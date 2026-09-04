---
title: /change
description: Compile one semantic draft into a validated OpenSpec agreement.
---

```text
/change <intent | existing-change> [--prototype-selection <path>]
```

`/change` turns intent into the durable agreement that every later phase reads.
The agent writes one compact semantic draft; Change Loop generates the
bookkeeping and installs the result transactionally.

## The semantic draft

The required core is deliberately small:

```json
{
  "version": 3,
  "intent": "Prevent orphaned rows from blocking mutations",
  "impact": "medium",
  "coupling": "isolated",
  "requirements": [{
    "key": "orphan-row-does-not-lock",
    "capability": "mutation-control",
    "operation": "added",
    "scenario": "An orphaned phase row exists",
    "outcome": "Unrelated mutations remain available"
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
  }
}
```

The agent uses meaningful keys. The compiler creates stable claim/task IDs,
spec-to-claim-to-task-to-provider links, classification, and versioned defaults.
It reports every independent draft problem together, pointing back to the input
field. A failed compile leaves no partial change.

Print the current schema with `change start --template`; start with
`change start <draft.json> --consume-draft`. Versions 1 and 2 remain supported
for existing integrations.

## Typed extensions

Add complexity only when the work needs it:

- multiple requirements with separate `capability` and `operation` values
- `decisions` for load-bearing choices
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

Rapid changes normally contain only `proposal.md`, `tasks.md`, and
`evidence.yaml`. Standard changes add delta specs; `design.md` appears only for
a load-bearing decision or architecture context. Execution, repository,
handoff, and grounding files appear only for real overrides.

After compilation, `openspec/changes/<id>/` is the source of truth. The draft is
temporary and `.foundation/` is derived runtime state.

## Revising during Build

If Build discovers a new observable requirement, use one semantic amendment:

```bash
claude-foundation change amend <change> <amendment.json> --consume-amendment
```

It preserves completed tasks, custom prose, diagrams, and unrelated sections;
adds stable links, increments the revision, validates, and rolls back on
failure. An existing task may gain claim coverage, but replacing its outcome or
verification command requires a new task. Legacy changes retain their
compatible manual path.

A successful `/change` is already validated and isolated. Continue with
`claude-foundation advance <change> --through build`.
