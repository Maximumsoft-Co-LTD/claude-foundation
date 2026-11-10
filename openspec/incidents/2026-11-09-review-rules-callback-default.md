# Review receipt validity throws when no rules lookup is supplied

| Field | Value |
|---|---|
| Id | 2026-11-09-review-rules-callback-default |
| Detected | 2026-11-09, by the full suite run on the target checkout after Land |
| Affected versions | branch `docs/review-governance-phase0` at commit `1a2c008b`; never released |
| Severity | major (see [REVIEW.md](../../REVIEW.md#severity)) |
| Status | closed |
| Decision | fix now, before the branch is pushed (maintainer) |
| Fix change | bind-the-review-rules-a-reviewer-was-sent-and-fix-rules-wiring |
| Regression | `.claude/harness/tests/receipt-validity.test.mjs` (no-lookup validity) and `.claude/tests/harness/run-risk-tiered-review-tests.mjs` CASE-REVIEW-REPAIR-CLOSURE |

## Symptom

`node .claude/tests/harness/run-risk-tiered-review-tests.mjs` failed
CASE-REVIEW-REPAIR-CLOSURE with
`TypeError: currentReviewRulesHash is not a function`
(`runtime/evidence/receipt-validity.mjs`). The `bounded review repair closure`
suite failed the same way.

## Evidence

Reproduced on the target checkout after Land of
bind-the-project-s-advisory-review-md-to-every-ai-review. Production wiring in
`foundation.mjs` always supplies the callback, so installed consumers were not
observed to fail; that is inferred from the wiring, not from a consumer run.

## Cause

`createReceiptValidity` gained a required `currentReviewRulesHash` dependency
with no default, while every new review receipt started recording
`review.reviewRulesHash`. Tests that build receipt validity directly did not
pass the callback. The change's Prove ran only each task's verify command, so
the full suite first ran after Land.

## Resolution

The dependency now defaults to `() => null` (no REVIEW.md). Review receipts also
bind the hash carried by the dispatched attempt instead of reading the file at
record time. Lesson added to [lessons.md](../lessons.md).
