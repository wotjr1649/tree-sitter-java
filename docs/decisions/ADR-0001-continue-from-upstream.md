# ADR-0001 — Continue from tree-sitter-java v0.23.5

- Status: accepted by the owner on 2026-11-18
- Origin: `tree-sitter/tree-sitter-java` v0.23.5 at
  `94703d5a6bed02b98e438d7cad1136c01a60ba2c`

## Decision

The owner maintains this independent repository for Java grammar fixes and for
use by go-treesitter under ADR-0024 rule 7. The import merges the full history of
the origin release and preserves its MIT notices. The local ref
`refs/upstream/v0.23.5` records the imported release outside `refs/tags`. Preserve
commit history so consumers can keep pinning reachable commits. Adopting a later
origin change requires a decision in this repository. Synchronization is manual.

The repository's own versions begin at v1.0.0. The origin tag and go-treesitter's
current Java pin (`e10607b45ff745f5f876bfa3e94fbcc6b44bdc11`) have identical
`grammar.js`, queries and corpus. The baseline uses tree-sitter CLI 0.27.2, ABI 15
and the native JavaScript runtime. Moving the pin requires separate owner approval
and the evidence in ADR-0024 rule 7. Registry publishing is disabled. The owner
approves tags and releases separately.

For later fixes, the planned Java syntax oracle is the parse phase of `javac`.
Oracle setup and compiler version selection are future work.

## Amendment (2026-11-19): release versions

Decided by the owner on 2026-11-19, following tree-sitter-mssql's ADR-0007:

- The 1.x line is the upstream baseline. v1.0.0 is byte-identical in grammar and generated source to upstream v0.23.5
  regenerated with CLI 0.27.2.
- Releases that carry this repository's own grammar fixes start at v2.0.0. Within 2.x, versions follow semantic
  versioning, and removing or renaming a node kind or field still needs a new major version (AGENTS.md).
- The first such release, the Java 25 fixes K1-K3, is v2.0.0. No v1.1.0 tag was made; the 1.1.0 manifest values on
  `main` between PR #11 and the v2.0.0 release PR were never tagged.
- From v2.0.0 the Go module path carries the major version suffix (`github.com/wotjr1649/tree-sitter-java/v2`), as Go
  modules require for v2 and later.
- Tags and any GitHub Release remain separate owner approvals. Registry publishing stays disabled.

## Amendment (2026-11-21) — Phase 5 release

The owner chose v3.0.0 as the first major release after 2.x. K17 narrows the public
schema of `provides_module_directive` by making `provider` required and removing
the unnamed `children` entry. Phase 5 also withdraws reserved-word tolerances, so
affected inputs that previously parsed cleanly now produce errors. Restricted type names used as declared type names
(such as `class var {}` or `class yield {}`) and `_` in field declarations stay documented tolerances: javac rejects them,
the pinned examples do not use them, and a position-specific grammar change would gain nothing.

The Go module path for v3 is `github.com/wotjr1649/tree-sitter-java/v3`. The 2.x
releases remain reachable through their existing tags.
