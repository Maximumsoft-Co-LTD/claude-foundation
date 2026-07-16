# Fable-5 Improvement Plan — claude-foundation workflow

Audit date: 2026-07-15 (v2.6.8). Full read of orchestrator + references, commands, WORKFLOW.md, all 19 agent files, router, 26 skills, 7 hooks, settings.

**Core finding:** the pipeline is architected around three assumptions the Fable 5 era changes: (1) opus-main / sonnet-worker / haiku-analyzer cost tiering, hard-coded in hooks and prose; (2) orchestrator context as a scarce resource rationed by correctness-trading shortcuts; (3) structural distrust of sub-agent output built up reactively. Plus a set of model-agnostic consistency bugs worth fixing regardless.

---

## P0 — Consistency bugs (fix now, no design work)

1. **`INDEX.md:11` says `pm` is sonnet; `pm.md:5` says opus.** Only mismatched row in the registry. Fix INDEX.md (CHANGELOG 2.6.5 confirms opus is intended).
2. **`dev-state-validate.sh:70` dup-key check assumes exactly 2-space top-level indent.** Any reformat of `state.json` silently defeats the check that exists because of a real `--resume`-breaking regression. Use `jq` keys-count comparison instead of a fixed-indent grep.
3. **`dev-agent-guard.sh` Case 3 fails open with 0 or 2+ concurrent runs** (no `CLAUDE_DEV_RUN_ID`). Documented only in shell comments — surface it in `state-edge-cases.md` as a caveat on the state-discipline guarantee.
4. **Case 4 reads worker `model:` pins via `sed` off frontmatter** — a YAML reformat silently falls through to "allow". Harden the parse or fail closed with a clear message.
5. **Stale prose:** `dev.md:15` omits test-plan folding into the XS/S combined spawn (contradicts `xs-s-fast-path.md:6`); `WORKFLOW.md:234` fanout table omits the surface (per-repo) axis and the step-7 `research:` signal; guard error text says "an opus main session" (main tier is now variable).
6. **Two finished hooks are unwired with no status marker:** `no-direct-main-commit.sh` (has self-test, reads as if wired, isn't) and `artifact-lint.sh` (marked optional, has the only real test suite). Either wire artifact-lint as a PostToolUse warn-only check on `.workflow/**` writes, or stamp both headers `OPT-IN`.

## P1 — Retune the model-tier system for Fable 5

The current tier map (opus main → sonnet workers → haiku analyzers) is enforced in `dev-agent-guard.sh` Cases 4–6 and justified by claims like "sonnet ≈ opus at ~½ wall-clock" (`references/lead.md:22`). With a Mythos-class main model sitting **above** opus, the map needs one deliberate decision pass, then mechanical rollout:

1. **Write a single `model-tiers` policy note** (new short reference, pointed to by INDEX.md and the guard) replacing scattered per-file rationale. Proposed mapping:
   - **Main agent (orchestrator, interview, gate): inherit (Fable 5).** Already true; its judgment-heavy jobs (gate fold, size/field calls, fanout arbitration) are exactly where the tier upgrade pays.
   - **`lead` security mode + L-tier plan/review: allow `inherit`** instead of capping at opus. Today the guard makes above-opus impossible for the highest-stakes artifacts — backwards under Fable. Requires a Case-4 exemption list (lead is already exempt; keep) and updated prose in `references/lead.md:22`.
   - **`pm` stays opus** (spec quality rationale from 2.6.5 holds; interview happens on Fable main anyway).
   - **`engineer`/`qa`/`retro`/`uxui` stay sonnet; haiku analyzers stay haiku** — mechanical/narrow-lens work, tier is right; document the (currently unstated) haiku-vs-sonnet rationale in TEAM.md.
   - **Case 6 floor (`general-purpose`/`Explore` → sonnet): keep, but parameterize** the floor model in one place instead of a hard-coded string, and fix the error text.
2. **Re-benchmark the "sonnet ≈ opus at ½ wall-clock" claim** against current models before it keeps steering lead's default-down override — it's the single most load-bearing cost claim in the corpus and dates to the pre-Fable generation.
3. **Inline-fallback silently upgrades haiku roles to sonnet** (`references/lead.md:96`, `pm.md:20`, `qa.md:51`) with no flagging. Fine as behavior; add one line requiring the `Dispatched-as:` entry to note the tier change so cost drift is visible.
4. **Stale cache-TTL rule:** `orchestrator.md:21` "keep turns short (~5-min cache TTL)" — Fable sessions run 1-hour TTL. Keep "decide, write, spawn" as hygiene; drop the TTL justification.

## P2 — Relax correctness-trading context rations (biggest quality win)

These rules exist purely to keep tokens out of the opus-era orchestrator context. On Fable (larger budget, cheaper judgment per token), several trade away correctness margin that's no longer worth trading:

1. **Set-compare gate fold** (`team-mode-sharding.md:11`, `orchestrator.md:33`): a shard can lie about `ac_covered` and pass if the set merely matches. Add a cheap spot-check — gate re-reads ONE random AC's artifact row per shard; full re-read only on mismatch. Keeps ~90% of the savings, closes the lie-through-the-index hole.
2. **Security trigger decided name-only** (`phase-2-guards.md:23`): keep the name-only fast path, but on any *near-miss* (tripped path category, no content sink) allow a bounded content peek instead of a hard skip.
3. **`tail -40` final-suite capture** (`phase-2-guards.md:29`): bump to a failure-aware capture (full output on red, tail on green).
4. **Keep** the distrust machinery that's cheap and catches real failures (disjointness re-verify from `tasks.md`, `git status --porcelain` ground-truth, zero-file BLOCKER, present-and-compiles). It's model-agnostic pipeline hygiene, not weak-model compensation. Do NOT relax.

## P3 — Structural consolidation (maintenance debt)

1. **Fanout reference sprawl:** `fanout.md` + `fanout-plan.md` + `surface-fanout.md` + `implement-fanout.md` = 5.4k words, 45% of reference weight, tracing one signal spans 4 files, and the registry-preflight rule is restated per-axis. Merge to two files: `fanout-dispatch.md` (signal regex, registry preflight, guard interplay, all 3 axes' dispatch tables) + `implement-fanout.md` (genuinely distinct: write-only engineers, integration engineer).
2. **Recruit-help boilerplate is copy-pasted ~7×** (identical stop-line + cap + registry branch in team-codebase-explorer, team-best-practice-researcher, team-code-reviewer, references/lead|pm|qa, uxui). Extract the nesting contract to `fanout-team-agents/references/dispatch-mechanism.md` (already exists) and leave per-agent: cap number + one pointer line. One future cap-policy change currently requires 7 hand-edits.
3. **`references/engineer.md` parity gap:** engineer is the 2nd-densest core file, 3 modes + fanout contract living in a different directory tree (`orchestrator/references/implement-fanout.md`). Create `references/engineer.md` holding the fanout/phase-engineer contract pointer + ship-mode detail; state the rule for when an agent gets a references file.
4. **Two disconnected trigger systems:** fundamentals.md router (16 code-lifecycle skills) vs bare frontmatter matching (10 others, 6 of which have zero wiring anywhere). Add a one-table "non-router skills" appendix to fundamentals.md (or CLAUDE.md) so the second system is at least documented as intentional.
5. **Hook test coverage:** only `artifact-lint.sh` is tested. `dev-agent-guard.sh` (234 lines, 6 cases, blocks spawns) is the highest-risk untested script — port `no-direct-main-commit.sh`'s self-test pattern into `tests/` for guard + validate + mark.
6. **`ui-ux-pro-max`** is the largest monolithic SKILL.md (6.1k words, no references/ split) — split like its siblings.
7. **`team-*` fork drift:** forked 2026-05-21 from pr-review-toolkit, one recorded local edit, no audit mechanism (`TEAM.md:50-56`). Either schedule one audit pass now (~8 weeks of upstream drift) or explicitly declare the fork detached.
8. **Multi-repo boundary** (`size-execution.md:28`, `surface-fanout.md:16`): "still being built out" is functional debt wearing a design-rule costume — a blocking finding in a non-primary repo can't be auto-fixed. Decide: build implement/ship fanout for multi-repo, or hard-scope it out and say so.

## P4 — Fable-era capability adoption (directional, behind a version gate)

The `FANOUT_REQUESTED:` first-line-sentinel protocol and the orchestrator-mediated dispatch loop are a hand-rolled version of what the harness now provides natively. Adopt incrementally, keeping the signal path as fallback (same pattern as the v2.1.172 direct-nesting gate):

1. **Structured worker returns:** sentinel strings (`BLOCKER:`, `SIZE_UPGRADE:`, first-line parsing) are fragile-by-construction. Where the harness supports schema-validated agent output, define a small return schema (status, size_upgrade, files_changed, ac_covered) and let validation retry replace prose-parsing rules.
2. **Deterministic fanout via the Workflow primitive** for the fixed-shape fanouts (review core-3/full-6, surface per-repo, security buckets): script the fan-out/synthesis barrier deterministically instead of prompting the orchestrator to follow a 4-file procedure. Implement fanout stays orchestrator-owned (needs gate interplay + git ground-truthing).
3. **Session-scoped registry fragility** (`running-a-fanout.md`: new `team-*` agents unspawnable until restart, whole `team_registry` branch built around it): check whether current harness versions rescan agents mid-session; if so, the three-way registry state collapses to a version note.
4. **`qa` visual pass** is Playwright-via-Bash only; evaluate the browser-automation MCP tools as an alternative for the Visual+a11y step (may be deliberate for headless CI — document either way).

## P5 — Opus 4.8 main-model profile (close the gap to Fable 5)

Source: `how-to-4.8-same-5.md` (Anthropic docs + external benchmarks, Jul 2026). Key fact: the Fable-5 gap is in long-horizon agentic self-verification (SWE-Bench Pro 80.3 vs 69.2), and closes almost entirely when the harness supplies external verification feedback. This workflow already has most of that harness — the profile below finishes it.

1. **Session config (the #1 miss):** run the orchestrator session with adaptive thinking ON and effort `xhigh` (Claude Code default for coding; minimum `high`). Opus 4.8 does not think unless asked — unlike Fable 5. Add a one-line note to `orchestrator.md` preamble: "on an Opus 4.8 main session, verify effort ≥ high before Phase 2."
2. **Wire the verification loop end-to-end** (this is the actual gap-closer, and upgrades P0.6 from housekeeping to load-bearing):
   - Wire `artifact-lint.sh` as PostToolUse warn-only on `.workflow/**` writes — mechanical artifact checking replaces the self-review Fable does internally.
   - Extend `lint.sh` to also run the project's typecheck (tsc/go vet) on edited files, not just style linters — immediate error feedback after every edit batch is the Terminal-Bench condition where 4.8 ≈ Fable.
   - Keep review/QA in **separate-context agents** (already the design: `lead` Mode B, `qa` execute). Do NOT fold review into the implementer at XS/S — a fresh-context verifier beats self-critique on 4.8 specifically.
3. **Fix the review recall trap:** `team-code-reviewer.md:25` hard-filters to confidence ≥ 80 with "filter aggressively". 4.8 over-obeys don't-be-nitpicky instructions and recall drops. Change the worker contract to "report ALL findings with confidence + severity" and move the ≥ 80 filter to `lead`'s synthesis step (`references/lead.md:113`), where it belongs anyway.
4. **Counter 4.8's under-reach on subagents/tools:**
   - 4.8 prefers thinking over tool calls — the trigger-phrased router (`fundamentals.md`) and agent descriptions already help; audit that every fanout decision point in `orchestrator.md` is phrased imperatively ("spawn X when Y"), not descriptively.
   - Make `## Fanout plan` default-on at M/L instead of lead's discretion — 4.8 won't reach for parallelism unprompted.
5. **Cut ask-rate:** add one line to `pm`/`lead`/`engineer` prompts: "small decisions (naming, default values) — choose, note in the artifact, don't BLOCKER". Keep `BLOCKER:` for unknown-goal only (`pm.md:28` already draws this line for pm; replicate for engineer).
6. **Spec-complete first turns:** spawn prompts already carry "pointers + the delta" — keep; 4.8 degrades on drip-fed instructions, so never split a worker brief across turns.
7. **Model escalation policy (updates P1.1):** default main = Opus 4.8 + this harness; reserve Fable 5 for the runs where failure cost exceeds token cost — L-tier plans, security mode, big migrations, overnight autonomous runs. 4.8 already wins on hallucination rate and GPQA, at half the price ($5/$25 vs $10/$50 per MTok).

## Sequencing

- **Week 1:** P0 (mechanical, ~1 day) + P1.1–1.2 decision pass (needs owner judgment on tier policy).
- **Week 2:** P1 rollout + P2 (small diffs, big correctness margin).
- **Weeks 3–4:** P3 items 1–3 (the consolidation trio), then 4–8 opportunistically.
- **P4:** spike per item behind version gates; don't couple to P0–P3.

Every P0/P1 item touches files the closing rule in `fundamentals.md:55` says must move together (CLAUDE.md / README / WORKFLOW mirror the chain) — run the grep-anchor check (`ddd-strategic`) after each batch.
