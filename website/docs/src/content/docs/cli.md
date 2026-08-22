---
title: CLI reference
description: The commands your agent runs, grouped by what they do and what authority they need.
---

Your agent runs these; you rarely need to. They are documented so you can read what the agent is doing, and drive it yourself when you want to.

Every command answers `--help`, and `claude-foundation describe [command] [--json]` describes the surface — including the eight slash commands, resolvable by bare word or `/slash` spelling, read from the shipped command files so there is no second copy to drift.

## Read-only

Safe to run at any time. These mutate nothing.

| Command | Purpose |
|---|---|
| `changes` | List active changes, lifecycle status, and each one's next useful action |
| `doctor [--stage change\|build\|prove] [--change <id>]` | Diagnose project, provider, and lifecycle readiness |
| `packet <change> [--phase <phase>] [--task <id>]` | Read the bounded machine handoff for the current operation |
| `metrics <change>` | Inspect measured usage, active budget, cost, and execution timing |
| `change audit <change>` | Audit scenario, claim, task, and provider traceability |
| `proof readiness <change>` | Typed blockers and canonical next commands |
| `land check <change>` | Validate that the proven projection remains landable |
| `handoff status <change>` | Inspect permission-bound operations and their Land disposition |
| `handoff packet <change> [--id <H00n>]` | Read the credential-free packet for a named DevOps/SRE owner |
| `repos [change]` | Inspect repository topology and selection |
| `models` | Inspect model-tier policy |
| `providers` | Inspect evidence wiring while defining a change contract |
| `version` | Print the installed package version |

## The change lifecycle

| Command | Purpose |
|---|---|
| `change new <intent> [--rapid]` | Create a change agreement |
| `change start --template \| <draft.json>` | Create and start an isolated change from one validated draft |
| `change resolve <change> …` | Persist impact, coupling, security, and review decisions |
| `change validate <change>` | Validate the change and its executable evidence contract |
| `sandbox create <change> [--all]` | Create the isolated Build workspace |
| `sandbox sync <change>` | Synchronize an intentional contract revision into Build |
| `proof advance <change>` | Normal resumable Prove path; execute once, route external gates, and finalize when ready |
| `proof collect <change>` | Low-level collection for diagnosis or an explicit integration |
| `proof run <change>` | Low-level atomic run when no resumable external handoff is needed |
| `handoff record <change> --id <H00n> …` | Record a named operator's accepted/completed/rejected result and durable references |

## Evidence wiring

| Command | Purpose |
|---|---|
| `evidence detect <change>` | Detect safe project-owned provider candidates without executing them |
| `evidence init <change> [--write]` | Preview, or explicitly write, high-confidence provider wiring |
| `evidence doctor <change>` | Explain configured, detectable, and unresolved wiring |
| `evidence verify-ci <change> <provider> <signed.json>` | Verify signed CI provenance bound to the provider workspace |

## External authority

Review and acceptance, resumable across sessions. Prefer `proof advance`; use
these directly for diagnosis or an explicit integration.

| Command | Purpose |
|---|---|
| `authority request <change> --type review\|acceptance` | Create a resumable external request |
| `authority status <change> [--request <id>] [--template]` | Inspect authority; `--template` emits the response file to fill in |
| `authority dispatch <change> …` | Reserve the exact full/delta packet when handing review to an AI or named human |
| `authority run <change> …` | Run the configured read-only ephemeral AI reviewer and record its real session |
| `authority abort <change> …` | Close an unusable request without pretending its dispatched attempt completed |
| `authority record <change> --request <id> --response <file>` | Validate a bound host response and record its evidence |
| `evidence record <change> <provider> <status> …` | Low-level integration path for externally observed evidence |

:::caution
`evidence record` is a low-level integration path, **not** the normal interactive recovery flow. It refuses a passing receipt for any provider the harness executes.
:::

## Landing

| Command | Purpose |
|---|---|
| `land archive <change>` | Apply, synchronize, audit, archive, and clean up |
| `land record <change> --repo <id> --commit <sha> --decision-ref <ref>` | Bind a child repository commit after a recorded user decision |
| `land resume <change>` | Resume an interrupted or multi-repository Land saga |

## Recovery and escape hatches

| Command | Purpose |
|---|---|
| `change abandon <change> --reason <r> --decision-ref <ref>` | Quarantine a change that cannot be proven |
| `change waive <change> --capability <c> --reason <r> --decision-ref <ref>` | Withdraw one capability's enforcement after its provider ran and failed; `--revoke` restores it |
| `budget continue <change> --reason <r> --decision-ref <ref>` | Open one policy-gated completion window |
| `agents release <change> <task> --owner <id> [--force]` | Release a lease; `--force` takes over one whose owner crashed |

Commands marked as needing a `--decision-ref` require an **explicit host-recorded user decision**. The runtime will not accept the agent's own judgement in their place.

## Administration

| Command | Purpose |
|---|---|
| `init [target-path] [--yes]` | Install or upgrade Foundation in a project |
| `help [--all]` | Canonical commands; `--all` includes compatibility routes |
| `dashboard [-up\|-status\|-down]` | Manage the optional team-presence client |
| `migrate [legacy-id] [--apply]` | Migrate corroborated legacy workflow records |

## Protocol versions

Wire-visible contracts are pinned in `.claude/harness/protocol.json`. A mixed-revision install fails immediately at load rather than partway through Land.

| Pin | v3.4.1 |
|---|---|
| runtime | 3.4.1 |
| runtime API | 25 |
| provider protocol | 8 |
| evidence schema | 1, 2 |
| packet schema | 6 |
| review protocol | 3 |
| acceptance protocol | 2 |
| attestation protocol | 1 |
| authority protocol | 2 |

:::note
Provider protocol 8 means receipts recorded by earlier versions read as `provider-version-stale` and must be re-proven. An old receipt cannot say whether it was executed or merely asserted, so it cannot be trusted to have been executed.
:::
