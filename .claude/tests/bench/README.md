# Efficiency benchmark

Measures how the `/dev` workflow *performs* — not whether its artifacts are valid
(that's `../scenarios/`), but what a run **costs**, how much **machinery** it
uses, and how **good** the delivered code is. Answers three questions:

1. **Per-run scorecard** — for a task, what did a run cost (tokens/$/turns/ms),
   how many agents did it spawn, how many rework cycles, what quality score?
2. **Before/after** — did a change to the workflow make runs pricier / slower /
   lower-quality? (a regression ratchet)
3. **A/B vs no-workflow** — is the machinery worth it? Same task via `/dev` vs a
   plain "just build it" prompt, compared on cost and delivered-code quality.

## What's measured (5 dimensions)

| Dimension | Signal | Source | Note |
|-----------|--------|--------|------|
| **Mechanism** | `spawn_count`, `cycles.{test,review}`, `skipped` | `state.json` (+ `dev-metrics.sh`) | deterministic — the primary proof a change worked |
| **Speed** | `duration_ms`, `phase_times` | envelope / `state.json` | noisy → median ≥3 repeats |
| **Cost** | `total_cost_usd`, in/out tokens, `num_turns` | `claude -p --output-format json` | the signal `state.json` doesn't carry |
| **Quality** | outcome-judge score + `judge_sd`, `judge_p10` | `judge-outcome.sh` | arm-agnostic, so A/B is fair |
| **Reliability** | `ok`, `fail_reason`, `n_ok`, `ok_rate` | runner (watchdog + envelope) | separates a broken run from bad code |

### Reliability: why a failed run needs a reason

`ok=false` alone conflates two opposite problems — *the workflow wrote bad code*
and *we killed the run before it finished*. That is not hypothetical: a `/dev` arm
hit the 1800s ceiling, the judge then graded a half-built sandbox at **3/fail**,
and the scorecard read like a quality regression that never happened.

So a failed row carries `fail_reason`:

| Reason | Means |
|--------|-------|
| `timeout` | the watchdog ended it — nothing in the row grades the workflow; raise `BENCH_TIMEOUT` |
| `no_envelope` | exited without emitting JSON (stall / crash) |
| `api_error` | the envelope itself reports `is_error` |
| `exit_<n>` | exited nonzero on its own, envelope still parsed |

**`aggregate.sh` folds only `ok==true` rows into every median** and prints the
excluded tally beneath the table. `n` counts all rows, `n_ok` the usable ones.
When `n_ok == 0` every median is `null` — no measurement exists, and saying so
beats printing a number derived from wreckage. Rows written before `fail_reason`
existed classify as `unknown` rather than disappearing.

### Quality: the median hides the thing you're buying

Identical prompts have scored **9 and 4** on this suite. A median of 6.5 reads as
"mediocre but steady" when the truth is "a coin flip", so spread ships next to it:

- **`judge_sd`** — sample stddev (n-1). `null` at n<2: one run cannot estimate
  variance, and a `0` there would claim a consistency nobody measured.
- **`judge_p10`** — worst-case quality by nearest-rank. At n≤10 this *is* the
  minimum observed, which is the honest reading at these sample sizes. It answers
  "how bad does a bad day get" — exactly what a median is built to hide.

A workflow scoring 7±1 beats one scoring 8±4 for real work: the second means some
runs land at 4 and a human pays to clean them up. Read `judge_p10` before `judge_score`.

## Run it

Live runs cost tokens; everything defaults to **dry-run**. The comparison MATH is
unit-tested with no tokens, so a real verdict can be trusted.

```sh
sh tests/run-bench-tests.sh              # deterministic: prove the median/ratchet/AB math (free)
sh run-bench.sh                          # dry-run: print the plan
sh run-bench.sh --run --repeats 3        # live: 3 repeats/arm for stable medians
sh run-bench.sh --run --arm workflow     # workflow arm only (skip the A/B baseline)
sh run-bench.sh --run --out results/a.jsonl   # separate scorecard file (see below)
```

**Never run two benches into the same scorecard file.** Both truncate
`results/scorecards.jsonl` on start, so the second run destroys the first's rows —
this happened for real (a runner whose parent process died kept going and
overwrote a later run's results). Pass `--out <file>` for any concurrent or
salvage run; the runner also warns when the target was written in the last 90s.
`BENCH_TIMEOUT` (default 1800s) bounds each run — a full `/dev` arm on an app-sized
task can exceed 30 minutes, so raise it rather than let the watchdog kill a run
mid-cycle (a killed run yields no cost envelope and an artificially low judge score).

Then:

```sh
sh aggregate.sh results/scorecards.jsonl --table   # median per task/arm
sh compare.sh   --ab results/scorecards.jsonl      # is the machinery worth it?

# before/after ratchet:
cp results/scorecards.jsonl baselines/v2.12.jsonl   # set a reference (commit it)
# … change the workflow, re-run …
sh compare.sh --ratchet baselines/v2.12.jsonl results/scorecards.jsonl
```

`compare.sh --ratchet` fails (exit 1) if the workflow arm regresses: spawn_count
or cycles increase, cost exceeds baseline by more than `BENCH_COST_TOL` (default
20%), or the quality score drops. Mechanism regressions are deterministic;
cost/speed use the median and a tolerance because live runs vary.

## Tasks & arms

A task is `tasks/<name>/` with three files:

- `workflow.txt` — the `/dev` prompt (workflow arm; sandbox has the machinery)
- `baseline.txt` — a plain "just build it" prompt (baseline arm; bare repo)
- `acceptance.txt` — the criteria the outcome-judge grades BOTH arms against

Shipped tasks are greenfield `feat` (both arms build from the same empty sandbox
— the fair A/B start). For a brownfield task, add `tasks/<name>/seed/` — its
contents are copied into both sandboxes before the run as the starting code.

## Interpreting it honestly

- **Mechanism first.** A workflow change that cuts `spawn_count` with equal
  quality is a real, reproducible win. Trust it over a 5% cost delta.
- **Cost/speed need repeats.** One run is anecdote; use `--repeats 3`+ and read
  the median. A single number in a slide is noise.
- **Quality gates the cost story.** "Cheaper" only counts at equal-or-better
  judge score — `compare.sh` enforces that ordering in both `--ratchet` and `--ab`.
- **A/B is directional, not proof.** Two tasks and a judge model are a smoke, not
  a benchmark suite; widen the task set before drawing hard conclusions.
- **The workflow arm needs `/dev --yes` (supported).** `/dev`'s gate is a human
  approval (AskUserQuestion); the workflow prompts pass `/dev --yes` so a
  no-deviation gate auto-approves and the arm completes headless. Validated live —
  a full run went interview→…→ship→retro with `ok=true`. Two caveats it surfaced,
  both handled: (1) the `--output-format json` envelope UNDERCOUNTS tokens for a
  sub-agent-spawning run (`usage.*` sees only the top session) — trust
  `total_cost_usd`, not the token fields; (2) judge-outcome diffs against the
  recorded **base commit**, not HEAD, so code the ship phase already committed is
  still graded (diffing HEAD scored a completed run 0 because its code was in a
  commit). Measured once: a full `/dev` on a trivial CSV task ≈ **$5.6 vs $0.2**
  plain (~29×) — the machinery is heavy for XS-scale work, which is exactly what
  the micro-lane / fast path exists to avoid.
- **A judge score of exactly 0 is a parser smell, not a verdict.** The rubric asks
  for single-line JSON; models pretty-print anyway. The old reply parser ran
  `grep -o '{.*}'`, which is line-wise, so on a multi-line reply it selected the
  first *nested* object — usually `subscores` — which parses as valid JSON but has
  no `.score`. A `// 0` default then recorded a genuine 8/pass as **0/fail**.
  It stayed invisible until three `/dev` arms with wildly different behaviour
  (`spawn_count` 4, 4 and 0) all landed on exactly 0 while all eight baseline arms
  scored 8–10. `judge-outcome.sh` now parses the whole reply and treats a missing
  numeric `.score` as unjudgeable (exit 2 → `judge_score: null`), so the row drops
  out of the medians instead of manufacturing a quality failure. The parser is
  unit-tested off canned replies via `JUDGE_REPLY_FILE` — no tokens.

- **Keep the harness out of the graded diff.** `run-bench.sh` used to write
  `.bench-envelope.json` *inside* the sandbox, where `git add -A` swept it into
  the solution diff. Measured on a trivial CSV task: **33,370B of diff, of which
  1,805B was the actual solution — 94% harness noise**, and half the 60,000B cap
  spent before the judge read a line of code. Turn count drives envelope size, so
  a longer run pushes the real code off the end of the cap and the judge grades
  metadata. The envelope and the watchdog flag are now siblings of the sandbox,
  and `judge-outcome.sh` also excludes build caches (`__pycache__`, `*.pyc`,
  `node_modules`, `.venv`, `.pytest_cache`, `*.log`) — but NOT `dist/` or
  `build/`, which hold the deliverable for some tasks. After the fix the same
  task graded 2,759B with 2,296B of solution (3% of the cap). Truncation now
  warns on stderr instead of silently capping.

**Scorecards written before those fixes cannot be trusted on quality.** Cost, wall
time and mechanism telemetry in those rows are still good; only `judge_score` /
`judge_verdict` are suspect, and a `0/fail` on a run whose `ok=true` and cost is
substantial is almost certainly the harness, not the code.

**Inspect what a run actually built:** pass `--keep`. Sandboxes survive under the
printed `$SANDROOT`, and `results/` is gitignored, so copying one there is safe.
Without `--keep` every generated file is deleted when the run ends — which is how
two of the three bugs above stayed hidden as long as they did.
```
