# Foundation runtime

This directory is machine-owned. Runtime state, receipts, immutable evidence
bundles, workspace snapshots, provider logs, request-usage events, incremental
transcript cursors, recoverable Land transaction journals/backups, and sandboxes
are intentionally ignored.
`install-manifest.txt` is the exception: it records only files owned by the
Foundation installer so upgrades can remove stale managed files safely.
Durable intent belongs in `openspec/`; implementation truth belongs in code and
tests.
