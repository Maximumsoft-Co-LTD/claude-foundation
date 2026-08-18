# Design

## Current state

`sandbox-runtime.mjs:rebaseWorktree` stages and swaps one root worktree. It
returns early when `state.repositories` has more than one entry, even though
each writable repository record already carries the same inputs: sandbox path,
target path, and recorded base. `repository-snapshot.mjs` composes otherwise
content-derived repository hashes together with `baseHead`, so changing only a
commit identity changes both `workspaceHash` and `codeHash`.

## Decisions

- **Decision:** Build one replay descriptor per moved writable worktree and
  prepare every binary replay in a temporary worktree before replacing any live
  sandbox. On conflict, clean every prepared artifact and leave all live
  sandboxes and recorded bases unchanged.
  - **Why:** Sequentially rebasing repositories can leave a half-rebased change
    when a later repository conflicts. Staging the whole set makes the expected
    failure path conflict-atomic while keeping Git sequencing inside one deep
    sandbox-runtime operation.
  - **Rejected:** Abandon/reopen, because it discards valid work and review;
    sequential replay, because it exposes partial progress on ordinary
    conflicts.
- **Decision:** Compose `workspaceHash` and `codeHash` from sorted repository
  IDs and content hashes only; retain `baseHead` as diagnostic/Land state.
  - **Why:** The snapshot already hashes every tracked byte and contract
    revision. Existing `control-head-moved` guards separately compare target
    heads before Land, so commit identity is redundant evidence input that only
    creates false staleness.
  - **Rejected:** A review-only third hash, because executable evidence and the
    final proof suffer the same false invalidation and would retain three
    overlapping identities.

## Compatibility and migration

Single-repository output remains compatible. Multi-repository sync adds one
repository-qualified replay line per moved repository. Existing runtime state
needs no migration. Provider and proof protocol pins bump because recorded
workspace identity semantics change; rollback forces one honest re-prove.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A conflict in repository N mutates repositories 1..N-1 | Prepare every replay before swapping any live worktree; regression asserts all original sandboxes and bases survive | test |
| Removing `baseHead` weakens Land safety | Keep and regression-test the explicit current-head vs recorded-base Land guard | test |
| Existing receipts appear mysteriously stale | Bump provider/proof protocol pins so recovery reports version staleness | compatibility |
