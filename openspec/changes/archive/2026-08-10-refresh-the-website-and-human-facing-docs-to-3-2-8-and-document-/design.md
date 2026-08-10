# Design

## Current state

Verified against code and disk, not inferred.

- `.claude/tests/docs/run-doc-consistency.sh` asserts
  `assert_file_contains "VERSION is reflected in the workflow" "$WF" "Version $ver"`.
  That single assertion is why `WORKFLOW.md:3` still reads `**Version 3.2.8**`
  and every unguarded surface drifted. The suite currently carries 19
  assertions and already runs in `run-all.sh` as
  `run "workflow documentation contracts"`.
- `website/index.html` carries only two assertions anywhere in the suite
  (`run-context-budget-tests.sh:132-138`), both about `proof run` versus
  `proof execute`. Nothing checks a version.
- Ground truth: `VERSION` = `3.2.8`; `.claude/harness/protocol.json` has
  `runtime` `2.8.0`, `runtimeApi` `17`, `providerProtocol` `7`. The site's
  `provider protocol 7` is already right; only the release, runtime, and
  runtime-API numbers are wrong.
- `ADAPTERS` in `.claude/harness/foundation.mjs:94-96` is the authority on the
  adapter set, and `EVIDENCE.md:136` documents five. Only
  `.claude/harness/README.md:288` says four.
- `.foundation/` roots are declared in `.claude/harness/foundation.mjs:228-241`.
  Disk carries 13 directories; `repository-sandboxes/`, `prototypes/`, and
  `policy.json` are created conditionally.
- `website/docs` is an Astro/Starlight site that builds clean in ~0.7s for 25
  pages, and `website/docs/dist/` is gitignored (`.gitignore:33`), so a build
  cannot disturb the workspace hash.
- The runtime implements four distinct human/authority boundaries that the docs
  conflate. `land archive` is registered `kind: "authority"` and
  `.claude/commands/land.md` instructs the agent to offer inspect/proceed/pause,
  but the harness gates Land on evidence, not consent.

## Decisions

- **Decision:** Extend `run-doc-consistency.sh` with version and catalog
  assertions rather than adding a separate docs-freshness suite.
  - **Why:** the drift has exactly one cause — assertions existed for
    `WORKFLOW.md` and nothing else. Putting the new checks in the same suite
    keeps one place where "documentation must match reality" lives, and that
    suite already runs in `run-all.sh`.
  - **Rejected:** a new suite. `.claude/tests/README.md` requires a new suite to
    be three coordinated edits, and a second doc suite would compete with the
    first for ownership of the same question.

- **Decision:** Derive every asserted number from its source at test time
  (`VERSION`, `protocol.json`, `foundation.mjs` `ADAPTERS`) instead of hard-coding
  expected strings in the test.
  - **Why:** a hard-coded expectation has to be updated in two places at each
    release and will drift the same way the docs did. Deriving means the next
    release either updates the docs or fails the suite.
  - **Rejected:** asserting literal `3.2.8`. It reproduces the defect one
    release later.

- **Decision:** Publish the four topics as new pages under
  `website/docs/src/content/docs/` (EN and TH) and have `README.md` /
  `README.th.md` point at them.
  - **Why:** the user's decision, and it matches how the repository already
    behaves — `README.md:489-490` already defers to the docs site for adapters,
    and `README.md` is already 664 lines.
  - **Rejected:** expanding both READMEs fully, which duplicates content that
    must then be kept in sync — the exact failure this change exists to fix.

- **Decision:** One canonical `.foundation/` artifact table on the docs site;
  `WORKFLOW.md`, `.claude/harness/README.md`, and `README.md` carry a short
  listing that names the canonical source.
  - **Why:** four independent listings produced four different wrong answers.
    A single table with pointers has one place to update.
  - **Rejected:** deleting the shorter listings. A shipped file must stay
    useful offline, and shipped files may not cite repository-only paths.

- **Decision:** Cover the `accessibility` capability the surface forecast raises
  with an `external` provider recording a human observation, not by introducing
  axe or pa11y.
  - **Why:** the forecast fires on the `.html` extension of
    `website/index.html`, where this change edits two text nodes. The
    repository has no accessibility tooling, and adding a scanner is a
    different change with its own evidence obligations.
  - **Rejected:** narrowing the surface to hide `website/index.html`. The pins
    on lines 84 and 528 genuinely change, and a surface that omits an edited
    file is a false declaration.

- **Decision:** State plainly that Land gates on evidence rather than consent.
  - **Why:** the new approval page is precisely where a reader would infer a
    guarantee the runtime does not make. Documenting a safety property that
    does not exist is worse than documenting none.
  - **Rejected:** describing `land archive` as human-approved because the
    command file asks the agent to confirm. That is agent instruction, not an
    enforced gate.

## Compatibility and migration

No runtime, CLI, schema, or protocol contract changes; no pin in
`protocol.json` moves, so no consumer needs to re-prove anything.

Two shipped files change content: `.claude/harness/README.md` and
`WORKFLOW.md`. Both are in `install.sh`'s `MANAGED` set and are overwritten on
install, so consumers receive the corrections on their next upgrade with no
migration step. `WORKFLOW.md` keeps its `**Version <n>**` line and its existing
headings, so the existing assertion and any consumer link anchors continue to
resolve.

The new documentation pages are additive. Repository-only surfaces
(`README*.md`, `website/**`, `.claude/tests/**`) never reach a consumer.

Rollback is `git revert`; nothing is persisted outside the working tree.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| New assertions hard-code a number and drift at the next release | Derive every expected value from `VERSION`, `protocol.json`, and `foundation.mjs` at test time | `test` |
| Shipped docs grow past their context budget | `run-context-budget-tests.sh` already bounds shipped files and runs in the same suite set; keep shipped edits to corrections plus a short pointer | `test` |
| A shipped file cites a repository-only path such as `website/` | `run-doc-consistency.sh` already fails on maintainer-only path citations in shipped docs; the canonical table is named, not linked, in shipped files | `test` |
| EN and TH pages diverge as they are written | Assert page-for-page parity between `docs/` and `docs/th/` rather than trusting review | `test` |
| New pages break the docs site build | Build the site as evidence; `dist/` is gitignored so it cannot expire the proof | `static-analysis` |
| Landing-page edits silently alter accessibility posture | Edits are restricted to text nodes; recorded as an external observation with the diff as the artifact | `accessibility` |
| Documentation overclaims that Land requires human approval | Assert that no documentation surface states Land is gated on consent | `test` |
