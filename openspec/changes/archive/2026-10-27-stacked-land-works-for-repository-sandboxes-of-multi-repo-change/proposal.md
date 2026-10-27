# Change: Stacked Land works for repository sandboxes of multi-repo changes

- **Change:** `stacked-land-works-for-repository-sandboxes-of-multi-repo-change` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** high tier · **Owner:** unassigned · **Created:** 2026-10-27

## Why

When two changes touch the same repository of a multi-repository change, the later one cannot land. Sandbox sync replays an earlier change's landed, uncommitted edit only into the root sandbox, and repository Land accepts neither a clean replay nor an agent's hand merge. An agent that merges the landed code by hand is still refused with "Land would overwrite an uncommitted target edit". After this change the repository sandboxes follow the same stacked-change rules as the root.

## Scope

- **In scope (`repository-stacked-land`):** A later change's repository sandbox holds the earlier landed edit, or a conflict is reported with the repository and path; An agent-resolved merge of overlapping edits lands, and a merge that drops landed content does not; A user's uncommitted edit is never overwritten by a resolution mechanism meant for landed edits
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/runtime/workflow/target-edits.mjs`, `.claude/harness/tests/concurrent-repositories.test.mjs`, `.claude/harness/tests/fixtures/concurrent-repositories.mjs`, `.claude/harness/tests/target-edits.test.mjs`, `.claude/tests/run-all.sh`, … +6 more; the authored Non-goals below

## Non-goals

- Copying landed files that a repository sandbox did not edit into that sandbox
- Changing the root sandbox replay, which already works
- Accepting a sandbox merge only because merging it again changes nothing, without a recorded conflict

## Impact and risk

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Communication, support, and release note

### Release note

A change that branched before another landed in the same repository now lands: sandbox sync merges the landed edit into each repository sandbox and Land accepts a resolved merge.

## Acceptance traceability

Tasks: `tasks.md`; scenarios: the specs.

| Requirement | Scenario | Kind | Task | Check | Decision |
|---|---|---|---|---|---|
| repository-landed-replay | Edits on different lines merge | success | T001, T003 | test: `.claude/harness/tests/concurrent-repositories.test.mjs`, `.claude/harness/tests/fixtures/concurrent-repositories.mjs`, `.claude/harness/tests/target-edits.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | A replayed change lands | success | T001, T003 |  |  |
|  | A file edited after the landing is not replayed | boundary | T001, T003 |  |  |
|  | A file the sandbox did not edit is left alone | boundary | T001, T003 |  |  |
|  | Edits on the same line conflict | failure | T001, T003 |  |  |
| repository-resolution-accepted | A resolved merge lands | success | T002, T003 | test: `.claude/harness/tests/repository-delivery-saga.test.mjs` | — |
|  | A resolution does not survive a changed target | boundary | T002, T003 |  |  |
|  | A merge that drops landed content does not land | failure | T002, T003 |  |  |
| repository-user-edit-stops | A sandbox that already carries the edit lands | boundary | T002 | test: `.claude/harness/tests/repository-delivery-saga.test.mjs` | — |
|  | A user edit on the same lines stops Land | failure | T002 |  |  |

## Definition of done

- Fresh evidence for every claim (10).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Appendix: Discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | repository-landed-replay |  |  |
| affected-actor | covered | repository-landed-replay, repository-resolution-accepted |  |  |
| compatibility | covered | repository-user-edit-stops |  |  |
| verification | covered | repository-landed-replay, repository-resolution-accepted, repository-user-edit-stops |  |  |
| operability | covered | repository-landed-replay, repository-resolution-accepted |  |  |
| recoverability | covered | repository-resolution-accepted |  |  |
| security-privacy | not-applicable |  |  | No new input crosses a trust boundary; the change narrows when Land may write over uncommitted target bytes. |
| permission-rejection | not-applicable |  |  | No user or role is involved; Land's existing authority gate is unchanged. |
| data-migration | not-applicable |  |  | New runtime fields are optional and absent fields mean no recorded resolution. |
| rollout-rollback | covered | repository-user-edit-stops |  |  |

Derived by the harness from the draft (5): desired-behavior, success-path, failure-path, input-boundary, non-goals.

## Amendment discovery coverage

Reason: Build found the approved scenario for a merge that drops landed content is narrower in the root path it is meant to match: the root accepts any resolution of the lines both changes rewrote, because only the agent can decide those, and refuses a resolution that drops landed edits outside them. The repository scenario now says so; the agreement keeps parity with the root.

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| failure-path | covered | repository-resolution-accepted | none | none |
| input-boundary | covered | repository-resolution-accepted | none | none |

## Appendix: Derived by the harness

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for repository-landed-replay, repository-resolution-accepted, repository-user-edit-stops.

## Appendix: Amendment history

- Revision 1 (2026-10-27): Build found that a repository Land stop on a landed path must reach the harness-owned landed-change sync as the root path does; that routing lives in apply-runtime.mjs, outside every approved task path. No behavior of the agreement changes.
- Revision 2 (2026-10-27): Build found the approved scenario for a merge that drops landed content is narrower in the root path it is meant to match: the root accepts any resolution of the lines both changes rewrote, because only the agent can decide those, and refuses a resolution that drops landed edits outside them. The repository scenario now says so; the agreement keeps parity with the root.

## Appendix: Review record

| Round | Finding | Severity | Fix | Reviewer |
|---|---|---|---|---|
| 1 | F1-untracked-landed-sync-loop: `assertChildTargetCompatible` refuses every `untracked` row before checking `childEditCarried` or `resolvedLanded`. `overwriteError` then sets `landedSync: true` whenever a Land journal vouches for the target bytes, unless `landedReplay` already holds the sandbox digest. `replayLandedWithin` only writes `landedReplay` for a clean merge. A resolved conflict goes to `landedResolved` instead, and a 'carried' result is not recorded at all.  Example: alpha lands a new file in backend, and bravo's sandbox also created that path with different content. Sync reports an add/add CONFLICT, the agent resolves it, and the next sync records `landedResolved`. Land still refuses the row (`untracked`) with `landedSync: true`, which maps to the `sandbox-sync` automatic recovery. That sync finds the resolution still valid, nothing merged and no conflicts, so it returns SYNCED and leaves the proof valid. `advanceThrough` then recurses into the same Land refusal (advance-runtime.mjs:1381-1392 has no attempt limit). The result is an `advance --through archived` that never terminates.  The same loop can happen when the bytes are carried but the permission bits differ: `childEditCarried` returns false, replay returns 'carried', and nothing is recorded.  Suggested fix: treat `landedSync` as exhausted when sync already ran for the current sandbox bytes, whether as a replay, a recorded resolution or a carry. Alternatively, apply `resolvedLanded` to untracked rows as well. (root/.claude/harness/runtime/workflow/repository-delivery-saga.mjs:203) | major | verified in round 2 | claude-opus |
| 1 | F2-resolution-ignores-mode: `resolvedLanded` accepts a refused row by content identity alone. `childEditCarried` refuses when the target and sandbox permission bits differ (line 186), but a recorded resolution skips that check. So Land can overwrite a permission change that alpha landed (for example, a file made executable) with the sandbox's mode, without stopping. (root/.claude/harness/runtime/workflow/repository-delivery-saga.mjs:165) | minor | resolved by round 2 | claude-opus |
| 1 | F3-edited-after-landing-stop-unasserted: The 'file edited after the landing' test only checks that sync does not replay the file and leaves the sandbox untouched. The scenario's second THEN (Land's target-edit stop still applies to that file) is not checked there. Other tests (the changed-target resolution test and the user-edit test) only cover it indirectly. (root/.claude/harness/tests/concurrent-repositories.test.mjs:137) | minor | resolved by round 2 | claude-opus |
