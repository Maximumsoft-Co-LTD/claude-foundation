# Design

## Current state

The package-owned host instruction endpoint is project-independent and already
permits additive protocol-1 fields. Project packets are produced by the copied
runtime and receive their instruction provenance before final serialization.
The installed CLI and copied runtime therefore need an explicit version bridge,
while remote release state must remain transient advisory data.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| update advisory | A non-blocking comparison of installed CLI, project runtime, and latest cached stable release | update gate |
| phase boundary check | Advisory resolution at Investigate entry, Change entry, or Build preflight | continuous network check |

## Decisions

- **Decision:** Resolve advisories only at Investigate entry, Change entry, and
  Build preflight.
  - **Why:** These are the last useful decision boundaries before implementation
    and avoid noise or remote work in Prove and Land.
  - **Rejected:** Checking every command or lifecycle phase.
- **Decision:** Keep release/cache state outside deterministic instruction,
  packet, workspace, proof, and receipt identity.
  - **Why:** A newly published release must not invalidate earned evidence.
  - **Rejected:** Hashing the advisory into lifecycle artifacts.

## Compatibility and migration

Protocol 1 gains only an optional `update` field. Existing required fields and
errors remain unchanged. The user-level cache is disposable and carries no
project authority. Rolling back removes the optional field and cache consumer;
older tolerant clients continue unchanged.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Remote release lookup delays a session | Short timeout, 24-hour shared cache, stale fallback, non-blocking unknown status | test |
| Advisory changes evidence identity | Attach it after deterministic digest computation and test identical digests | test, compatibility |
| Additive JSON breaks a strict client | Preserve protocol-1 required fields and schema-test tolerant compatibility | compatibility |
