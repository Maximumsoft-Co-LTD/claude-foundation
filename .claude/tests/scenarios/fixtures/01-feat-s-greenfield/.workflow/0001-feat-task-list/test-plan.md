# Test plan: Task list app

## Coverage plan

| AC | Level | Asserts |
|----|-------|---------|
| AC1 | unit | adding an item appends an open row |
| AC2 | integration | toggling persists the completed state across a reload |

## Edge cases

- An empty title is rejected.
- Duplicate titles are allowed and listed separately.

## Fixtures / env

- A seeded localStorage with two items for the reload assertion.

## Coverage targets

- Statement coverage on `src/store.js` at or above the project floor.
