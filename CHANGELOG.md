# Changelog

## Unreleased

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
