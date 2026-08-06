# cloop — Production Readiness Report

> Session of 2026-08-05 → 06. Branch `feat/changeloop-cli`, base commit `2e0bd2c`.
> Research: `docs/research/changeloop-agent-runtime-2026.md` (92 sources)
> Plan: `docs/reports/agent-runtime-adoption-plan.md`
> Build log: `docs/reports/agent-runtime-implementation-log.md`

---

## Headline

| | Start | Now |
|---|---|---|
| Tests | 754 passed | **1,061 passed, 0 failed** |
| Crates | 21 | **25** |
| Rust | ~86,000 lines | **104,006 lines** |
| Gates | — | clippy 0 issues · `fmt --check` clean · TS bindings not stale · release binary builds |

Every number above was measured in the primary checkout after integration, not
taken from an agent's self-report — two agents misreported their own counts by
40–70% early in the session, so verification became a standing step.

**All 16 items of the adoption plan shipped**, plus five items the plan did not
contain: the Prove↔Land join, ACP protocol support, an ACP runtime driver, the
subagent authority fix, and a `status` robustness fix.

---

## What was added

### New crates

| Crate | Lines | What it is |
|---|---|---|
| `changeloop-sandbox` | 3,271 | The only process-spawning API in the workspace. `raw` is a private module, so the compiler — not code review — enforces that every child crosses the boundary. Seatbelt / Landlock+seccomp / bubblewrap / Windows restricted-token backends, deny-by-default policy, and an enumerated exception register whose `ExceptionId` cannot be constructed outside the crate. |
| `changeloop-acp` | 4,013 | Agent Client Protocol: JSON-RPC 2.0 over stdio, version negotiation that refuses mixing, sessions, streamed prompts, permission round-trips, cancellation cascade. |
| `changeloop-acp-runtime` | — | The driver that makes ACP real — a genuine model turn, real tool dispatch, real permission pauses, over `AgentRuntime`. |

### Evidence and the Prove gate

The research found the field's default evidence signal is measurably weak:
~11.0% of patches passing every developer test are actually incorrect, the full
suite flips 7.8% of "passing" ones, and a field study of 17 developers found
practitioners **treat green tests as proof and stop reading the code**.

- **`changeloop-evidence`** gained a Prove oracle (~1,930 lines, 32 tests):
  coverage delta on touched lines, differential testing against the pre-change
  revision, ranked divergences, a suppression ledger. `is_proof_of_correctness()`
  is a `const fn` returning `false` **on every variant, including the strongest**.
- **`changeloop-land`** renders that honestly. Every briefing opens with *"Tests
  are weak evidence. A passing suite shows that code ran, not that it is
  correct."* The strongest state still says *"About one patch in nine that passes
  every developer test is still incorrect. Read the diff."* A test asserts the
  words *verified*, *proven* and *guaranteed* appear nowhere.
- **The join** (`changeloop-cli/src/prove_oracle.rs`) makes it real: Prove writes
  the receipt Land reads. Before it, both halves worked and neither did anything.

### Runtime hardening

- **Reasoning atomicity** — the bug class that recurred ~7 times in 5 months
  across two vendors and was independently rediscovered in a third codebase.
  Raw reasoning payloads are a private type; request builders moved out of the
  adapter crate so the payload can stay private; `InputMessage.parts` is private
  so no generic filter can reorder a content array. `ReasoningDisposition` has
  exactly two variants and is deliberately not `#[non_exhaustive]` — **a third
  operation fails to compile.**
- **Two-gate fallback** — the transactional gate (never fall back while a tool
  call's completion is uncertain) plus a reasoning-identity gate that fires
  regardless of mutation state, because encrypted reasoning state is bound at
  account level. Automatic cross-provider fallback now refuses loudly.
- **Context-assembly plane** — the third control surface. A sandbox governs what
  a process may touch; the permission grid governs which acts need a human; this
  governs *what may enter the model's context*. It closes the stdout → context →
  provider path that carries 73.5% of credential leaks and crosses no OS
  boundary. It found a real gap: redaction previously ran only on the
  persistence path, not on provider-bound requests.
- **Watcher safety** — classify, never write. It also corrected the algorithm it
  was given: `git show HEAD:<path>` alone under-detects reverts, because VS Code
  "Discard Changes" restores the *index* version — the exact operation the source
  incident describes would have been misclassified.
- **Snapshots + expected-revision** — catches the write-revert-write race the
  watcher provably cannot see, pinned by a test that asserts the watcher
  contributed nothing to the pause.
- **Single-writer enforcement** — `WriterGrant` takes a kernel `flock` before
  SQLite opens the file, so no public API yields a writable store handle without
  it. Proved by SIGKILLing a real child and showing the parent acquires the role
  with the lock file still present.
- **Ownership-based disposal** — bounded caches whose every departure routes
  through an eviction sink, SIGTERM and panic force-dispose, and a fan-out test
  that spawns 24 real children and asserts `ECHILD` per PID.
- **Delegation contracts** — the harness authors a child's scope, tools, budgets
  and result schema; a model-supplied contract is refused unless byte-identical
  to the re-authored one.
- **Tool-catalogue discipline** — the default catalogue measures **1,678 tokens
  across 18 tools**, pinned by a test, with deferred schema loading past 10K and
  a documented (not arbitrary) truncation rule.
- **Format-then-check on every write**, in one transaction, with the digest taken
  from post-format bytes so the watcher cannot misread the agent's own formatted
  write as an external edit.

---

## What was reduced or removed

Deliberate subtractions, each with a reason:

| Removed | Why |
|---|---|
| **The app-server's second formatter pipeline** (`formatter_after_edit`) | Two formatter paths meant check-then-format — the wrong order — and a digest computed on pre-format bytes. Deleted, not deprecated; one pipeline remains. |
| **MCP's duplicate Seatbelt/bubblewrap adapters** | Superseded by `changeloop-sandbox`. `StdioTransport::spawn` was a bare `Command::new` with **no sandbox at all**; the extension host carried a hand-written Seatbelt profile string and a hand-written bubblewrap argv. All three now go through `Spawn`. An unenforced host **refuses** to start an MCP server rather than running it host-privileged, and the extension host refuses at construction with no escape hatch. |
| **`changeloop-ops`' hand-rolled `setpgid` + `terminate_process_tree`** | Replaced by the sandbox crate's owned process group. The lifecycle executor *declines* isolation under an enumerated register row rather than enforcing it — proof commands routinely resolve dependencies over the network, and enforcing would have broken real providers with no test coverage to catch it. |
| **`changeloop-tools`' private sandbox adapter** and its process-group helpers | Same. Zero bare `Command::new` remains in that crate's production code. |
| **`changeloop-config`'s local `open_enum!` macro** | Moved to `changeloop-protocol`, the layering-correct home, rather than duplicated. |
| **Unconditional `FilesystemWrite` for subagents** | Every child previously received write authority and a model-chosen path scope. Now `{read_file}` and a harness-chosen scope. |
| **Model-authored delegation scope** | A `paths` argument from the model is now a hard refusal, not a silently-ignored field. |
| **`allow_always` in ACP permission requests** | Deliberately absent, so an ACP client cannot record a standing grant. |
| **Automatic cross-provider fallback** | Refuses loudly instead of silently degrading. |
| **`base_workspace_revision` as a timestamp** | Replaced with a real revision hash. |

### Not built, on purpose

- **A general cross-schema-version converter.** ACP's own maintainers built one,
  shipped it, and deleted it as *"doing more harm than good since there are
  plenty of unrepresentable states."* cloop guarantees within-version open enums
  and enumerated downgrade paths only, failing **visibly** where it cannot.
- **Heartbeat / TTL lease reclaim.** No evidence exists in the corpus for this
  problem shape. `MutationLease::renew` is holder-only; recovery is the kernel
  dropping the descriptor, not a timeout. An agent that started designing one
  was told to stop and report it as a gap.
- **Native LSP.** Measured at +1.4–2.0pp resolve rate on teacher models and
  **−0.4pp on a trained one** — none of which survives the corpus's own ~6pp
  SWE-bench noise floor. The real, consistent effect is efficiency: −17.5% turns,
  −23.7% tokens. Deferred with the numbers stated rather than on a hunch.
- **Embeddings / BM25 retrieval.** Classical retrieval scores 12.7% against
  agentic exploration's 44–59% at issue-localization scale, and a structural
  index fails to significantly beat competent grep (p=0.087).
- **Parallel-write subagents.** Safe only where work units are independently
  verifiable by a strong oracle — and cloop's oracle declares itself weak.

---

## Where cloop stands against OpenCode

| Capability | cloop | OpenCode |
|---|---|---|
| Structured message parts | ✅ + payload-preserving open enums, schema-version tags, by-reference artifacts | ✅ |
| Session model + compaction | ✅ | ✅ |
| Local server + SDK | ✅ `serve --stdio/--unix/--http` | ✅ |
| MCP | ✅ + OAuth, extensions, bounded stdio-v1 | ✅ |
| Snapshots / undo | ✅ shadow git + expected-revision checks | ✅ |
| File watching | ✅ classify-never-write | ⚠️ silently overwrites a user's `git checkout`; issue closed "not planned" |
| Provider abstraction | ✅ + two-gate fallback, account-bound reasoning identity | ⚠️ signature-loss bug recurred ~7× in 5 months |
| Permissions | ✅ 4 actions × 4 modes | ✅ |
| **OS sandbox** | ✅ dedicated crate, compiler-enforced coverage | ❌ none |
| **Evidence oracle** | ✅ coverage delta + differential + ranked divergence | ❌ none |
| **Land gate** | ✅ human reviews evidence, not transcript | ❌ none |
| **Context-assembly plane** | ✅ credential scrubbing, provenance, quarantine | ❌ none |
| ACP | ✅ protocol + real runtime driver, read-only | ✅ |
| LSP | ⚠️ `lsp status` only; deferred on measured evidence | ✅ (shipped **disabled by default**) |
| PTY / background jobs | ✅ | ✅ |

**Ahead:** OS sandboxing, the evidence oracle, the Land gate and the
context-assembly plane have no OpenCode equivalent. Two of them — the watcher
overwrite bug and the reasoning-signature bug class — are failures OpenCode has
shipped and cloop now has regression tests against.

**Behind:** ACP is read-only where OpenCode's is not, and LSP is deferred. The
LSP gap is a deliberate, evidence-backed choice rather than a shortfall; the
ACP write path is a genuine limitation.

---

## What remains

### Blocking for a write-capable production release

1. **ACP is read-only.** An ACP client can converse, read the workspace, run
   read tools and answer permission prompts. It cannot write, run shell, or
   execute tests — refused at four independent layers. Making it write-capable
   requires routing through cloop's change-confirmation path, which is a design
   decision, not a wiring gap.
2. **`changeloop-app-server`'s runtime wiring is private**, so the ACP driver
   assembles its own read-only runtime from public crates. Two wirings, one
   authority model. Making `RuntimeTools`/`RuntimeGate`/`RuntimeProvider` public
   with a read-only constructor would collapse them.

### Mechanisms built but not fully load-bearing

3. **`BoundedResourceCache` has no user yet** — `ResourceKind::Cache` is
   registered by name only.
4. **Five ledger rows remain** (down from seven): `changeloop-app-server`,
   `changeloop-cli`, `changeloop-project`, `changeloop-snapshot` — mostly
   operator-machine `git` invocations outside an agent turn — plus
   `changeloop-language`, whose blocker is structural: the fallback
   `ProjectProcessLauncher` trait returns a `std::process::Command`, so wiring it
   needs either that signature changed or a second `raw_command` register row,
   which `exactly_one_row_grants_a_raw_command_handoff` forbids.
5. **No spawn site reaches a `ProjectInstance`.** MCP children are owned and
   reaped by their transport instead, which is real ownership in a different
   place. `ChildProcessRegistry::adopt` consumes the whole `SandboxedChild`, so a
   transport needing the child's pipes cannot hand it over without leaking the
   transport for the session's duration — a design tension worth resolving before
   the registry can take over.
6. **`ForceDisposeSignalGuard` is installed only in `run_tui`** — headless and
   CLI entry points have no signal-triggered disposal.
7. **Linux extension isolation narrowed on one axis.** The shared bubblewrap
   backend uses `--unshare-net` where the deleted MCP adapter used
   `--unshare-all`, so PID/IPC/UTS/cgroup namespaces are no longer unshared for
   extensions. No test asserted the old behaviour, and eliminating per-component
   profile divergence is the point of the sandbox crate — but this is genuinely
   looser than before and wants its own change with Linux coverage.

### Platform

6. **Windows is planner-only.** The restricted-token backend generates and tests
   a policy but **refuses to spawn**; enabling it is a deliberate `compile_error!`
   rather than a sandbox that does not sandbox. Signal handling and process-group
   termination are `#[cfg(unix)]`.
7. **Linux Landlock applier is behind a non-default feature**; bubblewrap is the
   default and degrades (loudly) when egress rules are present.

### Evidence gaps carried forward

8. Harness-vs-model ceiling unresolved: one study measures a 23.8-point harness
   spread at fixed model, another finds model choice dominates scaffold choice.
9. No controlled ablation isolates delegation-contract authorship — the central
   subagent claim is inference across two studies.
10. Land cannot catch injection that produces no diff; the context-assembly plane
    is what covers that class, and no guardrail detects stored injection reliably
    (measured 0–36%).

---

## Honest notes on method

Two tests are **flaky under heavy parallel load**, both pre-existing and both
wall-clock/lock sensitive: `leader_election_never_connects_to_malformed_owner_metadata`
and `runtime_extensions_require_explicit_mcp_allow_and_reject_authority_output`.
Verified as flakes rather than regressions — each passes in isolation, in its own
crate suite, single-threaded, and on full-workspace re-runs.

**Nothing in this session has been committed.** All work sits staged in the
working tree on `feat/changeloop-cli` (base `2e0bd2c`). `CLAUDE.md` additionally
carries 99 lines injected by a research-tool installer; revert with
`git checkout -- CLAUDE.md` if unwanted.
