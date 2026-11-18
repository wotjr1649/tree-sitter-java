# Java oracle

The reference for valid Java syntax is the parse phase of `javac` ([ADR-0001](../docs/decisions/ADR-0001-continue-from-upstream.md)):
`com.sun.source.util.JavacTask.parse()`, Eclipse Temurin **25.0.5+8**, `--release 25`, **preview off**. This is the
only verdict level. javac's later phases (enter, attribute, flow) are out of scope, so a type error or an undefined
name is not a syntax rejection; the runner's self-test shows one.

| Path | Holds |
| --- | --- |
| `runner/ParseOracle.java` | The runner (single-file Java, run with `java ParseOracle.java`) |
| `data/cases/<set>.jsonl` | Cases: `id`, `sha256` (of the UTF-8 `source`), `source`, `provenance`, optional `assert` and `file` |
| `data/cases/NOTICE` | Credit and MIT notice for the inputs borrowed from tree-sitter-java PR #233 |
| `data/verdicts/temurin-25.0.5+8.<set>.json` | The runner's verdicts: `[]` accepted, or javac's error codes |
| `data/expected-failures.json` | Rule (a): the confirmed baseline mismatches |
| `../scripts/oracle-replay.mjs` | Judges every case through the tree-sitter API and compares with the baseline |
| `../scripts/generate-node-kinds.mjs` | Snapshot of node kinds and fields, `test/node-kinds.txt` (`--check` in CI) |
| `../scripts/parser-cost.mjs` | Size and table counts of `src/parser.c`, for one tree or base against head |

Case sets: `bundle` (the six minimal inputs and probes of go-treesitter's java evidence bundle: `q71-inputs`,
`p97-probes`), `pr233` (the four inputs of `test/corpus/java25.txt` from tree-sitter-java PR #233, by arraypress,
MIT) and `probes` (written in this task: a `this(...)` probe for K2 and adjacent invalid inputs for K1-K3). Every
case names its origin in `provenance`: the bundle path with its `SHA256SUMS` hash, the PR, or "written in this task".
IDs are prefixed with the set name. To add a case, append a line, hash its `source` (SHA-256 of the UTF-8 bytes; the
replay prints the actual hash when it differs), then regenerate that set's verdicts.

## Verdicts

```sh
java oracle/runner/ParseOracle.java --self-test
java oracle/runner/ParseOracle.java --cases oracle/data/cases/<set>.jsonl --out oracle/data/verdicts/temurin-25.0.5+8.<set>.json
```

The runner needs exactly Temurin 25.0.5+8 (a JDK, not a JRE); any other JDK is a runner fault. It writes no timestamps
and no host fields, so regenerating on any host gives byte-identical files; CI regenerates every file and fails on any
difference. Each file's `meta` records `java.vendor`, `java.runtime.version`, `release`, `preview`, `options`,
`source_encoding` (cases are JSON strings, hashed and parsed as UTF-8), `cases_sha256` (the case file's bytes) and
`runner_sha256` (the runner source's bytes). The runner reads the sources from the case file and parses each one under
the name `Case.java`; a case may set `file`. javac's parser does not look at the file name (a module declaration
parses under `Case.java` and under `module-info.java`; the self-test proves it).

Exit codes: **0** done (self-test passed); **1** the self-test failed; **2** runner fault: crash, unreadable or
inconsistent case file (bad hash, duplicate id), a JDK other than the pinned one. A fault is never recorded as a
rejection. Only javac errors count as a rejection; warnings do not.

## Replay

```sh
npm ci --legacy-peer-deps
node scripts/oracle-replay.mjs
```

The replay parses every case with the `tree-sitter` Node API and the grammar's own binding (`bindings/node`; never
the CLI summary). A tree is **bad** when the root `hasError`, any node is `ERROR` or `MISSING`, any node other than a
MISSING one is zero-width (as in mssql's tree-check), the root does not end at the end of the input, or an assertion of
the case fails. Offsets are the binding's UTF-16 code unit indexes.

An assertion (`assert` in the case) has the form `{"type": "range-kinds", "in": ..., "text": ..., "require": [...],
"forbid": [...]}`: `in` is a text that occurs exactly once in the source and `text` a part of it; among all nodes,
anonymous and named, inside the range of `text`, every `{kind, named}` of `require` is present and no node has a
kind of `forbid`. K3 uses it on `default` in `case null, default`: the anonymous `default` token must be there and no
`identifier`, so a wrong tree without any error is still a mismatch.

A case is a **mismatch** when javac accepts it and the tree is bad. A case javac rejects whose tree is clean
(`rejected-clean`) is only printed: the grammar is not required to enforce everything javac rejects.

Exit codes: **0** the results equal the baseline; **1** they differ (a mismatch that is not in the expected-failure
set, or a listed case that no longer fails); **2** the inputs are inconsistent (a case's hash does not match its
source, verdicts made from other cases or another runner or JDK, an expected-failure entry bound to a different
input or to a case javac rejected).

## Rule (a): the expected-failure set

`data/expected-failures.json` lists only confirmed mismatches: the javac verdict is recorded and accepts the input,
and the base grammar errs or fails an assertion. Each entry is bound to the case id, the SHA-256 of its input, the
`K` it belongs to, and its base tree, all measured at grammar base `a241253` (v1.0.0). `6744e4a` (v1.0.0 plus three
Dependabot workflow bumps) has identical `grammar.js` and `src/`. The replay fails on a mismatch that is not listed
and on a listed case that no longer fails. If a listed case still fails but its tree differs from the recorded base
tree it prints a note.

A later K pull request that fixes a defect **deletes its entries** from `expected-failures.json` (and only those; the
cases and their assertions stay as passing cases). After K3 (and K4, which the PR #233 cases cover) the set is empty.
A new input that the grammar fails but javac accepts is never added silently: it is a new defect, so it needs its own
fix, or a recorded entry with its javac verdict and evidence.

## Node kinds and parser cost

`node scripts/generate-node-kinds.mjs` writes `test/node-kinds.txt` from `src/node-types.json`: named kinds with their
fields (`class_declaration{body,interfaces,...}`), then the anonymous tokens as JSON strings. With `--check` it exits 1
if the snapshot differs, so a removed or renamed kind or field is a visible diff. A change to either one needs a major
version and a CHANGELOG entry (AGENTS.md).

`node scripts/parser-cost.mjs [<tree> [<tree>]]` prints `src/parser.c` bytes, `STATE_COUNT`, `LARGE_STATE_COUNT`,
`SYMBOL_COUNT`, `PRODUCTION_ID_COUNT` and the field-map entries for this repository, for a tree, or as base against head
for two trees (repository roots or `parser.c` files).

## Windows

`npm ci` builds the grammar's Node binding with node-gyp, which needs Visual Studio on Windows, and node-gyp's
`rebuild` deletes the whole `build/` directory, including anything cached under `build/oracle/`. Without Visual
Studio, compile `bindings/node/binding.cc` and `src/parser.c` with gcc (MSYS2 UCRT64) against the Node headers and
`node.lib` that node-gyp caches, and write the result to `build/Release/tree_sitter_java_binding.node`, where
`node-gyp-build` finds it. CI builds the binding with node-gyp on Linux.
