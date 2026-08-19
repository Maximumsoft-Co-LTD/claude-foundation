# Design

## Current state

- `foundation-standard` already owns `design.md`; `foundation-rapid` deliberately
  omits it.
- Standard template creation and rapid-to-standard upgrade use separate code
  paths, so both must receive the same additive content.
- `design.md` already owns load-bearing decisions and rejected alternatives,
  while `grounding.yaml` locks the user decision batch.
- Existing validation checks artifact presence and content quality without
  requiring a fixed list of design headings.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| Domain language | Project-specific canonical terms, meanings, and aliases that affect requirements or implementation boundaries | glossary artifact, general vocabulary |
| Durable tradeoff | A choice that is hard to reverse, surprising without context, and selected among meaningful alternatives | routine decision, ADR-worthy |
| Parallel ledger | Any artifact outside the existing OpenSpec packet that duplicates its terminology or decision authority | CONTEXT.md, ADR store |

## Decisions

- **Decision:** Add `## Domain language` to the existing standard `design.md`.
  - **Why:** The terminology remains adjacent to the requirements and decisions
    it constrains, preserving OpenSpec as the only durable agreement.
  - **Rejected:** Create `CONTEXT.md`, `CONTEXT-MAP.md`, or a glossary artifact.
- **Decision:** Treat the existing Decisions section as the durable rationale
  record only when all three tradeoff criteria hold.
  - **Why:** This adapts the useful ADR discipline without creating a second
    numbering, status, or lifecycle system.
  - **Rejected:** Create `docs/adr` or record every implementation choice.
- **Decision:** Generate the section prospectively but do not make it a
  validation requirement for existing packets.
  - **Why:** Active changes and archives remain compatible, and the rapid lane
    stays minimal.
  - **Rejected:** Retrofit old packets or add `design.md` to rapid changes.

## Compatibility and migration

No public API, runtime protocol, or persisted state changes. New standard
packets and rapid-to-standard upgrades receive the section. Existing standard
packets without it and all rapid packets remain valid. Rollback restores the
template, materializer, and instruction wording; no stored data is migrated.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A glossary competes with OpenSpec | Forbid parallel artifacts and persist only in `design.md` | test, review |
| Existing or rapid packets become invalid | Keep validation additive and assert both compatibility paths | test |
| Routine terminology bloats packets | Restrict capture to project-specific terms that affect the change | review |
| Direct start and upgrade drift | Assert generated output from both materialization paths | test |
