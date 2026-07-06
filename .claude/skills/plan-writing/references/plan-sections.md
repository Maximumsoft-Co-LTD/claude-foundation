# Plan sections — triggers & placement

`.workflow/_templates/plan.md` is a **clean skeleton**: the always-required sections (Summary · Technical Context · Gate check · Phases for this task · Fanout plan · Architecture diagram) plus a pointer here; the executable `T###` tasks live in `tasks.md`. **This file is the authoritative trigger + placement list** for the optional plan sections — `lead.md` Mode A steps carry the *how*, this table the *when + where*. The companion size-axis view is `SKILL.md > Section gating by Size`.

Add a section ONLY when its trigger fires; delete it otherwise (no empty headers, no "N/A").

**Two per-section axes** (columns below):
- **Reader** — `eng` = engineer reads it at implement (**build-time**, pulled per-task via `[ref:]`); `gate` = **plan-time**, only gate/reviewer/orchestrator read it. Always-required sections: `## Summary` + `## Technical Context` are engineer up-front reads; `## Architecture diagram` + Scaffold are `eng` (pulled per-task); `## Gate check`/`## Phases`/`## Fanout plan` are `gate`.
- **Budget** — a prose cap (concretizes `rules/fundamentals.md > Output discipline`); cap prose, never drop a consumed field (`[AC#]`, `path#anchor`, `verify:`, mermaid).

| Section | Reader | Budget | Include WHEN | Placement |
|---|---|---|---|---|
| Reviewer summary | gate | ≤10 lines | Size=L OR ≥3 decisions need sign-off (goal · decisions needing sign-off · top risks) | before Summary |
| Hard-to-reverse decisions | gate | 1 line each | schema/migration · public API/event contract · architecture/topology · destructive script (decision · why now · cost to reverse) | after Summary; gate confirms each |
| Current state | eng | ≤~15 lines | brownfield: full for M/L OR refactor OR fix; proportional note for brownfield feat at XS/S. Skip greenfield. LSP-walk, cite `path#anchor`: entry points · flow 3–7 hops · blast radius · invariants — **digest the invariants into `tasks.md > ## Guardrails`** | before Diagram |
| To explore at implement | eng | 1 line each | brownfield deferred internals: pointer list `path/area — what to read — why safe to defer` (no blast-radius invariant — those go to Guardrails) | after Current state |
| References / examples | eng | 1 line each | spec carries it; restate repo refs as `path#anchor` + tag the `tasks.md` tasks `[ref: …]` | after Architecture diagram |
| Scaffold | eng | tree + signatures; stub body ≤1 line | M/L required · optional mini for S touching existing code · skip XS. Target file tree (★ new · ~ edited) + each new/changed file's key signatures + inlined decision-bearing types. Subsumes Folder structure for M/L | after Diagram |
| Folder structure | eng | tree only | new project OR feat adding ≥3 packages/modules. M/L → fold into Scaffold | after Diagram |
| API / event contracts | eng | 1 line per endpoint/field | feat/fix changing public HTTP / event schema / cross-service message / new internal port. method · path · request · response · error codes (or interface + signatures). Name it BEFORE the tasks that fill it | after Scaffold |
| UI component & state plan | eng | 1-line direction/screen | feat/refactor shipping UI: component tree (`[AC#]`) · state ownership · data source per screen · routes→screens · 1-line direction + a11y target | after API contracts |
| Research notes | gate | 1 line/finding | spec/plan fanout ran (per worker: Dispatched-as + finding · plan impact) | — |
| Alternatives considered | gate | 1 line/rejection | M/L when approach non-obvious (name the evidence per rejection) | — |
| Risks | gate\* | 1 row each | M/L OR fix with unclear root cause OR migration (table: Risk \| Likelihood \| Mitigation). \*engineer reads Risks/mitigations only on deviation | — |
| Observability | eng | 1 log + 1 metric | feat/fix ships runtime code adding a failure mode (new log line + metric) | — |
| Dependencies (WHEN) | gate | 1 line each | can't ship until something else lands first (WHEN only; WHAT → spec Constraints) | — |
| Rollback | gate | trigger + ordered tasks | DB migration · destructive script · prod flag · binary cutover · public API (Trigger + ordered tasks + Data loss?) | — |
| Out of scope | gate | 1 line each | real scope-creep risk (spike: "no production code lands — recommendations.md only") | — |

The per-file change list (new|edit|delete) lives in `tasks.md` — each task's `path#anchor (new|edit|delete)` — not a separate plan `Files touched` table. Task ordering is the `tasks.md` phase order + `T###` sequence.

Sections marked with no placement (`—`) sit after `## Architecture diagram` in the order above. Sections marked `skip` for the run's Size in `SKILL.md > Section gating by Size` are DELETED entirely.
