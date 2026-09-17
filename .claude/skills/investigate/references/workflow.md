# Investigate workflow

The harness owns boundaries, persistence, and resume routing.
Inspect code, specs, tests, and integration docs.
Separate facts, hypotheses, options, tradeoffs, and unknowns. Resolve source-owned
facts; ask users only for consequential choices evidence cannot settle.

Start with `claude-foundation investigate --template`; keep the record at
`openspec/investigations/<id>.json`. After each evidence batch run
`claude-foundation investigate <record.json>`. Interpret discovered sources and
acknowledge them in `sources`. Follow `EDIT`, `ASK_USER`, or `DONE` and its resume
route. When proceeding to Change, copy `handoff` into draft `investigation`;
Reject stale bindings.

For Build/Prove, set `activeChange`; follow the
[workspace-binding contract](../../../../WORKFLOW.md#investigate-problem).

Write in the user's language (`language: "th"` selects Thai headings). The harness generates
`openspec/investigations/<id>.report.md` after each batch. Link the current report
with a short conclusion in chat; retain JSON for validation/handoff. Resume
report failures without repeating valid research.
Do not use generated reports as sources or start Change automatically.

Without comparison, agent writes are the record and an optional authored note;
the harness owns the generated report. Preserve existing `<id>.md` notes. With
approved `--compare`, create three to five disposable alternatives only under
`.foundation/prototypes/<id>/`, record the choice, reasons, rejected options,
and paths in `selection.md`, and do not edit product code or OpenSpec. Prototype
output is never proof.

Continue while evidence changes the result. At real boundaries or repeated
no-progress, preserve findings and exact resume routes.
