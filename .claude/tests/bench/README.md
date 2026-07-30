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
| **Reliability** | `ok`, `fail_reason`, `n_ok`, `ok_rate` | runner (watchdog + envelope + `done_at`) | separates a broken run from bad code |
| **Provenance** | `workflow_sha`, `spawn_observed` | `git rev-parse` + guard-hook ledger | says which `/dev` ran, and counts spawns independently |

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
| `incomplete_at_<step>` | `state.json` has no `done_at` — the run stopped early **and exited cleanly** |
| `blocked_at_<step>` | the orchestrator recorded a `BLOCKED:` note and halted for a human — **not a workflow failure** (see below) |

### `blocked_at_*` is the pipeline succeeding, and the scorecard calls it a failure

This is an **outcome-validity** hole, not a bookkeeping nit. Measured at M on
`13-money-drift`: one run wrote spec/plan/tasks/test-plan, then its `lead` caught a
real contradiction — the round-half-up default chosen at interview conflicts with AC6,
because `A-1004` (8.01 × 0.5 = 4.005) and `A-1005` (4.01 × 0.5 = 2.005) are *both*
exact half-cents. It recommended round-half-even, showed that it satisfies AC1–6 with
all five fixture totals byte-identical, and **refused to auto-resolve under `--yes`**
because the choice belongs to a human. The same ambiguity is what **4 of 6 plain-prompt
runs silently guessed wrong**, failing AC1/AC3/AC7 on the oracle.

That is the pipeline doing the one thing a plain prompt cannot. It scores `ok=false`,
folds into no median, and contributes nothing to any A/B — so **the harness cannot
currently observe `/dev` succeeding at its actual job.** Any M-tier verdict built on
`ok=true` rows alone is measuring only the runs where nothing needed a human.

Until the runner reports it separately, read `blocked_at_*` by hand before concluding
anything about M: `jq -r 'select(.fail_reason|startswith("blocked_at"))' results/*.jsonl`
and then read the run's `state.json > notes`. A substantive `BLOCKED:` clause naming a
real contradiction is a **design-phase success with no code**; an empty or procedural
one is a stall. The two look identical in the `ok` column.

`incomplete_at_*` is the quiet one. A `/dev` run that halts at the gate returns a
healthy envelope, so the row looked like a success: `ok=true`, no error, the judge
simply finding no code. One such run — stalled on its own benign `Docs: light`
deviation — burned **$2.80 over 640s and delivered zero lines**, and nothing in the
scorecard said so. `done_at` is the run's own completion stamp; its absence is the
only reliable signal, because the exit code lies.

`spawn_count` vs `spawn_observed`: the first is what the orchestrator wrote into
`state.json`, the second is counted by `dev-agent-guard.sh` on the spawns it
actually saw. They have disagreed — a run reported `spawn_count: 0` while its own
notes said "combined lead spawn". **Trust `spawn_observed`**; a gap between them is
a finding about the orchestrator's bookkeeping, not about the run.

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

### The judge is not an AC oracle — measured, 2026-07-30

`judge-outcome.sh` asks a model whether a diff meets the task's prose acceptance
criteria. `grade-oracle.sh` asserts each criterion directly — no model, no tokens,
no variance. Running both over 12 kept sandboxes on `11-recent-window` (6 `/dev`,
6 plain baseline) produced the same answer twelve times, and it was not the judge's:

| arm | judge (median) | oracle | AC4 |
|---|---|---|---|
| `/dev` workflow | 9 · all pass | **5/6** | **fails 6/6** |
| vibe baseline | 10 · all pass | **5/6** | **fails 6/6** |

Every run — both arms — ships

```js
if (n <= 0) return [];
return items.slice(-n);
```

which handles zero and negatives and **puts bug #412 straight back for any
fractional window**: `lastN(items, 0.4)` → `slice(-0.4)` → `slice(0)` → the entire
array, the 900-row hang the ticket describes. `acceptance.txt` AC4 names this in so
many words ("NEGATIVE AND **NON-INTEGER** INPUT does not resurrect the bug"). The
judge scored those diffs 8–10 and called all twelve `pass`.

Three things follow, and they change how every quality number in this file reads:

- **A judge score is not evidence an AC holds.** It was already known that the
  judge graded one run 9/pass while failing AC4 and AC5; that was treated as an
  anecdote. At n=12 with a deterministic oracle beside it, it is the normal case.
  Quote `judge_score` for *simplicity* and *fit* — the dimensions no test can
  express — and cite the oracle for anything of the form "the criteria are met".
- **The judge's between-arm difference on this task is noise.** It ranked the
  baseline **higher** (10 vs 9) than `/dev` while both were objectively identical
  at 5/6. Any A/B verdict that rested on a 1-point judge gap on this task rested
  on nothing.
- **`/dev` and a plain prompt are equally correct here, at 7.4× the price.** That
  is the `XS/S value check` in `orchestrator.md`, now measured objectively instead
  of inferred from a model's opinion — and the pipeline's core claim (that it
  surfaces requirements the user never stated) **failed on this instance for both
  arms**: AC4 appears in neither prompt, and neither arm found it.

```sh
sh grade-oracle.sh <sandbox-dir> 11-recent-window   # per-AC pass/fail, $0
```

Oracles live in `tasks/<task>/oracle/` and are **never** copied into a sandbox
(`run-bench.sh` copies only `tasks/<task>/seed/`), so they cannot leak the answer
key the way `.claude/tests` once did. AC1 is a SWE-bench **FAIL_TO_PASS** check —
the shipped suite must pass on the delivered tree *and fail* once the pristine
`window.js` is restored, because a suite that stays green does not pin the bug.
The oracle itself is pinned by four fixtures in `fixtures/oracle-11/` with verdicts
known by construction (`good` 6/6, `trap-feed` 3/6, `no-test` 5/6, `collateral`
5/6) — an unvalidated oracle is worse than no oracle. Only `11-recent-window` has
one so far.

**Watch for this when writing the next oracle:** `node --test <dir>` prints
"Could not find" and still **exits 0** on Node 26, which scores a sandbox with zero
tests as a green suite. Pass explicit file paths and run from inside the tree.

## Run it

Live runs cost tokens; everything defaults to **dry-run**. The comparison MATH is
unit-tested with no tokens, so a real verdict can be trusted.

```sh
sh tests/run-bench-tests.sh              # deterministic: prove the median/ratchet/AB math (free)
sh run-bench.sh                          # dry-run: print the plan
sh run-bench.sh --run --repeats 3        # live: 3 repeats/arm for stable medians
sh run-bench.sh --run --arm workflow     # workflow arm only (skip the A/B baseline)
sh run-bench.sh --run --out results/a.jsonl   # separate scorecard file (see below)
sh run-bench.sh --run --arm design        # Phase 1 only — 62% cheaper, 57% faster
sh run-parallel.sh --arm design --tasks 09-api-compat --repeats 3 --out results/d.jsonl
```

**Never run two benches into the same scorecard file.** Both truncate
`results/scorecards.jsonl` on start, so the second run destroys the first's rows —
this happened for real (a runner whose parent process died kept going and
overwrote a later run's results). Pass `--out <file>` for any concurrent or
salvage run; the runner also warns when the target was written in the last 90s.

**A live bench outlives most shells that start it.** Three repeats of an S-tier
task run 30–70 minutes, longer than the timeout on many agent/CI shell wrappers.
When the parent is reaped mid-run the runner's `claude` children are **orphaned,
not stopped** — they keep spending tokens with nobody left to collect the envelope
or write a row. Start long runs in their own session so the parent survives:

```sh
nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- \
  sh run-bench.sh --run --arm workflow --tasks 08-name-migration --repeats 3 \
  --out results/bf08-before.jsonl > results/bf08-before.log 2>&1 &
```

Check liveness with `pgrep -fl run-bench.sh`, not `ps | grep` — the runner's
command line is long enough to be truncated out of a `ps` match, which reads as
"the run died" when it is healthy and mid-repeat. **The progress file is silent
between repeats by design**: it only updates at run boundaries, so a run in its
fifteenth minute looks identical to a dead one. To abort, `pkill -f run-bench.sh`
**and** `pkill -f "claude -p /dev"` — the runner alone leaves the children behind.

**That runaway runner had a cause, now fixed.** `trap cleanup EXIT INT TERM` with a
`cleanup` that doesn't `exit` **swallows** the signal: the handler runs — deleting
`$SANDROOT` — and the script resumes at the next statement. Every later repeat then
ran against a sandbox root that no longer existed and appended `no_envelope` rows,
and `kill`/Ctrl-C could not stop it. Reproduced live while collecting the brownfield
baseline: eight unkillable runners racing garbage into two scorecard files. `INT`/
`TERM` now clean up **and exit** (`EXIT` alone still just cleans up), and
`tests/run-bench-tests.sh` TERMs a runner behind a `claude` stub to prove it dies
and writes no rows. If you ever see a scorecard full of `no_envelope` rows with
tiny `wall_s`, this is the shape to look for: the runner outlived its children.
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

# did an optimisation pass actually pay? (the ratchet's mirror image)
sh compare.sh --gain baselines/v2.12.jsonl results/after.jsonl --target 0.5
```

### Where the wall clock goes — `profile-phases.sh`

The scorecard says a run cost $6.50 and took 845s; it does not say which phase
spent it. `state.json > phase_times` does, and `profile-phases.sh` turns those
stamps into durations, shares and a stage roll-up — free, no model, reading only
`--keep` sandboxes:

```sh
sh profile-phases.sh --find --root /var/folders/xv --task 09-api-compat --newer 5400
sh profile-phases.sh /path/to/sandbox/.workflow/0002-feat-…    # explicit dirs
```

Two things it gets right that a naive reading does not. **Phases written in ONE
state write share a stamp** — the combined Design write stamps spec/plan/test-plan
identically — so those collapse into a single `spec+plan+test-plan` row instead of
three zeros and one real number. And **a block spanning two stages is reported as
`MIXED:`, never split**, because dividing an unseparable block across buckets
invents a number the stamps do not contain. Always pass `--task` and `--newer`:
mixing configurations in one profile averages away the thing you are looking for,
since a change's before and after land in the same column.

`--ratchet` and `--gain` ask opposite questions and you need both. The ratchet is a
**guard**: it passes a run that costs 19% *more*, because its job is to catch
regressions, not to reward savings. `--gain` is the **goal**: it prints the per-task
and suite-total cost/wall deltas and, with `--target 0.5`, fails unless BOTH dropped
by half. Its quality rule is not opt-in — a judge-score drop fails at any saving,
with or without a target, the same ordering `--ratchet` and `--ab` enforce. A task
whose rows are all `ok=false` on either side fails a targeted run rather than
reporting a delta against a null: an unmeasured task cannot be claimed as a win.

`compare.sh --ratchet` fails (exit 1) if the workflow arm regresses: spawn_count
or cycles increase, cost exceeds baseline by more than `BENCH_COST_TOL` (default
20%), or the quality score drops. Mechanism regressions are deterministic;
cost/speed use the median and a tolerance because live runs vary.

## Tasks & arms

A task is `tasks/<name>/` with four files:

- `workflow.txt` — the `/dev` prompt (workflow arm; sandbox has the machinery)
- `baseline.txt` — a plain "just build it" prompt (baseline arm; bare repo)
- `design.txt` — `/dev --yes --plan-only`: Phase 1 only, stops at the gate
- `acceptance.txt` — the criteria the outcome-judge grades the first two against

### The design arm — iterate in a third of the time

A full workflow arm is 12–25 minutes and $5–9, so a 6-run verdict cycle is ~30
minutes and ~$35. That is too slow to iterate on, and most workflow changes are
**structural** — who writes an artifact, how many spawns, which phase runs where.
Design alone is **39–49% of a brownfield-S run**, so `--arm design` measures the
phase most changes actually touch at roughly a third of the cost:

```sh
sh run-parallel.sh --arm design --tasks 08-name-migration --repeats 3 \
   --out results/d08.jsonl                                   # repeats run CONCURRENTLY
sh compare.sh --mechanism baselines/<ref>.jsonl results/d08.jsonl   # honest at --repeats 1
```

Measured on `09-api-compat`: a design run is **$1.86 / 357s** against the full
workflow arm's **$4.92 / 827s** — **62% cheaper, 57% faster**, `spawn_count 0`,
graded 10/pass with all five acceptance ids tasked and covered. With
`run-parallel.sh` the repeats overlap instead of queueing, so a 3-repeat, 2-task
design cycle is **~6 minutes and ~$11** where the equivalent workflow cycle is
~30 minutes and ~$35. Same tokens, a third of the waiting: repeats are independent
by construction (own sandbox, own envelope, own row), so serialising them bought
nothing but delay. Each child still writes its **own** scorecard file — sharing one
`--out` is the truncation incident documented above.

It is graded by **`grade-design.sh`** — deterministic, no model, no tokens, no
variance: artifact-lint clean, every acceptance id carries a delivering task, and
(feat/fix/refactor) every one carries a Coverage row. Because it is deterministic
it needs no repeats to be trusted, unlike cost and the outcome judge.

**What it cannot tell you** — whether the spec caught the requirements the user
never stated. That gap is the entire headroom rule below, and only delivered code
exposes it. A 10 here means "the design set hangs together", never "this is a good
design". Iterate on the design arm; **decide on the workflow arm.**

`--plan-only` is a real `/dev` mode, not a benchmark hook: it runs Phase 1 in full,
stops before implementing, and leaves the run resumable with `/dev --resume <id>`
(`orchestrator.md > Plan-only`). The design arm measures the same code path a real
`/dev` run takes — which the team-mode slice commands (`/spec`, `/dev-plan`) would
NOT, since they spawn `pm`/`lead`/`qa` per slice instead of drafting inline.

For a brownfield task, add `tasks/<name>/seed/` — its contents are copied into
both sandboxes before the run as the starting code.

### A task is only useful if the baseline can fail it

The first five tasks (csv, paginate, debounce, form-validator, task-list) are
greenfield pure functions, and a **plain prompt scores 10/10 on every one of
them**. That is the whole problem: a benchmark whose control is already perfect
has no headroom, so no change to `/dev` can show up as an improvement. Those five
still earn their place as a cost/latency baseline — they just cannot answer "is
the machinery worth it".

Discrimination comes from tasks with a **trap**: something a competent-looking
first draft gets wrong, written into `acceptance.txt` so the judge checks for it.

**The prompt must not contain the trap.** This was learned the expensive way. The
first draft of tasks 07–09 spelled every AC out in both arm prompts — including
"use a constant-time comparison" and "do not log the token" — and the plain
baseline scored **10/pass on all of them**. Of course it did: it had been handed
the answer key. Rewriting the prompts as what a person would actually type
("issue(userId) gives me a token, verify(token) tells me if it's good; sessions
last 15 minutes") while leaving `acceptance.txt` untouched moved the same baseline
to **7/pass** and **6/fail**.

So: `workflow.txt` and `baseline.txt` carry the **user's ask**; `acceptance.txt`
carries the **requirements the user never said**. That gap is the thing being
measured — a workflow earns its cost by surfacing unstated requirements, not by
following a list it was already given. A prompt that enumerates its own ACs
measures transcription, not judgement.

### The headroom has evaporated — re-measured 2026-07-29

The table below was written when the baseline arm still failed these tasks. On a
**fixed sandbox** (see the answer-key leak above) with n=3–4 per arm, it no longer
reproduces:

| task | ask | vibe-code baseline | `/dev` workflow | verdict |
|---|---|---|---|---|
| `08-name-migration` | precise | **$0.44 / 110s / judge 8** (7,8,9 — 0 fails) | $11.40 / 1310s / judge 9 | +1 point for **26×** |
| `11-recent-window` | precise | **$0.27 / 51s / judge 10** (9,10,10) | $2.81 / 432s / judge 9, 1 fail in 6 | **−1 point** for 10× |
| `12-contact-search` | deliberately vague | **$0.26 / 49s / judge 10** (10,10,9,10) | not run — 10/pass means no headroom | — |

`08`'s documented **6/fail** baseline was **n=1**; at n=3 it passes every time.
`12` was built specifically to test the workflow's core claim — a one-sentence ask
(*"give them a way to search it"*) hiding five unstated requirements including a
`name: null` row that crashes the naive `c.name.toLowerCase()`. The plain prompt
handled all of it unprompted.

**That claim was judge-based, and it now survives objective grading — 2026-07-30.**
Six fresh baseline runs on `12-contact-search`, graded by the deterministic oracle
rather than the model: **6/6 at 5/5 ACs**, every run building a
`contacts.js:searchContacts` that is case-insensitive, survives the `name: null`
row, returns the full list for an empty query, leaves `listContacts()` and
`addressBook()` intact, **and ships a suite that goes red when the search is swapped
for the naive `c.name.includes(q)`**. The plain prompt really does surface all five
unstated requirements here.

Read that beside the `11-recent-window` result above, where the same judge passed
12/12 diffs that objectively failed AC4. **The judge is not uniformly wrong — it is
unreliable in a way you cannot predict from its own output**, agreeing with the
oracle on one task and blind on another. Which case a given task is in is exactly
what the oracle exists to tell you, and it is why a headroom claim should be
re-checked with `grade-oracle.sh` before it is used to retire a task.

**Read this as a statement about model capability, not about workflow design.**
The suite was calibrated against a weaker generation; the base model now covers
what the pipeline used to add at this scale. What follows:

- **A no-headroom task cannot measure a workflow change.** Before trusting any A/B
  here, re-run the baseline arm — it is under a dollar — and check it still fails.
- **The remaining value of `/dev` at XS/S is not in the judged code.** It is the
  artifacts, the AC→test traceability, `--resume`, and the human gate — none of
  which `judge-outcome.sh` grades. Do not read "judge 9 vs 10" as "the workflow is
  useless"; read it as "the code-quality premium at this size is now zero", which
  is what `orchestrator.md > Size-aware execution > XS value check` exists to say.
- **The untested regime is M/L**, where coordination, disjoint-file fanout and
  multi-surface blast radius are the actual problem. Every task in this suite is
  XS/S. Any claim that the machinery pays must be earned there.

| Task | Headroom comes from |
|---|---|
| `06-landing-site` | non-functional ACs — no-CDN, one `h1`, 375px overflow, focus styles, dark mode |
| `07-session-token` | trust boundary — unsigned "tokens", `===` on a signature, caller-supplied `exp`, `Math.random()`, secrets in logs |
| `08-name-migration` | data loss — `name.split(" ")` blanks a mononym, drops a third name part, no backup, not idempotent |
| `09-api-compat` | contract break — returning `{data,total}` satisfies the ask and breaks every existing caller |
| `10-rounding-fix` | the `fix` lane's own discipline — pin the reported case with a regression test, and fix the money layer rather than the formatter that prints it |

`10-rounding-fix` was headroom-checked before any workflow arm ran it, per the rule
below: the plain baseline scored **8/pass at $0.43 / 97s** — short of the 10/pass
that would mean the task measures nothing, so the two points it drops are real
headroom. Its seed is verified to reproduce: order #1183 prints lines
4.97 + 1.52 + 11.18 = 17.67 against a total of 17.68, while whole-quantity orders
still reconcile — so "round everything" is not a free fix either.

Write the trap paragraph FIRST, then the ACs that catch it, then a prompt that
mentions **none of it**. If you cannot name a plausible way a good-faith attempt
fails, the task will score 10/10 on both arms and measure nothing.

**Check a new task before trusting it:** run the baseline arm alone
(`--arm baseline --tasks <name>`, well under a dollar). A 10/pass means the task
has no headroom yet — fix the task before spending a workflow arm on it.

## Interpreting it honestly

- **Mechanism first — but `spawn_count` is not where the money is.** Measured on
  the XS lane: cutting 4 spawns to 1 moved cost only **$4.78 → $4.18**. Trimming
  what stays *resident* (a shorter fast-path reference, an explicit value check,
  design written inline instead of spawned) took the same task to **$1.77 / 300s
  at an unchanged judge 10** — **−63% cost, −55% wall**. An XS run costs roughly
  `resident playbook × turns`; a spawn is a rounding error next to what every
  turn re-carries. Cut context and turns, not delegations.
- **The brownfield-S lane, measured end to end (2026-07-28).** Two tasks × 3 repeats
  per side, every run `ok=true`. Baseline: `08-name-migration` **$8.34 / 1516s /
  4 spawns / judge 7**, `09-api-compat` **$8.81 / 1357s / 4 spawns / judge 9**, ~102
  turns each. The phase clock said where it went — **Design was 39–49% of the wall
  clock in every run**, a cold `lead` spawn re-reading a 29 KB brief to re-derive the
  size, field and intent the orchestrator had just settled. Routing Design (and with
  it Implement, now warm) inline at S: **08 → $6.29 / 944s / 2 spawns / judge 9**,
  **09 → $5.49 / 693s / 2 spawns / judge 9**. Suite **−31.4% cost, −43% wall**,
  ratchet PASS, median quality up on one task and flat on the other. Two things this
  measurement is worth more than the numbers: (1) the artifacts did not change — the
  earlier attempt that *rationed* them lost 9/pass → 8/fail, and this one moved only
  who holds the pen; (2) **`judge_p10` on 08 went 7 → 6, crossing pass→fail**, so the
  median's improvement hides a worse bad day. Read the spread before quoting the win.
  A second pass adding the Guardrails-evidence rule (below) landed at **$6.38 / 934s
  (08)** and **$4.92 / 827s (09)** — suite **−34.1% cost, −38.7% wall**, `judge_p10`
  back to 7 on 08 and down to 8 on 09. The two passes differ by −4% cost and +7.6%
  wall, i.e. **less than this suite's own run-to-run spread at n=3** — so read them as
  one result (≈ −⅓ cost, ≈ −40% wall) rather than as a trend, and re-measure at
  `--repeats 5` before ranking them.
- **What reading the artifacts found that no metric did.** A `--keep` run on
  `08-name-migration` graded **9/pass** while silently failing two of its acceptance
  criteria — no backup or atomic write (AC4), and a test suite that exercised the
  name-splitting helper instead of the migration against a copy of the real fixture
  (AC5). The cause was upstream of the code: `plan.md > ## Current state` quoted the
  seed comment *"Do not change its contract"* and then appended *"never touches `fs`
  directly"*, which the comment never said. That inflation reached `tasks.md >
  ## Guardrails` — the engineer's only up-front invariant read — and so **forbade the
  temp-file-and-rename AC4 required**. A wrong guardrail costs more than a missing one,
  because it gets obeyed. `plan-writing` and `lead` now require each guardrail to say
  no more than its citation and to be cross-checked against the AC set (a guardrail
  that blocks an `AC#` is a `BLOCKER:`). **The judge did not catch any of this** —
  budget one `--keep` run per configuration and read what it built.
- **Chasing the last 15 points made it worse — the negative result.** With Design
  inline the lane sat at −34% cost / −39% wall, and the obvious next cuts were the
  two remaining spawns' worth of overhead: inline docs+ship at S, and stop keeping
  the M/L-shaped `phase-2-guards.md` resident on a lane that cannot reach most of it.
  Measured at n=3 per task, both together took `08-name-migration` from **$6.38 to
  $8.44** — a 32% cost regression that blew the ratchet, back to baseline cost — and
  widened `09-api-compat`'s quality to `judge_sd` **3.46** with a **4/fail**, the
  worst row in the whole programme. Suite: −19.6% cost / −29.2% wall, i.e. **worse on
  both axes than doing less**. Reverted. The lesson is the XS lane's, arriving from
  the other direction: inlining *relocates* work, and by the time S has Design and
  Implement in main, main is not the cheap place to put anything else. **Inlining
  docs+ship at S is now measured-and-rejected twice, on two different shapes** — the
  fast path and the size matrix both pin it, and `run-doc-consistency.sh` fails if a
  later pass quietly re-adopts it.
- **Review never fired, in 18 of 18 runs.** Across the whole brownfield-S programme
  (6 baseline + 12 post-change) every row carries `cycles_test = 0` **and**
  `cycles_review = 0` — the Test and Review phases never once routed a fix. That
  includes the run whose delivered migration overwrote the store with no backup
  (AC4) and tested the helper instead of the migration (AC5), and the rows the judge
  graded 6/fail and 8/fail. Review costs ~3 min and one of the two remaining spawns.
  Read this as a finding about the **review specification**, not a licence to delete
  the phase: `lead` Mode B is told to walk every AC against the diff with `path:line`
  evidence, and a walk that had actually reached AC4 would have seen the missing
  backup. Before trading the phase away for the ~10% it costs, fix the walk and
  re-measure — a cheaper workflow that ships the same acceptance failures is not the
  win the cost column makes it look like.
- **So the walk was strengthened, and it failed on both axes.** The rule: an AC that
  names a mechanism (a backup, an atomic write, an unchanged caller, a test against
  the real fixture) may be ticked only by pointing at that mechanism's line — "the
  code looks right" and "the suite is green" barred as evidence. It did change
  behaviour: `cycles.review` fired for the **first time in 25 runs**. It also took
  `09-api-compat` from **$4.92 to $7.37 (+50%)** while never routing a fix there,
  and `08-name-migration`'s judge median from **9 down to 7**. Ratchet: FAIL on both
  tasks. Reverted (`baselines/brownfield-s-strict-review-rejected.jsonl`). Two things
  survive it: a stricter reviewer is not automatically a better one — the extra
  walking cost 50% and bought a *lower* grade — and **`--mechanism` PASSED this
  configuration**, because spawn counts and median cycles were unchanged. That is
  precisely the blind spot its own tests pin, seen in the wild. If the walk is worth
  another attempt, scope it to the ACs that *name a mechanism* instead of to every
  AC, and measure it alone.
- **THE SANDBOX WAS LEAKING THE ANSWER KEY — every quality number predating
  2026-07-29 is suspect.** `setup_workflow` built the sandbox with `cp -R .claude`,
  which includes `.claude/tests/bench/tasks/<t>/acceptance.txt` — the graded
  criteria with the trap written out in plain English — plus every baseline and
  past result. The **baseline arm gets a bare repo and never saw it**, so only the
  workflow arm was handed the answer key: precisely the asymmetry the "a task is
  only useful if the baseline can fail it" rule exists to prevent, arriving via the
  sandbox layout instead of the prompt. Not hypothetical — a captured run ran
  `cat …/tasks/11-recent-window/design.txt` and Read `acceptance.txt` out of its
  own tree. `rm -rf "$s/.claude/tests"` now fixes it, pinned by two tests.
  Measured impact on `11-recent-window`: removing the crib moved the workflow arm
  from **$2.22 / 362s / 51 turns** to **$2.81 / 432s / 67.5 turns** — the leak was
  inflating *efficiency* as much as quality, because a run that can read the ACs
  skips the work of deriving them. **Re-earn any A/B or quality claim on the fixed
  sandbox; cost comparisons between two workflow configs survive** (both sides
  carried the leak equally).
- **Know the resolution floor BEFORE trusting a delta.** Pooled clean-sandbox cost
  on `11-recent-window` is mean **$2.72, sd $0.77** — so at n=6 the standard error
  is 12% of the mean and **nothing below ~23% is resolvable.** Two verdicts in one
  session were reported at −6.5% and −13% and then failed to reproduce: measured
  honestly, the session-start config came in at **$2.63** and the "optimised" one
  at **$2.81** — no improvement at all. Compute `2·sd/√n` first and refuse to
  report anything under it; a median that moved less than that is a coin landing.
- **Cost is not instruction bytes — but it is not playbook overhead either.** Two
  independent ~26 KB cuts to resident instructions moved cost **+16.4%** and
  **−0.3%**. Removing genuine round-trip waste (a `date -u` shell-out per
  timestamp, seven per run; the per-phase state ritual collapsing from 3 calls to
  1) cut tool calls **68 → 50** and still did not move clean-sandbox cost outside
  the noise floor. The conclusion those three results share: on a fair sandbox the
  run's turns go into **the work** — reading the seed, deriving requirements that
  were never stated, writing a regression test, reviewing — and the playbook
  overhead around that work is too small to matter. Optimise scope, not overhead.
  (`profile-turns.sh` still earns its place: it is how the 19-touch `state.json`
  ritual and the answer-key read were both found.)
- **But the bookkeeping is load-bearing — don't "optimise" it.** `state.json` is
  the most-touched path of an XS run (19 Read/Write/Edit), and state+INDEX+
  timestamps are ~44% of all tool calls, which looks like the obvious target.
  Cutting the between-phase re-reads did drop turns 25% and cost with them — and
  blew the cost spread from 1.03× to **2.59×**, dropped `judge_p10` 9 → 6, and
  produced the task's first hard acceptance failure: one run drifted to 39 turns
  and shipped too little, another flailed to 92. The re-read is the orchestrator's
  anchor between phases. The saving was the run doing less.
- **Cost variance and quality variance are different numbers.** `11-recent-window`
  looked immune to the S lane's spread problem — 1.04× cost across its first three
  runs — and its quality is nonetheless bimodal: most runs land 9–10, roughly one
  in nine takes the wrong-layer trap and scores 6. So a `judge_p10` of 6 at n=3
  says nothing about a change; it is the task's own failure rate showing through.
  **Calibrate the unchanged config at n≥6 and read median cost + failure count,
  not `p10`.** Two verdicts in this session were wrong at n=3 and reversed at n=9.
- **Re-baseline before crediting yourself with someone else's numbers.** The
  brownfield-S reference in `baselines/brownfield-s-after.jsonl` reads $4.92 on
  `09-api-compat`, but it was recorded two commits earlier. Re-measured at
  `50f1f74` the same task and config is **$6.50 / 845s / judge 10, `judge_p10` 10**
  (n=3, `baselines/brownfield-s-09-current.jsonl`) — 32% pricier and a full point
  better, `judge_p10` 8 → 10. Both movements belong to the intervening commits, not
  to whatever you are about to try. A stale reference silently books that swing into
  your change's column, in whichever direction flatters it least. **The `--gain`
  "before" must come from the tree you are about to edit**; the cost of finding out
  is one extra 3-repeat run.
- **Rejected: a smaller design read (`lead-design.md` + the shape table inlined).**
  The theory came straight from the XS lane — this suite's cost is input-token
  dominated roughly 6:1, so cut what main re-carries every turn. Three
  content-neutral cuts, ≈ **−26 KB resident per S run**: split the 24.5 KB
  `agents/references/lead.md` into a design half (17.2 KB) and a review/fanout half
  (8.3 KB) so a design pass stops loading review-fanout, security-fanout and
  multi-repo sections it cannot execute; inline the 12-line `Artifact shape by Type`
  table into the fast path so S design stops reading 18.8 KB of `size-tiering.md` to
  reach it; move the fast path's measurement narrative into a non-resident rationale
  file. No design content removed, no spawn, check or artifact touched; all four
  suites green. **It did not pay:** $6.50 → **$7.57 (+16.4%)**, wall 845 → 892s
  (+5.6%), judge median 10 → 9 and `judge_p10` 10 → 9. Ratchet FAIL, `--gain` FAIL,
  reverted byte-exactly (`baselines/brownfield-s-lean-design-refs-rejected.jsonl`).
  Two honest caveats: the phase clock showed Design collapsing from ~295s to **~76s**
  while the total still rose, so whatever was saved up front came back later; and
  the after-spread ($5.10–$8.03) overlaps the before ($5.49–$6.82), so the fair claim
  is **"no gain demonstrated"**, not "proven harmful". Either way the ratchet's rule
  stands — a configuration that moves cost, wall and quality the wrong way is not
  adopted on the hope that it was noise. What this closes off is the whole family of
  *"same content, fewer bytes to read at design time"* ideas at S: reading less at
  Design behaves like rationing it even when not one sentence of the contract is cut.
  The kept sandboxes agree weakly — median `spec.md` 4804 B → 4076 B.
- **What works at XS can break S.** The same session tried capping artifact
  length and restricting which reference sections `lead` may read. At XS
  (`run.md` ≤ 40 lines) that was free — a hermetic unit with ≤3 stated ACs has no
  design space to starve. At S the identical idea graded **9/pass → 8/fail** and
  the ratchet rejected it. Size is not a dial on the same lane; the lanes differ.
- **At S, n=1 measures nothing. This was tested, not assumed.** Two runs of the
  *identical* configuration and prompt on `06-landing-site` came back **$3.88 /
  1386s / 1 spawn / 9-pass** and **$9.41 / 1790s / 3 spawns / 8-fail** — a **2.4×
  cost spread and a flipped verdict with nothing changed**. Across five runs:
  median $8.53, judge median 8, `judge_sd` 0.5, one run lost to
  `incomplete_at_implement`. Two earlier "regressions" that the ratchet rejected
  sat entirely inside that spread; the rejection was noise, not signal.
  **Budget ~5 repeats per configuration before believing any S-level verdict** —
  roughly $40 at this task's cost. The XS claims above are trustworthy for the
  opposite reason: judge 10 is the ceiling and every single run hit it, so the
  cost curve is the only thing moving.
- **`compare.sh --ratchet` inherits that limit.** It compares medians, so it is
  only as trustworthy as the `n` behind them. On a task with real spread, run it
  against `--repeats 3`+ per side or it will fail on noise — exactly as it did
  here, twice.
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
