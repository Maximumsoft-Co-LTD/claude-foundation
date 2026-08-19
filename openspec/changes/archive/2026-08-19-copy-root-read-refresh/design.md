# Design

## Current state

`sandbox-runtime.mjs::sync` calls `validate(id, "root", { quiet: true })` before it rebases the sandbox. `change-validation.mjs` chooses the root packet directory for that source, but every `selectedRepositories(id, state)` call still returns `workspacePath` from runtime sandbox state and reads repository selection through `activeChangePath`. A root packet whose immutable read-set digest was refreshed after HEAD moved is consequently compared with stale sandbox bytes and rejected before replay.

## Decisions

- **Decision:** Make repository selection explicitly source-aware during validation
  - **Why:** Packet location, repositories.yaml, and read-set workspace must describe one tree for both root and active validation, including multi-repository changes.
  - **Rejected:** Skip grounding validation during sync
- **Decision:** Preserve active validation defaults
  - **Why:** Prove and Build must continue reading the sandbox; only callers explicitly validating the root packet receive target paths.
  - **Rejected:** Globally force selected repositories back to target paths
- **Decision:** Fix the owning selection boundary rather than copy files before validation
  - **Why:** Pre-copying would mutate the sandbox before conflict checks and hide whether root or sandbox supplied a digest.
  - **Rejected:** Copy refreshed read-set files into the sandbox as a sync preflight

## Compatibility and migration

No schema or persisted-state migration. Existing callers keep active workspace selection by default. Rollback is the runtime and topology change together; no state rewrite is required.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Root validation accidentally reads an active repositories.yaml | Bind selection to the explicit packet directory and cover differing root/sandbox selections | target-drift tests |
| Active validation starts reading target code | Keep source-aware behavior opt-in from root validation and test both modes | topology unit tests |
| Multi-repository target paths are reconstructed incorrectly | Reuse catalog target paths for every selected repository and preserve dependency validation | topology unit tests |
