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
| Compare skill trigger rates before and after the catalog simplification | [2026-10-27 skill catalog trigger evaluation](2026-10-27-skill-catalog-trigger-evaluation.md) | Baseline `281caac1b` and candidate arms, 32 skills × positive/negative × 2 reps each, Claude Code `claude -p` with Sonnet; raw transcripts outside Git; see the report's Regression section for the verdict |
| Review the first paid runs of the lifecycle lane (amendment, SIGKILL in Build and Land, stacked Land) | [2026-10-26 lifecycle](scenario-order-inventory-lifecycle-2026-10-26.md) / [ภาษาไทย](scenario-order-inventory-lifecycle-2026-10-26.th.md) | Eleven paid runs, none strict green (the latest, on the pushed repository replay/resolution change, stops before Land because the review counts merged landed edits as the later change's; open); harness resumed after both crashes and amended; B's Land refused after A landed in every run that reached it; cause found (child repositories lack the root's carried-edit and recorded-resolution handling), the exact-carry half fixed with a deterministic test but not enough for overlapping edits; Prove's reviewer stalled before Land in 3 of 4 later runs (unexplained); five open findings; US$23.7 measured, total unknown |
| Review the repeated `order-inventory` paid runs (multi-repo, concurrency) | [2026-10-26 repeat](scenario-order-inventory-repeat-2026-10-26.md) / [ภาษาไทย](scenario-order-inventory-repeat-2026-10-26.th.md) | `52c3e50c9`, four runs, all archived with oracle 19/19; `repeated-green` for this lane only (runs 2–4, one patch digest); median US$1.022 and 407.6 s; missing-section count was a scorecard artifact, fixed; three minor review findings open at Land in run 1; one of 28 lanes; ≈US$4.68 of a US$1000 cap |
| Review the per-task five-scenario smoke of the decision-first approval page and the new work types | [2026-10-22 smoke](scenario-smoke-candidate-497ab55fb-2026-10-22.md) / [ภาษาไทย](scenario-smoke-candidate-497ab55fb-2026-10-22.th.md) | Clean `497ab55fb` vs v3.6.7 vs no harness, five rows, n=1; 15/15 oracle passes and strict delivery; +5.2% cost, +6.2% time versus v3.6.7 (within noise, per-task rows move both ways); 1.93× cost versus no harness; the new undo rule appeared in the two high-risk rows; new work types not exercised; Claude Code only; US$5.6888 of a US$40 cap |
| Review the five-scenario smoke of the non-Claude-host fixes | [2026-10-21 smoke](scenario-smoke-candidate-2af6788-2026-10-21.md) / [ภาษาไทย](scenario-smoke-candidate-2af6788-2026-10-21.th.md) | Clean `2af6788` vs v3.6.6 vs no harness, five rows, n=1; 15/15 oracle passes; −3.3% cost, −10.2% time versus v3.6.6 (within noise); 1.94× cost versus no harness; Claude Code only; US$5.41 |
| Review repeated rapid-tier runs after the overhead fixes | [2026-10-19 rapid repeat](scenario-repeat-rapid-2026-10-19.md) / [ภาษาไทย](scenario-repeat-rapid-2026-10-19.th.md) | Clean `0660d1329`, `3fdea70b6`, `0131bc704`; five rows, three paired rounds each; rapid median ratio 2.01× (target 1.5×, recorded, not blocking); regression-fix 109.6 → 70.5 s after the unnamed-modified fix; one config-flag oracle failure on `0660d1329`; US$13.5001 |
| Review the candidate checkpoint after v3.6.5 | [2026-10-19 `9f1c09bf2` checkpoint](scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.md) / [ภาษาไทย](scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.th.md) | Clean `9f1c09bf2`, all 28 paid scenarios in Change Loop and no-harness arms, n=1; strict 28/28 after the `e1518a1` dependency-refresh fix and a clean `f3ad30df0` dependency-upgrade rerun; +0.5% time, +0.9% cost versus retained v3.6.5; no-harness ratio rapid 2.03× (fail) / standard 1.69×; US$21.7435 |
| Review the v3.6.5 candidate checkpoint | [2026-10-18 v3.6.5 checkpoint](scenario-checkpoint-v3.6.5-2026-10-18.md) / [ภาษาไทย](scenario-checkpoint-v3.6.5-2026-10-18.th.md) | Clean `078e10ba8` + `90cd46364` (regression-fix rerun), all 28 paid scenarios, n=1; strict 28/28; −18% time, −12% cost versus v3.6.4; +9% / +6% versus v3.6.3 on ten shared rows; US$14.5801 |
| Review the release candidate checkpoint after v3.6.3 | [2026-10-18 checkpoint](scenario-checkpoint-candidate-2026-10-18.md) / [ภาษาไทย](scenario-checkpoint-candidate-2026-10-18.th.md) | Clean `8410d517c`, all 28 paid scenarios, n=1; strict 28/28 after the `dde4a619e` ledger fix and a two-row rerun; Tracker 33/33; +44% time, +27% cost versus v3.6.3 on ten shared rows; US$21.8885 |
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
