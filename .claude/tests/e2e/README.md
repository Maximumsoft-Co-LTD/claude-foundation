# End-to-end testing

## Evidence boundary

`run-e2e.sh` targets the retired `.workflow/` phase orchestrator. It expects
legacy templates and artifact linting that are not shipped by Runtime API 8.
Do not use its live mode as release evidence for the OpenSpec-native product.

Current deterministic product contracts remain in `.claude/tests/run-all.sh`.
Consumer-level speed, quality, cost, and feedback-boundary measurements belong
in the separate `claude-foundation-lab` repository.

The temporary-project method below serves a different purpose: it asks several
real `claude -p` `/dev` runs to inspect and harden one in-progress change from
different risk angles. Its output is a diagnostic report and candidate patches,
not release evidence. Every reported defect still needs a deterministic
reproduction in the main test harness.

## Full-loop scenario (`loop/run-loop.sh`)

`loop/` holds the OpenSpec-native counterpart to the retired runner: one
simulated user takes a small consumer project (`loop/fixture/`, a pricing
module with a documented-vs-implemented boundary bug) through
`/investigate → /change → /build → /prove → /land`, one headless `claude -p`
session per phase, so cross-session state persistence is exercised too. The
sandbox is produced by the real consumer path (`install.sh <target> --yes`).

The model's prose is never the verdict. Between phases the runner asserts
deterministic lifecycle state: the investigation note exists and nothing else
was written; exactly one change exists and `changes` lists it; Build leaves no
pending task and no code or contract blocker in `proof readiness` (the review
boundary it hands to Prove is not a Build failure); `land check` exits 0 after
Prove; root `src/` stays untouched until Land;
after Land the change is archived, the suite is green, and `loop/accept.mjs`
(a content-bound acceptance check the run never sees) passes against the
landed code.

```sh
sh .claude/tests/e2e/loop/run-loop.sh          # dry-run plan (default, free)
sh .claude/tests/e2e/loop/run-loop.sh --run    # live; costs tokens
sh .claude/tests/e2e/loop/run-loop.sh --run --keep                 # keep sandbox
sh .claude/tests/e2e/loop/run-loop.sh --run --sandbox DIR --from 30  # resume
```

Env: `CLAUDE_LOOP_MODEL` (default sonnet), `CLAUDE_LOOP_TIMEOUT` (2400 s per
phase), `CLAUDE_LOOP_BUDGET_USD` (10 per phase). A broken deterministic assert
is FAIL (exit 1); a claude process failure — timeout, budget, stall — is
INCONCLUSIVE (exit 0) and stops the chain. Same evidence boundary as above:
diagnostic smoke, not release evidence.

## Parallel `/dev` diagnostic harness

Use this method when a change spans multiple runtime seams and benefits from
independent E2E probes. A good set contains four or five scenarios with disjoint
failure hypotheses.

For a deliberately broader audit, `diagnostic/run-claude-probes.sh` automates
the same snapshot and evidence boundary with exactly 20 focused `claude -p`
sessions. It defaults to a free dry run; live mode requires a clean source
checkout and writes every sandbox, transcript, patch, timestamp, and aggregate
summary under a new `/tmp/claude-foundation-20probe.*` directory:

```sh
bash .claude/tests/e2e/diagnostic/run-claude-probes.sh
bash .claude/tests/e2e/diagnostic/run-claude-probes.sh --run --jobs 5
```

Its model verdicts are triage, never release evidence. Reproduce every proposed
defect independently against the source checkout before changing production
code. The runner also shallow-fetches the historical tags named by
`CF_DIAGNOSTIC_TAGS` (default `v3.2.19`) into each content snapshot, because the
upgrade-compatibility suite exercises that real prior release.

For example, the packet/dispatch/telemetry change tested on 2026-08-20 used:

1. capacity-aware spawn-group dispatch;
2. leased-worker packet contracts and schema compatibility;
3. usage availability classification;
4. archive-time telemetry draining;
5. oversized review-authority display and durable persistence.

Do not create five paraphrases of the same happy path. Each scenario should name
its boundary conditions, negative cases, and the evidence needed for a verdict.

### 1. Snapshot before launching children

Capture the branch, status, and the complete tracked diff before starting any
background process. Use `git diff HEAD`, not plain `git diff`, so staged changes
are included.

```sh
HARNESS_ROOT="$(rtk mktemp -d /tmp/claude-dev-harness.XXXXXX)"
rtk git rev-parse HEAD > "$HARNESS_ROOT/source-head.txt"
rtk git status --porcelain=v2 > "$HARNESS_ROOT/source-status.txt"
rtk git diff HEAD --binary --output="$HARNESS_ROOT/worktree.patch"
rtk git ls-files --others --exclude-standard > "$HARNESS_ROOT/untracked.txt"
```

Review `untracked.txt`. Copy only untracked files that are required by the test
into each sandbox, preserving their relative paths. Never copy secrets, local
databases, dependency trees, build output, or runtime state. Record the selected
file list in the report.

Do not run a file under `contracts/` directly. Contract fragments assume that a
public wrapper has initialized `TMP` and helper functions; without that context
they may operate in the caller repository. Use commands such as:

```sh
rtk bash .claude/tests/harness/run-harness-tests.sh multi-repository
```

### 2. Create one isolated clone per scenario

Create every clone from the captured source commit and apply the same patch.
`--no-local` avoids sharing mutable worktree state with the source checkout.

```sh
SCENARIO_ID="01-dispatch-capacity"
SANDBOX="$HARNESS_ROOT/sandboxes/$SCENARIO_ID"
RESULT="$HARNESS_ROOT/results/$SCENARIO_ID"

rtk mkdir -p "$RESULT"
rtk git clone --quiet --no-local "$(rtk git rev-parse --show-toplevel)" "$SANDBOX"
SOURCE_HEAD="$(rtk proxy sed -n '1p' "$HARNESS_ROOT/source-head.txt")"
rtk git -C "$SANDBOX" checkout --quiet "$SOURCE_HEAD"
rtk git -C "$SANDBOX" apply "$HARNESS_ROOT/worktree.patch"
```

Before starting Claude, verify that each clone has the expected changed-file
set. If it differs from the captured source status, stop; the scenarios would no
longer be testing the same input.

### 3. Run `claude -p` concurrently

Start Claude from inside each sandbox. Remove `CLAUDECODE` so a nested headless
session is allowed. `--dangerously-skip-permissions` is acceptable only because
the target is a disposable clone; never point this invocation at the source
worktree. Give every child its own output files and budget.

```sh
PROMPT='/dev --yes Test and harden the current uncommitted implementation for scenario: <focused scenario and boundary cases>

This is an isolated disposable test sandbox. Inspect the current diff first.
Exercise the behavior with focused deterministic tests, including negative and
boundary cases. If you find a real defect, fix it and add a regression test
inside this sandbox. Do not commit, push, or open a PR. Finish with a concise
report containing: verdict PASS/FAIL/INCONCLUSIVE, commands run, evidence,
defects with severity and file:line, and suggested fix.'

(
  cd "$SANDBOX" || exit 97
  rtk proxy env -u CLAUDECODE claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    --output-format json \
    --max-budget-usd 5 \
    > "$RESULT/claude.json" 2> "$RESULT/stderr.log"
  rtk printf '%s\n' "$?" > "$RESULT/exit-code.txt"
  rtk git diff --binary --output="$RESULT/sandbox.patch"
  rtk git status --short > "$RESULT/status.txt"
) &
CLAUDE_PIDS="$CLAUDE_PIDS $!"
```

Repeat that block for four or five scenario IDs, then wait for the recorded
children:

```sh
for CLAUDE_PID in $CLAUDE_PIDS; do
  wait "$CLAUDE_PID"
done
```

Initialize `CLAUDE_PIDS=""` before launching the first child. Add a trap in an
automated runner that terminates only these recorded PIDs on `INT` or `TERM`,
then checks for their direct children before returning. Do not use a broad
`pkill claude`; it can stop unrelated user sessions.

The CLI may emit either one result object or a JSON array whose final element is
the result. Normalize both shapes before aggregation:

```sh
rtk jq 'if type == "array" then .[-1] else . end |
  {subtype,is_error,result,total_cost_usd,duration_ms,num_turns}' \
  "$RESULT/claude.json"
```

### 4. Preserve evidence per scenario

Each result directory must contain:

- `claude.json`: complete CLI result or event envelope;
- `stderr.log`: CLI and hook diagnostics;
- `exit-code.txt`: process result;
- `sandbox.patch`: fixes and tests proposed inside the sandbox;
- `status.txt`: changed-file inventory;
- start and finish timestamps when the runner supports them.

Classify a scenario as:

- `PASS` only when the requested boundary cases ran and all relevant checks
  passed;
- `FAIL` when a product defect is deterministically reproduced;
- `FAIL -> PASS with sandbox fix` when the same reproduction turns green after
  a candidate fix;
- `INCONCLUSIVE` for budget exhaustion, timeout, invalid fixtures, missing
  evidence, or an incomplete `/dev` lifecycle—even if several checks passed.

Never copy a sandbox patch directly into the source tree. Read it, reproduce the
failure against the source checkout, then implement and verify the smallest
appropriate fix separately.

### 5. Re-verify the source checkout

After all children exit, compare the source branch and status with the captured
snapshot before running main-worktree verification:

```sh
rtk git rev-parse HEAD
rtk proxy sed -n '1p' "$HARNESS_ROOT/source-head.txt"
rtk git status --porcelain=v2
rtk proxy sed -n '1,240p' "$HARNESS_ROOT/source-status.txt"
```

If either differs, stop and investigate before editing anything. Preserve the
pre-run patch and reflog; do not use `git reset --hard` or discard files. Restore
only after identifying the exact process and affected paths.

Then run deterministic suites proportional to the change. For the example
change, the focused verification was:

```sh
rtk node --test \
  .claude/harness/tests/agent-dispatch.test.mjs \
  .claude/harness/tests/workflow-policy.test.mjs \
  .claude/tests/harness/run-actionable-validation-telemetry-tests.mjs \
  .claude/tests/harness/run-archive-telemetry-tests.mjs
rtk bash .claude/tests/harness/run-agent-contract-tests.sh
rtk bash .claude/tests/harness/run-harness-tests.sh multi-repository
```

### 6. Write the report

Store the durable summary under `docs/reports/`. Include:

- source commit and changed-file scope;
- Claude version, scenario budget, total cost, and parallel wall time;
- one row per scenario with CLI status, cost, duration, and verdict;
- confirmed defects ordered by severity, with reproduction and suggested fix;
- incomplete probes and the exact reason they are not evidence;
- deterministic main-worktree verification results;
- the temporary raw-result path and candidate patch path;
- confirmation that the source branch and original worktree were preserved.

The 2026-08-20 reference report is
`docs/reports/dev-test-report-2026-08-20.md`.
