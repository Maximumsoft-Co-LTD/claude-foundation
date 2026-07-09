# Orchestrator reference — Surface (per-repo) fanout

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The **third, orthogonal fanout axis**: split the read-and-judge phases — **test (11), review (12), security (13)** — one agent per changed repo on a **multi-repo control-plane run** (`state.repos` size > 1). Read this **only** when the changed-repo set is > 1; a single-repo run (the common case) never needs it. Core fanout model (signal recognition, registry, synthesis): `fanout.md`.

**Common shape (all three steps).** One foreground coordinator (`lead` review/security, `qa` test) in its **Surface-coordinator variant** nests one `general-purpose` per-repo helper per repo (Per-repo contract inlined, `repo_root=<r>`, `model="sonnet"`, foreground, one message), then writes the unified artifact in the **same spawn**; **cap 6** (group beyond); each helper single-pass (no inner lens/bucket/category fanout — don't nest the 6-lens or per-category, 6×N); **you** write `state.json` on return; the cycle counter bumps **once per fanout, per run**, never per repo; resume fanout-granular. Helpers are `general-purpose` **on purpose** — a same-message foreground batch of the 5 /dev-worker types self-blocks on the 2nd spawn under `dev-agent-guard.sh` Case 3, but `general-purpose` falls through. (Degradation: a coordinator that can't nest reviews the repos sequentially itself, single-pass.) **Retro (16)** reads across repos too but is multi-repo-aware **single-pass, not surface-fanned**, and holds no `Agent`.

## Per-step decision (shared)

Decide surface fanout **first** in each step — it's the outer loop around everything else.

**Changed-repo set (compute once at step 11; review and security reuse this canonical compute).** The repos this run actually wrote to. Take the **engineer's returned per-repo changed-file list as authoritative** — it knows what it touched, and for `fix` (commits test+fix → *clean tree*, so `git status` shows nothing) it's the *only* reliable signal. Confirm each candidate with `git -C <r> status --porcelain` non-empty OR new commits ahead of `<r>`'s base branch, and **restrict to `state.repos`** (or `[repo_root]` when `repos` is `null`) — don't pull in a sibling carrying stray changes the run never touched.

- **Set size ≤ 1 → single-repo path (unchanged).** Run the rest of the step exactly as written against `repo_root` (or the one changed repo) — the default for every non-control-plane run. Siblings listed in `state.repos` but confirmed unchanged by the engineer's authoritative report → stay here.
- **Set size > 1 → surface fanout.** Apply the **common shape**; coordinator is the step's agent (test → `qa`; review/security → `lead`). Each per-repo helper returns a `### Repo: <r>` block; the coordinator writes the unified artifact (one `### Repo: <path>` subsection per repo) plus the global cross-repo walk.

**Non-primary-repo blocking item (all three steps).** `engineer` (step 10) and ship (step 15) are scoped to the primary `repo_root` (`size-execution.md > Multi-repo boundary`), so a blocking item in a repo ≠ `repo_root` — a failing test (11), a `fix-required` finding (12), or a `high` (13) — **can't be auto-fixed this slice**. Surface it via `AskUserQuestion` (fix manually in that repo, or accept/defer); route **only** `repo_root` items to `engineer`. A `high` you can't auto-fix is still blocking — never downgrade it to fit the boundary.

## Step 11 (test) — deltas

Coordinator `qa` (QA — Execute, below). Each per-repo helper runs that repo's suite over its `test-plan.md` slice; coordinator writes `tests.md`. **Aggregate `passing` iff every repo passes**; any `failing` → run `failing`. **`cycles.test` bumps once for the whole fanout.** For `fix`, the regression contract lives in the one repo holding the bug — only that repo's helper runs the pre-fix verification.

**Visual verification.** Restate the visual instruction in each per-repo qa prompt whose diff touches UI; the coordinator carries per-repo visual findings + deferrals up, and you run the MCP backstop for any repo that deferred.

## Step 12 (review) — deltas

Coordinator `lead` (Lead — Mode B, below). Each per-repo helper reviews only that repo's diff against its `plan.md`/`spec.md` slice; coordinator writes `review.md`. The model-override + lens rules apply **per per-repo helper** (decide per repo from that repo's plan slice); the coordinator keeps the high-stakes-model rule (opus when any repo earned it). **Aggregate `pass` iff every repo passes**; any `fix-required` → run `fix-required`. **`cycles.review` bumps once for the whole fanout, not per repo.** Resume re-runs the whole coordinator.

## Step 13 (security) — deltas

Runs only when the **security-review** set size > 1; coordinator `lead` (Lead — Mode C, below), passing the tripping-repo set. Each per-repo helper returns a block; coordinator writes `security.md`. Set size ≤ 1 → single-pass.

---

# Agent contracts — per-repo + surface-coordinator variants

> These were inline in `lead.md` / `qa.md` but only run on a multi-repo control-plane run, so they live here off the always-loaded agent bodies. The agent docs carry a one-line pointer; the orchestrator (or the coordinator nesting helpers) passes the relevant section to each spawn. A single-repo run never reads this.

**Per-repo variant — shared rules (all three modes).** You are **one per-repo helper** — a `general-purpose` agent the Surface-coordinator nested with this contract inlined, `repo_root=<r>` one of the run's repos (security: one of the tripping repos). Act on **only that repo** (scope every command to `<r>`, e.g. `git -C <r> …`) and **return** a `### Repo: <r>` text block — you do **NOT** write the shared artifact (single-writer; the coordinator owns it). **Single-pass** — no inner lens/bucket/category fanout for one repo. Walk only this repo's slice of plan/spec/test-plan; an AC another repo proves is `not-in-this-repo` so the synthesizer reconciles it globally (anti-bias still binds within the slice). Mode-specific diff source + return fields below.

**Surface-coordinator variant — shared protocol (all three modes).** The orchestrator spawns you as the coordinator (it passes the changed/tripping-repo list; review/security always on `opus`). Run the whole phase in **one spawn**:
1. **Nest one `general-purpose` helper per repo** — foreground, all in one message, each carrying the **Per-repo variant** contract inlined + `repo_root=<r>` + `model="sonnet"` (Case 6 requires the pin on any general-purpose spawn). Dispatch mechanics: **Common shape** above.
2. **Collect** every helper's `### Repo: <r>` block (note `Dispatched-as: general-purpose` once in the artifact), then write the single artifact: one `### Repo: <path>` subsection per repo under the mode's `## Per-repo …` heading. Apply the mode's global walk + aggregate rule + the single **run-level** `Cycle` counter (not per-repo), then return the mode's tuple.

## Lead — Mode B (Review)

**Per-repo:** diff = `git -C <r> diff` + any new commits this run made on `<r>`'s branch — that repo only. Walk the tasks whose `path#anchor` is in `<r>` and ACs satisfiable here (every in-slice task → one row; no "looks good"). **Lens-fanout exception:** lens-fanout (tiered review workers — core 3 at M, full 6 at L/high-stakes) only if *this repo's own* diff is genuinely non-trivial AND the orchestrator's concurrency cap allows; else one direct pass. **Return:** `### Repo: <r>` — Tasks adherence (this repo's tasks), Acceptance-criteria evidence (with `not-in-this-repo` where applicable), Blocking / Non-blocking findings (`path:line`), one-line verdict (`pass` | `fix-required`).

**Coordinator** — write `review.md`, subsections under `## Per-repo review` (mirrors the `## Per-agent findings` shape):
- **Global anti-bias walk:** walk every `spec.md` AC **once across all repos** in the top-level `Acceptance-criteria check` — tick each against whichever repo's block provides the evidence; an AC **no** repo implements is a blocking finding. Same for tasks and `Files touched`.
- **Cross-repo coherence (coupled changes only).** If the changed repos **share a contract** this change touches — a proto/schema/IDL bump, a shared client/server signature (the *coupled* case; an independent sweep has none) — verify it's **consistent across every repo** (same contract version, compatible regenerated signatures/wire shape, no repo left on the old version). A skew is a **blocking** finding — the one defect per-repo isolation structurally can't see. Read the shared artifact across the repos **yourself**; don't infer it from the per-repo blocks alone.
- **Aggregate `Verdict` = `pass` iff every repo passed**; lift all repos' blocking findings into the top-level `### Blocking`.
- **Return:** review.md path + aggregate verdict + cycle + total blocking count + unticked-AC count + repo count.

## Lead — Mode C (Security review)

**Per-repo:** scope the diff to `<r>` (`git -C <r> diff`); walk only the buckets *this repo's* paths trip. **Return:** `### Repo: <r>` — Threat model (this repo), Checklist marks, Blocking (high) / Non-blocking (medium/low) findings (`path:line`), one-line verdict (`pass` | `fix-required`).

**Coordinator** — write `security.md`, subsections under `## Per-repo security` (each = that repo's threat model + findings):
- **Aggregate `Verdict` = `fix-required` iff any repo has a `high`** (a high in any repo is blocking); lift every high into the top-level `### Blocking (severity = high)`, medium/low into Non-blocking.
- `Trigger` lists the union of buckets that fired across all repos.
- **Return:** security.md path + aggregate verdict + total high/medium/low counts + per-repo verdicts + repo count.

## QA — Execute (Test)

**Per-repo:** run that repo's suite inside `<r>` over its `test-plan.md > Coverage plan` rows; honour the **batch-the-run** rule per repo (one suite command in `<r>`, never one Bash call per file). **For `fix`:** only the repo holding the bug runs the regression pre-fix verification (`test-plan.md > Regression contract`); a tester for a repo with no regression contract skips that step. **Return:** `### Repo: <r>` — Results table, Acceptance-criteria coverage (this repo's slice), any Failing, this repo's diff-coverage vs floor, **any Visual verification findings or a `visual: deferred to orchestrator MCP backstop` note (when this repo's diff touches UI)**, one-line status (`passing` | `failing` — a blocking visual defect makes it `failing`).

**Coordinator** — write `tests.md`, subsections under `## Per-repo results` (each = that repo's results + coverage):
- **Global AC-coverage walk:** map every `spec.md` AC **once across all repos** to whichever repo's actual test proves it (including each AC's boundary/error scenario and `measured:` target) — an AC no repo's tests cover is an unmapped-AC finding.
- **Cross-repo coherence (coupled changes).** If the changed repos share a contract this change touches, confirm a **cross-repo integration/e2e test actually exercises the shared boundary** (a client in one repo against the server in another) — per-repo suites run in isolation and pass even when two repos sit on incompatible contract versions. A failing cross-repo test is `failing` like any other; the **absence** of any such test on a coupled change is a coverage gap — record it, don't let isolated green suites imply the boundary is proven.
- **Aggregate `Status` = `passing` iff every repo passed**; any `failing` ⇒ run `failing`. Collect all failures into the top-level `Failing`.
- Carry each repo's below-floor coverage rows, edge-case gaps, and `[plan-contradiction]` findings up so the orchestrator escalates them once. **Carry each repo's Visual verification findings up too** — surface any blocking visual defect (→ `failing`) and any `visual: deferred to orchestrator MCP backstop` note; a UI defect in a non-primary repo must not vanish in synthesis.
- **Return:** tests.md path + aggregate status + cycle + total failure count + unmapped-AC count + per-repo coverage summary + repo count.
