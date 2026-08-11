# Change: prevent avoidable proof failures with comprehensive preflight diagnostics

## Why

An OpenSpec delta for a capability that does not yet exist can declare
`MODIFIED Requirements`, pass Foundation validation, and fail only during
archive after implementation and proof have already been completed. Foundation
must reject that invalid delta while the change contract is still cheap to
correct.

## What changes

- Validate every standard change's spec deltas against the current canonical
  capability set.
- Refuse a new capability whose delta contains `MODIFIED` or `REMOVED`
  requirements, and name the required `ADDED Requirements` form.
- Cover both the invalid and valid new-capability paths at the deterministic
  runtime boundary.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** change validation and deterministic harness tests
- **Security triggers:** none

## Non-goals

- Changing OpenSpec archive semantics.
- Redesigning provider execution, proof hashing, or Land transactions.
- Adding delegation policy or cost estimation.
