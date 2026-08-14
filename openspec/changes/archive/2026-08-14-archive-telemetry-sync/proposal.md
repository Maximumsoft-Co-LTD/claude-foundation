# Change: archive-telemetry-sync

## Why

`telemetry sync` exists but nothing in the lifecycle ever calls it: Land and
archive complete without importing the session's model usage, so a consumer's
round ledger shows empty cost and token columns unless someone remembered the
manual command. The Hydra round report shipped with
`command-observed; model usage requires host telemetry ingestion` in place of
every cost figure.

## What changes

- `land archive` runs one quiet Claude-telemetry sync for the change before
  the destructive archive step, using the ambient host transcript when one is
  bound; absence of a transcript stays silent and non-blocking.
- When the change reaches archive with no model usage ever imported, the
  existing end-of-archive warning cluster gains one line saying cost columns
  will be empty and naming the manual command.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped runtime (`apply-runtime.mjs` archive path,
  `foundation.mjs` wiring), deterministic tests.
- **Security triggers:** none.

## Non-goals

- No new CLI surface; `telemetry sync` keeps its manual form.
- No blocking gate — telemetry absence never stops an archive.
- No changes to telemetry parsing, cursors, or storage formats.
