---
description: Explore an unclear brownfield problem without committing to a change.
argument-hint: <problem or decision>
---

Investigate **$ARGUMENTS**.

This is a bounded, no-stakes exploration. Read relevant code and existing
`openspec/specs/`; distinguish facts, hypotheses, options, tradeoffs, and unknowns.
When the arguments name an active change with a sandbox, inspect code at the
runtime's `workspace.path`, not the pre-build target tree.
Do not edit product code. Write a concise note under
`openspec/investigations/<kebab-name>.md` only when the findings need to survive
the conversation. End with one of: `ready for /change`, `needs user decision`, or
`not worth changing`.
