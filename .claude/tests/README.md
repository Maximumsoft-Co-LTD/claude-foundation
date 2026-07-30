# Workflow test harness

Tests the `/dev` workflow itself — not the apps it produces. Three layers, one
entry point.

```sh
sh .claude/tests/run-all.sh              # deterministic suites (fast, free, CI-safe)
CLAUDE_E2E=1 sh .claude/tests/run-all.sh # + live /dev e2e smoke (needs claude CLI, costs tokens)
```

Dependency: `jq` (and `python3` for a couple of nested-JSON hook checks). POSIX
`sh` + `grep`/`awk` otherwise — no test framework.

## Layers

| Layer | What it proves | Cost | Where |
|-------|----------------|------|-------|
| **1 — deterministic** | hooks behave; every artifact is structurally valid; a run conforms to the type-aware phase matrix | free, sub-second | `hooks/tests/` (existing) + `scenarios/` |
| **1 — doc consistency** | the docs that *drive* the prose workflow don't rot: version single-sourced, agent model pins valid, `phase-matrix.tsv` ↔ `WORKFLOW.md` in sync, no shipped file cites a path or reference that isn't there | free | `docs/` |
| **1 — ledger** | the repo context ledger can be pruned without data loss: a dead `path#anchor` goes, every survivor stays byte-identical, and anything unverifiable is kept | free | `ledger/` |
| **1 — bench logic** | the scorecard math is right before any live run pays for it: medians, the ratchet, the A/B, the oracle-over-judge ordering, `blocked` ≠ failure, and the context axis (including the `requestId` dedup that would otherwise overstate context 1.9×) | free | `bench/tests/` |
| **1 — interview replay** | the answer matcher that lets a headless run be driven through a real interview: the match ladder, one-answer-one-use, gate forcing (incl. **reject**), and the inert-without-a-bank safety paths | free | `interview/` |
| **2 — e2e (live)** | a real `/dev` run on a fresh sandbox produces valid, on-axis artifacts | tokens + `claude` CLI | `e2e/` |
| **2 — interview replay (live)** | `/dev` driven through its **real interview and real gate** from a recorded bank, on a deliberately vague prompt and **without `--yes`** | tokens | `interview/run-replay.sh` |
| **3 — judge** | the artifacts are *good*, not just well-shaped (AC quality, plan↔spec fit, task executability) | tokens | `e2e/judge/` |
| **3 — bench (live)** | what a run *costs and delivers* across four axes — quality, speed, cost, context | tokens | `bench/` |

Why the split: most of the workflow is prose the model interprets live, so it
can't be unit-tested directly. Layer 1 pins everything *around* that prose (the
deterministic surface). Layers 2–3 exercise the prose itself by running it.

**The efficiency benchmark measures four axes — quality, speed, cost, context** —
and `bench/README.md` is the contract for what to trust in each. Two rules worth
knowing before reading any scorecard: quality leads with the deterministic
`oracle_*` because the model judge has passed twelve diffs that objectively failed
an acceptance criterion, and the **context axis costs no tokens** — it is read off
the transcript the CLI writes anyway, which also means it can be recovered for runs
that already happened (`bench/backfill-context.sh`).

## The executable matrix

`phase-matrix.tsv` is a machine-readable copy of `WORKFLOW.md`'s type-aware phase
matrix. The scenario suite reads it to derive which artifacts a run of a given
type must NOT contain (e.g. `chore` skips test-plan/test → no `test-plan.md`,
no `tests.md`). `docs/run-doc-consistency.sh` cross-checks the load-bearing skip
cells against `WORKFLOW.md`. Flip a `skip`→`yes` in one place and the harness
fails until all three (TSV, WORKFLOW.md, the fixture's artifact set) agree.

## Scenarios (Core 6)

Golden `.workflow/<id>/` fixtures under `scenarios/fixtures/`, one per meaningfully
distinct phase-sequence, registered in `scenarios/scenarios.tsv`:

| Fixture | type · size · field | Exercises |
|---------|---------------------|-----------|
| `01-feat-s-greenfield` | feat · S · greenfield | full plan set, no `context.md`, greenfield size cap |
| `02-feat-m-brownfield` | feat · M · brownfield | `context.md` required |
| `03-fix-s-brownfield` | fix · S · brownfield | regression-first tasks, regression contract |
| `04-refactor-m-brownfield` | refactor · M · brownfield | baseline contract, `context.md` |
| `05-chore-xs` | chore · XS · brownfield | `run.md` micro-lane, test-plan/test skipped |
| `06-spike` | spike · S · brownfield | `recommendations.md`, test/security/docs skipped |

Each fixture asserts: artifact-lint passes · `state.json` type/size/field match
the declared axes and the run-id slug · required artifacts present · matrix-skip
artifacts absent · field invariants (greenfield ⇒ size ≤ S, no `context.md`).

## Add a scenario

1. `mkdir -p scenarios/fixtures/<name>/.workflow/<NNNN-type-slug>/` and drop in the
   golden artifacts (keep them lint-clean — no `TODO`/`<...>`; note the linter's
   `todo` check is a **case-insensitive substring**, so avoid words like "todo").
2. Add one row to `scenarios/scenarios.tsv`:
   `<name> <type> <size> <field> <comma,joined,required,artifacts>`.
3. `sh scenarios/run-scenario-tests.sh` — the forbid rules and field invariants
   apply automatically from the matrix.

For a live e2e prompt, add `e2e/prompts/NN-<type>-<slug>.txt` (a fully-specified
`/dev` intent that steers the interview to no-op).

## Live e2e caveat

`/dev`'s Phase 1 interview uses `AskUserQuestion`, which a headless `claude -p`
session can't answer. The prompts are written fully-specified ("do not ask
clarifying questions — assume …") to make the interview a no-op, but a run that
still stops to ask times out and is reported **SKIP**, not pass. Treat live e2e
as a best-effort smoke, not a merge gate. Preview without spending tokens:

```sh
sh .claude/tests/e2e/run-e2e.sh          # dry-run: prints the plan
sh .claude/tests/e2e/run-e2e.sh --run    # live
```

**e2e suppresses the interview on purpose; `interview/` is the suite that tests
it.** The two are opposites and neither substitutes for the other: e2e checks that
a fully-specified run produces a conformant artifact set, while `interview/`
answers a *vague* prompt's questions from a bank recorded off a real session — and
runs the gate for real, `--yes` omitted, so `--gate reject` reaches a branch e2e
and the benchmark structurally cannot. See `interview/README.md`, including the
seam it does not close (the hook denies the tool and returns the answers as the
denial reason rather than answering it).

```sh
sh .claude/tests/interview/run-replay.sh                    # dry-run
CLAUDE_REPLAY=1 sh .claude/tests/run-all.sh                 # + live replay
sh .claude/tests/interview/run-replay.sh --run --gate reject # the rejection path
```
