# Design

## Current state

- `cli.sh host instruction` routes directly to a package-owned Node module and
  works without project discovery.
- `host-instruction.mjs` reads only allow-listed command files and `VERSION`;
  treating `AGENT.md` as a command would conflate two contracts.
- `.claude/harness/AGENT.md` is a managed shipped file and is the canonical
  portable agent contract.

## Decisions

- **Decision:** Add the sibling resource endpoint `host agent-contract`.
  - **Why:** It keeps the resource name and response shape distinct while
    retaining the same package-owned, project-independent host boundary.
  - **Rejected:** Adding `agent` to `host instruction`; it is not a workflow
    command and has no arguments, description, or argument mode.
- **Decision:** Protocol 1 returns `{ protocol, contract, foundationVersion }`
  and preserves the UTF-8 contract text read from the installed package.
  - **Why:** Consumers need the canonical prompt plus enough version metadata
    to diagnose compatibility without parsing prose.
  - **Rejected:** Returning a filesystem path, which would leak package layout
    and force clients to perform their own unbounded file I/O.
- **Decision:** Use a dedicated `agentContractProtocol` pin and schema.
  - **Why:** The new resource can evolve additively without changing existing
    host-instruction clients.
  - **Rejected:** Bumping host instruction protocol 1 despite making no
    breaking or additive change to that response.

## Compatibility and migration

The endpoint is additive. Existing clients and `host instruction` remain
unchanged. New clients must fail closed when the endpoint is unavailable or
returns an unsupported/malformed protocol response. Rollback removes only the
new route, module, schema, metadata, docs, and pin; no persisted data exists.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A packaged CLI omits `AGENT.md` or resolves the wrong root | Exercise a Homebrew-style libexec fixture containing only shipped dependencies | test |
| Response drift breaks host consumers | Publish a JSON schema and assert required fields plus additive compatibility | test |
| Existing instruction clients regress | Run the existing host-instruction suite and installer smoke unchanged | compatibility |
