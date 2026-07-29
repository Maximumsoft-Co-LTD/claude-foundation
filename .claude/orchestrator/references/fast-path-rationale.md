# Optimization rationale — what was measured, and what was rejected

> **Never loaded during a run.** The playbook files it explains stay resident for
> every turn, so their rationale lives here instead. Read this before *changing*
> a cost/turn rule — most of the obvious cuts have already been tried, and
> re-adopting a rejected one costs a benchmark cycle to re-learn. Numbers come
> from `.claude/tests/bench` (method, spread and reliability caveats in its README).

## The cost model, established the hard way

Cost on this workflow is input-dominated roughly **6:1** over output, so the
tempting theory is "shrink the playbook". That theory is **wrong**, and it was
falsified twice before it stopped being attractive:

| cut | size | cost effect |
|---|---|---|
| S design read (`lead-design.md` split + shape table inlined) | −26 KB resident | **+16.4%** (rejected) |
| XS boot chain (fast path becomes the only Phase-1 reference) | −26 KB resident, −4 reads | **−0.3%** |

Two independent ~26 KB cuts, neither moving cost. The reason: every turn re-sends
the *whole accumulated* context, and instructions are a shrinking fraction of it
as artifacts, diffs and tool output pile up. Bytes are nearly free. **Turns are
not free either, but see the retraction below — removing overhead turns did not
move clean-sandbox cost outside the noise floor.** What is left is the work.

The turn inventory of one XS run (`profile-turns.sh`, task `11-recent-window`):

```
round-trips (context re-sends):      68
tool calls:                          68   (1.00 per round-trip — headless
                                          `claude -p` never batches; not a lever)
  29 Bash   (22 work commands, 7 bare `date -u` timestamp fetches)
  20 Edit   19 of them state.json
  12 Read
   7 Write  ← the only calls that produce an artifact
```

`state.json` is the single most-touched path in the run. State + INDEX + timestamp
bookkeeping is **~44% of every tool call the workflow makes**.

## The retraction: none of the overhead cuts below actually moved cost

Everything in the two sections that follow was measured on a **leaking sandbox**.
`run-bench.sh` copied all of `.claude/` into the workflow arm's sandbox, including
`.claude/tests/bench/tasks/<t>/acceptance.txt` — the graded criteria with the trap
spelled out — which the baseline arm never sees. A run that can read the ACs skips
the expensive part (deriving requirements that were never stated), so the leak
inflated efficiency as well as quality.

Re-measured on the fixed sandbox, n=6 per side:

| config | cost | wall | turns | judge |
|---|---|---|---|---|
| session-start | **$2.63** | 418s | 64 | 8.5 |
| all three cuts adopted | **$2.81** | 432s | 67.5 | 9 |

**No improvement.** And pooled clean-sandbox cost is mean $2.72 with sd $0.77, so
at n=6 the standard error is 12% and **nothing under ~23% is resolvable** — the
−6.5% and −13% originally reported for these changes were both below the floor.
Compute `2·sd/√n` before believing a delta.

**They are kept anyway, as cleanliness rather than speed:** each one provably
removes tool calls (the sentinel collapses the per-phase state ritual from three
calls to one; total calls fell 68 → 50) and none costs quality. They just do not
show up in the cost column, because on a fair sandbox the run's turns go into the
*work* — reading the seed, deriving unstated requirements, writing the regression
test, reviewing — and playbook overhead is small beside it. **Optimise scope, not
overhead** is the lesson; three separate attack surfaces (instruction bytes,
bookkeeping turns, playbook overhead) are now measured and exhausted.

## Adopted (as cleanliness, not speed): the `__now__` sentinel

The orchestrator has no clock, so the rule was "every timestamp = `$(date -u …)`
output — run it, never guess". Sound (a hand-typed ISO is hallucinated) but it
cost **seven Bash turns per XS run**. It now writes the literal `"__now__"` and
`dev-state-validate.sh` substitutes real UTC after the write: the model still
never types a clock value, it just stops paying a turn to read one. Turns 69 → 64, and the per-phase state ritual
collapsed from three calls to one (`state.json` touches 19 → 5, total tool calls
68 → 50). Cost flat within noise on the fixed sandbox — kept for the simplicity,
not for a saving. Pinned by `hooks/tests/run-hook-tests.sh` (sentinel must
vanish everywhere including nested, real timestamps must survive untouched).

## Rejected: the bookkeeping turn diet

The obvious follow-on: if bookkeeping is 44% of calls, stop re-reading
`state.json` between phases (the orchestrator is its single writer and already
holds what it wrote) and fold the INDEX touch into the same write. It worked
exactly as designed on the metric it targeted — **turns 69 → 52 (−25%)**, cost
following down — and it broke the run:

| | cost median | cost spread | judge median | `judge_p10` |
|---|---|---|---|---|
| before | $2.74 | **1.03×** | 9 | 9 |
| turn diet | $2.89 | **2.59×** ($1.86–$4.81) | 9 | **6** |

One run drifted to 39 turns, shipped too little and took the task's first hard
acceptance failure in nine runs; another flailed to 92 turns and $4.81. **The
re-read is the orchestrator's anchor between phases, not a defensive tic — the
paperwork is the control loop.** Cutting it does not remove work, it removes the
thing that keeps the run on the rails, and the cost saving is really the run
doing less. Reverted; the rule in `orchestrator.md > State discipline` now says so.

## Rejected: the one-artifact XS lane (`run.md` absorbs test/review/retro)

The most promising scope cut of the session, and the only change all day whose
effect ever cleared the resolution floor. At `size=XS`, `run.md` also carried
`## Test results`, `## Review` and `## Retro` — one document per run instead of
four, so no later phase opens a second file to check a third.

At n=6 it looked like a clear win: **-29.4% cost, -27.9% wall, -31.9% turns**. At
n=12 it was neither as cheap nor as good:

| | cost | wall | turns | judge median | worst | fail rate |
|---|---|---|---|---|---|---|
| four artifacts (n=6) | $2.81 | 432s | 67.5 | 9 | 6 | 17% |
| one artifact (n=12) | $2.24 | 341s | 50.5 | **8** | **5** | **25%** |

The cost win regressed to **-20.3%** (back under the ~23% floor) while quality
dropped a full point — six of twelve runs graded 8 where the four-artifact lane
sat at 9, and the worst case fell 6 -> 5. That is a consistent shift across twelve
samples, not the task's own trap rate. Ratchet FAIL, `--gain` FAIL, reverted
(`baselines/xs-11-onefile-rejected.jsonl`).

**Two lessons worth more than the 20%.** First, *n=6 is not enough even for an
effect that clears the floor* — this one shrank by a third between n=6 and n=12,
in the direction that flattered it. Second, the plausible mechanism: each phase
appends to and re-reads a document that already holds the design, so the review
becomes an annotation on the thing it is reviewing rather than an independent
check, and the per-AC rows get less careful treatment than a freshly-written file
demands. **Separate artifacts are doing work that a section heading does not.**

## Rejected: rationing the design

Capping artifact length and restricting which reference sections `lead` may read:
cost **+9%**, wall **+16%**, quality **9/pass → 8/fail**. The `run.md` ≤ 40-line
budget works at XS precisely because a hermetic unit with ≤3 stated ACs has no
design space; S and up do, and starving it costs more than it saves.

**Keep the distinction straight.** Rationing removes design *content*. Pointing a
design pass at a smaller file that carries the same content removes no content —
but the S experiment above shows that even *that* does not pay, so neither is a
live lever.

## Rejected: inlining docs+ship at S — twice, on two different shapes

1. At n=1 per config: **8/fail ×2** against 9/pass.
2. At n=3 on the inline-Design shape: `08-name-migration` $6.38 → **$8.44** (a 32%
   regression that blew the ratchet), `09-api-compat` quality spread widened to
   `judge_sd` **3.46** with a **4/fail**.

Inlining relocates work into a main context already carrying Design and Implement;
at S that context is no longer small. `run-doc-consistency.sh` fails if a later
pass re-adopts it.

## Rejected: trimming main's resident Phase-2 references at XS/S

Tried inside the docs+ship pass above and reverted with it, so it has **never been
isolated**. Given the two byte-cuts at the top of this file, expect it to buy
nothing; if tried again, run it alone.

## Rejected: the strict review walk

An AC naming a mechanism (a backup, an atomic write, an unchanged caller) may be
ticked only by pointing at that mechanism's line. `cycles.review` fired for the
first time in 25 runs — and `09-api-compat` went **$4.92 → $7.37 (+50%)** while
never routing a fix, with `08-name-migration`'s judge median **9 → 7**. Ratchet
FAIL on both. A stricter reviewer is not automatically a better one. Note that
`compare.sh --mechanism` **passed** this configuration (spawn counts and median
cycles unchanged) — its documented blind spot, seen in the wild.

## Why S inlines Design (adopted, and the last big win)

Six brownfield-S runs at a median **$8.34 / 1516s** and **$8.81 / 1357s**, 4 spawns
each. Design was **39–49% of the wall clock** in every run — a cold worker
re-reading a 29 KB brief to re-derive a size, field and intent the orchestrator
had already settled. Inlining it: **$6.38 / 934s** and **$4.92 / 827s**, ≈ −⅓ cost
and ≈ −40% wall, quality up on one task and flat on the other. Review keeps its
spawn: the plan's author reading their own diff is the bias `WORKFLOW.md > Anti-bias
rule` exists to break.

## Standing caveat: how much `n` a verdict needs

At S, two runs of an identical configuration came back **$3.88 / 9-pass** and
**$9.41 / 8-fail** — a 2.4× spread and a flipped verdict with nothing changed.

The XS task `11-recent-window` looked immune (cost spread **1.04×** across its
first three runs) and is not: **cost and quality have different variances.** Its
quality is bimodal — most runs land 9–10, an occasional one takes the wrong-layer
trap and scores 6 — so `judge_p10` at n=3 cannot distinguish a real regression
from the task's own failure rate. Calibrate the unchanged config at n≥6 before
reading `judge_p10` as a verdict, and read the cost spread separately from the
quality spread.
