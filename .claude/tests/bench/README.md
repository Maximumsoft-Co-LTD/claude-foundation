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

## What's measured (4 dimensions)

| Dimension | Signal | Source | Note |
|-----------|--------|--------|------|
| **Mechanism** | `spawn_count`, `cycles.{test,review}`, `skipped` | `state.json` (+ `dev-metrics.sh`) | deterministic — the primary proof a change worked |
| **Speed** | `duration_ms`, `phase_times` | envelope / `state.json` | noisy → median ≥3 repeats |
| **Cost** | `total_cost_usd`, in/out tokens, `num_turns` | `claude -p --output-format json` | the signal `state.json` doesn't carry |
| **Quality** | outcome-judge score (code diff vs acceptance) | `judge-outcome.sh` | arm-agnostic, so A/B is fair |

## Run it

Live runs cost tokens; everything defaults to **dry-run**. The comparison MATH is
unit-tested with no tokens, so a real verdict can be trusted.

```sh
sh tests/run-bench-tests.sh              # deterministic: prove the median/ratchet/AB math (free)
sh run-bench.sh                          # dry-run: print the plan
sh run-bench.sh --run --repeats 3        # live: 3 repeats/arm for stable medians
sh run-bench.sh --run --arm workflow     # workflow arm only (skip the A/B baseline)
```

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
```
