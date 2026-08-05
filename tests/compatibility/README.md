# Repository compatibility matrix

Run the matrix against the built CLI:

```sh
cargo build -p changeloop-cli
tests/compatibility/repository-matrix.sh target/debug/cloop
```

Every case emits exactly one typed result:

- `PASS` means the asserted behavior and safety checks executed successfully.
- `SKIP reason=<typed_reason>` means the host or current public surface cannot
  execute the case. Skips are counted separately and never added to passes.
- `FAIL reason=<typed_reason>` terminates the matrix with a non-zero status.

The matrix exercises clean/dirty/non-Git repositories, symlink rejection,
rename/delete Land, nested repositories, monorepos, sparse checkouts, local
submodules, LFS pointers without network, optional local Git LFS validation,
case/path collisions, large and binary files, read-only and simulated full-disk
failures, external-edit conflicts, and isolation between independent repositories.
It explicitly reports missing multi-repository declaration and public snapshot
fixture surfaces rather than presenting those gaps as passes.

## Hermetic lifecycle sample

Run the reusable end-to-end lifecycle sample against a debug build:

```sh
cargo build -p changeloop-cli
sh tests/compatibility/hermetic-lifecycle-e2e.sh target/debug/cloop
```

The script creates and removes its own temporary Git repository and config
directory. A debug-only deterministic fixture backend exercises read-only
conversation, draft confirmation, the contract gate, automatic low-risk proof,
risk-triggered review, undo/redo proof invalidation, rejected stale Land, and
explicit successful Land. It never uses network access or a real credential.
