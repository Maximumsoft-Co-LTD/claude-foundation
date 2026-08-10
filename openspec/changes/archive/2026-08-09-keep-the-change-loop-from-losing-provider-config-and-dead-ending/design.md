# Design

## Current state

- `activeChangePath` (`runtime/core/state-runtime.mjs:37`) resolves to the
  sandbox's copy of the change whenever a sandbox is active. That is right for
  reading a Build packet and wrong for writing durable contract artifacts.
- `initializeEvidence` (`runtime/workflow/change-validation.mjs:401`) writes
  `execution.yaml` through `activeChangePath`.
- `sync` (`runtime/workflow/sandbox-runtime.mjs:308`) is one-way source →
  sandbox: it `rmSync`es the destination, `cpSync`es the source over it, and
  merges back only `tasks.md` via `mergeTaskProgress`.
- `createSingle` (`runtime/workflow/sandbox-runtime.mjs:182`) falls back to a
  full-tree copy when any dirty path is not this change's own draft,
  `.foundation/`, or `openspec/changes/archive/`.
- Other changes' drafts are already outside both the workspace hash
  (`state-runtime.mjs:230`) and the apply projection
  (`apply-runtime.mjs:49`).

## Decisions

- **Decision:** `evidence init --write` writes to `changePath(id)` and, when a
  sandbox is active, mirrors the identical file into it.
  - **Why:** the durable directory is what Land archives and what `sync` copies
    forward, so writing there is the only placement a sync cannot destroy.
    Mirroring keeps Build's packet accurate immediately, without forcing a
    `sync` that would bump `revision` and drop `provenHash`.
  - **Rejected:** teaching `sync` to merge `execution.yaml` back like
    `tasks.md`. `tasks.md` merges because progress is produced *in* the sandbox;
    provider config is contract, and a two-way merge invites conflicts the
    fingerprint checks would then have to arbitrate.

- **Decision:** add `openspec/changes/` wholesale to `createSingle`'s
  `harnessOwned` predicate.
  - **Why:** every draft under it is already excluded from the hash and the
    projection, so admitting it costs no isolation fidelity, and the loop's own
    design keeps drafts uncommitted until Land.
  - **Rejected:** committing drafts automatically — that would put unproven
    intent into history.

- **Decision:** `install.sh` stages managed files and prints that they must be
  committed before the first `/change`, rather than committing for the user.
  - **Why:** the installer writes into someone else's repository; creating a
    commit there is an authority the user has not granted. Staging plus an
    explicit next step keeps the decision theirs while removing the trap.
  - **Rejected:** auto-committing; also rejected excluding harness paths from
    `policyAnalysis`, which would be wrong in this repository, where
    `.claude/**` genuinely is the product surface.

## Compatibility and migration

No wire-visible contract changes, so no `protocol.json` pin moves.
`execution.yaml` placement changes only where the file is written, not its
schema. Existing sandboxes keep working: a mirror write is additive, and the
`harnessOwned` widening only makes `sandbox create` choose worktree where it
previously chose copy.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Mirroring into the sandbox diverges from the source | Write the identical serialized value to both; `sync` overwrites the mirror from source anyway | test |
| Widening `harnessOwned` hides a genuinely dirty target | Only `openspec/changes/` is added, and it is already excluded from hash and projection | test |
| Rapid template header change breaks existing rapid drafts | Headers are advisory to OpenSpec's validator; existing drafts keep validating as before | test |
