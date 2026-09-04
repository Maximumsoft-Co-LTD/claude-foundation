# Reports and operational plans

Use this index to distinguish current operating documents from historical
investigation records. Historical reports preserve what was observed at that
time; they are not updated to describe the current release.

## Start here

| Need | Document | Status |
|---|---|---|
| Understand the current backend change and release gap | [User scenario release status](user-scenario-release-status.md) | Current source cohort |
| See the executable scenario and acceptance matrix | [User scenario test plan](user-scenario-test-plan.md) | Current contract |
| Operate dogfood, pilot, rollback, and production observation | [Rollout operations](rollout-operations.md) | Current runbook |
| Configure consumer CRAP and mutation gates | [Consumer quality](../consumer-quality.md) / [ภาษาไทย](../consumer-quality.th.md) | Current guide |
| Understand the agent-harness simplification design | [Agent harness simplification plan](agent-harness-simplification-plan-2026-09-03.md) | Implemented design |
| Review the repository-wide simplification audit | [Agent harness simplification implementation audit](agent-harness-simplification-implementation-audit-2026-09-03.md) | v3.5.3 implementation record |
| Review the v3.5.4 lifecycle safety remediation | [Lifecycle safety remediation plan](v3.5.4-lifecycle-safety-remediation-plan-2026-09-04.md) | v3.5.4 release acceptance record |
| Review the post-v3.5.4 multi-repository binding remediation | [Multi-repository runtime binding remediation](multi-repository-runtime-binding-remediation-2026-09-04.md) | Current working-tree verification record |

Release mechanics live in the repository [RELEASING.md](../../RELEASING.md).
Detailed runtime semantics live in [WORKFLOW.md](../../WORKFLOW.md). Do not copy
those contracts into a report; link to them instead.

## Historical material

Files with a date in their name are point-in-time evidence or investigations.
Plans and audits such as `bug-audit-*`, `*-plan.md`, `*-assessment-*`, and
`changeloop-review-*` record the reasoning that led to later implementation.
Generated `harness-report-*.html` files are preserved renderings.

Use historical material to reproduce an old finding, not to decide whether the
current source is ready. Current readiness comes from the source-cohorted
release report and is summarized only in
[User scenario release status](user-scenario-release-status.md).

## Maintenance rule

- Update the two user-scenario documents when the matrix, behavior, or release
  evidence changes.
- Update the rollout runbook only when rollout policy or commands change.
- Add a dated report for a new investigation; never rewrite an old observation
  as though it happened on the current source.
- Keep implementation details in code and canonical references. Reports should
  state decisions, evidence, gaps, and exact continuation commands.
