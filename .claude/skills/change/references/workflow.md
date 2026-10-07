# Change workflow

Before drafting, reconcile the conversation's constraints, examples,
corrections, investigation conclusions, and selected prototypes; the latest
explicit correction supersedes only what it conflicts with. Separate confirmed
decisions from proposals, rejected alternatives, and unresolved choices; an
assistant suggestion or user silence is not agreement. Use retained project
notes for unavailable sessions; never claim to have read missing history.

Read the smallest canonical sources that settle the behavior: OpenSpec
requirements, relevant code/tests, architecture decisions, prototype selection,
and versioned integration documentation. Reuse settled answers without asking them again.
Read [semantic-intake.md](semantic-intake.md) when the draft declares
`impact: high`, `riskSignals`, integrations, or external operations, or inspect
returns discovery rows or `ASK_USER`.

## Agreement detail and language

Write agent-authored document prose in the user's requested document language;
otherwise use the language of their current request, including amendment
prose; an English template or repository does not override it.
Preserve schema keys, enums, IDs, paths, commands, code identifiers, and
parser-required headings/markers such as `Requirement:`, `Scenario:`,
`WHEN`, `THEN`, and `SHALL`. Preserve canonical requirement/scenario names
and unchanged text when modifying an existing spec; do not rename identities
or translate unrelated documents.

Write each `description` as one short statement with `SHALL` in the document
language (for example, `ระบบ SHALL ปฏิเสธคำขอที่ไม่มีสิทธิ์`); list constraints
in `details` and split a statement that joins cases with `;`. `outcome` is the
observable result; `requirement`/`title` names it. Set `language`; each
capability gets a `capabilityOverviews` entry `{capability, title, overview}`.

Make the agreement understandable without chat history, using facts from the
canonical sources and the user's settled intent:

- In `why`, explain the current behavior, concrete problem, affected actor or
  system, and desired result. Use `changes` for observable before/after behavior
  and affected surfaces, and `nonGoals` for meaningful scope exclusions.
- Give each requirement a bounded outcome. Each scenario is one case: a short
  `name`, state or configuration in `given`, one trigger in `when`, one checkable
  result in `then`, extra results in `and`. Cover the main path and relevant
  failure, boundary, permission, or compatibility cases, never "works correctly"
  or an implementation step; mark `kind` `success`, `failure`, or `boundary`.
- Tasks name outcomes and affected paths, link requirement coverage, and name
  verification that can detect a violation; a command run alone is not acceptance.
- Optional `userStories` (P1-P3, `covers`), `successCriteria`, and
  `assumptions` help reviewers; `openQuestions` block approval until answered.
  Record each settled answer as a resolved `discovery.decisions` row with
  `decidedBy`. Resolve discoverable facts yourself; never invent facts.

Scale detail to behavior and risk, not length.
Cross-component changes need a boundary/dependency diagram; changed state,
async, or workflow behavior needs transitions or sequence, including
failure/recovery paths.
The packet is the dev document Build executes. The harness infers `workType`
from task `paths` and derives folder tree, plan, file and test maps, and the
failure matrix from `failure` scenarios (optional `recovery`). A standard draft
always authors `why` (or `summary`), failures except for
docs/chore/test/refactor/config, and per-type fields (test has none):
feature `userFlow` (Mermaid); ui `userFlow`, `uiStates`, `componentMap`; api
`apiContracts`; data `dataModel`; config `configContract`; async `jobContract`
and a sequence diagram; bugfix/refactor their objects. Keep `fileMap` paths
and task tests inside task `paths`.

## Compile and inspect

Create one semantic draft v4 from `change start --template`: `intent`, semantic
`requirements`, `tasks` with `covers`, and evidence capabilities keyed by
requirement. Its discovery contract is defined once in
[semantic-intake.md](semantic-intake.md). Draft v3 remains the compatibility
path for existing callers. Put only real complexity in typed extensions:

- `decisions` only for choices hard to reverse, surprising without context,
  and selected among meaningful alternatives;
- `diagrams` for Mermaid or referenced SVG/PNG contracts;
- `prototypeSelection` for an existing selection note (never prototype code or
  output as proof);
- `integrations` with documentation source/version, linked requirements, and
  security/resilience/compatibility concerns;
- `repositories` only for multi-repository work, plus each task's
  `repository`, whose root its paths and verify are relative to;
  external operations only for permission-bound work; Grounding v3 only for
  non-derived material decisions.

Local references must be project files; remote integration sources need HTTPS
and a fixed version, not `latest` or a branch.

Create no decision-tree or interview ledger. Never create `CONTEXT.md`, a glossary artifact, or an ADR store;
durable terms and choices belong in the compiled packet. Always hash grounding reads in the draft `grounding` field
when a material decision needs one; the compiler writes `grounding.yaml`.

Compare canonical requirements before choosing `ADDED`, `MODIFIED`, or
`REMOVED`. Do not default to `ADDED`. For `MODIFIED`, copy the complete
requirement and every existing scenario; for `REMOVED`, include a
`**Migration:**` or `**Compatibility:**` consequence. Do not guess
upstream API behavior when documentation or version is missing—return a research
or user-decision boundary.

For defect behavior, include adjacent input partitions and source-language representation/coercion boundaries,
not only the reported reproduction; declare `input-domain` when behavior uses caller-supplied values.

`claude-foundation change start .foundation/drafts/<id>.json` inspects and
starts in one call when clean; otherwise follow the returned intake action.
Never inspect managed `.claude/harness/**` merely to reconstruct this schema.
The compiler owns classification, the intake responsibilities in
[semantic-intake.md](semantic-intake.md), stable requirement/claim/task IDs,
cross-links, conditional artifacts, versioned defaults, structural validation,
and rollback; the first Build `advance` owns sandbox creation and setup.
Repair only the draft fields it reports, as one batch, then retry. Never create
parallel IDs by hand.

If Build discovers new observable behavior, create a semantic amendment v1 and
run `change amend <change> <amendment.json>`: it inspects, then amends only
at `DONE`. It preserves completed tasks and custom prose/assets,
increments the revision, invalidates the affected contract, and rolls back on
failure. Never rewrite a legacy change only to migrate it. An amendment to a v4 agreement must include discovery coverage
for added and revised requirements. `updateTasks` may extend claim coverage,
never replace an outcome; a completed task's verify changes only with
`reopen: true`. Task-only amendments (`updateTasks` verify, `removeTasks` for
unfinished tasks) need no intake (`change amend --template`). `reviseRequirements` replaces a requirement row in
its same capability and operation and needs an open task; `removeRequirements`
needs a `migration` and must not orphan a task. Before Build starts, revise the
whole agreement with `change revise <change> <draft.json>`, which likewise
inspects first.

After a successful start, read the compiled proposal, tasks, evidence, and any
specs/design: detail and document language must survive compilation. Reconcile each confirmed
conversation requirement and constraint against its compiled
requirement/scenario, proposal exclusion, or design decision; report any
uncovered material point in the approval summary, not a separate ledger.
Structural validation alone does not establish semantic completeness; check
that cited sources support the claimed meaning. Repair missing content through
the draft/amendment workflow, never by silently proceeding to Build.

The compiled `openspec/changes/<id>/` documents—not the draft or `.foundation`
state—are the source of truth. Wait for explicit approval of
this spec before Build unless the request already approves it; validation is not approval.
Revisions and amendments carry that approval unless they remove a requirement.
At a real decision, authority, resource, contradiction, or repeated no-progress
boundary, preserve the draft and present supported alternatives. The agent
must never retire one unasked or infer acceptance from silence.
Optional audit warnings are advisory and do not invent missing grounding.
