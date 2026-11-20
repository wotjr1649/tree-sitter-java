// Replays the javac oracle against the current grammar (oracle/README.md).
//
// Every case in oracle/data/cases/*.jsonl is parsed through the tree-sitter Node API (never the CLI summary) and
// judged: root hasError, any ERROR or MISSING node, zero-width nodes, the root ending at the end of the input, and
// the case's own assertions. A case is a mismatch when javac accepted it (oracle/data/verdicts) and the tree is
// bad. Rule (a): mismatches must equal oracle/data/expected-failures.json exactly. Cases marked expectError also
// require javac to reject the input and the grammar to produce ERROR or MISSING.
//
// Usage: node scripts/oracle-replay.mjs
// Exit 0: results equal the baseline. 1: they differ (an unlisted mismatch, or a listed case that no longer
// fails). 2: the inputs are inconsistent: an unreadable or malformed file, a hash mismatch, verdicts made from other
// cases or by another oracle, an empty case set, a bad expected-failure entry.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DATA = `${root}oracle/data/`;
const RUNNER = `${root}oracle/runner/ParseOracle.java`;

// The oracle a verdict file must come from (oracle/runner/ParseOracle.java fixes the same values).
export const ORACLE = {
  'java.vendor': 'Eclipse Adoptium',
  'java.runtime.version': '25.0.5+8-LTS',
  api: 'com.sun.source.util.JavacTask.parse()',
  options: ['--release', '25', '-proc:none'],
  preview: false,
  release: '25',
  source_encoding: 'UTF-8',
};

// Fixed evidence for rule (a): the grammar base v1.0.0 (a241253). 6744e4a has identical grammar.js and src/.
export const GRAMMAR_BASE = {
  commit: 'a241253570b20a5f83c9dde367a5a50f0116a978',
  parser_c_sha256: '85977add5c0918e0991c2decf75ad7aa66539811786703653ee9c9f1ed4ef523',
  grammar_js_sha256: 'b89ada7566bda16a8d7a710755c27824d6097e44b8d3b1dafbb749f3c34d13e0',
};

export class Inconsistent extends Error {}
const fail = (message) => {
  throw new Inconsistent(message);
};

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// File and JSON errors are inconsistent inputs (exit 2) and name the file.
const readBytes = (path) => {
  try {
    return readFileSync(path);
  } catch (e) {
    return fail(`${path}: cannot read: ${e.message}`);
  }
};
const parseJson = (text, where) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fail(`${where}: malformed JSON: ${e.message}`);
  }
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const files = (dir, ext) => {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(ext))
      .sort();
  } catch (e) {
    return fail(`${dir}: cannot list: ${e.message}`);
  }
};

// --- inputs ---------------------------------------------------------------------------------------------------

// Every assertion field the replay reads is checked here, so a wrong shape is an input error (exit 2), not a crash.
const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
function checkAssertions(name, c) {
  if (c.assert === undefined) return;
  const where = `${name}: ${c.id} assert`;
  if (!Array.isArray(c.assert)) fail(`${where} must be an array`);
  for (const a of c.assert) {
    if (!isObject(a) || a.type !== 'range-kinds') fail(`${where}: each assertion is an object of type "range-kinds"`);
    if (typeof a.in !== 'string' || typeof a.text !== 'string') fail(`${where}: "in" and "text" must be strings`);
    if (a.require !== undefined && !(Array.isArray(a.require) && a.require.every((r) => isObject(r) && typeof r.kind === 'string' && typeof r.named === 'boolean')))
      fail(`${where}: "require" must be an array of {kind: string, named: boolean}`);
    if (a.forbid !== undefined && !isStrings(a.forbid)) fail(`${where}: "forbid" must be an array of strings`);
  }
}

export function loadCases() {
  const sets = [];
  const ids = new Set();
  for (const name of files(`${DATA}cases/`, '.jsonl')) {
    const bytes = readBytes(`${DATA}cases/${name}`);
    const cases = bytes
      .toString('utf8')
      .split('\n')
      .map((line, n) => [line, n + 1])
      .filter(([line]) => line.trim())
      .map(([line, n]) => parseJson(line, `${name}:${n}`));
    if (!cases.length) fail(`${name}: no cases`);
    for (const c of cases) {
      if (!isObject(c)) fail(`${name}: a case line is not an object`);
      for (const key of ['id', 'sha256', 'source'])
        if (typeof c[key] !== 'string') fail(`${name}: a case has no string "${key}"`);
      if (!isObject(c.provenance)) fail(`${name}: ${c.id} needs a "provenance" object`);
      if (c.file != null && typeof c.file !== 'string') fail(`${name}: ${c.id} "file" must be a string or null`);
      if (c.expectError !== undefined && c.expectError !== true) fail(`${name}: ${c.id} "expectError" must be true when present`);
      checkAssertions(name, c);
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
  const runnerSha = sha256(readBytes(RUNNER));
  const levels = new Set();
  for (const name of files(`${DATA}verdicts/`, '.json')) {
    const file = parseJson(readBytes(`${DATA}verdicts/${name}`).toString('utf8'), name);
    if (!isObject(file) || !isObject(file.meta) || !isObject(file.verdicts)) fail(`${name}: must be an object with "meta" and "verdicts" objects`);
    const { meta, verdicts: v } = file;
    const set = sets.find((s) => s.sha === meta.cases_sha256);
    if (!set) fail(`${name}: made from cases that are not in the repository`);
    if (covered.has(set.name)) fail(`${name}: a second verdict file for ${set.name}`);
    covered.add(set.name);
    for (const [key, want] of Object.entries(ORACLE))
      if (JSON.stringify(meta[key]) !== JSON.stringify(want))
        fail(`${name}: meta.${key} is ${JSON.stringify(meta[key])}, the oracle is ${JSON.stringify(want)}`);
    if (meta.case_count !== set.cases.length) fail(`${name}: meta.case_count is ${meta.case_count}, ${set.name} has ${set.cases.length} cases`);
    if (meta.runner_sha256 !== runnerSha) fail(`${name}: made by a different runner than oracle/runner`);
    levels.add(`${meta['java.vendor']} ${meta['java.runtime.version']}`);
    const ids = set.cases.map((c) => c.id);
    if (JSON.stringify(Object.keys(v)) !== JSON.stringify(ids)) fail(`${name}: verdict ids differ from ${set.name}`);
    for (const [id, codes] of Object.entries(v))
      if (!Array.isArray(codes) || codes.some((code) => typeof code !== 'string'))
        fail(`${name}: the verdict of ${id} is not an array of strings`);
    for (const c of set.cases)
      if (c.expectError && !v[c.id].length) fail(`${name}: ${c.id} expects an error but javac accepts it`);
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
  return { ok: reasons.length === 0, hasSyntaxError: errors > 0 || missing > 0, reasons, tree: rootNode.toString() };
}

export function judgeAll(sets) {
  const require = createRequire(import.meta.url);
  const Parser = require('tree-sitter');
  const parser = new Parser();
  parser.setLanguage(require('../bindings/node'));
  return Object.fromEntries(sets.flatMap((s) => s.cases.map((c) => [c.id, judge(parser, c)])));
}

// --- baseline -------------------------------------------------------------------------------------------------

export function loadExpected(sets, verdicts) {
  const expected = parseJson(readBytes(`${DATA}expected-failures.json`).toString('utf8'), 'expected-failures.json');
  if (!isObject(expected) || !isObject(expected.cases) || !isObject(expected.grammar_base)) fail('expected-failures.json: needs "grammar_base" and "cases" objects');
  const byId = Object.fromEntries(sets.flatMap((s) => s.cases.map((c) => [c.id, c])));
  for (const [key, want] of Object.entries(GRAMMAR_BASE))
    if (expected.grammar_base[key] !== want) fail(`expected-failures.json: grammar_base.${key} is ${expected.grammar_base[key]}, the base v1.0.0 has ${want}`);
  for (const [id, e] of Object.entries(expected.cases)) {
    if (!isObject(e)) fail(`expected-failures.json: the entry of ${id} must be an object`);
    for (const key of ['k', 'sha256', 'base_tree'])
      if (typeof e[key] !== 'string' || !e[key]) fail(`expected-failures.json: the entry of ${id} needs a non-empty string "${key}"`);
    if (!byId[id]) fail(`expected-failures.json: unknown case ${id}`);
    if (e.sha256 !== byId[id].sha256) fail(`expected-failures.json: ${id} is bound to a different input (${e.sha256})`);
    if (verdicts[id].length) fail(`expected-failures.json: ${id} is not a confirmed mismatch, javac rejected it`);
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
  // At the grammar base the recorded base trees must be exactly the current trees; after a fix PR changes the parser
  // they are history, and a changed tree is only noted.
  const atBase = sha256(readBytes(`${root}src/parser.c`)) === GRAMMAR_BASE.parser_c_sha256;
  if (atBase)
    for (const [id, e] of Object.entries(expected.cases))
      if (results[id].tree !== e.base_tree) fail(`expected-failures.json: the base_tree of ${id} is not its tree at the grammar base`);
  const r = compare(expected, verdicts, results);
  const missedErrors = sets.flatMap((s) => s.cases
    .filter((c) => c.expectError && !results[c.id].hasSyntaxError)
    .map((c) => c.id));

  console.log(`oracle: ${jdk}, --release 25, preview off; ${Object.keys(results).length} cases`);
  for (const id of Object.keys(results)) {
    const javac = verdicts[id].length ? `rejected ${verdicts[id].join(',')}` : 'accepted';
    const tree = results[id].ok ? 'clean' : `bad (${results[id].reasons.join('; ')})`;
    const note = r.mismatches.includes(id) ? (r.unlisted.includes(id) ? 'MISMATCH' : 'expected failure') : r.rejectedClean.includes(id) ? 'rejected-clean' : 'agree';
    console.log(`${id.padEnd(44)} javac ${javac.padEnd(38)} tree ${tree}  [${note}]`);
  }
  if (!atBase) console.log(`note: src/parser.c differs from the grammar base ${GRAMMAR_BASE.commit.slice(0, 7)}`);
  for (const id of r.changedTree) console.log(`note: ${id} still fails, but its tree differs from the recorded base tree`);
  if (r.rejectedClean.length)
    console.log(`info: ${r.rejectedClean.length} case(s) javac rejects parse clean (the grammar is not required to reject them)`);

  for (const id of r.unlisted) console.error(`not in expected-failures.json: ${id} (javac accepts it, the tree is bad)`);
  for (const id of r.stale) console.error(`listed in expected-failures.json but no longer fails: ${id} (delete the entry)`);
  for (const id of missedErrors) console.error(`expected ERROR or MISSING: ${id}`);
  const bad = r.unlisted.length + r.stale.length + missedErrors.length;
  console.log(bad ? `FAIL: ${bad} unexpected result(s)` : `OK: ${r.mismatches.length} expected failure(s), no other mismatch`);
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
