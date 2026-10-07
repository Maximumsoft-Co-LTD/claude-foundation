# Change Loop workflow

**Version 3.5.30**

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
final diff review, and the authority for any later Git or external side effect
(such as an explicit `/deliver`). The coding agent
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

### Authority from the user's words

One rule decides what the user's chat words authorize; `AGENT.md` carries it
for every host, and the phase guard enforces its Git and Deliver parts.

- **Approval.** A reply to the spec-approval or amendment question in the
  user's own words—"ลุยเลย", "ทำเลย", "ทำไปเลย", "go ahead", "approve"—is the
  approval. The agent records it through the existing
  `advance <change> --approve-spec --decision-ref <ref>` path and does not ask
  again. Approval stated in the original request counts the same way.
- **Land.** Any explicit instruction to land grants Land. A user who said up
  front "ทำจนจบ", "ทำให้เสร็จ", or "finish it" also authorized Land for that
  change.
- **Not authority.** Silence, and urgency alone ("ด่วน", "รีบ demo"), never
  approve or grant Land. A negated request ("don't push yet") is never
  authority. Authority for an external side effect is never inferred beyond
  what was said.
- **Commit and push.** Only `/deliver` or the user's direct instruction
  ("commit this", "push it") commits or pushes; a push instruction covers the
  commit it publishes. Land never commits. During Build or Prove, a
  `git commit` or `git push` from the main checkout that the user's latest
  prompt did not ask for does not run: the phase guard replaces it with the
  question for the user, and a yes reply lets the same command run. Inside the
  isolated workspace it is ordinary Build work.
- **Pull requests.** A direct request to open a PR or deliver ("เปิด PR ให้เลย",
  "open a PR") is `/deliver` for that one composite command, as is a yes to the
  delivery question the guard asked.

## Lifecycle commands

### `/investigate <problem>`

Use Investigate only when the problem or direction is unclear. It is bounded
and read-only with respect to product code. `investigate --template` defines a
versioned fact, hypothesis, option, decision, and conclusion record. Running
`investigate <record.json>` discovers and hashes repository sources, persists a
machine-owned resumable state with compact metrics, and returns one typed
agent, user, or harness action. Discovered sources are acknowledged
automatically and stay hashed for freshness; facts and options must cite an
inventoried source, and discoveries no fact cites are listed in the report.
Open decisions derive `conclusion.status: needs-user-decision`; a settled
record with `changeIntent` concludes as `ready-for-change` in the same run, and
explicit legacy statuses stay accepted. Three unchanged attempts expose a
no-progress boundary without discarding the exact resume route: it reaches the
user only when the repeated action was a user question, a sandbox or discovery
failure goes to the harness, and any other stall returns to the agent.

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

- optional discovery coverage (required for high impact or typed risk), ambiguity, impact, coupling, and size;
- semantic requirements and task outcomes, rendered for people: one case per
  scenario with a short name, optional GIVEN/AND lines, and a titled overview
  per capability;
- claim-to-task coverage and required evidence capabilities;
- semantic security and review triggers;
- typed extensions only when the change needs them.

Rapid changes contain `proposal.md`, `tasks.md`, `evidence.yaml`, and a concise
delta `specs/<capability>/spec.md` (one SHALL statement and its scenarios per
requirement, rendered exactly as in standard), which Land merges into
`openspec/specs` like any other delta; only a legacy rapid packet or declared
docs-only work (`workType: ["docs"]` adding requirements, such as README
wording) declares `skip_specs` and has none, so prose never becomes a living
system requirement; its claims still bind evidence. A delta for a capability with no living spec states a
`## Purpose` (the capability overview, else the intent) that archive carries
into the new spec instead of OpenSpec's TBD placeholder; an existing spec's
Purpose is never replaced. A minimal draft's derived names stay short: the
capability is a top-level `capability` or the intent's noun phrase (such as
`kanban-board`), a requirement key is at most five whole words, and its
heading is the readable SHALL clause. A rapid proposal omits Why when the draft states no
reason, and lists recorded `decisions` (defaults the agent chose without
asking, `decidedBy: agent`) under Decisions. Every packet is a dev document:
the proposal shows a folder tree of touched paths (`+` add, including paths
absent at the base; `~` change; `-` remove), and a rapid proposal also carries
the compact form (summary, what changes, user flow, failure matrix, the Plan
Build executes, and any authored descriptive section: file map, test map,
component map, config contract, refactor, bugfix). Descriptive sections never move a
low-risk draft to standard; impact, coupling, security triggers, review, and
acceptance still do. A standard v4 change
always has `design.md`, and its draft must author the sections its work type
needs (`why` or `summary`, and failures unless the work is only refactor,
config, or light work; user flow, UI states, component map,
API contracts, data model, config or job contract by type); the harness infers
the work type from task paths (stated in `design.md`; declare `workType` to
override; test-, docs-, or manifest-only paths are light work) and derives the
file map, test map (scenario and check command), and plan. Flowchart node
labels holding `(`, `)`, or `"` must be quoted (`A["mean(values)"]`).
Each fact is written once: without an authored `failureMatrix`, scenarios with
`kind: "failure"` become its rows (an optional scenario `recovery` fills the
recovery column), and `why` gives the reader the lead a separate summary would
repeat. A
missing section is an agent draft repair, never a user question. `execution.yaml`, `repositories.yaml`, `handoffs.yaml`,
and `grounding.yaml` appear only when execution differs from detected defaults,
multiple repositories participate, external authority is required, or a
non-derived material decision must be recorded. Absence has versioned
virtual-default semantics.

The packet is written for a human reviewer first. `proposal.md` opens with an
optional plain-language summary, prioritized user stories, measurable success
criteria, and a capability index (capability, requirements, tasks); discovery
coverage and investigation provenance close it as appendices. `design.md`
records every settled intake answer as a durable decision (context, choice,
rejected options, decided by), adds an optional overview diagram, assumptions,
open questions, the user flow, a component map, and the Plan (task, outcome,
files, verify, dependencies, requirements) with its dependency graph, fills the
file map's task column from task `[paths:]`, and omits sections the change
leaves empty. While any open question remains, an approval request returns those
questions as one `ASK_USER` decision instead of recording consent; the agent
asks them, records the answers, and asks for approval again.

Before compilation, the harness requires every risk-derived discovery dimension
to be covered, marked not applicable with a rationale, investigated, or resolved
by the user. It validates decision dependencies and exposes only the current
frontier; the agent interprets sources and authors requirements, while the user
owns consequential choices. After compilation, the OpenSpec packet is the
source of truth. The semantic draft is temporary and `.foundation/` is derived
coordination state. Draft v1 remains compatible, draft v2 retains its
unambiguous bookkeeping behavior, and draft v3 remains readable.

`change start <draft.json>` inspects before compilation (`--inspect` only
inspects). Inspection returns one typed `EDIT`, `ASK_USER`, or `DONE` action
with an exact resume route. Its `EDIT` batch also names, as agent repairs, a
task `verify` that references a test file which neither exists nor falls inside
any task's `paths`, and an `apiContracts` error listed without a status or code. An
unresolved user-owned coverage row must link to its decisions through
`decisionKeys`; once every linked decision is resolved, the harness treats the
row as covered by those decisions, so recording an answer needs no further
coverage edit. Repository-owned investigation is returned before user
questions. At `DONE` the same call compiles atomically; `--consume-draft` also
removes the draft.
Typed `riskSignals` provide language-neutral triggers for access control,
persisted data, integrations, performance SLOs, UI accessibility, operational
risk, external side effects, and input domains (`input-domain` requires
`input-boundary` coverage of the adjacent input partitions).
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
graph coverage. The harness records the source digest itself;
`discovery.sourceDigest` is optional, and a correct draft completes intake on
its first inspect. Source facts and recommendation evidence must match the
selected inventory. Discovery coverage is optional for an ordinary change;
`impact: high`, `riskSignals`, security triggers, integrations, and external
operations require their mapped dimensions. A required dimension the draft
already states is derived as a `covered` row marked derived in the proposal
appendix: current behavior from `currentState`, affected actor from
`userStories`, desired behavior from requirements, success, failure, and input
boundary from scenario `kind` (`success`, `failure`, `boundary`; failures also
from `failureMatrix`, boundaries also from `apiContracts` with request and
errors), compatibility and non-goals from their fields, verification when every
requirement has a verifying task and evidence, data migration and rollback from
every `dataModel` entry, integration contract from documented `integrations`,
timeout/retry/idempotency from integration concerns or a complete
`jobContract`, and accessibility from `uiStates`. Without backing content the
dimension stays missing; an authored row always wins, so a
`needs-user-decision` row is still asked. Draft v3 is unchanged. Prose is never scanned for risk
keywords, a modified requirement does not imply migration or rollback coverage,
and a risk-derived `not-applicable` row needs only a rationale. Design and
reader-guide warnings are advisory, and small rapid-lane drafts get no
missing-section prompts; sections the agent writes are always checked.
Compact effectiveness counts survive successful compilation in runtime, but no chat or interview history is kept. A
changed selected source invalidates readiness and returns agent-owned coverage refresh.

For newly started changes, present the compiled spec, scope, and acceptance
criteria and wait for explicit user approval before Build, including `/dev`.
When the request itself already approves the spec, in any wording (for example
"I approve the spec" in a `/dev` request), that is the approval, as is a reply
such as "ลุยเลย" to the approval question; silence and urgency never are
([authority from the user's words](#authority-from-the-users-words)).
Record it with `advance <change> --approve-spec --decision-ref <ref>` (alias of
`change resolve <change> --approve-spec`); add `--through <target>` to continue
in the same call. The same `--approve-spec --decision-ref <ref> [--through
<target>]` flags on `change start`, `change revise`, or `change amend` record the
approval in the call that applies the approving answer; a call that stops at an
intake action approves nothing. Design open questions print with the approval
packet so the user answers them with the approval. The normal agent path uses only
`change start <draft>`, which inspects and starts a complete draft in one call,
`advance`, and `changes`: `advance` wires detected evidence, synchronizes the
sandbox, runs agent-runnable configured reviewers, and ticks a handed-off task
in `tasks.md` when its verify passes (a failed check returns
`verificationFailures`). Every REPAIR carries a command or instruction, so the
agent never reads harness source to recover. `/dev` runs `/change` → `/build`
→ `/prove` → `/land` (Land only with authority) exactly as the separate
commands: shared agent rules live only in `.claude/harness/AGENT.md`, each phase
command is the single source for its phase, and the full Change, intake, and
Build references load only on their triggers. A minimal draft (`intent`,
`requirements[{description, scenarios[{when, then}]}]`,
`tasks[{outcome, verify, paths}]`, no `version`) is expanded by the compiler.
Every EDIT or REPAIR lists `contextFiles` (absolute paths to open), `newFiles`
(declared paths to create), and `contextScope`. Each EDIT task carries its own
`workspace`: a non-root repository's task names
`.foundation/repository-sandboxes/<change>/<repository>`, never the shared
sandbox's empty submodule directory, and the top-level `workspace` (plus a
`workspaces` map by repository) is that sandbox whenever every task shares it. Unauthorized external work enters
`handoffs.yaml` only through a semantic amendment, and grounding reads belong in
the draft's `grounding` field.
Runtime approval binds agreement content and revision; task checkboxes and
task `[paths:]` write scope are bookkeeping and do not invalidate it. The user
approves a change once: a later `change revise` or `change amend` that only adds
or revises requirements carries the current approval to the new revision and
packet, with an audit row (`approvalCarries`), and needs no second approval. A
revision or amendment that removes a requirement, or one of a change that was
never approved, still waits for approval. During Build agreement edits go through
`change amend`, and a hand-edited isolated packet is agent-owned drift repair. Legacy
primitive-created/in-flight changes retain their compatibility route.

To change an agreement that has not started Build, revise it in place instead
of abandoning it and writing a new draft:

```bash
claude-foundation change revise <change> <draft.json>
```

The revised semantic draft keeps the change id (a different `id` is refused)
and passes the same intake gate as `change start`, under its own snapshot: the
call inspects first, revises only at `DONE`, and otherwise prints the intake
action and changes nothing. `--inspect` only inspects; `--consume-draft` also
removes the draft. With `--merge` the file is a partial draft applied to the
draft the change was compiled from: objects merge, `null` deletes a key, and an
entry in a list keyed by `key` (or `dimension`, or `name`) merges into the
entry with that identity, `"$remove": true` drops it, and other entries are
appended; any other list is replaced. Removing a requirement drops its evidence
entry and task coverage. A change started before partial revision, or one an
amendment changed after its draft was recorded, needs the whole draft instead. The transaction
recompiles the whole packet, increments the contract revision, and restores the
prior packet and runtime state byte-for-byte on any failure. It is refused once
the change has a Build workspace, a receipt, or a completed task, and in
`proven`, `landing`, or `archived` status; the refusal names the amendment or
successor-change route.

Every revision or amendment reports its requirement delta (`added`, `revised`,
`removed` keys). A carried approval prints it as covered by the current
approval. Otherwise the delta waits for the next approval, and unapproved deltas
fold together: a key added and then removed disappears, and a key added and then
revised stays added. Present only that delta for approval; `change resolve
--approve-spec` prints the approved delta and clears it, while approval still
binds the whole agreement.

Referenced diagrams, prototype selections, and local integration documentation
must resolve to regular files inside the project. Remote integration sources
must use HTTPS and a fixed version rather than `latest`, a branch, or another
floating alias. An amendment may extend a task's claim coverage, but changing
its outcome, or the verify command of a completed task, requires a new task so
completed work cannot silently change meaning.

An unfinished task (unchecked, with no valid passing command receipt for its
claims) may change its verify command, and optionally `paths`, through an
amendment with only `updateTasks: [{key, verify, paths?}]` rows. It needs no
requirement, evidence, or version-4 intake; `change amend --template` prints
it. The agent may make that correction directly, without amendment JSON or a
new approval: `change amend <change> --task <task-key|task-id> --verify
<command> [--reason <text>]`. Derived provider commands follow the new verify,
the task's claims are invalidated so Prove reruns their evidence, and the
revision, validation, and rollback match any amendment. Claims, capabilities,
and the spec approval do not change; a command that always passes (`true`,
`echo`, `|| true`, `; true`) is refused by a best-effort text screen; the prior command is kept in the amendment
record; and the harness accepts the task only after the corrected command
passes in the workspace.

When Build discovers new behavior, amend the same agreement before continuing:

```bash
claude-foundation change amend <change> <amendment.json>
```

An amendment may add (`addRequirements`), revise (`reviseRequirements`, the
full replacement row for an existing key), or remove (`removeRequirements`,
each with a `migration`) requirements; a key may appear in only one of them. A
revised requirement replaces its spec block and claims in place and needs an
open task, so add one with `addTasks` when only completed work covers it. It
keeps its capability and operation; moving a requirement is a removal plus an
addition. A
removal deletes the block, retires its claims from evidence, tasks, and
provider bindings, records the migration in the proposal, and is refused if a
task would be left without coverage unless `updateTasks` moves it. Only the
claims and providers bound to added, revised, or removed claims are
invalidated; removals are planned from the pre-amendment claims.

A version-4 amendment includes discovery coverage for every added or revised
requirement. The call inspects first and amends only at `DONE`; otherwise it
prints the typed intake action and changes nothing. `--inspect` only inspects;
`--consume-amendment` also removes the amendment file. The returned proof command
is the exact post-amendment recovery route. The transaction validates and
appends that delta to the compiled proposal.
During Build, the amended packet stays in the isolated workspace until Land.
Once that revision is approved (or carries the approval), `advance` resumes from this packet without
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
claude-foundation advance <change> --through proven
```

The coordinator validates the agreement, prepares or synchronizes isolation,
compiles the task graph, and returns one bounded protocol-v6 action:
`EDIT`, `REPAIR`, `RUN_EXTERNAL`, `WAIT`, `ASK_USER`, or `DONE`. `/build`
targets `proven` from its first call, because Prove has no external side
effects: proof runs only once Build is complete, in the same coordinator
call, without a separate Build `DONE` round trip. It stops at `proven` and
never Lands. `advance <change> --through build` remains available to stop at
Build.
`tasks.md` is the only implementation ledger. `handoffs.yaml` separately owns
AWS, cluster, secret, Terraform, deploy, restart, or other operations that need
external authority.

Build writes only inside the declared isolated workspace. Git projects normally
use detached worktrees; a dirty target or non-Git project uses an isolated copy.
This is workspace integrity, not OS process, network, or secret containment.
The agent runs `cd <workspace>` once as its own shell call and then plain
commands, so no compound command asks the user for approval.

The live guards never refuse the agent by default; they automate or route. A
product edit aimed at the main checkout while a workspace exists is redirected
to the same path in the workspace. Internal Land commands run as `advance
<change> --through archived`, and a delivery outside `/deliver` becomes the
question for the user. Everything else runs with guidance naming the rule and
the route: shell findings (path escapes, copies from outside the workspace),
edits before a change exists, and edits outside the phase's surface. Land
reports target edits made outside the sandbox, and the host still owns process
isolation for indirect or dynamically computed effects. A secret read shows a
redacted copy, and a detached `authority run` runs attached. Hosts that want
refusals set `FOUNDATION_GUARDRAIL_MODE=block` (or `FOUNDATION_SHELL_GUARD=block`,
`FOUNDATION_SECRETS_GUARD=block`).

The harness also absorbs what used to cost a turn: the agent's scratchpad
(`<tmp>/claude-*`) and `~/.claude` are writable in every phase unless they hold
the project or a repository the change writes; after Prove, edits inside the
isolated workspace only make the proof stale; during Land, read-only test
commands may run but script runners still need the runtime transaction; and an
isolated packet edited outside a semantic amendment is
restored to the approved text by the harness (whitespace in place; any other
edit saved under `.foundation/agreement-drift/<change>/` for an amendment), not
reported as drift for the agent to undo. A
workspace never borrows the checkout's dependencies. When no setup command is
declared, the harness runs the workspace lockfile's pinned install itself
(`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`,
or `bun install --frozen-lockfile`) and records it like a configured setup;
`sandbox.installDependencies: false` opts out. If that install fails or its
tool is missing, Build is not blocked: `advance` returns a `REPAIR` handoff with
the command, workspace directory, and log tail for the agent to finish.

Before Build, the harness compiles and persists an execution-preparation plan
from selected repositories, setup commands, provider wiring, and tool identity.
It reuses ready records, prepares only missing project-local dependencies, and
retries only failed repository setup records. OpenSpec is required only from
Prove onward: Build neither installs nor stops for a missing CLI and records the
tool as `deferred`; the first Prove installs the pinned CLI under
`.foundation/tools` (never globally) and keeps the existing `HANDOFF` when that
fails. Prove and Land re-check the same plan. Before Build, an unavailable
OpenSpec CLI only defers the strict spec lint; from Prove on, the lint is required and an absent
CLI fails closed rather than letting an unlinted agreement reach archive. A setup or
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

An edit inside the sandbox outside every task's `[paths:]` does not block Build
or Prove. Prove records it in the change surface (`surfaceAdditions`), so it is
proven and lands with the change. Prove still refuses a deletion, a
control-plane, CI, or secret path (for example `.claude/`, `.github/`,
`foundation.json`, `.env`), a misplaced root sandbox, or more than 100 such
paths until a task's `[paths:]` declares them; Build refuses a write inside
another active task's scope.

Lease recovery is harness work, not a user decision. An owner reacquiring its
own unreleased lease after the graph, contract, or `[paths:]` changed is
re-granted under a new fencing generation and keeps its original write
baseline, so earlier writes are still judged against the widened scope. A
lease past its TTL is released or taken over without `--force` or a decision
reference; only a live lease held by another worker needs one. `advance` settles
the session lease it holds even after its TTL. A lease conflict between two
active changes remains a real resource boundary.

A force-released lease grants no result authority. If its task was already
checked complete, the planner returns it for leased verification without
rewriting the checkbox; only an accepted release clears that recovery.

An accepted task result binds that task's own authority: its node (text,
repository, paths, dependencies, schemas) and the claims it proves. An
amendment that leaves a task unchanged keeps its result; a rewritten task and
its dependants need verification. Results recorded before this binding keep
the whole-graph comparison they were written under. `advance` re-verifies a
checked task with a stale record itself, under a harness lease: its `verify`
check must pass, and work finished outside a lease is never split per task.
Only a task a live worker holds, a failing check, or one behind an unverified
dependency returns as an EDIT, listed under `reverification` with its cause as
implemented work to repair, not to redo.

When every pending Build task must run one at a time (a dependency chain or
overlapping paths) in one repository with no cross-repository claim or
external resource, `advance` hands all of them in one session EDIT, in
dependency order, with no lease. The next `advance` runs each handed task's
`verify`, ticks every passing task, records its result under a harness lease,
and returns an EDIT only for failed tasks (with `verificationFailures`) and
their dependents. Plans with a parallel wave, several repositories, or shared
external resources use native workers, but the harness still holds every
lease: `advance` acquires the group's leases, the parent only spawns one worker
per `execution.workers` entry and waits, and the next `advance` verifies, ticks,
releases, and scope-checks each task. No agent acquires, releases, or ticks.

Every completed task carries one kind of authority: a result the harness
recorded after the task's `verify` passed, bound to that task's own authority.
Planning records none. Older `single-agent-observed` and graph-v2 records stay
readable for in-flight changes only.

An upgrade from execution graph v2 preserves a completed multi-task
single-session Build only when the persisted plan still binds the same task
authority, claims, contract revision, and contract fingerprint. The current
proof records that compatibility witness without manufacturing lease results.
If the binding is absent, stale, or superseded by a force-released lease, the
planner returns only the affected completed task and its dependency descendants
to current leased verification without rewriting `tasks.md`; a packet already
complete at isolation keeps its independent proof route. This deterministic
recovery never asks the user for a semantic decision.

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
fall back to the live target. Each repository has one location: Build envelopes,
the phase guard, review finding binding (a finding named
`root/<submodule path>/<file>` binds to that repository), and Land all use its
repository sandbox. A declared repository's directory or gitlink in the root
workspace (missing, empty, or pointing at another commit) is that repository's
pointer, never a root change, so it is excluded from root review, proof
readiness, Apply, and replay.

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

### Follow-up requests during an active Change

Treat a new user instruction as a product decision, not as a request for the
user to maintain OpenSpec. Before product mutation, the agent compares it with
the approved agreement and owns the resulting amendment, implementation, tests,
and documentation. The harness owns validation, revision state, invalidation,
evidence, recovery, and lifecycle progression. Ask the user only when material
product meaning or a trade-off remains unresolved; never ask them to author
amendment JSON, edit ledgers, or run routine recovery.

| Follow-up | Route |
|---|---|
| Fix the approved color, button position, filter result, validation, API mapping, permission, or failure behavior | Repair in contract; no amendment |
| Choose a new color or location; add a filter, saved search, field, action, responsive state, accessibility outcome, or user-visible copy meaning | Amend before implementation |
| Add or change an API contract, stored-data rule, migration, role, security boundary, performance target, notification, retry, integration, external effect, compatibility, or rollout behavior | Amend before implementation |
| Add a regression test, documentation correction, or internal refactor without changing approved behavior | Implement in contract; no amendment |
| Change a test expectation or public documentation because intended behavior changed | Amend before implementation |
| Request “make it better” or similar wording with materially different valid outcomes | Ask only for the unresolved product choice |
| Add an independently deliverable objective, or request it after archive | Start a successor Change |

A clear instruction supplies the decision input, so do not ask the same question
again. An additive amendment carries the existing approval; only a removal
waits for approval. Report the product delta, not harness commands or machine
inputs. A new outcome
received during Prove returns through amendment and Build before selective proof
resumes. Any relevant product or agreement edit makes the affected proof stale.
A review or acceptance response for a superseded workspace is never recorded;
the harness re-requests that authority bound to the current workspace, spending
no review attempt until dispatch, and `advance` resumes from it.

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
Failed, missing, stale, erroneous, or inconclusive evidence remains visible as
assurance status. It blocks a `PROVEN` result, but an explicit `/land` may still
authorize the current workspace projection.

Composite identity binds repository content and agreement revision rather than
Git commit identity. Recorded base heads remain explicit recovery and Land
state: an unsynchronized target still stops, while moving to a history-only
commit with byte-identical content does not charge another review.

A provider that executed and failed has three honest exits:

- fix the cause and rerun;
- rewire the provider in `execution.yaml`;
- withdraw the capability under a recorded decision with `change waive`.

Resuming unchanged is not one of them. A harness-executed provider that failed
and then passes on byte-identical inputs is recorded as a flake: the receipt
stays `fail` with `flake` evidence (the first failure and the observed pass), so
the claim needs a repair, and only a pass on changed content is proof again.

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
semantic progress identity changes. Two unchanged automated transitions hand
the stuck step to the agent as a no-progress repair carrying what the step
returned.

Harness automation that cannot finish is handed to the agent rather than
stopping the flow: a failed sandbox setup or OpenSpec preparation returns an
agent `REPAIR` with `recovery.type: HANDOFF` and a `handoff` naming the step,
its exact command, working directory, and output. The agent finishes the step
(or fixes its declared setup) and resumes. Thrown Build, Prove, or Land
dependencies are captured in the same action envelope with their original
reason and exact recovery route. Decisions,
authority, resources, conflicts, and repeated no-progress preserve state.
`proof readiness`, `proof advance`, `proof run`, and direct authority commands
remain diagnostic or integration primitives behind `advance`.

### `/land <change>`

`/land` runs the same route `/dev` uses:

```bash
claude-foundation advance <change> --through archived
```

This explicit invocation supplies Land authority. Any other explicit user
instruction to land, in any wording (for example "land it when proven" in a
`/dev` request), supplies it too. Silence never does. `land advance` remains an
internal compatibility route that the agent does not call.
Tests and checks run only inside the returned workspace, never in the main
checkout. If Land's apply conflicts with target files that are regenerable
artifacts (for example `__pycache__/*.pyc`) and were clean at isolation,
Land restores them to the sandbox base itself and continues. Any other
conflicting target edit is a user decision listing the files; its restore
option, `advance <change> --through archived --restore-target <paths>`, requires
`--decision-ref`, and a file changed after the restore was recorded is never
overwritten.
Land has one user-visible
goal: place the exact current workspace projection in the declared main
workspace. The Harness binds a resumable grant to the exact change, workspace
hash, available assurance, repository graph, and target roots, then owns
checking, Apply, verification, semantic spec
synchronization, archival, recovery, and cleanup as internal checkpoints. It
finishes only at `archived`; `proven` is not completion.

Apply is a journaled transaction over the target. An interruption is recovered
and resumed by the Harness through the same `/land` invocation. Restore,
keep-current, journal, check, resume, and archive mechanics are not separate
user operations. The Harness settles an interrupted apply itself when doing so
cannot lose bytes: it finishes or reverses only content Land wrote, and when the
target holds other content it keeps the current target, synchronizes the sandbox
onto it, and proves again. The agent receives the divergent paths as a notice;
if automatic recovery cannot finish, the agent gets a repair with the transaction
location, not the user. Restoring the recorded backup over divergent content is
never automatic; a user who wants it records it through the same route,
`advance <change> --through archived --recover-apply restore-backup
--decision-ref <user-decision>`, which settles the journal and continues Land.

Uncommitted target edits that Land would overwrite are kept, never committed or
discarded automatically: the agent merges each into the sandbox copy of the same
path, and Land applies the merged file once merging the target edit into it
changes nothing. Edits made outside the sandbox stop Land only on paths in this
change's Land projection; others are reported.

Land is always allowed for stacked changes. Because Land leaves its diff
uncommitted, a change that branched before another change landed meets that
landed diff in the target; nobody has to commit the first change before the
second one lands. The harness treats the earlier landed bytes as part of the
target: paths the later change left alone land beside it untouched, and for a
path both changed it replays the landed edit into the later change's sandbox
copy (a 3-way merge), proves again only what that invalidated, and applies.
When both rewrote the same lines, the later change's agent merges them in its
sandbox copy, keeping the landed content; that edit is the resolution. Earlier
landed bytes are never restored over or offered for discard, and the user is
asked only when the two changes' intents genuinely contradict. Each change
archives in Land order, so OpenSpec merges each change's spec delta onto the
specs the earlier Land already synchronized.

The projection is confined to Git-tracked files plus paths declared in
`tasks.md`. An untracked path no task names is neither evidence surface nor a
Land deletion. A target path is deleted only when the authorized sandbox removed
it. Conflicts never overwrite unrelated target edits.

Every writable selected repository is prepared before the first target write
and then applied in dependency order with durable per-repository checkpoints.
Each target finishes `applied-uncommitted`: its intended diff is visible for
the user to inspect, while Git HEAD and index remain unchanged. Read-only
repositories remain unchanged. Re-entering `/land` resumes the same grant and
skips already verified nodes; it never requires the user to assemble a journal,
grant, commit, recovery command, or archive command.

Land never commits, and never implies permission to commit, push, publish,
deploy, or open a pull request. Commit and push happen only through `/deliver`
or the user's direct instruction
([authority from the user's words](#authority-from-the-users-words)).

### `/deliver <change>` (optional)

Deliver is an optional post-Land transaction. The normal change lifecycle is
still complete at `archived`; no delivery state, provider work, presentation
evidence, prompt, or gate exists unless the user explicitly invokes
`/deliver <change>` or directly asks to open a PR or deliver ("เปิด PR ให้เลย"),
which is the same invocation.

The agent runs one composition command, `claude-foundation deliver advance
<change>`, and executes its automatic recovery internally. The user never
assembles readiness, preparation, commit, push, provider, or resume commands.
Invoking `/deliver` on a proven change that is not yet archived is also the
user's Land authority: Deliver runs the normal `advance <change> --through
archived` route, which issues the Land grant under this invocation, and continues
delivery in the same call once the change is archived. A Land boundary on the
way (a real decision or an agent repair) is returned with the Deliver resume
route. A change that is not proven yet is not landed; Deliver recommends
finishing Build and Prove first. The invocation grants only the authority to
Land, create an isolated feature branch, commit the proven Land projection,
push that branch, and open or reuse a pull request. It does not authorize
force-push, default-branch push, merge, deploy, publish, evidence disclosure to
a new store, or product edits. Deliver questions use the blocked-decision shape
(options with outcomes, a recommendation, and `pause`); only typed provider
failures (remote, credentials, push, or pull-request service) wait on the
repository operator.

Deliver reconstructs the projection in a separate Git worktree, leaving the
user's checkout, HEAD, index, and unrelated edits unchanged. It binds durable
checkpoints to the archived change, proof run, target head, and Land projection.
Commits added on top of the Land base after Land do not stop delivery: the
branch is built from that base and the proven content is verified separately.
Only a history that no longer contains the base (reset or rebase) asks the user.
After interruption it reconciles the local commit, remote branch, and provider
state before taking the next missing action. A repeated invocation verifies and
returns the existing pull request rather than creating another.

A review follow-up updates the pull request it answers instead of opening a
second one. The follow-up change records the original delivery by citing that
pull request's URL in its proposal or design (for example "Address the
requested changes on <PR URL>"). Deliver binds only a URL that a verified
delivery receipt of another change in this project produced; an ordinary
related link never redirects publication. When exactly one such pull request is
cited and the provider reports it still open on its delivered branch and base,
Deliver builds the follow-up commit on that branch's current head, pushes it as
a fast-forward (never forced) to the same branch, and returns
`reached: pr-updated` with the updated URL. A closed or merged pull request, a
moved branch or base, or more than one cited delivery opens a new pull request
instead, and the result's `followUp.notice` says why. The binding is
checkpointed, so a resumed delivery never re-decides it. Re-running Deliver for
the original change afterwards still returns its pull request as reused: a head
at a commit that a recorded follow-up delivery built on the original commit
counts, and the result's `followedUpBy` names those changes. Any other head,
even one descending from the delivered commit, still fails verification.
Multi-repository deliveries do not bind follow-ups yet.

Before committing, Deliver verifies staged Git blobs against the retained Land
projection. Before publishing, it verifies the actual commit tree again, including
resumed commits and changes made by Git hooks. Changed bytes, file modes, missing
files, or additional paths block publication rather than inheriting old proof.
Drift inside the unpublished delivery workspace (an interrupted attempt or a
stray edit) is Harness-owned: Deliver rebuilds that workspace once from the Land
projection and resumes. Only drift that survives the rebuild, such as a commit
hook rewriting staged files, asks the user to fix the hook and retry or leave the
work archived. It fetches the proposed remote PR base on each unfinished attempt
and requires that base to contain the proven Land base. Target content, HEAD, or
PR-base drift asks the user to restore the proven content and retry Deliver, or
leave the work archived; it never asks for a new change. Independent sibling repositories
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
- unit or static evidence is sufficient;
- a semantic draft authors no design content (file map, UI states, failure
  matrix, user decisions or answered intake choices, assumptions, risks); such a
  draft compiles as standard so that content is kept. Agent defaults
  (`decidedBy: agent`, the minimal-draft default) stay rapid.

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

Consumer quality is opt-in (`quality.changeGate` defaults to `off`) through
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

Review is bounded by its rounds (one full review, then one changed delta), not
by elapsed time: the agent's repair between rounds and reviewer retries never
spend a user-facing budget. Each dispatch has its own 30-minute timeout, and an
expired dispatch is a reviewer infrastructure failure, not a user question.
`change resolve --continue-review` is still accepted and changes nothing.
Timeout is not a pass. Try repair first; if it cannot progress, explain the
attempted remedies and offer further work or explicit waivers for the current
diff before Land. Conflicts, incomplete Apply, and missing side-effect authority
still require their actual resolution, never a claim of successful delivery.

Under `workflow.reviewPolicy: "risk-tiered"` every change receives review, with
the correction circuit bounded by risk; `RESOLVED` prints the route, such as
`review: risk-tiered AI review (low tier, fast model)`, never "not required".
Under legacy policy it prints `required` or
`not required (legacy review policy: no AI review runs)`. The review reads the change's diff and
the agreement's requirements, not whole files. Low risk runs one diff-only
review on the fast model tier at medium effort (`review.lowRiskModel:
"configured"` or a reviewer `fastModelId` overrides it); medium and high keep
the configured model at high effort. Every full round receives the agreement's scenario checklist and must
report each scenario as covered, missing, or unsure; a missing scenario becomes
a blocking finding that goes straight to repair. If a fast first round is
only unsure of a scenario or its coverage is unreadable, the harness re-runs
that review once on the configured model without consuming a review round. Security triggers are declared (draft `securityTriggers` or
`resolve --security`) or inferred from intent keywords: declared triggers
select the standard lane and security evidence, while an intent keyword alone
only makes review required at the low tier and the change keeps its lane.

- **low** — one full AI review; a material correction promotes the route to
  medium;
- **medium** — one full AI review, one correction batch, and at most one fresh
  delta review closing the first-round finding IDs;
- **high** — material risks are settled in the initial Decision Sheet, followed
  by one full AI review and at most one post-correction delta.

A delta review that no longer reports an earlier finding closes it. When a
repaired final finding has no declared critical case to bind and current checks
pass, Prove stops at the review-exhausted user decision (accept the review risk
with `change waive --capability review`, revise the agreement, or pause); it
never returns an unsatisfiable repair.

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
review waves, corrupt review history, a moved control repository during
multi-repository Land, reset staged submodule pointers, or an apply rollback
that could not complete.

Each stop preserves the change and returns a decision envelope with a typed
code, at least two honest options, a recommendation, and an exact resume route.
When `automaticRecovery` is marked, the known typed recovery is performed by
the harness and explained by the agent without opening a user interview. The
coordinator executes sandbox sync and resumes the original target; a conflicting
sync preserves the work and asks for the intended resolution. Other options are
translated into the user's language; the agent never treats a stop as a dead
end or infers authority. A moved target base is replayed, never answered with a
recreated sandbox or a retired change. Retiring with `change abandon` is offered
only where the work itself cannot continue.

Advance protocol 6 retains the existing actions and command routes. Recovery
observations and answers live in `advanceRecovery` on the existing runtime
record. The ladder has three rungs: the first unchanged repair handoff is the
agent's repair, the second returns one agent-owned `REPAIR`
(`TRY_ALTERNATE_APPROACH`) asking for a materially different approach inside the
approved agreement, and the third requests a decision (`NO_PROGRESS_BOUNDARY`)
whose `decision.repetition` carries the evidence: rounds, first and last
observation, and the output that kept repeating. Two unchanged internal
automated transitions, a sandbox sync conflict, and a Build task verify that
keeps failing with identical output (durations and timestamps ignored) follow
the same ladder. New process sessions, proof run IDs, diagnostic wording, retry
counters and bookkeeping revisions do not reset progress. Relevant content,
agreement, execution policy, a different verify output, or actual delivery
changes do. Read-only inspection never counts as a repair attempt or records an
answer.

Causes only the user can clear skip the ladder and return `ASK_USER`
(`USER_ENVIRONMENT_REQUIRED`, boundary `user-environment`) on the first
observation: a missing or expired credential or token, VPN, proxy or network
denial, a reviewer CLI that is not logged in, a full disk (`ENOSPC`), private
registry authentication, or a Git remote that rejects the credential (for
example a push `403`). `decision.category` types the boundary as `resource`,
`credential`, or `network`, and `decision.cause` names it. Causes are
classified where the failure is raised, so inspection and every route agree:
typed error codes first, then known signatures in child-process output, on
harness, setup, delivery, and reviewer routes. A full disk is recognized on
every route, while credential or network words inside failing product output
remain a product repair, and a bare local process timeout (`ETIMEDOUT` from a
spawn) is not a network cause. The question names the fix (for example "run
`claude /login`" or "free disk space") and the resume command, and carries no
agent repair instruction; nothing is counted, and an uncleared cause is
reported again the same way. `deliver advance` uses the same classifier and
decision shape; a remaining provider failure is the repository operator's
`WAIT` with an explicit `wait.condition` and `wait.checkCommand`.

Signals the agent must act on that do not change the action ride on the same
envelope as optional `signals[]` entries (`{code, message}`), in addition to
their unchanged stderr or stdout line: `agreement-restored` (an isolated
agreement edit was restored and saved aside for an amendment),
`budget-warning` (spend reached 70% with `execution.budgetWatchdog` on),
`already-archived` (archive recovery found the change already archived), and
`apply-recovered` (an interrupted apply was settled). The field is absent when
nothing was signalled.

No agent-facing route names a lifecycle primitive. Any `command`, `next`,
instruction, reason, or decision option that would point at `proof run|advance`,
`land check|advance`, `sandbox sync|create`, or `evidence init` is rewritten to
`advance <change>` with the route's target: proof primitives resume `--through
proven`, Land primitives `--through archived`, and sandbox primitives keep the
current target, so a rewrite never widens a route to Land. Two primitives that
needed a user answer are now advance decisions: an indeterminate provider run
(`DECIDE_INDETERMINATE_EXECUTION`, options `retry|pause`) whose `retry` answer
reaches the next proof run once, and an amended-agreement conflict
(`RESOLVE_AGREEMENT_CONFLICT`, options `merge|retain|pause`) whose answer
performs the resolving synchronization.

Every question offers concrete alternatives, a recommendation and pause, with
the cause and retained repair observations. External waiting is the default,
not a question: `WAIT` names the owner, condition and checking route, and the
agent reports it and resumes when the condition changes.
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
claude-foundation advance <change> --decision <offered-option> \
  --decision-fingerprint <hash> --decision-ref <user-answer> --reason <approach>
```

The offered options are `retry|wait|pause` for recovery decisions, and the
options listed by an advance decision such as `merge|retain|pause`. The answer
retains the prior `--through` target. Retry records the chosen
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
- 100%: every exhaustion opens one more window of the same size
  automatically, recorded as a harness decision
  (`harness://auto-extend/budget/1`) that does not use an operator-approved
  continuation. Budget is advisory and never asks the user while delivery
  progresses; three windows reopened without delivery progress (unchanged
  content and lifecycle state) return the `budget-no-progress` decision with
  the window evidence, and an answer starts a new count.

`budget continue` remains an optional, audited explicit widening; it never
deletes usage or lowers assurance.

`budget checkpoint` reports the measured remaining window, unfinished work, and
exact resume route. It never guesses future model demand.

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
- Missing, failed, inconclusive, invalid, or stale proof is preserved as Land
  assurance and cannot be misreported as passing.
- A sandbox diff cannot overwrite a conflicting target.
- OpenSpec performs semantic spec sync before archive; the change is recorded
  `archived` only after the harness verifies the merged specs.
- Required assurance is never dropped because of size or budget.
- A delivery flow is complete only at `archived`.
