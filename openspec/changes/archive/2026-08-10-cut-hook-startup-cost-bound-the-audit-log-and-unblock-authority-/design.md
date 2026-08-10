# Design

## Current state

- `.claude/settings.json` wires `.claude/hooks/phase-mutation-guard.mjs` as a
  `PreToolUse` hook on `Edit|Write|MultiEdit|NotebookEdit|Bash`.
- The guard exits 0 without recording anything when
  `FOUNDATION_GUARDRAIL_MODE=off` (line 19), when the tool is not mutating
  (lines 31-32), and — in any mode other than `block` — when no phase can be
  established (line 42).
- `recordedPhase()` scans `.foundation/logs/*/phase-context.jsonl` and honours a
  12-hour freshness window.
- `recordAudit()` appends to `.foundation/logs/guardrail-audit.jsonl` with no cap.
- `install.sh` merges hooks with a jq `upsert` that only *adds* a hook when no
  entry with the same `command` exists; it never replaces one. A separate
  `remove_legacy` step drops named retired commands before the upsert runs.
- `authority record`'s flag schema is `value: ["request", "response"]`
  (`cli-router.mjs:171`), while `recordReceipt` requires subject provenance for
  the review capability (`receipt-runtime.mjs:251`).
- `validateResponse` copies `response.evidence` verbatim into the flag object
  (`authority.mjs:75-79`), so provenance keys placed there already reach
  `recordReceipt`.

## Decisions

- **Decision:** add `phase-mutation-guard.sh` as the wired entry point; it
  answers only the cases the guard would have exited on, then `exec`s the `.mjs`.
  - **Why:** 44 of the guard's 53ms is Node startup, and the stock-install answer
    is "nothing to enforce". A shell test costs 3ms. The prefilter never decides
    a violation — it only decides whether a decision is needed.
  - **Rejected:** rewriting the guard in shell. Its path canonicalization
    resolves symlinks and non-existent suffixes; reimplementing that in `sh` would
    move a security boundary into a weaker language for no further gain.
  - **Rejected:** dropping `Bash` from the matcher. The guard's `looksMutating`
    check is exactly what makes Bash coverage meaningful.

- **Decision:** the prefilter treats *any* `phase-context.jsonl` as reason to
  delegate, without parsing it.
  - **Why:** freshness and phase validity are the guard's job. A shell test that
    parsed timestamps would duplicate policy and could disagree with it. Presence
    is a strict over-approximation: it can only cause more delegation, never less.

- **Decision:** `block` mode always delegates, before any other test.
  - **Why:** the guard fails closed in block mode even when the phase is unknown.
    A prefilter that short-circuited there would convert enforcement into silence.

- **Decision:** retire the old command through `remove_legacy` rather than
  teaching `upsert` to replace.
  - **Why:** `upsert` matches on `command`, so a changed command is a *new* hook
    to it; without retirement an upgraded project runs both guards on every
    mutating call. `remove_legacy` is the mechanism already used for exactly this.

- **Decision:** rotate the audit log by size, keeping one `.1` generation.
  - **Why:** an audit trail that deletes itself is not an audit trail, and one
    that grows forever is a defect. One generation bounds the file at 2× the cap
    while keeping recent history readable.

- **Decision:** carry review provenance in the response file, not in new
  `authority record` flags.
  - **Why:** the response file is the artifact the external responder produces,
    and `validateResponse` already forwards its `evidence` keys. Adding CLI flags
    would ask the agent to assert provenance the responder should be stating.

## Compatibility and migration

No wire-visible contract changes, so no `protocol.json` pin moves. The response
template gains fields; a response that omits them fails exactly as it does today,
now with a message naming where they belong. Projects that never upgrade keep the
`.mjs` wiring and behave as before.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Prefilter skips a case the guard would have flagged | Block mode and any recorded phase context delegate unconditionally; pinned by test | test |
| Upgrade leaves two guards wired | `remove_legacy` retires the `.mjs` command; pinned by installer test | test |
| Rotation loses audit history mid-write | Rotate before append, keep one generation, and keep failures non-fatal as today | test |
