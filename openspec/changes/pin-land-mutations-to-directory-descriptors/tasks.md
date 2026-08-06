# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [x] **T001** [claims:a-symlinked-parent-component-is-rejected,an-absent-leaf-reports-missing] `PinnedEntry`: resolve a relative path into a held parent
  directory descriptor, opening every component `O_DIRECTORY | O_NOFOLLOW` and
  creating missing parents with `mkdirat` —
  `crates/changeloop-land/src/pinned.rs` — verify:
  `cargo test -p changeloop-land pinned_entry`
- [x] **T002** [claims:a-symlinked-leaf-is-neither-read-nor-replaced,an-absent-leaf-reports-missing] Identity, remove, and replace performed through the pinned
  descriptor with `openat`, `fstatat`, `unlinkat`, and same-directory
  `renameat` — `crates/changeloop-land/src/pinned.rs` — verify:
  `cargo test -p changeloop-land pinned_entry`
- [x] **T003** [claims:a-re-pointed-parent-name-does-not-redirect-the-write] `apply_entries` stages inside the destination directory and
  publishes with a same-directory rename instead of a cross-directory one —
  `crates/changeloop-land/src/lib.rs` — verify: `cargo test -p changeloop-land`
- [x] **T004** [claims:rollback-restores-through-the-same-descriptor] `rollback` restores through the same pinned descriptor —
  `crates/changeloop-land/src/lib.rs` — verify: `cargo test -p changeloop-land`
- [x] **T005** [claims:a-re-pointed-parent-name-does-not-redirect-the-write,a-symlinked-parent-component-is-rejected,a-symlinked-leaf-is-neither-read-nor-replaced] Adversarial regressions: the parent name is swapped for a
  symlink after resolution and the write still lands in the checked directory;
  symlinked component and symlinked leaf are refused —
  `crates/changeloop-land/src/lib.rs` — verify: `cargo test --workspace`
- [x] **T006** [claims:an-absent-leaf-reports-missing] Non-Unix keeps the previous path-based behaviour and says so —
  `crates/changeloop-land/src/pinned.rs` — verify: `cargo clippy --workspace`
