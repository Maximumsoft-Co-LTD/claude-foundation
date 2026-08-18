# Design

## Current state

- `providerInputIdentity` already supports explicit `inputs`, including scoped
  repository paths, but command validation/bootstrap does not require a
  workspace script argument to be covered.
- Copy-mode apply compares target identity only to its recorded baseline; the
  worktree path already recognizes content that equals the sandbox result.
- Runtime state stores an absolute workspace path. Missing workspaces expose
  recreate/abandon recovery but cannot rebind a canonical relocated sandbox.
- The four executable runtime pins are API 23, while two shipped instruction
  files still name older APIs.
- Claude review now performs a fresh-session handshake and exact-session check.

## Decisions

- **Decision:** Keep global workspace hashing narrow and enforce command-file
  coverage at the provider boundary.
  - **Why:** Explicit inputs preserve concurrent-change isolation while binding
    the actual executable script.
  - **Rejected:** Hash every untracked file, which would let unrelated work
    invalidate receipts and defeat scoped reuse.
- **Decision:** Compare target identity and mode with both baseline and sandbox
  before declaring a copy conflict.
  - **Why:** Equality with the desired result cannot overwrite different bytes.
  - **Rejected:** Require `sandbox sync --resolve` for a no-op projection.
- **Decision:** Rebind only to the canonical sandbox path under the current
  project after verifying recorded workspace identity and expected layout.
  - **Why:** Recovery must not accept an arbitrary caller-supplied directory.
  - **Rejected:** Blind path rewriting or compatibility symlinks.
- **Decision:** Derive instruction assertions from protocol/runtime pins.
  - **Why:** Static duplicated numbers drift silently.
  - **Rejected:** Updating the prose without a regression.

## Compatibility and migration

Existing changes and receipts remain readable. New validation applies when a
provider command names a workspace file that is untracked and outside the
declared surface. Rebind only changes live runtime workspace locators; immutable
evidence retains its recorded provenance. Rollback is the prior runtime bundle.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Input inference covers too little | Fail closed and name the missing path; regression mutates the script | test |
| Equality shortcut hides mode drift | Compare both content identity and mode | test |
| Rebind targets unrelated content | Canonical path plus recorded identity/layout checks | test |
| Shipped docs drift again | One consistency test reads all four pins and instruction files | test |
| Runtime change breaks consumers | Full deterministic suite | compatibility |
