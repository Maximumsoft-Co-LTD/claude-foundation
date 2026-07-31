---
name: programming-fundamentals
description: Apply code-level fundamentals before changing non-trivial logic, models, modules, or data structures. Covers constrained data modeling, illegal-state elimination, focused functions, pure core/effectful shell, explicit errors, complexity, naming, and testability. Skip one-line shell, generated output, and pure configuration.
---

# Programming fundamentals

Use this as the primary skill for code whose main difficulty is local logic.
Load a reference only for the decision in front of you.

## Rules

1. Model inputs, outputs, and state transitions before operations. Prefer the
   most constrained useful type.
2. Make illegal states unrepresentable with enums, variants, wrappers, and
   validated constructors.
3. Give each function one reason to change. Extract policy, not arbitrary line
   counts.
4. Keep decisions pure where practical; isolate I/O, clocks, randomness,
   network, and storage at the edge.
5. Represent expected failure explicitly. Add context at boundaries; never
   swallow or double-log.
6. Choose data structures and algorithms from expected scale. Measure before
   optimizing.
7. Name by domain meaning and effect. Avoid generic containers and misleading
   boolean flags.

## Check before finishing

- Are invariants enforced once at construction or the boundary?
- Can the decision logic run without infrastructure?
- Are error and cancellation paths observable and tested?
- Are tests aimed at behavior, boundaries, and failure rather than internals?
- Is the simplest correct complexity acceptable for the expected input?

Skip for trivial/generated work with no decision or invariant.

References: `references/details.md`, `error-handling.md`, `complexity.md`,
`naming.md`, and `testing.md`. Read only the matching file.
