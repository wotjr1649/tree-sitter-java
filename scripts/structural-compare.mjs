// Compare parse-only javac ASTs with the Java binding over the same UTF-8 sources.
// Exit 0: matched (or equal to the baseline with --check). 1: unexpected differences. 2: tool/input fault.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { loadCases, loadVerdicts, sha256 } from './oracle-replay.mjs';
import { rssOf } from './tree-compare.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(import.meta.url);
const structural = join(root, 'oracle/structural');
const mib = 2 ** 20;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const counts = () => ({ matched: 0, mismatched_kind: 0, no_node_at_range: 0, unpositioned: 0, unclassified_context: 0, skipped_by_mapping: 0 });
const readText = (path) => decoder.decode(readFileSync(path));
const readRows = (path) => readText(path).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
const rowText = (rows) => rows.map((row) => JSON.stringify(row) + '\n').join('');

function oracleGroups() {
  const sets = loadCases();
  const { verdicts } = loadVerdicts(sets);
  const groups = { oracle: [], probes: [] };
  for (const { name, cases } of sets) {
    const probes = name === 'structural.jsonl';
    for (const c of cases) {
      if (probes) assert.equal(verdicts[c.id].length, 0, `javac rejected probe ${c.id}`);
      if (!verdicts[c.id].length) groups[probes ? 'probes' : 'oracle'].push(c);
    }
  }
  return groups;
}

function corpusCases() {
  const dir = join(root, 'test/corpus');
  return readdirSync(dir).filter((name) => name.endsWith('.txt')).sort().flatMap((name) => {
    const text = readText(join(dir, name));
    // shortcut: the checked-in corpus uses unsuffixed headers and one divider per case.
    const headers = [...text.matchAll(/^(={3,})\r?\n([^\r\n]+)\r?\n(?::[^\r\n]*\r?\n)*\1\r?$/gm)];
    assert.ok(headers.length && headers[0].index === 0, `invalid corpus header in ${name}`);
    return headers.map((header, index) => {
      const body = text.slice(header.index + header[0].length + 1, headers[index + 1]?.index);
      const dividers = [...body.matchAll(/^-{3,}\r?$/gm)];
      assert.equal(dividers.length, 1, `need one divider in ${name}: ${header[2]}`);
      // tree-sitter test keeps the leading whitespace and removes the divider's preceding line ending.
      const source = body.slice(0, dividers[0].index).replace(/\n$/, '').replace(/\r$/, '');
      return { id: `corpus/${name}/${header[2].trimEnd()}`, source, sha256: sha256(source) };
    });
  });
}

function byteOffsets(source) {
  if (Buffer.byteLength(source) === source.length) return null;
  const offsets = new Int32Array(source.length + 1);
  let bytes = 0;
  for (let i = 0; i < source.length;) {
    offsets[i] = bytes;
    const cp = source.codePointAt(i++);
    if (cp > 0xffff) {
      offsets[i++] = -1;
      bytes += 4;
    } else {
      bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : 3;
    }
  }
  offsets[source.length] = bytes;
  return offsets;
}

function* preorder(tree) {
  const cursor = tree.walk();
  for (;;) {
    yield cursor.currentNode;
    if (cursor.gotoFirstChild()) continue;
    while (!cursor.gotoNextSibling()) if (!cursor.gotoParent()) return;
  }
}

const sourceChildren = (node) => node.children.filter((child) => !child.isExtra && !child.isMissing);

function projections(node) {
  switch (node.type) {
    case 'explicit_constructor_invocation': {
      const args = node.childForFieldName('arguments');
      if (!args) return [];
      const ranges = [[node.startIndex, args.endIndex, 'constructor-call']];
      const typeArgs = node.childForFieldName('type_arguments');
      const constructor = node.childForFieldName('constructor');
      if (typeArgs && constructor && !node.childForFieldName('object'))
        ranges.push([typeArgs.startIndex, constructor.endIndex, 'constructor-selector']);
      return ranges;
    }
    case 'switch_block_statement_group': {
      const children = sourceChildren(node);
      const labels = children.filter((child) => child.type === 'switch_label');
      return labels.map((label, i) => {
        const colon = children[children.indexOf(label) + 1];
        return [label.startIndex, i === labels.length - 1 ? node.endIndex : colon?.endIndex, 'colon-case'];
      });
    }
    case 'instanceof_expression': {
      const name = node.childForFieldName('name');
      if (!name) return [];
      const children = sourceChildren(node);
      const first = children[children.findIndex((child) => child.type === 'instanceof') + 1];
      return first ? [[first.startIndex, name.endIndex, 'instanceof-binding-tail']] : [];
    }
    case 'wildcard': {
      const question = sourceChildren(node).find((child) => child.type === '?');
      return question ? [[question.startIndex, node.endIndex, 'wildcard-core']] : [];
    }
    default: return [];
  }
}

function rowFor(rules, javac) {
  const eligible = rules.filter(({ when }) =>
    !when || Object.entries(when).every(([key, value]) => javac[key] === value));
  return eligible.find(({ context }) => context === (javac.context ?? 'default'))
    ?? eligible.find(({ when }) => when)
    ?? eligible.find(({ context }) => context === 'default');
}

function describe(node, javac, rule, source, byteAt) {
  const candidate = { kind: node.type, named: node.isNamed };
  if (javac.operator !== undefined || rule.operator !== undefined) {
    if (node.type === 'update_expression') {
      const children = sourceChildren(node);
      const prefix = ['++', '--'].includes(children[0]?.type);
      candidate.operator = (prefix ? children[0] : children.at(-1))?.type;
      candidate.operatorPosition = prefix ? 'prefix' : 'postfix';
    } else {
      candidate.operator = node.type === 'element_value_pair' ? sourceChildren(node).find((child) => child.type === '=')?.type
        : node.childForFieldName(rule.operatorField ?? 'operator')?.type;
    }
  }
  if (javac.wrapsCast !== undefined)
    candidate.wrapsCast = node.namedChildren.some((child) => child.type === 'cast_expression');
  if (javac.explicitTypeArguments !== undefined)
    candidate.explicitTypeArguments = !!node.childForFieldName('type_arguments');
  if (javac.qualifiedSuper !== undefined) {
    // TypeName.super::m: the qualifier and a named super node are the named children before '::' (K20).
    const children = sourceChildren(node);
    const before = children.slice(0, children.findIndex((child) => child.type === '::')).filter((child) => child.isNamed);
    candidate.qualifiedSuper = before.length === 2 && before[1].type === 'super';
  }
  if (javac.providerRanges !== undefined)
    candidate.providerRanges = node.childrenForFieldName('provider').map((child) =>
      [byteAt(child.startIndex), byteAt(child.endIndex)]);
  if (javac.textBlock) {
    candidate.textBlockCommentRanges = [];
    candidate.uncoveredContinuationRanges = [];
    let end = node.startIndex;
    for (const child of node.children) {
      if (child.isExtra && (child.type === 'line_comment' || child.type === 'block_comment'))
        candidate.textBlockCommentRanges.push([byteAt(child.startIndex), byteAt(child.endIndex)]);
      for (const match of source.slice(end, child.startIndex).matchAll(/\\(?:\r\n?|\n)/g)) {
        const start = end + match.index;
        candidate.uncoveredContinuationRanges.push([byteAt(start), byteAt(start + match[0].length)]);
      }
      end = child.endIndex;
    }
  }
  return candidate;
}

function compareCase(parser, source, row, mapping) {
  const result = { id: row.id, errors: row.errors, counts: counts(), rows: {}, firstMismatch: null, mismatches: [] };
  if (row.errors.length) return result;
  const tree = parser.parse(source, null, { bufferSize: Math.max(32 * 1024, source.length * 4) });
  result.treeHasError = tree.rootNode.hasError || tree.rootNode.endIndex !== source.length;
  const offsets = byteOffsets(source);
  const byteAt = (index) => offsets ? offsets[index] : index;
  const ranges = new Map();
  const wanted = row.nodes.map((javac) => {
    const rule = rowFor(mapping[javac.kind], javac);
    if (rule && rule.action !== 'skip' && javac.start !== null && javac.end !== null)
      ranges.set(`${javac.start}:${javac.end}`, []);
    return { javac, rule };
  });
  for (const node of preorder(tree)) {
    if (node.isMissing || node.isExtra) continue;
    ranges.get(`${byteAt(node.startIndex)}:${byteAt(node.endIndex)}`)?.push({ node, range: 'same' });
    for (const [start, end, range] of projections(node))
      ranges.get(`${byteAt(start)}:${byteAt(end)}`)?.push({ node, range });
  }
  for (const { javac, rule } of wanted) {
    assert.ok(rule || !mapping[javac.kind].every(({ when }) => when),
      `${row.id}: ${javac.kind} at ${javac.start} has no row for its when attributes`);
    assert.ok(!javac.context || !rule || rule.when || rule.context === javac.context,
      `${row.id}: ${javac.kind} at ${javac.start} has no row for runner context ${javac.context}`);
    if (rule?.action === 'skip') {
      result.counts.skipped_by_mapping++;
      continue;
    }
    if (rule) result.rows[`${javac.kind}:${rule.context}`] = (result.rows[`${javac.kind}:${rule.context}`] ?? 0) + 1;
    const atRange = ranges.get(`${javac.start}:${javac.end}`) ?? [];
    const expected = rule?.ts ?? [];
    const attr = {
      operator: rule?.operator ?? javac.operator,
      operatorPosition: rule?.operatorPosition ?? (javac.kind.startsWith('PREFIX_') ? 'prefix'
        : javac.kind.startsWith('POSTFIX_') ? 'postfix' : undefined),
      wrapsCast: javac.wrapsCast,
      explicitTypeArguments: javac.explicitTypeArguments,
      qualifiedSuper: javac.qualifiedSuper,
      providerRanges: javac.providerRanges,
      textBlockCommentRanges: javac.textBlock ? [] : undefined,
      uncoveredContinuationRanges: javac.textBlock ? [] : undefined,
    };
    const candidates = rule ? atRange.filter(({ node, range }) => {
      if (range !== 'same' && range !== rule.range) return false;
      if (rule.range === 'constant-case-expression') return node.parent?.type === 'switch_label' && node.isNamed;
      return expected.some(({ kind, named }) => kind === node.type && named === node.isNamed);
    }) : [];
    const sameKind = candidates.map(({ node }) => describe(node, javac, rule, source, byteAt));
    const matched = rule?.action === 'compare-range-only' && candidates.length > 0
      || sameKind.some((candidate) => Object.entries(attr).every(([key, value]) => value === undefined || isDeepStrictEqual(candidate[key], value)));
    let status;
    if (!rule) status = 'unclassified_context';
    else if (javac.start === null || javac.end === null || javac.end < javac.start) status = 'unpositioned';
    else if (!atRange.length) status = 'no_node_at_range';
    else if (matched) status = 'matched';
    else status = 'mismatched_kind';
    result.counts[status]++;
    if (status !== 'matched') {
      const mismatch = { group: rule?.group ?? 'Unclassified context', status, javac,
        expected: expected.map(({ kind }) => kind), candidates: [...new Set(atRange.map(({ node }) => node.type))], sameKind };
      result.firstMismatch ??= mismatch;
      result.mismatches.push(mismatch);
    }
  }
  return result;
}

function makeParser(binding, runtime) {
  const Parser = require(runtime ?? 'tree-sitter');
  const parser = new Parser();
  parser.setLanguage(binding ? require(binding) : require('../bindings/node'));
  return parser;
}

function worker(configFile) {
  const { binding, runtime, mapping, inputs, structures, output, maxRss } = JSON.parse(readText(configFile));
  const parser = makeParser(binding, runtime);
  const cases = readRows(inputs);
  const rows = readRows(structures);
  assert.equal(cases.length, rows.length, 'javac and comparator case counts differ');
  let peak = 0;
  const measure = () => {
    peak = Math.max(peak, process.memoryUsage.rss());
    assert.ok(peak <= maxRss, `Node worker over memory cap: ${Math.ceil(peak / mib)} MiB resident`);
  };
  const results = cases.map((c, i) => {
    assert.equal(rows[i].id, c.id, 'javac and comparator case IDs differ');
    const result = compareCase(parser, c.source, rows[i], mapping);
    measure();
    if (i % 25 === 24) globalThis.gc();
    return result;
  });
  globalThis.gc();
  measure();
  writeFileSync(output, JSON.stringify({ results, peak }));
}

async function runChild(command, args, maxRss) {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
    env: { ...process.env, UV_THREADPOOL_SIZE: '1' } });
  let peak = 0, checking = false, failure;
  const stop = (error) => {
    failure ??= error;
    child.kill();
  };
  const timer = setInterval(async () => {
    if (!child.pid || checking) return;
    checking = true;
    try {
      const rss = (await rssOf(new Set([child.pid]))).get(child.pid) ?? 0;
      peak = Math.max(peak, rss);
      if (rss > maxRss) stop(new Error(`child over memory cap: ${Math.ceil(rss / mib)} MiB resident`));
    } catch (e) {
      stop(e);
    } finally {
      checking = false;
    }
  }, 500);
  const deadline = setTimeout(() => stop(new Error('batch child exceeded 120 seconds')), 120_000);
  try {
    const code = await new Promise((done) => {
      child.once('error', (e) => { failure ??= e; });
      child.once('close', (code, signal) => done(code ?? signal));
    });
    if (failure) throw failure;
    if (code !== 0) throw new Error(`${command} exited with ${code}`);
    return peak;
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
  }
}

// Contexts StructuralOracle.context() can emit, by javac kind. Keep in step with the runner.
const runnerContexts = {
  ASSIGNMENT: ['annotation-element'],
  METHOD_INVOCATION: ['explicit-constructor-invocation'],
  EXPRESSION_STATEMENT: ['explicit-constructor-invocation', 'for-header'],
  MEMBER_SELECT: ['annotated-catch-qualification', 'class-literal', 'flattened-selector', 'qualified-name'],
  IDENTIFIER: ['synthetic-enum-type', 'annotated-varargs-element', 'constructor-keyword-with-type-arguments',
    'this-or-super', 'type-or-unresolved-name'],
  BLOCK: ['static-initializer', 'constructor-body'],
  PATTERN_CASE_LABEL: ['non-jls-mixed-switch-label'],
  DECONSTRUCTION_PATTERN: ['non-jls-mixed-switch-label'],
  CASE: ['arrow-rule', 'colon-case'],
  BINDING_PATTERN: ['instanceof-type-binding', 'switch-or-record-component'],
  MODIFIERS: ['empty-synthetic-or-split', 'instanceof-bare-final', 'contiguous-modifiers'],
  ANNOTATED_TYPE: ['leading-annotated-type', 'distributed-annotations'],
  ARRAY_TYPE: ['nested-or-distributed-array-type', 'outer-contiguous-array-type'],
  VARIABLE: ['enum-constant', 'ordinary-formal-or-catch-parameter', 'single-local-declaration'],
  PARAMETERIZED_TYPE: ['annotated-varargs-element'],
  NEW_CLASS: ['enum-constant-initializer'],
  CLASS: ['implicit-class', 'anonymous-class'],
  // An anonymous class body is always a CLASS tree; ENUM keeps its existing row.
  ENUM: ['anonymous-class'],
  INT_LITERAL: ['absorbed-decimal-minus'],
  LONG_LITERAL: ['absorbed-decimal-minus'],
  STRING_LITERAL: ['folded-string-concatenation'],
};
const scalar = (value) => ['string', 'boolean', 'number'].includes(typeof value);

function loadMapping(path) {
  const data = JSON.parse(readText(path));
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), 'mapping must be an object');
  const seen = new Set();
  const rows = Object.entries(data).flatMap(([kind, entry]) => {
    assert.ok(Array.isArray(entry?.variants) && entry.variants.length, `mapping ${kind} has no variants`);
    for (const rule of entry.variants) {
      assert.ok(rule && rule.javacKind === kind && /^[A-Z_]+$/.test(kind) && typeof rule.context === 'string'
        && ['compare', 'compare-range-only', 'skip'].includes(rule.action)
        && ['same', 'none', 'constructor-call', 'colon-case', 'constant-case-expression',
          'instanceof-binding-tail', 'wildcard-core', 'constructor-selector'].includes(rule.range)
        && Array.isArray(rule.ts) && rule.ts.every((node) => typeof node?.kind === 'string' && typeof node.named === 'boolean')
        && (rule.when === undefined || rule.when && typeof rule.when === 'object' && !Array.isArray(rule.when)
          && Object.keys(rule.when).length && Object.values(rule.when).every(scalar))
        && ['operator', 'operatorField'].every((key) => rule[key] === undefined || typeof rule[key] === 'string')
        && [undefined, 'prefix', 'postfix'].includes(rule.operatorPosition),
      `invalid mapping row for ${kind} ${rule?.context}`);
      // A `when` row is selected by javac attributes, so its context name is only a label.
      assert.ok(rule.context === 'default' || rule.when || runnerContexts[kind]?.includes(rule.context),
        `mapping row ${kind} ${rule.context}: the runner never emits this context`);
      assert.ok(!seen.has(`${kind}:${rule.context}`), `duplicate mapping row ${kind} ${rule.context}`);
      seen.add(`${kind}:${rule.context}`);
    }
    // Every context the runner emits for this kind needs its own row; otherwise its nodes fall to the default row.
    for (const context of runnerContexts[kind] ?? [])
      assert.ok(seen.has(`${kind}:${context}`), `mapping ${kind} has no row for runner context ${context}`);
    return entry.variants;
  });
  assert.ok(rows.length, 'mapping has no rows');
  const byKind = Object.groupBy(rows, ({ javacKind }) => javacKind);
  const comparable = Object.entries(byKind).filter(([, rules]) => rules.some((rule) => rule.action !== 'skip'));
  assert.ok(comparable.length, 'mapping has no comparable kinds');
  return Object.fromEntries(comparable);
}

async function compareGroup(name, cases, { java, out, empty, kinds, mapping, binding, runtime, batch, maxRss, differences, rowCounts }) {
  const summary = {
    cases: cases.length, accepted: 0, rejected: 0, tree_errors: 0, cases_with_mismatch: 0,
    ...counts(), batches: 0, peak_child_rss_mib: 0,
  };
  const resultsFile = join(out, name + '.results.jsonl');
  writeFileSync(resultsFile, '');
  for (let i = 0; i < cases.length; i += batch) {
    const slice = cases.slice(i, i + batch);
    const base = join(out, `${name}-${++summary.batches}`);
    const inputs = base + '.inputs.jsonl';
    const structures = base + '.javac.jsonl';
    const output = base + '.tree.json';
    const config = base + '.job.json';
    writeFileSync(inputs, rowText(slice.map(({ id, source, sha256, file }) => ({ id, source, sha256, file }))));
    const javaPeak = await runChild(java, ['-Xmx512m', '-XX:ActiveProcessorCount=1', '-XX:+UseSerialGC',
      '-cp', empty, join(root, 'oracle/runner/StructuralOracle.java'), kinds, inputs, structures], maxRss);
    writeFileSync(config, JSON.stringify({ binding, runtime, mapping, inputs, structures, output, maxRss }));
    const nodePeak = await runChild(process.execPath, ['--max-old-space-size=1024', '--v8-pool-size=1',
      '--expose-gc', script, '--worker', config], maxRss);
    const { results, peak } = JSON.parse(readText(output));
    summary.peak_child_rss_mib = Math.ceil(Math.max(javaPeak, nodePeak, peak, summary.peak_child_rss_mib * mib) / mib);
    for (const row of results) {
      if (row.errors.length) {
        if (name === 'oracle' || name === 'probes')
          throw new Error(`previously accepted case now rejected: ${row.id} (${row.errors})`);
        summary.rejected++;
      } else summary.accepted++;
      if (row.treeHasError) summary.tree_errors++;
      if (row.firstMismatch) summary.cases_with_mismatch++;
      if (differences && row.mismatches.length) differences[row.id] = row.mismatches.map(({ javac, status }) =>
        ({ kind: javac.kind, start: javac.start, end: javac.end, status }));
      for (const key of Object.keys(row.counts)) summary[key] += row.counts[key];
      for (const [key, n] of Object.entries(row.rows)) rowCounts[key] = (rowCounts[key] ?? 0) + n;
    }
    appendFileSync(resultsFile, rowText(results));
  }
  return summary;
}

function baselineChanges(expected, actual) {
  const messages = [];
  for (const id of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    const pending = [...(expected[id] ?? [])];
    for (const { kind, start, end, status } of actual[id] ?? []) {
      const index = pending.findIndex((r) => r.kind === kind && r.start === start && r.end === end && r.status === status);
      if (index >= 0) pending.splice(index, 1);
      else messages.push(`added: ${id} ${kind} [${start}, ${end}) ${status}`);
    }
    for (const { kind, start, end, status, reason } of pending) {
      messages.push(`missing: ${id} ${kind} [${start}, ${end}) ${status} (${reason})`);
    }
  }
  return messages.sort();
}

function loadExpected() {
  const expected = JSON.parse(readText(join(structural, 'expected-differences.json')));
  const statuses = ['mismatched_kind', 'no_node_at_range', 'unpositioned', 'unclassified_context'];
  const offset = (n) => n === null || Number.isSafeInteger(n) && n >= 0;
  assert.ok(expected && typeof expected === 'object' && !Array.isArray(expected), 'invalid expected-differences.json');
  for (const [id, rows] of Object.entries(expected)) {
    assert.ok(Array.isArray(rows) && rows.length && rows.every((row) => row
      && typeof row.kind === 'string' && /^[A-Z_]+$/.test(row.kind)
      && offset(row.start) && offset(row.end) && statuses.includes(row.status)
      && typeof row.reason === 'string' && /^(K(?:1[6-9]|2[0-5])|limit|error-case)$/.test(row.reason)),
    `invalid expected differences for ${id}`);
  }
  return expected;
}

async function selfTest(config) {
  const source = 'class T { Object m() { /* 한😀 */ return ((String) x) + "é"; } }';
  const rejected = 'class T { void m( {}';
  const wrong = 'interface J { default String m() { return ""; } } class T implements J { Object f() { return (java.util.function.Supplier<String>) J.super::m; } } enum E { A, @Deprecated B(1) {} ; E() {} E(int n) {} }';
  const inputs = [source, rejected, wrong].map((s, i) => ({ id: `self/${i}`, source: s, sha256: sha256(s) }));
  const summary = await compareGroup('self', inputs, config);
  const [accept, reject, reference] = readRows(join(config.out, 'self-1.javac.jsonl'));
  const position = (s, needle) => {
    const at = s.indexOf(needle);
    return [Buffer.byteLength(s.slice(0, at)), Buffer.byteLength(s.slice(0, at + needle.length))];
  };
  const cast = accept.nodes.find((node) => node.kind === 'TYPE_CAST');
  const parens = accept.nodes.find((node) => node.kind === 'PARENTHESIZED');
  const plus = accept.nodes.find((node) => node.kind === 'PLUS');
  assert.deepEqual([cast.start, cast.end], position(source, '(String) x'));
  assert.deepEqual([parens.start, parens.end, parens.wrapsCast], [...position(source, '((String) x)'), true]);
  assert.deepEqual([plus.start, plus.end, plus.operator], [...position(source, '((String) x) + "é"'), '+']);
  assert.ok(reject.errors.length && !reject.nodes.length);
  const method = reference.nodes.find((node) => node.kind === 'MEMBER_REFERENCE');
  assert.deepEqual([method.start, method.end, method.qualifiedSuper], [...position(wrong, 'J.super::m'), true]);
  const rows = readRows(join(config.out, 'self.results.jsonl'));
  assert.ok(rows[0].counts.matched >= 3);
  assert.deepEqual(rows[0].mismatches, []);
  const parser = makeParser(config.binding, config.runtime);
  const wrongOperator = { ...config.mapping, PLUS: config.mapping.PLUS.map((rule) => ({ ...rule, operator: '-' })) };
  const absent = { ...cast, start: cast.start + 1 };
  const probe = compareCase(parser, source, { ...accept, nodes: [plus, absent] }, wrongOperator);
  assert.deepEqual(probe.mismatches.map(({ status }) => status), ['mismatched_kind', 'no_node_at_range']);
  const range = { kind: 'TYPE_CAST', start: 4, end: 9, status: 'mismatched_kind' };
  const expected = { t: [{ ...range, reason: 'K16' }] };
  assert.deepEqual(baselineChanges(expected, { t: [range] }), []);
  assert.deepEqual(baselineChanges(expected, { t: [range, range], u: [range] }),
    ['added: t TYPE_CAST [4, 9) mismatched_kind', 'added: u TYPE_CAST [4, 9) mismatched_kind']);
  assert.deepEqual(baselineChanges(expected, { t: [{ ...range, status: 'no_node_at_range' }] }),
    ['added: t TYPE_CAST [4, 9) no_node_at_range', 'missing: t TYPE_CAST [4, 9) mismatched_kind (K16)']);
  assert.deepEqual(reference.nodes.filter(({ context }) => context === 'enum-constant').map(({ start, end }) => [start, end]),
    [position(wrong, 'A'), position(wrong, '@Deprecated B(1) {}')]);
  assert.equal(rows[2].rows['VARIABLE:enum-constant'], 2);
  // A node whose `when` attributes select no row is a tool fault, not a skip.
  const { qualifiedSuper, ...noWhen } = method;
  for (const node of [noWhen, { ...method, qualifiedSuper: 'yes' }])
    assert.throws(() => compareCase(parser, wrong, { ...reference, nodes: [node] }, config.mapping), /no row for its when/);
  const base = JSON.parse(readText(join(structural, 'mapping.json')));
  const mappingFile = join(config.out, 'self-mapping.json');
  const variable = base.VARIABLE.variants;
  for (const [variants, message] of [[[...variable, { ...variable[0], context: 'enum-konstant' }], /never emits/],
    [[...variable, variable[0]], /duplicate/], [[...variable, { ...variable[0], when: [] }], /invalid mapping row/],
    [variable.filter(({ context }) => context !== 'single-local-declaration'), /no row for runner context/]]) {
    writeFileSync(mappingFile, JSON.stringify({ ...base, VARIABLE: { variants } }));
    assert.throws(() => loadMapping(mappingFile), message);
  }
  const known = rows[2].mismatches.find(({ javac }) => javac.kind === 'MEMBER_REFERENCE');
  if (known) console.log('qualified super mismatch:', JSON.stringify(known));
  console.log('self-test passed', JSON.stringify(summary));
}

async function main() {
  if (process.argv[2] === '--worker') return worker(process.argv[3]);
  const { values } = parseArgs({ options: {
    java: { type: 'string', default: 'java' },
    out: { type: 'string', default: join(root, 'build/phase3') },
    cases: { type: 'string' }, mapping: { type: 'string' }, binding: { type: 'string' }, runtime: { type: 'string' },
    batch: { type: 'string', default: '100' },
    'max-rss-mib': { type: 'string', default: '2048' }, 'self-test': { type: 'boolean' }, check: { type: 'boolean' },
  } });
  assert.ok(!values.check || !values.cases && !values['self-test'], '--check requires the full set');
  const batch = Number(values.batch), cap = Number(values['max-rss-mib']);
  assert.ok(Number.isInteger(batch) && batch >= 1 && batch <= 500, '--batch must be an integer from 1 to 500');
  assert.ok(Number.isInteger(cap) && cap >= 64 && cap <= 2048, '--max-rss-mib must be an integer from 64 to 2048');
  const out = resolve(values.out);
  const empty = join(out, 'empty');
  const kinds = join(out, values['self-test'] ? 'self-kinds.txt' : 'kinds.txt');
  const mappingPath = values.mapping ?? join(structural, 'mapping.json');
  const mapping = loadMapping(mappingPath);
  const expected = values.check ? loadExpected() : null;
  const differences = Object.create(null);
  mkdirSync(empty, { recursive: true });
  writeFileSync(kinds, Object.keys(mapping).sort().join('\n') + '\n');
  const config = {
    java: values.java, out, empty, kinds, mapping,
    binding: values.binding && resolve(values.binding), runtime: values.runtime && resolve(values.runtime),
    batch, maxRss: cap * mib, differences: expected ? differences : null, rowCounts: {},
  };
  if (values['self-test']) return selfTest({ ...config, batch: 3 });
  const summary = { mapping: sha256(readFileSync(mappingPath)) };
  let mismatches = 0;
  const groups = values.cases ? [['cases', readRows(resolve(values.cases))]]
    : [...Object.entries(oracleGroups()), ['corpus', corpusCases()]];
  for (const [name, cases] of groups) {
    assert.ok(cases.length, name + ': no cases');
    assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length, name + ': duplicate case IDs');
    summary[name] = await compareGroup(name, cases, config);
    mismatches += summary[name].cases_with_mismatch;
  }
  // A compared row with no node in any input has no evidence; list it rather than imply coverage.
  summary.uncompared_rows = Object.values(mapping).flat().filter((rule) => rule.action !== 'skip')
    .map(({ javacKind, context }) => `${javacKind}:${context}`).filter((key) => !config.rowCounts[key]).sort();
  summary.uncompared_row_count = summary.uncompared_rows.length;
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, (key, value) => key === 'peak_child_rss_mib' ? undefined : value, 2));
  if (expected) {
    const changes = baselineChanges(expected, differences);
    for (const change of changes) console.error(change);
    for (const key of summary.uncompared_rows) console.error(`uncompared: ${key}`);
    const failures = changes.length + summary.uncompared_row_count;
    console.log(failures ? `FAIL: ${changes.length} baseline change(s), ${summary.uncompared_row_count} uncompared row(s)`
      : 'OK: structural differences equal the baseline');
    process.exitCode = failures ? 1 : 0;
  } else {
    process.exitCode = mismatches ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(`structural-compare: ${e.message}`);
  process.exitCode = 2;
});
