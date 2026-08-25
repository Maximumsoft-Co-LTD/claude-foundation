# Project-wide CRAP Score and Mutation Testing Plan

> Status: implementation complete; changed-code enforcement active
> Scope: the complete `claude-foundation` repository
> Date: 2026-08-25
> Planning constraint: this document is repo-only and does not open an OpenSpec change

### Implementation status — 2026-08-25

The project-wide system described by this plan is now implemented:

- repository-owned quality policy, schemas and expiring exception registry;
- ESLint-based per-function classic cyclomatic complexity collection;
- branch coverage with function fallback and explicit unmapped status;
- lane-aware zero-coverage synthesis, CRAP calculation, merge-base comparison
  and Markdown summary;
- dashboard, selected runtime, example and website StrykerJS mutation shards;
- a 12-fault semantic catalog across runtime, CLI, installer, protocol and
  schema boundaries, with mutation-v2 output for every fault;
- blocking changed-code and mutation ratchets, pull-request reporting, release
  checks and nightly runtime/mutation workflows;
- trend history, versioned debt baselines and unified machine-readable evidence;
- unit tests for formula, mapping, diff parsing, config and result classification.

`c8 --all` was tested against both dashboard and runtime scopes but did not
terminate after the test processes completed in this repository. The active
collectors therefore omit `--all`; repository-owned lane manifests synthesize
0% only when the matching collector completed, while a lane that did not run is
reported unavailable. This keeps zero coverage and missing evidence distinct.

The verified implementation baseline is:

| Signal | Baseline |
|---|---:|
| Production JavaScript functions analyzed | 2,667 |
| Runtime statement coverage | 52.54% |
| Runtime branch coverage | 63.35% |
| Runtime function coverage | 49.53% |
| CRAP pass / warn / fail / unmapped | 2,196 / 86 / 379 / 6 |
| Dashboard automated mutants | 737 |
| Automated mutation score | 41.25% |
| Automated killed / timeout / survived / no coverage | 299 / 5 / 281 / 152 |
| Selected runtime mutation score | 51.03% (149 killed/timeout, 98 survived, 45 no coverage) |
| Example mutation score | 75.00% (141 killed, 31 survived, 16 no coverage) |
| Website mutation score | 60.80% (76 killed, 47 survived, 2 no coverage) |
| Required semantic mutants | 12/12 killed (5/5 suites) |

Tooling is pinned to Node-20-compatible versions: StrykerJS 9.6.1, c8 10.1.3,
ESLint 9.39.2 and Espree 10.4.0. Quality tests and complexity collection were
executed successfully on Node 20.19.0. The transitive `qs` dependency is
overridden to 6.15.3; the resulting lockfile reports zero known npm audit
vulnerabilities at the time of this baseline.

## 1. Executive summary

This plan adds CRAP Score and mutation testing as complementary engineering
controls across the whole project:

- **CRAP Score** identifies executable functions that combine high cyclomatic
  complexity with weak automated-test coverage.
- **Automated mutation testing** measures whether ordinary tests detect small
  behavioral faults in code surfaces where a mutation engine is practical.
- **Semantic mutation testing** injects deliberately selected faults into
  critical Foundation invariants and requires a named critical test case to
  detect each fault.

The project SHALL NOT use a single project-wide score as a release verdict.
Different surfaces have different execution models, so each surface receives
the strongest meaningful control:

| Surface | Primary controls |
|---|---|
| Node.js runtime and hooks | Function coverage, CRAP, focused semantic mutants |
| Dashboard JavaScript | Function coverage, CRAP, automated mutants, focused semantic mutants |
| Shell CLI/installers/test runners | Shell static checks, deterministic contracts, semantic mutants |
| Schemas and protocol data | Contract tests and schema/protocol semantic mutants |
| Website and examples | Build/test coverage where executable; advisory CRAP/mutation only |
| Docs, release notes, generated/static assets | Consistency/build checks; no artificial CRAP target |
| Release and Homebrew surfaces | Syntax, packaging and upgrade contracts; selective semantic mutants |

Rollout begins in report-only mode, then applies a **changed-code ratchet**.
Existing debt is recorded and cannot worsen; new and modified executable code
must meet the policy. Required semantic mutants remain stricter: every required
mutant must apply, compile or load, and be killed by its expected critical case.

## 2. Current-state assessment

The repository already has important parts of a mutation-quality system:

- `.claude/tests/run-all.sh` is the deterministic verification entry point and
  runs suites concurrently in isolated fixtures.
- Mutation suites already exist for evidence binding, target drift, Land
  surface enforcement, and risk-tiered review behavior.
- `openspec/specs/evidence-quality/spec.md` defines mutation protocol v2 and
  requires mutant identity, applied/compiled state, killed/survived state, and
  the critical case responsible for the kill.
- `WORKFLOW.md` requires mutation testing to occur only in isolation and states
  that a mutation crash is not a behavioral kill.
- `dashboard/` uses the Node test runner and already has unit and shell client
  tests.
- The root CI workflow runs the deterministic harness, but it does not
  currently publish unified function coverage, CRAP, or automated mutation
  reports.

The plan therefore extends the existing evidence model instead of replacing it
with a generic mutation-score gate.

## 3. Goals and non-goals

### 3.1 Goals

1. Identify high-risk changed functions before they land.
2. Make weak assertions visible even when line coverage is high.
3. Bind critical behavioral invariants to explicit semantic mutants.
4. Prevent new complexity and test debt without blocking work on unrelated
   legacy debt.
5. Produce deterministic, machine-readable and human-readable CI evidence.
6. Keep PR feedback fast enough for normal development.
7. Preserve the existing isolation, restoration, and fail-closed guarantees.

### 3.2 Non-goals

- CRAP Score is not a developer-performance KPI.
- Mutation score is not proof that the product is correct.
- The rollout does not require 100% automated mutation score.
- Documentation, generated files and declarative data are not forced through
  JavaScript complexity metrics.
- The project will not rewrite the entire test stack to accommodate one
  mutation tool.
- Existing high-CRAP code is not required to be refactored in one migration.
- A test crash, timeout, syntax failure or non-applying mutant never counts as
  a behavioral kill.

## 4. Quality model

The project will evaluate six layers. Higher layers do not replace lower ones.

| Layer | Question | Evidence |
|---|---|---|
| Q0 — Parse/static | Can the artifact be parsed and does it satisfy basic static rules? | Node/Ruby/shell syntax, lint, schema validation |
| Q1 — Deterministic tests | Does expected behavior pass in a clean baseline? | Unit, contract, integration and deterministic harness suites |
| Q2 — Coverage | Which executable decisions and functions were reached? | Function and branch coverage |
| Q3 — CRAP | Which reached or unreached functions are risky to change? | Per-function CC, coverage and CRAP |
| Q4 — Mutation | Do tests detect deliberately broken behavior? | Automated and semantic mutant reports |
| Q5 — System evidence | Does the complete workflow remain correct? | E2E, upgrade, packaging, compatibility and release checks |

The controls are interpreted together:

| CRAP | Mutation result | Interpretation | Expected action |
|---|---|---|---|
| Low | Strong | Maintainable and well protected | Preserve |
| Low | Weak | Simple or covered code with weak assertions | Improve behavioral assertions |
| High | Strong | Tests are sensitive but the implementation is complex | Refactor safely |
| High | Weak | Highest change risk | Prioritize tests and refactoring |

## 5. Repository-wide scope and control mapping

### 5.1 Lane A — Runtime

**Paths**

- `.claude/harness/foundation.mjs`
- `.claude/harness/runtime/**`
- runtime-facing Node modules under `.claude/harness/**`

**Controls**

- Collect branch and function coverage from focused runtime suites.
- Calculate per-function CRAP for executable `.js` and `.mjs` files.
- Enforce changed-function CRAP ratchets.
- Require semantic mutants for high-impact authorization, evidence, state,
  recovery, concurrency, hash-binding and fail-closed behavior.
- Keep full automated mutation advisory initially; the runtime's large harness
  and specialized invariants make targeted semantic faults more useful than a
  blind full-tree mutant count.

**Required semantic-mutant categories**

- remove or invert an authority check;
- accept stale proof or stale workspace identity;
- swap identity, digest or repository fields;
- bypass a conflict or recovery disposition;
- change fail-closed behavior to fail-open;
- accept missing/skipped critical cases;
- bind a mutant kill to the wrong critical case;
- remove retry, timeout or concurrency bounds;
- reorder state transitions or skip durable persistence;
- weaken repository or change-surface boundaries.

### 5.2 Lane B — Instructions, rules and hooks

**Paths**

- `.claude/hooks/**`
- `.claude/commands/**`
- `.claude/rules/**`
- `.claude/skills/**`
- `.claude/orchestrator.md`
- `WORKFLOW.md`

**Controls**

- Apply coverage and CRAP to executable hook JavaScript.
- Use deterministic contract and documentation-consistency tests for Markdown
  and instruction registries.
- Add semantic mutants where a hook enforces a live security or mutation
  boundary, for example removing a recognized mutating command or allowing an
  out-of-surface write.
- Do not calculate CRAP for instruction text.
- For instruction changes, use behavioral/contract mutation only when a stable
  parser or registry behavior can be deliberately broken and detected.

### 5.3 Lane C — Shipping boundary and public CLI

**Paths**

- `cli.sh`
- `install.sh`, `install-*.sh`
- `.claude/harness/commands.json`
- `.claude/harness/protocol.json`
- `openspec/schemas/**`

**Controls**

- Shell syntax and static checks for CLI/install scripts.
- Existing installer, upgrade compatibility, packaged CLI and protocol tests.
- Semantic mutants for public command routing, managed-file ownership,
  retired-file cleanup, API/protocol mismatch, install preservation, and
  fail-closed argument validation.
- Schema mutants for required-field removal, enum widening, incorrect default,
  and protocol-version acceptance.
- CRAP is applied only to executable JavaScript helpers, not JSON/YAML schemas.

### 5.4 Lane D — Repository-only products

#### Dashboard

**Paths**

- `dashboard/**/*.js`
- `dashboard/**/*.mjs`
- `dashboard/client.sh`
- `dashboard/test/**`

**Controls**

- Branch/function coverage for Node tests.
- Per-function CRAP.
- Automated mutation testing on production JavaScript.
- Focused semantic mutants for sanitization, authentication/authorization if
  present, migration correctness, usage aggregation and persistence behavior.
- Shell contracts for `client.sh`.

#### Website

**Paths**

- `website/**`
- `website/docs/**`

**Controls**

- Build, link and content consistency checks.
- Apply coverage/CRAP only to non-generated executable JavaScript modules that
  contain application behavior.
- Do not mutation-test static HTML/CSS or generated site output.
- Use focused DOM/behavior tests before enabling any website mutation gate.

#### Examples

**Paths**

- `examples/**`

**Controls**

- Keep example-owned test commands green.
- Publish coverage and CRAP as advisory.
- Mutation testing is required only for an example that is used as a release
  contract, template, or documented reference implementation.
- Example quality must not block unrelated runtime changes unless its files or
  shared contract changed.

#### Test infrastructure

**Paths**

- `.claude/tests/**`
- `scripts/**`

**Controls**

- Test code is excluded from product CRAP and mutation-score denominators.
- Test runners themselves receive deterministic process-control and wiring
  tests.
- Mutation helpers must prove clean baseline, isolated application, reliable
  restoration and unambiguous result reporting.

### 5.5 Lane E — Release and packaging

**Paths**

- `.github/workflows/**`
- `Formula/**`
- `RELEASING.md`
- `VERSION`, `CHANGELOG.md`, release notes

**Controls**

- Workflow syntax and release rehearsal.
- Ruby syntax and Homebrew packaging contracts.
- Semantic mutants only for executable release decisions with deterministic
  tests, such as wrong asset/version selection or skipped checksum validation.
- No CRAP calculation for prose, changelogs or workflow YAML.
- Full mutation runs are scheduled checks and release evidence; they must not
  modify the release checkout.

## 6. Metric definitions and policy

### 6.1 Coverage

Coverage used by CRAP must be stable and reproducible:

- primary measure: **branch coverage per function**;
- secondary diagnostic measures: line and function coverage;
- source maps must resolve to repository-relative production paths;
- uncovered production files must be included as zero coverage;
- tests, fixtures, generated artifacts, vendored code, temporary sandboxes,
  build output and machine-owned runtime output are excluded;
- the Node version and coverage-tool version are recorded in every report.

Project-level coverage is informational. Changed-code coverage is actionable.
Initial changed-code floors align with the project's documented direction:

| Evidence type | Initial changed-code floor |
|---|---:|
| Unit behavior | 80% branch coverage |
| Integration behavior | 70% of changed integration decisions |
| Critical E2E journeys | 50% of declared changed journeys |

These floors are inputs to review, not permission to omit critical negative
paths. A critical branch requires a test even if aggregate coverage is already
above the floor.

### 6.2 Cyclomatic complexity

- Calculate classic McCabe cyclomatic complexity per executable function.
- Report function name, path and start line.
- Treat anonymous callbacks as functions when the analyzer can identify them
  stably.
- Do not hide complexity behind a project average.
- Use ESLint's classic complexity interpretation as the canonical JavaScript
  definition unless the implementation spike shows a mapping defect.

Initial guidance:

| Complexity | Policy |
|---:|---|
| 1–10 | Normal target |
| 11–20 | Review and test all decisions |
| 21–30 | Refactoring candidate; requires strong evidence |
| >30 | New/changed function is rejected unless an approved exception exists |

### 6.3 CRAP Score

For a function `m`:

```text
CRAP(m) = CC(m)^2 * (1 - coverage(m))^3 + CC(m)
```

where coverage is a fraction from `0` to `1`.

Initial policy:

| Condition | Result |
|---|---|
| CRAP < 20 | Pass |
| CRAP 20–29.99 | Warning and reviewer attention |
| CRAP >= 30 in a new function | Fail |
| CRAP increases in a changed existing function | Fail unless approved |
| Existing untouched CRAP >= 30 | Debt inventory; does not fail unrelated PRs |
| CC > 30 in changed code | Fail independently of coverage |

The report must show both inputs. A CRAP number without its complexity and
coverage components is not actionable.

### 6.4 Automated mutation score

Automated reports distinguish:

- killed;
- survived;
- no coverage;
- timeout;
- compile/load error;
- ignored or explicitly equivalent.

Only valid, behavior-changing mutants belong in the theoretical denominator.
Because equivalent mutants cannot be identified completely, CI must expose raw
status counts rather than presenting the score as exact truth.

Rollout policy:

1. Report-only baseline.
2. Fail when changed code introduces a new `NoCoverage` mutant.
3. Fail when the changed-code mutation score regresses from the merge base.
4. After two stable sprints, set a changed-code target from observed data;
   `70%` is the candidate starting target, not a pre-approved mandate.
5. Never require a blind 100% automated score.

### 6.5 Semantic mutation policy

Semantic mutation is stricter than automated score aggregation. Every required
mutant must provide:

```text
id
description or fault class
source path
applied
compiled or loaded
result: killed | survived
expected killer case ID
actual killer case ID
```

A required semantic mutant passes only when:

1. the clean baseline passes;
2. the mutation applies to the intended bytes or AST node;
3. the mutated artifact compiles or loads;
4. the expected behavioral suite fails for the intended assertion;
5. the actual killer matches the declared critical case;
6. the isolated source is restored or discarded byte-for-byte;
7. the unmutated suite still passes when restoration verification is needed.

## 7. Tooling architecture

### 7.1 Coverage collector

Conduct a short spike comparing Node's built-in test coverage with `c8` for:

- direct `node --test` dashboard tests;
- shell runners that launch multiple Node child processes;
- ESM source mapping;
- uncovered-file inclusion;
- LCOV and machine-readable output;
- Node 20.19 and Node 24 compatibility.

Select one canonical collector for each execution lane, but normalize all
results into the same repository-owned report schema.

### 7.2 Complexity and CRAP reporter

Create repository-owned tooling under `scripts/quality/`:

```text
scripts/quality/
  collect-coverage.mjs
  collect-complexity.mjs
  calculate-crap.mjs
  compare-quality-base.mjs
  render-quality-summary.mjs
```

Recommended implementation:

1. Run ESLint's `complexity` rule in classic mode through a machine-readable
   formatter to collect per-function complexity.
2. Parse normalized LCOV/coverage JSON for function and branch coverage.
3. Join records by repository-relative path, start line and stable function
   identity.
4. Refuse ambiguous mappings instead of silently assigning the wrong coverage.
5. Calculate CRAP and emit JSON plus Markdown.

The implementation spike must test methods, arrow functions, anonymous
callbacks, nested functions, class fields, `switch`, logical expressions and
uncovered files before the report is trusted as a gate.

### 7.3 Automated mutation engine

Use StrykerJS first for `dashboard/` production JavaScript. Start with the
command test runner because the project uses `node:test`, then constrain the
scope to focused files and focused tests. The command runner lacks per-test
coverage optimization, so a full-runtime Stryker run is not a PR requirement.

Candidate first files:

- `dashboard/sanitize.js`
- `dashboard/migrations.js`
- `dashboard/usage-scan.mjs`
- other pure modules discovered during baseline collection

Do not start with `dashboard/server.js`; first isolate pure decision logic or
add focused seams so a mutant does not require a complete service test for
every small expression.

### 7.4 Semantic mutation harness

Extend the existing mutation-fixture pattern rather than creating a second
protocol. Common helpers should support:

- isolated temporary source fixture;
- baseline execution and optional pre-proven baseline vouchers;
- exact-match mutation with failure on zero or multiple targets;
- compiled/loaded verification;
- named critical-case result capture;
- timeout classification;
- cleanup traps for `EXIT`, `HUP`, `INT`, `PIPE`, and `TERM` where applicable;
- byte-for-byte restoration checks;
- mutation-v2 JSON output.

### 7.5 Configuration and reports

Proposed repository files:

```text
quality/
  policy.json
  exclusions.json
  exceptions.json
  schemas/
    quality-report-v1.schema.json

scripts/quality/**
stryker.dashboard.config.mjs
.github/workflows/code-quality.yml
.github/workflows/mutation-nightly.yml
```

Generated output stays under ignored or CI-owned paths:

```text
.foundation/test-results/quality/
  coverage.json
  complexity.json
  crap.json
  mutation-automated.json
  mutation-semantic.json
  summary.md
```

## 8. CI design

### 8.1 Pull request checks

PR CI should run in this order, while independent jobs may execute in parallel:

1. static/syntax checks;
2. affected deterministic suites;
3. changed-code coverage collection;
4. changed-function complexity and CRAP comparison;
5. affected required semantic mutants;
6. dashboard automated mutation for changed eligible modules;
7. unified quality summary.

Required PR checks:

| Check | Initial mode | Enforced mode |
|---|---|---|
| Deterministic affected tests | Blocking | Blocking |
| Coverage report | Report-only | Changed-code floor |
| CRAP report | Report-only | No regression; new function <30 |
| Required semantic mutants | Existing behavior blocking | Blocking for all declared affected mutants |
| Automated dashboard mutants | Report-only | Changed-code ratchet |
| Unified summary | Required artifact | Required artifact and PR summary |

PR latency targets:

- quality analysis excluding full deterministic tests: <= 5 minutes;
- changed-code automated mutation: <= 10 minutes;
- no PR waits for the full repository automated mutation run.

When a latency target is exceeded for three consecutive main-branch runs, the
team must reduce mutant scope, improve focused test selection, or move the
expensive check to scheduled CI without weakening required semantic mutants.

### 8.2 Main-branch checks

- Run the complete deterministic harness.
- Recalculate the full CRAP inventory.
- Run all required semantic mutation suites.
- Publish merge-base comparison and trend artifacts.
- Reject a mutation report whose tool/config version differs unexpectedly from
  the policy lock.

### 8.3 Nightly checks

- Run full eligible dashboard automated mutation.
- Run expanded advisory automated mutation on selected runtime modules.
- Re-run all semantic mutants without affected-test shortcuts.
- Publish survived/no-coverage mutant inventory.
- Open or update one deduplicated quality-debt issue rather than one issue per
  mutant.

Nightly target: <= 60 minutes. If the full eligible scope exceeds the target,
shard by surface and retain one aggregate report.

### 8.4 Release checks

- Require the latest main-branch deterministic and semantic-mutation evidence.
- Require no unresolved critical survived mutant.
- Treat an unavailable or stale mutation report as missing evidence, not pass.
- Keep packaging and mutation workspaces separate.

## 9. Development workflow

### 9.1 Plan before code

For any material executable change, identify:

- production functions and paths expected to change;
- happy, boundary and negative behavior;
- critical case IDs;
- expected coverage impact;
- likely complexity increase;
- required semantic faults for high-risk invariants;
- test command capable of detecting each fault.

Example:

```text
Behavior: expired proof cannot authorize Land
Critical case: CASE-EXPIRED-PROOF-REFUSED
Mutant: MUT-SKIP-PROOF-EXPIRY
Expected killer: CASE-EXPIRED-PROOF-REFUSED
```

### 9.2 Build loop

1. Add or strengthen a behavioral test.
2. Implement the smallest production change.
3. Run focused deterministic tests.
4. Inspect changed-function coverage and CRAP.
5. Refactor if complexity increased unnecessarily.
6. Apply the required semantic mutant or run the eligible automated mutants.
7. Confirm the intended assertion kills the fault.
8. Run the affected project suite.

### 9.3 Review

Reviewers inspect evidence, not only aggregate numbers:

- Does the test assert observable behavior?
- Is a high coverage value hiding weak assertions?
- Did CRAP rise because complexity increased or coverage fell?
- Is a survived mutant a real test gap, equivalent behavior, or irrelevant
  implementation detail?
- Was a semantic mutant killed by its declared critical case rather than by a
  crash or unrelated test?
- Is an exception narrow, owned and expiring?

## 10. Definition of Done

### 10.1 All executable changes

- [ ] Focused tests cover happy, boundary and relevant negative behavior.
- [ ] Changed-code coverage meets policy or has an approved exception.
- [ ] New functions have CRAP below 30.
- [ ] Existing changed functions do not increase CRAP without approval.
- [ ] Changed functions do not exceed CC 30 without approval.
- [ ] Test, generated and vendored files are not included in product metrics.
- [ ] Required CI artifacts are complete and use the locked report protocol.

### 10.2 Critical runtime, hook, CLI or shipping changes

- [ ] Stable critical case IDs are declared.
- [ ] Required semantic mutant IDs are declared.
- [ ] Each mutant applies exactly once and compiles or loads.
- [ ] Each mutant is killed by its expected critical case.
- [ ] Crash, timeout and compile failure are not reported as kills.
- [ ] Mutation occurs only in an isolated fixture.
- [ ] Restoration or fixture disposal is verified.

### 10.3 Dashboard changes

- [ ] Unit tests and shell client contracts pass as applicable.
- [ ] Coverage and CRAP checks pass for changed functions.
- [ ] Eligible automated mutants do not regress against the merge base.
- [ ] Critical escaped mutants are fixed or documented through an approved
      exception.

### 10.4 Declarative/docs/release-only changes

- [ ] Applicable consistency, schema, build, syntax or packaging checks pass.
- [ ] No artificial CRAP or mutation score is required for non-executable text.
- [ ] Executable decision changes receive semantic contract tests where
      applicable.

## 11. Exception policy

An exception is allowed only when the metric is misleading or the cost is
disproportionate to the risk. It is not a general deadline bypass.

Every entry in `quality/exceptions.json` must contain:

```json
{
  "id": "QEX-0001",
  "path": "repository/relative/path",
  "functionOrMutant": "stable identity",
  "metric": "crap | complexity | coverage | mutation",
  "reason": "specific technical reason",
  "risk": "what can escape",
  "compensatingEvidence": ["test or review reference"],
  "owner": "team or maintainer",
  "approvedBy": "reviewer",
  "expires": "YYYY-MM-DD",
  "trackingIssue": "issue reference"
}
```

Rules:

- exceptions are function- or mutant-specific, never directory-wide by
  default;
- expiry is at most 90 days unless the artifact is generated/vendor-owned;
- expired exceptions fail CI;
- raising a threshold to hide one finding is prohibited;
- equivalent-mutant suppressions must explain the behavioral equivalence;
- deleted or renamed targets invalidate their exceptions.

## 12. Reporting and governance

### 12.1 Unified report

The quality report should contain:

- repository commit and merge base;
- Node/tool/config versions;
- included and excluded paths;
- coverage totals and changed-function coverage;
- top CRAP functions and changed CRAP deltas;
- automated mutant status counts;
- every required semantic mutant result;
- active and expiring exceptions;
- CI duration per quality stage;
- clear pass, warn, fail or unavailable state.

### 12.2 Metrics for the team

Track trends, not personal scores:

- count of changed functions with CRAP >= 30;
- count of untouched legacy high-CRAP functions;
- median and 90th-percentile CRAP on production functions;
- changed-code branch coverage;
- automated survived and no-coverage mutants;
- required semantic mutant kill rate;
- mutation/quality job duration;
- flaky baseline incidents;
- exception count and age.

The following are prohibited as individual performance metrics:

- mutation score per developer;
- number of tests written;
- raw coverage increase;
- number of mutants killed;
- CRAP reduction without review of behavior and design.

### 12.3 Ownership

| Role | Responsibility |
|---|---|
| PR author | Supply behavior tests, investigate CRAP deltas and mutant results |
| Reviewer | Validate test oracles, semantic-mutant binding and exceptions |
| Runtime maintainers | Own critical invariant/mutant catalog |
| Dashboard maintainers | Own automated mutation configuration and focused seams |
| Release maintainers | Own CI budgets, tool locks and release evidence freshness |
| Project maintainers | Approve policy changes and expiring exceptions |

## 13. Rollout plan

### Phase 0 — Policy and inventory (2–3 days)

**Work**

- Approve metric definitions, exclusions, report protocol and exception shape.
- Inventory executable production paths and their test commands.
- Inventory existing semantic mutants and their critical killers.
- Record current CI durations.

**Exit criteria**

- Every repository surface has an assigned control strategy.
- Existing mutants have stable IDs or a migration task.
- No implementation gate is enabled yet.

### Phase 1 — Coverage instrumentation (3–5 days)

**Work**

- Spike Node built-in coverage versus `c8`.
- Add dashboard coverage.
- Add focused runtime/hook coverage collection.
- Normalize output and exclusions.

**Exit criteria**

- Repeated clean runs produce stable function/branch numbers.
- Uncovered production files appear as zero coverage.
- Multi-process coverage loss is understood and documented.

### Phase 2 — CRAP baseline (3–5 days)

**Work**

- Implement complexity extraction and coverage mapping.
- Test mapping edge cases.
- Generate full inventory and changed-code comparison.
- Publish report-only CI artifact.

**Exit criteria**

- Every mapped function shows path, line, CC, coverage and CRAP.
- Ambiguous/unmapped functions are reported explicitly.
- Maintainers review the top 20 high-risk functions for plausibility.

### Phase 3 — Dashboard automated mutation pilot (3–5 days)

**Work**

- Configure StrykerJS for selected pure dashboard modules.
- Establish focused commands, timeouts and exclusions.
- Classify initial survivors and equivalent mutants.
- Keep CI report-only.

**Exit criteria**

- Pilot is deterministic across three consecutive runs.
- Runtime meets the PR budget for changed pilot files.
- Survived mutants produce actionable file/line feedback.

### Phase 4 — Semantic mutation expansion (1 week)

**Work**

- Normalize existing scripts onto mutation-v2 output.
- Create a catalog for runtime, hooks, CLI/installers and schema/protocol
  invariants.
- Add missing high-risk semantic mutants.
- Verify isolation, target-match count and cleanup behavior.

**Exit criteria**

- Every critical invariant has at least one negative behavioral case and, where
  technically meaningful, one required semantic mutant.
- Required mutants cannot pass through crash or wrong-killer behavior.

### Phase 5 — Changed-code enforcement (1 week)

**Work**

- Enable no-regression CRAP gate.
- Enforce CRAP <30 and CC <=30 for new functions.
- Enforce required semantic kills.
- Enable dashboard changed-code mutation ratchet.
- Add exception validation and expiry.

**Exit criteria**

- Gates are green on main.
- Legacy debt does not block unrelated PRs.
- PR summary explains every failure and remediation path.

### Phase 6 — Scheduled full-project operation (ongoing)

**Work**

- Add nightly mutation shards and trend reporting.
- Triage top risk hotspots each sprint.
- Reduce accepted exceptions and legacy high-CRAP functions when touched.
- Review thresholds quarterly or after material test-tool changes.

**Exit criteria**

- Nightly completes within budget.
- No unresolved critical semantic survivor exists.
- Quality trends are available for release review.

## 14. Prioritized implementation backlog

| ID | Priority | Deliverable | Depends on | Acceptance |
|---|---:|---|---|---|
| QM-001 | P0 | Executable-path and test-command inventory | — | All surfaces classified |
| QM-002 | P0 | `quality/policy.json` and exclusions | QM-001 | Policy validates deterministically |
| QM-003 | P0 | Coverage collector spike | QM-001 | Stable branch/function report |
| QM-004 | P0 | Quality report v1 schema | QM-002 | Valid/invalid fixtures tested |
| QM-005 | P0 | Complexity collector | QM-002 | JS syntax edge cases pinned |
| QM-006 | P0 | CRAP calculator and Markdown renderer | QM-003, QM-005 | Formula and mapping tests pass |
| QM-007 | P0 | Dashboard coverage scripts | QM-003 | Production files include uncovered code |
| QM-008 | P0 | Runtime/hook focused coverage | QM-003 | Multi-process limitations resolved |
| QM-009 | P1 | Merge-base quality comparison | QM-006 | Changed-function delta is deterministic |
| QM-010 | P1 | Stryker dashboard pilot | QM-007 | Three stable report-only runs |
| QM-011 | P1 | Semantic mutant catalog | QM-001 | Existing mutant/killer pairs indexed |
| QM-012 | P1 | Shared mutation-v2 helpers | QM-004, QM-011 | Isolation and wrong-killer tests pass |
| QM-013 | P1 | Runtime invariant mutant expansion | QM-012 | Critical catalog has behavioral kills |
| QM-014 | P1 | CLI/installer/schema semantic mutants | QM-012 | Shipping boundaries have negative proof |
| QM-015 | P1 | PR quality workflow | QM-006, QM-009, QM-012 | Report-only artifact and summary publish |
| QM-016 | P1 | Exception registry and validator | QM-002 | Scope and expiry fail closed |
| QM-017 | P2 | Enable changed-code gates | QM-010, QM-015, QM-016 | Main green; legacy debt isolated |
| QM-018 | P2 | Nightly mutation workflow | QM-010, QM-013, QM-014 | Sharded run completes within budget |
| QM-019 | P2 | Trend dashboard/report | QM-018 | Main/nightly history is reviewable |
| QM-020 | P2 | Website/example executable pilot | QM-006 | Only meaningful executable code included |

### Backlog completion record — 2026-08-25

All `QM-001` through `QM-020` deliverables are implemented. Dashboard mutation
was verified across three consecutive full runs with identical results (737
mutants and 41.25% score) and completes in about 70 seconds
on the baseline workstation. The complete 77-suite deterministic harness,
12 required semantic mutants, four coverage lanes, four automated mutation
scopes, merge-base comparison, exception validation, trend recording, PR/main/
nightly workflows and release evidence gate are wired and locally verified.

Operational history such as “two stable sprints” remains an observation window,
not missing implementation. Versioned ratchets are active immediately; changing
the candidate 70% target into an absolute gate remains a deliberate quarterly
policy decision based on collected trend data.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Coverage from shell-launched Node children is incomplete | Wrong CRAP values | Coverage spike, explicit unavailable state, focused collectors |
| Function mapping joins the wrong coverage record | Misleading gate | Stable path/line identity, ambiguity refusal, mapping fixtures |
| Command-runner mutation is slow | PR latency | Changed files only, focused commands, scheduled full runs |
| Equivalent mutants lower score | False debt | Raw status reporting, reviewed expiring suppressions |
| Flaky tests misclassify mutants | Untrustworthy results | Require three stable baselines and fix flakes before gating |
| Mutation edits the real checkout | Developer/release corruption | Temporary fixtures only and byte restoration checks |
| Team writes tests tailored only to a mutant | Brittle tests | Review observable public behavior and expected killer case |
| Aggregate target encourages gaming | Weak assertions | Pair CRAP with mutation and critical-case review |
| Legacy debt blocks normal work | Rollout rejection | Merge-base ratchet and touched-function enforcement |
| Tool upgrade changes scores | Noisy regressions | Pin versions, record report protocol and deliberate baseline migration |
| Generated/docs code pollutes metrics | Meaningless failures | Central exclusions with deterministic validation |

## 16. Success criteria after two sprints of enforcement

- No new function with CRAP >=30 lands without an approved exception.
- Changed-function CRAP does not regress silently.
- Every required semantic mutant applies, loads/compiles and is killed by the
  expected case.
- Dashboard changed-code mutation results are deterministic and fit the PR
  latency budget.
- Full-project nightly mutation finishes within its shard budget.
- Zero mutation run modifies the source checkout.
- Unavailable, crashed, timed-out and non-applying mutants are reported
  truthfully and never converted to pass.
- Maintainers can identify the project's top risk hotspots from one report.
- Exceptions are narrow, owned and expiring.
- Metrics are used for code/test decisions, not individual performance.

## 17. First execution slice

The first implementation slice should complete `QM-001` through `QM-008` and
remain report-only. It should produce:

1. a canonical policy and exclusion list;
2. dashboard and focused runtime coverage;
3. tested per-function complexity extraction;
4. a full CRAP inventory;
5. a Markdown CI summary;
6. no new blocking gate.

After maintainers validate the top reported hotspots, proceed to the dashboard
mutation pilot and semantic-mutant catalog. Enforcement begins only after the
reports are stable and actionable.

## 18. Reference principles

- Original CRAP formula: cyclomatic complexity combined with automated test
  coverage; the historical warning threshold is 30.
- Coverage proves execution, not assertion strength.
- Automated mutation is a test-sensitivity signal, not correctness proof.
- Required semantic mutation is claim evidence and must bind a deliberate
  fault to a named behavioral killer.
- Project policy follows the existing Foundation invariants: mutation only in
  isolation, zero-test and missing-evidence cases fail closed, and mutation
  crash is not a behavioral kill.

### Source references

- Bob Evans and Alberto Savoia's CRAP metric is preserved in Venkat
  Subramaniam's [Caring About Code Quality presentation](https://agiledeveloper.com/presentations/caring_about_code_quality.pdf),
  including the formula and historical threshold context.
- [ESLint's complexity rule](https://eslint.org/docs/latest/rules/complexity)
  defines the classic/modified variants and the JavaScript constructs counted
  by the canonical collector.
- [c8 uncovered-file documentation](https://www.npmjs.com/package/c8#checking-for-full-source-coverage-using---all)
  explains why unloaded production files otherwise disappear from V8 coverage.
- [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)
  documents command-runner behavior, thresholds, concurrency and its inability
  to distinguish `Survived` from `NoCoverage` without runner coverage data.
- [Stryker mutant states and metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)
  defines detected, survived, no-coverage, invalid and mutation-score terms.

Because this repository uses the command runner, the implementation pairs each
mutation shard with an independent c8 run using the exact same test command and
normalizes unexecuted survivor locations to `NoCoverage` before applying the
versioned ratchet.
