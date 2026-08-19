# Build dispatch actions

The native host owns spawning, cancellation, leases, and the task ledger.
Foundation only returns the next bounded action.

For `spawn-group`, the parent is the orchestrator and join owner. Acquire each
returned lease, then regenerate its `packet --task`. Give each native worker
only that packet and repository state; never replay the parent transcript.
Spawn every successfully leased worker before waiting for any worker. Never
serialize the group or implement its tasks in the parent. Wait for the whole
group, release each matching lease, then mark only accepted successes complete
in `tasks.md`. Leave failed or blocked tasks pending and dispatch again.

A worker implements only its leased task and allowed paths. It must not edit
`tasks.md`, dispatch successors, or claim another worker's result. It reports
its summary, focused checks, and blockers to the parent for coordination; that
report is not evidence. Foundation accepts results from observed workspace
writes and lease authority, and Prove owns the aggregate graph join.

If an acquire loses to another host, do not spawn that worker. Keep and run any
leases already acquired by this host, release their results, then dispatch
again. For `wait`, wait for the named live workers or recover the existing
lease; never create duplicates.
