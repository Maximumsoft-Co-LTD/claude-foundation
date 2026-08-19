# Change: Let sandbox sync validate refreshed root inputs

## Why

`sandbox sync` validates the root change packet before it rebases or refreshes an existing sandbox. The packet directory comes from the root, but repository selection and grounding read-set paths still resolve through the active sandbox workspace. After another change lands, a correctly refreshed grounding digest therefore mismatches the stale sandbox and blocks the very sync operation that would update it.

The desired outcome is that root-source validation reads root repository inputs and root repository selection, while active-source validation continues to read the isolated workspace.

## What changes

- Make validation select repository paths from the same source tree as the packet being validated.
- Let `sandbox sync` validate a refreshed root packet before replaying target movement into the sandbox.
- Preserve active sandbox, multi-repository, topology, and conflict semantics with focused regression coverage.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** sandbox synchronization, change validation, repository topology, target-drift tests
- **Security triggers:** none

## Non-goals

- Cleaning orphan runtime state.
- Weakening grounding digest validation or accepting a mismatched read set.
- Automatically resolving target/sandbox content conflicts.
- Changing Land projection or proof freshness rules.
