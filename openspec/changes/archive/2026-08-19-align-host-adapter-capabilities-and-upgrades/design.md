# Design

## Current state

The shipped hook matrix documents that Cursor and Codex have no live tool hooks and that OpenCode has partial coverage. The main installer owns managed files through an install manifest, while the three host adapters copy current commands or prompts without recording and removing retired Foundation-owned adapter files.

Native host dispatch is now implemented and canonical. It standardizes worker orchestration, but it does not add tool-hook APIs to Cursor or Codex and therefore does not close this prevention-capability gap.

## Decisions

- **Decision:** Preserve all supported hosts and report degraded prevention capabilities truthfully
  - **Why:** Land gates still provide final enforcement, while capability reporting prevents users from assuming live parity.
  - **Rejected:** Reject installation on Cursor and Codex until they expose equivalent hook APIs
- **Decision:** Use per-adapter ownership manifests
  - **Why:** Deletion must be based on prior Foundation ownership rather than directory or filename inference.
  - **Rejected:** Delete every file absent from the current adapter source
- **Decision:** Keep adapter ownership state in a dedicated namespace
  - **Why:** `.foundation` contains unrelated runtime evidence and plans; adapter cleanup may own only `.foundation/adapter-manifests/`.
  - **Rejected:** Declare the whole `.foundation` tree as adapter task surface

## Compatibility and migration

Preserve support for hosts without live hook APIs and preserve user-authored commands or prompts. The change is additive for capability reporting and removes only adapter files previously recorded as Foundation-owned.

## Build precondition

The active sandbox predates the landed native-dispatch and discovery commits. Refresh it to the current root before implementation; the present `sandbox sync` validation-before-refresh deadlock is tracked by the separate `copy-root-read-refresh` draft and must be resolved without rewriting this change's audit history.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| An upgrade deletes a user-authored host command or prompt | Remove only exact paths recorded by the prior Foundation adapter manifest and test mixed user/Foundation directories. | installer tests |
| Capability output overstates protection on a host without hooks | Derive output from one canonical host coverage contract and pin every host row in deterministic tests. | contract tests |
