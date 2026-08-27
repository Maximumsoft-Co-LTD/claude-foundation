# Harness consumer E2E assessment — 2026-08-27

## Executive summary

Foundation's deterministic runtime and repository test suite are internally
strong, but the current consumer journey is not reliable enough for unattended
`claude -p` feature delivery. The main failure is not that Claude cannot write
code. It is that a headless session can exit successfully while the lifecycle is
still waiting, code can diverge between the Build sandbox and the consumer
working tree, and Prove/Land bindings can invalidate an already reviewed change.

Ten realistic consumer tasks were run against source revision
`bec9af3815d4244b9c869d72ecefe8baa16ee891` with Claude Code 2.1.247 and
Sonnet. The run required 21 top-level Claude sessions after recovery and Land
attempts. Provider-reported cost was $52.00, with 172.64M input-context tokens,
815K output tokens, and 1,678 turns. Only one scenario Landed. Its focused tests
passed, but the repository-wide `node --test` command failed because an archived
test-topology file was rediscovered from the wrong working directory. Therefore
zero scenarios achieved the strict terminal condition: Landed, acceptance met,
and the ordinary project test command green.

The required development order is:

1. make terminal status truthful and headless external work bounded;
2. enforce sandbox/root phase isolation and make Land projection stable;
3. repair proof/review rebinding and archive test isolation;
4. move CI/review decisions to preflight;
5. activate measurable consumer quality, including CRAP, by policy;
6. optimize turns, context, and cost only after reliability is green.

## Remediation implemented after the assessment

The first P0 repair batch was implemented directly in the working tree after
the baseline run. These are code changes with deterministic regression
coverage; they are not yet a claim that the ten-scenario portfolio is green.

| Finding | Implementation status |
|---|---|
| P0.1 detached reviewer | Fixed for Claude Code: a PreToolUse hook rejects background `authority run` via `&`, `nohup`, `setsid`, or `disown`; the configured reviewer remains synchronous and session-owned. |
| P0.2 false `/dev` success | Fixed for Claude Code: a Stop hook reads runtime state and blocks termination with typed `DEV_TERMINAL/INCOMPLETE` until exactly one active change has a passing, audited proof bound to the current workspace hash. It records `changeId`, `phase`, `blockerKind`, `resumeAction`, and wall time; provider cost remains unavailable until the final provider envelope. |
| P0.3 root/sandbox isolation | Fixed on the `/dev` path: the default audit rollout promotes to blocking for a `/dev` transcript, including before the first phase packet. Build recovers the authorized sandbox from recorded runtime state when the host exports no workspace variable. Non-`/dev` sessions retain the documented audit default. |
| P0.4 Land identity drift | Fixed for the observed cause: Land no longer runs `git add -N .` in the sandbox. Tracked and untracked paths are discovered read-only, so Land cannot change the proven snapshot merely by inspecting it. `reset-base-move` is recommended only when an eligible, diff-changing sync record exists. |
| P0.5 archived test discovery | Fixed at validation: runnable source files are forbidden inside change packets; test topology must remain path-and-digest evidence in `grounding.yaml`, so archive cannot introduce executable test copies. |

Regression evidence completed so far:

- the historical task-list false-success transcript now returns
  `INCOMPLETE/proof-not-passing` from the new Stop gate;
- phase mutation guard: 36/36 assertions pass;
- change-loop seams: 121/121 assertions pass;
- base-move rebind: 20/20 assertions pass;
- all 26 affected suites pass;
- the authoritative full suite passes all 181 suites after the repair batch.

Still outstanding before release: authority/CI preflight, acceptance-oracle
binding, consumer CRAP activation, cost/context optimization, the maintained
consumer lab, and a fresh immutable ten-scenario run (preferably n≥3 for noisy
speed and cost comparisons). Therefore the baseline speed, quality, token, cost,
wall-time, and CRAP conclusions below remain the current measured result.

## Scope and method

### Source and runtime

- Product source: `bec9af3815d4244b9c869d72ecefe8baa16ee891`
- Claude Code: 2.1.247
- Requested model: `sonnet`; session envelope reported `claude-sonnet-5`
- Strict empty MCP configuration
- Fresh Foundation installation into every disposable consumer repository
- Initial cap: $6 and 2,400 seconds per task
- Recovery cap: $3 per active change
- Land cap: $2 per proven change
- Initial concurrency: five
- Source checkout remained clean

### Consumer scenarios

1. Greenfield task-list web app
2. Responsive, accessible landing page
3. Session-token security module
4. Persisted user-name migration
5. Backward-compatible article pagination
6. Fractional-money rounding fix
7. Activity-window bug fix
8. Contact search feature
9. Multi-module finance refactor
10. Contact sorting feature

Every task used `/dev --yes` as a real user would. Recovery turns continued the
same active change. Changes that reported proof completion were checked with the
runtime's own `land-check`; Land was attempted only when that check was green.
Delivered behavior was then checked with focused tests, hidden deterministic
oracles where available, and direct acceptance probes. Model prose was never
treated as the verdict.

## Quantitative result

| Measure | Result |
|---|---:|
| Consumer scenarios | 10 |
| Top-level Claude sessions | 21 |
| Initial sessions with process rc 0 | 9/10 |
| Initial sessions actually proven | 1/10 |
| False-success initial envelopes | 8/10 |
| Initial max-budget failures | 1/10 |
| Changes with green `land-check` before Land | 2/10 |
| Successfully Landed | 1/10 |
| Feature-level acceptance pass | 4/10 |
| Landed + acceptance + ordinary full test command green | 0/10 |
| Initial provider-reported cost | $41.31 |
| Total cost including recovery/Land attempts | $52.00 |
| Mean total cost per scenario | $5.20 |
| Initial mean wall time per task | 15.1 min |
| Initial median wall time per task | 15.0 min |
| Initial task range | 9.1–20.5 min |
| Parallel initial suite wall time | 39.8 min |
| Full exercise wall time | 72.5 min |
| Summed session duration | 207.5 min |
| Input context | 172.64M tokens |
| Output | 815K tokens |
| Thinking output | 410K tokens |
| Turns | 1,678 |
| Input cache-read share | ~98.7% |

Cost is a lower bound. Review adapters launched as external/background Claude
processes may not be included in the calling session's `total_cost_usd`.

## Scenario result

| Scenario | Lifecycle result | Delivered-quality result |
|---|---|---|
| Task list | Exited rc 0 waiting for review; recovery also exited waiting | Root implementation and four focused tests passed |
| Landing page | Exited waiting for review; recovery restarted polling and exited again | Root verification failed content, landmarks, focus, and dark-mode checks; completed work remained in Build sandbox |
| Session token | Grounding lock blocked Build recovery | Tests/typecheck/security lint passed, but the opaque-token design did not satisfy the stated signature/constant-time comparison contract |
| Name migration | Review remained background pending | Build sandbox passed, but root `users.json` retained the legacy schema and failed compatibility |
| API pagination | Proof reported complete after recovery | Root API remained unchanged; Land required signed CI that was not configured |
| Rounding fix | Review remained background pending across two turns | Root behavior and focused regression test passed |
| Recent window | Proved; Land invalidated proof binding | Hidden oracle 5/6; negative/fractional input remained wrong; base-move recovery route did not match recorded state |
| Contact search | Root edited before Build, making sandbox creation refuse the dirty baseline | Hidden oracle 5/5 passed in root despite failed lifecycle |
| Finance refactor | Exhausted $6 initial and $3 recovery budgets | Hidden oracle 5/7; invoice/report drift and regression-test criterion still failed |
| Contact sorting | Proved after recovery and Landed | Focused tests passed; broad `node --test` failed on archived test-topology discovery |

## Assessment by dimension

### Reliability: fail

The CLI envelope is not a lifecycle verdict. Eight initial runs returned rc 0
and subtype `success` without a passing proof. Several final replies explicitly
said that a reviewer was still running or that the session would wait, but the
headless process terminated immediately.

The shipped Prove procedure already says a background dispatch dies with the
session and instructs the agent to remain in-session. Live behavior violated
that instruction repeatedly. This requires a runtime/host contract, not more
prompt emphasis.

### Quality: fail

Claude often produced plausible code and focused tests, but only four root
deliverables met their feature-level acceptance criteria. Hidden oracles found
defects after proof/review had called work complete:

- recent-window: 5/6; negative/fractional windows were still wrong;
- contact-search: 5/5;
- finance-refactor: 5/7; both reconciliation and regression-test coverage failed.

The one Landed scenario passed its focused tests but broke the repository-wide
test command through archived test discovery.

### Speed: fail

An XS/S task took a median of 15 minutes before Land, and many needed another
turn. Recovery itself ranged from seconds to 18.7 minutes. A small task could
spend eight extra minutes only to end at the same background-review wait.

### Cost and context: fail

The exercise consumed $52 and 172.64M input-context tokens. The 98.7% cache-read
share kept billed cost far below raw context volume, but the workflow still
re-read large contexts over 1,678 turns. Optimization must reduce the request
count and repeated state correction, not only resident instruction size.

### User interaction: fail

`--yes` did not form a predictable authority boundary. Late in the run, agents
asked for decisions about reviewer cost, grounding reopen, budget continuation,
signed CI, and proof rebind. Some are legitimate trust decisions, but they were
discovered only after substantial implementation spend. Preflight should expose
them before Build.

### Isolation and delivery: fail

The observed states included both failure directions:

- correct work existed only in `.foundation/sandboxes/...`, while the root still
  failed acceptance;
- agents edited root before Build, after which sandbox creation correctly refused
  the dirty baseline.

The phase mutation guard did not reliably keep agent writes inside the phase's
authorized workspace.

### Consumer quality and CRAP: not measured

No consumer sandbox produced a CRAP report. Only the installed schema and test
fixture existed. The consumer quality framework was present but no quality
configuration/provider was activated by `/dev`, so CRAP status is `not measured`,
not zero and not pass.

The repository policy currently defines warning at 20 and failure at 30, rejects
regression, and expects changed unit coverage of at least 80%. None of those
gates participated in the consumer runs.

## Confirmed failure modes and seams

### P0.1 — Headless background work has no trustworthy terminal contract

**Evidence:** task-list, landing, migration, rounding, and their recovery turns
ended with “wait” prose while the process exited successfully.

**Relevant seams:**

- `.claude/skills/prove/references/workflow.md`
- `.claude/harness/runtime/workflow/authority-runtime.mjs`
- `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`

**Required change:** In non-interactive mode, reviewer dispatch must either:

1. block in the owning runtime until completion or a bounded timeout; or
2. persist a durable external job and return a typed non-success terminal status
   such as `WAITING_EXTERNAL`, with a resume token.

Agent prose must not determine the process result. `/dev` success must require a
passing proof. Pending proof should produce a distinct nonzero/typed incomplete
result that automation can classify.

**Acceptance gate:** a fake delayed reviewer cannot yield rc 0 before a proof or
typed wait receipt exists; killing the caller cannot burn or orphan the attempt.

### P0.2 — `/dev` terminal truth is not enforced

**Evidence:** nine initial process successes, one actual proof success.

**Relevant seams:**

- `.claude/commands/dev.md`
- `.claude/orchestrator.md`
- host command/result wrapper

**Required change:** add a deterministic terminal assertion after the agent turn:
exactly one active change, all Build tasks complete, proof status pass. If not,
the command result is `INCOMPLETE`, regardless of model output or Claude CLI rc.
Expose machine-readable fields: `changeId`, `phase`, `status`, `blockerKind`,
`resumeAction`, `cost`, and `wallMs`.

### P0.3 — Build/root mutation authority is porous

**Evidence:** contact-search edited root before Build and made sandbox creation
impossible; landing, migration, and API work passed in Build but root remained
unusable.

**Relevant seams:**

- `.claude/hooks/phase-mutation-guard.mjs`
- `.claude/harness/runtime/workflow/sandbox-runtime.mjs`
- `.claude/commands/build.md`

**Required change:** make the phase guard content-aware and fail closed:

- Change may write only packet files;
- Build product/test writes must resolve inside the recorded sandbox;
- Prove is read-only except evidence state;
- Land alone may apply the proven projection to root.

Add an early check that the sandbox baseline is usable before implementation.
Do not solve this by silently committing user work.

### P0.4 — Proof/Land identity can invalidate unchanged work

**Evidence:** recent-window had a passing proof and green `land-check`; Land then
changed the workspace identity, invalidated proof, offered `reset-base-move`, and
that command refused because no base-move record existed.

**Relevant seams:**

- `.claude/harness/runtime/workflow/land-runtime.mjs`
- `.claude/harness/runtime/evidence/review-attempt-store.mjs`
- `.claude/harness/runtime/workflow/authority-runtime.mjs`

**Required change:** validate proof against the immutable proven projection before
root mutation. After apply, compare projection/content digests instead of treating
the expected root transition as an unrecorded edit. Automatically rebind a passing
review only when the full reviewed projection is byte-identical. Never recommend
`reset-base-move` unless the required sync record exists.

**Acceptance gate:** a proven byte-identical projection survives Land without a
new review; a one-byte change still invalidates it.

### P0.5 — Archived change tests pollute consumer test discovery

**Evidence:** contact-sorting's root `render.test.js` passed, but broad
`node --test` discovered
`openspec/changes/archive/.../test-topology/render.test.js` and failed because its
relative imports resolved from the archive tree.

**Relevant seams:**

- archive/spec-sync logic in `.claude/harness/runtime/workflow/land-runtime.mjs`
- generated `test-topology` artifacts

**Required change:** archived contract evidence must not look like runnable project
tests. Store it with a non-test suffix or outside default discovery, or generate a
project-level exclusion when the ecosystem supports it.

## P1 improvements

### P1.1 — Preflight every required authority and external dependency

Before Build, produce one decision sheet containing:

- required independent-review mode and estimated external cost;
- whether a grounding reopen or waiver is already needed;
- required signed CI and whether its key/provider exists;
- anticipated post-Prove Land requirements;
- request/token budget and the consequence of exhaustion.

`--yes` should have a documented typed scope. It may authorize the configured,
non-destructive reviewer route and deterministic recovery, but must not silently
authorize trust waivers or changed behavior. Anything outside that scope must
block before implementation spend.

### P1.2 — Make budget recovery structural

Separate model-work budget from deterministic CLI operations and reviewer wait
time. Validate generated grounding/contract structures locally before another
model turn. A resume packet should carry only current blockers and the minimal
change identity, not rebuild the whole conversation.

Proposed performance gates after P0 is green:

| Tier | Median wall to Prove | Median cost to Prove | Terminal reliability |
|---|---:|---:|---:|
| XS | ≤5 min | ≤$1.50 | ≥95% |
| S | ≤10 min | ≤$3.00 | ≥95% |
| M | ≤20 min | ≤$6.00 | ≥90% |

### P1.3 — Surface signed-CI feasibility before work

API pagination reached proof and only then learned that Land required a signed
CI provider. `doctor --stage change` or change validation should report this as a
preflight blocker/handoff. Preserve the policy; move discovery earlier.

### P1.4 — Turn acceptance cases into proof inputs

Promote explicit AC boundary cases into machine-readable critical-case IDs and
require the test provider to prove them. Add FAIL_TO_PASS oracles for bug fixes
and hidden holdout acceptance in the consumer lab. Reviewer pass must never
override a failing deterministic acceptance oracle.

### P1.5 — Activate consumer quality intentionally

For supported JavaScript/TypeScript projects:

1. `quality discover` during Change;
2. generate a preview configuration and require an explicit write policy;
3. collect coverage and complexity during Build/Prove;
4. emit a real CRAP report bound to workspace/tool/config digests;
5. enforce warning 20, failure 30, changed-unit coverage 80%, and regression;
6. report `unsupported` or `not measured` explicitly when a provider is absent.

Do not claim the consumer quality framework is active merely because its schema
was installed.

## P2 product and observability improvements

### P2.1 — Clarify the delivery command

`/dev` intentionally stops after Prove. A user asking “build this feature” often
expects files in root. Keep Land explicit, but offer a clearly named composition
such as `feature --through-land` that performs Change → Build → Prove → Land only
after preflight authority is settled. Its final state must still avoid commit,
push, and PR unless separately authorized.

### P2.2 — First-class consumer scorecard

Every run should emit one durable row covering:

- terminal lifecycle state and blocker class;
- acceptance/oracle score;
- focused and full-suite test status;
- CRAP/coverage/mutation status;
- wall time by phase and reviewer wait;
- provider cost and reviewer subprocess cost;
- total context, cache share, turns, and resumptions;
- root-vs-sandbox projection state.

### P2.3 — Build a maintained OpenSpec-native consumer lab

The retired benchmark runner cannot validate the current product. Move the ten
tasks and their hidden oracles into a separate maintained lab that installs the
current source revision, runs the complete lifecycle, and preserves immutable raw
evidence. Use identical scenario revisions for before/after comparisons.

## Recommended implementation sequence

1. **Terminal truth + durable reviewer wait** — P0.1 and P0.2 in one change.
2. **Phase mutation enforcement** — P0.3 with root-write and dirty-baseline E2Es.
3. **Land identity/rebind repair** — P0.4 with byte-identical and one-byte-drift tests.
4. **Archive test isolation** — P0.5 across Node, pytest, and common glob runners.
5. **Authority/CI preflight** — P1.1 and P1.3.
6. **Acceptance oracle binding** — P1.4.
7. **Consumer CRAP activation** — P1.5.
8. **Budget/context optimization** — P1.2 only after the first seven gates pass.
9. **Delivery composition and scorecard** — P2.1 and P2.2.
10. **Re-run the immutable ten-scenario portfolio at n≥3 for noisy cost/time claims.**

## Release gate

Do not market unattended consumer delivery as ready until one immutable ten-task
run satisfies all of the following:

- 10/10 terminal statuses are truthful;
- ≥9/10 reach Prove within their declared tier budget;
- every Prove pass also passes its hidden acceptance oracle;
- every green `land-check` Lands without invalidating unchanged proof;
- 10/10 ordinary project test commands remain green after archive;
- zero product writes occur outside Build sandbox before Land;
- CRAP is measured where supported and explicitly unavailable elsewhere;
- no result relies on model prose as evidence;
- source and every consumer sandbox preserve complete cost/token/wall provenance.

## Evidence locations

- Raw consumer run: `/tmp/cf-consumer-e2e-20260827.X8GBer/run`
- Earlier framework diagnostic: `/tmp/cf-quality-10-20260827.yueYhR/run`
- Historical reports:
  - `docs/reports/e2e-live-10-scenario-2026-08-23.md`
  - `docs/reports/e2e-live-20-scenario-2026-08-25.md`

Temporary paths are not release evidence by themselves. Preserve the raw run in
the future consumer lab before relying on it for a release decision.
