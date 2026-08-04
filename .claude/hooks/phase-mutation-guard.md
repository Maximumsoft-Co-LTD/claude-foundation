# Phase mutation guard

`phase-mutation-guard.mjs` is a `PreToolUse` policy layer for file mutations and
obviously mutating shell commands. It is wired in `.claude/settings.json` in
audit-only mode by default.

The agent host supplies execution context:

- `FOUNDATION_ACTIVE_PHASE=change|build|prove|land`
- `FOUNDATION_WORKSPACE_ROOT=/absolute/build/workspace` during Build
- `FOUNDATION_ALLOWED_PATHS_JSON='["/absolute/extra/path"]'` for explicitly
  declared Build paths
- `FOUNDATION_LAND_TRANSACTION=1` only inside the runtime-owned Land transaction
- `FOUNDATION_GUARDRAIL_MODE=audit|block|off` (`audit` is the default)

Audit records contain policy metadata, not command text or file paths, and are
appended to `.foundation/logs/guardrail-audit.jsonl`. Move to `block` only after
the host exports phase context consistently and audit false positives have been
reviewed.

The Bash inspection is a conservative command-word screen, not a shell sandbox.
Host process isolation remains required for shell commands, network authority,
and indirect mutations.

## Bounded retry integration

`runtime/reliability/bounded-retry.mjs` is intentionally standalone. Runtime
providers may wrap only read-only/idempotent infrastructure operations and must
pass `idempotent: true`. Its default classifier retries timeouts, transient
network codes, HTTP 408/429, and HTTP 5xx; validation, security, test assertion,
and business failures are not retried. Pass `onAttempt` to project attempt
metadata into the host execution contract without recording payloads.

Mutation providers and Land transactions must never use this helper unless they
independently implement an idempotency key and recovery contract.
