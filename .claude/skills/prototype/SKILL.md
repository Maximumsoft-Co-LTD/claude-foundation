---
name: prototype
description: "Use when an approver must see a drafted or started change as a clickable approval page before approving. Skip settled UI code (frontend-design) and open interaction decisions (ux-ui-principles)."
---

# Approval page

Write the one page an approver reads. The change is its only source.

## Steps

1. Read the change first: compiled proposal, specs, design, tasks, or the draft. With none, stop and ask for `/change`.
2. Run `claude-foundation package <change>`; copy its risk, proof, roles, `factsDigest`, and `prototype.checklist` verbatim.
3. Choose the form from [by-work-type](references/by-work-type.md); show every checklist surface and write `unknown` where the draft is silent.
4. Build the page to [page-contract](references/page-contract.md) in the project's own design ([design-and-canvas](references/design-and-canvas.md)).
5. If the host has a design skill or Artifact `design` type, build on its canvas; always export `.foundation/previews/<change>/prototype.html`.
6. Name that file as the `prototype` example with `covers`, then run `change revise`.
7. When the page is edited, revise or amend the change in the same turn ([sync](references/sync.md)).

## Harness

The page is never proof and gates nothing; facts are copied from the harness, never authored.
Write only under `.foundation/previews/<change>/`.

## References

- [page-contract](references/page-contract.md), [by-work-type](references/by-work-type.md), [design-and-canvas](references/design-and-canvas.md), [sync](references/sync.md).
