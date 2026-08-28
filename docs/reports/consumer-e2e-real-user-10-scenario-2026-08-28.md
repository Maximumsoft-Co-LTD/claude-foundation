# Consumer E2E: 10 real-user scenarios — 2026-08-28

## Executive summary

Ten disposable consumer repositories were installed from the current
Foundation worktree and exercised with real headless `claude -p` sessions using
natural `/dev` requests. The strict result is **5/10 PASS**. Eight changes
Landed, one security change was correctly blocked by signed-CI policy, and one
UI change never progressed beyond Change despite two success envelopes.

The result is not release-green. Task-list Landed and passed unit plus browser
E2E tests, but a clean `npm ci` failed. Recent-window Landed with its focused
suite green but failed the hidden negative/fractional-window case. Money-refactor
Landed with its five project tests green but scored only 4/7 on the independent
oracle, breaking discount ordering, persisted-money interpretation, and an
already-correct order. Landing-site returned success twice while runtime state
remained `change`, and its root was modified without an isolated Build sandbox.

Consumer CRAP is measured in this run. Code scenarios passed quality discovery,
initialization, and enforced doctor before Claude was invoked. The HTML-only
landing scenario records CRAP as not applicable.

## Method

- Foundation commit: `f33d4b609ab447e59a9fd2988b872edb64dc62b2`
- Input worktree: the uncommitted CRAP-discovery/diagnostics remediation under
  test, captured as a binary patch before the run
- Claude Code: 2.1.250
- Requested model: Sonnet; actual terminal envelopes used `claude-sonnet-5`
- Strict empty MCP configuration
- Initial budget: $6 and 2,400 seconds per scenario
- Recovery budget: $3 per unfinished change, concurrency two
- Land budget: $2 per deterministic `land check`-green change
- Initial concurrency: five, in two waves
- Quality preflight: `quality discover`, `quality init --write`, and
  `quality doctor --enforce` before every paid initial session
- Verdict source: runtime state, `land check`, archive state, project commands,
  clean-install checks, and independent acceptance oracles; model prose and
  process exit codes were not treated as verdicts
- The source worktree status after the portfolio exactly matched its captured
  pre-run status.

CRAP was produced by the disposable portfolio's provider: a file-level
cyclomatic-decision estimate combined with Node's measured function coverage,
using the standard CRAP formula. A post-run provider correction added discovery
of root-level `*.test.js` files; final scores below use that corrected measurement.
`Max CRAP` is the highest file-level score and `Mean` is the mean across measured
application files. These values measure complexity/coverage, not semantic
correctness.

## Portfolio totals

| Measure | Result |
|---|---:|
| Consumer scenarios | 10 |
| Claude sessions | 24 |
| Initial success envelopes | 5/10 |
| Initial changes actually ready to Land | 4/10 |
| False-success initial envelopes | 1/10 |
| Ready to Land after bounded recovery | 9/10 |
| Deterministic Land-ready checks | 8/10 |
| Signed-CI policy blocks | 1/10 |
| Successfully Landed | 8/10 |
| Strict PASS | 5/10 |
| Initial cost | $48.00 |
| Recovery cost | $10.39 |
| Land cost | $1.77 |
| Total provider-reported cost | **$60.16** |
| Summed provider duration | 244.5 min |
| Portfolio wall time through aggregation | approximately 96 min |
| Turns | 1,855 |
| Input context | 199.49M tokens |
| Output | 931.3K tokens |
| Cache-read share | 98.59% |

## Per-scenario result

`Time` is summed provider duration across initial, recovery, and Land sessions;
parallel portfolio wall time is lower. `Input` includes direct, cache-creation,
and cache-read input. Speed is Fast below 15 minutes, Medium from 15 through 30,
and Slow above 30. For CRAP, `before → after` shows maximum score; parenthesized
values show final mean and function coverage.

| Scenario | Lifecycle / quality result | Time | Cost | Input | Output | Speed | CRAP | Strict |
|---|---|---:|---:|---:|---:|---|---|---|
| Task list | Landed; unit 10/10 and browser 3/3 pass; clean `npm ci` fails because lockfile and package manifest are out of sync | 32.8m | $7.18 | 24.02M | 106.7K | Slow | new → **5.00** (mean 3.00, 100%) | FAIL |
| Landing site | Two success envelopes, but state remains `change`; root HTML/tests written before Build; browser test dependency absent | 25.7m | $5.54 | 16.18M | 124.9K | Medium | N/A — HTML-only | FAIL |
| Session token | Proven; tests 7/7 and security-static pass; correctly blocked from Land by required signed CI; root changed without an isolated Build sandbox | 26.3m | $6.84 | 22.99M | 99.9K | Medium | new → **13.00** (mean 9.00, 100%) | BLOCKED CORRECTLY / not delivered |
| Name migration | Landed; migration/shape/store tests 3/3 pass | 20.1m | $5.25 | 17.93M | 80.1K | Medium | 2.00 → **3.00** (mean 3.00, 100%) | PASS |
| API pagination | Landed; pagination, validation, compatibility and consumer tests 12/12 pass | 28.4m | $8.20 | 27.82M | 111.9K | Medium | 2.00 → **5.00** (mean 3.00, 100%) | PASS |
| Rounding fix | Landed; project tests 2/2 and three additional reconciliation baskets pass | 14.0m | $3.05 | 9.57M | 47.0K | Fast | 2.00 → **1.00** (mean 1.00, 100%) | PASS |
| Recent window | Landed; focused tests 6/6 pass; hidden oracle 5/6 because negative/fractional windows still return rows | 34.3m | $8.93 | 30.07M | 141.8K | Slow | 6.00 → **5.39** (mean 2.37, 75%) | FAIL |
| Contact search | Landed; project tests 10/10 and hidden oracle 5/5 pass | 9.9m | $2.88 | 9.23M | 40.5K | Fast | 6.00 → **6.00** (mean 4.00, 100%) | PASS |
| Money refactor | Landed; project tests 5/5 pass, but hidden oracle only 4/7: discount ordering, persisted precision, and collateral behavior fail | 39.3m | $8.85 | 30.02M | 134.8K | Slow | 20.00 → **4.01** (mean 2.51, 90.48%) | FAIL |
| Contact sorting | Landed; project test and independent case/null/immutability checks pass | 13.6m | $3.43 | 11.66M | 43.8K | Fast | 6.00 → **4.00** (mean 2.50, 100%) | PASS |

## Findings

### F1 — success envelopes can still contradict runtime state (high)

Landing-site returned an initial success after 18.7 minutes and a recovery
success after another 7.0 minutes. Runtime remained at `change` after both. The
consumer root contained `index.html`, tests, and result files, while no isolated
Build sandbox existed. This is both false terminal success and wrong-side phase
mutation. A headless caller relying on process success would be misled twice.

### F2 — proof and Land still miss explicit semantic acceptance (high)

Recent-window passed six focused tests, Prove, `land check`, and Land, but the
independent oracle scored 5/6: negative and fractional limits still return rows.
Money-refactor passed five focused tests, Prove, `land check`, and Land, but the
oracle scored 4/7. It changed discount order, reinterpreted persisted dollar
values, and broke an already-correct order. The CRAP score improved sharply for
money-refactor, demonstrating that complexity/coverage cannot substitute for
semantic acceptance.

### F3 — clean-install reproducibility is still outside proof (medium)

Task-list passed ten unit tests and three Playwright journeys, then Landed. A
clean `npm ci` failed because `package.json` and `package-lock.json` were not in
sync. This repeats the prior portfolio's reproducibility defect.

### F4 — phase isolation also failed on the security scenario (high)

Session-token reached passing proof, but the consumer root contained modified
package metadata and new implementation, test, security, and script files while
the change remained active. No isolated Build sandbox existed. Signed-CI policy
correctly prevented delivery, but did not prevent root mutation beforehand.

### F5 — signed-CI classification changed materially (medium)

Only session-token required signed CI in this run. Migration, API pagination,
and the multi-file money refactor all passed `land check` and Landed. The prior
portfolio classified migration and API as requiring signed CI. Risk
classification needs a deterministic audit to determine whether the new result
is intended policy or model-dependent grounding drift.

### F6 — numeric CRAP is now present and useful, but not a correctness verdict

All nine code scenarios produced numeric final CRAP reports; the UI-only scenario
correctly reports N/A. Money-refactor improved max CRAP from 20.00 to 4.01 while
failing three semantic acceptance criteria. Recent-window also improved max CRAP
while retaining the known boundary defect. CRAP should remain one quality lane,
never the portfolio's delivered-quality verdict.

### F7 — recovery is effective for persisted code changes, but not universal

Five of six recovery sessions reached `ready-to-land` within the $3 cap.
Task-list, session-token, API pagination, recent-window, and money-refactor all
resumed successfully. Landing-site returned success without advancing state, so
the same recovery mechanism does not reliably handle an incomplete Change.

## What held

- Quality preflight completed before paid model work for every scenario.
- No provider/network failure occurred across 24 sessions.
- Runtime correctly blocked session-token Land without signed CI.
- Eight `land check`-green changes archived and ended with no active change.
- Persisted state enabled five bounded recoveries to reach Prove.
- Contact-search, rounding, migration, API compatibility, and sorting passed
  both lifecycle delivery and their independent/project-owned checks.
- The Foundation source worktree was not mutated by any consumer session.

## Recommended order

1. Make terminal `/dev` success conditional on runtime-confirmed Prove state;
   return a typed failure whenever the lifecycle remains at Change or Build.
2. Enforce root-write blocking before Build sandbox creation, including UI and
   high-risk security changes.
3. Bind independent acceptance classes into Prove strongly enough to catch the
   recent-window and money-refactor failures before Land.
4. Add clean-install/lockfile consistency to JavaScript proof evidence.
5. Audit deterministic risk classification for migration, API compatibility,
   and multi-file financial refactors.
6. Keep the corrected root-test discovery in the maintained lab CRAP provider.

## Evidence

Raw prompts, preflight reports, CRAP before/after artifacts, Claude envelopes,
stderr, patches, timestamps, lifecycle state, test logs, oracles, and aggregation
are preserved under:

```text
/tmp/cf-consumer-e2e-real-20260828.Z0qrVw/run
```

The temporary runner, recovery/Land scripts, CRAP provider, verification script,
and aggregator are in:

```text
/tmp/cf-consumer-e2e-real-20260828.Z0qrVw
```
