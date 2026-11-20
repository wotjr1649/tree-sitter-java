# tree-sitter-java

[![CI][ci]](https://github.com/wotjr1649/tree-sitter-java/actions/workflows/ci.yml)

Java grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter).

**Origin.** This repository is independent
([ADR-0002](docs/decisions/ADR-0002-independent-repository.md)). It started from the original grammar,
[tree-sitter/tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java) v0.23.5 (commit
`94703d5`), merged with its full history as v1.0.0 ([ADR-0001](docs/decisions/ADR-0001-continue-from-upstream.md)). Its
later changes are not merged: defects are fixed here and checked against javac 25. See [NOTICE](NOTICE).

It is not published to package registries; the `tree-sitter-java` packages on crates.io, npm and PyPI belong to the
original repository.

For v3, import the Go binding from `github.com/wotjr1649/tree-sitter-java/v3/bindings/go`.

[ci]: https://img.shields.io/github/actions/workflow/status/wotjr1649/tree-sitter-java/ci.yml?branch=main&logo=github&label=CI
