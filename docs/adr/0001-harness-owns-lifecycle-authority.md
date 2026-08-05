# ADR 0001: The harness owns lifecycle authority

- Status: Accepted
- Date: 2026-08-04
- Milestone: M0

## Context

Changeloop coordinates models, child agents, tools, proof providers, reviewers,
and repository operations through `Investigate? -> Change -> Build -> Prove ->
Land`. Model output is probabilistic and may contain instructions copied from
untrusted repository, web, MCP, or tool content. Treating an agent's narrative
as lifecycle state would let that content weaken permissions, skip proof, or
authorize a write.

The existing Foundation runtime already separates change state, evidence,
authority records, and Land journals. The Rust rewrite must preserve those
invariants while adding conversations, native providers, subagents, and more
transports.

## Decision

The deterministic harness is the sole authority for lifecycle transitions,
permission decisions, evidence freshness, review gates, and Land.

- Conversation sessions are read-only. Implementation intent creates a draft;
  only explicit confirmation or `cloop run` creates an authorized change.
- Every transition is evaluated from persisted state, policy, repository
  revision, and typed evidence. Free-form model text is never a transition.
- Models and child sessions may propose actions and return typed results, but
  cannot grant permissions, expand scope, lower risk, Land, or change policy.
- AUTO is a versioned deterministic classifier. YOLO suppresses eligible
  per-tool prompts but cannot bypass policy denies, scope, secret protection,
  change confirmation, proof, review, or Land authority.
- Land is explicit and obtains an exclusive project transaction lock.
- Interrupted or failed operations receive terminal events; a budget timeout
  never converts missing evidence into success.

Lifecycle state changes are append-only audit events plus materialized state.
The event records include actor, authority source, operation ID, expected
workspace revision, and the evidence or approval used by the transition.

## Consequences

The same lifecycle behavior can be tested without a model, and hostile content
cannot directly obtain authority. All UI, CLI, SDK, and transport surfaces must
call the same transition APIs. More explicit approvals and state records are
required, and agent loops must pause when authority is missing instead of
guessing user intent.

## Rejected alternatives

- Prompt-only lifecycle rules: untrusted content and provider variation make
  them non-deterministic.
- Agent-declared proof completion: narrative completion is not executable
  evidence.
- Mode-specific lifecycle implementations: they would allow assurance drift
  between headless, TUI, and SDK clients.

