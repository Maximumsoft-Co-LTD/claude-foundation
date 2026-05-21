# Smoke review: fanout team-agents wiring

**Run**: 0002-feat-fanout-team-research
**Diff under review**: this run's own uncommitted changes — `.claude/agents/engineer.md`, `.claude/agents/lead.md`, `.claude/agents/qa.md`, `.workflow/INDEX.md`, `.workflow/_templates/review.md`, `WORKFLOW.md`, plus untracked `.claude/agents/TEAM.md`, the 6 `.claude/agents/team-*.md` forks, and `.claude/skills/fanout-team-agents/SKILL.md`.
**Smoke-mode disclaimer** — the engineer sub-agent that wrote this file CANNOT spawn other sub-agents at Claude Code's runtime (the load-bearing invariant the plan calls out at `.claude/orchestrator.md:3` and `WORKFLOW.md:147-148`). Per the orchestrator's mode-A guidance for this step, this file is a **simulation**: each `### team-<role>` subsection was populated by the engineer reading the corresponding `.claude/agents/team-*.md` file end-to-end and applying its checklist to the real diff above. A second, real smoke run (orchestrator-driven, spawning the workers in parallel) is recommended after wiring lands — see `BLOCKER` notes in the run's return.

## Per-agent findings

### team-code-reviewer
- `.claude/agents/lead.md:77` (Mode B step 1a) — Confidence 88 / Important. Step renumbering: the new "1a" sub-step breaks the existing numbered list shape (1 → 1a → 2). The other modes in the same file use a flat 1..N numbering. Suggested fix: either renumber the whole Mode B step list to 1..7 (with mandatory fanout as step 2), or change `1a.` to a bullet under step 1. The current shape works but is inconsistent.
- `.claude/agents/lead.md:52` (Mode A step 9) — Confidence 82 / Important. The opt-in fanout instruction is appended inline to a step that already has a `MUST` clause about `path:line` citation. Two distinct directives are now glued together; future readers may treat the fanout instruction as conditional on the LSP-first rule. Suggested fix: split into 9a (path:line rule) and 9b (opt-in fanout) for parallel structure with Mode B's "1a" pattern, or move the fanout instruction to its own numbered step.
- `.claude/agents/TEAM.md:21` — Confidence 84 / Important. The seventh bullet (`team-dispatching-skill-source`) is documented as "no agent fork from `superpowers` ships" but is grouped under "Fork sources" as a bullet. The step-17 verify clause counts these bullets via `grep -c "^- team-"` and the count of 7 included this skill-source line. The line is informational and not actually a `team-*` agent — it conflates pattern-source and agent-fork. Suggested fix: move the skill-source line to its own "Pattern source" subsection so the `- team-` bullets count exactly 6.
- `.claude/agents/team-code-reviewer.md:8` (and 5 sibling files) — Confidence 80 / Important. The `Fork source:` block sits between the YAML frontmatter close (`---`) and the agent body. Claude Code's parser is documented as accepting freeform body content; the block is well-placed. No issue, but flagging as a deliberate convention readers may not recognise.

### team-code-simplifier
- `.claude/skills/fanout-team-agents/SKILL.md:96-103` — The "in one message" code-block uses indented pseudo-syntax (`Agent(subagent_type="team-code-reviewer", prompt=<focused-prompt-1>)`). It reads as Python but is illustrative — a reader expecting runnable JS or TS could be confused. Suggestion: change the fence info string from blank to `text` so syntax highlighting doesn't paint it as a real language.
- `.claude/agents/lead.md:110` (Mode C step 1a) — The instruction packs four ideas into one sentence (trigger condition, signal shape, payload, single-bucket fallback). Splitting into two sentences would help: one sentence for "when to fanout", one for "what the orchestrator does". The Mode B equivalent at `:77` has the same density; consider applying the same simplification to both for consistency.
- `WORKFLOW.md:88` — The new "Fanout availability" paragraph is dense (one sentence, six step numbers, two file references). Consider a short bulleted list under the bold lede so the reader can scan which steps support fanout without parsing a long sentence.

### team-comment-analyzer
- `.workflow/_templates/review.md:24-25` — The parenthetical "(present only when fanout ran; omit for single-reviewer runs)" is a *what*-comment, not a *why*-comment, but in template files this is the right call — templates teach future fillers what to do. No issue, but worth noting as a deliberate exception to the project's "WHY-only comments" rule.
- `.claude/agents/lead.md:77` (`FANOUT_REQUESTED: review`) — The new step cites `WORKFLOW.md:153` for the anti-bias rule. That reference is accurate today, but `WORKFLOW.md` lines shift on every edit — comments referencing line numbers in other files rot fast. Consider citing the section title (`Anti-bias rule`) instead of the line number.
- `.claude/agents/TEAM.md:5-8` (naming-convention numbered list) — Each bullet ends with a justification, which is the right shape for a manifest file. Risk: the second bullet says "load-bearing" without spelling out the failure mode. A reader who doesn't know Claude Code's spawn surface won't know what "drift" means here. Suggested addition: one example of the failure mode (e.g., "if `code-reviewer.md` has `name: team-code-reviewer` but the file is named `foo.md`, the spawn fails with `Agent type 'team-code-reviewer' not found`").
- `.claude/agents/team-*.md` (all 6, `Fork source:` line) — These are inline metadata, not comments in the code sense. They are accurate as of 2026-05-21 but will become stale if the upstream file changes and the local copy doesn't track. TEAM.md's drift-awareness rule (`:30-33`) covers this — the per-agent Fork source line is fine.

### team-pr-test-analyzer
- *No production code shipped in this run* — every changed file is a workflow doc, agent prompt, skill, or template. The fanout-team-agents skill is not exercisable by a unit test; the `FANOUT_REQUESTED:` signal shape is exercisable only by a real orchestrator-driven smoke run.
- **Critical gap (rating 9/10)** — AC10 (smoke run produces `review.md` with all 6 per-agent sections populated) is the only end-to-end exercise of the wiring. This file is the engineer's simulation, not a real orchestrator-driven dispatch. The "test" that the wiring actually works end-to-end is *missing* until the orchestrator runs a fresh `/dev` review pass against a real diff with the new wiring in place. Suggested follow-up: the next `/dev` run that hits Phase 2 step 5 should be the implicit acceptance test.
- **Important coverage (rating 7/10)** — the `dev-agent-guard.sh` hook is named in the skill (`SKILL.md:105`) and the plan's Risks table (high likelihood: "this WILL fire"). Whether the guard actually blocks `team-*` spawns is untested by this run. Suggested test: a smoke run that triggers a fanout and observes whether the hook fires + what the error message looks like.
- **Test-quality positive** — the verify-clauses in plan.md are runnable (`grep`, `test -f`, `awk`), and every plan step has one. This is the test plan; it caught the case-sensitive anti-pattern verify clause described in BLOCKER (see engineer return).

### team-silent-failure-hunter
- `.claude/agents/lead.md:77` (`FANOUT_REQUESTED: review`) — **CRITICAL pattern risk**, not a current failure: there is no documented fallback for "the orchestrator does not honor the `FANOUT_REQUESTED:` line". If the orchestrator misses or ignores the signal, `lead` will be re-spawned with no per-agent findings to synthesise, and the review may proceed in single-pass mode with `review.md > Per-agent findings` empty. The skill (`SKILL.md:105-107`) names a fallback ("read the team-*.md inline and apply sequentially") but only for the *guard-hook-blocks-spawn* failure mode, not for the *orchestrator-ignores-signal* failure mode. Suggested fix: add a second fallback paragraph to the skill — if the orchestrator does not return per-agent outputs in lead's re-spawn prompt, lead writes a `BLOCKER:` note explaining that fanout was requested but workers' findings were not returned, and the orchestrator surfaces the question to the user.
- `.claude/orchestrator.md:34` (guard hook) — Not modified in this diff, but the plan's Risks table marks this as high-likelihood. **Silent failure risk**: if the guard blocks `team-*` spawn and the orchestrator does not log the block back to lead, lead synthesises against empty inputs. Mitigation already in the skill (fallback path) but the *visibility* of the guard block to lead is undocumented. Suggested follow-up: the guard hook should write a marker the orchestrator surfaces in lead's re-spawn prompt.
- `.claude/agents/qa.md:32` (Mode opt-in fanout) — The `FANOUT_REQUESTED: test:` signal would have no consumer if the orchestrator's mode-C / step-13 wiring isn't updated to parse it. Same shape as silent-failure-hunter's first finding above — this is a *workflow* silent-failure pattern, not a code one.

### team-type-design-analyzer
- `FANOUT_REQUESTED:` signal — **Invariants (rating 7/10):** the signal is documented as a return-prefix string convention with 5 shapes (`review`, `security:<list>`, `plan:<list>`, `test:<list>`, `implement:<list>`). There is no shared type/parser; each consumer (orchestrator, only) re-parses the line. **Expression (rating 6/10):** the colon-separated list-payload is ad-hoc — a future shape that needs structured params (e.g., per-bucket path filter) would need a new convention. **Usefulness (rating 8/10):** for the current 5 shapes the convention is fit-for-purpose; the prefix is unambiguous and grep-friendly. **Enforcement (rating 4/10):** nothing validates the signal shape at write-time — a sub-agent that returns `FANOUT_REQUESTED:reviiew` (typo) will silently fall through to non-fanout. Suggested follow-up: a tiny parser in the orchestrator that allowlist-checks the prefix and surfaces a `BLOCKER:` if the shape is unrecognised.
- Team-`<role>` filename / `name:` invariant — **Strong design**: filename slug ↔ `name:` YAML lock-step is the load-bearing rule and is documented in three places (TEAM.md `:5-15`, the plan's step 4-9 verify clauses, and the Risks table). Plus per-file `Fork source:` blocks make drift auditable. Concern: nothing enforces the lock-step automatically — a future agent rename will break spawning until a developer notices. Suggested follow-up: a tiny CI/pre-commit check that asserts `name:` matches filename for every `.claude/agents/*.md`.
- `review.md > Per-agent findings` shape — **Encapsulation (rating 8/10):** the section is additive, the parenthetical says when to omit it, and existing single-reviewer runs stay valid. The template's `### team-<role>` subsections are pre-populated with the 6 names so the orchestrator-spawned synthesis pass has the right keys. Risk: the template's pre-populated names will drift if `pr-review-toolkit` upstream renames an agent and we re-fork. TEAM.md's drift-awareness rule covers the rename audit.

## Plan adherence (engineer self-check)

- [x] Step 1 — `.claude/skills/fanout-team-agents/SKILL.md` exists, contains the skill body. evidence: `SKILL.md:1-137`.
- [x] Step 2 — 4 sections present (overview, when-to-use, the pattern, anti-patterns). evidence: `grep -c "^##" SKILL.md` returns 11 ≥ 5.
- [x] Step 3 — anti-patterns named (case-insensitive: "Too broad", "No constraints", "Vague output"). evidence: `SKILL.md:126-128`. *Verify-clause caveat*: the plan's verify uses lowercase regex; the substance is correct, the regex is case-sensitive.
- [x] Steps 4-9 — 6 team-`<role>` agent files exist, renamed lock-step. evidence: `ls .claude/agents/team-*.md` returns 6 files; `grep "^name: team-" .claude/agents/team-*.md` returns 6 matches.
- [x] Step 10 — Fork source blocks present in all 6 files. evidence: `rtk proxy grep -c "^Fork source:" .claude/agents/team-*.md` returns 6 total.
- [x] Step 11 — `## Per-agent findings` section in `.workflow/_templates/review.md`. evidence: `review.md:24-46`.
- [x] Step 12 — Mode B mandatory fanout instruction at `lead.md:77`. evidence: `grep -n "FANOUT_REQUESTED: review" lead.md`.
- [x] Step 13 — Mode C per-bucket fanout at `lead.md:110`. evidence: `grep -n "FANOUT_REQUESTED: security" lead.md`.
- [x] Step 14 — Mode A opt-in fanout at `lead.md:52`. evidence: `grep -n "FANOUT_REQUESTED: plan" lead.md`.
- [x] Step 15 — qa.md opt-in fanout at `qa.md:32`. evidence: `grep -n "FANOUT_REQUESTED: test" qa.md`.
- [x] Step 16 — engineer.md opt-in fanout at `engineer.md:27`. evidence: `grep -n "FANOUT_REQUESTED: implement" engineer.md`.
- [x] Step 17 — `.claude/agents/TEAM.md` exists. evidence: `test -f TEAM.md && grep "Fork date: 2026-05-21" TEAM.md`.
- [x] Step 18 — WORKFLOW.md edits land. evidence: `:88` (fanout-availability paragraph), `:148` (agent-map row).
- [x] Step 19 — this file exists with 6 `### team-` subsections, each non-empty. evidence: `grep -c "^### team-" smoke-review.md` returns 6.

## Acceptance-criteria check (engineer self-check)

- [x] AC1 — `.claude/skills/fanout-team-agents/SKILL.md` exists; documents independent domains, focused prompts, parallel dispatch, integration, and anti-patterns. evidence: `SKILL.md:69-137`.
- [x] AC2 — 6 `team-*.md` files under `.claude/agents/`. evidence: `ls .claude/agents/team-*.md` returns 6 files; each YAML `name:` matches its filename. *Note on the seventh*: the spec line "(6 from `pr-review-toolkit` + the `code-reviewer` from `superpowers`)" was resolved by Open question E to drop the `superpowers` variant; 6 forks ship, not 7, and TEAM.md records the resolution (`:21`).
- [x] AC3 — `lead.md` Mode B (`:77`) documents the mandatory 6-worker fanout; `review.md` template (`:24-46`) carries the per-agent section shape lead will fill on synthesis.
- [x] AC4 — `lead.md` Mode C (`:110`) documents the per-bucket fanout opt-in.
- [x] AC5 — `lead.md` Mode A (`:52`) documents the opt-in plan-mode fanout with the "≥ 2 independent integration points" heuristic.
- [x] AC6 — `qa.md` (`:32`) documents the opt-in test-mode fanout with the "≥ 2 categories AND any category ≥ 3 tests" heuristic.
- [x] AC7 — `engineer.md` (`:27`) documents the opt-in implement-mode fanout with the "L-tier + Phases + disjoint Files touched" heuristic.
- [x] AC8 — `.workflow/_templates/review.md` (`:24-46`) carries the additive `## Per-agent findings` section with the "(present only when fanout ran; omit for single-reviewer runs)" annotation, keeping single-reviewer runs valid.
- [x] AC9 — `WORKFLOW.md` (`:88` + `:148`) and `.claude/agents/TEAM.md` together name the skill, the 6 forks, and the fork-source/date.
- [~] AC10 — *engineer-simulated smoke run*. This `smoke-review.md` contains the 6 per-agent subsections, each populated by the engineer reading the corresponding `team-*.md` and applying its checklist heuristically to the real diff of this run. **A real orchestrator-driven smoke run is still required** after the wiring lands — see BLOCKER in the engineer's return.

## Findings (engineer synthesis)

### Blocking
- AC10 cannot be fully ticked from inside a sub-agent. The engineer sub-agent cannot spawn `team-*` workers; this file is a simulation, not a real fanout dispatch. The orchestrator (or `lead` at next review) must run a real fanout once and confirm the 6 sections come back populated. Until then AC10 is `~` (partial) not `[x]`.

### Non-blocking (carry to retro)
- The plan's step 3 verify-clause regex is case-sensitive against substance that uses capital-letter starts; rephrase the regex (or the headings) at retro. Substance is correct — only the verify-clause regex is off.
- TEAM.md groups the pattern-source line (`team-dispatching-skill-source`) under the same `- team-` bullet shape as the 6 agent forks; the step-17 verify-clause counts 7 bullets (matches plan exactly) but the bullet shape conflates pattern-source and agent. Consider a sub-section for the pattern source so the agent count is exactly 6.
- The `FANOUT_REQUESTED:` signal has no parser or validator; a typo silently falls through to non-fanout. Add a follow-up to file a small orchestrator-side parser.
- The dev-agent-guard hook (`.claude/orchestrator.md:34`) will likely block `team-*` spawns on the first real run; the plan's Risks table calls this out at high likelihood. The mitigation is documented in `SKILL.md:105-107`, but the *real* unblock (relax the guard allowlist) is a follow-up the smoke run will surface.

## Sign-off
pass-with-caveat (engineer simulation) — needs real orchestrator-driven smoke run to confirm AC10. See Phase 2 step 5 of the next `/dev` run that exercises the new wiring.
