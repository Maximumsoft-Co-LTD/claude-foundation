# Design

## Current state

- `usageAvailability` recognizes `host-execution-contract` but retained Codex host envelopes may carry `source: host-execution`, producing measured tokens with `source-unsupported` attribution.
- Blocker fallback selects the first broad regular-expression match. Known domains can supply structured causes, but ambiguous legacy text can still produce a confidently wrong recovery route.
- `SOURCE_COHORT` hashes the complete harness at module initialization even for commands that do not consume provenance.
- `proof advance` already emits `AUTO_REPAIR`, a bounded repair batch, and a repair plan, but the host agent must interpret that response, perform the repair without a lifecycle interval, and manually resume the loop.
- The guarded low-level commands have no additive coordinator that projects their next safe action.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| machine action | A bounded next action computed by the harness and executed by the host | autonomous authority |
| repair interval | Time from a current in-contract repair stop until an observed changed workspace resumes Proof | quiet time, human wait |
| derived repair node | Machine-owned execution work derived from verified current findings; it does not amend OpenSpec | task amendment |
| local recovery | Reversible workspace/evidence reconciliation that grants no delivery authority | automatic Land |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** Keep one OpenSpec change but implement dependency-ordered workstreams.
  - **Why:** The user explicitly requested one change, while the wire-visible surfaces still require staged implementation and verification.
  - **Rejected:** Separate changes for telemetry, repair, driver, and reporting.
  - **Consequences:** One final proof covers the integrated behavior; tasks and claims preserve internal isolation.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** The core returns machine actions and may converge deterministic local operations, but a host adapter remains responsible for invoking implementation agents and reviewers.
  - **Why:** This maximizes harness assistance without making the runtime a model launcher or inferring cost and authority.
  - **Rejected:** Have `advance` silently spawn models or perform delivery.
  - **Consequences:** Existing low-level commands remain supported; host integrations can follow the additive action contract.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** Review blocker/major findings become derived repair nodes only when current, in-contract, path-bounded, and evidence-bound.
  - **Why:** The harness already owns the repair batch and can remove orchestration work without taking semantic implementation authority.
  - **Rejected:** Automatically patch product files or close findings from reviewer text alone.
  - **Consequences:** Changed behavior/security/data/rollout continues to stop at `CONTRACT_DECISION_REQUIRED`.
  - **Supersedes:** none
  - **Superseded by:** none

## Compatibility and migration

All new commands and fields are additive. Existing operation rows, review attempts, receipts, and active changes remain readable. Missing legacy cause or repair data stays explicitly unavailable. Installer upgrades preserve project-owned configuration; an acknowledgement records intent but never rewrites policy. Wire-visible additions require protocol pins and supported-upgrade coverage.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Coordinator crosses an authority boundary | Typed terminal actions and negative tests for commit/push/publish/waive | compatibility + review |
| Repair nodes legitimize stale findings | Bind source attempt, workspace hash, paths, claims, and evidence; reject unchanged workspace closure | test + resilience |
| Timing labels imply unsupported causality | Use interval provenance and retain genuinely unattributed time | observability |
| Narrow invalidation reuses stale proof | Derive provider dependencies from recorded manifests and default ambiguous scope to invalidated | test + review |
