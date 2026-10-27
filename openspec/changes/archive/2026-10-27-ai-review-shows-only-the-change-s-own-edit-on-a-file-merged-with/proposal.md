# Change: AI review shows only the change's own edit on a file merged with landed work

- **Change:** `ai-review-shows-only-the-change-s-own-edit-on-a-file-merged-with` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-27

## Why

When two changes edit the same file and the earlier one has landed, sandbox sync merges the landed edit into the later change's sandbox. The AI review diff compares every file with the base, so it presents the earlier change's lines as the later change's work. In a live run the reviewer asked for the earlier change's SDK methods to be removed as an unrequested surface, a request Land must refuse, and the later change could not finish.

## Scope

- **In scope (`review-landed-edits`):** The reviewer sees only the change's own lines in such a file and the diff says which bytes it compares against; The review diff can tell a root file merged with landed work from one the change alone edited
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/concurrent-same-file.test.mjs`, `.claude/harness/runtime/evidence/review-diff.mjs`, `.claude/harness/runtime/workflow/packet-runtime.mjs`, `.claude/harness/tests/configured-reviewer.test.mjs`, `.claude/harness/tests/packet-value.test.mjs`, … +1 more; the authored Non-goals below

## Non-goals

- Changing which files count as the change's surface or its diff identity
- Hiding any line of the sandbox file from the reviewer who opens the file
- Changing the review of a file that no earlier change landed

## Impact and risk

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Communication, support, and release note

### Release note

AI review of a change whose file merges an earlier landed edit now shows only this change's own lines.

## Acceptance traceability

Tasks: `tasks.md`; scenarios: the specs.

| Requirement | Scenario | Kind | Task | Check | Decision |
|---|---|---|---|---|---|
| review-diff-excludes-landed | A merged file shows only this change's lines | success | T002, T003 | test: `.claude/harness/tests/configured-reviewer.test.mjs`, `.claude/harness/tests/packet-value.test.mjs` | — |
|  | A file no earlier change landed keeps the base diff | boundary | T002, T003 |  |  |
|  | A file equal to the landed bytes has no change of its own | boundary | T002, T003 |  |  |
|  | Landed bytes that no longer match fall back to the base diff | failure | T002, T003 |  |  |
| root-landed-sync-record | The root sync records the merged file | success | T001 | test: `.claude/harness/tests/concurrent-same-file.test.mjs` | — |

## Definition of done

- Fresh evidence for every claim (5).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Amendment discovery coverage

Reason: Prove's review found that a delta (after-correction) round rebuilds the review inspection without the landed-byte comparison, so the first round and the correction rounds would disagree about which lines are the change's own. The agreement now names every review round.

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| failure-path | covered | review-diff-excludes-landed | none | none |
| input-boundary | covered | review-diff-excludes-landed | none | none |

## Appendix: Derived by the harness

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for review-diff-excludes-landed, root-landed-sync-record.

## Appendix: Amendment history

- Revision 1 (2026-10-27): Prove's review found that a delta (after-correction) round rebuilds the review inspection without the landed-byte comparison, so the first round and the correction rounds would disagree about which lines are the change's own. The agreement now names every review round.

## Appendix: Review record

| Round | Finding | Severity | Fix | Reviewer |
|---|---|---|---|---|
| 1 | F1: The `landedBase` mapping is only attached to the full-packet inspection. The delta review packet rebuilds `changedSurface.inspection` in authority-runtime.mjs:953-972 (`deltaInspection`) with only `repositoryId`, `workspacePath`, `baseHead` and `paths`, so `landedBase` is dropped. On the route's `ai-delta-after-correction` round, a merged file falls back to the base diff and shows the earlier change's landed lines as this change's work again. The fallback is safe because nothing is hidden, but the requirement is only met for the full round. Fix: carry `fullInspection.get(row.repositoryId)?.landedBase`, filtered to the delta paths, into each delta inspection entry. (root/.claude/harness/runtime/workflow/packet-runtime.mjs:118) | minor | resolved by round 2 | claude-opus |
| 2 | D1: If no root rows are in the delta scope, the control-workspace entry is pushed as `{ ...control, paths: [], ... }`. That copy brings along every `landedBase` entry from the full root inspection, which goes against the helper's own comment that only scoped rows keep a landed comparison. It does no harm: `reviewDiffValue` only looks up `landedBase` for scoped rows, and this entry has none. The `contractOnly` test also never checks for this. To match the comment, drop `landedBase` from the spread, e.g. `const { landedBase: _unused, ...rest } = control`. (root/.claude/harness/runtime/workflow/packet-runtime.mjs:124) | minor | open | claude-opus |
