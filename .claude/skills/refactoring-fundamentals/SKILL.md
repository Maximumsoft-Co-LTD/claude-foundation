---
name: refactoring-fundamentals
description: Apply refactoring fundamentals — change structure without changing behavior, safely. Use BEFORE reshaping existing, working code whose behavior should stay identical and only the shape is wrong — break up, extract, move, rename, consolidate duplication, untangle, or restructure legacy/untested code (characterize first). The ask often sounds like "clean this up / break into smaller pieces / extract / split / pull into one place / de-duplicate / untangle / is there a cleaner way / it works but it's a mess / pay down tech debt" — even when the word "refactor" never appears. Skip greenfield code, new features, bug fixes, reformatting, deleting code, and explaining what code does.
---

# Refactoring Fundamentals

## Why this exists

Classic failure modes that turn refactoring into breaking:

- Restructuring code that has no tests, then "it still looks right" ships a behavior change nobody noticed.
- One commit that *both* renames things *and* fixes a bug — unreviewable, impossible to revert selectively.
- A big-bang "rewrite this module properly" that's 80% done for three weeks while `main` can't ship.
- Refactoring for its own sake — gold-plating code that was about to be deleted.
- Calling it "refactoring" while actually changing behavior, so no one writes the test that would have caught the regression.

Apply *before* moving code, not after the suite goes red. This skill owns the **safe path** (Fowler, Beck, Feathers) — not what the destination looks like (that's [[programming-fundamentals]]), but how to get there without breaking anything. A smell tells you *that* this code needs restructuring; programming-fundamentals tells you *what shape* to move it toward; this skill tells you *how to get there green*.

## The 7 principles

Apply them roughly in order — the early ones gate the later ones. Full rule/why/how-to-apply/example for each lives in the linked reference file.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Refactoring changes structure, never behavior | State the one-line behavior-equivalence claim before starting; if the change alters output, validation, or a bug, it's a feat/fix and must not travel as "refactor." | `references/refactoring-discipline.md` |
| 2 | Wear one hat at a time | Each commit is either pure restructure (`refactor(...)`) or pure behavior change (`feat`/`fix`) — never both. Editing test assertions mid-refactor is the red flag. | `references/refactoring-discipline.md` |
| 3 | Get green before you touch; if there's no test, characterize first | Refactor only on a passing test that exercises the behavior being moved. Uncovered → pin current actual behavior (bugs included) with a characterization/golden-master test first. | `references/characterization-tests.md` |
| 4 | Small reversible steps, green between every one | Use the catalog's named moves one at a time, run tests after each, commit when green. Estimating effort across a batch = a rewrite, not a refactor (see principle 7). | `references/catalog.md` |
| 5 | Refactor with a purpose — let smells and upcoming change drive it | Name the trigger first: an active smell or an upcoming change ("make the change easy, then make the easy change"). Rule of Three for duplication; "it felt messy" is not a trigger. | `references/code-smells.md` |
| 6 | Know when NOT to refactor | Skip code scheduled for deletion, stable backwaters, and no-net deadline work — note the debt instead. Effort-estimated batches are rewrites in disguise. | `references/code-smells.md` |
| 7 | Keep large refactorings shippable — Mikado and strangler | Too big for one sitting → keep trunk green and stoppable: Mikado leaf-first, branch by abstraction, parallel change (expand → migrate → contract). Never a flag-day cutover. | `references/large-scale.md` |

## Pre-flight checklist

Before you start moving code, run through these:

1. **Behavior contract:** Can I state the one-line "what stays observably identical" claim? (If not, this might be a feature/fix, not a refactor.)
2. **One hat:** Is this commit *only* restructuring, with no behavior change riding along?
3. **Safety net:** Is the touched behavior under a passing test? If not, have I written a characterization/golden-master baseline *first*?
4. **Small steps:** Am I moving in named, reversible steps, green and committed between each — not one big edit?
5. **Purpose:** What smell or upcoming change is driving this? (If "it felt messy," reconsider.)
6. **Should I even?** Is this code worth it — not about-to-be-deleted, not a stable backwater, not secretly a rewrite?
7. **Size:** If it's too big for one sitting, do I have a Mikado/strangler plan that keeps trunk green and stoppable?

If any answer is "I don't know," stop and find out before changing code. A reverted tiny step costs seconds; a tangled half-done refactor on a red branch costs days.

## When to skip this skill

- **Greenfield code** with nothing to preserve — there's no existing behavior to hold constant; use [[programming-fundamentals]] to get the shape right the first time.
- **Behavior-changing work** — a feature or a bug fix. That's `feat`/`fix`, with its own tests for the *new* behavior. (You may *refactor in preparation* — that part follows this skill; the behavior change itself doesn't.)
- **Throwaway scripts** you'll delete within the hour.
- **A trivial, IDE-mechanical rename** with the symbol fully covered and the tool doing the work — the discipline is already satisfied by construction.

For anything else — yes, even the "quick cleanup," even the "I'll just extract this one function" — these fundamentals apply. The cleanups that break production are almost always the ones that started with "this is too small to need a test."

## Relation to other skills

- [[programming-fundamentals]] — the **destination**. A smell says *that* code needs work; programming-fundamentals says *what good looks like*; this skill says *how to get there green*.
- [[debug-fundamentals]] — for a `fix`, run debug-fundamentals first to find the cause; refactoring is then often the safe way to reshape around it. Both share "pin behavior with a test before you touch it."
- [[coding-discipline]] — the conduct layer that wraps this and every code task (`CLAUDE.md` / the router own the "wraps first" agreement).
- [[architecture-fundamentals]] — when the refactor crosses component/service boundaries, it owns the runtime-boundary and contract decisions; this skill owns the keep-it-green mechanics.
- [[git-workflow]] — the delivery channel for principle 2: atomic per-step commits, refactor commits separate from feature/fix commits, a branch green at every commit.

**Run order when several apply:** `.claude/rules/fundamentals.md` is canonical — it runs this skill first (pick the safe path, capture the baseline), then the construction skill that owns the target layer ([[programming-fundamentals]], plus [[database-fundamentals]]/[[hexagonal-backend]] when the restructure reaches those layers).

## Reference files

Read the one that matches the move in front of you; you don't need them all upfront.

- `references/refactoring-discipline.md` — the behavior-equivalence contract and the one-hat-per-commit discipline; principles 1 and 2's full rule/why/how-to-apply/example.
- `references/code-smells.md` — the smell catalog: each smell, why it hurts, and the refactoring move(s) that resolve it. Start here to decide *whether and what* to refactor; principles 5 and 6's full rule/why/how-to-apply/example.
- `references/catalog.md` — the core named refactorings (Extract/Inline Function, Move, Rename, Replace Conditional with Polymorphism, Introduce Parameter Object, Replace Temp with Query, Split Phase…) with their safe step-by-step mechanics. The *how* of principle 4, plus its full rule/why/how-to-apply/example.
- `references/characterization-tests.md` — Feathers' technique: seams, cover-and-modify, golden-master/approval tests, pinning legacy behavior including bugs. The safety-net deep-dive for principle 3 (full rule/why/how-to-apply/example) — and the home of the `/dev` baseline-capture contract.
- `references/large-scale.md` — Mikado Method, branch by abstraction, strangler fig, parallel change (expand-migrate-contract), keeping trunk green. The *how* of principle 7, plus its full rule/why/how-to-apply/example.
