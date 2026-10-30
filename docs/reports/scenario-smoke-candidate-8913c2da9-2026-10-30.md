# Candidate smoke: `8913c2da9` vs retained v3.6.8-era rows vs no harness — 2026-10-30

**Status:** observed smoke evidence, n=1 per cell, eight lanes (seven small gates
plus the lifecycle lane), reported per lane. Seven lanes are strict green; the
lifecycle lane is a recorded checkpoint gap after three retained runs. This is
an explicit exception to the all-paid-lane checkpoint in
[RELEASING.md](../../RELEASING.md), not repeated assurance. No release decision
is recorded here. [ภาษาไทย](scenario-smoke-candidate-8913c2da9-2026-10-30.th.md)

## Scope and conditions

| Item | Value |
|---|---|
| Candidate | Clean `8913c2da9f59817b958165e5662094af1d5f9284` (four authority-continuity fixes after v3.6.8: content-bound approval across amendments and bookkeeping, landed-replay acceptance at Land with identity bridges, stale session leases parked instead of deadlocked, child-only Land archiving the amended sandbox packet; plus the shipped read-only permission allowlist) |
| Lifecycle run 3 source | `6005e473e` = candidate plus one bench-only change (the oracle-repair prompt grants one extra AI review wave); no shipped file differs from the candidate. Its tree was `dirty` from another session's untracked skill and change files, so that run is not an immutable baseline |
| Previous | Retained Change Loop rows from `9e612cbb7` (2026-10-22, seven commits before the `v3.6.8` tag `402a2eb7c`), five lanes. Not rerun today; same lab, same model |
| No harness | Retained `--arm baseline` rows from `0bd8c578e` (2026-10-15) and `3eb57e95d` (2026-10-16): same seeds and oracles, no Change Loop. Not interleaved with today's runs |
| Model | Host default `claude-sonnet-5-5` for implementation; the lifecycle lane's configured reviewer ran as `claude-opus` with the lab's independence and diversity waivers |
| Lanes | `tiny-feature`, `owner-only-delete`, `idempotent-refund`, `speed-up-search`, `regression-fix-with-fixes`, `security-hotfix`, `ml-eval-threshold`, `order-inventory-lifecycle` |
| Repeats | One per small lane. The lifecycle lane ran three times; all three are retained |
| Authority | User approved an eight-lane smoke with a recorded exception after the matrix grew to 29 paid lanes; estimated US$10–20. Measured spend US$11.68, all from host result envelopes |
| Deterministic gates | Full suite green on the VM for `8913c2da9` (one bench timing flake, repository-only); zero-cost sentinel pass; release preflight pass with the `release-portfolio-not-ready` advisory; upgrade matrix pass |
| Host | Claude Code only |

Per-run ceilings came from the matrix: US$5 for `tiny-feature`, US$3 for the other
six small lanes, US$60 for the lifecycle lane.

## Results: seven small lanes

Every cell reached `archived` with its hidden oracle fully passed, measured
quality with zero failures, and strict delivery (project command, clean install,
post-install project command). Cost is US$, time is wall seconds.

| Lane | Oracle | Cost | Time | Requests | Tool calls |
|---|---|---|---|---|---|
| `tiny-feature` | 8/8 | 0.3987 | 64.5 | 10 | 14 |
| `owner-only-delete` | 9/9 | 0.4571 | 94.1 | 12 | 21 |
| `idempotent-refund` | 12/12 | 0.5978 | 235.3 | 14 | 28 |
| `speed-up-search` | 11/11 | 0.4650 | 74.3 | 13 | 20 |
| `regression-fix-with-fixes` | 10/10 | 0.4397 | 65.7 | 13 | 20 |
| `security-hotfix` | 9/9 | 0.4472 | 85.0 | 13 | 22 |
| `ml-eval-threshold` | 9/9 | 0.4472 | 67.7 | 10 | 22 |
| **Total** | 68/68 | 3.2527 | 686.6 | 85 | 147 |

`idempotent-refund` carried one quality warning (no failure). No run hit
`CONTRACT_DECISION_REQUIRED`, an overwrite refusal, or a self-review verdict,
which were the blocking symptoms the candidate's fixes target.

### Versus the retained v3.6.8-era rows (five lanes)

| Arm | Cost | Time | Requests | Tool calls |
|---|---|---|---|---|
| Candidate `8913c2da9` | 2.4068 | 554.4 | 65 | 111 |
| Retained `9e612cbb7` (2026-10-22) | 2.2885 | 628.5 | 72 | 114 |

Candidate vs retained: +5.2% cost, −11.8% time, −9.7% requests, −2.6% tool calls.
With n=1 and non-interleaved batches this shows no regression, not a measured
speedup. Per lane: `security-hotfix` 85.0 s vs 141.0 s and `speed-up-search`
74.3 s vs 99.8 s are faster; `idempotent-refund` 235.3 s vs 224.7 s and
`owner-only-delete` 94.1 s vs 95.3 s are flat; `regression-fix-with-fixes`
65.7 s vs 67.7 s is flat. `tiny-feature` and `ml-eval-threshold` have no
retained row from that commit.

### Versus no harness (seven lanes)

| Arm | Cost | Time | Requests |
|---|---|---|---|
| Candidate `8913c2da9` | 3.2527 | 686.6 | 85 |
| No harness (retained, mean where two runs exist) | 1.5986 | 326.6 | 51.5 |

Ratio 2.03× cost, 2.10× time, 1.65× requests. The baseline reaches the same
oracle passes but produces no review, evidence receipts, clean-install proof, or
archive; the ratio is the price of those. The shortest lane carries the largest
ratio (`owner-only-delete` 3.8× time) because the harness's fixed cost dominates.

## Results: `order-inventory-lifecycle` (three runs, all retained, none strict)

The lane injects SIGKILL mid-Build, a mid-flight requirement amendment, a hidden
pre-Land oracle whose failures it reports as a user, a stacked second change,
and SIGKILL mid-Land. All three runs resumed the same change after the kill and
recorded the amendment. Each run then stopped at a decision the harness reserves
for the user, which the headless lane cannot answer. No run looped, lost
approval, or returned an unsatisfiable repair; every stop carried an exact
resume route.

| Run | Source | Cost | Time | Requests | Where it stopped | Oracle |
|---|---|---|---|---|---|---|
| 1 | `8913c2da9` clean | 1.3998 | 1906 | 64 | Prove's reviewer found the agent's own spec said zero stock is invalid while the fixture doc says it is valid; the agent replaced that requirement with a second amendment; `advance` asked for spec approval of the changed agreement | A 20/27 before Land; B not started |
| 2 | `8913c2da9` clean | 3.3895 | 2085 | 113 | Wave 1 (full) raised a blocker, wave 2 (delta) passed; the lane's oracle then reported a defect, the agent fixed it, and the re-prove needed a third wave; `advance` returned `review-exhausted` (2/2, high tier) | A 24/24 after one repair; B 7/7; nothing landed, final 7/27 |
| 3 | `6005e473e` dirty | 3.6418 | 2603 | 124 | The prompt's one-wave grant was used (`authority extend-review`); wave 3 raised two findings that the oracle repair had regressed (`R1-cancel-expired-regressed-to-200`, `R2-tenant-claim-ignored-regressed`); the agent repaired, but no wave or declared critical case remained to close them, so `advance` returned `review-route-exhausted`; a second grant with the same reference was refused | A 18/24 after three repairs; final oracle timed out |

Lifecycle spend US$8.4311. The previous green runs of this lane
(`3f472ee5e` 27/27, `04e516576` 26/27 on 2026-10-29) needed no oracle repair, so
they never reached a third review wave.

What this evidence does and does not say:

- The candidate's fixes hold: no authority loss across the amendment, no lease
  deadlock, no `CONTRACT_DECISION_REQUIRED`, and in run 3 the harness honored
  a user-granted wave once and refused its reuse, as the contract states.
- The stops are contract behavior at user gates (spec approval of a changed
  agreement; exhausted AI review). Whether a high-tier change should default to
  two AI waves when an amendment and a user-reported defect both occur is a
  product policy question for the maintainer, recorded as open.
- The agent's repair quality drove runs 1 and 3 (a self-contradicting
  scenario; regressions introduced while fixing an oracle case). That is an
  agent/model observation, not a harness finding.
- The candidate's change 4 (archiving the amended sandbox packet on a
  child-only Land) is covered by deterministic tests but remains unobserved in a
  paid lane: `amendment-in-archived-packet` was `unavailable` in all three runs
  because change A never archived.

## Limits

- Eight of 29 paid lanes; the standard-tier portfolio rows (`notes-api`,
  `cart-coupons`, `project-tracker-api`, `order-inventory`, and the sixteen
  three-dollar gates not listed above) were not run. This is an exception-level
  smoke, not the all-scenario checkpoint.
- The previous-release and no-harness arms are retained rows from earlier
  dates, not interleaved runs; n=1 per cell. Differences in either direction are
  not stable results.
- Lifecycle run 3 ran from a tree that other work had dirtied; its shipped
  files equal the candidate, but the run is disclosed as non-immutable.
- Self-review inside the disposable lab for the small lanes means review cost
  and independence of a real project are not represented.
- Claude Code only.

## Raw evidence

The ten run bundles (scorecards, manifests, `integrity.json`, source patches,
host streams, oracle and quality outputs, retained evidence trees) are archived
outside Git and disposable state:

```text
~/.local/share/changeloop/benchmarks/2026-10-30-candidate-8913c2da9-smoke.tar.gz
sha256 b9cbfc8557e6c6e48d180546def3075c44497db3eb32b725a2aabeeab3039937
```

The archive holds 653 files, including ten per-run `integrity.json` indexes that
content-bind each run's artifacts. Each run's manifest records its source
commit, `dirty` flag, and the frozen seed digest.

## Reproduce

```bash
# zero-cost gate first
npm run bench:openspec-native:sentinel
# one small lane; add --arm baseline for the no-harness arm
node .claude/tests/bench/openspec-native/lab.mjs --scenario owner-only-delete
# the lifecycle lane
node .claude/tests/bench/openspec-native/lab.mjs --scenario order-inventory-lifecycle
```

Paid runs need explicit user authority and a spend cap.
