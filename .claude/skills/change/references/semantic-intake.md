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

Before compilation, run `change start <draft.json> --inspect`. The harness
returns one typed action: agent-owned `EDIT` for source investigation or draft
repair, user-owned `ASK_USER` for at most three dependency-ready consequential
decisions, or harness-owned `DONE` when compilation may start. Follow its
`resume` route after updating the same draft. Every `needs-user-decision` row
must name its related decisions in `decisionKeys`; missing or unknown links are
draft errors rather than an empty decision frontier.
Inspection keeps one machine-owned snapshot keyed by draft path, binding the
draft and grounded-source digests. Changed sources invalidate `DONE` and return
`refresh-source-coverage`; changing the draft acknowledges the refreshed
interpretation. No transcript or answer history is retained.

Draft v4 `discovery.coverage` records every harness-required dimension as
`covered`, `not-applicable`, `needs-investigation`, or
`needs-user-decision`. Map covered dimensions to requirements or grounded local
sources. Explain every not-applicable result. Never turn an unresolved status
into an assumption: investigate discoverable facts and ask only consequential
semantics. The harness rejects missing dimensions, unresolved coverage,
unknown requirement links, decision dependency cycles, and open decisions. It
exposes at most three dependency-ready decisions as the next frontier.
Use stable, language-neutral `riskSignals` when a concern is known:
`access-control`, `persisted-data-change`, `external-integration`,
`performance-slo`, `user-interface`, `high-operational-risk`, or
`external-side-effect`. The harness maps these signals to required dimensions;
natural-language matching remains only a compatibility aid.

Every settled answer must land in a requirement, scenario, non-goal, constraint,
or qualifying typed decision before compilation. The compiled proposal retains
the coverage table so no answer lives only in chat. Draft v3 remains readable
for compatibility; do not retrofit active legacy changes merely to migrate.
For a v4 agreement, a Build-time semantic amendment supplies a complete
discovery delta for its added requirements. The harness revalidates it and
appends the delta to the proposal; v3 amendments retain their compatibility
shape.
