---
name: refactoring-fundamentals
description: "Use when restructuring code without changing behavior: extract, move, rename, split, deduplicate, simplify. Skip bug fixes and new features."
---

# Refactoring fundamentals

Change structure, never behavior; one reversible move at a time.

## Steps

1. State the equivalence claim: what stays identical (outputs, validation,
   errors, visible effects). If any of these change, that is a separate
   feature/fix slice.
2. Name the purpose: an observed smell or an imminent change the current shape
   makes hard. Do not refactor from taste alone.
3. Capture a green baseline. If touched behavior lacks coverage, add a focused
   characterization or golden-master test first.
4. Apply one named, reversible move, then rerun the narrowest trustworthy
   check. Never edit expected assertions to make a structural move pass.
5. Keep large work shippable with Mikado, branch-by-abstraction, strangler, or
   expand-migrate-contract sequencing. Avoid flag-day rewrites and deleting an
   API before its consumers are compatible.
6. Stop when the stated obstacle is gone. Leave unrelated cleanup for another
   change, then hand the target shape to the owning construction skill.

## Harness

Record the equivalence claim, baseline check, ordered slices, and rollback point
through Change revision/amendment; harness receipts prove the same behavior on the
exact workspace. No second ledger; Build never stages or commits; only the harness marks tasks complete.

## References

- `references/refactoring-discipline.md` — equivalence and one purpose per slice.
- `references/characterization-tests.md` — baseline for uncovered legacy code.
- `references/code-smells.md` — diagnose what to change and when not to.
- `references/catalog.md` — safe named moves.
- `references/large-scale.md` — staged restructuring patterns.
