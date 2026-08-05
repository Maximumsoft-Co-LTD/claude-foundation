# Snapshot/CAS concurrency and recovery audit

Date: 2026-08-05  
Scope: `changeloop-snapshot` blob integrity, quota/GC concurrency, restore
preconditions, stale temporary files, and persisted-manifest recovery.

## Result

The snapshot store now serializes cooperating writers, garbage collection, and
restore transactions with a state-directory lock. Blob admission is bounded by
an explicit byte/file quota and is checked while that lock is held. Restore
holds the same transaction from expected-revision validation through blob
preflight, mutation, and rollback.

## Controls added

- Default CAS quota: 2 GiB and 100,000 digest files, configurable through
  `SnapshotManager::new_with_limits`.
- Atomic quota accounting across managers that share a state directory.
- Content-addressed reuse verifies the existing blob before accepting it.
- Blob opens reject symlinks and non-regular files; copied content is hashed
  again at restore time.
- Owned crash leftovers use a recognizable temporary-file prefix and are
  removed while the transaction lock is held.
- GC ignores non-digest state files and cannot race a cooperating capture or
  restore.
- Restore repeats the expected-state check at the mutation boundary. Creation
  into an expected-missing path uses atomic no-replace on supported release
  targets (macOS and Linux).
- Persisted manifests reject unknown fields, unsafe/non-canonical or oversized
  paths, invalid hashes, duplicate checkpoint IDs/paths, inconsistent
  timestamps, dangling/duplicate redo entries, and invalid proof/audit IDs.
- An oversized failed save leaves the previous atomic manifest readable.

## Adversarial evidence

- Two concurrent managers racing a one-file/four-byte quota admit exactly one
  distinct blob.
- Reusing the same digest succeeds when the store is at its file quota.
- Corrupt and symlinked pre-existing digest entries fail closed.
- Stale owned temporary files are recovered on manager initialization.
- Unknown fields, parent traversal, invalid hashes, and dangling redo IDs are
  rejected on load.
- A file created after an expected-missing preflight is preserved and reported
  as an external modification.
- A failed oversized replacement preserves the last durable manifest.

Verification:

```text
cargo test -p changeloop-snapshot
21 passed; 0 failed

cargo clippy -p changeloop-snapshot --all-targets --no-deps -- -D warnings
clean
```

## Residual risk

- Exact compare-and-swap replacement/deletion of an existing file is not a
  portable filesystem primitive. The transaction lock closes races among
  Changeloop processes and the boundary recheck narrows external races, but an
  uncooperative process can still mutate an existing destination in the final
  operating-system call window. A future target-specific swap/quarantine
  protocol should close this for macOS/Linux.
- The fallback for Unix platforms other than macOS/Linux cannot promise atomic
  no-replace. Those platforms are outside the initial release matrix.
- Managers sharing a blob directory are expected to share the authoritative
  checkpoint manifest/app-server lease. The CAS lock prevents corrupt writes,
  but it cannot merge independent in-memory checkpoint histories.
