# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase.

- [x] **T001** [claims:verification-never-creates-a-missing-key,a-repository-owned-key-directory-is-rejected,tampered-payload-voids-authority,foreign-project-root-voids-authority] `authenticated_record` module: HMAC-SHA256 sidecar, operator key
  (`0600`, nofollow, one hard link), sign/verify/write/load —
  `crates/changeloop-evidence/src/authenticated_record.rs` — verify:
  `cargo test -p changeloop-evidence authenticated_record`
- [x] **T002** [claims:unsigned-operational-state-clears-authority-only,tampered-payload-voids-authority,changing-lifecycle-config-or-losing-the-key-stales-readiness] CLI `operational.json` load/save authenticates with bindings over
  proof-providers, reviewer, prove-oracle, and executor-approvals; unsigned or
  invalid state clears authority only —
  `crates/changeloop-cli/src/operational.rs` — verify:
  `cargo test -p changeloop-cli authenticated_operational`
- [x] **T003** [claims:unsigned-proof-is-invisible-to-restart-discovery,unsigned-review-does-not-satisfy-review-readiness,authenticated-proof-and-review-survive-restart-discovery] App-server proof/review writes authenticated records; discovery and
  review resume require valid sidecars (review binds agreement+evidence digests) —
  `crates/changeloop-app-server/src/executable.rs` — verify:
  `cargo test -p changeloop-app-server restart_discovers_fresh_proof`
- [x] **T004** [claims:unsigned-proof-is-invisible-to-restart-discovery,tampered-payload-voids-authority] Adversarial regressions: forged/unsigned proof is ignored, sidecar
  mismatch fails closed — `crates/changeloop-evidence`,
  `changeloop-cli`, `changeloop-app-server` — verify:
  `cargo test -p changeloop-evidence authenticated_record && cargo test -p changeloop-cli authenticated_operational && cargo test -p changeloop-app-server restart_discovery_rejects`

## Deliberately not in this change

- Encrypting repository artifacts (inspectability retained).
- Authenticating display-only briefing receipts under `.changeloop/receipts`.
- Two-phase crash journal for workspace mutations (Track B1).
