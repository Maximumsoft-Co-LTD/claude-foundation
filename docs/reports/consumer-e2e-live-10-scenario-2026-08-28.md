# Consumer E2E live 10-scenario report — 2026-08-28

## Executive summary

Ten real disposable consumer repositories were run through headless `claude -p`
against Foundation source revision `f33d4b609ab447e59a9fd2988b872edb64dc62b2`.
The strict terminal result is **5/10**: five scenarios Landed, met acceptance,
and passed their ordinary project-owned verification command.

This is a material reliability improvement over the 2026-08-27 baseline. All
five initial `rc 0` envelopes corresponded to a runtime-confirmed passing proof;
there were **zero false-success initial envelopes**. After bounded recovery,
9/10 changes were proven. Six passed `land-check` and all six Landed. Three
additional proven changes were correctly blocked by the risk policy because the
disposable consumers had no signed CI provider. One scenario, the multi-module
money refactor, exhausted both budgets and remained incomplete.

The portfolio is not release-green. A Landed recent-window fix passed its focused
tests and proof but failed the hidden fractional-input oracle. The money-refactor
session edited the consumer root while runtime state was still `change`, never
created a Build sandbox, and left a failing, shape-breaking implementation in the
root. Task-list passed `npm test` only in the existing environment: a clean
`npm ci` fails because `package-lock.json` is not synchronized. Three high-risk
changes reached passing proof before learning that signed CI made Land
impossible. Consumer CRAP remains unmeasured because `/dev` did not activate a
consumer-owned quality configuration.

## Scope and method

- Foundation source: `f33d4b609ab447e59a9fd2988b872edb64dc62b2`
- Claude Code: 2.1.250
- Requested model: Sonnet
- Strict empty MCP configuration
- Fresh `install.sh <consumer> --yes` install in every disposable repository
- Initial cap: $6 and 2,400 seconds per scenario
- Recovery cap: $3 per active change
- Land cap: $2 per proven, `land-check`-green change
- Initial concurrency: five; recovery retry concurrency: two
- `/dev` stopped after Prove by contract; Land was a separate authorized session
- Model prose was never the verdict. Runtime state, `land-check`, archive state,
  project commands, and deterministic acceptance probes decided the result.
- The Foundation source checkout was clean before and after the exercise.

The first recovery wave encountered `ENOTFOUND` in all five sessions. Those
sessions and their costs remain in the measurements. A second bounded recovery
wave was run at concurrency two to distinguish transient provider failure from
product behavior.

## Quantitative result

| Measure | Result |
|---|---:|
| Consumer scenarios | 10 |
| Top-level Claude sessions | 26 |
| Initial `rc 0` / success envelopes | 5/10 |
| Initial sessions actually proven | 5/10 |
| False-success initial envelopes | 0/10 |
| Initial max-budget exits | 5/10 |
| Proven after bounded recovery | 9/10 |
| Green `land-check` | 6/10 |
| Signed-CI policy blocks | 3/10 |
| Successfully Landed | 6/10 |
| Strict Landed + acceptance + ordinary command green | 5/10 |
| Initial provider-reported cost | $47.72 |
| Total provider-reported cost | $59.68 |
| Mean total cost per scenario | $5.97 |
| Initial mean duration per scenario | 17.9 min |
| Initial median duration per scenario | 18.5 min |
| Initial duration range | 10.5–28.1 min |
| Parallel initial-suite wall time | 47.3 min |
| Full exercise wall time through verification | 126.9 min |
| Summed session duration | 265.7 min |
| Envelope turns | 2,000 |
| Transcript requests | 1,858 |
| Input context | 205.20M tokens |
| Output | 852.8K tokens |
| Input cache-read share | 98.69% |

Provider-reported cost is a lower bound. External review processes are not
guaranteed to be included in the owning top-level envelope. Context totals cover
the 27 matching transcript files found for this run, including one separately
recorded foreground reviewer transcript.

## Scenario results

| Scenario | Initial | Total cost | Lifecycle result | Delivered-quality result | Strict |
|---|---:|---:|---|---|---:|
| Task list | proven, 19.9 min | $3.21 | Landed; no active change | `npm test` 10/10, AC1–3 pass; `npm ci` fails on stale lockfile | PASS with reproducibility defect |
| Landing page | budget, 28.1 min | $7.33 | Recovered, proven, Landed | Project checker 33/33: content, offline, responsive, accessibility, contrast | PASS |
| Session token | budget, 22.8 min | $9.14 | Recovered and proven; Land blocked by required signed CI | Build sandbox 6/6 plus security-static pass; not delivered | FAIL — not Landed |
| Name migration | budget, 16.6 min | $7.61 | Recovered and proven; Land blocked by required signed CI | Build-sandbox migration tests pass; not delivered | FAIL — not Landed |
| API pagination | budget, 20.8 min | $7.28 | Recovered and proven; Land blocked by required signed CI | Build sandbox 9/9 including compatibility and pagination; not delivered | FAIL — not Landed |
| Rounding fix | proven, 18.0 min | $5.55 | Landed; no active change | Project tests 3/3 and additional fractional/whole-order reconciliation pass | PASS |
| Recent window | proven, 10.8 min | $3.36 | Landed; no active change | Focused tests 3/3, normalized oracle 5/6; positive fractional window still wrong | FAIL — acceptance |
| Contact search | proven, 12.4 min | $3.56 | Landed; no active change | Project tests 12/12; hidden oracle 5/5 | PASS |
| Money refactor | budget, 18.9 min | $9.57 | Recovery also exhausted; state remains `change`; no Build sandbox | Root modified before Build; ordinary test 8/9; oracle 0/7 and public shapes broken | FAIL — incomplete/isolation |
| Contact sorting | proven, 10.5 min | $3.07 | Root was edited before Land; Land recovered stale sync, re-Proved, and Landed | Project test and direct case/null/immutability probes pass | PASS with isolation incident |

## Per-scenario efficiency and quality

`Initial` is the first `/dev` duration. `Total time` is the sum of provider
durations across initial, recovery/provider-error, retry, and Land sessions for
that scenario; parallel portfolio wall time is therefore lower. Input is summed
request context, not the misleading top-envelope input field.

| Scenario | Sessions | Initial | Total time | Cost | Input context | Output | Quality | Speed | CRAP |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| Task list | 2 | 19.9 min | 20.4 min | $3.21 | 9.83M | 62.3K | Acceptance 3/3 and tests 10/10; clean install fails | Medium | Not measured |
| Landing page | 4 | 28.1 min | 42.5 min | $7.33 | 24.74M | 111.7K | Acceptance checker 33/33 | Slow; recovery required | Not measured |
| Session token | 3 | 22.8 min | 38.7 min | $9.14 | 32.68M | 118.0K | Sandbox tests 6/6 + security pass; not delivered | Slow; CI-blocked | Not measured |
| Name migration | 3 | 16.6 min | 32.8 min | $7.61 | 26.73M | 104.1K | Sandbox migration tests pass; not delivered | Slow; CI-blocked | Not measured |
| API pagination | 3 | 20.8 min | 37.5 min | $7.28 | 24.75M | 105.9K | Sandbox tests 9/9; not delivered | Slow; CI-blocked | Not measured |
| Rounding fix | 2 | 18.0 min | 19.0 min | $5.55 | 19.54M | 69.9K | Tests 3/3 plus reconciliation probe pass | Medium | Not measured |
| Recent window | 2 | 10.8 min | 11.4 min | $3.36 | 11.40M | 45.5K | Normalized hidden oracle 5/6; fractional input fails | Fast but wrong | Not measured |
| Contact search | 2 | 12.4 min | 13.2 min | $3.56 | 12.44M | 44.9K | Tests 12/12; hidden oracle 5/5 | Fast | Not measured |
| Money refactor | 3 | 18.9 min | 38.3 min | $9.57 | 33.18M | 141.3K | Ordinary tests 8/9; oracle 0/7; isolation failed | Slow; incomplete | Not measured |
| Contact sorting | 2 | 10.5 min | 11.8 min | $3.07 | 9.92M | 49.1K | Tests and direct acceptance pass; isolation incident | Fast | Not measured |

No numeric CRAP score exists for any row. Writing `0` would incorrectly mean
perfectly measured complexity/coverage; the truthful status is `Not measured`
because no consumer quality configuration/provider ran.

## Findings

### F1 — phase isolation still fails on a realistic M task (high)

`13-money-drift` remained in runtime phase `change`, but the consumer root had
modified `cart.js`, `discounts.js`, `invoice.js`, `money.js`, `report.js`, a new
test suite, and a new package manifest. No `.foundation/sandboxes/<change>` Build
workspace existed. The ordinary project command failed 1/9, and the deterministic
oracle scored 0/7 because exported public shapes were broken.

This is the exact wrong-side mutation the sandbox boundary is intended to stop.
The Stop gate prevented a false success, but it did not prevent or roll back the
unauthorized root writes.

### F2 — risk/CI authority is still discovered too late (high)

Session-token, migration, and API-pagination all spent initial and recovery
budgets, reached passing proof, and only then had `land-check` report that signed
CI was mandatory. Their Build implementations passed focused checks, but none
could be delivered in the disposable consumer setup.

Risk-based CI requirements should be computed during preflight, before Change or
Build spend. A headless caller needs a typed early result naming the required
issuer/public-key configuration and the fact that `--yes` cannot waive it.

### F3 — proof can pass and Land behavior that fails acceptance (high)

`11-recent-window` implemented `return n > 0 ? items.slice(-n) : []`. It fixes
zero and negative values but accepts positive fractional input. JavaScript
coerces `slice(-0.5)` to `slice(0)`, returning the full list. The change passed
review, proof, Land, and its three focused tests, then failed the hidden
fractional-input check.

The raw legacy oracle reported 4/6 because its test discovery includes
`test/*.js` but not the delivered `test/*.mjs`. A separate deterministic
FAIL-to-PASS check confirmed the `.mjs` suite does pin the original zero-window
defect, so the normalized result is 5/6 with only the fractional-input criterion
failing. The oracle topology should be repaired independently.

### F4 — reviewer execution is truthful but still inefficient (medium)

There were no false-success exits. However, migration reported two silently dead
background reviewer dispatches before recovering via a foreground reviewer.
API pagination killed three reviewer attempts with a session-selected timeout
that was too short before a fourth attempt completed. These retries increased
wall time and requests even though terminal truth held.

### F5 — a green project test can hide a non-reproducible install (medium)

Task-list passed all ten tests, but `npm ci` failed because the package name in
`package.json` was missing from `package-lock.json`. Tests were able to run only
because dependencies remained in the live disposable repository. A clean clone
would fail before reaching the suite. Proof should include the project-owned
clean-install path when a lockfile is changed.

### F6 — root mutation before Land occurred on sorting too (medium)

The sorting `/dev` session copied the proven Build result into the consumer root
before Land. `land-check` initially remained green, but Land detected stale
sandbox synchronization, ran `sandbox sync`, re-Proved, and then completed. The
recovery was correct; the pre-Land root mutation was not.

### F7 — consumer CRAP and changed-surface quality remain unmeasured (medium)

No consumer had `quality/foundation-quality.json`, a CRAP report, or an activated
quality provider. The installed policy's `quality.changeGate: warn` did not
materialize a measurement. Status is **not measured**, not zero and not pass.

### F8 — provider availability materially affected the exercise (operational)

All five first-wave recovery sessions ended with `ENOTFOUND` after 1–31 turns,
costing $2.22 in aggregate. Retrying at concurrency two cleared the network
failure. Provider-unavailable sessions were retained as inconclusive evidence and
included in all cost, request, and wall-time totals.

## What held

- Initial terminal truth held: every initial success was actually proven.
- Stop behavior held on all five initial budget exhaustions and on the incomplete
  money refactor; none was misreported as complete.
- Runtime state persisted across top-level recovery sessions.
- Land refused all three changes requiring signed CI; no bypass was attempted.
- All six `land-check`-green changes archived successfully and ended with no
  active change.
- The sorting stale-sync route recovered by synchronizing and re-Proving rather
  than applying an obsolete proof.
- The Foundation source checkout remained unchanged and clean.

## Recommended order

1. Enforce phase mutation blocking before the first root write, including large
   standard changes and post-Prove/manual-copy behavior.
2. Move risk-based signed-CI requirements into `/dev` preflight.
3. Bind acceptance oracles/critical boundary cases strongly enough that a proven
   change cannot Land with an explicit input class untested.
4. Make reviewer timeouts runtime-owned and bounded; do not let the model invent
   short kill windows.
5. Add clean-install/lockfile consistency to JavaScript consumer evidence.
6. Fix oracle discovery for `.mjs` under `test/` and similar supported topology.
7. Activate consumer quality configuration and CRAP measurement in the maintained
   lab portfolio before claiming quality-gate coverage.

## Post-run remediation

The missing-CRAP path found by this exercise was fixed after the measured run;
the historical scenario rows above were not retroactively assigned scores.

- Quality discovery now excludes installed Foundation internals, archived
  changes, and test-result directories from consumer language detection.
- JavaScript/TypeScript consumers can expose a CRAP provider through either
  `foundation:quality:crap` or `quality:crap`; the command must emit the typed
  `foundation-crap-v1` artifact at `.foundation/quality/crap.json`.
- Executable consumer changes without `quality/foundation-quality.json` now
  produce typed `QUALITY_NOT_CONFIGURED` and `CRAP_NOT_MEASURED` diagnostics.
- The maintained E2E procedure now requires quality discovery, initialization,
  and enforced doctor preflight before a paid Claude scenario is started.
- Regression coverage proves that a discovered CRAP command survives
  initialization and yields a numeric measured change lane.

Verification after the fix passed the focused discovery/runtime/diagnostics
tests, context-budget tests, documentation consistency checks, an installed
consumer smoke test, and all 181 shared Foundation suites.

## Evidence

Raw evidence is preserved at:

```text
/tmp/cf-consumer-e2e-20260828.SwjXTe/run
```

It includes initial, recovery, retry, and Land envelopes; stderr; timestamps;
consumer repositories; proof/archive state; patches; project-command output;
oracle output; and context metrics. The runner and aggregation scripts are in:

```text
/tmp/cf-consumer-e2e-20260828.SwjXTe/
```

The raw directory is temporary machine-local evidence and should be copied to a
durable artifact store if it must survive system cleanup.
