# <Incident title: the observed failure in one line>

| Field | Value |
|---|---|
| Id | YYYY-MM-DD-<short-slug> |
| Detected | YYYY-MM-DD, by <signal: CI on main / user issue / harness feedback / release scenario> |
| Affected versions | <VERSION range or commit> |
| Severity | blocker / major / minor (see [REVIEW.md](../../REVIEW.md#severity)) |
| Status | open / fixing / scheduled / dismissed / closed |
| Decision | <service owner's decision and reason> |
| Fix change | <openspec change id, or none> |
| Regression | <test path or eval id that fails without the fix> |

## Symptom

What the user or CI saw, with the exact error text.

## Evidence

Commands, logs, or receipts that reproduce it. Mark anything not reproduced as
unverified.

## Cause

The verified root cause. Leave "unknown" until it is verified.

## Resolution

What changed and where. Link the change and the lesson added to
[lessons.md](../lessons.md).
