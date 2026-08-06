# Design

## Current state

`apply_entries` resolves one entry's destination through `scoped_path`, then
calls `identity`, `create_dir_all`, `remove_regular_if_exists` and `fs::rename`
— four further resolutions of the same name. `rollback` repeats the pattern.
`scoped_path` does check each component for a symlink, but that check is a
separate resolution from the write that follows it, which is what makes it a
time-of-check to time-of-use gap rather than a defence.

`copy_regular` already carries a partial mitigation (`ParentIdentity::capture`
then `verify`), which narrows the window but does not remove it: the verify is
still a name lookup, and the rename after it is another.

`changeloop-snapshot` restores through pinned descriptors already, but its
helpers are private methods on `SnapshotManager`, bound to its worktree
descriptor and its error type.

## Decisions

- **Decision:** a `PinnedEntry` in `changeloop-land` that holds the parent
  directory open and exposes exactly the four operations Land performs on it:
  identity, remove-if-regular, replace, and display-for-errors.
  - **Why:** Land needs a small, auditable surface, and the operations differ
    from snapshot's (Land replaces from a sandbox file and restores from a
    backup file; snapshot restores from a content-addressed blob). Reusing
    snapshot's private internals would mean widening its API to shapes it does
    not otherwise need.
  - **Rejected:** exporting snapshot's helpers; a new shared filesystem crate
    for two callers.

- **Decision:** the staged replacement is written *inside the destination
  directory* through the pinned descriptor, not into the transaction's `stage/`
  directory and then renamed across.
  - **Why:** a cross-directory rename resolves the destination parent by name
    again, which is the exact window being closed. Same-directory `renameat`
    through one held descriptor has no second resolution.
  - **Rejected:** keeping `stage/` and renaming across; it would leave the gap
    open at the last step.

- **Decision:** `O_NOFOLLOW` on every component and on the leaf, with `ELOOP`
  and `ENOTDIR` mapped to `UnsupportedPath`.
  - **Why:** a symlink in the path is refused rather than traversed, which is
    the behaviour `scoped_path` intended; doing it in the same call that opens
    the descriptor is what makes it hold.

- **Decision:** non-Unix keeps the previous path-based implementation, and the
  module says so.
  - **Why:** the `*at` family is what makes pinning possible. Windows is already
    planner-only for the sandbox, so this does not narrow a supported platform.
  - **Rejected:** a portable "best-effort" pin, which would claim a guarantee it
    does not have.

## Compatibility and migration

No public API changes; `PinnedEntry` is crate-private. The on-disk journal
format is unchanged, so an interrupted transaction prepared before this change
still recovers. The transaction `stage/` directory is no longer written; nothing
reads it back, and `backup/` — which rollback does read — is untouched.

File mode on a replaced file is now taken from the projected identity's
`executable` flag (0o755 or 0o644) rather than copied from the sandbox file's
mode. The projection is what Land verifies against afterwards, so this is the
mode the entry actually declares.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| The descriptor is not actually pinned | A test swaps the parent's name for a symlink after resolution and asserts the write landed in the original directory | test |
| A symlinked component is traversed | Resolution opens every component `O_NOFOLLOW` and a planted symlink is refused | test |
| A symlinked leaf is read or replaced | Identity and remove both refuse a non-regular leaf; the target outside is asserted unchanged | test |
| Unsafe FFI misuse | Every `unsafe` block is a single libc call with a borrowed descriptor and a NUL-terminated name, each with a SAFETY note; descriptors are adopted by `File` immediately | test |
| Rollback regressions | The existing Land transaction, interruption, and rollback tests run unchanged against the new implementation | test |
