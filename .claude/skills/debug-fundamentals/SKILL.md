---
name: debug-fundamentals
description: "Use when workType is bugfix and the cause is unknown: reproduce, localize, fix, prove. Skip obvious corrections, new features, and slowness (use performance-investigation)."
---

# Debug fundamentals

Demonstrate the cause before fixing it; a symptom patch is not a fix.

## Steps

1. Define expected versus actual behavior, environment, evidence, and a
   checkable definition of fixed.
2. Reproduce with the smallest reliable trigger. For a flake, raise the factor
   that raises its rate; for production-only failures, preserve identifiers and
   inspect safely first.
3. Localize: read the whole error/trace/log, separate facts from assumptions,
   find the first boundary where correct data becomes wrong. Bisect code,
   input, configuration, or time when the space is large.
4. Test one hypothesis at a time: write the prediction, change or instrument
   one thing, quote the predicted failure content. After two failed fixes on
   the same gate, stop and write a falsifying experiment.
5. Fix the violated invariant at its owning layer. Do not bundle cleanup;
   report instances outside the change as follow-up.
6. Prove: add a regression test that fails without the fix and passes with it,
   confirm reverting restores the failure, remove temporary logs and flags, then
   report root cause, fix, blast radius, and remaining risk.

## Harness

Proof is tied to the exact Build workspace through harness receipts; the
harness owns task status and Build never stages or commits. The owning
construction skill decides the fix shape.

## References

- `references/reproduction.md` — flaky and production-only failures.
- `references/root-cause.md` — two-failed-fixes stop rule, guard legitimacy.
- `references/bisection.md` — narrowing by commit, code, input, or flag.
- `references/tools.md` — lightest diagnostic tool that answers; multi-hop
  incident shapes.
