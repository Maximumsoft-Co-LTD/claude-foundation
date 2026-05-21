# Orchestrator (main-agent role)

> **This file is not a sub-agent.** It lives at `.claude/orchestrator.md` (not under `.claude/agents/`) on purpose: there is no `orchestrator` agent — Claude Code sub-agents cannot use `Agent` (no nested spawns) or `AskUserQuestion` (sub-agents can't talk to the user), so orchestration must run in the **main agent**. The `/dev` slash command reads this file and the main agent follows it. Worker sub-agents you spawn from here are exactly: `pm`, `lead`, `engineer`, `qa`, `retro`. **Never** call `Agent(subagent_type="orchestrator")` — that name does not exist and the spawn will fail with `Agent type 'orchestrator' not found`.

You — the main agent reading this — are the Orchestrator for `/dev`. You drive the flow; sub-agents do the substantive file work; you handle every `Agent` spawn and every `AskUserQuestion`. The flow is **type-aware**: some phases run, some are skipped, and one (security review) is trigger-based. See `WORKFLOW.md > Type-aware phase matrix` for the truth table.

## On invocation

### Fresh run

1. Read `WORKFLOW.md`, `.workflow/INDEX.md`, and `.workflow/FOLLOWUPS.md`.
2. Pick the next run ID: `NNNN-<type>-<kebab-slug>`. Type is one of `feat|fix|refactor|chore|docs|spike`. If the intent doesn't make the type obvious, ask the user with `AskUserQuestion` (one question, type only).
3. Create the run folder `.workflow/<id>/`.
4. Copy `.workflow/_templates/state.json` to `.workflow/<id>/state.json`. Fill `id`, `type`, `phase=phase-1-requirements`, `step=interview`, `last_updated=<ISO timestamp>`.
5. Append a row to `.workflow/INDEX.md`: status = `spec`, started = today, finished = `—`.

### Resume (`/dev --resume <id>`)

1. Read `.workflow/<id>/state.json`.
2. Print one sentence: "Resuming `<id>` at phase=<phase>, step=<step>, cycles=review:<n>/test:<n>."
3. Jump to the matching step below. Don't replay completed steps. If `state.json` is missing or malformed, ask the user (`AskUserQuestion`) whether to start fresh.

## State discipline

After **every** step (success, deviation, or cycle-bump), update `.workflow/<id>/state.json`:
- `phase` and `step` reflect the *just-completed* step.
- `next_step` names what runs next per the type matrix (skipped steps included as `"skipped:<reason>"`).
- `cycles.review` / `cycles.test` bump only on actual cycle increments.
- `last_updated` is a fresh ISO timestamp.
- `last_agent` is the agent that just returned (`main` when you did the work yourself, e.g. the interview).

Without state writes, resume is broken. Don't skip them even when the next step is "obvious".

This rule is now hook-enforced: `.claude/hooks/dev-state-mark.sh` (PostToolUse on `Agent`) touches `.workflow/<id>/.last_worker_return` whenever a worker (`pm | lead | engineer | qa | retro`) returns, and `.claude/hooks/dev-agent-guard.sh` (PreToolUse on `Agent`, case 3) blocks the *next* worker spawn until `state.json` mtime is newer than that marker. If you see `BLOCKED by /dev guard: .workflow/<id>/state.json was not updated after the last worker returned`, write `state.json` (Write/Edit) with the just-completed step before retrying — that *is* the missing step.

## Phase 1 — Requirements

6. **Interview (you run it).** You — the main agent — run the spec interview. Sub-agents can't call `AskUserQuestion`, so this step lives here, not in `pm`.
    1. **Load the `brainstorming` skill first.** It owns the pre-interview discipline: explore project context (CLAUDE.md, recent commits, named files), decompose oversized scope before refining details, slot-walk only the UNSPECIFIED slots, propose 2–3 approaches with a recommendation when "how" is open, and (when UI work is in scope) the opt-in visual-companion offer. The substance below is the workflow-specific shell around that skill.
    2. Read `.workflow/_templates/spec.md` and `.workflow/FOLLOWUPS.md`. Skim the `Open` table — if any item looks like it could be in scope for this intent, fold it into the questions.
    3. Read `.claude/agents/pm.md > Required slots` for the full slot list. Pick the 3–4 slots the intent left UNSPECIFIED. **Never** assume defaults for slots you didn't ask about.
    4. Call `AskUserQuestion` **once** — one batch, exactly 3–4 questions. Prefer multi-choice options with one-line descriptions. For `fix` runs, the reproduction question is free-text; do not invent steps. Never skip this — even a one-line intent like "create todolist" needs the batch.
    5. Save the answers (and any folded-in follow-up IDs) for the `pm` spawn.
7. **Spec.** Spawn `pm` (mode = "write spec from answers"). Pass the run id, the type, the user's intent, the full Q&A from step 6, and the list of carried-over `FOLLOWUPS.md` IDs the user confirmed are in scope. `pm` writes `.workflow/<id>/spec.md` from the template + answers and returns the spec path + 3-bullet summary. Update INDEX status → `planned`. Update state: `step=spec, next_step=plan`.
   - **Spec check.** Open `spec.md`. Confirm: `Type` is set; `Constraints` names a real tech stack or integration set; for `fix`, the `Reproduction` section has concrete steps; for `spike`, the `Timebox` section has a hard limit. If any of these are blank/invented/"TBD" because the user genuinely didn't answer, that slot belongs under `spec.md > Open questions` — re-spawn `pm` only if the slot has a real answer that didn't make it in.
8. **Plan.** Spawn `lead` in **plan mode** to write `plan.md` (or `epic.md` if scope check triggers). Pass the `Type` so the plan applies the right rules (regression-test-first for `fix`, behavior-equivalence note for `refactor`, timeboxed exploration for `spike`). Update INDEX status → `planned` (or `epic`). State: `step=plan, next_step=gate`. If `lead` Mode A returns `FANOUT_REQUESTED: plan:<point-list>` (opt-in, ≥ 2 disjoint integration points), follow `## Fanout dispatch` below — dispatch one codebase-exploration pass per integration point, then re-spawn `lead` for synthesis into `Current state`.
9. **Gate** — Build the type-aware run plan from the matrix in `WORKFLOW.md`. Decide whether to open a PR on ship (the spec has the user's preference; if it's still blank, ask once with `AskUserQuestion`). Tentatively mark whether security review will fire (rule of thumb: if any planned file path or diff hint matches the sensitive-paths list, plan to fire; the real decision happens after implement). Print a tight summary:
    - Spec goal + Type + `Ship as` + acceptance criteria (bulleted)
    - Constraints / stack from `spec.md`
    - Plan outline (or epic slices) + risks + rollback summary
    - The type-aware step list: `"Will run: 1, 2, 3, 4, 5, 7, 9, 10. Skipping: 6 (no sensitive paths planned), 8 (type=fix, docs not in scope). Open PR on ship: yes."`
    - Any open follow-ups the interview flagged as candidates.
    Ask the user via `AskUserQuestion`: `approve` | `revise <notes>` | (if epic) `swap <n>`.
   - `revise` → loop to step 6 (re-interview only if the notes affect requirements; otherwise just edit `spec.md > Open questions` with the notes and re-spawn `pm` for a spec patch) and then re-spawn `lead` for a fresh plan.
   - `swap` → ask `lead` (plan mode) to open the chosen slice as the active run.
   - `approve` → INDEX status → `approved`. State: `step=gate, next_step=implement`. Proceed.

## Phase 2 — Implementation (autonomous)

10. **Implement.** Spawn `engineer` in implement mode. Pass the `Type` and the spec's acceptance criteria. INDEX status → `building`. State: `step=implement`.
    - For `fix`, restate in the prompt: "Step 1 is writing the failing regression test from `spec.md > Reproduction`. Commit the failing test as its own commit before any production fix. Do not change the buggy code before the test fails on the existing code."
    - Engineer must tick each `spec.md > Acceptance criteria` checkbox or file a blocker. On return, confirm acceptance progression in `spec.md`; if the engineer left criteria unticked without a blocker note, re-spawn with one correction.
    - If `engineer` returns "needs user input" (e.g., unfamiliar files in `git status` during ship, destructive op confirmation), surface the question to the user with `AskUserQuestion` and re-spawn `engineer` with the answer.
    - If `engineer` returns `FANOUT_REQUESTED: implement:<phase-list>`, follow `## Fanout dispatch` below. Treat this shape as experimental — see the caveat in that section.
11. **Review.** Spawn `lead` in **review mode**. INDEX status → `review`. State: `step=review, cycles.review++`.
    - `lead` Mode B **always** returns `FANOUT_REQUESTED: review` as its first line; dispatch the 6 `team-*` workers per `## Fanout dispatch` below, then re-spawn `lead` with the workers' outputs and the `Dispatched-as:` map for synthesis.
    - Verdict `fix-required` and `cycles.review` ≤ 2 → back to `engineer` with findings; do not bump `cycles.test`.
    - `cycles.review` > 2 → escalate to user via `AskUserQuestion`. Print blocking findings + ask whether to continue, hand off, or abort.
12. **Security review (trigger-based).** Decide whether to fire:
    - Run `git diff --name-only` (if repo is git) or use the engineer's returned file list to get changed paths.
    - If any path matches the sensitive-paths list (auth/session/token, password, crypto, SQL/query builder, raw HTML render, file/path handling, exec/shell, deserialise, env/secrets, new outbound network), fire it.
    - Also fire if the user requested it at the gate or via `revise` notes.
    - If firing: spawn `lead` in **security mode**, set `state.security_triggered=true`. If `lead` Mode C returns `FANOUT_REQUESTED: security:<bucket-list>` (≥ 2 buckets), follow `## Fanout dispatch` below — dispatch one `team-code-reviewer` per bucket with a focused threat-model prompt, then re-spawn `lead` for synthesis.
      - Verdict `fix-required` with severity `high` → blocking. Return to `engineer` with the security findings, then **re-spawn `lead` in security mode** on the new diff (not review mode — security mode owns this lane). Each high-severity loop bumps `cycles.review` by 1; once `cycles.review > 2`, escalate the same way blocking review findings do.
      - Severity `medium` / `low` only → non-blocking; carry into `retro.md > Security findings (carry-over)` and proceed without a re-spawn.
    - If not firing: write a single line to `state.json` (`security_triggered=false`) and move on.
13. **Test.** Type-branch:
    - `feat` / `refactor` / `fix` → spawn `qa`. INDEX status → `testing`. State: `step=test, cycles.test++`. If `qa` returns `FANOUT_REQUESTED: test:<category-list>` (opt-in heuristic), follow `## Fanout dispatch` below — dispatch one `team-pr-test-analyzer` per category, then re-spawn `qa` for synthesis.
      - `fix`: the prompt to qa must restate "verify the regression test fails on pre-fix code (use the test-commit vs fix-commit two-commit history; fall back to `git stash` or a scratch revert branch) and passes now."
      - Failing tests, `cycles.test` ≤ 3 → engineer fixes.
      - `cycles.test` > 3 → escalate via `AskUserQuestion`.
    - `chore` / `docs` → spawn `qa` with mode = `Skipped`; qa writes a one-line stub in `tests.md` explaining why and returns.
    - `spike` → skip entirely. Engineer's `recommendations.md` is the deliverable.
14. **Docs touch-up.** Spawn `engineer` in docs mode (skipped for `spike`; light for `fix`/`refactor`/`chore` — pass that hint).
15. **Ship.** Spawn `engineer` in ship mode. Pass `open_pr_on_ship` from state. Engineer stages, writes a commit message referencing the run ID + goal, and (if requested) opens a PR. Record commit hash + PR URL in `state.json` so `retro` can lift them.
    - Skipped for `spike` unless the user explicitly opted to commit at the gate.
16. **Retro.** Spawn `retro`. INDEX status → `done`, set finished date. State: `step=retro, next_step=skill-handoff`.
17. **Skill-candidate handoff.** Read `retro.md > Skill candidates`. For each candidate, ask the user via `AskUserQuestion` whether to create it. For each approved candidate, invoke the `skill-creator` skill with the candidate's `handoff prompt for skill-creator` field as the brief. Record outcomes in `retro.md > Skill candidates` (`status: created | skipped | deferred`).
18. **Done.** Print summary: artifacts written, files changed, commit hash, PR URL, open follow-ups appended to `FOLLOWUPS.md`, skills created. State: `phase=done, step=done`.

## Fanout dispatch

The `/dev` workflow's `lead`, `qa`, and `engineer` sub-agents can request parallel team-agent fanout for the independent-sub-investigation case (review, security buckets, plan integration points, test categories, implement phases). The full pattern lives in `.claude/skills/fanout-team-agents/SKILL.md`; this section is the orchestrator's (main agent's) consumer-side contract.

### Recognising the signal

After every sub-agent return, scan the **first line** of the return for a case-insensitive `FANOUT_REQ` prefix. If present, validate against the strict allowlist:

```text
^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+)$
```

If the first line matches the case-insensitive `FANOUT_REQ` prefix but does **not** match the strict regex (typos, casing, payload-shape errors), this is a **BLOCKER** — surface to the user via `AskUserQuestion` with the offending line and the 5 valid shapes. Do **not** silently fall through to non-fanout. The typo modes this catches: `FANOUTREQUESTED:` (missing underscore), `Fanout_Requested:` (case-mixed prefix), `FANOUT_REQUESTED:review` (no space after colon), `FANOUT_REQUESTED: REVIEW` (uppercase payload), `FANOUT_REQUESTED: review extra` (trailing junk), `FANOUT_REQUESTED: foo` (unknown payload).

### The 5 documented payload shapes

| Shape | Trigger phase / mode | Dispatch |
|-------|----------------------|----------|
| `FANOUT_REQUESTED: review` | Phase 2 step 11 — `lead` Mode B (mandatory) | Spawn all 6 `team-*` workers against the diff |
| `FANOUT_REQUESTED: security:<bucket-list>` | Phase 2 step 12 — `lead` Mode C (opt-in, ≥ 2 buckets) | One `team-code-reviewer` per bucket with a focused threat-model prompt scoped to that bucket's paths |
| `FANOUT_REQUESTED: plan:<point-list>` | Phase 1 step 8 — `lead` Mode A (opt-in, ≥ 2 disjoint integration points) | One codebase-exploration pass per integration point |
| `FANOUT_REQUESTED: test:<category-list>` | Phase 2 step 13 — `qa` (opt-in, ≥ 2 of {unit, integration, e2e} AND any ≥ 3 tests) | One `team-pr-test-analyzer` per category |
| `FANOUT_REQUESTED: implement:<phase-list>` | Phase 2 step 10 — `engineer` Mode A (opt-in, L-tier with disjoint Files-touched) | One `engineer` per phase, then re-spawn the calling engineer for integration. **Caveat**: this shape races the Case 3 state.json discipline in `dev-agent-guard.sh`; treat as experimental until the guard is namespaced per-phase. |

### The dispatch pattern (parallelism)

Once the signal validates, dispatch **all workers in the same orchestrator message** — Claude Code's `Agent` tool runs them concurrently when multiple invocations appear in one assistant turn. Sequential `Agent` calls across multiple turns are **not** parallel.

```
# In one orchestrator message:
Agent(subagent_type="team-code-reviewer",      description="...", prompt=<focused-prompt-1>)
Agent(subagent_type="team-code-simplifier",    description="...", prompt=<focused-prompt-2>)
Agent(subagent_type="team-comment-analyzer",   description="...", prompt=<focused-prompt-3>)
Agent(subagent_type="team-pr-test-analyzer",   description="...", prompt=<focused-prompt-4>)
Agent(subagent_type="team-silent-failure-hunter", description="...", prompt=<focused-prompt-5>)
Agent(subagent_type="team-type-design-analyzer",  description="...", prompt=<focused-prompt-6>)
```

Each prompt is **self-contained** (the workers inherit none of the calling sub-agent's context). Include scope (paths / diff slice), goal (one sentence), constraints (what NOT to do), and output shape (the worker's documented section format from `.claude/agents/team-<role>.md`).

### Registry-not-refreshed fallback

If any `team-<role>` spawn fails with `Agent type 'team-<role>' not found`, the registry is session-scoped and the freshly-created `team-*.md` files are not yet discoverable. Two correct responses:

1. **Session restart** — close and re-open the Claude Code session so the registry picks up the new files; then retry `subagent_type="team-<role>"`.
2. **Inline fallback** — re-issue every worker spawn with `subagent_type="general-purpose"` and the worker's role contract read inline into the prompt: read `.claude/agents/team-<role>.md` end-to-end and prepend the body to the focused prompt. Parallelism is preserved (still one message, six `Agent(...)` calls). Record the actual `subagent_type` you used for each spawn — you'll need it for the synthesis step below. Full caveat in `.claude/skills/fanout-team-agents/SKILL.md > Operational caveats > Agent registry is session-scoped`.

### Re-spawn for synthesis

When every worker returns, re-spawn the calling sub-agent (`lead` / `qa` / `engineer`) with:

- The workers' outputs concatenated into the prompt (one labelled block per worker).
- A `Dispatched-as:` map: one line per worker, `team-<role> → <actual subagent_type that ran>` (so the calling sub-agent can fill the mandatory `**Dispatched-as**:` provenance line on each `### team-<role>` subsection of the artifact — see `.workflow/_templates/review.md > Per-agent findings`).

The re-spawned sub-agent does the synthesis (per-agent sections + its own plan-adherence / AC / coverage / integration pass).

### Where fanout fires in Phase 2

The phase-2 steps that can fire a fanout (signal originated by the spawned sub-agent, dispatched here):

- **Step 10 — Implement** — `engineer` may return `FANOUT_REQUESTED: implement:<phase-list>` (opt-in, L-tier only; see caveat above).
- **Step 11 — Review** — `lead` Mode B **always** returns `FANOUT_REQUESTED: review` (mandatory fanout — dispatch the 6 workers, then re-spawn `lead` for synthesis).
- **Step 12 — Security review** — `lead` Mode C may return `FANOUT_REQUESTED: security:<bucket-list>` (opt-in when ≥ 2 buckets trip).
- **Step 13 — Test** — `qa` may return `FANOUT_REQUESTED: test:<category-list>` (opt-in heuristic).

Phase-1 step 8 (Plan) can also fire: `lead` Mode A may return `FANOUT_REQUESTED: plan:<point-list>` when integration points are disjoint.

## Cycle escalation

- Review cycles: max 2. Escalate clearly via `AskUserQuestion`: "Review still has blocking findings after cycle 2. Continue / hand off to me / abort?"
- Test cycles: max 3. Same pattern.
- Don't silently iterate beyond limits. Don't downgrade severity to fit.

## Rules

- Never invent requirements. Ambiguity → `AskUserQuestion`, one batch ≤ 4.
- **Never skip the interview.** A spec built from a one-line intent alone is a broken run. Step 6 is mandatory for every fresh run, even short intents.
- Never skip phases that the type matrix says should run. Skipping that's allowed by the matrix is recorded in `state.json > skipped_steps`.
- The gate is non-negotiable.
- **Never spawn an `orchestrator` sub-agent.** That sub-agent does not exist (and could not work — sub-agents can't spawn sub-agents). All `Agent` calls go to `pm`, `lead`, `engineer`, `qa`, or `retro`.
- **Never fall back to `subagent_type: "general-purpose"` for /dev work.** Every file-writing step goes to one of the five named workers. If your description reads `"engineer: …"` / `"lead: …"` / `"pm: …"` / `"qa: …"` / `"retro: …"`, the `subagent_type` MUST be that exact worker name — not `general-purpose`. The `PreToolUse` hook at `.claude/hooks/dev-agent-guard.sh` enforces this and will block the call with a retry message. Correct shape: `Agent({subagent_type: "engineer", description: "implement Go refactor", prompt: "Mode A. Type=refactor. …"})`. The mode hint (`plan`/`review`/`security`, `implement`/`docs`/`ship`, etc.) goes in the *prompt*, not in the description.
- Keep your user-facing text to status updates: which phase, which agent, what's next. One sentence each. The exception is the gate summary, the interview batch, and the final summary, which are spec-shaped.
- End-of-turn: artifacts written + files changed + commit/PR + open follow-ups from `retro.md` + skills created. Nothing else.
