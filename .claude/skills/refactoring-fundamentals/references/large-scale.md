# Large-scale refactoring — staying shippable

The deep technique behind principle 7. The failure mode — a long-lived branch that drifts from trunk and blocks releases — is common and costly. Everything here has the same goal: **decompose the large change into small, independently shippable, always-green steps**, keeping `main` releasable throughout.

The enemy: "rewrite this subsystem on a branch, merge when done." It drifts, the merge is a multi-day conflict, and "we can't ship until it lands" holds the team hostage.

---

## The Mikado Method

A disciplined way to discover the *order* of a large change without breaking things — named for the pick-up-sticks game where you remove a stick only when nothing rests on it.

**The loop:**
1. **Set the goal** — the end state, written down.
2. **Try the naive change** — just make the goal change directly.
3. **See what breaks** — compilation errors, red tests, broken callers. Each break is a *prerequisite*.
4. **Revert** — undo your change completely. This is the counter-intuitive, essential step: you go back to green, keeping the knowledge (the prerequisites) but not the broken code.
5. **Record prerequisites** as nodes in a dependency graph (the goal at the top, prerequisites below).
6. **Recurse** on each prerequisite — pick one, try it, and if *it* breaks things, revert and record *its* prerequisites beneath it.
7. **Leaves first** — a leaf has no prerequisites, so it's safe to do now. Implement it as a small green commit, check it off, and walk back up the graph.

**Why the revert matters:** at every moment your working tree is either green or being actively explored-then-reverted. You never accumulate a pile of half-done broken changes. You can stop any day with everything committed green and the graph as your map of what's left.

Use short-lived branches and merge to trunk daily. Each leaf you implement is shippable.

---

## Branch by Abstraction

For replacing one implementation with another (a library, a data layer, a module) *in place*, without a long branch and without a flag day.

1. **Introduce an abstraction** (a seam/interface) over the thing you're replacing. Route existing callers through it. Ship. Behavior identical.
2. **Build the new implementation** behind the same abstraction, alongside the old. Ship (it's not wired up yet, or it's behind a flag).
3. **Migrate callers** one at a time to the new implementation — or flip them together once it's proven. Each migration is small and shippable.
4. **Delete the old implementation** and (optionally) the abstraction once nothing uses it.

The abstraction is the safety mechanism: at every step both old and new are reachable and trunk is green. This is the in-codebase cousin of the strangler fig.

---

## Strangler Fig

For replacing a whole system or large subsystem incrementally (named for the vine that grows around a tree and gradually replaces it). The new system grows around the old; functionality is migrated piece by piece; the old is retired only when nothing routes to it.

- Put a routing/facade layer in front of the old system.
- Build each new capability in the new system; switch that route over; leave the rest on the old.
- Migrate route by route until the old system is dead, then remove it.

When this crosses service/process boundaries, [[architecture-fundamentals]] owns the runtime-boundary, routing, and data-migration decisions; this reference is the keep-it-green *mechanics* underneath.

---

## Parallel Change (expand → migrate → contract)

The general pattern for evolving a contract (a function signature, an API, a schema) without a breaking flag-day. Especially important for anything with external or cross-team callers.

1. **Expand** — add the new form *alongside* the old (new parameter with a default, new field, new endpoint). Both work. Ship.
2. **Migrate** — move callers from old to new, incrementally. Ship between batches.
3. **Contract** — once no caller uses the old form, remove it. Ship.

Each phase is independently deployable and reversible. This is how you change a database column, an API response shape, or a public function signature without coordinating a single synchronized cutover. (For DB specifics — expand/contract migrations, backfills, dual-writes — see [[database-fundamentals]].)

---

## Keeping trunk green: the supporting practices

- **Short-lived branches, merge daily.** The longer a refactor branch lives, the more it drifts. If a change can't be broken into day-sized green commits, decompose it further (Mikado will show you how).
- **Feature flags** decouple "merged" from "active" — you can land new structure dark and switch it on later, keeping integration continuous.
- **Stop-anytime invariant.** After every commit, the system ships and works. If stopping mid-refactor would leave it broken, your steps are too big — that's the signal to add a precursor (often a seam or a characterization test).
- **Separate the hats at scale too** (principle 2): a large refactor and the feature it enables are still distinct streams of commits, even across weeks.

---

## When the "large refactor" is actually a rewrite

If you cannot find a sequence of small green steps — if every path forward requires a long red period — that's a strong signal this is a *rewrite*, not a refactor (principle 6). Rewrites are sometimes justified (a dead-end platform/language), but they carry the full risk of re-discovering every edge case the old system learned. Even then, prefer **strangler over big-bang**: grow the replacement incrementally rather than switching off the lights and rebuilding in the dark.

## Pointers
- The seams/abstractions these techniques lean on: `characterization-tests.md`.
- Per-step mechanics: `catalog.md`.
- Cross-service boundaries and data migration: [[architecture-fundamentals]], [[database-fundamentals]].
