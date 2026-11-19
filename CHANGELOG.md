# Changelog

## Unreleased

- Parse decimal floating point literals whose digits start with a zero followed by more digits, such as `00d`,
  `01d`, `00f`, `01e1` and `08d` (JLS 25 §3.10.2: the digits before an exponent or a type suffix may have leading
  zeros and are not octal). They used to split into an `octal_integer_literal` or `decimal_integer_literal` and an
  ERROR. They are now one `decimal_floating_point_literal`, like `0d` and `00.5`. Integer literals such as `00`,
  `007` and `08` keep their trees.
- Accept one or more underscores between digits in every numeric literal (JLS 25 §3.10.1-2; tree-sitter-java issue
  #227): decimal, octal, hex and binary integers (`1__0`, `0_7`, `0__7`, `0x1__F`, `0b1__0`) and decimal and hex
  floating point literals (`1__0.5`, `1e1__0`, `0x1__F.8p1`). A hex floating point exponent may start with zeros
  (`0x1p03`, `0x1p0_3`). These inputs used to contain ERROR. Underscores at the start or end of the digits, next to
  the point, a prefix, an exponent marker or a suffix still give ERROR (`1_`, `0x_1`, `1._5`, `1_.5`, `0_x1`, `1e_5`,
  `1_L`), as javac rejects them.
  Two forms that javac rejects keep the single-underscore rule they had: the non-Java `0o`/`0O` octal prefix (`0o1__7`
  still gives ERROR) and a hex floating point literal without a `p` exponent (`0x.8__8` still gives ERROR; `0x5.4` and
  `0x1_F.8` still parse).
- The two entries above change no node kind or field, and `node-types.json` is unchanged. Inputs that parsed without
  errors keep their trees. The pinned example file that failed on `00d` now parses, so `test/examples/failures.txt`
  drops it (9 to 8 paths).

## 2.1.0

More Java 25 syntax fixes found through the javac oracle and the pinned examples (K4, K5). Node kinds and field
names are unchanged; `node-types.json` only gains child types (K4). Some trees change, as described below.

- CI parses the six example repositories once on Ubuntu at pinned commits and fails when the failing paths differ
  from `test/examples/failures.txt` (a new failure or a baseline entry that now parses). It replaced the unpinned,
  non-blocking example step on all three OS (#13).
- Add `scripts/tree-compare.mjs`, a full-tree comparison of two parser builds over a file list that runs in batches
  of 100 files per child process by default (at most 500) with a memory cap that the child checks after every file and
  the parent watches while the child runs (`oracle/README.md`). No grammar or parser change.
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
- Parse annotations before the `...` of a variable arity parameter, as in `Object @Nullable ... args` (JLS 25
  §8.4.1; tree-sitter-java issue #205), in methods, constructors, record components and lambda parameters. The
  annotations are children of `spread_parameter` before the anonymous `...` token, like the annotations after it.
  Only `spread_parameter` changes: `dimensions` is as in 2.0.0 and K5 adds no conflict or GLR split, so inputs that
  parsed without errors keep their trees (an array type with nine annotated dimensions keeps one flat `dimensions`;
  a corpus case fixes it). No node kind or field changes and `node-types.json` is unchanged. Known limit: an
  annotation right after an array dimension still starts another dimension, so `int @A [] @B ... xs` and
  `int @A [] @B @C [] [] @D @E ... r` contain ERROR as in 2.0.0, although javac accepts them; the oracle lists them
  as expected failures (`k5/v04-after-dimensions`, `k5/v05-many-dimensions`). Annotations after `...`
  (`int... @Foo x`) are still accepted, although javac rejects them. The 14 pinned example files that failed on
  annotations before `...` now parse, so `test/examples/failures.txt` drops them (23 to 9 paths).

- Set `tree-sitter.json` `metadata.version` and the package manifests to 2.1.0 (the generated `parser.c` embeds it).
- Known limitations:
  - A raw NUL byte (U+0000) inside a string literal makes the literal fail to parse (2 pinned example files): the
    current string rules exclude NUL, as the tree-sitter generator 0.27.2 renders negated character classes without
    it. An explicit NUL alternative in the grammar fixes this; it is planned for the next release.
  - The pinned examples baseline now holds 9 paths: 6 Maven archetype templates (`package ${package};`, which javac
    also rejects), 2 files with a raw NUL in a string, and 1 file with `00d`; the last three are planned for the next release.

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
