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
| `../scripts/parser-cost.mjs` | Size and table counts of `src/parser.c`, for one tree or base against head; `--check` against `test/parser-cost.json` |
| `../scripts/tree-compare.mjs` | Full-tree comparison of two parser builds over a file list, in memory-bounded batches |

Case sets: `bundle` (the six minimal inputs and probes of go-treesitter's java evidence bundle: `q71-inputs`,
`p97-probes`), `pr233` (the four inputs of `test/corpus/java25.txt` from tree-sitter-java PR #233, by arraypress,
MIT), `probes` (written in this task: a `this(...)` probe for K2 and adjacent invalid inputs for K1-K3), `k1`
(valid and adjacent invalid `import module` inputs of the K1 fix), `k2` (valid and adjacent invalid inputs with
statements before `super(...)`/`this(...)` of the K2 fix), `k3` (valid and adjacent invalid `case null, default`
inputs of the K3 fix), `k4` (valid and adjacent invalid qualified record patterns and `final` or annotated type
patterns of the K4 fix), `k5` (valid and adjacent invalid variable arity parameters with annotations before
`...` of the K5 fix), `k6` (valid and adjacent invalid numeric literals of the K6 fix: decimal floating point
literals with leading zeros such as `00d`, underscores between digits such as `1__0` and `0_7`, and hex floating
point exponents with leading zeros such as `0x1p03`), `k7` (valid and adjacent invalid annotated multi-catch
alternatives, annotated receiver parameters and `instanceof` type patterns with annotations before `final` of the K7
fix), `k8` (a raw NUL byte inside string literals, text blocks and char literals, with adjacent unterminated
literals, of the K8 fix, plus the probes of the PR #19 review: raw NUL next to CR, LF, line continuations and text
block delimiters, with NUL-free controls), `k9` (`open`, `module`, and `with` as type names, with module
declarations, expression controls and adjacent invalid inputs), `k10` (Unicode escapes in strings, text blocks and
character literals, with controls for repeated `u`, including after an encoded backslash, mixed encoded and raw
backslashes before literal content and closing delimiters, quote boundaries and adjacent invalid inputs), `k12`
(parenthesized assignment targets, adjacent invalid inputs, and base-clean controls for expression and identifier
tolerances), and `k13` (typed and bare underscores in record patterns, other unnamed-variable contexts, and adjacent
invalid patterns). Every case names its origin in `provenance`: the bundle path with its `SHA256SUMS` hash, the PR,
or "written in this task". IDs are prefixed with the set name. To add a case, append a line, hash its `source`
(SHA-256 of the UTF-8 bytes; the
replay prints the actual hash when it differs), then regenerate that set's verdicts.

See [grammar tolerances and known limits](../docs/tolerances.md) for accepted invalid forms, deliberate
grammar errors, and known differences on valid input.

## Verdicts

```sh
mkdir -p build/oracle/empty
java -cp build/oracle/empty oracle/runner/ParseOracle.java --self-test
java -cp build/oracle/empty oracle/runner/ParseOracle.java --cases oracle/data/cases/<set>.jsonl --out oracle/data/verdicts/temurin-25.0.5+8.<set>.json
```

Always start the runner with the JVM class path set to one existing **empty directory** (`-cp build/oracle/empty`),
never `-cp ""` or the default: javac loads compiler plugins and annotation processors through the class path (an
empty class path element means the current directory), and a plugin that adds a diagnostic would be stored as a
syntax rejection. The runner refuses to run (exit 2) unless the class path is exactly one empty directory and there is
no module path. It also passes `-proc:none`.

The runner needs exactly Temurin 25.0.5+8 (a JDK, not a JRE); any other JDK is a runner fault. Preview is off (no
`--enable-preview`), but `parse()` reports only the preview diagnostics that the parser itself emits: a preview
feature that javac rejects in a later phase is accepted by the parse-only verdict (for example primitive type patterns
in `switch`: `javac --release 25` rejects them, `parse()` accepts them). It writes no timestamps
and no host fields, so regenerating on any host gives byte-identical files; CI regenerates every file and fails on any
difference. Each file's `meta` records `java.vendor`, `java.runtime.version`, `release`, `preview`, `options`,
`source_encoding` (cases are JSON strings, hashed and parsed as UTF-8), `cases_sha256` (the case file's bytes) and
`runner_sha256` (the bytes of the source file the launcher is running, `jdk.launcher.sourcefile`; the runner has no
option to hash another file). The runner reads the sources from the case file and parses each one as a virtual file.

The virtual file name (the optional case field `file`) only selects the kind of compilation unit that javac's
file manager expects, such as `module-info.java` or `package-info.java`; javac's parser itself does not look at it (the
same module declaration parses under `Case.java` and under `module-info.java`, which the self-test proves). An absent
`file` field, or `"file": null`, means `Case.java`. A `file` must match `[A-Za-z0-9_.-]{1,64}\.java`. The restriction to
ASCII is intentional: it keeps the name a safe URI path component with no path separators, spaces or control
characters, and non-ASCII names such as `한글.java` are refused on purpose (runner fault, exit 2) rather than encoded.
Any other value, including a non-string, is a runner fault too.

Exit codes: **0** done (self-test passed); **1** the self-test failed; **2** runner fault: crash, unreadable or
inconsistent case file (bad hash, duplicate id, a case set with no cases, a bad `file`), a JDK other than the pinned
one, a class path that is not one empty directory. A fault is never recorded as a
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
source, an empty case set, a file that cannot be read or is not valid JSON, verdicts made from other cases or
another runner, or a verdict file whose `meta` is not the oracle (vendor, runtime, API, options, encoding, `release`,
`preview`, or a `case_count` that differs from the real count) or whose values are not arrays of strings, an
`expected-failures.json` whose `grammar_base` is not the fixed v1.0.0 evidence, an entry bound to a different input or
to a case javac rejected, or, while `src/parser.c` is the base parser, a `base_tree` that is not the case's current
tree).

## Rule (a): the expected-failure set

`data/expected-failures.json` lists only confirmed mismatches: the javac verdict is recorded and accepts the input,
and the base grammar errs or fails an assertion. Each entry is bound to the case id, the SHA-256 of its input, the
`K` it belongs to, and its base tree, all measured at grammar base `a241253` (v1.0.0). `6744e4a` (v1.0.0 plus three
Dependabot workflow bumps) has identical `grammar.js` and `src/`. The replay fails on a mismatch that is not listed
and on a listed case that no longer fails. `grammar_base` (commit `a241253…`, `parser.c` and `grammar.js` sha256) must equal the fixed evidence in the replay.
While `src/parser.c` equals the base parser, every listed `base_tree` must equal the current tree (otherwise exit 2).
After a fix PR changes the parser, a listed case that still fails but whose tree changed only prints a note.

A later K pull request that fixes a defect **deletes its entries** from `expected-failures.json` (and only those; the
cases and their assertions stay as passing cases). K4 deleted the last two entries (`pr233/record-pattern-qualified`, `pr233/switch-final-type-pattern`), so the set was
empty. K5 adds two cases it does not fix, `k5/v04-after-dimensions` and `k5/v05-many-dimensions`: an annotation right
after an array dimension and before `...` (`int @A [] @B ... xs`) still starts a dimension and errs.
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
With `--check` it compares this repository's `parser.c` bytes and `STATE_COUNT` with `test/parser-cost.json` and exits 1
on any difference (CI job `parser-cost`); a grammar change that moves either number updates that file and says why.

## Comparing trees

`node scripts/tree-compare.mjs --base <base.node> --head <head.node> --list <paths file> [--root <dir>] [--json]`
compares the trees two compiled bindings make over a list of files (see Windows below for building one). It checks every
node, anonymous ones included: kind, field, named and MISSING flags, start and end offset, and the root's end. Offsets are
the Node binding's `startIndex`/`endIndex`, which count UTF-16 code units, not bytes: they agree with byte offsets only for
ASCII text, and a reported range in a file with non-ASCII characters is not a byte range. It prints
a summary (`files`, `same`, `changed`, `base_error`, `head_error`, peak child memory) and, per changed file, the first
differing node with its parents. Exit 0: no change, 1: changes, 2: bad input or infrastructure error. `--self-test`
runs the built-in checks. Use it instead of a one-off comparison script: it runs 100 files per child process by default
(`--batch`), caps a child at `--max-old-space-size=1024` and stops the run with exit 2 at 2 GB resident (`--max-rss-mb`),
and starts at most 3 children (`--jobs`, the shared-machine thread limit). The cap is checked by the child after every
file and after the last garbage collection of its batch (so a batch of one file is covered), and by the parent, which reads
every child's resident memory every 500 ms and kills all children when one passes the cap. The Node binding frees trees
only when V8 collects them, which is why an unbatched loop once reached 21 GB.


## Windows

`npm ci` builds the grammar's Node binding with node-gyp, which needs Visual Studio on Windows, and node-gyp's
`rebuild` deletes the whole `build/` directory, including anything cached under `build/oracle/`. Without Visual
Studio, compile `bindings/node/binding.cc` and `src/parser.c` with gcc (MSYS2 UCRT64) against the Node headers and
`node.lib` that node-gyp caches, and write the result to `build/Release/tree_sitter_java_binding.node`, where
`node-gyp-build` finds it. CI builds the binding with node-gyp on Linux.
