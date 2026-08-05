# ADR 0002: Local-first app server with one protocol schema

- Status: Accepted
- Date: 2026-08-04
- Milestone: M0

## Context

Changeloop needs a headless CLI, TUI, reusable local service, and later SDK/IDE
clients. These clients must observe identical lifecycle and event semantics.
Project resources such as watchers, LSP servers, PTYs, provider requests, and
SQLite connections also need a single owner so that two clients do not create
conflicting mutations or leak processes.

## Decision

Run the harness as a local-first app server and define its public contract from
one versioned schema source.

- Generate Rust and TypeScript protocol types and clients from that schema.
- Use stdio for owned TUI/headless processes, a Unix socket for a reusable local
  service, and HTTP+SSE only for the Beta SDK/IDE surface.
- Negotiate protocol version and maturity (`experimental`, `beta`, `stable`)
  before accepting commands. Unknown required message parts fail negotiation;
  negotiated optional parts may be retained as opaque data.
- Give events ordered IDs and stable replay cursors. Reconnect uses cursor
  replay, heartbeats, bounded queues, and explicit backpressure errors.
- Permit one app-server leader per data directory using a process lock and
  SQLite WAL. A second server connects to the leader or exits with recovery
  guidance; it never creates an independent writer.
- Require local authentication and strict origin checks for non-stdio
  transports. Listening on a non-loopback interface is not an MVP behavior.
- Scope resources to a repository/worktree project instance. Disposal cancels
  children and provider calls, rejects pending requests, flushes state, and
  releases processes without affecting another instance.

## Consequences

Transport clients stay thin, reconnect is testable, and protocol changes cannot
silently diverge across languages. Server ownership adds startup, locking, and
recovery complexity. Generated artifacts must be checked for schema drift in
CI, and event retention must preserve cursors referenced by active sessions.

## Rejected alternatives

- Separate CLI and TUI cores: lifecycle behavior and migrations would diverge.
- Hand-maintained Rust and TypeScript types: compatibility failures would be
  discovered late.
- Cloud-first state: it conflicts with local-only telemetry and offline
  repository operation.

