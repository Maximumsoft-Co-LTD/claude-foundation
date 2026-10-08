---
name: debug-fundamentals
description: "Reproduce and localize unknown-cause bugs, crashes, regressions, and flakes before fixing the owning invariant. Prove failing-before and passing-after behavior through project evidence. Use performance-investigation for measured slowness; skip obvious corrections and greenfield work."
---

# Debug fundamentals

Quote predicted failure content, not only assertions or exit codes. Repeated
failed fixes sharing an assumption require a falsifying experiment.

Use this before the construction skill that owns the eventual fix.

## Loop

1. **Define:** state expected versus actual behavior, affected environment and
   version, evidence, and a checkable definition of fixed.
2. **Reproduce:** create the smallest reliable trigger. For a flake, increase
   the factor that raises its rate; for production-only failures, preserve
   identifiers and inspect safely before attempting a local analogue.
3. **Localize:** read the complete error/trace/log, separate facts from
   assumptions, and find the first boundary where correct data becomes wrong.
4. **Test a hypothesis:** write one prediction, change or instrument one thing,
   and bisect code, input, configuration, or time when the search space is large.
5. **Fix the source:** repair the violated invariant at its owning layer. Avoid
   symptom suppression or unrelated cleanup.
6. **Prove:** add a regression test that fails without the fix and passes with
   it, then run the surrounding project-owned evidence.
7. **Report:** name the root assumption, source layer, fix, regression proof,
   blast radius, and any remaining risk.

If evidence disproves the hypothesis, return to reproduction; do not stack
speculative fixes.

## Check before finishing

- Is the cause demonstrated rather than inferred from the symptom?
- Does reverting the fix restore the failure?
- Does the test pin public behavior or an invariant rather than implementation?
- Were temporary logs, flags, and scaffolding removed?
- Is proof tied to the exact changed workspace through the harness?

References: read `reproduction.md` for flaky/prod-only failures;
`bisection.md` for narrowing; `instrumentation.md` for the lightest diagnostic
tool; and `distributed-debugging.md` for multi-hop incidents.
