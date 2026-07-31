# Test plan: Extract the pricing engine

## Coverage plan

| AC | Level | Asserts |
|----|-------|---------|
| AC1 | unit | golden master over eight fixtures matches the captured baseline |

## Baseline contract

Golden master over the eight order fixtures. How compared: exact string match on the serialized price breakdown. Captured before any extraction; it must hold, unchanged, after.

## Edge cases

- A fixture with a split discount is included so the pinned rounding quirk is captured, not hidden.
