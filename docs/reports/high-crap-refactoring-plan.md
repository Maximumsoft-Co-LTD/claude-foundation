# High-CRAP Runtime Refactoring Plan

> Status: planned; no production refactor started
> Scope: highest-risk runtime functions in `claude-foundation`
> Baseline date: 2026-08-25

This document defines the detailed method for the first five runtime hotspots.
The complete function-by-function inventory and assigned work waves are in the
[all-functions refactoring plan](./refactoring-plan/index.md).

## 1. Objective

Reduce change risk in the highest-CRAP runtime functions without changing
observable behavior or weakening fail-closed invariants. Work proceeds in small,
independently reviewable batches. Each batch establishes behavioral and mutation
evidence before changing production structure.

This is not a bulk cleanup of all 379 legacy CRAP failures. Untouched legacy
findings remain debt inventory and the existing changed-code ratchet remains in
force.

## 2. Current baseline

| Signal | Baseline |
|---|---:|
| Production functions | 2,667 |
| CRAP pass / warn / fail / unmapped | 2,196 / 86 / 379 / 6 |
| Runtime statement coverage | 52.54% |
| Runtime branch coverage | 63.35% |
| Runtime function coverage | 49.53% |
| Dashboard automated mutation score | 41.25% |
| Selected runtime mutation score | 51.03% |
| Required semantic mutants | 12/12 killed |

Initial hotspots:

| Order | Function | CC | Coverage | CRAP |
|---:|---|---:|---:|---:|
| 1 | `receipt-runtime.mjs:206 recordReceipt` | 226 | 10.08% | 37,364.27 |
| 2 | `evidence-contract.mjs:175 evidence` | 186 | 0% | 34,782.00 |
| 3 | `cli-router.mjs:3 routeRuntimeCommand` | 127 | 11.25% | 11,401.90 |
| 4 | `adapter-runtime.mjs:310 executeAdapter` | 105 | 0% | 11,130.00 |
| 5 | `change-validation.mjs:440 groundingValue` | 250 | 45.17% | 10,550.20 |

## 3. Safety rules

1. Add characterization tests before moving or rewriting logic.
2. Preserve public commands, exit codes, error text and persisted data formats
   unless a separately approved behavior change says otherwise.
3. Extract pure validation and mapping functions before changing control flow.
4. Keep filesystem, process execution, timestamps and persistence at explicit
   orchestration boundaries.
5. Never combine a behavior change, schema migration and structural refactor in
   the same batch.
6. Keep every batch revertible and small enough to diagnose from its focused
   tests.
7. Required semantic mutants must remain 12/12 killed throughout the work.

## 4. Work sequence

### Batch 0 — Evidence safety net

Before production edits:

- inventory the happy, boundary and negative paths for the five hotspots;
- create stable case IDs for authorization, claim scope, artifact provenance,
  repository identity, timeout and fail-closed behavior;
- add focused tests for uncovered branches and exact public errors;
- add semantic mutants for any critical decision not represented in the
  existing 12-mutant catalog;
- record focused test commands and before-refactor quality reports.

Exit criteria:

- every intended extraction has a passing characterization test;
- every critical negative branch has a named case;
- the clean baseline is deterministic across three consecutive runs;
- no test relies only on internal call order when observable behavior is
  available.

### Batch 1 — CLI routing pilot

Target: `routeRuntimeCommand`.

Proposed structure:

- group command handlers by domain: change, agent, proof, authority, land,
  sandbox and telemetry;
- retain one exported router that resolves a command and invokes a handler;
- move strict flag definitions and argument validation beside each handler;
- retain the injected `api` boundary so tests do not need real runtime state;
- preserve command names, aliases, error messages and exit behavior.

Targets:

- router CC <= 10;
- individual handler CC <= 15, with no function above 30;
- >= 80% branch coverage for changed routing decisions;
- no changed command contract in packaged CLI tests.

### Batch 2 — Evidence contract validation

Target: `evidence`.

Extract pure validators for:

- top-level evidence document shape;
- claim identity, scenario and capability validation;
- provider and adapter configuration;
- repository and multi-repository scope;
- contract-digest configuration;
- inputs, resources, timeout and report-path rules.

Keep file loading and error rendering in the orchestration function. Return
normalized values only after all fail-closed validations succeed.

Targets:

- orchestration CC <= 20;
- validator CC <= 15, with no function above 30;
- >= 80% branch coverage for changed validation decisions;
- invalid schema/protocol mutants remain killed by their declared cases.

### Batch 3 — Receipt creation pipeline

Target: `recordReceipt`.

Split the function into an explicit pipeline:

1. resolve provider capability and configuration;
2. validate requested claims and provider authorization;
3. normalize foreground, command and adapter metadata;
4. normalize and validate artifacts and references;
5. validate provenance and manual-versus-executed evidence floors;
6. calculate repository, workspace and input identities;
7. construct the receipt value;
8. persist the receipt and update runtime state.

Pure steps return values or structured validation findings. Only the outer
orchestrator may read state, copy artifacts, generate time-dependent IDs or
persist data.

Targets:

- orchestrator CC <= 30;
- helper CC <= 15;
- >= 80% branch coverage for all changed receipt decisions;
- byte-compatible receipt shape and version;
- manual receipts cannot impersonate harness execution;
- stale identity, wrong repository and missing provenance mutants remain killed.

### Batch 4 — Adapter execution boundary

Target: `executeAdapter`.

Extract:

- adapter command construction;
- environment and working-directory resolution;
- timeout and process-result classification;
- report and command-log discovery;
- provider response normalization;
- cleanup and failure mapping.

Wrap process execution behind an injected boundary so timeout, signal, malformed
output and missing executable paths are deterministic in unit tests.

Targets:

- orchestrator CC <= 25;
- helper CC <= 15;
- >= 80% branch coverage for changed adapter decisions;
- timeout, crash and load failure never count as behavioral mutation kills;
- command logs and durable artifacts remain mandatory where currently required.

### Batch 5 — Grounding validation decomposition

Target: `groundingValue`.

Decompose checks by invariant rather than by incidental file layout:

- change and repository identity;
- task and requirement grounding;
- evidence and proof readiness;
- review and acceptance requirements;
- state transition readiness;
- diagnostics and remediation rendering.

Each checker returns structured findings. One coordinator orders and aggregates
them to preserve current output ordering and public diagnostics.

Targets:

- coordinator CC <= 30;
- checker CC <= 15;
- >= 80% branch coverage for changed grounding decisions;
- finding order and diagnostic text remain compatible;
- missing evidence and invalid state remain fail closed.

## 5. Per-batch delivery workflow

Each batch is delivered in two pull requests when practical:

1. **Test hardening:** characterization cases, mutation cases and baseline
   evidence only.
2. **Structural refactor:** production extraction with no intentional behavior
   change.

Required checks for every pull request:

- focused unit and contract tests;
- complete deterministic harness;
- changed-function coverage and CRAP gate;
- affected automated mutation shard;
- all required semantic mutation suites;
- static/config validation and packaged CLI contract where applicable.

## 6. Acceptance criteria

A batch is complete only when:

- observable behavior and persisted formats are unchanged;
- every new or extracted function has CRAP < 30 and CC <= 30;
- changed-code branch coverage is at least 80%;
- the affected mutation score does not regress;
- no new `Survived` or `NoCoverage` mutant is introduced in changed code;
- all required semantic mutants apply and are killed by the expected cases;
- the deterministic harness and unified quality gate pass on CI;
- the before/after CRAP and mutation evidence is attached to the review.

For a legacy wrapper that cannot reach CRAP < 30 in one safe batch, the batch
must reduce its CRAP materially, introduce no new decisions and record the next
extraction as an owned follow-up. This exception cannot be used for newly
created functions.

## 7. Stop and rollback conditions

Stop the batch and restore the last green structure when:

- a public command or persisted receipt changes unintentionally;
- a required semantic mutant survives or is killed by the wrong case;
- a timeout, crash or fixture failure is classified as a kill;
- focused tests become flaky across three runs;
- the refactor requires a protocol or schema change not included in the batch;
- CI latency repeatedly exceeds the existing quality-job budget.

## 8. Progress reporting

After every batch, record:

- original and resulting CC, coverage and CRAP for the target;
- extracted function count and their maximum CRAP;
- mutation counts and score before/after;
- semantic mutant results;
- deterministic harness and CI run links;
- remaining hotspot and the next recommended batch.

After Batches 1–5, regenerate the project-wide debt inventory and reprioritize
the remaining 374 legacy CRAP failures using criticality, change frequency,
incident history and mutation weakness rather than CRAP rank alone.
