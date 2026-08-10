# Multi-repository and lifecycle audit — 2026-08-07

Supplement to `docs/bug-audit-2026-08-07.md`. That audit swept the single-repo
runtime and found 4 critical / 9 high / 20 medium / 21 low. This one covers what
it did not reach: the **multi-repository control plane**, the **change-lifecycle
resolver**, **host telemetry attribution**, and the **test fixtures themselves**.

Verified by 4 parallel agents plus lead reproduction. Findings marked
**reproduced** were executed against scratch installs, never against this repo.

> **Line numbers are against the working tree of 2026-08-07.** A feature
> workstream (`spec-sync-verify.mjs`, `model-drift.mjs`, `assertOpenSpecCli`) was
> editing `foundation.mjs`, `apply-runtime.mjs`, `land-runtime.mjs`,
> `agent-planning.mjs`, `diagnostics-runtime.mjs` and `run-all.sh` concurrently.
> Findings below are anchored in files outside that working set unless noted.

## Overlap with the earlier audit

Not repeated here — already covered there:

| Finding | There |
|---|---|
| Forged receipt via caller-supplied `--adapter` → `PROVEN` with nothing executed | C1 |
| Review-attempt chain race | M5 |
| `describe` has no CLI route; `--help` refused for 12 commands | M1–M3 |
| `phase-mutation-guard` gaps | M16 |
| Service spawn failure orphans started services | H6 |

One detail to graft onto **C1**: even the honest external path is decorative.
`references[]` is never validated anywhere in the tree — it is a free string,
as are `observed` and `provenance.source`. Only `artifacts[]` is digest-bound
(`artifact-store.mjs:119-127`), and a passing receipt needs *either* one.

**Reproduced** on a clean install, without C1's `--adapter` bypass:

```
receipt trivial-thing test pass \
  --observed "I ran the tests and they all passed, honest" \
  --source "me" --reference "trust me bro"
receipt trivial-thing discovery pass \
  --observed "found 12 tests" --source me --reference "trust me bro" \
  --discovered 12 --minimum 1

prove      → PROVEN
land-check → LAND READY   (exit 0)
```

So C1's fix must validate the fields, not merely close the adapter hole.

---

## Multi-repository control plane

The earlier audit does not mention topology, repository contract hashes, or
composite hashing at all. This section is the current-state map plus its gaps.

### What is real and enforced

Multi-repo is not a stub. It is exercised by ~240 lines of deterministic tests
at `.claude/tests/harness/run-harness-tests.sh:1359-1600`.

- **Topology catalog** — `openspec/repositories.yaml`, validated at
  `runtime/workflow/repository-topology.mjs:61-89`: `id`, `type`
  (`root|submodule|git|external`), `path`, `mode` (`read|write`), `dependsOn`.
  Submodules auto-discovered from `.gitmodules` (`:8-26`); unregistered ones
  warn (`:160-161`). Path escape blocked unless `allowOutsideRoot` (`:75-76`).
- **Per-change scope** — `openspec/changes/<id>/repositories.yaml` selects which
  repositories a change may touch (`:92-99`), with dependency closure enforced
  (`:133-136`).
- **Task→repo binding** — `tasks.md` annotations parsed at
  `runtime/workflow/change-validation.mjs:60-80`:
  `[repo:] [kind:] [depends:] [paths:] [resources:] [claims:] [model:]`.
- **Contract propagation** — `agents plan` emits `repositoryContractHashes`
  (per-repo hash of the claim subset) and `contractFingerprint`
  (`runtime/workflow/agent-planning.mjs:148-152`). When one repo's contract
  moves, dependent tasks are marked `invalidatedTasks` transitively
  (`:166-194`). This is the machine-checkable half of "agents agree via
  OpenSpec".
- **Mutual exclusion** — task leases are atomic (`lease-runtime.mjs:56`,
  `openSync(…,"wx")`) with owner, expiry, and forced takeover requiring
  `--decision-ref`. `activeRepositoryConflicts` (`agent-planning.mjs:36-54`)
  blocks two changes from writing the same repository.
- **Changed-path authority** — files changed outside a task's declared
  `[paths:]` block Prove (`runtime/evidence/proof-readiness.mjs:78-99`).
  Note this is **gated to multi-repo only** (`:80`): a single-repository change
  has no path authority at all.
- **Per-repo receipt binding** — `providers.<name>.repository` resolves that
  repo's snapshot hash (`runtime/evidence/evidence-contract.mjs:254-270`), so an
  unrelated repo's edit preserves scoped evidence.
- **Land ordering** — topological sort on `dependsOn` with cycle detection,
  root forced last (`runtime/workflow/land-runtime.mjs:69-95`).
- **Digest-bound handoff artifacts** — packets (`packetDigest` plus a
  `references{path,sha256}` map and a hard byte ceiling), agent plan
  (`planDigest`, `supersedesPlanDigest`), instruction manifest (a real JSON
  Schema at `runtime/contracts/instruction-manifest.schema.json`), host
  execution result, authority request/response, task leases.

### MR1 — `cross-repo-contract` has no verifier (critical for multi-repo)

`foundation.mjs:89` — the capability's entire definition is a description
string:

```js
"cross-repo-contract": "Producer and consumer repositories agree on the same versioned contract.",
```

`change-validation.mjs:257-259` forces the *claim* to declare it when spanning
repositories, and `requiredProviders` forces *a provider to exist*. But
`runtime/evidence/adapter-runtime.mjs` implements exactly two adapters —
`test-discovery` (`:145`) and `playwright` (`:171`). Everything else is
`external`, i.e. a free-text receipt, i.e. the hole above.

The harness's own test proves the emptiness: it wires `{"adapter":"external"}`
(`run-harness-tests.sh:1397`) and satisfies the capability with a fixture
(`:1555-1557`):

```
receipt … cross-repo-contract pass --observed "API/App contract fixture passed" \
  --source harness-test --reference "fixture://cross-repo-contract"
```

Nothing hashes a shared artifact. Nothing compares producer to consumer. The
guard is that somebody asserted it.

`WORKFLOW.md:428-430` overstates this — "require cross-repository contract
evidence before each repository is landed" — when only the *declaration* is
required. The design doc promised the missing piece and it never shipped:

> `docs/openspec-native-harness.md:296` — "**Cross-repository contract
> provider** — validates coupled changes against their shared contract."

> `docs/openspec-native-harness.md:220` — "…every repository, base revision,
> sandbox path, expected contract, and intended landing order." Every element
> ships **except** "expected contract".

**Fix shape**: hash the declared contract artifact (`.proto`, OpenAPI, JSON
Schema) and make both sides verify against the same digest. This is the single
change that would make the multi-repo story real.

### MR2 — authority is repo-blind, so fixing repo B voids repo A's review

`runtime/workflow/authority-runtime.mjs:40-43` selects the review/acceptance
provider by capability alone, ignoring `config.repository`. `requestAuthority`
(`:76-115`) always binds `relevantHash(id)` — the composite.

Consequences:

- A review verdict cannot be scoped to one repository. `reviewPacketValue`
  renders per-repo `inspection` rows (`packet-runtime.mjs:354-370`), but the
  verdict is one global pass/fail.
- Any edit in *any* selected repository makes an open request stale
  (`:168-169`). Fix repo B, and repo A's already-granted review is void.
- The only repo-aware path in the file is `recordVerifiedCi` (`:198-232`).

On a wide change this turns review into a moving target: every repo you touch
invalidates the reviews you already earned.

### MR3 — non-submodule children have no durable binding and no compensation

`rootGitlink()` returns `null` unless `type === "submodule"`
(`land-runtime.mjs:103-108`), and `stageRootPointers` filters to submodules
(`:238-240`). For a `type: "git"` sibling repository the child commit lives
only in `.foundation/runtime/<id>.json` — machine state, gitignored. **Nothing
versioned in the root repository records which commit of `api` this change
landed against**, yet status still advances to `child-landed` (`:127`).

Also:

- **No push, ever.** `repositoryCommitLanded()` (`:97-101`) is
  `git merge-base --is-ancestor <commit> HEAD` against the *local* checkout.
  "Landed" means "merged into your local clone". A remote rejecting the push
  afterwards is outside the model.
- **No compensation for a child repository.** There is no `land unrecord`, no
  revert generation, no un-merge. `land-journal.mjs` rollback covers only the
  root-repo file projection and degrades to `status: "manual-recovery"`
  (`:107-124`). On A-landed / B-failed,
  `assertMultiRepositoryArchiveReady` (`:374-382`) refuses archive with
  `multi-repository Land is incomplete: app:awaiting-explicit-commit` and
  recovery is entirely manual.
- **`--ci` is self-reported.** `land record --ci pass` is validated only against
  `pass|fail|pending` (`:193-195`). The real Ed25519-signed CI envelope
  (`authority-runtime.mjs:198-232`, `runtime/evidence/signed-ci.mjs`) exists and
  is **not wired into `land record`**. The two paths never meet.

`WORKFLOW.md:434-436` is honest that Land is not atomic. The gap is that the
non-atomicity has no recovery story for anything but submodules.

### MR4 — repo-level `dependsOn` fans in at task granularity

`agent-planning.mjs:73-77` auto-injects dependencies: declaring that repo `app`
depends on `api` makes *every* pending `app` task depend on *every* pending
`api` task. There is no way to express "T005 in app depends on the schema T002
in api produces" other than writing the task-ID edge by hand. Correct but
coarse — it serializes work that could run in parallel.

### MR5 — schema templates omit the annotations the runtime requires

`openspec/config.yaml` mandates that multi-repo changes "annotate each task with
repo, kind, paths, dependencies, and exceptional shared resources". But:

- `openspec/schemas/*/templates/tasks.md` documents only `[claims:…]`.
- `openspec/schemas/*/templates/evidence.yaml` has no `repositories:` field on a
  claim, though `agent-planning.mjs:150` and `packet-runtime.mjs:186-194` filter
  on `claim.repositories`.

An agent following the shipped template cannot produce a valid multi-repo
change.

### MR6 — `repositories.yaml` is written into every change but is in no schema

`change-lifecycle.mjs:117` instantiates `repositories.yaml` into every new
change, single-repo included. It is read back at `repository-topology.mjs:92-108`
and drives `selected()` including hard failures at `:119-120`. Neither
`openspec/schemas/foundation-rapid/schema.yaml:5-29` nor
`foundation-standard/schema.yaml:5-41` lists it as an artifact.

Related: **the catalog has no writer.** `repository-topology.mjs:29` reads
`openspec/repositories.yaml`; `install.sh:217-219` copies it once if absent. No
command creates or registers an entry — populating it is a hand-edit against a
schema documented nowhere shipped (`allowOutsideRoot` and `dependsOn` have zero
hits across `WORKFLOW.md`, `.claude/commands/`, `.claude/skills/`,
`openspec/config.yaml`, `README.md`).

Also inert: `role: "control-plane"` is set on the root entry
(`repository-topology.mjs:45`) and read nowhere; `drift` (unregistered
submodules) is computed and only warned — it never blocks validate, sandbox,
prove, or land.

---

## Test fixtures produce mixed-version trees

### T1 — `foundation.mjs` and `runtime/**` are copied non-atomically from the live working tree

`.claude/tests/harness/run-harness-tests.sh:25-26`:

```sh
cp    "$ROOT/.claude/harness/foundation.mjs" "$TMP/project/.claude/harness/"
cp -R "$ROOT/.claude/harness/runtime"        "$TMP/project/.claude/harness/"
```

Two separate copies. Any write to `.claude/harness/**` landing between them
produces a temp project with `foundation.mjs` at revision A and `runtime/**` at
revision B.

Same shape in **6 suites, 8 copy sites**: `run-harness-tests.sh` (×3),
`run-agent-contract-tests.sh`, `run-feedback-review-tests.sh`,
`run-packet-scaling-tests.sh`, `run-telemetry-concurrency-tests.sh`,
`run-upgrade-compat-tests.sh`. `run-all.sh` runs them back to back, so one
concurrent edit can leave different suites holding different mixes.

**Observed**: `sh .claude/tests/run-all.sh` failed once with

```
TypeError: assertOpenSpecCli is not a function
  at archive (…/runtime/workflow/apply-runtime.mjs:497:5)
```

and passed cleanly on an immediate re-run. Evidence preserved at
`/tmp/foundation-audit-20260807/{runall-FAILED,runall-PASSED}.log`.

**Fix**: copy from `git archive HEAD` rather than the working tree, or stage to
a temp path and `mv` into place atomically. This also decouples the suite from
whatever the developer is editing.

### T2 — foundation↔runtime version skew is structurally undetectable

Three independent reasons the `api-version` / `protocol-bundle` guard cannot
catch T1:

1. **Wrong axis.** `diagnostics-runtime.mjs:114-136` compares constants declared
   in `foundation.mjs` against `.claude/harness/protocol.json`. **No module under
   `runtime/` declares a version of its own** — `RUNTIME_API_VERSION` appears in
   `foundation.mjs` only. There is no marker that could detect the skew.
2. **Not on the path.** That check runs only inside `doctor`. `archive` never
   calls it; `api-version` (`cli-router.mjs:229`) just prints the constant.
3. **Tautological in the fixture.** `run-harness-tests.sh` never copies
   `protocol.json`, so `protocolDescriptor()` (`foundation.mjs:1199-1216`) falls
   through to a fallback built from `foundation.mjs`'s own constants and
   compares them to themselves. Green by construction.

A mixed tree passes `api-version`, `version`, `doctor`, `prove` and
`land-check`, then throws at `archive` — the last step of Land.

The asymmetry is why it reads as a flake: old-`foundation.mjs` +
new-`apply-runtime.mjs` crashes, while the reverse (a newer foundation passing
an extra key an older module ignores) is silent.

### T3 — dependency objects fail silently, and seven forward references are unguarded

`assertOpenSpecCli` reaches `archive()` as an **object-property destructure**
(`apply-runtime.mjs:39`), not an ESM import. A missing key yields `undefined`
silently; ESM link-time checking never applies.

A brace-depth-aware checker over every `export function create*({…})` under
`runtime/**` versus the argument objects in `foundation.mjs` reports all factory
calls currently wired (script preserved at
`/tmp/foundation-audit-20260807/wiring.mjs`; worth adding to CI — it catches
this class at build time).

The related latent hazard: `foundation.mjs` declares eight runtime handles with
bare `let` (`repositoryTopology:316`, `evidenceContract:364`, `packetRuntime:365`,
`changeValidationRuntime:366`, `receiptRuntime:367`, `adapterRuntime:368`,
`applyRuntime:886`, `abandonRuntime:951`) and threads them into factories through
~20 `(...args) => x.y(...args)` thunks closing over bindings assigned later. Any
thunk firing during construction throws `Cannot read properties of undefined` —
same shape, same invisibility. Only one guard exists
(`foundation.mjs:952-955`, with a comment explaining it); the other seven
handles are unguarded.

---

## Change lifecycle

### L1 — security triggers are literal substring matches

`foundation.mjs:103-107` defines `SECURITY_TERMS` as a flat list, applied at
`change-lifecycle.mjs:184` via `semanticText.includes(term)` over the intent
string.

Every document promises the opposite — `WORKFLOW.md:358-362` ("Triggers are
semantic … Syntax alone is not risk"), `.claude/orchestrator.md:26-28`,
`.claude/commands/change.md:14` ("Omit `--security` when there are no
triggers").

Both directions fail:

- `"Improve keyboard accessibility of the nav bar"` contains `access` →
  `security: access`. Same for any intent naming a *migration guide*, an
  *access log*, or a *permission dialog*.
- `"let users sign in with a passkey"` matches nothing.

An agent told the resolver is semantic will both over-trigger external review on
trivial work and under-trigger on real trust boundaries.

### L2 — a silent schema upgrade produces an unvalidatable change

`change-lifecycle.mjs:217-222` flips `state.schema` to `foundation-standard`
when impact, coupling, review, or acceptance demand it — and the `RESOLVED`
block printed at `:224` has **no schema line at all**. Rapid creation wrote only
`proposal.md, tasks.md, evidence.yaml, execution.yaml, repositories.yaml`
(`:117`); standard now additionally requires `design.md` and `specs/**/*.md`
(`change-validation.mjs:206-217`).

**Reproduced** — and note L1 is what triggers it:

```
new "Improve keyboard accessibility of the nav bar" --rapid  → schema: foundation-rapid
resolve … --impact low --coupling isolated                   → security: access
validate   → BLOCKED: missing change artifacts: design.md, specs/**/*.md
changes    → …  change  foundation-standard  claude-foundation change validate <id>
```

`/changes` recommends a command that can never pass until the agent guesses to
instantiate the standard templates.

### L3 — `coupling: coupled` alone forces review, undocumented

`change-lifecycle.mjs:192-193`:

```js
reviewRequired = impact === "high" || coupling === "coupled" ||
  securityTriggers.length > 0 || Boolean(flags.review);
```

`WORKFLOW.md:310-312` and `.claude/orchestrator.md:65-68` enumerate the review
triggers; coupling is absent from both. `.claude/commands/change.md:15` says
"Require review only for policy triggers."

Inverse gap: most triggers the docs *do* list — concurrency, money, public
compatibility, irreversible mutation — are never inferred. They arrive only via
the substring list or an explicit `--review`.

### L4 — `--acceptance-*` flags are undocumented but block every standard change

`change-validation.mjs:230-231` blocks while `acceptance.decision ===
"undecided"`; the flags are parsed at `change-lifecycle.mjs:194-216`.
`.claude/harness/commands.json:12` documents the whole surface as
`change resolve <change> [options]`. Grep across `WORKFLOW.md`,
`orchestrator.md`, `.claude/commands/`, `AGENT.md`, `EVIDENCE.md`,
`harness/README.md`, `commands.json`: **zero hits** for
`acceptance-required` / `acceptance-not-required` / `acceptance-reason` /
`acceptance-claims`. Only the runtime's own error string names them.

Compounding: `change resolve` uses the lenient parser
(`cli-router.mjs:38-41` → `cli-flags.mjs:8-33`), so a misspelled acceptance flag
is silently dropped and validate keeps failing with the identical message.

### L5 — missing runtime state is a dead end that `abandon` cannot exit

With `openspec/changes/<id>/` present and `.foundation/runtime/<id>.json`
deleted — **reproduced**:

```
changes                              → trivial-thing untracked unknown
                                       claude-foundation doctor --change trivial-thing
doctor --change trivial-thing        → BLOCKED: unknown change
abandon … --decision-ref host://d/1  → BLOCKED: unknown change
validate trivial-thing               → BLOCKED: unknown change
```

`changes` names an operation that cannot run, and `abandon` — the designed
terminal exit — is itself gated on `loadRuntime`
(`abandon-runtime.mjs:126`, `state-runtime.mjs:65-68`). Only a manual `rm`
escapes. `orphanRuntimeChanges` handles the inverse case tolerantly
(`state-runtime.mjs:81-98`); nothing handles this one.

Corrupt rather than missing is worse. If the corrupt file corresponds to an
existing change directory, `showChanges` dies before printing anything and one
bad file takes down the listing for every change — **reproduced**:

```
changes → BLOCKED: invalid JSON: .foundation/runtime/trivial-thing.json (…)
```

(A corrupt file with no matching change directory is handled well:
`orphan-runtime / invalid-runtime-json`.)

Aggravating: `writeJson` (`foundation.mjs:276-285`) writes a temp file and
renames without `fsync` on the file or the directory, so a power loss can
produce exactly this state.

This contradicts the intent of commit `6bcae63`, "give every dead end in the
change loop a way out".

---

## Hooks

### K1 — the phase guard ships wired but nothing ever supplies its phase

`.claude/settings.json:15-25` registers `phase-mutation-guard.mjs` on
`PreToolUse` for `Edit|Write|MultiEdit|NotebookEdit|Bash`. The hook reads
`FOUNDATION_ACTIVE_PHASE` (`:27`), `FOUNDATION_LAND_TRANSACTION` (`:70`, `:91`)
and `FOUNDATION_WORKSPACE_ROOT` (`:76`).

A full-repository grep for those variables returns writes in exactly one place —
`.claude/tests/hooks/run-phase-mutation-guard-tests.sh`. Nothing in `cli.sh`,
`install.sh`, `.claude/harness/**`, `crates/`, `clients/`, `dashboard/` or
`website/` ever exports them. (`cli.sh:65` exports
`FOUNDATION_PUBLIC_OPERATION` — a different name, and only into the node
subprocess, not the agent's shell.)

So on a stock install the guard sits permanently in its first branch
(`:30-31`, `violations.push("active phase is unavailable")`) and appends to
`.foundation/logs/guardrail-audit.jsonl` on **every** mutating tool call. The
default mode is `audit` (`:10`), so nothing is blocked — the guard is inert and
noisy rather than dangerous.

But the documented enablement path is a trap. `.claude/hooks/phase-mutation-guard.md:7-14`
tells a host to set `FOUNDATION_GUARDRAIL_MODE=block` after exporting the phase.
A host that sets the mode without the phase — the only combination the shipped
code can produce — blocks every edit, and the documented Land carve-out
(`:13`, "`FOUNDATION_LAND_TRANSACTION=1` only inside the runtime-owned Land
transaction") is unreachable because `apply-runtime.mjs` never sets it.

Relationship to the earlier audit: **H8** (unquoted hook paths) and **M16**
(`looksMutating` regex gaps) both concern this hook, and neither covers this.
M16 in particular reasons about behavior "with `FOUNDATION_GUARDRAIL_MODE=block`
and `FOUNDATION_ACTIVE_PHASE=prove`" — a configuration no shipped code produces.
Its severity should be read in that light: the regex gaps matter only once
someone wires the phase, which is the prerequisite that is missing.

Neither `WORKFLOW.md` nor `.claude/orchestrator.md` mentions the guard at all.

---

## Host telemetry

### O1 — usage attribution binds to the session, not the project

`foundation.mjs:1674-1677` auto-syncs the host transcript on `metrics` and
`budget-continue`. `claudeHostContext()`
(`runtime/observability/telemetry-runtime.mjs:116-127`) resolves the transcript
purely from `FOUNDATION_CLAUDE_TRANSCRIPT_PATH` plus
`FOUNDATION_CLAUDE_SESSION_ID` — **there is no project, workspace, or cwd
check**.

Observed during this audit: a brand-new change in a throwaway scratch project,
with zero telemetry imported by hand, already reported
`"measurement": "operations-and-host-events", "requests": 5,
"cacheReadTokens": 669710`, and its `events.jsonl` held
`"source":"claude-transcript"` rows under three `sourcePathHash` values
belonging to sibling agents working in a *different repository*.

The time bound works (`session binding excludes pre-change transcript history`
passes). The project bound does not exist. This is the only finding that reaches
a user's cost numbers.

Secondary effect: the suite ingests the live session's real token usage whenever
it is run from inside Claude Code, which is one of the two reasons `run-all.sh`
is not reproducible on a developer machine (T1 is the other). CI passes because
no transcript exists there.

---

## Shipping boundary

- `CLAUDE.md` states "`install.sh > PLAN` is authoritative". **There is no
  `PLAN` in `install.sh`** — the list is the `MANAGED[]` array at
  `install.sh:65-76`. `MANAGED[]` matches CLAUDE.md's Ships list exactly; the
  drift is in separately-handled writes: `openspec/repositories.yaml`
  (`:217-220`), `foundation.json` (`:221-222`), `.foundation/install-manifest.txt`
  (`:121`, `:211`), and the managed `CLAUDE.md`/`AGENTS.md` blocks (`:284-346`).
  `CLAUDE.md` appears in the **does-not-ship** list while `install.sh:284-315`
  creates and edits it.
- **Shipped file → non-shipped path**: `.claude/harness/README.md:400` and
  `:416` reference `./install.sh`, which does not ship. The guard that exists to
  catch this, `.claude/tests/docs/run-doc-consistency.sh:66-70`, greps only for
  `\.claude/tests|tests/bench|docs/research` and its file list omits
  `.claude/harness/README.md`, `.claude/hooks/`, and `.claude/settings.json` —
  wrong pattern set and wrong file set.
- `.claude/hooks/tests/` is both installed (`install.sh:71`) and legacy-deleted
  (`:97`) on every install. The manifest is built at `:174-183`, *before* the
  delete at `:242-244`, so `.foundation/install-manifest.txt` records 5 entries
  for files never left on disk. `doctor` already reports
  `legacy-hook-tests: absent` as the desired state; deleting the directory from
  source fixes both.
- `CLAUDE.md`'s Map lists a "migration" command under `.claude/commands/`; the
  directory holds only `build, change, changes, dev, investigate, land, prove`.
- `.claude/tests/README.md` documents 8 suites; `run-all.sh` runs 19.
- **Narrative / cost / incident leakage: none found.** Swept all shipped
  Markdown, JSON and `.mjs`. Every hit was a false positive from skill content
  (SQL `$1` placeholders, `$18pt` design tokens, a `$100 discount` test-naming
  example).
- Two payload observations, not violations: `.claude/skills/**` ships 3.5 MB, of
  which `ui-ux-pro-max` is 1.6 MB of CSV; and
  `.claude/skills/init-project-docs/evals/` ships maintainer eval fixtures
  inside a shipped skill, which sits oddly against the `.claude/tests/**`
  does-not-ship rule.

---

## Coverage gaps

- **`land pointers` has zero coverage** and is `kind: authority`. No test file
  in the repo mentions it. `stageRootPointers`
  (`land-runtime.mjs:210-340`, ~130 lines) has three unexercised guard branches:
  control-repo-moved-since-sandbox (`:218`), pointers-re-staged-outside-Foundation
  (`:275`), and a rollback path (`:327`). Highest-privilege untested code in the
  runtime, and it is on the multi-repo Land path.
- **Installer failure/rollback untested.** `install.sh:121-173` has backup +
  `rollback_install` + an EXIT trap. All 135 installer assertions cover the happy
  path, upgrade, legacy cleanup, manifest, and the Cursor adapter — none covers a
  failed install restoring the prior tree. `refusing unsafe managed manifest
  path` (`:192`) is unproven, and it guards a delete loop.
- **Hooks: 7 assertions against ~27K of shell.** `protect-secrets.sh` (9.9K)
  gets 2; no coverage of Bash-command sinks, Write/Edit paths, or the documented
  fail-open-without-`jq` branch. `lint.sh` (7.6K) gets 1, proving only that it
  ignores an out-of-project file. `no-direct-main-commit.sh` (10.2K) is verified
  only by its own `--self-test`.
- **`migrate` has zero coverage**, and there is nothing to migrate: the legacy
  path reads no `.workflow/` content at all. It enumerates directory names and
  writes a fixed placeholder markdown per name
  (`diagnostics-runtime.mjs:359-363`). Separately, `migrate` uses `parseFlags`
  rather than the strict parser, so `--apply=false` yields the truthy string
  `"false"` and performs the write.

---

## Running tests across repositories

### How a provider is placed

A provider executes in **exactly one workspace**, always
(`runtime/evidence/adapter-runtime.mjs:78-79`):

```js
const repository = providerRepository(id, provider, config);
const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
```

`config.repository` binds a provider to one selected repository; absent that, it
runs in the change's sandbox, falling back to the control root. There is no
"run this provider in both repos" and no per-repo fan-out of a single provider —
covering two repositories means declaring two providers.

The same fallback is written twice — `providerWorkspace`
(`evidence-contract.mjs:260-263`) for the preflight checks
(`commandExists`, `playwrightAvailability` at `provider-scheduler.mjs:32,37`),
and recomputed in `executeAdapter` for the spawn. One cwd either way.

`config.repository` is a **scalar**, never an array
(`evidence-contract.mjs:255`). A provider that omits it does not "span" — it
silently lands in the *control* sandbox (`.foundation/sandboxes/<change>/`),
a third tree containing neither repo's code.

**No environment variable names a sibling repository.** The env block
(`adapter-runtime.mjs:91-101`) exports `FOUNDATION_CHANGE_ID`,
`FOUNDATION_CONTROL_ROOT`, `FOUNDATION_REPOSITORY_ID` (the provider's *own* repo,
or `"root"`), `FOUNDATION_PROOF_RUN_ID`, `FOUNDATION_COMMAND_EXECUTION_ID`. A
script could reconstruct
`$FOUNDATION_CONTROL_ROOT/.foundation/repository-sandboxes/$FOUNDATION_CHANGE_ID/<repo>`
— the sandboxes do live there (`sandbox-runtime.mjs:183`) — but the harness never
publishes the repo ids, never validates such a path, and would not hash anything
read through it (`.foundation` is in `EXCLUDED_WORKSPACE_DIRS`). An escape hatch,
not a feature.

Auto-discovery names per-repo provider instances `<capability>-<repo>`
(`runtime/evidence/evidence-bootstrap.mjs:65-67`) and downgrades multi-repo
discovery to `confidence: "review"` (`:119-122`).

Two provider-level features do compose across repositories: `config.dependsOn`
(a provider DAG, validated at `evidence-contract.mjs:144-149`, satisfied by a
completed run *or* an already-valid receipt at `provider-scheduler.mjs:74-75`)
and `config.outputs` (one execution recording receipts for several providers,
`:150-154`). Command dedup (`adapter-runtime.mjs:84-88`) keys on `cwd`, so the
same command in two repos is correctly *not* deduped.

### Services are change-scoped, not repo-scoped

`execution.yaml` holds one flat `services` map for the whole change. A provider
names one via `config.service`, and `startRequiredServices`
(`adapter-runtime.mjs:45-59`) starts the union of services referenced by the
batch, unwinding in reverse on failure. Each service resolves its own cwd via
`resolveServiceCwd(id, config)` (`runtime/core/process-runtime.mjs:79`).

So the cross-repo e2e shape **is** expressible: declare a service whose cwd is
repo `api`, and a Playwright provider whose `repository` is `app` and whose
`service` is that API. Nothing repo-scopes the service map, which is what makes
this work.

### E1 — the evidence DAG's resource model is not repository-scoped

`runtime/evidence/evidence-results.mjs:97-110` is the whole model:

```js
if (Array.isArray(config.resources)) return [...new Set(config.resources)].sort();
if (config.adapter === "playwright")  return ["browser", "dev-server", "workspace-read"];
if (providerCapability(...) === "mutation") return ["workspace-write"];
return ["workspace-read"];
```

Resources are opaque strings intersected pairwise, with `workspace-write`
excluding every other `workspace-*`. `runExecutionDag`
(`runtime/evidence/provider-scheduler.mjs:66-89`) batches ready nodes that do not
conflict, so this is what "resource-safe DAG" means.

The defaults carry **no repository identity**, and that cuts both ways:

- **False conflict.** A Playwright provider in `api` and one in `app` both claim
  the literal `"dev-server"`, so they serialize — even though they are different
  repositories, different servers, different ports. Multi-repo e2e is
  needlessly sequential by default.
- **Missed conflict.** Two providers in different repositories that genuinely
  share a resource — one Postgres, one Redis, one browser profile — do *not*
  conflict unless the author hand-declares matching `resources` strings. The
  system cannot infer it.

Contrast the Build side, which *does* scope by repository
(`runtime/workflow/agent-planning.mjs:78`):

```js
task.resources = [...new Set([`workspace:${task.repository}`, ...task.resources])].sort();
```

Build resources are repo-qualified; proof resources are not. Same concept, two
different rules.

### E2 — the cross-change guard exists, but not on the proof path

`activeRepositoryConflicts` (`agent-planning.mjs:36-54`) does block two changes
from holding write scope on the same repository. It is computed in exactly one
place — `planValue` at `agent-planning.mjs:110` — and reaches callers through
`plan.dispatchable`: `agents plan`, `showTask` (`:281-282`), and `agents acquire`
(`lease-runtime.mjs:24-25`, `fail("change '<id>' conflicts with active repository
work")`). So dispatch and lease acquisition are guarded.

**Proof is not.** `proof-runtime.mjs`, `proof-readiness.mjs` and
`proof-execution-runtime.mjs` never consult it. The only lease check on the proof
path is `activeChangeLeases(id)` (`proof-runtime.mjs:17-19`,
`proof-readiness.mjs:277`), scoped to the change's *own* leases — another
change's leases are invisible.

Verified: two `proof-collect` runs launched simultaneously in the same repo.
Neither was blocked; both proceeded into execution.

`runExecutionDag` reasons only about the nodes of its own change. There is no
global scheduler, no shared resource registry, no cross-change lease.

### E3 — ports are literals; collision detection exists but only within one change

There is no allocation, offsetting, or ephemeral assignment. The port is
whatever the author wrote into `readiness.url` (`process-runtime.mjs:84-86`):

```js
const readinessUrl = new URL(config.readiness.url);
const port = Number(readinessUrl.port || (readinessUrl.protocol === "https:" ? 443 : 80));
```

There *is* a static collision check — `proof-readiness.mjs:61-73` parses
`port:NNNN` out of each service's readiness URL and emits
`service resource collision`. But it compares only the services declared inside
**one change's own `execution.yaml`**, and it is the sole consumer of
`service.resources`. The execution scheduler never sees those tokens.

Two changes branched from the same project — the normal case — carry the same
`execution.yaml` and therefore the same port, and nothing compares them.

Failure surfaces badly. For the built-in static server, `EADDRINUSE` is raised
via `server.once("error", reject)` (`process-runtime.mjs:117`); for a spawned
command there is no equivalent and it just times out. Reproduced with two
simultaneous runs on the same port:

```
alpha: BLOCKED: service 'web' exited before readiness (status 1): node:events:487
             throw er; // Unhandled 'error' event
beta:  RECEIPT beta/integration: pass
```

A raw Node stack dump attributed to alpha's *own* service. Nothing indicates
another change holds the port.

### E4 — readiness identity is mandatory, and still cannot tell two changes apart

Identity is **not** optional for services — `evidence-contract.mjs:41-42` hard
fails without it:

```js
if (!service.readiness.expectBody && !service.readiness.expectHeader)
  die(`service '${name}' readiness requires expectBody or expectHeader identity`);
```

(For *providers* the same condition is only a readiness issue, not a hard fail —
`proof-readiness.mjs:56-58`.) The built-in static server injects
`x-foundation-service: <name>` by default (`process-runtime.mjs:87`), and
`readinessMatches` (`:12-28`) enforces the declared expectation.

The guard is real, and it is aimed at the wrong threat. **The identity string
lives in `execution.yaml`, which is copied byte-identical into every sandbox.**
Two changes of the same project therefore present the *same* identity. The check
distinguishes "some unrelated program" from "our service"; it cannot distinguish
change A's server from change B's.

Nothing in the readiness contract carries a change id, proof run id, or
workspace hash — even though `FOUNDATION_PROOF_RUN_ID` is already injected into
every service's environment (`process-runtime.mjs:151`). The material for a
correct check is present and unused.

### E5 — false-positive receipt: reproduced, reaches LAND READY

Composed with the cleanup defect (`die()` is `process.exit`, so the `catch`/
`finally` that stops sessions never runs). **Reproduced end to end, deterministic
3/3**, using two changes in one repo on the same declared port:

**Step 1 — `alpha` leaks its server.** Its provider exits 1, so `proofCollect`
hits `die("evidence collection failed…")` at
`proof-execution-runtime.mjs:47` — inside the `try`, so `process.exit` skips both
the `catch` at `:76` and the `finally` at `:79`:

```
RECEIPT alpha/integration: fail
BLOCKED: evidence collection failed: integration:fail

listeners on 8731 AFTER failure:  node 688 … TCP 127.0.0.1:8731 (LISTEN)
what is it serving?               healthy
service log artifact              NO service log artifact
activeProofRun left in state      {"id":"collect-1786038682903", …}
```

**Step 2 — `beta` ships definitively broken code.** Its sandbox `server.mjs` is
`throw new Error("beta broke the server on startup")`. It cannot start.

**Step 3 — `beta` proves anyway:**

```
proof-collect beta → RECEIPT beta/integration: pass
  observed     : exit 0; 111ms; readiness observed
  workspaceHash: d7c047ebe1373cbc        ← beta's own tree
  execution log: observed marker from service: healthy   ← alpha's data
prove beta       → PROVEN
land-check beta  → LAND READY
```

The deciding mechanism is `process-runtime.mjs:159-181`: the readiness loop
polls *immediately* before sleeping, so an already-bound server answers on the
first poll, before the dying child can be observed. An **already-leaked** server
is therefore deterministic; a **simultaneous** start is racy and can land on
either outcome (E3's confusing error, or this).

`observed: "…readiness observed"` is actively misleading — readiness *was*
observed, of the wrong process. Every downstream guard holds and none help:
contract fingerprint, workspace hash, receipt digest and proof audit all
validate the *provenance of the receipt*, and none validate *which process
answered*.

This is a different route to a false `PROVEN` than the earlier audit's C1. C1
forges the receipt; this one earns it honestly against the wrong server, from
ordinary tooling with no dishonest input.

### E6 — neither sandbox mode carries dependencies, so real e2e cannot run in its own sandbox

Verified in a worktree sandbox:

```
node_modules in worktree sandbox: ABSENT
.env.local in worktree sandbox:   ABSENT
sandbox contents: check.mjs marker.txt openspec server.mjs
```

- **worktree mode** — `git worktree add` checks out tracked files only, so
  `node_modules` and every untracked file (local env files, fixtures, generated
  assets) are absent.
- **copy mode** — `createCopy` (`sandbox-runtime.mjs:20-24`) filters
  `EXCLUDED_WORKSPACE_DIRS` (`foundation.mjs:76-79`), which lists `node_modules`,
  `coverage`, `test-results`, `playwright-report`.

So isolation is simultaneously weaker than advertised (shared runtime state, see
E7) and stronger than usable. `playwrightAvailability` (`foundation.mjs:1226-1238`)
probes `node_modules/.bin/playwright` *inside the workspace*, so it reports the
provider unavailable in its own sandbox.

Note the interaction with the `.foundation/.gitignore` gap (`attestations/`,
`authority/` unlisted): on a stock install that gap pushes these sandboxes into
`/tmp` copy mode, which makes E6 and E7 worse.

### E7 — everything outside the file tree is shared

`startServiceSession` spawns with `{...process.env, ...envFrom, ...config.env,
FOUNDATION_*}` (`process-runtime.mjs:143-154`). `DATABASE_URL`, `REDIS_URL` and
API keys pass through verbatim to every change. Also unisolated: ports, `/tmp`,
the Playwright browser cache (`~/.cache/ms-playwright`, outside any workspace),
and any external database, queue or fixture the service talks to.

`FOUNDATION_CHANGE_ID` and `FOUNDATION_PROOF_RUN_ID` *are* injected, but nothing
requires or verifies that a service echoes them.

*Not demonstrated*: two concurrent changes migrating the same database. The
shared-env mechanism is verified; the downstream consequence is inferred.
Playwright browser-profile contention is code-reading only — no browsers were
installed in the scratch environment.

### E8 — nothing reclaims a leaked process

`session.stop()` appears at exactly five call sites —
`adapter-runtime.mjs:56`; `proof-execution-runtime.mjs:49, 76, 116, 128`:

| Path | Services stopped? |
|---|---|
| normal success (`:49`, `:116`) | yes |
| exception thrown inside `try` (`:76`, `:128`) | yes |
| `startRequiredServices` partial failure (`adapter-runtime.mjs:55-58`) | yes |
| service readiness timeout (`process-runtime.mjs:183-184`) | yes |
| **`die()` inside `try` — including "a provider failed"** | **no** |
| **Ctrl-C / SIGINT / SIGHUP / SIGTERM** | **no handler exists** |
| **unhandledRejection / uncaughtException** | **no handler exists** |
| provider watchdog timeout (`process-runtime.mjs:59-64`) | no — kills the direct child only, not the process group |

The only `process.on` in the entire harness is `foundation.mjs:169`, an `"exit"`
handler that writes telemetry and cannot reliably stop children. **No command
reclaims a port or lists orphaned services** — `abandon`, `archive` and `doctor`
clean sandboxes, transactions and leases, never processes. Recovery is
`lsof … | xargs kill` by hand.

Secondary loss: `stop()` is also what writes the service log
(`process-runtime.mjs:170-172`). When the leak happens the log is never written,
so the evidence trail is destroyed precisely in the failure case that needed it.

### E9 — a cross-repo claim binds to the composite hash, and cannot declare per-repo inputs

`providerWorkspaceHash` (`evidence-contract.mjs:265-271`) branches on whether
`config.repository` is set:

- **Scoped provider** (`repository: "api"`) → binds
  `snapshot.repositories.api.workspaceHash`, a hash of that tree only
  (`state-runtime.mjs:271-277`). An edit in `app` does not move it.
- **Cross-repo provider** (no `repository`) → `providerRepository` returns
  `null`, so it falls back to `relevantHash(id)`, the **composite**
  (`state-runtime.mjs:279-290`). An edit in *either* repo, or in the control
  repo, invalidates it.

That is the correct semantics and it is forced rather than chosen. The harness
asserts the contrast itself (`run-harness-tests.sh:1479-1491`):
`unrelated repo edit preserves API receipt` / `owning repo edit invalidates API
receipt`.

The gap is the reuse escape hatch. `receiptValidity` keeps a receipt whose
workspace hash moved if `inputs:` are declared and unchanged
(`reusable-inputs`), but `providerInputIdentity`
(`evidence-contract.mjs:273-319`) walks **only** `providerWorkspace(...)` —
`collect(workspace)` at `:311`. So a cross-repo provider cannot declare "my
inputs are `api/openapi.yaml` plus `app/src/client/**`". It is all-or-nothing
against the composite.

Related and correct: the adapter fingerprint includes
`repository: config?.repository || null` (`:349`) and the full resolved service
config (`:360-363`), so moving a provider between repos, or changing the service
it consumes, invalidates its receipt.

### What would close it

- **Bind readiness to the run, not the service name.** `FOUNDATION_PROOF_RUN_ID`
  is already in the service environment; require the service to echo it and the
  readiness expectation to match it. A stale or foreign server then *fails*
  readiness instead of satisfying it. This alone kills E5.
- Allocate an ephemeral port and inject it into both the service and its
  consumers, instead of a literal in `execution.yaml` (E3).
- Make `die()` unwind — or register a process-group kill plus a
  `.foundation/services/` registry a later command can reclaim, and add SIGINT/
  SIGTERM handlers (E8).
- Apply `activeRepositoryConflicts` at proof time as well as plan time, or take a
  project-scoped lease for the duration of `prove` (E2).
- Repo-qualify default proof resources the way Build already does
  (`dev-server:<repo>`, `browser:<repo>`) — removes E1's false serialization and
  makes genuine sharing declarable.
- Decide what a sandbox owes an e2e suite: either install dependencies into it or
  document that e2e providers run against the control workspace (E6).

### Quick reference

| Question | Answer |
|---|---|
| Provider cwd | One workspace. `config.repository` → repo sandbox, else control sandbox, else ROOT (`evidence-contract.mjs:260-263`, `adapter-runtime.mjs:79`) |
| Provider sees two repos' files | **Absent.** No env var names a sibling repo (`adapter-runtime.mjs:91-101`) |
| Cross-repo test coupling | **Network only**, via `config.service` + `service.repository` (`foundation.mjs:705-710`) |
| Port allocation | **Absent.** Literal ports; static collision check within one change only (`proof-readiness.mjs:61-73`) |
| Readiness identity | Mandatory for services (`evidence-contract.mjs:41-42`), but keyed on service name — cannot distinguish two changes |
| Evidence DAG resource model | Opaque tokens; **repo-blind**, unlike the build planner's `workspace:<repo>` (`evidence-results.mjs:97-110` vs `agent-planning.mjs:78`) |
| DAG knows ports / databases | **No.** Ports live only in readiness; databases only if hand-declared |
| Concurrent `prove` | **Unguarded** — the conflict check reaches dispatch and lease acquisition, never proof |
| Cross-repo claim receipt | Composite hash; any repo's edit invalidates (`evidence-contract.mjs:265-271`) |
| Per-repo `inputs` for a spanning provider | **Absent.** `providerInputIdentity` walks one workspace (`:311`) |

---

## Suggested order

1. **Validate receipt evidence fields** — close C1's adapter hole *and* make
   `references[]` resolvable (URL or path plus digest), or require `artifacts[]`
   for every capability except `review`/`acceptance`. Everything else rests on
   this, including MR1.
2. **Make the test fixtures atomic** (T1) — `git archive HEAD` instead of the
   working tree. Add `wiring.mjs` to CI (T3). Give `runtime/**` its own version
   marker checked at load, not only in `doctor` (T2).
3. **Give `abandon` a path when runtime state is missing or corrupt** (L5), and
   make `changes` tolerate a bad file the way it already tolerates orphans.
4. **Build the cross-repository contract provider** (MR1) — hash the declared
   contract artifact; both sides verify the same digest.
5. **Fix security detection and print the schema on upgrade** (L1, L2) — these
   compound into a permanent dead end today.
6. **Bind readiness to the proof run** (E4, E5) — **reproduced 3/3**: a leaked
   server from a failed run hands a different change a green e2e suite and
   `LAND READY` on code that cannot even start. `FOUNDATION_PROOF_RUN_ID` is
   already in the service environment; requiring the service to echo it and the
   readiness expectation to match closes this with no new plumbing. Pair with
   process reclamation (E8), which is what leaves the server running.
7. **Decide the telemetry session-vs-project binding** (O1).
8. Repo-qualify proof resources (E1); guard concurrent proof (E2); scope
   authority per repository (MR2); give non-submodule children a durable binding
   and a compensation path (MR3).
