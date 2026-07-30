---
description: Produce and validate content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). Run:

1. Start from `claude-foundation packet <change>` rather than replaying Build
   history, then run `claude-foundation validate <change>`.
2. Run `claude-foundation proof plan <change>`.
3. Run `claude-foundation proof execute <change>`. Evidence v2 adapters batch
   claims, reuse receipts, deduplicate identical commands, schedule independent
   providers concurrently, and finalize proof.
4. If execution blocks on an `external` or unconfigured provider, obtain and
   record only that receipt, then run `proof execute` again.
5. Run risk-triggered review only when resolver state requires it.

Do not describe a check as passed without a matching receipt. Do not land.
