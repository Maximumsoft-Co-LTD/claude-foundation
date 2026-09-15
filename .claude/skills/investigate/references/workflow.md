# Investigate workflow

Inspect the smallest relevant code, specifications, tests, referenced
integration documentation, and active sandbox. Separate verified facts,
inferences, hypotheses, falsified hypotheses, options, tradeoffs, and unknowns.
Source-owned facts are agent work; ask the user only for consequential choices
that evidence cannot settle.

Without comparison, the investigation note is the only allowed write; create
`openspec/investigations/<name>.md` only when findings must persist. With
approved `--compare`, create three to five disposable alternatives only under
`.foundation/prototypes/<id>/`, record the choice, reasons, rejected options,
and paths in `selection.md`, and do not edit product code or OpenSpec. Prototype
output is never proof.

Return the conclusion, source references, hypotheses tested and falsified,
recommendation, unknowns, unresolved decision keys, and the exact `/change`
next action in the user's language. The harness owns write boundaries,
persistence, and resume routing. Continue while evidence changes the result;
at repeated no-progress, preserve findings and return the exact resume route.
