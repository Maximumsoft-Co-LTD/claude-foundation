# Reports and operational plans

**Audience:** maintainers and reviewers of Change Loop's development and release
evidence. These repository reports are not installed system instructions or
the agreement for a consumer project's change.

Use this index to distinguish current operating documents from historical
investigation records. Historical reports preserve what was observed at that
time; they are not updated to describe the current release.

<a id="start-here"></a>

## Choose a report

This directory is an evidence archive, not the product manual. For everyday
use, start with the [README](../../README.md); for development, use
[CONTRIBUTING.md](../../CONTRIBUTING.md).

| Question | Read |
|---|---|
| What is the current release status? | [User scenario release status](user-scenario-release-status.md) |
| Which scenarios are required? | [User scenario test plan](user-scenario-test-plan.md) |
| How do I release? | [RELEASING.md](../../RELEASING.md) |
| What happened in a particular experiment? | The dated record below; its result applies to its recorded source and environment |

## Recent evidence and operating documents

| Need | Document | Status |
|---|---|---|
| Review paid E2E after the evidence-gate and cross-change rollup change | [2026-10-15 pstack gates](scenario-pstack-gates-2026-10-15.md) / [ภาษาไทย](scenario-pstack-gates-2026-10-15.th.md) | Dirty source, n=1, two rounds; Sonnet delivery 10/11 (Tracker 33/33 once); order/inventory ledger still incomplete; US$16.9995 |
| Review the full paid portfolio and real multi-session Investigate | [2026-10-15 paid E2E](continuity-paid-e2e-2026-10-15.md) / [ภาษาไทย](continuity-paid-e2e-2026-10-15.th.md) | Delivery 9/10; Tracker still fails 32/33; history retained but independent timeout/cross-key probe fails after-generated design; US$16.7394936 |
| Compare requirement continuity before and after | [2026-10-15 differential scenario](investigation-continuity-differential-2026-10-15.md) / [ภาษาไทย](investigation-continuity-differential-2026-10-15.th.md) | New-contract guards 5/19 before, 19/19 after; deterministic runtime/compiler seam, not paid E2E |
| Review Investigate → Change development smoke | [2026-10-15 smoke](investigation-continuity-smoke-2026-10-15.md) / [ภาษาไทย](investigation-continuity-smoke-2026-10-15.th.md) | `notes-api` archived, oracle 13/13, clean install pass; US$0.5192617; one dirty-source run |
| Review the larger order/inventory paid workload | [2026-10-12 audit](scenario-order-inventory-2026-10-12.md) / [ภาษาไทย](scenario-order-inventory-2026-10-12.th.md) | Product oracle 19/19 and clean install pass; archived task ledger retains three unchecked tasks; strict outcome incomplete; US$2.0839467 including reviewer |
| Review the v3.6.3 candidate checkpoint | [2026-10-11 checkpoint](scenario-checkpoint-v3.6.3-2026-10-11.md) / [ภาษาไทย](scenario-checkpoint-v3.6.3-2026-10-11.th.md) | Historical checkpoint 9/10; tracker 32/33 at proven; publication later explicitly authorized as an exception in current status |
| Review omitted legacy and three-repository workloads | [2026-10-09 supplement](remaining-scenarios-no-harness-v3.6.2-2026-10-09.md) / [ภาษาไทย](remaining-scenarios-no-harness-v3.6.2-2026-10-09.th.md) | 15 workloads × two arms, n=1; acceptance, quality and retained-state gaps; exploratory, not release-green |
| Distinguish current source from recorded release evidence | [User scenario release status](user-scenario-release-status.md) | v3.6.3 published under an explicit exception; artifact/install/live-doc checks 20/20 and prior-version upgrades 4/4; tracker and production assurance remain open |
| Compare the retained release scenario baseline | [2026-10-08 comparison](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.md) / [ภาษาไทย](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md) | Historical 30-run cohort; source pins, incomplete cost, failure and private archive checksum retained |
| Compare release delivery against direct implementation | [No-harness comparison](scenario-benchmark-no-harness-2026-10-08.md) / [ภาษาไทย](scenario-benchmark-no-harness-2026-10-08.th.md) | 40 retained runs; all four arms deliver 9/10; baseline faster/cheaper in n=1, terminal-time differences disclosed |
| See the executable scenario and acceptance matrix | [User scenario test plan](user-scenario-test-plan.md) | Current contract |
| Operate dogfood, pilot, rollback, and production observation | [Rollout operations](rollout-operations.md) | Current runbook |
| Review delivery convergence, ownership, tool preparation, permission, and uncommitted multi-repository Land | [Delivery convergence master plan](delivery-convergence-master-plan-2026-09-05.md) | v3.5.7 implementation record |
| Configure consumer CRAP and mutation gates | [Consumer quality](../consumer-quality.md) / [ภาษาไทย](../consumer-quality.th.md) | Current guide |
| Understand the agent-harness simplification design | [Agent harness simplification plan](agent-harness-simplification-plan-2026-09-03.md) | Implemented design |
| Review the repository-wide simplification audit | [Agent harness simplification implementation audit](agent-harness-simplification-implementation-audit-2026-09-03.md) | v3.5.3 implementation record |
| Review the v3.5.4 lifecycle safety remediation | [Lifecycle safety remediation plan](v3.5.4-lifecycle-safety-remediation-plan-2026-09-04.md) | v3.5.4 release acceptance record |
| Review the post-v3.5.4 multi-repository binding remediation | [Multi-repository runtime binding remediation](multi-repository-runtime-binding-remediation-2026-09-04.md) | v3.5.5 release verification record |

Release mechanics live in the repository [RELEASING.md](../../RELEASING.md).
Detailed runtime semantics live in [WORKFLOW.md](../../WORKFLOW.md). Do not copy
those contracts into a report; link to them instead.

## Historical material

- [Project review and fix plan](project-review-fix-plan-2026-09-17.md) —
  2026-09-17 repository-wide inventory, deterministic checks, and reproduced
  evidence, installation, delivery, and dashboard defects on source
  `63f2ce1c4b73034bed2cbdb70b924928529e3fde`. Proposed fixes only; includes the
  full-suite timeout and verification limits.

- [Maintainer task log](maintainer-task-log-2026-09-17.md) —
  2026-09-16 to 2026-09-17 root-level implementation ledger for the project
  review fixes and Deliver release review; all items complete at v3.5.19.

- [Weekly Review feedback remediation plan](weekly-review-feedback-remediation-plan-2026-09-11.md) —
  2026-09-11 full artifact review and current-source comparison covering intent
  continuity, guards, leases, toolchains, evidence coverage, and telemetry.
  Includes approved upstream implementation, verification, and limits;
  consumer logs and version-cohort replay are still needed.

- [Concurrent change review efficiency plan](concurrent-change-review-efficiency-plan-2026-09-08.md) —
  2026-09-08 source-read proposal for review reuse across copy/worktree sync,
  selective invalidation, diagnostics, and conditional impact review. Planning
  only; no tests or implementation were performed for this report.

- [Harness behavior plan](harness-behavior-plan-2026-09-05.md) —
  2026-09-05 proposed boundary, completion, recovery, and projection changes;
  includes a reproduced target-completion projection mismatch. Not implemented.

- [Development roadmap](development-roadmap-2026-09-05.md) —
  2026-09-05 proposed development sequence based on the related-projects
  research and source inspection; implementation has not started.

- [Related projects research](related-projects-research-2026-09-05.md) —
  2026-09-05 ecosystem comparison and proposed investigations; not benchmark
  evidence or an approved implementation plan.

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
