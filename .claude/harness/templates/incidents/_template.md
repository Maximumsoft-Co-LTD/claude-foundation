# <Incident title: the observed failure in one line>

| Field | Value |
|---|---|
| Id | YYYY-MM-DD-<short-slug> |
| Detected | YYYY-MM-DD, by <signal: alert / user report / CI / release check> |
| Affected versions | <version range, deployment, or commit> |
| Severity | blocker / major / minor (see [REVIEW.md](../../REVIEW.md#severity)) |
| Status | open / fixing / scheduled / dismissed / closed |
| Decision | <service owner's decision and reason> |
| Fix change | <Change Loop hotfix change id, or none> |
| Regression | <scenario with `regressionOf` and the test that fails without the fix> |

## Symptom

What users or monitoring saw, with the exact error text.

## Evidence

Commands, logs, or traces that reproduce it. Mark anything not reproduced as
unverified. Remove secrets and personal data.

## Cause

The verified root cause. Leave "unknown" until it is verified.

## Resolution

What changed and where. Link the hotfix change and the lesson added to
[lessons.md](../lessons.md).
