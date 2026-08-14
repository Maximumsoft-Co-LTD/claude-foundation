# Change: sandbox-setup-command

## Why

A newly created Build sandbox excludes dependency directories (`node_modules`
and everything gitignored) by design, and nothing ever installs them. Any
project whose test provider needs installed dependencies fails its first
`proof run` inside the sandbox with a missing-dependency error, and the agent
has to discover and fix this by hand every round. A consumer incident report
(Hydra dashboard round, 2026-08-14) hit exactly this: the jest gate failed
because the sandbox had no `node_modules`.

## What changes

- `foundation.json` accepts an optional `sandbox.setupCommand` (and
  `sandbox.setupTimeoutMs`); after a sandbox is created, the command runs once
  inside the new workspace and its outcome is recorded in the workspace record.
- `openspec/repositories.yaml` repository rows accept an optional
  `setupCommand`; multi-repository sandbox creation runs each repository's
  command inside that repository's sandbox.
- A failed setup command keeps the sandbox, records the failure, and prints a
  warning naming the command and workspace path; it never destroys the
  workspace.
- No configuration means behavior is unchanged.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped runtime (`sandbox-runtime.mjs`,
  `runtime-environment.mjs`, `repository-topology.mjs`, `foundation.mjs`
  wiring), project config (`foundation.json`, `openspec/repositories.yaml`),
  harness reference docs, deterministic tests.
- **Security triggers:** none — the command comes from project-owned config,
  the same trust domain as `execution.yaml` provider commands the harness
  already executes in the workspace.

## Non-goals

- No automatic detection of package managers or lockfiles; the command is
  explicit config only.
- No retry or re-run subcommand; a failed setup is fixed by running the
  printed command manually inside the sandbox.
- No change to workspace copy exclusions or worktree mechanics.
- No protocol pin bump: the config merge is permissive and no wire format
  changes.
