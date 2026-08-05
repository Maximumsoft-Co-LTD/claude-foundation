# Migration and install-path inventory

Status: M0 baseline

Last updated: 2026-08-04

This inventory defines ownership and migration rules from `claude-foundation`
to `changeloop-cli`. It is a contract for `cloop migrate`, installers, and the
staged Rust cutover; it does not itself authorize deletion of legacy data.

## Observed Foundation baseline

The 2026-08-04 checkout has:

- executable `claude-foundation`, routed by `cli.sh`;
- project-owned Node runtime `.claude/harness/foundation.mjs`;
- runtime API 13 in both `cli.sh` and `.claude/harness/protocol.json`;
- configuration `foundation.json`, `openspec/config.yaml`, and
  `openspec/repositories.yaml`;
- machine state under `.foundation/`;
- installer ownership in `.foundation/install-manifest.txt`;
- preserved legacy provenance under `.workflow/`;
- Homebrew payload under the formula's `libexec`, with a wrapper in `bin`.

Runtime API 12 fixtures remain required as a historical replay corpus. API 13
is the current observed source baseline and must also be captured before the
Node implementation changes.

## Target locations and ownership

| Location | Owner | Migration behavior |
| --- | --- | --- |
| `changeloop.json` | Project/user | Create from supported `foundation.json` fields; never overwrite custom values without a reported conflict |
| `.changeloop/` | Harness | Stage converted state transactionally; do not copy caches or live process identifiers |
| `openspec/` | Project + schema-managed portions | Preserve project intent and changes; update only versioned schema-owned files |
| `AGENTS.md` | Project with managed block | Replace or append only the marker-delimited managed block |
| `foundation.json` | Legacy project/user | Read for one major compatibility period; preserve after migration unless the user separately removes it |
| `.foundation/` | Legacy harness | Read receipts/evidence/state; retain as recoverable source until migration validation and retention expiry |
| `.workflow/` | Legacy provenance | Preserve read-only; never make it an active control plane or delete it automatically |
| platform config directory `changeloop/` | User | User config, provider profile metadata, policy, and install/update channel; secrets belong in the OS credential store |
| platform data directory `changeloop/` | Harness/user | SQLite, sessions, content-addressed artifacts, update metadata, and local audit/metrics |
| platform runtime directory `changeloop/` | Harness | Socket, process lock, transient auth material, and PID metadata; safe to recreate after validated stale-owner recovery |

The user configuration directory contains `config.json` and the redacted
`auth-profiles.json` registry. Provider secrets are retrieved from the operating
system credential store; environment API keys take explicit precedence for
ephemeral automation. `CHANGELOOP_CONFIG_HOME` is the supported isolated-test
and managed-install override.

Platform directories use the Rust platform-directory library's resolved paths,
not string concatenation. Expected families are XDG config/data/runtime paths on
Linux and the corresponding Application Support/cache/runtime locations on
macOS. `cloop doctor` and `cloop privacy inspect` must print the exact resolved
paths. Tests override roots with dedicated Changeloop test variables and never
reuse `HOME`.

Repository-local `.changeloop/` holds state that must follow the worktree or is
needed for repository-local recovery. User-level data holds cross-project
sessions and indices. Each record stores its canonical repository and worktree
identity; moving a repository requires explicit re-association, not path-only
trust.

## Existing Foundation path classification

### Installer-managed and replaceable

The existing install manifest covers shipped `.claude` orchestration, commands,
harness, skills, rules and hooks; `openspec/schemas`; `.foundation/.gitignore`;
`.foundation/README.md`; and `WORKFLOW.md`. Changeloop may supersede these only
when the exact path is recorded as installer-owned. Unknown files below the same
directories remain user-owned.

### Project-owned and merge-only

`CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `foundation.json`,
`openspec/config.yaml`, and `openspec/repositories.yaml` are merge-only. Managed
blocks or known schema fields may change; unrelated content and unknown fields
are retained. A failed merge is a surfaced conflict.

### Machine-owned but evidentiary

`.foundation/receipts/`, `evidence/`, `snapshots/`, `attestations/`, `authority/`,
`transactions/`, and recovery journals may be required to explain or validate a
past Land. They are imported with source path, original schema/API version,
content hash, and migration operation ID. Invalid or unknown records are
quarantined, not rewritten as valid evidence.

Logs, plans, runtime handoffs, leases, sandboxes, repository worktrees, caches,
PTY metadata, and process IDs are normally non-portable. The dry run identifies
them; apply cancels or verifies inactive resources and imports only data with a
defined target schema. A live lease never becomes authority in the new runtime.

## Environment-variable compatibility

For one major release, accept documented legacy `CLAUDE_FOUNDATION_*` and
`FOUNDATION_*` inputs at the lowest configuration precedence. Emit a once-per-
process deprecation event naming the replacement, without logging the value.
Changeloop-native CLI flags, managed policy, project config, and `CHANGELOOP_*`
variables win according to the source-aware config contract. Test-only legacy
variables are enabled only in test builds or explicit fixture processes.

Unknown legacy variables are ignored and reported by `config explain`; they do
not become provider environment pass-through automatically.

## Install-method detection

Record the installation source at install/update time:

- Homebrew: receipt/formula metadata and resolved Cellar prefix;
- signed standalone archive or installer: signed install receipt and channel;
- Cargo/source development build: executable metadata without self-update;
- legacy Foundation/Homebrew install: detected executable plus project manifest.

Detection is evidence, not permission. `cloop update` delegates to Homebrew when
Homebrew owns the executable, performs verified replacement only for a signed
standalone install, and gives manual instructions for Cargo/source builds. It
never writes through a symlink before resolving and validating the owned target.
Keep `claude-foundation` as an alias for at least one major release; the alias
reports the Changeloop version and forwards arguments without changing policy.

## Transactional migration protocol

`cloop migrate --dry-run` is read-only and reports:

1. detected install method, executable, project root, worktree identity, runtime
   API/schema versions, and resolved user directories;
2. every create, merge, import, quarantine, preserve, skip, conflict, and
   deprecated input;
3. byte counts and content hashes for evidence-bearing sources;
4. processes, leases, transactions, or external edits that block apply;
5. required free space and the recovery/backup location.

`cloop migrate --apply` requires the dry-run plan digest or recomputes and shows
changes. It then:

1. obtains the project migration lock and checks the expected workspace
   revision;
2. writes an operation journal and copies inputs to a recoverable backup;
3. stages config/state in temporary paths on the destination filesystem;
4. validates schemas, evidence hashes, database migrations, ownership, and
   permissions;
5. atomically promotes staged data and records a completion event;
6. leaves `foundation.json`, `.foundation/`, and `.workflow/` preserved;
7. on interruption, resumes from the journal or rolls back promoted paths.

Apply is idempotent by migration operation ID. Re-running a completed operation
verifies its outputs. A source change after planning invalidates the plan rather
than being silently included. Cleanup is a separate, explicit command introduced
only after retention and evidence-reference rules are implemented.

## Field and artifact rules

- Preserve unknown `foundation.json` fields in a namespaced legacy section and
  report them; do not guess semantics.
- Convert `execution.maxParallelAgents`, scoped packet/token budgets, lease
  duration, model tiers, and escalation triggers only through versioned field
  mappings with validation.
- Redact secrets before persistence. Configuration values that look like
  credentials become unresolved secret references and require user repair.
- Imported receipts retain original bytes plus a normalized index. They are not
  considered fresh proof until the Rust verifier validates their original
  protocol and current workspace binding.
- Never import absolute sandbox/worktree paths as active workspaces, process IDs
  as live processes, or expired leases as permissions.
- Preserve timestamps together with their source clock and parsing status;
  migration time is a separate field.

## Acceptance tests

Cover clean and dirty worktrees, missing `jq`, API 12 and API 13 sources,
partially upgraded installs, custom managed blocks, unknown config fields,
symlinks, case-sensitive collisions, interrupted apply at every journal step,
insufficient disk, read-only destinations, corrupt evidence, active leases,
Homebrew and standalone ownership, repeat apply, rollback, and preservation of
unrelated files under `.claude/`, `.foundation/`, and `.workflow/`.
