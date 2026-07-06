---
name: debug-fundamentals
description: Apply debugging fundamentals as a six-phase loop — refine the ticket, reproduce, plan the fix, fix the right layer one change at a time, pin with a regression test, report the root cause. Use BEFORE guessing at fixes for any unknown-cause failure — bug, crash, regression, flaky test, perf cliff, or unexpected production behavior, in any stack. The trigger is any "fix this / why is X happening / this used to work" investigation, even when the user doesn't say "debug". Skip one-line typo fixes with the cause already on screen, and greenfield work where nothing is broken.
---

# Debug Fundamentals

Days get eaten when you change five things at once, silence a symptom with a try/catch, or fix the layer where the bug *surfaced* instead of where it *started*. Find the cause before you change code — the loop below runs the seven principles from ticket to close-out.

## Workflow

| Phase | Do | Principles |
|---|---|---|
| **1. Refine** | Sharp problem statement before touching code: expected vs actual, env/version/timestamp, artifacts (error, logs, request id, screenshot), what "fixed" means. A vague ticket debugged as-is wastes the repro. | feeds P1–2 |
| **2. Reproduce** | Smallest, most reliable trigger; then read the full evidence it produces. | P1, P2 |
| **3. Plan** | Facts vs assumptions, bisect to the cause, find the layer where data *first* turns wrong, decide fix + blast radius. | P3, P4, P6 |
| **4. Fix** | One change at a time, at the source layer, prediction written first. | P5, P6 |
| **5. Test** | Regression test red without the fix, green with it; then the surrounding suite. | P7 |
| **6. Report** | Root cause = the wrong assumption that let the bug exist; + layer, fix, test, blast radius (what else read the same bad data), follow-ups. Update the ticket. | P7 |

Iterate, don't march: if phase 3 disproves the theory or phase 5 stays red, drop back to phase 2 with what you learned.

## The 7 principles

1. **Reproduce before you diagnose** — smallest reliable trigger; a fix you can't reproduce is a guess. Flaky? Turn up the knob that raises the rate (concurrency, cold cache, a specific row) until it's reliable.
2. **Read what the system said** — full error, stack trace, log, *before* theorizing. The cause is usually frames down in your code, not the top frame; note timestamp / request-id / version.
3. **Separate facts from assumptions** — for each load-bearing belief ask *how do I know?*; verify the cheap ones with one print. Suspect "should / must be / can't be," and data shape / nullability / ordering.
4. **Bisect the search space** — halve it each step: `git bisect`, midpoint logging, half the failing payload, flags in pairs. O(log n), not O(n).
5. **Change one thing at a time** — one hypothesis, one change, one written prediction. Put the bug back to prove the fix causes the cure; strip all scaffolding after.
6. **Fix the right layer** — trace symptom → source, fix where data *first* turns wrong, not where it surfaced. Most cross-layer bugs live in boundary translations: units, timezones, encoding, coercion.
7. **Fix the cause + regression test** — a test red without the fix and green with it, committed together. Prefer encoding the invariant in types/schema ([[programming-fundamentals]] P2) over a runtime check.

## Skip when

One-line typo with the cause on screen; greenfield (nothing broken yet — use [[programming-fundamentals]]); obvious reversible config edits. Anything else — even "I think I see it," even "just a quick fix" — applies.

## Run order & references

Load *this first* to find the cause, then the construction skill that owns the fix layer, then pin it ([[testing-fundamentals]] owns test design). Most bugs violate [[programming-fundamentals]] — the fix is usually "make illegal states unrepresentable." Full run order: `.claude/rules/fundamentals.md`.

Deeper technique, load on demand:
- `references/reproduction.md` — reliable + minimal repros, flaky failures, prod-only bugs.
- `references/bisection.md` — `git bisect`, binary search over code paths, inputs, configs, deps.
- `references/instrumentation.md` — strategic logging, tracing, `strace`/`dtrace`/eBPF.
- `references/distributed-debugging.md` — correlation IDs, traces, races, retries, time-skew.
