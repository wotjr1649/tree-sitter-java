# Changelog

## Unreleased

- Parse `import module` declarations (JEP 511, JLS 25 §7.5.5) as an `import_declaration` with an anonymous
  `module` token. No node kind or field changes; trees of existing inputs are unchanged, and `module` as an ordinary
  name keeps its `identifier` tree.
- Add a javac parse-only oracle (Eclipse Temurin 25.0.5+8, `--release 25`, preview off) with committed
  cases, verdicts and a tree-sitter API replay (`oracle/`, `scripts/oracle-replay.mjs`). Known baseline mismatches
  are an expected-failure set that each fix removes (`oracle/README.md`). No grammar or `src/` change.
- Add a node kind and field snapshot (`test/node-kinds.txt`, `scripts/generate-node-kinds.mjs --check`) and a
  parser cost script (`scripts/parser-cost.mjs`).
- Add the `oracle-replay` and `oracle-javac` jobs to `ci.yml`.

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
