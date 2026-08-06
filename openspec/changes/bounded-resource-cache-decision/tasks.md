# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [ ] **T001** [claims:no-placeholder-cache-registration-at-project-open] Remove
  `(ResourceKind::Cache, "provider-tool-cache")` from `ManagedProject::open` —
  `crates/changeloop-app-server/src/executable.rs` — verify:
  `rg 'provider-tool-cache' crates/changeloop-app-server` returns no matches
- [ ] **T002** [claims:baseline-resource-count-excludes-unused-cache] Update
  app-server tests that assert the pre-open owned-resource count —
  `crates/changeloop-app-server/src/executable.rs` — verify:
  `cargo test -p changeloop-app-server resource_count`
- [ ] **T003** [claims:bounded-resource-cache-still-tested-in-project-crate]
  Confirm [`BoundedResourceCache`] unit tests remain green —
  `crates/changeloop-project/src/disposal/tests.rs` — verify:
  `cargo test -p changeloop-project disposal`
