# OpenSpec-native efficiency benchmark

This is the current benchmark surface for the installed OpenSpec-native
Foundation runtime. It does not reuse the retired `.workflow/` runner in the
parent directory.

This page is the maintainer protocol for running and diagnosing the lab. For a
short statement of what is green or still required, read
`docs/reports/user-scenario-release-status.md`; for the scenario portfolio and
acceptance rules, read `docs/reports/user-scenario-test-plan.md`.

## End-to-end terminal contract

A paid scenario is green only after the change reaches `archived`: Change,
Build, Prove, review, Land, and post-Land delivery checks must all complete.
A passing proof with `landStatus: awaiting-user` is scored `incomplete` with
`failureClass: land-not-archived`.

The consumer lab marks every project disposable. Paid lab runs explicitly
authorize main-session self-review and Land inside that disposable workspace;
the waiver remains visible in review provenance. This test authority never
changes the normal product project's review or explicit-Land policy.

For an explicitly authorized paid Land lane, the runner treats the backend
`archived` lifecycle state as terminal truth. It stops a host that is still
generating closing narration and immediately proceeds to oracle, quality,
project, and clean-room verification; it never upgrades `proven` or
`code-applied` to completion.

When a lane has a deterministic task oracle, the runner stops first at
`proven`, executes that oracle against the still-isolated sandbox, and permits
the backend Land operation only on a passing verdict. Hidden task failure can
therefore never be discovered for the first time after archive.
Failed case IDs start a fresh Build/Prove continuation against the same
disposable change while wall/request allowance remains. A retained lab can be
continued with `--resume-project <path>`; a `proven` fast path uses zero model
requests only when backend `land-check` also confirms that proof is fresh.

The runner records one
`foundation-openspec-native-scorecard-v1` JSON row per execution. Its trusted
speed value is the runner's monotonic wall-clock stopwatch. Claude's result
envelope duration is retained only as `hostEnvelopeDurationMs` because it may
exclude sub-agent time.

## Safety boundary

A live run refuses any project that does not contain both:

- an installed `.claude/harness/foundation.mjs`; and
- `.foundation-benchmark.json` containing `{ "disposable": true }`.

The runner never creates or deletes the project. Prepare a disposable project
explicitly:

```bash
BENCH_PROJECT="$(mktemp -d)"
./install.sh "$BENCH_PROJECT" --yes
printf '{"disposable":true}\n' > "$BENCH_PROJECT/.foundation-benchmark.json"
```

Do not add that marker to a real project.

## Live run

For a maintained scenario, use the consumer-lab wrapper. It creates a clean
temporary consumer from the frozen seed, installs the current source revision,
checks the seed digest, runs the normal benchmark, preserves the source patch,
installed manifest, lifecycle/evidence trees, host output, oracle, quality, and
scorecard under one run directory, then removes the consumer:

```bash
node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario bare-node-boundary
```

Pass `--keep-project` only for an explicit debugging run. Direct `run.mjs`
invocation remains available for an already prepared disposable project.
Each retained run has `manifest.json`, `source.patch`, and `integrity.json`; the
last file content-binds every preserved artifact. Aggregate repeated runs with:

```bash
npm run bench:openspec-native:aggregate -- \
  .claude/tests/bench/results/openspec-native-lab
```

Before authorizing any paid smoke, run the zero-cost release sentinel:

```bash
npm run bench:openspec-native:sentinel
```

It validates the matrix, checks every frozen fixture digest, and runs the
deterministic defect/repair oracle for every workload row. Its versioned
JSON report includes the matrix, source patch, command-output, and fixture
digests. A dirty source tree is reported explicitly and is not presented as an
immutable release baseline.

The aggregate is strict: lifecycle completion, oracle, quality, ordinary
project command, clean install, and the post-install project command must all
pass for every run. Missing measurements remain `null`, never zero.

Generate the versioned release evidence index after collecting runs:

```bash
npm run bench:openspec-native:release-report -- \
  .claude/tests/bench/results/openspec-native-lab
```

The report always reruns the zero-cost sentinel, then classifies each matrix
row as `deterministic-green`, `smoke-green`, `repeated-green`, or `blocked`.
For measured values it reports reliability first, followed by median and p95
wall time, cost, model requests, operations, and resumptions. Missing paid runs
and incomplete repeat counts are explicit blockers; unavailable measurements
remain separate from numeric zero. The command exits 2 until every paid row has
the required identical-source repeats.

Clean-room verification is a separate versioned contract from the focused
project command. It runs with a bounded timeout and disposable npm, pip, and XDG
caches, records its declared network policy, and reports a missing command as
`unavailable` rather than converting it into a test failure or a pass. The
ordinary project command runs again only after clean installation succeeds.

```bash
npm run bench:openspec-native -- \
  --scenario todolist-r2 \
  --project "$BENCH_PROJECT" \
  --prompt "/dev create app todolist" \
  --repeat 1 \
  --timeout-ms 1800000
```

Paid runs should bind every matrix lane directly to the runner:

```bash
  --timeout-ms <budget.wall_ms> \
  --max-cost-usd <budget.cost_usd> \
  --max-model-requests <budget.model_requests> \
  --max-tool-calls <budget.tool_calls>
```

The wall and cost ceilings are delegated to the stopwatch and Claude CLI. The
budgets must cover the scenario's declared convergent repair path, not only its
happy path. Increasing a ceiling never changes the measured result or its
baseline comparison; the scorecard still reports actual wall time and request
count, and a run is green only at `archived` with delivery checks complete. The
runner counts distinct streamed model request IDs and terminates at the request
ceiling; `--max-tool-calls` likewise counts distinct streamed `tool_use` IDs
(failure class `budget-exhausted-tool-calls`). Budget termination records
`needs-user-decision`; it is resumable and
is never classified as completed or permanently blocked.

For an existing change, the runner executes deterministic proof readiness
before dispatching the paid host. An `external-authority` user decision stops
at that preflight boundary with zero model requests. The same structured
boundary is also recognized in live tool output, so an active host is stopped
on the first independent-review or external-evidence decision instead of
polling readiness with more model calls. A stable decision fingerprint makes a
repeated unchanged boundary visible without reopening model work.

Brownfield tasks can add a deterministic hidden-acceptance oracle. The runner
invokes the shell script only after workflow proof completes and passes the
delivered sandbox as its sole argument:

```bash
npm run bench:openspec-native -- \
  --scenario recent-window-brownfield \
  --project "$BENCH_PROJECT" \
  --prompt "/dev fix bug #412" \
  --oracle .claude/tests/bench/tasks/11-recent-window/oracle/run.sh
```

The oracle must emit one JSON object with `verdict`, `score`, `max`, and
per-criterion `results`. A configured oracle that fails, times out, exits
nonzero, or emits an invalid result prevents `outcome.complete`, even when the
Foundation proof itself passed. This keeps workflow evidence truth separate
from benchmark task correctness without exposing the answer key to the agent.

Extra Claude arguments must be passed as repeated, literal `--claude-arg`
values. The runner does not enable a permission bypass itself.

The append-only scorecard defaults to
`.claude/tests/bench/results/openspec-native-scorecards.jsonl`. Per-run host
metadata, stderr, and the formatted scorecard are kept under
`results/openspec-native-runs/<run-id>/`. The results directory is ignored by
Git.

Live runs retain Claude's verbose `stream-json` as `host.stream.jsonl`. A
timeout can therefore keep observed browser and task-mirror counts even when
the final result envelope never arrives. Cost remains unavailable in that case;
the scorecard never guesses dollars from an external price table.

Request accounting keeps the effective, stream-observed, host-reported, and
cap-consumed counts separately. On forced termination, an observed request
count wins over a synthetic zero result envelope. A zero-cost envelope paired
with observed model work is treated as unavailable rather than as free usage;
nonzero final-envelope cost from an interrupted run remains partial.

## No-harness baseline arm

Every paid scenario can also run without Change Loop, scored by the same
hidden oracle, so correctness, cost, wall time, and interruptions compare
directly. The default arm stays `change-loop`; existing commands, prompts, and
scorecards are unchanged apart from the additive `arm` field.

```bash
node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario notes-api --arm baseline
```

The baseline arm:

- copies the same frozen seed and writes the same disposable marker, but runs
  no installer: no `.claude/`, `openspec/`, `.foundation/`, hooks, or
  `claude-foundation` shim. `run.mjs --arm baseline` refuses a project that
  contains any of them. The seed becomes one local Git commit so read-only Git
  works and the lab can keep the delivered diff as `product.patch`;
- sends the scenario task text without its leading slash command, the canonical
  project test command, and the same partition hint, then asks for direct
  implementation with tests, a green project command, and uncommitted changes.
  It carries no `advance`, review, archive, or Land instruction;
- pre-approves only what a plain user would for the task under
  `--permission-mode acceptEdits`: `Edit(/**)`, the project command's runner,
  `npm test` when the manifest declares it, and read-only `git status`,
  `git diff`, `git log`, and `git show`;
- uses the same matrix wall, cost (`--max-budget-usd`), request, and tool-call
  ceilings and the same model as the Change Loop arm;
- ends when the host exits. There is no lifecycle watch, preflight, oracle
  repair continuation, or resume. The oracle then grades the working tree the
  host left, the project command runs once more, and the usual quality, clean
  install, and friction measurements follow. A baseline row is `completed`
  only when the host exited cleanly, its project command passes, and the oracle
  passes.

Check any arm for free first. `--dry-run` prepares the project, prints the
prepared tree, the exact host argv and prompt, and the ceilings, calls no model,
writes no results, and removes the project unless `--keep-project` is given:

```bash
node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario notes-api --arm baseline --dry-run
```

Compare arms side by side, from one or several result roots:

```bash
npm run bench:openspec-native:aggregate -- \
  <change-loop-results> <baseline-results> --compare        # Markdown table
npm run bench:openspec-native:aggregate -- \
  <change-loop-results> <baseline-results> --compare-json   # pairwise JSON
```

Aggregates are keyed by scenario and arm; rows written before arms existed are
Change Loop rows. The pairwise table reports oracle passes and median score,
median cost, wall time, model requests, host tool calls, and permission prompts
per arm. A `*` marks a cost that at least one run reported only partially,
because the host was stopped before its result envelope (the Change Loop arm
stops its host at `proven` or `archived`); compare such costs as lower bounds.
The release report reads Change Loop rows only: a baseline row can neither
promote nor block a matrix row, and is counted in `excludedComparisonRuns`.

## Collection-only verification

Fixtures and recovered runs can be scored without launching Claude:

```bash
npm run bench:openspec-native -- \
  --collect-only \
  --scenario todolist-r2 \
  --project "$BENCH_PROJECT" \
  --change-id <change-id> \
  --run-id recovered-1 \
  --wall-ms <measured-wall-ms> \
  --output /tmp/native-scorecards.jsonl
```

If wall time, usage, cost, operations, or quality was not measured, the field
is `null` and its measurement state is `unavailable`; absence is never rendered
as zero. A run is complete only when the host completed, no tasks remain, and a
passing durable proof exists, plus a passing oracle when one was configured.

`operations.hostToolCalls` records the host's distinct `tool_use` calls from the
stream: `total`, `byTool`, and `byCategory` over the closed set `harnessCli`,
`harnessDocReads`, `stateReads`, `harnessArtifactWrites`, `productWrites`,
`testRuns`, and `other`. The categorizer is shared with the runtime transcript
importer (`metrics <change>` → `hostToolProfile`). Without a host stream every
count is `null`.

`friction` records what the harness cost the agent: `hookBlocks` (tool calls a
hook refused), `permissionPrompts` (host approvals the agent waited on,
including host safety denials such as a JSON heredoc),
`toolErrors` (failed results the agent saw; a call the bench's own stop killed
mid-flight, with no later assistant turn, is not counted), `advanceActions` (protocol-6 actions the agent was handed), and
`guardrail` (the guard's own audit outcomes in the run window: `redirected`,
`routed`, `guided`, `shell-audit`, `blocked`). The target for a normal run is
zero `hookBlocks`; the lab aggregate sums `hookBlocks`, `permissionPrompts`,
`askUserActions`, and `repairActions` per scenario. The 2026-10-06 baseline
before the guards stopped refusing was one hook block in every lane and eight
approval prompts across six lanes.

Completed Node.js runs collect coverage and CRAP from the delivered sandbox.
Projects with an npm test script use it; bare CommonJS/ESM projects fall back to
discovered `*.test.*` and `*.spec.*` files under `node --test`.

The schema is
[`../config/openspec-native-scorecard.schema.json`](../config/openspec-native-scorecard.schema.json).
Targets remain in
[`../config/openspec-native-targets.json`](../config/openspec-native-targets.json).

## Workload matrix and repeat gate

Do not tune only for the todolist sentinel. The release matrix must cover these
distinct control paths:

The machine-enforced cross-domain plan lives in
[`../config/openspec-native-matrix.json`](../config/openspec-native-matrix.json).
Every workload class has an executable frozen fixture (including the
`tiny-feature` overhead probe, target `tool_calls_max: 20`); a future row
must remain `planned` until its seed digest, prompt, host, risk, project and
clean-install commands, critical cases, oracle, quality policy, and budgets are
complete. Inspect the matrix or one ready execution plan with:

```bash
node .claude/tests/bench/openspec-native/matrix.mjs
node .claude/tests/bench/openspec-native/matrix.mjs \
  .claude/tests/bench/config/openspec-native-matrix.json bare-node-boundary
```

Budget exhaustion is a resumable user-decision boundary in this manifest. It
may not be converted into either completed work or a permanent blocked result.

| Class | Representative work | Required terminal truth |
|---|---|---|
| Greenfield | CLI and browser app from an empty repository | Change never creates product code; Build and Prove complete |
| Brownfield | Focused bug fix with existing tests and architecture | Baseline digests remain strict; rapid lane stays rapid |
| Contract/data | Public API or persisted-format migration | Compatibility, rollback, and invariant evidence pass |
| Multi-repository | Producer/consumer contract change | Scoped leases, topology, and ordered proof complete |
| External authority | Deploy, secret, IAM, or human acceptance | One handoff, no polling, truthful waiting state |
| Long-running evidence | Integration/browser/provider command | External time is measured and no duplicate execution occurs |
| Resume/recovery | Timeout, crash, stale lock, or exhausted budget | Resume starts at the first incomplete operation |
| Non-code | Investigation or documentation-only request | No unnecessary Build/Prove lifecycle is invented |

Run one disposable sentinel first. Continue to paid repeats only when it reaches
its expected terminal state and reports walltime, usage, operation counts, and
quality without unknown fields that the comparison needs. Then use at least
three repeats per changed workload class; never ratchet from a timeout, a single
run, or two runs that selected materially different product surfaces.
