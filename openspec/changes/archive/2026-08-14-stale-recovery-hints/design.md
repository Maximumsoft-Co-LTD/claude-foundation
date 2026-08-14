# Design

## Current state

- `landCheck` refuses with `proof is stale (<hash> != <hash>)`
  (`land-runtime.mjs:164`) and nothing more; the Hydra round hit the
  edit→prove→edit loop four times in eight minutes.
- `authority record` refuses with `authority request '<id>' is stale`
  (`authority-runtime.mjs:227`); the same round re-issued its attestations
  wholesale after every workspace move.
- The `/prove` and `/land` command files sit at their context-budget word
  limits (165/170 and 137/140), so ordering guidance cannot live there.

## Decisions

- **Decision:** extend both refusal strings in place with one recovery
  sentence each, naming the command to run (`proof run` re-prove; `authority
  request` re-request) and the ordering rule (content first, prove once,
  attest last).
  - **Why:** the hint reaches exactly the person who hit the refusal at
    exactly that moment, costs no instruction budget, and changes no
    behavior.
  - **Rejected:** aggregating `landCheck`'s fail-fast checks (invasive,
    dependent checks make most aggregations vacuous); instruction-file edits
    (budgets at capacity).
- **Decision:** regression as a CLI-driving `node:test` suite (established
  pattern): a proven fixture whose sandbox is edited after Prove asserts the
  stale-proof hint; a fixture whose sandbox is edited after
  `authority request` asserts the stale-request hint.

## Compatibility and migration

Message-text extension only; no formats, pins, or exit codes change. The
messages' existing prefixes (`proof is stale (`,
`authority request '<id>' is stale`) are preserved so anything matching on
them keeps matching.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Existing tests match the full message | prefixes preserved; full suite run | test |
