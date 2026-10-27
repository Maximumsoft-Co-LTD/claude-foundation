# Order-inventory lifecycle lane: first paid runs — 2026-10-26

**Status:** observed evidence from a new lane's first ten paid runs, none
strict green. Not smoke-green and not repeated assurance. Finding 1 has a
demonstrated cause; a partial fix is proven by a deterministic test but did not
unblock the lane, and the remaining cause is identified (below).
[ภาษาไทย](scenario-order-inventory-lifecycle-2026-10-26.th.md)

## Scope and conditions

| Item | Value |
|---|---|
| Source | `52c3e50c9` plus uncommitted bench tooling (`lifecycle.mjs`, runner and scorecard changes, the lane's seed, oracle and fixtures) |
| Lane | `order-inventory-lifecycle` (see [the test plan](user-scenario-test-plan.md)); Claude Code only |
| Runs | Four full runs (crash in Build and in Land) and three controls (crash in Build only) before the fix, three full runs after it, plus one run killed by a tooling restart |
| Authority | User cap US$300; per-run ceiling US$60 |
| Cost | Measured US$23.7 across the ten completed runs; a SIGKILLed session writes no envelope, so total spend is not known and is bounded only by per-session allowances. The restart-killed run is unmeasured |

## What the harness did

| Behavior | Observed |
|---|---|
| Resume the same change after a SIGKILL in Build | Yes, in every run that reached it (7/7); no second change was created |
| `change amend` after the crash | Yes; the runtime state recorded one amendment and change A passed its scoped oracle 24/24 in 4 of 7 runs |
| Branch change B while A is proven and unlanded | Yes (5 runs reached it); B passed its scoped oracle 7/7 in 4 |
| Resume A's Land after SIGKILL once one repository was applied | Yes, to `archived` (4/4 full runs); the crash caught `backend` applied while `sdk` and `web` were not |

## Findings (open)

1. **B's Land is refused after A landed.** In all four full runs, Land of B
   returned `REPOSITORY_DELIVERY_FAILED: Land would overwrite an uncommitted
   target edit in 'backend': server.mjs`, although `WORKFLOW.md` (stacked
   changes) says Land is always allowed and replays landed edits. `sandbox sync`
   reported only fast-forwarded files and left B's `backend/server.mjs`
   without A's landed code. An agent with Land authority merged A's code into
   the sandbox file (identical to the target outside the paging code) and the
   refusal repeated eight times. **Cause (demonstrated without a model or a
   crash):** `assertChildTargetCompatible` in `repository-delivery-saga.mjs`
   never excused a target edit that the repository sandbox already holds,
   unlike the root path (`targetEditCarried`), so any earlier uncommitted
   landing in the same repository path was refused. **Fix:** the same carried
   check for child repositories, with three saga tests (carried lands; not
   carried and a different edit still stop and keep the target). **Insufficient
   end to end:** in the next full run (Prove passed) B's Land was still
   refused. The sandbox held all of A's landed code plus 68 added lines and
   differed from the target by one line, but merging A's base-to-target edit
   into it with `git merge-file` reports 4 conflicts (B's insertions sit next to
   A's), so the exact-carry check does not hold, although an `--ours` merge
   changes nothing (nothing landed is dropped). The root path accepts such an
   agent-resolved merge through a recorded conflict resolution
   (`landedResolved`, `resolutionKeepsLanded`); the repository path has no
   equivalent, and `sandbox sync` does not replay landed edits into a
   repository sandbox (`replayLandedChanges` covers the root only). So an
   agent merge of overlapping edits cannot land in a multi-repository change.
   Accepting `--ours` equality alone would let a sandbox overwrite a user's
   conflicting edit, so it needs the recorded resolution, not a looser check;
   this is a feature-sized change, not applied.
2. **The archived proposal omits the Amendment history appendix** although the
   runtime state records the amendment (4/4 archived A packets).
3. **Prove's reviewer stalled after an amendment** in 3 of 4 runs after the
   first four (0 of the first 4; the latest run passed): the second review
   round (delta closure) returned output that "do not bind to the dispatched
   workspace: delta closure must verify exactly: F1-…, F2-…",
   `advance` stopped at its no-progress boundary, and a second
   `authority reset-infra` with the benchmark's waiver reference was refused as
   already used. In `configured-reviewer.mjs` this is raised whenever the
   reviewer's `verifiedFindingIds` differ from the first-round IDs and is stored
   as a non-retryable error rather than a failed review, so a reviewer that
   considers a finding still open has no valid answer. The raw reviewer output
   of a stalled run was not captured (the one run that kept it passed), so
   this reading is not confirmed.
4. **Oracle-repair sessions can find nothing to do.** When Build's target is
   already reached, `advance --through build` returns no tasks; in three
   sessions the agent also searched the root checkout rather than the
   sandbox. This route is shared with the single-change lanes.
5. **B reached `proven` without wiring its route** once (oracle 0/7); the
   delivered tests passed. The oracle caught it.

## Bench defects found and fixed

A resumed session ended in 0.25 s when two changes shared the project (change
discovery was ambiguous); the budget accounting stopped the run when any
session lacked an envelope; the merge prompt hid the harness's own Land answer.
Each is covered by `openspec-native-lifecycle.test.mjs`.

## Limits

- Nine runs, one host, one model setting; findings 2–5 are single-digit
  counts and may be agent variance.
- The lane has no strict paid pass; nothing here supports a claim that stacked
  Land works or fails in general.
- Raw bundles remain under `.claude/tests/bench/results/openspec-native-lab/`
  (`order-inventory-lifecycle-17930…` to `…17936…`); no checksummed archive
  outside Git was made.
