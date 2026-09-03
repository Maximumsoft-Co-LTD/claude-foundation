# Design

## Current state

Reports do not bind the exact runtime source cohort; upgrades preserve project-owned legacy defaults without identifying known historical defaults; blocked operation rows omit typed cause and recovery; validation can accept critical-case wiring that the selected adapter cannot report; token targets do not scale with the execution surface; and delivery outside Land can leave Git reality ahead of lifecycle state without a dedicated diagnostic.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| source cohort | The exact Foundation version, protocol bundle, and content digest that produced an observation or report. | version when only a mutable semantic-version label is known |
| legacy-default drift | A project-owned configuration value that equals a known former packaged default and now differs from the current packaged default. | custom configuration unless user intent is known |
| out-of-band delivery | Change bytes observed in a target repository or recorded delivery reference before the harness reaches archived. | landed, proven, or archived |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** Identify report producers with semantic version, protocol bundle, and a content-derived source cohort digest.
  - **Why:** The current source tree and the tagged release can share a version string while carrying different protocols, so a version string alone cannot attribute feedback.
  - **Rejected:** Use only foundationVersion or infer the runtime generation from symptoms.
  - **Consequences:** Report and metrics schemas gain additive provenance fields and their protocol pin and compatibility coverage must move together.
  - **Supersedes:** none
  - **Superseded by:** none
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** Treat legacy-default drift as an advisory until the user explicitly authorizes migration.
  - **Why:** The installer cannot distinguish a preserved former default from a deliberate local policy strongly enough to rewrite it safely.
  - **Rejected:** Replace all old-looking foundation.json values during upgrade.
  - **Consequences:** Doctor must explain the old and current defaults, affected active changes, and the exact opt-in migration result.
  - **Supersedes:** none
  - **Superseded by:** none
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** Record only package-defined blocker codes, classifications, summaries, and recovery routes in the operation ledger.
  - **Why:** Raw stderr and arbitrary command text can contain secrets or unstable details while reports need durable causal data.
  - **Rejected:** Copy the complete thrown error or terminal transcript into operations.jsonl.
  - **Consequences:** Unknown failures remain failed or unavailable; they are never assigned a fabricated blocker reason.
  - **Supersedes:** none
  - **Superseded by:** none
- **Decision ID:** DEC-004
  - **Status:** accepted
  - **Decision:** Report out-of-band delivery as lifecycle drift with explicit recovery choices, never as evidence or implicit Land authority.
  - **Why:** The harness can observe repository reality but cannot grant or infer permission for actions performed outside it.
  - **Rejected:** Automatically mark a change proven or archived when its bytes appear on a target branch.
  - **Consequences:** Diagnostics may reconcile bookkeeping only through an explicit, audited route while Proof and Land requirements remain intact.
  - **Supersedes:** none
  - **Superseded by:** none

## Compatibility and migration

Preserve all public command names and arguments and keep active changes from every supported release readable. Additive report and telemetry fields must not make older records invalid. Project-owned configuration is never rewritten silently; any migration requires an explicit user decision and leaves an audit record.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Additive provenance or blocker fields accidentally invalidate old telemetry consumers. | Pin additive schemas and run the complete supported-upgrade and public-contract matrices. | T001 |
| Legacy-default detection mistakes intentional project policy for stale defaults. | Keep detection advisory, show a preview, and require an explicit decision before mutation. | T002 |
| Persisted blocker detail leaks secrets or user-controlled terminal content. | Persist only bounded package-owned enums and templates and test hostile error content. | T003 |
| Budget recalibration silently grants more spend or out-of-band detection is mistaken for delivery authority. | Never auto-expand an audited continuation, preserve measured lifetime usage, and keep drift diagnostics non-authoritative. | T004 |
