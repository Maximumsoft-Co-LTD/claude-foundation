# Investigate workflow

Inspect the smallest relevant code, specs, tests, integration docs, and active
sandbox. Separate facts, inferences, hypotheses, options, tradeoffs, and unknowns.
Source-owned facts are agent work; ask the user only for consequential choices
that evidence cannot settle.

Print the record with `claude-foundation investigate --template`; keep it at
`openspec/investigations/<id>.json`. After each evidence batch run
`claude-foundation investigate <record.json>`. The harness discovers and hashes
sources, validates fact/hypothesis links, persists metrics and no-progress, and
returns `EDIT`, `ASK_USER`, or `DONE` with a resume route. Interpret and add each
new source to `sources`. On `DONE`, copy `handoff` into the semantic draft's
`investigation`; Change rejects stale bindings.

For Build/Prove investigations, set `activeChange`; follow the
[workspace-binding contract](../../../../WORKFLOW.md#investigate-problem).

Without comparison, the record and optional note are the only allowed write;
create `openspec/investigations/<name>.md` only when narrative helps. With
approved `--compare`, create three to five disposable alternatives only under
`.foundation/prototypes/<id>/`, record the choice, reasons, rejected options,
and paths in `selection.md`, and do not edit product code or OpenSpec. Prototype
output is never proof.

Return the conclusion, sources, tested/falsified hypotheses, recommendation,
unknowns, decision keys, and exact `/change` action in the user's language.
The harness owns boundaries, persistence, and resume routing. Continue while
evidence changes the result; at repeated no-progress, preserve findings and
return the resume route.
