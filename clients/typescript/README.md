# Changeloop TypeScript SDK

`src/index.ts` provides typed RPC and authenticated HTTP+SSE clients. It uses
the protocol types in `generated/`, which are emitted from the canonical Rust
protocol source by `ts-rs`. Do not edit generated files by hand.

The generated protocol and TypeScript SDK are currently **beta**; the CLI is
**experimental**. Consumers can inspect `INTERFACE_MATURITY` instead of
inferring stability from the package version.

```ts
import { ChangeloopClient } from "@changeloop/sdk";

const client = new ChangeloopClient({
  baseUrl: "http://127.0.0.1:3210",
  token: process.env.CHANGELOOP_SERVER_TOKEN!,
  origin: "http://localhost",
});

await client.status();
for await (const frame of client.events("session-id", { signal })) {
  // Persist event cursors; reconnect is exclusive of the last cursor.
}
```

The client requires a `beta` server by default, validates the protocol and
maturity headers on every RPC/SSE response, and reconnects with the last
exclusive event cursor. Exact boundary replays are suppressed. Set
`minimumMaturity: "stable"` to reject this Beta HTTP+SSE surface. Use
`cancelOperation(operationId)` or `steerOperation(operationId, message)` for
operation-scoped control; `cancel()` remains the explicit process-wide action.

Tokens are retained in a private field. Endpoint/origin/control-character,
response-size, SSE frame-size, sequence, session, and protocol checks fail
closed before a frame reaches application code.

The SDK also exports generated v1 contracts for `ReadFile`, `WriteFile`,
`ApplyPatch`, `DeleteFile`, and `RenameFile` requests/results. Their
`schema_version`/`schemaVersion` field is the literal
`MUTATION_TOOL_SCHEMA_VERSION` (`1`). The canonical Rust decoder rejects
unknown fields, unsafe or oversized paths, invalid hashes, unsupported
versions, oversized JSON/content payloads, inconsistent content/artifact
outcomes, and unbounded formatter/checker/proof-impact lists.

`WriteFileResult` and `ApplyPatchResult` carry a `checker` verdict describing
the format-then-check gate that ran inside the write. `status` is
`not_configured` when the file's language configures no formatter and no
checker, and `checked` otherwise, with one `runs` entry per command. Only a
verdict whose runs all report `passed` is a clean write; `failed`, `timed_out`,
`cancelled`, and `unavailable` all mean the mutation landed unverified. The
field is additive — a payload from a server that predates it decodes as
`not_configured` rather than as a passing check.

The same pinned version is exported for `ProcessTool`, `SpawnJob`,
`JobStatus`, `JobStdin`, and `JobCancel` contracts. Process requests accept a
single executable plus an argument vector (never a shell command string), and
explicitly bind sandbox, timeout, output, environment, stdin, and identifier
bounds. Process artifacts expose content identity, not local filesystem paths.

Run `npm test` in this directory to typecheck and exercise the SDK against a
real local `cloop serve --http` process.
