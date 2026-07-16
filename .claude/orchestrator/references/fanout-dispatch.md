# Orchestrator reference — Fanout dispatch

> Loaded on demand by `.claude/orchestrator.md` — read the section you need, not the file: **§1 + §2** on a `FANOUT_REQUESTED:` first line or any fanout dispatch; **§3** when `lead` authors the `## Fanout plan` block or the gate steers it; **§4 only** when the changed-repo set is > 1. Implement consumer contract → `implement-fanout.md`. A single-repo XS/S run with no fanout signal needs none of this.

## 1. Dispatch mechanics

Main agent + `pm`/`lead`/`qa`/`engineer` can request parallel team-agent fanout. Full pattern: `.claude/skills/fanout-team-agents/SKILL.md`; this is the consumer-side contract. **Direct nesting is primary (v2.1.172+)** — those workers + self-splitting `team-*` hold `Agent` and self-dispatch helpers (each has a "Recruit help…" section), so a worker may already have fanned out. **Prefer it for all read/research fanouts (plan/review/security/test)** — one spawn vs the signal's *double* spawn (worker → signal → dispatch → re-spawn to synthesise); a too-expensive fanout still fires via direct nesting, never single-pass. The `FANOUT_REQUESTED:` signal is the **fallback** (worker prefers you dispatch) and earns its keep for **background implement-fanout** (phase-granular `impl_phases_done` resume) + as the **registry-fallback**. You still lead **plan-prep push (Plan)** — `lead` dedups against it.

**One level of split.** A nested helper never re-fans-out — every helper contract is single-pass (§4 common shape; implement phase-helpers: `implement-fanout.md > Guardrails`' literal "You are a nested helper…" line).

### Signal recognition

After every sub-agent return, scan the **first line**: case-insensitive `FANOUT_REQ` → validate against the regex; `BLOCKER:` → surface to user; `SIZE_UPGRADE:`/`FIELD_UPGRADE:` → `## Size-aware execution` (`FIELD_UPGRADE` also: record `field=brownfield`, backfill understand/lock artifacts to owners); else → success. Before advancing, run the step's **Return check** if defined — **only** on the primary worker return (`pm`/`lead`/`engineer`/`qa`/`retro`), never intermediate `team-*`; it's a presence/shape tripwire (one corrective re-spawn, then `AskUserQuestion`), not a quality review.

```text
^FANOUT_REQUESTED: implement:[a-z0-9,\-]+$
```

**`implement` is the only signal shape** (v2.8.0 cut): every splittable worker holds `Agent` and direct-nests its own read/research/review helpers (dispatch-mechanism contract), so the old `review|security:|plan:|test:|research:` signal shapes were a redundant second path — implement keeps the signal because background phase-dispatch needs orchestrator-owned resume granularity (`implement-fanout.md`). A worker signalling a retired shape gets ONE corrective re-spawn ("dispatch helpers yourself per `fanout-team-agents > references/dispatch-mechanism.md`"); a second signal → BLOCKER. A first line matching `FANOUT_REQ` but not the regex (typos/casing/payload errors) is a **BLOCKER** — surface via `AskUserQuestion` with the offending line + the valid shape. Never silently fall through.

### Fanout points (Interview → Security)

**Every fanout point:** (a) honours gated `state.json > fanout_plan.<phase>` — levers, override limits, and the absent-entry default are §3 > The gate owns it; (b) prefers direct nesting for read/research; (c) appends one `state.json > fanout_log` entry **only when eligible or fired** (ineligible points log nothing) — format + write discipline in §3 > Telemetry.

Each point dispatches **its own** worker set (this table is authoritative); each prompt is **self-contained** (no inherited context) — scope (paths/diff), goal (1 sentence), constraints (what NOT to do), output shape (from `.claude/agents/team-<role>.md`). **Dispatch all workers in one message** — the orchestrator's for Interview and Implement (the only two the orchestrator still dispatches); the worker's own for Spec/Plan/Test/Review/Security, which now direct-nest (concurrent only within one turn; sequential turns aren't parallel). A worker that can't direct-nest returns `BLOCKER:` naming why — no signal escape for these five.

| Phase / shape | Eligible when | Dispatch |
|---|---|---|
| **Interview — spec-prep** (main-agent-led, opt-in, no signal) | 2+ of {existing code named, integration points in disjoint surfaces, APIs, security paths, unfamiliar domain terms, 2+ independent research Qs} **and** research substantial; always single-pass XS/S + pure-greenfield | One `team-codebase-explorer` per codebase Q + one `team-best-practice-researcher` per best-practice Q; else main agent interviews off its own read |
| **Spec — research** (`pm` direct-nests, no signal) | pm needs research after drafting | One `team-codebase-explorer` per `codebase-*` Q + one `team-best-practice-researcher` per `best-practice-*` Q. pm self-dispatches **after a draft `spec.md`** (draft-first), then reads its own draft + the findings and refines in place — no orchestrator round-trip |
| **Plan** (push-prep + `lead` direct-nest pull, no signal) | S/M/L existing-code, independently-researchable points clearing the cost bar; single-pass XS / pure-greenfield / one change / **`context_built` (context.md already maps current state — pass its path to `lead`, don't re-spawn explorers)** | **(a) Push-prep (preferred):** before `lead`, one `team-codebase-explorer` (haiku) per integration point for M/L with ≥2 points **in disjoint surfaces**, then spawn `lead` once with findings. **(b) Pull (direct nest):** `lead` self-dispatches the residual `team-best-practice-researcher` for what prep missed (usually best-practice; skips explorer for points push-prep mapped) — no signal, no orchestrator round-trip |
| **Implement — `implement:<parallel-phase-list>`** (`engineer` Mode A, **feat-only**, orchestrator-dispatched signal — the only remaining shape) | plan declares ≥2 `Parallelizable: yes` phases | Gate `Type==feat`, verify pairwise-disjoint, write-only phase-engineers (background) → foreground integration engineer. **Full 5-substep consumer contract → `implement-fanout.md > Orchestrator consumer contract`** |
| **Test** (`qa` direct-nests, no signal) | ≥2 of {unit, integration, e2e} **and** any category has enough tests to repay coordination | `qa` self-dispatches one `team-pr-test-analyzer` per category — no orchestrator round-trip |
| **Review** (`lead` Mode B direct-nests, no signal) | non-trivial diff (large, cross-module, critical, type/contract/test-sensitive, or uncertain) clearing the cost bar; single-pass small/low-risk | Tiered review workers, self-dispatched by `lead`: **core 3** at M/moderate (`team-code-reviewer`, `team-pr-test-analyzer`, `team-silent-failure-hunter`), **full 4** at L/high-stakes (+ `team-type-design-analyzer`; comment-accuracy + simplification are lenses inside `team-code-reviewer`) |
| **Security** (`lead` Mode C direct-nests, no signal) | ≥2 buckets trip **and** per-bucket work substantial; single-pass one bucket / quick checks | `lead` self-dispatches one `team-code-reviewer` per bucket, focused threat-model prompt scoped to that bucket's paths — no orchestrator round-trip |

**Surface axis (multi-repo, `state.repos` size > 1):** test/review/security also split **per repo** — orchestrator-led, no signal (you know the repo list at dispatch) → §4.

### Re-spawn for synthesis (implement only — the sole remaining orchestrator round-trip)

Every other point (Spec-research, Plan-pull, Test, Review, Security) direct-nests — the worker synthesises its own return in the same spawn, no orchestrator re-spawn. When every phase-engineer returns, re-spawn the calling `engineer` (Integration variant) with: the phase outputs concatenated (one labelled block each); a `Dispatched-as:` map (`team-<role> → <actual subagent_type>`) for the mandatory provenance line on each `### team-<role>` subsection (`.workflow/_templates/review.md > Per-agent findings`), if any phase-engineer itself nested `team-*` helpers; and only genuinely **prompt-only** context (the re-spawn inherits none — prefer durable artifacts: `tasks.md`/`plan.md` disk inputs carry requirements, so re-pass only e.g. phase-specific findings being addressed). The re-spawned `engineer` does the integration pass (wire shared glue, install deps, run every `verify:`, tick the ACs).

## 2. Registry preflight — decide once, record, thread

`team-*` is **session-scoped**: files created/edited mid-session aren't discoverable until restart, so a spawn can fail `Agent type 'team-<role>' not found`. Handle **once per run**; **never let `not found` retreat to single-pass** — a registry miss never downgrades a planned fanout.
- **First `team-*` dispatch is the probe** → record `state.json > team_registry`: `"live"` if it resolves, `"inline-fallback"` on `not found` (no fanout → stays `null`); later fanouts read it without re-probing.
- **On `inline-fallback`, reissue inline** — every spawn `subagent_type="general-purpose"` + `model="sonnet"` (Case 6 blocks an unpinned general-purpose spawn; the sonnet floor governs the fallback even for a `haiku`-tier role) + the worker's role contract (`.claude/agents/team-<role>.md`) read into the prompt; parallelism preserved (one message, N calls); record actual `subagent_type` per spawn for the `Dispatched-as:` map.
- **Thread it** — every `pm`/`lead`/`qa` spawn carries `team_registry: <live|inline-fallback|unknown>`. (`engineer`'s implement helpers are `engineer`-type — registry-exempt; pass it to `engineer` only if it may recruit read-only `team-*` helpers.) While `unknown`, the worker tries `team-*`, falls to inline on `not found`, **reports the path used**; on any such return while `null`/`unknown`, write that value before the next spawn. Session restart also refreshes the registry (user action). Full caveat: `.claude/skills/fanout-team-agents/SKILL.md > Operational caveats`.

## 3. The gate-steerable fanout plan

Canonical definition — `plan.md` (the section), `lead.md` (authoring), `orchestrator.md` (gate lever + telemetry + dispatch), and `retro.md` (surfacing the log) point here rather than restating it.

`/dev` is single-pass-first (`orchestrator.md > Single-pass-first`); the **Fanout plan** makes that stance explicit and gated — the sibling of the per-task phase plan (`WORKFLOW.md > Per-task phase plan`). `lead` declares the planned fanout strategy (single-pass by default, fanout only where the work clears the cost bar) in a `## Fanout plan` block in `plan.md`, the gate surfaces it for sign-off, and `state.json` records both the gated intent and the runtime outcome.

**What `lead` declares** — one row per **gate-authorized Phase-2 fanout phase**: **Review** (the 6 lenses), **Security** (per threat bucket), **Test** (per category), **Implement** (per parallelizable feat phase). These are what the gate is about to authorize for Phase 2, so they are what the user can steer. Each row: `Fanout` (yes/no) · `Workers (×N)` · `Reason`. Review/security/test rows are *predictions* (no diff exists yet) from the planned scope; the **Implement** row is **derived from the `Parallelizable: yes` phase markers in `tasks.md`** — it mirrors them (those markers are the single source of truth the runtime reads), never an independent claim. **Plan-fanout and spec-prep-fanout run *before* the gate** (Plan and Interview), so they aren't gate-steerable or in this table — their provenance lives in `## Research notes` / `spec.md > Discovery notes`, and their outcome is still in `fanout_log` (telemetry, below).

```
## Fanout plan
| Phase     | Fanout | Workers (×N)          | Reason          |
|-----------|--------|-----------------------|-----------------|
| Review    | yes    | 6 review lenses ×1    | cross-module    |
| Security  | yes    | code-reviewer ×2      | 2 buckets trip  |
| Test      | no     | —                     | 1 category      |
| Implement | no     | —                     | no ∥ phases     |
```

At XS / pure-greenfield / a single straightforward change the whole block is one line — `No fanout — single-pass (XS).`

**Review defaults to `yes` at M/L** (core-3 at M, full-4 at L — `references/lead.md > Review fanout`): a Review row of `no` on an M/L run needs a real Reason, not a cost reflex. The other three rows stay single-pass-first.

**Same worker, N instances — horizontal scaling is first-class.** A fanout is **not** one-of-each-worker. The plan-prep, security, and test axes spawn **N copies of the *same* `team-*` worker** — one per independent unit (the §1 table's per-integration-point / per-bucket / per-category rows), which is what the `×N` column records. Only Review spawns six *different* lenses ×1. Cap the total at **6 concurrent** and group beyond it; never spawn N for N's sake. **For the plan-prep (codebase-explorer) axis, "independent unit" means a *disjoint surface* — a separate module/folder/repo, not raw integration-point count:** two points inside one cohesive module is a single serial `lead` walk; the parallel cold-start only repays when surfaces are genuinely separate (the multi-repo control-plane run is the canonical strong case). Canonical trigger: `orchestrator.md > Plan`.

**The gate owns it.** Surfaced alongside the phase plan; levers `fanout <phase> on` / `fanout <phase> off`, recorded in `state.json > fanout_plan.<review|security|test|implement>`. `off` forces single-pass; `on` forces the fanout even when the runtime heuristic would skip it (the user accepts the cost). A gated `on`/`off` is a **soft-guardrail override only** — it cannot defeat: (a) the **hard feasibility guardrails** — a forced `on` can't split work that isn't independent, and `fanout implement on` only **re-enables** parallel phases the plan already declared, never manufactures them; (b) the **size-tier machinery** — a forced `fanout review on` on an XS/S run (where review-fanout is refused as too heavy for the tier) becomes a `SIZE_UPGRADE` prompt, not a silent honour. When a forced `on` is blocked either way, surface it and record the blocked outcome in `fanout_log` (`fired:false, path:single, reason:"forced-on blocked: <guardrail>"`). **Runtime can still diverge from a signed-off prediction:** a phase approved `Fanout: yes` may still run single-pass (e.g. the diff turned out small) — the **runtime heuristic wins and the divergence is logged** (not re-surfaced at the gate; a forced `on` pins it). Absent a gated entry, the runtime heuristic decides (`orchestrator.md > Where fanout fires`).

**Telemetry — outcomes are recorded, non-events are not.** A fanout point appends one entry to `state.json > fanout_log` as part of that step's terminal write **only when the phase was eligible or fired** (re-read the array and append — never regenerate from memory, same discipline as `impl_phases_done`): `{phase, eligible, fired, path, n, reason}`, keyed by **phase name**, `path` ∈ `direct` (self-dispatched direct-nesting) / `signal` (`FANOUT_REQUESTED:`) / `single` (evaluated but stayed single-pass). An ineligible point logs **nothing** — `retro` reads absence as not-eligible, and mid-run bookkeeping stays minimal. The log still covers more than the gated `fanout_plan` when eligibility arises at `spec-prep` (Interview) or `plan` (Plan), which run before the gate (no `fanout_plan` key). `retro` surfaces it so under-firing is a measurable finding, not a vibe, and a gated-intent-vs-outcome divergence shows up with its reason.

**Registry & dispatch.** Live `team-*` vs inline fallback = the §2 preflight (once per run, `state.json > team_registry`); dispatch-path preference (direct-nesting primary; signal fallback + background-implement path — `fanout-team-agents > Two dispatch paths`) = §1.

## 4. Surface (per-repo) fanout

> The **third, orthogonal fanout axis**: split the read-and-judge phases — **test, review, security** — one agent per changed repo on a **multi-repo control-plane run** (`state.repos` size > 1). Read **only** when the changed-repo set is > 1; a single-repo run (the common case) never needs it.

**Common shape (all three steps).** One foreground coordinator (`lead` review/security, `qa` test) in its **Surface-coordinator variant** nests one `general-purpose` per-repo helper per repo (Per-repo contract inlined, `repo_root=<r>`, `model="sonnet"`, foreground, one message), then writes the unified artifact in the **same spawn**; **cap 6** (group beyond); each helper single-pass (no inner lens/bucket/category fanout — don't nest the 6-lens or per-category, 6×N); **you** write `state.json` on return; the cycle counter bumps **once per fanout, per run**, never per repo; resume fanout-granular. Helpers are `general-purpose` **on purpose** — a same-message foreground batch of the 5 /dev-worker types self-blocks on the 2nd spawn under `dev-agent-guard.sh` Case 3, but `general-purpose` falls through. (Degradation: a coordinator that can't nest reviews the repos sequentially itself, single-pass.) **Retro** reads across repos too but is multi-repo-aware **single-pass, not surface-fanned**, and holds no `Agent`.

### Per-step decision (shared)

Decide surface fanout **first** in each step — it's the outer loop around everything else.

**Changed-repo set (compute once at Test; review and security reuse this canonical compute).** The repos this run actually wrote to. Take the **engineer's returned per-repo changed-file list as authoritative** — it knows what it touched, and for `fix` (commits test+fix → *clean tree*, so `git status` shows nothing) it's the *only* reliable signal. Confirm each candidate with `git -C <r> status --porcelain` non-empty OR new commits ahead of `<r>`'s base branch, and **restrict to `state.repos`** (or `[repo_root]` when `repos` is `null`) — don't pull in a sibling carrying stray changes the run never touched.

- **Set size ≤ 1 → single-repo path (unchanged).** Run the rest of the step exactly as written against `repo_root` (or the one changed repo) — the default for every non-control-plane run. Siblings listed in `state.repos` but confirmed unchanged by the engineer's authoritative report → stay here.
- **Set size > 1 → surface fanout.** Apply the **common shape**; coordinator is the step's agent (test → `qa`; review/security → `lead`). Each per-repo helper returns a `### Repo: <r>` block; the coordinator writes the unified artifact (one `### Repo: <path>` subsection per repo) plus the global cross-repo walk.

**Non-primary-repo blocking item (all three steps).** `engineer` (Implement) and ship (Ship) are scoped to the primary `repo_root` (`size-execution.md > Multi-repo boundary`), so a blocking item in a repo ≠ `repo_root` — a failing test (Test), a `fix-required` finding (Review), or a `high` (Security) — **can't be auto-fixed this slice**. Surface it via `AskUserQuestion` (fix manually in that repo, or accept/defer); route **only** `repo_root` items to `engineer`. A `high` you can't auto-fix is still blocking — never downgrade it to fit the boundary.

### Test — deltas

Coordinator `qa` (QA — Execute, below). Each per-repo helper runs that repo's suite over its `test-plan.md` slice; coordinator writes `tests.md`. **Aggregate `passing` iff every repo passes**; any `failing` → run `failing`. **`cycles.test` bumps once for the whole fanout.** For `fix`, the regression contract lives in the one repo holding the bug — only that repo's helper runs the pre-fix verification.

**Visual verification.** Restate the visual instruction in each per-repo qa prompt whose diff touches UI; the coordinator carries per-repo visual findings + deferrals up, and you run the MCP backstop for any repo that deferred.

### Review — deltas

Coordinator `lead` (Lead — Mode B, below). Each per-repo helper reviews only that repo's diff against its `plan.md`/`spec.md` slice; coordinator writes `review.md`. The model-override + lens rules apply **per per-repo helper** (decide per repo from that repo's plan slice); the coordinator keeps the high-stakes-model rule (opus when any repo earned it). **Aggregate `pass` iff every repo passes**; any `fix-required` → run `fix-required`. **`cycles.review` bumps once for the whole fanout, not per repo.** Resume re-runs the whole coordinator.

### Security — deltas

Runs only when the **security-review** set size > 1; coordinator `lead` (Lead — Mode C, below), passing the tripping-repo set. Each per-repo helper returns a block; coordinator writes `security.md`. Set size ≤ 1 → single-pass.

---

### Agent contracts — per-repo + surface-coordinator variants

> These were inline in `lead.md` / `qa.md` but only run on a multi-repo control-plane run, so they live here off the always-loaded agent bodies. The agent docs carry a one-line pointer; the orchestrator (or the coordinator nesting helpers) passes the relevant section to each spawn. A single-repo run never reads this.

**Per-repo variant — shared rules (all three modes).** You are **one per-repo helper** — a `general-purpose` agent the Surface-coordinator nested with this contract inlined, `repo_root=<r>` one of the run's repos (security: one of the tripping repos). Act on **only that repo** (scope every command to `<r>`, e.g. `git -C <r> …`) and **return** a `### Repo: <r>` text block — you do **NOT** write the shared artifact (single-writer; the coordinator owns it). **Single-pass** — no inner lens/bucket/category fanout for one repo. Walk only this repo's slice of plan/spec/test-plan; an AC another repo proves is `not-in-this-repo` so the synthesizer reconciles it globally (anti-bias still binds within the slice). Mode-specific diff source + return fields below.

**Surface-coordinator variant — shared protocol (all three modes).** The orchestrator spawns you as the coordinator (it passes the changed/tripping-repo list; the security coordinator is always `opus` — Mode C rule; the review coordinator is `opus` only when any repo earned it per the Review delta below, else the sonnet default — `model-tiers.md`). Run the whole phase in **one spawn**:
1. **Nest one `general-purpose` helper per repo** — foreground, all in one message, each carrying the **Per-repo variant** contract inlined + `repo_root=<r>` + `model="sonnet"` (Case 6 requires the pin on any general-purpose spawn). Dispatch mechanics: **Common shape** above.
2. **Collect** every helper's `### Repo: <r>` block (note `Dispatched-as: general-purpose` once in the artifact), then write the single artifact: one `### Repo: <path>` subsection per repo under the mode's `## Per-repo …` heading. Apply the mode's global walk + aggregate rule + the single **run-level** `Cycle` counter (not per-repo), then return the mode's tuple.

#### Lead — Mode B (Review)

**Per-repo:** diff = `git -C <r> diff` + any new commits this run made on `<r>`'s branch — that repo only. Walk the tasks whose `path#anchor` is in `<r>` and ACs satisfiable here (every in-slice task → one row; no "looks good"). **Lens-fanout exception:** lens-fanout (tiered review workers — core 3 at M, full 6 at L/high-stakes) only if *this repo's own* diff is genuinely non-trivial AND the orchestrator's concurrency cap allows; else one direct pass. **Return:** `### Repo: <r>` — Tasks adherence (this repo's tasks), Acceptance-criteria evidence (with `not-in-this-repo` where applicable), Blocking / Non-blocking findings (`path:line`), one-line verdict (`pass` | `fix-required`).

**Coordinator** — write `review.md`, subsections under `## Per-repo review` (mirrors the `## Per-agent findings` shape):
- **Global anti-bias walk:** walk every `spec.md` AC **once across all repos** in the top-level `Acceptance-criteria check` — tick each against whichever repo's block provides the evidence; an AC **no** repo implements is a blocking finding. Same for tasks and `Files touched`.
- **Cross-repo coherence (coupled changes only).** If the changed repos **share a contract** this change touches — a proto/schema/IDL bump, a shared client/server signature (the *coupled* case; an independent sweep has none) — verify it's **consistent across every repo** (same contract version, compatible regenerated signatures/wire shape, no repo left on the old version). A skew is a **blocking** finding — the one defect per-repo isolation structurally can't see. Read the shared artifact across the repos **yourself**; don't infer it from the per-repo blocks alone.
- **Aggregate `Verdict` = `pass` iff every repo passed**; lift all repos' blocking findings into the top-level `### Blocking`.
- **Return:** review.md path + aggregate verdict + cycle + total blocking count + unticked-AC count + repo count.

#### Lead — Mode C (Security review)

**Per-repo:** scope the diff to `<r>` (`git -C <r> diff`); walk only the buckets *this repo's* paths trip. **Return:** `### Repo: <r>` — Threat model (this repo), Checklist marks, Blocking (high) / Non-blocking (medium/low) findings (`path:line`), one-line verdict (`pass` | `fix-required`).

**Coordinator** — write `security.md`, subsections under `## Per-repo security` (each = that repo's threat model + findings):
- **Aggregate `Verdict` = `fix-required` iff any repo has a `high`** (a high in any repo is blocking); lift every high into the top-level `### Blocking (severity = high)`, medium/low into Non-blocking.
- `Trigger` lists the union of buckets that fired across all repos.
- **Return:** security.md path + aggregate verdict + total high/medium/low counts + per-repo verdicts + repo count.

#### QA — Execute (Test)

**Per-repo:** run that repo's suite inside `<r>` over its `test-plan.md > Coverage plan` rows; honour the **batch-the-run** rule per repo (one suite command in `<r>`, never one Bash call per file). **For `fix`:** only the repo holding the bug runs the regression pre-fix verification (`test-plan.md > Regression contract`); a tester for a repo with no regression contract skips that step. **Return:** `### Repo: <r>` — Results table, Acceptance-criteria coverage (this repo's slice), any Failing, this repo's diff-coverage vs floor, **any Visual verification findings or a `visual: deferred to orchestrator MCP backstop` note (when this repo's diff touches UI)**, one-line status (`passing` | `failing` — a blocking visual defect makes it `failing`).

**Coordinator** — write `tests.md`, subsections under `## Per-repo results` (each = that repo's results + coverage):
- **Global AC-coverage walk:** map every `spec.md` AC **once across all repos** to whichever repo's actual test proves it (including each AC's boundary/error scenario and `measured:` target) — an AC no repo's tests cover is an unmapped-AC finding.
- **Cross-repo coherence (coupled changes).** If the changed repos share a contract this change touches, confirm a **cross-repo integration/e2e test actually exercises the shared boundary** (a client in one repo against the server in another) — per-repo suites run in isolation and pass even when two repos sit on incompatible contract versions. A failing cross-repo test is `failing` like any other; the **absence** of any such test on a coupled change is a coverage gap — record it, don't let isolated green suites imply the boundary is proven.
- **Aggregate `Status` = `passing` iff every repo passed**; any `failing` ⇒ run `failing`. Collect all failures into the top-level `Failing`.
- Carry each repo's below-floor coverage rows, edge-case gaps, and `[plan-contradiction]` findings up so the orchestrator escalates them once. **Carry each repo's Visual verification findings up too** — surface any blocking visual defect (→ `failing`) and any `visual: deferred to orchestrator MCP backstop` note; a UI defect in a non-primary repo must not vanish in synthesis.
- **Return:** tests.md path + aggregate status + cycle + total failure count + unmapped-AC count + per-repo coverage summary + repo count.
