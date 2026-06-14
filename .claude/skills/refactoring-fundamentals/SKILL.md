---
name: refactoring-fundamentals
description: Apply refactoring fundamentals — change structure without changing behavior, safely. Use BEFORE reshaping existing, working code whose behavior should stay identical and only the shape is wrong — break up, extract, move, rename, consolidate duplication, untangle, or restructure legacy/untested code (characterize first). The ask often sounds like "clean this up / break into smaller pieces / extract / split / pull into one place / de-duplicate / untangle / is there a cleaner way / it works but it's a mess / pay down tech debt" — even when the word "refactor" never appears. Skip greenfield code, new features, bug fixes, reformatting, deleting code, and explaining what code does.
---

# Refactoring Fundamentals

## Why this exists

Refactoring is the most common way working code gets *broken*. The intent is harmless — "just clean this up" — but a restructure with no safety net, a diff that mixes cleanup with a behavior change, or a "small tidy" that quietly turns into a half-finished rewrite is how a green codebase goes red. The classic failure modes:

- Restructuring code that has no tests, then "it still looks right" ships a behavior change nobody noticed.
- One commit that *both* renames things *and* fixes a bug — unreviewable, and impossible to revert one without the other.
- A big-bang "rewrite this module properly" that's 80% done for three weeks while `main` can't ship.
- Refactoring for its own sake — gold-plating code that was about to be deleted, or that nobody will touch again.
- Calling it "refactoring" while actually changing behavior, so no one writes the test that would have caught the regression.

The discipline below is what separates a safe, reviewable, always-green transformation from "I cleaned it up and now staging is down." It is language- and stack-agnostic, drawn from Fowler (*Refactoring*), Beck (*Tidy First?*), and Feathers (*Working Effectively with Legacy Code*). Apply it *before* you start moving code, not after the suite goes red.

This skill owns the **safe path**. It deliberately does *not* re-teach what good code looks like at the destination — one-thing functions, illegal states unrepresentable, good names, sane complexity. That's [[programming-fundamentals]]. A smell tells you *that* this code needs restructuring; programming-fundamentals tells you *what shape* to move it toward; this skill tells you *how to get there without breaking it*.

## The 7 principles

Each principle has a one-line rule, a *why*, and a worked example. Apply them roughly in order — the early ones gate the later ones.

---

### 1. Refactoring changes structure, never behavior

**Rule:** A refactoring changes the internal structure of code without changing its observable behavior. If a change alters what the system *does* — a different output, a new validation, a fixed bug — it is not a refactoring, and it must not travel under that name.

**Why:** The whole safety argument for refactoring rests on this contract. Because behavior is held constant, the existing tests are a sufficient safety net and reviewers can read the diff as "same thing, better shape." The moment you smuggle a behavior change into a "refactor," both guarantees evaporate: the tests no longer pin the new behavior, and the reviewer waves through a functional change they thought was cosmetic. Naming is load-bearing here — mislabeling a behavior change as a refactor is how regressions ship unwatched.

**How to apply:**
- Before you start, state the one-line behavior-equivalence claim: *what stays observably identical, and how you'll verify it.* If you can't state it, you don't yet know whether this is a refactor.
- If partway through you discover you *need* a behavior change, stop, finish or revert the refactor, and do the behavior change as its own separate, named, tested step (see principle 2).
- "Observable" means at the boundary that matters: same return values, same persisted state, same emitted events, same error behavior. Internal call shapes are exactly what you're allowed to change.

**Example:**
```
Refactor:  Extract a 40-line `calculateInvoice()` into four named helpers. Same totals, same rounding, same DB writes. ✓
Not a refactor: "While extracting, I also fixed the rounding to round half-up." ← that's a fix. It changes output.
               Ship the extraction first (behavior identical), then the rounding fix as its own commit with its own test.
```

---

### 2. Wear one hat at a time

**Rule:** At any moment you are *either* refactoring (changing structure, adding no functionality, touching tests only to keep them compiling) *or* adding/changing functionality — never both. Each commit wears exactly one hat.

**Why:** Beck's two-hats rule is what makes both activities tractable. A pure-refactor commit is safe to review fast and safe to revert wholesale. A pure-behavior commit is where the reviewer and the test suite focus their attention. A mixed commit is the worst of both: the reader can't tell which of the 200 changed lines actually changed behavior, and you can't roll back the regression without also losing the cleanup. Separation isn't bureaucracy — it's what keeps the diff legible and the history bisectable.

**How to apply:**
- One commit = one hat. Refactor commits say `refactor(...)`; behavior commits say `feat(...)`/`fix(...)`. The split is visible in history, not just in your head.
- When adding a feature reveals that the code needs reshaping first, swap to the refactoring hat, make the structure ready, commit that, *then* swap back and add the feature. That ordering is principle 5 (preparatory refactoring).
- If you catch yourself editing test *assertions* (not just signatures/imports) mid-refactor, that's a red flag — you're probably changing behavior. Stop and check which hat you're wearing.

**Example:**
```
Bad:  one PR "refactor auth + add SSO" — 600 lines, reviewer can't isolate the security-relevant change.
Good: PR 1 `refactor(auth): extract TokenVerifier port` (behavior identical, suite green).
      PR 2 `feat(auth): add SSO adapter behind TokenVerifier` (new behavior, new tests).
```

---

### 3. Get green before you touch; if there's no test, characterize first

**Rule:** Refactoring is only safe on top of a passing test that exercises the behavior you're about to move. If that behavior isn't covered, write a *characterization test* that pins its current actual behavior — including any bugs — before you change a line.

**Why:** Without a safety net, refactoring is just editing and hoping. The test is the entire reason you're allowed to restructure aggressively: it's what tells you, after each step, that behavior is still identical. Legacy code is exactly the code with no such net, which is why Feathers' move is "cover, *then* modify": you capture what the code *actually does* (not what it should do — you're not fixing it yet), and that captured behavior becomes the baseline the refactor must reproduce. Skipping this is the single biggest cause of refactors that silently break things.

**How to apply:**
- Covered already? Run the suite, confirm green, then refactor. Green-to-green is the loop.
- Uncovered? Before touching the code, write characterization tests: feed representative inputs, capture whatever the code returns/writes *now*, and assert that. A golden-master / snapshot test is the fast path when output is large. Pin the behavior even where it looks wrong — fixing it is a separate, later hat.
- Can't get the code under test because it's too tangled to instantiate? Find a *seam* — a place to break a dependency so you can call the unit in isolation — before you refactor the logic. The deep technique (seams, cover-and-modify, golden master) is in `references/characterization-tests.md`.
- This baseline is the `/dev` refactor contract: it's why the workflow makes characterization capture step 1 when coverage is thin.

**Example:**
```
Task: untangle a 200-line `exportReport()` with zero tests.
Wrong: start extracting functions immediately → no way to know if output changed.
Right: golden-master first — run exportReport on 5 saved fixtures, snapshot the exact bytes, assert them.
       NOW extract functions one at a time, re-running the snapshot after each. Any drift = you broke something. Found instantly.
```

---

### 4. Small reversible steps, green between every one

**Rule:** Move in the smallest behavior-preserving steps the catalog offers — Extract Function, Inline, Move, Rename, Replace Conditional with Polymorphism — running the tests after each and committing per step. Refactoring is a sequence of tiny safe moves, not one big edit.

**Why:** Each named refactoring is a mechanical transformation with known, low-risk mechanics; done one at a time with a green run between, a mistake is caught the instant it's introduced, while the diff is one move wide and trivial to undo. This is the bright line between *refactoring* and *rewriting*: a rewrite throws working code away and rebuilds (re-discovering every edge case the original learned the hard way), while a refactor keeps the code working and shippable at every step. If you're estimating effort across a batch of changes, you've stopped refactoring and started rewriting — recognize it and treat it as principle 7.

**How to apply:**
- Prefer the catalog's named moves over freehand edits — they have a tested sequence of micro-steps that never goes red. See `references/catalog.md`.
- Run the test suite (or the affected subset) after each move. Commit when green. A refactor branch should be green at every commit, never "green again by Friday."
- Lean on automated refactorings (IDE/LSP rename, extract) when available — they're behavior-preserving by construction and faster than hand-editing.
- If a single step can't be made small and safe, you're missing a precursor step (often a characterization test or a seam). Add it first.

**Example:**
```
Goal: replace a 6-branch type-code switch with polymorphism.
Steps (green after each, one commit each):
  1. Extract the switch into its own method.   2. Introduce the subclass hierarchy (empty overrides).
  3. Move one branch into its subclass.  4. …repeat per branch…  5. Make the base method abstract.
Each step is reversible; if step 3 reddens the suite, you undo one tiny commit, not a day's work.
```

---

### 5. Refactor with a purpose — let smells and upcoming change drive it

**Rule:** Don't refactor for its own sake. Refactor when a *code smell* is actively costing you, or to *prepare* for a change you're about to make — "make the change easy, then make the easy change."

**Why:** Refactoring isn't free: it costs time and adds (small, but real) risk. Spent without a purpose, that's gold-plating — polishing code that didn't need it, or that's about to be deleted. The payoff is real only when the code is one you keep paying to work around. Code smells are the named symptoms that signal *which* code that is (Long Method, Feature Envy, Data Clumps, Primitive Obsession, Shotgun Surgery, Divergent Change). And the highest-leverage moment is *preparatory* refactoring: when a feature is awkward to add because of the current shape, first reshape so the feature drops in cleanly — separating the restructure (safe, tested) from the addition (new behavior) and making both easier than forcing the feature on top of an awkward design.

**How to apply:**
- Name the trigger before you start: which smell, or which upcoming change does this enable? "It felt messy" is not a trigger; "Shotgun Surgery — every new payment type edits six files" is. The smell→move map is in `references/code-smells.md`.
- Preparatory refactoring: when about to add feature X, ask "what shape would make X trivial?" Refactor to that shape first (commit), then add X (commit). Two clean diffs beat one tangled one.
- Opportunistic tidying (the Boy Scout rule) is fine *in small doses and the right hat* — a rename or an extract you pass through. Anything bigger than a "tidying" gets its own planned, committed step, not a drive-by.
- Apply the Rule of Three: duplication is cheap to tolerate twice; the third occurrence earns the extraction.

**Example:**
```
Task: add a "gift card" payment method.
Naive: bolt a 7th case onto the same six switch statements scattered across the codebase (Shotgun Surgery gets worse).
Prepared: first refactor the six scattered switches into one PaymentMethod strategy (behavior identical, suite green, commit).
          THEN add GiftCard as one new strategy class (new behavior, new test, commit). The feature became a one-file change.
```

---

### 6. Know when NOT to refactor

**Rule:** Refactoring is a tool, not a virtue. Don't do it when the payoff is absent or the risk is unmanaged: code about to be deleted, a hard deadline with no test net, or a change so large it's really a rewrite in disguise.

**Why:** The most expensive refactoring mistakes are the ones that shouldn't have started. Restructuring code you're about to delete is pure waste. Refactoring untested, tangled code under deadline pressure — with no time to build the characterization net first — is how you turn a working-but-ugly system into a broken one right before a release. And the "let's just rewrite it properly" reflex is a trap: rewrites discard hard-won correctness, take far longer than estimated, and usually produce a *new* mess plus a migration. Knowing when to leave code alone is as much a part of this skill as knowing how to change it.

**How to apply:**
- Skip it when: the code is scheduled for deletion; it's stable and rarely touched (refactor what costs you *weekly*, not what merely offends you); or you're against a deadline and the safety net doesn't exist yet — note the debt, schedule it, move on.
- Refactor vs rewrite test: if you're *estimating effort* on a batch of changes rather than making mechanical green-to-green moves, it's a rewrite. Default to incremental (principle 7) — reserve true rewrites for when the platform/language is genuinely a dead end, and even then prefer strangling the old system over a big-bang replacement.
- No tests + no time + must-change code: build the *minimum* characterization net around just the change point (find a seam), make the change, defer the broader cleanup. Don't refactor blind to save time — that trade loses.

**Example:**
```
"This module is ugly, let's rewrite it." → It's 4 years old, handles 30 edge cases encoded in 30 past bug fixes, and is touched
twice a year. A rewrite re-opens all 30. Decision: leave it. Refactor the module you touch every sprint instead.
```

---

### 7. Keep large refactorings shippable — Mikado and strangler

**Rule:** When a refactor is too big for one sitting, don't open a long-lived branch and disappear. Keep the trunk green and shippable the whole way: discover the dependency graph and work it leaf-first (Mikado), or grow the new structure alongside the old and switch over incrementally (strangler / parallel change).

**Why:** Big-bang refactors on a three-week branch are where refactoring goes to die: the branch drifts from `main`, the merge is a nightmare, and "we can't ship until it's done" blocks everyone. The alternative is to decompose the large change into a sequence of small, independently shippable, always-green steps. The Mikado Method finds that sequence safely — try the naive change, note what breaks, *revert*, and record the prerequisites as a graph; the leaves (no prerequisites) are your safe starting points, and you work back toward the goal, committing small the whole time. Strangler-fig / parallel-change does the same for replacing a subsystem: new and old coexist, traffic shifts gradually, the old is retired only once nothing depends on it.

**How to apply:**
- Mikado: attempt the goal change directly. When it breaks something, don't push through — undo it, write down the prerequisite it revealed, and recurse. Implement leaves first (each a small green commit), erasing the graph as you go. Full technique in `references/large-scale.md`.
- Replacing a component: use **branch by abstraction** (introduce a seam/interface, build the new implementation behind it, flip consumers one by one, delete the old) or **parallel change** (expand → migrate callers → contract). Never a flag-day cutover if you can avoid it.
- Stay mergeable: short-lived branches, merge to trunk daily, be able to *stop at any point* and still have shipped value. If stopping would leave the system broken, your steps are too big.
- When the refactor crosses service or process boundaries, [[architecture-fundamentals]] owns the runtime-boundary and strangler-migration decisions; this skill owns the keep-it-green mechanics.

**Example:**
```
Goal: replace the home-grown ORM with a real one across 80 call sites.
Big-bang: 3-week branch, 80 files at once, un-reviewable, blocks releases. ✗
Mikado/branch-by-abstraction: introduce a Repository seam (commit). Migrate one aggregate behind it (commit, ship). Repeat per
aggregate, trunk green and shipping the entire time. Delete the old ORM once the last caller moves. Stoppable at every step. ✓
```

---

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

Refactoring is a *process* skill, the structural-change sibling to debugging. They compose with the construction skills, they don't replace them:

- [[programming-fundamentals]] — the **destination**. This skill is the safe path; programming-fundamentals defines the shape you're moving toward (one-thing functions, illegal states unrepresentable, pure core, good names). A smell says *that* code needs work; programming-fundamentals says *what good looks like*; this skill says *how to get there green*.
- [[debug-fundamentals]] — the **other process sibling**. For a `fix`, run debug-fundamentals first to find the cause; refactoring is then often the safe way to reshape around it. Both share the "pin behavior with a test before you touch it" instinct — a regression test (debug) and a characterization test (refactor) are the same move aimed at different goals.
- [[coding-discipline]] — wraps this, as it wraps all code work (assumptions surfaced, minimum change, surgical diff, verifiable done).
- [[architecture-fundamentals]] — when the refactor crosses component/service boundaries (extract a service, strangler migration), it owns the runtime-boundary and contract decisions; this skill owns the keep-it-green mechanics underneath.
- [[git-workflow]] — the delivery channel that realizes principle 2: atomic per-step commits, refactor commits kept separate from feature/fix commits, a branch green at every commit.

**Run order when several apply:** for a refactor, run *this skill first* (pick the safe path, capture the baseline), then the construction skill that owns the target layer ([[programming-fundamentals]], and [[database-fundamentals]]/[[hexagonal-backend]] if the restructure reaches those layers). The canonical cross-skill chain lives in `.claude/rules/fundamentals.md`.

## Reference files

Deeper guides. Read the one that matches the move in front of you; you don't need them all upfront.

- `references/code-smells.md` — the smell catalog: each smell, why it hurts, and the refactoring move(s) that resolve it. Start here to decide *whether and what* to refactor.
- `references/catalog.md` — the core named refactorings (Extract/Inline Function, Move, Rename, Replace Conditional with Polymorphism, Introduce Parameter Object, Replace Temp with Query, Split Phase…) with their safe step-by-step mechanics. The *how* of principle 4.
- `references/characterization-tests.md` — Feathers' technique: seams, cover-and-modify, golden-master/approval tests, pinning legacy behavior including bugs. The safety-net deep-dive for principle 3 — and the home of the `/dev` baseline-capture contract.
- `references/large-scale.md` — Mikado Method, branch by abstraction, strangler fig, parallel change (expand-migrate-contract), keeping trunk green. The *how* of principle 7.
