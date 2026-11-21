# AGENTS.md — tree-sitter-java

This owner-maintained Java grammar continues from tree-sitter/tree-sitter-java. See
[ADR-0001](docs/decisions/ADR-0001-continue-from-upstream.md) for the baseline, and
[ADR-0002](docs/decisions/ADR-0002-independent-repository.md) for why the repository is independent of the original
grammar.

`go-treesitter` records its grammar commit and CLI pins in `tools/gen/pins.json`. Propose this repository's latest
release tag in a separate PR under go-treesitter ADR-0024 rule 7, with a comparison against its current pin and owner
approval. go-treesitter regenerates `src/parser.c` with its own pinned CLI.

## Rules

- Source is `grammar.js`. `src/parser.c`, `src/grammar.json`, `src/node-types.json` and `src/tree_sitter/*.h` are
  generated. Regenerate with the pinned CLI using the CI generate command (`tree-sitter generate --abi <ABI>
  --js-runtime native`), commit the generated files with the source change and run `tree-sitter test`. Never edit
  generated files by hand or by post-processing. A generated `parser.c` must not contain the generator's optimize-off
  pragmas.
- The CLI pin is `devDependencies.tree-sitter-cli` in `package.json`. Until CI reads it, the three `tree-sitter-ref`
  values in `.github/workflows/ci.yml` repeat it: change all in the same PR. It tracks the latest stable tree-sitter
  release (`gh release view -R tree-sitter/tree-sitter`). Move it in its own PR: regenerate, compare full CSTs on the
  fixed inputs and record generated-code differences. Identical trees are a patch release; otherwise follow the SemVer
  rules below.
- The ABI is the `--abi` value of the CI generate command; the `CMakeLists.txt` default repeats it: change both.
  Binding runtime lower bounds are in the binding manifests. Changing the ABI or a runtime lower bound needs the
  owner's approval and a major release.
- Releases are `vMAJOR.MINOR.PATCH` tags; the latest is the highest `v*` tag (`git ls-remote --tags --sort=-v:refname
  origin 'v*'`; no GitHub Release is required here). Record every release in `CHANGELOG.md`.
  - MAJOR: a node kind, field or supertype subtype is removed or renamed, or the CST of valid input that the previous
    release parsed without an error changes. Add migration notes. Valid input: javac accepts it (the oracle in
    `oracle/`).
  - MINOR: additions, error-to-ok fixes, accepted invalid input becoming an error, changes to the tree of input that
    is an error before and after (`ERROR` and `MISSING` included), and tree-identical performance work.
  - PATCH: build, tooling and documentation changes, and a CLI-pin move with identical trees.
- The release PR sets the release version in every manifest and its own lockfile entry, including `tree-sitter.json`
  `metadata.version`, and regenerates `src/` because `src/parser.c` embeds that version. Fix PRs change none of them.
- Keep the grammar name `java` and the C symbol `tree_sitter_java`.
- Start each fix with a failing case and cite its evidence so the change can be checked against the case that
  motivated it. Keep existing corpus tests passing unless the fix intentionally changes their expectations and records
  why.
- Preserve commit history so pinned commits remain reachable. Fetch the original grammar's tags with `--no-tags` and
  an explicit destination under local `refs/upstream/` (the historical import ref of the original grammar; later
  changes are not tracked).
- Keep every copyright line in `LICENSE` and the original grammar's attribution in `NOTICE`.
- Agents may prepare branches, commits and pull requests. The owner separately approves every merge, tag, release,
  publication, repository-setting change and deletion. Do not publish to registries.
