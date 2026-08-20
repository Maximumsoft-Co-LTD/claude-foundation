# `/dev` Parallel Test Harness Report — 2026-08-20

## Scope

Five isolated copies of the current worktree were created under
`/tmp/claude-dev-harness.HwJs28/sandboxes/`. Each copy received the same
uncommitted patch and was exercised concurrently with `claude -p` and a focused
`/dev --yes` intent. Sandbox changes were retained only as diagnostic patches;
none were applied to the main worktree.

- Claude Code: `2.1.235`
- Per-scenario budget: USD 5
- Total reported cost: USD 22.96
- Parallel wall time: about 10m 27s (slowest scenario)
- Raw results: `/tmp/claude-dev-harness.HwJs28/results/`
- Main-worktree verification after the runs: 25/25 Node tests, 26/26 agent
  contract assertions, and 88/88 multi-repository contract assertions passed.

## Results

| Scenario | CLI result | Cost | Duration | Verdict |
|---|---:|---:|---:|---|
| Capacity-aware dispatch | success | $4.26 | 6m 22s | PASS |
| Worker packet contract/schema v8 | budget limit | $5.07 | 10m 27s | INCONCLUSIVE; no product defect confirmed |
| Usage classification | success | $4.04 | 9m 51s | FAIL, then PASS with sandbox fix |
| Archive telemetry drain | success | $4.46 | 7m 06s | FAIL, then PASS with sandbox fix |
| Oversized authority display | budget limit | $5.12 | 6m 51s | INCONCLUSIVE; display boundary passed |

## Findings to fix

### 1. Imported junk usage values are treated as measurements

Severity: Medium

Location: `.claude/harness/runtime/observability/metrics-runtime.mjs`, beginning
near `usageAvailability()` and repeated in `sumKnown()`, `groupUsage()`, and
phase aggregation.

The current finite-value guard uses `Number.isFinite(Number(value))`. This makes
blank strings, booleans, and arrays look measured (`Number("") === 0`,
`Number([]) === 0`, and `Number(true) === 1`). It can therefore report
`no-usage` or `measured` for fields that were never valid usage observations.
This weakens the new `partial-measurement` distinction.

Suggested fix: introduce one strict numeric parser that accepts finite numbers
and non-blank numeric strings only, then use it consistently in availability,
totals, grouping, phase totals, and carry-in calculation. Preserve the current
rule that every event needs valid input and output token totals before the set is
considered complete. The sandbox added 15 deterministic matrix tests covering
unsupported, missing, partial, zero, measured, mixed, junk, and per-host
recovery behavior.

Sandbox evidence:
`/tmp/claude-dev-harness.HwJs28/results/03-usage-classification/sandbox.patch`

### 2. A corrupt complete Claude transcript line can terminate archive

Severity: High

Location: `.claude/harness/runtime/observability/telemetry-runtime.mjs`,
`readCompleteJsonLines()` and `syncClaudeTelemetry()`.

`readCompleteJsonLines()` calls the injected `die()` on malformed JSON.
`die()` calls `process.exit()`, so the quiet lifecycle drain cannot catch it.
This contradicts the intended contract in `apply-runtime.mjs`: telemetry is
advisory and an unreadable transcript must not prevent archive.

Suggested fix: throw a regular error while parsing a source. In
`syncClaudeTelemetry()`, fail explicit/non-quiet syncs, but warn and continue for
quiet lifecycle drains while leaving the source cursor unchanged. The sandbox
proved the defect red, applied that behavior, and passed the focused archive,
telemetry-concurrency, and actionable-telemetry suites.

Sandbox evidence:
`/tmp/claude-dev-harness.HwJs28/results/04-archive-telemetry-drain/sandbox.patch`

## Passed or incomplete areas

### Capacity-aware dispatch — PASS

Returned-order selection, `maxParallelAgents` bounding, no over-acquisition,
retry eligibility for unselected tasks, parent join ownership, and worker packet
boundaries passed. The sandbox reported 10/10 focused dispatch tests, 26/26
agent-contract assertions, 88/88 multi-repository assertions, 22/22 upgrade
compatibility assertions, and 3/3 wiring assertions.

### Worker contract/schema v8 — INCONCLUSIVE

All shipped targeted suites passed. Additional negative checks confirmed that
unleased packets still contain worker boundaries, a peer cannot release another
worker's lease, forced takeover requires a decision reference, out-of-scope
writes are rejected, and schema 7 is rejected against runtime schema 8.

The run exhausted its budget while correcting a new ledger-staleness fixture;
two added assertions failed because the selected probe task was dependency
blocked, not because a product defect was demonstrated. Treat the extra sandbox
test patch as unfinished and do not copy it directly.

### Oversized authority display — INCONCLUSIVE

The deterministic probe passed the under-limit case, exact-boundary behavior,
one-byte-over truncation, warning text, bounded valid JSON, and durable-route
summary. The run exhausted its budget while making the authority-request fixture
fully valid, so persistence/digest/status continuity and retry idempotency were
not completed. No product defect was confirmed.

The existing main-worktree unit test for durable packet preservation passes.
Finish the fixture validation before adopting the sandbox shell test.

## Recommended order

1. Fix corrupt-transcript handling first because it can terminate archive even
   though telemetry is documented as advisory.
2. Merge the strict measured-number parser with the current
   `partial-measurement` logic and add the full classification matrix.
3. Keep the capacity/worker changes; the shipped focused and contract suites are
   green.
4. Complete the authority persistence fixture and the ledger-staleness probe as
   test-hardening follow-ups, not release blockers based on this run.

## Harness safety note

One contract fragment was initially invoked directly instead of through
`run-harness-tests.sh`; that fragment assumes wrapper-provided `TMP` and helper
state and can mutate the caller repository when run standalone. A late fixture
commit was recovered and the original 14-file uncommitted worktree was restored
from the pre-run snapshot. The final main branch is back at `fc24240`, and the
original changes remain uncommitted. Future harnesses should call only the public
wrapper and should create the worktree snapshot before launching any child.
