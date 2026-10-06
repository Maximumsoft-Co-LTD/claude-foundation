---
title: /change
description: Compile one semantic draft into a validated OpenSpec agreement.
---

```text
/change <intent | existing-change> [--prototype-selection <path>]
```

`/change` turns intent into the durable agreement that every later phase reads.
The agent interprets sources and writes one semantic draft; Change Loop derives
the required discovery dimensions, validates the decision frontier, generates
the bookkeeping, and installs the result transactionally.

## Minimal draft

For an ordinary change, write only the intent, the behavior, and the tasks, and
leave `version` out. `change start --template` prints this form first as
`minimalDraft`:

```json
{
  "intent": "Reject empty note titles",
  "requirements": [{
    "description": "The system SHALL reject a note whose title is empty",
    "scenarios": [{ "when": "a user submits an empty title", "then": "the note is not created" }]
  }],
  "tasks": [{ "outcome": "Validate note titles", "verify": "npm test", "paths": ["src/note.js"] }]
}
```

The compiler fills in the version, requirement and task keys, capability (an
optional top-level `capability` names it; otherwise an existing `openspec/specs`
capability matched by requirement text or task paths; with no confident match
one `EDIT` lists the capabilities to choose from; when no specs exist, the
intent's noun phrase in at most three words, such as `kanban-board`), operation
(`modified` when a canonical requirement matches, otherwise `added`), scenario
names, `covers` (inferred
only with one task or one requirement; several of both return one `EDIT`
naming each `tasks[i].covers`),
rapid defaults, and test evidence from `verify`. A derived requirement key is
whole words from the SHALL clause (at most five words and 40 characters, no
trailing word such as "and" or "to"), and the requirement heading is that
clause as a readable title, such as "Persist its cards in browser
localStorage". A delta for a capability with no living spec states a
`## Purpose` (the capability overview, else the intent, with requirement titles
when the intent is short) that archive carries into the new spec; an existing
spec's Purpose is never replaced. A derived scenario name is a
short whole-word title from `when` (at most 60 characters, no leading article or
dangling word); two that read the same are told apart by their `given` or
`then`, else a number. Add `decisions: [{ "key", "choice", "reason"? }]` for
each default you chose without asking (stack, storage): they are recorded as
`decidedBy: agent`, listed under Decisions in the proposal, and keep the rapid
lane. With no `why`, the proposal omits Why rather than repeat the intent.
One `change start <draft>`
inspects and starts it, and prints the packet files and tasks. A draft that
states `version: 4` or declares risk uses the full form below.

## The full semantic draft

The full core stays small:

```json
{
  "version": 4,
  "intent": "Prevent orphaned rows from blocking mutations",
  "impact": "medium",
  "coupling": "isolated",
  "requirements": [{
    "key": "orphan-row-does-not-lock",
    "capability": "mutation-control",
    "operation": "added",
    "description": "The mutation guard SHALL ignore phase rows of inactive changes.",
    "outcome": "Unrelated mutations remain available",
    "scenarios": [{
      "name": "Orphaned row",
      "given": "a phase row belongs to an archived change",
      "when": "another change edits a product file",
      "then": "the edit is allowed"
    }]
  }],
  "tasks": [{
    "key": "filter-orphan-rows",
    "outcome": "Exclude orphaned rows from active locks",
    "covers": ["orphan-row-does-not-lock"],
    "paths": ["src/**"],
    "verify": "npm test"
  }],
  "evidence": {
    "orphan-row-does-not-lock": { "capabilities": ["test"] }
  },
  "discovery": {
    "coverage": [
      { "dimension": "current-behavior", "status": "covered", "sources": ["src/mutations.js"] },
      { "dimension": "affected-actor", "status": "covered", "covers": ["orphan-row-does-not-lock"] },
      { "dimension": "desired-behavior", "status": "covered", "covers": ["orphan-row-does-not-lock"] },
      { "dimension": "success-path", "status": "covered", "covers": ["orphan-row-does-not-lock"] },
      { "dimension": "failure-path", "status": "covered", "covers": ["orphan-row-does-not-lock"] },
      { "dimension": "input-boundary", "status": "covered", "covers": ["orphan-row-does-not-lock"] },
      { "dimension": "compatibility", "status": "not-applicable", "rationale": "No public contract changes." },
      { "dimension": "non-goals", "status": "not-applicable", "rationale": "The behavior is already narrowly bounded." },
      { "dimension": "verification", "status": "covered", "covers": ["orphan-row-does-not-lock"] }
    ],
    "decisions": []
  }
}
```

The agent uses meaningful keys. Discovery coverage is optional for an ordinary
change: `impact: high` and typed risk declarations (`riskSignals`, security
triggers, integrations, external operations) add required dimensions, prose is
never scanned for keywords, and a risk-derived `not-applicable` row needs only
a rationale. The harness refuses unresolved investigation or user-decision statuses, checks
decision prerequisite cycles, and exposes at most three dependency-ready
decisions at a time. The compiler creates stable claim/task IDs,
spec-to-claim-to-task-to-provider links, classification, and versioned defaults.
It reports every independent draft problem together, pointing back to the input
field. A failed compile leaves no partial change.

Specs are written for people. Each scenario is one case with a short `name`,
optional `given` preconditions, one `when`, one `then`, and optional `and`
results; a `when` or `then` that joins cases with `;` is refused, as is a
requirement statement long enough to hide several requirements (list
constraints in `details` instead). `capabilityOverviews` gives each spec file a
human title and a short overview, and `language` records the document language:
prose follows it while `SHALL`, `GIVEN`, `WHEN`, `THEN`, and `AND` stay English
for the OpenSpec parser.

Print the current schema with `change start --template`, then run
`change start <draft.json>`. A complete draft is inspected, compiled, and
started in one call, and the output lists the packet files and tasks.
Otherwise the harness returns agent-owned source investigation or repair, or at
most three linked user decisions, plus an exact resume route, and creates
nothing. `--inspect` inspects without starting; `--consume-draft` also removes
the draft after a successful start. Record the user's spec approval with
`advance <change> --approve-spec --decision-ref <ref>`. Versions 1 through 3 remain
supported for existing integrations.
Use typed `riskSignals` for access control, persisted data, integrations,
performance SLOs, UI, operational risk, and external side effects so required
coverage does not depend on the language used in prose. The harness records
the source digest itself, so a correct draft reaches `DONE` on its first
inspect; design and reader-guide warnings are advisory.
Inspection stores one machine-owned snapshot bound to the draft and its local
source digests. Before inspection, bounded repository intelligence ranks specs,
tests, callers, integrations, persistence, and permission boundaries. Typed
risk and repository signals adapt the read budget without dropping required
dimensions. Source-answerable questions, duplicate alternatives, and
unsupported recommendations are rejected. A changed source returns
`refresh-source-coverage`; the snapshot records compact effectiveness metrics,
not a transcript.

## Typed extensions

Add complexity only when the work needs it:

- multiple requirements with separate `capability` and `operation` values
- dev document sections: `summary`, `userFlow` (Mermaid), `failureMatrix`,
  `componentMap`, `apiContracts`, `dataModel`, `uiStates`, `configContract`,
  `jobContract`, `bugfix`, or `refactor`. The harness infers `workType` from
  task paths (declare it to override) and derives the folder tree, plan, file
  map, and test map. A standard change must carry the sections its work type
  needs; a missing one is a draft repair for the agent, never a user question.
  A task whose own tests sit outside its `paths` is a design warning
- `decisions` for load-bearing choices, each with its consequences
- Mermaid or referenced SVG/PNG `diagrams`
- `prototypeSelection` pointing at an existing selection note
- `integrations` with documentation source/version, linked requirements, and
  security/resilience/compatibility concerns; related scenarios explicitly use
  `"kind": "success"` and `"kind": "failure"`
- repositories for multi-repository scope
- external operations for permission-bound work
- Grounding v3 for non-derived material decisions

Prototype output is never proof. Missing or unversioned integration
documentation is a research/user-decision boundary, not permission to guess.
For `MODIFIED`, the compiler reads the canonical spec and merges its complete
scenario set before adding or changing scenarios; `REMOVED` requires a
migration consequence. A local diagram, prototype selection, or integration
document must resolve to a regular file inside the project; directories and
symlinks that escape it are refused. A remote integration source must use HTTPS
and a fixed version rather than `latest` or a branch.

## Conditional artifacts and source of truth

Rapid changes contain `proposal.md`, `tasks.md`, `evidence.yaml`, and a concise
delta `specs/<capability>/spec.md` rendered exactly as in standard; Land merges
it into `openspec/specs`. Only a legacy rapid packet declaring `skip_specs` has
no delta. The rapid proposal is the compact dev document: summary, user flow,
folder tree, failure matrix, and the plan Build executes. A standard v4 change
always adds `design.md` with the full dev document. Execution, repository,
handoff, and grounding files appear only for real overrides.

After compilation, `openspec/changes/<id>/` is the source of truth. The draft is
temporary and `.foundation/` is derived runtime state.

## Revising before Build

To change an agreed change before Build starts, revise the same change instead
of abandoning it:

```bash
claude-foundation change revise <change> <draft.json> --inspect
claude-foundation change revise <change> <draft.json> --consume-draft
```

The revised draft keeps the change id and passes the same intake gate as
`change start`. The whole packet is recompiled transactionally, the contract
revision increments, and any failure restores the prior packet and runtime
state. Once Build has a workspace, a receipt, or a completed task, the command
routes to `change amend`. The result lists the added, revised, and removed
requirements. An approved change keeps its approval for additive deltas; only
a delta that removes a requirement needs approval.

## Revising during Build

If Build discovers a new or changed observable requirement, use one semantic
amendment. `reviseRequirements` replaces an existing requirement (an open task
must cover it) and `removeRequirements` drops one with a `migration`:

```bash
claude-foundation change amend <change> <amendment.json> --consume-amendment
```

It preserves completed tasks, custom prose, diagrams, and unrelated sections;
adds stable links, increments the revision, validates, and rolls back on
failure. An existing task may gain claim coverage, but replacing its outcome,
or a completed task's verify command, requires a new task. To fix the verify
command of an unfinished task, send only `updateTasks: [{"key", "verify",
"paths"?}]`: no requirement, evidence, or intake is needed, and Prove reruns
that task's evidence. `change amend --template` prints both forms. Legacy changes retain their
compatible manual path. A version-4 amendment must include discovery coverage
for its added requirements; the validated delta is appended to `proposal.md`.
Before mutation, the harness records the affected claims, tasks, and
dependency-closed provider set as bounded input for proof scheduling. It
preserves only passing unaffected receipts whose declared provider, claim, and
input fingerprints remain exact; affected or ambiguous bindings rerun through
the returned Prove route.

A successful `/change` is already validated and isolated. Continue with
`claude-foundation advance <change> --through build`.
