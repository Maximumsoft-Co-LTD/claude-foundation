# Tool schema stability and compatibility review

Date: 2026-08-05  
Scope: built-in agent tools, provider serialization, paused-operation resume,
and the versioned core file-tool family.

## Result

The runtime is safe against silent schema drift during a paused operation. The
built-in contract reports version `1.0` with **experimental** maturity. The
read/write/apply/delete/rename boundary now also has generated version-1 Rust
and TypeScript request/result contracts, but the full built-in surface is not
yet a stable generated public contract.

## Verified controls

- The effective ordered tool definitions, AUTO classifier version, and runtime
  permission policy are serialized into `tool_schema_sha256`, together with the
  explicit built-in contract version and maturity.
- Status exposes `toolContract.version` and `toolContract.maturity` so a client
  does not have to infer compatibility from an opaque hash.
- Resume requires the exact recorded binding, so adding `delete_file`, changing
  a schema, or changing permission policy cannot silently resume an older tool
  call with different authority.
- Provider adapters construct Anthropic and OpenAI tool payloads explicitly;
  internal metadata is not accidentally forwarded to provider APIs.
- Mutability and permission mapping are runtime-owned. Model arguments cannot
  turn a read tool into a write tool or grant lifecycle authority.
- `delete_file` and `rename_file` require SHA-256 preconditions at runtime even
  if a provider does not enforce its advertised JSON Schema.
- Canonical v1 decoders for read/write/apply/delete/rename reject unknown fields, unsupported
  versions, unsafe or oversized paths, invalid hashes, oversized payloads, and
  unbounded formatter/proof-impact lists before application dispatch.
- Generated TypeScript request/result types pin the schema version to the
  literal `1`, with compatibility fixtures covering the published field names.
- App dispatch decodes all five file tools through the canonical bounded v1 decoder
  before acquiring a mutation lease. Provider schemas require
  `schema_version: 1`, and typed results emit `schemaVersion: 1`.
- Legacy (missing-version), future-version, unknown-field, and oversized
  mutation requests are rejected without changing the workspace.
- Shell/test and owned-job tools now form a separate generated v1 process
  family. It accepts executable+argv only, binds sandbox/timeout/output limits,
  bounds environment/stdin/job IDs, and removes local artifact paths from typed
  results.
- YOLO/allow conversations remain unable to invoke Shell/Test permissions;
  confirmed changes retain PTY stdin, cancellation, and terminal-status flows.

## Compatibility findings

| Priority | Finding | Impact | Required remediation |
| --- | --- | --- | --- |
| Medium | `ToolDefinition` has no immutable ID or per-tool maturity. | The built-in surface has a global version/maturity, but extensions and individual promotions cannot be negotiated independently. | Add immutable IDs and maturity metadata to the schema source, generated clients, doctor output, and compatibility errors. |
| High | Tool results outside the core file and process/job families remain ad-hoc JSON values. | A renamed field in the remaining families can break TUI/SDK consumers without a useful compatibility error. | Extend the versioned request/result pattern and canonical decoder routing to remaining bounded tool families. |
| Medium | Most non-file input schemas permit unknown properties and omit bounded string lengths. | Provider-side strictness differs; misspelled or oversized arguments may reach runtime validation inconsistently. | Apply the strict file-tool pattern (`additionalProperties: false`, bounded fields, identical runtime checks) to each remaining tool family. |
| Medium | Paths are JSON strings, so public tools cannot address non-UTF-8 Unix names. | Internal dirfd mutations work with `OsStr`, but headless/provider calls cannot represent every repository path. | Document the limitation for MVP; later add an encoded path type only through a major/version-negotiated contract. |
| Medium | Schema hashes include definition ordering. | An order-only refactor invalidates paused calls although semantics are unchanged. This is safe but noisy. | Canonicalize built-in definitions by stable tool ID before hashing, while preserving provider display order separately. |
| Low | Tool names are the only stable identifiers. | Renaming a display/API name is necessarily breaking. | Add immutable tool IDs and keep deprecated name aliases for the documented window. |

## Rename/delete compatibility evidence

- macOS case-only rename uses same-inode detection and preserves content.
- A destination created after preflight is rejected atomically with
  `RENAME_EXCL` on macOS or `renameat2(RENAME_NOREPLACE)` on Linux.
- Source, destination, and formatter-created paths share one snapshot and proof
  invalidation ledger.
- Undo refuses overlapping external destination edits and preserves them.
- Nested destination parents are scoped below the project and unrelated sibling
  files remain unchanged.
- Descriptor-relative operations support non-UTF-8 names on filesystems that
  accept them; APFS can reject invalid byte sequences before Changeloop sees
  the path.
- Dirty Git worktrees retain unrelated indexed and working-tree edits.

## Recommended gate

Do not promote built-in tools beyond their current `experimental` label until
all tools have versioned typed requests/results, generated client coverage,
strict bounded schemas, compatibility fixtures, and a documented
deprecation/alias test. Core file tools now provide the first bounded generated
and runtime-adopted family. The current resume binding is a
strong safety gate and should remain even after explicit version negotiation is
added.
