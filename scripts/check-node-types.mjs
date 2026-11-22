// Usage: node scripts/check-node-types.mjs BASE [-] | --self-test
// Compare src/node-types.json at an ancestor BASE and HEAD. Pass - to read the head schema from stdin.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const schema = 'src/node-types.json';
const key = ({ type, named }) => JSON.stringify([type, named]);
const name = ({ type, named }) => (named ? type : JSON.stringify(type));

function compare(before, after) {
  const failures = [];
  const head = new Map(after.map((node) => [key(node), node]));

  function checkTypes(previous, current, label) {
    const types = new Set(current.map(key));
    for (const type of previous) {
      if (!types.has(key(type))) failures.push(`${label}: removed ${name(type)}`);
    }
  }

  function checkEntry(previous, current, label) {
    if (!current) {
      failures.push(`${label}: removed`);
      return;
    }
    if (previous.multiple && !current.multiple) failures.push(`${label}: lost multiplicity`);
    if (!previous.required && current.required) failures.push(`${label}: became required`);
    checkTypes(previous.types, current.types, `${label} types`);
  }

  for (const node of before) {
    const current = head.get(key(node));
    const kind = name(node);
    if (!current) {
      failures.push(`removed kind ${kind}`);
      continue;
    }

    const fields = current.fields ?? {};
    for (const [field, entry] of Object.entries(node.fields ?? {})) {
      checkEntry(entry, Object.hasOwn(fields, field) ? fields[field] : undefined, `${kind} field ${field}`);
    }
    if (node.children) checkEntry(node.children, current.children, `${kind} children`);
    checkTypes(node.subtypes ?? [], current.subtypes ?? [], `${kind} subtypes`);
  }
  return failures;
}

function selfTest() {
  const identifier = { type: 'identifier', named: true };
  const token = { type: 'identifier', named: false };
  const entry = { multiple: true, required: false, types: [identifier, token] };
  const before = [
    { type: 'expression', named: true, subtypes: [identifier] },
    { type: 'call', named: true, fields: { argument: entry }, children: structuredClone(entry) },
    identifier,
    token,
  ];
  assert.deepEqual(compare(before, structuredClone(before)), []);

  const removed = structuredClone(before);
  removed[0].subtypes.pop();
  delete removed[1].fields.argument;
  delete removed[1].children;
  removed.pop();
  assert.deepEqual(compare(before, removed), [
    'expression subtypes: removed identifier',
    'call field argument: removed',
    'call children: removed',
    'removed kind "identifier"',
  ]);
  assert.deepEqual(compare([identifier, token], [token]), ['removed kind identifier']);

  const narrowed = structuredClone(before);
  for (const target of [narrowed[1].fields.argument, narrowed[1].children]) {
    target.multiple = false;
    target.required = true;
    target.types.pop();
  }
  assert.deepEqual(compare(before, narrowed), [
    'call field argument: lost multiplicity',
    'call field argument: became required',
    'call field argument types: removed "identifier"',
    'call children: lost multiplicity',
    'call children: became required',
    'call children types: removed "identifier"',
  ]);

  const expanded = structuredClone(before);
  const literal = { type: 'literal', named: true };
  expanded.push(literal);
  expanded[0].subtypes.push(literal);
  expanded[1].fields.extra = { multiple: false, required: false, types: [literal] };
  expanded[1].fields.argument.types.push(literal);
  expanded[1].children.types.push(literal);
  assert.deepEqual(compare(narrowed, expanded.reverse()), []);
  console.log('Node types contract self-tests passed');
}

function main([base, input, ...rest]) {
  if (base === '--self-test' && input === undefined) return selfTest();
  if (!base || (input !== undefined && input !== '-') || rest.length) {
    throw new Error('Usage: node scripts/check-node-types.mjs BASE [-] | --self-test');
  }

  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = git('rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).trim();
  try {
    git('merge-base', '--is-ancestor', commit, 'HEAD');
  } catch (error) {
    if (error.status === 1) throw new Error(`Base commit ${commit} is not an ancestor of HEAD`);
    throw error;
  }

  const before = JSON.parse(git('show', `${commit}:${schema}`));
  const after = JSON.parse(input === '-' ? readFileSync(0, 'utf8') : git('show', `HEAD:${schema}`));
  const failures = compare(before, after);
  if (failures.length) {
    console.error(`Breaking node types changes since ${commit}:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Node types contract is compatible with ${commit}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
