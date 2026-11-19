// Compares the trees two parser builds make for the same files, node by node.
//
// A tree is the same when every node, anonymous ones included, agrees in kind, field name, named flag, MISSING flag
// and start/end offset, and when the root ends at the same place. Output: a summary and, for each changed file, the
// first differing node in document order (kind, field, range, parent kinds), enough to map a change to a fix.
//
// Usage: node scripts/tree-compare.mjs --base <base.node> --head <head.node> --list <paths file> [--root <dir>]
//          [--json] [--jobs 1..3] [--batch 1..500, default 100] [--max-rss-mb 2048]
//        node scripts/tree-compare.mjs --self-test
// A build is a compiled grammar binding (build/Release/tree_sitter_java_binding.node, see oracle/README.md); the
// tree-sitter Node module is the runtime for both. Offsets are the Node binding's `startIndex`/`endIndex`
// (UTF-16 code units, equal to bytes for ASCII), enough to tell two trees apart.
// Exit 0: no change. 1: at least one file changed. 2: inconsistent input or infrastructure error (bad option,
// unreadable list or file, missing build, a child over the memory cap or crashed).
//
// Memory: the Node binding frees a tree only when V8 collects it, and V8 cannot see native memory, so trees pile up
// in a long run (21 GB over 6k files, 2026-11-19). Each child process therefore gets at most --batch files (default 100, at most 500),
// runs with --max-old-space-size=1024 and --expose-gc, collects garbage every 25 files, keeps nothing after a file
// and stops with an error when its resident memory passes --max-rss-mb (default 2048). Up to 4 children run at once.
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

class Inconsistent extends Error {}

const desc = (c) => {
  const n = c.currentNode;
  return {
    field: c.currentFieldName ?? null,
    kind: n.type,
    named: n.isNamed,
    missing: n.isMissing,
    start: n.startIndex,
    end: n.endIndex,
    row: n.startPosition ? n.startPosition.row + 1 : undefined,
  };
};
const KEYS = ['field', 'kind', 'named', 'missing', 'start', 'end'];
const sameNode = (x, y) => KEYS.every((k) => x[k] === y[k]);

// First difference of two cursors at their roots, in document order; null when the trees are the same. A cursor needs
// currentNode, currentFieldName, gotoFirstChild, gotoNextSibling and gotoParent. The nodes are compared in lockstep, so
// nothing but two cursors is kept.
export function firstDiff(a, b) {
  const path = [];
  const report = (x, y) => ({ base: x, head: y, path: path.slice(-4).join(' > ') });
  for (;;) {
    const x = desc(a);
    const y = desc(b);
    if (!sameNode(x, y)) return report(x, y);
    const ga = a.gotoFirstChild();
    const gb = b.gotoFirstChild();
    if (ga !== gb) {
      path.push(x.kind);
      return report(ga ? desc(a) : null, gb ? desc(b) : null);
    }
    if (ga) {
      path.push(x.kind);
      continue;
    }
    for (;;) {
      const na = a.gotoNextSibling();
      const nb = b.gotoNextSibling();
      if (na !== nb) return report(na ? desc(a) : null, nb ? desc(b) : null);
      if (na) break;
      const pa = a.gotoParent();
      const pb = b.gotoParent();
      if (!pa || !pb) return null;
      path.pop();
    }
  }
}

// ---- child: parses one batch with both builds ----
async function runBatch({ base, head, root, files, maxRssMb }) {
  const require = createRequire(import.meta.url);
  const Parser = require('tree-sitter');
  const parsers = [base, head].map((p) => {
    const parser = new Parser();
    parser.setLanguage(require(resolve(p)));
    return parser;
  });
  const results = [];
  let peak = 0;
  const rss = () => (peak = Math.max(peak, process.memoryUsage.rss()));
  for (const [i, file] of files.entries()) {
    let src = readFileSync(join(root, file), 'utf8');
    const size = Math.max(32 * 1024, src.length * 4);
    let trees = parsers.map((p) => p.parse(src, null, { bufferSize: size }));
    const diff = firstDiff(trees[0].walk(), trees[1].walk());
    results.push({ file, diff, baseError: trees[0].rootNode.hasError, headError: trees[1].rootNode.hasError });
    src = trees = null;
    if (i % 25 === 24) {
      globalThis.gc();
      if (rss() > maxRssMb * 2 ** 20)
        throw new Inconsistent(`child over the memory cap: ${(peak / 2 ** 20).toFixed(0)} MB resident after ${i + 1} files`);
    }
  }
  globalThis.gc();
  rss();
  return { results, peak };
}

// ---- parent ----
function readList(listPath) {
  let text;
  try {
    text = readFileSync(listPath, 'utf8');
  } catch (e) {
    throw new Inconsistent(`${listPath}: cannot read: ${e.message}`);
  }
  const files = text.split(/\r?\n/).filter(Boolean);
  if (!files.length) throw new Inconsistent(`${listPath}: no files`);
  return files;
}

function dispatch(job) {
  return new Promise((done, fail) => {
    const child = fork(fileURLToPath(import.meta.url), ['--child'], {
      execArgv: ['--max-old-space-size=1024', '--expose-gc'],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let reply;
    child.on('message', (m) => (reply = m));
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      if (reply?.error) fail(new Inconsistent(reply.error));
      else if (reply?.results) done(reply);
      else fail(new Inconsistent(`child ended without a result (exit ${code ?? signal})`));
    });
    child.send(job);
  });
}

export async function compare({ base, head, list, root = '.', jobs = 2, batch = 100, maxRssMb = 2048 }) {
  const files = readList(list);
  const batches = [];
  for (let i = 0; i < files.length; i += batch) batches.push(files.slice(i, i + batch));
  const out = new Array(batches.length);
  let next = 0;
  let peak = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      const r = await dispatch({ base, head, root, files: batches[i], maxRssMb });
      out[i] = r.results;
      peak = Math.max(peak, r.peak);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, batches.length) }, worker));
  const results = out.flat();
  const changed = results.filter((r) => r.diff).map(({ file, diff }) => ({ file, ...diff }));
  const summary = {
    files: results.length,
    same: results.length - changed.length,
    changed: changed.length,
    base_error: results.filter((r) => r.baseError).length,
    head_error: results.filter((r) => r.headError).length,
    batches: batches.length,
    peak_child_rss_mb: Math.round(peak / 2 ** 20),
  };
  return { summary, changed };
}

const fmt = (n) => (n ? `${n.field ? `${n.field}:` : ''}${n.kind}${n.named ? '' : ' (anonymous)'}${n.missing ? ' MISSING' : ''} [${n.start}-${n.end}]` : 'none');

// ---- self-test: a changed tree is reported, an identical tree is not, an anonymous-token swap is reported ----
const fake = (type, [start, end], children = [], { named = true, field = null } = {}) => ({ type, start, end, children, named, field });
function cursor(root) {
  let stack = [{ node: root, i: 0 }];
  const top = () => stack.at(-1);
  return {
    get currentNode() {
      const n = top().node;
      return { type: n.type, isNamed: n.named, isMissing: false, startIndex: n.start, endIndex: n.end };
    },
    get currentFieldName() {
      return top().node.field;
    },
    gotoFirstChild() {
      const kid = top().node.children[0];
      if (!kid) return false;
      stack.push({ node: kid, i: 0 });
      return true;
    },
    gotoNextSibling() {
      if (stack.length < 2) return false;
      const parent = stack.at(-2).node;
      const i = top().i + 1;
      if (i >= parent.children.length) return false;
      stack[stack.length - 1] = { node: parent.children[i], i };
      return true;
    },
    gotoParent() {
      if (stack.length < 2) return false;
      stack.pop();
      return true;
    },
  };
}

async function selfTest() {
  // switch_label [0-10] with the keyword `default` as an anonymous child, as in K3.
  const label = (kw, named) => fake('switch_label', [0, 10], [fake(kw, [0, 7], [], { named }), fake('->', [8, 10], [], { named: false })]);
  const root = (child) => fake('program', [0, 10], [child]);
  const diff = (x, y) => firstDiff(cursor(root(x)), cursor(root(y)));
  assert.equal(diff(label('default', false), label('default', false)), null, 'identical trees are not reported');
  const swap = diff(label('default', false), label('default', true));
  assert.deepEqual([swap.base.kind, swap.base.named, swap.head.named, swap.path], ['default', false, true, 'program > switch_label'], 'anonymous swap');
  const kind = diff(label('default', false), label('case', false));
  assert.equal(kind.head.kind, 'case', 'kind change');
  const range = firstDiff(cursor(fake('a', [0, 5], [fake('b', [0, 5])])), cursor(fake('a', [0, 6], [fake('b', [0, 5])])));
  assert.equal(range.base.end, 5, 'root end change');
  const extra = firstDiff(cursor(fake('a', [0, 5], [fake('b', [0, 5])])), cursor(fake('a', [0, 5], [fake('b', [0, 5]), fake('c', [5, 5])])));
  assert.deepEqual([extra.base, extra.head.kind], [null, 'c'], 'extra child');
  const field = firstDiff(cursor(fake('a', [0, 5], [fake('b', [0, 5], [], { field: 'x' })])), cursor(fake('a', [0, 5], [fake('b', [0, 5], [], { field: 'y' })])));
  assert.equal(field.head.field, 'y', 'field change');

  // End to end: the real binding of this repository, two copies as base and head, in one child.
  const build = fileURLToPath(new URL('../build/Release/tree_sitter_java_binding.node', import.meta.url));
  const Parser = createRequire(import.meta.url)('tree-sitter');
  const parser = new Parser();
  try {
    parser.setLanguage(createRequire(import.meta.url)(build));
  } catch (e) {
    console.log(`self-test: synthetic cases passed; no binding at ${build}, end-to-end check skipped`);
    return;
  }
  const parse = (s) => parser.parse(s).walk();
  assert.equal(firstDiff(parse('class A { int x; }'), parse('class A { int x; }')), null);
  // The root's end differs first, in document order.
  assert.deepEqual(firstDiff(parse('class A {}'), parse('class A { int x; }')).head, { field: null, kind: 'program', named: true, missing: false, start: 0, end: 18, row: 1 });
  console.log('self-test: passed');
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      base: { type: 'string' }, head: { type: 'string' }, list: { type: 'string' }, root: { type: 'string', default: '.' },
      json: { type: 'boolean' }, jobs: { type: 'string', default: '2' }, batch: { type: 'string', default: '100' },
      'max-rss-mb': { type: 'string', default: '2048' }, 'self-test': { type: 'boolean' }, child: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.child) {
    process.on('message', async (job) => {
      try {
        process.send(await runBatch(job));
      } catch (e) {
        process.send({ error: `${e.message}` });
      }
      process.exit(0);
    });
    return;
  }
  if (values['self-test']) return selfTest();
  const num = (name, lo, hi) => {
    const v = Number(values[name]);
    if (!Number.isInteger(v) || v < lo || v > hi) throw new Inconsistent(`--${name} must be an integer from ${lo} to ${hi}`);
    return v;
  };
  if (positionals.length || !values.base || !values.head || !values.list)
    throw new Inconsistent('usage: tree-compare.mjs --base <base.node> --head <head.node> --list <paths file> [--root <dir>] [--json] [--jobs 1-3] [--batch 1-500] [--max-rss-mb N]');
  const { summary, changed } = await compare({
    base: values.base, head: values.head, list: values.list, root: values.root,
    jobs: num('jobs', 1, 3), batch: num('batch', 1, 500), maxRssMb: num('max-rss-mb', 64, 2048),
  });
  if (values.json) console.log(JSON.stringify({ summary, changed }, null, 2));
  else {
    console.log(Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' '));
    for (const c of changed) console.log(`${c.file}\tline ${c.base?.row ?? c.head?.row}\tbase ${fmt(c.base)}\thead ${fmt(c.head)}\tunder ${c.path || 'root'}`);
  }
  process.exitCode = changed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(`tree-compare: ${e.message}`);
    process.exitCode = 2;
  });
