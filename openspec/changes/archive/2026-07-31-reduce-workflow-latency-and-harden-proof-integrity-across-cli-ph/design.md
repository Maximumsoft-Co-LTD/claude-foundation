# Design

## Current state

- `cli.sh` is the public router, but an installer-only global command can still
  shadow it and force agents to discover and invoke the low-level runtime.
- `proof preflight`, `proof plan`, `proof execute`, and `proof audit` are
  separate deterministic commands that the model orchestrates manually.
- Receipts share a workspace snapshot. This is safe but invalidates unrelated
  evidence, such as supply-chain results after an application-only edit.
- External receipts can carry `pass` with empty observations and no durable
  artifact. Playwright secondary outputs currently inherit the full annotation
  set rather than the provider's declared claim subset.
- Packets are byte-bounded and measured, but the runtime does not record
  whether the next phase uses a fresh host session.
- R5 exposed a `/var` versus `/private/var` canonical-path mismatch and spent
  most of its active time in model/control-plane rework rather than provider
  execution.

## Decisions

- **Decision:** Keep the existing low-level commands but add `proof readiness`
  and atomic `proof run` as the normal public path.
  - **Why:** One deterministic state machine removes model round trips while
    preserving debuggability and compatibility.
  - **Rejected:** Removing the individual commands, which would make diagnosis
    and recovery harder.

- **Decision:** A provider receipt remains bound to the final proof snapshot,
  but reuse additionally uses a provider-input fingerprint.
  - **Why:** The shared snapshot preserves proof identity; scoped inputs avoid
    needless re-execution for demonstrably unrelated edits.
  - **Rejected:** Replacing the shared snapshot with independent provider
    snapshots, which would weaken the statement that all evidence describes
    one delivered state.

- **Decision:** Unknown or incomplete input scopes fall back to global
  invalidation.
  - **Why:** Reuse must be fail-safe; optimization cannot infer dependencies.
  - **Rejected:** Automatically guessing provider inputs from command text.

- **Decision:** External `pass` receipts require a non-empty observation,
  provenance, and at least one durable artifact or reference.
  - **Why:** A status bit without inspectable evidence is not independent
    review or supply-chain proof.
  - **Rejected:** Retaining permissive recording for convenience.

- **Decision:** Capability-scoped providers may cover only claims that declare
  the provider capability.
  - **Why:** This enforces the documented deny-by-default provider protocol.
  - **Rejected:** Treating all annotations from a shared Playwright run as
    coverage by every emitted provider.

- **Decision:** Fresh phase execution is a host capability with an explicit
  recorded fallback, not an assumption made by packet generation.
  - **Why:** The CLI cannot force every host to reset a model session.
  - **Rejected:** Reporting packet size as proof that context was reset.

- **Decision:** Review runs before the proof snapshot is frozen. A review that
  finds a verified defect returns the change to convergence and cannot issue a
  pass receipt.
  - **Why:** Review must still find real defects without invalidating evidence
    recorded prematurely.
  - **Rejected:** Moving review after proof and accepting repeated global
    invalidation as normal.

- **Decision:** Adapter conveniences remain explicit and dependency-free.
  - **Why:** Foundation may parse project output or serve declared static
    content, but must not install tools or silently invent project commands.
  - **Rejected:** Bundling Playwright, test frameworks, or audit tools.

## Compatibility and migration

Receipt and proof readers remain backward compatible. New receipts use a
protocol revision carrying provenance, capability scope, and input
fingerprints. Archived legacy proofs remain readable and are labeled
`legacy-unverified-external` when they lack the new external evidence fields;
active legacy external receipts must be re-recorded before a new proof can
pass. Provider-scoped reuse ships in shadow mode first and falls back to global
invalidation when scope is absent or disputed.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Scoped invalidation reuses evidence unsafely | Explicit declared inputs, shadow comparison, and global fallback | test, review |
| Atomic proof hides a failing stage | Structured stage results and retained low-level commands | test |
| Fresh contexts omit needed decisions | Digest-bound references and phase handoff contract | test |
| New receipt requirements break active changes | Backward reader plus explicit active re-record guidance | compatibility |
| Adapter convenience becomes hidden project mutation | Opt-in configuration and no dependency installation | review |
| CLI routing selects the wrong runtime | Project-root discovery and protocol compatibility check | test |
