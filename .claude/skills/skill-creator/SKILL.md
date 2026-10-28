---
name: skill-creator
description: "Use when explicitly asked to create or edit a skill. Skip unrequested skill changes; use skill-evaluation to compare behavior."
---

# Skill creator

Explicit authoring handoff for approved skill changes; a description selects a
skill, it never grants authority.

## Steps

1. Capture the settled intent, examples, constraints, and corrections. Ask
   only for consequential choices still missing.
2. Define the task, positive and negative triggers, output, tool requirements,
   and boundaries.
3. Write the shortest operational body; keep depth in selectively loaded
   references and link canonical contracts instead of copying them.
4. Validate metadata, references, install independence, and harness ownership.
5. Use `skill-evaluation` for old/new comparisons; label static checks apart
   from observed model behavior, and keep missing runs unknown.
6. Review the diff and resume the current harness action.

## Harness

Shipped changes go through Change Loop with status in the active OpenSpec
tasks, never a second ledger. Publishing or Git mutations need separate authority.

## References

- `references/authoring-overview.md` — phases and templates; read first, then
  only the phase reference it names.
- `references/creating-skills.md`, `references/improving-skills.md`,
  `references/description-optimization.md`, `references/testing-and-evaluation.md`,
  `references/environment-specifics.md`, `references/schemas.md` — per phase.
- Use `skill-suite-auditor` when the problem spans the whole catalog.
