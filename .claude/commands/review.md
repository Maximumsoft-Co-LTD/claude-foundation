---
description: Independently review a risk-gated change.
argument-hint: <change>
---

Review **$ARGUMENTS** without editing product code.

Start only from
`claude-foundation packet <change> --phase review`; do not inherit Build history.
The host invokes a fresh reviewer and supplies reviewer and implementer
provenance. Enforce the packet's independence and diversity policy; unknown or
same-session provenance cannot pass.

Inspect its claims, decisions, changed surface, evidence, and prior findings.
Report verified blockers together. A passing receipt requires zero unresolved
blockers, complete provenance, an observation, and a durable reference.

If fixes are needed, return them to Build. The edit makes the prior receipt
stale; re-review only changed scope. Allow two AI rounds, then require a human.
Do not implement fixes, loop unboundedly, finalize proof, or Land.
