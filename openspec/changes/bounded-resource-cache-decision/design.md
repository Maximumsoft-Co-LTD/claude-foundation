# Design

## Current state

`ManagedProject::open` registers seven owned resource names, including
`(ResourceKind::Cache, "provider-tool-cache")`. No code path attaches a
[`BoundedResourceCache`] to that registration or uses the name elsewhere.
[`BoundedResourceCache`] is tested in `changeloop-project` but not integrated
into app-server runtime wiring.

## Decisions

- **Decision:** unregister the placeholder `ResourceKind::Cache` slot at project
  open.
  - **Why:** Honest disposal reporting — only register resources something
    actually owns. No obvious existing hot path needs the cache today.
  - **Rejected:** inventing a speculative provider-tool cache to consume the slot;
    that would add complexity without a proven eviction need.

- **Decision:** keep [`BoundedResourceCache`] and `ResourceKind::Cache` in
  `changeloop-project`.
  - **Why:** The type and kind are the intended integration surface when a real
    owner appears; removing them would foreclose the next wiring step.
  - **Rejected:** deleting the cache type because the registration was premature.

## Compatibility and migration

No persisted state references `"provider-tool-cache"`. Open projects lose one
unused registration row; disposal behaviour is unchanged because nothing was
disposed through that slot.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A future cache owner forgets to register | Document in design that `ResourceKind::Cache` registers with the cache instance, not at bare project open | change packet |
| Tests still assume seven baseline resources | Update `resource_count` assertions in app-server tests | test |
