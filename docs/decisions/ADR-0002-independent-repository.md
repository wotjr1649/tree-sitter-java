# ADR-0002: An independent repository

- Status: accepted (owner decision, 2026-11-21)
- Date: 2026-11-21
- Supersedes: the sentences of ADR-0001 that assume later adoption ("Adopting a later origin change requires a decision in
  this repository. Synchronization is manual.")

## Context

ADR-0001 continued the grammar from `tree-sitter/tree-sitter-java` v0.23.5 (`94703d5`) as this repository's v1.0.0 and kept
open the adoption of later changes from that repository. Since then this repository has fixed the grammar against
javac 25's parse phase (an oracle with recorded verdicts, a structural comparison with javac ASTs, and its own corpus),
changed some trees (2.x) and the schema of `provides_module_directive` (planned for 3.0.0), and its owner maintains it alone. Taking changes from the
original grammar would bring back choices that javac's verdicts already overrode, and nothing in this repository depends on it.

## Decision

1. From v2.0.0 on this repository is independent. `tree-sitter/tree-sitter-java` v0.23.5 is the original grammar it started from, as
   v1.0.0, not an upstream: its later changes are not tracked or merged, and defects are fixed here.
2. Its history stays in this repository (merge commits only, no rewrite) for attribution and so that pinned commits stay
   reachable. The imported release tag stays out of `refs/tags`, as the local ref `refs/upstream/v0.23.5`; the ref keeps
   that name only as a historical import ref. `LICENSE` and `NOTICE` keep every copyright line and the attribution.
3. Valid Java means what javac 25's parse phase accepts (the oracle, `oracle/README.md`), except for the deliberate
   tolerances and known limits listed in `docs/tolerances.md`. The grammar is verified against
   that oracle, not against the original repository.
4. Nothing is posted to the original repository or to other tree-sitter projects automatically. Reports to them (for
   example about the tree-sitter CLI or runtime) are optional and need the owner's approval for each post. Defects in those
   tools are worked around here where a grammar change can do it, and documented as limits where it cannot.
5. Issue references to `tree-sitter/tree-sitter-java` stay as plain links where they record where a construct was reported.
6. Versioning, tags, releases and registry publishing are unchanged (ADR-0001 amendments): the owner approves each tag and
   release separately, and registry publishing stays disabled.

## Consequences

- No synchronization with the original repository is planned or needed. Documentation calls it "the original grammar" or
  `tree-sitter/tree-sitter-java`, not "upstream".
- The `tree-sitter-java` packages on crates.io, npm and PyPI belong to the original repository, not to this one.
- The MIT attribution in `LICENSE` and `NOTICE` is unchanged.
- ADR-0001 stays as the record of the import and the baseline; only the sentences named above are superseded.
