# Executable extensions (experimental)

Changeloop only executes project-local extensions that explicitly declare the
`stdio-v1` runtime. Merely placing JavaScript, a skill, or another file under
`.changeloop/` never makes it executable.

```json
{
  "id": "example-check",
  "kind": "extension",
  "entry": "check.sh",
  "contract_version": 1,
  "runtime": "stdio-v1",
  "timeout_ms": 5000
}
```

The manifest lives at
`.changeloop/extensions/<name>/manifest.json` (or under
`.changeloop/skills/`). The manifest and canonical entry must remain inside
the repository. The entry must already exist and be executable; Changeloop
does not download runtimes or dependencies.

## `stdio-v1` contract

The executable receives one JSON value on standard input and emits one JSON
value on standard output. Its environment is cleared of ambient credentials.
Execution requires the platform sandbox, denies network and home/credential
paths, and does not expose repository files other than the executable itself;
required content must be supplied in the bounded input. Output is capped at
1 MiB, stderr is sanitized and capped at 16 KiB, and timeout cancellation
terminates the owned process group, including descendants. If no supported
platform sandbox is available, execution remains disabled.

Input is an envelope with schema `dev.changeloop.extension-input`, version `1`,
untrusted provenance, immutable denied-authority flags, and an `input` field.
Supported responses are:

```json
{"type":"finding","finding":"description"}
{"type":"data","data":{"key":"value"}}
```

Responses requesting `land`, `expand-scope`, `grant-permission`, or
`change-policy` disable the handler and fail the call. Extension output is
always returned as untrusted `mcp-content`; it is not proof and cannot advance
the lifecycle.

Inspect loader health with `cloop mcp extensions`. Explicitly invoke a handler
with `cloop mcp extensions run <id> [json]`. This interface is experimental and
may change before GA.

## Skill and hook semantics

Contract version `1` distinguishes three kinds:

- `skill` is explicitly invoked by a user or agent tool call and never runs
  from lifecycle events;
- `hook` must declare one or more `hook_events` subscriptions (`before-tool`,
  `after-tool`, `before-prove`, `after-prove`, `before-review`, or
  `after-review`);
- `extension` is a generic explicitly invoked handler.

Hook dispatch is ordered by handler ID. A timeout, crash, invalid output, or
forbidden authority request marks only that handler unhealthy and is returned
as a typed invocation error; remaining hooks still run. Hook output remains
untrusted `mcp-content`, cannot veto or advance lifecycle state, and cannot
grant permission, expand scope, change policy, or Land. Unsupported contract
versions and hook manifests without subscriptions fail discovery instead of
falling back to generic extension behavior.

Automatic hook execution is disabled by default and requires an explicit
trusted `CHANGELOOP_PERMISSION_MCP=allow` grant. Repository manifests cannot
grant that permission; `ask`, `auto`, and YOLO do not enable hooks, and a
policy deny always wins. In contract version 1 all hook failures are advisory:
they are recorded in bounded, redacted `hooks.json` audit artifacts, but cannot
skip, satisfy, weaken, or block required proof/review. A future blocking hook
mode would have to be owned by trusted policy and versioned separately; it
cannot be requested by a repository hook.
