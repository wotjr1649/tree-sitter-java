import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = join(root, 'oracle/runner/ParseOracle.java');
const repos = ['RxJava', 'cassandra', 'elasticsearch', 'flink', 'guava', 'jdk', 'log4j2'];
const oracle = {
  api: 'com.sun.source.util.JavacTask.parse()',
  'java.runtime.version': '25.0.5+8-LTS',
  'java.vendor': 'Eclipse Adoptium',
  options: ['--release', '25', '-proc:none'],
  preview: false,
  release: '25',
  source_encoding: 'UTF-8',
};
const limits = ['limit:k5', 'limit:unicode-escape'];
const entryKeys = ['path', 'sha256', 'verdict', 'codes', 'category', 'group'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const readJson = file => JSON.parse(decode(readFileSync(file)));
const isCode = value => typeof value === 'string' && /^compiler\.err\.[a-z0-9_.]+$/.test(value);

class Difference extends Error {}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal}): ${String(result.stderr ?? '').trim()}`);
  return result.stdout;
}

function pathParts(path) {
  if (typeof path !== 'string' || /[\\:\x00-\x1f\x7f]/.test(path) || !path.endsWith('.java')) {
    throw new Difference('invalid example path');
  }
  const [prefix, repo, ...parts] = path.split('/');
  if (prefix !== 'examples' || !repos.includes(repo) || !parts.length ||
      parts.some(part => !part || part === '.' || part === '..')) {
    throw new Difference(`invalid example path: ${path}`);
  }
  return [repo, ...parts];
}

function sourceBytes(path, checkouts, pins) {
  const [repo, ...parts] = pathParts(path);
  const object = `${pins[repo]}:${parts.join('/')}`;
  return run('git', ['--no-replace-objects', '-C', checkouts[repo], 'cat-file', 'blob', object],
    { encoding: null, maxBuffer: 16 * 1024 * 1024 });
}

function reviewed(entry) {
  const { category, group } = entry;
  return limits.includes(category) && group === undefined ||
    category === 'parse-only' && typeof group === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group);
}

function byPath(entries, report = error => { throw error; }) {
  if (!Array.isArray(entries)) {
    report(new Error('invalid verdict entries'));
    return null;
  }
  const index = new Map();
  for (const entry of entries) {
    try {
      if (!entry || typeof entry !== 'object') throw new Error('invalid verdict entry');
      pathParts(entry.path);
      if (index.has(entry.path)) throw new Difference(`duplicate verdict: ${entry.path}`);
      index.set(entry.path, entry);
    } catch (error) {
      report(error);
    }
  }
  return index;
}

function check(paths, checkouts, meta, file) {
  const saved = readJson(file);
  const errors = [];
  const report = error => errors.push(error);
  const mismatch = message => report(new Difference(message));
  if (Object.keys(saved).some(key => key !== 'meta' && key !== 'entries')) {
    mismatch('unexpected top-level verdict fields');
  }
  if (!isDeepStrictEqual(saved.meta, meta)) mismatch('verdict metadata differs from the current inputs');
  const hasEntries = Object.hasOwn(saved, 'entries');
  if (!hasEntries) mismatch('missing verdict entries');

  const entries = hasEntries ? byPath(saved.entries, report) : null;
  const missing = new Set(entries ? paths : []);
  for (const [path, entry] of entries ?? []) {
    if (!missing.delete(path)) {
      mismatch(`extra verdict: ${path}`);
    } else {
      try {
        if (entry.sha256 !== sha256(sourceBytes(path, checkouts, meta.example_pins))) {
          mismatch(`SHA-256 differs: ${path}`);
        }
      } catch (error) {
        report(error);
      }
    }
    if (Object.keys(entry).some(key => !entryKeys.includes(key))) mismatch(`unexpected verdict fields: ${path}`);
    const { verdict, codes, category, group } = entry;
    if (!Array.isArray(codes) || !codes.every(isCode) ||
        !(verdict === 'rejected' && codes.length && category === undefined && group === undefined ||
          verdict === 'accepted' && !codes.length && reviewed(entry))) {
      mismatch(`invalid verdict or unreviewed javac acceptance: ${path}`);
    }
  }
  for (const path of missing) mismatch(`missing verdict: ${path}`);

  if (errors.length) {
    const Failure = errors.every(error => error instanceof Difference) ? Difference : Error;
    throw new Failure(errors.map(error => error.message).join('\nexample-verdicts: '));
  }
  console.log(`Verified ${paths.length} example verdicts.`);
}

function generate(paths, checkouts, meta, file, java) {
  let prior = new Map();
  try {
    prior = byPath(readJson(file).entries);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = mkdtempSync(join(tmpdir(), 'java-example-verdicts-'));
  const entries = [];
  try {
    const empty = join(temp, 'empty');
    mkdirSync(empty);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|JDK_JAVAC_OPTIONS|CLASSPATH)$/i.test(key)));
    const javaArgs = ['-Xmx1g', '-XX:ActiveProcessorCount=3', '-XX:+UseSerialGC', '-cp', empty, runner];
    const invoke = args => run(java, [...javaArgs, ...args], { cwd: temp, env, stdio: 'inherit' });
    invoke(['--self-test']);
    for (let start = 0; start < paths.length; start += 500) {
      const cases = paths.slice(start, start + 500).map(path => {
        const bytes = sourceBytes(path, checkouts, meta.example_pins);
        const name = basename(path);
        const item = { id: path, sha256: sha256(bytes), source: decode(bytes) };
        if (name === 'module-info.java' || name === 'package-info.java') item.file = name;
        return item;
      });
      const input = join(temp, `cases-${start}.jsonl`);
      const output = join(temp, `result-${start}.json`);
      const jsonl = cases.map(item => JSON.stringify(item) + '\n').join('');
      writeFileSync(input, jsonl);
      invoke(['--cases', input, '--out', output]);
      const batch = readJson(output);
      const expected = { ...oracle, runner_sha256: meta.runner_sha256,
        case_count: cases.length, cases_sha256: sha256(jsonl) };
      if (!isDeepStrictEqual(batch.meta, expected) || Object.keys(batch.verdicts).length !== cases.length) {
        throw new Error(`inconsistent runner output for batch starting at ${start}`);
      }
      for (const { id: path, sha256: hash } of cases) {
        const codes = batch.verdicts[path];
        if (!Array.isArray(codes) || !codes.every(isCode)) throw new Error(`missing or invalid runner verdict: ${path}`);
        const entry = { path, sha256: hash, verdict: codes.length ? 'rejected' : 'accepted', codes };
        if (!codes.length) {
          const old = prior.get(path);
          if (old?.sha256 === hash && old.verdict === 'accepted' && reviewed(old)) {
            entry.category = old.category;
            if (old.group) entry.group = old.group;
          } else {
            entry.category = 'defect';
            console.error(`Unreviewed javac acceptance: ${path} (${hash})`);
          }
        }
        entries.push(entry);
      }
    }
  } finally {
    rmSync(temp, { recursive: true });
  }
  const counts = Object.fromEntries(['rejected', 'parse-only', ...limits, 'defect'].map(key => [key, 0]));
  for (const entry of entries) counts[entry.category ?? entry.verdict]++;
  console.log(JSON.stringify(counts));
  if (counts.defect) throw new Difference('resolve unreviewed acceptances before replacing the verdict file');
  const staging = mkdtempSync(join(dirname(file), '.example-verdicts-'));
  try {
    const pending = join(staging, 'verdicts.json');
    writeFileSync(pending, JSON.stringify({ meta, entries }, null, 2) + '\n');
    renameSync(pending, file);
  } finally {
    rmSync(staging, { recursive: true });
  }
  console.log(`Wrote ${entries.length} example verdicts to ${file}.`);
}

function main() {
  const { values } = parseArgs({ options: {
    check: { type: 'boolean' },
    generate: { type: 'boolean' },
    java: { type: 'string' },
    examples: { type: 'string', default: join(root, 'examples') },
    jdk: { type: 'string' },
    verdicts: { type: 'string', default: join(root, 'test/examples/failure-verdicts.json') },
  } });
  if (Boolean(values.check) === Boolean(values.generate) || values.check && values.java) {
    throw new Error('use --check or --generate [--java <executable>] [--examples <directory>] [--jdk <checkout>] [--verdicts <file>]');
  }
  const bytes = readFileSync(join(root, 'test/examples/failures.txt'));
  const paths = bytes.length ? decode(bytes).replace(/\r?\n$/, '').split(/\r?\n/) : [];
  paths.forEach(pathParts);
  if (new Set(paths).size !== paths.length) throw new Difference('duplicate paths in the failure list');
  const checkouts = Object.fromEntries(repos.map(repo =>
    [repo, realpathSync(repo === 'jdk' && values.jdk ? values.jdk : join(values.examples, repo))]));
  const pins = Object.fromEntries(repos.map(repo => {
    statSync(join(checkouts[repo], '.git'));
    return [repo, run('git', ['-C', checkouts[repo], 'rev-parse', '--verify', 'HEAD']).trim()];
  }));
  const meta = { ...oracle, runner_sha256: sha256(readFileSync(runner)), example_pins: pins,
    failure_count: paths.length, failures_sha256: sha256(bytes) };
  const file = resolve(values.verdicts);
  if (values.check) check(paths, checkouts, meta, file);
  else generate(paths, checkouts, meta, file, values.java ? resolve(values.java) : 'java');
}

try {
  main();
} catch (error) {
  console.error(`example-verdicts: ${error.message}`);
  process.exitCode = error instanceof Difference ? 1 : 2;
}
