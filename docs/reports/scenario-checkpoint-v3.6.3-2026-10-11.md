# v3.6.3 candidate scenario checkpoint (2026-10-11)

[ภาษาไทย](scenario-checkpoint-v3.6.3-2026-10-11.th.md)

**Publication remains blocked.** Nine of ten scenarios satisfy strict delivery.
The tracker passes 32/33 oracle cases but fails `CASE_TESTS_EXIST`; it remains
`proven`, was not Landed, and has no quality or clean-install result.
These observations do not establish production assurance or a stable speedup.

## Source and execution boundary

- Candidate target: v3.6.3; tested clean preparation commit:
  `9f561b67ac5273e0712fd7537e5fcaf2146d441a`. Installed VERSION remains 3.6.2
  until the publication workflow performs the release rewrite.
- Ten paid scenarios, one initial attempt each, plus one selective tiny-feature
  retry; all eleven bundles pass their SHA-256 integrity indexes and preserve
  the exact source and frozen seed digests.
- Requested and stream-observed model: `claude-sonnet-5-5` in every run.
  Claude Code 2.1.296, Node v26.3.0, macOS 26.7 arm64; canonical macOS temp paths.
- Explicit user-authorized aggregate allowance: US$105. Scenario ceilings are
  the matrix defaults. Maximum concurrency four; one paid sentinel completed
  before the other nine were scheduled.
- Experiment-only instrumentation pins the model and deducts measured previous
  session costs before oracle-repair continuation. Unknown prior session cost
  stops paid continuation. The shipped runtime, fixtures and oracles are unchanged.
  The tiny-feature retry makes already authorized fixture specification/Build
  approval explicit and uses the remaining original allowance.

## Results and historical stable context

Cells are host seconds / measured main-host cost / oracle score. Current values
use the selected attempt; the initial tiny-feature stop remains below.
The previous stable values come from the
[retained v3.6.2 cohort](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.md),
source `50ad2ce4d5ceccb8bee0c1b8c44d5387617fadec`.

| Scenario | Current candidate | Historical v3.6.2 | Current terminal |
|---|---|---|---|
| bare-node-boundary | 50.6 / $0.3409 / 6/6 | 59.9 / $0.3589 / 6/6 | archived |
| typescript-react-state | 42.5 / $0.3197 / 6/6 | 60.9 / $0.4045 / 6/6 | archived |
| python-api-validation | 39.5 / $0.3145 / 5/5 | 47.4 / $0.3502 / 5/5 | archived |
| database-migration-rollback | 80.8 / $0.3237 / 6/6 | 87.6 / $0.3510 / 6/6 | archived |
| refactor-no-reproduction | 45.3 / $0.3197 / 6/6 | 63.4 / $0.4122 / 6/6 | archived |
| multi-service-event-flow | 96.7 / $0.3543 / 6/6 | 118.0 / $0.4251 / 6/6 | archived |
| tiny-feature | 33.7 / $0.2893 / 8/8 | 57.4 / $0.3256 / 8/8 | archived |
| notes-api | 135.2 / $0.5003 / 13/13 | 228.7 / $0.4842 / 13/13 | archived |
| cart-coupons | 103.7 / $0.5047 / 11/11 | 124.8 / $0.5800 / 11/11 | archived |
| project-tracker-api | 390.0 / $1.1146 / 32/33 | 269.6 / $0.9505 / 32/33 | proven; failed |

The nine successful selected attempts reach `archived`, pass the pre-Land
hidden oracle, measured quality, ordinary project command, clean installation,
and the post-install project command. Tracker passes eleven delivered tests;
the hidden adequacy criterion requires at least fifteen passing tests that also
reject the original seed. No criterion was weakened.

The stable batch used Claude Code 2.1.294, concurrency eight and US$2 per
scenario. This batch uses different allowances, concurrency and host version;
the batches are non-interleaved and have n=1 without spread. They are not a
matched-budget performance comparison. The table compares observed task
outcomes as historical context only; no aggregate speed/cost improvement is claimed.

## Findings and selective repair

1. The initial tiny-feature host stopped at specification approval before Build:
   35.4 host seconds, US$0.2247395, eight observed model requests, oracle and
   quality unavailable. The benchmark had not stated its spec approval explicitly.
   A fresh selective retry with explicit fixture authority passed all eight
   oracle cases, archived and passed clean installation. Its allowance was
   reduced by the measured first attempt; both attempts are retained.
2. Tracker reproduces the stable cohort's `CASE_TESTS_EXIST` failure. Its eleven
   passing tests are below the hidden adequacy threshold. Oracle-repair continuation
   received no repair tasks, made no edits, and narrated that the failure had
   cleared. The repeated oracle still failed 32/33; narration is not evidence.
   Repair task invalidation/continuation and test adequacy before a new checkpoint.
3. The runner's merged-session scorecard reports only the final result envelope's
   cost for tracker (US$0.1386859), omitting the first session's US$0.975896.
   The retained audit sums both envelopes: US$1.1145819 for tracker and
   **US$4.6064739 across all eleven attempts**, with no unavailable host-cost result.
   This is measured main-host CLI cost, not an account invoice; independently
   billed provider/reviewer cost was not measured.

## Retention and continuation

Private raw bundles, helper instrumentation, budgets, progress, summaries and
per-run integrity indexes are retained outside Git and disposable state:

```text
~/.local/share/changeloop/benchmarks/2026-10-11-v3.6.3-candidate-1791733256467270000.tar.gz
SHA256 be81a9169cfc8af72c1bb1ac0f67be0856829083a54094d5640846a9c1a87ee4
```

The ignored working copy is
`.foundation/test-results/benchmark/v3.6.3-20261011/`; `summary.json` records
all attempts and `retention.json` points to the checked archive. Verify the
archive checksum and each `integrity.json` before reuse. Earlier local audit
archives are superseded by the cumulative-session-cost archive above.

The required checkpoint in [RELEASING.md](../../RELEASING.md) is not green.
Do not publish v3.6.3 or transfer this evidence to a changed product source.
Repair the tracker continuation/test-adequacy finding and merged-session cost
accounting through a new scoped product change, then retain fresh candidate
evidence and all prior failures. There is no live disposable consumer to resume;
the failed consumer was removed after its evidence was preserved.
