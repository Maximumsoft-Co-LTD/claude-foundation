# Semantic intake

The harness owns required coverage, validation, state, and the next action. The
agent owns source interpretation and semantic authoring. The user owns
consequential choices and compiled-spec approval.

Resolve facts from the smallest relevant code, specifications, tests, and
versioned documentation. Never ask the user for a source-owned fact. When more
than one material interpretation remains, use `brainstorming`'s private
dependency tree. Ask only the current frontier in bounded rounds, carrying one
recommended answer per decision. A dependent question waits for its
prerequisites; recompute the frontier after every answer. Keep the tree private:
there is no interview ledger and only one compiled agreement approval after the
frontier closes.
For intake intelligence see
[semantic-intelligence.md](semantic-intelligence.md).

`change start <draft.json>` inspects before compiling and returns one typed
action: agent-owned `EDIT` for source investigation or draft
repair, user-owned `ASK_USER` for at most three dependency-ready consequential
decisions, or harness-owned `DONE` when compilation may start. Follow its
`resume` route after updating the same draft. Every `needs-user-decision` row
must name its related decisions in `decisionKeys`; missing or unknown links are
draft errors rather than an empty decision frontier.
Inspection keeps one machine-owned snapshot keyed by draft path, binding the
draft and grounded-source digests. Changed sources invalidate `DONE` and return
`refresh-source-coverage`; changing the draft acknowledges the refreshed
interpretation. No transcript or answer history is retained.

Draft v4 `discovery.coverage` is optional for an ordinary change; its
requirements carry coverage. Only typed declarations require rows:
`impact: high` (nine core dimensions plus operability and recoverability),
`riskSignals`, security triggers, `integrations`, and `externalOperations`.
A row is `covered`, `not-applicable` (with rationale), `needs-investigation`,
or `needs-user-decision`. Never turn an unresolved status into an assumption.
The harness rejects missing required dimensions, unresolved coverage, unknown
links, decision cycles, and open decisions, exposing at most three
dependency-ready decisions. Without `status`, only a `choice` settles a decision. Declare known concerns as `riskSignals`:
`access-control`, `persisted-data-change`, `external-integration`,
`performance-slo`, `user-interface`, `high-operational-risk`,
`external-side-effect`, or `input-domain` (caller-supplied values).
Prose is never scanned for risk keywords.

Every settled answer must land in a requirement, scenario, non-goal, constraint,
or qualifying typed decision before compilation. The compiled proposal retains
the coverage table so no answer lives only in chat. Draft v3 remains readable
for compatibility; do not retrofit active legacy changes merely to migrate.
For a v4 agreement, a Build-time semantic amendment supplies a complete
discovery delta for its added requirements. The harness revalidates it and
appends the delta to the proposal; v3 amendments retain their compatibility
shape.
