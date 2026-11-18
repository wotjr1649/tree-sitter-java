// Replays the javac oracle against the current grammar (oracle/README.md).
//
// Every case in oracle/data/cases/*.jsonl is parsed through the tree-sitter Node API (never the CLI summary) and
// judged: root hasError, any ERROR or MISSING node, zero-width nodes, the root ending at the end of the input, and
// the case's own assertions. A case is a mismatch when javac accepted it (oracle/data/verdicts) and the tree is
// bad. Rule (a): mismatches must equal oracle/data/expected-failures.json exactly.
//
// Usage: node scripts/oracle-replay.mjs
// Exit 0: results equal the baseline. 1: they differ (an unlisted mismatch, or a listed case that no longer
// fails). 2: the inputs are inconsistent (hash mismatch, verdicts made from other cases, bad entry).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Parser from 'tree-sitter';
import Java from '../bindings/node/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const DATA = `${root}oracle/data/`;
const RUNNER = `${root}oracle/runner/ParseOracle.java`;

export class Inconsistent extends Error {}
const fail = (message) => {
  throw new Inconsistent(message);
};

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const files = (dir, ext) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .sort();

// --- inputs ---------------------------------------------------------------------------------------------------

export function loadCases() {
  const sets = [];
  const ids = new Set();
  for (const name of files(`${DATA}cases/`, '.jsonl')) {
    const bytes = readFileSync(`${DATA}cases/${name}`);
    const cases = bytes
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    for (const c of cases) {
      for (const key of ['id', 'sha256', 'source'])
        if (typeof c[key] !== 'string') fail(`${name}: a case has no string "${key}"`);
      if (!c.provenance) fail(`${name}: ${c.id} has no provenance`);
      const actual = sha256(Buffer.from(c.source, 'utf8'));
      if (actual !== c.sha256) fail(`${name}: ${c.id} sha256 is ${c.sha256}, its source hashes to ${actual}`);
      if (ids.has(c.id)) fail(`duplicate case id ${c.id}`);
      ids.add(c.id);
    }
    sets.push({ name, sha: sha256(bytes), cases });
  }
  if (!sets.length) fail('no case sets');
  return sets;
}

// Verdict files are bound by meta.cases_sha256 to exactly one case set; the result maps case id -> error codes.
export function loadVerdicts(sets) {
  const verdicts = {};
  const covered = new Set();
  const runnerSha = sha256(readFileSync(RUNNER));
  const levels = new Set();
  for (const name of files(`${DATA}verdicts/`, '.json')) {
    const { meta, verdicts: v } = JSON.parse(readFileSync(`${DATA}verdicts/${name}`, 'utf8'));
    const set = sets.find((s) => s.sha === meta.cases_sha256);
    if (!set) fail(`${name}: made from cases that are not in the repository`);
    if (covered.has(set.name)) fail(`${name}: a second verdict file for ${set.name}`);
    covered.add(set.name);
    if (meta.release !== '25' || meta.preview !== false) fail(`${name}: not Java 25 with preview off`);
    if (meta.runner_sha256 !== runnerSha) fail(`${name}: made by a different runner than oracle/runner`);
    levels.add(`${meta['java.vendor']} ${meta['java.runtime.version']}`);
    const ids = set.cases.map((c) => c.id);
    if (JSON.stringify(Object.keys(v)) !== JSON.stringify(ids)) fail(`${name}: verdict ids differ from ${set.name}`);
    Object.assign(verdicts, v);
  }
  for (const s of sets) if (!covered.has(s.name)) fail(`${s.name}: no verdict file`);
  if (levels.size !== 1) fail(`verdict files come from different JDKs: ${[...levels].join('; ')}`);
  return { verdicts, jdk: [...levels][0] };
}

// --- judging --------------------------------------------------------------------------------------------------

function* preorder(tree) {
  const cursor = tree.walk();
  for (;;) {
    yield cursor.currentNode;
    if (cursor.gotoFirstChild()) continue;
    while (!cursor.gotoNextSibling()) if (!cursor.gotoParent()) return;
  }
}

// Offsets are JS string indexes: the node binding counts UTF-16 code units.
function locate(c, a) {
  const at = c.source.indexOf(a.in);
  if (at < 0 || c.source.indexOf(a.in, at + 1) >= 0) fail(`${c.id}: assertion text ${JSON.stringify(a.in)} is not unique in the source`);
  const inner = a.in.indexOf(a.text);
  if (inner < 0) fail(`${c.id}: assertion text ${JSON.stringify(a.text)} is not inside ${JSON.stringify(a.in)}`);
  return [at + inner, at + inner + a.text.length];
}

// `range-kinds`: among all nodes (anonymous and named) inside the range of `text` (found in `in`), every `require`
// {kind, named} is present and no node has a `forbid` kind.
function assertion(c, a, nodes) {
  if (a.type !== 'range-kinds') fail(`${c.id}: unknown assertion type ${a.type}`);
  const [from, to] = locate(c, a);
  const inside = nodes.filter((n) => n.startIndex >= from && n.endIndex <= to);
  const seen = inside.map((n) => (n.isNamed ? n.type : `"${n.type}"`)).join(' ');
  const reasons = [];
  for (const r of a.require ?? [])
    if (!inside.some((n) => n.type === r.kind && n.isNamed === r.named))
      reasons.push(`${JSON.stringify(a.text)} has no ${r.named ? 'named' : 'anonymous'} ${r.kind} node (found: ${seen || 'none'})`);
  for (const kind of a.forbid ?? [])
    if (inside.some((n) => n.type === kind)) reasons.push(`${JSON.stringify(a.text)} has a ${kind} node (found: ${seen})`);
  return reasons;
}

export function judge(parser, c) {
  const tree = parser.parse(c.source);
  const rootNode = tree.rootNode;
  const nodes = [...preorder(tree)];
  const len = c.source.length;
  const reasons = [];
  if (rootNode.hasError) reasons.push('root hasError');
  const count = (pred) => nodes.filter(pred).length;
  const errors = count((n) => n.isError);
  const missing = count((n) => n.isMissing);
  // A missing node is zero-width by construction; count it once, as missing (as mssql's tree-check does).
  const zero = count((n) => !n.isMissing && n.startIndex === n.endIndex && len > 0);
  if (errors) reasons.push(`${errors} ERROR`);
  if (missing) reasons.push(`${missing} MISSING`);
  if (zero) reasons.push(`${zero} zero-width`);
  if (rootNode.endIndex !== len) reasons.push(`root ends at ${rootNode.endIndex}, input has ${len}`);
  for (const a of c.assert ?? []) reasons.push(...assertion(c, a, nodes));
  return { ok: reasons.length === 0, reasons, tree: rootNode.toString() };
}

export function judgeAll(sets) {
  const parser = new Parser();
  parser.setLanguage(Java);
  return Object.fromEntries(sets.flatMap((s) => s.cases.map((c) => [c.id, judge(parser, c)])));
}

// --- baseline -------------------------------------------------------------------------------------------------

export function loadExpected(sets, verdicts) {
  const expected = JSON.parse(readFileSync(`${DATA}expected-failures.json`, 'utf8'));
  const byId = Object.fromEntries(sets.flatMap((s) => s.cases.map((c) => [c.id, c])));
  if (!expected.grammar_base?.commit || !expected.grammar_base?.parser_c_sha256) fail('expected-failures.json: no grammar_base');
  for (const [id, e] of Object.entries(expected.cases)) {
    if (!byId[id]) fail(`expected-failures.json: unknown case ${id}`);
    if (e.sha256 !== byId[id].sha256) fail(`expected-failures.json: ${id} is bound to a different input (${e.sha256})`);
    if (verdicts[id].length) fail(`expected-failures.json: ${id} is not a confirmed mismatch, javac rejected it`);
    if (!e.base_tree || !e.k) fail(`expected-failures.json: ${id} needs "k" and "base_tree"`);
  }
  return expected;
}

export function compare(expected, verdicts, results) {
  const mismatches = Object.keys(results).filter((id) => verdicts[id].length === 0 && !results[id].ok);
  const listed = Object.keys(expected.cases);
  return {
    mismatches,
    unlisted: mismatches.filter((id) => !listed.includes(id)),
    stale: listed.filter((id) => !mismatches.includes(id)),
    changedTree: listed.filter((id) => mismatches.includes(id) && results[id].tree !== expected.cases[id].base_tree),
    rejectedClean: Object.keys(results).filter((id) => verdicts[id].length && results[id].ok),
  };
}

function main() {
  const sets = loadCases();
  const { verdicts, jdk } = loadVerdicts(sets);
  const expected = loadExpected(sets, verdicts);
  const results = judgeAll(sets);
  const r = compare(expected, verdicts, results);

  console.log(`oracle: ${jdk}, --release 25, preview off; ${Object.keys(results).length} cases`);
  for (const id of Object.keys(results)) {
    const javac = verdicts[id].length ? `rejected ${verdicts[id].join(',')}` : 'accepted';
    const tree = results[id].ok ? 'clean' : `bad (${results[id].reasons.join('; ')})`;
    const note = r.mismatches.includes(id) ? (r.unlisted.includes(id) ? 'MISMATCH' : 'expected failure') : r.rejectedClean.includes(id) ? 'rejected-clean' : 'agree';
    console.log(`${id.padEnd(44)} javac ${javac.padEnd(38)} tree ${tree}  [${note}]`);
  }
  const grammar = sha256(readFileSync(`${root}src/parser.c`));
  if (grammar !== expected.grammar_base.parser_c_sha256)
    console.log(`note: src/parser.c differs from the grammar base ${expected.grammar_base.commit.slice(0, 7)}`);
  for (const id of r.changedTree) console.log(`note: ${id} still fails, but its tree differs from the recorded base tree`);
  if (r.rejectedClean.length)
    console.log(`info: ${r.rejectedClean.length} case(s) javac rejects parse clean (the grammar is not required to reject them)`);

  for (const id of r.unlisted) console.error(`not in expected-failures.json: ${id} (javac accepts it, the tree is bad)`);
  for (const id of r.stale) console.error(`listed in expected-failures.json but no longer fails: ${id} (delete the entry)`);
  const bad = r.unlisted.length + r.stale.length;
  console.log(bad ? `FAIL: ${bad} difference(s) from the baseline` : `OK: ${r.mismatches.length} expected failure(s), no other mismatch`);
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (e) {
    if (!(e instanceof Inconsistent)) throw e;
    console.error(`inconsistent inputs: ${e.message}`);
    process.exitCode = 2;
  }
}
