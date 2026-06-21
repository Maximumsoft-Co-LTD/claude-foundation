# Plan sections — triggers & placement

`.workflow/_templates/plan.md` is a **clean skeleton**: the always-required sections (Summary · Technical Context · Gate check · Phases for this task · Fanout plan · Architecture diagram) plus a pointer here; the executable `T###` tasks live in `tasks.md`. **This file is the authoritative trigger + placement list** for the optional plan sections — `lead.md` Mode A steps carry the *how*, this table the *when + where*. The companion size-axis view is `SKILL.md > Section gating by Size`.

Add a section ONLY when its trigger fires; delete it otherwise (no empty headers, no "N/A").

| Section | Include WHEN | Placement |
|---------|--------------|-----------|
| Reviewer summary | Size=L OR ≥3 decisions need sign-off (≤10 lines: goal · decisions needing sign-off · top risks) | before Summary |
| Hard-to-reverse decisions | schema/migration · public API/event contract · architecture/topology · destructive script (1 line each: decision · why now · cost to reverse) | after Summary; gate confirms each |
| Current state | brownfield: full for M/L OR refactor OR fix; proportional note for brownfield feat at XS/S. Skip greenfield. LSP-walk, cite path#anchor: entry points · flow 3–7 hops · blast radius · invariants | before Diagram |
| To explore at implement | brownfield deferred internals: pointer list `path/area — what to read — why safe to defer` (no blast-radius invariant) | after Current state |
| References / examples | spec carries it; restate repo refs as path#anchor + tag the `tasks.md` tasks `[ref: …]` | after Architecture diagram |
| Scaffold | M/L required · optional mini for S touching existing code · skip XS. Target file tree (★ new · ~ edited) + each new/changed file's key signatures + inlined definition of any decision-bearing type. Subsumes Folder structure for M/L. | after Diagram |
| Folder structure | new project OR feat adding ≥3 packages/modules. M/L → fold into Scaffold | after Diagram |
| API / event contracts | feat/fix changing public HTTP / event schema / cross-service message / new internal port. method · path · request · response · error codes (or interface + signatures). Name it BEFORE the tasks that fill it | after Scaffold |
| UI component & state plan | feat/refactor shipping UI: component tree ([AC#]) · state ownership · data source per screen · routes→screens · 1-line direction + a11y target | after API contracts |
| Research notes | spec/plan fanout ran (per worker: Dispatched-as + finding · plan impact) | — |
| Alternatives considered | M/L when approach non-obvious (name the evidence per rejection) | — |
| Risks | M/L OR fix with unclear root cause OR migration (table: Risk \| Likelihood \| Mitigation) | — |
| Observability | feat/fix ships runtime code adding a failure mode (new log line + metric) | — |
| Dependencies (WHEN) | can't ship until something else lands first (WHEN only; WHAT → spec Constraints) | — |
| Rollback | DB migration · destructive script · prod flag · binary cutover · public API (Trigger + ordered tasks + Data loss?) | — |
| Out of scope | real scope-creep risk (spike: "no production code lands — recommendations.md only") | — |

The per-file change list (new|edit|delete) lives in `tasks.md` — each task's `path#anchor (new|edit|delete)` — not a separate plan `Files touched` table. Task ordering is the `tasks.md` phase order + `T###` sequence.

Sections marked with no placement (`—`) sit after `## Architecture diagram` in the order above. Sections marked `skip` for the run's Size in `SKILL.md > Section gating by Size` are DELETED entirely.
