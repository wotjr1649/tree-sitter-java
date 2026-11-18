// Generated-parser cost: the size of src/parser.c and its table counts, so a grammar change shows what it adds.
// Metrics: parser.c bytes, STATE_COUNT, LARGE_STATE_COUNT, SYMBOL_COUNT, PRODUCTION_ID_COUNT, and the number of
// field-map entries (all, and the inherited ones consumers pay for in field lookups).
//
// Usage: node scripts/parser-cost.mjs [<tree> [<tree>]]
// A tree is a repository root, a directory holding parser.c, or a parser.c file. With no argument it measures this
// repository; with one it prints that tree; with two it prints base, head and the change (base first).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFINES = ['STATE_COUNT', 'LARGE_STATE_COUNT', 'SYMBOL_COUNT', 'PRODUCTION_ID_COUNT'];

function parserPath(tree) {
  if (statSync(tree).isFile()) return tree;
  for (const candidate of [join(tree, 'src', 'parser.c'), join(tree, 'parser.c')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  throw new Error(`no parser.c in ${tree}`);
}

export function measure(tree) {
  const path = parserPath(tree);
  const text = readFileSync(path, 'utf8');
  const cost = { parser_c_bytes: statSync(path).size };
  for (const name of DEFINES) {
    const m = text.match(new RegExp(`^#define ${name} (\\d+)$`, 'm'));
    if (!m) throw new Error(`${path} has no #define ${name}`);
    cost[name.toLowerCase()] = Number(m[1]);
  }
  const start = text.indexOf('static const TSFieldMapEntry ts_field_map_entries[] = {');
  if (start < 0) throw new Error(`${path} has no ts_field_map_entries`);
  const block = text.slice(start, text.indexOf('\n};', start));
  cost.field_map_entries = (block.match(/^\s*\{field_/gm) ?? []).length;
  cost.inherited_field_map_entries = (block.match(/\.inherited = true/g) ?? []).length;
  return cost;
}

function main(args) {
  if (args.length > 2) throw new Error('usage: parser-cost.mjs [<tree> [<tree>]]');
  const trees = args.length ? args : [fileURLToPath(new URL('..', import.meta.url))];
  const costs = trees.map(measure);
  const metrics = Object.keys(costs[0]);
  if (costs.length === 1) {
    console.log('| metric | value |\n| --- | ---: |');
    for (const k of metrics) console.log(`| ${k} | ${costs[0][k]} |`);
    return;
  }
  const [base, head] = costs;
  console.log('| metric | base | head | change |\n| --- | ---: | ---: | ---: |');
  for (const k of metrics) {
    const change = base[k] ? `${(((head[k] - base[k]) / base[k]) * 100).toFixed(2)} %` : head[k] ? 'new' : '0.00 %';
    console.log(`| ${k} | ${base[k]} | ${head[k]} | ${change} |`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`parser-cost: ${e.message}`);
    process.exitCode = 2;
  }
