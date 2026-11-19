# Changelog

## Unreleased

- Add `scripts/tree-compare.mjs`, a full-tree comparison of two parser builds over a file list that runs in batches
  of 100 files per child process by default (at most 500) with a memory cap (`oracle/README.md`). The CI `examples` job caches the six
  pinned example checkouts, keyed by their repositories and SHAs, and skips the fetch on a cache hit. No grammar or
  parser change.
- Parse qualified record patterns and `final` or annotated type patterns (K4, JLS 25 §14.30.1). A `record_pattern`
  may now name its type with a `scoped_type_identifier` (`o instanceof a.b.R(int x)`, `case Outer.Box(Outer.Point(var
  x, var y))`). A `type_pattern` in a `case` label and a `record_pattern_component` take an optional `modifiers` child
  holding only `final` and annotations, the variable modifiers that JLS 25 §4.12.4 allows there (`case final String
  s`, `case @A final a.b.C c`, `R(final var x, @A String s)`). No node kind or field is removed or renamed. `src/node-types.json` gains three
  child types: `scoped_type_identifier` under `record_pattern`, and `modifiers` under `type_pattern` and
  `record_pattern_component`. Inputs that parsed without errors keep their trees, with one exception: a qualified record
  pattern with an empty component list or only `_`, such as `case T.R() -> 1;` or `case T.R(_) -> 1;`, used to
  parse cleanly as a `method_invocation` and is now a `pattern` holding a `record_pattern`, as javac's parser reads
  it. The call captures on them go away: `@function.method` in `queries/highlights.scm` and `@reference.call`
  in `queries/tags.scm`; `T` and `R` are captured as `@type` instead. Inputs with these patterns that used to contain ERROR or MISSING now parse cleanly. `instanceof final T x` keeps its anonymous `final` token. Other
  modifier keywords are not accepted there (`case static String s` contains ERROR, as before), so a constant
  subtraction such as `case non-sealed -> 1` keeps its `binary_expression` tree. Two invalid
  inputs that used to parse cleanly by reading `final` as a type name, `case final s` and `case final String`, now
  contain MISSING. The expected-failure set is now empty. The 13 pinned example files that failed on qualified
  record patterns now parse, so `test/examples/failures.txt` drops them (36 to 23 paths). Upstream tree-sitter-java issue #229 and PRs #230 (by
  DragonAxe), #231 (by akd-devvine) and #232 (by mihailkirov) proposed the same two changes.

## 2.0.0

First release with the owner's grammar fixes: Java 25 syntax (K1-K3). The 1.x line is the upstream v0.23.5
baseline; 2.x carries this repository's fixes (ADR-0001, amendment 2026-11-19). Node kinds and field names are
unchanged, but some trees change (K2, K3 below), which can affect consumers of named children and queries.

- Parse `import module` declarations (JEP 511, JLS 25 §7.5.5) as an `import_declaration` with an anonymous
  `module` token. No node kind or field changes. Inputs that parsed without errors keep their trees; inputs
  with `import module` that used to contain ERROR now parse cleanly. `module` as an ordinary name keeps its
  `identifier` tree.
- Add a javac parse-only oracle (Eclipse Temurin 25.0.5+8, `--release 25`, preview off) with committed
  cases, verdicts and a tree-sitter API replay (`oracle/`, `scripts/oracle-replay.mjs`). Known baseline mismatches
  are an expected-failure set that each fix removes (`oracle/README.md`). No grammar or `src/` change.
- Add a node kind and field snapshot (`test/node-kinds.txt`, `scripts/generate-node-kinds.mjs --check`) and a
  parser cost script (`scripts/parser-cost.mjs`).
- Add the `oracle-replay` and `oracle-javac` jobs to `ci.yml`.
- Parse statements before `super(...)` and `this(...)` in a constructor body (JEP 513, JLS 25 §8.8.7). The call
  stays an `explicit_constructor_invocation`, also when qualified (`outer.super(...)`) or generic (`<T>this(...)`).
  As in javac's parser, more than one invocation in a body is not a syntax error. No node kind or field changes.
  Inputs that parsed without errors keep their trees, with one exception: a qualified generic call after a
  statement, such as `outer.<T>super(n);`, used to parse cleanly as a `method_invocation` named `super` and is now
  an `explicit_constructor_invocation`. Constructor bodies with statements before the invocation that used to
  contain ERROR or MISSING now parse cleanly. The `repeat(choice(...))` form matches orchard's Java grammar.
- Parse `default` in a `case` label list, as in `case null, default` (JLS 25 §14.11.1), as the anonymous
  `default` token of `switch_label` instead of an `identifier`. No node kind or field changes. Trees change only
  where a `case` label list held `default` as an `identifier`: `default` is a reserved keyword, so no valid
  program names it. The grammar accepts `default` in any position of the list. This is wider than javac's parser,
  which accepts labels after `null, default` (`case null, default, 1` is rejected only in attribution) but rejects
  `case default` and `case 1, default`. Invalid inputs that used `default` as an expression, such as
  `case default + 1 ->`, may now get a different error-recovery tree with ERROR where they used to parse cleanly.
- The Go module path is now `github.com/wotjr1649/tree-sitter-java/v2`, as Go requires for v2 releases. Import the
  binding from `github.com/wotjr1649/tree-sitter-java/v2/bindings/go`.
- Set `tree-sitter.json` `metadata.version` and the package manifests to 2.0.0. CLI 0.27.2 embeds the metadata
  version in `src/parser.c`, so the generated parser differs from 1.0.0 in that field too.
- Known open item: two inputs that javac accepts still parse with errors (a qualified record pattern and
  `case final String s`, K4). They stay in `oracle/data/expected-failures.json` until their scope is decided.

## 1.0.0

- Establish the independent Java grammar baseline from upstream v0.23.5.
- Import the Go binding from `github.com/wotjr1649/tree-sitter-java/bindings/go`.
- Resolve the Swift test dependency from `tree-sitter/swift-tree-sitter` in the
  range `>=0.25.0, <0.26.0`.
- Set the Python wheel tag to `cp310-abi3` for CPython.
- Retain `tree-sitter.json` metadata at 0.23.5 to preserve the generated
  parser bytes. The first grammar behaviour change will use its release version.
- Remove the automated GitHub Release and registry publishing workflow and the
  upstream npm maintainer list.
- Use ABI 15 and set binding runtime lower bounds in the 0.25 line. The Go binding
  requires Go 1.23 or newer. The Python binding requires Python 3.10 or newer.
