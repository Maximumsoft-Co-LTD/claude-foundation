# Orchestrator reference — Surface (per-repo) fanout

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The **third, orthogonal fanout axis**: split the read-and-judge phases — **review (step 11), security (step 12), test (step 13)** — one agent per changed repo on a **multi-repo control-plane run** (`state.repos` size > 1). Read this **only** when the run's changed-repo set is > 1; a single-repo run (the common case) never needs it. Shared dispatch mechanics live in `.claude/orchestrator/references/fanout.md > Surface (per-repo) fanout`; this file holds the per-step decisions and the non-primary-repo dead-ends that were inline in steps 11/12/13.
>
> **Common surface-fanout shape (steps 11/12/13).** Each step: compute the changed-repo set; ≤ 1 → single-repo path below; > 1 → spawn **ONE** foreground coordinator (`lead` for review/security, `qa` for test) in its **Surface-coordinator variant**, passing the relevant repo set. The coordinator nests **one `general-purpose` per-repo helper per repo** (Per-repo variant contract inlined, `repo_root=<r>`, foreground, one message), collects the per-repo blocks, and writes the single unified artifact in the **same spawn** — no synthesis re-spawn. Helpers are `general-purpose` (**not** `lead`/`qa`) so the same-message batch clears guard Case 3 (rationale: `## Fanout dispatch > Surface (per-repo) fanout > Dispatch`). **Cap 6** nested helpers; group in ≤ 6 beyond. Each per-repo helper is **single-pass** — never nest that phase's own fanout (6-lens review, per-bucket security, per-category test) inside a per-repo helper. **You** write `state.json` when the coordinator returns; resume is **fanout-granular** (re-run the whole coordinator; no per-repo done-tracking). Each step's distinct rules follow.

## Step 11 (review) — surface fanout decision

Otherwise: **Surface (per-repo) fanout — decide this FIRST, it is the outer loop around everything else in this step.** Compute the **changed-repo set**: the repos this run actually wrote to. **Take the engineer's returned per-repo changed-file list as the authoritative source** — it knows what it touched, and for `fix` (which commits test+fix and leaves a *clean tree*, so `git status` shows nothing) it is the *only* reliable signal. Confirm each candidate with `git -C <r> status --porcelain` non-empty OR new commits ahead of `<r>`'s base branch, and **restrict to repos in `state.repos`** (or `[repo_root]` when `repos` is `null`) so an unrelated sibling repo carrying stray local changes the run never touched is not pulled in. (Leaning on the engineer's report rather than a bare git scan closes both the `fix` clean-tree case and the stray-sibling case.) Apply the **common surface-fanout shape** above; coordinator is `lead` in its **Surface-coordinator variant** (§ Lead — Mode B (Review), below).
    - **Set size ≤ 1 → single-repo path (unchanged).** Run the rest of this step exactly as written below against `repo_root` (or the one changed repo) — the default for every non-control-plane run. If `state.repos` lists sibling repos but the engineer's authoritative report confirms only the primary `repo_root` changed, stay here — don't pay the surface coordinator cost just because sibling repos exist.
    - **Set size > 1 → surface fanout.** Each per-repo helper reviews only that repo's diff against its slice of `plan.md`/`spec.md` and returns a per-repo block; the coordinator writes the unified `review.md` (one `### Repo: <path>` subsection per repo under `## Per-repo review`, plus the global anti-bias walk ticking each `spec.md` AC against whichever repo's block implements it). The model-override + lens rules in the prose below apply **to each per-repo helper** (decide per repo from that repo's plan slice); the coordinator keeps the high-stakes-model rule (opus when any repo earned it). Resume re-runs the whole coordinator — review writes no production code, so re-reviewing is safe and cheap (no `review_repos_done` analog to `impl_phases_done`). **Aggregate verdict = `pass` iff every repo passes**; any repo `fix-required` makes the run `fix-required`. **`cycles.review` bumps once for the whole fanout, not per repo.** The verdict handling below (fix-required → engineer; ≥ 2 cycles → escalate) operates on the aggregate exactly as in the single-repo path.

## Step 11 — non-primary-repo blocking finding

    - **(Surface fanout) A blocking finding in a NON-primary repo has no auto-fix path this slice.** `engineer` (step 10) and ship (step 15) are scoped to the primary `repo_root` (`WORKFLOW.md > Multi-repo boundary`), so they can only remediate findings *in* `repo_root`. When the aggregate `fix-required` is driven by a finding in a repo ≠ `repo_root`, **do not route it to `engineer`** (it would edit the wrong repo) — surface it to the user via `AskUserQuestion` (fix manually in that repo, or accept/defer), and route only the `repo_root` findings to `engineer`. Parallel review can now *find* cross-repo problems faster than this slice can *fix* them.

## Step 12 (security) — surface fanout

      - **Surface (per-repo) fanout (same common shape as steps 11/13).** Security-review set size > 1 → coordinator is `lead` in its **Surface-coordinator variant** (§ Lead — Mode C (Security review), below), passing the tripping-repo set; each per-repo helper returns a per-repo block and the coordinator writes the unified `security.md` (one `### Repo: <path>` subsection each). Set size ≤ 1 → single-pass below.

## Step 12 — non-primary-repo high finding

      - **(Surface fanout) A `high` finding in a NON-primary repo can't be auto-fixed this slice** — `engineer` is scoped to the primary `repo_root` (same boundary as steps 11/13, `WORKFLOW.md > Multi-repo boundary`). Surface it to the user via `AskUserQuestion` (fix manually in that repo, or accept the risk) instead of routing to `engineer`; route only `repo_root` high findings to `engineer`. A `high` you can't auto-fix is still blocking — never downgrade it to fit the boundary.

## Step 13 (test) — surface fanout

      - **Surface (per-repo) fanout — decide first (same common shape as step 11).** Compute the changed-repo set exactly as step 11 — the engineer's reported per-repo changed files (authoritative, and the only reliable signal for `fix`'s clean tree), confirmed by git, restricted to `state.repos` (else `[repo_root]`). **Set size > 1 → surface fanout**: coordinator is `qa` in its **Surface-coordinator variant** (§ QA — Execute (Test), below), passing the changed-repo set; each per-repo helper runs that repo's suite over its slice of `test-plan.md` and returns a per-repo result block, and the coordinator writes the unified `tests.md` (one `### Repo: <path>` subsection per repo under `## Per-repo results`, plus the global AC-coverage walk mapping each `spec.md` AC to whichever repo's tests prove it). **Aggregate status = `passing` iff every repo passes**; any repo `failing` makes the run `failing`. **`cycles.test` bumps once for the whole fanout, not per repo.** The cycle/coverage/edge-gap handling below operates on the aggregate. For `fix`, the regression contract lives in the one repo that holds the bug — only that repo's per-repo helper runs the pre-fix verification. **Set size ≤ 1 → single-repo path (unchanged):** continue below against `repo_root`.

## Step 13 — non-primary-repo failing test

      - **(Surface fanout) A failing test in a NON-primary repo can't be auto-fixed this slice** — `engineer` is scoped to the primary `repo_root` (same boundary as step 11 / `WORKFLOW.md > Multi-repo boundary`). When the aggregate `failing` is driven by a repo ≠ `repo_root`, surface it to the user via `AskUserQuestion` (fix manually in that repo, or accept/defer) instead of routing to `engineer`; route only `repo_root` failures to `engineer`.

## Step 13 — visual verification in multi-repo fanout

**In surface (multi-repo) fanout**, restate the visual instruction in each per-repo qa prompt whose repo's diff touches UI; the coordinator carries per-repo visual findings + deferrals up (§ QA — Execute below), and you run this backstop for any repo that deferred.

---

# Agent contracts — per-repo + surface-coordinator variants

> These were inline in `lead.md` / `qa.md` but only ever run on a multi-repo control-plane run, so they were moved here off the always-loaded agent bodies. The agent docs carry a one-line pointer; the orchestrator (or the coordinator nesting helpers) passes the relevant § to each spawn. A single-repo run never reads this.

## Lead — Mode B (Review)

### Per-repo variant (one repo of a multi-repo run)

When you are dispatched as **one per-repo reviewer** of a control-plane run's surface fanout (step 11) — a `general-purpose` helper nested by the Surface-coordinator with this contract inlined — `repo_root=<r>` is one of `state.repos`. Review **only that repo's diff** and **return** a per-repo findings block; you do **NOT** write the shared `review.md` (single-writer; the Surface-coordinator owns it).

- The diff is `git -C <r> diff` plus any new commits this run made on the branch in `<r>` — that repo only.
- Walk the **slice** of `plan.md`/`spec.md` this repo implements: plan steps whose `path#anchor` is in `<r>`, and ACs satisfiable here. Do **not** fail an AC that another repo implements — mark it `not-in-this-repo` so the synthesizer reconciles it globally. The anti-bias discipline still binds within your slice (every in-slice step → one row; no "looks good").
- **Single-pass by default.** Only lens-fanout (the tiered review workers — core 3 at M, full 6 at L/high-stakes) if *this repo's own* diff is genuinely non-trivial AND the orchestrator's concurrency cap allows — otherwise one direct pass.
- **Return shape (text, not a file):** a `### Repo: <r>` block — Plan adherence (this repo's steps), Acceptance-criteria evidence (this repo's slice, with `not-in-this-repo` where applicable), Blocking / Non-blocking findings (`path:line`), and a one-line per-repo verdict (`pass` | `fix-required`).

### Surface-coordinator variant (nests per-repo helpers, then writes the unified review.md)

When the orchestrator spawns you as the **surface-fanout coordinator** for a multi-repo run (it passes the changed-repo list; always on `opus`), you run the whole per-repo review in **one spawn** — nest, collect, write:

1. **Nest one per-repo helper per repo** — `Agent(subagent_type="general-purpose", …)` per `<r>`, foreground, all in one message, each carrying the **Per-repo variant** contract above inlined + `repo_root=<r>`. Dispatch mechanics (`general-purpose` not `lead` to clear guard Case 3, **cap 6** with waves-of-≤6 beyond, serial-yourself fallback when `Agent` is unavailable) are canonical in `orchestrator.md > Surface (per-repo) fanout > Dispatch`; follow them there.
2. **Collect** every helper's `### Repo: <r>` block (note `Dispatched-as: general-purpose` once in the artifact), then write the single `review.md`:

- One `### Repo: <path>` subsection per repo under `## Per-repo review`, carrying that repo's plan-adherence + findings (mirrors the `## Per-agent findings` shape).
- **The global anti-bias walk still binds:** walk every `spec.md` AC **once across all repos** in the top-level `Acceptance-criteria check` — tick each against whichever repo's block provides the evidence; an AC **no** repo implements is a blocking finding. Same for plan steps and `Files touched`.
- **Cross-repo coherence (coupled changes only).** If the changed repos **share a contract** this change touches — a proto/schema/IDL bump, a shared client/server signature (the *coupled* case; an independent sweep has none) — verify it is **consistent across every repo**: same contract version, compatible regenerated signatures/wire shape, no repo left on the old version. A skew (repo A regenerated, repo B not; two repos on different versions) is a **blocking** finding — the one defect per-repo isolation structurally cannot see. Read the shared artifact across the repos **yourself** to confirm; don't infer it from the per-repo blocks alone.
- **Aggregate `Verdict` = `pass` iff every repo passed**; lift all repos' blocking findings into the top-level `### Blocking`.
- Set the single **run-level** `Cycle` counter (not per-repo).
- Return: review.md path + aggregate verdict + cycle + total blocking count + unticked-AC count + the repo count.

## Lead — Mode C (Security review)

### Per-repo variant (one repo of a multi-repo run)

When you are dispatched as **one per-repo security reviewer** of a control-plane run's surface fanout (step 12) — a `general-purpose` helper nested by the Surface-coordinator with this contract inlined — `repo_root=<r>` is one of the repos that tripped sensitive paths. Threat-model and check **only that repo's diff** and **return** a per-repo block; you do **NOT** write the shared `security.md` (single-writer; the Surface-coordinator owns it).

- Scope the diff to `<r>` (`git -C <r> diff`). Walk only the buckets *this repo's* paths trip.
- **Single-pass** — do not nest the per-bucket fanout for one repo (the orchestrator caps total agents). One threat model, one checklist walk for `<r>`.
- **Return shape (text):** a `### Repo: <r>` block — Threat model (this repo), Checklist marks, Blocking (high) / Non-blocking (medium/low) findings (`path:line`), and a one-line per-repo verdict (`pass` | `fix-required`).

### Surface-coordinator variant (nests per-repo helpers, then writes the unified security.md)

When the orchestrator spawns you as the **surface-fanout coordinator** for a multi-repo security review (it passes the tripping-repo set), you run the whole per-repo security pass in **one spawn** — nest, collect, write:

1. **Nest one per-repo helper per tripping repo** — `Agent(subagent_type="general-purpose", …)` per `<r>`, foreground, all in one message, each carrying the **Per-repo variant** contract above inlined + `repo_root=<r>`. Dispatch mechanics (`general-purpose` not `lead` to clear guard Case 3, **cap 6** with waves-of-≤6 beyond, serial-yourself fallback when `Agent` is unavailable) are canonical in `orchestrator.md > Surface (per-repo) fanout > Dispatch`; follow them there.
2. **Collect** every helper's `### Repo: <r>` block (note `Dispatched-as: general-purpose` once in the artifact), then write the single `security.md`:

- One `### Repo: <path>` subsection per tripping repo under `## Per-repo security`, each carrying that repo's threat model + findings.
- **Aggregate `Verdict` = `fix-required` iff any repo has a `high`** (a high in any repo is blocking); lift every repo's high findings into the top-level `### Blocking (severity = high)`, medium/low into Non-blocking.
- `Trigger` lists the union of buckets that fired across all repos.
- Return: security.md path + aggregate verdict + total high/medium/low counts + the per-repo verdicts + repo count.

## QA — Execute (Test)

### Per-repo variant (one repo of a multi-repo run)

When you are dispatched as **one per-repo tester** of a control-plane run's surface fanout (step 13) — a `general-purpose` helper nested by the Surface-coordinator with this contract inlined — `repo_root=<r>` is one of `state.repos`. Run **only that repo's suite** over its slice of `test-plan.md` and **return** a per-repo result block; you do **NOT** write the shared `tests.md` (single-writer; the Surface-coordinator owns it).

- Scope every command to `<r>` (`git -C <r> …`, run the suite inside `<r>`). Honour the **batch-the-run** rule per repo: one suite command in `<r>`, never one Bash call per file.
- Cover the `test-plan.md > Coverage plan` rows whose tests live in `<r>`; an AC another repo proves is `not-in-this-repo` for you.
- **For `fix`:** only the repo that holds the bug runs the regression pre-fix verification (`test-plan.md > Regression contract`); a per-repo tester for a repo with no regression contract skips that step.
- Single-pass by default — don't nest the per-category fanout for one repo's slice.
- **Return shape (text, not a file):** a `### Repo: <r>` block — Results table, Acceptance-criteria coverage (this repo's slice), any Failing, this repo's diff-coverage vs floor, **any Visual verification findings or a `visual: deferred to orchestrator MCP backstop` note (when this repo's diff touches UI)**, and a one-line per-repo status (`passing` | `failing` — a blocking visual defect makes it `failing`).

### Surface-coordinator variant (nests per-repo helpers, then writes the unified tests.md)

When the orchestrator spawns you as the **surface-fanout coordinator** for a multi-repo run (it passes the changed-repo list), you run the whole per-repo test phase in **one spawn** — nest, collect, write:

1. **Nest one per-repo helper per repo** — `Agent(subagent_type="general-purpose", …)` per `<r>`, foreground, all in one message, each carrying the **Per-repo variant** contract above inlined + `repo_root=<r>`. Dispatch mechanics (`general-purpose` not `qa` to clear guard Case 3, **cap 6** with waves-of-≤6 beyond, serial-yourself fallback when `Agent` is unavailable) are canonical in `orchestrator.md > Surface (per-repo) fanout > Dispatch`; follow them there.
2. **Collect** every helper's `### Repo: <r>` block (note `Dispatched-as: general-purpose` once in the artifact), then write the single `tests.md`:

- One `### Repo: <path>` subsection per repo under `## Per-repo results`, carrying that repo's results + coverage.
- **Global AC-coverage walk:** map every `spec.md` AC **once across all repos** to whichever repo's actual test proves it (including each AC's `on error / at boundary:` clause and `measured:` target) — an AC no repo's tests cover is an unmapped-AC finding.
- **Cross-repo coherence (coupled changes).** If the changed repos share a contract this change touches, confirm a **cross-repo integration/e2e test actually exercises the shared boundary** (a client in one repo against the server in another) — per-repo suites run in isolation and pass even when two repos sit on incompatible contract versions. A failing cross-repo test is `failing` like any other; the **absence** of any such test on a coupled change is a coverage gap — record it, don't let isolated green suites imply the boundary is proven.
- **Aggregate `Status` = `passing` iff every repo passed**; any repo `failing` ⇒ run `failing`. Collect every repo's failures into the top-level `Failing`.
- Set the single **run-level** `Cycle` counter. Carry each repo's below-floor coverage rows, edge-case gaps, and any `[plan-contradiction]` findings up so the orchestrator can escalate them once. **Carry each repo's Visual verification findings up too** — surface any blocking visual defect (→ `failing`) and any `visual: deferred to orchestrator MCP backstop` note; a UI defect in a non-primary repo must not vanish in synthesis.
- Return: tests.md path + aggregate status + cycle + total failure count + unmapped-AC count + per-repo coverage summary + repo count.

