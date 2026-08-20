# Parallel `/dev` diagnostic report — telemetry measurement & transcript recovery (10 probes)

Date: 2026-08-20. Method: `.claude/tests/e2e/README.md` (parallel `/dev`
diagnostic harness), run with 10 scenarios instead of the recommended 4–5 at
the user's request.

## Input under test

- Source commit: `6f0886af49dac0e332844eef826871bc719a32b0`
  (`fix telemetry measurement and transcript recovery`), clean worktree,
  empty patch, no untracked files copied.
- Change surface: `runtime/core/measured-number.mjs` (new),
  `runtime/observability/{metrics-runtime,telemetry-runtime,telemetry}.mjs`,
  `runtime/workflow/budget.mjs`, `runtime/evidence/evidence-contract.mjs`,
  plus the dispatch/lifecycle surface of `8cce368`.

## Method deviation

The source `.git` is 22 GB, so `git clone --no-local` per sandbox was
infeasible. Each sandbox is a `git archive <source-head>` export (9.7 MB) with
a fresh single-commit git history — the same isolation method as
`lib/harness-fixture.sh`. Content equality with the snapshot commit is
guaranteed by `git archive`; every probe therefore tested the same input.

## Run metadata

- Claude CLI 2.1.237, `--output-format json`, `--max-budget-usd 5` per probe.
- 10 concurrent children, wall time 8m58s (06:46:43Z → 06:55:41Z).
- Total cost: $42.75.
- Raw results: `~/.claude/jobs/cf3b29fe/tmp/claude-dev-harness.TnZMm8/results/`
  (per scenario: `claude.json`, `stderr.log`, `exit-code.txt`,
  `sandbox.patch`, `status.txt`, timestamps). Candidate patches live in each
  scenario's `sandbox.patch`. This path is temporary job state.

## Per-scenario results

| # | Scenario | CLI status | Cost | Duration | Verdict |
|---|---|---|---|---|---|
| 01 | measuredNumber validator semantics | success | $3.75 | 7m19s | PASS (1 low defect fixed in sandbox) |
| 02 | budget cache-write derivation | budget exhausted | $5.03 | 6m38s | INCONCLUSIVE (salvaged: its 125-line boundary suite passes 14/14 against shipped code) |
| 03 | usage availability classification | budget exhausted | $5.05 | 8m53s | INCONCLUSIVE (no verification reached) |
| 04 | archive-time telemetry draining | success | $3.67 | 4m56s | FAIL → PASS with sandbox fix (1 high, 1 medium defect) |
| 05 | transcript cursor identity/recovery | success | $4.94 | 6m51s | PASS after fix (1 low defect) |
| 06 | metrics context rollup / contextBytes | budget exhausted | $5.05 | 7m43s | INCONCLUSIVE (no verification reached) |
| 07 | event flag validation | success | $3.55 | 3m43s | PASS, no defect |
| 08 | normalizeTelemetryRow | success | $1.96 | 3m33s | PASS, no defect |
| 09 | evidence timeoutMs validation | success | $4.88 | 8m32s | PASS, no defect |
| 10 | dispatch/lifecycle diagnostics | success | $4.88 | 8m07s | FAIL → PASS with sandbox fixes (2 medium defects) |

## Confirmed defects, by severity

Every defect below was re-verified against the shipped HEAD content (sandbox
fix reverted, suite re-run) or directly at the source checkout, per the
README's rule that probe output is diagnostic, not evidence.

1. **HIGH — archive drain permanently breaks on a corrupt rollup.**
   `telemetry-runtime.mjs` (drain seam, pre-fix line ~92): a
   `context-rollup.json` with missing/invalid `byKind` throws `TypeError`
   inside the drain loop; the outer catch swallows it, so every subsequent
   drain fails silently and pending `context-events/*.json` files grow
   unboundedly past the 1000 threshold. Reproduced at source content:
   scenario 04's suite with the fix reverted fails `1001 !== 501` (files never
   drained). Companion **MEDIUM**: corrupt rollup counters (`count: "5"`,
   missing `totalBytes`) string-concatenate or NaN-poison the persisted
   rollup. Suggested fix (candidate in `results/04-*/sandbox.patch`): rebuild
   the loaded rollup through `measuredNumber`, drop junk `byKind` rows,
   guarantee `byKind` is an object.

2. **MEDIUM — corrupted lease file grants leased authority.**
   `packet-runtime.mjs:233,252`: a malformed lease file parses via
   `readJson(leasePath, {})` to `{}`, which is truthy, so the task packet
   reports `executionAuthority.status: "leased"` with `leaseId`/
   `fencingGeneration` undefined — a worker would proceed believing it holds
   fencing authority. Confirmed by code inspection at source; the probe's
   added tests do NOT pin this path (its claimed proof via the agent-contract
   suite passes either way), so a deterministic repro (write a corrupt lease
   JSON, generate a packet) must be added before landing the guard. Suggested
   fix: treat a lease without `leaseId` as `status: "unleased"` with the
   re-acquire instruction.

3. **MEDIUM — `workflow-policy.test.mjs` fails inside any Claude Code
   session.** The two main-session-fallback scenarios isolate only
   `CODEX_THREAD_ID`, but `authority-runtime.mjs:524-530` gives
   `FOUNDATION_CLAUDE_SESSION_ID` ambient precedence, so the fallback binds to
   the host's live Claude session and the handback becomes
   `main-session-provenance-unavailable`. Reproduced at the source checkout:
   `node --test .claude/harness/tests/workflow-policy.test.mjs` fails as-is
   and passes with `env -u FOUNDATION_CLAUDE_SESSION_ID`. Test defect, not a
   runtime defect. Suggested fix (candidate in `results/10-*/sandbox.patch`):
   hoist the existing eight-key host-provenance snapshot/clear/restore over
   both scenarios.

4. **LOW — duplicate claude-user transitions on transcript rescan.**
   `telemetry.mjs:113-118`: `normalizeClaudeUserTransition` folds the
   import-time `now()` fallback into `transitionId` when a user row lacks its
   own timestamp, so every legacy-cursor rescan mints a fresh id and
   duplicates the transition. Unreachable with well-formed Claude transcripts
   (rows always carry timestamps). Reproduced at source content: scenario 05's
   suite with the fix reverted fails 1/8. Fix: derive identity from row
   content only.

5. **LOW — `measuredNumber(-0)` preserves the sign bit.** Reproduced at the
   source checkout: `measuredNumber(-0)` returns `-0`. No current caller
   observes the sign; normalize with `+ 0`.

## Incomplete probes (not evidence)

Scenarios 02, 03, 06 hit the $5 budget cap (`error_max_budget_usd`) before
producing a verdict. All three burned their budget standing up the Foundation
change-loop ceremony (OpenSpec packet drafting) before testing. Scenario 02's
partially written boundary suite was salvaged and run deterministically
afterward: 14/14 pass against shipped code, including
explicit-cache-creation-wins and negative-derived-write cases — suggestive of
no defect, but formally INCONCLUSIVE. 03 and 06 produced no test artifacts.

**Meta-finding**: probes that skipped or deferred the `/dev` lifecycle
ceremony all finished with substantive verdicts; the three that attempted the
full loop all exhausted budget on process artifacts. Scenario 09 additionally
hit a real friction point: the deterministic review tier maps a test-only
change on the harness surface to `high`, demanding `realWire` grounding that a
test-only change cannot truthfully declare.

## Deterministic main-worktree verification

At the source checkout after all children exited:

- `agent-dispatch.test.mjs`, `run-actionable-validation-telemetry-tests.mjs`,
  `run-archive-telemetry-tests.mjs`, `run-telemetry-truth-tests.mjs` — pass.
- `workflow-policy.test.mjs` — **fails** (defect 3 above); passes with the
  ambient session var stripped.
- `run-agent-contract-tests.sh` — 26/26. `run-harness-tests.sh
  multi-repository` — 88/88.

## Source integrity

The source worktree stayed clean throughout. HEAD moved mid-run
(`6f0886a` → `9cfc9f3`) via one unrelated local `.gitignore` chore commit,
investigated per the README stop rule: it touches only `.gitignore`, no
harness child could have produced it (each ran in its own sandbox git repo),
and the change-under-test commits are untouched. All sandboxes were built
from the snapshot commit, so probe inputs were unaffected. No resets or
discards were performed.

## Follow-up

Land fixes for defects 1–4 through the normal change loop, each with its
regression at the lowest deterministic boundary; the sandbox patches are
candidates to read, not to copy. Defect 3's fix unblocks running
`workflow-policy.test.mjs` from inside Claude Code sessions.
