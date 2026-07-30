---
description: Produce and validate content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

The managed Foundation block already supplies the loop invariants. Run:

1. Start from `claude-foundation packet <change> --phase prove` rather than
   replaying Build history. This incrementally closes Build telemetry from the
   native Claude transcript.
2. Run `claude-foundation doctor --stage prove --change <change>` and
   `claude-foundation proof preflight <change>`.
3. Run `claude-foundation proof plan <change>`, then
   `claude-foundation proof execute <change>`. Adapters batch
   claims, reuse receipts, deduplicate identical commands, schedule independent
   providers concurrently, and finalize proof.
4. If execution blocks on an `external` or unconfigured provider, obtain and
   record only that receipt, then run `proof execute` again.
5. Run risk-triggered review when resolver or changed-surface policy requires it.
6. Run `claude-foundation proof audit <change>` before handing off to Land.

Do not describe a check as passed without a matching receipt. Do not land.
