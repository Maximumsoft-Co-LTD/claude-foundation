# Release scenario comparison: v3.6.0–v3.6.2 (2026-10-08)

[ภาษาไทย](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md)

This is a curated historical observation, not a green release gate. Thirty
disposable scenario runs were executed: ten scenarios, one repeat per release.
Each release delivered and archived 9/10; all three failed the same tracker
oracle. The portfolio does not establish a stable improvement or test every
skill individually. Future releases follow [RELEASING.md](../../RELEASING.md).

## Source and measurement boundary

| Release | Tested commit |
|---|---|
| v3.6.0 | `b404be47db136fb3fc97eb714dab286dd0859695` |
| v3.6.1 | `839daff42d1b025fd2c5c38139035ec070ecbca5` |
| v3.6.2 | `50ad2ce4d5ceccb8bee0c1b8c44d5387617fadec` |

All 30 bundles passed source-cleanliness, frozen-fixture, actual-model, and
SHA-256 integrity checks. Runner, fixture, oracle, quality scripts, and lockfile
were identical across the tags. The host was Claude Code 2.1.294, Node 26.3.0,
on macOS; the observed main model was `claude-sonnet-5-5`.

Maximum concurrency was eight hosts. v3.6.1/v3.6.2 ran in alternating scenario
pairs; v3.6.0 ran afterward with reused comparison evidence. Service load, cache,
and concurrent workload mix may differ. No spread or confidence interval is
available from one repeat. A 0.7% time difference is inconclusive.

Experiment-only instrumentation pinned the model and deducted prior measured
session cost before repair continuation. Unknown prior cost stopped further
paid continuation. Each run had a $2 cumulative allowance; the total authorized
ceiling was $40. Canonical macOS temporary paths avoided the historical
`/var` versus `/private/var` coverage alias on every version. Shipped runtime
and machine-owned proof were unchanged.

## Matched outcomes

| Metric | v3.6.0 | v3.6.1 | v3.6.2 |
|---|---:|---:|---:|
| Delivered, archived, oracle and clean-install pass | 9/10 | 9/10 | 9/10 |
| Measured quality pass | 9/10 | 9/10 | 9/10 |
| Host time, nine successful pairs | 842.3 s | 747.4 s | 847.9 s |
| Cost, eight successful pairs with complete cost | $3.1728 | $3.2288 | $3.3415 |
| Model requests, nine successful pairs | 98 | 93 | 96 |

Against v3.6.0, v3.6.1 used 11.3% less host time and 1.8% more measured cost;
v3.6.2 used 0.7% more host time and 5.3% more measured cost. Against v3.6.1,
v3.6.2 used 13.5% more host time and 4.0% more cost across nine cost-complete
successful pairs. Different cost denominators are intentional: v3.6.0 Python
API has no final cost envelope, so its cost is unavailable and excluded.

Host time is the runner stopwatch across model sessions, reaching `proven` on
successful runs. It excludes the backend oracle, Land, and later clean-install
checks. The separate `labElapsedMs` remains in the raw summary. Failed runs stay
in outcome and spending totals and cannot count as faster delivery.

### Per-scenario observations

Each cell is host seconds / cost / oracle score, one run per release.

| Scenario | v3.6.0 | v3.6.1 | v3.6.2 |
|---|---|---|---|
| bare-node-boundary | 68.9 / $0.2993 / 6/6 | 76.2 / $0.3829 / 6/6 | 59.9 / $0.3589 / 6/6 |
| typescript-react-state | 67.9 / $0.3438 / 6/6 | 53.9 / $0.3527 / 6/6 | 60.9 / $0.4045 / 6/6 |
| python-api-validation | 63.4 / unavailable / 5/5 | 43.6 / $0.3226 / 5/5 | 47.4 / $0.3502 / 5/5 |
| database-migration-rollback | 85.0 / $0.3513 / 6/6 | 118.3 / $0.3998 / 6/6 | 87.6 / $0.3510 / 6/6 |
| refactor-no-reproduction | 93.3 / $0.4637 / 6/6 | 53.8 / $0.3486 / 6/6 | 63.4 / $0.4122 / 6/6 |
| multi-service-event-flow | 80.7 / $0.3426 / 6/6 | 96.6 / $0.3736 / 6/6 | 118.0 / $0.4251 / 6/6 |
| tiny-feature | 45.3 / $0.3070 / 8/8 | 43.3 / $0.3029 / 8/8 | 57.4 / $0.3256 / 8/8 |
| notes-api | 247.4 / $0.5959 / 13/13 | 157.3 / $0.5534 / 13/13 | 228.7 / $0.4842 / 13/13 |
| cart-coupons | 90.3 / $0.4691 / 11/11 | 104.4 / $0.5150 / 11/11 | 124.8 / $0.5800 / 11/11 |
| project-tracker-api | 340.3 / $0.8693 / 32/33 | 397.2 / $1.1618 / 32/33 | 269.6 / $0.9505 / 32/33 |

The first nine archived and passed clean installation; the tracker failed and
remained `proven`.

## Findings retained for the next candidate

All three tracker runs passed 32/33 hidden cases but failed
`CASE_TESTS_EXIST`. The oracle requires at least 15 passing delivered tests and
requires those tests to reject the original seed implementation. v3.6.2
reported ten tests. Each repair session advanced Build/Prove without changing
the product because the harness returned no repair plan. The hidden failure
persisted, Land was withheld, and clean-install checks were not run.

Treat external-oracle repair and test adequacy as unresolved release findings.
Do not weaken the oracle or count `proven` as delivery. This observation does
not isolate a deterministic regression in the new skills.

Known spend across all runs is **at least $13.3974738**; the complete bill is
unavailable because v3.6.0 Python API has no cost result. Reserving its full $2
allowance bounds the experiment at $15.3974738 against the authorized $40.
These are sums of main-host CLI result costs and its allowances; independently
billed provider/reviewer cost was not measured. They are not an account invoice.

## Evidence retention

The private raw bundle is retained locally outside repository state:

```text
~/.local/share/changeloop/benchmarks/2026-10-08-v3.6.0-v3.6.2-1791472711421.tar.gz
SHA256 697f8869df77749cbc47c8ec9c8d425b0744e5c97105e136afe761097ebf1277
```

It contains all 30 run manifests, per-run integrity indexes, host streams,
oracle/proof/quality evidence, summaries, budgets, and experiment helpers.
Sources/worktrees and dependencies are excluded. The original ignored working
copy is `.foundation/test-results/benchmark/comparison-v3.6.1-v3.6.2-1791472711421/`.
The summary entry point is `summary-three-versions.json`.

Verify the archive checksum before extracting it into a fresh evidence directory;
verify each run's `integrity.json` before reuse. These tested tags are a historical
comparison cohort, not assurance for later candidates. Keep raw output and host
logs out of Git; retain a new curated dated report for every future release check.
