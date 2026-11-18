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
