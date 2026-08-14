# Change: stale-recovery-hints

## Why

When the workspace moves after Prove or after an authority request, the
harness correctly refuses — but says only that the thing "is stale". A
consumer round (Hydra dashboard, 2026-08-14) paid four full proof reruns in
its final eight minutes because contract edits, commits, and attestation
requests were sequenced against the binding rules the messages never state:
finish the content first, prove once, attest last.

## What changes

- The `proof is stale` refusal at `land check` states the recovery order:
  finish contract and code edits, sync, then one fresh prove.
- The `authority request is stale` refusal states that review and acceptance
  are requested last, after the workspace stops changing, and names the
  re-request command.

## Impact

- **Impact:** low
- **Coupling:** coupled
- **Affected surfaces:** shipped runtime failure messages
  (`land-runtime.mjs`, `authority-runtime.mjs`), deterministic tests.
- **Security triggers:** none.

## Non-goals

- No change to what is considered stale or when; refusals stay refusals.
- No aggregation refactor of `land check`'s fail-fast structure.
- No instruction-file edits — the command word budgets are at capacity, and
  the hint belongs at the moment of refusal.
