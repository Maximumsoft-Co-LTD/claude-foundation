# Change: Automate native-host agent dispatch

## Why

Foundation compiles a safe execution graph, bounded task packets, and fenced
leases, but the native host must still interpret `agents plan` and assemble the
spawn/wait/resume loop itself. The result is capable but inconsistent: two host
sessions can make different dispatch choices, repeat a live worker after a
restart, or copy more conversation context than the task needs.

The desired outcome is one host-facing, deterministic dispatch decision that
turns the current graph and lease state into the next bounded native-host
action while retaining the existing single-agent path.

## What changes

- Add an idempotent `agents dispatch <change>` host command that reports one of
  `run-in-session`, `spawn-group`, `wait`, `blocked`, or `build-complete`.
- Bind every spawn recommendation to the current graph, plan, task packet,
  model tier, owner identity, and concurrency ceiling.
- Make `/build` consume dispatch decisions and use native subagents only for a
  returned parallel group; workers receive task packets rather than the parent
  transcript.
- Expose active workers and expiry in the same decision so an interrupted host
  waits or resumes instead of duplicating live work.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** public CLI, plan/packet contracts, Build host instructions, runtime protocol, tests, documentation
- **Security triggers:** host/worker authority and stale-result boundary

## Non-goals

- Making the harness invoke Claude, Codex, OpenCode, or any model process.
- Automatically committing, pushing, opening pull requests, deploying, or
  extending host permissions.
- Parallelizing tasks whose declared paths, resources, or dependencies do not
  prove independence.
- Copying the complete parent conversation into workers.
