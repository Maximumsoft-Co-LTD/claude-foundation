---
name: brainstorming
description: Resolve genuine ambiguity before creating or materially revising an OpenSpec change. Use for unclear observable outcomes, competing approaches with consequential tradeoffs, unknown scope boundaries, or an explicit request to explore options. Skip when repository evidence and user intent already determine the change.
---

# Change investigation

Use the lightest path that resolves the decision.

1. Read existing OpenSpec specs and only the code needed to understand the seam.
2. Separate verified facts, hypotheses, constraints, and unknowns.
3. Identify at most three viable approaches and recommend one with concrete
   tradeoffs.
4. Ask only questions whose answers materially change behavior, compatibility,
   security, persistence, or scope.
5. End with a compact agreement: outcome, in/out, observable scenarios, chosen
   approach, and remaining risk.

Use `/investigate` when the exploration should remain no-stakes. Once the
agreement is clear, hand it to `/change`; do not create a separate spec, plan,
interview ledger, or lifecycle state.

No product code lands during investigation. Repository facts must be grounded
in files actually read; label inference explicitly. Prototypes stay inside the
harness-provided investigation scope and are evidence for a decision, not
implementation to Land.
