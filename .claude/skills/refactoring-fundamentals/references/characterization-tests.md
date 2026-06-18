# Characterization tests — the safety net for changing untested code

This is the deep technique behind principle 3 and the home of the `/dev` **baseline-capture contract**. Drawn from Michael Feathers, *Working Effectively with Legacy Code*.

The core problem: you must change code that has no tests. You can't safely refactor without a net, and you can't write "correct" unit tests because you don't yet know what correct *is* — the code is the only spec. The resolution: stop asking "what *should* this do?" and pin "what does it *actually* do, right now?"

## What a characterization test is

> A characterization test documents the **actual** behavior of a piece of code — not its intended behavior.

You feed the code representative inputs, observe whatever it currently produces (return value, persisted rows, emitted events, even the exact exception), and write an assertion that locks *that* in. The test now fails the moment behavior changes — which is exactly the signal a refactor needs.

Crucially: **pin the behavior even where it looks wrong.** If the code has a bug, the characterization test asserts the buggy output. You are not fixing anything yet (that would be a different hat — principle 2). You're building the net. Once the net is green, *then* you can decide to fix the bug as a separate, tested behavior change.

### Writing one when you don't know the expected value
A useful trick: assert a value you *know is wrong*, run the test, and let the failure message tell you the actual output. Then paste the actual value into the assertion. You've now characterized it.

```
test("exportReport characterization", () => {
  expect(exportReport(fixtureA)).toBe("PLACEHOLDER")   // run → failure prints the real output
})
// → "Expected PLACEHOLDER, got '2024-Q1|rev=10432|...'"  → lock that in:
  expect(exportReport(fixtureA)).toBe("2024-Q1|rev=10432|...")
```

## Golden master / approval testing

When the output is large or messy (a generated file, an HTML page, a big JSON blob, a report), don't hand-write assertions field by field — snapshot the whole thing.

1. Run the code on a set of representative inputs (the more varied, the more behavior you pin).
2. Capture the full output to an approved/golden file.
3. The test re-runs the code and diffs against the golden file; any difference fails.
4. Refactor. The diff stays empty → behavior preserved. The diff shows exactly what drifted → you broke (or intentionally changed) something, visible to the byte.

This is the fastest way to throw a wide net around legacy behavior before a big restructure. Generate inputs broadly — random or combinatorial inputs often surface behavior you didn't know existed.

## Seams — getting tangled code under test at all

Often you can't even *call* the unit in isolation: it news up a database connection in its constructor, calls a global clock, hits the network. Feathers' concept:

> A **seam** is a place where you can alter behavior without editing in that place — and an **enabling point** is where you choose which behavior.

Seams are how you insert a test double to break the dependency that's stopping you from testing. Common kinds:
- **Object seam** (most useful in OO/typed code): the dependency is called through a method/interface you can override or inject. Extract the hard dependency behind a parameter or interface, pass a fake in the test. (This is a [[hexagonal-backend]] port in miniature.)
- **Preprocessing / link seam**: language-level substitution (build flags, link-time swaps, module mocking) when you can't change the call site cleanly.

Finding and exploiting a seam is itself a tiny, careful refactor — and one of the few you may have to do *without* a full net. Keep it minimal (e.g., "extract the `new Clock()` into a constructor parameter"), lean on automated/IDE moves, and change as little as possible to get the seam in.

## The cover-and-modify workflow (the legacy change algorithm)

Feathers' loop:

1. **Identify change points** — where the new behavior or restructure must happen.
2. **Find test points** — where you can observe the effects.
3. **Break dependencies** — introduce seams so the code can run under a test harness (keep these edits tiny and mechanical).
4. **Write characterization tests** — cover the current behavior around the change point.
5. **Make changes and refactor** — with a net, apply the catalog moves in small green steps.

**Cover, then modify.** The temptation is to start changing immediately; that's exactly backwards.

## How much to cover

You don't need 100% — you need the behavior *that your change could affect*. Characterize the change point and its blast radius (what reads the same state, what the same function feeds). A focused net you can build in an hour beats a comprehensive suite you never finish, and beats refactoring blind every time.

## The /dev baseline-capture contract

This technique is what the `/dev` workflow's refactor path operationalizes:
- **plan** (`lead`): when the touched behavior isn't already covered, plan step 1 is "capture characterization baseline for `<behaviour>` at `path#anchor`."
- **implement** (`engineer`): write the characterization/golden-master tests first, confirm they pass on the unchanged code, commit them *before* the structural change.
- **test** (`qa`): verify a baseline existed and the refactor still satisfies it; *no baseline + uncovered behavior = blocking gap* (the equivalence claim is unverifiable). Recorded in `tests.md > Baseline`.

The before→after diff against that baseline is the proof the refactor preserved behavior — the whole point of principle 1.

## Pointers
- The moves you apply once covered: `catalog.md`.
- Sequencing a large, multi-day cover-and-modify effort while staying shippable: `large-scale.md`.
- Where the side-effect dependency *belongs* once you've seamed it out: [[hexagonal-backend]].
