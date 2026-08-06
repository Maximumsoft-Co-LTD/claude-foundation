# Change: pin Land mutations to directory descriptors

## Why

`apply_entries` and `rollback` in `changeloop-land` resolve every path by name,
repeatedly: `scoped_path` walks the components checking for symlinks, `identity`
opens by path, `create_dir_all` creates by path, `remove_regular_if_exists`
stats and unlinks by path, and `fs::rename` renames by path. Each of those is a
fresh resolution of the same name, so a same-user process can replace a parent
directory between two of them and redirect the write that Land already decided
was safe. `changeloop-snapshot` closed exactly this window on its restore path
with pinned directory descriptors; Land — the one operation that writes the
operator's real working tree under an explicit authority grant — did not.

## What changes

- Land resolves each entry's parent directory once, into a directory descriptor
  opened with `O_DIRECTORY | O_NOFOLLOW`, and performs every subsequent check
  and mutation for that entry through that descriptor with `openat`, `mkdirat`,
  `fstatat`, `unlinkat` and `renameat`. Replacing a parent by name after the
  descriptor is held no longer affects where the write lands.
- The staged replacement is written into the destination directory itself rather
  than a separate transaction staging directory, so the rename that publishes it
  is same-directory and same-filesystem.
- Rollback restores through the same pinned descriptor.
- On non-Unix targets the previous path-based implementation remains, and says
  so; Windows is already planner-only for the sandbox.

## Impact

- **Impact:** high
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** filesystem trust boundary; time-of-check to time-of-use
  on a privileged write path

## Non-goals

- The prepared/applying/committed crash journal for undo/redo and snapshot
  cleanup. That is a durability gap, not a TOCTOU one, and has its own change.
- Changing which entries Land is willing to apply, the authority grant it
  requires, or its revision checks.
