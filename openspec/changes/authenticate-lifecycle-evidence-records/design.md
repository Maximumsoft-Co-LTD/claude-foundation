# Design

## Current state

- CLI `operational.json` contains `ChangeRecord.convergence`, proof receipts,
  review readiness and Land readiness. `load_state` accepts any bounded JSON
  with the right shape. The workspace hash excludes `.changeloop/`, so editing
  this file does not stale itself.
- CLI proof/review writes additional JSON artifacts, but Land's actual gate is
  the operational convergence state. The receipt briefing at
  `.changeloop/receipts` is rendered only; it does not gate.
- App-server restart discovery scans `.changeloop/proofs/*.json` and
  `.changeloop/reviews/*/{agreement,evidence,result}.json` and infers recoverable
  proof/review state from their contents. It checks regular-file/nofollow bounds
  and workspace revision, but not authorship.
- A1's trusted executor approval store already provides a durable operator
  config directory and content-bound executor digests.

## Decisions

- **Decision:** HMAC-SHA256 over a canonical binary framing of project root,
  record kind, record id, payload digest and ordered bindings.
  - **Why:** the question is local authorship under one operator key, not public
    verifiability. HMAC has the correct trust model and smaller key-management
    surface than public-key signatures.
  - **Rejected:** plain SHA256 (detects accidents, not forgery); Ed25519 (adds a
    public-key lifecycle where no independent verifier exists).

- **Decision:** implement the primitive in `changeloop-evidence` with its own
  `authenticated_record` module; use `sha2` (HMAC-SHA256 inline per RFC 2104),
  `getrandom`, and `zeroize`.
  - **Why:** evidence contracts own record authenticity. `changeloop-ops` owns
    executable approvals, not evidence semantics. Inline HMAC keeps the
    dependency surface to crates already used for digests.

- **Decision:** store payload and authentication sidecar separately, writing
  payload first and sidecar second. A mismatch or missing sidecar fails closed.
  - **Why:** existing artifact readers and human inspection remain compatible.
    A crash between writes produces a visible but unauthoritative record — safe
    degradation, not false readiness.
  - **Rejected:** envelope every JSON payload, which would break every current
    consumer and make records harder to inspect.

- **Decision:** the authentication key lives at
  `<operator-config>/record-auth-key-v1`, mode `0600`, opened nofollow, one hard
  link. It is created from OS entropy on first authoritative write; verification
  never creates a missing key.
  - **Why:** reading a forged repository must not mint a key and retroactively
    trust it. Creation is an explicit write-side event.

- **Decision:** legacy unsigned operational state preserves sessions and change
  intent, but clears proof, review, convergence and Land readiness before being
  returned. It is signed on the next save.
  - **Why:** destroying conversation/change history is unnecessary; preserving
    authority would be unsafe. This is the conservative migration.

- **Decision:** freshness binds executor approval digests and source config
  digests, not only workspace revision.
  - **Why:** workspace revision excludes `.changeloop`, where those configs live.
    A1 made authorization sensitive to them; proof/review freshness must be too.

## Compatibility and migration

First run after upgrade treats existing unsigned proof/review records as
historical content only. Existing sessions and change intent remain; fresh
Prove/Review is required before Land. The next operational save creates the
operator key if absent and writes a sidecar.

Deleting the key is equivalent to resetting local authority. Nothing is deleted;
all authenticated records become unverifiable and require fresh evidence.

Unknown sidecar/key versions fail closed.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Repository reads key through a path trick | key is outside root, nofollow, regular, one link, `0600` | test |
| Repository copies a valid record between projects | canonical root is inside MAC input | test |
| Old valid evidence is replayed after config changes | source config and executor approval digests are freshness bindings | test |
| Crash leaves payload without sidecar | readers refuse it; next prove regenerates | test |
| Legacy migration loses user history | clear authority fields only; preserve sessions/change intent | test |
| Key loss permanently destroys evidence | content remains inspectable; re-prove/re-review restores authority | test |
