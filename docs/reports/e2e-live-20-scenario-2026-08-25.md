# Live 20-session Claude diagnostic — 2026-08-25

Diagnostic smoke, not release evidence. Twenty real headless `claude -p`
sessions inspected one immutable source snapshot in separate temporary git
projects. Model verdicts were used only for triage; every accepted defect below
was independently reproduced red against the source snapshot and green with
the candidate production fix.

## Run metadata

- Source: `207f3fc0ca5336c983a8a565698dcc1e9ced9219` (v3.4.5 formula commit,
  including the runtime API 26 singleton-dispatch change).
- Claude CLI 2.1.241, model `sonnet`, JSON output, strict empty MCP config.
- 20 sessions in four waves of five; $2 maximum per session; $15.21 total.
- Raw results: `/tmp/cf-20probe-20260824/` (`claude.json`, stderr, exit code,
  timestamps, status, and candidate patch per scenario).
- Every Claude process exited 0 with subtype `success`. Session 06 exhausted
  its useful response on a broad suite and omitted the requested final verdict,
  so its model result remains inconclusive even though its defect was later
  confirmed independently.

## Per-session analysis

| # | Scenario | Cost | Model triage | Independent analysis |
|---|---|---:|---|---|
| 01 | singleton dispatch | $0.28 | PASS | Singleton selection returns leased inline authority; no worker group. |
| 02 | one repo, many tasks | $0.77 | PASS | Planner/dispatcher boundary behaved correctly for parallel and shared-resource variants. |
| 03 | multi-repo spawn group | $0.74 | PASS | Bounded multi-repository group and repository-scoped packets confirmed. |
| 04 | acquire/packet/release | $0.64 | PASS | Wrong-owner and unsafe force release stayed blocked. |
| 05 | live lease after restart | $0.55 | PASS | No defect; useful on-disk restart/expiry regressions were retained. |
| 06 | stale lease takeover | $1.87 | INCONCLUSIVE | **Confirmed defect:** a former generation with the same stable owner could release its successor's lease. |
| 07 | observed-write authority | $1.19 | FAIL_FIXED | **Confirmed defect:** an omitted `[paths:]` scope was inconsistently treated as no authority instead of whole-tree authority. |
| 08 | graph revision drift | $0.67 | PASS | Acquire and release reject stale graph identity; unrelated drift distinction remains a possible future test. |
| 09 | Build instruction contract | $0.48 | PASS | All six dispatch actions are documented; missing assertions were added. |
| 10 | runtime API single source | $0.38 | PASS | API 26 pins and torn-install refusal passed; missing historical tag exposed a snapshot-fixture weakness. |
| 11 | fresh consumer install | $1.03 | PASS | Install, doctors, planning, dispatch, and invalid-scaffold refusal passed. |
| 12 | upgrade consumer install | $0.50 | PASS | Product passed after fetching v3.2.19; archive-only snapshots lacked the tag. |
| 13 | phase attribution | $0.65 | PASS | Public CLI and direct runtime calls both attributed plan/dispatch to Build. |
| 14 | critical-case readiness | $0.52 | PASS | Missing, present, excluded, untracked, and unanswerable cases behaved correctly. |
| 15 | review authority | $1.61 | FAIL_FIXED | **Confirmed defect:** a completed failed review attempt could be replayed as a passing receipt. |
| 16 | Land guard/recovery | $0.52 | PASS | Missing/stale proof, root isolation, and interrupted archive recovery held. |
| 17 | secrets hook boundary | $0.49 | FAIL_FIXED | **Confirmed defect:** safe docs-only content grep was blocked as if it could read `.env`. |
| 18 | telemetry/budget truth | $0.94 | FAIL_FIXED | **Confirmed defect:** phase spend omitted cache writes derived from total minus cache-read tokens. |
| 19 | dashboard projection | $0.87 | FAIL_FIXED | **Confirmed defect:** stale passing `proof.json` outranked a current failed provider receipt. |
| 20 | composition/release seam | $0.50 | PASS | Wiring and registry passed; two apparent full-suite failures were both the missing-tag fixture artifact. |

## Confirmed fixes

1. **Lease fencing:** `agents release` accepts `--lease-id`; a taken-over
   generation refuses a missing or stale id. The inline dispatch command now
   carries a safely quoted acquired-id placeholder, and the registry plus
   English/Thai docs state the contract.
2. **Path authority:** empty task paths consistently mean whole-tree authority
   in result validation, observed-write release, and proof scope checks.
3. **Review integrity:** review attempt status must equal receipt status;
   repair-closure receipts must also be explicitly passing.
4. **Secrets usability:** content grep remains blocked unless its glob can only
   match extensions already allowed as documentation/templates.
5. **Metrics truth:** phase metrics expose derived cache-write tokens and use
   them in spend, matching the budget window.
6. **Dashboard truth:** a live failed/error provider receipt outranks a stale
   passing proof certificate.

All six reproductions were run in fresh archive snapshots with only the new
regression applied: each failed on source and passed after its production fix.

## Harness improvements from the run

- Added the reusable `diagnostic/run-claude-probes.sh`, a 20-scenario manifest,
  JSON analyzer, clean-snapshot guard, five-wide waves, per-session budgets,
  bounded watchdogs, raw evidence capture, and conservative verdict parsing.
- The runner shallow-fetches required historical tags (v3.2.19 by default), so
  upgrade tests no longer fail merely because a content archive has no tag
  objects.
- Added real on-disk restart/expiry dispatch tests and derived the agent suite's
  reported test count from TAP instead of a hardcoded number.
- Added Build-instruction assertions for `run-in-session`, `wait`, `blocked`,
  and `build-complete` in addition to the existing spawn/leased-inline checks.

## Follow-up plan

1. Add a full planner-to-dispatch multi-repository integration regression for
   the exact three-repository/capacity-two boundary exercised by session 03.
2. Add explicit release-time graph-drift coverage distinguishing related task
   drift from unrelated repository drift (session 08).
3. Narrow the broad authority scenarios so they do not spend most of their
   budget rerunning the entire suite; reserve the full suite for one final
   composition probe.
4. Consider invalidating `proof.json` at the runtime mutation boundary, not
   only making the dashboard prefer a current failed receipt.
