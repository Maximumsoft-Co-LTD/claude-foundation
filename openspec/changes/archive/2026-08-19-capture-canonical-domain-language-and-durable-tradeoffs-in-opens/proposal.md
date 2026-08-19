# Change: Capture canonical domain language and durable tradeoffs in OpenSpec design

## Why

Foundation should sharpen project-specific terminology and preserve meaningful tradeoffs without introducing CONTEXT.md, ADR directories, or another source of truth beside the existing OpenSpec packet.

## What changes

- Add a concise Domain language section to newly generated standard design.md packets for canonical project terms, meanings, and avoided aliases.
- Make discovery source-check fuzzy or conflicting terminology and persist resolved language in the existing OpenSpec design rather than a parallel glossary.
- Record durable tradeoffs in the existing Decisions section only when they are hard to reverse, surprising without context, and chosen among meaningful alternatives.
- Prove new-standard, upgrade, rapid compatibility, and no-parallel-ledger behavior with deterministic production-bound tests.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** standard OpenSpec design template, change materialization, discovery skills, deterministic contract tests
- **Security triggers:** none

## Non-goals

- Create CONTEXT.md, CONTEXT-MAP.md, docs/adr, a glossary artifact, or a new lifecycle phase.
- Require terminology capture for general programming vocabulary or for every change.
- Retrofit existing active or archived packets, or add design.md to the rapid schema.
