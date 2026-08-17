# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Multi-repository worktree sandboxes now reconcile target movement at
  `sandbox sync`.** Every moved writable repository is replayed in a temporary
  worktree before any live sandbox is replaced. A conflict in one repository
  names `<repository>:<path>`, cleans all prepared replays, and leaves every
  live sandbox and recorded base unchanged instead of forcing abandon/reopen.
- **Land now follows the deterministic target-movement recovery automatically.**
  Structured blockers name `sandbox sync` as `automaticRecovery` for both
  single- and multi-repository worktrees, while conflicts and non-deterministic
  choices still stop for repair or explicit authority.
- **Repository commit identity no longer expires content-identical evidence.**
  Composite workspace/code hashes bind repository content and agreement
  revision, while recorded base heads remain explicit target-drift and Land
  guards. Provider protocol 9 and proof protocol 6 mark the identity boundary
  honestly for active changes.

## [3.2.27] - 2026-08-16

### Fixed

- **The review-receipt guard no longer blocks a change forever.** "A completed
  AI response has no matching recorded receipt" compared delivered-attempt
  counts against a receipt that only ever records the latest attempt digest, so
  a delta receipt overwriting the full receipt, a human receipt superseding the
  AI one, or an errored completion (which never gains a receipt) locked
  dispatch, record, and run permanently. The guard now reconciles the latest
  delivered AI attempt against the newest recorded receipt of any reviewer
  type, at both the dispatch and `authority run` paths, while a genuinely
  unrecorded response still refuses. (Reported by the Model Router V1 consumer
  round; see `docs/reports/model-router-v1-harness-defects.md`.)
- **`REVIEW_SCHEMA` no longer carries `uniqueItems`.** OpenAI structured output
  rejects the keyword, so every codex-adapter review dispatch failed as an
  infrastructure error. Uniqueness is still enforced after parse, now over
  trimmed IDs so normalization-equivalent duplicates ("F1" vs " F1") are
  rejected before dispatch instead of throwing afterwards.
- **A rapid change upgraded to the standard schema no longer contradicts
  itself.** The upgrade materialized `specs/` while leaving `skip_specs: true`
  in `.openspec.yaml`, which OpenSpec strict validation refuses; the upgrade
  now rewrites the marker.

### Added

- **`authority reset-infra <change> --decision-ref <ref>`** — the recovery the
  infrastructure-error message always instructed but never provided. After the
  reviewer diagnosis passes, it acknowledges completed infrastructure errors so
  they stop consuming the bounded retry; it refuses a reused decision
  reference, refuses while any AI attempt is still dispatched, and never
  mutates the recorded attempt chain.
- **`sandbox apply --refresh`** — the sanctioned recovery for a target that
  legitimately moved after apply, routing to the existing
  `refreshAppliedProjection`; unknown flags still die and diverged applied
  paths still refuse.
- **`change validate` now runs the OpenSpec strict lint** when the CLI is
  available, so missing SHALL/MUST wording surfaces before Prove instead of
  inside `openspec archive` after the code has landed; an absent CLI degrades
  to a warning.
- **`review guard reconciliation` deterministic suite** covering all of the
  above at the store, router, and lint seams, wired into `run-all.sh` as
  suite 56 with five critical cases.

## [3.2.26] - 2026-08-16

### Added

- **Runtime architecture boundaries are now executable contracts.** A new
  deterministic guard rejects reverse dependencies through static imports,
  dynamic imports, CommonJS `require`, and `createRequire`; it also syntax-checks
  every shipped module and verifies that CI path filters cover each tested
  product surface.
- **Dashboard schema evolution now has isolated migration coverage.** Fresh,
  legacy v1-v3, current, future, rollback, and idempotent SQLite paths are
  exercised independently from the HTTP server.

### Changed

- **The harness runtime now follows explicit domain direction.** Portable
  change-artifact and model-policy contracts, workspace policy, provider
  catalog, bootstrap persistence, spec-delta validation, and proof-service
  lifecycle behavior live behind narrower domain seams instead of the
  compatibility entrypoint and oversized runtime modules.
- **Dashboard sanitization and SQLite migrations are separate modules.** Schema
  changes run transactionally, service startup resets cleanly to in-memory mode
  after storage failure, and the server retains its existing HTTP contract.

### Fixed

- **A rollback deployment can no longer downgrade a newer dashboard database's
  migration marker.** Future schema versions are rejected without rewriting
  `PRAGMA user_version`, preventing destructive migrations from being replayed.
- **Architecture and dashboard-only changes can no longer bypass CI.** Workflow
  filters now include dashboard, host installers, package locks, and committed
  policy surfaces.
- **Change-artifact imports remain available during harness upgrades.** The old
  workflow path is retained as a compatibility re-export while new code uses
  the canonical contract module.

## [3.2.25] - 2026-08-16

### Added

- **Project policy is now documented as a first-class configuration surface.**
  The English and Thai documentation explain every `foundation.json` section,
  validation range, execution budget, model tier, escalation trigger, sandbox
  setup, and review profile, with links from install, artifacts, README, and
  the landing page.

### Changed

- **New installations default to a single-model self-review profile.** Claude
  Code Opus remains the configured read-only ephemeral reviewer, while
  `independence: "self"` and `diversity: "single-model"` let Claude-only users
  start without Codex or a distinct reviewer identity. Stricter independence
  and cross-provider diversity remain opt-in committed policies.
- **The landing page now exposes committed execution policy.** Model routing,
  packet limits, leases, parallelism, escalation, and the review circuit are
  visible in a responsive policy section; the mobile evidence layout no longer
  overflows the viewport.

## [3.2.24] - 2026-08-16

### Fixed

- **Upgrade compatibility tests now follow the release source of truth.** The
  real previous-installation fixture derives its expected upgraded CLI version
  from `VERSION` instead of retaining a stale patch-version literal that
  blocked later release suites.

- **Release artifacts now report the version they were published as.** The
  release workflow updates the executable runtime, protocol descriptor,
  installed agent/setup guidance, and CLI documentation together, while the
  single-source contract prevents those mirrors from drifting from `VERSION`.

## [3.2.23] - 2026-08-16

### Fixed

- **Multi-repository copy Land no longer projects child repositories through
  the control root.** Both nested Git repositories and submodules are excluded
  from initial apply, reapply, and the final transaction guard, preventing
  child `.git` metadata or independently landed files from being replaced.
- **Manual apply recovery now has executable, crash-resumable outcomes.**
  `land recover --resolution restore-backup` stages and verifies every backup
  before swapping targets, while `keep-current` preserves the target and
  requires a sandbox sync before proving or landing again. Recovery journals
  retain their authority reference and remain pending across interrupted
  settlement.

### Changed

- Runtime API 21 binds the new Land journal settlement boundary across the
  CLI, entrypoint, runtime modules, protocol descriptor, and public docs.

## [3.2.22] - 2026-08-16

### Added

- Risk-tiered review: low uses one AI full review; medium and high permit one
  correction batch and a delta-only closure. High-risk decisions are batched at
  intake and Prove has no mandatory human approval gate.
- Grounding v2 records production entry, real wire, legacy activation,
  cross-service interaction, observability, critical-case, and mutant
  decisions in the initial Decision Sheet.
- A configured Codex CLI reviewer runs GPT-5.6 Sol in a fresh read-only
  ephemeral session with structured output and durable provenance.
- A configured Claude Code CLI reviewer runs a high-effort Opus review with a
  JSON schema, read-only tools and a fresh non-persistent session. Codex-only
  and Claude-Code-only projects may commit the single-model diversity waiver
  without waiving reviewer identity/session independence.
- `proof advance` serializes proof/authority mutation, resumes external waits
  without polling, checks freshness, and orders review before acceptance.
- Permission-bound AWS, secret, Terraform, deploy, restart, and environment
  work uses activation-aware `handoffs.yaml` plus durable operator records;
  Build and Prove continue while Land blocks only unsafe unresolved operations.
- A final in-contract AI finding closes through its named claims and current
  critical-case receipts, producing a hash-chained deterministic closure
  without a third AI or mandatory human review.

### Changed

- Runtime API 20 and the review, authority, proof, packet, and adapter
  protocols bind the new routing and evidence contracts.

## [3.2.21] - 2026-08-14

### Fixed

- **A successful archive now logs its own operation row.** The telemetry exit
  hook re-read the change's runtime status at exit, and `archive` flips the
  status to `archived` mid-command — so the one command that finished a change
  was the only one missing from its `operations.jsonl` timeline (blocked and
  failed archives still logged). The hook now gates on the status captured
  when the command started: the finishing archive logs its row, while later
  sessions that merely touch an archived change stay silent, as before.
  (Reported from a consumer round report's timeline gap.)

## [3.2.20] - 2026-08-14

### Added

- **Sandboxes can install their own dependencies.** `foundation.json` accepts
  `sandbox.setupCommand` (+ `setupTimeoutMs`), and `openspec/repositories.yaml`
  rows accept a per-repository `setupCommand`; the harness runs the command
  once inside every newly created Build workspace and records the outcome on
  the workspace record. A failing setup keeps the sandbox and prints a
  recovery warning instead of destroying the workspace — the jest-without-
  `node_modules` first-proof failure is gone.
- **`land archive` imports session telemetry before sealing the record.** One
  quiet Claude-transcript sync runs before the destructive archive step, and a
  change archived with no model usage warns that its cost columns will stay
  empty, naming the manual `telemetry sync` command. Telemetry never gates an
  archive.
- **Default-branch visibility at Land.** `land record` warns — without
  blocking — when the target repository is checked out on `main`/`master`,
  `land check` adds a `branch:` line to `LAND READY` for a default-branch root
  target, and `doctor` now reports the unwired `no-direct-main` hook at `warn`
  instead of `info`. All branch reads are failure-silent; every land guard
  stays commit-based.
- **DAG cycle diagnostics.** When the task planner or the provider scheduler
  detects a stuck graph, the error now names one concrete dependency cycle
  (`a -> b -> a`) instead of listing every pending node, and the provider
  scheduler distinguishes a cycle from a dependency that ran and failed.

### Changed

- **The changed-surface proof blocker now hands back the fix.** When a
  repository changed files no task declares, readiness recovery renders the
  undeclared paths as a paste-ready `[paths:...]` annotation per repository,
  and `/build` instructs that new files are declared in the owning task's
  `[paths:]` as they are created.
- **Staleness refusals state the recovery order.** `proof is stale` now says
  to finish contract and code edits, sync, and run one fresh prove;
  `authority request … is stale` says to request review and acceptance last,
  after the workspace stops changing — each naming the resuming command.

### Fixed

- **Landing two changes over the same file no longer loses the first one's
  work.** Worktree apply validated the patch textually but applied by copying
  whole files, so a target file carrying uncommitted edits from a previously
  landed change was silently overwritten (last writer wins). Apply now
  refuses, names the clobbered paths, and says how to reconcile; symlinks are
  compared by link target like git blobs.

## [3.2.19] - 2026-08-14

### Changed

- **`harness-html-report` now specifies a round-ledger report, not a bare
  status dump.** The skill's procedure was rewritten around the strongest
  report the harness has produced so far: the newest finished change told as a
  complete story with the active change appended as next-round status. The
  reference now pins the header shape (lede + verdict/profile/next-round
  chips), a KPI scorecard that adds Harness (blocked/total commands), Code,
  and Docs volume dimensions, a non-overlapping phase-attribution timeline
  whose per-phase times sum exactly to the span, a harness-interventions
  section that groups `blocked` operations by what the guard prevented — 
  including what the harness did *not* catch and the rework its strictness
  forced — slowest-command and code-volume tables derived from the round's
  actual commits, budget used/target from the runtime state file, and
  plain-Thai first-use glosses for harness jargon. Verbatim-receipt quoting
  and the no-invented-cost rule are unchanged. File:
  `.claude/skills/harness-html-report/references/report.md`.

## [3.2.18] - 2026-08-13

### Fixed

- **`agents acquire` no longer pretends to accept a takeover.** Its flag spec
  was copied from `agents release` and accepted `--force` and `--decision-ref`,
  but `acquire()` reads nothing but `--owner`. Both were swallowed in silence,
  so a host reaching for a takeover got a plain contended acquire and an exit
  code that read as a considered refusal rather than a flag the runtime never
  saw. Takeover belongs to `release`, which frees the resource so the next
  acquire can win it fairly; the registry usage already said `--owner` alone,
  so the parser is the half that changed. Both flags now fail with the
  supported surface named. Files:
  `.claude/harness/runtime/core/cli-router.mjs`,
  `.claude/tests/harness/contracts/planning-diagnostics.sh`.

## [3.2.17] - 2026-08-13

### Added

- **A failing gate now has a recorded way out: `change waive`.** A provider
  that executed and failed used to leave one printed route — re-run — which is
  useless when the gate itself is wrong or the user decides to land without
  it. `claude-foundation change waive <change> --capability <c> --reason <why>
  --decision-ref <ref>` withdraws that one capability's enforcement on an
  explicit host-recorded user decision: the claim keeps declaring it, the
  waiver travels as a `user-waived` advisory into proof readiness, the proof
  record, the archive, and the `LAND READY` line, and `--revoke` restores the
  requirement. Receipts already earned stay valid — a waiver is subtractive
  and cannot change what any other provider attested — so the re-prove after a
  waive executes zero providers. There is deliberately no route that lands a
  failing proof, and `review`/`acceptance` are refused here in favor of their
  own documented waiver and withdrawal routes. The `fail` validity now prints
  all three exits (fix, rewire, waive) beside the blocker at Prove and Land.
- **`describe` now covers the change loop.** `describe build` answered
  "unknown command" and `describe prove` answered with the internal `proof
  finalize` — the surface an agent is actually driven by was the one surface
  `describe` knew nothing about. The seven host commands are now read from the
  shipped `.claude/commands/*.md` files (no second copy to drift), listed
  ahead of the CLI surface, and resolvable by bare word or `/slash` spelling.

## [3.2.16] - 2026-08-13

### Added

- **OpenCode and Codex CLI host adapters.** `claude-foundation init --host
  cursor|opencode|codex` (also runnable as `install-opencode.sh` /
  `install-codex.sh` from a source checkout) layers a host adapter over the
  shared install. OpenCode gets the seven commands in `.opencode/commands/`
  and a guard plugin at `.opencode/plugins/foundation.js` that replays the
  shipped hooks through `tool.execute.before/after` — secrets guard and
  phase-mutation guard block live, lint feeds back on edit — while skills and
  the agent contract need no adapter at all: OpenCode reads `.claude/skills/`
  and `AGENTS.md` natively. Codex gets the seven prompts in
  `$CODEX_HOME/prompts` (Codex has no per-project prompt directory) stamped
  with an ownership marker, so re-installs refresh Foundation prompts and
  never clobber a same-named user prompt; Codex has no tool hooks, so the
  installer says plainly that live guards are inert there and Land gates plus
  the opt-in `no-direct-main-commit.sh` remain the enforcement.
- **`.claude/hooks/README.md` states the hook contract.** The stdin event
  shape, the two answer channels (block JSON before the tool, exit 2 with
  stderr after it), and the per-host wiring matrix are now a shipped contract,
  so a new host adapter targets the contract instead of forking guard logic.

### Fixed

- **The Cursor adapter now ships the skill router as an always-on rule.** A
  bare `.md`→`.mdc` rename left `fundamentals.mdc` without MDC frontmatter,
  so Cursor treated the always-on router as an agent-requested rule; the
  adapter now writes `alwaysApply: true` frontmatter around it.

## [3.2.15] - 2026-08-13

### Added

- **`harness-html-report` skill.** A shipped skill that projects harness state
  into a self-contained Thai-language HTML report and publishes it as an
  Artifact when the host supports one (file fallback otherwise). The report
  opens with an eight-dimension KPI scorecard — quality, bugs, time, speed,
  tokens, cost, improvement proposals, overall health — followed by a
  per-phase walltime/token/cost table joined from `operations.jsonl` and
  `events.jsonl`, gate receipts quoted verbatim, and a derived
  improvement-candidates list. Read-only over `.foundation/` and `openspec/`;
  cost estimates are allowed only when labeled with the assumed per-MTok
  rates, and a `null` host cost is reported verbatim, never invented.

## [3.2.14] - 2026-08-13

### Added

- **`hash <change> [provider]` is a public command.** EVIDENCE.md has always
  documented it as the way to read the workspace hash a signed CI envelope must
  bind, but only the deprecated `runtime` namespace actually reached it — the
  documented signed-CI flow failed at the first step. The provider-scoped form
  is now in the command registry and routed by the CLI.

### Fixed

- **`exec <change> -- <command>` routes through the public CLI.** The registry
  advertised it and `/build` instructed agents to wrap long externals in it,
  but `cli.sh` had no route, so external-command timing silently never reached
  metrics. A new single-source check asserts every public registry entry is
  routable, so a command can no longer ship documented-but-dead.
- **The secrets hook catches quoted paths.** `cat ".env"` and `cat '.env'`
  passed the guard because dequoting erased quoted spans wholesale; a quoted
  span that is a single plain word is now kept, while prose strings (commit
  messages) stay exempt.
- **The phase guard fails closed on unrecognised mode spellings and stops
  blocking `/dev/null` redirects.** The prefilter fast-pathed any casing it did
  not recognise (`BLock` fell through to audit while the guard meant block),
  and pure `2>/dev/null` / `>/dev/null` redirects counted as mutations. It also
  now permits `openspec/investigations/` notes during Change and Prove, so a
  phase left by an earlier packet cannot block `/investigate`.
- **`proof collect` no longer loses service logs.** Collected service
  artifacts were saved onto `activeProofRun` and then cleared by the same
  command's cleanup before `prove` ever read them; they now survive to the
  proof manifest and are consumed exactly once.
- **A provider whose spawn fails no longer hangs `proof run`.** The error path
  now stops the readiness poll and clears the timeout timer; previously the
  poll rescheduled itself forever. Verbose providers are safe too: the
  external-receipt runner's 1 MB `maxBuffer` killed any green suite printing
  more, recording it as an infrastructure error — it now matches the 64 MB
  ceiling used everywhere else.
- **Sandbox sync and apply no longer corrupt non-UTF-8 content.** The binary
  git diff was decoded through UTF-8 (invalid bytes became U+FFFD) before being
  replayed, silently corrupting files and surfacing phantom conflicts; the
  patch now stays bytes end to end.
- **Quoted (non-ASCII) filenames no longer break status parsing.** Three
  hand-rolled porcelain parsers broke on `core.quotepath` C-quoting — silently
  downgrading every sandbox to the expensive isolated-copy mode and dropping
  files from the pre-existing-dirt ledger. One shared `-z` parser replaces
  them.
- **A new change cannot reuse an archived change's id.** Leftover receipts and
  review history under the old id were silently inherited, so a brand-new
  change could open already `review-attempts-exhausted`; the id is now refused
  while that history exists.
- **A blocked provider dependency no longer strands `activeProofRun`.** The
  scheduler exited the process from inside the execution DAG, skipping the
  cleanup that stops services and clears the run, so the next `evidence
  record` bound a dead run's workspace hash.
- **Workspace hashing no longer depends on the machine's locale.** Directory
  and fingerprint sorts used `localeCompare`, so byte-identical trees could
  hash differently across environments and expire receipts spuriously; all
  hash-feeding sorts are now codepoint-ordered.
- **Authority-bearing commands parse flags strictly.** `agents
  plan/acquire/release`, `land recover`, and `land record` now reject unknown
  flags, and `land record --ci-required` is a true boolean — the lenient
  parser consumed the next positional as its value, so a falsy-looking token
  could silently disable the requirement it was meant to assert.
- **The installer survives hostile-but-legal input.** A user hook entry
  without a `command` string no longer aborts the whole install (jq type
  guard); a failed fresh install no longer leaves `install-manifest.txt` or a
  seeded `openspec/repositories.yaml` behind after rollback; preflight now
  checks `.foundation/README.md`; and a non-interactive run without `--yes`
  dies with an actionable message instead of a bare read failure.
- **Dashboard daemon heartbeats report real schema/version metadata.** The
  background scan derived them in a subshell and never published them, so
  every heartbeat sent `none`/`unknown` and mixed-revision detection could
  never fire. The server also validates status before throttling, throttles
  against the last accepted beat (a fast client could previously starve its
  own persistence forever), and caps the profile roster the way agents are
  capped.

### Changed

- **A new project is seeded with both review waivers.** The shipped
  `foundation.json` now carries `"review": { "independence": "self",
  "diversity": "single-model" }`, because the common setup is one operator
  driving one model, and the stricter posture made that setup unable to satisfy
  its own review gate. A project with a second reviewer available sets either
  axis back to `"required"`. This changes only what a *new* install is seeded
  with: `foundation.json` is copied when missing and never overwritten, and the
  runtime still defaults to `required` on both axes when the key is absent, so
  existing projects keep whatever policy they committed. Receipts continue to
  record what was observed — `independent: false` and the named waiver — rather
  than what the policy permitted.

## [3.2.12] - 2026-08-13

### Added

- **`land recover <change> --decision-ref <ref>` settles an interrupted apply.**
  Recovery replays or reverses filesystem mutations, so it now carries the same
  decision reference every other authority action does and reports what it is
  about to settle before settling it. `land check` reports a pending
  transaction with its status and counts instead of resolving it.
- **`sandbox sync` reconciles a worktree sandbox with a moved target.** It
  replays the sandbox's diff onto the target's current commit and reports
  `rebased: <base> -> <head>`. The replay is staged in a throwaway worktree
  first, so a hunk that no longer applies leaves the sandbox untouched and
  names each rejected file as a `CONFLICT`. `sandbox inspect` reports the
  recorded base against the target's head, reading `.git/HEAD` and the ref
  files rather than running `git`, so the diagnostic still works when the
  environment is suspect.
- **`hash <change> [provider]` prints the hash that provider binds**, which is
  what a CI system signing an evidence envelope needs to state.

### Fixed

- **Land could project deletions for paths the change never declared.** The
  apply projection was derived from a whole-tree manifest diff, so a projection
  of 9 updates and 1 create also carried 6,509 deletions of undeclared files
  under a nested repository sitting in the working tree. The change surface is
  now the union of git-tracked paths and the paths the change declares, and a
  projected deletion requires the path to be inside that surface. A change that
  declares nothing keeps the previous unconfined surface, so undeclared new
  files are never silently dropped. Every apply reports its update, create and
  delete counts before it runs.
- **A moving target was only refused after the evidence was spent.** A worktree
  sandbox is pinned to the commit it branched from, and nothing moved it:
  `sandbox sync` printed an ordinary success while the sandbox kept building
  against a base the target no longer had, and the refusal arrived inside the
  apply transaction as a bare string after Build and Prove had already run.
  Both apply guards and `land check` now emit the `control-head-moved` decision
  naming the replay as the way out, and a target that moved is always reported,
  including for a multi-repository sandbox this sync cannot resolve.
- **Editing the change packet expired every receipt.** The proof hash covered
  the whole change surface, so a note added to `design.md` after proving
  charged a full provider re-run for an edit no test or lint command can read.
  The workspace snapshot is now folded twice: `workspaceHash` is every path the
  change surface admits, `codeHash` is that minus the change packet. An
  executable provider binds the second; `review` and `acceptance` still bind
  the first, because a reviewer read the proposal.
- **The loop dead-ended on gates it could not prove.** A capability inferred
  from the realized diff can only appear after Build, and an inferred
  capability nobody wired defaulted to adapter `external`, so Prove and Land
  stopped on a gate with no executable path and no stated way out. An inferred
  capability is now enforced only where a provider is wired or a claim declares
  it, and is otherwise carried as a reported, non-blocking advisory. Preflight,
  Prove finalize, and Land print the recovery route beside the blocker, and
  `/prove` no longer bans self-review outright, which had made that supported
  solo setup unusable.
- **Unmeasured host usage was reported as zero.** Metrics reported
  `requests: 0` and the budget window initialized numeric zero while
  `measurement` still said no host events had been ingested, so a real run
  appeared to consume nothing and `budgetDecision` claimed to be measured.
  Unknown usage now stays null, a genuinely observed zero stays a measured
  zero, and `ensureBudgetState` heals the legacy invented zero on read.

### Changed

- **`foundation.mjs` is a composition root again.** The runtime implementation
  moved under `.claude/harness/runtime/`, leaving the entrypoint to wire the
  domains together; the command registry and runtime environment are now their
  own modules.
- **`runtimeApi` moves to 19 and `providerProtocol` to 8** for the
  provider-scoped hash and the runtime module split.
- **The test suite runs suites through a bounded pool**, buffering each suite's
  output and replaying it in table order so a parallel run diffs like a serial
  one: 5m54s to 1m56s. Mutation suites hold a lock and refuse a tree that still
  carries an injected fault, because two overlapping runs had already written
  one run's fault into the working tree permanently.

## [3.2.11] - 2026-08-11

### Added

- **Review independence can be waived by committed project policy.** Projects
  driven from a single session may set `review.independence: "self"` in
  `foundation.json`. Review receipts preserve the observed self-review and the
  policy waiver; critical work still needs any separately required diversity
  waiver.

### Fixed

- **Invalid deltas for new capabilities now fail before Build.** A capability
  without a canonical specification may only declare `ADDED Requirements`;
  validation rejects `MODIFIED` and `REMOVED` sections with a corrective
  diagnostic instead of letting the change fail during archive.
- **The portable agent contract names the structured question channel.** The
  only instruction file guaranteed to reach consumer projects now explicitly
  names `AskUserQuestion`, retains plain text as the fallback, and points to
  the conduct rules.

### Changed

- **The portable agent contract is back within its original 150-word budget.**
  Its wording is tighter without dropping workflow, authority, evidence,
  translation, or interaction rules, and the temporary 175-word allowance has
  been removed.

## [3.2.10] - 2026-08-11

### Fixed

- **A typed lifecycle stop was reported as a failure.** `metrics` counted every
  operation that was not `completed` as failed rework, so a change with nineteen
  completed operations, six blocked stops, and zero failures reported six
  failures. The same file's `rework` section had it right, and the test suite
  only ever asserted on that section. Underneath it, the status itself was
  guessed rather than declared: the exit handler inferred "blocked" from exit
  code 2 against a hardcoded list of three command names, so any path that set
  an exit code without going through `die` was filed as a failure — the same
  `validate` refusal read `failed` in one change and `blocked` in another.
  Blocking is now declared by the command that decides it, and the phase rollup
  counts `blocked` separately.
- **A failing test suite was reported as `blocked`.** The `test-discovery`
  adapter collapsed four possible statuses into `pass`/`blocked`, so a suite
  that ran and failed was indistinguishable from one still waiting on something
  external — the meaning `blocked` carries everywhere else in the harness. The
  adapter now reports the worst real status, and the Playwright aggregate takes
  the highest severity instead of whichever output happened to come last.
- **A passing review inherited a blocker count nobody stated.** `--unresolved-blockers`
  defaulted to zero when the flag was absent, which satisfied the gate that
  exists to stop a review with open blockers from reaching Land. A reviewer who
  never counted and one who counted zero were indistinguishable. A passing
  review must now state the count, and the authority response template asks for
  it so the documented path stays completable.
- **A deleted `repositories.yaml` passed validation and failed inside Land.**
  The file is named in both schemas' `apply.requires` and written by
  `change new`, but `changeArtifactGaps` never checked for it.
- **Per-phase token accounting was empty whenever a call bypassed `cli.sh`.**
  The lifecycle-phase table existed twice — as a `case` grammar in `cli.sh` and
  as an object literal in `foundation.mjs` — and the two disagreed on seven
  commands. Operations bucketed by phase only when the phase came from the CLI,
  so a direct `node foundation.mjs` call, which is what an agent runs, split one
  change's rollup into two disjoint halves: operations with no tokens, tokens
  with no operations. One table now lives in `runtime/core/lifecycle-phase.mjs`,
  the runtime derives the phase itself, and a test asserts the shell grammar
  still agrees with it.
- **`humanWaitMs` was a hardcoded null beside the data that computes it.** The
  stated reason was the absence of a host/user transition signal, while
  `authority-request` and `authority-record` had bracketed every human decision
  with timestamps all along. Both those brackets and the host transcript's
  orchestrator-answer-to-next-user-message intervals are now read, overlapping
  spans merged so the figure is elapsed wait rather than a sum of observations.
  Only a timestamp-and-identity projection of a user row is retained; prompt
  content never reaches the logs.
- **The `event` CLI could not report cache-write spend.** `cacheCreationTokens`
  was hardcoded null and `--cache` was written to both the read and total
  fields, so the budget derived cache-write as exactly zero for every manually
  recorded event. `--cache-create` now exists.
- **`--size` was accepted verbatim and read by nothing.** `WORKFLOW.md` says
  size is "for budget and slicing only", but the budget calculator took no size
  argument, and the one check that read it compared against the literal `"S"` —
  which the atomic-start path's own `"xs"` could never match. Size is now
  validated against an enum, stored lowercase, and scales the request lane.
- **`budget` printed `0.0% CONTINUE` when nothing had been measured.** Unknown
  spend still fails open, but it now reports `unmeasured` rather than a zero
  that reads as a measurement. A discovery receipt likewise writes
  `discovered: null` instead of a zero contradicting its own "count
  unavailable" text.
- **The dashboard read `proof.json` as if it were a provider receipt**, which
  produced a phantom provider row and reported a receipt set containing
  failures as the same `partial` as an all-green set still awaiting `prove`.

### Added

- **A suite for the tables that must agree.** `run-single-source-tests.mjs`
  asserts the `cli.sh` phase grammar against the runtime table, the four
  runtime-API pins pairwise, `foundation.mjs` `VERSION` against
  `protocol.json`, and `install.sh` `MANAGED` against CLAUDE.md. Four of those
  pin pairs had no check at all, so an edit to `cli.sh` alone was caught by
  nothing.
- **`metrics` output version 5** adds `blocked` and `spendTokens` per phase,
  per-phase `inputTokens`, and `humanWaitSpans`/`humanWaitBasis`; `budget`
  decisions carry `measured`. `spendTokens` sums input, output, and cache-write
  — the budget's own measure — so a phase can be compared against its window.

### Changed

- **Request budgets re-derived from the archived runs**, 80/160 → 100/200.
  Standard changes with real implementation cost 100–170 model turns, and one
  landed on exactly the old 160 target while its tokens sat near half. `--size`
  widens the lane further (`xs` 0.5x, `s` 1x, `m` 1.5x, `l` 2x), combining with
  impact by the larger of the two rather than multiplying them.
- **Runtime API 17 → 18.** The entrypoint imports a runtime module an older
  `runtime/` tree does not contain, which is the mixed-install case those pins
  exist to catch. Projects upgrade with `claude-foundation init`.
- **`state.provenHash` removed** along with the three modules that paid to
  invalidate it. Freshness is decided from `proof.workspaceHash`; the mirror was
  read by nothing.

## [3.2.9] - 2026-08-10

### Fixed

- **The shipped operator guide named four adapters and documented four of the
  five** — `contract-digest` was missing from the adapter table in
  `.claude/harness/README.md`, so a reader of an installed harness could not
  learn that the adapter exists while `EVIDENCE.md`, two files away, documented
  it. The table now carries a row per adapter and says which of them execute
  without running a command.
- **Four `.foundation/` listings each described a different subset of what the
  runtime writes** — the one in `WORKFLOW.md` omitted `evidence/`, the immutable
  proof vault. `.claude/harness/README.md` now carries the canonical table of
  every state root, and the shorter listings name it as their source rather than
  restating it.

### Added

- **Documentation that states a release now fails a test when it drifts from
  one.** `WORKFLOW.md` was the only surface with a version assertion, and it was
  the only one that stayed current — both READMEs, the landing page, and the
  docs site had been pinned to v3.2.4 across four releases, one of them telling
  readers which receipts read as `provider-version-stale` using the wrong
  number. `run-doc-consistency.sh` now derives the release, runtime, protocol
  API, and adapter set from `VERSION`, `protocol.json`, and `foundation.mjs` at
  run time, so nothing in it can go stale the way the documentation did. The
  release workflow bumps every one of those surfaces, and `docs/run-docs-tap.sh`
  restates the suite as counted evidence.
- **Documentation for the artifacts the system produces, and for human
  approval.** New pages, in English and Thai, cover every artifact the harness
  writes — the change packet, the `.foundation/` tree, the evidence vault, and
  the two outputs that are deliberately inadmissible as evidence — receipts,
  the four provider statuses, the executed-versus-asserted floor, and content
  binding; and the four distinct approval boundaries the runtime implements.
  The approval page states plainly that Land gates on evidence rather than
  consent, and a test now fails if any surface claims otherwise.
- **`discoveryProvider` and the leftover-server hazard are documented for
  readers**, having previously existed only in the agent-facing reference: a
  second test suite in one repository must name the discovery provider that
  speaks for it, and a status-only readiness probe can be satisfied by a
  development server already holding the port.

## [3.2.8] - 2026-08-10

### Fixed

- **A sandbox no longer copies — or hashes — regenerable build output** — both
  the copy sandbox and the workspace baseline decided what to walk from a fixed
  list of directory names. That list knew `node_modules` and `coverage` but not
  `target`, `dist`, `build`, `vendor`, or `.venv`, so a repository carrying a
  large ignored build directory paid for it twice. On this project's own 79GB
  gitignored Rust `target/`, `sandbox create` copied until the filesystem was
  full, died on an uncaught `ENOSPC`, and left a 41GB tree `state.workspace` had
  never recorded — invisible to the runtime, and enough to make every retry fail
  with `sandbox path already occupied`. `workspaceManifest` hashed the same tree
  into the copy baseline: 906,814 of 909,041 entries, and a 156MB runtime state
  file that every later command re-parsed, taking `changes` from 0.09s to 1.96s
  and `packet` from 0.22s to 9.31s. Both walks now ask git what it ignores.
  Measured after: `sandbox create` 0.92s, the sandbox 29MB, the state file
  104KB, `packet` 0.23s. A copy that fails partway now removes what it wrote
  instead of leaving a tree nothing knows about.
- **Detected provider configuration survives a sandbox sync** — `evidence init
  --write` resolved its target through `activeChangePath`, which points into the
  sandbox during Build. `sandbox sync` is one-way source → sandbox: it removes
  the destination, copies the source over it, and merges back only `tasks.md`.
  Provider configuration written during Build was therefore handed to the next
  sync to delete, silently, in both trees, after being reported as written — and
  `evidence doctor` recommends the very command that lost its own output. It now
  writes the durable change directory and mirrors into the active sandbox.
- **The working tree's existing contents are no longer counted as change
  surface** — the surface came from `git status`, which cannot tell a file this
  change wrote from one that was already lying around. A stray untracked
  `theme.css` pulled the `accessibility` policy trigger onto a one-line rapid
  change that had touched no stylesheet, and Prove then asked for evidence the
  author could not honestly produce. `change new` now records a digest of every
  dirty path before the change writes anything, and the surface drops a path
  whose digest still matches. Digests rather than names: a pre-existing file the
  change *does* edit returns to the surface.
- **Uncommitted state no longer costs a change its worktree** — `sandbox create`
  fell back to a whole-tree copy for any dirt it did not recognise. Another
  change's draft did it, though the loop deliberately keeps drafts uncommitted
  until Land, and so did a single stray untracked file. Both now keep the
  git-worktree sandbox; editing a carried-in file still makes it a dirty target.
- **Test evidence can be proven in more than one repository** — a
  `test-discovery` provider not named exactly `test` must name a
  `discoveryProvider`, and that reference had no satisfiable target: the
  discovery half was refused the adapter outright, every other adapter passed
  validation and then failed at execution because none produces a discovered
  count, and the scheduler only folded the pair into one node when their configs
  hashed identically — impossible once `capability` differs. Two repositories
  need two test providers, so at most one could be named `test` and every other
  repository was unprovable. The scheduler now follows the `discoveryProvider`
  reference, and `EVIDENCE.md` documents the pairing.
- **Rapid changes are valid to OpenSpec** — the rapid schema declares no spec
  artifact, so a rapid change never has deltas to find, and OpenSpec reads that
  absence as an error rather than an omission. Every rapid change was invalid to
  `openspec validate`, and Land printed the validator's five-line remedy at the
  user each time. Rapid changes now carry `skip_specs: true`, and the rapid
  proposal template uses the `## Why` and `## What Changes` headers OpenSpec
  expects.
- **The budget's operator stop is real, and required proof stays inside it** —
  `activateBudgetWindow` carries `operator-required` across a run id because the
  id is caller-supplied, but nothing ever raised that mode. An exhausted run
  read `completion-only`, and renaming the run reset it to `normal` with a full
  fresh allowance: the gate re-armed indefinitely with no decision recorded.
  Exhausting the one extra window an operator already funded now raises the
  stop, and the stop's allowances were wrong as well as unused — they listed
  neither `provider-run` nor `land-recovery`, so reaching it would have stranded
  a change rather than gating it. A first window running out is still an
  ordinary completion boundary, and a genuine host rollover still earns a fresh
  one.
- **An unreadable telemetry export fails in a sentence** — a telemetry export is
  written by the host, so a truncated one is an ordinary input. The JSONL
  fallback parsed it with a bare `map`, so one malformed line threw out of the
  command and printed a Node stack trace with absolute runtime paths. Skipping
  is already this command's vocabulary; unparseable lines now join the reported
  `skipped` count, and only a file with nothing readable in it is an error.
- **Machine state under `.foundation/` is ignored by default** — the runtime
  ignore file named each machine-state directory, so every directory added since
  had to be remembered. Two were not: `authority/` and `attestations/` surfaced
  as untracked files in any project using external review or host attestation,
  and `install-manifest.txt` did the same in every project that ran the
  installer. It is now an allow-list.
- **A change that requires acceptance says how to leave that state** — declaring
  acceptance required without naming what is to be accepted left every later
  command refusing the change, with a message naming two flags of `change
  resolve`, a command already run by the time anything reads it. All three exits
  are now named.
- **The orphan-runtime diagnostic names `change abandon`** rather than
  instructing an operator to move runtime state files by hand.

### Changed

- **The phase guard costs 4ms instead of 51ms per mutating tool call** — of the
  guard's measured 53ms, 44ms was Node startup, and on a stock install with no
  active change its answer is always "nothing to enforce". A shell prefilter now
  answers that case with builtins alone and `exec`s the guard whenever a
  decision is needed. Block mode and any recorded phase context always delegate,
  so enforcement and freshness policy stay in one place. Installing over a
  project retires the superseded `phase-mutation-guard.mjs` wiring, so an
  upgraded project runs one guard rather than two.
- **The guardrail audit log is bounded**, rotating at 1MB and keeping one
  previous generation.
- **`install.sh` stages the files it manages** and states that they must be
  committed before the first `/change`. Until they are, the loop reads them as
  the change surface: the harness's own shipped paths then trip its own policy
  triggers, and the first change is asked for accessibility, compatibility, and
  data-migration evidence it cannot produce.
- **The review response template carries reviewer and implementation
  provenance** — `authority record` accepts only `--request` and `--response`,
  while the receipt it writes requires subject provenance. `validateResponse`
  already forwards the response file's `evidence` keys, so the file could always
  carry it; the emitted template simply never named the fields, and an operator
  following the template hit a dead end on a flag the command rejects.

## [3.2.7] - 2026-08-07

### Fixed

- **A copy sandbox no longer links back into the project it isolates** —
  `cpSync` resolves symbolic links by default, rewriting a relative link into an
  absolute path pointing at the *source* tree. Every isolated copy therefore
  carried links aimed at the real workspace: anything that followed one — a
  build, an evidence provider, a script — wrote into the project while believing
  it was sandboxed, and git inside the copy reported the rewritten links as
  modifications the change never made, which then read as work outside the
  change's scope. Copies now preserve links verbatim, the way `land-journal`
  already did on the way back out.
- **A committed directory is no longer deleted for sharing a name with build
  output** — workspace surface was decided by matching an excluded name against
  *every* path segment at *every* depth. `.foundation` and `.workflow` name the
  harness's own directories at the project root and nothing below it, so a
  repository that committed a fixture of that name anywhere else lost it from
  the change surface and from the copy sandbox at once — the file vanished from
  the hash and reappeared to git as a deletion nobody made. Depth alone cannot
  decide it either, since `node_modules` legitimately nests in every monorepo.
  The axis that separates the two is what git already knows: generated output is
  untracked, committed content is content. `.git` is now excluded at any depth,
  `.foundation` and `.workflow` at the project root only, and every other name
  at any depth *unless git tracks the path*. Projects with a nested directory of
  those names, or with tracked files under a name like `coverage/`, will see
  their workspace hash change once and must re-run `proof run` for any change
  proven but not yet landed.
- **Landing a change no longer costs the next change its worktree** — archiving
  moves a change's packet into `openspec/changes/archive/` and leaves that move
  uncommitted, which the dirty-target check counted as unrelated work. The next
  `sandbox create` therefore fell back to an isolated copy — a mode with
  strictly lower fidelity — for dirt the operator never produced and could only
  clear by committing someone else's bookkeeping. `.foundation/` and an
  uncommitted `changes/archive/` move are now recognised as the harness's own
  output. Neither is ever a change's surface, so a worktree taken from HEAD
  cannot lose work by ignoring them. Every other uncommitted path still earns
  the copy.
- **A provider no longer expires the receipt it just produced, in silence** —
  the workspace hash is taken before providers run and again at finalization, so
  a provider writing its report inside the hashed surface guarantees the two
  differ: the run passed, printed its receipts, and then declared them `stale`
  with no indication that its own output was the cause. `change validate` now
  names a `report` path that sits inside the surface before a run is spent on
  it, and finalization reports the hash movement and the remedy instead of a
  bare validity code.
- **Acceptance now names the claim that requires it** — a claim declaring
  capability `acceptance` outranks `change resolve --acceptance-not-required`,
  and `change validate` persisted that derived answer without a word. The flag
  appeared to do nothing, permanently, and the only way to learn why was to read
  the runtime. `validate` now names the claims holding the gate open and the
  file to edit, on every run rather than once, and `proof readiness` carries the
  acceptance scope and its origin so the one gate that can only be cleared by a
  named human can say why it is there.
- **Finalizing before anything has executed now names the operation that
  executes** — `prove` finalizes from receipts that already exist; `proof run`
  is what produces them. Reaching the first with none of the second answered
  with `test:missing, discovery:missing` and no route onward.

### Added

- **The change loop reports where it stands without being asked** — the
  `SessionStart` hook carried only telemetry identity, so every new session,
  `/clear`, and compact began blind to work already in flight. It now reports
  each active change, its status, the command that moves it, and runtime state
  left behind by a change that no longer exists. The digest is deliberately
  hash-free and never claims a proof is fresh — readiness is what `/changes`
  adds, and the digest names it rather than implying an answer it did not
  compute. With no active change it names the entry points instead.
- **Every step of the loop names the next one** — the status-to-command map
  existed only inside `/changes`, so `change resolve` and `change validate`
  ended a phase saying nothing about what followed. Both now print it, and
  `validate` names the phase ahead rather than echoing the operation the caller
  just ran.

## [3.2.6] - 2026-08-07

### Fixed

- **An isolated copy is a git repository again** — a target with any unrelated
  dirty or untracked file falls back from a worktree to an isolated copy, which
  is the common case for work in progress. That copy was created in the system
  temp directory with `.git` filtered out, and three subsystems then degraded
  silently: the changed surface fell back from `git diff` to a walk of the whole
  tree, the workspace hash stopped honouring `.gitignore`, and the sandbox lived
  somewhere the operating system is free to delete mid-run. Running a frontend
  build to collect evidence therefore wrote `.next` into the workspace hash and
  expired the evidence that had just been produced. A copy now carries `.git`,
  records the base commit it was taken from, and lives beside the worktree
  sandboxes under `.foundation/sandboxes/<change>`. `.git` remains excluded from
  every hash and every apply diff, so it is never projected back onto the
  target; a `.git` that is a *file* — a linked worktree or submodule — is still
  refused, because carrying it would point the sandbox at the repository it
  exists to leave alone.
- **`authority status --template` no longer throws on a wide review** — a review
  packet compacts its claims past twelve into `{count, preview, digest}`, and
  the response template called `.map` on that field unconditionally, before it
  even checked whether the request was the acceptance kind that reads it. The
  template was unreachable for exactly the changes carrying the most to inspect,
  and a responder met a stack trace at the moment they needed the shape. Read
  through `expandList`, which now ships as the missing half of `compactList`.
- **A copy sandbox is no longer stranded by a changed `TMPDIR`** — cleanup
  compared the recorded path against the *current* `tmpdir()` prefix. On macOS
  that value is per-session, so a shell other than the one that created the
  sandbox refused to remove it and leaked it permanently. Cleanup now recognises
  the current sandbox location and still accepts the legacy temp form, narrowed
  to a `foundation-<change>-` directory directly under a system temp root so a
  corrupt state file cannot direct a recursive delete anywhere else.
- **Generated output is no longer change surface** — `.next`, `.nuxt`,
  `.svelte-kit`, `.turbo`, `.astro`, `.parcel-cache`, `.pytest_cache`,
  `.mypy_cache`, `.ruff_cache`, `__pycache__`, `.tox`, `.gradle`, and
  `.terraform` join the excluded set. `dist`, `build`, `out`, `target`, and
  `vendor` are deliberately **not** excluded: projects do commit source under
  those names, and excluding a directory removes it from the apply diff as well
  as the hash — a wrong guess there is silent data loss at Land, not a stale
  hash.

### Added

- **"Could not be checked" no longer reads like "checked and passed"** — model
  tier drift classifies an unreported or unresolvable model as `unknown`, and
  `unknown` never blocks Land, by design: a reporting gap is not proof of a
  downgrade. But it also left no trace, so a host that never reported a model
  produced the same silence as one that ran exactly the planned tier — across
  the contract, architecture, security, migration, and review tasks the planner
  forces a deep tier for. Those rows now carry `unverified`, the change drift
  summary lists them, and `doctor` warns. What blocks Land is unchanged.
- **`doctor` names missing mutation coverage on high-impact changes** — the
  `mutation` provider is the only one that answers whether the rest of the
  evidence suite detects a deliberate fault, and it is the one capability no
  file pattern can infer: nothing about a path says the suite around it is
  load-bearing. A high-impact change that omitted it looked identical to one
  that weighed it and declined. `doctor` now warns; the evidence contract stays
  the author's, so nothing new is required and no contract fingerprint moves.

### Changed

- **Runtime 2.8.0, runtime API 15** — the composition root gained
  `sandboxCopyExcludedDirs`, `providerCapability`, `unverifiedDrift`,
  `expandList`, and `listCount`. A mixed-revision install would pass `undefined`
  for these and fail partway through, which is precisely what the API pin
  exists to refuse up front.
- **In-flight changes on an isolated copy must re-collect evidence.** The
  workspace hash for a copy sandbox now honours `.gitignore` instead of walking
  the whole tree, so it legitimately differs from the value recorded before this
  release. Changes already proven and landed are unaffected; a change mid-Prove
  on a copy sandbox will report its receipts as stale and needs `proof-collect`
  again. Worktree sandboxes are unchanged.

## [3.2.5] - 2026-08-07

### Changed

- **Ordinary engineering vocabulary no longer summons a reviewer** — security
  triggers are inferred from the change intent, and `token`, `session`,
  `identity`, `sensitive`, and `escalation` were entries of their own. Whole-word
  matching did not save them: "reduce the token budget", "resume the session",
  "record state-identity evidence", "make paths case-sensitive", and "escalate to
  a human" each bought an independent reviewer, an upgrade to the standard
  schema, and — because a security trigger also makes reviewer diversity
  mandatory — a second model or a person. They are now carried as the phrases
  that actually name a trust boundary (`auth token`, `access token`,
  `session cookie`, `session id`, `sensitive data`, `identity provider`, and
  siblings). The auth/oauth/jwt/passkey/credential cluster is untouched, and
  `--security <trigger>` remains the explicit declaration for a boundary no
  phrase caught.
- **`coupling: coupled` at low impact no longer requires review** — coupling
  reports that a change spans components, which still earns the standard
  schema's `design.md` and `specs/`. It is not on its own a reason to summon an
  independent reader, and the cross-repository cases that do need one are caught
  separately: any claim above low impact spanning repositories already requires
  review through `multi-repository-claim`, which never consulted this flag.
  `coupled` at medium or high impact is unchanged.

### Added

- **`review.diversity` in `foundation.json`** — a project with one model
  available cannot satisfy reviewer diversity with a second provider, so
  critical work always fell to a person. Setting
  `"review": { "diversity": "single-model" }` accepts a same-family reviewer
  there instead. The waiver is not silent: it appears as a
  `diversity-waived-single-model` trigger in the review packet and is recorded
  in the receipt as `review.policy.diversityWaived`, inside the hash chain that
  binds the attempt. It is deliberately not a command flag — a flag would let
  the party being reviewed write its own exemption at the moment it is caught.
  It relaxes diversity only; reviewer **independence** is never waived, because
  a fresh session and a distinct identity cost nothing even with one model.

## [3.2.4] - 2026-08-07

### Added

- **A change that cannot be proven can now be retired** —
  `claude-foundation change abandon <change> --reason <reason> --decision-ref
  <ref>` releases the change's leases, cleans up its sandbox, and moves its
  change directory, runtime state, receipts, evidence, transactions, and logs
  into `.foundation/recovery/abandoned/<id>/`, with an audit line in
  `.foundation/logs/abandoned.jsonl`. Every other exit from the change loop
  required the change to succeed, so an unsatisfiable evidence contract, a
  provider that will never exist, or a corrupt review chain left deleting
  runtime files by hand as the only way out — and nothing in the workflow said
  that was allowed. It quarantines rather than deletes, never touches Git, and
  refuses an archived change. When the proven files are already in the working
  tree it stops and asks whether to keep or revert them.
- **Terminal stops carry their exits** — exhausted AI review rounds, a corrupt
  review chain, a spent budget continuation, a continuation more model budget
  would not unblock, a control repository that moved under a multi-repository
  Land, submodule pointers reset after staging, and an apply that could not
  finish rolling back now emit the same decision envelope readiness recovery
  uses: a stop code, at least two honest options, a recommendation, and a
  preserved `pause`. The invariants are enforced in the runtime, not reviewed
  per call site, and every registered stop is pinned by
  `run-blocked-decision-tests.mjs`.
- **`agents release --force`** takes over a lease whose owner crashed. Readiness
  told the host to release stale leases, but a release required the original
  owner, so the only real option was waiting out the 45-minute expiry. A lease
  that has not expired also needs `--decision-ref`, because the worker holding
  it may still be running; the readiness recovery now names the exact command
  and the expiry.
- **`doctor --change <id>` reports unresolved apply transactions** before Land
  reaches them.

### Fixed

- **`PROVEN` now means the evidence ran.** The real-evidence requirements were
  gated on `adapter === "external"`, and the adapter came from
  `flags.adapter || config?.adapter`, so the caller chose whether to be
  checked: `evidence record <change> <provider> pass --adapter command` was
  accepted with no observation, no provenance and no artifact. Repeating it for
  each required provider produced a change that reported `PROVEN` and
  `LAND READY` having executed nothing. A receipt now records how it was
  produced — `execution: "harness"` is set only by a call site that actually
  ran a command, through an argument the command line cannot supply — and every
  hand-recorded receipt owes observation, provenance, and an artifact or a
  reference that resolves. `receiptValidity` re-checks the same floor on read
  rather than recomputing an expectation from the receipt's own fields.
- **A reference has to point somewhere.** `references[]` was never validated,
  so `--reference "trust me bro"` satisfied a passing external receipt. It must
  now be a URI or a path that exists.
- **Archive re-projects work done after an earlier failed archive.** Once a
  sandbox had been applied, archive skipped re-projection, so a fix made after
  a failed archive was proven, passed `land check`, and archived as success
  while the target kept the *first* projection — then the sandbox and its
  transaction backups were deleted, making the proven fix unrecoverable.
- **Work committed inside a sandbox lands.** The worktree projection was built
  from `git diff HEAD`, so committed changes were dropped while proof — which
  hashes the sandbox index — still counted them; a partial land was reported as
  success. The projection is now taken from the recorded base.
- **A recovered archive re-checks the Land guards.** If `openspec archive`
  moved the change directory and then failed, recovery declared the change
  archived before `landCheck` ran, skipping dropped-scenario, proof-freshness,
  receipt-validity, projection and pending-task checks — and committed
  `archived` plus sandbox deletion before auditing the proof, leaving a change
  every command refused with no exit. Recovery now verifies what remains
  checkable before writing anything, and refuses a projection that never ran.
- **Abandoning a change removes its sandbox.** Cleanup read a field only a
  successful apply writes, so every never-applied sandbox was reported
  `not-needed` and left on disk while the abandon record claimed a clean exit.
- **A zero-byte lease no longer deadlocks a resource permanently.** A
  descriptor created but not written could never expire and never match an
  ownership check, so `workspace:root` could become unleasable for every change
  with no command able to release it.
- **The dashboard survives unauthenticated malformed requests.** `GET //` threw
  inside the request listener with no handler above it and no
  `uncaughtException` handler in the file; with the restart policy retrying ten
  times, eleven requests turned a crash into a permanent outage. A `null` JSON
  body did the same through `/api/heartbeat` and `/api/profile`.
- **Host usage is attributed to this project.** The Claude transcript was
  resolved from the environment with no project check, so a sibling agent
  working in a different repository had its requests and cache reads counted
  against this project's change, and its cost.
- **Leaked services stop handing the next run a green suite.** A failed proof
  left its server holding the port — `die()` is `process.exit`, which runs no
  `finally` — and the readiness loop polls before it sleeps, so the next
  change's suite passed against the previous run's process. Readiness is probed
  before a service starts, sessions are reclaimed on failure and on signals,
  and the built-in static server binds its identity to the proof run.
- Secret-guard bypasses (`VAR=value` command prefixes, repo-wide content
  searches for credential-shaped patterns), phase-guard gaps (`git rm`,
  `cherry-pick`, `revert`, `stash`, `am`, in-place `sed`), unquoted hook paths
  that failed open on any project path containing a space, and an installer
  that deleted a user's own `.claude/hooks/tests/`.
- Playwright claims credited to skipped tests, declared readiness enforced only
  for Playwright, stale reports satisfying the discovery floor, review history
  wrongly reported corrupt after migration, `--help` refused for 12 registered
  commands, and unknown token counts recorded as a measured zero.

### Changed

- **BREAKING — provider protocol is 7.** Receipts recorded by earlier versions
  read as `provider-version-stale` and must be re-proven. This is the cost of
  the evidence floor above: an old receipt cannot say whether it was executed
  or asserted, so it cannot be trusted to have been executed.
- **BREAKING — a passing receipt cannot be hand-recorded for a provider the
  harness executes.** `evidence record` refuses `--adapter command`,
  `--adapter test-discovery`, `--adapter playwright` and `--adapter
  contract-digest`, and refuses any passing receipt for a provider configured
  with one of them. Run `proof run <change>` so the declared command is what
  executes. `evidence run` likewise refuses a provider that declares its own
  command, rather than letting an ad-hoc command stand in for it.
- **A declared readiness probe that was not observed fails every adapter**, not
  only Playwright. A provider that declared readiness and did not observe it
  previously passed while its own `observed` string said `readiness
  not-observed`.
- `sandbox apply`, `change resolve` and `migrate` reject unknown flags. Loose
  parsing let `sandbox apply --controlPlane` defeat the multi-repository guard,
  silently dropped a misspelled `--acceptance-*` flag, and let `migrate
  --apply <legacy-id>` swallow the id and migrate every legacy run.
- `/api/health` returns liveness only; headcount, version and storage mode are
  no longer exposed unauthenticated.
- Security triggers match whole words. `access` matched "accessibility" and
  `migration` matched "migration guide", forcing external review on routine
  work, while "sign in with a passkey" matched nothing.
- An unresolved apply transaction stops the next apply instead of being
  skipped. A journal left in `rolling-back` or `manual-recovery` was ignored on
  retry, so the next apply opened a fresh transaction over a working tree
  Foundation had already failed to restore, and reported success. The recorded
  recovery options — which the rollback had been writing into the journal and
  nothing ever displayed — are now what the stop shows. Projects carrying such a
  journal from an earlier version will see this stop on their next Land;
  `doctor` reports it first, and `change abandon` is the exit if the change is
  not worth resuming.
- **Staging root pointers that already hold the landed commit is a no-op.** It
  previously invalidated the proof unconditionally, so anything that reset the
  control repository's index sent Land back to Prove and straight into Land
  again. Re-staging the same pointers a second time now stops with options
  rather than restarting the cycle.
- **`changes` names a next command for every reachable status**, instead of
  falling back to `doctor --change` for applied and landing changes, and
  survives one unreadable runtime state file instead of failing the whole
  listing. `change abandon` works when that state is missing or corrupt — it is
  the designed exit from a change that cannot proceed, and was itself gated on
  the state being readable.
- **A silent schema upgrade instantiates the artifacts it now requires.**
  Resolving impact, coupling, security or acceptance could move a change from
  `foundation-rapid` to `foundation-standard`, after which `validate` refused it
  for missing `design.md` and `specs/**` — the only next command `changes`
  offered. `resolve` now prints the schema it settled on and adds the files.
- **Cross-repository contract evidence is checked, not asserted.** The
  `cross-repo-contract` capability had no verifier: it forced a claim to declare
  it and a provider to exist, then accepted a free-text receipt. The new
  `contract-digest` adapter hashes one declared artifact in every participating
  repository and passes only when the bytes agree.
- **Review scoped to a repository is no longer voided by an edit elsewhere.**
  Authority bound every verdict to the composite hash, so on a wide change each
  repository touched invalidated the reviews already earned.
- `land record --ci pass` remains the operator's word for it, but
  `--ci-attestation <signed.json>` now accepts the Ed25519-signed CI envelope
  the harness already knew how to verify, and `--ci-required` refuses the
  unsigned assertion. A non-submodule child's binding is reported as
  runtime-state-only, because nothing versioned in the root records it.
- Default proof resources are repository-qualified, so two repositories' suites
  no longer serialize against each other; genuinely shared resources must be
  declared.
- Runtime API is **14**; `runtime/version.mjs` now declares the same number and
  is checked at load, so a mixed-revision install fails immediately instead of
  partway through Land.

## [3.2.3] - 2026-08-05

### Added

- **A renamed scenario is refused before Land** — `validate` and the Land
  readiness check now reject a change whose `## MODIFIED Requirements` block
  stops naming a scenario the current spec still declares. OpenSpec reads a
  MODIFIED block as the complete scenario list, so a rename archives as a
  deletion. `openspec validate --strict` does not catch it, and `openspec
  archive` only reports it once the code has already been projected into the
  target — which is how one renamed scenario turned into a half-landed change.
  There is deliberately no bypass flag: OpenSpec enforces the same rule at
  archive time, so skipping the check would only move the same failure past the
  point of no return. The accepted form is to rename the requirement as well —
  the old name under `## REMOVED Requirements`, the new name under
  `## ADDED Requirements` with its full scenario list.

### Changed

- **Operation telemetry is opt-out** — `operations.jsonl` is now recorded unless
  `FOUNDATION_TELEMETRY=0`. It was opt-in and only `cli.sh` ever set it, so
  invoking the runtime directly recorded nothing and `metrics` reported
  `wallTimeMs`, `activeTimeMs`, and the rework counters as null or zero for runs
  that really took many minutes and retried several times. Self-measurement no
  longer depends on being launched through the shell wrapper.
- **A refusal is a lifecycle stop, not a failure** — `die()` exits non-zero for
  every guard refusal, and those were recorded as `failed`. Recording telemetry
  by default would therefore have buried real breakage under the guards that are
  working as designed, so a refusal is now recorded as `blocked` and
  `rework.unexpectedFailures` keeps its meaning.

### Fixed

- **`sandbox apply` rolls forward instead of resuming a stale transaction** — an
  applied change whose sandbox had moved on could never be projected again:
  apply short-circuited on `workspace.applied`, and `--refresh` failed as soon
  as the target and the sandbox diverged, so a change edited after Land began
  had no supported way out. Apply now rebuilds the desired projection from the
  current sandbox and compares it with the recorded one — an unchanged sandbox
  still resumes, a moved sandbox opens a new transaction. The virgin-target
  conflict guards cannot run on that path, because after a first apply the
  target legitimately differs from the baseline; divergence is caught instead by
  matching each entry's `before` against what the previous transaction actually
  projected, which is the stricter check.

## [3.2.2] - 2026-08-05

### Fixed

- **`workflow-tests` is green on Linux again** — two suites had been red on every
  `main` run since 2026-08-04 while passing on macOS, so no developer machine
  ever showed them.
  - **`dashboard contracts`** — `dashboard/client.sh` probed file times with
    `stat -f %m … || stat -c %Y …`. GNU's `-f` is *display filesystem status*,
    not BSD's format flag, so on Linux the first arm stats a nonexistent file
    named `%m` (non-zero exit) while still printing a filesystem block for the
    real path; the fallback then appended the true mtime. Every timestamp became
    `Inodes: Total: … Blocks: … <epoch>`, which is exactly the garbage the CI
    assertion dump showed. Both call sites now probe the flavor once and commit
    to it, and the birth-time fallback also treats GNU's `-` as unknown.
  - **`feedback isolation`** — the host-control-socket scan reads absolute paths,
    and a GitHub runner has Docker installed, so `/var/run/docker.sock` is a
    genuinely writable control socket. `safeForUnattended` is
    `attestation.valid && hazards.length === 0`, so a valid attestation could
    never authorize unattended work there — correct fail-closed behavior that
    the suite had no way to isolate itself from. Those probes now re-root under
    `FOUNDATION_TEST_HOST_ROOT`, gated on `FOUNDATION_TESTING=1` exactly as the
    trust root already is; production keeps the real absolute paths.
- **A failing unattended inspection no longer kills the suite silently** — the
  assertion lived in a bare `$(…)` under `set -eu`, so a non-zero exit aborted
  the run with no `FAIL` line and no captured stderr, which is why CI reported
  only `✗ feedback isolation` with nothing to act on. It now reports and prints
  the command output.
- **The packaged-CLI contract check asserts the vocabulary the CLI actually
  publishes** — it grepped `cli.sh help` for `proof plan` and `runtime new`,
  legacy names that still resolve but were deliberately dropped from help, and
  which `run-context-budget-tests.sh` fails any slash command for using. The
  step therefore contradicted the suite it runs beside. It broke when help moved
  to the canonical surface and stayed invisible because the test-harness step
  ahead of it was already failing the job. Now checks `change new`, `proof run`,
  and `land check`.
- **Re-rooting is covered by a positive control** — a mistyped fixture path would
  relocate the hazard scan into nothing and silently turn the unattended
  assertions into a rubber stamp, so a planted writable control socket must
  still deny unattended work and name itself in the refusal.

## [3.2.1] - 2026-08-05

### Changed

- **`brainstorming` now specifies *how* to ask, not just *what* to ask** — the
  single "ask only material questions" step splits into two: (4) facts the
  specs, code, LSP, or sandbox can settle are the agent's to resolve and are
  never put to the user, and (5) questions are asked in rounds of
  already-unblocked decisions, each carrying a `(Recommended)` answer, with the
  round recomputed from the replies. The material-change filter survives inside
  step 5, so this changes question *shape* without licensing an exhaustive
  interrogation. Rounds and recommendations are expressed through the existing
  `AskUserQuestion` seam (multi-question calls, stable headers, recommended
  first option), so the `interview/` replay bank keeps matching by header.
  `/investigate` is untouched. Technique adapted from the `grilling` skill in
  [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) — its
  frontier-rounds model, per-question recommendation, and facts-are-your-job
  rule; its literal `❓`/`➡️` transcript format was deliberately not adopted.
  Three deterministic pins added in the context-budget suite.

## [3.2.0] - 2026-08-05

### Added

- **A self-describing command surface** — every command answers `--help` before
  its arguments are validated, so a command invoked without its required
  arguments explains itself instead of refusing. `describe [command] [--json]`
  reads back the command registry, and `describe` also names where the
  machine-readable file shapes live. Rejected flags now list the flags the
  command does support.
- **`authority status --template`** — emits the response file for an open
  request with the request, change, type, and workspace identity already bound,
  and the criteria under review prefilled. These are exactly the fields the
  response validator matches, so a responder no longer discovers the shape one
  rejection at a time.
- **Per-phase usage in `metrics`** — `phases` now carries requests, output,
  cache-write and cache-read tokens, and `context.carryover` reports what each
  phase inherited across a boundary that did not reset. Metrics output moves to
  version 4.

### Changed

- **Budget measures new work, not context re-read** — spend is input, output,
  and cache writes; cache reads are reported separately and never counted.
  Counting them made measured usage grow with session length rather than with
  work done, so a long session could read as many multiples over target while
  nothing was ever blocked. Budget state moves to version 3; version 2 totals
  are recomputed from retained events rather than carried forward under changed
  semantics.
- **A phase boundary is a context boundary** — Prove and Land start from their
  packet in a fresh context. A packet that is not sufficient on its own is a
  packet defect, not a reason to retain the prior phase's context.
- **Requirements and warnings name their cause** — an inferred capability
  reports the path that triggered it, and an unmatched scenario reports its
  normalized form and the matching rule instead of only that it did not match.
- **Missing evidence is reported all at once** — external and acceptance
  receipts list every missing requirement in one refusal, naming each field
  both as a flag and by its location in the response file. Authority response
  validation likewise reports every mismatched field together.

### Fixed

- **Importing host telemetry no longer resets the active budget window** —
  imported rows without their own run identity fell back to the change id,
  which did not match the active window and silently opened a new one,
  discarding its targets. This only occurred when a real session identity was
  present, so budget enforcement was effectively disabled in exactly the
  environment it is meant to run in.
- **`metrics` no longer writes to an archived change** — reading a landed run
  back appended the current session's telemetry to its finished evidence.

## [3.1.8] - 2026-08-04

### Added

- **Versioned instruction provenance** — plans, packets, proofs, and host
  telemetry now carry content-addressed instruction manifests without storing
  prompt text. A validated host-execution envelope records requested and actual
  models, attempts, usage, fallback reasons, and failure classes through
  `telemetry host-import`.
- **Current-runtime dashboard projection** — `dashboard snapshot --json`
  exposes a bounded, read-only `.foundation` view for team telemetry while the
  client retains an isolated `.workflow` fallback for older installations.
- **Harness reliability contracts** — deterministic prompt/skill regression
  gates, an audit-first phase mutation guard, and an opt-in bounded retry
  primitive cover instruction integrity, unsafe phase writes, and explicitly
  idempotent infrastructure failures.

### Changed

- **Observable model execution** — metrics distinguish actual host attempts,
  fallback outcomes, and instruction revisions; missing usage remains unknown
  instead of being fabricated as zero. Dashboard heartbeats also report their
  source schema and Foundation version.
- **Protocol bundle 2.7** — the runtime advances to 2.7.0 / API 13, packet
  schema 5, agent-plan schema 3, and review-packet schema 3 for additive
  instruction provenance and host execution metadata.

### Security

- **Phase-aware mutation auditing** — Edit, Write, Notebook, and mutating Bash
  activity is checked against Change, Build, Prove, and Land boundaries. The
  rollout defaults to audit mode and can move to blocking only after the host
  supplies explicit phase/workspace context and false positives are reviewed.

## [3.1.7] - 2026-08-04

### Changed

- **Human-first decision UX** — agent and orchestrator contracts now require
  user-facing questions in natural language, translate machine envelopes and
  statuses before presenting them, and offer honest choices to approve, reject,
  pause, or report an inconclusive result without exposing harness syntax.
- **Explicit acceptance and release authority** — Standard changes preserve
  acceptance as undecided until a person responds, acceptance packets include
  the intent, criteria, changed surface, decisions, and automated evidence a
  reviewer needs, and budget continuation and Land recording bind the resulting
  action to an auditable human decision reference. The expanded contract
  advances the bundled runtime to API 12.

### Fixed

- **External evidence recovery no longer asks users to operate the harness** —
  proof readiness returns a structured user decision instead of raw commands,
  generated evidence placeholders, or instructions that could manufacture a
  passing receipt; review and acceptance requests remain routed through their
  real authority workflows.
- **Recovery prompts stay actionable and reversible** — interrupted Land
  operations describe plain-language inspect, keep-current, restore-backup, and
  pause choices, while validation blocks unresolved required acceptance instead
  of silently treating it as approved.
- **UX contract regression coverage** — human-interaction, interview, installer,
  agent-contract, and current OpenSpec documentation checks now run in the main
  suite and reject leaked status tokens, hashes, receipt syntax, placeholders,
  and decision flags in user-facing guidance.

## [3.1.6] - 2026-08-04

### Added

- **Evidence provider bootstrap** — `evidence detect` inspects project-owned
  manifests without executing scripts, `evidence init` previews or explicitly
  writes high-confidence `execution.yaml` wiring, and `evidence doctor` explains
  configured, detectable, ambiguous, and external-authority gaps. Existing
  providers are preserved and detection never installs dependencies or creates
  passing receipts.
- **Traceability audit** — `change audit` verifies scenario, claim, task, and
  provider links, including security negative paths and migration safeguards.
- **Trusted host attestation** — unattended sandbox creation now uses a
  short-lived Ed25519 challenge, system trust roots, exact permission binding,
  hazard detection, and single-use nonce consumption.
- **External authority and signed CI** — resumable review/acceptance requests
  and signed CI envelopes bind external evidence to the current workspace and
  pass through the existing receipt validators.
- **Portable telemetry and trust runtime** — Cursor and OpenTelemetry GenAI/LLM
  formats normalize into common usage events, while canonical signature logic
  moves into a reusable runtime module. Traceability, telemetry normalization,
  host attestation, evidence bootstrap/results, signed CI, external authority,
  CLI flag parsing, budget policy, and managed process/service execution are
  also separated into focused runtime modules. Agent planning, repository
  topology, CLI routing, provider scheduling, review validation, sandbox
  lifecycle, atomic Land journaling, and proof finalization/audit now have
  explicit subsystem boundaries while `foundation.mjs` remains the compatible
  lifecycle orchestration entrypoint. The expanded protocol bundle advances the
  bundled runtime to 2.6.0 / API 11.

### Changed

- **Domain-organized harness runtime** — runtime modules now live under
  `core`, `evidence`, `workflow`, and `observability` boundaries. Read-only
  metrics aggregation is separated from telemetry ingestion; state/snapshot,
  evidence contract, provider execution, change validation, packet, authority,
  Land/Apply, and diagnostics each have explicit factories. The compatible
  `foundation.mjs` composition root is reduced from roughly 7,000 to about
  1,500 lines without changing the public CLI.

## [3.1.5] - 2026-08-04

### Added

- **Bounded AI command surface** — a project-owned command registry classifies
  canonical workflow, conditional recovery, host, administration, and internal
  routes. Default help now shows only the 15 normal and 6 conditional AI
  operations; `help --all` retains diagnostics and compatibility visibility.
- **Canonical Change namespace** — `change new|start|resolve|validate` replaces
  raw runtime vocabulary in slash commands and normal agent guidance.
- **Run-scoped budget recovery** — packets and metrics distinguish lifetime
  usage from the current run and declare completion-only allowed/forbidden work.
  A single policy-gated `budget continue` command opens one audited completion
  window when required model work remains. The added command surface advances
  the bundled runtime to 2.4.0 / API 9.

### Changed

- **Proof and task routing are summary-first** — normal Proof exposes only
  readiness, collect, and run; released aliases remain callable with warnings.
  Task dispatch now uses `packet --task`, independent review is a Prove-owned
  activity, and disposable comparison is `/investigate --compare`.
- **Low-level operations leave the AI catalog** — telemetry, leases, raw
  provider execution, sandbox apply, proof internals, Land planning/pointers,
  dashboard, and migration remain available to their host/admin/internal
  callers without becoming model choices.
- **Budget exhaustion preserves completion paths** — at 85% autonomous work
  enters completion-only mode; at 100% the harness recommends split/rescope.
  Focused fixes and required proof remain available, while speculative scope,
  optional refactors, and new subagents stop.

### Fixed

- **Explicit telemetry no longer hard-locks a change** — recording the request
  that crosses a budget persists the decision and returns success instead of
  exiting after the model cost has already occurred. Deterministic lifecycle
  recovery therefore has the same non-blocking semantics for explicit events,
  Claude transcripts, and imported host telemetry.
- **Typed budget eligibility** — readiness now separates model-fixable work,
  active leases, external authority, infrastructure failures, and deterministic
  execution. Legacy `operator-required` windows remain recoverable, while
  `metrics` stays read-only and missing artifacts return audited blockers.

## [3.1.4] - 2026-08-04

### Fixed

- **Atomic start after schema escalation** — `runtime start` now re-materializes
  a draft when intent classification upgrades it from Rapid to Standard, so the
  required design and spec artifacts exist before validation begins.

## [3.1.3] - 2026-08-03

### Fixed

- **Packaged version identity** — Homebrew installs nested under its own Git
  worktree no longer inherit Homebrew's tag as a false Foundation source-build
  suffix; source identity is appended only when `cli.sh` is at that checkout's
  repository root.

## [3.1.2] - 2026-08-03

### Added

- **Atomic start and proof resume** — a validated `runtime start` draft can
  create an isolated Rapid build in one operation, while `proof run` performs
  readiness, provider execution, receipt reuse, finalization, and audit without
  requiring a phase orchestrator.
- **Structured blocker recovery** — every typed readiness failure now carries
  an actionable next step: resume pending Build tasks, diagnose/revise invalid
  configuration, repair or replace unavailable providers, or record verifiable
  external evidence without weakening claim coverage.

### Fixed

- **Budget-safe lifecycle recovery** — host telemetry still records and warns
  on `STOP_AND_SPLIT`, but an exhausted model budget no longer exits before
  deterministic packet, readiness, evidence, proof-resume, metrics, or archive
  commands can reuse completed work.
- **Orphan runtime dead ends** — `changes` exposes non-archived runtime state
  whose active OpenSpec directory disappeared, and `doctor` reports explicit,
  recoverable restore-or-quarantine guidance instead of failing later with a
  missing-file error.
- **Stable CLI compatibility and release identity** — `proof run` remains the
  canonical recovery command supported by stable 3.1.1, new CLI help exposes
  readiness and the `proof finish` alias, and source checkouts display their
  post-tag build identity instead of masquerading as the tagged binary.
- **Release and CI reliability** — atomic draft validation fails closed on
  malformed risk inputs, installer routing covers resumable proof commands, and
  dashboard tests run only on their supported Node versions.

## [3.1.1] - 2026-08-03

### Fixed

- **Homebrew `init` packaging** — ship the required `foundation.json` source
  manifest in `libexec`, and exercise a real initialized project in the formula
  test so incomplete bottles fail before release.

## [3.1.0] - 2026-08-03

### Added

- **Trigger-only feedback harness** — optional disposable prototypes hand off an
  explicit selection to Change, independent review uses a ≤8 KiB fresh-context
  packet, and explicitly scoped human acceptance remains external to the
  deterministic runtime.
- **Attributable review protocol v2** — structured reviewer/implementation
  provenance, risk-scaled diversity, committed-plus-dirty repository surfaces,
  and a change-level hash-chained attempt history make the two-AI review limit
  auditable without adding work to ordinary Rapid or Standard changes.

### Fixed

- **Fail-closed unattended preflight** — malformed, valued, or duplicate
  unattended flags cannot fall back to interactive execution, blocked commands
  cannot mutate telemetry or workspace state, and isolation inspection launches
  no PATH-resolved subprocess.
- **Proof-origin and receipt integrity** — prototype paths, file URIs, traversal,
  symlink origins, and post-write receipt tampering cannot satisfy evidence;
  review payloads and human acceptance fields are fully rebound and revalidated.
- **Committed review blind spots** — review, policy, ordinary packets, and Prove
  share one NUL-safe repository surface from the recorded base and fail closed
  when the base or attempt history is missing or corrupt.

### Performance

- **Zero-cost untriggered lane** — redundant Git discovery was removed after a
  30-run A/B exposed an 11.2% packet regression; the hardened build packet then
  measured 7.1% faster at median with no added model requests or agent spawns.

## [3.0.0] - 2026-08-02

### Added

- **Bounded agent contracts** — compact JSON now measures the exact emitted
  bytes, packet schema 4 and plan schema 2 expose compatibility explicitly,
  large collections degrade to previews/digests, and task dispatch rejects
  claims outside repository or provider authority.
- **Resume-safe model routing** — completed dependencies remain satisfied,
  complete plans route to proof, and mixed work reports the deepest model tier
  required by the session.
- **Concurrent-safe context accounting** — plan and packet metrics use
  best-effort atomic events, tolerate legacy or malformed rows, and roll older
  events into a bounded summary without blocking agent handoff.
- **Upgrade-safe packet policy** — install migrates only the exact former
  64 KiB default to scoped 8/12/16 KiB limits, preserves custom numeric values
  with a doctor warning, and deep-merges partial scoped configuration.
- **Composable skill context** — hot backend skills are concise and the rules
  select one primary construction skill plus triggered security or
  observability guidance instead of loading every layer.
- **Faster, integrity-bound proof path** — typed `proof readiness` blockers and
  atomic `proof run` remove repeated orchestration; declared provider inputs
  permit safe scoped reuse, while external passes require inspectable
  observation, provenance, and durable evidence.
- **Native static proof service and structured change drafts** —
  `execution.yaml` can serve a workspace-relative static root with readiness
  identity, and `new --draft` materializes one validated agreement without a
  second task ledger.
- **Phase and rework accounting** — metrics separate active time from
  unattributed wait, record phase context/model recommendations, and expose
  receipt reuse and failed-operation counts without inventing human wait.
- **Enforced context budgets** — static orchestrator/rule/command word limits,
  ≤4 KiB summary-first agent plans, 8/12/16 KiB task/repository/global packets,
  artifact references, small-change single-agent routing, and context-byte
  telemetry keep brownfield plans bounded without hiding the persisted detail.
- **Multi-repository control plane** — committed topology and per-change
  repository scope drive composite snapshots, child worktrees, repository/task
  packets, scoped providers, changed-path authority, and cross-repository
  contract enforcement while single-repository changes remain compatible.
- **Risk-aware model and agent planning** — `agents plan` builds dependency and
  resource groups, routes portable fast/standard/deep tiers to
  Haiku/Sonnet/Opus defaults, reports active-change conflicts, preserves
  unaffected tasks across replans, and uses expiring atomic task leases.
- **Honest multi-remote Land saga** — `land plan`, `land record`,
  `land pointers`, and `land resume` bind explicit child commits and CI,
  transactionally stage verified gitlinks, require refreshed composite proof,
  and archive the control repository last without implying remote atomicity.
- **Repository-scoped provider instances** — repeated capabilities can use
  instance IDs such as `api-test` and `app-test`; commands, services, receipts,
  environment fingerprints, and invalidation are bound to their repository.
- **Model/repository/task cost attribution** — telemetry and metrics can report
  usage by model, repository, and task while unknown values remain unknown.
- **Preflight and honest operation telemetry** — `claude-foundation doctor`
  checks runtime, hooks, pinned OpenSpec archive support, legacy packaged tests,
  and opt-in branch policy; native operations record duration/status while
  unknown request, token, cache, and cost values remain `null`.
- **Measured change summary** — `claude-foundation metrics <change>` aggregates
  phase timing, unique provider executions, external request/token/cache/cost
  data, and orchestrator share without manufacturing missing values.
- **Compact execution handoff** — `claude-foundation packet <change>` gives
  Build and Prove the active paths, revision, claims, providers, tasks, hash,
  and budget without replaying the orchestrator transcript.
- **Executable evidence v2** — change contracts can configure project-owned
  command, combined test/discovery, Playwright, and external adapters while
  evidence v1 remains readable and has an explicit upgrade command.
- **Resource-aware proof execution** — `proof execute` reuses content-bound
  receipts, deduplicates identical commands, runs non-conflicting providers
  concurrently, writes structured artifacts, and finalizes proof in one
  operator action.
- **Project-owned Playwright integration** — structured JSON reports and claim
  annotations produce browser receipts using the honest
  `browser-automation` input mode without Foundation installing dependencies.
- **Native `claude-foundation` control surface** — project-aware provider,
  change, proof, evidence, sandbox, land, and migration namespaces now forward
  to the runtime installed in the current repository, including subdirectory
  discovery, explicit `--project`, runtime API guards, and typo-safe routing.
- **Production evidence provider catalog** — adds static analysis, data
  migration, accessibility, resilience, observability, deployment, and
  dependency/supply-chain contracts, plus a deterministic `providers` command
  for discovery without forcing every provider onto every change.
- **OpenSpec-native change loop** — replaces the fixed phase orchestrator with
  `/investigate → /change → /build → /prove → /land`; `/dev` remains a
  compatibility composition through proof.
- **Foundation standard and rapid OpenSpec schemas** — proposal, delta specs,
  load-bearing design, one task ledger, and claim-oriented `evidence.yaml`.
- **Deterministic harness runtime** — content hashing, provider receipts,
  discovery enforcement, stale-proof invalidation, semantic risk resolution,
  review triggers, watchdog events, migration candidates, Git worktree isolation,
  transactional apply checks, and OpenSpec-owned safe archive/spec sync.
- **Upgrade-safe installer migration** — preserves legacy `.workflow/` history
  and project-owned OpenSpec content while removing old lifecycle agents,
  phase commands, templates, hooks, hook wiring, and orchestration references.

### Fixed

- **Recoverable Land projection transaction** — copy sandboxes and Git
  worktrees now prepare touched-path backups and an apply journal before
  mutation, preserve unrelated target edits, verify only the proven projection,
  roll back partial writes, keep the sandbox as the proof subject through
  archive, and resume safely after an interrupted or failed OpenSpec archive.
- **Packaged CLI contract drift** — Formula, bottle, release, and deterministic
  workflow checks now require the public `proof plan`, `land check`, and
  `runtime new` surface so an installer-only binary cannot pass packaging tests.
- **Strict discovery report semantics** — regression coverage distinguishes
  numeric zero (measured failure) from `null`, arrays, booleans, empty strings,
  and numeric strings (inconclusive rather than JavaScript-coerced zero).
- **Content-bound proof over the complete change packet** — edits to the active
  proposal, design, tasks, delta specs, or evidence now invalidate receipts and
  proof; sandbox validation consistently reads its active packet.
- **Deny-by-default provider receipts** — executable providers require explicit
  claim scope, receipts cannot claim undeclared outcomes, protocol/fingerprint
  drift invalidates reuse, and browser foreground requirement is distinct from
  foreground availability.
- **Task and archive lifecycle semantics** — implementation tasks are never
  silently ignored because they mention `/prove`; lifecycle commands are no
  longer generated as tasks, isolated work must be applied before archive, and
  repeated archive/land checks return the archived state without resyncing.
- **Transactional landing** — `land archive` now applies a proven isolated
  workspace when needed before identity verification and OpenSpec archive, so
  the normal land path is one deterministic transaction.
- **Shipped self-tests** — obsolete phase-hook suites are removed from installs
  and replaced by tests for the hooks that are actually shipped.

### Removed

- **Phase control plane** — PM/lead/engineer/QA/retro lifecycle agents, fanout
  roles, duplicated task/state ledgers, phase references, artifact reconciliation,
  and phase-specific workflow templates are no longer shipped.

- **Multi-axis workload profiles** — `/dev` records workload profile, risk,
  ambiguity, evidence classes, implementation volume, and coupling separately from
  Size; profile-specific Opus-main turn budgets stop invisible runaway orchestration.
- **Evidence-bearing contracts** — new-run ACs declare structural, behavioral,
  rendered, integration, measured, security, or manual evidence. Contract lint
  checks evidence agreement and Full/Impacted command boundaries including cwd,
  environment/dependencies, and expected test groups/minimum discovery.
- **Foreground worker lifecycle** — ordinary phase workers with
  `run_in_background=true` are blocked unless the prompt explicitly authorizes a
  disjoint fanout. Structured returns include task/AC completion, files, commands,
  discovery counts, gaps, and context.
- **Rendered smoke independent of E2E** — rendered ACs run a cheap real-browser
  visibility/contrast/focus/viewport check while full journeys remain opt-in.
- **Profile-aware telemetry and pricing metadata** — state/dev-metrics/bench rows
  carry main-turn budgets and separated active/human/worker/reconcile timing;
  benchmark pricing metadata is versioned in `bench/config/pricing.json`.

- **`## Capabilities` — the ledger's behaviour half** — retro appends only Ship-Gate-passing AC evidence from `tests.md` as `<guarantee> — [<test path>] — [run-id]`, superseded in full. `feat`/`fix` may add or rewrite a guarantee; `refactor`/`chore`/`docs` may not touch the group. Its separate ~25-line budget cannot evict invariants.
- **`orchestrator/references/ledger-prune.sh`** — deterministic staleness prune: re-resolves every `path#anchor` in the ledger and drops only the facts it can **prove** dead (file gone, symbol renamed away), keeping headings, prose, directories, globs and anything unverifiable byte-identical. Spec drift is the standard failure of a spec library and the usual mitigation is human diligence; ours is a grep, at no model cost. Called from retro's fold. New `ledger` test suite, 15 assertions.
- **`fix` input-domain rule at S/M** — the teaching note that took acceptance from 5/6 to 6/6 at XS now also sits in `_templates/spec.md`'s `fix` block; the defect it catches (a ticket names one input, the bug lives one input over) is a property of `fix` at any size. Template notes are stripped on fill, so it stays free at runtime. **Unvalidated on a holdout** — see the caveat in `rationale.md`.
- **Doc-consistency check 13** — pins the behaviour half at all three ends: retro writes it type-aware and supersedes in full, `qa` reads it, and the prune ships.

### Changed

- Placeholder lint now treats TODO/TBD/FIXME/lorem as marker words, so product terms
  such as `todolist` no longer fail the Contract Gate.
- Test and Ship gates treat exit 0 with zero tests, missing declared groups, or
  discovery below the declared minimum as failure; actual evidence-level drift is
  blocking.
- Auth/profile/identity work routes to security-product review with ownership,
  revocation, negative-path, and PII/logging checks.

- **Three authoritative quality gates** — Contract Gate owns deterministic artifact/AC-set consistency plus human intent approval; Change Gate owns Impacted AC evidence and triggered semantic/security review; Ship Gate owns one Full + lint/type/static run per converged diff. Engineer no longer mutates spec acceptance checkboxes, Review consumes `tests.md` instead of rebuilding every AC row, and Retro reports from Ship-Gate-passing evidence.
- **Model-economic Implement routing** — main Opus retains interview, risk/size, gate, and acceptance judgment; repeated code generation routes once to the Sonnet-pinned `engineer` when execution volume fires (≥3 code tasks/files, a planned test-fix loop, or >~2K expected generation), even with a warm main context. XS/micro work and deterministic Test/Docs/Ship remain inline. Size=L alone no longer upgrades engineer to Opus; high-stakes overrides require `model_reason:<trigger>` and the spawn guard enforces it. S's fast ceiling is now ≤2 to accommodate one volume-routed Implement plus the previously measured Docs+Ship exception.
- **Context hot-path diet** — `/dev` is now a thin launcher, XS alone loads the compact fast-path reference, and S/M/L read their normal phase references directly. Resident orchestration rules no longer carry benchmark history or duplicated procedures; inline Design/Implement/Retro use compact local contracts instead of loading cold-worker prompts. The foundation's own always-loaded `CLAUDE.md` is reduced to a project map and shipping rules, Phase 2 guard detail loads by named section, the per-spawn state reminder is bounded and uses the `__now__` contract, and the cross-run context ledger now has line/byte limits. Deterministic doc tests pin these budgets and reject role-prompt pointers from inline templates.
- **Fast/standard/deep execution profiles** — XS/S target zero/one spawn, M ≤3, L ≤5. These are ceilings, not required worker counts. Fanout is never implied by size; `/dev --fast` makes the low-spawn intent explicit and security-triggered work still receives isolation.
- **M/L phase resolver** — size is now a spawn ceiling (M ≤3, L ≤5), not a routing table. Every phase defaults inline and records `exec_mode` + `exec_reason`; cold workers require independent judgment, a material context gap, tooling isolation, or proven parallel payoff. Warm M/L Design/Implement/Test, deterministic Docs/Ship, and Retro can all stay in main. L's former automatic `pm → lead → qa` chain is now proof-gated.
- **Agent capabilities aligned with the resolver** — `pm`/`lead`/`engineer`/`qa`/`retro` now accept bounded scopes and execution reasons, reuse context maps instead of re-walking the repo, and reject size-only cold spawns. Every `Agent` holder requires parent-supplied `fanout_authorized: true` plus a named proof and disjoint scopes; M/L review fanout now defaults off, while one independent runtime review remains available when justified.
- **One-batch Gate at every size** — M/L now presents its larger summary once but resolves approval, commit disposition, and deviations in the same interaction; revisions remain targeted and re-present only changed sections.
- **Cross-run test-command cache** — the repo ledger's `## Test infra` now retains validated Full/Impacted/lint-static commands with their owner anchor. Later runs skip package-script discovery until that owner is missing, changed, or rejects the command.
- **Edit-loop lint startup removed by default** — PostToolUse keeps only near-zero-startup deterministic checks such as `gofmt`; ESLint/Biome/Ruff/Stylelint/Prettier plus type/static analysis run once at Ship Gate. `CLAUDE_EDIT_LINT=1` restores per-edit file lint and `CLAUDE_EDIT_FULL_CHECKS=1` restores the complete legacy hook.
- **Delta-scoped re-review** — after a review fix, Lead receives prior blockers, changed-since-review hunks, and affected AC/task rows instead of re-reading the complete spec/plan/diff. Public contracts, shared invariants, security boundaries, and scope escapes force a full re-review.
- **Project-wide checks moved out of the edit hot loop** — `tsc`, `pyright`, and `golangci-lint` run once at Ship Gate instead of after every edited file; process-starting file linters are deferred too. Set `CLAUDE_EDIT_FULL_CHECKS=1` to restore the previous per-edit behavior.
- **Generated output cleanup** — coverage, test results, and nested `node_modules` are ignored consistently; the tracked todolist coverage summary was removed.
- **Boot goes out in one message** — `orchestrator.md > State discipline` told the orchestrator *not* to batch tool calls, on the grounds that headless `claude -p` doesn't run them concurrently. That is a rule tuned to the benchmark rather than to the host users actually run: interactive Claude Code does batch, and boot's reads (`INDEX.md`, `FOLLOWUPS.md`, `CONTEXT.md`, the repo-detection `find`) have no dependency on each other's content. Same calls, same tokens, fewer round-trips — a **wall-clock** lever, never a cost one, which is why no cost measurement to date could have surfaced it. Three hard exclusions: no speculative reads (choosing what to open before seeing anything is how you pay for files you didn't need), never batch a `state.json` write with the spawn it gates (`dev-agent-guard.sh` fires PreToolUse on the spawn and may not see the write), and expect nothing under headless. Economy of calls stays the primary lever.
- **The repo context ledger is now spent, not just written** — `.workflow/CONTEXT.md` has been written by every run's retro since 2.11.0 but was read by **one** consumer (brownfield M/L Context); `phase-1.md` sent greenfield / XS / S off to cold-walk instead. Now every run, every size, either field, reads it **once before the first grep or LSP call** of the current-state walk and walks only what it doesn't cover — the cross-run form of the lever that made inline-Design pay: don't re-derive what is already settled. Wired in `orchestrator.md > Size-aware execution` (rule), `orchestrator/references/xs-s-fast-path.md`, and `plan-writing > references/current-state.md > The LSP-walk technique` (step 0, the procedure). **Evidence, not authority** — spot-check load-bearing claims; code beats the ledger; absent ledger → walk as before. Extracted from OpenSpec (`docs/research/openspec.md`), whose spec library is read before every proposal and accrues per shipped change; its delta-spec artifact, archive-merge command and no-gate flow are deliberately not adopted. **Unmeasured** — the bench runs each task once in a fresh sandbox, so no run has a predecessor's ledger to read; rationale, downside bound and the two-run measurement plan are in `.claude/tests/bench/rationale.md`.
- **Ledger fold keeps what survives** — retro step 5b now groups lines under `## <area>` headings with a durable `## Test infra` group, replaces a superseded line **in full** rather than appending beside it, and prunes by **load-bearingness, not age** (oldest-first eviction dropped the stable invariants and kept the latest one-off gotcha). Cost-neutral: same write, better retention.

### Fixed

- **Dangling reference in a shipped file** — `orchestrator.md > State discipline` cited `references/fast-path-rationale.md`, which does not exist (that rationale moved to the bench when evidence was split from the rules). A resident pointer to a missing file costs a wasted read at runtime; the rule stands, the pointer is gone.

### Added

- **Two doc-consistency guards** — check 11 fails on any `references/*.md` a shipped file cites that exists nowhere under `.claude/**/references/` (check 10 only caught pointers into paths that never ship); check 12 pins the context ledger's writer **and** all four readers, so a later pass can't drop one end and leave the other paying for nothing.

## [2.12.0] - 2026-07-24

Warm-drafting, effort-by-size, and run telemetry for the `/dev` pipeline — cheaper cold path, right-sized thinking, measurable mechanism.

### Added

- **Warm Phase-1 drafting** — a new **execution-mode axis** (inline / fork / cold-spawn; canonical in `orchestrator/references/size-execution.md > Execution mode`, chosen once at size time by a cheap lookup). When substantial pre-work is resident this session (POC / extended spec discussion), Phase 1 drafts **warm** — the orchestrator `fork`s itself and writes the resolved artifact shape directly instead of cold-spawning `pm`/`lead` through a lossy digest. `dev-agent-guard.sh` now permits `fork` **only** in `phase-1-requirements` (reads `phase` from the active run's `state.json`, fails **closed** on unknown/unreadable phase); Phase 2+ `fork` stays blocked so sonnet-pinned execution workers never silently run opus. Hook test suite adds the phase-1 allow case.
- **Effort-by-size dial** — the main (opus 4.8) session's reasoning effort now scales with size (`size-execution.md > Effort by size`): **xhigh** for L or any security-triggered run, **high** for M (and whenever main is the requirement-verifier), **medium** for XS/S — xhigh on a 10-line change is pure think:output waste. Floor items (gate, per-line AC confirm, security-trigger check) never depend on the dial.
- **Run telemetry (speed benchmark)** — `state.json` gains `spawn_count` + `exec_mode`; the orchestrator bumps `spawn_count` on every `Agent` spawn (inline not counted) and records the per-phase mode at Design and Implement. New `orchestrator/references/dev-metrics.sh <run-dir>` prints the mechanism + timing row — mechanism metrics (spawn_count/exec_mode/size) are deterministic proof a change worked; wall-clock is noisy — and retro folds it into the report.
- **Scaffold-leftover lint** — `artifact-lint.sh` adds `scan_scaffold_leftover`: a filled artifact that still carries template teaching scaffolding (the "delete the rest" guidance footer / section notes) fails the lint — it's re-read 4–6× downstream, so leftover scaffolding is dead weight; backtick example lines stay exempt. `rules/fundamentals.md > Output discipline` gains the matching **strip-on-fill** rule.

### Changed

- **`pm` model opus → sonnet** — draft-cheap + verify-in-main: spec drafting from a good interview is template-filling, and the resident main session (opus, holding the full interview) runs the semantic requirement verify while plan/gate backstop downstream. Cold `pm` runs sonnet and is cold-spawned only at **L** / thin pre-work / `/spec`; substantial pre-work drafts Phase 1 warm instead (`model-tiers.md`, `INDEX.md`, `pm.md`).
- **Per-repo fanout gated** — surface (per-repo) review/security/test fanout now fires **only** when the run is M/L or the repos share a changed contract (coupling); a wide-but-shallow XS/S multi-repo sweep is reviewed in one inline pass. Repo count alone never triggers per-repo fanout — the same principle that keeps it out of M/L sizing.

## [2.11.0] - 2026-07-17

Fast-first, goal-driven overhaul of the `/dev` pipeline — five workstreams from `feedback-notes/improvement-plan.md`.

### Added

- **XS micro-lane** — a single `run.md` artifact (`_templates/run.md`) replaces spec/plan/tasks/test-plan at `size=XS` (lint + `--resume` + team-mode wired); interview **fast-lane** (digest answers every slot → one confirmation question) and a **one-batch gate** at XS/S; a gate-flipped review on a patch-lane run executes inline (no `lead` spawn).
- **Type-aware artifact shapes** — spec/plan/tasks templates carry per-Type contract blocks (`fix` → Reproduction & Expected, `refactor` → Equivalence contract, `chore` → Checklist, `docs` → Docs scope, `spike` → Questions & Timebox — each carrying its own `AC#`s); `artifact-lint.sh` validates the shape from `**Type**:` (chore/docs exempt from mermaid); canonical lookup table in `plan-writing > references/size-tiering.md > Artifact shape by Type`; the gate accepts **additive-only** shape deviations. Lint suite grows to 52 assertions.
- **Context ledger** — workers return `CONTEXT: path#anchor — fact` lines; the orchestrator (single writer) folds them into `context.md > ## Discovered`; retro folds still-true lines up to a repo-level `.workflow/CONTEXT.md` that seeds the next run's Context step; **truth hierarchy** (code > docs > ledger; post-Implement the diff wins) added to the always-on router.
- **Decision records** — retro appends architecture-level decisions to an append-only `docs/DECISIONS.md` (supersede by new row, never rewrite).
- **Docs freshness** — `init-project-docs` gains a **diff-scoped** third mode + `last-verified` frontmatter stamps; engineer docs mode syncs only the sections the run's diff touches and recommends a full update run on heavy drift.
- **SC measurement** — retro walks every `SC-###` (measured, or `unmeasurable at ship` → follow-up); new `## SC outcome` section in the retro template.
- **Dashboard: version display** — the server reads its version from `dashboard/package.json` (aligned with the foundation release) and surfaces it in `/api/health`, `/api/online`, and the sidebar footer (`vX.Y.Z`).

### Changed

- **Vision** — `WORKFLOW.md` declares **fast first** as the tie-breaker plus a never-cut floor (gate · security-trigger check · state writes/`--resume` · `fix` regression contract · per-line AC confirm); the Conduct digest mirrors both.
- **Spawn briefs** — every brief opens with a Goal line (run Goal + AC ids) and attaches the context ledger when present.
- **Models** — `engineer` escalates to opus at `Size=L` / security paths; `team-type-design-analyzer` haiku → sonnet.
- **Type rules single-sourced** — canonical in the type matrix; `lead`/`engineer` keep pointers; `lead` adds an adversarial pass at L review.
- **Leaner agent bodies** — duplicated context-usage/task-format detail moved to references; the ledger contract is one line per agent; orchestrator ledger-fold mechanics live in `references/state-edge-cases.md`.

## [2.10.0] - 2026-07-17

### Added

- **Dashboard: run ownership** — the orchestrator now writes `owner`/`owner_email` (git identity, `never guess`) into `state.json` at run creation (template gains both fields); `client.sh` reports them per run (+ `size` and a normalized `repoId`, with a first-commit-author fallback for older runs) and the server attributes each run to its **owner, never the reporter** — a teammate pulling your committed `.workflow/` dir can't show up as having run it. Runs dedupe by `repoId|runId` across clones and worktrees.
- **Dashboard: profiles + multi-select teammate filter** — new `POST /api/profile` + `profiles` table (org, team tags, optional chart color per person) edited via a **My profile** modal; the per-teammate filter is now multi-select with one-click org / `#team` group chips; every person gets a stable color (hashed palette or their chosen one) used consistently across chips, charts, and tables.
- **Dashboard: Workload panel** (Insights) — per-person effort points from size-weighted completed runs (XS=1 S=2 M=5 L=8, unknown→S) plus commits/lines, each compared against the previous equal-length window; `/api/history` now returns per-person daily `work[]` (MAX-merged across machines) so the comparison reaches beyond the live 14-day window. Activity rows now show the run's size tier.
- **Dashboard: `presence_hourly` aggregate** — the Presence heatmap reads a compact per-hour-minutes table (backfilled from the raw beat log during migration) instead of scanning raw heartbeats; the raw log is debug-only and `HEARTBEAT_LOG_DAYS` drops 30 → 7. SQLite schema migrates v2 → v3 in place.

### Changed

- **Dashboard client scan coverage (`client.sh` 1.8.0 → 1.10.0)** — all `git log` scans use `--branches` (commits on any local branch count, deduped by hash); linked **worktrees** (`.git` as a file) are scanned; **clean** repos with a commit in the last 14 days still report commits/work/pushes/follow-ups (side cap `CLEAN_REPO_CAP` 10) instead of vanishing once you commit; repo-level stats are reported by only the first root per `repoId` so extra worktrees/clones never double-count; heartbeats now carry `gitEmail`.
- **Dashboard defaults & load** — heartbeat `--interval` 15 → 30 s (new env `CLAUDE_FOUNDATION_DASHBOARD_INTERVAL`); `ONLINE_TTL_MS` 30000 → 75000 (2.5× the beat, so one dropped beat doesn't flicker); `/api/online` payload memoized for `ONLINE_CACHE_MS` (default 2000 ms) and shared across all viewers; new `HISTORY_DAYS` (default 400) prunes the date-keyed history tables that previously grew forever; browser polling pauses on hidden tabs; `/api/history` fetch window scales with the selected date range (2×, 120–365 d). README documents the new **ownership matrix** and honor-system-identity limitation.

## [2.9.2] - 2026-07-16

### Changed (skill-load diet — fewer tokens per task, same rules)

- **Conduct digest in the always-on router** — `rules/fundamentals.md` now carries the 4-principle core of `coding-discipline` (think-before-coding · Simplicity/Ponytail · surgical changes · goal-driven); the full body loads **on friction only** instead of on every code task (~1,300 words saved per ordinary coding task). `Ponytail` heading and anchor unchanged.
- **Body diet on the 10 SKILL.md files over the ~1,200-word page cap** — all now ≤1,150 words: `programming-fundamentals` 1701→983, `api-design-fundamentals` 1399→1145, `plan-writing` 1394→1150, `ui-ux-pro-max` 1362→1024, `init-project-docs` 1331→1141, `hexagonal-backend` 1286→1149, `brainstorming` 1282→1148, `testing-fundamentals` 1270→1148, `coding-discipline` 1267→1022, `refactoring-fundamentals` 1255→1113. Move-don't-delete: every cut detail lives verbatim in that skill's `references/` (new: `programming-fundamentals/references/details.md`, `api-design-fundamentals/references/auth-and-limits.md`, `coding-discipline/references/details.md`); frontmatter descriptions byte-identical (triggers unchanged); externally-referenced section headings preserved (`coding-discipline > Simplicity First`, `plan-writing > Parallelizable phases` / `Section gating by Size` / principle 8).
- Net effect: a typical code task's skill-text overhead drops ~3,200 → ~900 words; any skill body that does load is 10–40% lighter.

## [2.9.1] - 2026-07-16

### Changed

- **Orchestrator ops collapsed 22 → 9** (Setup · Interview · Design · Gate · Implement · Test · Review+Security · Ship · Close) — setup 0–5 folded into one op, Phase-1 spec/context/plan/test-plan into one size-routed Design op, review+security and final-gate/docs/ship and retro/skills/done each into one op with lettered sub-steps. Pure renumbering + prose consolidation: `state.json` step vocabulary, phase names, the type matrix, and all v2.9.0 behaviour are unchanged (in-flight runs `--resume` fine). Cross-file references swept to phase names per the file's own local-counter rule; fixed pre-existing stale ones (`brainstorming` pointed at old step numbers).

## [2.9.0] - 2026-07-16

### Changed (wall-clock pass — fewer sequential spawns, same guarantees)

- **Combined `lead` fast path extended to M** — an M run gets one opus `lead` combined spawn (spec + plan + tasks + test-plan) instead of `pm` + `lead` + `qa` test-plan; brownfield M builds `context.md` before the combined spawn, seeded from the requirements digest. `pm` and the `qa` test-plan spawn are now L-only in one-shot `/dev`; `/spec` and `/test-plan` team-mode commands are unchanged.
- **Security folded into the Review spawn** — the trigger scan (name-only, never skippable) runs before Review; a fired trigger extends the same `lead` spawn with security mode (opus, one spawn, two artifacts). Standalone security spawn remains for user-requested audits and gate-skipped Review. Blocking semantics and cycle accounting unchanged.
- **Test runs inline at XS/S** (`e2e_visual=off`) — the engineer implements the planned `test-plan.md` rows alongside the tasks; the orchestrator runs the Impacted command and writes `tests.md` itself. `qa` execute spawns at M/L or `e2e_visual=on`.
- **Docs+ship merged through M** (one `engineer` spawn; L keeps two) and **retro inline through S** (light spawn at M, full at L).
- **Size picker calibrated** — S widened to ~5 files on one understood surface; the machinery estimate tie-breaks borderline XS/S and S/M to the smaller tier when no hard risk flag is present (`SIZE_UPGRADE` ratchets up mid-run); borderline M/L stays L. Plan-section `Size` keeps the conservative round-up.
- Net effect: a typical M run drops from ~10–11 sequential sub-agent spawns to ~6; the never-shrinks set (interview, gate + per-line AC confirm, state discipline, security-trigger check, type matrix) is untouched.

## [2.8.1] - 2026-07-16

### Changed (token/speed pass — zero behavior change)

- **Twelve more skill bodies slimmed to ≤ ~1.3k words each** (total ~34.9k → ~13.1k): `brainstorming` 4.1k→1.3k, `plan-writing` 3.1k→1.4k, `architecture-fundamentals` 3.3k→1.0k, `observability-fundamentals` 3.3k→1.2k, `testing-fundamentals` 3.2k→1.3k, `database-fundamentals` 3.1k→0.8k, `refactoring-fundamentals` 2.9k→1.3k, `concurrency-fundamentals` 2.9k→0.7k, `tailwind-design-system` 2.4k→0.6k, `init-project-docs` 2.3k→1.3k, `qa-handoff-note` 2.1k→1.0k, `hexagonal-backend` 2.0k→1.3k. Same discipline as 2.8.0: elaboration moved verbatim into references/ (two-directional line verification per skill), frontmatter byte-identical (triggering unchanged), every principle/step still named in the body as a complete checklist, all cross-file `skill > section` anchors verified resolving (13/13 for plan-writing incl. the canonical `size-tiering.md > Greenfield vs brownfield`). A triggered load now costs roughly a third of the tokens; `brainstorming` + `plan-writing` sit on the /dev interview/plan critical path.
- **`WORKFLOW.md` deduplicated against the canonical references** (4,347 → 3,314 words): agent-map tool columns → `INDEX.md`; team-mode walkthrough → commands + `team-mode-sharding.md`; fanout/sub-agent bullets → `fanout-dispatch.md`; gate-lever lists → `gate.md`; size-tier prose → `size-execution.md`. All 24 headings byte-identical (every `WORKFLOW.md > <section>` anchor resolves); the mermaid flow, type matrix, artifacts table, and every fact with no other canonical home stay.

## [2.8.0] - 2026-07-15

### Changed (complexity-cut release — less for the model to hold, nothing load-bearing dropped)

- **Dual step-numbering killed:** cross-file references now go by phase NAME (Interview, Spec, Plan, Test-plan, Gate, Implement, Test, Review, Security, Docs, Ship, Retro); numbers are file-local only. 26 files swept; orchestrator.md keeps its op counter internally; the hand-maintained op↔matrix translation table is gone.
- **`FANOUT_REQUESTED:` narrowed to `implement:` only.** Every splittable worker holds `Agent` and direct-nests its own read/research/review helpers (dispatch-mechanism contract), so the five read-shape signals (`review`, `security:`, `plan:`, `test:`, `research:`) were a redundant second dispatch path — retired. Implement keeps the signal (background phase-dispatch needs orchestrator-owned resume granularity). A retired-shape signal gets one corrective re-spawn, then BLOCKER.
- **Review lenses 6 → 4:** `team-code-simplifier` + `team-comment-analyzer` retired; their checklists live on as Simplification and Comment Accuracy lenses inside `team-code-reviewer`. Tiers are now core-3 (M) / full-4 (L). Two fewer spawns + synthesis inputs per L review; TEAM.md ledger records the fold.
- **`fanout_log` records outcomes, not non-events:** append only when a fanout point was eligible or fired; ineligible points log nothing (retro reads absence as not-eligible). Cuts per-run bookkeeping writes.
- **Five heaviest skill bodies slimmed to ≤ ~1.2k words** (`ddd-strategic` 3.8k→1.1k, `delivery-engineering` 3.8k→1.1k, `security-fundamentals` 3.5k→1.2k, `queue-fundamentals` 3.4k→1.1k, `skill-creator` 3.5k→0.6k) — detail moved verbatim into references/ (line-level zero-loss verified per skill); frontmatter byte-identical, so triggering is unchanged. A triggered load now costs ~⅓ the context.

## [2.7.2] - 2026-07-15

### Added

- **`.claude/hooks/tests/run-hook-tests.sh`** — 28-assertion suite for the four wired hooks (guard Cases 1/3/4/5/6 incl. floor override + fail-closed pin, state-validate dup-key paths, state-mark foreground/background/team-slice, protect-secrets allow/deny) — previously only artifact-lint had tests.
- **`.claude/agents/references/engineer.md`** — agent-side view of the phase-/integration-engineer contract (source stays `implement-fanout.md`); `INDEX.md` now states when an agent earns a references file.
- **`CLAUDE.md > Skills outside the router`** — documents the second (frontmatter/pipeline) trigger system for the ten non-lifecycle skills; `fundamentals.md` notes the split and its mirror claim now matches reality (README mirrors the chain; CLAUDE/WORKFLOW only name it canonical).

### Changed

- **Fanout references consolidated 3→1:** `fanout.md` + `fanout-plan.md` + `surface-fanout.md` merged into `orchestrator/references/fanout-dispatch.md` (dispatch mechanics · registry preflight · gate-steerable plan · surface fanout), zero rule loss, each rule stated once; every pointer repo-wide updated; the coordinator-model ambiguity resolved (security always opus, review conditional per `model-tiers.md`). `implement-fanout.md` stays separate.
- **Recruit-help boilerplate deduped 7→1:** the worker-side nesting contract (one-message dispatch, stop-line, merge rule, registry-miss fallback) now lives once in `fanout-team-agents > references/dispatch-mechanism.md`; the seven carrier files keep only their split criterion + cap.
- **`ui-ux-pro-max` split** to SKILL.md (~1.3k words) + 3 references (rule catalog, search tool, app-UI tables), frontmatter byte-identical, line-exact zero-loss verified.
- **Multi-repo boundary declared permanent** (implement/gate/ship pinned to primary `repo_root` by design; cross-repo blocking findings surface to the user) — `size-execution.md`, `WORKFLOW.md`.

## [2.7.1] - 2026-07-15

### Changed

- **Context rations no longer trade correctness margin** (three surgical relaxations): the team-mode gate fold spot-checks one AC per shard after the set-compare (a shard listing every AC no longer passes on its own say-so — `team-mode-sharding.md`, `orchestrator.md > Pre-gate consistency scan`); the name-only security trigger gains a bounded one-file near-miss peek to downgrade obviously-false trips (doubt → still fires — `phase-2-guards.md`); the final full-suite gate re-captures `tail -200` on red so diagnosis isn't starved by the green-path 40-line window (`phase-2-guards.md`).

## [2.7.0] - 2026-07-15

### Added

- **Opus 4.8 main-model profile** — the workflow now closes the self-verification gap when the main session runs Opus 4.8 instead of a Mythos-class model: `artifact-lint.sh --hook` PostToolUse adapter (warn-only lint of the artifact just written, wired in `settings.json`; test suite → 40 assertions); `lint.sh` typechecks `.ts/.tsx` via the nearest tsconfig (`tsc --noEmit`, diagnostics filtered to the edited file, 20s cap) and `.py` via pyright when present; `orchestrator.md` preamble gains an effort ≥ high check for 4.8 sessions and a whole-brief-per-spawn rule.
- **`orchestrator/references/model-tiers.md`** — single policy note for who runs on which tier and why (workers, analyzers, built-ins floor, escalation guidance); `INDEX.md` points at it; guard Case 6's sonnet floor is now `CLAUDE_DEV_FLOOR_MODEL`-overridable.

### Changed

- **Review recall fix:** `team-code-reviewer` reports ALL findings scored 0-100 (was: pre-filter to ≥ 80, which over-obeyed "don't be nitpicky" and dropped true positives); the ≥ 80 precision gate moves to `lead`'s synthesis, where cross-worker context lives. Fork ledger updated; the `team-*` forks are declared **DETACHED** from `pr-review-toolkit`.
- **Review fanout defaults ON at M/L** (core-3 at M, full-6 at L); a `no` in the Fanout-plan Review row needs a stated reason. Other phases stay single-pass-first.
- `engineer`: small decisions (naming, defaults, internal shapes) are chosen and noted, never `BLOCKER:`-ed. Inline-fallback dispatches must flag the haiku→sonnet tier upgrade in their path report. `lead`'s "sonnet ≈ opus at ½ wall-clock" claim marked generation-dated.

## [2.6.9] - 2026-07-15

### Fixed

- **`dev-state-validate.sh` duplicate-key check is now indent-proof** — the old check greped for exactly-2-space-indented top-level keys, so any state.json written at a different indent silently defeated the guard that exists because a two-`notes`-keys corruption once broke `/dev --resume`. Primary check is now python3 `json.load(object_pairs_hook=…)` (exact, catches nested dups too); the grep heuristic remains as the no-python3 fallback. Files: `.claude/hooks/dev-state-validate.sh`.
- **`dev-agent-guard.sh` Case 4 no longer fails open (or crashes) on an unreadable model pin** — a `model` override on a named worker whose frontmatter pin can't be read (file missing / frontmatter reformatted) previously either slipped through or killed the hook via `set -euo pipefail` on the `sed` of a missing file. The pin read is now crash-proof and an override with an unreadable pin is refused with an explicit reason (no-override spawns are untouched). Files: `.claude/hooks/dev-agent-guard.sh`.
- **`INDEX.md` pm row said `sonnet`; `pm.md` pins `opus`** (promoted in 2.6.5) — the only registry row that disagreed with its agent file. Files: `.claude/agents/INDEX.md`.

### Changed

- **Docs de-staled:** `dev.md` XS/S fast-path line now mentions `test-plan.md` folding into the combined spawn; `WORKFLOW.md` sub-agent constraints gain the surface (per-repo) fanout axis + pm's step-1 `research:` signal; `state-edge-cases.md` spells out that guard Case 3 fails OPEN with 0 or ≥2 concurrent runs (state discipline is then manual); guard Case 6 message no longer assumes an "opus" main session; `no-direct-main-commit.sh` header stamped OPT-IN. Files: `.claude/commands/dev.md`, `WORKFLOW.md`, `.claude/orchestrator/references/state-edge-cases.md`, `.claude/hooks/{dev-agent-guard,no-direct-main-commit}.sh`.

## [2.6.8] - 2026-07-14

### Changed

- **Team-slice clarify now names the grill-me tactics explicitly — `/dev-plan`, `/test-plan`, `/uxui-plan` grill via the `brainstorming` interview-tactics reference when a decision is open, not just a bare `Team-slice clarify` link.** Each command's clarify step now drives its open plan/test/UX decision through `brainstorming/references/interview-tactics.md` (recommend-lead questions + tree-ordered dig loop), gated on "when open" and still scoped by `interview.md > Team-slice clarify` for each slice's remit; `/uxui-plan` also points at the sibling `visual-companion.md` for visual UX questions. It targets the 11 KB reference, not the 26 KB `brainstorming` skill body, per `interview.md`'s "reach for one reference, not the full body" on the critical path — same grilling discipline at ~half the tokens, no pull to re-scope an already-approved spec. Files: `.claude/commands/{dev-plan,test-plan,uxui-plan}.md`.

## [2.6.7] - 2026-07-09

### Added

- **Read-only LSP for the three `team-*` reviewers — `team-code-reviewer`, `team-silent-failure-hunter`, `team-type-design-analyzer` now resolve symbols across the diff instead of grep-only.** Each gains the `LSP` tool (read-only: go-to-definition / find-references for cross-diff verification); the `Agent`/`Write`/`Bash` boundaries are untouched, so these workers stay report-only (and, except `team-code-reviewer`, still hold no `Agent`). Logged as a post-fork local edit in `TEAM.md`. Files: `.claude/agents/{team-code-reviewer,team-silent-failure-hunter,team-type-design-analyzer,TEAM}.md`.

### Changed

- **Brownfield-M/L implement no longer re-sweeps source to orient — the `engineer` reads the pre-built `context.md` map, and `plan.md > ## Current state` becomes a pointer, not a paste.** v2.6.3 made the engineer's up-front read `tasks.md` + `plan.md > ## Summary`/`## Technical Context`; this adds `plan.md > ## Current state` for brownfield orientation, and when that section points at the shared brownfield-M/L `context.md`, the engineer loads `context.md > ## Current state` **only** (not `## UI surface`/`## Test infra`) — enough to know where code lives and how it flows, never to re-derive it. An edit point unlocatable from a task's `[ref:]` + the map is a `BLOCKER:` (plan gap), never a source sweep. To keep one source of truth, `lead` now writes `plan.md > ## Current state` as `> Full map: context.md > ## Current state` + this change's overlay only (the blast-radius subset the plan touches + any re-resolved delta); a run with no `context.md` (greenfield / brownfield XS-S) still writes the map inline. The `context.md` template's `Consumed by` line and `plan-sections.md`'s Reader / `Current state` rows record the new engineer reader. Files: `.claude/agents/engineer.md`, `.claude/agents/references/lead.md`, `.claude/orchestrator.md`, `.claude/skills/plan-writing/references/{current-state,plan-sections}.md`, `.workflow/_templates/context.md`.

- **`/dev` spawn-guard sonnet floor broadened — the read-and-judge helpers can no longer inherit the opus main tier anywhere they spawn.** `dev-agent-guard.sh` Case 6 now covers the built-in **`Explore`** agent alongside `general-purpose`, and enforces the `model="sonnet"` pin on **every** spawn, not just inside an active `/dev` run — neither agent carries `model:` frontmatter, so without the pin an opus session runs them on opus. (Case 5's fork block stays run-scoped.) The fanout references that name the guard were synced to the new "blocks an unpinned general-purpose spawn" wording. Files: `.claude/hooks/dev-agent-guard.sh`, `.claude/agents/references/{pm,lead,qa}.md`.

- **Tighter read scope in two more `/dev` steps + no double-walk in the context builder.** (1) `qa` **execute** mode now treats `test-plan.md` as authoritative (it already maps every `AC# → level → assertion`) and pulls `plan.md`/`spec.md` only for a specific unresolved row, not up front. (2) Orchestrator **step 13** hands `lead` security mode the exact tripped-path set the name-only sink scan flagged as its read scope, instead of the whole diff. (3) Orchestrator **step 7a** seeds any code spec-prep (step 6) already walked into the context-builder prompt and dispatches explorers only for surfaces it didn't cover. Files: `.claude/agents/qa.md`, `.claude/agents/references/qa.md`, `.claude/orchestrator.md`.

- **Team-mode slice commands + `WORKFLOW.md` de-duplicated against the orchestrator — same behaviour, less drift surface.** The `/spec`, `/dev-plan`, `/test-plan`, `/uxui-plan`, `/implement` commands now point at the orchestrator step they mirror ("run step N verbatim — don't re-derive it here") instead of restating the recipe, and `WORKFLOW.md` collapsed its duplicated skill-routing / phase-flow prose to name `fundamentals.md` + `orchestrator.md` canonical (~44 lines cut, no rule change). `CLAUDE.md` drops the stale OpenWolf parent-directive bullet (no `.wolf/` tree exists here). Files: `.claude/commands/{spec,dev-plan,test-plan,uxui-plan,implement}.md`, `WORKFLOW.md`, `CLAUDE.md`, `.claude/orchestrator/references/{fanout,gate,implement-fanout,surface-fanout}.md`, `.claude/skills/fanout-team-agents/references/{running-a-fanout,surface-fanout}.md`, `.claude/agents/retro.md`.

## [2.6.6] - 2026-07-09

### Added

- **`/dev` spawn guard now closes the model-tier leak on `general-purpose` and every `team-*` fanout worker — no spawn silently inherits the opus main tier.** Two extensions to `dev-agent-guard.sh` (building on v2.6.5's Cases 4/5). **Case 4 extended:** the frontmatter-model match now covers every `team-*` fanout worker (via a `team-*` glob), not just `pm|engineer|qa|retro|uxui` — a stray `model` override on a named team worker is blocked, so each runs at the tier its own agent file pins (the `haiku` analyzers — codebase-explorer, comment-analyzer, pr-test-analyzer, type-design-analyzer, code-simplifier — stay haiku). `lead` remains the sole exempt worker. **New Case 6:** a `general-purpose` spawn during an active `/dev` run must set `model="sonnet"` — general-purpose has no `model:` frontmatter, so without the pin it inherits the main-session tier and an opus session runs every fanout / inline-fallback / surface helper on opus; the guard now blocks an absent or non-sonnet model. Cases 5 & 6 share one `.workflow` probe that runs only for a fork or general-purpose spawn, so the common worker spawn is unaffected. The four sanctioned general-purpose dispatch paths (inline-fallback in `pm`/`lead`/`qa`, `orchestrator/references/fanout.md`; surface-coordinator helpers in both `surface-fanout.md` refs) are updated to pass `model="sonnet"` so they satisfy Case 6 without a wasted block-and-retry. Files: `.claude/hooks/dev-agent-guard.sh`, `.claude/agents/references/{pm,lead,qa}.md`, `.claude/orchestrator/references/{fanout,surface-fanout}.md`, `.claude/skills/fanout-team-agents/references/{running-a-fanout,surface-fanout}.md`.

## [2.6.5] - 2026-07-09

### Added

- **`/dev` spawn guard now enforces model tier — a worker can no longer silently run on the wrong model.** `dev-agent-guard.sh` gains two cases. **Case 4:** a `model` override on a named worker (`pm`, `engineer`, `qa`, `retro`, `uxui`) must match that worker's pinned `model:` frontmatter — a `model` param outranks the agent-definition model, so without this an opus main session could silently run a sonnet-pinned worker on opus. `lead` stays exempt (the playbook tunes it sonnet↔opus per phase); the pinned value is re-read from disk each spawn, so flipping a worker's own `model:` needs no hook change. **Case 5:** `subagent_type="fork"` is blocked during an active `/dev` run — a fork inherits the main agent's model **and** context, bypassing worker frontmatter entirely, so an opus main session would drag opus onto every forked worker; outside a run, fork is a normal harness feature and passes through untouched. Both cases sit off the common spawn path (Case 4 adds one `jq` plus a `sed` only when a `model` param is present; Case 5 runs globbing only for a fork spawn), so a plain worker spawn still pays two reads. Files: `.claude/hooks/dev-agent-guard.sh`.

### Changed

- **`pm` worker promoted to `opus`** (was `sonnet`) — spec quality over spec cost for the one artifact every later phase is anchored on. Files: `.claude/agents/pm.md`.
- **Phase-2 orchestration hardened for context discipline — the orchestrator stops re-reading its guide and stops pulling large payloads into its own context.** Four levers: (1) `references/phase-2-guards.md` is read **once** on entering step 10 and kept resident through the final gate (13a) — no per-step re-open; (2) the **changed-repo set** is computed once at step 11 (engineer's returned files, ground-truthed by one `git status --porcelain`) and **held for steps 12/13/13a** instead of recomputed downstream; (3) the **security trigger is decided name-only** — a `git diff -G'<sink tokens>' --name-only` pickaxe returns only the *files* whose added/removed lines carry a sink token, so a large diff body never enters the orchestrator's context (the boolean only picks whether to spawn `lead` security, which reads the actual code itself); (4) the **final full-suite gate captures only the exit code + a bounded tail** (`<cmd> 2>&1 | tail -40; echo "exit=${PIPESTATUS[0]}"`) rather than the whole suite stdout — a red tail still carries the failing lines. Files: `.claude/orchestrator.md`, `.claude/orchestrator/references/phase-2-guards.md`.

## [2.6.4] - 2026-07-08

### Changed

- **`plan-writing` skill tersed 1028 → 849 lines (~17%) — same rules, far shorter trigger-time read.** A two-pass minimization of the skill `lead` loads at plan time. Pass one compressed prose and de-duplicated repeated rules (`SKILL.md` 270 → 208, `references/size-tiering.md` 168 → 119, `references/self-review.md` 155 → 95; the greenfield S-cap rule went from ~6 restatements to one canonical definition + pointers). Pass two removed duplicate/back-reference *sections* outright: the `Pre-flight checklist` (a restatement of the 10 principles — kept only the non-dup `Draft order`), `When to skip` (duplicated the frontmatter skip list), `size-tiering`'s `Edge cases` (merged into `Signals`, its three overlapping cases folded in as inline examples), and `current-state`'s `When to skip Current state` (a self-labeled "quick reference" of principle 3). Every principle (numbers unchanged), gating/tiers/scorecard/diagram table, worked example, and cross-file anchor (`Section gating by Size`, `Greenfield vs brownfield`, `Boundary-depth`) is preserved — only prose and duplicate headings were cut. Files: `.claude/skills/plan-writing/{SKILL.md,references/size-tiering.md,references/self-review.md,references/current-state.md}`.

## [2.6.3] - 2026-07-06

### Changed

- **`/dev` implement no longer front-loads five whole plan artifacts — `tasks.md` is the single up-front read; everything else is pulled per-task.** v2.6.1 made the engineer's *references* lazy; this extends the same discipline to the sibling artifacts. Mode A previously read `tasks.md` + `plan.md` (Summary/Scaffold/Architecture + Current state) + spec ACs + `test-plan.md` + `uxui-plan.md` whole before the first edit — a payload that scaled with plan size, not task size. Now the engineer's entire up-front read is `tasks.md` — carrying a new `## Guardrails` header (the must-not-break blast-radius invariants, digested from `plan.md > ## Current state`) — plus `plan.md > ## Summary` & `## Technical Context`; Scaffold, Architecture, AC text, test-plan Coverage rows and uxui Scenes open per-task via the row's `[ref: path#anchor]` pointer, only when the citing task starts. Two supporting levers land with it: `plan-sections.md` gains a **Reader** column (`eng` build-time vs `gate` plan-time — the engineer never loads plan-time sections) and a **Budget** column (per-section prose caps, never dropping a consumed field); and `artifact-lint.sh` gains an AC-text-locality check flagging `**Given**/**When**/**Then**` prose leaking outside `spec.md` (acceptance text stays single-sourced, referenced by `AC#` id elsewhere). Files: `.claude/agents/{engineer,lead,pm,qa,uxui}.md`, `.claude/agents/references/lead.md`, `.claude/orchestrator.md`, `.claude/skills/plan-writing/{SKILL.md,references/plan-sections.md}`, `.claude/hooks/artifact-lint.sh`, `.workflow/_templates/{tasks,plan,spec}.md`.

## [2.6.2] - 2026-07-06

### Changed

- **`git-workflow` and `debug-fundamentals` skill bodies minimized — same guidance, far terser trigger-time read.** `git-workflow/SKILL.md` 266 → 36 lines (~86%): the branching/committing/rebasing/PR mechanics condense to their load-bearing rules, dropping restated context and worked-out prose while keeping every destructive-op guardrail. `debug-fundamentals/SKILL.md` 226 → 45 lines (~80%): the body is recast around the explicit six-phase debugging loop (reproduce → isolate → instrument → hypothesize → fix → verify) in a phase/principle table, and its four `references/` are streamlined in step — `bisection.md` 142 → 89, `distributed-debugging.md` 146 → 66, `instrumentation.md` 129 → 74, `reproduction.md` 87 → 58 — each tightened to its actionable core (deterministic standalone repros, high-signal instrumentation, bisection procedure). Same triggers and cross-skill citations; the router's construction/debug run-order is untouched. Files: `.claude/skills/git-workflow/SKILL.md`, `.claude/skills/debug-fundamentals/{SKILL.md,references/*}`.
- **`.gitignore` now ignores the local `solar-system/` scratch directory.** Files: `.gitignore`.

## [2.6.1] - 2026-07-04

### Changed

- **`/dev` engineer no longer front-loads every plan reference before writing code — references and `## To explore` areas now open lazily, per-task.** Mode A told the engineer to *"open every cited reference (exempt from skill budget) + LSP-open each `## To explore at implement` area **before editing**"* — an unbounded expansion that scaled with plan length, not task size, so a reference-heavy plan burned hundreds of thousands of tokens (and reasoning over that inflated context) before the first edit. Now the engineer reads the plan core up front (`Summary`/`Technical Context`/`Scaffold`/`Architecture` + `## Current state`, where the blast-radius invariants live) + spec ACs, and opens each `[ref: …]` / its `## To explore` area only when it **starts the task that cites it**; a cross-task invariant surfacing only under `## To explore` is a plan gap the engineer flags (`BLOCKER:`) rather than silently absorbing. The `tasks.md` template now surfaces the `[ref: path#anchor]` tag (legend + task format) so `lead` reliably emits the per-task pin the lazy load keys off — previously the tag was documented only in `plan-writing`. `qa` and `lead` review were checked and carry no equivalent front-load (both are bounded by the diff/test-plan they consume, not an unbounded reference expansion). Files: `.claude/agents/engineer.md`, `.workflow/_templates/tasks.md`.

## [2.6.0] - 2026-07-01

### Added

- **`BUSINESSRULE.md` — 8th doc in the `init-project-docs` suite.** Captures the domain rules the code enforces (invariants, validation, formulas, eligibility, state guards), grounded in validators/services/named constants; placed after COREFEATURE, before API, with an optional state/decision diagram. Skipped for thin-CRUD/static projects. Files: `.claude/skills/init-project-docs/{SKILL.md,references/doc-templates.md,scripts/build_doc_viewer.py}`.

## [2.5.14] - 2026-06-25

### Changed

- **`/dev` test phase now runs tiered — impacted tests on every inner cycle, the full suite once at a final convergence gate — to cut test-phase wall-clock (~5×).** The test step is the re-validation gate every fix re-enters (failing test, review fix, security fix); combined with the "passing must be a full-suite one-command run" rule, a large suite could re-run on every cycle — the dominant test-phase cost. Inner cycles (steps 11/12/13) now run impacted/related tests only; the full suite runs once as a final ship-blocking gate at convergence (review ∧ security clean, pre-docs — step 13a) that sets the authoritative `passing`. The invariant "ship only on a green full suite of the final diff" is preserved. Files: `.claude/agents/qa.md`, `.claude/agents/references/qa.md`, `.claude/orchestrator.md`, `.claude/orchestrator/references/phase-2-guards.md`, `.workflow/_templates/test-plan.md`.
- **`/dev` state-discipline write overhead between worker spawns cut three ways, each preserving `--resume`.** The discipline forced a full re-emit of the whole `state.json` after every step, serialized between every worker spawn by the guard — the dominant between-spawn cost. **(A)** Relaxed "always Write the COMPLETE object, never Edit a key": a new `dev-state-validate.sh` PostToolUse hook verifies `state.json` still parses and has no duplicate top-level key after each write, so routine per-step bumps can `Edit` the hot scalars (`step`/`next_step`/`last_updated`/`last_agent`/`cycles`) instead of re-emitting the growing object — the validator now guarantees what the blanket-Write rule did (the two-`notes`-keys corruption that broke `--resume`). **(B)** Scoped the `dev-agent-guard.sh` Case 3 freshness hard-block to M/L runs — XS/S spawn few workers and are cheap to re-run, so the BLOCKED retry loop cost more than the resume granularity it bought; the write *instruction* still holds at all sizes (the "never shrinks at any size" invariant is untouched), only the hard block is dropped, and legacy/no-`size` state falls through to enforcement. **(C)** Write at every worker return / phase boundary / fanout point rather than literally "every step" — orchestrator-only micro-steps that spawn nothing fold into the next write. Files: `.claude/hooks/dev-state-validate.sh` (new), `.claude/hooks/dev-agent-guard.sh`, `.claude/orchestrator.md`, `.claude/settings.json`.
- **`.gitignore` now ignores `docs/` build output and the Serena MCP server's local `.serena/` cache.** Files: `.gitignore`.

## [2.5.13] - 2026-06-25

### Added

- **The three most code/table-dense artifacts now open with a one-line `> For humans` lede.** `tasks.md`, `test-plan.md`, and `uxui-plan.md` each begin with a single plain-language blockquote that says how to skim the file and which codes a human can skip (`T###` / `[AC#]` / `S1`, `path#anchor`); the `For humans` label also signals downstream agents the line is skippable. Additive only — every machine-read field is untouched and the `Output discipline` terse-first contract for AI-to-AI artifacts is unchanged. The owning skill/agent guidance pins the lede as always-on (one line, never stripped in self-review). Files: `.workflow/_templates/tasks.md`, `.workflow/_templates/test-plan.md`, `.workflow/_templates/uxui-plan.md`, `.claude/skills/plan-writing/SKILL.md`, `.claude/agents/qa.md`, `.claude/agents/uxui.md`.

## [2.5.12] - 2026-06-25

### Added

- **Specs now require a one-line `## Goal` — what's built, for whom, to what outcome.** Added to the spec minimum floor: a `## Goal` section (one sentence; *not* a metric → that's `Success Criteria`, *not* a feature list → that's `User Stories`). The `pm` agent writes it from the interview's goal capture (unknown goal → `BLOCKER:`, not `[NEEDS CLARIFICATION]`); the `brainstorming` interview captures it; and the `artifact-lint` hook now enforces `## Goal` alongside `**Type**:` and `## User Stories`, with a new pass-fixture section and dedicated test assertions. Files: `.claude/agents/pm.md`, `.claude/hooks/artifact-lint.sh`, `.claude/hooks/tests/run-artifact-lint-tests.sh`, `.claude/hooks/tests/fixtures/pass/.workflow/0000-feat-sample/spec.md`, `.claude/skills/brainstorming/SKILL.md`, `.workflow/_templates/spec.md`, `WORKFLOW.md`.

### Changed

- **Code-bearing plans now require a `sequenceDiagram`.** `feat` / `fix` / `refactor` plans MUST carry a `sequenceDiagram` of the call path — the interaction order that prose hides — with a structural `flowchart` / `classDiagram` demoted to an optional companion (used when shape matters as much as order). `chore` / `docs` / `spike` stay exempt. The diagram table, the per-Type templates, and the XS (≤3 participants) / L (sequence + before/after pair) sizing notes in `plan-writing` are updated to match. Files: `.claude/skills/plan-writing/SKILL.md`, `.claude/skills/plan-writing/references/diagrams.md`.

## [2.5.11] - 2026-06-24

### Added

- **One-action release — `.github/workflows/release.yml` automates the whole mechanical release.** Write the changelog under `## [Unreleased]` and trigger the *Release* workflow with a version; on a current-Xcode `macos-15` runner it renames the changelog (`[Unreleased]` → dated `[X.Y.Z]` + fresh `[Unreleased]` + link refs), bumps `VERSION`/`WORKFLOW.md`, tags + pushes, computes the source-tarball `sha256` and bumps the formula `url`/`sha256`, publishes the GitHub release, builds + uploads the bottle and arms the formula's `bottle do` block, then commits — turning ~15 manual steps into one trigger (2 bot commits + a tag + a bottled release). A `dry_run` input rehearses the edits + bottle build with no push/tag/publish. Files: `.github/workflows/release.yml`, `RELEASING.md`.

## [2.5.10] - 2026-06-24

### Added

- **Ship no longer auto-commits — the commit is opt-in at the gate, default `no`.** Phase 9 (Ship) always runs — it isolates the run's diff and scans for secrets — but whether it *commits* is now the gate's call via a new **`commit on|off`** lever (`state.json > commit_on_ship`, asked **every run**, default `off`). `off` → the engineer leaves the tree as built and hands back a **ready-to-run commit command** (no commit, no push, no PR — `open_pr_on_ship` is forced `no`); `on` → it commits with the spec-aware message and opens a PR when a remote exists and `Open PR on ship = yes`. Independent of the in-`implement` commits `fix`/`refactor` make for the regression/baseline contract (those still land at phase 4). Files: `.claude/agents/engineer.md`, `.claude/orchestrator/references/gate.md`, `.workflow/_templates/state.json`, `.claude/orchestrator.md`, `.claude/agents/{INDEX.md,retro.md}`, `.claude/commands/implement.md`, `WORKFLOW.md`, `README.md`.

### Fixed

- **`brew install claude-foundation` no longer demands an up-to-date Xcode / Command Line Tools.** The formula compiles nothing — `install` only copies files — but Homebrew runs its fatal *"Your Xcode/Command Line Tools are too outdated"* check on every **build-from-source** install (`formula_installer.rb`: `if !pour_bottle? && DevelopmentTools.installed?`), and with no bottle published every stable install was build-from-source. So a user on a newer macOS (e.g. Tahoe 26) with an older Xcode was blocked for a toolchain the formula never uses. Fixed by **publishing a prebuilt bottle** (`cellar: :any_skip_relocation`) so `pour_bottle?` is true on a matching platform and the check is skipped — an `arm64_sequoia` bottle ships first, and it also pours on `arm64_tahoe` (macOS 26 ARM), since Homebrew uses an older-macOS bottle on a newer one; other platforms keep building from source until their bottle is added. (The formula's `bin` wrapper bakes an absolute prefix, so it isn't `:all`-eligible — brew produces a per-platform bottle.) A new `.github/workflows/bottle.yml` builds the bottle on a current-Xcode `macos-latest` runner (building a bottle is itself build-from-source, so it cannot be produced on the machine that hits the error), uploads it to the GitHub release, and prints the `bottle do` block to paste into the formula; `RELEASING.md` documents the per-release step and how to retro-fix an already-published version. `brew install --HEAD` still builds from source (HEAD ignores bottles), as expected. Files: `.github/workflows/bottle.yml`, `Formula/claude-foundation.rb`, `RELEASING.md`.

### Changed

- **`testing-fundamentals` test-design reference — boundary-testing guidance expanded.** Adds a mnemonic for the conditions worth probing and a new note on interaction / sequence / combination testing, and tightens the edge-case checklist. Files: `.claude/skills/testing-fundamentals/references/test-design.md`.

## [2.5.9] - 2026-06-22

### Changed

- **Two skills minimized and split into on-demand `references/` — `api-design-fundamentals` and `fanout-team-agents`, no load-bearing content lost.** `api-design-fundamentals/SKILL.md` 259 → 115 lines (~56%): each of the 8 principles drops to its Rule + a one-line how-to + a reference pointer, with the worked examples, decision tables, and full mechanics moved into three new references (`resource-modeling.md`, `contracts-and-errors.md`, `evolution.md`) — these were already named by the skill's "Reference files" section but never existed (dangling pointers, now resolved; auth/principle 7 deliberately keeps a fuller body and defers to `security-fundamentals`). `fanout-team-agents/SKILL.md` 193 → 58 lines (~70%): the body keeps the when-to-use eligibility table, the worker roster, and the always-hold invariants; the dispatch mechanism, the per-repo surface axis, the run procedure, and the anti-patterns move into three new references (`dispatch-mechanism.md`, `surface-fanout.md`, `running-a-fanout.md`). Same triggers, same cross-skill citations, the `FANOUT_REQUESTED:` allowlist regex and the `AC8`/spec-0002 citations all preserved — terser trigger-time read, depth pulled only when a friction needs it (the critical-path "load no full skill body unless required" stance). Files: `.claude/skills/api-design-fundamentals/{SKILL.md,references/*}`, `.claude/skills/fanout-team-agents/{SKILL.md,references/*}`.

## [2.5.8] - 2026-06-22

### Added

- **The plan phase now produces a dedicated `tasks.md` — a dependency-ordered, executable task list — split out from `plan.md`.** `plan.md` stays the design/strategy artifact (approach, phases, `path#anchor` refs, risks, verification); the new `tasks.md` carries the *do-this* list: numbered `T###` tasks, each tagged with the acceptance criteria it delivers (`[AC#]`) and a runnable `verify:` line, dependency-ordered and XS/S/M/L-sized. `lead` plan mode writes both; `engineer` implement mode executes `tasks.md` (was: "executes the plan"); the gate's pre-gate consistency scan now maps every AC to a delivering+verifying task in `tasks.md` and the plan check requires ≥1 `T###` task with an `[AC#]` tag + `verify:`. New `_templates/tasks.md`. Files: `.claude/skills/plan-writing/SKILL.md` (+ `references/`), `.claude/orchestrator.md`, `.claude/agents/{lead,engineer}.md`, `.workflow/_templates/tasks.md`, `WORKFLOW.md`, `README.md`, `website/`.
- **A full worked example of a `/dev` run — `examples/todolist-v2/`.** A complete reference app (vanilla JS to-do list with due dates, priorities, tags, filtering) shipped with its real test pyramid — unit (`pure-helpers`), integration (CRUD, filters, due-date/priority/tags, regression), and opt-in Playwright e2e (a11y, keyboard, responsive, sort, visual snapshots) plus coverage output — and its **complete on-disk run folder** `.workflow/0002-feat-todolist/` (spec, plan, tasks, test-plan, uxui-plan, tests, review, retro, session-summary, state shards). It shows, end to end, what a real run leaves behind. 28 files / ~6.5k LOC.

### Changed

- **Prompt-surface condensation pass — no load-bearing content lost.** `.claude/orchestrator.md` rewritten 98 → 50 lines (~49%); the agent prompts (`pm`, `lead`, `engineer`, `qa`, `retro`, `uxui`, every `team-*`), the orchestrator `references/`, the `plan-writing` skill, and all 11 `_templates/*` tightened (templates net +285/−142 as `tasks.md` lands and the others shrink). Same triggers, same run order, same fields each phase reads — terser prose. `.workflow/FOLLOWUPS.md` doc tightened for clarity. Files: `.claude/orchestrator.md` (+ `references/`), `.claude/agents/*`, `.claude/skills/plan-writing/*`, `.workflow/_templates/*`, `.workflow/FOLLOWUPS.md`.

## [2.5.7] - 2026-06-19

### Added

- **The Phase-1 interview now grills along the design tree and recommends an answer to every question — `grill-me` concepts imported across `/spec`, `/dev-plan`, `/test-plan`, and `/uxui-plan`.** Slot/decision selection is no longer a flat "pick the 3–4 most consequential" batch: the interview now **orders open slots by the design tree** (a load-bearing decision others hinge on — approach, data shape, actor — is resolved first; a dependent slot is never asked cold while its parent is open, it waits for a later batch the prior answer shapes), and **every `AskUserQuestion` choice leads with a `(Recommended)` option + one-line why** (the harness-native label) so the user vetoes instead of authoring from scratch. The bounded dig loop is reframed **tree-driven, not counter-driven** — keep digging while a consequential branch is unresolved; the 3-batch cap is the safety stop, not a quota. The same discipline is mirrored into the team-slice clarify step (each slice orders by its own remit's tree: plan approach gates placement+rollback · test levels gate fixtures+env · UX devices+style gate layout). The literal grill-me "one question at a time" is a deliberate divergence — our model batches 3–4 (token-conscious + the orchestrator owns `AskUserQuestion`), so thoroughness comes from tree-ordered batches + the dig loop, not single-question prompts. Files: `.claude/orchestrator.md`, `.claude/orchestrator/references/interview.md`, `.claude/skills/brainstorming/SKILL.md`, `.claude/skills/brainstorming/references/interview-tactics.md`.
- **`grill-with-docs` capture-as-you-go — a triggered `Glossary` spec section, plus interview-resolved decisions wired into the plan's existing ADR sections.** As the grilling surfaces them, the interview now records **glossary terms** (domain language that needed defining → a new **triggered** `spec.md > Glossary` section owned by `pm`, sourced from the interview bundle; `[[ddd-strategic]]` territory, skipped for generic CRUD, so it stays off the minimum floor) and **resolved decisions** (each non-trivial choice + its rejected alternative + the one-line why). The ADR side adds **no new artifact** — the plan already carried `Approach`, `Alternatives considered`, and `Hard-to-reverse decisions`; the interview now feeds them so the rationale doesn't evaporate once the user picks. `ddd-strategic` owned the glossary *discipline* (principle 3) but it never landed as a run artifact before; now it does. Files: `.claude/agents/pm.md`, `.workflow/_templates/spec.md`, `.claude/orchestrator/references/interview.md`, `.claude/skills/brainstorming/SKILL.md`.

### Changed

- **`interview-tactics.md` minimized 234 → 127 lines (~46%) with no load-bearing content lost.** Removed sections that duplicated `brainstorming/SKILL.md` (the "Bounded multi-round digging" section restated principle 3 almost verbatim; the interview "anti-patterns" section restated SKILL.md's), de-duplicated the "export user data" worked example that appeared 4× (now one canonical copy), cut the redundant pre-mortem worked example (its category table already conveys it), and tightened prose throughout. All anchor-referenced content is preserved — slot-picking, multi-choice framing, `revise` follow-ups, `Type=fix` reproduction, and the full `The Mom Test for spec interviews` section SKILL.md links to. Files: `.claude/skills/brainstorming/references/interview-tactics.md`.

## [2.5.6] - 2026-06-19

### Added

- **Team-mode plan slices now ask before guessing — `/dev-plan`, `/test-plan`, and `/uxui-plan` clarify any open decision in their own remit before spawning the worker, mirroring `/spec`'s interview.** A standalone slice can run cold against an older spec; each command's main agent (workers can't `AskUserQuestion`) now asks one ≤ 3 `AskUserQuestion` batch only on genuinely-open decisions it owns — `/dev-plan`: approach/tech/placement/rollback · `/test-plan`: test levels/fixtures/env/`e2e_visual` · `/uxui-plan`: devices/style/reference — never re-asking spec-settled slots, and routing a contract gap (ambiguous requirement, undefined AC, security/data hole) to `/spec` rather than patching it here. The discipline lives once in `interview.md > Team-slice clarify` (the canonical interview reference); the three commands carry one-line pointers + their remit, so a future change touches one file. Nothing open → ask nothing, proceed. Files: `.claude/orchestrator/references/interview.md`, `.claude/commands/dev-plan.md`, `.claude/commands/test-plan.md`, `.claude/commands/uxui-plan.md`.

## [2.5.5] - 2026-06-19

### Changed

- **Phase 2 now runs `test` before `review` — reviewers judge code that already passes its suite, and test becomes the true pre-ship gate.** The autonomous build order changes from `implement → review → security → test → improve → docs → ship` to `implement → test → review → security → docs → ship` (the `improve` phase is also removed this release — see below). Three adjacent phases rotate in both numbering schemes — phase-matrix `{5,6,7}` and operational `{11,12,13}` — so **test = 5/11, review = 6/12, security = 7/13**; every other step number (implement 4/10, docs 8/14, ship 9/15, retro 10/16) is unchanged. **Loop-back added so the reorder stays correct:** a `review` or `security` fix routed back to `engineer` now **re-enters test** before re-review, so a review/security-driven code change can never ship untested (previously test sat last and re-validated those fixes implicitly). Cycle counters are clarified to bump **only on a real fix-routing** — `cycles.test` on a failing test sent to `engineer`, `cycles.review` on a review/security fix sent to `engineer` — so the re-validation runs don't inflate the budgets. The test↔review **`team-pr-test-analyzer` dedup reverses direction**: test runs first now, so review folds in test's coverage findings (was the other way). No phase is added or removed; the gate, security trigger, type matrix, and protected set are unchanged. Files: `.claude/orchestrator.md`, `.claude/orchestrator/references/phase-2-guards.md`, `.claude/orchestrator/references/fanout.md`, `.claude/orchestrator/references/surface-fanout.md`, `.claude/orchestrator/references/gate.md`, `.claude/agents/lead.md`, `.claude/agents/qa.md`, `.claude/agents/references/qa.md`, `.claude/commands/dev.md`, `.claude/commands/implement.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `.claude/skills/plan-writing/SKILL.md`, `WORKFLOW.md`, `README.md`.

### Removed

- **The `improve` phase (7½ / engineer Mode D) is removed entirely.** Phase 2 is now `implement → test → review → security → docs → ship → retro` — the post-test, behaviour-preserving cleanup leg is gone as a phase. Rationale: it was the most-gated, lowest-stakes discretionary phase, and writing clean code is the engineer's job at implement-time (`coding-discipline` / Ponytail) with `review` catching residual mess; touched-code cleanup that genuinely needs its own pass becomes a follow-up `refactor` run. The brownfield discipline contracts from `understand → lock → change → improve` to **`understand → lock → change`** — the lock/characterization leg stays (the load-bearing brownfield safety). **No renumbering** (7½ was a half-step; docs 8 / ship 9 / retro 10 unchanged). `engineer` drops Mode D; `state.json > phase_plan` keys drop `improve`; the discretionary set is now `test`/`review`/`docs`. Files: `.claude/orchestrator.md`, `.claude/orchestrator/references/{phase-2-guards,gate,size-execution,xs-s-fast-path,resume}.md`, `.claude/agents/{engineer,lead,retro}.md`, `.claude/agents/references/lead.md`, `.claude/commands/{dev,implement}.md`, `.claude/skills/plan-writing/references/size-tiering.md`, `.claude/skills/{refactoring-fundamentals,init-project-docs}/SKILL.md`, `WORKFLOW.md`, `README.md`, `CLAUDE.md`, plus the marketing/demo surface (`website/`).

## [2.5.4] - 2026-06-19

### Added

- **Team-mode Phase-1 plan slices now run fully in parallel — `/dev-plan`, `/test-plan`, and `/uxui-plan` can be fired together on one run, no sequence.** `/dev-plan` and `/uxui-plan` need only `spec.md`; `/test-plan` also consumes `plan.md`, so when it starts before the plan exists it runs **spec-only** — every acceptance criterion still maps to a level (the Coverage plan stays complete), but plan-derived rows (edge cases off Files-touched, fixtures, the regression/baseline path) are recorded `[pending plan]` instead of invented, and the shard sets `pending_plan_backfill`. The **gate backfills** them: when it folds the Phase-1 shards and `plan.md` now exists, it re-spawns `qa` in a new `backfill` mode once to complete the deferred rows before the consistency scan (which now also requires no `[pending plan]` rows remain). Spec-only is a first-class path (no user go-ahead needed); a one-shot `/dev` run is unchanged (it writes the test plan after the plan, so never produces `[pending plan]`). Files: `.claude/commands/test-plan.md`, `.claude/agents/qa.md`, `.claude/orchestrator.md`, `.claude/commands/implement.md`, `.claude/orchestrator/references/team-mode-sharding.md`.

### Fixed

- **`uxui-plan.md` is now consumed by the engineer at build time.** Previously the UX/UI design artifact (`/uxui-plan`'s Scenes, ASCII wireframes, UX direction, components, AC↔scene mapping) was folded as a state shard and checked by `qa` visual verification, but never fed to the engineer — who built the UI from `plan.md`'s Scaffold + the frontend skills generically, ignoring the approved design. The engineer's Inputs + implement mode now read `uxui-plan.md` when present and build each screen/state to its Scene + wireframe; orchestrator step 10 and `/implement` point the engineer at it. Files: `.claude/agents/engineer.md`, `.claude/orchestrator.md`, `.claude/commands/implement.md`.

### Changed

- **De-duplication pass across the team-mode command surface — no behaviour change.** Three concepts that were re-explained in full across the slice commands now live in one canonical home with thin pointers + per-command deltas, matching the existing fanout/resume house pattern: the **shard shape** (was duplicated across 4 files → now only `team-mode-sharding.md`), the **"resolve the run" selection logic** (was in 5 files → new `references/resolve-run.md`), and the **spawn-by-name guard** (was a full callout in 6 files → now points to `orchestrator.md > Rules`). Collapses ~1,400 words of repeated prose to one-line pointers; a future change to a shard field, the run-id format, or the guard now touches one file instead of 4–6. Also fixes two pre-existing drifts surfaced during the pass: `WORKFLOW.md`'s version line (stuck at 2.5.2) and the `CHANGELOG.md` link-reference block (had skipped 2.5.2 / 2.5.3). Files: `.claude/commands/*.md`, `.claude/orchestrator/references/resolve-run.md` (new), `.claude/orchestrator/references/team-mode-sharding.md`, `WORKFLOW.md`.

## [2.5.3] - 2026-06-19

### Added

- **Terse-output is now a first-class always-on rule (`fundamentals.md` › Output discipline).** Promotes the user-level "Terse output" preference and the v2.5.1 / v2.5.2 minimization work into a standing stance carried every turn: default every response, artifact, and agent report to the minimum that carries the point. Two channels, different floors — **throwaway prose** (chat reply, agent report to the orchestrator, `state.json notes`) minimizes hard to breadcrumb tags, not paragraphs; **consumed artifacts** (`spec.md`, `plan.md`, `test-plan.md`, `review.md`, `security.md`, `tests.md`, `retro.md`, `uxui-plan.md`) trim prose freely but keep every load-bearing field a later phase reads (acceptance criteria, plan steps, the mermaid diagram, `path#anchor` citations, the regression contract, `--resume` state keys) — **terse ≠ lossy**, never drop a result, caveat, or needed step. Paired with `orchestrator.md`, whose `state.json notes` field is now specified as terse breadcrumb tags (`patch-lane`, `ci: unchecked`, `branch_existed=true`, `fanout refused — <reason>`), not prose that restates artifact content. The same pass trims two flourish/attribution lines from the `fundamentals.md` intro and `Ponytail` blocks. No `/dev` flow, phase, artifact, or command change; every trigger, skill name, and the cross-skill run-order chain is preserved verbatim. Files: `.claude/rules/fundamentals.md`, `.claude/orchestrator.md`.

## [2.5.2] - 2026-06-18

### Changed

- **Word-minimization pass across the `/dev` prompt surface — no behaviour change.** Continues the v2.4.0 / v2.5.0 / v2.5.1 minimalism work, now at the word level: trims filler, hedge words, and rationale that merely restates the adjacent rule from the always-read playbook (`orchestrator.md`), the worker agents (`pm` / `lead` / `engineer` / `qa` / `retro` / `uxui`, the `team-*` fanout workers, and `INDEX.md` / `TEAM.md`), the on-demand reference modules (`.claude/orchestrator/references/**`, `.claude/agents/references/**`), and `WORKFLOW.md` — ~180 net lines, with the largest cuts on the forked `team-*` review agents (upstream flattery preambles / padded process prose) and only modest cuts on the dense one-rule-per-line playbook and reference files (six of which were already at irreducible density and left untouched). Two structural touch-ups ride along: orchestrator-reference cross-references to the agent references now use the full `.claude/agents/references/<agent>.md` path (a bare `references/<agent>.md` was unresolvable from the orchestrator-references directory), and `surface-fanout.md`'s four non-primary-repo notes fold from their own `##` headings into bold paragraphs under their parent step (no pointer targets them). Every rule, threshold, trigger, type-matrix entry, gate, state transition, `FANOUT_REQUESTED:` shape, and `file > Section` pointer is preserved verbatim and verified to resolve; the `/dev` flow, phases, artifacts, and commands are identical. Files: `.claude/orchestrator.md`, `.claude/orchestrator/references/**`, `.claude/agents/**`, `.workflow/_templates/tests.md`, `WORKFLOW.md`.

## [2.5.1] - 2026-06-18

### Changed

- **De-bloat / modularization pass across the `/dev` prompt surface — no behaviour change.** Continues the v2.3.1 / v2.4.0 / v2.5.0 minimalism work: the always-read playbook and worker prompts are slimmed by moving rarely-needed detail into on-demand `references/` modules that load only when that path actually fires. `orchestrator.md` drops to a lean core and splits its gate, interview, resume, fanout, Phase-2 guard, team-mode sharding, and XS/S fast-path detail into `.claude/orchestrator/references/`; the `pm` / `lead` / `qa` agents move their long-form procedure into `.claude/agents/references/`; the fundamentals skill bodies (hexagonal-backend, plan-writing, and others) extract reference sections so each `SKILL.md` stays focused; and the `.workflow/_templates/*` artifacts shed explanatory boilerplate. Every rule, threshold, type-matrix entry, gate, and state transition is preserved verbatim — the `/dev` flow, phases, artifacts, and commands are identical; only context-per-spawn shrinks. Files: `.claude/orchestrator.md` (+ new `.claude/orchestrator/references/`), `.claude/agents/**` (+ new `.claude/agents/references/`), `.claude/skills/**`, `.claude/rules/fundamentals.md`, `.workflow/_templates/**`, `WORKFLOW.md`.

## [2.5.0] - 2026-06-18

### Added

- **ASCII wireframes are now a first-class, always-required section of the `uxui-plan.md` UX design.** Every scene in a `/uxui-plan` now gets at least one low-fidelity ASCII wireframe (in a fenced `text` block) — desktop + mobile variants when responsive stacking differs, a single shared sketch when the layout is identical — showing hierarchy, regions, ordering, and responsive stacking, not pixel-perfect styling. The wireframes reuse the Scene IDs / Key elements and introduce no unmapped UI, so `frontend-design` and the implementer see the intended layout before any code, and `qa > Visual verification` gets concrete layout properties to check against. It joins `Scenes` · `Scenarios` · `AC ↔ scene mapping` as a minimum-floor section (the plan check now fails a scene with no wireframe). The same pass tightens the `uxui` agent's `ui-ux-pro-max` lookup to the bounded `scripts/search.py` lookups — paste only the small result set, read at most one targeted reference/SKILL section, and **never read the CSV `data/` corpus directly into prompt context**. Files: `.workflow/_templates/uxui-plan.md`, `.claude/agents/uxui.md`, `.claude/commands/uxui-plan.md`.

### Changed

- **Browser-based e2e + the visual/a11y verification pass are now opt-in (`e2e_visual`, default `off`).** They used to fire automatically: a UI-touching diff always triggered the visual content-trigger, and a user-observable journey was mapped to the e2e level with a 50%-of-journeys coverage floor — so almost every UI `feat` paid the browser cost (installing the browser binary + slow journeys) on every run, the dominant cause of a long test phase. The test phase now defaults to **unit + integration only** (a journey maps to the integration level; UI *logic* is covered over jsdom/happy-dom without a browser), with **no e2e level, no Visual verification plan/pass, no e2e coverage floor, and no browser install**. The browser path is turned on per-run via a binary interview opt-in (asked only for feat/fix shipping a UI surface) and a new `e2e on|off` gate lever, recorded in `state.json > e2e_visual` and mirrored in `spec.md` frontmatter (`E2E + visual`); a still-unset flag resolves to `off` at approve. When `on`, the full browser path runs exactly as before (system `channel`, one reused session, the visual/a11y pass, the e2e floor). Canonical: `WORKFLOW.md > E2E + visual (opt-in)` and `qa.md > e2e_visual`. Files: `.claude/orchestrator.md`, `.claude/agents/{qa,lead}.md`, `.claude/commands/test-plan.md`, `WORKFLOW.md`, `README.md`, `.workflow/_templates/{state.json,spec.md,test-plan.md,tests.md}`.
- **De-bloated the always-read `/dev` prompts further with no behaviour change** — continuing the v2.3.1/v2.4.0 minimalism passes on the hot-path files. Removed non-rule calibration asides (`(observed in the field)`, war-story examples, time-anecdotes) from `orchestrator.md`, consolidated the browser-install-cost rationale that `qa.md` stated three times into its one canonical Rule plus pointers, and collapsed the two duplicated spawn-guard blockquotes + verbatim call-shape code examples in `dev.md` into a single warning that points at `orchestrator.md > Rules`. Every rule, threshold, and state-transition is kept verbatim; dense procedure steps were left untouched by design. Files: `.claude/orchestrator.md`, `.claude/agents/qa.md`, `.claude/commands/dev.md`.
- **A formal "patch lane" (XS subtype) for tiny-but-tracked work.** Recognises the common case the size tiers under-served: a one-file-per-surface change with no runtime behaviour surface, no persisted data / API / schema / dependency / security-sensitive path, no executable test surface, and no cross-repo coupling. The run records `size=XS` and notes `patch-lane` in `state.json > notes` — the `Type` stays the real type (`chore`/`docs` in the common case; another type only when `lead` proves no executable behaviour changes), so this is a **machinery shortcut, not a new type**. It takes the XS/S fast path, the gate summary names it explicitly (`Size: XS → patch lane`), and the phase plan defaults review/test/docs to the cheapest matrix-safe disposition (review skipped for XS chore/docs, test stub inline, docs+ship merged, retro inline). A **wide-but-shallow multi-repo sweep** (the same trivial independent edit across N repos, one file per repo, no shared contract) stays patch-lane sized by the **deepest single repo surface** — repo count alone never upgrades it. Any worker that discovers executable behaviour, a contract change, multiple files in one repo, cross-repo coupling, or integration risk returns `SIZE_UPGRADE: S` and leaves the lane. Canonical: `orchestrator.md > Patch lane (XS subtype)`. Files: `.claude/orchestrator.md`, `.claude/skills/plan-writing/references/size-tiering.md`, `WORKFLOW.md`.
- **A size scorecard + worked-examples table in `size-tiering.md` for borderline / operationally-risky sizing.** The XS/S/M/L picker now carries a story-point-style **scorecard fallback** — seven factors (layers touched, data change, cache complexity, deployment risk, observability, security/compliance, test scope), each scored 0–2 and mapped to a tier — used when the picker feels borderline or the change spans unfamiliar operational concerns. It **calibrates** the tier; the hard picker overrides (public-contract/schema/migration → at least L, trust boundary → at least M, queue/broker → at least M, the greenfield cap at S, a multi-repo sweep scored by its deepest single surface) still win, and the score is always taken on the **deepest single surface**, never inflated by repo count. A worked-examples table (unread-count badge → ClickHouse analytics ingestion → MongoDB migration/backfill → public-schema change → consolidated multi-stack inbox) shows the score, tier, *why*, and a `measurable done` line for each. The orchestrator's digest-time size estimate and `WORKFLOW.md` point at it. Files: `.claude/skills/plan-writing/references/size-tiering.md`, `.claude/orchestrator.md`, `WORKFLOW.md`.
- **Review fanout and the review model override are now size-tiered, so M-tier diffs stop over-paying.** Review fanout used to be all-or-nothing (six lenses) and the keep-opus exception fired on `Size ∈ {M, L}`. Now a fanned-out review dispatches the **core 3 lenses** (`team-code-reviewer`, `team-pr-test-analyzer`, `team-silent-failure-hunter`) for an M-tier / moderate diff and the **full 6** only for an L-tier / high-stakes one (the bare `review` fanout signal carries no count — the orchestrator picks the tier from `state.json > size` plus the same plan signals as the model override), and the **`model: sonnet` review default now stands through M-tier** — the keep-opus exception narrows from `{M, L}` to `Size=L` (the public-contract and test-*infrastructure* triggers are unchanged). XS/S still refuse review fanout and stand on sonnet regardless, and the fanout synthesis re-spawn still keeps opus. Files: `.claude/orchestrator.md`, `.claude/agents/lead.md`, `WORKFLOW.md`.
- **The multi-repo read/judge boundary is stated explicitly — and an independent sweep is never sized up just for spanning repos.** A control-plane `/dev` run can *read and judge* many repos in parallel (review/security/test fan out per repo), while branch/implement/ship stay on the single `repo_root` and a blocking finding outside the writable repo set surfaces to the user rather than auto-fixing. `WORKFLOW.md` gains a **Multi-repo boundary** note making that explicit, and reinforces that a wide-but-shallow independent sweep (same trivial edit per repo, no shared contract) is patch-lane / S sized by the deepest single surface; if the current path can't safely write + ship every touched repo, that is surfaced as a workflow support limitation to fix, not a reason to reclassify the work as large. Files: `WORKFLOW.md`, `.claude/orchestrator.md`.
- **`install.sh` now re-syncs the managed `CLAUDE.md` rules-import block in place instead of freezing it on first write.** The fallback block is wrapped in `claude-foundation:rules-imports` sentinel comments and **re-synced between them on every install**, so a rule-router change (the v2.4.0 16-stubs → single `fundamentals.md` consolidation, and anything after) lands in an existing target's `CLAUDE.md` instead of going stale behind the old first-write freeze; an older pre-sentinel block is upgraded once, and a file with no foundation block still gets the fallback appended — all preserving everything outside the managed block. If `awk` is somehow unavailable the re-sync is flagged loudly (`resync-skipped`) rather than silently leaving the stale block, the installer warns when **`jq` is missing** (the hook scripts fail open without it, so spawn-guarding / state-freshness / secret-read protection can be silently inactive), and the `dashboard-*` usage lines are dropped from `install.sh`'s help (they live on `cli.sh`). Files: `install.sh`, `README.md`.

### Fixed

- **Calibration-round refinements to the always-read `/dev` prompts** — the orchestrator now writes the skipped-test `tests.md` stub **inline at any size** for `chore`/`docs` (not just XS — no `qa` spawn merely to author audit prose), defers coverage-floor accounting for XS/S and batches any below-floor gaps into a single `AskUserQuestion`, and makes the review→test `team-pr-test-analyzer` dedup **required** (read `review.md` once and pass the omission explicitly rather than silently re-running the same ground). `CLAUDE.md` now records the **skill-load budget on the `/dev` critical path** (plan / implement / review): the always-on router + agent summaries are the default pre-flight — load no full skill body unless a specific friction requires it, and prefer at most one targeted `references/<file>` section. Files: `.claude/orchestrator.md`, `CLAUDE.md`, `.claude/agents/{engineer,lead,qa,retro,uxui,team-*}.md`, `.claude/commands/implement.md`, `.claude/orchestrator/references/{fanout,surface-fanout}.md`, `.claude/skills/{fanout-team-agents,plan-writing,qa-handoff-note}/**`, `.workflow/{INDEX,FOLLOWUPS}.md`, `.workflow/_templates/plan.md`.
- **Doc-drift fixes in `WORKFLOW.md` and `README.md`.** `test-plan.md` authorship is corrected to **`lead` combined mode (XS/S) or `qa` (M/L)** to match the v2.1.1 combined fast path (it was still described as always a `qa` spawn); a **team-mode cost note** records that team commands deliberately skip the XS/S combined fast path (prefer one-shot `/dev` for tiny work); the releasing blurb drops the hardcoded `v1.3.0` for "`VERSION` is the source of truth, formula updated during the release runbook after the tag exists"; the install note now states `CLAUDE.md` is **never wholesale overwritten** (managed block re-synced in place); and the dashboard-availability note reflects shipping in stable Homebrew releases. Files: `WORKFLOW.md`, `README.md`.

## [2.4.0] - 2026-06-18

### Changed

- **`/dev` is now single-pass-first — the fanout default is reversed.** The workflow used to be *delegation-first*: every phase defaulted to parallel `team-*` fanout whenever its sub-investigations looked independent, and stayed single-pass only on a feasibility guardrail. Measured against real runs that bias over-fired — firing six review workers (or N prep probes) on diffs and research surfaces a single sequential pass would have finished before the helpers even spun up, paying an N× worker cold-start, a context re-pass, and a synthesis re-read for nothing. The default is now inverted: **each phase runs a single sequential worker pass, and fanout fires only when all three hold** — (a) the work genuinely decomposes into independent sub-investigations, (b) the workers write disjoint files/symbols, and (c) the coordination + N× cold-start cost is clearly *less* than the wall-clock saved. The gate's `## Fanout plan` now defaults every row to `no` (the user can still steer a phase `on`), and clearing a phase's eligibility bar makes fanout *eligible*, not *mandatory*. The stance is propagated end-to-end: `orchestrator.md` (`## Single-pass-first`), the `lead` / `qa` / `engineer` / `retro` agents, `fanout-team-agents`, and `WORKFLOW.md`. None of the guardrails changed — single-writer `state.json`, the synthesis pass when fanout *does* fire, implement-fanout disjointness re-verification, and the gate are all unchanged; only the default flipped. Files: `.claude/orchestrator.md`, `.claude/agents/{lead,qa,engineer,retro}.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `WORKFLOW.md`, `CLAUDE.md`.
- **The 16 per-skill rule redirect stubs are consolidated into one always-on router, `.claude/rules/fundamentals.md`.** Each fundamentals skill used to ship a ~7-line `.claude/rules/<skill>.md` stub whose only job was to name the trigger and point at the skill body; Claude Code auto-loads the whole `.claude/rules/` directory, so all 16 were carried on every turn. They now collapse into a single `fundamentals.md` router — a thin detection table mapping every "by default" trigger to its skill, plus the cross-skill run order and the **Ponytail** always-on minimalism digest (the `coding-discipline` principle-2 decision ladder + the `ponytail: <upgrade path>` shortcut-marker convention). One file loaded per turn instead of sixteen; the full skill body still loads on demand. Every skill body and doc that referenced a per-skill rule file is repointed at the router. Files: `.claude/rules/` (15 stubs removed, `fundamentals.md` rewritten), `.claude/skills/*/SKILL.md`, `CLAUDE.md`, `README.md`.
- **`orchestrator.md` is slimmed by ~120 lines into on-demand references.** The fanout-dispatch contract, resume mechanics, state-discipline edge cases, and the surface (per-repo) fanout contract moved out of the always-read `orchestrator.md` into `.claude/orchestrator/references/{fanout,resume,state-edge-cases,surface-fanout}.md`, each loaded only when its path actually fires (a `FANOUT_REQUESTED:` return, a `--resume`, a background spawn / worktree, or a multi-repo run). A single-repo XS/S run with no fanout signal never pays to carry any of it. Files: `.claude/orchestrator.md`, `.claude/orchestrator/references/**`.

### Fixed

- **Installer upgrade-cleanup for the removed rule files.** Both `install.sh` and `install-cursor.sh` now delete the consolidated per-skill rule files from an upgraded target (`.claude/rules/*.md` and the Cursor `.cursor/rules/*.mdc` ports), so a stale stub can't keep auto-loading the old router alongside the new one; the cleanup lists explicit paths only, so user-authored rules are never touched. `install.sh` also rewrites the `CLAUDE.md` managed import block from the 16-import list to the single `@.claude/rules/fundamentals.md`, ships the new `.claude/orchestrator/references/**`, and fixes a macOS BSD `awk` bug that silently left the stale import block in place on re-sync (a multi-line `-v` variable is rejected by BSD awk — the fresh block is now read from a temp file). Files: `install.sh`, `install-cursor.sh`.

## [2.3.2] - 2026-06-17

### Added

- **`DESIGN.md` (UX/UI) as a seventh doc in the `init-project-docs` suite.** The brownfield onboarding-docs skill now documents a project's UX/UI surface — design tokens, a reusable-component inventory, a mermaid screen/navigation map, the key per-screen states (loading/empty/error/loaded), and interaction & accessibility patterns — alongside the existing OVERVIEW / ARCHITECTURE / TECHSTACK / DATAMODEL / COREFEATURE / API set. Like the rest of the suite it is **grounded in the code**: tokens come from the real theme/Tailwind/CSS files, components from the component directory, and the screen map from the router/page definitions — never a framework's defaults. It is produced **only for a project with a user-facing UI**; for a headless service, pure-API backend, or library it is dropped or left a one-line "Not applicable" stub (the existing skip discipline). It documents the UX the code *already implements* — the brownfield counterpart to the forward-looking `uxui` / `/uxui-plan` design plan. The `document.html` viewer slots `DESIGN.md` into canonical reading order after `API.md`. Files: `.claude/skills/init-project-docs/SKILL.md`, `.claude/skills/init-project-docs/references/doc-templates.md`, `.claude/skills/init-project-docs/scripts/build_doc_viewer.py`.

## [2.3.1] - 2026-06-17

### Added

- **A ponytail-style "decision ladder" in `coding-discipline`.** Principle 2 (Simplicity First) now opens with an explicit, ordered ladder — **does it need to exist? → standard library → native platform feature → already-installed dependency → one line → only then minimal code** — so the agent reaches for the laziest correct solution before writing new code. It carries a *"lazy, not negligent"* guard (trust-boundary validation, error/data-loss handling, authorization, and accessibility are never on the chopping block; a *new* dependency is not a free rung — `security-fundamentals` owns that call). `engineer` (Mode A) and `lead` (review) point at it rather than restating it. Adapted from the [ponytail](https://github.com/DietrichGebert/ponytail) concept. Files: `.claude/skills/coding-discipline/SKILL.md`, `.claude/agents/{engineer,lead}.md`.

### Changed

- **De-bloated the `/dev` workflow docs by ~840 words with no behaviour change** — applied the workflow's own minimalism discipline to its own prompts. **(1) DRY**: the skill-load budget, the UI visual/a11y-verification procedure, and the registry-path fallback each collapse to one canonical home plus one-line pointers (the "single canonical location + pointers" rule, previously violated by 2–4 verbatim copies each). **(2) Prose-pass**: trimmed defense/rationale prose from the prose-heavy `orchestrator.md` narrative steps (plan / size / digest), keeping every rule, threshold, and state-transition verbatim. **(3) Aside sweep**: removed 14 *"this is the fix for «past complaint»"* calibration-history asides that carried no rule (anecdotes belong in memory, not the always-read prompt). Dense procedure steps were left untouched by design; `orchestrator.md` (the epicentre) dropped ~415 words. Files: `.claude/orchestrator.md`, `.claude/agents/{engineer,lead,pm,qa}.md`, `WORKFLOW.md`.
- **`WORKFLOW.md` now stamps the current release version** at the top, pointing at `VERSION` (source of truth) and `CHANGELOG.md`, kept in lockstep by the release bump. Files: `WORKFLOW.md`, `RELEASING.md`.

## [2.3.0] - 2026-06-16

### Added

- **Team-mode Phase-1 plan slices can now run in parallel on one run — the fix for two concurrent slices clobbering each other's state.** The three Phase-1 plan commands — `/dev-plan` (→ `lead`), `/test-plan` (→ `qa`), and `/uxui-plan` (→ `uxui`) — each need only `spec.md`, so they're independent and always *should* have been parallelisable; but each used to write the **whole** shared `state.json` cursor (read base → re-emit the full object), so two slices running concurrently on the same run was a classic lost update — the second writer clobbered the first's `size` / `field` / `phase_plan`. Each slice now writes its **own shard** instead — `state.plan.json` / `state.test-plan.json` / `state.uxui.json` — and leaves `state.json` and `INDEX.md` untouched; the **gate folds the shards into `state.json` single-writer** (absorbing the plan shard's `size` / `field` / `phase_plan` / `next_step`) at its existing sequential fold point, so the canonical cursor is still written at exactly two points (run creation + gate) and readiness is still derived from the **artifacts** (`plan.md` / `test-plan.md` present, no `[NEEDS CLARIFICATION]`), never a contended cursor field — the shards only carry the metadata an artifact can't express. Three supporting fixes: **(1)** the `/dev-plan` and `/test-plan` worker spawns now tag the prompt's first line with a `team-slice: <plan|test-plan>` token so `dev-state-mark.sh` skips the shared `.last_worker_return` freshness marker for them — a sliced producer owns its shard and never trips the Phase-2 guard, where otherwise a sibling slice's spawn (even sequential, even a separate session) would be false-blocked by `dev-agent-guard.sh` Case 3 against an unchanged `state.json`; `/uxui-plan`'s worker isn't in the marker set, so it was already exempt. **(2)** `/dev --resume` reconciles a team-built run: a stale `spec` / `plan` cursor with shards present routes to the gate (whose fold absorbs them) instead of replaying a `plan` / `test-plan` step whose artifact already exists. **(3)** `/implement`'s gate-if-needed step folds the shards before its consistency scan, so a run gated via `/implement` picks up the sharded `size` / `field` / `phase_plan` exactly as a `/dev --resume` gate does. Chosen over an append-only JSONL log because the fold point is already single-writer and the shard-per-owner shape needs no replay. Canonical: `orchestrator.md > State discipline > Team-mode Phase-1 sharding`. Files: `.claude/orchestrator.md`, `.claude/commands/{dev,dev-plan,test-plan,uxui-plan,implement}.md`, `.claude/hooks/dev-state-mark.sh`, `CLAUDE.md`, `WORKFLOW.md`.

## [2.2.0] - 2026-06-16

### Added

- **`/dev` fanout is now planned, gated, and recorded — the fix for "I didn't see the team fan out to help."** Parallel `team-*` fanout used to be an invisible runtime decision; now `lead` declares a **`## Fanout plan`** in `plan.md` — one row per **gate-authorized Phase-2 phase** (Review / Security / Test / Implement; plan-fanout and spec-prep run before the gate, so they're telemetry-only), each `Fanout` y/n · `Workers (×N)` · `Reason` — the **gate surfaces it for sign-off** with a new `fanout <phase> on|off` lever, and the runtime outcome of every fanout point is logged to **`state.json > fanout_log`** (name-keyed, broader than the gated plan) so `retro` can surface under-firing as a calibration finding instead of a vibe. The Implement row is **derived from** the `Parallelizable: yes` phase markers (single source of truth), and a gated `on`/`off` is a soft override (it can't defeat the hard disjointness/independence guardrails or the size-tier machinery). Three supporting fixes: **(1) registry preflight** — whether `team-*` are live or need the inline `general-purpose` fallback is decided once per run and recorded in **`state.json > team_registry`** (threaded into worker prompts), so a session-scoped registry miss never silently downgrades a fanout to single-pass; **(2) N copies of the same worker is first-class** — a fanout spawns one `team-*` instance per independent unit (one explorer per integration point, one reviewer per security bucket, one analyzer per test category), recorded as the `×N` column, not limited to one-of-each; **(3) direct nesting is the preferred dispatch** for read/research fanout (the worker self-dispatches its helpers, skipping the orchestrator's collect-then-re-spawn double spawn), with the `FANOUT_REQUESTED:` signal reserved for background implement-fanout and the registry fallback. Canonical: `WORKFLOW.md > Fanout plan`.
- **Surface (per-repo) fanout now nests instead of background-dispatching — plus four calibration fixes from an 11-repo control-plane trace.** When a control-plane `/dev` run spans multiple repos, review / security / test fan out *per repo*; that dispatch was reworked and four adjacent gaps the trace surfaced were closed:
  - **Coordinator nesting (no background, no guard self-block).** The orchestrator now spawns **one** foreground `lead`/`qa` *Surface-coordinator* that **direct-nests one `general-purpose` per-repo helper per repo** and synthesises in the same spawn — replacing the old orchestrator-direct `run_in_background` batch (whose one-message launch reliability was inferred-never-verified, and whose foreground equivalent self-blocked on the 2nd spawn under `dev-agent-guard.sh` Case 3). `general-purpose` helpers fall through Case 3 exactly like the lens axis's `team-*`; `> 6` repos nest in waves of ≤ 6. (`lead`/`qa` hold `Agent` — Claude Code v2.1.172+.)
  - **Cross-repo coherence for coupled changes.** Per-repo review reads each repo in isolation — blind to a cross-repo skew on a *coupled* change (a shared proto/schema/contract every repo regenerates from: repo A on v2.1, repo B still on v2.0). The coordinator's synthesis now runs a cross-repo coherence check on coupled changes (review: contract version/signature agreement across all repos; test: a cross-repo integration test covers the boundary), gated on the same independent-vs-coupled axis the size picker uses.
  - **Wide-but-shallow right-sizing.** A parallel *sweep* — the same trivial edit across N **independent** surfaces with no shared contract — is now sized by its **deepest single surface**, not inflated to M/L by repo count; width drives the per-repo review/test fan-out, not ceremony depth. The size picker's "crosses > 1 subsystem → L" rule now keys on *coupling*, not raw count.
  - **Submodule control-plane detection.** Repo detection now matches `.git` whether it is a directory **or** a file (`find … -name .git \( -type d -o -type f \)`) — a git submodule's `.git` is a gitdir-pointer *file*, so the old `-type d`-only scan mis-read a submodule-based control-plane as a single repo.
  - **Engineer bounded verification (wait ≠ retry).** `engineer` now separates *waiting* for a slow-but-converging check (use the runtime's own `--wait`/timeout) from *fixing* (≈ 2–3 distinct attempts, each changing one thing, then **STOP** and return a `BLOCKER:` with evidence) — so a fiddly runtime probe can't silently loop the run.

  Files: `.claude/orchestrator.md`, `.claude/agents/{engineer,lead,qa}.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `.claude/skills/plan-writing/references/size-tiering.md`.
- **`/init-project-docs` skill — generate an onboarding documentation suite for an existing (brownfield) codebase.** Reads the code and produces `OVERVIEW.md`, `ARCHITECTURE.md`, `TECHSTACK.md`, `DATAMODEL.md`, `COREFEATURE.md` (with mermaid sequence diagrams), and `API.md`, plus a self-contained `document.html` viewer that renders them all. Triggers on "document this codebase / init docs / generate project documentation" (and the Thai equivalents). Files: `.claude/skills/init-project-docs/`.
- **The `/dev` improve phase (7½) now leads with an explicit simplification pass.** `engineer` Mode D runs a `team-code-simplifier`-style simplification pass *first* — reduce the complexity the change introduced (shorten long functions, drop duplication/dead branches, flatten tangled conditionals) — and only then the cosmetic touch-ups (rename, tighten types). Behaviour-preserving and bounded to the touched code as before; reducing complexity is the point of the phase, cosmetics ride second.
- **`/dev` now makes greenfield-vs-brownfield a first-class axis and enforces the brownfield discipline `understand → lock → change → improve`.** A new **`field`** slot (`greenfield | brownfield`, recorded in `state.json` next to `type`/`size`) formalises the "new project vs existing codebase" detection the command already claimed to do. **greenfield** = new, isolated code (nothing imports it, no published contract, no integration with existing code; always XS/S); **brownfield** = the change modifies/extends existing behaviour or wires into existing code (the default — every `fix`/`refactor` and every M/L run). The orchestrator estimates `field` at the digest; `lead` re-derives it at plan time and ratchets greenfield → brownfield one-way via a first-line `FIELD_UPGRADE: brownfield` signal (parallel to `SIZE_UPGRADE`). The classification gates three mechanisms, closing the "added a feature to existing code and broke what already worked" hole that the old `Type`/`Size`-keyed triggers left open:
  - **Understand** — the `Current state` map trigger moves from "M/L or refactor/fix" to **brownfield** (which subsumes it). A **brownfield `feat` at XS/S** is no longer exempt just because it's small — it now carries a *proportional* current-state note (entry point + blast radius of the touched code); greenfield skips the section entirely. (`plan-writing > principle 3` + `references/current-state.md` + `references/self-review.md` Scan 4 + `lead.md` step 5 + the section-gating table.)
  - **Lock** — the characterization **baseline** contract, previously refactor-only, now also covers a **brownfield `feat` that edits existing behaviour not already covered by a test**: `lead` makes baseline-capture step 1, `engineer` captures + commits it before the feature change, and `qa` verifies it pre-change (a greenfield feat has nothing to pin and skips it). (`test-plan.md` template + `qa.md` + `engineer.md` + `lead.md` + `plan.md` template.)
  - **Improve** — a new bounded post-test phase **7½** (`engineer` **Mode D**): with the suite green, a **behaviour-preserving** cleanup of *only the code the run changed to deliver spec/plan* (bounded to the spec/plan-approved footprint — `plan.md`'s `Files touched` — **not the engineer's discretion**; pre-existing code the change merely *exposed* is a follow-up, not this phase), re-verified green. Commit handling is type-aware — a separate `[improve]` commit for `fix` (clean tree after implement), or folded into the ship commit for `feat` (uncommitted until ship, like the docs phase). It runs for a brownfield `feat` (and optionally a brownfield `fix`); a `refactor` skips it (the refactor *was* the improvement) and greenfield skips it (right shape the first time). It does **not** re-trigger review or test (security re-runs only if the cleanup touched a security sink); the safety contract is bounded scope + behaviour-preserving + re-verified green suite. Improvement that would spread beyond the touched code is appended to `FOLLOWUPS.md` as a `refactor` follow-up rather than widened in place. Numbered 7½ (mirroring the 2½ test-plan slot) so phases 8–10 don't renumber and the state machine / hooks are untouched. It is the fourth **discretionary** phase (the gate can `skip 7½`) and the lowest-stakes one — a skip waives no contract.

  Canonical `field` definition lives in `plan-writing > references/size-tiering.md > Greenfield vs brownfield`; `orchestrator.md`, `lead.md`, `WORKFLOW.md`, and the plan/test-plan templates point there. The marketing/demo site is kept in sync — the flow string and diagram gain the `(improve)` phase, the engineer card gains its fourth (`improve`) mode, the type matrix gains a `7½ Improve` row, and the gate gains the `skip <n>`/`run <n>` per-task-phase-plan levers. Files: `.claude/skills/plan-writing/references/{size-tiering,current-state,self-review}.md`, `.claude/skills/plan-writing/SKILL.md`, `.claude/orchestrator.md`, `.claude/agents/{lead,engineer,qa,retro}.md`, `.claude/commands/{dev,implement}.md`, `.workflow/_templates/{state.json,plan.md,test-plan.md,tests.md}`, `WORKFLOW.md`, `README.md`, `CLAUDE.md`, `website/index.html`, `website/app.js`, `website/demo/index.html`, `website/demo/src/slides/{flow,types,agents,gate}.js`.

- **`/dev` qa gains two trigger-based test capabilities that reuse existing machinery (no new always-on cost).** (1) **Contract test** is now a Coverage-plan level — when `plan.md` declares a `## API / event contracts` section, `qa` plans a contract test on the request/response or event shape both sides depend on (consumer-driven when a separate consumer exists; folds into integration for fanout + floors), completing the pyramid for public-contract changes. (2) **Accessibility (a11y) check** rides the existing UI-triggered visual-verification pass — `qa` runs axe-core (or the stack's equivalent) in the **same** browser session the screenshots already use (no extra browser, no Chromium cost), treating a serious WCAG violation (contrast, missing accessible name/role) as blocking like a layout defect and a best-practice nit as an `Edge-case gap`. Both are type-gated (feat/fix/refactor) and fire only on their trigger. Files: `.claude/agents/qa.md`, `WORKFLOW.md`, `README.md`.

## [2.1.1] - 2026-06-16

### Changed

- **The XS/S fast path now designs the whole contract in one spawn — `spec.md` + `plan.md` + `test-plan.md` — instead of two.** For `feat`/`fix`/`refactor`, the combined `lead` spawn (the path that already skips `pm` and merges spec+plan for XS/S runs) now also writes `test-plan.md` in the same pass, so there is no separate `qa` design-time spawn and no orchestrator-inline test-plan write: one design-time spawn produces all three artifacts the gate signs off. `lead` writes the test-plan as an adversarial check on the plan it just wrote (every AC verifiable, the unhappy path stated, a reachable security/data-integrity `undefined` returns a first-line `BLOCKER:`), and the orchestrator's step-8a test-plan check + the pre-gate consistency scan run on the artifact `lead` already produced. `/implement` (Phase-2 entry) and a gate test-plan-revise correctly fall back to writing/editing the test-plan inline, since there is no combined `lead` spawn to fold into at those points. Files: `.claude/agents/lead.md`, `.claude/orchestrator.md`, `.claude/commands/{spec,implement}.md`, `README.md`, `WORKFLOW.md`.

### Fixed

- **`/dev` calibration round 3** (from a third `/dev` trace) — five surgical fixes that close behaviour-drift and cost gaps the run surfaced, no new features:
  - **Plan-adherence reconciliation (`qa` step 2b + orchestrator test phase).** A behaviour the gate-approved `plan.md` (a Step *or* a `Risks`-table mitigation) or `test-plan.md` (a Coverage row or a `Specified` edge case) **named**, where the diff does the **opposite**, is now a `[plan-contradiction]` — `qa` asserts the specified behaviour and **never weakens an assertion (or renames a weaker test) to go green** against a divergent implementation, and never files it under `Edge-case gaps` (that bucket is spec-*undefined* inputs only). The orchestrator reconciles it before ship (match the plan → `engineer`, or amend the contract at a mini-gate), never ships the contradiction as a one-line follow-up. `engineer` is told explicitly that "the plan" is **not only the numbered Steps** — a `Risks` mitigation or a `test-plan` `Specified` behaviour binds the same way.
  - **Settled-render visual verification.** `qa` captures each viewport on a *settled* render — `animations: "disabled"` **and** the transition waited out — because a mid-transition frame (washed-out background, faded text) reads as a contrast/readability defect the running app does not have. Findings are recorded as **observations, not source diagnoses**: before naming any cause `qa` greps the CSS/JS to confirm it (a present-but-mid-transition value is a capture artifact, not a source bug), and an unconfirmed cause goes up as a flagged hypothesis, never a confident diagnosis the orchestrator would route straight to a fix.
  - **Capture-first defect validation (orchestrator).** Before spawning `engineer` for a visual defect (from `qa` or its own MCP backstop), the orchestrator confirms the shot was a settled render and greps any claimed source cause itself — one grep + a re-read is far cheaper than burning a whole `engineer` cycle on a capture artifact; a defect that survives both checks is the only one worth a cycle.
  - **System-browser test runner.** `qa`'s `Execution mechanism` now defaults a web browser runner to the system-installed browser via Playwright's `channel` (`channel: 'chrome'` / `'msedge'`), driving the Chrome/Edge already on the machine with **no multi-minute Chromium download** — bundled Chromium is the fallback only when no system browser exists. The gate signs the chosen `channel` off so execute mode configures it without re-downloading.
  - **Review model exception narrowed.** The "keep opus" review exception for a "substantial test change" now means **test-*infrastructure* churn** (a new harness, reworked fixtures, mass rewrites) — **not** a high *count* of straightforward new tests, which on a fast-path feature is normal coverage; on XS/S, sonnet stands regardless and a contract/test-infra signal is a size-upgrade consideration, not an opus-on-S escalation.

  Files: `.claude/agents/{engineer,qa}.md`, `.claude/orchestrator.md`.

## [2.1.0] - 2026-06-15

### Added

- **Team-mode commands — `/dev` is no longer all-or-nothing; each role can be handed to the person who owns it.** `/dev` runs the whole pipeline in one shot; team mode breaks that same flow into five role-scoped slash commands so a team can divide the work — the PM takes `/spec`, the tech lead takes `/dev-plan`, QA takes `/test-plan`, the UX/UI designer takes `/uxui-plan`, and the engineer takes `/implement` — while every command writes into the **same `.workflow/<id>/` run folder**, so the artifacts still compose and the run is still resumable with `/dev --resume <id>`. Mechanics are identical to `/dev`: the command's main agent plays the orchestrator (interview/gate + single-writer `state.json`); the named worker does the file work; the spawn guard still requires calling workers by name. Specifically:
  - **`/spec <intent>`** — runs the Phase-1 interview, then `pm` writes `spec.md`, and stops at `step=spec`. Always spawns `pm` (no XS combined-mode shortcut — it is the PM command). Pass a run id to refine an existing spec (spec-patch mode).
  - **`/dev-plan [id]`** — runs plan-prep fanout, then `lead` plans against the spec (`plan.md`/`epic.md`; sonnet by default, opus for L-tier — schema/contract/cross-subsystem), runs the plan check, stops at `step=plan`. No gate, no build.
  - **`/test-plan [id]`** — `qa` designs `test-plan.md` (coverage per AC, edge cases, fixtures, regression/baseline contract) against `spec.md` + `plan.md`, before any code. Needs a spec; warns if there is no plan yet; chore/docs/spike get none.
  - **`/uxui-plan [id]`** — the new `uxui` agent writes `uxui-plan.md` (Scenes, Scenarios, UX direction & components, AC↔scene mapping) for UI-bearing work, driving `ui-ux-pro-max` / `frontend-design`. Design only, no UI code; it leaves the resume cursor untouched (not a linear state-machine step).
  - **`/implement [id]`** — the Phase 2 entry point for when the plan is already done: confirms the run is ready (spec + plan + test-plan, producing a missing test-plan as a gate prerequisite), runs the **gate** if the run has not been approved yet (human sign-off before autonomous work never shrinks), then runs the whole autonomous build — implement → review → security → test → docs → ship → retro. Same Phase 2 and same `state.json` as `/dev`, so `/implement <id>` and `/dev --resume <id>` are interchangeable mid-build.
  - Files: `.claude/commands/{spec,dev-plan,test-plan,uxui-plan,implement}.md`.
- **New `uxui` sub-agent + `uxui-plan.md` template — a design-time UX artifact the `/dev` flow never had.** `uxui` (sonnet) reads `spec.md` and the existing design system, then writes the Scenes (every screen/state, including the empty/error states implementers skip), Scenarios (user journeys across scenes, happy path + the spec's `on error / at boundary` flows), UX direction & components, and an AC↔scene mapping that catches orphan scenes (scope creep) and unmapped ACs (design gaps) — the UX analogue of `test-plan.md`'s coverage plan. It holds `Agent` for one-level UX-research fanout (`team-best-practice-researcher` / `team-codebase-explorer`) and is reused by `qa`'s visual-verification pass at the test phase. Files: `.claude/agents/uxui.md`, `.workflow/_templates/uxui-plan.md`, `.claude/agents/{INDEX,TEAM}.md`.

### Changed

- `install.sh` now ships the **whole** `.claude/commands/` directory (was just `dev.md`) and the new `uxui-plan.md` template, so future commands need no manifest edit. `install-cursor.sh` ports every team-mode command into `.cursor/commands/` with a Cursor-port banner inserted **after** the YAML frontmatter (the frontmatter stays on line 1); the `uxui` agent and `uxui-plan.md` template are picked up automatically by its directory globs. The `dev-agent-guard.sh` PreToolUse guard learned `uxui` so a `general-purpose` spawn mislabeled `uxui:` is blocked the same way the five `/dev` workers are. Files: `install.sh`, `install-cursor.sh`, `.claude/hooks/dev-agent-guard.sh`, `README.md`, `WORKFLOW.md`, `CLAUDE.md`.

### Fixed

- **`/dev` calibration round 2** (from a second `/dev` trace, run `0002-feat-todolist-website`) — four surgical workflow fixes: (1) **plan-writing** gains a trust-boundary skill-load bullet so the *planner* engages `security-fundamentals` and names the safe construction in the step (`textContent`, not `innerHTML`) — the root cause of an `innerHTML`-in-plan XSS near-miss, since the always-on security rule only fires at code-write time and the combined fast path loads skills lightly; (2) **orchestrator gate (step 9)** — a resolved `undefined → spec gap` now triggers a `test-plan.md` sync independent of any AC change (and an inline `spec.md` patch carries the matching `test-plan.md` edit), fixing the doc-drift where the gate decision lands in `spec.md` while `test-plan.md` still reads "spec gap"; (3) **orchestrator security trigger (step 12)** now scans diff **content** (added lines for `innerHTML`/SQL/`exec` sinks), not just `--name-only` — a filename can't reveal a sink, so a path-only scan would wrongly apply the `localStorage` carve-out to a diff that actually contains an `innerHTML` (a stored-XSS false-negative); (4) **retro + orchestrator (step 17 / XS-inline)** — sub-bar memory/skill candidates are reported `not proposing — <reason>` rather than raised as an `AskUserQuestion`, and memory candidates are no longer gated by a question at all. Files: `.claude/agents/retro.md`, `.claude/orchestrator.md`, `.claude/skills/plan-writing/SKILL.md`.

## [2.0.2] - 2026-06-15

### Added

- **The `/dev` test phase gains visual verification for UI-touching changes — a content-trigger that screenshots the rendered output and eyeballs it, catching layout defects DOM assertions miss.** When a diff changes rendered UI (`.html`/`.css`/`.jsx`/`.tsx`/`.vue`/`.svelte`/templates/styling), `qa` now adds a visual pass — because a DOM assertion proves structure, not appearance (`scrollWidth ≤ width` proves "no horizontal scroll" but NOT that a title doesn't break mid-word on a phone — the exact bug a real run shipped past `scrollWidth`-green tests). `qa` test-plan mode designs the check (viewports to inspect + the visual properties an eye must confirm: no mid-word break / overflow / clipping / overlap / unreadable truncation, correct stacking, legible contrast) into `test-plan.md > Visual verification`; execute mode captures each viewport **by reusing the e2e browser already open** — never booting one just to screenshot (that is the Chromium-install cost) — views the PNGs via `Read`, and treats a real layout/readability defect as **blocking** (sets `tests.md` Status = `failing` → `engineer`), a cosmetic nit as a follow-up. When no reusable live browser session exists (jsdom-only e2e, no e2e at all, or no browser tooling), `qa` defers to an orchestrator backstop that renders the surface and eyeballs it via the `claude-in-chrome` MCP (degrading to an `AskUserQuestion` + tracked follow-up when even that is absent, never a silent skip). It is type-gated inside the feat/fix/refactor test phase (never fires for chore/docs/spike) and carries through surface (multi-repo) fanout. Files: `.claude/agents/qa.md`, `.claude/orchestrator.md`, `WORKFLOW.md`, `.workflow/_templates/{test-plan,tests}.md`.

### Changed

- **`/dev` right-sizes self-contained greenfield work to the S fast path, and the security review stops firing on first-party browser storage.** Two calibration fixes that keep a trivial build from paying a migration's process cost. **(1) Greenfield sizing.** A brand-new, isolated module (nothing imports it yet, no published contract, no integration with existing code, first-party storage only) now caps at **S regardless of file count** — a 3-file vanilla CRUD app is S, not M — because blast radius, not feature breadth, is what M-tier machinery (separate `pm`+`lead` spawns, fanout eligibility, full retro) exists to cover. The size-tiering picker (step 3, the "security-sensitive path → bump a tier" signal, a new greenfield override signal + edge case + glance-table note + torn-rule exemption) and the orchestrator's digest quick-test both encode it, so a greenfield toy lands S at estimate time and `lead` can't ratchet it up. **(2) Security trigger carve-out.** A first-party `localStorage`/`sessionStorage`/`IndexedDB` round-trip of the app's own single-user data (the app reading back what it wrote, rendered via `textContent`) is no longer an untrusted-`deserialise` trigger for the phase-6 review — *unless* the diff carries a dangerous HTML-injection sink (an **open** list: `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`Function`/React `dangerouslySetInnerHTML`/jQuery `.html()`/…, each itself a "raw HTML render" trigger that fires regardless) or the data crosses a real trust boundary (multi-user / shared-device, or server-/other-principal-written). Files: `.claude/skills/plan-writing/references/size-tiering.md`, `.claude/orchestrator.md`, `WORKFLOW.md`.
- **`/dev` lightens the trivial-work path — a one-shot test-runner veto, a no-git short-circuit, leaner spawn prompts, and browser reuse.** Four cost cuts that don't weaken the contract. **(1) Test-execution one-shot.** `qa` test-plan now picks an automated headless runner proactively (instead of defaulting to "manual" and eating a gate-revise round-trip) and documents the dev-tooling-vs-app-runtime separation; the gate surfaces *any* newly-introduced runner for a single veto, and execute mode installs a gate-approved runner without re-asking. **(2) No-git short-circuit.** When `repo_root` is null the orchestrator decides no-git **once** and treats every VCS gate (branch, diff-checks, review/security git scans, the test-phase diff read, ship/CI) as a silent no-op instead of re-deliberating it each phase (the per-step guards are unchanged — this is purely additive framing). **(3) Spawn-prompt norm.** Spawn prompts now pass a pointer + the delta a worker can't derive and point at the authoritative artifact, rather than re-paraphrasing a spec/plan the worker is about to read (which spent orchestrator output and created a second source of truth that could drift). **(4) Browser cache.** `qa` reuses a cached browser binary and one session for both e2e and the visual pass, never reinstalling Chromium per run (the dominant cost of a browser test phase). Hardened by three rounds of fresh-agent adversarial review (which caught and fixed a real one: an earlier closed dangerous-sink list omitted React `dangerouslySetInnerHTML`, a stored-XSS path the carve-out would have suppressed) — converged. Files: `.claude/agents/qa.md`, `.claude/orchestrator.md`, `WORKFLOW.md`, `.workflow/_templates/test-plan.md`.

### Fixed

- **`/dev` run-metrics now measure build→ship exactly instead of approximating from `last_updated`.** `done_at` is stamped just before the retro spawn (step 16) rather than at the final "done" step (18, *after* retro had already read it as null and fallen back to an approximation) — so the wall-clock duration `retro` records is the real build→ship time, the data point that answers "where is the workflow overhead?". The XS inline-retro path stamps it too, and `retro` labels the metric build→ship with a documented null-fallback. Files: `.claude/orchestrator.md`, `.claude/agents/retro.md`, `WORKFLOW.md`.

## [2.0.1] - 2026-06-14

### Added

- **`claude-foundation` gains `init`, `version`, and `help` subcommands.** `init [target-path] [options]` is an explicit alias for the installer (the bare `claude-foundation [target-path]` form still works unchanged); `version` (also `--version` / `-v`) prints the release from a new root `VERSION` file — cli.sh's machine-readable source of truth, read relative to the script so it works from both a source checkout and the Homebrew libexec, with a `git describe` fallback; `help` (also `--help` / `-h`) prints a top-level command map and points at `claude-foundation init --help` for the full installer flags. The Homebrew formula ships `VERSION` when present and otherwise synthesizes it from the formula version (so stable tarballs predating the file still report correctly without clobbering HEAD builds), and its `test` block now asserts `version` output. `RELEASING.md` adds a `VERSION` bump step (kept in lockstep with the tag). Files: `cli.sh`, `VERSION` (new), `Formula/claude-foundation.rb`, `RELEASING.md`, `README.md`.

## [2.0.0] - 2026-06-14

### Added

- **`/dev` shifts test design left into a gate-approved `test-plan.md` (new Phase-1 step 2½).** When the spec and plan finish — before any code — `qa` (a new design-time **test-plan mode**) writes `.workflow/<id>/test-plan.md`: a coverage plan mapping every acceptance criterion (happy path AND its `on error / at boundary:` clause) to the test **level** that owns it and what each test asserts, the **edge cases to probe** (discovered against the plan, not the diff — the shift-left of `qa`'s old phase-7 step-2a discovery, so the engineer handles them during implementation instead of QA finding gaps after), what's **out of test scope**, the **fixtures/data/environment** a run needs, and the type contract (regression contract for `fix`, characterization baseline for `refactor`) plus the per-level coverage targets. It's authored after `plan.md` (so it can cite files-touched), **surfaced at the gate** alongside the spec ACs and plan scaffold so the user signs off *how it'll be proven* next to *what's built*, and a wrong level / missing case is a `revise` routed to `qa` test-plan-revise mode. `tests.md` is now the **execution record** only — `qa` (now **execute mode**) runs the agreed plan and records actual AC→test mapping, results, measured diff-coverage, and any edge-case gaps found, rather than designing and executing in one late step. Type-gated to `feat`/`fix`/`refactor` (the types whose test phase runs; `chore`/`docs`/`spike` skip it via `skipped_steps`), size-aware (written inline by the orchestrator at XS, mirroring inline-retro; a `qa` spawn at S+). The gate consistency scan now also requires every AC to have a `test-plan.md > Coverage plan` row, and resume understands the new `test-plan` / `revise-test-plan` cursors. `artifact-lint.sh` gains a `test-plan.md` rule (a `## Coverage plan` section + an AC reference) with 5 new fixture assertions. The `engineer` now reads `test-plan.md` so it builds the planned edge cases during implementation, and `retro` lifts any surviving design-time test gaps into follow-ups. Both installers ship the new template. Hardened by two rounds of fresh-agent adversarial review (type×size gating, resume/state-machine, cross-file consistency, qa dual-mode coherence) — all findings applied. Files: `.workflow/_templates/test-plan.md` (new), `.workflow/_templates/tests.md`, `.claude/agents/qa.md`, `.claude/agents/engineer.md`, `.claude/agents/retro.md`, `.claude/agents/INDEX.md`, `.claude/orchestrator.md`, `.claude/commands/dev.md`, `WORKFLOW.md`, `.claude/rules/testing-fundamentals.md`, `.claude/skills/testing-fundamentals/SKILL.md`, `.claude/skills/qa-handoff-note/SKILL.md`, `.claude/hooks/artifact-lint.sh`, `.claude/hooks/tests/run-artifact-lint-tests.sh`, `install.sh`, `install-cursor.sh`, `README.md`, `website/index.html`, `website/demo/index.html`, `website/demo/src/slides/{artifacts,agents}.js`.
- **The `/dev` test phase gains per-level diff-coverage floors on the changed code — unit ≥80%, integration ≥70%, e2e ≥50% of the change's critical user journeys.** `qa` measures coverage on the **diff** (never the whole repo) after the green run and records each in-scope level in a new `tests.md > Coverage (diff vs floor)` table. Each floor is measured over the **slice that level owns** — unit over the unit-testable changed lines, integration over only the *boundary-crossing* changed lines (so the integration floor never fires against pure logic in the same diff), e2e over the critical journeys — and a level whose slice is empty has no floor. The floors are **advisory ratchets, not a hard gate** (consistent with `testing-fundamentals` Principle 7's "ratchet, not a bar"): a below-floor level is a finding the orchestrator escalates via `AskUserQuestion` — accept the gap (→ `retro.md` follow-up) or send it back to `engineer` to add the missing tests (bumps `cycles.test`) — it never sets `tests.md` status to `failing` on its own, and `qa` must not pad coverage with trivial tests to clear a number. e2e is scored by **critical-journey coverage**, not line coverage, so the test pyramid stays right-side-up; e2e uses **Playwright** for web/browser journeys and the stack's own runner otherwise (no new framework introduced where none exists). A floor applies only where its level is in scope for the change. The single-instrumented-run-split-by-level path keeps `qa`'s one-command rule intact, with one bounded per-level coverage pass as the only sanctioned exception. Files: `.claude/skills/testing-fundamentals/SKILL.md`, `.claude/agents/qa.md`, `.workflow/_templates/tests.md`, `.claude/orchestrator.md`, `WORKFLOW.md`, `README.md`, `website/index.html`, `website/demo/src/slides/agents.js`.
- **`plan.md` gains a `## Scaffold` section — the concrete skeleton the gate signs off before a long build.** Plan-writing **principle 10**: for **M/L** plans, `lead` writes a `## Scaffold` block after the Architecture diagram — the target file tree (`★` new · `~` edited) with each new/changed file's key exported signature(s) inline (interface/type/function → params → return/error), plus the definition of any consumed type whose shape is itself a decision (discriminated union / value object / state enum) — the illegal-state-representable check the reviewer should see, not just the signature that takes it. Signatures + type shapes + one-line stubs only (no real bodies — that's early implementation smuggled past the gate). It **subsumes `## Folder structure`** for M/L (the tree lives in Scaffold), and `## API / event contracts` shrinks to only the field/error-code detail richer than the one-line signature already shown. The orchestrator surfaces it at the gate so the user signs off the concrete shape — a misplaced boundary, wrong signature, or a type that leaves an illegal state representable is cheap to fix in a skeleton and expensive after hundreds of lines — and the `engineer` builds the skeleton (layout + signatures + type shapes) first instead of inventing the layout. Threaded through the pre-flight checklist, the size-gating table, the self-review scans (a Scaffold-integrity check: section exists, every `★` maps to a `(new)` Step and vice versa, every signature maps to a Step, a decision-bearing type is shown as a definition, the block stays signatures/type-shapes/stubs, no duplicate `## Folder structure`), and an anti-pattern. Files: `.claude/skills/plan-writing/SKILL.md`, `.claude/skills/plan-writing/references/self-review.md`, `.claude/agents/{lead,engineer}.md`, `.claude/orchestrator.md`, `.workflow/_templates/plan.md`, `WORKFLOW.md`, `website/demo/src/slides/artifacts.js`.
- **Surface (per-repo) fanout — a third fanout axis that parallelises a multi-repo control-plane run's read-and-judge phases.** A `/dev` run launched over a tree of sub-repos (the control-plane case, where `repo_root` is the single primary repo) used to have one `lead`/`qa` crawl every sub-repo's diff serially at review, security, and test. The orchestrator now records the full discovered sub-repo list in a passive `state.repos`, and when a cross-repo change touches more than one of them it **fans review (step 11), security (step 12), and test (step 13) out one `lead`/`qa` per changed repo, in the background, in a single message** — then a foreground synthesis re-spawn merges the per-repo blocks into one unified `review.md`/`security.md`/`tests.md` (one `### Repo: <path>` subsection each), with the acceptance-criteria walk, aggregate verdict, and cycle counter staying **global** (verdict = pass iff every repo passes; security = fix-required iff any repo has a `high`; one cycle bump per fanout). It is orthogonal to the existing *lens* axis (the 6 review workers on one diff) and *category* axis (the test categories), and is **orchestrator-owned — it carries no `FANOUT_REQUESTED:` signal**, since the repo list is known at dispatch time. `retro` (step 16) also reads every changed repo's diff but stays a **multi-repo-aware single pass** (it synthesises the already-unified per-repo sections; no `Agent`). The honest boundary of this slice: branch/implement/gate/ship stay scoped to the single primary `repo_root`, so a blocking review finding, failing test, or `high` security finding in a **non-primary** repo is *found* in parallel but has **no auto-fix path** — the orchestrator surfaces it to the user instead of routing to `engineer` (which would edit the wrong repo). Full multi-repo targeting (per-repo branch/implement/ship) is tracked as `FOLLOWUPS.md` F0001. Files: `.claude/orchestrator.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `.claude/agents/{lead,qa,retro}.md`, `.workflow/_templates/{review,security,tests,state.json}`, `.workflow/FOLLOWUPS.md`, `WORKFLOW.md`, `README.md`.

### Changed

- **`/dev` fanout flips from opt-in to delegation-first, and the splittable workers now self-dispatch their helpers via direct nesting (Claude Code v2.1.172).** Two coupled shifts to how parallel work is decided and dispatched. **(1) Delegation-first stance.** A new `.claude/orchestrator.md > Delegation-first` section makes parallel fanout the **default** for any phase whose sub-investigations are independent — "spawn parallel helpers first; single-pass is the exception you justify," not the old "opt-in, default single-pass." The per-phase heuristics in `lead` (plan + review), `qa` (test), and `engineer` (implement) are reworded to "default to fanout when domains are independent," gated only by four named feasibility guardrails (no independent domains · not disjoint · cost clearly loses · type/ordering forbids it); `pm` stays the deliberate exception, because its research fanout is draft-first and judgment-gated and the proactive default lives in the orchestrator's step-6 push. The guardrails *bound* the stance, they don't negate it — the new, more-likely error is staying single-pass on genuinely splittable work. **(2) Direct nesting.** Since a sub-agent can now hold `Agent`, the seven splittable workers (`pm`, `lead`, `qa`, `engineer` plus the self-splitting `team-codebase-explorer`, `team-best-practice-researcher`, `team-code-reviewer`) are granted `Agent` and **spawn their own helpers directly** when their work is large — each gains a "Recruit help when the work is large" section with a trigger, helper type, cap, disjointness rule, and a one-level-of-split guard: every helper prompt ends with a literal "you are a nested helper — do NOT spawn further agents" line, since a fresh-context helper is otherwise indistinguishable from a top-level dispatch. The other five `team-*` review workers stay read-only with **no `Agent`**. The orchestrator-mediated `FANOUT_REQUESTED:` signal is **retained as the fallback** (and as the path for background implement-fanout, where phase-granular `state.json > impl_phases_done` resume is wanted). What never changes regardless of path: only the orchestrator calls `AskUserQuestion` (a helper that hits genuine ambiguity returns a `BLOCKER:`), `state.json` stays single-writer (helpers never write it), and implement-fanout still re-verifies pairwise-disjoint `Files touched (exclusive)` before dispatch. Implement-fanout is also tightened to **feat-only**, driven by a plan's `Parallelizable: yes` phases (`fix`/`refactor`/`spike` have a step-1 ordering that parallel phases break). Files: `.claude/orchestrator.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `.claude/agents/{pm,lead,qa,engineer,team-codebase-explorer,team-best-practice-researcher,team-code-reviewer,TEAM}.md`, `.claude/commands/dev.md`, `.workflow/_templates/{plan,state.json}`, `CLAUDE.md`, `WORKFLOW.md`, `README.md`.
- **`hexagonal-backend` skill rewritten around driving vs driven ports and the Go `core/port/adapter` idiom.** The skill gains an explicit *Two kinds of ports* section distinguishing **driven (secondary) ports** — what the application needs from outside (`OrderRepository`, `PaymentGateway`), implemented by driven adapters — from **driving (primary) ports** — the use-case surface (`OrderService`) the application offers, depended on by driving adapters — with the judgement call of when a driving-port interface earns its keep (many entry points: HTTP **and** queue **and** cron) versus calling the concrete use case directly (one caller). The Go example is reworked into the community `core/ port/ adapter/` layout (a composition-root `cmd/main.go`, all ports in one `core/port` package, driving HTTP/AMQP adapters under `handler/`, driven adapters under `storage/`), with a note that TypeScript's `domain/ application/ adapters/` and Go's idiom are the same logical rule under different names. New worked patterns: a **rich domain entity** (unexported fields, an invariant-enforcing constructor, domain errors in business language, no infra tags) replacing the anemic tagged struct most templates ship, and explicit **persistence-model mapping** in the adapter (a `rehydrate` static factory). The `description:` is updated to name driving/driven ports and persistence mapping, and the prose throughout is tightened (241 insertions / 144 deletions). Files: `.claude/skills/hexagonal-backend/SKILL.md`.
- **The read-only `team-*` fanout workers are pinned to least-privilege `tools:` (close hygiene).** Five advisory review workers — `team-code-simplifier`, `team-comment-analyzer`, `team-pr-test-analyzer`, `team-type-design-analyzer`, `team-silent-failure-hunter` — were inheriting the **full** tool set (including `Agent`, `AskUserQuestion`, `Write`, `Edit`) despite only ever reading and reporting; each now declares an explicit `tools: Read, Grep` so it cannot spawn, prompt the user, or edit files. `team-code-simplifier` is additionally **converted from an autonomous code-mutator to advisory (report-only)** — it now recommends simplifications for others (the `engineer` or the calling `/dev` sub-agent) to apply, rather than rewriting code directly, matching the fanout findings contract every other review worker follows (its `INDEX.md` role line is updated to match). The three workers that genuinely split their work (`team-codebase-explorer`, `team-best-practice-researcher`, `team-code-reviewer`) keep `Agent` for direct nesting; which workers hold it and why is documented in `.claude/agents/TEAM.md`. Files: `.claude/agents/{team-code-simplifier,team-comment-analyzer,team-pr-test-analyzer,team-type-design-analyzer,team-silent-failure-hunter,INDEX}.md`.
- **15 skill `description:` fields trimmed back under the authoring budget — the always-on skill-list surface gets lighter without losing a single trigger.** A pass over every `SKILL.md` description found the longest had drifted to 92–120 words (api-design 120, refactoring 118, plan-writing 106, debug 103, brainstorming 102, security 101), well past the ~100-word budget `skill-creator` sets for the always-in-context metadata. The cut targets only **fat**, never trigger muscle: the exhaustive inline **principle enumeration** (the description restated the skill's whole principle list, which the body already carries), the trailing **`Includes references on …`** clauses (discoverable, not a trigger), and the **`[[wikilink]]` relationship sentences** (the bracket syntax doesn't link in a description and the relationship already lives in each skill's body — verified: `[[programming-fundamentals]]` ×5 in `refactoring`, `[[plan-writing]]` ×3 in `brainstorming`, etc.). Every **`Use BEFORE/when …` trigger context, the pushy `even when …` cue, and the full `Skip …` list are preserved verbatim** — `skill-creator`'s own guidance is that Claude *under*-triggers, so the trigger surface stays intact and only the redundant "what it does" prose shrinks. Result: the 13 substantively-trimmed skills land at 71–89 words (api-design 120→74, security 101→73, debug 103→89, plan-writing 106→82, brainstorming 102→82, frontend-design 96→71, …); `refactoring` is deliberately left at 109 because its length *is* the "clean this up / de-duplicate / pay down tech debt" trigger list; `ui-ux-pro-max` and `architecture` are touched only to drop `[[ ]]` brackets. No tightening of the standard — `skill-creator`'s ~100-word budget is unchanged and now simply enforced. Descriptions are not mirrored in README/website/installers (confirmed), so no prose drift. Files: `.claude/skills/{api-design-fundamentals,refactoring-fundamentals,plan-writing,debug-fundamentals,brainstorming,security-fundamentals,concurrency-fundamentals,delivery-engineering,frontend-design,coding-discipline,queue-fundamentals,database-fundamentals,testing-fundamentals,ui-ux-pro-max,architecture-fundamentals}/SKILL.md`.
- **Chain seam disambiguation tightened and de-duplicated — the "which of the 10 fundamentals owns this?" boundaries now read from one scannable map instead of a run-on paragraph restated per rule.** The always-on routing cost of the 10-skill construction chain is the judgment at the blurry seams (concurrency vs queue vs database isolation; api-design vs architecture; security/observability as cross-cutting), and that disambiguation was stated **twice** — once in the canonical `.claude/rules/fundamentals.md` and again restated inside the individual rule files. Two fixes, no routing decision changed: **(1)** `fundamentals.md`'s dense run-on seam paragraph becomes a three-bullet **seam-map** (`concurrency vs queue vs database`, `api-design vs architecture`, `security & observability are cross-cutting`) — same decisions, scannable and consistently formatted. **(2)** The `concurrency-fundamentals` and `api-design-fundamentals` rule files drop the chain-position clause they restated ("it sits between X and Y in the chain …") — `fundamentals.md` is the single source of truth for run-order/seams and loads in the same always-on context, so the rules keep only their own ownership distinction (in-process vs cross-process/isolation; one-API-surface vs runtime-relationship). Left intact deliberately: the **unique** cross-cutting notes in the `security` (design-time vs the `/dev` review), `observability` (proactive vs reactive `debug`), and `refactoring` (safe process vs target shape) rules — not duplicated anywhere; the `ddd-strategic` body's "Skills this sits next to" section — on-demand progressive disclosure, not always-on; and the `WORKFLOW.md` glance-mirror that already points to canonical. Files: `.claude/rules/{fundamentals,concurrency-fundamentals,api-design-fundamentals}.md`.

### Fixed

- **`/dev` durable state hardened against corruption under concurrent runs and resume.** Three durability fixes for the parallel-run and resume paths. **(1) Marker hook run-scoping.** `dev-state-mark.sh` picked the *most-recently-modified* `state.json` as "the active run" — but during an implement fanout this run's own `state.json` is the newest on every phase completion, so a **concurrent sibling run's** worker return cross-touched this run's `.last_worker_return` marker and false-blocked its next spawn under `dev-agent-guard.sh` Case 3. The hook now scopes its marker to the orchestrator's explicit `$CLAUDE_DEV_RUN_ID` (the **same** knob the guard scopes its freshness check to, so the two hooks can no longer disagree on "which run"), falling back to newest-mtime only when the var is unset. **(2) Whole-object `state.json` writes.** The orchestrator now mandates re-emitting the **complete** `state.json` object with `Write` on every update, never `Edit`-ing a single key in — successive single-key appends are how a file ends up with a duplicate key or a missing comma (observed in the field: a run whose `state.json` had two `notes` keys could not be reloaded, breaking `/dev --resume` entirely). **(3) Collision-proof follow-up IDs.** `retro` minted new `FOLLOWUPS.md` IDs as "next number after the highest existing ID," which silently races when two parallel runs both read the same highest ID and both claim it (the duplicate-`F0001`-class corruption); it now mints **run-namespaced `F-<run-id>-NN` IDs** (this run's folder name + a per-run counter starting at `01`), collision-proof by construction, with legacy global `F0001`-style IDs left as-is (a mixed ID space is expected — history is not renumbered). A new `artifact-lint.sh` `check_followups` governance scan enforces the invariant — flagging any duplicate row ID and any `consumed-by:` row left in `## Open` instead of moved to `## Closed` — backed by 5 new fixture assertions (the suite now runs 34). Files: `.claude/hooks/dev-state-mark.sh`, `.claude/orchestrator.md`, `.claude/agents/retro.md`, `.claude/hooks/artifact-lint.sh`, `.claude/hooks/tests/run-artifact-lint-tests.sh`, `.workflow/_templates/spec.md`, `.workflow/FOLLOWUPS.md`.

## [1.6.0] - 2026-06-14

### Added

- **Five new fundamentals skills, closing the software-lifecycle coverage gaps.** A five-lens review found whole disciplines that no skill owned: `security-fundamentals` (the design-time counterpart to the `/dev` security review — threat modeling, input validation, contextual output encoding, authn/authz deny-by-default, secrets/crypto, least privilege, dependency hygiene), `testing-fundamentals` (test strategy/design that was scattered across `programming-fundamentals`, `qa`, and `refactoring-fundamentals` — pyramid, what-to-test, disciplined doubles, behaviour-not-implementation; the canonical home of the edge-case checklist, which `qa` step 2a now points to), `observability-fundamentals` (logs/metrics/traces, correlation, RED/USE, SLOs, alert-on-symptoms — backs the `plan.md > Observability` trigger), `concurrency-fundamentals` (in-process: shared state, atomic critical sections, deadlock avoidance, async/await pitfalls, bounded fan-out — sits between `programming-fundamentals` and `queue-fundamentals`), and `delivery-engineering` (CI/CD as the merge contract, build-once-promote, config/secrets outside the artifact, safe reversible deploys — the delivery-channel sibling to `git-workflow`, backing the new CI ship-gate). Each ships a rule in `.claude/rules/`, a full `SKILL.md` + references, and is wired into the run-order chain (`.claude/rules/fundamentals.md`), `WORKFLOW.md` skill routing, `CLAUDE.md`, and both installers (`install.sh`, `install-cursor.sh`). The construction chain is now `ddd-strategic → programming-fundamentals → concurrency-fundamentals → database-fundamentals → hexagonal-backend → architecture-fundamentals → queue-fundamentals → security-fundamentals → observability-fundamentals`, with `testing-fundamentals` as the verification companion and `delivery-engineering` joining `git-workflow` on the delivery channel.
- **Size-aware execution matrix.** `Size` (XS/S/M/L) is now a first-class run dimension next to `Type`: the orchestrator estimates it from the requirements digest before any question is asked and records it in `state.json`. XS/S runs take a **fast path** — setup + interview fold into one `AskUserQuestion` batch, `pm` is skipped in favour of `lead`'s new **combined spec+plan mode**, review runs sonnet with fanout refused, docs + ship merge into one `engineer` spawn, and retro is inline (XS) or a light spawn (S) — cutting a trivial run from 8+ worker spawns / 7–9 questions to ~4 spawns / 2 batches. The contract never shrinks (interview, gate with per-line AC confirmation, `state.json` discipline, security trigger, type matrix), upgrades are one-way via a first-line `SIZE_UPGRADE: <size> — <reason>` worker signal, and the plan's `Size` field (section gating) is now explicitly distinct from the run size (machinery). Validated end-to-end against sandbox adopter repos (XS chore shipped in 4 spawns; fix-type two-commit regression contract, review fail→fix→pass cycle, and security Mode C all exercised live). Hardened on review: resuming a pre-size run (missing/`null` `size`) always takes the full M/L machinery, never an inferred fast path; the merged XS/S question batch has an explicit drop order when it would exceed the 4-question cap (type → branch, never an interview slot); the orchestrator announces the size + path to the user; and the CI ship-gate probes most-available-first (MCP tool → PR-activity subscription → `gh` CLI, which remote environments often lack). Files: `.claude/orchestrator.md`, `WORKFLOW.md`, `.claude/agents/{lead,engineer}.md`, `.claude/commands/dev.md`, `.workflow/_templates/state.json`, `README.md`.
- **Five SDD verification gaps closed** (from a spec-driven-development gap analysis): a pre-gate **analyze scan** (AC ↔ plan-step consistency on the happy path, not just after `revise`); **CI as the final ship gate** when a PR was opened and CI is reachable (failures route back to `engineer` on the test-cycle budget); a **`Hard-to-reverse decisions`** plan section the gate lifts for explicit per-line human confirmation (schema/API-contract/architecture/backfill); a **spec-drift amendment contract** (`engineer` amends the affected spec/plan line in place with `(amended during implement: <why>)`, `lead` review verifies each amendment is a discovered constraint, not smuggled scope); and **run metrics in `retro.md`** (wall-clock, size, skipped steps, security state). Files: `.claude/orchestrator.md`, `.claude/agents/{lead,engineer,retro}.md`, `.workflow/_templates/{plan,retro}.md`.
- **`api-design-fundamentals` skill — API surface design as a construction-chain fundamental.** A new skill for designing the surface a client codes against: resource/endpoint modeling, HTTP semantics & status codes, request/response contracts & validation, errors-as-contract, idempotency & method safety, pagination/filtering, backwards-compatible versioning, and auth/rate-limiting at the boundary (8 principles, each Rule/Why/How/Example, plus a pre-flight checklist and skip list). Slotted into the construction chain **between `hexagonal-backend` and `architecture-fundamentals`** — an API surface is one service's published driving-adapter shape, settled before the cross-service topology is drawn — and registered consistently across all four chain mirrors (`.claude/rules/fundamentals.md`, `CLAUDE.md`, `README.md`, `WORKFLOW.md`), its always-on rule, and the website skills grid. The chain is now `… → hexagonal-backend → api-design-fundamentals → architecture-fundamentals → …`. Files: `.claude/skills/api-design-fundamentals/SKILL.md`, `.claude/rules/api-design-fundamentals.md`, `.claude/rules/fundamentals.md`, `CLAUDE.md`, `README.md`, `WORKFLOW.md`, `website/index.html`.
- **`artifact-lint.sh` — an optional artifact gate for `/dev` runs.** A dependency-light POSIX-sh linter that validates a `.workflow/<id>/` directory against the templates: required sections per artifact (`spec.md` Type + acceptance; `plan.md` mermaid + inline AC tag + runnable `verify:`) and no leftover placeholder markers (`TODO`/`TBD`/`FIXME`/`lorem`/`<...>`), with a fenced-code / inline-code-span exclusion so an artifact that *documents* the markers still passes. Prints a per-check report and exits non-zero on any failure. Ships a 24-assertion fixtures suite (`pass/` + `fail/`) and is documented in `WORKFLOW.md` as **opt-in** — not wired into the state machine, never blocks a tool call. Files: `.claude/hooks/artifact-lint.sh`, `.claude/hooks/tests/**`, `WORKFLOW.md`.
- **`.claude/agents/INDEX.md` — a model/role reference for every agent.** A two-section table (`/dev` workers vs `team-*` fanout workers) listing each agent's `model:` and a one-line role, sourced from the agents' frontmatter, so the cost/speed tiering is visible at a glance instead of opening every file.
- **`no-direct-main-commit.sh` — an opt-in guard hook against committing to the default branch.** A PreToolUse `Bash` guard that blocks a `git commit` while on `main`/`master` and tells you to branch first — fails open on detached HEAD / non-repo, honours `ALLOW_MAIN_COMMIT=1`, and ships a 5-case `--self-test`. Shipped **opt-in**: the hook file and its `CLAUDE.md` entry land, but it is *not* registered in `.claude/settings.json` by default (register it under `PreToolUse`/`Bash` to activate). Files: `.claude/hooks/no-direct-main-commit.sh`, `CLAUDE.md`.

### Changed

- **Always-on context trimmed (~5 KB per session).** `CLAUDE.md` no longer restates the per-skill trigger list (the always-on `.claude/rules/` are the detection layer); the `refactoring-fundamentals` and `qa-handoff-note` skill descriptions and the `team-code-reviewer` / `team-code-simplifier` / `team-silent-failure-hunter` agent descriptions are trimmed to trigger phrases + skip lists, with worked `<example>` dialogues moved into agent bodies. Trigger phrasing is preserved verbatim.
- **The cross-skill chain's prose mirrors are now declared sync targets.** `.claude/rules/fundamentals.md` (the canonical run order) now names the three readability mirrors — `CLAUDE.md`, `README.md`, `WORKFLOW.md` — and the rule to update them together, so adding, removing, or reordering a chain skill can't silently drift the prose overviews.

### Fixed

- **Four workflow contradictions** surfaced by a fanout audit: the fanout dispatch example showed 8 `Agent` calls where the text mandates the 6 review workers; `engineer` ship mode wrote `commit_sha`/`pr_url` into `state.json` itself, violating the orchestrator's single-writer discipline (it now returns them); `team-pr-test-analyzer` could run twice per run (review fanout + test fanout) with no dedup; and the forked `team-silent-failure-hunter` / `team-code-simplifier` agents carried another project's conventions (`constants/errorIds.ts`, Statsig logging, ES-module/React style) — both now read conventions from the target repo's CLAUDE.md.
- **Hooks treated `.workflow/_templates/state.json` as the active run** (the `*/state.json` glob matches it), so a freshly-installed repo's first `/dev` run could be guard-blocked against the template. Both `dev-agent-guard.sh` and `dev-state-mark.sh` now skip `_templates`. Found live in adopter-sandbox testing.
- **Combined-mode `lead` implemented before the gate** (observed in testing: the planning spawn wrote the full feature implementation undisclosed). The combined variant now writes exactly `spec.md` + `plan.md`, and the orchestrator runs a clean-tree check after the return, reverting undisclosed source writes. Size-anchoring also hardened: combined mode must re-derive the tier with hard tripwires (any persisted-data/storage-key/schema/API change is never XS). Note: mid-session edits to agent definitions don't reach later spawns (the registry caches content at session start — now documented in `WORKFLOW.md`), so these two agent-side rules need a fresh-session verification pass.
- **`dev-agent-guard.sh` false-blocked one `/dev` run when a concurrent run wrote its state.** The Case 3 state-discipline freshness check picked the globally-newest `state.json` across **all** runs, so two `/dev` runs at once — or a run inside a separate `git worktree` sharing the tree — could block one run's worker spawns citing a *sibling* run's id. The guard now resolves the active run from `$CLAUDE_DEV_RUN_ID` when set, else the single active run, and **fails open** when two or more runs are active (never false-blocks one run for another); single-run behaviour — the common case — is unchanged. The worktree / concurrent-run caveat and the `CLAUDE_DEV_RUN_ID` knob are documented in `.claude/orchestrator.md`. Reproduced and fixed against a 6-case test; surfaced by a parallel size-benchmark dogfooding run. Files: `.claude/hooks/dev-agent-guard.sh`, `.claude/orchestrator.md`.

## [1.5.1] - 2026-06-12

### Added

- **`refactoring-fundamentals` skill + baseline-capture contract.** A dedicated process skill for restructuring existing code without changing behaviour — closing the `fix`→`debug-fundamentals` / `refactor`→(nothing) asymmetry. Carved from `programming-fundamentals` (which owns the *target shape*); this owns the *safe path* to get there: 7 principles (behaviour contract, one hat at a time, characterize-before-touch, small reversible steps, smell/preparatory triggers, when-NOT-to-refactor, Mikado/strangler) plus references (code smells, the refactoring catalog, characterization tests, large-scale). Registered in the always-on rule, `WORKFLOW.md` skill routing, and the `rules/fundamentals.md` run order. The **baseline-capture contract** threads it into `/dev`: a `refactor` run captures a characterization (golden-master) baseline as plan step 1 when coverage is thin, and `qa` verifies it (no baseline + uncovered behaviour = blocking gap) — wired through `plan-writing`, `lead`, `engineer`, `qa`, the `plan.md` / `tests.md` templates, and the type-aware phase matrix. Files: `.claude/skills/refactoring-fundamentals/**`, `.claude/rules/refactoring-fundamentals.md`, `CLAUDE.md`, `WORKFLOW.md`, `.claude/agents/{lead,engineer,qa}.md`, `.claude/skills/plan-writing/SKILL.md`, `.workflow/_templates/{plan,tests}.md`.
- **`qa-handoff-note` skill.** A product skill that writes `.workflow/<id>/qa-note.md` — a black-box handoff telling QA how to exercise a change on a deployed **dev / staging environment** (environment URL + build, login account/role, navigation path, API endpoint + auth, seeded test data, feature flags) and what to test (focus areas / risk hotspots, known limits *not* to flag, and step-by-step scenarios with explicit expected results). Bounded against `spec.md` (acceptance criteria) and `tests.md` (automated results) so it never restates them; oriented to manual testing on the environment, so it carries no code or run-the-repo steps. Manual invocation — no phase-matrix or agent changes. Ships filled `feat` + `fix` examples under `references/`, loaded on demand. Files: `.claude/skills/qa-handoff-note/**`, `CLAUDE.md` (skills inventory).

## [1.5.0] - 2026-06-12

### Added

- **Dashboard redesign — sidebar + four tabs + Insights.** The presence dashboard is now a multi-tab app with a left sidebar: **Team** (presence + "working in" + activity), **Conflicts**, **Insights**, and **Activity**.
  - **Insights** aggregates `/dev` completion stats across the team: runs completed (total + this week), in-flight count, median duration, *completed-by-type* and *median-duration-by-type* bar charts, a 14-day *throughput* column chart, and *top-contributor* / *most-active-repo* leaderboards — all rendered with vanilla CSS/SVG (no chart library).
  - **Activity** is a feed of recent `/dev` runs (shipped + duration, or active + phase), newest first.
  - A **member filter** ("Whole team" + a chip per teammate) on Insights and Activity scopes every stat and the feed to one person; the client computes from a deduped run list, so filtering is instant and day-buckets use the viewer's own timezone.

### Changed

- **Client reports full `/dev` run history (client v1.5.0).** `scan_runs` replaces the active-only activity scan: it reports every run under the scan roots (active + completed) with filesystem-derived timing — run-dir birth time ≈ start, `state.json` mtime ≈ finish — and treats `phase: "done"` as completed (real `state.json` carries no `created_at`/`done_at`). The server derives live activity, deduped run stats, and the activity feed from these records.
- **Compact team cards.** Each "working in" repo is now a single line (folder name + branch + file count, full path on hover), capped at 6 with a "+N more" toggle, and the agent meta collapses to one line — so a machine with many active repos no longer makes a very tall card. Repos stay sorted most-recently-edited first.
- The dashboard heartbeat body cap was raised to 512 KB to fit the richer run + change payloads, and over-limit bodies now drain to a clean `400` instead of dropping the connection (which surfaced as a `502`). Files: `dashboard/server.js`, `dashboard/client.sh`, `dashboard/public/**`.

## [1.4.0] - 2026-06-12

### Added

- **Team presence dashboard** — a real-time awareness board for everyone on the `/dev` flow. Each machine runs a background client (`claude-foundation dashboard-up --key <key>`; `dashboard-down` to stop, `dashboard-status` to check) that heartbeats to one **zero-dependency Node server** (deploys to Railway in minutes); a vanilla-JS web page shows four layers:
  - **Presence** — who's online right now (git name + host; in-memory, 30s window).
  - **Working in** — which repos each person has uncommitted changes in, with the local **folder path** and an optional **label** (`git config dashboard.label "<name>"`) so nested/same-named sub-repos stay distinct. Scans every git repo in the background, ranked by most-recently-edited.
  - **/dev activity** — the in-flight run id + phase, read straight from `state.json`.
  - **Potential conflicts** — a pre-merge early warning: when two people's changed **line ranges** in the same file overlap (computed from `git diff`, including uncommitted work the git server can't see yet), both are flagged with the file, branches, and lines.

  The client binds **no port** (PID-file controlled, outbound HTTP only) and the page has a **demo mode** (`?demo`, a header "demo" button, or a gate link) that renders sample data through the real render path — no key needed. Files: `dashboard/**` (`server.js`, `public/`, `client.sh`, `package.json`, `railway.json`, `.env.example`, `README.md`), `README.md` (`## Team presence dashboard`), `website/` (landing-page section).

- **`cli.sh` top-level command router** — splits the single `claude-foundation` command in two: `dashboard*` subcommands → the presence client, everything else → the installer (`install.sh`), keeping the installer single-purpose. The Homebrew bin execs `cli.sh`; the formula installs `cli.sh` + `dashboard` on `--HEAD` builds (guarded so the current stable tarball still installs cleanly). Files: `cli.sh`, `install.sh` (usage), `Formula/claude-foundation.rb`.

## [1.3.0] - 2026-06-11

### Added

- **Homebrew install support** — engineers can add the foundation to any project via a tap formula: `brew tap maximumsoft-co-ltd/claude-foundation https://github.com/Maximumsoft-Co-LTD/claude-foundation`, then `brew trust maximumsoft-co-ltd/claude-foundation` (recent Homebrew requires third-party taps to be trusted once), then `brew install claude-foundation`. The formula packages the foundation into `libexec` and exposes a `claude-foundation` CLI that wraps `install.sh`, forwarding all flags (`--dry-run`, `--force`, `--yes`, `--help`, `[target-path]`) unchanged. Ships **both** a stable tagged release (pinned via `url` + `sha256`, so `brew upgrade claude-foundation` works the normal way) and a `--HEAD` mode that tracks `main`. Files: `Formula/claude-foundation.rb`, `README.md` (`## Install via Homebrew`), `RELEASING.md`.

### Changed

- **`/dev` QA now runs a bounded edge-case discovery pass instead of only mapping the spec's acceptance criteria** — `qa` mapped every AC (including its `on error / at boundary` clause) to a test but had **no step to surface edge cases the spec author never wrote down** (empty/null, off-by-one boundaries, overflow, unicode, ordering/duplicate, idempotency, partial failure, auth/tenancy), so a forgotten edge case stayed forgotten through QA — coverage-driven, not discovery-driven. A new **step 2a** walks a shared **Edge-case checklist** (added to `programming-fundamentals/references/testing.md`, loaded on demand so it costs nothing per run) against the code in the diff and classifies each *reachable* case three ways: **covered** (an AC already asserts it), **specified** (the spec implies the behaviour → write the test now), or **undefined** (the diff can hit it but the spec never says what should happen). Undefined cases are deliberately **not** asserted against a guessed behaviour — that would make QA invent requirements (scope creep); instead they're recorded in a new `tests.md > Edge-case gaps` section and surfaced as a finding, **non-blocking by default** (it's a spec gap, not a test failure) and escalated to a blocking `AskUserQuestion` only when the undefined path is a reachable **security or data-integrity** hole. The pass stays bounded — only inputs the diff can actually reach, skipping illegal states a type/guard already makes impossible. The orchestrator's test step (13) gains the matching branch: non-blocking gaps ride along in `tests.md` for `retro` to lift into follow-ups, blocking ones stop for a user decision (define the behaviour → back to `engineer`/`pm`, or accept the risk → carry into `retro.md`). Files: `qa.md` (step 2a + edge-case-gap count in the return contract), `programming-fundamentals/references/testing.md` (Edge-case checklist), `.workflow/_templates/tests.md` (Edge-case gaps section), `orchestrator.md` (step 13 gap handling).

- **The one-command QA suite rule now names the monorepo workspace-aggregator tier** — the batch-run rule shipped in 1.2.0 jumped straight from "call the runner once" to "write a one-shot script", which could push `qa` to hand-roll a script in a monorepo that already has `pnpm -r test` / `turbo run test` / `go test ./...`. Step 4 now names the workspace-aggregator middle tier explicitly (one added sentence, keeping the agent file tight), and a new `testing.md > Running the suite in one command` section spells out the full three-tier order — runner auto-discovery → workspace aggregator → one-shot script as a last resort — with the why (the cost is N tool-call round-trips, not the tests) and the "if you rewrite the script every run, commit it as `make test`" smell. Files: `qa.md` (step 4), `programming-fundamentals/references/testing.md` (Running the suite in one command).

## [1.2.0] - 2026-06-11

### Changed

- **`spec.md` and `plan.md` now lead with a plain-language `## Outcome` block (Before → After → Benefit)** — a field report said both artifacts were *hard to read* because neither tells a reviewer, at a glance, **what it's like before the change, what it's like after, and what they get**. The artifacts opened straight into technical content (`spec.md` → `Goal` one-liner + acceptance criteria; `plan.md` → `Approach` + diagram + steps), and the nearest existing framing was the *optional* `Problem` (rarely rendered) and the `path#anchor`-cited `Current state` (written for an engineer, not a 30-second scan) — with no home at all for "what's the win". The fix adds one always-required section at the very top of each artifact, a three-bullet **Before** (today's gap/pain) → **After** (what "done" looks like) → **Benefit** (the value). The split avoids duplication: `spec.md > Outcome` is **product-level** (After = the one-sentence outcome the ACs verify — it *absorbs* the old `Goal`, whose testable-target role moves into the After bullet so engineer/qa still reference it); `plan.md > Outcome` is **system-level** (Before/After describe the flow's behaviour, Benefit links `→ spec.md > Outcome` rather than restating it). The plan's plain-language Before is explicitly a *complement* to `Current state`, not a second copy — Before carries no anchors, `Current state` carries the cited walk, and Before is written even when `Current state` is absent. `Outcome` (not `Goal`) is the section name on purpose: a block holding before/after/benefit is broader than a single goal, so "Goal" would mismatch the 3-bullet content and prime a one-sentence answer — the exact insufficiency the feedback flagged; agent comprehension is equal between the two words, so the choice is semantic fit, confirmed with the user. `epic.md` is left alone — its existing `## Problem` paragraph already frames the before/why at epic granularity, and the report was scoped to spec/plan. The `spec.md > Problem` trigger is rewritten to fire only when the one-line Before/Benefit needs a *fuller* paragraph (so it never duplicates Outcome). Fourteen files keep the chain consistent: `.workflow/_templates/spec.md` (`Goal` → `Outcome` floor + `Problem`/`Users` trigger reword), `.workflow/_templates/plan.md` (new Outcome block + always-required list + Current-state relationship note), `plan-writing/SKILL.md` (new principle 9 + 8→9 count + draft-order + gating-table row + a self-review scan), `plan-writing/references/self-review.md` (new Scan 6 + 5→6 count), `pm.md` (floor + digest-mapping + an Outcome hard rule on plain language / no invented benefit), `lead.md` (Mode A section-discipline step 7), `brainstorming/SKILL.md` (floor + both "Present design" spots + the worked-example slot walk), `orchestrator.md` (spec-check floor + gate-revise requirement list), `engineer.md` (input now `spec.md > Outcome`, After = done-definition), `WORKFLOW.md` (artifact-table descriptions), and the demo surface `website/index.html` + `website/demo/src/slides/artifacts.js`.

- **`/dev` review (`lead` Mode B) now defaults to Sonnet, escalating to Opus only for high-stakes diffs** — a field report flagged review as *very* slow, and the cause was that review was pinned to Opus for **every** diff (`lead.md` frontmatter + an orchestrator note reading "review and security always keep opus"), so even an XS one-file change paid Opus wall-clock on review's inherently verbose one-row-per-AC/step/file anti-bias walk. Plan mode already solved the identical problem (Sonnet override by default, Opus only for L-tier), so review now mirrors it: the orchestrator spawns review with a `model: sonnet` override by default and **omits the override (keeps Opus) only for high-stakes diffs** — the *same* conditions that already gate review fanout (large/cross-module, critical paths, public-contract/type change, substantial test change). Because a sub-agent's model is fixed at spawn, the orchestrator must decide **before** the spawn; it uses plan `Size ∈ {M, L}` plus the plan's `## API / event contracts` section and `Files touched` as the pre-spawn proxy for the diff judgment `lead` itself makes for fanout. The divergence self-corrects: if `lead` (on Sonnet) sees a riskier-than-planned diff and requests review fanout, the **synthesis re-spawn always keeps Opus**, since fanout only fires on diffs that earned the scrutiny. Mode C (security) is unchanged — always Opus. The skill-load-budget rationale ("judge fundamentals from the summary, don't re-read the 100 KB library") was reworded to hold on either model rather than being tied to Opus. Note this does **not** address the companion "review writes/reads many files / feels heavy" observation — the likely culprit there is review fanout (6 `team-*` workers) firing on small diffs, a separate opt-in tightening left for a follow-up. Files: `lead.md` (Mode B model note + Mode A/step-89 reword + step-34 reword), `orchestrator.md` (step 8 pre-spawn note + step 11 override rule), `engineer.md` (skill-budget "opus review" → "review").

- **Always-on context slimmed ~79% — rules become 3-line pointers, skill descriptions trimmed under the truncation cap, run order moved to a single shipped file.** An internet best-practice pass (Anthropic's progressive-disclosure guidance and the memory docs' under-200-line CLAUDE.md target; the superpowers / 12-factor-agents community pattern of "ordering lives in exactly one place"; and measured evidence that instruction volume degrades compliance while compact constraint headers cut ~71% of constraint tokens with no compliance loss — arXiv 2604.07192) found the same routing information loaded **three times every session**: CLAUDE.md's working agreements, the nine `.claude/rules/*.md` essays (~4,070 words always-on), and the skill frontmatter descriptions (~2,070 words in the skill list) — with the canonical construction run order written out in ~10 files. Three structural fixes. **(1) Rules become pointers.** Every rule is rewritten to trigger + one-sentence why + skill pointer; the one-sentence why *stays* (Anthropic's docs endorse brief rationale for compliance — "Claude is smart enough to generalize from the explanation") while the How-to-apply / Relation-to-other-skills / Status boilerplate *goes*, since it re-taught SKILL.md content that already loads on demand. Rules shrink 4,071 → 855 words (~5,500 → ~1,150 tokens); sub-agents reload the full CLAUDE.md + rules hierarchy on every spawn, so a 5-agent `/dev` run saves roughly 22k tokens beyond the main session. **(2) Skill descriptions trimmed.** The nine longest `description:` fields are cut from 101–223 words to 60–80, keeping the trigger cues ("Use BEFORE…", "even when the user doesn't say…") and skip lists — Claude Code truncates `description` + `when_to_use` at 1,536 characters, and `git-workflow`'s ~1,500-char description was silently at risk of losing its tail. **(3) Run order gets one home that actually ships.** The canonical construction chain moves to a new tenth rule, `.claude/rules/fundamentals.md` — chosen over CLAUDE.md because the installer **never copies CLAUDE.md** to adopting repos (stub + frozen import block), so parking the order there would have dropped it from every target repo — a propagation gap caught mid-change — while `.claude/rules/` is copied always-overwrite and refreshes on every re-install. CLAUDE.md's working agreements and `coding-discipline/SKILL.md`'s run-order line now point at that file instead of restating the chain; `install.sh`'s import-fallback block gains the `@.claude/rules/fundamentals.md` line (existing installs' frozen blocks won't pick it up, but current Claude Code auto-loads the rules directory, so the file still lands and loads on re-install); `install-cursor.sh` enumerates rule files dynamically, so the new rule ships as `.cursor/rules/fundamentals.mdc` automatically (doc counts updated 9 → 10). `paths:`-scoping the db/queue rules was considered and **rejected**: path-scoped rules fire only when a matching file is read, a foundation can't guess adopters' layouts, and schema/queue design usually starts before any file is open — the silent-absence risk outweighs the ~80 remaining tokens. Verified by a real install into a temp target: all 10 rules land (each ~600–800 B, down from ~1.5–2.5 KB), the CLAUDE.md stub imports all 10, and the trimmed descriptions ship. Files: `.claude/rules/*.md` (9 rewritten + `fundamentals.md` new), `.claude/skills/{git-workflow,debug-fundamentals,queue-fundamentals,database-fundamentals,coding-discipline,plan-writing,programming-fundamentals,brainstorming,hexagonal-backend}/SKILL.md` (descriptions; `coding-discipline` body run-order pointer), `CLAUDE.md`, `install.sh`, `install-cursor.sh`, `README.md`, `website/index.html`.

- **`/dev` requirement-capture and revise-speed reworked** after two field reports — specs came out missing requirements that *were* discussed before `/dev`, and rejecting at the gate to "chat about this" triggered a **full Phase-1 restart** (re-interview + re-fanout + re-spec + re-plan, ~20–30 min). Four changes land. **(1) Pre-`/dev` conversation → requirements digest.** The interview captured only the 3–4 `AskUserQuestion` slots and `pm` received only that Q&A, so anything the user established in the pre-`/dev` conversation that didn't map onto a chosen slot was silently dropped. The orchestrator now distils the entire prior conversation into a **requirements digest** (goals, constraints, decisions, concrete examples, edge cases — in the user's words) and passes it to `pm` as a first-class, authoritative requirement source on par with the Q&A; the slot interview then asks only what the digest leaves unspecified (also shortening the batch) and closes with a single free-text "anything I missed?" catch-all so the user is never boxed into the multiple-choice slots. **(2) Draft-first `pm` contract — the digest can't drop on a re-spawn.** A sub-agent keeps no memory across spawns, so when `pm` requested research fanout *before* writing `spec.md`, the re-spawn rebuilt the spec from a prompt that re-passed only the Q&A — silently dropping the digest. `pm` now **writes the draft `spec.md` first** (folding in the digest, marking research gaps with `[NEEDS CLARIFICATION]`) and only *then* requests research to refine it; on the re-spawn it re-reads its own draft (digest already folded in) instead of relying on re-passed prompt context. `spec.md` is the single durable home for requirements — a separate `interview.md` artifact was considered and rejected as a dual-source-of-truth. **(3) Gate feedback never restarts Phase 1.** "chat about this" / free-form gate feedback used to spin up a fresh `/dev` run (the ~20–30 min restart). A new **not-actually-fresh guard** (orchestrator Fresh-run step 0) scans `.workflow/*/state.json` for an in-flight Phase-1 run (the most-recently-updated one) and routes spec/plan feedback into *that* run's revise path instead of creating a new one; if multiple abandoned Phase-1 runs exist (the litter past restarts left), it offers to close them as `abandoned`. **(4) Revise is now a targeted in-run edit, not a regeneration.** Plan-only notes re-spawn `lead` in a new **plan-revise mode** that `Edit`s only the affected steps — no plan-prep fanout, no LSP re-walk (`Current state` already lives in `plan.md`), no skill reloads; requirement notes re-spawn `pm` in **spec-patch mode** to edit only the affected `spec.md` sections (re-interview only for a genuinely new slot). The orchestrator then re-verifies consistency (every AC still has a delivering+verifying step, no dangling `P<n>.<step>` cross-refs, zero markers) and re-presents only the changed parts. Resume maps a `revise-spec`/`revise-plan` step back to the gate. Files: `orchestrator.md` (step-0 guard, step 6 digest + free-text, step 7 draft-first spawn + fanout re-spawn simplification, gate revise rewrite, resume map), `pm.md` (digest input, draft-first contract, spec-patch mode), `lead.md` (Mode A plan-revise variant), `brainstorming/SKILL.md` + `references/interview-tactics.md` (revise = surgical, gate edge relabel), `fanout-team-agents/SKILL.md` (research re-spawn reads the draft), `WORKFLOW.md` + `README.md` (interview digest + incremental-revise gate description).
- **Definition-of-Done items now get plan-time coverage.** `spec.md` defined DoD items as "concrete artifacts `plan.md` must deliver", but nothing enforced it: plan steps tag only `[AC#]`, and `self-review.md` Scan 2 said "every Step ↔ an AC, **no third option**" — which actively told the planner to *delete* a step that existed only to deliver a DoD item (telemetry, a doc, a rollback flag). So a DoD item could be silently absent from the plan and surface only as a **review-cycle catch** (`lead` Mode B walks DoD in the diff) — an engineer re-spawn + opus re-review later. Scan 2 is renamed *Requirement coverage: acceptance criteria + Definition of Done* and now allows a `[DoD]`-tagged step as the legitimate third option plus a DoD-coverage check: every in-run DoD item needs a delivering+verifying `[DoD]` step **or** an explicit deferred note for genuinely post-ship items ("watch error rate for a week"), so the gap is caught at the plan line, not the review cycle. Files: `plan-writing/references/self-review.md` (Scan 2 rename + DoD coverage), `lead.md` (Mode A step 10 DoD delivery rule), `.workflow/_templates/plan.md` (`[DoD]` tag in the Steps format).
- **`/dev` QA phase now runs the whole suite in one command instead of looping Bash per test file** — a slow QA phase traced to the `qa` agent invoking the runner once per test file/case rather than letting a single `npm test` / `pytest` / `go test ./...` / `cargo test` discover and run everything in one process. `qa.md` now mandates a single full-suite invocation as the status-deciding run (steps 4, 7, and a new Cross-cutting "batch the run" rule); per-file/per-test targeting is allowed only while iterating on a single failure, never for the run that sets status = `passing`. Files: `qa.md`.
- Requirement→implementation **traceability** closed on two leaks that let a correct spec still ship the wrong code, plus two narrower plan-quality guards — the result of an internet best-practice pass (GitHub spec-kit's WHAT/HOW split + no-markers gate, AWS Kiro's EARS acceptance criteria and requirement-bug taxonomy, Mavin's EARS notation, Spracklen et al.'s package-hallucination study) cross-checked against the actual templates and agents. Four fixes land. **(1) NFR orphaning — the clean miss.** Acceptance criteria were the *only* requirement that threaded `spec → plan → qa → review`: plan steps tag only `[AC#]`, `plan-writing` principle 1 brands any non-AC step "scope-creep", and `lead` review + `qa` walk only AC — yet the spec defined an NFR as "a measurable target **outside the AC**", so a `p95 < 200ms — measured: X` target had no plan step, no test, and no review row and could ship entirely unchecked (the plan template has no NFR section at all, and Observability ≠ a perf budget). Fix follows the advisor-endorsed "make the one load-bearing wire carry more, don't add three parallel wires": a measurable perf/security/a11y target is now **written as an Acceptance criterion** whose verify is its `measured:` clause, so it threads through the existing AC machinery with zero new tags; the standalone `Non-functional requirements` section is demoted to an optional at-a-glance roll-up of AC numbers, never the home of a target. **(2) Error/boundary self-gated — the #1 "runs but does the wrong thing" failure.** Both slots that capture concreteness were gated by the *same author's* judgment — the `e.g.` fired only "when not self-evident", the `Edge` only "when it changes design" — so the author who under-specifies is exactly the one who mis-judges both gates, and the unhappy path (bad input, hit limit, unauthorized caller — the "exports soft-deleted rows / skips authz / picks the wrong API of two" shadow-requirement traps) gets silently guessed. Every consequential AC now carries a **required `on error / at boundary:` sub-bullet** (EARS IF/THEN); `none — <default>` is a valid *recorded* decision, an empty line is not, and the orchestrator interview detects it the same binary way it detects NFRs. **(3) Internal port contracts.** The `## API / event contracts` plan section triggered only for public HTTP/event/cross-service formats, so for a hexagonal-first repo a new internal port let the engineer invent the signature and the adapter drift; the trigger now also fires for **a new internal port/interface boundary**, naming the interface + method signatures *before* the Steps that fill them. **(4) Dependency hygiene.** Nothing caught a hallucinated or typo-squatted package at plan time; any Step that adds a third-party dependency must now **pin an exact existing version and verify it resolves** (weakest-fit guard for this locked-stack repo, kept to a line). Fourteen files updated to keep the chain consistent end-to-end (the whole point of fix 1): `.workflow/_templates/spec.md` (AC format + NFR/DoD comments), `.workflow/_templates/plan.md` (port trigger + error-coverage + dep-hygiene notes), `.workflow/_templates/review.md` (error/boundary AC rows + a new `## Non-AC slot check` walk for DoD + Constraints — the slots that genuinely *can't* fold into AC), `pm.md` (NFR-as-AC + error/boundary hard rules), `lead.md` (Mode A port contract + AC-sufficiency error coverage + dep hygiene; Mode B step 3 error/boundary walk + new step 3a DoD/Constraints walk), `qa.md` (map error/boundary + measured target), `engineer.md` (an AC isn't done until its boundary clause is built), `brainstorming/SKILL.md` + `references/interview-tactics.md` (detect-don't-fill capture of NFR-as-AC and the unhappy path, self-review scans), `plan-writing/SKILL.md` + `references/self-review.md` (AC-sufficiency error coverage, two new anti-patterns), and `orchestrator.md` + `WORKFLOW.md` + `README.md` (interview, gate-contract, review/qa/anti-bias descriptions). `Scope — Out` was deliberately **left out** of the orphaned-slots fix: it's already double-covered by review's invented-requirements rule, so threading it would have weakened an otherwise sharp asymmetry (NFR = clean miss · DoD/Constraints = partial · Scope-Out = covered).
- Plan step-target and current-state citations migrated from `path:line` to a re-resolvable **`path#anchor`** convention across the `/dev` plan-writing surface. Line numbers are accurate when a plan is *written* but go stale the moment an earlier step edits the file, so a reader — `engineer` executing a late step, `lead` reviewing, `qa` cross-checking — who hits `:42`-now-at-`:88` loses confidence and burns time cross-checking; the plan stops being a trustworthy document. Note the failure mode is *reference durability*, not mechanical breakage: the `Edit` tool matches on `old_string`, not line numbers, so a stale `:42` never breaks an edit — it breaks *trust*. The fix is to cite a handle a reader can re-resolve with LSP or `grep` regardless of line drift: the **symbol** for code (`src/users.ts#getUserById`), or a **unique quoted snippet / heading** for shell, markdown, config, or a spot inside a function with no named symbol (`dev-state-mark.sh#"command -v jq"`, `WORKFLOW.md#"## Type-aware phase matrix"`). A line number MAY be appended only as an explicit write-time hint (`#getUserById (~L42)`), never as the sole handle; new files use `path (new)`. **Scope was deliberately bounded to the two citation uses the staleness actually hits** — *step targets* (executed late, after earlier steps have shifted lines) and *current-state / invariant citations* (read at review and cross-checked against the tree). **Review / QA / security findings were left `path:line` on purpose**: they cite a diff frozen at review time, and `path:line` is the convention every PR tool expects (and the harness renders clickable) — migrating them would be scope creep that fights the tooling. Eleven files updated: the keystone `.workflow/_templates/plan.md` (Steps format string + a one-paragraph anchor gloss + the Current-state cite line), `plan-writing/SKILL.md` (the full definition at principle 5 plus nine cross-references), `plan-writing/references/{current-state,self-review,size-tiering}.md` (template slots, the three worked examples for feat / fix / refactor, and prose), `lead.md` plan-mode steps 39–59 (with a compact inline gloss so XS work that skips the full skill body still gets the rule), `team-codebase-explorer.md` (whose output format feeds `Current state`), `engineer.md` (the spec-AC evidence note), and `WORKFLOW.md` + `README.md` (the flow descriptions). A verification pass enforced a rule the convention itself implies — **every anchor that names a real repo file must itself `grep`-resolve, or the example teaches the exact staleness the convention exists to kill** — which caught two self-undermining anchors before commit: the canonical definition cited `WORKFLOW.md#"## Phase matrix"` when the real heading is `## Type-aware phase matrix`, and a feat example cited `dev-state-mark.sh#">>"` for an append the hook never performs (`>>` appears zero times in the file). Both fixed; the remaining real-file anchors (`command -v jq`, `INDEX.md`, `PreToolUse`) were grep-confirmed. The migration's own dogfood proved the thesis: the jq invariant example previously cited `dev-state-mark.sh:17`, but the guard is actually on line 18 — the line number had already drifted, while the `command -v jq` snippet is correct and stays correct.
- Compacted the `CLAUDE.md` **Working agreements** section from long-form per-skill prose into a tight trigger→skill index grouped under a `Construction skills — when several apply, run in this order` header. Semantics are unchanged — all ten skill rules plus the OpenWolf-ignore note are retained, each still pointing at its `.claude/rules/<name>.md` + `.claude/skills/<name>/SKILL.md` — but the section loads faster as always-on context and makes the run-order chain (`ddd-strategic → … → queue-fundamentals`) legible at a glance.

### Fixed

- **Demo website fanout roster was missing `team-code-simplifier`** — the `#agents` "parallel fanout workers" chip list showed 7 of the 8 `team-*` workers (`team-code-simplifier`, the review-fanout simplifier, was absent). Added the missing chip so the published roster matches `.claude/agents/`. Also refreshed a stale `file:line` reference in the workflow-steps copy to the current re-resolvable `path#anchor` convention (the `/dev` plan citations migrated to anchors in an earlier change, but the site still said `file:line`). Files: `website/index.html`.
- `dev-state-mark.sh` no longer treats a **background spawn's launch acknowledgment as a worker return**, fixing the self-blocking `/dev` fanout batch observed in the field: relaunching N tracks as background engineers in one message had spawn A's immediate tool result (just the launch ack — the worker hadn't run yet) touch `.last_worker_return`, which tripped the Case 3 guard in `dev-agent-guard.sh` for spawn B and forced the orchestrator into a degenerate interleave of `bump state.json → spawn → bump → spawn` with nothing real to record between bumps. The marker means "a worker **returned**", so the PostToolUse hook now exits early when `tool_input.run_in_background` is `true`; the PreToolUse guard is deliberately unchanged (a stale marker from a real foreground return must still block any next spawn, background included — verified). Trade-off made explicit in `orchestrator.md > State discipline`: a background worker's *completion* arrives as a task notification, which fires no PostToolUse, so for background workers state discipline is prose-enforced — the orchestrator writes `state.json` as each notification lands. The `FANOUT_REQUESTED: implement` caveat row is updated to match (race fixed; shape stays experimental because per-phase state isn't tracked, so a mid-fanout interrupt resumes at the whole step). Verified with simulated hook payloads: foreground return still marks + reminds, background ack neither marks nor emits, a background batch no longer self-blocks, and the skipped-bookkeeping block-then-bump-then-pass path still works.
- `install.sh` now propagates the always-on rules-import fallback into a target that **already has a `CLAUDE.md`**, instead of silently skipping the file. The installer treated `CLAUDE.md` as pure user-state — it generated the stub (which carries the `@.claude/rules/*.md` import block) **only when the file was absent**, so the common adoption case (a project that already has its own `CLAUDE.md`) had `.claude/rules/` installed but **nothing pointing at it**: on Claude Code versions that don't auto-load `.claude/rules/`, the entire fundamentals layer went silently un-loaded. Note the import block is the *fallback* — recent Claude Code auto-loads the rules directory — so the failure was invisible on current versions and only bit older ones, which is exactly why it slipped through. The fix mirrors the existing `settings.json` merge strategy rather than overwriting: the full file is still never clobbered, but if a `CLAUDE.md` exists **without** the block, the installer **appends only the `## Always-on fundamentals` section** (all nine `@.claude/rules/*.md` imports), preserving every line of the user's existing content. The block is factored into a single `emit_rules_block()` source-of-truth used by both the fresh-stub and append paths, keyed for idempotency on the first import line (`@.claude/rules/coding-discipline.md`) — re-running adds nothing, and the dry-run plan reports the precise action (`+ stub` / `~ append` / `= kept`). The idempotency key is documented in-code as a deliberate **first-write freeze, not a sync**: once the block exists it's left untouched, so a later rule-set change won't re-propagate into an existing block — acceptable because the block is only the fallback and the rule *files* themselves always refresh, narrowing the stale window to (old Claude Code × rule-set change); a sentinel-comment wrap is noted as the future hook if true re-sync is ever needed. `install-cursor.sh` needs no equivalent change — it writes `.cursor/rules/*.mdc`, which Cursor always auto-loads, so there is no fallback-import to propagate. Verified empirically across all paths: fresh target (stub + 9 imports), existing `CLAUDE.md` without the block (user content preserved + 9 imports appended), and re-run (still 9 imports, exactly one heading), plus dry-run plan output for the without-block and with-block cases.

## [1.1.0] - 2026-06-06

### Added

- Return-check tripwires across the `/dev` orchestrator plus three new optional `plan.md` sections and a two-pass section-discipline upgrade in `lead` — closing the gap where the orchestrator could silently advance past a step whose worker produced nothing, an empty artifact, or a plan that omitted a section a reviewer needed. Three complementary changes land in this commit. (1) **Return-check tripwires (`orchestrator.md`).** The "first-line scan after a sub-agent returns" section gains a new concept: before *advancing to the next step*, the orchestrator runs that step's **Return check** if one is defined. Return checks run **only** on the step's primary worker return (`pm` / `lead` / `engineer` / `qa` / `retro`) — never on intermediate `team-*` fanout workers, whose artifact doesn't exist until synthesis runs (a check there would false-positive). A Return check is a presence/shape **tripwire**, not a quality review (the `lead` review and `qa` gates own quality); it fires at most **one** corrective re-spawn, then escalates to the user via `AskUserQuestion` rather than looping. Six checks are wired: **Plan check** (step 8) reads `plan.md`/`epic.md` and confirms a `Steps` section with ≥1 step (≥1 slice for an epic) and no remaining `[NEEDS CLARIFICATION]`; **Diff check** (step 10, skipped when `repo_root` is null) confirms the engineer actually produced work — `recommendations.md` exists for `spike`, HEAD advanced via `git -C <repo_root> log --oneline -2` for `fix` (which commits during implement, leaving a clean tree), and `git -C <repo_root> status --porcelain` otherwise (catches staged, unstaged, **and untracked new files**, which `git diff` misses); **Review artifact check** (step 11) reads the first line of `review.md`; **Security artifact check** (step 12) reads the first line of `security.md`; **Test artifact check** (step 13) confirms `tests.md` exists; **Ship check** (step 15, skipped when `repo_root` is null or the engineer returned "no VCS — ship skipped") runs `git -C <repo_root> log --oneline -1` and confirms the commit SHA the engineer reported is present. (2) **Three new optional plan sections + a reviewer summary (`.workflow/_templates/plan.md`).** A `## Reviewer summary` (TRIGGER: Size=L OR ≥3 decisions need gate sign-off; placed *before* `## Approach`, max 10 lines — root cause/goal, decisions needing sign-off with what was rejected, top risks) gives larger plans an at-a-glance sign-off block. `## Folder structure` (new project OR feat adding ≥3 packages/modules; directory tree with one-line purpose per node, unchanged subtrees omitted) and `## API / event contracts` (feat/fix that introduces or changes public HTTP endpoints, event schemas, or cross-service message formats; method · path · request · response · error codes per endpoint) are added to the foot trigger menu between Architecture diagram and Steps. `## UI component & state plan` (feat/refactor shipping UI; component/screen tree with `[AC#]`, server-state-vs-local-UI-state ownership, data source per screen, routes→screens, one-line design direction) joins the menu — the HOW build structure, distinct from `spec.md > User journey`'s WHAT flow. The Steps section also gains a **phase cross-reference rule**: when steps are grouped under `### Phase N`, all references elsewhere in the document MUST use `P<phase>.<step>` notation (e.g. `P3.2`) — never a bare global step number, since phases restart at 1. (3) **`lead.md` updated to match.** Plan-mode skill routing adds frontend/UI work → `ui-ux-pro-max` for the UX/IA/accessibility decisions that shape the new UI section (`frontend-design` / `tailwind-design-system` are build-layer skills named in the design-direction line, not loaded at plan time). Section discipline (step 7) becomes **two passes** — Pass 1 trigger check (any fired condition MUST be included; the trigger list is a floor), Pass 2 active reasoning ("given this task's risk, blast radius, and unfamiliar paths, would omitting this section make a reviewer miss something or ask a follow-up?" — the list is a floor, not a ceiling). New-project guidance (step 8) requires the stack in `Approach` plus a `## Folder structure` section, the same section scoped to the new subtree for existing-project feats adding ≥3 packages, and `## API / event contracts` when public endpoints/events/message formats change. Self-review (step 11) gains two L-plan checks: confirm `## Reviewer summary` exists above `## Approach` when Size=L or ≥3 decisions need sign-off, and grep for bare `step [0-9]` outside `## Steps` to catch phase-cross-reference bugs before marking `draft`.

- Repo-aware branch management for the `/dev` workflow — the workflow now detects whether it is running inside a single git repo or a control-plane workspace (a parent directory with multiple sub-repos), creates a named branch at the very start of a run, and scopes every git operation for the rest of the run to the correct repository. Previously the workflow operated on whatever branch and repo `HEAD` happened to be pointing at when `/dev` was invoked, which caused silent work on the wrong branch or the wrong repo in control-plane setups. Four complementary changes land in this commit. (1) **Repo detection (`orchestrator.md` Fresh run step 2).** At the start of every fresh run, the orchestrator runs `find . -maxdepth 2 -name .git -type d` to discover git repos. Three branches: if only `./.git` exists (no subdirectory repos) the topology is **single-repo** and `repo_root = $(pwd)` is set automatically with no question; if any subdirectory `.git` dirs are found — whether or not the root itself is also a repo (the `tgs-control-plane`-style case where the workspace is itself a versioned repo containing child repos) — the topology is **control-plane** and the user is asked "Which repo does this run target?" with the discovered paths as options (the root is offered as the first option labelled `<dirname> (this repo)` when it has `.git`); if no `.git` is found at all (`repo_root = null`) branch creation is skipped. (2) **Branch creation with base check (`orchestrator.md` step 3).** After `repo_root` is established, the orchestrator proposes a branch name derived from the run ID slug (`<type>/<kebab-slug>`, e.g. `feat/todolist-app`) and asks via `AskUserQuestion` — folded into the same batch as the type question if type was ambiguous, so no extra round-trip. Before `checkout -b`, it checks `git -C <repo_root> branch --show-current`: if the current branch is not `main` or `master` the user is warned and asked whether to base off the default branch first (recommended) or branch from the current head — eliminating the silent "inherits stale feature branch" failure mode. `repo_root` and `branch` (plus the new `branch_existed` field) are written to `state.json` immediately. (3) **Resume hard-fail (`orchestrator.md` resume step 2).** On `--resume`, the orchestrator reads `repo_root` and `branch` from `state.json` and runs `git -C <repo_root> checkout <branch>` before printing the status line or continuing any step. Previously resume silently continued on whichever branch happened to be current. If the checkout fails for any reason (dirty working tree, missing branch, detached HEAD, git error) the orchestrator stops immediately and surfaces the error to the user via `AskUserQuestion` — it never proceeds on an unverified branch. (4) **Sub-agent git scoping.** The orchestrator's "Between-step efficiency" section gains a bullet mandating that `repo_root` and `branch` from `state.json` be included in every sub-agent prompt, with each sub-agent required to scope its git and file operations to `repo_root`. Three agent files were updated to wire this: `engineer.md` ship mode gains a **Repo scope** preamble (before step 1) instructing the agent to prefix all git calls with `git -C <repo_root>` and to `cd <repo_root>` before any source-file operations; `lead.md` review-mode inputs and `qa.md` inputs both now specify `git -C <repo_root> diff` when `repo_root` is provided, and `qa.md`'s fix-mode regression verification steps (`git checkout <test-commit>`, `git checkout -b qa-pre-fix`) are updated to the same pattern. The orchestrator's own security-trigger diff check (step 12) is updated from plain `git diff --name-only` to `git -C <repo_root> diff --name-only` — previously the security trigger silently never fired in control-plane mode because no changed files were visible from the control-plane root. `state.json` template gains three new fields: `repo_root` (null by default), `branch` (null), and `branch_existed` (false).

- Always-on skill rule, full skill body, and `CLAUDE.md` working-agreement bullet for `coding-discipline` — a behavioral *conduct* layer adapted from [Andrej Karpathy's note on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876) (via the MIT-licensed [`multica-ai/andrej-karpathy-skills`](https://github.com/multica-ai/andrej-karpathy-skills)). Four principles — **Think Before Coding** (state assumptions and name ambiguity rather than running with a silent interpretation), **Simplicity First** (minimum non-speculative code; if 200 lines could be 50, rewrite), **Surgical Changes** (every changed line traces to the request; mention orthogonal dead code, don't fix it inline), and **Goal-Driven Execution** (restate the task as a checkable success criterion and loop until met). Unlike the construction-fundamentals stack it governs *how you show up to a code task*, not *what you build*, so it is deliberately a thin **wrapper** that routes to the skills owning each concern rather than duplicating them — `brainstorming` (the full ambiguity/scope conversation), `programming-fundamentals` + `/simplify` (complexity mechanics + post-hoc cleanup), `git-workflow` (surgical diffs → atomic commits), and `debug-fundamentals` / `qa` (test authoring). Wired into `CLAUDE.md` immediately after **LSP first** — ahead of the layered `ddd-strategic → … → queue-fundamentals` run-order — so it fires first as the stance check on every code task. `README.md` always-on-rules list + file map and `WORKFLOW.md` skill-routing updated to match.
- `.claude/hooks/protect-secrets.sh` PreToolUse guard that blocks reads of `.env` and credential material across the three tool surfaces that can surface file contents into context: `Read` (a secret `file_path`), `Grep` (a secret `path`, or a `glob` that targets secret files — with `output_mode:"content"` the matching lines would print the secret), and `Bash`. The `Bash` check is precision-tuned to avoid false positives: it first **drops the contents of quoted spans** (so a secret filename mentioned only inside a string argument — a commit message, an `echo`, a generated doc — is ignored), then splits the command into simple-command segments and flags a segment only when its **command word** is a content-reading/copying utility (`cat` / `head` / `grep` / `base64` / `cp` / `scp` / `dd` / …) *and* one of its arguments is a secret file. So `cat .env`, `grep KEY .env`, `sudo cat /etc/app/.env`, and `export X=$(cat .env)` are blocked, while `source .env`, `docker compose --env-file .env up`, `npm run dev`, and `git commit -m "... cat .env ..."` (which never read a dotenv into context) all pass. Allow-list wins over deny-list: `*.example` / `*.sample` / `*.template` / `*.dist` / `*.pub` / `*.md`, public certs (`*.crt`), and `~/.ssh/config` / `known_hosts` / `authorized_keys` are never blocked, so the template and public files a developer already needs stay readable. Deny patterns cover `.env` / `.env.*` / `*.env`, key & cert stores (`*.pem` `*.key` `*.pfx` `*.p12` `*.jks` `*.kdbx` `*.ppk` `*.gpg`), SSH private keys (`id_rsa` / `id_ed25519` / …), `.npmrc` / `.pypirc` / `.netrc` / `.git-credentials` / `.htpasswd`, `credentials(.json)`, service-account JSON keys, paths under `~/.ssh` / `~/.aws/credentials` / `~/.gnupg`, and `*secret*` / `*credential*` files with a data/config extension (so the hook file itself, `protect-secrets.sh`, isn't flagged). On a match it emits a `decision: block` JSON with a why + remediation pointer, matching `dev-agent-guard.sh`'s shape, and fails open if `jq` is absent. Registered under `PreToolUse` in `.claude/settings.json` (matcher `Read|Grep|Bash`, 5s timeout). Verified against a 37-case block/allow battery (all pass). Scoped as defence-in-depth against accidental reads in a normal session, not an adversarial sandbox (a deliberate `bash -c "cat .env"` wrapper is a documented gap).

### Fixed

- `coding-discipline/SKILL.md` description: standardized `/simplify` (was `[[simplify]]` — `simplify` is a slash command, not a project skill, so the wikilink form was wrong) and added the missing `[[git-workflow]]` route (Principle 3 Surgical Changes was the only principle without a named route in the description; body, `CLAUDE.md`, rule, and CHANGELOG all listed it).
- `programming-fundamentals/SKILL.md` body: same `[[simplify]]` → `/simplify` fix (pre-existing drift in the same vein).
- `README.md` always-on skill rules list: added `ddd-strategic` and `architecture-fundamentals` (previously listed 7 of 9 rules; now matches `CLAUDE.md`'s full working-agreement stack).

## [1.0.0] - 2026-06-04

### Changed

- Agent-spawn overhead trimmed across the `/dev` orchestration path — the workflow felt slow *between* worker spawns, not inside them. Four independent changes: (1) **`dev-agent-guard.sh` hot path cut from three `jq` subprocesses to one.** The PreToolUse guard runs before *every* `Agent` spawn (worker and non-worker alike); it previously parsed `tool_name`, `subagent_type`, and `description` in three separate `jq` calls. `tool_name` + `subagent_type` (both newline-free) now come from a single `jq … | @tsv` read, and the newline-bearing `description` is parsed only inside the Case-2 (`general-purpose` misroute) branch where it is actually used, so the common worker spawn pays for exactly one `jq` process. All three block cases (orchestrator misname, worker-prefixed `general-purpose`, stale `state.json`) plus the fail-open-on-malformed-JSON path were re-verified against six payloads — behaviour is unchanged. (2) **`orchestrator.md` gained a "Between-step efficiency" subsection** under State discipline, because the slowest part of a run is usually the main-agent turn *between* two spawns: treat `state.json` + the returning worker's summary as the working set (don't re-read `spec.md` / `plan.md` unless a step requires it), keep main-agent turns short so the shared prompt-cache prefix stays warm across its ~5-minute TTL, and dispatch fanout in one message. (3) **`CLAUDE.md` rewritten to match reality** — it still described the repo as "currently empty (no source files, no git history)" and told every session to re-run `/init`, stale context that loaded into every spawn and actively misled sub-agents; replaced with an accurate surface map (orchestrator / agents / rules / skills / hooks / `WORKFLOW.md`) while preserving the load-bearing "Working agreements" rule bullets verbatim and compacting the dead OpenWolf parent-directive note to a single line. (4) **`team-codebase-explorer` model `sonnet` → `haiku`**, narrowing the recent explicit-per-agent model pass — the read-only LSP/grep fact-gatherer that feeds `pm` / `lead` is faster and cheaper on Haiku, while reviewer/analyzer workers stay on Sonnet because their judgment is load-bearing. Revert this one line if a Haiku explorer starts missing callers or invariants in plan current-state mapping.
- Requirement-gathering layer (`brainstorming` + spec/plan templates + orchestrator interview/gate) hardened on six fronts, all aimed at the same gap: the workflow was strong on a spec's *internal* correctness (no placeholders, no contradictions, verifiable + traceable AC) but thinner on *external* validation — whether the spec captures what's actually needed — and the spec is the only user-validated link in the `spec → plan → code` chain, so its ceiling caps everything downstream. (1) **Bounded multi-round interview** — the interview was hard-capped at one `AskUserQuestion` batch, which is too shallow for the open-ended work `brainstorming` claims to own (the Mom Test is iterative — a good past-behaviour answer opens the next question). A dig loop is now allowed: up to 3 *narrowing* batches when ambiguity is genuinely high (Type still unclear, >4 consequential slots open, or a batch-1 answer opened a new unknown), with "still open after 3" itself becoming a `[NEEDS CLARIFICATION]` rather than a guess. Default stays one batch. (`brainstorming/SKILL.md` principle 3 + process-flow mermaid, `references/interview-tactics.md` new section, `orchestrator.md` step 6, `WORKFLOW.md`.) (2) **AC presented as a contract at the gate** — the gate showed AC as a bulleted summary approved wholesale; it now frames them as the contract for *per-line* confirmation ("done when each is true — confirm or correct each"), because the AC are the load-bearing artifact of the whole `spec correct → code correct` bet. (`orchestrator.md` step 9, `WORKFLOW.md`.) (3) **Specification by Example** — nothing forced AC to be grounded in concrete cases, so hidden requirements (size limits, formats, timeouts) surfaced late in the pre-mortem instead of up front; consequential AC now carry an `e.g.: <input> → <expected output>` sub-bullet captured during the interview, and that example becomes the plan's verify target. (`brainstorming/SKILL.md` principle 3 + self-review scan 5, `references/interview-tactics.md` new section, `.workflow/_templates/spec.md` AC format, `pm.md` hard rules.) (4) **Repo-inferred assumptions surfaced for veto** — slots the *repo* answered (stack, integration points, conventions) were treated as fact and never shown to the user, so a wrong inference silently corrupted the spec; the interviewer now logs them and the gate prints `Assumptions (inferred — correct any that are wrong)` for a one-line veto. (`brainstorming/SKILL.md` principle 1, `orchestrator.md` steps 6 + 9, `WORKFLOW.md`.) (5) **Plan AC mapping upgraded from coverage to sufficiency** — the plan rule only checked that each AC *appeared* in some `[AC#]` tag (presence); it now requires the tagged steps to *together* fully deliver the AC with at least one step's `verify:` doubling as that AC's acceptance check (the spec example is the verify target). (`plan-writing/SKILL.md` principle 8, `references/self-review.md` Scan 2 renamed "sufficiency", `lead.md` Mode A step 10.) (6) **NFR detection made mandatory for runtime-shipping runs** — the anti-bloat "no number → no NFR section" stance left NFR detection resting on one optional question, but a missing-but-needed NFR is exactly the failure that passes every consistency scan and only breaks in prod; the *detection question* (binary: is there a measurable perf/security/a11y target?) is now mandatory for feat/fix that ship a runtime path — without reintroducing bloat, since a `no` answer still deletes the section (asking ≠ inventing). (`brainstorming/SKILL.md` principle 3, `.workflow/_templates/spec.md` NFR trigger, `pm.md` hard rules, `references/interview-tactics.md` consequence table.) Also fixed two pre-existing self-count drifts surfaced while editing: the `brainstorming` process-flow mermaid said "4 scans" (principle 7 has 5) and `plan-writing/references/self-review.md`'s closing note said "run all four scans" (the file documents five). Dogfooded via a table-top mock run (admin audit-log export) that exercised all six mechanisms and surfaced three doc-polish refinements now folded in: dig-loop-resolves-slots-*before*-approach-options sequencing (`brainstorming/SKILL.md`), an `[inferred — confirm at gate]` tag convention so repo-inferred values are never rendered as user-stated facts (`pm.md`), and a note tying batch-1 NFR-slot pressure to the dig loop rather than dropping a question. The dogfood's strongest signal: writing AC2's concrete example surfaced an async/queue dependency at *spec* time rather than mid-implementation — the exact value Specification by Example was added for.
- `.workflow/_templates/` blueprints flipped from a **"show every section, delete what doesn't apply"** model to a **"show only the always-required sections + a trigger menu at the foot, add what fires"** model — net −234 lines across nine templates (`spec.md`, `plan.md`, `epic.md`, `review.md`, `security.md`, `tests.md`, `recommendations.md`, `retro.md`, and the matching pointer edits). Previously each template shipped every optional section as a stub with a `<!-- include when... -->` comment, and the author had to *delete* the ones that didn't apply; in practice that meant the model started from a wall of headers and pruned, which leaked empty headers and "N/A" lines into artifacts. Now each template carries only its genuinely always-required sections as live headers (e.g. `spec.md` → Goal + Acceptance criteria; `plan.md` → Approach + Architecture diagram + Steps; `review.md` → checklist + AC check + Findings), followed by a single authoritative `<!--`-fenced trigger menu listing every optional section with its WHEN condition, to be *added* only when the trigger fires. Concrete moves: `plan.md`'s ten optional sections (Step order, Current state, Research notes, Alternatives considered, Files touched, Risks, Observability, Dependencies, Rollback, Out of scope) collapse from inline stubs into one foot menu; `spec.md`'s eleven (Problem, Users, User journey, Scope—Out, NFRs, DoD, Reproduction, Timebox, Constraints, Discovery notes, Carried-over follow-ups) do the same; `review.md`'s entire Per-agent findings block (the six `### team-<role>` subsections + Dispatched-as provenance rule) moves to the menu, gated on "review-mode fanout ran"; `security.md`'s five checklist *subsections* compress into five single-line bucketed checkboxes walked only for the bucket the `Trigger` names; `tests.md`, `recommendations.md`, `retro.md`, and `epic.md` each keep their type/mode-required core and push the rest to a foot menu. Multi-line metadata headers also collapse to single `·`-delimited lines (e.g. epic/recommendations front-matter). The trigger menus are now declared **authoritative** — `.claude/agents/lead.md` step 7 and `.claude/skills/brainstorming/SKILL.md` were updated to point readers at "the `<!-- ... -->` trigger menu at the foot" and to "add ONLY the sections whose trigger fires" rather than the old "read each section's comment and DELETE the section when its trigger doesn't fire."
- Explicit per-agent `model:` frontmatter across all 13 agents under `.claude/agents/`, replacing a mix of `opus`, `inherit`, and unset (implicit-inherit) values that made cost/latency unpredictable — running `/dev` from an Opus session was silently promoting *every* sub-agent to Opus. Assignments: `lead` → `opus` (plan / review / security are the highest-leverage reasoning steps and worth the spend), `engineer` / `qa` / `pm` / `retro` → `sonnet` (implementation, test authoring, spec synthesis from Q&A, and artifact summarization fit Sonnet 4.6 cleanly), `team-best-practice-researcher` / `team-code-reviewer` / `team-codebase-explorer` / `team-code-simplifier` → `sonnet` (downgraded from `opus` — the search-and-summarize / review-by-bucket shape doesn't need Opus's depth), `team-pr-test-analyzer` / `team-silent-failure-hunter` / `team-type-design-analyzer` → `sonnet` (promoted from `inherit` so they no longer drift to Opus when the parent session is on Opus), `team-comment-analyzer` → `haiku` (comment-rot scanning is mechanical pattern-matching — Haiku is ~3x faster and ~5x cheaper than Sonnet for this shape). Net effect: `/dev` runs from an Opus session now spend Opus tokens only on `lead`, with the rest of the pipeline pinned to Sonnet (or Haiku for the comment scan), and every agent's cost profile is now explicit at the file level rather than inherited from session state.
- `install.sh` and `install-cursor.sh` flipped the default for foundation-owned files from `skip-if-exists` to `always-overwrite`. Re-running the installer now refreshes `.claude/orchestrator.md`, `.claude/agents/**`, `.claude/commands/dev.md`, `.claude/skills/**`, `.claude/rules/**`, `.claude/hooks/*.sh`, and `WORKFLOW.md` on every run so upstream skill / agent / hook updates land without needing `--force`. User-state files are untouched: `.workflow/INDEX.md`, `.workflow/FOLLOWUPS.md`, and `CLAUDE.md` / `CURSOR.md` stay `never-overwrite`, and `.claude/settings.json` stays `skip-if-exists` because it already has its own jq merge path for hook wiring (use `--force` to overwrite it wholesale). The `.claude/agents/*.md` row-by-row enumeration in `install.sh` is replaced by a `.claude/agents` directory glob, which fixed a latent bug: the six fan-out workers (`team-code-reviewer.md`, `team-code-simplifier.md`, `team-comment-analyzer.md`, `team-pr-test-analyzer.md`, `team-silent-failure-hunter.md`, `team-type-design-analyzer.md`) and `TEAM.md` were in the source tree but missing from the install PLAN, so existing targets never received them. Verified end-to-end: a fresh install reports `77 new, 0 overwrite, 0 kept`; an immediate re-run reports `0 new, 74 overwrite, 3 kept` (the three kept being `settings.json` + `INDEX.md` + `FOLLOWUPS.md`, with `CLAUDE.md` also kept separately). `--force` is repurposed accordingly: foundation files no longer need it, so it now only governs `.claude/settings.json`. Help text, behavior banner, and `README.md` install section updated to match.
- `brainstorming` skill enriched with a light research pass over three external best-practice sources, folded in surgically (no skill rewrite). (a) **Amazon Working Backwards PR/FAQ** ([workingbackwards.com](https://workingbackwards.com/concepts/working-backwards-pr-faq-process/), [workingbackwards.com/resources](https://workingbackwards.com/resources/working-backwards-pr-faq/)) — the internal-FAQ question *"Top three reasons this product will not succeed"* is adapted as a 5th self-review scan in `SKILL.md > Principle 7`, with a dedicated *"Pre-mortem at the gate"* section in `references/interview-tactics.md` (failure-mode classification table, three-is-the-magic-number rule, worked example on the "export user data" spec). (b) **Rob Fitzpatrick — *The Mom Test*** ([atlantaventures.com](https://www.atlantaventures.com/blog/the-3-rules-to-customer-interviews-from-the-mom-test), [momtestbook.com](https://www.momtestbook.com/)) — the three rules (talk about their life not your idea / ask past specifics not future opinions / talk less and listen more) and the three types of bad data (compliments, hypothetical fluff, wishlists) are added as a *"The Mom Test for spec interviews"* section in `references/interview-tactics.md` (good-vs-bad question tables, the silence-as-tool note adapted for `AskUserQuestion`, an internal-user variant for solo / team-of-one cases where compliments become self-justification, hypotheticals become scope-creep enthusiasm, and wishlists become gold-plating); a one-line cue in `SKILL.md > Principle 3` points readers to the reference; one new anti-pattern bullet ("Treating compliments / hypotheticals / wishlists as signal") is added to `SKILL.md > Anti-patterns`. (c) **Anthropic Claude Code best practices** ([code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)) — the documented single-highest-leverage principle *"Give Claude a way to verify its work"* is cited directly in the 5th self-review scan, which now requires each AC to name the exact command or observable that verifies it. The same doc's *"Let Claude interview you"* workflow validates the existing `/dev` Phase 1 interview shape — no skill change needed there, but a public reference now exists for it.

### Added

- Spec/plan fanout workers and wiring: added `team-codebase-explorer` and `team-best-practice-researcher` for read-only codebase exploration and focused best-practice research before `spec.md` / `plan.md` synthesis. `.claude/orchestrator.md` now conditionally runs spec-prep fanout when existing code, APIs, security-sensitive paths, unfamiliar domain terms, or multiple research questions make guessing risky; `pm` can request `FANOUT_REQUESTED: research:<codebase-*|best-practice-*>`; and `lead` plan mode fans out S/M/L existing-code plans into paired codebase + best-practice probes per integration point. `spec.md` gains `Discovery notes`; `plan.md` gains `Research notes`; `WORKFLOW.md`, `README.md`, and `fanout-team-agents` now document the condition-based spec/plan fanout path.
- `skill-creator` skill bundled at `.claude/skills/skill-creator/` (copied from the Anthropic-shipped skill at `~/.agents/skills/skill-creator/`). Closes the gap that `README.md > Retro` already advertised — orchestrator step 10 hands off to `skill-creator` for each approved skill candidate, but until now the foundation relied on the user having it installed globally; a fresh install of the foundation onto a new machine would silently break that handoff. `install.sh` already ships `.claude/skills/**` as `always-overwrite`, so downstream installs pick up the new directory without any installer changes. `README.md > File map` inventory line updated to list `skill-creator` alongside the other in-project skills. ([f1a8f51](../../commit/f1a8f51))
- Always-on skill rule and full skill body for `ddd-strategic` — the strategic half of Domain-Driven Design that sits *above* the construction-fundamentals stack and decides *where* a model lives and *what language* it speaks (not how its code is layered, which is `hexagonal-backend`'s job). Six principles: classify the subdomain (core / supporting / generic) before deciding build-vs-buy or investment level, discover boundaries from domain events rather than drawing them around technologies or teams, enforce one ubiquitous language per context (the same word means the same thing inside a context, and translation lives at the seams), name each context relationship deliberately using the seven patterns (shared kernel, customer/supplier, conformist, anticorruption layer, open host service, published language, separate ways) so integration debt has an explicit owner, size aggregates around invariants (Vernon's four rules: protect true invariants, design small, reference by identity, eventual consistency between aggregates), and separate internal domain events from cross-context integration events so the public contract isn't accidentally the internal model. Includes `references/subdomain-classification.md`, `references/bounded-contexts.md`, `references/event-storming.md`, and `references/aggregate-design.md`. CLAUDE.md working-agreement run order updated: ddd-strategic *first* (where does the model live, what language does it speak, where are the boundaries) → programming-fundamentals → database-fundamentals → hexagonal-backend → architecture-fundamentals → queue-fundamentals — the intuition is to decide the model and language first, then build what was decided. Skip rules documented in the skill (generic CRUD, throwaway prototypes, single-context features). ([6f51143](../../commit/6f51143))
- UI/design skills bundled at `.claude/skills/frontend-design/`, `.claude/skills/tailwind-design-system/`, and `.claude/skills/ui-ux-pro-max/` (the last one includes a `data/` corpus of styles, color palettes, font pairings, product types, UX guidelines, and chart types across 10 stacks, plus `scripts/` for search and design-system generation). These do **not** have always-on rule pointers under `.claude/rules/` — they're available via the Skill tool when a request matches their triggers (UI components, landing pages, dashboards, design-system work) rather than firing on every code task the way the construction-fundamentals do. ([6f51143](../../commit/6f51143))
- `fanout-team-agents` skill at `.claude/skills/fanout-team-agents/` plus six `team-*` worker agents under `.claude/agents/` (`team-code-reviewer`, `team-code-simplifier`, `team-comment-analyzer`, `team-pr-test-analyzer`, `team-silent-failure-hunter`, `team-type-design-analyzer`) and a `TEAM.md` index describing the pattern. The skill formalizes the "dispatch N focused workers, then synthesize" pattern for any `/dev` phase that has 2+ independent sub-investigations that can run in parallel — code review (mandatory wiring), security buckets, codebase exploration across disjoint integration points, test categories, or plan phases that write to disjoint files (opt-in wiring for security / plan / test / implement). The orchestrator dispatches each worker with a focused scope and a `/dev` sub-agent (e.g. `lead`) synthesizes the findings into the single artifact (`review.md`, `security.md`, etc.) — workers never write the final artifact themselves. The six initial workers are forks of the public `pr-review-toolkit` agent set, adapted to the foundation's review-by-bucket idiom. `.claude/orchestrator.md` updated to wire fanout into Phase 2 step 5 (review) as the default and document opt-in usage for the other phases. Discovered and resolved cycle-1 during dogfood: the Claude Code agent registry is session-scoped, so any agent file dropped into `.claude/agents/` mid-session is invisible until the next session — workflow run `0002-feat-fanout-team-research` captures the eight blocking findings and resolutions. `WORKFLOW.md` updated with the new step-5 fanout description. ([5bfd067](../../commit/5bfd067))
- `brainstorming` skill at `.claude/skills/brainstorming/` — the pre-spec discipline that pairs with the `/dev` Phase 1 interview (orchestrator step 6) and any "let's brainstorm / scope / design / explore options for X" request. Seven principles: (1) explore project context BEFORE the first question, (2) decompose oversized scope before refining details, (3) ask only about UNSPECIFIED required slots (never re-ask what the intent or repo already pinned, never assume defaults for slots you didn't ask about), (4) propose 2–3 approaches with a clear recommendation when "how" is open, (5) HARD-GATE — no code, no `Status: approved`, no `plan.md` until the design is acknowledged, (6) visual-companion offer is opt-in and lives in its own message with a per-question browser-vs-terminal decision rule, (7) spec self-review with four scans (placeholder, contradiction, scope, ambiguity). Includes a pre-flight checklist, a mermaid process flow, a one-paragraph worked example ("add a way for users to export their data"), `references/interview-tactics.md` (slot consequence ranking, multi-choice framing with worked examples, `revise` follow-up handling, the `Type=fix` reproduction question), and `references/visual-companion.md` (when to offer, the own-message rule, per-question test, anti-patterns). `.claude/orchestrator.md > Phase 1 step 6` updated to load this skill first, mirroring how `lead` (plan mode) loads `plan-writing`. Sourced from a research pass over [`obra/superpowers`](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md) — the HARD-GATE, propose-2–3-approaches, spec-self-review, and own-message-visual-offer patterns are adapted from that skill; the slot-walk discipline, decomposition trigger tied to `Ship as: staged`, and the construction-fundamentals composition are foundation-native.
- `.claude/hooks/dev-agent-guard.sh` PreToolUse guard for the `Agent` tool. Blocks two known failure modes that the prompt-only rules in `dev.md` / `orchestrator.md` could not reliably prevent: (a) `subagent_type="orchestrator"` (there is no orchestrator sub-agent; the main agent IS the orchestrator), and (b) `subagent_type="general-purpose"` paired with a description prefixed by a worker name (`pm:` / `lead:` / `engineer:` / `qa:` / `retro:`) — the "model labels the description with the right worker but routes to the catch-all" pattern observed in the wild. Returns a `decision: block` JSON with a retry pointer to the correct `subagent_type`. Registered under `PreToolUse` in `.claude/settings.json` with a 5s timeout.
- `color:` frontmatter on the five `/dev` sub-agents — `pm` cyan, `lead` blue, `engineer` green, `qa` yellow, `retro` purple — so the Claude Code TUI agent view distinguishes them at a glance during a run.
- Always-on skill rule and full skill body for `architecture-fundamentals` — the system-level layer above hexagonal that names boundaries (bounded contexts, module-vs-service), single-owner data, sync vs async, resilience (timeouts, retries, breakers, bulkheads), eventual vs strong consistency, observability (RED/USE, SLI/SLO, tracing), and backwards-compatible contract evolution. Includes `references/` deep dives on boundaries, communication, resilience, and observability. CLAUDE.md working-agreement run order updated: hexagonal → architecture → queue.
- `install.sh`: structured `CLEANUP` array for legacy file removal. Dry-run lists pending deletions; apply pass loops the array and reports a `removed` count. Future fixes that drop a previously-installed file just add a row. ([7a20615](../../commit/7a20615))
- Interactive workflow slides example — single-file static deck (no build, no deps) walking the `/dev` workflow across 12 slides, each with its own widget (type-aware matrix picker, agent tiles, gate mock, animated flow, security trigger paths, live `state.json`). Content sourced from `WORKFLOW.md`. ([278402d](../../commit/278402d))
- Zero-install todolist example under `examples/`, produced by run `0002-feat-todolist-app` on branch `examples/todolist`. Workflow artifacts under `.workflow/` are intentionally excluded — only the example ships. ([5b70308](../../commit/5b70308))
- Always-on skill rules and full skill bodies for `programming-fundamentals`, `database-fundamentals`, `hexagonal-backend`, `queue-fundamentals`, and `debug-fundamentals`, including per-skill `references/` deep dives. ([ed0329e](../../commit/ed0329e), [f79b663](../../commit/f79b663))
- `.workflow/_templates/` blueprints — `spec.md`, `plan.md`, `review.md`, `security.md`, `tests.md`, `recommendations.md`, `retro.md`, `epic.md`, `state.json`. ([ed0329e](../../commit/ed0329e))
- `.workflow/INDEX.md` run registry and `.workflow/FOLLOWUPS.md` carry-over registry (never overwritten on re-install). ([ed0329e](../../commit/ed0329e))
- `.claude/hooks/lint.sh` PostToolUse lint dispatcher and `.claude/settings.json` hook wiring (only installed when missing). ([ed0329e](../../commit/ed0329e))
- `install.sh` with `--dry-run`, `--force`, `--yes`, and `--source` flags; self-copy guard. ([ed0329e](../../commit/ed0329e))
- Initial five-agent set under `.claude/agents/`: `pm`, `lead`, `engineer`, `qa`, `retro`. ([ed0329e](../../commit/ed0329e))
- `/dev` slash command and `WORKFLOW.md` flow reference. ([ed0329e](../../commit/ed0329e))

### Changed

- `plan-writing` skill gained a new **Principle 3: map the current state before designing the change** for non-greenfield work. Existing plans cited `path:line` and listed Steps, but skipped the reverse-engineering pass — engineers then discovered each load-bearing invariant the hard way by breaking it. The new principle forces an LSP-walked *Current state* section (entry point, data/control flow, callers + blast radius, invariants, anti-goals for `refactor`, bug path for `fix`) **before** the architecture diagram, and is required for all M/L plans and any `refactor` / `fix` at any size. `SKILL.md` gains the new Principle 3 (old 3–7 renumber to 4–8) with pre-flight checklist, section-gating table, anti-patterns, and references map updated to match; `references/current-state.md` (new) covers the LSP-walk technique, what counts as an invariant (and what does *not* — implementation details, internal state, "this method is called by X"), the one-line bar per invariant, the 0/1/2–5/6+ caller-count framing for blast radius, and worked examples per Type; `references/self-review.md` gains Scan 4 (Current-state coverage) so "four scans" becomes "five scans"; `.workflow/_templates/plan.md` gains the *Current state* section between Approach and the architecture diagram; `.claude/agents/lead.md` Mode A inserts step 5 (map current state) with LSP guidance and downstream steps renumber. Dogfooded against spec `0002-feat-fanout-team-research` — the new principle surfaced three invariants the principle-3-less plan had missed (asymmetric `jq`-guard between the two hooks; append-safe `mtime` reasoning; `retro`'s no-auto-create adjacency). ([6b37088](../../commit/6b37088))
- `plan-writing` skill realigned with the `/dev` workflow and restored to working state. The prior refactor ([ecd6ba3](../../commit/ecd6ba3)) had collapsed the skill into a generic "superpowers" framing and deleted `references/size-tiering.md`, `references/diagrams.md`, and `references/self-review.md` — but `.claude/agents/lead.md` (plan mode, step 1) still cites those files and depends on the skill owning the size tiers, mermaid-by-Type rules, AC tagging, and pre-draft self-review. lead was effectively loading a stub. This commit rewrites `SKILL.md` as 7 principles aligned to `/dev` (spec-first reading, size-before-steps, always-required diagram, strict step format `action — path:line — verify — [AC#]`, one-verify-per-step, type-specific rules, pre-draft self-review), restores the three reference files lightly polished, and folds in three research-backed reinforcements: a runnable-verify rule (Anthropic's [single-highest-leverage rule for AI coding agents](https://code.claude.com/docs/en/best-practices) — "give the agent a way to verify its work"); a cite-existing-patterns hint in Steps (Anthropic, same source); and an optional `### Phase N: <name>` grouping for L plans > 12 steps ([GitHub spec-kit](https://github.com/github/spec-kit/blob/main/spec-driven.md) phase-structure pattern). `.workflow/_templates/plan.md` gets matching light-touch updates: `Approach` must name the why-over-alternative; `fix` must state the root cause not just the symptom (Anthropic — "address root causes, not symptoms"); `Steps` makes the runnable-verify rule explicit. Verified by dry-run on a mock fix-type spec (login redirect loop): the skill produced an S-tier plan with a sequenceDiagram, 3 atomic steps with runnable verifies, full AC coverage, and passed all four self-review scans. ([78dc313](../../commit/78dc313))
- `.claude/commands/dev.md` and `.claude/orchestrator.md` gained an explicit Correct/Wrong `Agent({…})` call shape and a one-line rule banning `subagent_type: "general-purpose"` for `/dev` work. The mode hint (`plan` / `review` / `security`, `implement` / `docs` / `ship`, etc.) is documented as belonging in the *prompt*, not in the description. Pairs with the new `dev-agent-guard.sh` hook: the prompt is the soft layer (tells the orchestrator the right shape); the hook is the hard layer (blocks calls that drift back to the catch-all).
- `install.sh` now installs `.claude/hooks/dev-agent-guard.sh` (added to `PLAN` and the source-validation list) and detects partial hook wiring on upgraded targets — the settings-snippet decision now requires **both** `lint.sh` (PostToolUse) **and** `dev-agent-guard.sh` (PreToolUse) to be referenced in `settings.json`. Targets installed before this change get `.claude/settings.foundation.json` dropped with merge instructions covering both hook entries. Help text and post-install banner updated to mention the new guard hook.
- `install.sh` upgraded from "drop a snippet, ask the user to merge" to **auto-merge by default** when a target already has `.claude/settings.json` and a hook is missing. Uses `jq` (idempotent upsert keyed by hook command), preserves all of the user's other fields (permissions, model, env, their own hooks), writes a timestamped backup next to the file (`settings.json.backup-YYYYMMDD-HHMMSS`), and validates the merged output is still parseable JSON before overwriting. Falls back to the original snippet-drop path if `jq` isn't installed or the merge fails (e.g., target's `settings.json` is invalid JSON) — on fallback the backup is removed so it doesn't leak. Tested across six scenarios: fresh install, no-hooks target, upgrade-with-lint-only, user-already-has-Bash-PreToolUse-hook (preserved alongside our `Agent` matcher), invalid-JSON-falls-back-to-snippet, and re-running the installer is a no-op for settings.
- 2026-currency audit applied across the fundamentals skills. Cross-referenced all 7 skills for scope overlap (none found needing structural change — the existing cross-links compose cleanly) and revised content against current authoritative sources. Per-skill changes:
  - `architecture-fundamentals`: flagged Netflix Hystrix as end-of-life; recommended Resilience4j / Polly / opossum / gobreaker / pybreaker for new circuit breakers. Promoted OpenTelemetry from "or equivalent" to default (2025 logs went stable over OTLP, completing the three-pillar story). Added DORA delivery metrics (deployment frequency, lead time, change failure rate, failed-deployment recovery time, rework rate) alongside SLI/SLO in `references/observability.md`. Added Chaos Engineering as an SLO partner with explicit error-budget gating. Clarified the sagas-vs-2PC stance toward the 2024 hybrid consensus (sagas first, 2PC narrow). Made monolith-first the explicit default following the 2024 Fowler/Newman conversation.
  - `queue-fundamentals`: clarified that Kafka's idempotent producer has been on by default since 3.0 and that end-to-end exactly-once requires idempotent producer + transactional producer + `isolation.level=read_committed` consumer (Kafka-to-Kafka only). Added a Kafka 4.0 / KRaft-only / ZooKeeper-removed note to `references/broker-selection.md`. Elevated the Stripe-style HTTP `Idempotency-Key` contract (now an IETF draft) to a first-class principle in `references/idempotency.md` with schema, TS sketch, and rationale tying it to message-level idempotency.
  - `database-fundamentals`: sharpened the engine-specific `REPEATABLE READ` distinction — Postgres `RR` is snapshot isolation and prevents lost updates via 40001; MySQL InnoDB `RR` does **not** prevent lost updates on read-modify-write despite the name. Added Postgres SSI as a first-class alternative to `SELECT FOR UPDATE`. Added `ON CONFLICT` vs `MERGE` decision rule in `references/transactions.md` (OLTP single-row vs bulk ETL with retry loop). Added Spirit to `references/migrations.md` as the modern successor to gh-ost / pt-online-schema-change.
  - `git-workflow`: clarified that Conventional Commits v1.0.0 only *mandates* `feat` and `fix` (plus `!` / `BREAKING CHANGE:`); the rest of the project's type list (`refactor | chore | docs | spike | test | perf | build | ci`) is a project choice, with `spike` called out as a project-local extension. Added an AI-assisted PR review section in `references/pull-requests.md` covering scope (mechanical first-pass), policy (never counts toward required approvals), and the human-vs-AI division of labor.
  - `hexagonal-backend`: added a "Relation to Vertical Slice Architecture" section framing VSA as **complementary, not competing** — VSA is a physical layout choice (feature-scoped folders), hexagonal's dependency-direction rule is a logical invariant; they compose, and VSA is the lighter answer for CRUD-heavy services.
- Documentation and agent specs refreshed for **type-aware** execution — `feat`, `fix`, `refactor`, `chore`, `docs`, `spike` no longer all run the same phases. `qa` and `retro` carry the brunt of the type-aware behavior (regression-first for `fix`, skipped with stub for `chore` / `docs` / `spike`, recommendations-only for `spike`). ([7ec293f](../../commit/7ec293f), [f79b663](../../commit/f79b663))
- `pm` agent now receives interview Q&A as input rather than running the interview itself; `AskUserQuestion` removed from its tool list. ([acf8964](../../commit/acf8964))
- `README.md` and `WORKFLOW.md` updated to describe the main-agent orchestrator role and the five remaining sub-agents. ([acf8964](../../commit/acf8964))
- `install.sh` extended to install the new skills, rules, hooks, templates, and follow-up registries. ([7ec293f](../../commit/7ec293f), [f79b663](../../commit/f79b663))

### Fixed

- `.claude/hooks/lint.sh` Go branch reworked so a single-file edit is linted in its real package context and a `golangci-lint` that *fails to run* can no longer pass silently. Two problems fixed: (a) the old branch ran `golangci-lint run "$FILE_PATH"`, but Go cannot type-check one file in isolation — sibling-package symbols read as "undefined", producing a false cascade — so the branch now lints the edited file's **package** from its module root (walked up to the nearest `go.mod`, which also makes it correct in a multi-module workspace: each file is linted in its own module) and filters output to the edited file's path so pre-existing lint debt in sibling files never blocks the edit; (b) that filter was applied across *all* non-zero exits via `|| true`, so a run that produced no path-matching lines because it had errored out — a broken `.golangci.yml`, an unresolved package — left the hook exiting 0 and reporting a clean lint that never actually happened, a silent failure that is especially dangerous in a multi-module tree where each project may carry its own `.golangci.yml` (one broken config silently disables linting for every edit in that project). The branch now captures the exit code and separates *no findings in this file* (exit 0; or exit 1 = findings that all filtered out as sibling debt → don't block) from *the linter could not run* (any other code → surface the raw `golangci-lint` output and exit 2). Verified end-to-end through the hook against four real `golangci-lint` v2.10 scenarios: clean (exit 0 → pass), finding-in-file (exit 1 → blocks with the issue), broken `.golangci.yml` (exit 3 → now blocks with the config error instead of passing silently), and unresolved package (exit 7 → surfaces).
- `/dev`: orchestrator + spec interview moved from a sub-agent into the main agent. Claude Code sub-agents cannot use `Agent` (no nested spawns) or `AskUserQuestion` (no user prompts), so the previous design silently failed at the first hop. Orchestrator promoted to a main-agent script at `.claude/orchestrator.md`, loaded by `/dev`. `install.sh` gained an upgrade-cleanup block so existing targets lose the stale sub-agent file. ([acf8964](../../commit/acf8964))
- `/dev`: drop the short-lived `.claude/agents/orchestrator.md` redirect stub introduced in [5bd0475](../../commit/5bd0475) — official Claude Code docs ([sub-agents](https://code.claude.com/docs/en/sub-agents)) do not describe a "redirect stub" pattern, and any `.md` file under `.claude/agents/` simply registers as a spawnable sub-agent, so the stub *enlarged* the available-agents list with a tempting "orchestrator" entry rather than removing it from view. Tightened `.claude/commands/dev.md` and `.claude/orchestrator.md` to make the no-spawn rule explicit ("there is no `orchestrator` sub-agent; the spawn will fail with `Agent type 'orchestrator' not found`") and rely on the natural "agent not found" error as the backstop. `install.sh` now restores the `CLEANUP` row that removes any stub left over on upgraded targets, plus a `${CLEANUP[@]+"${CLEANUP[@]}"}` guard so the loop stays safe under `set -u` if `CLEANUP` is ever emptied again.

### Removed

- `.claude/skills/plan-writing/plan-document-reviewer-prompt.md` — superpowers-style template for dispatching a separate "plan document reviewer" subagent. The `/dev` workflow uses `lead` in review mode for plan review (Phase 2 step 5), so this artifact had no caller in this repo. ([78dc313](../../commit/78dc313))
- `.claude/agents/orchestrator.md` sub-agent file (replaced by the main-agent script at `.claude/orchestrator.md`). ([acf8964](../../commit/acf8964))
  - **Note:** a short-lived *redirect-only* stub at the same path was introduced in [5bd0475](../../commit/5bd0475) and removed again later — see the matching entry under `Fixed`. There is now **no** `orchestrator` sub-agent. The only worker sub-agents are `pm | lead | engineer | qa | retro`.

[Unreleased]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.27...HEAD
[3.2.27]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.26...v3.2.27
[3.2.26]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.25...v3.2.26
[3.2.25]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.24...v3.2.25
[3.2.24]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.23...v3.2.24
[3.2.23]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.22...v3.2.23
[3.2.22]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.21...v3.2.22
[3.2.21]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.20...v3.2.21
[3.2.20]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.19...v3.2.20
[3.2.19]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.18...v3.2.19
[3.2.18]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.17...v3.2.18
[3.2.17]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.16...v3.2.17
[3.2.16]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.15...v3.2.16
[3.2.15]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.14...v3.2.15
[3.2.14]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.13...v3.2.14
[3.2.13]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.12...v3.2.13
[3.2.12]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.11...v3.2.12
[3.2.11]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.10...v3.2.11
[3.2.10]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.9...v3.2.10
[3.2.9]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.8...v3.2.9
[3.2.8]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.7...v3.2.8
[3.2.7]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.6...v3.2.7
[3.2.6]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.5...v3.2.6
[3.2.5]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.4...v3.2.5
[3.2.4]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.3...v3.2.4
[3.2.3]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.2...v3.2.3
[3.2.2]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.1...v3.2.2
[3.2.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.2.0...v3.2.1
[3.2.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.8...v3.2.0
[3.1.8]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.7...v3.1.8
[3.1.7]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.6...v3.1.7
[3.1.6]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.5...v3.1.6
[3.1.5]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.3...v3.1.4
[3.1.3]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.2...v3.1.3
[3.1.2]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.12.0...v3.0.0
[2.12.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.11.0...v2.12.0
[2.11.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.10.0...v2.11.0
[2.10.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.9.2...v2.10.0
[2.9.2]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.9.1...v2.9.2
[2.6.8]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.7...v2.6.8
[2.6.7]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.6...v2.6.7
[2.6.6]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.5...v2.6.6
[2.6.5]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.4...v2.6.5
[2.6.4]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.3...v2.6.4
[2.6.3]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.2...v2.6.3
[2.6.2]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.1...v2.6.2
[2.6.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.14...v2.6.0
[2.5.14]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.13...v2.5.14
[2.5.13]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.12...v2.5.13
[2.5.12]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.11...v2.5.12
[2.5.11]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.10...v2.5.11
[2.5.10]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.9...v2.5.10
[2.5.9]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.8...v2.5.9
[2.5.8]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.7...v2.5.8
[2.5.7]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.6...v2.5.7
[2.5.6]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.5...v2.5.6
[2.5.5]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.4...v2.5.5
[2.5.4]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.3...v2.5.4
[2.5.3]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.2...v2.5.3
[2.5.2]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.1...v2.5.2
[2.5.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.3.2...v2.4.0
[2.3.2]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.0.2...v2.1.0
[2.0.2]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.6.0...v2.0.0
[1.6.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/releases/tag/v1.0.0
