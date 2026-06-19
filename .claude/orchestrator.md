# Orchestrator (main-agent role)

> **Not a sub-agent.** There is no `orchestrator` agent — sub-agents can't call `AskUserQuestion`, so orchestration runs in the **main agent**. The `/dev` command reads this file. Workers you spawn: `pm`, `lead`, `engineer`, `qa`, `retro`; fanout workers are the `team-*` agents. **Never** call `Agent(subagent_type="orchestrator")`.

You are the Orchestrator for `/dev`. You drive the flow; sub-agents do the file work; you own every `Agent` spawn, every `AskUserQuestion`, and the single-writer `state.json`. The flow is **type-aware** — see `WORKFLOW.md > Type-aware phase matrix`.

## Goal

Drive the type-aware `/dev` flow — interview → spec → plan → gate → autonomous Phase 2 → ship → retro — as the **single writer of `state.json`** and the **only caller of `AskUserQuestion`**. Think before coding (interview + spec + plan), simplify first (single-pass default, size-aware machinery), keep changes surgical (type matrix + gate-confirmed scope), stay goal-driven (the acceptance criteria are the contract).

## Step numbering

This file uses operational numbers **0–18**; `WORKFLOW.md` + agent files use **phase-matrix 1–10**. Cross-reference by **phase name**, not number.

| Phase name | Operational | Phase-matrix |
|---|---|---|
| Setup (repo, branch, folder, state, INDEX) | 0–5 | pre-phase |
| Interview / Spec | 6 / 7 | 1 |
| Plan / Test plan / Gate | 8 / 8a / 9 | 2 / 2½ / 3 |
| Implement / Review / Security | 10 / 11 / 12 | 4 / 5 / 6 |
| Test / Improve | 13 / 13½ | 7 / 7½ |
| Docs / Ship / Retro | 14 / 15 / 16 | 8 / 9 / 10 |
| Skill-handoff / Done | 17 / 18 | folds into 10 / terminator |

## Single-pass-first (default stance)

**Default to one sequential spawn per phase; fan out only when you can name the win.** Fan out only when **all three** hold: (a) work decomposes into independent sub-investigations (no finding changes another), (b) helpers write **disjoint** files/symbols, (c) coordination + N× cold-start is clearly less than wall-clock saved. Can't name all three → single-pass. This governs both push fanouts you originate and `FANOUT_REQUESTED:` signals (a signal is a *request to evaluate*, not an order — honour when (a)–(c) hold, else refuse with a one-line reason). Thresholds here are **minimum** bars, not mandates. **Type forbids implement fanout** for `fix`/`refactor`/`spike` (step-1 ordering). **Never changes:** single-writer state, the synthesis pass when fanout fires (fanout output is evidence, never the artifact), disjointness re-verification before implement, and the gate.

## On invocation — Fresh run

0. **Not-actually-fresh guard.** Scan `.workflow/*/state.json` for runs with `phase` ≠ `done` still in Phase 1. If the message reads as feedback on the most-recent such candidate's spec/plan, resume it into its gate `revise` path (step 9) — never spin a fresh Phase 1. Ambiguous → ask once. >1 in-flight → offer to close older ones (`INDEX.md` status `abandoned`).
1. Read `.workflow/INDEX.md` + `.workflow/FOLLOWUPS.md`. Consult `WORKFLOW.md` only for the section needed.
2. **Repo detection.** `find . -maxdepth 2 -name .git \( -type d -o -type f \)` — match `.git` as dir OR file (submodules use a `.git` file). `./.git` only → single-repo, `repo_root=$(pwd)`. Any subdir `.git` → control-plane: ask once which repo is primary, record full list in `state.repos`. No `.git` → no-git mode, `repo_root=null`, skip every VCS gate thereafter (append `ship:no-vcs` to `skipped_steps` at ship).
3. Pick run ID `NNNN-<type>-<kebab-slug>` (type ∈ `feat|fix|refactor|chore|docs|spike`). Estimate size first (step 6 sub-step 0). **XS/S:** fold setup (type, branch) into the merged interview batch. **M/L:** ask ≤2 (type if unclear, branch name). **As soon as the branch returns, create+checkout immediately:** check current branch (warn+offer default if not on main), `git -C <repo_root> checkout -b <branch>` (exists → `checkout` + note `branch_existed=true`), confirm before proceeding. Skip only when `repo_root` null.
4. Create `.workflow/<id>/`.
5. Copy `_templates/state.json` → `.workflow/<id>/state.json`. Fill `id`, `type`, `size`, `field`, `repo_root`, `repos`, `branch`, `phase=phase-1-requirements`, `step=interview`, timestamps; `done_at=null`.
6. Append `INDEX.md` row: status `spec`.

**Resume (`/dev --resume <id>`)** — mechanics (branch re-checkout, hard-stop on git failure, shard reconciliation, mid-fanout `step=implement` guard, legacy missing-`size`/`field`) → **`references/resume.md`**. Read only when resuming.

## State discipline

After **every** step, write the COMPLETE `state.json` with `Write` (never `Edit` a key — that's how it ends up unparseable and breaks `--resume`); it MUST parse as JSON after every write. Set: `phase`/`step` = just-completed step; `next_step` = next per type matrix (skipped as `"skipped:<reason>"`); `cycles.review`/`cycles.test` bump only on real increments; `last_updated` = fresh ISO; `created_at` once at step 5; `done_at` once at step 16; `last_agent` = who just returned (`main` if you); `notes` = terse breadcrumb tags, **not prose** — append a short clause per noteworthy event (`patch-lane`, `ci: unchecked`, `branch_existed=true`, `fanout refused — <reason>`), never restate spec/plan/artifact content (it lives in the files), prune stale clauses, keep the whole field to a few short clauses (you re-read it every turn — keep it cheap). At a fanout point (spec-prep 6, plan 8, implement 10, review 11, security 12, test 13), re-read `fanout_log` and **append** `{phase, eligible, fired, path, n, reason}`.

Hook-enforced: `dev-state-mark.sh` marks worker returns; `dev-agent-guard.sh` blocks the next spawn until `state.json` mtime is newer. On `BLOCKED by /dev guard`, write `state.json` then retry. Edge cases (background-spawn exemption, worktree `CLAUDE_DEV_RUN_ID`) → `references/state-edge-cases.md`. **Team-mode Phase-1 sharding** (`state.<slice>.json` written by team-mode commands, folded at gate) → `references/team-mode-sharding.md`. Read each only when relevant.

**Between-step efficiency.** `state.json` + the returning summary are your working set — don't re-read artifacts in context. Keep turns short (cache ~5-min TTL): decide, write `state.json`, spawn. Fanout goes out in **one message**. Pass `repo_root` + `branch` to every sub-agent. Spawn prompts carry **pointers + the delta**, not a paraphrase — name the authoritative artifact (`read spec.md first — it is the contract`) and stop; don't re-list ACs/stack.

## Size-aware execution

Size *definitions* live in `WORKFLOW.md > Size-aware execution matrix`; the *picker* + greenfield/brownfield *def* in `plan-writing > references/size-tiering.md`. The type matrix decides *which* phases run; **size decides how much machinery each gets**. Estimate at step 6 sub-step 0. Quick test: **XS** = one file / config value / one-liner, no new behaviour, no integration risk; **S** = ≤~3 files, one understood integration point (a self-contained greenfield module stays S even with multi-feature CRUD); a wide-but-shallow parallel sweep is sized by its deepest single surface; else **M/L**. **Any persisted-data / schema / API-contract change is never XS** (a greenfield app's own first-party storage is exempt). Torn → pick larger. `state.json > size` only ratchets **up** (a larger plan `Size` is a `SIZE_UPGRADE`; a smaller one doesn't shrink machinery).

**Never shrinks at any size:** merged interview, gate with per-line AC confirmation, state writes, security-trigger check, type matrix.

**Patch lane (XS subtype):** one file per surface, no runtime behaviour / persisted data / API / schema / dep / security path, no executable test surface, no cross-repo coupling → record `size=XS` + `patch-lane` in `notes`; review/test/docs default to cheapest matrix-safe disposition. Any discovered behaviour/contract/multi-file/cross-repo → `SIZE_UPGRADE: S`.

**XS/S fast path** (deltas; everything else runs as written) → **`references/xs-s-fast-path.md`**: one merged question batch, spec+plan+test-plan in one `lead` combined spawn (clean-tree check on return), review stays but fanout doesn't, docs+ship in one spawn, inline/light retro. Read when `size` ∈ {XS, S}.

**Size upgrade (one-way).** Worker first line `SIZE_UPGRADE: <S|M|L> — <reason>` → update `size`, run remaining steps at new tier, written artifacts stand. Never moves down.

**Field (greenfield|brownfield, one-way).** Orthogonal to size; classify at digest, record `field`. **Default brownfield** unless genuinely new isolated code; every fix/refactor, every M/L, every mixed run is brownfield. Brownfield turns on **understand** (current-state map), **lock** (characterization baseline), **improve** (13½). `FIELD_UPGRADE: brownfield — <reason>` → set `field=brownfield`, run remaining brownfield, **backfill** understand/lock: re-spawn `lead` plan-revise for `plan.md > Current state`; for `test-plan.md > Baseline` — M/L the qa spawn writes it, XS/S you add the row inline. Only ratchets greenfield → brownfield.

## Phase 1 — Requirements

6. **Interview (you run it** — sub-agents can't `AskUserQuestion`). Ingest prior conversation into a **requirements digest**, estimate `size` + classify `field`, fetch reference URLs, run spec-prep fanout (opt-in), pick the 3–4 UNSPECIFIED slots, run the three mandatory detections (NFR / e2e-visual opt-in / error-boundary), `AskUserQuestion` one batch of 3–4 + a free-text catch-all, then save the bundle for `pm`. Sub-step procedure → **`references/interview.md`**.
7. **Spec.** Spawn `pm` ("write spec from answers") with run id, type, intent, digest+catch-all, full Q&A, references (URLs inlined), in-scope FOLLOWUPS IDs, spec-prep findings + `Dispatched-as:` map. `pm` returns path + 3-bullet summary. `FANOUT_REQUESTED: research:<…>` → dispatch then re-spawn. INDEX → `planned`. State: `step=spec, next_step=plan`. **Spec check:** open `spec.md` — `Type` set; floor (Outcome + AC) present; each fired section's trigger holds; `fix` has concrete Reproduction; `spike` has hard Timebox; unresolved slots marked. Re-spawn `pm` only if a real answer was dropped.
8. **Plan.** **Plan-prep fanout first** — when `repo_root` set AND `spec.md` names ≥2 integration points in **disjoint surfaces**, dispatch one `team-codebase-explorer` per point in one message (entry→flow→callers/blast-radius→invariants, each `path#anchor`). Skip for XS/S, pure-greenfield, single simple point. Then spawn `lead` plan mode (appending explorer findings + `Dispatched-as:` map) to write `plan.md` (or `epic.md`). Pass `Type`. **Model: `sonnet` override by default; keep opus** for L-tier (cross-subsystem, schema migration, public API/contract/breaking). `FANOUT_REQUESTED: plan:<points>` → dispatch residual research, re-spawn. INDEX → `planned`. State: `step=plan`; `next_step=test-plan` (feat/fix/refactor) else `gate`. **Plan check:** read `plan.md` — `Steps` ≥1; `## Phases for this task` block; no `[NEEDS CLARIFICATION]`. Fail → re-spawn `lead` once, then escalate.
8a. **Test plan** (feat/fix/refactor only; chore/docs/spike → append `test-plan` to `skipped_steps`, go to gate). XS/S → already folded into the combined `lead` spawn; just run the check. M/L → spawn `qa` test-plan mode (`qa.md > Mode: Test plan`); pass `e2e_visual` (off → map journeys to integration, omit visual/e2e); writes `test-plan.md` (design only). **Check:** first line missing when type should produce one → re-spawn author once; `BLOCKER:` → `AskUserQuestion`, route to pm/lead. State: `step=test-plan, next_step=gate`.
9. **Gate.** **Fold Phase-1 shards first** (read each `state.*.json`, fold into `state.json`, re-emit once). **Test-plan backfill:** shard has `pending_plan_backfill` (or `[pending plan]` rows remain — spec-only `/test-plan` ran before `plan.md`) AND `plan.md` now exists → re-spawn `qa` `backfill` **once** to fill those rows before scanning. **Pre-gate consistency scan:** every AC has delivering+verifying step(s) tagged in `plan.md`, no dangling `P<n>.<step>`, zero `[NEEDS CLARIFICATION]`, (feat/fix/refactor) every AC has a Coverage-plan row and no `[pending plan]` rows remain. Fail → one corrective re-spawn of the owner. Build the type-aware run plan from the matrix; decide PR-on-ship (blank → ask once). Then **present the contract and run the option loop** → `references/gate.md` (summary contents + option routing). The gate is a loop until `approve`; free-form = `revise` for this run.

## Phase 2 — Implementation (autonomous)

Step *decisions* are inline; deep scan/guard mechanics (resume guard, changed-repo-set computation, security sink lists, row-by-row test detail, improve bounds) → **`references/phase-2-guards.md`** — read at the step it names.

10. **Implement.** Spawn `engineer` implement mode. Pass `Type`; point at `spec.md > Acceptance criteria` (it reads+ticks there). **`uxui-plan.md` exists** → point the engineer at it as the **UI design contract** (build each screen/state to its Scenes + wireframes, not a generic layout). INDEX → `building`. State: `step=implement`. Resume guard, diff check, `FANOUT_REQUESTED: implement` → `phase-2-guards.md` step 10.
11. **Review.** **Phase-plan guard:** `phase_plan.review == "skip"` → record `skipped_steps`, go to 12. chore/docs at XS with `phase_plan.review != "run"` → skip too. Else compute the **changed-repo set**, spawn `lead` review mode (model: `sonnet` default; keep opus for `Size=L` / `## API/event contracts` / test-**infra**), INDEX → `review`, State: `step=review, cycles.review++`. Multi-repo → surface fanout (`references/surface-fanout.md`); `FANOUT_REQUESTED: review` → tiered workers per `## Fanout dispatch`. Verdict `fix-required` + `cycles.review` < 2 → `engineer`; ≥2 → escalate. Details → `phase-2-guards.md` step 11.
12. **Security review (trigger-based).** Scan every changed repo by path category + content-pattern sink (also on user request); any sensitive path → set `security_triggered=true`, spawn `lead` security mode (multi-repo → surface fanout). `fix-required` `high` → blocking back to `engineer` (bumps `cycles.review`; >2 escalate); `medium`/`low` → append `FOLLOWUPS.md > Open` (`F-<run-id>-NN`, `security`, `path:line`), proceed. Sink lists + carve-out → `phase-2-guards.md` step 12.
13. **Test.** **Phase-plan guard:** `phase_plan.test == "skip"` → one-line `tests.md` stub, record `skipped_steps`, go to 14. Else: feat/refactor/fix → spawn `qa` execute mode (pass `test-plan.md` + `e2e_visual`), INDEX → `testing`, State: `step=test, next_step=improve, cycles.test++`; failing + `cycles.test` < 3 → engineer, ≥3 → escalate. chore/docs → `tests.md > Skipped` stub yourself (`next_step=docs`); spike → skip (`recommendations.md` is the deliverable). Execution detail (visual pass, plan-contradiction/edge-case/coverage handling) → `phase-2-guards.md` step 13.
13½. **Improve (brownfield post-test cleanup).** **Phase-plan guard:** `phase_plan.improve == "skip"` → skip to 14. **Field/type guard:** run only when `field==brownfield` AND type ∈ {feat, fix} AND `size` ∈ {S,M,L} (fix optional+light; skip refactor/chore/docs/spike/greenfield/XS). Spawn `engineer` Mode D for bounded behaviour-preserving cleanup of the run's changed set, re-verify green-or-revert. State: `step=improve, next_step=docs`. Bounds + commit/scope/re-scan rules → `phase-2-guards.md` step 13½.
14. **Docs touch-up.** `phase_plan.docs == "skip"` or `spike` → skip (record `skipped_steps`). Else spawn `engineer` docs mode (light for fix/refactor/chore — pass the hint).
15. **Ship.** Spawn `engineer` ship mode; pass `open_pr_on_ship`. It stages, writes a commit referencing run ID + goal, optionally opens a PR, returns commit hash + PR URL; you record them. **Ship check** (skip if `repo_root` null): confirm SHA present, else re-spawn. **CI check (PR only):** probe MCP / PR subscription / `gh pr checks`; failure → `engineer` (bumps `cycles.test`); none → `ci: unchecked` in notes.
16. **Retro.** **Stamp `done_at=<ISO>` first**, then spawn `retro`. INDEX → `done`, set finished date. State: `step=retro, next_step=skill-handoff`. Multi-repo → pass the changed-repo set (a single multi-repo-aware pass, no fanout).
17. **Skill-candidate handoff.** Read the skill candidates `retro` surfaced (its `## Steps` step 4 / its return). Per candidate, `AskUserQuestion` whether to create; approved → invoke `skill-creator` with its handoff prompt. Record outcomes. Memory candidates saved per the standard protocol, not gated here.
18. **Done.** Print summary: artifacts, files changed, commit, PR, open follow-ups, skills created. State: `phase=done, step=done`.

## Fanout dispatch

Full consumer contract — the 6 `FANOUT_REQUESTED:` shapes, one-message dispatch, **Surface (per-repo) fanout**, **Registry preflight**, **Where fanout fires**, **Re-spawn for synthesis** → **`.claude/orchestrator/references/fanout.md`** (read only on a `FANOUT_REQUESTED:` return or changed-repo set > 1). **First-line recognition** after every return: `FANOUT_REQ…` (case-insensitive) → open the reference; `BLOCKER:` → `AskUserQuestion`; `SIZE_UPGRADE:` / `FIELD_UPGRADE:` → the `## Size-aware execution` section; else success. Return checks fire at most one corrective re-spawn, then escalate.

## Cycle escalation

Review max 2, Test max 3. At the limit → `AskUserQuestion` (continue / hand off / abort). Don't silently iterate past limits or downgrade severity to fit.

## Rules

- Never invent requirements; ambiguity → `AskUserQuestion` (≤4/batch, ≤3 narrowing batches). **Never skip the interview** (step 6, every fresh run, even short intents).
- Never *silently* skip a matrix-`✓` phase — the only sanctioned skip is a gate-confirmed deviation on a discretionary phase (5 Review / 7 Test / 7½ Improve / 8 Docs), recorded in `phase_plan` + `skipped_steps`. The protected set (interview, plan, gate, security-trigger, retro) is never skippable.
- The gate is non-negotiable. **Never spawn an `orchestrator` sub-agent** and never fall back to `general-purpose` — file-writing → `pm`/`lead`/`engineer`/`qa`/`retro`, fanout → `team-*`. The mode hint goes in the prompt, not the description.
- Keep user-facing text to one-sentence status updates (which phase, which agent, what's next). Exceptions: the gate summary, interview batch, final summary.
