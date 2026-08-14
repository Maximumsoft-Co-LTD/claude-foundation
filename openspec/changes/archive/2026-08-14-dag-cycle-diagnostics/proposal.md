# Rapid change: dag-cycle-diagnostics

## Why

Both DAG schedulers detect a stuck graph only implicitly: when no node is
ready they list every pending id and stop. The task planner
(`agent-planning.mjs`) says `task dependency cycle: <all pending>` without
showing which edges form the cycle, and the provider scheduler
(`provider-scheduler.mjs`) cannot even tell a cycle apart from a dependency
that ran and failed — both throw the same
`provider dependency cycle or blocked dependency` message. Debugging either
condition means reconstructing the graph by hand.

## What Changes

- When the task planner detects a cycle, the error names an actual cycle
  path (`a -> b -> c -> a`) instead of only listing pending task ids.
- When the provider scheduler stalls, the error distinguishes the two
  causes: a true dependency cycle reports its cycle path; a node blocked by
  a dependency that executed and did not pass reports
  `blocked by failed provider <name>`.
- The provider scheduler still throws (never `fail()`/exit) so the caller's
  catch keeps stopping services and clearing the active proof run.
- Scheduling behavior for acyclic graphs is unchanged: same waves, same
  batching, same outcomes.

## Eligibility

- **Impact:** low
- **Coupling:** isolated
- **Public contract:** no
- **Persistent migration:** no
- **Security trigger:** no
- **Irreversible effect:** no
