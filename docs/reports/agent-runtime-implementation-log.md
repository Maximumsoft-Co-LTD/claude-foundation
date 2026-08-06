# Agent Runtime — Implementation Log

> What was built, verified and left open in this working session.
> Plan: `docs/reports/agent-runtime-adoption-plan.md`
> Evidence: `docs/research/changeloop-agent-runtime-2026.md`
> Branch: `feat/changeloop-cli`, base commit `2e0bd2c`

---

## Summary

| | |
|---|---|
| Items shipped | **Wave 0 (4) + Wave 1 (2) + the Prove↔Land join + Wave 2 items 7 and 11** |
| Tests | 754 → **861 passed, 0 failed** (+107) |
| New code | ~8,000 lines across 12 crates |
| Gates | `cargo clippy --workspace --all-targets` 0 issues · `cargo fmt --check` clean · TS bindings not stale |
| Agents | 11 implementers (+2 retried after a stall), each in an isolated git worktree |

Every number above was measured in the primary checkout after integration, not
taken from an agent's self-report. That distinction earned its keep — see
*Things that went wrong* below.

---

## What was built

### Item 4 — `reqwest`/`configd` regression guard ✅

`tests/performance/tests/reqwest_sandbox_guard.rs` (199 lines, 4 tests)

**The research said this was a live landmine; verification said otherwise.** The
default macOS Seatbelt profile denies mach-lookup to
`com.apple.SystemConfiguration.configd`, so a Rust CLI using `reqwest`'s default
features panics with exit 101 when sandboxed — reproduced against Codex CLI,
closed "not planned" upstream. But this repository already sets
`default-features = false` on reqwest, and `system-configuration` appears **zero
times** in `Cargo.lock`. `cloop` was already immune.

So the item became a guard rather than a fix. Two assertions: no workspace
manifest may enable reqwest default features or name
`macos-system-configuration`; `system-configuration` must never enter the
lockfile. A third self-test keeps the guard's own detection logic honest in CI.

The failure message explains the backstory, because whoever trips this in two
years will not have read the research. It was proven to fail before it was
accepted as passing — the predicate was flipped, the failure observed, then
restored.

Runs in CI: `workflow-tests.yml:97` executes `cargo test --workspace --locked`
with a path filter already covering `Cargo.toml`, `Cargo.lock`, `crates/**` and
`tests/performance/**`.

### Item 8 — format-then-check on every write ✅

`crates/changeloop-tools/src/{lib,tests}.rs`,
`crates/changeloop-protocol/src/lib.rs`,
`crates/changeloop-app-server/src/{executable,runtime_tool_tests}.rs`,
`clients/typescript/generated/` (48 → 53 files)

`write` and `apply_patch` now return `VerifiedWrite { sha256, verdict }`. The
formatter runs, then the checker, inside the same tool invocation, before the
tool reports success. The verdict reaches protocol clients as
`WriteCheckVerdict`.

Evidence: adding a lint gate to the edit tool moved resolve rate **15.0% →
18.0%** at fixed model. Separately, unified-diff patches apply cleanly 95% of
the time but are only 76–81% linter-clean — apply-success and correctness
diverge by 14–19 points.

Three design decisions worth recording:

- **`sha256` is computed on post-format bytes.** The implementing agent found
  this itself by reading §6.D: computing it pre-format makes a file watcher
  misclassify the agent's own formatted write as an external edit — the exact
  failure mode item 11 exists to prevent.
- **A verdict struct, not a bare `Vec`.** An empty vector cannot distinguish "no
  checker is configured" from "a checker ran and found nothing". Telling those
  apart is the entire point of the item.
- **A checker that cannot spawn, times out, or is cancelled becomes a visible
  non-passing verdict, never an `Err`.** The write has already landed; returning
  an error would imply nothing happened.

Backward compatibility: `#[serde(default)]` plus `#[default] NotConfigured`
means an older payload without the field decodes as "nothing attested", never as
a passing check.

### Item 15 — tool-catalogue discipline ✅

`crates/changeloop-runtime/src/catalog.rs` (476 lines) + runtime wiring, 16 tests

Measurement first, then policy. **The current default catalogue measures ~1,678
estimated tokens / 6,710 bytes across 18 built-in tools** — comfortably inside
the 10K budget, with the number now pinned by a test.

Evidence: a five-server MCP setup was measured at ~55,000 tokens of definitions;
deferred loading cut that >85% in one vendor measurement and 6.4–6.7× in a
protocol audit; tool-selection accuracy degrades past roughly 30–50 exposed
tools. Defaults: 10,000-token budget, 40-tool cap.

Two properties the plan demanded and the implementation honours:

- **Truncation is never silent.** Three warning codes are persisted to the
  session event log, deduped and bounded.
- **The cap is a documented rule, not arbitrary truncation.** Pinned tools
  first, then dispatcher declaration order. `plan()` is pure and a test asserts
  two runs are byte-identical.

Deferral changes only what goes on the wire; invocation resolves the full
definition, so permissions and argument handling are untouched.

### Item 16 — per-model profile ✅

`crates/changeloop-config/src/profile.rs` (712 lines) + config wiring, 7 tests

Evidence: there is no single correct runtime strategy because the right answer
inverts by model. Subagent context isolation was the *best* method for one model
and among the *worst* for another **in the same controlled study**. Edit-format
policy matters below the frontier and is near-irrelevant at it.

Three details that show the research was actually read, not skimmed:

- `symbol_graph_file_span: 3` — exploration escalates on **change locality**, not
  repository line count. That distinction was the synthesis finding that
  reconciled two benchmarks which looked contradictory.
- `count_server_tool_cache_reads: false`, commented as the
  "334,400-vs-63,000 accounting trap" — the SDK compaction-misfire finding,
  encoded as a default.
- Unknown config values round-trip through a hand-written `open_enum!` macro
  producing `Unknown { tag, body }` + `#[non_exhaustive]`. **`#[serde(other)]` is
  explicitly not used**, with a comment explaining why: it matches only a unit
  variant and discards both tag and payload. A reviewer had caught the report
  itself recommending `#[serde(other)]` — the bug was fixed in the research
  before it could reach the code.

Config-source precedence was reused, not reinvented: `agent` is a normal `PATHS`
entry, so the existing layering and `explain("agent")` provenance work
unchanged.

### Wave 1 item 1 — Prove oracle ✅

`crates/changeloop-evidence/src/{coverage,divergence,oracle}.rs` (~1,930 lines)
+ `tests/oracle.rs` (32 tests)

**The most important item in the plan.** `cloop`'s differentiator is that a human
reviews evidence at Land rather than a transcript — and the field's default
evidence signal is measurably weak:

- Patches passing every developer test diverge behaviourally at 29.6%;
  adjudicated as 28.6% certainly incorrect, 5.2% certainly correct, **66.2%
  undecidable**. The defensible figures are **~11.0% actual incorrectness** and
  **6.4pp inflation**.
- Running the full suite rather than only PR-modified test files flips **7.8%**
  of previously "passing" patches.
- A field study of 17 experienced developers found practitioners treat passing
  tests as proof and stop reading the code.

Produces a machine-readable `ProveOracleReport` attached to `Receipt::extensions`
under `proveOracle`: coverage delta on touched lines, differential test-outcome
comparison against the pre-change revision, ranked divergences, a suppression
ledger, and ordered warnings.

Four honesty properties are enforced in the type system rather than in prose:

- **`OracleConfidence::is_proof_of_correctness()` is a `const fn` returning
  `false` on every variant**, including the strongest one.
- **Unmeasured ≠ uncovered.** A touched line absent from the coverage report is
  `unmeasured`, never `uncovered` — otherwise every brace manufactures an alarm.
- **Coverage-unavailable is a typed verdict**, never a silent zero, and
  `implies_clean()` is const-false.
- **A regression is never auto-classified as expected.** An attributed
  regression gets a lower rank but stays `Unexpected`; only an explicit
  suppression rule silences it.

**The ranking rule addresses a real trap.** The research differentiates against
a *human oracle patch*, which `cloop` does not have — so diffing against the
pre-change revision flags every *intended* change. An unranked feed would
manufacture the approval fatigue the plan warns about (review rate predicts
defect-catch with no safe-speed threshold). The rule: **undeclared outranks
declared**, because "behaviour changed" is uninformative on the surface a change
declared it would touch and highly informative off it.

---

### Wave 1 item 2 — the Prove-gate honesty affordance ✅

`crates/changeloop-land/src/prove_evidence.rs` (~440 lines) +
`tests/prove_evidence.rs` (11 tests) + CLI Land rendering

The oracle refuses to claim proof in its types; this makes the human-facing
surface say the same thing. Every briefing opens with:

> Tests are weak evidence. A passing suite shows that code ran, not that it is
> correct. Nothing below is proof of correctness.

Even the strongest state is written to resist over-reading:

> **Evidence strength: WEAK — CHANGED PATH EXERCISED (strongest available)**
> The suite executed every instrumented line this change touched. That is the
> strongest signal this oracle can produce and it is still not proof of
> correctness: running a line is not the same as checking it. About one patch
> in nine that passes every developer test is still incorrect. Read the diff.

Note the figure: **one patch in nine ≈ 11.0%**, the adjudicated incorrectness
rate — not the 29.6% divergence rate that an earlier draft of the research
misused. The correction propagated all the way into shipped user-facing text.

Four behaviours are pinned by tests:

- A test asserts the strongest rendering contains none of *verified*, *proven*,
  *guaranteed*. Verified independently after integration: **0 occurrences** in
  the source.
- When the suite exercised **nothing**, the headline refuses to soften into
  "not fully": *"The suite ran, passed, and executed none of this change. The
  green result is about other code… the only reviewer of these lines is you."*
- Unavailability renders as *"not measured — not measured is not clean"*, never
  as absence of problems.
- Pacing is surfaced explicitly: *"Review rate predicts defect detection with
  no safe threshold: reading faster costs detection continuously. Budget time;
  do not skim."* With zero warnings it still adds *"A quiet oracle is not a
  reason to read faster."*

Divergences render in the oracle's existing rank order, capped at 8 with an
explicit "and N further" line. `to_json()` carries a hard-coded
`proofOfCorrectness: false`.

### Wave 0 item 8 — formatter pipeline merged ✅

`crates/changeloop-language/src/lib.rs`,
`crates/changeloop-tools/{Cargo.toml,src/lib.rs,src/tests.rs}`,
`crates/changeloop-app-server/src/{executable,runtime_tool_tests}.rs`

This closes the gap the item-8 agent flagged and declined to force: the verdict
was always `not_configured` in a real deployment because nothing populated
`WriteCheckerConfig`, and wiring it naively would have produced
**check-then-format** — the wrong order — with the digest computed on
pre-format bytes.

The write transaction now owns the whole gate in one explicit order:
**format → digest-from-disk → check**. `formatter_after_edit` is **deleted**
from the app-server, not deprecated — verified by grep after integration. The
app-server no longer executes formatters at all; it supplies configuration and
maps results.

`.changeloop/language.json` gained a `checkers` array beside `formatters`,
`#[serde(default)]` so existing files behave exactly as before. A relative
`executable` is now anchored to the repository root — the agent found that
leaving it relative handed the name to `PATH`, and caught it because a test
failed.

The post-format digest is proven end to end by
`language_json_checkers_run_after_the_formatter_on_the_post_format_bytes`,
which asserts `result["sha256"] == sha256(disk)` **and**
`!= sha256(requested)`, with a checker that only exits 0 on post-format
content.

`is_clean()` now counts both halves, so a failed formatter leaves the write
unverified even when no checker is configured.

### The Prove ↔ Land join ✅

`crates/changeloop-cli/src/prove_oracle.rs` (~640 lines), 16 tests

Wave 1 shipped two halves that never touched: evidence could produce an oracle
report, Land could render one, and **nothing wrote one**. Land therefore always
printed "NOT MEASURED" — honest, but the whole Wave 1 investment produced
nothing in practice.

The Prove path now builds the report and records it at
`<root>/.changeloop/receipts/<change_id>/prove-oracle.json` — the exact root
Land already reads, so `changeloop-land` was not modified.

**Land now renders a measured briefing.** Pinned end to end through the real
`prove_at → review_at → land_at` path by
`land_renders_a_measured_briefing_after_a_prove_run_that_produced_coverage`,
asserting `measured == true` and
`evidenceStrength == "WEAK -- CHANGED PATH EXERCISED (strongest available)"` —
while `proofOfCorrectness` stays false and the text still opens with "Tests are
weak evidence."

The differential arm decides availability in a fixed order, each branch
producing an explicit `DifferentialUnavailable` rather than an omitted field:
candidate outcomes unresolvable → `RunUnparsable`; no baseline configured →
`NotAttempted`; recorded baseline output missing → `BaselineRunFailed`; a
configured baseline command runs in a detached `git worktree` at HEAD, removed
on every exit path. A non-zero exit is *not* treated as failure — a suite with
failures is a valid baseline.

Prove gained **no gate**: the oracle runs after lifecycle state is durable, and
every failure becomes a diagnostic rather than a block. A *failed* Prove writes
no receipt at all.

### Wave 2 item 7 — reasoning atomicity ✅

`crates/changeloop-provider/src/{reasoning,request}.rs` (new) + provider,
adapters, runtime and app-server wiring, 15 tests

The most-recurring bug class in the corpus — roughly seven issues in five
months across two vendors, then independently rediscovered in a third codebase.

**Three concentric walls, none of them a convention:**

1. `RawReasoning` has no `pub`. It is unreachable from any other module in any
   crate; the only exits are two `pub(crate)` accessors returning `&str`, called
   solely by the canonical request builders.
2. **The builders were moved out of the adapter crate into `changeloop-provider`**
   so the raw payload can stay private. The adapter crate now owns transport,
   headers and parsing only — it *cannot* assemble a request body. Any future
   adapter inherits that constraint.
3. `InputMessage.parts` is private. A generic pass in another crate physically
   cannot `retain`, `remove` or reorder a content array. `retain_parts` returns
   `SkippedReasoningAtomic` without touching anything when the message carries
   reasoning.

`ReasoningDisposition` has exactly two variants, is deliberately *not*
`#[non_exhaustive]`, and `apply` matches without a wildcard — **a third
operation fails to compile.**

The two gates are separate by design. The transactional gate adds
`tool_call_uncertain`, set whenever a dispatched tool call has no matching
result — strictly stronger than "mutation observed", and the case a
mutation-only check misses. The reasoning-identity gate sits *outside*
`authorize_fallback` because it must fire regardless of progress, running for
every target including route 0. Identity is `(provider, account_fingerprint,
model)`, where the fingerprint is a domain-separated SHA-256 prefix — one-way,
stable across sessions, never carrying the credential.

Automatic cross-provider fallback is now **refused loudly** rather than
silently degrading.

### Wave 2 item 11 — watcher classifies, never writes ✅

`crates/changeloop-project/src/external_change.rs` (~500 lines), 13 tests

Implements the self-write fingerprint and pause-and-classify algorithm, and
**found three flaws in the specification it was given** — two fixed, one
reported:

1. **`git show HEAD:<path>` alone under-detects reverts.** VS Code "Discard
   Changes" and `git checkout` restore the *index* version when a file is
   staged — so the exact operation the source incident describes would have been
   misclassified as a hand edit. Now checks HEAD, then index, then stash, and
   reports which matched. It also compares *object ids* rather than streaming
   blob bytes, so Git's own clean/CRLF filters apply — a raw byte comparison
   would be wrong on any repo with `text=auto`.
2. **Leaving the fingerprint live after a pause reopens the same silent-loss
   class.** Under a literal "equals fingerprint → suppress" rule, a path already
   paused for an external edit gets its conflict silently cleared the moment the
   user happens to restore the agent's bytes by hand. The record is now retired
   at pause time.
3. **Residual and reported rather than papered over:** if the agent writes A,
   the user reverts, and the agent writes B all inside one debounce window, the
   window sees B, matches the latest fingerprint, and suppresses — the user's
   intervening revert leaves no trace. No watcher can observe a state that never
   survived to a poll; the real mitigation is item 13's expected-revision check
   on the *second* write.

The echo predicate is content equality and nothing else — `git_oid` is
deliberately excluded, because untracked paths and commit-less repos have none
and a formatter can produce bytes Git never hashed. Including it would have
manufactured failure mode 2 inside the echo branch.

The fingerprint compares against **post-format** bytes, matching the formatter
merge — pinned by
`post_format_bytes_are_the_echo_fingerprint_not_the_requested_bytes`.

---

## Things that went wrong

Recorded because they are the useful part.

### The plan contained a false urgency

Item 4 was ranked first as a live landmine. Pre-flight verification showed the
repository was already immune. **Cost of checking: two shell commands. Cost of
not checking: an agent dispatched to fix a bug that does not exist.** The plan
has been amended with the verification note.

### Worktrees were created from the wrong base

Agent worktrees branch from `origin/main` by default, and `main` contains **no
Rust workspace** — the code lives on `feat/changeloop-cli`. Three of four agents
detected this and reset themselves; the fourth copied the workspace in manually.
No work was lost, but the fourth agent's self-verification could not be trusted,
so its output was re-verified against the real base before integration. Later
dispatches named the base branch explicitly.

### A patch silently did not apply

`git apply` is atomic. One file in a seven-file patch failed with "does not match
index" — because that file already carried another agent's uncommitted changes —
and **the entire patch was rolled back**, including the six files that applied
cleanly. The failure scrolled past under a `head -5`.

The result was a state where five generated TypeScript files referenced Rust
types that did not exist, while `cargo test` still passed 791 because Rust never
sees the TS directory. **This was reported to the user as complete before it was
caught.** It was found by checking `git status` for files an agent claimed to
have modified and finding them absent.

Fix: apply the patch with `--include` filters for the files that merge cleanly,
stage the conflicting file so `--3way` has an index reference, then merge its
hunks separately. Both agents' work survived.

### Two agents misreported their own metrics

The synthesis agent reported ~8,400 words against an actual 14,492. The patch
agent reported ~13,000 against 16,640. Both were off by 40–70%.

Every count in this document was measured directly. Later agents were told
their numbers would be verified, and the ones that followed reported accurately
— one flagged a baseline discrepancy of a single test rather than papering over
it.

### Worktree isolation prevents file conflicts, not content conflicts

The research says this explicitly, and it happened here. Two agents modified
`runtime_tool_tests.rs` from different bases; copying either file wholesale
would have deleted the other's test. Caught by diffing before integrating.
This is why every merge in this session was verified with a full
`cargo test --workspace` rather than trusted.

---

## Method

The research's own conclusions were applied to the work of implementing it:

- **Parallel writes need an oracle.** The plan refuses parallel-write subagents
  because they are safe only where work units are independently verifiable. Here
  the oracle was `cargo check` + `cargo test` + `clippy` + `fmt`, and the base
  was confirmed green before any agent was dispatched — otherwise an agent
  cannot distinguish its own errors from pre-existing ones.
- **One writer per worktree.** Each agent got its own isolated worktree, and
  integration into the shared tree was strictly sequential with a full
  verification between each.
- **Interdependent work was not parallelised.** Wave 1 item 2 renders what item
  1 produces, so it was held until item 1 defined the data shape.
- **Overlap was designed out rather than merged after.** Two agents would have
  collided in `changeloop-tools`; one was directed to `changeloop-runtime`
  instead.

---

### Two agents were killed by a stall watchdog

The first attempt at Wave 1 item 2 and the formatter merge both died after 600
seconds of silence. The cause was my instruction: I told each agent to copy 18
paths individually, including a whole directory, which ran long with no output.

Fixed by collapsing setup into a single patch file (`wave0-1.patch`, 28 files)
so the whole base is established in one command, and by telling the retried
agents to narrate before slow steps. Both then completed.

### Agents were told to read a file that was not in their worktree

Setup patches were built with `git add -A -- crates clients tests docs/reports`,
which omits `docs/research/` — and that directory is gitignored, so it exists
only in the primary checkout. Every dispatched agent was told to read
`docs/research/changeloop-agent-runtime-2026.md`, and none of them could.

They worked from `docs/reports/agent-runtime-adoption-plan.md` instead, which
carries the evidence in summarised form, so no work was wrong. But it was luck
rather than design, and one agent flagged it explicitly rather than quietly
proceeding — which is how it was found.

---

## Still open

| Item | Status |
|---|---|
| Wave 2 items 6, 10, 13, 14 | Not started |
| Waves 3–4 | Not started |

**Integration gap between Wave 1's two halves.** Nothing currently *writes*
`changeloop_evidence::Receipt` — the CLI's Prove path produces
`changeloop_harness::ProofReceipt`, and no code outside `changeloop-evidence`
uses `ReceiptStore`. So Land today always renders the honest "NOT MEASURED"
briefing. That is correct behaviour rather than a bug — it never claims
evidence it does not have — but the join point
(`read_prove_evidence(root/".changeloop/receipts", change)`) still needs the
Prove path to write into it. Neither item owns that wiring; it is the next
task.

**Smaller items deliberately left:**
- `rename_file` formats but carries no `checker` field; item 8 scopes the gate
  to write and patch.
- Checker executables are not pinned by content hash the way formatters are via
  `ProjectToolResolver` — they run through the tools crate's sandboxed
  `run_process` instead. Aligning the two resolution models is a separate
  change.
- `WriteCheckStage::Format` remains a valid enum variant but is no longer
  emitted, since the format half now reports through `formatter:`. Kept for
  additivity.

Repository housekeeping: `CLAUDE.md` carries 99 lines injected by a research-tool
installer. Revert with `git checkout -- CLAUDE.md` if unwanted.
