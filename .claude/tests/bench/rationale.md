# Optimization rationale — what was measured, and what was rejected

> **Never loaded during a run** — it lives with the benchmark that produced it, not
> in `.claude/orchestrator/references/`, because the playbook files it explains stay
> resident for every turn and their evidence would be re-sent with them. The playbook
> carries the *rule*; the numbers behind it are here. Read this before *changing* a
> cost/turn rule — most of the obvious cuts have already been tried, and re-adopting a
> rejected one costs a benchmark cycle to re-learn. Method, spread and reliability
> caveats: `README.md` in this directory.

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

## Rejected: "the artifact IS the cursor" (OpenSpec's no-ledger model at XS)

Imported from OpenSpec, whose changes carry no state file at all — `openspec list`
derives status from the filesystem and `tasks.md` checkboxes are the cursor. The XS
analogue looked airtight: the lane runs a **0-spawn budget**, so `dev-state-mark.sh`
never fires and the per-boundary `state.json` write has nobody to synchronise with.
So: write `state.json` at 3 points only (Setup / gate / Close), let `run.md`'s
existing `**Status**` field and `T###` checkboxes carry the cursor, and point the
between-phase re-read at `run.md` — a **richer** anchor than a cursor scalar, and a
read Implement/Test/Review already make. Explicitly *not* the turn diet below, which
deleted the anchor outright.

Measured, n=9 per side, same task (`11-recent-window`), same 9-way parallel
concurrency, decision rule pre-registered before the after-run returned:

| | cost median | cost sd | spread | turns | wall | judge | `judge_p10` |
|---|---|---|---|---|---|---|---|
| before | $2.01 | $0.37 | 1.75× | 47 | 302s | 9 | 7 |
| after | **$2.01** | $0.39 | 1.73× | **48** | 301s | 9 | **6** |

**Zero movement on every cost axis, and `judge_p10` down one.** Rejected on the
pre-registered rule (adopt only at ≥17.4% cost drop with quality held). The p10 move
is probably this task's documented bimodality showing through — one 6-scoring run in
nine is its known base rate — but with no gain to weigh against it there is nothing
to trade.

**The finding worth more than the verdict: `turns` did not move (47 → 48).** The
change cannot have removed bookkeeping calls, because there were none left to
remove. The before-run's `phase_times` already carried **one identical timestamp
across all seven phases** — the current tree writes `state.json` in a batch, not per
boundary. So the "state+INDEX+timestamps ≈ 44% of every tool call" figure that
motivated this — and that the turn diet below was also aimed at — is **stale**; it
describes a tree several optimisation passes ago. Anyone planning a bookkeeping cut
should re-measure the tally with `profile-turns.sh` **first**: on this tree the
bookkeeping is already gone, and what remains at XS is the work.

Two process notes from the run. The historical baseline (`$2.74 / 65 turns`) was
**32% higher than the tree actually measured at** ($2.01 / 47) — re-baselining
first, per the standing caveat below, is what kept this from being reported as a
−27% win that was really someone else's earlier commits. And the doc-consistency
suite is where a change like this pays even when reverted: adding the rule surfaced
**two live contradictions** in prose that already said "don't re-read artifacts" and
"never skip the `state.json` re-read".

## Rejected: banning the harness task list at XS/S

`profile-turns.sh` on an XS run tallied **16 of 69 tool calls (23%) as
`TaskCreate`/`TaskUpdate`** — a third ledger for facts `run.md > ## Tasks` and
`state.json > step` already hold, used only because the harness prompts for it (the
playbook has never mentioned those tools). Removing an unambiguously duplicate
ledger looked free.

Measured, n=9 per side, same task, pre-registered rule:

| | cost median | sd | spread | turns | wall | judge distribution |
|---|---|---|---|---|---|---|
| before | $2.01 | $0.37 | 1.75× | 47 | 302s | 7 7 8 8 9 9 9 9 10 |
| after | **$2.19** | $0.34 | 1.59× | **51** | 314s | 7 7 8 8 9 9 9 9 10 |

Cost **+9%**, turns **+4** — the wrong direction on both, from banning a tool that
was supposedly burning 16 turns. Quality was *bit-identical* across the two judge
distributions, so nothing was traded; the change simply did not do what the
diagnostic predicted. Rejected and reverted.

**The methodological error, which is the reusable part.** The 23% came from **one**
`profile-turns.sh` run, and that run took **69 turns against a measured median of
47** — above every row in the 9-run baseline (max 66). It was an outlier, and its
task-tool usage is plausibly *why* it was one. Sizing an effect from a single
instrumented run, when the quantity being sized has CV ≈ 17%, produced a 23%
estimate for something worth roughly nothing in a typical run — and then cost $18 to
disprove. **`profile-turns.sh` tells you which tools a run uses; it does not tell you
how much a typical run uses them.** Profile to generate hypotheses, never to size
them: for that, n must match the noise.

Second reading, less certain but worth recording: a run that keeps a task list may
be *better organised* for it, in which case the list is doing the same anchoring
work the `state.json` re-read does. Both rejections this session point the same way —
**at XS, the bookkeeping is not the overhead, it is the control loop.**

## Adopted: the `fix` input-domain rule — the first correctness win here

Not a cost change. The deterministic oracle (`tests/bench/grade-oracle.sh`) showed
that **6/6 `/dev` runs and 6/6 plain-prompt runs** on `11-recent-window` fixed the
reported input (`lastN(items, 0)`) and left the identical bug one input over
(`lastN(items, 0.4)` → the whole list), while the model judge graded every one of
the twelve 8–10/`pass`. The defect was never in the code the pipeline wrote — it was
in the **AC set** the pipeline derived: nobody asked what happens beside the value in
the ticket.

So `_templates/run.md > ## Acceptance` gained a `fix`-scoped teaching note: a ticket
names ONE input; before writing AC2, walk that parameter's neighbours (number → zero,
negative, fractional, out-of-range; collection → empty, single, oversize; string →
empty, blank, case, `null`) and pin the ones that reproduce the symptom. Template
notes are stripped on fill, so it costs **nothing resident** and is read exactly when
the ACs are being written.

Measured, n=6 per side, same `--keep` config, rule pre-registered:

| | AC4 (oracle) | oracle score | judge | cost | turns |
|---|---|---|---|---|---|
| before | **fail 6/6** | 5/6 | 9 | $2.37 | 55 |
| after | **pass 6/6** | **6/6** | **10** | $2.64 | 58 |

Every run now satisfies every acceptance criterion. Cost +11.4% against an MDE of
**21.3%** at this n — i.e. no demonstrable cost increase — and the judge median rose
with it. Adopted.

**Two honest caveats.** The rule was derived from a dev-set task and measured on that
same task; it is a general engineering principle rather than a task-specific hack,
but it has not been validated on a holdout, which is exactly the benchmark-overfitting
trap. And the primary metric here was a **deterministic** pass rate, which is why n=6
sufficed — a judge-based verdict on the same change would still need n≈9+ and would
have missed the defect entirely.

## The background-spawn dead run — why the phase worker is always foreground

Not an optimisation, a failure mode the bench surfaced. A background completion can
only arrive in a *later* turn, and headless `claude -p` — every bench run, every
CI/cron invocation — has no later turn. Measured at M on `13-money-drift` (n=3,
3600s ceiling, nothing timed out): **two runs of three** ended on the orchestrator
signing off to wait for a backgrounded `lead`. One of them had already written
`spec.md`, `plan.md` and `tasks.md` — 36 KB of correct design work, abandoned. Both
rows: `incomplete_at_design`, **zero lines of code**, $2.22 and $2.37. The envelope
was healthy and the exit code 0 in both, which is what makes it worth pinning.

Rule lives in `orchestrator.md > State discipline` (resident) and
`orchestrator/references/state-edge-cases.md` (the mechanism);
`run-doc-consistency.sh` fails if either drops it.

## Rejected: defaulting Review/Docs/Retro to `skip` at XS

n=6, fixed sandbox: cost $2.81 → $2.22 (−21%, *under* this suite's ~23% resolution
floor) while the judge median fell **9 → 8**. Turning phases off does not make the run
cheap, because the cost is not in the phases — boot is 44% of an XS run's wall clock
and Design another 39%. They stay **optional** (skippable at the gate), just not off by
default. Rule: `WORKFLOW.md > Required vs optional`.

## The XS micro-lane — design outweighed implement

Routing one hermetic unit (a new pure function nothing imports yet, ≲3 ACs, no state
or I/O) through the four-artifact S path spent **more wall-clock designing than
implementing**: 6m22s design vs 3m37s implement on a CSV serializer. Hence the
single-`run.md` micro-lane, which carries the same contract core with Test and Review
untouched. Rule: `plan-writing > references/size-tiering.md > Signals that override
file count`.

## Adopted on reasoning, NOT measured: spending the repo ledger at every size

The write side has existed since the context-ledger change — `agents/retro.md` step 5b
folds `context.md > ## Discovered` up into a repo-level `.workflow/CONTEXT.md` at the
end of **every** run, at every size. The read side had exactly one consumer:
`ml-design-chain.md > Context`, gated on `field=brownfield AND size ∈ {M,L}`.
`phase-1.md` op 3a spelled out the other branch — *"Greenfield / XS / S → skip; the
slices cold-walk"*. So every run paid to record what it learned about the repo, and
only the rarest tier ever spent it; the lane the suite actually measures cold-walked
past a file its own predecessor wrote.

Now every run, every size, either field, reads the ledger once before the first grep
or LSP call of the current-state walk, then walks only the remainder. Wired at four
points: `orchestrator.md > Size-aware execution` (rule), `xs-s-fast-path.md` (the lane
that cold-walked), `current-state.md > The LSP-walk technique` step 0 (the procedure),
`ml-design-chain.md` (already did it).

**Mechanism — the same lever that made inline-Design pay.** That win removed
re-derivation *within* a run: a cold `lead` re-reading a 29 KB brief to re-derive the
size, field and intent the orchestrator had already settled. This removes re-derivation
*across* runs: run N+1 walking for entry points, callers, invariants and test-runner
facts that run N recorded and retro already filed. Nothing else on the remaining-cost
list ("reading the seed, deriving unstated requirements, writing the regression test,
reviewing") is addressable by a rule change — this one is, because the answer is
already on disk.

**Provenance: OpenSpec** (`docs/research/openspec.md`). Their whole bet is a spec
library read before every proposal that accrues per shipped change and is never
back-filled. We had the accrue half and not the read half. Taken: read-before-walk,
capability grouping, supersede-in-full. **Not** taken: the delta-spec artifact, the
archive-merge command, and the no-gate flow — the last of which is already measured
and rejected here ("the artifact IS the cursor", n=9, zero movement).

**Status: unmeasured, and this harness cannot measure it.** Every bench task runs
`/dev` once in a fresh sandbox with no prior run, so `.workflow/CONTEXT.md` is absent
and the new rule is a no-op in every arm — expect a bench delta of zero plus a few
resident bytes, which the byte-cut rows at the top of this file say is nothing. The
payoff is cross-run by construction. Downside if the reasoning is wrong: one extra
Read of a ≤100-line file per run, with staleness bounded by two rules that were
already load-bearing (evidence-not-authority; code > docs > ledger, and post-Implement
the diff wins). The write side's cost is unchanged — retro already wrote the file.

**How to measure it when there is a harness for it.** Extend `run-bench.sh` with a
two-run mode over ONE sandbox: run A (`/dev` on task T1) leaves a `CONTEXT.md`; run B
(`/dev` on task T2 touching the same surface) either reads it or has it deleted first.
Primary metric is **run B's** cost and wall, n ≥ 9 per side given the ~23% resolution
floor. Pre-register the same rule its cousin was rejected under: adopt-as-measured only
at ≥17.4% cost drop on run B with the judge held. Blocker: the suite has no task *pair*
sharing a surface — `08-name-migration` and `09-api-compat` are the closest shapes and
would need building out.

**Second-order change adopted with it (cost-neutral, same write).** The fold now groups
lines under `## <area>` headings, keeps a durable `## Test infra` group, replaces a
superseded line **in full** instead of appending beside it, and prunes by
load-bearingness rather than age. Oldest-first pruning evicted precisely the facts that
survive across runs — stable invariants and entry points — in favour of the latest
one-off gotcha, which is what would have made the read not worth making by run N+20.
Both the grouping and the replace-in-full rule are OpenSpec's (capability sections;
`MODIFIED` must carry the complete updated text).

Pinned by `docs/run-doc-consistency.sh` check 12 — writer plus all four readers — so a
later pass cannot silently drop one end and leave the other paying for nothing.

## Queued for one batch verdict — shipped unmeasured, rules pre-registered

**Deliberate sequencing, not an oversight.** The harness cannot currently produce a
valid verdict on the things being changed (no cross-run mode; oracles on 3 of 15 tasks;
`blocked_at_*` excluded from every median), so the workflow work went first and the
measurement is batched. The cost of that choice is that a regression would sit
undetected until the batch runs. The mitigation is this table: each change is a named
**revert unit**, claims one mechanism, and carries the rule that decides it **written
before any number exists**. (#3 and #4 share a commit — the prune is what keeps #4
trustworthy, and shipping the behaviour group without its staleness guard would be the
one combination worth refusing; #5 is its own commit.) Reading the numbers first and picking a rule afterwards is how the
earlier verdicts in this file became arguable.

Run the free suites (`sh .claude/tests/run-all.sh`, 546 assertions, no tokens) before
any of this — they gate mechanism, not effect.

| # | change | mechanism claimed | metric | pre-registered rule |
|---|---|---|---|---|
| 1 | read-before-walk at every size | run N+1 stops re-deriving what run N recorded | **run B** cost + wall in a two-run sandbox | needs the two-run mode. Adopt at **≥17% cost drop on run B** with oracle held; below that "no gain demonstrated" — keep as cleanliness or revert |
| 2 | fold retention (area grouping · supersede-in-full · prune by load-bearingness) | same write, better retention, so #1 still pays at run N+20 | none — cost-neutral by construction | **no verdict owed.** It is a precondition for #1, not an independent claim |
| 3 | `ledger-prune.sh` | a ledger every run trusts must be checkable; drift becomes a grep instead of diligence | its own suite (15 assertions) | **deterministic — already verified.** Only risk is over-pruning; pinned by the byte-identical and keep-what-you-cannot-check assertions |
| 4 | `## Capabilities` + type-aware fold + `qa` read | behaviour truth, so a later run derives ACs knowing what is promised and gets the regression map free | **two-sided.** Write cost is visible on a single-run A/B **today**; the benefit is not | Cost side, measurable now: **write-side cost must stay under 5%** at n=9 single-run, else the cross-run payoff has to exceed it before this is worth keeping. Benefit side: same two-run rule as #1 |
| 5 | input-domain rule extended to `spec.md` (S/M) | the defect it catches is a property of `fix` at any size, not of XS | **oracle** pass rate on a `fix`-shaped task at S/M | Adopt if oracle pass rate rises or holds with cost inside the MDE. `13-money-drift` has an oracle and is fix-shaped; `10-rounding-fix` needs one built first |

**Two honest caveats carried forward.** #5 is still unvalidated on a holdout — the rule
was derived *and* measured on `11-recent-window`, the benchmark-overfitting trap named in
its own adoption note above; extending it to another template does not fix that, it
widens the blast radius of being wrong. And #4 is the one change here that **adds** work
to every run: retro writes more, and only later runs collect. On a bench of one-shot runs
that is a pure cost, which is exactly why its cost side gets a rule that can fire before
its benefit side is even measurable.

Order of the batch when it runs: **#3 (free, already done) → #5 (oracle exists today) →
#1 and #4 together once the two-run mode lands.** #1 and #4 share an instrument, and
running them as one verdict is acceptable only because #4's write cost is separately
bounded by its own rule — otherwise this would violate the one-change-per-verdict rule
below.

## Fixed in passing: a pointer to a reference that does not exist

`orchestrator.md > State discipline` cited `references/fast-path-rationale.md >
Rejected: the bookkeeping turn diet` for the turn-diet reversal. No such file exists —
that rationale lives in this file, and it moved here when evidence was split out of the
shipped playbook. A resident pointer to a missing file costs a wasted read at runtime
and returns nothing. The rule it annotated stands; only the pointer is gone.
`run-doc-consistency.sh` check 11 now fails on any `references/*.md` a shipped file
cites that exists nowhere under `.claude/**/references/` — check 10 caught pointers into
paths that never ship, not ones into files that were renamed or moved out.

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
