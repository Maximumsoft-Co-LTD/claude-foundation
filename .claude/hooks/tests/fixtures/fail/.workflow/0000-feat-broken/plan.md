# Plan: Broken fixture

**Spec**: [./spec.md](./spec.md) · **Type**: feat · **Size**: XS · **Status**: draft

## Outcome
- **Before:** no plan fixture for the fail case.
- **After:** a valid plan so the fail verdict is attributable to spec.md, not this file.
- **Benefit:** keeps the fail fixture's failure cause unambiguous.

## Approach
This plan is intentionally valid; spec.md carries the injected failures.

## Architecture diagram
```mermaid
flowchart LR
  A[input] --> B[linter] --> C[exit non-zero]
```

## Steps
1. Provide a valid plan — `plan.md` (new) — verify: this file passes the linter's plan checks [AC1]
