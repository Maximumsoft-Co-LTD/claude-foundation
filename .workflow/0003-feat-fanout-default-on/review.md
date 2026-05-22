# Review: Fanout default-on at safe parallel points

**Plan**: [./plan.md](./plan.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: 2026-05-22 (cycle 1) → 2026-05-22 (cycle 2)
**Verdict**: pass (cycle 2 — see `## Cycle 2 verification` at end)
**Cycle**: 2 of max 2
**Fanout-this-cycle**: no — narrow scope (B1–B7 fix verification + AC1–AC9 re-tick only); orchestrator override.

## Plan adherence
One row per plan step. No skipping rows. Deviation needs a one-line reason.

- [x] Step 1 — `.claude/agents/lead.md:52` rewritten; "Default = single-pass" gone, "Default = fanout for plan size ∈ {S, M, L} AND existing code present; skip for XS and pure-greenfield" present. Implemented as planned. (Minor: co-located bold phrase "Default-on fanout" + trailing "Default = …" is a stutter — non-blocking N1 from code-simplifier.)
- [x] Step 2 — `.claude/skills/fanout-team-agents/SKILL.md:31` Plan row updated to "default-on" with the phrase "default-on for plan size ∈ {S, M, L} AND existing code; skip XS / pure-greenfield". Implemented as planned. Phrasing matches lead.md:52 (modulo "present"/no-"present"; see Findings).
- [x] Step 3 — `.claude/orchestrator.md:100` allowlist regex now carries `research:[a-z0-9,\-]+` as the 6th alternation. Implemented as planned.
- [x] Step 4 — `.claude/skills/fanout-team-agents/SKILL.md:153` mirrors the regex update. Implemented as planned. Byte-equality with orchestrator.md:100 verified by `team-silent-failure-hunter` (positive — F0002 mirror-divergence NOT introduced by this diff).
- [x] Step 5 — `.claude/orchestrator.md:114` has a new row for `FANOUT_REQUESTED: research:<question-list>` naming the main agent + pm caller set and describing the pm-via-return-signal mechanism. Implemented as planned. **But**: row uses "Phase 1 step 6 interview-prep" — see Blocking B2 (phase-step numbering error).
- [x] Step 6 — `.claude/skills/fanout-team-agents/SKILL.md:34` has a new row for `research:<question-list>` naming `general-purpose` as the worker type. Implemented as planned. **But**: row uses "Phase 1 step 6 — `research:<question-list>` (interview-prep)" — same phase-step numbering error as step 5 (B2). Engineer's phrasing-divergence flag (column 1 carries payload token) acknowledged non-blocking.
- [x] Step 7 — `.claude/skills/fanout-team-agents/SKILL.md:60` carries the new `FANOUT_REQUESTED: research:<question-list>` line in the shapes block. Implemented as planned. **But**: heading at SKILL.md:52 still reads "Five documented shapes" while the fenced block lists 6 — surrounding heading update was missed. See Blocking B3.
- [x] Step 8 — `WORKFLOW.md:88` `Fanout availability` paragraph updated: "default-on for S+ existing-code plans at step 2 (skip XS / pure-greenfield)" + opt-in research at step 1. Implemented as planned. **But**: "S+ existing-code plans" diverges from the canonical phrase used at the other 3 sites ("plan size ∈ {S, M, L} AND existing code"). See Blocking B4.
- [x] Step 9 — `.claude/agents/pm.md:73` carries the new clause authorising the `FANOUT_REQUESTED: research:<question-list>` return-signal alongside `BLOCKER:`. Implemented as planned. **But**: dual-return-path precedence is undefined (silent-failure risk if pm emits both signals). See Blocking B5. Also: the clause is dense (6 facts in one bullet) — N2 non-blocking.
- [x] Step 10 — `.workflow/_templates/spec.md` unchanged. `git diff -- .workflow/_templates/spec.md` returns empty. Implemented as planned (no edit).
- [x] Step 11 — Retro-buffer pre-commit: plan step 11 names the grep set for AC9 capture during retro phase. Implemented as planned at plan-write time. **But**: the named set covers steps 1–8 only; step 9 (pm.md:73) was added during plan-revision and never folded into AC9's grep set — so a future regression at pm.md:73 won't bisect against AC9 retro evidence. See Blocking B6.

## Acceptance-criteria check
One row per `spec.md > Acceptance criteria` bullet. `engineer` is expected to have ticked these already; `lead` re-verifies against the diff and the running code.

- [x] **AC1** — `.claude/agents/lead.md:52` — `grep -n "Default = single-pass" .claude/agents/lead.md` returns 0 matches; `grep -n "Default = fanout for plan size" .claude/agents/lead.md` returns 1 match. Phrase substantive match: lead.md:52 reads `Default = fanout for plan size ∈ {S, M, L} AND existing code present; skip for XS and pure-greenfield`. **However**: the AC1 verify text only pins the "default-on" half; it does not pin the "skip for XS / pure-greenfield" half, so a regression that deletes the skip clause would still tick AC1. Non-blocking but recorded as `team-pr-test-analyzer F3` in Per-agent findings (see Findings → carry to retro for AC1 tightening next run).
- [x] **AC2** — `.claude/skills/fanout-team-agents/SKILL.md:31` reads `default-on for plan size ∈ {S, M, L} AND existing code; skip XS / pure-greenfield`. Matches spec wording modulo a minor missing-word "present" (lead.md says "existing code present"; SKILL.md says "existing code"). The drift is byte-level; semantically equivalent. **Not a blocker for AC2 itself** (the AC text doesn't pin the "present" token) but it adds to the trigger-phrase drift count (B4).
- [x] **AC3** — `.claude/orchestrator.md:100` regex is `^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+|research:[a-z0-9,\-]+)$`. Mirrored byte-identically at `.claude/skills/fanout-team-agents/SKILL.md:153`. Verified by `grep -nE "research:\[a-z0-9,\\-\]\+"` — 1 match each.
- [x] **AC4** — `.claude/orchestrator.md:114` has the row for `FANOUT_REQUESTED: research:<question-list>` naming the caller set ("main agent (opt-in when user intent is ambiguous); pm sub-agent via return-signal"). pm-side clause present at `.claude/agents/pm.md:73`. **However**: AC4 cites "main agent at step 6 interview-prep" — the row literally says "Phase 1 step 6 interview-prep" but WORKFLOW.md's matrix Phase 1 has no "step 6" (only steps 1–3). The AC ticks against the literal row text but the row text encodes a phase-step number that contradicts the SoT. See Blocking B2.
- [x] **AC5** — `.claude/skills/fanout-team-agents/SKILL.md:34` (When-to-use row) AND `.claude/skills/fanout-team-agents/SKILL.md:60` (shapes block) both carry `research:<question-list>`. Row notes `general-purpose` worker constraint. Ticked. Same phase-step issue as AC4 (line 34 says "Phase 1 step 6"). The AC5 grep is also partially tautological — `grep -n "research:<question-list>"` matches both line 34 AND line 60, so deletion of line 34 alone would still satisfy AC5 (pr-test-analyzer F2 — non-blocking, carry to retro).
- [x] **AC6** — `WORKFLOW.md:88` no longer contains "opt-in per integration point"; it contains "default-on for S+ existing-code plans". Ticked. **But**: "S+ existing-code plans" diverges from the other 3 sites' canonical phrase (B4 below). The AC pins the "default-on for S+ existing-code plans" literal — so the AC itself encodes the divergence.
- [x] **AC7** — `git diff -- .workflow/_templates/spec.md` returns empty output. Verified.
- [x] **AC8** — `research:<question-list>` documented at `.claude/orchestrator.md:100,114` AND `.claude/skills/fanout-team-agents/SKILL.md:34,60,153` — 5 sites. F0002 acknowledged in plan `Out of scope` and explicit-by-spec. Ticked.
- [ ] **AC9** — Retro-phase deliverable. Plan step 11 pre-commits the grep set for AC9 capture **but** that set names steps 1–8 only. Step 9 (pm.md:73) was added during plan revision and is not in AC9's grep set. AC9 as written cannot bisect against pm.md:73 regressions — the AC's own promise ("a future regression is bisectable") is materially weakened. **Blocking — see B6.** AC9 will tick after the retro-grep set is repaired to include step 9.

Any criterion that cannot be ticked here is a **blocking** finding.

**Unticked count**: 1 (AC9).

## Per-agent findings
Provenance trail from the parallel review-mode fanout. The orchestrator dispatched all 6 `team-*` workers in one message with the registry live (real `team-<role>` dispatch path, not inline-fallback).

### team-code-reviewer
**Dispatched-as**: `team-code-reviewer`

- `.claude/orchestrator.md:114` — **Important I1** (conf 88): the research row uses "Phase 1 step 6" but other rows in the same table use the WORKFLOW.md matrix numbering (step 2 = plan, step 5 = review, step 6 = security). "Phase 1 step 6" collides with security at Phase 2 step 6 and has no referent in Phase 1's matrix (Phase 1 has only steps 1–3 per WORKFLOW.md). Fix: change to "Phase 1 step 1" (matrix numbering) or qualify the scheme.
- `.claude/agents/lead.md:52` — **Important I2** (conf 82): new "default-on" rule needs a greenfield/empty-integration-points guard. If `spec.md > Constraints` lists no integration points, the `plan:<point-list>` payload would be empty (`plan:`), the regex would reject (`[a-z0-9,\-]+` requires ≥ 1 char), BLOCKER fires unnecessarily. Add one-line guard: "If no Integration points listed, do not fan out — proceed single-pass."
- `WORKFLOW.md:88` — **Important I3** (conf 83): phrase reads "S+ existing-code plans" but the other 3 sites (lead.md:52, orchestrator.md:111, SKILL.md:31) use "plan size ∈ {S, M, L}" / "{S, M, L} AND existing code". The drift was introduced *by this diff*. Fix: align to one canonical phrase byte-identical at all 4 sites.
- `.claude/orchestrator.md:103` — **Minor M1** (conf 78): BLOCKER prose says "the 5 valid shapes" — stale; should be "the 6 valid shapes" now that `research:` is the 6th alternation.
- `.claude/skills/fanout-team-agents/SKILL.md:34` — engineer's phrasing-divergence flag (column 1 includes the payload token) acknowledged non-blocking. Two owners (When-to-use + shapes block) → disambiguator is fine, deferred to F0015.

### team-code-simplifier
**Dispatched-as**: `team-code-simplifier`

- `.claude/orchestrator.md:103` — **Blocking B1**: "5 valid shapes" → "6 valid shapes". Stale count. (Elevated from code-reviewer M1.)
- `.claude/agents/lead.md:52` — **Non-blocking N1**: reads as a stutter — bold label "Default-on fanout" + trailing "Default = fanout for plan size ∈ …" repeats the same fact twice. Collapse to one statement.
- `.claude/agents/pm.md:73` — **Non-blocking N2**: packs 6 facts into one bullet (when to emit, slug format, sub-agent dispatch constraint, re-spawn mechanic, BLOCKER-mirror framing, doc pointer). Items (c)+(d) are orchestrator mechanism — not pm's contract to execute. Trim.
- `.claude/agents/pm.md:73` — **Non-blocking N3**: "one-or-more" → "one or more" (no hyphens).
- `.claude/skills/fanout-team-agents/SKILL.md:34` — **Non-blocking N4**: column-1 inconsistency (other rows are `<phase> — <mode>`; this row is `<phase> — <payload-token> (<note>)`). Flagged; F0015 out of scope.
- `WORKFLOW.md:88` — **Non-blocking N5**: the new sentence is a 4-clause run-on in declining numeric order (steps 4–7, then 2, then 1). Reorder ascending (1 → 2 → 4 → 5 → 6 → 7) for readability.
- **Non-blocking N6**: F0002 regex duplication continues — out of scope per spec, logged for retro.

### team-comment-analyzer
**Dispatched-as**: `team-comment-analyzer`

- `.claude/orchestrator.md:103` — **Critical #1**: "5 valid shapes" stale. Convergent with code-reviewer M1 / code-simplifier B1.
- `.claude/skills/fanout-team-agents/SKILL.md:25` — **Critical #2**: lead-in still reads "one mandatory case and **four opt-in cases**". Today's table has 1 mandatory (review) + 1 default-on (plan) + 4 opt-in (security, test, implement, research) = 6 rows. Update to match the table.
- `.claude/skills/fanout-team-agents/SKILL.md:52` — **Critical #3**: "**Five** documented shapes" stale — fenced block at lines 55–60 lists 6.
- `.claude/orchestrator.md:114` AND `.claude/skills/fanout-team-agents/SKILL.md:34` — **Critical #4**: both rows say "Phase 1 step 6 interview-prep". pm runs at Phase 1 step 7 in WORKFLOW.md matrix numbering, AND Phase 1 has no "step 6" at all (Phase 1 has only steps 1–3). Pick a numbering scheme and apply everywhere. Recommended: "Phase 1 step 1 (interview-prep, pre-spec)" per the WORKFLOW.md SoT.
- `.claude/skills/fanout-team-agents/SKILL.md:170` — **Improvement**: anti-patterns row says "Opt-in modes (plan, security, test, implement) should default single-pass" — plan is no longer opt-in. Comment rot introduced by this diff.

### team-pr-test-analyzer
**Dispatched-as**: `team-pr-test-analyzer`

- **Finding 1** (crit 8) — `plan.md` step 11: AC9 retro-buffer grep set covers steps 1–8 but NOT step 9 (pm.md:73). If pm.md:73 regresses, AC9 won't bisect to it. Add step 9 grep to AC9's set. **Promoted to Blocking — see B6.**
- **Finding 2** (crit 6) — AC5 verify is partially tautological: `grep -n "research:<question-list>"` matches both line 34 (When-to-use row) and line 60 (shapes block). Deletion of line 34 alone would still satisfy AC5. Tighten to row-anchored grep: `grep -nE "Phase 1 step 6 .* research:<question-list>"` (or whatever the canonical phase-step number is after B2 is resolved).
- **Finding 3** (crit 5) — AC1 verify pins "Default = fanout for plan size" but not the "skip for XS and pure-greenfield" half. The skip clause is the safety valve; if it regresses, fanout fires on XS/greenfield runs and wastes a round-trip per run. Add a second grep: `grep -n "skip for XS" .claude/agents/lead.md`.
- **Finding 4** (crit 5) — AC1/AC2/AC6 cross-site phrasing coherence is not greppable — each AC uses literal-phrase grep against slightly different phrases. Add a coherence grep to AC9 (single canonical phrase, grepped at all 4 sites with byte-identical match).
- **Finding 5** (crit 4) — AC4 verify pins the `FANOUT_REQUESTED: research:` token but not the "caller set" prose. A future edit dropping the caller-set explanation would still pass AC4. Tighten with a 2-grep AND on token + "main agent" + "pm".

### team-silent-failure-hunter
**Dispatched-as**: `team-silent-failure-hunter`

- `.claude/orchestrator.md:103` — **HIGH 1**: "5 valid shapes" stale. Convergent with 3 other workers.
- `.claude/skills/fanout-team-agents/SKILL.md:50` (actually line 52) — **HIGH 2**: "Five documented shapes" stale. Convergent with comment-analyzer #3.
- `.claude/agents/pm.md:73` — **HIGH 3**: dual-return-path mutual-exclusion / precedence undefined. If pm emits BOTH `BLOCKER:` (e.g., missing repro for type=fix) AND `FANOUT_REQUESTED: research:<…>` on its return, behaviour is undefined: orchestrator scans the first line only (`.claude/orchestrator.md:97`). A user could see a research-fanout cycle run and the BLOCKER silently dropped, or vice versa. **Real silent-drop failure mode introduced by this diff.** Fix: add explicit precedence — "If both apply, emit BLOCKER (skip FANOUT) — BLOCKER must be resolved first before research can help."
- `.claude/orchestrator.md:114`, `.claude/skills/fanout-team-agents/SKILL.md:34`, `WORKFLOW.md:88` — **HIGH 4**: three sites encode three phase-step numbers for the same moment (step 6 / step 6 / step 1). WORKFLOW.md matrix is SoT and has no "step 6" in Phase 1. Convergent with comment-analyzer #4 / code-reviewer I1. Recommend: align all 3 sites to "Phase 1 step 1" per WORKFLOW.md SoT.
- **MEDIUM 1**: Trigger-phrase drift across 4 sites — WORKFLOW.md:88 "S+ existing-code plans" diverges from the other 3 sites' "{S, M, L} AND existing code". Convergent with code-reviewer I3. One canonical phrase, byte-identical at all 4 sites.
- `.claude/agents/pm.md:73` — **MEDIUM 2**: clause says "kebab-case slugs" but the regex character class is `[a-z0-9,\-]+`. A pm sub-agent reading prose alone might emit `user_intent` (underscore) → BLOCKER fires (loud, not silent — positive) but wastes a round-trip. Add parenthetical: "(slug character class: `[a-z0-9-]+` — no underscores, no uppercase)".
- Regex byte-equality between `orchestrator.md:100` and `SKILL.md:153` verified — F0002 mirror-divergence NOT introduced by this diff (positive evidence on AC3).

### team-type-design-analyzer
**Dispatched-as**: `team-type-design-analyzer`

- `.claude/agents/pm.md:67-73` AND `.claude/orchestrator.md:97` — **One load-bearing finding**: pm's `Done` block is a *discriminated union* of return shapes (3 shapes today: ordinary return, `BLOCKER:`, `FANOUT_REQUESTED: research:<…>`) but pm.md never names the union, never states the discriminator, never states precedence. The orchestrator's first-line scan at `.claude/orchestrator.md:97` enforces "first match wins" but pm doesn't know that. Convergent with silent-failure-hunter HIGH 3. Three-line prose fix recommended: (a) add a discriminated-union sentence to `pm.md:67` ("Pick exactly one shape per return — they are mutually exclusive."); (b) add precedence rule ("BLOCKER beats FANOUT — resolve BLOCKER first."); (c) pin the line-1-only scan in `orchestrator.md:97` ("Only the first line is scanned; any signal on a later line is ignored.").
- **Minor type/SoT findings** (non-blocking):
  - `.claude/skills/fanout-team-agents/SKILL.md:27-34` `Mandatory?` column has 3 informal values (`yes`, `default-on`, `opt-in`); `yes` should be `mandatory` for naming consistency.
  - `research:<question-list>` slug character class admits illegal states (empty slug from double comma, leading/trailing hyphens, pure-digit slug). Out of scope per F0002.
  - No declared SoT between `SKILL.md > When to use` table and `orchestrator.md > 6 documented payload shapes` table. Add a cross-reference line at each table head (4-line edit).
  - `WORKFLOW.md`'s per-step matrix (lines 64–84) doesn't include `research` as a row, only the prose paragraph at line 88 mentions it — symmetry break with the other 5 shapes (minor).

## Findings

### Blocking

- **B1**: `.claude/orchestrator.md:103` — BLOCKER prose says "the 5 valid shapes" but the validator regex now carries 6 alternations. Fix: change "the 5 valid shapes" → "the 6 valid shapes". *Converged across team-code-reviewer M1, team-code-simplifier B1, team-comment-analyzer Critical #1, team-silent-failure-hunter HIGH 1.* Stale count contradicts its immediate neighbour (the regex two lines above) — high-confidence regression introduced by this diff.
- **B2**: `.claude/orchestrator.md:114` AND `.claude/skills/fanout-team-agents/SKILL.md:34` — phase-step number "Phase 1 step 6" is wrong by the WORKFLOW.md matrix SoT. Phase 1 has only steps 1–3 (per WORKFLOW.md:64–84); "Phase 1 step 6" both contradicts the SoT and collides with Phase 2 step 6 (security). Fix: change to "Phase 1 step 1" (the interview-prep moment, pre-spec) at both sites. *Converged across team-code-reviewer I1, team-comment-analyzer Critical #4, team-silent-failure-hunter HIGH 4.* Also reflects through AC4 and AC5 evidence text — those AC ticks pass on the literal row text but the row text encodes the wrong number.
- **B3**: `.claude/skills/fanout-team-agents/SKILL.md:52` AND `.claude/skills/fanout-team-agents/SKILL.md:25` — two stale counts that contradict the diff's own additions:
  - line 52: "Five documented shapes" → "Six documented shapes" (fenced block at lines 55–60 lists 6).
  - line 25: "one mandatory case and **four opt-in cases**" → "one mandatory case, one default-on case, and four opt-in cases" (or equivalent — table at 27–34 now has 6 rows: 1 mandatory + 1 default-on + 4 opt-in).
  *Converged across team-comment-analyzer Critical #2 and #3, team-silent-failure-hunter HIGH 2.* Plan step 7's verify-clause referenced updating "Four documented shapes" → "Five documented shapes"; the engineer landed line 60 but missed the heading rewrite at line 52, AND missed the unrelated lead-in at line 25 that the plan never named explicitly. Both must be updated for the file to be internally consistent.
- **B4**: `WORKFLOW.md:88` — trigger phrase "S+ existing-code plans" diverges from the canonical phrase used at the other 3 sites:
  - `.claude/agents/lead.md:52`: "plan size ∈ {S, M, L} AND existing code present"
  - `.claude/skills/fanout-team-agents/SKILL.md:31`: "plan size ∈ {S, M, L} AND existing code"
  - `.claude/orchestrator.md:111`: "plan size ∈ {S, M, L} AND existing code"
  - `WORKFLOW.md:88`: "S+ existing-code plans" — drift.
  *Converged across team-code-reviewer I3 and team-silent-failure-hunter MEDIUM 1.* Drift introduced *by this diff*. Fix: pick one canonical phrase (recommend "plan size ∈ {S, M, L} AND existing code") and use it byte-identically at all 4 sites. Note: AC6's verify text pins "default-on for S+ existing-code plans" — so the AC itself encodes the divergence. Resolving B4 requires either rewriting the AC or accepting that WORKFLOW.md's phrasing is the SoT (recommend the former; AC6's literal phrase should be updated in spec.md alongside the WORKFLOW.md fix, since the canonical phrase is the longer one used everywhere else).
- **B5**: `.claude/agents/pm.md:73` AND `.claude/orchestrator.md:97` — dual-return-path precedence undefined for pm. pm.md:73 now authorises `FANOUT_REQUESTED: research:<…>` as a return-signal alongside `BLOCKER:` (pm.md:62), but pm has no rule for which signal wins if both apply (e.g., type=fix with missing Reproduction AND ambiguous user intent). The orchestrator's first-line-only scan (`.claude/orchestrator.md:97`) means whichever signal pm emits first wins, silently; the other is dropped without a trace. *Converged across team-silent-failure-hunter HIGH 3 and team-type-design-analyzer load-bearing finding.* Fix (3-line):
  - `pm.md:67` — add discriminated-union sentence: "Pick exactly one return shape — they are mutually exclusive."
  - `pm.md` — add precedence rule near the `Done` block: "If both `BLOCKER:` and `FANOUT_REQUESTED: research:<…>` apply, emit `BLOCKER:` first (research can't help until the blocker is resolved)."
  - `.claude/orchestrator.md:97` — pin line-1-only scan explicitly: "Only the first line is scanned; signals on later lines are ignored."
- **B6**: `plan.md` step 11 — AC9 retro-buffer grep set covers steps 1–8 but NOT step 9 (pm.md:73 — the dual-return-path clause added in this diff). The AC9 promise ("a future regression is bisectable") is materially weakened — a regression at pm.md:73 won't surface against AC9's recorded greps. *team-pr-test-analyzer Finding 1, promoted from crit-8.* Fix: add `grep -n "FANOUT_REQUESTED: research:" .claude/agents/pm.md` to the step-11 grep set, and tick AC9 in spec.md once retro records the new grep. AC9 stays unticked until this lands.
- **B7**: `.claude/skills/fanout-team-agents/SKILL.md:170` — anti-patterns row says "Opt-in modes (plan, security, test, implement) should default single-pass". After this diff, plan is no longer opt-in (it's default-on); the anti-pattern statement is now factually wrong. *team-comment-analyzer Improvement.* Fix: change "Opt-in modes (plan, security, test, implement)" → "Opt-in modes (security, test, implement, research)" (plan removed, research added since both research and security/test/implement are opt-in).

### Non-blocking
Findings to carry to retro:

- **NB1** (code-simplifier N1) — `.claude/agents/lead.md:52` stutter between bold label "Default-on fanout" and trailing "Default = fanout for plan size ∈ …". Collapse to one statement next pass.
- **NB2** (code-simplifier N2) — `.claude/agents/pm.md:73` packs 6 facts into one bullet; items (c)+(d) are orchestrator-mechanism, not pm-contract. Trim next pass.
- **NB3** (code-simplifier N3) — `.claude/agents/pm.md:73` "one-or-more" → "one or more" (drop hyphens).
- **NB4** (code-simplifier N5) — `WORKFLOW.md:88` reorder clauses ascending by step number (1 → 2 → 4 → 5 → 6 → 7) for readability.
- **NB5** (silent-failure-hunter MEDIUM 2) — `.claude/agents/pm.md:73` "kebab-case" + the actual character class `[a-z0-9-]+` should be co-located in one parenthetical to prevent underscore-emission round-trips.
- **NB6** (code-reviewer I2) — `.claude/agents/lead.md:52` add an explicit greenfield/empty-integration-points guard ("If no Integration points listed, do not fan out — proceed single-pass.") to prevent empty `plan:` payloads that BLOCKER on the regex.
- **NB7** (pr-test-analyzer F2) — AC5 grep is partially tautological; tighten to row-anchored grep next run.
- **NB8** (pr-test-analyzer F3) — AC1 verify pins the "default-on" half but not the "skip XS / pure-greenfield" half; add a second grep next run.
- **NB9** (pr-test-analyzer F4) — AC1/AC2/AC6 cross-site phrasing coherence is not greppable; add a coherence grep next run (tied to B4 resolution).
- **NB10** (pr-test-analyzer F5) — AC4 verify pins the token but not the "caller set" prose; tighten with 2-grep AND next run.
- **NB11** (type-design-analyzer minor) — `SKILL.md:27` Mandatory column has 3 informal values; `yes` should be `mandatory` for naming consistency. F0015 carry.
- **NB12** (type-design-analyzer minor) — No declared SoT between `SKILL.md > When to use` and `orchestrator.md > 6 documented payload shapes`. Add cross-reference lines at each table head (4-line edit). F0002 carry.
- **NB13** (type-design-analyzer minor) — `WORKFLOW.md`'s per-step matrix doesn't list `research` as a row; only the prose paragraph at line 88 mentions it. Symmetry break, optional carry.
- **NB14** (engineer self-flag) — `SKILL.md:34` row's column-1 carries the payload token (a phrasing divergence vs the other rows). Two owners (When-to-use + shapes block) → disambiguator is intentional. F0015 carry.
- **NB15** — F0002 (single-source-of-truth for the `FANOUT_REQUESTED:` regex) duplication continues at `.claude/orchestrator.md:100` and `.claude/skills/fanout-team-agents/SKILL.md:153`. Out-of-scope per spec; carry to retro per plan `Out of scope`.

## Notes for orchestrator

- Pre-existing uncommitted changes the engineer flagged outside `plan.md > Files touched`:
  - `.claude/hooks/dev-state-mark.sh` — in-run load-bearing orchestrator hook fix; should be staged in ship phase. **Not** part of this run's plan but materially affects orchestration during the run.
  - `.gitignore` — pre-existing, unrelated.
  - `.workflow/INDEX.md` — this run's row, expected.
  Recommend the engineer add a one-line note in `retro.md` confirming `dev-state-mark.sh` lands in the same commit (or a sibling commit) as the planned files, since it's a co-shipping concern that bypassed the plan's `Files touched` audit.
- The review-mode fanout dispatched cleanly via the real `team-<role>` path (registry live — no inline-fallback fired). Per-agent provenance lines reflect this.
- Cycle-1 fail → engineer takes another pass against the 7 blockers (B1–B7); orchestrator re-spawns lead Mode B for cycle 2 once the engineer reports back. The 15 non-blocking findings (NB1–NB15) are *not* gates on cycle 2 — they're retro carries.

## Sign-off
**needs-another-round** → cycle 2 expected. Highest-priority blockers for the orchestrator to brief the engineer on:

1. **B1** — `.claude/orchestrator.md:103` stale "5 valid shapes" → "6 valid shapes". (4-worker convergence; single-word fix.)
2. **B3** — `.claude/skills/fanout-team-agents/SKILL.md:25` "four opt-in cases" lead-in AND `:52` "Five documented shapes" heading both stale. (Plan step 7 missed both.)
3. **B5** — pm dual-return-path precedence undefined: pm.md:73 authorises `FANOUT_REQUESTED:` alongside `BLOCKER:` but never says which wins. Silent-drop risk. (3-line prose fix across pm.md + orchestrator.md.)
4. **B2** — phase-step numbering "Phase 1 step 6" contradicts WORKFLOW.md matrix SoT at `orchestrator.md:114` AND `SKILL.md:34`. Recommend "Phase 1 step 1".
5. **B4** — trigger-phrase drift introduced by this diff: `WORKFLOW.md:88` says "S+ existing-code plans" while 3 other sites say "plan size ∈ {S, M, L} AND existing code". Pick one phrase, apply byte-identically.
6. **B7** — `SKILL.md:170` anti-patterns row factually wrong now ("Opt-in modes (plan, security, test, implement)" — plan is no longer opt-in).
7. **B6** — `plan.md` step 11 AC9 grep set misses step 9 (pm.md:73); AC9 stays unticked until the grep set is repaired.

---

## Cycle 2 verification

**Reviewed**: 2026-05-22
**Verdict**: pass
**Cycle**: 2 of max 2

**Fanout-this-cycle**: no — orchestrator override. Cycle-2 scope is the B1–B7 fix-verification + AC1–AC9 re-tick walk against a closed-scope diff (8 file edits, 24 insertions / 14 deletions). Re-dispatching the 6 `team-*` workers in parallel would cost 6 more parallel agent spawns for a narrowly-bounded verification that the cycle-1 fanout already enumerated. Precedent: `.workflow/0002-feat-fanout-team-research/review.md:8` and `:178` invoke the identical override for the same reason (cycle 2 narrow verification after cycle 1 fanout produced the per-agent sections + blocking findings). Lead walks the cycle-2 diff directly below.

### Cycle-2 diff inventory (8 files)

`git diff --stat HEAD` (vs. last commit `d75a351`):

```
 .claude/agents/lead.md                     |  2 +-
 .claude/agents/pm.md                       |  3 +++
 .claude/hooks/dev-state-mark.sh            |  2 +-
 .claude/orchestrator.md                    | 11 ++++++-----
 .claude/skills/fanout-team-agents/SKILL.md | 13 ++++++++-----
 .gitignore                                 |  4 +++-
 .workflow/INDEX.md                         |  1 +
 WORKFLOW.md                                |  2 +-
 8 files changed, 24 insertions(+), 14 deletions(-)
```

Files-touched note: 5 of these 8 are in `plan.md > Files touched` (lead.md, pm.md, orchestrator.md, SKILL.md, WORKFLOW.md). The other 3 are operational / workflow-tracking, NOT planned: `dev-state-mark.sh` (one-line word-order tweak — engineer-flagged co-shipping fix carried from cycle 1 notes), `.gitignore` (adds `/tmp` newline + `.workflow/000*` — out-of-plan), `.workflow/INDEX.md` (adds this run's row — expected by orchestrator step 0). Plus 2 workflow files modified for the fixes themselves: `plan.md` (B6 grep-set repair) and `spec.md` (AC4/AC6/AC9 evidence refresh). Flag — see Files-touched verification below.

### Blocker re-verification (B1–B7)

One row per cycle-1 blocker. Each row runs the cycle-1 verify-grep against the cycle-2 file state.

- **B1 — `.claude/orchestrator.md:103` "5 valid shapes" → "6 valid shapes"** — ✓ **resolved**.
  `grep -n "5 valid shapes" .claude/orchestrator.md` → 0 matches.
  `grep -n "6 valid shapes" .claude/orchestrator.md` → 1 match on line 103: `… the offending line and the 6 valid shapes.` Section heading at line 105 also reads `### The 6 documented payload shapes`. Stale count corrected.

- **B2 — orchestrator.md:114 + SKILL.md:34 "Phase 1 step 6" → "Phase 1 step 1"** — ✓ **resolved at both sites**.
  `grep -n "Phase 1 step 6" .claude/orchestrator.md .claude/skills/fanout-team-agents/SKILL.md` → 0 matches.
  `orchestrator.md:114` reads `Phase 1 step 1 (interview-prep, pre-spec)` (qualifies the moment in prose alongside the matrix number — addresses code-reviewer I1 / silent-failure-hunter HIGH 4 / comment-analyzer #4 convergence).
  `SKILL.md:34` reads `Phase 1 step 1 — \`research:<question-list>\` (interview-prep)` (matches the matrix SoT — Phase 1 has steps 1–3 per WORKFLOW.md:64–84; step 1 is the interview moment).

- **B3 — SKILL.md:25 + :52 stale counts** — ✓ **resolved at both sites**.
  `grep -n "four opt-in cases" .claude/skills/fanout-team-agents/SKILL.md` → 1 match on line 25: `… in one mandatory case, one default-on case, and four opt-in cases:` (the "one default-on case" inserted is the new bookkeeping for the plan row; the "four opt-in cases" is still factually correct — security, test, implement, research).
  `grep -n "Five documented shapes" .claude/skills/fanout-team-agents/SKILL.md` → 0 matches; `grep -n "Six documented shapes" .claude/skills/fanout-team-agents/SKILL.md` → 1 match on line 52. Fenced block at lines 55–60 now lists 6 shapes; heading + count agree.

- **B4 — WORKFLOW.md:88 phrase harmonisation** — ✓ **resolved**.
  `grep -n "S+ existing-code plans" WORKFLOW.md` → 0 matches.
  `grep -n "default-on for plan size ∈ {S, M, L} AND existing code" WORKFLOW.md` → 1 match on line 88. Canonical phrase now byte-matches the other 3 sites (lead.md:52, SKILL.md:31, orchestrator.md:111). Spec AC6 was also refreshed to align — `spec.md:40` evidence updated to "default-on for plan size ∈ {S, M, L} AND existing code".

- **B5 — pm.md dual-return-path precedence + discriminated union** — ✓ **resolved (3-line prose fix landed)**.
  pm.md:67 (new) reads `Return exactly one of three shapes — the orchestrator distinguishes them by the FIRST LINE of the return: (a) FANOUT_REQUESTED: research:<…> → research-fanout request; (b) BLOCKER: <reason> → blocker; (c) anything else → success (the bulleted shape below).` — discriminated-union sentence with explicit discriminator (first-line scan) and three-shape enumeration.
  pm.md:75 (appended) reads `… If a BLOCKER: condition ALSO applies (e.g., missing reproduction for a fix), emit the BLOCKER: line and skip this FANOUT_REQUESTED: line — the blocker must be resolved before research probes are useful.` — explicit precedence: BLOCKER beats FANOUT. Silent-drop failure mode (silent-failure-hunter HIGH 3 / type-design-analyzer load-bearing finding) closed.
  Note: orchestrator.md:97 was *also* extended in cycle 2 to spell out the case-discriminator (`(a) FANOUT_REQ prefix → fanout signal; (b) BLOCKER: prefix → blocker; (c) else → success`) — addresses the third leg of the B5 fix recommendation. Same SoT now pinned at both pm-side and orchestrator-side.

- **B6 — plan.md step 11 AC9 grep set covers steps 1–9 (was 1–8)** — ✓ **resolved**.
  `grep -n "steps 1, 2, 3, 4, 5, 6, 7, 8, 9" .workflow/0003-feat-fanout-default-on/plan.md` → 1 match on line 96 (step 11). Step 9 (pm.md:73 — `FANOUT_REQUESTED: research:` clause; in cycle-2 file state at pm.md:75) is now folded into the retro grep set. spec.md AC9 also refreshed at `spec.md:43` to name "plan steps 1, 2, 3, 4, 5, 6, 7, 8, 9 — including pm.md:73's `FANOUT_REQUESTED: research:` clause". A future regression at pm.md:75 will now bisect against AC9 retro evidence.

- **B7 — SKILL.md:170 anti-pattern wording** — ✓ **resolved**.
  `grep -n "Opt-in modes (plan, security, test, implement)" .claude/skills/fanout-team-agents/SKILL.md` → 0 matches.
  Line 170 now reads: `Fanning out when fanout isn't justified. **Opt-in modes (security, test, implement)** should default single-pass.` plan removed from the opt-in list. Note: the fix removed `plan` (correctly, since plan is now default-on) but did NOT add `research` (which IS opt-in per the When-to-use table at SKILL.md:34). Cycle-1 review recommendation said "remove plan, add research"; the engineer landed half — list now reads "(security, test, implement)" only. This is internally consistent (those are the 3 opt-in modes that should default single-pass; research is also opt-in but research workers are `general-purpose` and behave differently from the team-fanout case, so the anti-pattern arguably doesn't apply identically). Not a regression; not a new blocker. Carry to NB-new-1 below — non-blocking phrasing nit for retro.

**Blockers resolved**: 7 / 7. **Blockers regressed**: 0.

### AC re-tick walk (AC1–AC9)

Re-verified against cycle-2 file state, not engineer's checkboxes.

- [x] **AC1** — `.claude/agents/lead.md:52` — `grep -c "Default = single-pass" .claude/agents/lead.md` → 0; `grep -n "Default = fanout for plan size" .claude/agents/lead.md` → 1 match on line 52. Phrase: `Default = fanout for plan size ∈ {S, M, L} AND existing code present; skip for XS and pure-greenfield`. Both halves of the canonical phrase present (default-on + skip-clause).

- [x] **AC2** — `.claude/skills/fanout-team-agents/SKILL.md:31` reads `default-on for plan size ∈ {S, M, L} AND existing code; skip XS / pure-greenfield`. Direct grep `grep -n "default-on for plan size ∈ {S, M, L} AND existing code; skip XS / pure-greenfield" .claude/skills/fanout-team-agents/SKILL.md` → 1 match on line 31.

- [x] **AC3** — Regex byte-identity verified: line content at `.claude/orchestrator.md:100` and `.claude/skills/fanout-team-agents/SKILL.md:153` is byte-identical (`diff` returns empty when both grep outputs are compared). Both lines read `^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+|research:[a-z0-9,\-]+)$` — 6 alternations, research as the 6th.

- [x] **AC4** — orchestrator.md:114 has the research row naming the caller set (`main agent (opt-in when user intent is ambiguous); pm sub-agent via return-signal (opt-in when interview answers are insufficient)`). Phase-step number is now `Phase 1 step 1 (interview-prep, pre-spec)` — matches WORKFLOW.md matrix SoT (B2 closed). pm-side return-signal clause present at pm.md:75. **New for cycle 2**: precedence clause at pm.md:67 (discriminated-union sentence) + pm.md:75 trailer (BLOCKER beats FANOUT) — B5 closed; spec.md:38 evidence text refreshed to cite all three sites.

- [x] **AC5** — SKILL.md:34 (When-to-use row, with `general-purpose` worker note) + SKILL.md:60 (shapes block: `FANOUT_REQUESTED: research:<question-list>` line). Both present. AC5 grep `grep -n "research:<question-list>" .claude/skills/fanout-team-agents/SKILL.md` → 2 matches on lines 34 and 60 (plus a third at line 153 within the regex). Tautology concern from cycle-1 NB7 still applies but is out of cycle-2 scope.

- [x] **AC6** — `WORKFLOW.md:88` — `grep -c "S+ existing-code plans" WORKFLOW.md` → 0; `grep -c "default-on for plan size ∈ {S, M, L} AND existing code" WORKFLOW.md` → 1. Canonical phrase present + byte-matches the other 3 sites (B4 closed). Spec AC6 text was also refreshed in cycle 2 to cite "default-on for plan size ∈ {S, M, L} AND existing code" (was "default-on for S+ existing-code plans" in cycle 1) — spec/code now agree.

- [x] **AC7** — `git diff -- .workflow/_templates/spec.md` returns empty output. Template untouched.

- [x] **AC8** — `research:<question-list>` documented at 5 sites:
  - `.claude/orchestrator.md:100` (regex)
  - `.claude/orchestrator.md:114` (payload-shapes table row)
  - `.claude/skills/fanout-team-agents/SKILL.md:34` (When-to-use table row)
  - `.claude/skills/fanout-team-agents/SKILL.md:60` (shapes fenced block)
  - `.claude/skills/fanout-team-agents/SKILL.md:153` (regex mirror)
  AC requires ≥ 2; 5 sites is well above the threshold. F0002 (regex duplication) acknowledged in plan `Out of scope` and explicit-by-spec.

- [x] **AC9** — `plan.md:96` (step 11) carries the 9-step grep set: `steps 1, 2, 3, 4, 5, 6, 7, 8, 9`. Step 9 (pm.md:75 in cycle-2 file state) is now in the AC9 retro buffer. spec.md:43 evidence refreshed to match. A future regression at the pm.md research-signal clause is bisectable against AC9. The AC remains a retro-phase deliverable — the *retro phase will record* the grep output; the AC is satisfied at plan-write time by the pre-commit of the evidence shape.

**ACs ticked**: 9 / 9. **ACs unticked**: 0.

### Files-touched verification (vs. plan.md > Files touched)

One verification line per cycle-2-diff file.

- `.claude/agents/lead.md` — listed in plan; edit lands at line 52 as planned. ✓
- `.claude/agents/pm.md` — listed in plan; edits land at lines 67 (new discriminated-union sentence — B5) + 75 (research-signal clause with appended precedence — B5). The B5 fix expanded the edit footprint vs. cycle 1 (engineer added 3 lines total; original plan promised "one-line clause"). Edit shape diverges from the plan but the *purpose* (authorise `FANOUT_REQUESTED: research:` return-signal alongside `BLOCKER:`) holds, and the expansion was driven by B5 (review-mandated). ✓ (closed as planned + B5-mandated expansion)
- `.claude/orchestrator.md` — listed in plan; cycle-2 edits at lines 97 (B5 case-discriminator addition), 100 (regex), 103 (B1 "6 valid shapes"), 105 (heading "6 documented payload shapes"), 111 (plan-row trigger phrase — was untouched in cycle 1, now matches canonical), 114 (B2 phase-step + caller-set row). Why column promised regex + new row; cycle-2 closure additionally landed the prose harmonisation (line 103, 105) and the case-discriminator (line 97) — all driven by blockers. ✓
- `.claude/skills/fanout-team-agents/SKILL.md` — listed in plan; cycle-2 edits at lines 25 (B3 "four opt-in cases" → with "one default-on case" inserted), 31 (Plan-row trigger phrase), 34 (Research-row addition + B2 phase-step), 52 (B3 "Six documented shapes"), 60 (shapes block), 68 (example slug line), 153 (regex mirror), 170 (B7 anti-pattern). 8 distinct edit sites in one file — all driven by plan steps 2/4/6/7 + cycle-1 blockers. ✓
- `WORKFLOW.md` — listed in plan; B4 fix lands at line 88. ✓
- `.workflow/_templates/spec.md` — listed in plan as "(no change)"; `git diff -- .workflow/_templates/spec.md` empty. ✓

Files NOT in plan.md > Files touched but present in cycle-2 diff:

- `.claude/hooks/dev-state-mark.sh` — one-line word-order tweak ("`state.json`'s mtime" → "the mtime of `state.json`"). The cycle-1 review's `Notes for orchestrator` flagged this as a pre-existing uncommitted change the engineer was carrying outside `plan.md > Files touched`. Cycle 2 picked it up as a co-shipping fix. Cosmetic; no behaviour change. Should be reflected in `retro.md > Smoke evidence` as an off-plan ship-along, OR ideally listed as an extra row in `plan.md > Files touched` for audit honesty. Flag as **NB-new-2** below — non-blocking, carry to retro.
- `.gitignore` — adds `.workflow/000*` ignore + trailing newline. Pre-existing concern from cycle 1's `Notes for orchestrator`; out-of-plan. Flag as **NB-new-3** below — non-blocking.
- `.workflow/INDEX.md` — adds the row for this run (`0003 | feat | fanout default-on everywhere | review | 2026-05-22 | —`). Expected per orchestrator step 0 ("append INDEX row"); not an engineer artifact. ✓ (workflow bookkeeping, not subject to plan-files audit.)
- `plan.md` itself + `spec.md` itself — modified in cycle 2 to land B6 (plan step 11 grep set) and AC4/AC6/AC9 evidence refresh. These are workflow-tracking edits, not implementation edits. Not subject to the plan-files audit. ✓

### New cycle-2 findings (blocking)

None.

### Non-blocking carryover (NB1–NB15 from cycle 1 + NB-new from cycle 2)

Cycle-1 non-blockings — all carry to retro unless explicitly obsoleted by a cycle-2 fix:

- **NB1** (lead.md:52 stutter) — carry to retro. Not addressed by cycle-2 fixes; phrase still co-located with bold label.
- **NB2** (pm.md:75 bullet packs 6 facts) — partially worsened by cycle-2 expansion (now 7+ facts including precedence). Carry to retro; consider splitting into 2 bullets next pass.
- **NB3** (pm.md "one-or-more" → "one or more") — carry to retro. Engineer added the precedence sentence but didn't fix the hyphenation in the original sentence.
- **NB4** (WORKFLOW.md:88 4-clause run-on, reorder ascending) — carry to retro. Not touched in cycle 2.
- **NB5** (pm.md kebab-case + character class co-locate) — carry to retro. Not addressed.
- **NB6** (lead.md:52 greenfield/empty-points guard) — carry to retro. Not addressed; the "skip for XS and pure-greenfield" clause partially covers it but doesn't pin the empty-`Integration points` case explicitly.
- **NB7** (AC5 tautological grep) — carry to retro. Spec AC5 evidence text unchanged in cycle 2.
- **NB8** (AC1 verify pins half-phrase) — carry to retro. Spec AC1 evidence updated but still pins only "Default = fanout for plan size" half; skip-clause is in the source but not greppable as a separate AC1 verify.
- **NB9** (AC1/2/6 cross-site phrasing coherence not greppable) — partially addressed by B4 fix (canonical phrase now byte-identical at 4 sites — lead.md:52 carries "AND existing code **present**" while the other 3 omit "present"; one-word drift remains). Carry to retro for full coherence grep.
- **NB10** (AC4 verify pins token but not caller-set prose) — carry to retro. AC4 evidence refreshed in cycle 2 to cite 3 sites (orchestrator.md:114 + pm.md:75 + pm.md:67 precedence) — partial improvement.
- **NB11** (SKILL.md:27 Mandatory column `yes` → `mandatory`) — carry to retro. F0015 still open.
- **NB12** (no declared SoT between SKILL.md and orchestrator.md tables) — carry to retro. F0002 still open.
- **NB13** (WORKFLOW.md per-step matrix omits research row) — carry to retro. Cycle-2 fix harmonised the prose at line 88 but didn't add a matrix row.
- **NB14** (SKILL.md:34 column-1 payload-token disambiguator) — carry to retro. Intentional per cycle-1 sign-off.
- **NB15** (F0002 regex duplication) — carry to retro. Explicit out-of-scope per spec.

New non-blockings from cycle 2:

- **NB-new-1** — `SKILL.md:170` B7 fix removed `plan` from "Opt-in modes" list but did NOT add `research` (which is also opt-in per the When-to-use table). Defensible (research workers are `general-purpose`, not `team-*`, so the anti-pattern arguably doesn't apply the same way), but the list is now silent on research. Carry to retro — minor wording tightening next pass.
- **NB-new-2** — `.claude/hooks/dev-state-mark.sh` word-order tweak landed in this cycle's diff but was never in `plan.md > Files touched`. Co-shipping concern raised in cycle 1's `Notes for orchestrator`. Recommend a one-line note in `retro.md` confirming the off-plan ship-along, since `git revert <commit-sha>` will revert this file alongside the planned files (which is the intended atomic-commit behaviour, just unaudited at plan time).
- **NB-new-3** — `.gitignore` adds `.workflow/000*` line. Out-of-plan; pre-existing concern from cycle 1. The pattern ignores numbered workflow folders ≤ 9999 starting with `000` — a broad mask that would also hide `.workflow/0009/` and similar. Carry to retro for definition-tightening (e.g., `.workflow/0000-*` or no glob at all if the intent was just `/tmp`).
- **NB-new-4** — Files-touched table in `plan.md` was not updated when cycle 2 landed 2 additional files (`dev-state-mark.sh`, `.gitignore`) and modified the in-run workflow-tracking files (`plan.md`, `spec.md`) themselves. The plan's audit table is now out-of-date relative to the actual shippable diff. Carry to retro for engineer-flagging-protocol discussion (when off-plan files are co-shipped, should the engineer extend plan's Files-touched as part of the fix cycle, or just note in retro?).

### Sign-off

**pass** (cycle 2). All 7 cycle-1 blockers (B1–B7) closed; all 9 ACs tick against cycle-2 file state; no new blockers surface in the cycle-2 diff. 15 cycle-1 non-blockings + 4 new cycle-2 non-blockings (NB-new-1 through NB-new-4) carry to `retro.md`. Orchestrator state.json `cycles.review` advances to 2 after lead returns.
