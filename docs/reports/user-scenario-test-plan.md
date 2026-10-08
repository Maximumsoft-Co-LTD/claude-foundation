# User scenario test plan

## Goal

Prove that a user can keep the existing commands while the harness performs
mechanical bookkeeping, grouped diagnosis, repair planning, selective reruns,
and recovery automatically. A code-delivery scenario passes only after:

```text
Change -> Build -> Prove -> pre-Land oracle -> Land -> archived
```

Self-review and Land are pre-authorized only inside disposable benchmark
consumers. Production authority rules are unchanged.

## Invariants tested in every paid scenario

- Public command names and arguments remain compatible.
- Product writes occur only in the declared isolated workspace.
- A gate reports all independent findings from one evaluation.
- The harness derives mechanical IDs and unambiguous evidence bindings.
- Repairs invalidate and rerun only affected evidence.
- Product repair is not limited by an arbitrary retry count.
- No-progress, authority, resource, conflict, and budget stops are resumable.
- Proof, receipts, oracle results, and Land bind the same workspace revision.
- Hidden acceptance runs before Land and cannot be overridden by review prose.
- Archived output passes the ordinary project command and clean-install check.
- Unknown usage stays unavailable; it is never reported as zero or pass.

## Executable portfolio

The machine-readable source of truth is
`.claude/tests/bench/config/openspec-native-matrix.json`. Fixture and oracle
digests are frozen by the deterministic sentinel.

| Scenario | Shape | Risk | Terminal evidence |
|---|---|---:|---|
| `bare-node-boundary` | Node boundary defect and numeric partitions | standard | Oracle 6/6, tests, clean npm install, archived |
| `typescript-react-state` | React controlled state and reopen behavior | standard | State cases, regression test, clean npm install, archived |
| `python-api-validation` | Python API type boundary including boolean rejection | standard | API partitions, unittest clean-room run, archived |
| `database-migration-rollback` | Forward migration, rollback, and lossless round trip | high | Compatibility and rollback cases, clean install, archived |
| `refactor-no-reproduction` | Behavior-preserving refactor without an initial defect | standard | Characterization and export compatibility, archived |
| `multi-service-event-flow` | Producer/consumer event contract across services | high | Version, compatibility, idempotency, ordered proof, archived |
| `budget-exhaustion-resume` | Deterministic budget stop and continuation | low | `needs-user-decision`, exact resume, eventual completion |
| `tiny-feature` | Small feature and fixed harness overhead | low | Boundary tests, oracle, clean install, archived |
| `notes-api` | CRUD, query/filter/sort/pagination API | medium | Oracle 13/13, meaningful tests, clean install, archived |
| `cart-coupons` | Coupon validation and pricing partitions | medium | Oracle 11/11, meaningful tests, clean install, archived |
| `project-tracker-api` | Auth, permissions, persisted projects/tasks and concurrency | medium | Oracle 33/33 including discriminating tests, clean install, archived |

Ten lanes use paid model execution. The budget/resume lane is
deterministic and must not spend model budget.

## Execution order

1. Run the zero-cost sentinel. Stop if a fixture digest or deterministic oracle
   changes unexpectedly.
2. Before every new version, run one budget-authorized paid smoke for every
   paid matrix lane, following [RELEASING.md](../../RELEASING.md). Each must reach
   `archived` and pass oracle, quality, project, clean-install and post-install
   checks. Retain failed runs and unavailable measurements as checkpoint gaps.
3. Compare with matching previous-release evidence and retain a dated curated
   report, source pins, gaps and a checksummed raw archive outside Git. Unknown
   cost is not zero; disclose exactly which pairs support each comparison.
4. For repeated assurance, run independent clean consumers until each lane has
   three strict passes from the same commit and patch digest, then generate the
   assurance report. Historical or zero-model runs cannot satisfy that gate;
   one smoke cannot establish a stable speedup.
5. Complete release preflight on a clean immutable candidate and the
   deterministic package rehearsal before publication. Do not discard a failed
   smoke or substitute historical proof for this candidate's checkpoint.
6. Continue dogfood, pilot, and production observation after publication; these
   gates control the `production-observed` claim, not artifact availability.

Do not tune budgets from a timeout or a single happy path. A ceiling must cover
the declared convergent repair path, while the report continues to show actual
wall time, model requests, operations, resumptions, and available cost data.

## Commands

```bash
# Full deterministic repository suite
rtk test bash .claude/tests/run-all.sh

# Frozen eleven-scenario safety check (zero model spend)
rtk npm run bench:openspec-native:sentinel

# One disposable paid lane
rtk proxy node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario <scenario-id>

# Source-cohorted assurance report
rtk npm run bench:openspec-native:release-report -- \
  .claude/tests/bench/results/openspec-native-lab

# Candidate structure and compatibility
rtk npm run release:preflight
rtk npm run release:upgrade-matrix -- --output <durable-path>/upgrade-matrix.json
rtk npm run release:local-rehearsal
```

## Result classification

| Stage | Meaning |
|---|---|
| `deterministic-green` | Frozen fixture and zero-cost oracle pass |
| `smoke-green` | One current-source paid model run is strict green |
| `repeated-green` | Three current-source paid model runs are strict green |
| `blocked` | A required result is absent, failed, unavailable, or mismatched |

Budget exhaustion is a resumable `needs-user-decision` outcome. It is neither
completion nor a permanent block. External review, signed CI, secrets, deploys,
and production acceptance are never synthesized by the harness.

## Current baseline

The [2026-10-09 remaining-workload supplement](remaining-scenarios-no-harness-v3.6.2-2026-10-09.md)
compares 14 omitted legacy workloads and reconstructed three-repository API keys
against no harness, one repeat each. Its acceptance/quality/state gaps remain
open. These exploratory fixtures are not promoted into this official matrix;
freeze their corrected graders and seed before using them for a fresh checkpoint.

The retained [2026-10-08 v3.6.0–v3.6.2 cohort](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.md)
contains 30 paid runs, one per scenario and version, with 9/10 archived deliveries
per version. All three tracker runs failed `CASE_TESTS_EXIST`; v3.6.0 Python API
cost is unavailable. This is a historical comparison, not a passing checkpoint
for a new candidate, a repeated-green portfolio, or a stable performance claim.
See [current scenario status](user-scenario-release-status.md) for open findings.
