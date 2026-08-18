# Change: Expose the package-owned Foundation agent contract through a versioned machine-readable host API for clients such as Changeloop

## Why

Host applications can resolve Foundation command instructions from the installed
release, but they cannot obtain the package-owned agent contract that explains
the harness lifecycle and authority boundaries. Clients such as Changeloop must
either duplicate that contract or read a project path, both of which can drift
from the installed Foundation release.

## What changes

- Add a read-only `host agent-contract` endpoint that returns the installed
  `.claude/harness/AGENT.md` through protocol-1 JSON without project discovery.
- Publish a response schema, stable failure codes, CLI help metadata, and a
  dedicated protocol pin.
- Preserve the existing `host instruction` protocol and command behavior.
- Cover source and packaged layouts, project independence, failures, and
  backward compatibility with deterministic tests and public workflow docs.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** public CLI host API, shipped runtime, schema, docs, tests
- **Security triggers:** bounded package-owned file read and JSON output

## Non-goals

- Changing the contents of `AGENT.md`.
- Reading a consumer project's `.claude/harness/AGENT.md`.
- Changing or version-bumping the existing host-instruction protocol.
