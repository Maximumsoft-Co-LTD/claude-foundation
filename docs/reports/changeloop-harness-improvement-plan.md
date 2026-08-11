# Change-loop harness improvement plan

Source: session report for `add-skills-spine` (2026-08-10, consumer project).
Verified against this repository at `main`, 17 commits ahead of `origin/main`.

The report listed seven improvement items. Two had already landed, one belongs
to the consumer project, and four were open. Sweeping the runtime for other
instances of the same defect shapes turned those four into **five defect
classes with roughly thirty instances**, several of which are more serious than
anything the report named.

Every finding below was verified by reading the code and, where the claim is
about behaviour, by running `metrics` against the twelve changes with logs in
`.foundation/logs/`.

---

## Part 1 — Verdict on the report's seven items

| Report item | Verdict | Where it stands |
|---|---|---|
| Calibrate the request limiter | **Open** | `--impact high` widening landed; `--size` is written and then ignored by the budget |
| `NEEDS_USER_DECISION` counted as a failed op | **Open** | Root cause is wider than the reported line — see Class A |
| `land archive` vs registered `archive` | **Closed** | `e6cbec0`; alias refused by design |
| `security-static` should surface at `/change` | **Closed** | `f86969c`; opt-in via `--surface`, advisory |
| No per-phase token breakdown | **Open** | Conditional, not absolute — see Class D0 |
| Separate human wait from model time | **Open** | The input data is read and then discarded — see Class B |
| Record gotchas in `architecture.md` | **Not harness work** | Consumer-project documentation |

### One report finding is wrong

The report blamed the request burn on "walking the harness one small command at
a time" and proposed batching `validate` + `audit` + `doctor`. The logs
disagree: harness operations run 6–25 per change against 27–160 model turns, so
harness invocations are at most 15% of turns. Batching three of them saves a
handful against the ten that went over budget. The real fact is that a standard
change with implementation costs 100–170 turns against a target of 160, and
`keep-the-change-loop-…` landed on exactly 160.

---

## Part 2 — Five defect classes

### Class A — status collapse: a tri-state read as a binary

The harness has a real three-valued vocabulary — `completed` / `blocked` /
`failed`, and for evidence `pass` / `fail` / `error` / `inconclusive`. Several
places flatten it, and each flattening loses the distinction between *"this
went wrong"* and *"this is waiting on something"*.

| Site | Defect |
|---|---|
| `metrics-runtime.mjs:117` | `if (operation.status !== "completed") phase.failed += 1;` — every blocked stop is reported as a failure. On `route-agent-questions-…`: 19 completed, 6 blocked, **0 failed**, reported as 6 failures. On `keep-the-change-loop-…`: 9 blocked + 1 failed reported as 10 |
| `foundation.mjs:283-284` | Status is *guessed* at the exit handler from `operationBlocked` plus a hardcoded allow-list (`code === 2` and operation in `{proof-readiness, proof-run, proof-collect}`). Any path that sets `process.exitCode` directly falls through to `failed` |
| `change-validation.mjs:208` | Sets exit 1 without `die()` → recorded `failed` |
| `sandbox-runtime.mjs:253` | `--unattended` refusal sets exit 1 → recorded `failed` |
| `adapter-runtime.mjs:261` | `testStatus === "pass" && discoveryStatus === "pass" ? "pass" : "blocked"` — **a genuinely failing test suite is reported as `blocked`**, the word this codebase reserves for waiting on something external |
| `adapter-runtime.mjs:285` | `if (status !== "pass") aggregateStatus = status;` — last-non-pass-wins. `[fail, inconclusive]` reports `inconclusive`; reversing the array reverses the verdict. No severity precedence |
| `proof-execution-runtime.mjs:86` | `outcomes.filter(row => row.status !== "pass")` → dies. `proof collect` is the deliberately tolerant command (it accepts `NEEDS_USER_DECISION` at :49) yet one `inconclusive` kills the whole collect |
| `dashboard/snapshot.mjs:76` | Reads `proof.json` as if it were a provider receipt (`metrics-runtime.mjs:161` explicitly skips it for this reason). A receipt set containing `fail` reports the same `evidenceStatus: "partial"` as an all-green set awaiting `prove` |

**Proof that the classification is guessed, not decided.** Across the twelve
logs, the same command with the same exit code lands on different statuses:

| Command | exit | status | change |
|---|---|---|---|
| `validate` | 1 | failed | `forecast-policy-…` |
| `validate` | 1 | blocked | `keep-the-change-loop-…` |
| `sandbox` | 1 | failed | `reduce-workflow-latency-…` |
| `sandbox` | 1 | blocked | `route-agent-questions-…` |
| `proof-readiness` | 2 | failed | `strengthen-the-harness-…` |
| `proof-readiness` | 2 | blocked | `route-agent-questions-…` |

The codebase already contains the correct pattern, with the rationale written
out: `model-drift.mjs:106-129` treats `unknown` as a first-class outcome that is
neither pass nor fail. `metrics-runtime.mjs:286-288` also gets it right
(`expectedStops` vs `unexpectedFailures`), and
`.claude/tests/harness/run-harness-tests.sh:871-873` asserts exactly that
contract — against `.rework.*`. Nothing asserts on `phases[].failed`, which is
why the bug survived.

### Class B — a sentinel that is never computed, next to data that would compute it

| Site | Defect |
|---|---|
| `metrics-runtime.mjs:228-229` | `humanWaitMs: null, humanWaitReason: "not inferred without an explicit host/user transition signal"`. But `telemetry.mjs:12-14` discards every non-`assistant` transcript row at normalize time. The user-row timestamp *is* that signal, read and thrown away one function earlier. Separately, `authority-request` → `authority-record` already brackets human decisions: 10, 7 and 3 minutes measurable today |
| `telemetry.mjs:53` | `cost` is null on **all 608 events across every `events.jsonl` on disk**, because the Claude transcript carries no cost field under any spelling. Meanwhile `dashboard/public/app.js:110-122` computes it from tokens + model. `README.md:110` advertises `metrics` as reporting cost |
| `telemetry-runtime.mjs:215` | `cacheCreationTokens: null` hardcoded in `recordEvent`, and `--cache` writes both `cacheReadTokens` and `cacheTokens`. So in `budget.mjs:13-15` the derived cache-write is structurally **exactly 0** for every manually recorded event — cache-write spend is unbillable on that path |
| `metrics-runtime.mjs:233` | `requests: events.length \|\| null` — a measured zero is reported as unknown. `budget.mjs:132` handles the identical case correctly |
| `telemetry-runtime.mjs:79-95` | Context percentiles are destroyed at rollup time, so `medianBytes`/`p95Bytes` become permanently null for a long-lived change. Lossy compaction, not an unmeasurable quantity |

### Class C — `Number(null)` is 0, so unknown becomes a measurement

| Site | Defect |
|---|---|
| `receipt-runtime.mjs:263` | `Number(flags["unresolved-blockers"] \|\| 0)`. **Omitting the flag asserts zero blockers**, which then satisfies the gate three lines down (`status === "pass" && blockers > 0` → die) and is written into the receipt as a counted zero. A reviewer who never counted and a reviewer who counted zero are indistinguishable, on the gate whose job is to stop a review with open blockers from landing |
| `adapter-runtime.mjs:257` | `discovered: discovered ?? 0` is written at the exact moment `discoveryStatus` is `inconclusive` *because* `discovered === null`. The receipt says `discovered: 0` and `observed: "structured test count unavailable"` — two contradictory statements in one receipt |
| `budget.mjs:162-165` | Unknown spend yields `ratio: 0` → `mode: "normal"`, printed by `foundation.mjs:1662` as literally `BUDGET <id>: 0.0% CONTINUE`. "No telemetry wired" is displayed as "0% spent", with `measurement: "unavailable-until-external-events"` sitting unread in the same object |
| `dashboard/public/app.js:118` | An unrecognized model id contributes exactly $0.00 to the headline cost tile — a whole model's spend can vanish silently |
| `metrics-runtime.mjs:116` | `phase.durationMs += Number(operation.durationMs \|\| 0)` with a `0` accumulator, where the token fields two lines later correctly use a null accumulator. Latent today |

### Class D — two tables that must agree, derived from neither

| # | Tables | Status |
|---|---|---|
| D0 | `cli.sh:71-77` phase grammar vs `foundation.mjs:1898-1926` `telemetryPhase` | **Disagree on 7 commands** — `new`, `start`, `validate`, `abandon`, `agent-plan`, `agent-acquire`, `agent-release` are mapped by the CLI and absent from the runtime map. Via `cli.sh` they bucket as `change`/`build`; via a direct `node foundation.mjs` call they bucket under the operation name. That is the whole per-phase-token defect |
| D1 | `phase-mutation-guard.md:16` documents `FOUNDATION_ACTIVE_PHASE` | **Nothing in the repo sets it.** The guard falls back to `phase-context.jsonl`, written only by `packet --phase`. A session that never calls it has no recorded phase, so in audit mode the guard exits silently — the documented enforcement surface is inert |
| D3 | `exec --phase` | Declared as an enum in `commands.json:8`, validated nowhere. `exec --phase buidl` silently creates a `buidl` bucket in `metrics.phases` |
| D5 | `foundation.mjs:1895-1896` | A 37-entry inline list of change-scoped commands, derived from neither `telemetryPhase`, `READ_ONLY_OPERATIONS`, nor `runtimeCommands`. A new command added to the registry and router records **no telemetry row at all** until it is also added here |
| D6 | `cli.sh:368` read-list vs `READ_ONLY_OPERATIONS` vs `commands.json kind:"read"` | `cli.sh` omits 10 read commands, so on a runtime-API mismatch `claude-foundation changes` warns while `claude-foundation runtime changes` hard-fails — same read, opposite gate |
| D8 | `foundation.mjs:66 VERSION` vs `protocol.json:2 runtime` | Agree at `2.8.0`; **no check compares them**. `doctor` deliberately skips this key |
| D10 | `foundation.json` vs `foundation.mjs:1472-1493` defaults vs `install.sh:239-244` | `foundation.mjs` defaults `review: {diversity: "required"}`, which `receipt-runtime.mjs:261` enforces — but shipped `foundation.json` has **no `review` key**, so a project reading it as the config reference never learns the setting exists |
| D12 | Schema `apply.requires` vs `change-validation.mjs:212-215` | **Live bug**: `repositories.yaml` is required by both schemas and written by `change-lifecycle.mjs:141`, but `changeArtifactGaps` never checks for it. Deleting it passes `change validate` and fails inside Land |
| D13 | `budget.mjs:22` | `schema === "foundation-rapid" ? "rapid" : "standard"` — any unrecognized schema name silently receives the *standard* budget |
| D14 | `PROVIDER_CONTRACTS` vs `website/docs/.../claims.md` | 5 of 19 capability rows have drifted text; `README.md` omits 3 entirely. The doc-consistency suite checks adapters but not capabilities |
| D16 | `cli-flags.mjs REPEATABLE_FLAGS` (11) vs `authority.mjs MULTI_VALUE_EVIDENCE` (6) | Omits the five `subject-*` flags, so `authority record` yields scalars where `evidence record` yields arrays. Absorbed downstream today, wrong tomorrow |

The four runtime-API pins all read `17` and agree. `install.sh MANAGED` and
`CLAUDE.md` agree exactly. `commands.json runtimeCommands` and the router's
`case` labels agree in both directions (52 each). `next-step.mjs NEXT_BY_STATUS`
is the correct single-source pattern and documents that it *used* to be
duplicated — that is the shape D0–D6 should become.

### Class E — state written and never read

| Field | Writes / reads |
|---|---|
| `state.land.status` (`code-applied` → `specs-archived` → `archive-audited` → `sandbox-cleaned`) | **8 writes, 0 runtime reads.** Only `run-specsync-gate-tests.sh` asserts on it. `archive()`'s real resume logic branches on `workspace.cleanup?.status` and `!initial.repositoryCleanup`. The field that reads like the Land saga's checkpoint is a label nothing acts on |
| `state.provenHash` | 1 write, 3 modules pay to `delete` it, 0 reads. Freshness is decided from `proof.workspaceHash` |
| `state.upgradedFrom` | Only occurrence of the identifier in the repository |
| `state.preArchiveWorkspaceHash` | Written; no recovery path compares against it |
| `state.workspace.git`, `land.strategy`, `land.pointersStagedAt`, `land.resumedAt`, `land.recoveredAt`, `repositories[].land.checkedAt` | Write-only |
| `state.blockers`, `state.pendingBlockers`, `state.land.blockers`, `state.workspace.branch`, `state.owner`, `state.ownerEmail` | **Read by `dashboard/snapshot.mjs:81,118-120`; written by nothing.** `blockerCount` is always 0 and `stateBlockers()` is unreachable code — the dashboard's per-change blocker view is structurally incapable of showing a blocker |
| `execution.escalation[]` (8 entries in `foundation.json`) | No reader anywhere. Editing it changes nothing |
| `models.*.purposes[]` | Surfaced as raw JSON only; agent planning selects tiers from task `kind` |
| `state.size` | Written at `change-lifecycle.mjs:215`, read for a word-count warning and a dashboard passthrough. **The budget ignores it**, while `CLAUDE.md:92` states "Size controls budget and slicing". No enum validation either — `--size medium` is accepted and stored. `startAtomic` writes `"xs"`, which can never satisfy the `=== "S"` test that is its only logic reader |

---

## Part 3 — Plan

Seven work packages. Each fixes a class at its root rather than patching
instances, per the playbook's rule about the lowest deterministic boundary.

### P0 · Close the two gates that accept a missing input as a satisfied condition
**rapid · Runtime lane**

- `receipt-runtime.mjs:263` — require `--unresolved-blockers` explicitly for a
  passing review instead of defaulting to `0`. Unknown must not satisfy the
  gate. Keep the default only for a non-passing status.
- `change-validation.mjs:212-215` — add `repositories.yaml` to
  `changeArtifactGaps` so a deleted file fails validation instead of Land.
- Regression at the receipt and validation boundaries.

First because both are integrity gates, and both are small.

### P1 · One status vocabulary
**standard · Runtime lane + dashboard**

- Replace the guessed classification at `foundation.mjs:283-284` with an
  explicit `block()` helper beside `die()`. The site that decides declares the
  block; the exit handler stops inferring. This deletes the hardcoded
  `typedBlock` allow-list, which is itself a Class D table.
- Convert `change-validation.mjs:208` and `sandbox-runtime.mjs:253` to it.
- `metrics-runtime.mjs:106-117` — add a `blocked` counter to `phaseEntry`;
  increment `failed` only on `status === "failed"`.
- `adapter-runtime.mjs:261` — return the real aggregate (`fail` when a suite
  failed, `blocked` only when genuinely waiting).
- `adapter-runtime.mjs:285` — give the aggregate a severity precedence
  (`error` > `fail` > `inconclusive`) instead of last-wins.
- `proof-execution-runtime.mjs:86` — let `collect` tolerate non-`pass` outcomes
  the way its own readiness check already does, and report them rather than die.
- `dashboard/snapshot.mjs:76` — stop treating `proof.json` as a provider;
  derive `evidenceStatus` from the receipt statuses, distinguishing a set
  containing failures from one merely awaiting `prove`.
- Extend the existing `.rework.*` assertions to cover `phases[].failed`.

### P2 · One phase identity
**standard · Runtime lane + Instruction gates**

- Single exported `PHASE_BY_COMMAND` in the runtime; `foundation.mjs:282`
  derives the operation's phase from it when `FOUNDATION_PUBLIC_OPERATION` is
  absent, so a direct runtime invocation buckets identically to a `cli.sh` one.
  This fixes the per-phase token gap at the root without touching the metrics
  keying logic.
- Cover the seven commands the runtime map omits, and give unmapped commands an
  explicit `meta` bucket rather than a phantom phase.
- Add a deterministic test asserting `cli.sh`'s grammar and the runtime map
  agree, since `cli.sh` cannot import the module.
- Validate `exec --phase` against the enum `commands.json` already advertises.
- Resolve D1: either wire `FOUNDATION_ACTIVE_PHASE` or remove it from
  `phase-mutation-guard.md` — a documented enforcement surface that nothing
  feeds is worse than an undocumented one.
- Derive the change-scoped command list (D5) from the registry instead of the
  37-entry inline array.

### P3 · Unknown is never zero, on the measurement surfaces
**standard · Runtime lane + dashboard**

- `humanWaitMs` — stop discarding user rows in `telemetry.mjs:12-14` (keep
  their timestamps only), and combine with the authority brackets. Name the
  basis in a companion field. Leave the remainder as model time derived by
  elimination.
- `cost` — either add the pricing table (the dashboard already has one) or stop
  advertising cost in `README.md:110`. Do not keep shipping a permanently null
  field described as measured.
- `telemetry-runtime.mjs:215` — add a cache-write input to `recordEvent` so the
  `event` path stops structurally reporting zero cache-write spend.
- `metrics-runtime.mjs:233` — report a measured zero as `0`, matching
  `budget.mjs:132`.
- `budget.mjs:162-165` — when spend is unknown, say unknown instead of printing
  `0.0% CONTINUE`.
- `adapter-runtime.mjs:257` — write `discovered: null`, not `0`, when the count
  is unavailable.
- `metrics-runtime.mjs:116` — null accumulator for `durationMs`, matching the
  token fields.

### P4 · Calibrate the request budget and make `size` mean something
**standard · Runtime + Instruction + Shipping gates**

- Re-derive `requestBudgets` from the archived logs rather than by feel.
- Wire `state.size` into `budgetTargets`, add enum validation for `--size`, and
  reconcile the `"xs"` vs `"S"` mismatch at `change-lifecycle.mjs:337`. Either
  the budget honours size or `CLAUDE.md:92` stops claiming it does.
- `budget.mjs:22` — fail loudly on an unrecognized schema name instead of
  silently granting the standard lane.
- Keep the `max(requestRatio, tokenRatio)` gate but surface the binding
  dimension in the mode message.
- A batched `change check` is optional ergonomics, not a budget fix.

### P5 · Dead state: delete it or wire it
**standard · Runtime lane + dashboard**

Kept as its own change because the fundamentals rule forbids bundling cleanup
into behavioural work. Per field, decide once:

- `state.land.status` — either make `archive()` resume from it or delete it and
  the tests that assert on it. A checkpoint nothing reads is a diagnosis trap.
- `state.provenHash` — delete it and the three `delete` sites that maintain it.
- `upgradedFrom`, `preArchiveWorkspaceHash`, `workspace.git`, `land.strategy`,
  `land.pointersStagedAt`, `land.resumedAt`, `land.recoveredAt`,
  `repositories[].land.checkedAt` — delete unless a reader is being added.
- `dashboard/snapshot.mjs:81,118-120` — either the runtime starts writing
  `blockers`/`owner`/`branch`, or the dashboard stops pretending to read them.
- `execution.escalation[]` and `models.*.purposes[]` — remove from
  `foundation.json` or give them a consumer.
- Add `review` to shipped `foundation.json` (D10) so an enforced setting is
  discoverable.

### P6 · Turn the drift risk into tests
**repo-only lane**

Rather than hand-fixing each pair, assert them in the deterministic suite:

- `cli.sh` phase grammar ↔ runtime `PHASE_BY_COMMAND` (P2 depends on this).
- The four runtime-API pins, pairwise — today only 4 of 6 pairs are covered and
  a `cli.sh`-only edit is caught by nothing outside the suite.
- `foundation.mjs VERSION` ↔ `protocol.json runtime` (D8, unchecked today).
- `PROVIDER_CONTRACTS` ↔ the capability tables in the website docs and README
  (D14 — 5 rows already drifted).
- `install.sh MANAGED` ↔ `CLAUDE.md` ↔ the manifest-prefix allowlist and prune
  roots inside `install.sh`.
- Fix the already-drifted pairs found: `usage()` vs `commands.json` (6 missing
  commands, 3 mismatched flag lists) and `MULTI_VALUE_EVIDENCE` (D16).

### Sequencing

P0 first — smallest and highest severity. P1 then P2 in order; both touch
`metrics-runtime.mjs` and P2 assumes P1's status vocabulary. P3 depends on P2
for phase attribution. P4 is independent and can run in parallel. P5 after
P1–P3 so nothing is deleted that is about to be wired. P6 last, so the new
invariants are the ones guarded.

---

---

## Part 4 — What shipped

All seven packages were implemented in one pass at the repository root, outside
the change loop, because the edits include the runtime-API pins and the
composition root — the bootstrap-breaking set the playbook exempts. 34 files
changed, 2 added; `sh .claude/tests/run-all.sh` passes end to end.

**P0.** A passing review now has to state `--unresolved-blockers`; the
authority response template carries the field so the documented path can still
be completed. `repositories.yaml` joined the required-artifact list.

**P1.** `markBlocked()` sits beside `die()`, and the exit handler no longer
guesses: the hardcoded `(exit code 2, operation name)` allow-list is gone, and
the four commands that set an exit code without dying now declare the block.
`metrics` counts `blocked` separately from `failed`. The adapter got an ordered
status vocabulary (`worstStatus`), so a failing suite reports `fail` rather than
`blocked`, and the Playwright aggregate takes the worst status instead of the
last. The dashboard stopped reading `proof.json` as a provider and now
distinguishes a failing receipt set from one awaiting `prove`.

**P2.** `runtime/core/lifecycle-phase.mjs` is the single phase table, covering
the seven commands the runtime map omitted. `foundation.mjs` derives the
operation's phase from it, so a direct runtime call buckets identically to a
`cli.sh` one. `exec --phase` is validated against the enum it always
advertised.

**P3.** `humanWaitMs` is computed from the authority request→record brackets,
with `humanWaitSpans` naming each one. Per-phase `inputTokens` and a derived
`spendTokens` (input + output + cache-write) make a phase comparable to the
budget window. `event --cache-create` exists, so the manual path can report
cache-write spend. `requests` reports a measured zero. `budget` prints
`unmeasured` instead of `0.0%` when nothing has been measured, via a new
`measured` field. The discovery receipt writes `discovered: null` rather than a
zero that contradicts its own `observed` text.

**P4.** `requestBudgets` re-derived to 100/200 from the archived runs. `size`
now scales the request lane (`xs` 0.5x, `s` 1x, `m` 1.5x, `l` 2x), combining
with impact by the larger of the two. `--size` is validated against an enum and
stored lowercase, which also repairs the `"xs"`-can-never-equal-`"S"` check.

**P5.** `state.provenHash` deleted along with the three modules that paid to
invalidate it. `land.status` kept but documented at the write site as a
breadcrumb, not the saga's position. `review` added to shipped
`foundation.json` so an enforced setting is discoverable.

**P6.** `run-single-source-tests.mjs` asserts the `cli.sh` phase grammar against
the runtime table, the four API pins pairwise, the runtime version against
`protocol.json`, and `install.sh MANAGED` against CLAUDE.md — 129 assertions.
Behavioural regressions were added at the boundary each defect crossed.

The four runtime-API pins moved 17 → 18: the entrypoint now imports a runtime
module that an older `runtime/` tree does not contain, which is exactly the
mixed-install case those pins exist to catch.

### Deliberately left alone, with reasons

- **`proof collect` aborting on a non-`pass` outcome.** Its tolerance at the
  readiness check is about `NEEDS_USER_DECISION`, not provider results; a
  provider that failed means collection failed. Loosening it would weaken
  evidence.
- **The dashboard's blocker projection.** `stateBlockers()` reads fields no
  runtime writes, but a dashboard test fabricates them and asserts the
  projection. The projection is correct and tested; only the producer is
  missing. Writing one is a feature, not a fix.
- **`escalation[]` and `models.*.purposes[]`.** No runtime consumer, but
  removing keys from a shipped config breaks anyone reading it, and adding a
  consumer is a feature. Left in place and recorded here instead.
- **Write-only Land breadcrumbs** (`upgradedFrom`, `preArchiveWorkspaceHash`,
  `workspace.git`, `land.strategy`, the `*At` stamps). They are a log, not a
  contract, and none of them reads as authoritative the way `land.status` did.
- **Transcript-derived human wait.** `telemetry.mjs` discards user rows, and
  keeping their timestamps means a new persisted artifact. The authority
  brackets already give a real number; this would extend coverage, not correct
  anything.
- **`cost`.** Still null everywhere. Computing it needs a pricing table the
  harness does not have and the dashboard does; picking where that table lives
  is a decision worth making deliberately rather than in passing.

## Deliberately not planned

- **An alias for two-word CLI forms at the runtime entrypoint.** `cli.sh` owns
  the public→internal mapping; a second router would duplicate it. The landed
  diagnostic already names both.
- **Making `--surface` mandatory.** The capability forecast is advisory by
  design. Escalating "no surface declared" from silence to a warn is a one-line
  follow-on if authors keep skipping it. Note that `startAtomic` calls
  `validate` with `quiet: true`, so the atomic-start path can never emit the
  forecast warning — worth fixing inside P2 if the warning is kept.
- **The `architecture.md` gotchas.** Consumer-project documentation.
