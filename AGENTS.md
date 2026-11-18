# AGENTS.md — tree-sitter-java

This owner-maintained Java grammar continues from tree-sitter/tree-sitter-java
v0.23.5 (`94703d5`). The intended consumer is go-treesitter, which pins grammar
sources under its ADR-0024 rule 7.

## Rules

- Edit `grammar.js` as source. Regenerate `src/` with tree-sitter CLI 0.27.2
  using `tree-sitter generate --abi 15 --js-runtime native`. Commit the generated
  files with the source change and run `tree-sitter test`.
- Start each fix with a failing case and cite its evidence so the change can be
  checked against the case that motivated it.
- Node kinds and field names are a public contract. Removing or renaming one
  requires a major version and a CHANGELOG entry. Keep the grammar name `java`
  and C symbol `tree_sitter_java` stable for consumers.
- Keep every copyright line in `LICENSE` and the upstream attribution in
  `NOTICE`.
- Agents may prepare branches, commits and pull requests. The owner separately
  approves every merge, tag, release, publication, repository-setting change and
  deletion. Do not publish to registries.
