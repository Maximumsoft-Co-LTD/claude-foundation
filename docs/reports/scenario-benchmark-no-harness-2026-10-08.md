# No-harness scenario comparison (2026-10-08)

[ภาษาไทย](scenario-benchmark-no-harness-2026-10-08.th.md)

Ten additional real model runs used the no-harness arm, one repeat per scenario,
against the [retained v3.6.0–v3.6.2 cohort](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.md).
All four arms delivered 9/10 and failed the same tracker oracle. The no-harness
arm was faster and cheaper in this sample; no observed correctness advantage
from Change Loop is established by this portfolio. This is smoke evidence, not
a stable performance, production, or skill-routing verdict.

## Comparable work and different guarantees

The no-harness lab copied the same frozen seeds but installed no Change Loop,
OpenSpec, project lifecycle, or CLI shim. The host implemented directly, added
tests, ran the canonical project command and left its changes uncommitted.
Only the disposable lab's initial seed was committed. Generic user host settings
were retained; this is not a test without all agent skills or plugins.

The main model was observed as `claude-sonnet-5-5`, on Claude Code 2.1.294 and
Node 26.3.0/macOS. Clean v3.6.2 tooling commit
`50ad2ce4d5ceccb8bee0c1b8c44d5387617fadec` supplied the identical runner,
fixtures, oracles, quality and dependency tooling; it was not installed into
baseline consumers. Every baseline manifest and host tool profile was checked
for harness contamination. All 40 raw bundles passed hash, clean-source, frozen
seed and actual-model checks.

Both arms received the same task and partition guidance. The baseline prompt
removed the slash command and lifecycle instructions; permissions were the
protocol's direct-edit/test/read-only-Git allowlist. Its hidden oracle ran after
host exit, with no automatic oracle repair session. Change Loop stopped first
at `proven`, ran the oracle before Land, could start oracle repair, and required
`archived` plus delivery checks. Archive does not apply to the baseline.

Baseline runs used at most eight concurrent hosts, $2 per run, and a $20
additional ceiling inside the existing $40 authority. They ran afterward,
reusing the historical three-version evidence. Timing, service load, cache,
workload mix and stochastic model output were not contemporaneously paired.

## Results

All sums below use the same nine successfully delivered scenarios and exclude
tracker failures from performance comparisons. They are cumulative run times,
not concurrent batch elapsed time.

| Metric | No harness | v3.6.0 | v3.6.1 | v3.6.2 |
|---|---:|---:|---:|---:|
| Oracle, delivery and clean-install pass | 9/10 | 9/10 | 9/10 | 9/10 |
| Measured quality pass | 9/10 | 9/10 | 9/10 | 9/10 |
| Host time, nine successful pairs | 479.6 s | 842.3 s | 747.4 s | 847.9 s |
| Lab time including delivery checks, nine pairs | 495.2 s | 953.8 s | 855.0 s | 940.6 s |
| Host cost, nine successful pairs | $2.0714 | unavailable | $3.5514 | $3.6917 |
| Model requests, nine successful pairs | 63 | 98 | 93 | 96 |

Host timing has different endpoints: baseline host exit versus Change Loop
`proven`. Lab time includes oracle, quality, backend Land where applicable,
project and clean-install verification; it excludes initial fixture/install
preparation. Preserve both, rather than treating host timing as an isolated
measurement of harness execution overhead.

| Change Loop versus no harness | Host time increase | Lab time ratio | Measured cost increase | Cost-complete pairs |
|---|---:|---:|---:|---:|
| v3.6.0 | +75.6% | 1.93x | +66.9% | 8 |
| v3.6.1 | +55.9% | 1.73x | +71.5% | 9 |
| v3.6.2 | +76.8% | 1.90x | +78.2% | 9 |

v3.6.0 Python cost remains unavailable. Its cost comparison uses eight matched
pairs: $1.9005 baseline versus $3.1728 Change Loop. For v3.6.1/v3.6.2, all nine
successful pairs have complete costs. Partial/absent dollars are never zero.

### Baseline per-scenario observations

| Scenario | Host seconds | Host cost | Model requests | Oracle |
|---|---:|---:|---:|---:|
| bare-node-boundary | 41.7 | $0.2168 | 7 | 6/6 |
| typescript-react-state | 28.9 | $0.1730 | 6 | 6/6 |
| python-api-validation | 23.9 | $0.1709 | 6 | 5/5 |
| database-migration-rollback | 62.9 | $0.2103 | 7 | 6/6 |
| refactor-no-reproduction | 33.8 | $0.1647 | 5 | 6/6 |
| multi-service-event-flow | 37.0 | $0.1902 | 7 | 6/6 |
| tiny-feature | 51.1 | $0.1927 | 8 | 8/8 |
| notes-api | 124.1 | $0.4287 | 9 | 13/13 |
| cart-coupons | 76.2 | $0.3241 | 8 | 11/11 |
| project-tracker-api | 187.2 | $0.6313 | 10 | 32/33, failed |

The tracker failure was `CASE_TESTS_EXIST`, identical to all three harness
cohorts; ordinary baseline tests passed, but that did not satisfy the hidden
test-adequacy criterion. Baseline tracker quality and clean-install checks were
not run after failure. The oracle requires at least 15 passing delivered tests
and a suite that rejects the seed implementation. Do not weaken that criterion
or promote a failed run as faster delivery. These runs do not show that the
harness caused the common failure.

## Retained evidence and limits

The baseline's complete main-host reported cost, including its failed tracker,
was $2.7026468. All four arms have known cost of at least $16.1001206. Reserving
the full $2 for missing v3.6.0 Python cost yields $18.1001206 against the $40
authority. These are host CLI result costs/allowances, not an account invoice;
independent provider/reviewer charges were not measured.

The complete 40-run raw archive is kept locally outside repository state:

```text
~/.local/share/changeloop/benchmarks/2026-10-08-with-no-harness-1791472711421.tar.gz
SHA256 2cae148457c27a00f767e93569cb850b8a4866cb095d01a46323fd0e164cf08e
```

Read `summary-with-baseline.json` after checksum verification; per-run hashes
live in `runs/<run-id>/integrity.json`. The previous 30-run archive and dated
reports remain unchanged. Sources/worktrees/dependencies are excluded from
both archives. Raw logs and generated results stay out of Git.

For future releases, use [RELEASING.md](../../RELEASING.md). Reuse this no-harness
reference only with matching task, model, budget and measurement conditions;
otherwise collect fresh, authorized comparison evidence. Repeat counts and
variance are needed before claiming a stable speedup. The no-harness arm also
does not provide Change Loop's agreement, isolation, proof and recoverable Land
guarantees; this study measures the task portfolio, not those guarantees' value.

## Per-scenario ratios and larger-workload limits

No harness = 1.00. Each cell is lab time / host cost; values above one mean
more time or cost. Ratios use unrounded raw measurements.

| Scenario | v3.6.0 | v3.6.1 | v3.6.2 |
|---|---:|---:|---:|
| bare-node-boundary | 1.80 / 1.38 | 2.06 / 1.77 | 1.59 / 1.66 |
| typescript-react-state | 2.52 / 1.99 | 2.09 / 2.04 | 2.29 / 2.34 |
| python-api-validation | 3.42 / unavailable | 2.29 / 1.89 | 2.27 / 2.05 |
| database-migration-rollback | 1.50 / 1.67 | 2.00 / 1.90 | 1.52 / 1.67 |
| refactor-no-reproduction | 2.92 / 2.82 | 2.02 / 2.12 | 2.05 / 2.50 |
| multi-service-event-flow | 2.42 / 1.80 | 2.73 / 1.96 | 3.33 / 2.24 |
| tiny-feature | 1.06 / 1.59 | 1.03 / 1.57 | 1.36 / 1.69 |
| notes-api | 2.06 / 1.39 | 1.34 / 1.29 | 1.89 / 1.13 |
| cart-coupons | 1.32 / 1.45 | 1.47 / 1.59 | 1.73 / 1.79 |
| Successful-run totals | 1.93 / 1.67 | 1.73 / 1.71 | 1.90 / 1.78 |

Totals are ratios of sums, not averages of per-scenario ratios. Time uses nine
successful pairs; cost uses eight for v3.6.0 and nine for the other versions.
Failed tracker runs are excluded from successful-delivery ratios.

Broader fixtures include Project Tracker API (33 oracle cases: auth, roles and
permissions, projects/tasks, filtering/pagination, persistence and concurrency),
Notes API (13: CRUD and query behavior) and Multi-service event flow (six:
producer/consumer contract, compatibility and idempotency). Tracker was executed
but failed 32/33 in every arm, so it cannot support a successful-delivery ratio.

These are single-session simulated projects. In this 40-run comparison, multi-day
changes, multiple Git repositories and real production systems were not tested. Multiple services in
a fixture do not establish multi-repository workflow coverage. This report
supports no performance or readiness claim for those larger workloads.

A separate three-repository API-keys case already exists: gateway (root), users
(Git submodule), and SDK (writable sibling checkout). Its retained
[semantic draft](../../.claude/tests/harness/fixtures/large-change/api-keys.draft.json)
and [packet regression](../../.claude/tests/harness/run-large-change-packet-tests.sh)
replay the real change's three tasks, 34 claims and approximately 22 changed paths
through Change and the Build boundary, then check packet budgets and completed-task
behavior. This is not a full delivery benchmark and was not included in the
four-arm comparison above; no version or no-harness performance ratio is available
for it.

## Existing scenarios outside this comparison

Inventory checked against the paid matrix, task directories and historical live
reports. All ten current paid matrix lanes were run in all four arms. However,
14 of the 24 task fixtures are outside that matrix and this comparison:

| Group | Existing fixture IDs not compared |
|---|---|
| Browser UI and public site | `01-task-list`, `06-landing-site` |
| Small utilities | `02-csv-format`, `03-form-validator`, `04-paginate`, `05-debounce` |
| Security | `07-session-token` |
| Compatibility and migration | `08-name-migration`, `09-api-compat` |
| Financial correctness | `10-rounding-fix`, `13-money-drift` |
| Search and accumulated changes | `12-contact-search`, `14-accumulate`, `14b-sort-only` |

Several have historical live results in the
[2026-08-28 real-user report](consumer-e2e-real-user-10-scenario-2026-08-28.md).
Those observations are not measurements of v3.6.0–v3.6.2. Within these 14
directories, only contact-search and money-drift currently contain the standard
`oracle/run.sh`; other acceptance checks must be inventoried or prepared before
promoting them into a comparable delivery benchmark. Similar workload names in
the new matrix do not establish coverage of these old fixtures.

The separate API-keys case above is also absent. Historical lifecycle probes
([ten-session report](e2e-live-10-scenario-2026-08-23.md)) and harness diagnostics
([twenty-session report](e2e-live-20-scenario-2026-08-25.md)) cover investigation,
authority, leases, isolation and recovery rather than paired product-delivery
performance. The current matrix's `budget-exhaustion-resume` lane is deterministic
and belongs to the sentinel, not the 40 paid runs. An
[installed multi-repository recovery regression](../../.claude/tests/harness/run-installed-recovery-tests.sh)
also exercises dependency-wave interruption and read-only repository preservation;
it has no four-arm performance result here.

Priorities for a broader comparison are full three-repository API-key delivery,
browser UI/landing verification, session-token security, money-drift semantics,
and interrupted delivery/resume. This inventory does not authorize new paid runs
or claim that the omitted fixtures have been validated against the latest tags.
