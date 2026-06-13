# Plan: Sample passing fixture

**Spec**: [./spec.md](./spec.md) · **Type**: feat · **Size**: XS · **Status**: approved

## Outcome
- **Before:** no clean plan fixture exists.
- **After:** this plan has a mermaid diagram, an AC tag, and a verify clause, so it lints clean.
- **Benefit:** proves the linter's plan checks pass on a complete plan.

## Approach
Hand-write a minimal complete plan that satisfies every required-section check.

## Architecture diagram
```mermaid
flowchart LR
  A[input] --> B[linter] --> C[exit 0]
```

## Steps
1. Provide a complete plan — `plan.md` (new) — verify: the linter exits 0 on this directory [AC1]
