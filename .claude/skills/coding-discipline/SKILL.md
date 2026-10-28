---
name: coding-discipline
description: "Use when scope, assumptions, or the right size of a fix is unclear and you might over-build. Skip routine settled work."
---

# Coding discipline

Pick the smallest change that provably meets the request; verify before you ask.

## Steps

1. Surface assumptions that could change behavior, compatibility, security,
   persistence, scope, or an irreversible effect. Check repository facts first;
   ask the user only when the remaining choice is consequential.
2. Choose the smallest adequate solution in order: no code, standard library,
   platform/framework, installed dependency, then minimal new code. Never trade
   away required safety, correctness, accessibility, or evidence.
3. Keep every changed line traceable to the request. Match local conventions,
   remove only debris your change caused, and report unrelated issues instead
   of fixing them.
4. Keep comments for non-obvious constraints and public contracts. Prove a
   guard unnecessary before removing it; uncertainty is not grounds for deletion.
5. Turn the request into a checkable outcome and continue until project-owned
   evidence proves it or a concrete blocker remains.
6. Then load the construction or process skill that owns the technical decision.

## Harness

Durable intent and decisions go to OpenSpec, not a chat-only or parallel plan.
Status lives in `tasks.md` and proof in harness receipts. "Goal-driven" grants
no authority to widen scope, mutate external systems, commit, or Land.

## References

- `references/details.md` — rationale for each rule, encoding a recurring correction as a check, building a lever for repeated work.
- `references/cleanup.md` — removing residue after a change.
