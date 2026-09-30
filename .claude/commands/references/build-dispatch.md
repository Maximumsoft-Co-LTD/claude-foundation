# Build dispatch actions

The native host owns spawning, cancellation, leases, and the task ledger.
Foundation returns one `EDIT` envelope with `execution.mode`, bounded tasks,
allowed paths, verification, and one resume route.

For a session-mode leased task, `advance` holds the lease itself
(`execution.managedLease`). Implement the embedded task and run its focused
checks; do not acquire or release it. After a success, resume `advance`: it
reruns the task's verify, ticks it in `tasks.md`, releases the lease, and checks
observed writes against the task scope. A failing task keeps its lease.
This keeps a singleton runnable frontier out of a new worker while preserving
the same fencing, observed-write, and result authority as spawned work.

For parallel mode, the parent is the orchestrator and join owner. Before
acquiring, determine the native worker slots currently available and select
that many workers, in returned order, without exceeding `maxParallelAgents`.
Never acquire a lease that cannot be spawned immediately. Acquire each selected
lease. Give each native worker only its action task and repository state; never
replay the parent transcript. Spawn every
successfully leased worker before waiting for any worker. Never serialize the
selected group or implement its tasks in the parent. Wait for the selected
group, release each matching lease, then resume `advance`; it ticks only
accepted successes whose verify passes. Leave unselected, failed, or blocked
tasks pending and dispatch again.

The task packet carries the worker contract. A worker implements only its
leased task and allowed paths. It reports its summary, focused checks, and
blockers to the parent for coordination; that report is not evidence.
Foundation accepts results from observed workspace writes and lease authority.
Resume `advance`; Proof owns the aggregate graph join.
The planner serializes tasks in a shared repository workspace because lease
release observes the repository diff. Parallel groups use independent
workspaces; do not widen a returned group just because paths look disjoint.
Force release abandons result authority. Never edit checkboxes yourself; keep
incomplete work pending and follow runtime recovery. If a ticked task is
returned with unresolved lease authority, preserve valid implementation and
rerun its focused verification under the returned lease before releasing the
result.

If an acquire loses to another host, do not spawn that worker. Keep and run any
leases already acquired by this host, release their results, then dispatch
again. For `wait`, wait for the named live workers or recover the existing
lease; never create duplicates.
