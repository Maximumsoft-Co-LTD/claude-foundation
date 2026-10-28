---
name: brainstorming
description: "Use when the product outcome or approach is still open and the user must pick between real alternatives before /change. Skip settled work and how/why questions (use investigate)."
---

# Brainstorming

Facts come from sources; choices come from the user.

## Steps

1. Read the OpenSpec specs and only the code needed to understand the seam.
   Separate verified facts, hypotheses, constraints, and unknowns.
2. Never ask what you can find. Challenge fuzzy or conflicting project terms
   against specifications and code; ask only when more than one material
   domain meaning remains.
3. Model open decisions as a private dependency tree (prerequisites,
   alternatives, dependent effects); never persist it as an
   artifact or lifecycle state.
4. Offer at most three approaches and recommend one with concrete tradeoffs.
   Ask only what materially changes behavior, compatibility, security,
   persistence, scope, or an observable non-functional target
   (performance, capacity, availability, privacy, accessibility).
5. Ask in rounds, not one at a time: every open decision whose
   prerequisites are already settled, through the host's
   structured question tool (AskUserQuestion), recommendation first. Recompute
   from the answers; stop only when
   every material decision has been asked and answered.
6. End with a compact agreement: outcome, in/out, scenarios, chosen approach,
   remaining risk, canonical terms, and
   each asked question with its chosen answer. Hand it to `/change`, reuse
   the settled answers without asking them again, and record them in the
   change packet, not chat.

## Harness

No product code lands here; prototypes stay inside the harness investigation
scope as evidence. Create no separate spec, plan, interview ledger, glossary,
or lifecycle state; the harness owns lifecycle and receipts.

## References

None; use `/investigate` for no-stakes exploration.
