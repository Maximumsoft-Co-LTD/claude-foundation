---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Start from `packet <change> --phase prove`, not Build history. For external
review or acceptance, run `proof collect` and `authority request`; explain the
packet and ask whether to inspect, send, or pause. Record real responses through
`authority record`. Run `proof run`; reuse fresh receipts.

Follow deterministic steps, but stop on decisions. Never expose raw readiness JSON
or ask users for receipt syntax, provenance, or placeholders. Responses may pass,
fail, be inconclusive, or pause. Use a fresh independent reviewer when required;
human acceptance inspects the final workspace.

Never substitute self-review or automation, claim an unproven pass, or Land.
