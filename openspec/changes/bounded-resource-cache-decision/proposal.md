# Change: bounded resource cache decision

## Why

`ManagedProject::open` registers `ResourceKind::Cache` as `"provider-tool-cache"`, but
nothing constructs a [`BoundedResourceCache`] or registers it against that slot.
The name-only registration implies disposal coverage the runtime does not have and
inflates baseline resource counts in tests.

## What changes

- Remove the placeholder `ResourceKind::Cache` registration from project open.
- Keep [`BoundedResourceCache`] in `changeloop-project` for future wiring; register
  `ResourceKind::Cache` only when a real cache owner exists.
- Update app-server tests that assert the pre-open resource count.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none (disposal honesty only)

## Non-goals

- Wiring a provider-tool cache without an obvious hot path.
- Removing or redesigning [`BoundedResourceCache`] itself.
