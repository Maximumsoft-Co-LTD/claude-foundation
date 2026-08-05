# Changeloop threat model

Status: M0 baseline

Last updated: 2026-08-05

## Scope and security objectives

This model covers the local `cloop` client, app server, SQLite state, project
instances, provider adapters, child agents, tools, web access, MCP/extensions,
evidence, updates, and Land. Provider infrastructure after an authorized request
and the security of user-authored repositories are outside Changeloop's direct
control, but their inputs and failures remain hostile at the boundary.

Security objectives are:

1. no mutation before explicit change authority;
2. no operation outside repository, path, network, or lifecycle scope;
3. no weakening of proof, review, or Land gates by model output or mode;
4. no secret disclosure to logs, persistence, providers, tools, or web origins
   beyond the user's explicit operation;
5. no silent overwrite of external edits and no cross-project resource leak;
6. replayable, tamper-evident provenance for material transitions;
7. safe cancellation, crash recovery, migration, update, undo, and rollback.

Availability against a malicious local administrator and confidentiality from a
provider that receives an explicitly authorized prompt are not objectives.

## Assets and principals

Protected assets include repository content and history, credentials, provider
tokens, prompts and attachments, session history, configuration and policy,
evidence receipts, snapshots, audit events, cost/quota data, and release/update
metadata.

Principals are the local user, trusted project/organization policy, client,
harness, model/provider, child agent, reviewer, tool process, web origin, MCP or
extension, and external repository editor. A process running as the same OS user
is not automatically trusted policy.

## Trust boundaries and provenance

Every context item carries one provenance label:

| Provenance | May supply facts | May request an action | May grant authority or alter policy |
| --- | --- | --- | --- |
| `trusted-policy` | Yes | Yes | Yes, within its signed/configured scope |
| `user-input` | Yes | Yes | Only through an explicit authority action |
| `repository-content` | Yes | Proposal only | No |
| `tool-output` | Yes | Proposal only | No |
| `web-content` | Yes | Proposal only | No |
| `mcp-content` | Yes | Proposal only | No |
| `model-generated` | Yes | Proposal only | No |

Crossing a boundary never upgrades provenance. Summaries and compaction retain
source IDs and labels. Only trusted policy and explicit user authority can change
permissions or lifecycle policy.

## Threats and required controls

### T1: Prompt injection and confused authority

Repository files, search results, fetched pages, MCP responses, tool output, or
model text may instruct the agent to enable YOLO, reveal a secret, broaden a
path, or declare proof complete.

Controls: typed provenance wrappers; deterministic policy evaluation outside the
model; conversation/change separation; hard YOLO boundaries; explicit Land;
schema validation of tool and child results; injection fixtures for every
untrusted source. The classifier version and complete effective permission and
network-scope policy are hashed into paused-runtime bindings, so restart or hot
reload cannot silently enable YOLO or broaden a pending operation. Repeated
non-progress always returns the `doom_loop` permission to explicit human
control, including in YOLO mode.

### T2: Tool escape and destructive mutation

A command can traverse symlinks, expand a shell expression unexpectedly, write
outside the worktree, or run with more access than displayed.

Controls: resolve and validate paths immediately before use; declare operation,
paths, network, reversibility, and sandbox capability to the permission engine;
use argument arrays where possible; apply OS sandboxing; check the expected
workspace revision for every write; snapshot around each mutating step; deny
secret paths and policy-owned files independently of YOLO. The central policy
engine also derives `change_unconfirmed` from structured operation and
lifecycle-authority inputs; callers cannot bypass change confirmation by
omitting a duplicate hard-boundary flag. Explicit unsandboxed execution is
recorded as `danger_full_access`, while missing best-effort isolation is
recorded as `unavailable`. On Unix, repository file operations are anchored to
an open project directory descriptor and traverse each component with
`openat(2)` plus `O_NOFOLLOW`; writes use a same-directory temporary file,
`fsync`, and `renameat(2)`, and repository reads reject multiply-linked regular
files. Process launch clears the ambient environment, restores a fixed trusted
executable path, rejects loader/config injection variables and direct protected
path arguments, and captures stdout/stderr through bounded readers with secret
redaction before persistence. Workspace Git diff helpers terminate option
parsing, disable external diffs and filesystem monitors, clear ambient Git
configuration, and run with bounded process-group ownership. Background-job
output mutex poisoning is recovered locally
so one failed reader cannot crash the server. Project jobs, retained output, and
PTY input are capped; PTY writes use a bounded nonblocking deadline, interrupted
pipe reads retry, and cancellation joins readers before publishing a terminal
state. Unix exit detection observes the leader with `waitid(WNOWAIT)`, terminates
the owned process group while its PID/PGID is still pinned, and only then reaps
it, preventing PID reuse from redirecting cleanup at an unrelated process.
Shell and test execution are intrinsically change-authorized operations: an
installed `allow` rule and YOLO cannot execute them from a conversation, even
when a caller reports a permissive sandbox. Confirmed Change, Prove, Review, or
Land authority is required before the configured rule is evaluated.

Persistent control-plane JSON (first-run setup, privacy state, migration
journals, operational state, and the MCP registry) is read through bounded
regular-file handles with `O_NOFOLLOW` on Unix; multiply-linked files are
rejected where they could import attacker-controlled state. Writers serialize
within the matching reader limit, stage to unique owner-only files, revalidate
the parent directory identity immediately before atomic rename, sync both the
file and containing directory, and never persist provider credentials. This
prevents predictable-stage clobbering, symlink/hardlink state substitution,
parent-swap escapes, and acknowledging state that survives only in cache.
First-run state is revalidated after deserialization before provider, model,
privacy, telemetry, or sandbox selections can become effective. Privacy-purge
journals bind the exact requested session scope, cap and deduplicate IDs,
re-check active/evidence guards on recovery, and commit/remove the journal with
a directory sync; a repository-authored journal therefore cannot expand a
single-session delete into another session. Migration rejects a symlinked state
directory before creating its lock or staging files, and its no-follow lock must
be a regular single-link file. Authentication registries revalidate their small
provider allowlist before any keyring lookup, while credential size and control
characters are rejected before keyring or registry mutation.
SQLite database opens additionally use `SQLITE_OPEN_NOFOLLOW`, canonicalize and
pin the parent identity around open/initialization, and reject non-regular,
symbolically linked, or multiply hard-linked database/WAL/SHM paths before and
after opening. The standard SQLite VFS does not expose an `openat`-style dirfd
contract, so a hostile same-user process can still race a path component in the
narrow interval between validation and SQLite's own open; post-open identity
checks detect this condition but cannot make that interval atomic without a
custom VFS.

Land treats transaction identifiers and projected paths as authority-bearing
inputs. Change/transaction IDs are bounded safe components, target and sandbox
roots cannot be symlinks, and projected files plus journals/archives must be
regular single-link files opened with `O_NOFOLLOW` on Unix. Journal restore
also verifies authority-to-plan binding, projection hash, and the exact backup
slot assigned during prepare before rollback can read it. Journal and archive
writes use bounded unique owner-only staging, parent identity revalidation,
atomic rename, and file/directory `fsync`. The exclusive Land lock and revision
checks prevent another Changeloop writer from racing the transaction; an
uncooperative same-user process can still modify a target between the final
identity comparison and rename because portable filesystems provide no atomic
"replace only if content hash still equals X" primitive. Post-write identity
verification and conservative rollback/manual recovery detect that residual
race without treating it as authority.

Structured protocol envelopes are rejected before JSON parsing above 16 MiB;
message and part IDs are bounded, non-empty, and duplicate-free, and message
session IDs must match their envelope. Known parts enforce schema, per-field
size, content-addressed artifact, and body/state invariants; completed/error
parts cannot transition to different content. Unknown part payloads are kept
opaque only after compatible minor-version negotiation and remain bounded.
Provider replay metadata required for resume/compaction is preserved while
sensitive token/credential keys are redacted at decode and again at the
storage boundary. Interrupted tool calls are persisted by the runtime as
terminal error `ToolResult` parts, and the protocol rejects running/partial
tool results or ambiguous inline-plus-artifact outcomes.

### T3: Web SSRF, DNS rebinding, and active content

Search/fetch can target loopback, link-local, private networks, metadata
services, or redirect from an allowed host. Downloads may be executable or much
larger than advertised.

Controls: HTTPS by default; separate search/fetch permissions; validate every
resolved address and redirect hop; pin the validated connection address;
forbid HTTPS downgrade, URL credentials, ambient proxies/cookies/auth headers,
and non-identity content encoding; reject IPv4 shorthand/integer forms and
private IPv4 embedded in IPv6 transition addresses; share one byte and timeout
budget across the complete redirect chain; MIME-sniff textual responses and
quarantine binary or executable-looking bytes even when mislabeled; restrict
methods; label content untrusted; retain the final validated source URL and
retrieval time in citations.

### T4: Credential and sensitive-data disclosure

Secrets may appear in environment variables, Git URLs, files, provider payloads,
tool output, errors, raw response bodies, telemetry, or crash dumps.

Controls: official provider authentication only; least-privilege credential
brokering; destination disclosure at first run; redact before logs, SQLite,
artifacts, telemetry, and crash reports; no browser-cookie extraction or
third-party credential reuse; local-only telemetry and disabled analytics by
default; independent secret-scanning tests using canaries. Provider requests
reject URL credentials/query/fragment ambiguity, require HTTPS except literal
loopback test fixtures, never follow redirects with authorization headers, use
bounded response/event assembly, zeroize owned API-key buffers, and expose only
redacted request/response diagnostics (never prompt bodies or raw provider
payloads).

### T5: Provider replay and unsafe fallback

Retrying a partial response can duplicate a mutating tool call. Provider-specific
reasoning signatures or tool-result media can be lost during compaction/resume.

Controls: stable message, part, request, operation, and tool-call IDs; terminal
results for interrupted tools; persist required provider metadata after
redaction; idempotency keys when officially supported; fallback only before a
mutating side effect or committed partial response; never silently replay tools.

### T6: Concurrency, stale state, and cross-project leakage

Two sessions may write the same worktree; an external editor may change a file;
or disposing one project may terminate another project's resources.

Controls: one active mutator per change/worktree; per-write revision checks;
explicit conflict classification; leases that never grant authority on expiry;
project-scoped ownership; SQLite WAL and a single-leader process lock; exclusive
project transaction lock for Land; process/resource leak and external-edit
tests. Artifact quota checks, content-addressed writes, and garbage collection
share an artifact-store filesystem transaction lock, including across local
processes; concurrent writers therefore cannot overrun a quota after observing
the same stale inventory. Garbage-collection unlink operations remain anchored
to the locked store descriptor, pin scans are bounded and no-follow, and a
default active grace period protects newly written artifacts while their
proof/snapshot references are committed. A deduplicated CAS hit refreshes that
grace from the verified artifact descriptor as well, closing the window where
an old unpinned object is reused and collected before its new reference becomes
durable.

### T7: Malicious or failed subagents and extensions

A child, MCP server, hook, or extension may exceed task scope, spawn persistent
processes, return a misleading patch, or attempt Land.

Controls: real child sessions with inherited parent/change IDs, bounded path and
tool scope, risk floor, depth, time/token/tool budgets, and typed result schemas;
cancellation propagation; parent validation; no child authority expansion or
Land; extension isolation, output limits, health state, and cleanup on failure.
MCP transports bound every request and response to at most 16 MiB; HTTP response
bodies are streamed into that bound, secure endpoints are validated again at
the transport boundary, redirects and ambient cookies are disabled, and stdio
children are terminated as owned process groups. Connection, tool, resource,
schema, description, argument, and identifier counts/sizes are bounded, JSON-RPC
version and response IDs are matched exactly, and all MCP results retain
untrusted `mcp-content` provenance. OAuth callbacks require an exact loopback
address, path, state, and PKCE S256 binding. Token and revocation endpoints have
stricter no-query HTTPS rules, token responses are bounded, persisted token sets
are validated on both load and replacement, failed replacement rolls back, and
secret buffers are zeroized. Extension manifests and entries are regular,
single-link, no-follow, project-scoped files; extension count, input, output, and
time are bounded, authority-bearing outputs remain disabled, and cleanup
failures retain a failed health record instead of silently losing the instance.

Residual risk: project-owned Git attributes and local repository configuration
can still affect checkout/worktree semantics; a future descriptor-native Git
integration is required to eliminate every same-user repository-config race.
Path-based app artifact commits recheck parent identity before and after rename,
but a same-user parent-directory swap remains narrower—not equivalent to the
`openat`/`renameat` protection used by repository mutation tools. TUI background
workers request cancellation but currently join without a forced timeout.
Cancellation of a blocking HTTP send is observed before and
after the send and is bounded by its timeout, but it cannot interrupt the
underlying blocking request at an arbitrary instruction. An arbitrary in-process
extension handler that ignores its cancellation token can keep its worker thread
alive until it returns; executable extensions are isolated in process groups and
are killed on timeout or cancellation.
An executable can fork, call `setsid`, and retain inherited output pipes outside
the owned process group. The current tools/jobs/LSP/lifecycle readers then have
an unbounded join after group termination. A correct fix requires OS containment
plus bounded nonblocking drain; detaching the reader would conceal a resource
leak and is not accepted as cleanup evidence.

Repository-local `.changeloop/proof-providers.json` and `reviewer.json` remain
untrusted content that can select executable names and arguments after an
explicit Prove/Review request. Execution is bounded and the reviewer receives a
clean artifact-only packet, but lifecycle intent is not yet a distinct trusted
approval of the selected command. A GA contract must surface and bind that
selection through trusted configuration or an explicit permission decision.
The shared lifecycle process runner also lacks filesystem/network sandboxing;
clearing its environment is not sufficient side-effect containment.
The clean reviewer process can currently self-report its model family and
accepted-risk metadata in typed output. Even after exact-command approval, those
claims must instead bind to a trusted reviewer attachment and a separately
persisted user/trusted-policy authority ID that reviewer output cannot create.

### T8: Evidence forgery, staleness, and narrative success

Receipts may refer to old content, a formatter may change files after proof, or
an agent may claim a failing check is irrelevant.

Controls: content-address evidence and bind receipts to provider, command,
environment, workspace revision, and protocol version; invalidate only affected
claims after edits; record proof freshness; classify infrastructure separately
from code failure; require independent review for risk triggers; never treat
narrative completion as proof. Patch hashes are streamed and checked again from
the destination descriptor immediately before atomic replacement, and formatter
side effects are included in the same snapshot and changed-path proof-impact
ledger as the initiating edit.
Deserialized convergence state is revalidated before it can carry authority:
proof freshness must match the phase, risky Ready/Landing/Landed states require
a valid latest independent review, Land requires its explicit transaction, and
IDs, histories, repair ordinals, findings, and provider references are bounded
and internally consistent. Persistence cannot manufacture a lifecycle advance.

Residual risk: workspace revision intentionally excludes `.changeloop`, while
proof/reviewer command configuration and operational/evidence authority records
are stored there. Structural validation alone does not authenticate origin or
bind those bytes to the proof revision. GA requires a trusted configuration
split and content digest plus authenticated SQLite/MAC binding for durable
authority and evidence.

### T9: Snapshot, migration, and recovery data loss

Undo can erase unrelated user edits, migration can partially rename state, or a
crash can strand a Land transaction.

Controls: step-scoped snapshots and three-way overlap detection; undo/redo as new
audited events; dry-run migration plan; same-filesystem staging where possible;
fsync/atomic rename and a recovery journal; preserve `.workflow/` read-only;
retain backups until validation; corruption and interrupted-operation tests.
First-class delete and no-clobber rename mutations require an expected content
hash and current workspace lease. They use descriptor-relative, no-follow
operations, conservatively classify direct deletion as irreversible at the
policy boundary, snapshot deletion and both rename paths in the standard app
path (including case-only renames), and invalidate proof for every resulting
path delta.
If the checkpoint manifest or post-mutation revision state cannot be persisted,
the in-memory checkpoint validates every after-state and restores all before
states transactionally; an overlapping external edit blocks rollback and is
preserved. A checkpoint that never became durable is removed from undo/redo
history, while partial changes from a failed formatter remain captured in one
explicitly failed, undoable checkpoint.

Residual risk: the compensation above covers an ordinary manifest-save error,
not process/power loss between workspace mutation and manifest commit. Snapshot
cleanup can also remove blobs before the new manifest is durable. Both need a
fsynced prepared/applying/committed journal or manifest-first two-phase GC.
Land still uses path-based target remove/create/rename after validation, leaving
a same-user parent-directory swap window that requires pinned dirfd/openat
mutation. Privacy purge deletes database/index state but not every snapshot,
proof, review, hook, archive or Land artifact, and its lock is not shared by all
lifecycle writers; safe deletion requires a content-bound exact inventory,
unified writer lock and journaled nofollow quarantine.

### T10: Local server and event-stream attack

Another local process or hostile browser origin may connect, forge a cursor,
exhaust an event queue, or exploit protocol-version ambiguity.

Controls: owner-only socket permissions or short-lived local bearer credentials;
strict origin policy; protocol negotiation; stable cursor validation; bounded
queues and message sizes; heartbeats; rate limits; replay retention limits;
graceful shutdown followed by forced cleanup.

### T11: Supply-chain and update compromise

Dependencies, release workflows, installers, or update channels may deliver a
modified binary or permit downgrade to a vulnerable version.

Controls: locked dependencies; an automated MSRV-to-lockfile compatibility
check; full-commit GitHub Action pins; license and vulnerability policy; SBOM; hermetic
release inputs where practical; GitHub OIDC signing; signed checksums and build
provenance; macOS signing/notarization; installer verification before replace;
rollback protection plus a separately verified recovery path.
Authenticated update-catalog entries are still treated as untrusted input:
catalog/source counts and sizes are bounded, online sources must parse as HTTPS
URLs without userinfo or fragments, and offline discovery rejects URL-shaped
remote sources rather than later interpreting them as local paths.

## Security verification gates

MVP/GA testing must include deterministic AUTO results, YOLO boundary cases,
prompt injection from every provenance class, symlink/path traversal, SSRF and
DNS rebinding, decompression limits, interrupted tool replay, child cancellation,
concurrent writers, external edits, stale receipts, undo overlap, server-origin
checks, database corruption, secret canaries, and signed-update rollback.

Any authentication, migration, concurrency, irreversible action, public API,
security-boundary, multi-repository, or anomalous-evidence change triggers an
independent clean-context review. Residual risks are recorded as verified,
hypothesis, disproved, or explicitly accepted risk; an unverified hypothesis is
not silently promoted to a blocking defect.
