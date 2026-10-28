---
name: programming-fundamentals
description: "Use for nontrivial local logic: types, state, data structures, error paths, module boundaries inside one process. Skip trivial or generated code and cross-runtime design."
---

# Programming fundamentals

Model the data first; make illegal states unrepresentable; keep decisions pure
and effects at the edge.

## Steps

1. Model inputs, outputs, and state transitions before operations. Prefer the
   most constrained useful type; brand primitives only where needed.
2. Make illegal states unrepresentable with enums, variants, wrappers, and
   validated constructors; enforce each invariant once, at the boundary.
3. Design deep, cohesive modules: a small interface hiding meaningful
   complexity. One reason to change per function; extract policy, not line
   counts or pass-through layers.
4. Keep decision logic pure; isolate I/O, clocks, randomness, network, and
   storage at the edge so the core runs without infrastructure.
5. Represent expected failure explicitly: add context at boundaries, never
   swallow or double-log, keep error and cancellation paths tested.
6. Choose data structures from expected scale; measure before optimizing. Name
   by domain meaning and effect.

## Harness

Record only durable behavior or module-boundary decisions in OpenSpec; keep
implementation detail in code and tests, proven by project providers through the
harness. No parallel design or completion ledger; Build never stages or commits.

## References

- `references/module-design.md` — module boundaries, abstraction depth, cohesion, skip signals
- `references/details.md` — data modeling and the pure core / effectful shell
- `references/error-handling.md` — the three error buckets and where to handle each
- `references/complexity.md` — accidentally quadratic patterns, when to optimize
- `references/naming.md` — naming by meaning and effect
- `../testing-fundamentals/references/test-design.md` — what to test and how
