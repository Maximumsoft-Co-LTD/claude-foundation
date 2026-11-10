# AI review deadlocks after the target checkout switches branch mid-review

| Field | Value |
|---|---|
| Id | 2026-11-09-review-deadlock-after-target-branch-switch |
| Detected | 2026-11-09, by `advance --through proven` during change add-repository-agent-evals-with-a-monthly-paid-budget |
| Affected versions | harness at commit `f9635e6f` (branch `feat/agent-evals-phase2b`); not reproduced on other versions |
| Severity | major (see [REVIEW.md](../../REVIEW.md#severity)) |
| Status | open |
| Decision | schedule a harness fix; deliver the blocked repository-only change outside the loop with full-suite verification (maintainer, 2026-11-09) |
| Fix change | none yet |
| Regression | none yet; required before this record closes |

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

- `authority status` showed one review request dispatched at
  2026-11-09T15:31:57Z with a delivered `pass` response and no review receipt.
- The guard is `unrecordedDeliveredAiResponse`
  (`.claude/harness/runtime/workflow/authority-runtime.mjs`), which returns the
  latest delivered AI attempt whenever the review receipt does not bind it.
- `git reflog` in the target checkout shows `checkout: moving from
  feat/agent-evals-phase2b to main` and a fast-forward to `ad82da00` while the
  review ran.

## Cause

Unverified hypothesis: the delivered response was bound to a workspace and
harness revision that no longer matched after the branch switch, so it can
never become a receipt, and no supported command retires a delivered but
unrecordable attempt. Aborting the request does not clear the attempt history
the guard reads.

## Resolution

The change was retired with `change abandon` (agreement kept under
`.foundation/recovery/abandoned/`). Its repository-only diff was applied to the
branch directly and verified with the full suite. A harness fix must let a
delivered attempt whose provenance can no longer match be retired on record,
then add a regression and close this record.
