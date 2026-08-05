# SQLite recovery and retention

Changeloop never replaces, deletes, or silently recreates a database that
fails an integrity, WAL-header, or schema-migration check. Startup returns a
typed `RecoveryRequired` error with a stable code and recovery instructions.
`cloop doctor` performs the same checks read-only and reports
`databaseModified: false`.

When recovery is required:

1. Stop every `cloop` and app-server process for the project.
2. Preserve `state.db`, `state.db-wal`, and `state.db-shm` together. Do not
   copy, restore, or delete only one member of the SQLite set.
3. Run `cloop doctor` and record its recovery code.
4. Restore the complete set from a verified backup or use SQLite's documented
   recovery tooling on copies. Keep the originals unchanged.

Schema migrations run in SQLite transactions. A partially applied or
schema-drifted migration is rejected without advancing `user_version` or
dropping existing rows. A database created by a newer Changeloop version is
also rejected.

Event IDs and cursors are unique. Each session retains at most 50,000 events.
At the limit, append returns typed `RetentionPressure` and pauses growth; it
does not silently prune history. The user must export/archive or explicitly
delete a session that is no longer referenced. Evidence, snapshots, pause
checkpoints, tool results, and audit/legal roots are never removed by automatic
retention. Explicit compaction is fail-closed: every proof, snapshot, export,
or audit root can add a durable cursor pin, multiple roots may pin the same
cursor, and compaction returns `CompactionPinned` until all matching roots are
explicitly released. Successful compaction appends a new audit event. Replay
from a deleted cursor returns typed `CursorExpired` with the oldest retained
cursor; an unknown future cursor remains `CursorNotFound`.

Global storage growth is bounded separately from per-session history. New
sessions stop at `CHANGELOOP_MAX_SESSIONS` (default 10,000), and growth writes
stop at `CHANGELOOP_DATABASE_MAX_BYTES` (default 4 GiB). These conditions
return `SessionQuotaPressure` or `DatabaseQuotaPressure`; they never trigger
implicit evidence deletion.

Content-addressed tool artifacts use independent limits:
`CHANGELOOP_ARTIFACT_MAX_BYTES` (default 1 GiB) and
`CHANGELOOP_ARTIFACT_MAX_FILES` (default 50,000). New unique artifacts receive
typed `ArtifactQuotaPressure`; already stored content remains readable and
deduplicated. Explicit artifact GC scans the SQLite/WAL, proof, review,
snapshot, hook, privacy, and operational roots for referenced digests. It only
removes oldest unreferenced artifacts, preserves recently created artifacts
for active work, and reports pressure when pinned content alone exceeds the
quota. If the bounded pin scan cannot finish, GC returns
`ArtifactPinScanPressure` and deletes nothing.

Privacy purge commits session deletion before WAL checkpoint/VACUUM. If that
maintenance step fails, `PostPurgeMaintenance` explicitly reports that the
deletion already committed, preventing a blind retry or false claim that no
data changed.
