# Provider replay corpus specification

Status: M0 contract

Last updated: 2026-08-05

## Purpose

The corpus is the provider boundary oracle for Anthropic Messages and OpenAI
Responses. It proves that the router preserves Changeloop's structured-message,
streaming, cancellation, accounting, and resume contracts without requiring a
live provider on every test run. It does not certify model quality and it must
not contain production prompts or credentials.

This corpus complements, rather than replaces, the deterministic Foundation
runtime oracle. The repository currently contains
`tests/oracle/runtime-api-12.json`, pinned to Foundation revision
`9a54190cafddec6546a63acbc606a86480da8b74`.
`tests/oracle/runtime-api-13.json` captures the current compatibility baseline
at revision `2e76097623e1ffdf145685dbcd59a127434cda33`; API 12 remains the
historical baseline. Provider fixtures exercise the new native provider
boundary, while runtime fixtures exercise existing harness behavior.

## Repository layout

The implementation should use the following stable layout:

```text
tests/provider-replay/
  manifest.json
  schema/
    manifest.schema.json
    exchange.schema.json
  anthropic/messages/<case>/
    request.json
    stream.jsonl
    expected.json
  openai/responses/<case>/
    request.json
    stream.jsonl
    expected.json
  shared/
    files/<sha256>
    images/<sha256>

crates/changeloop-provider-adapters/tests/fixtures/native/
  manifest.json
  anthropic-{request,success,error}.json
  openai-{request,success,error}.json
```

`request.json` contains the redacted HTTP-level request after provider-specific
translation. `stream.jsonl` contains ordered response frames or a single
non-streaming response/error frame. `expected.json` contains normalized
Changeloop parts, events, usage, retry classification, and terminal state.
Large or binary bodies are content-addressed under `shared/`; manifests include
hash, byte count, and MIME type.

The adapter-local `native/` companion is a SHA-pinned, synthetic, no-network
contract for the concrete `stream: false` HTTP path. It contains success and
error cases for both provider families and asserts outgoing roles/history,
reasoning replay metadata, tool calls/results, normalized usage, request/quota
headers, finish reasons, and error classification. It supplements the main SSE
corpus and is deliberately labelled `synthetic`; it is not live-provider proof.

## Manifest contract

The top-level manifest is canonical JSON with these required fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Replay-manifest schema version |
| `corpusVersion` | Immutable semantic version of the fixture set |
| `capturedAt` | UTC capture time, or `null` for hand-authored protocol fixtures |
| `sourceRevision` | Changeloop revision that produced the normalized expectation |
| `redactionProfile` | Versioned redaction/normalization profile |
| `pricingCatalogVersion` | Catalog used for expected estimated cost, or `null` |
| `cases` | Ordered case records |

Each case record contains a stable `id`, provider, API family, fixture kind
(`recorded`, `synthetic`, or `derived`), request/stream/expected paths and hashes,
protocol version, model capability profile, expected terminal classification,
and tags. Recorded cases also include provider API version, SDK/HTTP adapter
version, sanitized provider request ID shape, and capture provenance. Exact model
aliases are metadata, not an assumption that the model remains available.

A fixture is immutable after merge. Correcting one creates a new case revision
or corpus version; it never silently changes a historical provider behavior.

## Required case matrix

Both provider families must cover equivalent semantics even when their wire
formats differ:

| Area | Required cases |
| --- | --- |
| Roles/instructions | system and developer instructions, user/assistant history, unsupported-role transform |
| Text/reasoning | text deltas, reasoning deltas/signatures or encrypted metadata, redacted reasoning, missing reasoning metadata on resume |
| Tools | one tool, parallel tools, interleaved deltas, partial JSON arguments, empty arguments, malformed arguments, tool error, tool-result text/file/image |
| Streaming | split UTF-8 boundaries, unknown optional event, duplicate frame, out-of-order frame, clean end, truncated stream, cancellation before/after committed output |
| Limits | context overflow, maximum output, provider truncation, oversized tool result, large output artifact promotion |
| Caching | cache request metadata, cache hit/write/read usage, unsupported cache controls |
| Accounting | input/output/cache/reasoning tokens, provider-reported cost when available, estimated cost, absent/partial usage, quota/reset metadata, currency/source |
| Errors | authentication, permission, invalid request, model unavailable/deprecated, rate limit, timeout, overload, transport failure, provider-specific unknown error |
| Replay | multi-turn history, tool call/result replay, resumed reasoning metadata, compaction boundary, interrupted tool terminal result |
| Fallback | safe pre-commit fallback, refusal after committed text, refusal after mutating tool dispatch |

At least one cross-provider equivalence group exists for each row. Equivalence
means the same normalized Changeloop contract, not byte-identical provider data.
Provider-only capabilities remain explicit cases and cannot be discarded merely
to make the adapters look symmetrical.

## Capture and sanitization

Capture is an explicit developer operation against dedicated test accounts. The
capture tool writes to a temporary owner-only directory, validates the response,
then applies the versioned redaction profile before a fixture can enter the
repository.

Redaction removes authorization headers, cookies, account/project/organization
IDs, request URLs containing tenant data, raw provider request IDs, user content,
and incidental headers. Stable placeholders retain type and equality relations,
for example `req_<REQUEST_ID_1>`. Timestamps, boundaries, random IDs, and retry
jitter are normalized only when they are not contract data. Reasoning signatures
and encrypted replay metadata are treated as secrets: committed fixtures use
provider-documented test values or synthetic shape-valid values, never live
opaque blobs.

The sanitizer fails closed on unknown headers and known secret canaries. A
separate scan rejects high-entropy tokens and credentials. The raw capture is
deleted after verification unless an approved secure-retention policy applies;
it is never a CI artifact.

## Replay semantics

The replay server emits exactly the recorded frame order and supports scripted
pause, disconnect, cancellation, and backpressure points. Tests compare:

- ordered normalized events and stable part/tool-call IDs;
- partial/running/completed/error state transitions;
- provider metadata required for history replay;
- terminal cancellation and interrupted-tool results;
- retry/fallback classification and committed-side-effect boundary;
- usage completeness, catalog version, currency, and cost provenance;
- redacted persisted representation and content-addressed artifact hashes.

Unknown-part behavior is tested under an explicitly negotiated protocol version.
No test may drop an unknown required part, synthesize missing success, reorder
parallel tool calls, or replay a tool silently.

## Recorded, synthetic, and live tests

- Hermetic CI runs the full replay corpus with no network and exact normalized
  expectations.
- Synthetic fixtures cover malformed frames, rare failures, private-network
  safety interactions, and states that are unsafe or impractical to provoke.
- Scheduled live tests use dedicated accounts to detect upstream drift. They
  compare invariants and capability metadata, not nondeterministic prose.

Live drift opens a reviewable corpus update; it never rewrites fixtures or
weakens expectations automatically. Model deprecation marks a fixture historical
but does not remove its replay value. Any capture that cannot be safely redacted
is represented by a minimal synthetic fixture instead.

## Acceptance gate

M3 cannot exit until both adapters pass the shared matrix, provider-only cases
are documented, sanitized fixtures pass secret scanning, replay is deterministic
across repeated runs, cancellation leaves no active request/tool, and accounting
represents unknown or incomplete usage explicitly. A corpus change requires
provider-boundary review and a manifest-version decision.
