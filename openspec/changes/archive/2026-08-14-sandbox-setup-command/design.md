# Design

## Current state

- Sandbox creation lives in `.claude/harness/runtime/workflow/sandbox-runtime.mjs`:
  `createSingle` (worktree mode, ends :422) with `createCopy` as the
  lower-fidelity fallback (ends :205), and multi-repository creation writing
  per-repository runtime records around :463–470. No post-create hook or setup
  mechanism exists anywhere; creation ends with a `SANDBOX` log line.
- Copy mode excludes `node_modules` twice over: the
  `SANDBOX_COPY_EXCLUDED_DIRS` name set (`foundation.mjs:141`) and the
  gitignore-derived set from `git ls-files --others --ignored`. Worktree mode
  is a fresh checkout, so dependencies are absent there too.
- `foundationPolicy()` (`runtime-environment.mjs:54–127`) merges
  `foundation.json` permissively (`{ ...DEFAULT_POLICY, ...configured }`);
  unknown keys pass through, and range checks `fail(...)` around :110–114.
- `openspec/repositories.yaml` rows are parsed in
  `repository-topology.mjs:34–41`; unknown row fields are ignored.
- `wiring-check.mjs` statically requires every key a `create*Runtime` factory
  destructures to be supplied at its `foundation.mjs` call site.

## Decisions

- **Decision:** configure via `foundation.json` `sandbox.setupCommand` +
  optional `sandbox.setupTimeoutMs` for the root repository, and a
  `setupCommand` field on `openspec/repositories.yaml` rows for
  multi-repository topologies.
  - **Why:** both files are project-owned and already parsed by the runtime;
    the permissive policy merge accepts the new block without a protocol pin
    bump.
  - **Rejected:** a CLI flag (not persistent, would need typing every
    create); a schema under `runtime/contracts/` (that directory describes
    wire formats, not project policy).
- **Decision:** run the command with `sh -c` semantics, working directory set
  to the sandbox root (per-repository sandbox root in multi-repo), output
  captured, default timeout 600000 ms (overridable via `setupTimeoutMs`).
  - **Why:** matches how project-owned provider commands are treated; a
    default timeout prevents a hung installer from wedging `sandbox create`.
  - **Rejected:** argv-array config (setup lines like `npm ci --prefix web`
    are naturally shell strings; providers differ because they are
    fingerprinted).
- **Decision:** setup runs after `saveRuntime(state)` and before the
  `SANDBOX` log; failure records
  `workspace.setup = { command, status: "failed", exitCode }`, prints a
  warning with the tail of captured output, and keeps the sandbox. Success
  records `status: "ok"`.
  - **Why:** the workspace record already exists if setup fails, so state
    stays consistent; destroying the sandbox on a flaky network install would
    throw away a correct workspace. The warning names the command and path so
    the fix is one manual run.
  - **Rejected:** hard-failing creation (worse recovery); silent failure
    (reproduces the original incident one step later at proof time).
- **Decision:** no security classification.
  - **Why:** the command source is project-owned config, the identical trust
    domain as `execution.yaml` provider commands the harness already executes
    in the workspace; no new boundary is crossed.

## Compatibility and migration

Additive and opt-in. Absent configuration leaves behavior byte-identical.
Existing `foundation.json` files remain valid; no evidence, packet, or proof
wire format changes, so no `protocol.json` pin moves. Rollback is removing the
config key.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Setup failure leaves ambiguous workspace state | Outcome recorded on the workspace record; sandbox retained; warning names command and path | test |
| Factory param added without composition-root wiring | `wiring-check.mjs` static contract fails the suite | test |
| Config typos accepted silently | Type validation in `foundationPolicy()` fails with the field name | test |
| Hung installer wedges creation | Default 600s timeout, overridable | test |
