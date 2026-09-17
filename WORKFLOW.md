# Change Loop workflow

**Version 3.5.18**

Change Loop is an OpenSpec-native control plane for safe, economical software
changes in brownfield repositories:

```text
Investigate? → Change → Build → Prove → Land
```

This document owns the detailed lifecycle contract: what each phase means,
which state transitions are allowed, what blocks progress, and what authority
the harness never infers. Start with `README.md` or `README.th.md` for the user
journey. Runtime structure and operator commands belong to
`.claude/harness/README.md`; provider, receipt, and proof details belong to
`.claude/harness/EVIDENCE.md`.

## Why this shape

OpenSpec stores the agreement, the native coding agent implements it, and
deterministic project-owned providers prove it. The harness owns state,
isolation, budgets, evidence identity, authority boundaries, and recoverable
Land. Rigor scales with risk and evidence needs, not a task-size phase matrix.

## Ownership and user states

The user owns intent, consequential product decisions, explicit Land authority,
final diff review, and any later Git or external side effect. The coding agent
owns implementation and product repair. The harness owns compilation, tool
preparation, isolation, routing, evidence, permissions integration, recovery,
Apply, and archive. An external owner owns credentials, remote systems, and
human verdicts outside the execution boundary. Harness configuration or host
permission is never turned into a question or command for the user.

Normal output projects internal actions into five user states: `WORKING`,
`NEEDS_DECISION`, `WAITING_EXTERNAL`, `TARGET_REACHED`, and `DELIVERED`.
`DONE` at a requested Build or Prove target projects `TARGET_REACHED`, with
`delivered: false` and the next route preserved. Only `reached: archived`
projects `DELIVERED`. Internal worker and proof-lock waits remain harness-owned
`WORKING`; `WAITING_EXTERNAL` requires a real external owner. Internal commands,
request IDs, journals, repair graphs, and resume tokens remain machine-facing.

## Lifecycle commands

### `/investigate <problem>`

Use Investigate only when the problem or direction is unclear. It is bounded
and read-only with respect to product code. `investigate --template` defines a
versioned fact, hypothesis, option, decision, and conclusion record. Running
`investigate <record.json>` discovers and hashes repository sources, persists a
machine-owned resumable state with compact metrics, and returns one typed
agent, user, or harness action. Three unchanged attempts expose a no-progress
boundary without discarding the exact resume route.

Each inspection also generates `openspec/investigations/<id>.report.md` from the
validated state: conclusion, recommendation/reasons, facts and source links,
hypotheses, comparisons, unknowns, decisions, and next action. The agent writes
record content in the user's language and returns a short summary with the
current report link. `language: "th"` selects Thai headings; English is the
fallback. JSON stdout and handoff remain machine-readable. Generated reports
are excluded from investigation source binding, and authored `<id>.md` notes
are preserved. A report failure preserves research and returns a regeneration
route with no current report or handoff advertised. Reporting never starts Change.

Set the optional `activeChange` field to an existing change ID when the question
arises during Build or Prove. The harness then reads the active isolated root,
binds its workspace identity and base into state and handoff, and fails closed
with the same record command if that sandbox is missing or stale. Omitting the
field preserves standalone Investigate behavior against the project root.

`/investigate <decision> --compare` may build disposable alternatives only
under `.foundation/prototypes/`. It always records the selected conclusion in
`selection.md`. Prototype artifacts are never evidence.

A `ready-for-change` result emits a digest-bound handoff. The agent copies it
into semantic draft v4 as `investigation`; Change verifies the state and source
digests before compiling and retains the conclusion in the agreement.

### `/change <intent>`

Change authors one semantic draft v4 with compact bookkeeping and enough
behavioral detail to understand scope and acceptance without chat history.
Reconcile the relevant available conversation, latest corrections, and retained
decisions before drafting, then check their coverage in the compiled packet.
Use diagrams and affected folder mapping when boundaries, flow, or structure
need explanation; preserve that context for Build and session restart.
Agent-authored document prose follows the user's requested document language,
or the language of their current request; machine syntax and canonical
identities stay stable. See the [Change authoring workflow](.claude/skills/change/references/workflow.md)
for the detail, language, and compiled-packet inspection rules.
The transactional compiler creates
`openspec/changes/<id>/`, assigns stable cross-ledger IDs, validates the complete
agreement, installs it, and prepares isolation. The draft records:

- harness-required discovery coverage, ambiguity, impact, coupling, and size;
- semantic requirements and task outcomes;
- claim-to-task coverage and required evidence capabilities;
- semantic security and review triggers;
- typed extensions only when the change needs them.

Rapid changes contain `proposal.md`, `tasks.md`, and `evidence.yaml`. Standard
changes add delta specs and add `design.md` only for a load-bearing decision,
migration, compatibility boundary, architecture, diagram, integration, or
prototype selection. `execution.yaml`, `repositories.yaml`, `handoffs.yaml`,
and `grounding.yaml` appear only when execution differs from detected defaults,
multiple repositories participate, external authority is required, or a
non-derived material decision must be recorded. Absence has versioned
virtual-default semantics.

Before compilation, the harness requires every risk-derived discovery dimension
to be covered, source-grounded as not applicable, investigated, or resolved by
the user. It validates decision dependencies and exposes only the current
frontier; the agent interprets sources and authors requirements, while the user
owns consequential choices. After compilation, the OpenSpec packet is the
source of truth. The semantic draft is temporary and `.foundation/` is derived
coordination state. Draft v1 remains compatible, draft v2 retains its
unambiguous bookkeeping behavior, and draft v3 remains readable.

Run `change start <draft.json> --inspect` before compilation. It returns one
typed `EDIT`, `ASK_USER`, or `DONE` action with an exact resume route. An
unresolved user-owned coverage row must link to its decisions through
`decisionKeys`; repository-owned investigation is returned before user
questions. After `DONE`, rerun with `--consume-draft` to compile atomically.
Typed `riskSignals` provide language-neutral triggers for access control,
persisted data, integrations, performance SLOs, UI accessibility, operational
risk, and external side effects.
Inspection persists one machine-owned snapshot bound to the draft and its
grounded-source digests. Before each v4 inspection the harness performs bounded,
read-only repository discovery and ranks relevant specs, tests, callers,
integrations, persistence, and permission boundaries. Typed size, impact,
coupling, risk, and repository signals choose the intake depth without dropping
mandatory dimensions. Enumeration has fixed hard safety limits; adaptive limits
bound only the selected read-set and question frontier. Questions already answered by source facts, duplicate
alternatives, and unsupported recommendations are rejected. Git-aware discovery
omits ignored output; an oversized undeclared file is reported but cannot poison
the whole scan, and unsupported dependency languages are reported as partial
graph coverage. `discovery.sourceDigest`, source facts, and recommendation
evidence must match the selected inventory. Compact effectiveness counts survive
successful compilation in runtime, but no chat or interview history is kept. A
changed selected source invalidates readiness and returns agent-owned coverage refresh.

For newly started changes, present the compiled spec, scope, and acceptance
criteria and wait for explicit user approval before Build, including `/dev`.
Record it with `change resolve <change> --approve-spec --decision-ref <ref>`.
Runtime approval binds agreement content and revision; task checkboxes alone
do not invalidate it. Agreement edits require renewed approval. Legacy
primitive-created/in-flight changes retain their compatibility route.

Referenced diagrams, prototype selections, and local integration documentation
must resolve to regular files inside the project. Remote integration sources
must use HTTPS and a fixed version rather than `latest`, a branch, or another
floating alias. An amendment may extend a task's claim coverage, but changing
its outcome or verification command requires a new task so completed work
cannot silently change meaning.

When Build discovers new behavior, amend the same agreement before continuing:

```bash
claude-foundation change amend <change> <amendment.json> --inspect
```

A version-4 amendment includes discovery coverage for every added requirement;
follow its typed intake actions and source digest, then replace `--inspect` with
`--consume-amendment` after `DONE`. The returned proof command is the exact
post-amendment recovery route. The transaction validates and appends that delta
to the compiled proposal.
During Build, the amended packet stays in the isolated workspace until Land.
After approval of that revision, `advance` resumes from this packet without
importing the older target agreement. `sandbox sync` can replay code onto a moved
base while preserving the amended packet, approval, and contract revision. The
packet is copied and verified in staging before replacing the worktree; an
interrupted replacement retains a verified recovery checkpoint. Restoring that
checkpoint records the base already incorporated in staging, including when the
target has moved again. The aggregate proof is invalidated separately; retained
provider receipts and exact spec approval are rechecked, not silently renewed.

If the target packet changed, Build and sync return an agreement conflict.
The agent compares both packets and asks for the intended merge or retained
agreement. After the isolated result is approved, record that resolution with
`sandbox sync <change> --resolve openspec/changes/<change>`. This explicitly
accepts the current target packet as the baseline that Land may replace; it does
not copy the target over the amendment. Unknown or stale baselines are never
silently refreshed, and later target edits still block Apply. Code conflicts
continue to use their existing replay or copy-path resolution routes.
Version-3 amendments keep their compatibility shape. The amendment transaction
preserves an unaffected passing receipt only across one explicit revision when
its declared provider, claims, and input fingerprints remain exact. Everything
affected, missing, or ambiguous is rerun through the returned Prove route.

A change that cannot be proven is retired explicitly, never deleted by hand:

```bash
claude-foundation change abandon <change> --reason <reason> --decision-ref <ref>
```

Abandon releases leases, cleans up isolation, and moves the packet, runtime
state, receipts, evidence, and transactions to
`.foundation/recovery/abandoned/<id>/` with an audit record. It requires a real
user decision, never touches Git, refuses archived changes, and asks whether to
keep or revert already-applied files before acting.

### `/build <change>`

The normal entrypoint is:

```bash
claude-foundation advance <change> --through build
```

The coordinator validates the agreement, prepares or synchronizes isolation,
compiles the task graph, and returns one bounded protocol-v6 action:
`EDIT`, `REPAIR`, `RUN_EXTERNAL`, `WAIT`, `ASK_USER`, or `DONE`.
`tasks.md` is the only implementation ledger. `handoffs.yaml` separately owns
AWS, cluster, secret, Terraform, deploy, restart, or other operations that need
external authority.

Build writes only inside the declared isolated workspace. Git projects normally
use detached worktrees; a dirty target or non-Git project uses an isolated copy.
This is workspace integrity, not OS process, network, or secret containment.
Mutating shell commands must start with `cd` to the workspace root or a literal
directory inside it, joined by `&&`; on Claude Code the phase guard pins the
shell's reported directory as that anchor when it is already inside the
workspace, and audits the pin. The phase guard and
`claude-foundation exec` reject direct path escapes and symlink traversal, but
the host still owns process isolation for indirect or dynamically computed
effects. Copying or linking files from outside the workspace is refused as
well: a workspace never borrows the checkout's dependencies. Sandbox creation
prints a NOTE with the exact `sandbox.setupCommand` snippet when the project
has a lockfile but declares no setup command.

Before Build, the harness compiles and persists an execution-preparation plan
from selected repositories, setup commands, provider wiring, and tool identity.
It reuses ready records, prepares only missing project-local dependencies, and
retries only failed repository setup records. The pinned OpenSpec CLI may be
installed under `.foundation/tools`; it is never installed globally. A setup or
host-integration failure remains Harness-owned repair and is not emitted as a
command for the user.

Unattended Build requires a trusted host-owned attestation:

```bash
claude-foundation sandbox challenge <change>
claude-foundation sandbox create <change> --unattended --attestation <file>
```

`--unattended` is presence-only; valued or duplicate forms are rejected before
telemetry or mutation. An attestation is short-lived, project-, agreement-, and
permission-bound, single-use, and does not turn a worktree or container into a
security boundary. The complete operator contract is in the harness guide.

One-task changes without shared external authority stay in the current agent.
Independent tasks in separate repository workspaces may use native workers.
Tasks sharing a workspace stay serialized because lease release observes the
whole repository diff; disjoint paths alone cannot identify their writer.
The harness plans dependency and resource scopes,
leases them all-or-none with fencing generations, and accepts only observed
writes inside the granted authority. Load one primary construction skill per
task and only the cross-cutting security or observability skills whose triggers
apply.

A force-released lease grants no result authority. If its task was already
checked complete, the planner returns it for leased verification without
rewriting the checkbox; only an accepted release clears that recovery.

For multi-repository work, the committed topology selects repositories and
access modes before task, provider, or worker planning. Providers may execute
in one repository while consuming a declared set of other isolated
repositories. Read-selected Git dependencies participate in proof but never
produce a Land mutation node.

The declared selection—not the number of surviving runtime records—decides
whether a lifecycle is composite. Selecting one non-root repository is
multi-repository even when `root` has no product writes. After isolation, every
selected non-root repository must retain a worktree record whose path, target,
access mode, and base head match the catalog. Changed-surface hashing, review
packets, provider manifests, Apply, and Land all use that binding and never
fall back to the live target.

`sandbox inspect <change>` reports missing, unexpected, missing-path, and
invalid-worktree records without executing a PATH-resolved Git command.
`sandbox create <change> --all` repairs missing bindings idempotently while
preserving valid worktrees. Repair or retire an incomplete repository selection
before resume; never prove a subset.

An in-contract defect is repaired without asking again. Only evidence that
changes locked behavior, compatibility, security, data, or rollout opens one
audited batched amendment. Synchronize any amended agreement or moved target:

```bash
claude-foundation sandbox sync <change>
```

Sync increments the agreement revision and invalidates proof that no longer
describes it. A worktree replay is prepared against the current target before
replacement; a multi-repository replay prepares every writable repository
before replacing any; a copy fast-forwards files only the target changed.
Double-edited files stop as named `CONFLICT` entries and leave the existing
sandbox intact. Merge the target version in the sandbox and sync again, using
`--resolve` for a copy.

Several changes may be active at once. Overlapping path or repository scopes
never block Build, Prove, or Land across changes; whichever lands later
synchronizes onto the moved target as above, resolves any double edit, and
re-proves. Only an explicit `[resources:]` token names a resource two changes
cannot use at once, and those still serialize.

Packet artifacts flow from `openspec/changes/<change>/` in the target into the
sandbox. An artifact edited only in the sandbox blocks sync; only `tasks.md`
completion ticks merge back automatically.

### `/prove <change>`

The normal resumable entrypoint is:

```bash
claude-foundation advance <change> --through proven
```

Proof validates the agreement, hashes relevant inputs, resolves claims to
providers, reuses valid receipts, runs missing or stale project-owned evidence,
routes review before acceptance, and writes a proof bound to the workspace.
Required evidence that is failed, missing, stale, erroneous, or inconclusive
blocks Land.

Composite identity binds repository content and agreement revision rather than
Git commit identity. Recorded base heads remain explicit recovery and Land
state: an unsynchronized target still stops, while moving to a history-only
commit with byte-identical content does not charge another review.

A provider that executed and failed has three honest exits:

- fix the cause and rerun;
- rewire the provider in `execution.yaml`;
- withdraw the capability under a recorded decision with `change waive`.

A waiver removes the capability from the required set while the claim continues
to declare it. It remains visible as `user-waived`, preserves receipts already
earned, and can be revoked. There is no route that turns failed evidence into a
pass or lands it silently. Review may use the same explicit waiver route;
acceptance retains its explicit withdrawal route. New waivers bind the current
workspace and contract revision. Changed content expires them; original failed
receipts remain available and proof names the accepted exceptions.

When executable wiring is absent, `evidence detect` reads project manifests
without executing scripts, `evidence init` previews additions and writes only
with `--write`, and `evidence doctor` reports ambiguity or external authority.
Detection never installs tools, creates receipts, overwrites configured
providers, or weakens claims.

`change audit` checks scenario → claim → task → provider traceability, including
negative security paths and migration rollback/integrity. Tasks link claims
explicitly with `[claims:<claim-id>]`.

Every phase gate follows the same convergence rule: collect independent
findings, repair one dependency-ordered in-contract batch, and selectively
rerun invalidated checks. Product repair has no fixed cycle ceiling while its
semantic progress identity changes. Two unchanged automated transitions produce
the typed no-progress boundary.

Thrown Build, Prove, or Land dependencies are captured in the same action
envelope with their original reason and exact recovery route. Decisions,
authority, resources, conflicts, and repeated no-progress preserve state.
`proof readiness`, `proof advance`, `proof run`, and direct authority commands
remain diagnostic or integration primitives behind `advance`.

### `/land <change>`

The complete delivery command is:

```bash
claude-foundation advance <change> --through archived
```

This explicit invocation supplies Land authority. Land checks proof freshness,
binds a resumable grant to the exact change, proof, repository graph, and target
roots, applies the proven isolated diff when necessary, verifies state identity,
delegates semantic spec synchronization and archival to the pinned OpenSpec
CLI, and finishes only at `archived`. `proven` is not completion.

`land check` is read-only. Apply is a transaction over the target. An
interrupted transaction remains pending until `land recover` settles it under a
recorded decision. `restore-backup` restores and verifies the pre-apply state;
`keep-current` preserves the target, marks the projection unapplied, and
requires sandbox sync before Land resumes.

The projection is confined to Git-tracked files plus paths declared in
`tasks.md`. An untracked path no task names is neither evidence surface nor a
Land deletion. A target path is deleted only when the proven sandbox removed
it. Conflicts never overwrite unrelated target edits.

Every writable selected repository is prepared before the first target write
and then applied in dependency order with durable per-repository checkpoints.
Each target finishes `applied-uncommitted`: its intended diff is visible for
the user to inspect, while Git HEAD and index remain unchanged. Read-only
repositories remain unchanged. Re-entering `/land` resumes the same grant and
skips already verified nodes; it never requires the user to assemble a journal,
grant, commit, or recovery command.

Land never implies permission to commit, push, publish, deploy, or open a pull
request. Those effects require separate explicit authority.

### `/deliver <change>` (optional)

Deliver is an optional post-Land transaction. The normal change lifecycle is
still complete at `archived`; no delivery state, provider work, presentation
evidence, prompt, or gate exists unless the user explicitly invokes
`/deliver <change>`.

The agent runs one composition command, `claude-foundation deliver advance
<change>`, and executes its automatic recovery internally. The user never
assembles readiness, preparation, commit, push, provider, or resume commands.
The invocation grants only the authority to create an isolated feature branch,
commit the proven Land projection, push that branch, and open or reuse a pull
request. It does not authorize force-push, default-branch push, merge, deploy,
publish, evidence disclosure to a new store, or product edits.

Deliver reconstructs the projection in a separate Git worktree, leaving the
user's checkout, HEAD, index, and unrelated edits unchanged. It binds durable
checkpoints to the archived change, proof run, target head, and Land projection;
after interruption it reconciles the local commit, remote branch, and provider
state before taking the next missing action. A repeated invocation verifies and
returns the existing pull request rather than creating another.

Before committing, Deliver verifies staged Git blobs against the retained Land
projection. Before publishing, it verifies the actual commit tree again, including
resumed commits and changes made by Git hooks. Changed bytes, file modes, missing
files, or additional paths block publication rather than inheriting old proof.
It fetches the proposed remote PR base on each unfinished attempt and requires
that base to contain the proven Land base; unrelated feature-branch history or
a force-moved base requires a new proven change. Independent sibling repositories
receive their own PRs; only declared submodules produce root gitlink updates.

Delivery protocol 2 binds file modes to Land and archive evidence. Legacy changes
without mode evidence stay archived and cannot use automatic Deliver. The agent
can review the current diff for separately authorized Git publication, or leave
the work archived; a no-op follow-up Change is not a migration route. Current
modes are never substituted for missing proof. Valid dangling symlinks retain
their link text. Built-in Git text/binary
conversion (including CRLF/LF) is bound to the proven bytes and verified as Git
objects; a changed conversion configuration stops with a retry route. Custom
clean filters (including LFS) and working-tree encodings currently return an
explicit unsupported-conversion boundary before staging, without executing the
filter. Keep those project settings intact and choose separately reviewed Git
publication or leave the work archived. For an interrupted supported conversion,
restore the bound configuration to resume.
Effective push URLs, including rewrites and multiple destinations, must all
identify the approved repository. They are checkpoint-bound and rechecked before
push. Multi-repository Deliver validates all selected projections and destinations
before the first publication. The live remote default branch and the selected
PR base are both protected.

The PR body has one core contract—Summary, Why, Related Work, Type, included and
excluded Scope, Test and Evidence, Risk, Rollback, and Monitoring—plus the
applicable Frontend, Backend, Bug, Refactor/Technical Debt, Database/Migration,
Infrastructure/DevOps, Performance, or Security/Hotfix sections. Deliver reuses
content-bound proof receipts and archived OpenSpec sources. It may collect only
read-only presentation evidence; it never invents evidence or changes code. A
missing optional presentation artifact produces a draft according to project
policy, while missing or stale required evidence blocks Deliver without
changing the already-archived lifecycle result.

Success requires provider read-back proving that the open PR's base, head, and
commit match the delivery receipt. The final user-facing result is the verified
PR URL. Decisions remain with the user, semantic implementation and bounded
narrative work with the agent, and deterministic Git/provider orchestration,
retry, and recovery with the Harness.

### `/changes` and `/dev`

`/changes` distinguishes in-progress, proven, stale-proof, and ready-to-land
changes and names the next command for each. Session start may report the same
digest, but a hash-free digest never implies proof freshness. Orphaned runtime
state is reported rather than hidden.

`/dev` is compatibility composition:

```text
/change → /build → /prove
```

It never lands by implication. `--plan-only` stops after Change and
`--resume <id>` resumes an active OpenSpec change.

## Agreement lanes

### `foundation-rapid`

Rapid is allowed only when all are true:

- impact is low and coupling is isolated;
- no public contract or persistent migration changes;
- no semantic security or irreversible-effect trigger applies;
- unit or static evidence is sufficient.

### `foundation-standard`

Standard covers every other change. Design records only decisions that
constrain implementation, compatibility, rollout, rollback, or proof. Size
affects budgets and slicing only; it never weakens assurance.

## Evidence contract

`evidence.yaml` is the stable behavioral contract; `execution.yaml` holds
replaceable commands, reports, services, resources, and environment-variable
names. Provider names describe what is proven, not which tool runs. Run
`claude-foundation providers` for the installed catalog and use
`.claude/harness/EVIDENCE.md` for adapters, receipts, resource locks, signed
envelopes, Playwright annotations, and reuse rules.

Execution graph v3 includes setup, service, task, provider, and Land nodes.
The scheduler prioritizes the longest ready dependency path, then fills the
configured capacity with non-conflicting nodes. Valid receipts are reused;
required services and repository setup commands start in bounded independent
batches, and a partial service-start failure stops every session already born.

Test claims automatically require suite-level discovery. Risk-triggered changes
require review. Changed-surface policy may add supply-chain, migration,
accessibility, compatibility, security, review, or deployment obligations after
Build.

Because the real surface exists only after Build, `change resolve --surface`
forecasts those obligations during Change. Forecasts name the triggering glob
but never gate or reduce the requirements derived from actual changed files.
An inferred capability is binding only when a claim declares it or the project
has wired a provider; otherwise it remains a visible advisory. Review stays a
gate and has its own policy.

Consumer quality is opt-in through
`quality/foundation-quality.json`. It is report-only until explicitly enforced,
never expands the Change surface, and never converts unsupported, unavailable,
or unmapped measurements into zero or pass. The installed operational contract
is `.claude/harness/CONSUMER-QUALITY.md`.

Receipts bind provider and protocol versions, claim scope, relevant inputs,
execution configuration, environment identity, artifacts, observations, and
timestamps. Executable receipts record the actual command and log; external
receipts require real provenance and durable references. A provider protocol or
fingerprint change invalidates its prior receipt.

Remote CI and semantic acceptance may return signed, workspace-bound envelopes.
Signatures, issuer, cases, observations, transitions, and artifact digests are
verified before a receipt is written. Hidden oracle content stays external, and
review prose cannot replace a missing or failed required case.

An unavailable configured provider returns `INFRASTRUCTURE_ERROR` with honest
recovery choices: diagnose, retry, record verifiable external evidence, or
configure an available project-owned command proving the same claims. It never
becomes a zero or pass.

Pending implementation returns `NEEDS_CODE_CHANGE`. Agreement or topology
problems return `CONFIGURATION_ERROR`. Subjective acceptance or a contract
contradiction returns `NEEDS_USER_DECISION`. Every non-ready result names an
exact recovery or resume route.

The decision envelope is machine-facing. The agent explains it in the user's
language and owns routine commands and metadata. It
never asks the user to run a safe authorized operation it can perform.
For human review and acceptance, the user decides the concrete verdict; the
agent records that confirmed decision and resumes. Human decision ownership
does not require human CLI execution. Command permission alone is not a review
verdict. The host approval and denial handling procedure is in
`.claude/commands/references/decision-policy.md`.
Genuine decisions present honest
choices, including reject, inconclusive, or pause; they never contain a
preselected passing receipt.

## Review, acceptance, and external authority

Review has one persisted 30-minute window beginning at the first dispatch.
Retries, fallbacks, and delta review share its deadline; resume never resets it.
At expiry, report completed findings and unreviewed scope and ask whether to
continue, Land with explicit acceptance of remaining risks, or pause. Only a
user decision may open another 30-minute window, recorded through
`change resolve <change> --continue-review --decision-ref <ref>`.
Timeout is not a pass. Try repair first; if it cannot progress, explain the
attempted remedies and offer further work or explicit waivers for the current
diff before Land. Conflicts, incomplete Apply, and missing side-effect authority
still require their actual resolution, never a claim of successful delivery.

Under `workflow.reviewPolicy: "risk-tiered"` every change receives review, with
the correction circuit bounded by risk:

- **low** — one full AI review; a material correction promotes the route to
  medium;
- **medium** — one full AI review, one correction batch, and at most one fresh
  delta review closing the first-round finding IDs;
- **high** — material risks are settled in the initial Decision Sheet, followed
  by one full AI review and at most one post-correction delta.

High risk includes authorization or secrets, public or cross-repository
contracts, migration or destructive state, money, concurrency,
replay/idempotency, brokers or real wire behavior, and activating legacy
behavior. Medium includes other non-low impact/coupling and declared review
risk.

Review begins from a bounded review packet, never Build history. Its changed
surface includes committed and dirty paths from recorded repository bases plus
review contract artifacts. A missing base blocks review instead of appearing
clean. Every receipt records the actual reviewer, session, implementation
subjects, findings, closures, and scope.

Concurrent-change sync reuses identity-valid review evidence through the
[existing proof binding rules](.claude/harness/EVIDENCE.md). No-op sync preserves
proof and lifecycle progress; changed inputs still require a current proof.
This does not reset review waves or grant Land authority.

Critical work requires a different model/provider family or a human unless the
committed project policy explicitly waives diversity. Reviewer independence is
separate and may be waived only through committed policy. Each waiver relaxes
only its own axis and is named in both packet and receipt.

Configured `fallbackReviewers` are tried in order only after an infrastructure
error. `fail` and `inconclusive` are delivered verdicts and never fall through.
Packet inspection and finding/closure binding errors stop the current automatic
retry chain rather than dispatching the unchanged validation failure to another
model. The backend owns this routing through the existing commands.
The existing `advance --through` route reopens a binding failure only after the
retained packet/result validates again and the reviewer is ready, preserving
scope, attempt history, and infrastructure retry accounting.
A `main-session` fallback requires the explicit self-independence policy and
records observed provenance rather than guessing it.

The risk route is a circuit breaker, not a loop-until-pass rule. After the
allowed delivered AI waves, another open review is refused. A final in-contract
blocker must name affected claims and declared critical cases; current passing
provider evidence may then close those IDs deterministically without a third
AI. A hash chain binds attempts, scope, findings, closure, and receipts.
Deleting or renaming state cannot reset the limit; corrupt history fails closed.

Human acceptance is separate from review. Every new standard change explicitly
records whether subjective acceptance is required; `undecided` blocks
validation. Required acceptance binds named claims, nonblank criteria, human
identity, observation, provenance, durable evidence, and the final workspace.
The runtime never invokes a human, impersonates one, or manufactures approval.

`handoffs.yaml` owns external operations. Pending handoffs do not block Build or
evidence collection. Land blocks unresolved pre-Land or activation-coupled
operations. A declared post-Land operation does not require acknowledgement when
a claim proves the merged artifact is safe before activation; the archived
change preserves that operational obligation independently of `tasks.md`.
Acknowledgements, terminal outcomes, tickets, and evidence references are
optional operational records—never credentials. Archive means the code change
was delivered, not that deployment, activation, or production verification ran.

<a id="terminal-stops"></a>

## Recovery and user decisions

Some guards end a run rather than returning another repair action: exhausted AI
review waves, corrupt review history, a spent budget continuation, model budget
that cannot unblock the next step, a moved control repository during
multi-repository Land, reset staged submodule pointers, or an apply rollback
that could not complete.

Each stop preserves the change and returns a decision envelope with a typed
code, at least two honest options, a recommendation, and an exact resume route.
When `automaticRecovery` is marked, the known typed recovery is performed by
the harness and explained by the agent without opening a user interview. The
coordinator executes sandbox sync and resumes the original target; a conflicting
sync preserves the work and asks for the intended resolution. Other options are
translated into the user's language; the agent never treats a stop as a dead
end or infers authority. Retiring with `change abandon` is offered where valid.

Advance protocol 6 retains the existing actions and command routes. Recovery
observations and answers live in `advanceRecovery` on the existing runtime
record. Three unchanged repair handoffs across invocations request a decision;
two unchanged internal automated transitions do likewise. New process sessions,
proof run IDs, diagnostic wording, retry counters and bookkeeping revisions do not reset progress.
Relevant content, agreement, execution policy or actual delivery changes do.
Read-only inspection never counts as a repair attempt or records an answer.

Every question offers concrete alternatives, a recommendation and pause, with
the cause and retained repair observations. External waiting first asks whether
to retry, wait for the named owner/condition, or pause. An explicit wait answer
is reused only for the unchanged dependency, owner, condition and checking route.
Live proof workers remain working;
a dead worker returns to harness-owned diagnosis. Resumable internal Land
checkpoints advance automatically while their state progresses.

A stopped configured reviewer returns the existing `authority run` handoff,
not a read-only status command. The agent executes that bounded recovery with the
original implementation provenance and resumes Prove. A valid checkpoint is
reused without another model call; absent results follow the existing attempt
and infrastructure limits. Live reviewer controllers are never dispatched twice.

The agent records an explicit recovery answer using the fingerprint returned
with the decision:

```bash
claude-foundation advance <change> --decision retry|wait|pause \
  --decision-fingerprint <hash> --decision-ref <user-answer> --reason <approach>
```

The answer retains the prior `--through` target. Retry records the chosen
approach; wait is available only for an external dependency; pause preserves
the work without running setup or providers again. A recorded pause projects
`WAIT` with user state `PAUSED`, not another question or a claim of active work.
Answers are content-bound,
stale fingerprints are refused, and repeated identical references do not grant
another retry allowance. Changed scope requires a new decision. These answers
do not grant Land, waive evidence, extend a model/review budget, or authorize
external side effects. Those decisions keep their existing explicit routes.
Users supply decisions, never flags or runtime JSON.

An unresolved apply transaction blocks a new one. `doctor --change <id>` reports
it before Land and names the recovery operation.

## Invalidation

One relevant workspace snapshot supplies the identity shared by a proof and its
receipts. Runtime state, receipts, sandboxes, dependencies, other active changes,
and archives are excluded. Any relevant product or agreement edit makes the
affected proof material stale.

Executable providers normally bind product inputs rather than the change
packet, so a packet-only edit may re-finalize proof without rerunning them.
Review, acceptance, and semantic acceptance bind the packet because those
authorities read it. A provider may narrow executable inputs explicitly; the
proof plan shows the binding. Complete rules live in the evidence reference.

## Preflight and telemetry

Run `doctor --stage change|build|prove`. Change and Build permit commands that
are planned but not created yet. Prove requires executable providers and rejects
dependency cycles, report collisions, literal secret-like values, and
status-only readiness probes. Use `--require-archive` when the intended flow
includes Land.

Telemetry records only observed operation and usage metadata. Unknown requests,
tokens, cache, or cost remain unknown rather than zero. A complete token
measurement without price data is truthfully partial and may satisfy a policy
that requires a measured usage dimension; no measured dimension cannot.
Prompts and tool payloads are never copied.
When `advance` executes multiple lifecycle phases, its single operation row
carries disjoint phase intervals. Metrics attribute those intervals without
counting additional command invocations or overlapping parent time. Quality
lane timing includes adapter normalization and ratchet evaluation; structured
quality output is drained even when enforcement returns a failing exit code.

`metrics` and `feedback` expose cost, context, execution, reuse, repair, and wait
signals without counting several receipts from one process as independent
executions. Packet sizes, host imports, transcript cursors, and telemetry schema
belong to the harness operator guide.

## Sandbox and repository safety

Change Loop sandboxes protect workspace and apply integrity. They do not contain
processes, networks, host secrets, or system commands by themselves. Never
infer that a worktree or copy makes unrestricted execution safe.

- The target head and selected repository bindings are checked before Apply.
- `git apply --check` or the copy-mode equivalent runs before mutation.
- Apply identity covers only the proven touched-path projection.
- Touched paths and change artifacts are backed up and journaled.
- Failures roll back; an incomplete rollback stops future Apply attempts.
- The sandbox remains the proof subject until archive and proof audit finish.
- Conflicts stop without overwriting unrelated user edits.
- Mutation testing runs only in isolation.

If OpenSpec moves the packet and the archive command is interrupted, an explicit
`advance --through archived` continuation verifies retained proof, the applied
projection at the relocated packet, the approved agreement, captured file modes,
and spec synchronization before completing cleanup. It does not require a new
Change or reconstruct the missing active packet. A recorded `archived` checkpoint
still undergoes the pending archive audit and cleanup before that continuation
reports success. Recovery consumes its Land grant; it does not grant Git or
publication authority. Legacy recovery without captured modes remains explicit
about unavailable mode evidence for optional Deliver.

Copy mode preserves symbolic links verbatim and rejects target paths changed
since its baseline. Generated, tool-owned directories are excluded only when
untracked; a committed fixture remains content regardless of its directory
name.

Multi-repository changes use one OpenSpec agreement and one declared topology.
Cross-repository contract evidence must be checked before repositories Land in
dependency order. Writable sibling repositories and submodules receive their
proven bytes in their existing target working trees without staging, committing,
or manufacturing a gitlink SHA. Read-only repositories have no mutation node.
All writable targets are prepared before mutation and use an ordered, resumable
local saga; an unavailable external delivery remains an external-owner wait
rather than a claim of atomic remote mutation. Legacy in-flight commit-oriented
transactions remain readable through their recorded compatibility route.

Git or deployment activity outside Change Loop is observation, not authority.
A moved control target remains `control-head-moved` unless observed bytes match
the change projection or an explicit external delivery reference exists. Even
then, out-of-band delivery does not create proof, grant authority, or complete
the lifecycle. Sync, re-prove when invalidated, and continue to `archived`.

## Budgets and progress

The watchdog evaluates observed requests and token usage against the widest
applicable execution-surface factor. Factors are selected by maximum, never
multiplied. External authority does not inflate model allowance, and unknown
usage is never fabricated.

Budget actions are:

- 70%: batch remaining work and reuse evidence;
- 85%: stop speculative exploration and optional expansion;
- 100%: stop model work and request split, re-scope, continuation, or pause.

Budget stops apply to model exploration, not deterministic recovery. Packet,
readiness, evidence execution, receipt reuse, metrics, Land recovery, and
archive remain available. A continuation is audited and allowed only when more
model work can move a required code or configuration blocker; it never deletes
usage or lowers assurance.

`budget checkpoint` reports the measured remaining window, unfinished work, and
exact resume route. It never guesses future model demand. A continuation that
cannot unblock the change returns the external evidence, provider, deterministic
operation, re-scope, retire, or pause choice that actually can.

## Compatibility and operator references

`.workflow/` is legacy read-only state. Migration creates candidates rather
than authoritative specs:

```bash
claude-foundation migrate
claude-foundation migrate <legacy-id> --apply
```

Only statements corroborated by code, tests, or accepted contracts may be
promoted.

`claude-foundation` is the stable public control surface. It finds the project
from the current directory or `--project <path>` and routes to the installed
runtime so schemas and behavior stay aligned. Use `change start|amend` and
`advance --through build|proven|archived` for normal work. Operator,
integration, host-instruction, and recovery protocols are documented in
`.claude/harness/README.md`. Do not call `foundation.mjs` directly.

The harness guide also owns requirements and the canonical table of
`.foundation/` runtime state. Those files are machine-owned and ignored by Git;
this workflow names them only where their lifecycle meaning matters.

## Quality invariants

- Zero discovered tests cannot silently pass.
- Missing expected evidence cannot silently pass.
- Browser capability mismatch is inconclusive.
- Mutation crash is not a behavioral kill.
- Stale proof cannot Land or archive.
- A sandbox diff cannot overwrite a conflicting target.
- OpenSpec performs semantic spec sync before archive.
- Required assurance is never dropped because of size or budget.
- A delivery flow is complete only at `archived`.
