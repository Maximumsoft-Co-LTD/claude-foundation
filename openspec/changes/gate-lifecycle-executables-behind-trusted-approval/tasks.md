# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase.

- [x] **T001** [claims:the-raw-runner-is-unreachable,swapped-executable-voids-the-approval,edited-configuration-voids-the-approval,an-approval-does-not-transfer-to-another-project] `executor_approval` module: `ExecutorKind`, `ExecutorRequest`,
  content-bound digest over resolved program + bytes + ordered argv +
  environment + caps + config digest + canonical root —
  `crates/changeloop-ops/src/executor_approval.rs` — verify:
  `cargo test -p changeloop-ops executor_approval`
- [x] **T002** [claims:repository-content-cannot-record-an-approval,grant-re-derives-rather-than-accepting-a-digest] Trusted approval store: versioned JSON in the operator config
  directory, `0600`, fail-closed on unknown version, load/grant/revoke/list —
  `crates/changeloop-ops/src/executor_approval.rs` — verify:
  `cargo test -p changeloop-ops approval_store`
- [x] **T003** [claims:the-raw-runner-is-unreachable] Runner gate: make the raw lifecycle runner private and expose
  only an entry taking `&ApprovedExecutor`, constructible solely by the
  authorization check or the compiled-in register —
  `crates/changeloop-ops/src/lifecycle_service.rs` — verify:
  `cargo test -p changeloop-ops`
- [x] **T004** [claims:unapproved-proof-provider-refuses-to-run,approved-executable-runs,compiled-in-default-provider-needs-no-approval] CLI proof/repair/oracle-baseline/reviewer paths authorize before
  spawning, resolve every provider's authority before the lifecycle advances,
  and fail with the approval-required exit code naming the grant command —
  `crates/changeloop-cli/src/operational.rs`,
  `crates/changeloop-cli/src/prove_oracle.rs` — verify:
  `cargo test -p changeloop-cli`
- [x] **T005** [claims:unapproved-reviewer-refuses-to-run,independence-gate-reads-the-approved-family] App-server proof/reviewer paths authorize before spawning and
  return `SurfaceError::ApprovalRequired`; restart discovery counts a recorded
  review only while its reviewer is still approved —
  `crates/changeloop-app-server/src/executable.rs` — verify:
  `cargo test -p changeloop-app-server`
- [x] **T006** [claims:grant-re-derives-rather-than-accepting-a-digest] `cloop approve list|grant|revoke`: `grant` re-derives from
  on-disk config, displays the full resolved request, requires `--yes`, records
  one digest per executable, and never accepts a caller-supplied digest —
  `crates/changeloop-cli/src/main.rs`,
  `crates/changeloop-cli/src/operational.rs` — verify:
  `sh tests/compatibility/hermetic-lifecycle-e2e.sh`
- [x] **T007** [claims:reviewer-reporting-a-different-family-is-rejected,independence-gate-reads-the-approved-family] Reviewer model family is taken from the approval; a reviewer
  reporting a different family is rejected on both surfaces —
  `crates/changeloop-cli/src/operational.rs`,
  `crates/changeloop-app-server/src/executable.rs` — verify:
  `cargo test -p changeloop-cli a_reviewer_reporting_an_unapproved_model_family_is_refused`
- [x] **T008** [claims:swapped-executable-voids-the-approval,edited-configuration-voids-the-approval,repository-content-cannot-record-an-approval,an-approval-does-not-transfer-to-another-project] Adversarial regressions: unapproved provider never spawns,
  swapped executable bytes void the approval, edited configuration voids the
  approval, foreign project root does not transfer, a repository-planted store
  grants nothing — `crates/changeloop-ops`, `crates/changeloop-cli` — verify:
  `cargo test --workspace`
- [x] **T009** [claims:refusal-and-grant-flow-are-usable] Documented operator path in the CLI help —
  `crates/changeloop-cli/src/main.rs` — verify: `cloop --help` lists `approve`

## Deliberately not in this change

- Enforcing OS sandbox isolation on lifecycle executors. The runner still
  declines it under the enumerated `LIFECYCLE_OPERATOR_PROCESS` register row.
  Tracked as its own change; see the proposal's non-goals.
