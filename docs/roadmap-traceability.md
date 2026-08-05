# M0–M10 roadmap traceability audit

Audit date: 2026-08-05. This matrix distinguishes local executable evidence
from mock/corpus coverage and gates that require external credentials or CI.

Status legend: **complete** = implemented with local automated evidence in this
checkout (not a GA or live-provider claim);
**partial** = useful implementation exists but the roadmap claim is broader;
**external** = cannot be proved solely from this checkout.

## M0 — Contracts, threat model and baselines

| Roadmap item | Evidence | Status |
|---|---|---|
| Canonical roadmap | `docs/roadmap.md` | complete |
| ADRs and threat model | `docs/adr/0001-harness-owns-lifecycle-authority.md`, `docs/adr/0002-local-first-app-server-and-schema.md`, `docs/adr/0003-staged-rust-rewrite-and-compatibility-oracle.md`, `docs/threat-model.md` | complete |
| Runtime API 12 fixtures | `tests/oracle/runtime-api-12.json`, `tests/oracle/runtime-api-13.json` | complete |
| Node/Rust differential runner | `scripts/oracle/differential-runner.mjs`, `tests/oracle/run-rust-runtime-api-tests.mjs` | complete |
| Provider replay corpus | `tests/provider-replay/{anthropic,openai,shared}`, manifest runner | complete (synthetic/hermetic fixtures; no live capture) |
| Quality/performance baselines | methodology, fail-closed schemas/assessor, local diagnostics in `docs/quality-and-performance-baselines.md`, `scripts/performance`, `docs/reports/initial-performance-evidence-matrix.md`, and native non-streaming adapter fixtures for both provider families | partial: current local suite is 17/17 after fixing false overflow and separating three-cycle integration from evaluated long-run trends; two accepted source-frozen 8-hour records and a named reference-machine release run remain unmet |
| Install paths and migration rules | `docs/migration-and-install-paths.md`, migration tests | complete |
| Exit: language-neutral oracle and documented trust boundaries | API 12/13 oracle plus threat model | complete |

## M1 — Protocol, messages and storage

| Roadmap item | Evidence | Status |
|---|---|---|
| Rust workspace and CI | root `Cargo.toml`, locked toolchain, workflow tests | complete |
| Versioned message parts/event envelopes | `changeloop-protocol`; serialization/unknown-part tests | complete |
| SQLite sessions and migrations | `changeloop-storage`; schema, WAL and migration tests | complete |
| Cursor/replay/heartbeat/cancellation/crash recovery | protocol/storage/app-server reconnect and pause tests; atomic terminal tool event+claim transaction and dangling-result startup validation | complete |
| Generated TypeScript types | `clients/typescript/generated`, SDK tests | complete |
| Conversation/change distinction | session/app-server/CLI draft-confirm tests | complete |
| Exit: reconnect without duplicate tools/lost parts | stable event IDs, terminal tool recovery and replay tests | complete |

## M2 — Projects, configuration and concurrency

| Roadmap item | Evidence | Status |
|---|---|---|
| Project-instance registry and deterministic disposal | `changeloop-project`, multi-project disposal tests | complete |
| Config precedence/provenance | `changeloop-config`, `config explain` and managed override tests | complete |
| Process/database locks and leases | project leader/lease and storage WAL tests | complete |
| Filesystem/Git watchers and external-edit conflict | watcher, revision and pause-without-overwrite tests | complete |
| Config hot reload | project config state/invalidation dispatcher tests | complete |
| Exit: projects/sessions do not leak or conflict | concurrent read/mutation, worktree and disposal tests | complete locally |

## M3 — Providers and router

| Roadmap item | Evidence | Status |
|---|---|---|
| Anthropic Messages and OpenAI Responses adapters | `changeloop-provider-adapters` | complete |
| Compatibility transforms and replay | 28 synthetic replay fixtures/14 groups plus four SHA-pinned native JSON cases, adapter tests | complete hermetically |
| Official authentication profiles | OS credential-store boundary; no cookie/MITM path | complete |
| Model catalog/capability negotiation | router catalog, `cloop models`, floor tests | complete |
| Pricing/quota accounting, retry, circuit breakers | provider ledger/router tests | complete |
| Safe fallback and recorded/live tests | pre-side-effect fallback tests and synthetic corpus | partial: recorded/live provider captures were not available |
| Exit: identical replay/tool suites and auditable cost | synthetic/hermetic suites pass; live cross-provider parity | partial/external |

## M4 — Permissions, sandbox, tools and web

| Roadmap item | Evidence | Status |
|---|---|---|
| Permissions/actions/modes | `changeloop-policy`; exhaustive AUTO/YOLO matrix, intrinsic change-confirmation/deny precedence, mandatory doom-loop pause, and policy-bound restart tests | complete |
| Provenance/trust labels | protocol provenance and app runtime wrappers | complete |
| Filesystem/patch/shell/Git/test/question tools | `changeloop-tools`, runtime tool integration tests | complete |
| Web search/fetch controls and citations | `changeloop-web`; HTTPS, DNS/private-network, redirect/MIME/limit tests | complete |
| Platform sandbox and secret filtering | tool and extension sandbox tests | partial locally: macOS execution is exercised; Linux `bwrap` remains target-CI evidence, and macOS read confinement is broader than its exact-write/network denial |
| PTY/background jobs | bounded job manager, process-group cancellation/disposal tests | complete |
| Exit: policy/cancellation/untrusted boundaries | prompt-injection, secret, policy and cancellation regressions | complete locally |

## M5 — Snapshots, LSP, formatters and context

| Roadmap item | Evidence | Status |
|---|---|---|
| Checkpoint/undo/redo | `changeloop-snapshot`; overlap, audit and proof invalidation; ordinary manifest-save failure compensates workspace/history | partial: process/power crash journal and crash-safe cleanup ordering remain missing; portable fallback is best-effort |
| LSP lifecycle/diagnostics | `changeloop-language`; symbol/definition/reference/freshness tests | complete on the host for configured project-owned servers; required-sandbox verification remains cross-platform |
| Formatter lifecycle | formatter resolution, process ownership and mutation-snapshot tests | complete on the host; required-sandbox verification inherits the M4 platform gap |
| Instruction hierarchy/task packets | bounded `AGENTS.md`/task packet loader with untrusted provenance | complete |
| Context pruning/compaction and provider metadata | runtime compaction/reasoning replay tests | complete |
| File/image attachments | scoped MIME-sniffed CAS parts and native image payload tests | complete hermetically |
| Exit: diagnose/format/revert/resume/compact | integration tests cover normal and injected save-failure paths | partial until undo/redo and blob cleanup have durable crash journals |

## M6 — Agent and subagent execution

| Roadmap item | Evidence | Status |
|---|---|---|
| Streaming agent loop | `changeloop-runtime`, incremental provider/app SSE tests | complete with mock/synthetic providers |
| Steering/retry budget/loop detection | control, repair budget and doom-loop pause tests | complete |
| Scoped subagents/cancellation | `changeloop-agent`, scheduler and cancellation propagation tests | complete |
| Typed child results/merge validation | byte-safe Git status parser, result schemas, rename/delete/space/newline attribution, conflict and rollback tests | partial: the public child-result path schema is still `String`, so raw non-UTF-8 paths fail closed and cannot be merged |
| Conversation → draft → confirmed change | durable draft, contract and explicit confirmation tests | complete |
| Build in isolated workspaces | worktree merge/conflict/cleanup tests, checked deletion and multi-file rollback | partial only for raw non-UTF-8 path attribution; delete/rename/space/newline local merges pass |
| Exit: tasks complete without authority/resource leakage | hermetic multi-agent tests | partial locally because byte-safe public path attribution remains incomplete; live-model quality remains external |

## M7 — Prove/repair/review convergence

| Roadmap item | Evidence | Status |
|---|---|---|
| Adaptive lifecycle | `changeloop-harness` convergence state machine | complete |
| Bounded repair from proof findings | configured repair executor and targeted re-prove tests | partial: execution is bounded, but repository-selected executable/arguments still need a distinct trusted approval contract |
| Reuse unaffected receipts | freshness/invalidation tests | complete |
| Risk-triggered independent review | clean reviewer packet and risk-tier tests | partial: packet isolation passes, but repository-selected reviewer execution still needs a distinct trusted approval contract |
| Proof freshness/review attempt history | evidence/harness/archive tests | partial: freshness mechanics pass, but `.changeloop` executor/evidence artifacts are excluded from workspace revision and lack authenticated DB/config-digest binding |
| Explicit transactional Land | `changeloop-land`; revision lock and authority tests | partial: same-user parent-directory swap remains in path-based target mutation |
| Exit: failures cannot be narrated away/non-progress pauses | proof receipt and doom-loop tests | partial until repository-selected command authority is separated from lifecycle intent |

## M8 — TUI, headless, onboarding and server Beta

| Roadmap item | Evidence | Status |
|---|---|---|
| Full TUI/headless surfaces | ratatui TUI, public CLI and typed command tests | partial: local surfaces work, but the release provider runtime has no trusted literal-loopback endpoint contract for real 10k-delta PTY evidence and a permanently unresponsive in-process backend can still block worker join |
| Change/permission/review dialogs | durable draft/contract dialogs and typed state modals | complete |
| Session/job/agent/model selectors | typed `sessions.list`, bounded keyboard pick-list overlays, explicit model restart/cancel dialogs, owned background workers and PTY cancellation under one second | complete locally |
| First-run auth/privacy/sandbox | F2/`/setup` provider → model → sandbox wizard, explicit disclosure dialog, atomic local setup, OS credential next step and hermetic PTY cancel probe | complete locally; live authentication is external |
| HTTP+SSE and SDK exercises | strict auth/origin/protocol+maturity, bounded reconnect/cursor/backpressure tests and real TypeScript SDK → local-server exercise | complete |
| Update detection/signing/rollback | signed schema/channel v2 binds target triple and standalone-executable kind; legacy v1 fails closed; host recovery/tamper/rollback tests pass | complete on the host; actual four-target execution, publication/signing services and installed-release upgrade are external |
| Completion/accessibility basics | nested bash/zsh/fish completion, keyboard/headless doctor fields, `NO_COLOR`, non-TTY/`TERM=dumb`, resize and Unicode PTY diagnostics | complete locally; source-frozen release evidence is pending |
| Exit: new-user proven sample change | hermetic onboarding plus 15-transition sample lifecycle, including contract/prove/review/undo/redo/Land | complete locally; live provider auth and installed-release exercise remain external |

## M9 — Rust harness parity and migration

| Roadmap item | Evidence | Status |
|---|---|---|
| State/hashing/topology/diagnostics port | M9 reference and coverage manifest | complete |
| Lifecycle/validation/packets/sandbox port | M9 parity cases | complete |
| Evidence/receipts/readiness/proof port | M9 parity cases | complete |
| Authority/telemetry/review/Land/archive port | M9 parity cases | complete |
| Exit: deterministic suite without unapproved differences | coverage 47/47 and cases 29/29 | complete |

## M10 — MCP and GA cutover

| Roadmap item | Evidence | Status |
|---|---|---|
| MCP transports and official OAuth | stdio/Unix/HTTP transports; strict PKCE/state/loopback callback; HTTPS/no-redirect/no-cookie bounded token exchange; redacted/zeroized secrets; keyring replacement rollback plus refresh/revoke/logout adversarial tests | complete locally; live provider/keyring backends remain external |
| MCP permission/provenance/output limits | manager/runtime policy and untrusted result tests; transports are not loaded for Auto/Ask/Deny/Plan and repository/legacy config cannot activate YOLO | complete locally for tested transport policy; production authority enforcement remains decentralized |
| Skills/hooks with failure isolation | versioned hook contracts, manifest discovery, sandboxed `stdio-v1` handler isolation, bounded output and typed failure tests | complete locally; public stability remains version-labelled |
| Post-GA items remain deferred | roadmap explicitly defers marketplace/cloud/local models | complete as scope decision |
| Preview → Beta → RC → GA rollout | workflows and compatibility alias exist | external/not executed; GA publication is not proven by source tests |
| Node fallback then removal | compatibility alias and legacy runtime path exist | partial: release-window timing is external |

## Overall assessment

- A source-frozen Rust/Node/Foundation/security/compatibility baseline completed
  on 2026-08-05: 726 Rust tests in 49 suites, 17 Foundation suites with
  751 assertions, 47/47 M9 coverage cases, 29/29 differential cases, 28 provider
  replay cases, 9/9 TypeScript SDK checks, and 16 repository-compatibility
  passes with three explicitly typed environmental skips. These are separate
  gates and must not be added together as one synthetic test total. The current
  performance contract rerun is 17/17 after a non-captured stdout overflow bug
  was fixed. After bounded PTY probe cleanup/config isolation and the background
  runtime fix, the fresh composite local-release rerun completed with exit 0;
  release-mode SKIPs and external/time-bound GA evidence remain separate.
- Locally complete with hermetic evidence: M1–M2 and M9. M0's
  contracts/threat model/oracles are locally complete, but its numeric
  performance baseline is not release-qualified.
- M4 is mostly implemented, but cross-platform sandbox assurance and macOS read
  confinement remain partial.
- M5–M7 have substantial local implementations, but crash-journal/cleanup,
  raw non-UTF-8 child path
  attribution and trusted proof/reviewer command authority keep their broad
  roadmap exits partial.
- Implemented but dependent on external proof: M3 live providers and the M8
  install/auth/sample-change exit.
- Deliberately not GA-complete: M10 rollout/publication; local versioned
  skill/hook execution is implemented, while stable marketplace semantics stay
  post-GA.
- GA gates still external or time-bound: two source-frozen eight-hour soak
  records, a named reference-machine run, Apple signing/notarization, GitHub
  OIDC publication, four-target CI artifacts, and live Anthropic/OpenAI tests.
- Both eight-hour diagnostics completed on 2026-08-05 but started before later
  source/runner changes and were rejected by the current assessor. Storage had
  exact replay and zero database growth but lacked the current integrity/schema
  contract; mixed had 2,361 cycles, no orphan and bounded absolute resources but
  59 workload failures and only the old five-workload shape. They cannot be
  promoted to GA evidence. A future qualification
  run must keep source/binary/runner identities frozen and pass the current assessor.
- The current release binary cannot route provider traffic to a trusted
  literal-loopback fixture. Real provider-stream → TUI evidence therefore
  remains blocked; proxy/MITM/DNS substitution is explicitly not accepted as
  proof.
