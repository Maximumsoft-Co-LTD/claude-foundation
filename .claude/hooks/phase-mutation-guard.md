# Phase mutation guard

`phase-mutation-guard.mjs` is a `PreToolUse` policy layer for file mutations and
obviously mutating shell commands. Its default `auto` mode blocks whenever a
fresh Foundation phase is active and stays out of adoption-only sessions where
no lifecycle context exists.

What `.claude/settings.json` wires is `phase-mutation-guard.sh`, a prefilter that
answers the "no phase to guard" case with shell builtins alone and `exec`s the
`.mjs` whenever a decision is actually needed. On a stock install with no active
change that is the difference between ~50ms and ~4ms on every mutating tool call.
The prefilter never reports a violation and never reads the event body: `block`
mode and any recorded phase context always reach the guard, so enforcement and
freshness policy stay in one place.

The phase comes from one of two places, in this order:

1. `FOUNDATION_ACTIVE_PHASE=change|build|prove|land`, if the host exports it.
2. Otherwise the most recent row in `.foundation/logs/<change>/phase-context.jsonl`,
   which `packet <change> --phase <phase>` writes at every phase transition —
   so `/change`, `/build`, `/prove`, and `/land` establish it on a stock
   install with no host wiring at all. A row older than 12 hours is treated as
   no phase: the loop is not running.

The host may also supply:

- `FOUNDATION_WORKSPACE_ROOT=/absolute/build/workspace` during Build
- `FOUNDATION_ALLOWED_PATHS_JSON='["/absolute/extra/path"]'` for explicitly
  declared Build paths
- `FOUNDATION_GUARDRAIL_MODE=auto|audit|block|off` (`auto` is the default)

`FOUNDATION_LAND_TRANSACTION=1` is set by the runtime itself, for the duration
of the Land apply transaction and its child processes. Do not set it by hand:
it is the carve-out that distinguishes a runtime-owned projection from an agent
mutating the tree during Land.

When no phase can be established, `audit` mode records nothing — there is no
policy to check against, and a row per mutation is noise. `block` mode still
refuses, so a host that asked for enforcement gets it.

Audit records contain policy metadata, not command text or file paths, and are
appended to `.foundation/logs/guardrail-audit.jsonl`. Select explicit `audit`
only for a controlled rollout; `auto` is the normal fail-closed lifecycle mode.

The Bash inspection is a conservative command-word screen, not a shell sandbox.
During Build, an obviously mutating Bash command must begin with `cd`/`pushd`
to the exact isolated workspace. Obvious `..` escapes and output redirection to
an absolute path outside that workspace are blocked before execution. Use
structured Edit/Write operations where possible.
Formatter write modes, package-manager scripts, and shell-script runners enter
the same policy. Dynamic mutation paths using environment variables, command
substitution, backticks, or home expansion are rejected because their target
cannot be proven isolated before execution.
Host process isolation remains required for shell commands, network authority,
and indirect mutations.

## Bounded retry integration

`../harness/runtime/reliability/bounded-retry.mjs` is intentionally standalone. Runtime
providers may wrap only read-only/idempotent infrastructure operations and must
pass `idempotent: true`. Its default classifier retries timeouts, transient
network codes, HTTP 408/429, and HTTP 5xx; validation, security, test assertion,
and business failures are not retried. Pass `onAttempt` to project attempt
metadata into the host execution contract without recording payloads.

Mutation providers and Land transactions must never use this helper unless they
independently implement an idempotency key and recovery contract.
