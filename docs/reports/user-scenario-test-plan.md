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
| `order-inventory` | Brownfield backend/SDK/web state, multi-tenant SQLite transactions and cross-process concurrency | high | Oracle 19/19, per-surface discriminating tests, clean offline install, archived |
| `order-inventory-lifecycle` | The order/inventory contract plus a mid-flight requirement update, a stacked second change, SIGKILL in Build and Land | high | Oracle 27/27 across scopes, lifecycle checks, both changes archived in order |

Twelve lanes use paid model execution. The budget/resume lane is
deterministic and must not spend model budget.

### Larger workload: order and inventory (levels 1–2)

The frozen product contract lives in the seed's `ORDER-INVENTORY.md`; the
hidden oracle and its calibration answers stay outside the consumer. The lab
adds an OpenSpec repository catalog only for the Change Loop arm: three
writable repositories (`backend`, `sdk`, `web`) plus their control root. The
lab initializes a separate Git seed commit in each child before Build; the
control root uses copy isolation. The direct baseline retains its single
control-root Git seed. Both arms receive identical product files, but their
Git topology differs and these are not submodules.

The workload preserves an existing catalogue while adding stock reservations,
trusted-token tenant/role boundaries, SQLite migration, durable idempotency,
expiry, cancellation, ordered events, SDK methods and immutable web state.
The oracle sends fifty reservations to two independent HTTP processes sharing
one real SQLite database; exactly ten must succeed against stock ten. It also
checks concurrent identical keys, duplicate cancellation, restart persistence,
expiry boundaries with injected clocks, and stale/terminal events. Delivered
tests must pass and fail independently when each original backend, SDK or web
implementation is restored. A timeout does not establish discrimination.
Calibration also injects tenant-leakage, late-expiry and terminal-state
resurrection mutants and requires the corresponding oracle cases to fail.

No package downloads, Docker, credentials or external services are needed;
Python 3 with standard-library SQLite must be available. Quality collection
covers production JavaScript, including backend business rules; the Python
SQLite transport is exercised behaviorally but has no measured Python coverage
in this mixed-stack lane. UI acceptance covers state transitions, not rendered
browser accessibility or appearance.

The initial ceilings (90 minutes, US$25 per run, 400 model requests, 600 tool calls)
are proposed bounds, not measured performance or spend authorization. The
runner subtracts measured session cost before each oracle-repair continuation;
missing or partial cost pauses before another paid session. Per-session
envelopes are retained in `host-sessions.json` and summed in the scorecard.
Historical merged-session accounting limitations in published reports remain
historical; this change does not rewrite their measurements.
The scenario is executable and deterministically calibrated. The
[2026-10-12 paid audit](scenario-order-inventory-2026-10-12.md) reaches archived
and passes product, measured quality and clean-install checks, but its archived
task ledger remains incomplete. It is not smoke-green or repeated assurance.
Levels 3–4 (amendment, stacked Land and interruption injection) are not
credited by this lane; they have their own lane below.

### Lifecycle lane: amendment, interruptions and stacked Land (levels 3–4)

`order-inventory-lifecycle` reuses the frozen order/inventory seed and runs one
disposable consumer through: Change A (the order/inventory contract) with a
host SIGKILL once backend work exists in the sandbox; the product owner's
requirement update 1 (a revised TTL bound and a new partial release) applied to
the same change through `change amend`; Change B (independent catalogue paging
over the same files) branched while A is proven and unlanded; A's Land crashed
with SIGKILL once a repository projection is applied, then resumed; and B's
Land onto A's uncommitted bytes with Land authority held by the host, as a
user's `/land` would. Pre-Land oracles gate A (scope `a`) and B (scope `b`);
the landed tree grades the full scope. The lane passes only when every
lifecycle check passes: both crashes injected, the same change resumed, the
amendment recorded, B branched before A landed, A archived before B, no
repository HEAD moved, tasks complete and the final oracle green.

A crashed session writes no result envelope, so its cost stays unmeasured; the
driver charges it at a reserve for budgeting only. `--lifecycle-interruptions
mid-build` runs a control that crashes only in Build. The lane is executable
and deterministically calibrated (reference answer, scoped oracle, eight
mutants); it has no strict paid pass.
See the [2026-10-26 lifecycle findings](scenario-order-inventory-lifecycle-2026-10-26.md).

Prepare either arm without model spend:

```bash
rtk proxy node .claude/tests/bench/openspec-native/lab.mjs --scenario order-inventory --dry-run
rtk proxy node .claude/tests/bench/openspec-native/lab.mjs --scenario order-inventory --arm baseline --dry-run
```

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

# Frozen twelve-scenario safety check (zero model spend)
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
