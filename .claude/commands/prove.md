---
description: Produce and validate content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). Run:

1. Start from `claude-foundation packet <change>` rather than replaying Build
   history, then run `claude-foundation validate <change>`.
2. `claude-foundation proof plan <change>`
3. Group stale/missing claims by provider. Run each deterministic command once,
   with `--claims declared` (or an explicit comma-separated subset), and reuse
   its log rather than repeating the same suite per claim.
4. For browser evidence, start the app once, wait for readiness once, and replay
   the declared scenarios in one session. Record input mode plus
   `--foreground-required` and `--foreground-available` separately.
5. Run risk-triggered review only when resolver state requires it.
6. `claude-foundation proof finalize <change>`

Do not describe a check as passed without a matching receipt. Do not land.
