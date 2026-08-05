# Changeloop CLI Roadmap

> Canonical file: `docs/roadmap.md`  
> Product: `changeloop-cli`  
> Executable: `cloop`

## 1. Product contract and research baseline

Changeloop CLI is a coding-agent harness that manages the complete software change loop:

```text
Investigate? → Change → Build → Prove → Land
```

The harness owns lifecycle state, repository scope, permissions, evidence, review and transition gates. Models and subagents execute bounded work but cannot advance or weaken the lifecycle themselves.

### Locked decisions

- Full staged Rust rewrite
- Anthropic and OpenAI native providers in MVP
- Headless CLI and TUI in MVP
- Actual subagents in MVP
- Controlled web search/fetch in MVP
- Local/OpenAI-compatible models after GA
- Local-first execution with app-server protocol
- macOS/Linux arm64 and x64 first
- Local-only telemetry by default
- Risk-triggered independent review
- Permissions: `allow`, `ask`, `deny`, `auto`
- Modes: `auto`, `ask`, `plan`, `yolo`
- Official authentication contracts only
- No MITM, browser-cookie extraction or third-party credential reuse

### OpenCode research findings

Research baseline: OpenCode `dev` commit `f0afb6750e63ee0a60b052914531bde0afb9bc2b`, inspected 2026-08-04.

The research added these requirements:

- versioned structured message parts;
- provider-specific history/reasoning replay;
- scoped resource lifecycle per project/worktree;
- snapshot/undo/redo;
- LSP and formatters before GA;
- PTY and background-job management;
- event reconnect, cursor replay and backpressure;
- source-aware config precedence;
- generated SDKs;
- file watching and targeted invalidation;
- extension failure isolation;
- install-method detection and secure updates.

Reference implementations include OpenCode’s [session messages](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts), [instance lifecycle](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/project/instance-store.ts), [snapshots](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/snapshot/index.ts), [LSP](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/lsp/client.ts), and [configuration](https://opencode.ai/docs/config/).

## 2. Core behavior and architecture

### Conversation versus change

```bash
cloop
cloop ask "ระบบ authentication ทำงานอย่างไร"
cloop run "แก้ login timeout"
```

- `cloop` and `cloop "<prompt>"` start read-only conversation sessions.
- `cloop ask` answers headlessly without creating a change.
- Conversation sessions may inspect but cannot mutate.
- Implementation intent produces a draft change requiring confirmation.
- `cloop run` explicitly authorizes creation of a change.
- Low-risk work proceeds through Prove.
- Medium/high-risk work stops for contract approval before Build.
- Land is always explicit.
- YOLO cannot convert a conversation into a change.

### Adaptive convergence loop

```text
Change confirmed
    ↓
Build
    ↓
Prove
    ├── passed ────────────→ Review? → Ready to Land
    ├── code failure ──────→ Repair → targeted Prove
    ├── config failure ────→ Change/config decision
    ├── infrastructure ─────→ Retry/pause/external evidence
    └── authority required ──→ Wait for user/reviewer
```

Rules:

- Rerun only providers invalidated by the repair.
- Preserve fresh receipts for unaffected claims.
- Each repair cycle has an operation ID and budget.
- Two repeated failures with the same cause trigger focused diagnosis.
- Repeated non-progress triggers the `doom_loop` permission and pauses.
- Budget exhaustion never weakens evidence requirements.
- Requirement changes return to Change and invalidate affected proof.
- Agent narrative completion never counts as proof.

### Layering

```text
TUI / headless / SDK / future IDE
                │
Transport-neutral protocol
stdio / Unix socket / HTTP+SSE
                │
Changeloop Harness
lifecycle / policy / evidence / review / land
                │
Agent Runtime
sessions / context / subagents / tools / jobs
                │
Provider Router
Anthropic / OpenAI / official gateways
```

### Rust workspace

Create crates for:

- protocol and generated clients;
- structured sessions/messages/events;
- project instances and configuration;
- provider adapters and router;
- agent and subagent runtimes;
- tools, web, PTY and background jobs;
- permissions and sandbox;
- snapshots and patches;
- LSP and formatters;
- deterministic harness;
- MCP and extension host;
- app-server, TUI and CLI.

### Canonical paths

New projects:

```text
changeloop.json
.changeloop/
openspec/
AGENTS.md
```

User state follows platform config/data directories under `changeloop`.

Migration:

- Read `foundation.json`, `.foundation/` and existing receipts.
- `cloop migrate --dry-run` reports all changes.
- `cloop migrate --apply` is transactional and recoverable.
- Preserve `.workflow/` as read-only provenance.
- Accept legacy environment variables for one major compatibility period.
- Keep `claude-foundation` as an alias for at least one major release.

## 3. Runtime contracts

### Structured messages

Use a versioned union:

```text
Text
Reasoning
ToolCall
ToolResult
File
Image
Source
Patch
Snapshot
Retry
Compaction
Question
Permission
StepStart
StepFinish
Subagent
ReviewFinding
Error
```

Requirements:

- Stable message/part IDs
- Explicit partial/running/completed/error states
- Interrupted tool calls receive terminal results
- Unknown part behavior depends on negotiated protocol version
- Required provider metadata survives resume and compaction
- Raw provider payloads are redacted before persistence
- Large outputs become content-addressed artifacts
- Event/message pagination uses stable cursors

### Provider compatibility

Support Anthropic Messages and OpenAI Responses.

Maintain fixtures for:

- system/developer roles;
- reasoning signatures;
- parallel tools;
- partial tool arguments;
- tool-result media;
- context/output limits;
- prompt caching;
- usage and rate-limit metadata;
- cancellation;
- history replay;
- model status and deprecation;
- provider-specific errors.

Fallback may occur only before a mutating side effect or committed partial response. Tool calls are never silently replayed.

Router accounting records:

- pricing-catalog version;
- provider request IDs;
- input/output/cache/reasoning tokens;
- estimated and provider-reported cost;
- quota/reset metadata;
- unknown or incomplete usage explicitly;
- currency and pricing source.

Cost routing cannot lower the required risk tier.

### Project-instance lifecycle

Each repository/worktree instance owns:

- effective config and provenance;
- filesystem/Git watchers;
- LSP and formatter processes;
- PTYs and jobs;
- model executions;
- MCP connections;
- tool and provider caches.

Disposal cancels owned work, rejects pending requests, flushes state and releases processes without affecting another instance.

### Concurrency policy

- One active mutating execution per change/worktree.
- Multiple read-only conversations may inspect concurrently.
- Independent changes may run in separate worktrees if leases and resource declarations do not conflict.
- Every write checks the expected workspace revision.
- External changes cause pause and conflict classification, never silent overwrite.
- SQLite uses WAL plus an app-server process lock.
- A second local server connects to the leader or fails with recovery instructions.
- Lease expiry never grants authority automatically.
- Land obtains an exclusive project-level transaction lock.

### Subagent runtime

Subagents are real child sessions, not prompt-only abstractions.

Each child receives:

- parent/session/change IDs;
- task and repository/path scope;
- allowed tools and permissions;
- model/risk floor;
- token/time/tool budgets;
- explicit expected result schema.

Rules:

- Default depth is one.
- Default maximum parallel children follows project policy, initially three.
- Parent cancellation propagates to children.
- Child failures cannot leave resources running.
- Children cannot Land, expand scope, grant permissions or alter policy.
- Child output returns as typed findings, patches or task results.
- The parent validates merge conflicts and proof impact.
- High-risk independent review uses a clean reviewer session without implementation conversation.

### Permissions

Rule actions:

```text
allow
ask
deny
auto
```

Modes:

```text
auto
ask
plan
yolo
```

AUTO is a versioned deterministic classifier using tool, operation, paths, network, reversibility, sandbox capability and lifecycle authority. Model content cannot influence the decision.

YOLO:

- suppresses per-tool approval;
- permits danger-full-access for agent tools;
- remains visibly marked;
- requires explicit user activation;
- cannot bypass policy deny, repository scope, secret protection, change confirmation, proof, review or Land authority.

Add a `doom_loop` permission for repeated automated recovery.

### Untrusted-content boundary

Classify context provenance:

```text
trusted-policy
user-input
repository-content
tool-output
web-content
mcp-content
model-generated
```

Only trusted policy and explicit user authority can change permissions or lifecycle policy.

Repository, web, MCP and tool content:

- cannot enable YOLO;
- cannot add allowed domains or paths;
- cannot expose credentials;
- cannot authorize external side effects;
- is wrapped with provenance metadata before entering model context.

### Web tools

MVP includes `web_search` and `web_fetch`.

Controls:

- separate permissions for search and fetch;
- HTTPS by default;
- redirect limit;
- DNS rebinding and private-network protection;
- domain allow/ask/deny patterns;
- MIME, byte and timeout limits;
- no ambient browser cookies;
- downloaded content marked untrusted;
- citations retain source URL and retrieval timestamp;
- binary downloads become quarantined artifacts;
- web content cannot directly become executable instructions.

### Snapshots and undo

Capture a checkpoint around each mutating agent step.

```bash
cloop undo [session]
cloop redo [session]
```

- Revert only files changed by the selected step.
- Preserve unrelated user edits.
- Detect overlapping external modifications and pause.
- Undo/redo creates new audit events.
- Undo invalidates affected proof.
- Snapshot cleanup respects active sessions and evidence references.

### LSP and formatting

- Detect project-owned LSP servers without unapproved downloads.
- Support symbol lookup, definitions, references and diagnostics.
- Handle push/pull diagnostics, debounce and freshness timeouts.
- Scope LSP processes per project/worktree.
- Run configured project-owned formatters after edits.
- Formatting changes participate in snapshots and proof hashes.
- Formatter/LSP absence is diagnostic, not silently equivalent to success.

### App-server

Use one schema source to generate Rust and TypeScript clients.

Transports:

- stdio for TUI/headless;
- Unix socket for reusable local service;
- HTTP+SSE for Beta SDK/IDE integration.

Requirements:

- protocol negotiation and maturity labels;
- ordered event IDs;
- replay cursors;
- heartbeats;
- bounded queues and backpressure;
- graceful reconnect;
- local authentication outside stdio;
- strict origin policy;
- client/server compatibility errors;
- graceful shutdown and forced cleanup timeout.

## 4. Public CLI

```bash
cloop
cloop "<prompt>"
cloop ask "<question>"
cloop run "<intent>"
cloop change confirm|discard <session>
cloop contract approve <session>
cloop resume [session]
cloop fork <session>
cloop sessions
cloop status
cloop undo [session]
cloop redo [session]
cloop jobs
cloop review [change]
cloop prove [change]
cloop land <change>
cloop auth login|list|logout
cloop setup --provider <anthropic|openai> --model <model> --sandbox <mode> --accept-privacy --accept-provider-data
cloop setup status
cloop models
cloop config explain <field>
cloop privacy inspect|export|delete
cloop lsp status
cloop formatter status
cloop mcp add|list|auth|remove
cloop mcp extensions [run <id> [json]]
cloop serve
cloop doctor
cloop update
cloop migrate --dry-run
cloop migrate --apply <plan-digest>
cloop completion <shell>
```

TUI commands:

```text
/status
/sessions
/setup
/change
/change confirm
/change discard
/contract approve
/run
/prove
/review
/diff
/undo
/redo
/compact
/model
/permissions
/jobs
/agents
/mcp
/cancel
/help
/quit
```

Exit codes distinguish invalid input, approval required, agent failure, proof failure, cancellation, auth/provider failure and lifecycle rejection.

Public protocol, config and CLI features are tagged `experimental`, `beta` or `stable`. Stable interfaces receive a documented deprecation window.

## 5. Privacy, review and governance

### Privacy defaults

- Workflow audit and metrics remain local.
- Product analytics are disabled by default.
- Crash upload is a separate opt-in.
- No source, prompt, tool output or diff is uploaded except to the selected model/provider or explicitly invoked external tool.
- `cloop privacy inspect` shows destinations and retained data.
- `cloop privacy export` exports session data and provenance.
- `cloop privacy delete` removes sessions not referenced by active evidence.
- Secrets are redacted before logs, SQLite, crash reports and telemetry.
- Provider data-policy disclosure appears during first-run setup.

### Independent review

Review is risk-triggered for:

- authentication/authorization;
- public API compatibility;
- migrations and persistent data;
- concurrency;
- irreversible actions;
- security boundaries;
- multi-repository contracts;
- anomalous or conflicting evidence.

Reviewer rules:

- Clean context separate from implementation chat
- Diff, agreement, evidence and residual risk only
- Findings classified as verified, hypothesis, disproved or accepted risk
- Hypotheses require reproduction before becoming blocking defects
- Security review requiring independence uses another model family or external authority when policy demands it

### Release supply chain

- Locked Rust dependencies
- License-policy check
- `cargo audit`/deny checks
- SBOM generation
- Signed checksums and build provenance
- macOS signing/notarization
- GitHub OIDC-based release signing
- Installer verifies signature before replacement
- Update rollback protection
- Database compatibility matrix
- Recovery path for interrupted update

## 6. Implementation roadmap

### M0 — Contracts, threat model and baselines

- Replace `docs/roadmap.md` with this plan.
- Record ADRs and threat model.
- Capture runtime API 12 fixtures.
- Build Node/Rust differential runner.
- Define provider replay corpus.
- Establish quality and performance baselines.
- Inventory owned install paths and migration rules.

Exit: existing behavior has a language-neutral oracle and all trust boundaries are documented.

### M1 — Protocol, messages and storage

- Create Rust workspace and CI.
- Implement message parts and event envelopes.
- Implement SQLite sessions and migrations.
- Add cursors, replay, heartbeat, cancellation and crash recovery.
- Generate TypeScript client types.
- Implement conversation/change state distinction.

Exit: reconnect and resume do not duplicate tools or lose message parts.

### M2 — Projects, configuration and concurrency

- Implement project-instance registry.
- Add deterministic disposal.
- Implement config precedence/provenance.
- Add process/database locks and leases.
- Add filesystem/Git watchers and external-edit conflicts.
- Add config hot reload and `config explain`.

Exit: multiple projects and sessions run without leaking resources or conflicting writes.

### M3 — Providers and router

- Implement Anthropic/OpenAI adapters.
- Add provider compatibility transforms.
- Add official authentication profiles.
- Add model catalog and capability negotiation.
- Add pricing/quota accounting, retry and circuit breakers.
- Add safe fallback and recorded/live tests.

Exit: both providers pass identical replay/tool suites and cost data is auditable.

### M4 — Permissions, sandbox, tools and web

- Implement permissions and modes.
- Implement provenance/trust labels.
- Add filesystem, patch, shell, Git, test and question tools.
- Add web search/fetch security controls and citations.
- Add platform sandbox and secret filtering.
- Add PTY/background jobs.

Exit: local and web tools respect policy, cancellation and untrusted-content boundaries.

### M5 — Snapshots, LSP, formatters and context

- Add checkpoint/undo/redo.
- Add LSP lifecycle and diagnostics.
- Add project formatter lifecycle.
- Load instruction hierarchy and task packets.
- Add context pruning and compaction.
- Preserve reasoning/provider metadata.
- Add file/image attachments.

Exit: edits can be diagnosed, formatted, reverted, resumed and compacted safely.

### M6 — Agent and subagent execution

- Implement streaming agent loop.
- Add steering, retry budget and loop detection.
- Implement scoped subagents and cancellation propagation.
- Add typed child results and merge validation.
- Connect conversation → draft → confirmed change.
- Bind Build to isolated workspaces.

Exit: single and multi-agent tasks complete without authority or resource leakage.

### M7 — Prove/repair/review convergence

- Implement adaptive lifecycle.
- Feed proof findings into bounded repair cycles.
- Reuse unaffected receipts.
- Add risk-triggered independent review.
- Add proof freshness and review-attempt history.
- Keep Land explicit and transactional.

Exit: required failures cannot be narrated away and repeated non-progress pauses safely.

### M8 — TUI, headless, onboarding and server Beta

- Build full TUI and headless surfaces.
- Add change/permission/review dialogs.
- Add session/job/agent/model selectors.
- Add first-run auth/privacy/sandbox setup.
- Add HTTP+SSE and SDK exercises.
- Add update detection, signed update and rollback.
- Add shell completion and accessibility basics.

Exit: a new user can install, connect a provider, ask a question and complete a proven sample change without reading operator docs.

### M9 — Rust harness parity and migration

Port:

1. state, hashing, topology and diagnostics;
2. change lifecycle, validation, packets and sandbox;
3. evidence, receipts, readiness and proof;
4. authority, telemetry, review, Land and archive.

Exit: Rust passes the existing deterministic suite without unapproved differences.

### M10 — MCP and GA cutover

- Add MCP transports and official OAuth.
- Apply permission/provenance/output limits to MCP.
- Add skills/hooks with failure isolation.
- Keep marketplace, cloud execution and local models post-GA.

Rollout:

- Preview: Rust opt-in
- Beta: Rust default for conversation/read
- RC: Rust default for all operations
- GA: publish `changeloop-cli` and `cloop`
- One minor release with Node fallback
- Following major removes Node runtime

## 7. Verification and release gates

### Functional/security tests

- Provider stream and history replay
- Partial/interrupted tool calls
- AUTO determinism and YOLO hard boundaries
- Prompt injection from repository/web/MCP/tool output
- DNS rebinding/private-network web protection
- Subagent scope, depth, budget and cancellation
- Multiple concurrent sessions and external edits
- Snapshot undo preserving unrelated work
- LSP diagnostic freshness
- Formatter-created diff handling
- Event reconnect, replay and backpressure
- Config provenance and managed overrides
- Process/resource leak tests
- Database corruption/migration recovery
- Secret scanning
- Signed update rollback

### Repository compatibility matrix

- Clean and dirty worktrees
- Submodules
- Git LFS
- Sparse checkout
- Symlinks
- Case-sensitive paths
- Monorepos and nested repositories
- Multi-repository changes
- Non-Git directories
- Renames/deletes
- Large/binary files
- Read-only and full-disk failures

### Agent quality evaluation

Measure:

- task completion and executable proof rate;
- regression and unnecessary-diff rate;
- tool-call efficiency;
- repair cycles;
- context/token/cost;
- wall time and time to first useful edit;
- subagent contribution versus overhead;
- cross-provider variance;
- permission and scope violations.

Use deterministic oracles where possible. Model judges must be pinned independently from the executing model.

### Initial performance gates

- CLI help/status startup under 250 ms on a warm machine
- TUI ready under 750 ms excluding provider authentication
- Local event relay p95 under 50 ms
- Graceful shutdown under two seconds before forced cleanup
- No unbounded memory, event queue or database growth during an eight-hour soak
- Provider router overhead below 5% of upstream request wall time excluding deliberate retry
- Reconnect and replay of 10,000 events under two seconds on the reference machine

### GA gates

- Existing Foundation evidence and Land invariants remain intact.
- Conversation cannot mutate before change confirmation.
- Agent completion remains distinct from proof completion.
- Subagents cannot expand authority.
- AUTO and YOLO cannot weaken required assurance.
- Web content cannot grant permissions or expose local credentials.
- Local-only telemetry remains the default.
- Known incident benchmarks remain detectable.
- macOS/Linux arm64/x64 release artifacts verify and upgrade safely.

### Post-GA

- Ollama, LM Studio and OpenAI-compatible providers
- Windows native support
- IDE and desktop clients
- Browser/computer-use tools
- Cloud workers and team backend
- Public plugin marketplace
- Optional vector retrieval
