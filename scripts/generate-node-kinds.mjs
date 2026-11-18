// Writes test/node-kinds.txt from src/node-types.json: the grammar's public contract, so that a removed or renamed
// node kind or field shows up as a reviewable diff. Consumers match both. Named kinds come first, sorted, each
// with its field names (`class_declaration{body,name,...}`; a kind without fields is written bare). Anonymous
// tokens that queries can match follow as JSON strings (`"default"`).
//
// Usage: node scripts/generate-node-kinds.mjs [--check]
// Default writes the snapshot. --check exits 1 when the snapshot differs from src/node-types.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SNAPSHOT = `${root}test/node-kinds.txt`;
const nodeTypes = JSON.parse(readFileSync(`${root}src/node-types.json`, 'utf8'));

const fieldsByKind = new Map();
for (const node of nodeTypes) {
  if (!node.named || !node.fields) continue;
  const names = Object.keys(node.fields);
  if (!names.length) continue;
  const known = fieldsByKind.get(node.type) ?? new Set();
  for (const name of names) known.add(name);
  fieldsByKind.set(node.type, known);
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const named = [...new Set(nodeTypes.filter((n) => n.named).map((n) => n.type))].sort(byCode).map((kind) => {
  const fields = fieldsByKind.get(kind);
  return fields ? `${kind}{${[...fields].sort(byCode).join(',')}}` : kind;
});
const anonymous = [...new Set(nodeTypes.filter((n) => !n.named).map((n) => n.type))]
  .sort(byCode)
  .map((kind) => JSON.stringify(kind));
const snapshot = `${[...named, ...anonymous].join('\n')}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(SNAPSHOT, 'utf8');
  } catch {}
  if (current === snapshot) process.exitCode = 0;
  else {
    const have = new Set(current.split('\n'));
    const want = new Set(snapshot.split('\n'));
    for (const line of have) if (!want.has(line)) console.error(`- ${line}`);
    for (const line of want) if (!have.has(line)) console.error(`+ ${line}`);
    console.error('test/node-kinds.txt differs from src/node-types.json. Review the change, then run: node scripts/generate-node-kinds.mjs');
    process.exitCode = 1;
  }
} else {
  writeFileSync(SNAPSHOT, snapshot);
  console.log(`wrote test/node-kinds.txt (${named.length} named kinds, ${anonymous.length} anonymous)`);
}
