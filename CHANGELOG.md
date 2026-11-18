# Changelog

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
