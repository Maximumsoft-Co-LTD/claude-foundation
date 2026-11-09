# AI review deadlocks after an interrupted cheaper-tier review is aborted

| Field | Value |
|---|---|
| Id | 2026-11-09-review-deadlock-after-target-branch-switch |
| Detected | 2026-11-09, by `advance --through proven` during change add-repository-agent-evals-with-a-monthly-paid-budget |
| Affected versions | harness at commit `f9635e6f` and earlier releases with tiered review models |
| Severity | major (see [REVIEW.md](../../REVIEW.md#severity)) |
| Status | closed |
| Decision | fix now in the harness; the blocked repository-only change was delivered outside the loop with full-suite verification (maintainer, 2026-11-09) |
| Fix change | recover-interrupted-cheaper-tier-reviews-and-refuse-a-trapping-a |
| Regression | `.claude/harness/tests/workflow-policy.test.mjs` (fast-tier interrupted recovery and refused abort), `.claude/harness/tests/authority-request-operation.test.mjs`, eval `incident-2026-11-09-review-deadlock-after-target-branch-switch` |

## Symptom

While the change was in Prove, another session switched the target checkout
from `feat/agent-evals-phase2b` to `main` (release v3.6.11) and back. Then:

1. `advance` returned `REPAIR`: "configured review result integrity or
   reviewer provenance does not match".
2. After `authority abort` of that request and a new `authority request`,
   every `advance` returned "a completed AI response has no matching recorded
   receipt; repair that authority record or pause instead of starting another
   configured reviewer", ending at `repeated-no-progress`.

## Evidence

- Quarantined state under
  `.foundation/recovery/abandoned/add-repository-agent-evals-with-a-monthly-paid-budget/`:
  attempt 1 completed with `resultStatus: pass` on model `sonnet`
  (`modelTier: standard`), its response checkpointed, and no review receipt.
- Timeline (UTC): dispatch 15:31:57; checkout moved to `main` 15:32:30; review
  completed 15:32:54; receipt recording at 15:32:55 failed while on `main`
  (its `REVIEW.md` hash differed, so the receipt was stale); checkout returned
  15:34:32.
- Reproduced without any branch switch by
  `workflow-policy.test.mjs`: an interrupted fast-tier first round failed with
  the same message before the fix.

## Cause

Corrected 2026-11-09 (the original record's hypothesis named the branch switch
as the cause; the switch only interrupted recording). Two harness defects:

1. Recovery of a checkpointed result recomputed the expected reviewer model
   class after the attempt had completed. The completed attempt now counted as
   delivered, so a cheaper first round (sonnet) was expected to be the
   configured model (opus) and was refused as a provenance mismatch.
2. `authority abort` of a request whose result had completed without a receipt
   only marked the request aborted. The delivered attempt stayed in history,
   and the anti-repeat guard (`unrecordedDeliveredAiResponse`) then refused
   every new review with no supported way out.

## Resolution

Recovery now compares against the reviewer recorded at dispatch
(`dispatch.reviewer`) and records the receipt with that model. `authority
abort` refuses a request whose AI result completed without a receipt and names
`advance` or `authority record` instead. The anti-repeat guard is unchanged.
Lesson updated in [lessons.md](../lessons.md).
