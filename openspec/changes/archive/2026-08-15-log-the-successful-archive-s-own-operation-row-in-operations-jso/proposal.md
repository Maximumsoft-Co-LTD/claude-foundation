# Change: Log the successful archive's own operation row in operations.jsonl

## Why

A consumer round report showed the completed archive missing from the change timeline: every command logged except the one that finished the change, so metrics and post-hoc reports undercount the land phase.

## What changes

- Capture the change's runtime status once, before the command runs, and gate the exit-hook log on that pre-command status instead of re-reading at exit.
- A successful archive therefore appends its own operations.jsonl row, while any command run against an already-archived change still appends nothing.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none

## Non-goals

- No change to what the row contains, to Claude telemetry ingestion, or to the read-only-operations filter.
