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

The first six lanes use paid model execution. The budget/resume lane is
deterministic and must not spend model budget.

## Execution order

1. Run the zero-cost sentinel. Stop if a fixture digest or deterministic oracle
   changes unexpectedly.
2. Run one paid smoke for a lane. It must reach `archived` and pass oracle,
   quality, project, clean-install, and post-install checks.
3. Run independent clean consumers until the lane has three strict passes from
   the same commit and patch digest.
4. Generate the release report. Historical or zero-model runs remain visible
   but cannot satisfy the paid repeat gate.
5. Run release preflight from a clean immutable candidate.
6. Execute package rehearsal, dogfood, pilot, and production observation gates.

Do not tune budgets from a timeout or a single happy path. A ceiling must cover
the declared convergent repair path, while the report continues to show actual
wall time, model requests, operations, resumptions, and available cost data.

## Commands

```bash
# Full deterministic repository suite
bash .claude/tests/run-all.sh

# Frozen seven-scenario safety check
npm run bench:openspec-native:sentinel

# One disposable paid lane
node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario <scenario-id>

# Source-cohorted promotion report
npm run bench:openspec-native:release-report -- \
  .claude/tests/bench/results/openspec-native-lab

# Candidate structure and compatibility
npm run release:preflight
npm run release:upgrade-matrix -- --output <durable-path>/upgrade-matrix.json
npm run release:local-rehearsal
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

As of 2026-09-03, all seven deterministic lanes pass. The current source has
one strict `bare-node-boundary` paid smoke and therefore remains
`smoke-green`; the other paid lanes remain `deterministic-green`. See
`user-scenario-release-status.md` for the concise live status and remaining
release work.
