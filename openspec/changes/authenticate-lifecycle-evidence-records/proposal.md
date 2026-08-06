# Change: authenticate lifecycle evidence records

## Why

The workspace revision deliberately excludes `.changeloop/`, but that directory
holds the operational state and proof/review artifacts that decide whether Land
is available. The files are bounded, nofollow, and hash internally consistent;
none of those properties prove who wrote them. Repository content can fabricate
a new internally consistent record or replay an old one, then present it as
lifecycle authority.

A1 made executable approval content-bound and stored the grant outside the
repository. This change applies the same trust split to the records those
executables produce: repository-visible payloads remain inspectable, but a
record counts as authority only when its keyed authentication sidecar verifies
against a key stored in the operator's trusted configuration directory.

## What changes

- Generate a random 256-bit record-authentication key in the operator config
  directory (`0600`, nofollow, one hard link). The key is never stored under the
  project root and never serialized into a record or log.
- Every authoritative operational, proof, and review JSON record receives a
  versioned HMAC-SHA256 sidecar bound to canonical project root, record kind,
  record id, payload bytes, and an ordered binding map.
- CLI operational state is accepted as authority only with a valid sidecar.
  A legacy unsigned state is loaded conservatively with all proof/review/Land
  readiness cleared, then signed on the next write; sessions are preserved.
- App-server proof/review discovery ignores an artifact whose sidecar is absent,
  invalid, for another project, or bound to different bytes.
- Prove records the proof-provider configuration digest and approved executor
  digests. Review records the reviewer configuration and approval digests. Land
  recomputes those values and rejects stale proof/review before requesting Land
  authority.
- Key deletion intentionally invalidates all prior authority records. Recovery
  preserves content for inspection but requires re-prove/re-review.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code, persisted data, lifecycle recovery
- **Security triggers:** authentication key, untrusted repository content,
  durable authority, replay and forgery

## Non-goals

- Encrypting repository artifacts. They remain inspectable evidence; the goal is
  authenticity, not secrecy.
- Authenticating non-authoritative briefing receipts that Land renders but never
  gates on.
- A shared multi-user key or remote attestation service. This is a local-first,
  same-operator trust root.
- The two-phase crash journal for workspace mutations; a mismatched payload and
  sidecar after a crash fails closed and requires re-prove, which is safe.
