# ADR 0003: Stage the Rust rewrite behind a compatibility oracle

- Status: Accepted
- Date: 2026-08-04
- Milestone: M0

## Context

Foundation is a project-installed Node runtime with mature lifecycle, evidence,
authority, and Land behavior. Replacing it in one cutover would make it hard to
distinguish intentional contract changes from regressions. The repository
currently declares runtime API `13` in `.claude/harness/protocol.json`, and
`cli.sh` requires API 13 for writes. The roadmap also requires fixtures for
runtime API 12, the immediately preceding compatibility baseline.

## Decision

Implement a full Rust replacement in stages, with the Node runtime serving as a
language-neutral behavioral oracle until parity is demonstrated.

- Capture immutable request/result/state fixtures for both runtime API 12 and
  the observed API 13 baseline. API 12 fixtures are historical compatibility
  fixtures; documentation and tests must not describe API 12 as the current
  checkout API.
- Normalize nondeterministic fields (timestamps, temporary roots, process IDs,
  random IDs) before comparing Node and Rust executions.
- Compare exit code, stdout/stderr contract, filesystem mutations, audit events,
  evidence validity, lifecycle state, and recovery behavior.
- Every approved difference is named, reviewed, versioned, and recorded beside
  the fixture. An allowlist cannot use broad output or path wildcards.
- Run both implementations against copied fixtures and disposable repositories;
  never point differential tests at active user state.
- Roll out Rust as opt-in, then read-default, then all-operation default. Keep a
  Node fallback for one minor release, but never fall back after a mutating side
  effect or committed partial response.
- Preserve the `claude-foundation` executable alias and legacy environment
  variables for at least one major compatibility period.

## Consequences

Parity is measurable and the highest-risk invariants have an executable oracle.
Maintaining two runtimes and fixture normalization costs time, and new behavior
must declare whether Node parity applies. The oracle is evidence of compatibility,
not a reason to reproduce a known vulnerability; security fixes require an
explicit approved difference.

## Rejected alternatives

- Big-bang replacement: failures would lack a trustworthy comparison point.
- Source-level translation: implementation similarity does not prove behavioral
  compatibility.
- Permanent dual runtimes: it doubles the security and maintenance surface.

