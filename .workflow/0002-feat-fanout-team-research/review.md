# Review: Fanout team agents

**Plan**: [./plan.md](./plan.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: 2026-05-21
**Verdict**: pass (cycle 2 — see `## Cycle 2 verification` at end)
**Cycle**: 2 of max 2
**Fanout-this-cycle**: no (orchestrator override; cycle-2 scope is verification of B1–B8 only)

> Fanout note: this review IS the first observation of the new fanout path end-to-end. The orchestrator dispatched the 6 `team-*` workers via the inline-fallback route (`SKILL.md:105-107`) because Claude Code's agent registry is session-scoped and the freshly-created `team-*.md` files were not yet discoverable as `subagent_type=team-*`. Every `### team-<role>` subsection below carries a `Dispatched-as:` provenance line per the silent-failure-hunter's recommendation; this is a real-world instance of the failure mode B4 below names — and a different mechanism than the guard-hook story `SKILL.md:105-107` and `plan.md:158` describe.

## Plan adherence

One row per plan step.

- [x] Step 1 (create skill file) — implemented. `.claude/skills/fanout-team-agents/SKILL.md:1-6` exists; `name: fanout-team-agents` present.
- [x] Step 2 (4 core sections) — implemented. `SKILL.md` carries `## Overview` (`:8`), `## When to use` (`:23`), `## The load-bearing invariant` (`:41`), `## The pattern` with the 4 subsections (`:67`, `:80`, `:91`, `:111`). `grep -c "^##"` ≥ 5.
- [x] Step 3 (anti-patterns) — implemented with a verify-clause defect (carry to retro). `SKILL.md:122-128` names all three modes ("Too broad prompts", "No constraints", "Vague output shape") — but the plan's regex `grep -E "too.broad|no constraint|vague output"` is case-sensitive and would miss the capital-letter starts. Substance OK; regex off.
- [x] Step 4 (team-code-reviewer fork) — implemented. `.claude/agents/team-code-reviewer.md:2` `name: team-code-reviewer` present.
- [x] Step 5 (team-code-simplifier fork) — implemented. `.claude/agents/team-code-simplifier.md` present with renamed YAML.
- [x] Step 6 (team-comment-analyzer fork) — implemented. `.claude/agents/team-comment-analyzer.md` present.
- [x] Step 7 (team-pr-test-analyzer fork) — implemented. `.claude/agents/team-pr-test-analyzer.md` present.
- [x] Step 8 (team-silent-failure-hunter fork) — implemented. `.claude/agents/team-silent-failure-hunter.md` present.
- [x] Step 9 (team-type-design-analyzer fork) — implemented. `.claude/agents/team-type-design-analyzer.md` present.
- [x] Step 10 (Fork source block ×6) — implemented. `grep -c "^Fork source:" .claude/agents/team-*.md` returns 6.
- [x] Step 11 (review.md template) — implemented. `.workflow/_templates/review.md:23-44` carries `## Per-agent findings` with the omit-for-single-reviewer parenthetical and the 6 `### team-<role>` subsections; existing `Plan adherence` / `Acceptance-criteria check` / `Findings > Blocking/Non-blocking` retained (`:9-13`, `:15-21`, `:46-52`).
- [x] Step 12 (lead Mode B mandatory fanout) — implemented. `.claude/agents/lead.md:77` carries the `1a.` step with `FANOUT_REQUESTED: review` and all 6 worker names; cites the skill.
- [x] Step 13 (lead Mode C per-bucket fanout) — implemented. `.claude/agents/lead.md:110` `1a.` carries `FANOUT_REQUESTED: security:<bucket-list>` with the ≥ 2 buckets heuristic.
- [x] Step 14 (lead Mode A plan-mode opt-in) — implemented. `.claude/agents/lead.md:52` (Mode A step 9) carries `FANOUT_REQUESTED: plan:<point-list>` with the integration-points heuristic.
- [x] Step 15 (qa opt-in fanout) — implemented. `.claude/agents/qa.md:32` `1a.` carries `FANOUT_REQUESTED: test:<category-list>`.
- [x] Step 16 (engineer opt-in fanout) — implemented. `.claude/agents/engineer.md:27` (sub-bullet under step 3) carries `FANOUT_REQUESTED: implement:<phase-list>`.
- [x] Step 17 (TEAM.md manifest) — implemented but with B2 typo (see Blocking). `.claude/agents/TEAM.md:1-33` exists; `Fork date: 2026-05-21` at `:25`; 7 `^- team-` bullets (the 7th is the pattern-source line — see Non-blocking).
- [x] Step 18 (WORKFLOW.md edits) — implemented. `WORKFLOW.md:88` carries the Fanout-availability paragraph naming the skill + 6 team agents + TEAM.md; `WORKFLOW.md:148` adds the `team-*` agent-map row.
- [~] Step 19 (smoke run) — **deviated** (not skipped — partial fulfilment). The engineer wrote `smoke-review.md` as a *simulation* (each `### team-<role>` populated by reading the team-*.md inline and applying its checklist), not a real orchestrator-driven parallel dispatch. The engineer's self-disclosed BLOCKER (`smoke-review.md:5, :70, :75`) is honest; THIS `review.md` is the first real observation of the fanout path end-to-end, but it ran via the inline-fallback route, not real parallel `team-*` spawns (B4).

## Acceptance-criteria check

Re-verified against the diff, not trusting the engineer's checkbox alone.

- [x] AC1 (skill exists + 4 mechanics + anti-patterns) — verified. `SKILL.md:67-128` carries the 4 mechanics subsections (identify-independent-domains, focused-prompts, parallel-dispatch, findings-integration) and the 3 anti-patterns (`:124-128`). Re-tick holds.
- [x] AC2 (7 team agents exist) — verified with caveats. 6 `.claude/agents/team-*.md` files exist; `name:` YAML matches filename slug for each. **Headline contradiction in the spec** (B7): AC2 sentence says "All 7 team agents exist" then says "6 team agents land" — both in the same bullet. Substance is correct (6 forks ship; Open question E resolved to drop the superpowers variant) but the AC text contradicts itself. Re-tick the substance; flag the wording.
- [x] AC3 (lead review-mode fanout + per-agent sections) — verified, with the inline-fallback caveat. `lead.md:77` wires the dispatch; `review.md` template (this template) carries the 6 subsections; THIS review.md is the first actual fill-in of the per-agent sections. **AC3's evidence at spec.md:49 still cites `.workflow/_templates/review.md:24-46` correctly.** Re-tick.
- [x] AC4 (security-mode per-bucket fanout) — verified. `lead.md:110` documents the opt-in with the ≥ 2 buckets heuristic.
- [x] AC5 (plan-mode opt-in fanout) — verified. `lead.md:52` (Mode A step 9) documents the integration-points heuristic.
- [x] AC6 (qa test-mode opt-in fanout) — verified. `qa.md:32` documents the ≥ 2 categories + ≥ 3 tests heuristic; single-pass default preserved.
- [x] AC7 (engineer implement-mode opt-in fanout) — verified, but the engineer-fanout shape is structurally questionable (B5 / non-blocking #5). `engineer.md:27` documents the L-tier + Phases + disjoint-Files-touched heuristic. **Structural concern (non-blocking)**: parallel engineers race state.json discipline (`orchestrator.md:34` Case 3 guard); the AC re-ticks against the prose but the design is brittle.
- [x] AC8 (template accommodates both shapes) — verified. `.workflow/_templates/review.md:24-25` carries the "(present only when fanout ran; omit for single-reviewer runs)" parenthetical; the existing single-reviewer sections (`Plan adherence`, `Acceptance-criteria check`, `Findings > Blocking/Non-blocking`) are intact.
- [x] AC9 (WORKFLOW.md + TEAM.md docs) — verified with B8 caveat. `WORKFLOW.md:88` + `:148` carry the references; `.claude/agents/TEAM.md:1-33` carries the manifest with `Fork date: 2026-05-21`. The spec evidence cites `WORKFLOW.md:88` and `:148` — those ARE the right paragraphs today but line citations are brittle (B8).
- [x] AC10 (smoke run) — flipped from `[~]` to `[x]` against THIS `review.md`. The AC10 evidence in spec.md:56 still points at `smoke-review.md`; per the engineer's BLOCKER note ("orchestrator/lead runs a real smoke after wiring lands; if it succeeds, AC10 flips to `[x]`"), this run-in-progress IS that real smoke. **Evidence re-citation needed** (non-blocking): spec.md:56 should be updated to cite `review.md` not `smoke-review.md` as the real smoke artifact, and the parenthetical BLOCKER text removed. THIS `review.md` carries 6 `### team-<role>` subsections each with non-empty findings; `grep -c "^### team-" review.md` returns 6.

## Files touched verification

One verification line per `plan.md > Files touched` row (13 rows).

- `.claude/skills/fanout-team-agents/SKILL.md` (new) — exists; 137 lines; carries the 4 mechanics sections and anti-patterns per AC1. **B1 caveat**: `:105-107` documents a guard-hook block-rule that does not match what `dev-agent-guard.sh` actually does.
- `.claude/agents/team-code-reviewer.md` (new) — exists; `name: team-code-reviewer` at `:2`.
- `.claude/agents/team-code-simplifier.md` (new) — exists; renamed YAML.
- `.claude/agents/team-comment-analyzer.md` (new) — exists; renamed YAML.
- `.claude/agents/team-pr-test-analyzer.md` (new) — exists; renamed YAML.
- `.claude/agents/team-silent-failure-hunter.md` (new) — exists; renamed YAML.
- `.claude/agents/team-type-design-analyzer.md` (new) — exists; renamed YAML.
- `.claude/agents/TEAM.md` (new) — exists with `Fork date: 2026-05-21` at `:25`. **B2 BLOCKER**: line `:22` destination path reads `→ .claude/agents/type-design-analyzer.md` (missing `team-` prefix). This is the manifest itself violating the lock-step invariant TEAM.md documents.
- `.claude/agents/lead.md` (edit) — edited at `:52` (Mode A step 9), `:77` (Mode B step 1a), `:110` (Mode C step 1a). All three carry the documented `FANOUT_REQUESTED:` signal shapes and cite the skill. **Numbering deviation**: `1a.` shape breaks the existing flat 1..N numbering of every other mode (non-blocking).
- `.claude/agents/qa.md` (edit) — edited at `:32` (step 1a). Mode-A "Full / Fix" steps block carries the opt-in signal.
- `.claude/agents/engineer.md` (edit) — edited at `:27` (sub-bullet under Mode A step 3). Carries the opt-in signal but the resulting shape (multiple engineers racing state.json) is the structural concern under B5/non-blocking.
- `.workflow/_templates/review.md` (edit) — edited at `:22` onward; added `## Per-agent findings` section with 6 pre-populated `### team-<role>` subsections and the omit-for-single-reviewer parenthetical at `:24`.
- `WORKFLOW.md` (edit) — edited at `:88` (Fanout-availability paragraph under the phase matrix) and `:148` (team-* row in the agent map). **B3 BLOCKER**: `.claude/orchestrator.md` is NOT in this diff but the orchestrator IS the consumer of every `FANOUT_REQUESTED:` signal; the protocol's consumer side has zero documentation where the consumer reads it.

## Per-agent findings

The 6 workers were dispatched via the inline-fallback route (`SKILL.md:105-107` documented fallback) because Claude Code's agent registry is session-scoped — `team-*.md` files created mid-session are not yet discoverable as `subagent_type=team-*`. Each subsection below carries a `Dispatched-as:` provenance line per the silent-failure-hunter's recommendation.

### team-code-reviewer
**Dispatched-as**: `general-purpose` (inline-fallback — registry-not-refreshed)

- **Critical / conf 96** — `.claude/agents/TEAM.md:22` destination path reads `→ .claude/agents/type-design-analyzer.md`, missing the `team-` prefix that lines :17-21 use. The manifest violates the lock-step invariant TEAM.md documents at `:7-11`. (B2)
- **Critical / conf 92** — `.claude/skills/fanout-team-agents/SKILL.md:105` claims `dev-agent-guard.sh` "restricts the orchestrator's `Agent` calls to the 5 /dev workers", but the hook does no such thing for `team-*` types. Case 1 blocks `orchestrator` only; Case 2 blocks `general-purpose` only when description prefix is one of the 5 workers; Case 3 enforces state.json discipline only for the 5 workers. A `team-*` spawn just exits 0. The skill misdirects readers to a non-existent constraint. (B1)
- **Important / conf 89** — `.claude/orchestrator.md` carries zero references to `FANOUT_REQUESTED`, fanout, or `team-*`. The consumer-side wiring documented in SKILL.md doesn't exist where the consumer reads it. (B3)
- **Important / conf 84** — `.claude/agents/lead.md:77` uses `1a.` numbering, breaking the flat 1..N pattern of the rest of the file. Cross-refs to "step 2" now ambiguous. Same shape at `:110`, `:32` (qa), `:27` (engineer).
- **Important / conf 82** — `WORKFLOW.md:148` agent-map row says `team-*` agents return findings "to the calling /dev sub-agent for synthesis" — but the actual return path is sub-agent → orchestrator → re-spawn-calling-sub-agent. The row understates the bounce.
- **Important / conf 80** — Spec `:48` AC2 says "All 7 team agents exist" then "6 team agents land". Status=approved with the contradiction in the headline. (B7)

### team-code-simplifier
**Dispatched-as**: `general-purpose` (inline-fallback — registry-not-refreshed)

- **Clarity** — `.claude/agents/TEAM.md:22` typo flips the load-bearing invariant the file is documenting; one missing word breaks the section's whole point. (B2)
- **Complexity** — Roster of 6 names duplicated across 5 places: `SKILL.md:16-21`, `TEAM.md:17-22`, `lead.md:77`, `review.md` template `:28-43`, `WORKFLOW.md:88`. Single source of truth missing; one rename will cascade.
- **Complexity** — The `FANOUT_REQUESTED:` instruction prose at `lead.md:77`, `:110`, `:52`, `qa.md:32`, `engineer.md:27` is structurally identical (trigger, signal shape, payload, default) but repeated longhand 5×. Extract to skill, cite from each site.
- **Redundancy** — "Pattern documented in `.claude/skills/fanout-team-agents/SKILL.md`" trailer repeated 5× — could be one banner at the top of each agent file.
- **Consistency** — `model:` YAML field inconsistent across the 6 forks (2 `opus`, 4 `inherit`); `When to invoke` section present in 4/6 forks but absent in 2; trigger heuristic syntax drifts across the 5 fanout callsites (`≥ 2 independent`, `≥ 2 distinct`, `≥ 2 of {…}`).
- **Compactness** — `SKILL.md:53-65` has both a code block (the 5 shapes) and a bullet list explaining the same 5 shapes — pick one.

### team-comment-analyzer
**Dispatched-as**: `general-purpose` (inline-fallback — registry-not-refreshed)

- **Critical** — `plan.md:38` cites `WORKFLOW.md:147-148` for the sub-agent-cannot-spawn invariant; after the WORKFLOW.md edits at `:88` and `:148`, downstream content shifted by 3 lines. The cite is stale. Same shape: `plan.md:57` cites `WORKFLOW.md:147-148`, `plan.md:38` cites `WORKFLOW.md:153`. (B8)
- **Critical** — `SKILL.md:105` documents a non-existent guard-hook block-rule (the hook does no such thing for `team-*` types). The comment is rotting at write-time. (B1)
- **Critical** — `TEAM.md:22` destination typo. (B2)
- **Improvement** — `.claude/orchestrator.md` carries no FANOUT_REQUESTED / fanout / team-* mentions; the protocol's consumer-side instructions are absent from the consumer. (B3)
- **Improvement** — Spec AC2 (`:48`) headline contradiction "7 ... 6". (B7)
- **Improvement** — TEAM.md `:22-23` 7th bullet (`team-dispatching-skill-source`) is a pattern source, not an agent fork, but uses the `^- team-` bullet shape that `plan.md:123` step-17 verify-clause counts; the count of 7 is "correct" only because the bullet shape conflates two things.
- **Cross-cutting** — Replace `WORKFLOW.md:<number>` cites repo-wide with section-anchor refs (e.g., "WORKFLOW.md > Anti-bias rule") so line-shift doesn't rot them.
- **Positive** — `WORKFLOW.md:88` already uses the section name (`Type-aware phase matrix`) rather than line number — good pattern.
- **Positive** — `TEAM.md:7-11` invariants are observable (filename ↔ name: lock-step is grep-checkable).
- **Positive** — `review.md` template `:24` parenthetical encodes the optional-shape rule inline so the next filler can't miss it.

### team-pr-test-analyzer
**Dispatched-as**: `general-purpose` (inline-fallback — registry-not-refreshed)

- **Critical / sev 9** — AC10's evidence is non-reproducible: `smoke-review.md` is engineer-simulated, indistinguishable in shape from a real fanout output. AC10 reads `[~]` correctly today; the proposed fix (this `review.md` becomes the real-smoke artifact) only holds because THIS review's `Dispatched-as:` provenance lines exist. Without those lines, a future reader cannot tell simulation from reality.
- **Critical / sev 9** — `plan.md:158`, `SKILL.md:105-107`, and `smoke-review.md:5` all document the WRONG failure mode for `team-*` spawns. The real mechanism observed live this session is the session-scoped agent registry, not a guard-hook allowlist. (B1, B4)
- **Critical / sev 8** — `engineer.md:27` `implement:<phase-list>` shape: 3 parallel engineers would race `state.json` discipline (`orchestrator.md:34` Case 3 guard blocks the next worker spawn until state.json mtime > marker mtime). Structurally broken under load. (non-blocking #5)
- **Important / sev 7** — AC2 evidence contaminated by `TEAM.md:22` typo — the spec's AC2 evidence pointer to `TEAM.md:21` for the "6 vs 7" resolution falls under the typo's blast radius. (B2)
- **Important / sev 6** — Plan step 19 verify-clause `grep -c "^### team-" smoke-review.md` returns 6 — counts headers, not content; an all-empty-sections smoke would still tick.
- **Important / sev 7** — AC3's evidence at `spec.md:49` cites `.workflow/_templates/review.md:24-46` for the 6 subsections, but the template ships the headers as placeholders. AC3's real evidence — a populated `review.md` from a real fanout — only exists from THIS run on.
- **Important / sev 7** — Missing AC: a `FANOUT_REQUESTED:` signal validator. The signal has no parser anywhere; typos silently fall through. Candidate AC11. (B5)
- **Important / sev 8** — Missing AC: agent-registry refresh discipline (B4). The real failure mode observed today has no AC pinning it. Candidate AC12.
- **Re-verifiability matrix** (1=trivial, 10=non-defensible): AC1=2, AC2=4, AC3=7, AC4=5, AC5=5, AC6=5, AC7=8, AC8=3, AC9=5, AC10=9. AC7 and AC10 are the lowest-defensibility.
- **Positive** — Every plan step has a runnable verify-clause (`grep`, `test -f`, `awk`); the smoke-review.md disclosed its own case-sensitivity defect at `:46` honestly.

### team-silent-failure-hunter
**Dispatched-as**: `general-purpose` (inline-fallback — registry-not-refreshed)

- **Critical #1** — Session-scoped agent registry: live-observed this session. Orchestrator's `Agent(subagent_type="team-*", ...)` failed with "Agent type 'team-*' not found" because the registry is loaded at session start and the `team-*.md` files were created mid-session. The fallback (inline read of each `team-*.md` and dispatch via `general-purpose`) WORKED but produces an artifact byte-identical in shape to a real parallel dispatch. **Without provenance markers (`Dispatched-as:` line per subsection), AC3 ticks `[x]` even though no parallel dispatch occurred this session.** This is the load-bearing observability gap. (B4, B6)
- **Critical #2** — `FANOUT_REQUESTED:` signal has no validator. Six silent-typo paths: `FANOUT_REQUESTED:reviiew` (typo), `FANOUT_REQUESTED: REVIEW` (case), `FANOUT_REQUESTED:review` (no space), `FANOUT_REQUESTED: review extra` (trailing junk), `FANOUTREQUESTED: review` (missing underscore), `Fanout_Requested: review` (case-mixed prefix). Recommended fix: regex allowlist parser in `.claude/orchestrator.md` — "starts with `FANOUT_REQ` (case-insensitive) but doesn't match exact 5 shapes → BLOCKER". (B5)
- **Important #3** — Guard-hook denial path documented in `SKILL.md:105` is FALSE. `dev-agent-guard.sh` (read end-to-end) does not restrict `team-*` spawns at all — Case 1 blocks `orchestrator`, Case 2 blocks `general-purpose` with worker-prefix description, Case 3 enforces state.json mtime discipline for the 5 workers only. `team-*` subagent_type passes through to `exit 0`. The skill misdirects readers; the real block this session was registry-not-found, not the guard. **Adjacent risk**: `.last_worker_return` marker (`dev-state-mark.sh`) on a `team-*` return could mis-attribute future blocking errors if that hook is symmetric. (B1)
- **Important #4** — "(no findings)" indistinguishable from "worker crashed / partial return". Template's per-agent subsections should require a `Status: findings | no-findings | did-not-return` line per subsection so an empty `### team-X` distinguishes from a missing one.
- **Important #5** — Inline-fallback artifact byte-identical to real parallel dispatch (load-bearing duplicate of #1). AC3 ticks `[x]` even when no parallel dispatch occurred. Provenance markers on every per-agent subsection are the fix. (B6)
- **Minor #6** — `WORKFLOW.md:88` and `:148` claims read as aspirational on first install; add a one-line footnote about session restart requirement so future readers don't get bitten by the registry-load-at-session-start invariant.

### team-type-design-analyzer
**Dispatched-as**: `general-purpose` (inline-fallback — registry-not-refreshed)

- **Encapsulation 6/10** — `FANOUT_REQUESTED:` semantics live in `SKILL.md:53-59` (one enumeration of 5 shapes) but the *callers* (`lead.md:77`, `:110`, `:52`, `qa.md:32`, `engineer.md:27`) all repeat the shape in prose; no shared snippet. No parser reference anywhere in `.claude/orchestrator.md`. (B3)
- **Expression 4/10** — Illegal states trivially representable: `FANOUT_REQUESTED: foo` parses, `FANOUT_REQUESTED: review:extra` parses, `FANOUT_REQUESTED:review` (no space) parses, `FANOUT_REQUESTED: REVIEW` parses. The payload format (`security:auth,crypto`) is ad-hoc — no extension point if a future shape needs per-bucket path filters.
- **Usefulness 6/10** — Signal carries the *opt-in/skip* decision from the sub-agent (which has local plan/spec context) to the orchestrator (which can dispatch). That's the right direction. Weakness: payload portion is weaker — the orchestrator still has to parse and validate against `spec.md` / `plan.md`. A cleaner design: the sub-agent returns focused prompts directly, not a payload to interpret.
- **Enforcement 2/10** — LOAD-BEARING FAILURE. Nothing validates the signal. No allowlist. No companion hook to `dev-agent-guard.sh`. The only "enforcement" is "orchestrator reads SKILL.md and chooses to honor the prefix." Lower than smoke-review.md's self-score (4/10) because (a) smoke skipped the registry-mismatch failure mode entirely, (b) the existing `dev-agent-guard.sh` proves this repo CAN enforce allowlists for similar invariants — there is no excuse for the asymmetry. (B5)
- **Strengths** — Single enumeration at `SKILL.md:53-59`; prefix grep-friendly; sub-agents-can't-spawn invariant well-expressed at `SKILL.md:43-46`; all 6 forks have correct YAML `name:` field matching filename.
- **Concerns** — (1) `TEAM.md:22` adjacent invariant (filename ↔ name:) violated by the manifest itself (B2); (2) guard allowlist silently broadened in the prose but not in code; (3) `TEAM.md` `^- team-` returns 7 not 6 due to pattern-source bullet conflation; (4) no fallback for "orchestrator ignores signal"; (5) no automated YAML name-match check.
- **Verdict** — average 4.5/10. The adjacent typed surface (YAML name) is currently in lock-step but the manifest at `TEAM.md:22` already drifted — concrete evidence that prose-only enforcement has already cost one bug.

## Findings

### Blocking

- **B1** — `.claude/skills/fanout-team-agents/SKILL.md:105-107` and `plan.md:158` are factually wrong about what `dev-agent-guard.sh` does. The hook does not restrict `team-*` spawns; the skill misdirects readers to a non-existent block-rule and a non-existent remediation ("relax the guard"). **Fix**: rewrite `SKILL.md:105-107` to describe the actual failure mode observed this session (session-scoped agent registry — agents created mid-session are not discoverable until session restart; inline-fallback applies when registry-lookup fails) and update `plan.md:158` Risks row accordingly. (3+ workers converge: team-code-reviewer Critical conf 92, team-comment-analyzer Critical, team-pr-test-analyzer Critical sev 9, team-silent-failure-hunter Important #3, team-type-design-analyzer Concerns.)
- **B2** — `.claude/agents/TEAM.md:22` destination path reads `→ .claude/agents/type-design-analyzer.md`, missing the `team-` prefix used at lines `:17-21`. The manifest violates the very lock-step invariant TEAM.md documents at `:7-11`. **Fix**: change `:22` to `→ .claude/agents/team-type-design-analyzer.md` (one-character add: insert `team-` before `type-design`). (5 workers converge: team-code-reviewer Critical conf 96, team-code-simplifier Clarity, team-comment-analyzer Critical, team-pr-test-analyzer Important sev 7, team-type-design-analyzer Concerns 1.)
- **B3** — `.claude/orchestrator.md` carries ZERO references to `FANOUT_REQUESTED`, fanout, or `team-*`. The protocol's consumer-side instructions don't exist where the consumer reads them. The orchestrator is supposed to (a) recognize the `FANOUT_REQUESTED:` prefix on a sub-agent return, (b) parse one of the 5 shapes, (c) dispatch the right workers in parallel, (d) re-spawn the caller with worker outputs — none of this is documented in `.claude/orchestrator.md`. **Fix**: add one new section to `.claude/orchestrator.md` ("Fanout dispatch") describing the prefix-recognition, the 5 shapes, the dispatch pattern (one `Agent(...)` per worker, all in one message), and the re-spawn-for-synthesis flow. (4 workers converge: team-code-reviewer Important conf 89, team-comment-analyzer Improvement, team-silent-failure-hunter implicit in Important #4, team-type-design-analyzer Encapsulation 6/10.)
- **B4** — The session-scoped-registry silent-failure mode was just observed live and is undocumented. `SKILL.md:105-107` describes the wrong mechanism (guard-hook); the actual mechanism is "agent registry loaded at session start; new `team-*.md` files require a session restart to be discoverable; until then, `Agent(subagent_type="team-*", ...)` fails with `Agent type 'team-*' not found`". The inline-fallback documented at `SKILL.md:105-107` happens to be the right escape hatch, but for the wrong stated reason. **Fix**: add a new subsection under `## The load-bearing invariant` in `SKILL.md` documenting the registry-refresh discipline and pointing at the inline-fallback as the correct workaround until session restart. (2 workers converge: team-silent-failure-hunter Critical #1, team-pr-test-analyzer Critical sev 9 #2.)
- **B5** — No validator for the `FANOUT_REQUESTED:` prefix. Typos / case errors / payload-shape errors silently fall through to non-fanout. 6 documented silent-typo paths (see team-silent-failure-hunter Critical #2). **Fix**: add a small parser to `.claude/orchestrator.md`'s new fanout-dispatch section — regex allowlist for the 5 documented shapes, BLOCKER on any return whose first line starts with `FANOUT_REQ` (case-insensitive) but doesn't match exactly. (3 workers converge: team-silent-failure-hunter Critical #2, team-type-design-analyzer Enforcement 2/10, team-pr-test-analyzer Important sev 7 #7.)
- **B6** — The inline-fallback artifact (this very review!) is byte-identical in shape to a real parallel-dispatch artifact, with no provenance marker by default. AC3 will tick `[x]` even when no parallel dispatch actually occurred — as in this very review, where the workers were dispatched via `general-purpose` not the named `team-*` subagent types. **Fix**: update the `.workflow/_templates/review.md` per-agent-section shape to require a `Dispatched-as: <subagent_type> (<reason>)` line at the top of each `### team-<role>` subsection. The orchestrator should capture each `Agent` invocation's actual `subagent_type` and emit it as that line during synthesis. This `review.md` already carries the lines manually; the template should make them mandatory. (2 workers converge: team-silent-failure-hunter Critical #1 + Important #5.)
- **B7** — Spec `:48` AC2 reads "All 7 team agents exist" then "6 team agents land" in the same bullet. Status=approved with the contradiction in the headline. **Fix**: rewrite AC2 to say "All 6 `pr-review-toolkit` team agents exist (Open question E resolved: drop `superpowers` `code-reviewer` variant)" — one sentence, no count drift. (2 workers converge: team-code-reviewer Important conf 80, team-comment-analyzer Improvement.)
- **B8** — `WORKFLOW.md` line cites in plan.md (`:147-148`, `:153`) are stale: the new edits at `:88` (Fanout availability) and `:148` (team-* agent map row) shifted downstream content by 3 lines. The plan's invariant cites at `:38` and `:57` now point at the wrong content. **Fix**: replace numeric `WORKFLOW.md:<number>` cites in `plan.md` with section-anchor refs ("WORKFLOW.md > Anti-bias rule", "WORKFLOW.md > Agent map"). Apply the same rule to future cites in `lead.md`, `qa.md`, `engineer.md`. (1 worker: team-comment-analyzer Critical #1, but verified independently at orchestrator-time.)

### Non-blocking
- Roster of 6 team-agent names duplicated across 5 places (`SKILL.md:16-21`, `TEAM.md:17-22`, `lead.md:77`, `review.md` template `:28-43`, `WORKFLOW.md:88`). Single rename will cascade. Carry as a refactor follow-up.
- `1a.` numbering at `lead.md:77`, `:110`, `:52`, `qa.md:32`, `engineer.md:27` breaks the existing flat 1..N pattern of every other mode. Numeric cross-refs to "step 2" now ambiguous. Consider renumbering whole step lists or moving to bulleted sub-steps.
- `model:` YAML field inconsistent across the 6 forks (2 `opus`, 4 `inherit`). Pick one.
- `When to invoke` section present in 4/6 forks but absent in 2. Either keep in all 6 or none.
- `engineer.md:27` `implement:<phase-list>` shape: 3 parallel engineers race `state.json` discipline (`orchestrator.md:34` Case 3 guard). Structurally questionable. Consider deferring `implement:` fanout to a follow-up until state.json is namespaced per-phase or the Case 3 guard is relaxed for parallel engineers.
- AC10 evidence in `spec.md:56` should be re-cited against THIS `review.md`, not `smoke-review.md`, once this run is committed. The BLOCKER text in AC10's evidence should be removed; the `[~]` should flip to `[x]`.
- TEAM.md `:22-23` 7th bullet (`team-dispatching-skill-source`) conflates pattern-source with agent-fork under the `^- team-` shape. The step-17 verify count of 7 happens to match, but the bullet shape misrepresents. Sub-section the pattern source.
- Candidate AC11 (signal validator): pin the `FANOUT_REQUESTED:` allowlist parser as an AC in a follow-up `/dev` run.
- Candidate AC12 (registry refresh discipline): pin "agents created mid-session require session restart OR inline-fallback" as an AC.
- Trigger-heuristic syntax drifts across the 5 fanout callsites (`≥ 2 independent`, `≥ 2 distinct`, `≥ 2 of {…}`). Normalize.
- `WORKFLOW.md:148` agent-map row understates the return path (says "to the calling /dev sub-agent for synthesis"; real path is sub-agent → orchestrator → re-spawn).
- `SKILL.md:53-65` has both a code block and a bullet list explaining the same 5 shapes — pick one.
- `SKILL.md:96-103` pseudo-code-block has no fence info-string; syntax-highlighting risk. Set to `text`.

## Sign-off
**fix-required** — cycle 1 of max 2. B1–B8 are blocking and small to fix (one-character add for B2, one-paragraph rewrite for B1/B4, one new section for B3, one sentence for B7, repo-wide cite cleanup for B8, one template edit for B6, one parser stub for B5). The large items (signal validator parser at B5, registry-refresh discipline at B4) are mostly documentation today; the runtime code for the validator can ship as a follow-up. Return to engineer with these findings.

---

## Cycle 2 verification

**Cycle**: 2 of max 2.
**Fanout-this-cycle**: no (orchestrator override — cycle-2 scope is the narrow verification walk of B1–B8 and AC re-tick only; cycle-1 fanout produced the 6 per-agent sections + 8 blocking findings above, and the engineer's fix pass touched 8 files in a single closed scope. Re-running the 6-worker fanout would cost 6 more parallel dispatches for the same narrowly-scoped check. Orchestrator authorised.)
**Verified against**: post-fix diff (8 affected files: `SKILL.md`, `TEAM.md`, `orchestrator.md`, `lead.md`, `_templates/review.md`, `WORKFLOW.md`, `spec.md`, `plan.md`).

### B-item resolution grid

| B# | Status | Evidence |
|----|--------|----------|
| B1 (SKILL.md guard-hook misstatement) | **resolved** | `SKILL.md:105-111` now correctly enumerates the 3 hook cases (Case 1 = `orchestrator` block, Case 2 = `general-purpose` with worker-prefix description block, Case 3 = state.json discipline for the 5 /dev workers) and states plainly that `team-*` falls through every case and exits 0. The real failure mode (session-scoped registry) is documented separately at `SKILL.md:128-143`. Plan.md Risks row aligned at `plan.md:158` (renamed from guard-hook story to "first live fanout will fail at the spawn surface with `Agent type 'team-*' not found`"). |
| B2 (TEAM.md:22 typo) | **resolved** | `TEAM.md:22` now reads `→ .claude/agents/team-type-design-analyzer.md` (with the `team-` prefix); lock-step invariant restored. |
| B3 (orchestrator FANOUT_REQUESTED missing) | **resolved** | `.claude/orchestrator.md:91-157` adds a full `## Fanout dispatch` section covering (a) signal recognition at `:95-103`, (b) the 5 payload shapes at `:105-113`, (c) the parallel-dispatch pattern at `:115-129`, (d) the registry-not-refreshed fallback at `:131-136`, (e) the re-spawn-for-synthesis flow at `:138-145`, (f) the Phase-2 fanout-fire map at `:147-156`. Phase 1 step 8 (`:46`) and Phase 2 steps 10/11/12/13 (`:60-78`) all cross-reference `## Fanout dispatch`. |
| B4 (session-scoped registry failure mode undocumented) | **resolved** | `SKILL.md:126-143` adds `## Operational caveats > Agent registry is session-scoped` with the live-observed symptom (`Agent type 'team-code-reviewer' not found`) and the two correct responses (session restart / inline fallback). `WORKFLOW.md:88` carries the one-line operational note ("Claude Code's agent registry is session-scoped — `team-*.md` files created mid-session are not discoverable as `subagent_type=team-<role>` until the session restarts"). |
| B5 (no signal validator) | **resolved** | `SKILL.md:145-153` and `.claude/orchestrator.md:97-103` both carry the regex allowlist (`^FANOUT_REQUESTED: (review\|security:[a-z0-9,\-]+\|plan:[a-z0-9,\-]+\|test:[a-z0-9,\-]+\|implement:[a-z0-9,\-]+)$`) and the BLOCKER rule for any return whose first line matches case-insensitive `FANOUT_REQ` but fails the strict regex. **Non-blocking observation for retro**: the regex is duplicated in SKILL.md and orchestrator.md — a single source-of-truth (one canonical, one cross-reference) would be cleaner. Not a cycle-2 blocker; recorded for retro. |
| B6 (provenance line not mandatory) | **resolved** | `.workflow/_templates/review.md:28` adds the **Mandatory provenance line** subsection: "The first line of every `### team-<role>` subsection MUST be `**Dispatched-as**: <subagent_type> (<reason-if-fallback>)`." Each of the 6 `### team-<role>` headers (`:30, :34, :38, :42, :46, :50`) carries a `**Dispatched-as**:` line in the template. Orchestrator's responsibility (capture each `Agent` call's actual `subagent_type` and pass into the synthesis prompt as a `Dispatched-as:` map) is documented at `.claude/orchestrator.md:143` and `SKILL.md:115`. |
| B7 (spec AC2 contradiction) | **resolved** | `spec.md:48` AC2 now reads `All 6 pr-review-toolkit team agents exist under .claude/agents/` (no more "7 ... 6" contradiction). AC2 evidence body matches the headline. The "7 team agents" mention at `spec.md:21` is in the descriptive Scope section, written before Open question E resolved — not a contradiction with the AC. |
| B8 (stale WORKFLOW.md line cites) | **resolved** | `grep -rn "WORKFLOW.md:[0-9]" .claude .workflow` on the affected files returns only (a) cite-of-fact occurrences inside this `review.md`'s cycle-1 body (correct — they are reporting on past file state), and (b) `smoke-review.md` (the pre-cycle-1 engineer-simulated artifact, intentionally untouched per cycle-2 scope). Plan.md (`:38`, `:53`, `:57`, `:59`, `:118`, `:119`, `:124`, `:125`, `:143`, `:150`, `:161`) now uses section-anchor refs throughout (`WORKFLOW.md > Type-aware phase matrix`, `WORKFLOW.md > Sub-agent constraints`, `WORKFLOW.md > Anti-bias rule`, `WORKFLOW.md > Agent map`, `WORKFLOW.md > Scope: when to split (rare path)`). `lead.md:77, :110, :119` use section anchors only. `SKILL.md`, `orchestrator.md`, `qa.md`, `engineer.md` carry no numeric WORKFLOW.md cites. |

**Grid totals**: 8/8 resolved. 0 partially-resolved. 0 not-resolved.

### Acceptance-criteria re-tick (10/10)

| AC | Status | Evidence (post-fix) |
|----|--------|---------------------|
| AC1 | [x] | `SKILL.md:67-169` carries the 4 mechanics sections + anti-patterns; 3 failure modes named at `:159-161`. |
| AC2 | [x] | `spec.md:48` now reads `All 6` (no contradiction); 6 fork files exist; `name:` YAML matches filename slug for all 6 (grep verified in cycle 1). |
| AC3 | [x] | `lead.md:77` wires `FANOUT_REQUESTED: review`; `_templates/review.md:23-52` carries the 6 `### team-<role>` subsections with mandatory `Dispatched-as:` lines. THIS `review.md` is the first real artifact-of-record with all 6 per-agent subsections populated. |
| AC4 | [x] | `lead.md:110` (Mode C step 1a) carries `FANOUT_REQUESTED: security:<bucket-list>` with the ≥ 2-buckets heuristic. Orchestrator-side dispatch at `.claude/orchestrator.md:73, :110`. |
| AC5 | [x] | `lead.md:52` (Mode A step 9) carries `FANOUT_REQUESTED: plan:<point-list>`. Orchestrator-side dispatch at `.claude/orchestrator.md:46, :111`. |
| AC6 | [x] | `qa.md:32` (step 1a) carries `FANOUT_REQUESTED: test:<category-list>` with the ≥ 2 categories + ≥ 3 tests heuristic. Orchestrator-side dispatch at `.claude/orchestrator.md:78, :112`. |
| AC7 | [x] | `engineer.md:27` carries `FANOUT_REQUESTED: implement:<phase-list>` with the L-tier + Phases + disjoint-Files-touched heuristic. Orchestrator-side dispatch (with the experimental caveat) at `.claude/orchestrator.md:64, :113`. |
| AC8 | [x] | `_templates/review.md:24` `(present only when fanout ran; omit for single-reviewer runs)` parenthetical present; single-reviewer sections (`Plan adherence`, `Acceptance-criteria check`, `Findings > Blocking/Non-blocking`) retained at `:9-21, :54-60`. |
| AC9 | [x] | `WORKFLOW.md:88` (Fanout availability paragraph naming the skill + 6 team agents + TEAM.md + the session-restart operational note); `WORKFLOW.md:148` (team-* agent-map row); `.claude/agents/TEAM.md:1-33` (manifest with `Fork date: 2026-05-21`). |
| AC10 | [x] | Flipped from `[~]` to `[x]` at `spec.md:56`. Evidence now points at `.workflow/0002-feat-fanout-team-research/review.md` (this file), not `smoke-review.md`. The evidence text explicitly records the operational caveat (registry session-scoped → inline-fallback this run) and points at the `Dispatched-as:` provenance line as the discriminator between real and fallback dispatch. `grep -c "^### team-" review.md` returns 6 (verified). |

**AC re-tick total**: 10/10.

### Plan-step verify-clause spot-check

Verified 5 of 19 steps per cycle-2 scope:

| Step | Verify clause | Result |
|------|---------------|--------|
| 1 | `test -f .claude/skills/fanout-team-agents/SKILL.md && grep -q "fanout-team-agents" .claude/skills/fanout-team-agents/SKILL.md` | PASS |
| 4 | `head -10 .claude/agents/team-code-reviewer.md \| grep -q "^name: team-code-reviewer"` | PASS |
| 11 | `grep -q "Per-agent findings" .workflow/_templates/review.md && grep -q "Plan adherence" .workflow/_templates/review.md && grep -q "Acceptance-criteria check" .workflow/_templates/review.md && grep -q "Blocking" .workflow/_templates/review.md` | PASS |
| 17 | `test -f .claude/agents/TEAM.md && grep -q "Fork date: 2026-05-21" .claude/agents/TEAM.md && grep -c "^- team-" .claude/agents/TEAM.md returns 7` | PASS (7 bullets — 6 forks + 1 pattern-source row, as documented at `TEAM.md:23`) |
| 19 | `grep -c "^### team-" smoke-review.md returns 6` | PASS via `review.md` (the real-smoke artifact per AC10 evidence in spec); `smoke-review.md` was the pre-cycle-1 simulation, AC10 evidence now points at `review.md`. |

**Spot-check total**: 5/5 PASS. Remaining 14 steps untouched by cycle-2 fix pass; cycle-1 verify-clause checks (review.md:15-33) still hold.

### New blocking findings introduced by the cycle-1 fix pass

None. The 8 files touched are exactly the 8 files the engineer claimed; no scope drift; no new public API; no behaviour change.

### Non-blocking carryovers for retro (from cycle 2)

- **B5 single-source-of-truth**: regex allowlist documented in BOTH `SKILL.md:150` and `orchestrator.md:100`. Pick one canonical home and cite from the other; today both carry the full regex. Low cost to refactor; high cost-of-rot if the regex changes and only one site updates.
- **Plan step 19 verify-clause**: still cites `smoke-review.md` (engineer's pre-cycle-1 artifact). AC10's evidence in spec.md correctly points at `review.md` instead, but the plan step's grep target was not updated. Not a cycle-2 blocker (the AC is the contract; the plan step is the recipe), but worth noting for future plan-vs-spec coherence.

### Verdict

**pass** — all 8 blocking findings (B1–B8) resolved; all 10 acceptance criteria re-tick; 5/5 plan-step verify-clauses spot-checked PASS; no new blocking findings introduced; cycle-2 carryovers are non-blocking and recorded above.

**Cycle**: 2 of max 2. Returns to orchestrator with verdict `pass` — proceeds to Phase 2 step 6 (security review trigger evaluation) or step 7 (test) per the type matrix.
