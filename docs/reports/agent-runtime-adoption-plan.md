# Changeloop CLI — Agent Runtime Adoption Plan

> Derived from `docs/research/changeloop-agent-runtime-2026.md` (15,491 words,
> 92 sources). Every item below traces to a section of that report; section
> references are given as `§N`. Where a number appears, the report states what
> it was measured on — check there before quoting it.

**Scope.** What to build in the `cloop` agent runtime before GA, what to defer,
and what to refuse. The harness-owned lifecycle
(`Investigate? → Change → Build → Prove → Land`) is a fixed premise, not a
proposition under review.

**Total pre-GA effort:** ~27 engineer-weeks across 16 items. Sequence matters
more than the total — Wave 0 and Wave 1 carry most of the value.

---

## The finding that should reshape priorities

`cloop`'s differentiator is that a human reviews **evidence** rather than a
transcript. The research says the field's default evidence signal is measurably
weak, and — worse — that engineers over-trust it:

- Patches passing **every** developer test still diverge behaviourally at 29.6%;
  adjudication splits that into 28.6% certainly incorrect, 5.2% certainly
  correct, **66.2% undecidable**. The defensible figures are **~11.0% actual
  incorrectness** and **6.4pp inflation** of reported resolution rates.
- Running the full suite rather than only PR-modified test files flips **7.8%**
  of previously "passing" patches to incorrect.
- An IRB field study of 17 experienced developers found practitioners **treat
  passing tests as proof of correctness** and stop reading the code.
- Review *rate* predicts defect-catch with **no safe-speed threshold** — rushing
  costs 10–17 points of defect detection, continuously.

So the highest-leverage work is not a runtime feature. It is making Prove a
stronger oracle and making Land honest about how strong it is.

**Carry this caveat with the recommendation:** the differential-testing research
compares against a *human oracle patch*, which `cloop` does not have.
Differencing against the pre-change revision flags every *intended* behaviour
change. Divergences must be ranked and suppressed, or item 1 manufactures the
approval fatigue that §7 warns against.

---

## Wave 0 — This week (~2 weeks, highest value per unit effort)

| # | Item | Cost | Done when |
|---|---|---|---|
| 4 | `reqwest`/`configd` **regression guard** (see verification note below — the panic does not currently apply); transport-level bypass design | 1 day | CI fails if `default-features` is re-enabled on `reqwest`, or if `system-configuration` enters the lockfile |
| 8 | Format-then-check on every write — formatter, then lint/typecheck, inside the write transaction | ~1 day per language | No write commits without a checker verdict attached |
| 15 | Tool-catalogue discipline — deferred schema loading past ~10K tokens of definitions; hard cap on concurrently-exposed tools | 3–4 days | Tool definitions measured under budget at session start |
| 16 | Per-model context/exploration/delegation profile struct | ~3 days | Strategy is config, not a compile-time constant |

### Verification note on item 4 — the panic does NOT currently apply

The research flagged this as a live landmine: the default macOS Seatbelt profile
denies mach-lookup to `com.apple.SystemConfiguration.configd`, so a Rust CLI
using `reqwest`'s default features panics with exit 101. Reproduced against
Codex CLI, closed **"not planned"** upstream (§7).

**Checked against this repository — `cloop` is already immune:**

```toml
# Cargo.toml:42
reqwest = { version = "0.12", default-features = false,
            features = ["blocking", "json", "rustls-tls", "stream"] }
```

`default-features = false` disables reqwest's `macos-system-configuration`
feature, which is what pulls in the `system-configuration` crate that panics.
Confirmed empirically: `system-configuration` appears **zero times** in
`Cargo.lock`. Three crates depend on reqwest (`changeloop-mcp`,
`changeloop-provider-adapters`, `changeloop-web`) and all inherit the workspace
config.

So item 4 is **not a fix — it is a guard**. Its value is preventing a future
contributor from adding `default-features = true` or a dependency that
re-enables the feature transitively, which would silently reintroduce the panic
the day the sandbox ships. That is worth a cheap CI assertion, not two days of
remediation. Downgraded from urgent to routine.

**Why Wave 0 first, then.** Items 8, 15 and 16 carry the value here. Item 8 is
the cheapest measured quality win in the corpus: adding a lint gate to the edit
tool moved resolve rate 15.0% → 18.0% at fixed model (§6). Item 16 makes every
later decision configurable rather than hard-coded wrong — context strategy
rankings **invert between models** in the same controlled study (§4).

Item 8 is the cheapest measured quality win in the corpus: adding a lint gate to
the edit tool moved resolve rate 15.0% → 18.0% at fixed model (§6).

Item 16 makes every later decision configurable rather than hard-coded wrong —
context strategy rankings **invert between models** in the same controlled study
(§4).

---

## Wave 1 — The differentiator (~3–4 weeks)

| # | Item | Cost | Done when |
|---|---|---|---|
| 1 | Strengthened Prove oracle — differential testing against the pre-change revision, coverage delta on touched lines, weak-coverage warning, ranked/suppressed divergence surfacing | 2–3 weeks | Prove reports what was *not* exercised, not only what passed |
| 2 | Prove-gate honesty affordance — Land renders tests as *weak* evidence, surfaces unexercised paths, paced by review rate | ~1 week | Land never presents a green suite as proof |

This is the only work in the plan whose value **does not depreciate as models
improve**. Everything else is parity with the field.

Design constraint from §1 and §7: ranking and suppression are not polish. An
unranked divergence feed is an approval-fatigue generator, and the same report
shows a paranoid escalation policy performing *worse* under attack than a
load-aware one.

---

## Wave 2 — Correctness that is expensive to retrofit (~8–10 weeks)

| # | Item | Cost | Done when |
|---|---|---|---|
| 7 | **Message-level reasoning atomicity** — one request-builder per provider, account/deployment identity tag, two-gate fallback, no automatic fallback | 3–4 weeks | No code path outside the request-builder can touch reasoning-part presence, order or bytes |
| 6 | Typed part union, payload-preserving open enums, schema-version tag, by-reference artifact parts, cursor pagination | 1.5–2 weeks | An unknown part round-trips through storage and replay byte-identically |
| 11 | Watcher invalidates, never writes — fingerprint classification, preserve both sides on conflict | 1–2 weeks | No write-on-watcher-event path exists in the codebase |
| 13 | Per-step git snapshots, expected-revision checks, one mutating execution per worktree | ~1.5 weeks | Every write checks expected revision before applying |
| 10 | Socket rendezvous + `flock` + app-server owns all writes + WAL + versioned handshake | ~1.5 weeks | A second `cloop` process provably cannot write |
| 14 | Ownership-based disposal, bounded caches with eviction **callbacks**, SIGTERM/panic force-dispose | ~1 week | Disposal releases plugins, caches and child processes; no defunct children under watcher load |

**Item 7 is the most urgent here.** The same signature-loss bug class recurred
across roughly **seven issues in five months** in OpenCode and Claude Code, and
a later regression showed a *generic normalisation pass that merely stripped
empty text parts* independently reintroduced it. Two implementation facts from
reading real source diffs (§8):

- The atomic unit is **the entire assistant-message content array**, not the
  individual reasoning part. Once any part is `reasoning`, filtering must be
  disabled for the whole array.
- It must be enforced at **every layer that can filter message content** —
  three such layers existed in one codebase.

**Item 6 implementation note.** Do **not** use `#[serde(other)]` for unknown
variants: it matches only a unit variant and discards both tag and payload,
silently destroying exactly the data the open-enum promise undertakes to
preserve. Use a payload-carrying `Unknown { tag, body }` plus
`#[non_exhaustive]` (§3).

**Item 11 context.** A shipped competitor silently reapplies its own content
over a user's deliberate `git checkout`, and that issue was auto-closed
"not planned" with no fix. `cloop`'s never-silently-overwrite guarantee is
therefore unmet by the field leader — a differentiator, not table stakes (§10).

---

## Wave 3 — Enforcement (~5–7 weeks)

| # | Item | Cost | Done when |
|---|---|---|---|
| 5 | **Context-assembly control plane** — credential scrubbing on tool output, provenance tagging of fetched/MCP content, quarantine part-state | ~1 week | Tool output is treated as untrusted data, not transcript |
| 3 | **One sandbox spawn API** — raw primitive private to the crate; deny-default Seatbelt, Landlock + seccomp, Windows restricted tokens; enumerated exception register | 4–6 weeks **+ ongoing allow-list maintenance** | No module outside the sandbox crate can spawn a process |

**Item 5 is disproportionately cheap.** The highest-frequency credential-leak
path is stdout → model context → provider API at **73.5%** of cases, and it
crosses **no OS boundary at all**. No sandbox can see it. A quarantine
part-state costs roughly a boolean plus a context-assembly filter — one shipped
implementation proves the substrate is that cheap (§7).

**Item 3 comes with three honest limits** (§7):

1. Rust visibility binds **only `cloop`'s own crates**. A dependency calling
   `std::process::Command` directly escapes it — the `reqwest` finding proves
   this concretely. The boundary is necessary and **not sufficient**.
2. Grandchild coverage rests on OS sandbox *inheritance*, which is not uniform
   across backends.
3. The allow-list is an unbounded, adversarially-maintained artefact, and
   better-resourced vendors have declined to maintain it — four filed breakage
   issues, two closed "not planned". Budget the maintenance, and design the
   transport-level bypass on day one; command-name exclusion lists demonstrably
   fail for wrapped, nested and non-HTTP invocations.

---

## Wave 4 — Subagents (~3–4 weeks)

| # | Item | Cost | Blocked by |
|---|---|---|---|
| 12 | Harness-constructed subagent contracts (per §5.C); clean-context review first | 3–4 weeks | **Item 1** |

Parallel writes are safe **iff** work units are independently verifiable by a
strong automated oracle. Wave 1 builds that oracle. Doing item 12 first unlocks
a capability the evidence says is not yet safe to unlock (§5).

Evidence to keep in view: no model exceeds **50% workspace-permission
precision** across 12 tested models — privilege-granting, not perception, is the
bottleneck. And harness-owned authority intercepts roughly a third of the
documented multi-agent failure surface, not all of it.

---

## Critical path

```
Wave 0 (2w) ──► Wave 1 (4w) ──────────────► Wave 4 (4w)
                    │                          ▲
                    └── Wave 2 (10w) ──────────┘
                              │
                              └── Wave 3 (7w) ──► programmatic tool calling
```

- Item 12 must follow item 1.
- Programmatic tool calling (deferred) must follow item 3 — it needs a
  sandboxed execution surface, and it is the strongest context lever measured.
- Waves 2 and 3 are independent of each other and can run in parallel with
  separate owners.

**If effort is constrained:** ship **Wave 0 + items 1, 2 and 5** — about six
weeks. That covers the Rust landmine, the product differentiator, and the
credential-leak path no sandbox can reach. The remainder is parity work.

---

## Defer

| Item | Revisit when |
|---|---|
| Native LSP | Efficiency-driven. Accuracy delta (+1.4–2.0pp) sits inside the corpus's own ~6pp noise floor; real gains are −17.5% turns, −23.7% tokens. Also: language servers execute arbitrary code, so they must be spawned *inside* the sandbox, not as a documented exception |
| Embeddings / BM25 retrieval | Unnecessary below the change-locality threshold; contested above it. A structural index does not significantly beat competent agentic grep (p = 0.087) |
| Programmatic tool calling | Immediately after item 3 — strongest measured context lever, needs a sandboxed execution surface |
| HTTP+SSE transport, generated multi-language SDKs, worktree isolation as default, artifact GC/dedup | No pre-GA consumer |
| Filesystem-projected tool catalogues | 46.9% measured token reduction; revisit if tool-definition budget becomes binding |
| Subagent decomposition beyond clean-context review | Ship the evidenced pattern first |
| Heartbeat leases, MVCC write layers, `BEGIN CONCURRENT` | Unevidenced — the corpus contains nothing on lease crash-recovery. Do **not** invent one for GA |
| Bidirectional scope-contraction UI | Non-persistent grants deliver most of the benefit structurally |

---

## Refuse

These are categories to eliminate, not parameters to tune.

- **Parallel writers contending on one worktree.** Safe only with a strong
  automated oracle per work unit.
- **Automatic cross-schema-version conversion of stored session state.** Built,
  shipped and deleted by the reference protocol's own maintainers, citing
  "plenty of unrepresentable states" across five enumerated categories.
- **A thick provider-neutral core that normalises reasoning state.**
- **Automatic provider fallback mid-session.** Three independent codebases got
  the reasoning-identity gate wrong; encrypted reasoning state is
  account-bound.
- **Client-side reasoning pruning heuristics.** The provider auto-filters and
  bills only what it uses; a partial edit returns 400.
- **Model-discretionary compaction, delegation or scope expansion.** Prompt-only
  instruction let 30/30 adversarial violations through where harness-gated
  enforcement blocked 120/120 at fixed model.
- **Any write-on-watcher-event path.**
- **In-process MCP hosting.** 5 of 7 production clients run MCP tools with full
  host privileges. Separate sandboxed process or nothing.
- **A smarter permission classifier as the primary safety lever.** Inter-rater
  agreement across reviewer personas is κ = 0.52 — there is no single correct
  label to classify toward.
- **Marketing harness authority as eliminating multi-agent failure.** It
  intercepts the verification-fraud category and bounds blast radius. Nothing
  more.

---

## Decision table — conditions that change the answer

| If `cloop`'s… | is… | then… |
|---|---|---|
| Target repository | < 10K lines, single-issue changes | grep + read + glob only; no index |
| Target repository | changes spanning ≥ 3 files, or cross-repo | add a tree-sitter symbol/call graph; still not embeddings |
| Target repository | whole-repo transforms > 50K lines | agentic-only will fail; require staged decomposition |
| Model tier | frontier | skip edit-format policy work; use the editor-subagent split |
| Model tier | mid / open-weight | format policy matters; expect harness sensitivity |
| Context strategy | strong agentic model | subagent isolation is viable |
| Context strategy | weaker model | keep-latest plus summarisation; **disable** subagent isolation |
| Task type | read / research | subagents fine, with harness-authored contracts |
| Task type | write / mutate | single-threaded writes per worktree, full stop |
| Verification | tests only | present Prove as weak evidence, never as proof |
| Review load | any | budget Land by review *rate*, not action count |

---

## Open questions to watch

These are unresolved in the evidence, not merely unaddressed here. Treat claims
in these areas as provisional.

1. **Harness vs. model ceiling.** One study measures a 23.8-point spread
   attributable to harness at fixed model; another finds model swap dominates
   scaffold swap. The defensible reading is asymmetric — a bad harness can
   destroy a good model; a good harness cannot rescue a weak one.
2. **No delegation-contract ablation exists.** The harness-authored-vs-model-
   improvised reconciliation is inference across two studies with different
   models and tasks, not a controlled result. The settling experiment: fix model
   and task, vary only contract authorship.
3. **The multi-agent failure percentages are category-definition inference**,
   never re-annotated against a harness-owns-authority system.
4. **The escalation-rate inverted-U is an unvalidated simulation** over a
   125-item single-author-labelled dataset.
5. **No evidence exists on lease crash-recovery** for this problem shape — hence
   the recommendation not to build one for GA.
6. **Land cannot catch injection that produces no diff.** It mitigates the
   ships-a-bad-diff subset only; behavioural injection and exfiltration leave no
   artefact for a human to review. This is what item 5 exists to cover.

---

## Traceability

| Wave | Report sections |
|---|---|
| 0 | §6 (format-then-check, tool catalogue), §7 (`reqwest`/configd), §4 (per-model profile) |
| 1 | §1.A, §11, §12.B items 1–2 |
| 2 | §3 (parts, open enums), §8 (reasoning atomicity), §9 (single writer, disposal), §10 (watcher, snapshots) |
| 3 | §7 (sandbox, context-assembly plane) |
| 4 | §5 (subagent contracts) |

Full evidence, per-item Rust costs and cost-of-skipping statements are in
`docs/research/changeloop-agent-runtime-2026.md` §12.
