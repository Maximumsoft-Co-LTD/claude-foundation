# Tests: Fanout default-on at safe parallel points

**Plan**: [./plan.md](./plan.md)
**Status**: skipped
**Cycle**: 0 of max 3

## Type-aware mode
Pick one. The rest of this doc is filled out only for the active mode.

- [ ] **Full** (type = feat / refactor)
- [ ] **Fix** (type = fix — regression test mandatory)
- [x] **Skipped** (type = chore / docs / spike) — write the reason in `Skipped` and leave the rest blank.

## Skipped

- **Reason**: feat, but 100% of the diff is markdown — 5 workflow/agent/skill files (`.claude/agents/lead.md`, `.claude/agents/pm.md`, `.claude/orchestrator.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `WORKFLOW.md`) plus the in-run workflow-tracking files (`plan.md`, `spec.md`, `review.md`) and 2 co-shipping operational files (`.claude/hooks/dev-state-mark.sh` one-line word-order tweak, `.gitignore`). There is no executable production code touched, no schema, no public API, and no test harness exists in this repo (no `package.json`, `pytest.ini`, `go.mod`, no test runner of any kind). Authoring unit/integration/e2e tests would mean standing up a brand-new harness purely to assert that markdown files contain the text they already provably contain. The spec's verification model is **grep-based smoke-evidence**, pinned by AC9 and pre-committed in `plan.md > Steps > step 11` for capture during the retro phase into `retro.md > Smoke evidence`. The 0002-feat-fanout-team-research run took the identical path — see `.workflow/0002-feat-fanout-team-research/tests.md > Skipped > Reason`; this run mirrors that precedent.

- **Risk accepted**: If any of the 9 grep-evidence sites regresses after ship (e.g., a future edit re-introduces "Default = single-pass" at `.claude/agents/lead.md:52`, deletes the `research:[a-z0-9,\-]+` alternation at `.claude/orchestrator.md:100`, or drops the `FANOUT_REQUESTED: research:` authorisation clause at `.claude/agents/pm.md:73`), the regression will only be caught the next time a human runs `/dev` and notices that plan-mode fanout no longer fires by default or that pm's research-signal is silently rejected — not in CI. AC9's retro-phase grep set is the bisect surface; it is **not** a continuous regression test. This is acceptable for a workflow-tooling change in a repo with no CI today; it would not be acceptable once a CI layer exists.

## Acceptance-criteria coverage

Every AC in `spec.md > Acceptance criteria` was verified by either (a) `engineer`'s plan-step verify-clause at landing time, (b) `lead`'s cycle-1 review-mode fanout check (6 `team-*` workers), or (c) `lead`'s cycle-2 re-verification after the B1–B7 fix pass. Status verdicts come from `.workflow/0003-feat-fanout-default-on/review.md` (cycle-1 `## Acceptance-criteria check` + cycle-2 `## Cycle 2 verification > AC re-tick walk`). No runnable test asserts these; the grep evidence does.

| Spec criterion | Test(s) | Verified |
|----------------|---------|----------|
| AC1 — `.claude/agents/lead.md:52` no longer carries "Default = single-pass" or "≥ 2 disjoint integration points"; instead reads "Default = fanout for plan size ∈ {S, M, L} AND existing code present; skip for XS and pure-greenfield" | none (grep-evidence at `plan.md:86` step 1 verify-clause: `grep -n "Default = single-pass" .claude/agents/lead.md` → 0; `grep -n "Default = fanout for plan size" .claude/agents/lead.md` → ≥ 1) — confirmed at `review.md:234` cycle-2 walk | yes |
| AC2 — `.claude/skills/fanout-team-agents/SKILL.md:31` Plan row reflects default-on with the same phrasing | none (grep-evidence at `plan.md:87` step 2 verify-clause; canonical phrase "default-on for plan size ∈ {S, M, L} AND existing code; skip XS / pure-greenfield") — confirmed at `review.md:236` cycle-2 walk | yes |
| AC3 — `.claude/orchestrator.md:100` allowlist regex carries `research:[a-z0-9,\-]+` as the 6th alternation | none (grep-evidence at `plan.md:88` step 3 + `plan.md:89` step 4 verify-clauses; byte-equality verified between `orchestrator.md:100` and `SKILL.md:153` by `team-silent-failure-hunter` in cycle-1) — confirmed at `review.md:238` cycle-2 walk | yes |
| AC4 — `.claude/orchestrator.md:114` payload-shapes table has new row for `research:<question-list>` naming caller set (main agent + pm sub-agent via return-signal); pm-side clause + precedence at `.claude/agents/pm.md:67,73` | none (grep-evidence at `plan.md:90` step 5 + `plan.md:94` step 9 verify-clauses; cycle-2 B2 fix corrected phase-step from "step 6" → "step 1"; cycle-2 B5 fix added discriminated-union + BLOCKER-beats-FANOUT precedence) — confirmed at `review.md:240` cycle-2 walk | yes |
| AC5 — `.claude/skills/fanout-team-agents/SKILL.md:34` When-to-use row + `:60` shapes block both carry `research:<question-list>`; row notes `general-purpose` worker constraint | none (grep-evidence at `plan.md:91` step 6 + `plan.md:92` step 7 verify-clauses) — confirmed at `review.md:242` cycle-2 walk. Tautology concern from cycle-1 NB7 carried to retro. | yes |
| AC6 — `WORKFLOW.md:88` no longer says "opt-in per integration point"; canonical phrase "default-on for plan size ∈ {S, M, L} AND existing code" byte-matches lead.md:52 / SKILL.md:31 / orchestrator.md:111 (B4 closed) | none (grep-evidence at `plan.md:93` step 8 verify-clause; spec.md:40 evidence text refreshed in cycle-2) — confirmed at `review.md:244` cycle-2 walk | yes |
| AC7 — `.workflow/_templates/spec.md` unchanged in the diff | none (`git diff -- .workflow/_templates/spec.md` → empty; verify-clause at `plan.md:95` step 10) — confirmed at `review.md:246` cycle-2 walk | yes |
| AC8 — `research:<question-list>` documented in ≥ 2 places (5 sites total: `orchestrator.md:100,114` + `SKILL.md:34,60,153`); F0002 acknowledged in plan `Out of scope` for retro | none (grep-evidence at `plan.md:88-92` steps 3, 5, 6, 7 verify-clauses) — confirmed at `review.md:248-254` cycle-2 walk (5 sites enumerated) | yes |
| AC9 — `retro.md > Smoke evidence` will record the 9-step grep set (plan steps 1, 2, 3, 4, 5, 6, 7, 8, 9 — including pm.md:73's `FANOUT_REQUESTED: research:` clause) so future regressions are bisectable | none (the AC *is* a retro-phase deliverable; `plan.md:96` step 11 pre-commits the grep shape; cycle-2 B6 fix extended set from steps 1–8 to steps 1–9 to cover the pm-side authorisation clause added in step 9) — confirmed at `review.md:256` cycle-2 walk | yes (retro-phase deliverable; grep shape pre-committed at plan.md:96) |

**Unmapped ACs**: 0. All 9 ACs map to grep-evidence verify-clauses in `plan.md > Steps` (steps 1–11) + cycle-2 lead re-verification in `review.md > Cycle 2 verification`.

## Results

N/A — no harness. There is no `unit`, `integration`, or `e2e` suite to run because no executable surface changed. The verification artifacts are:

1. Per-step grep verify-clauses inside `plan.md > Steps 1–11`, executed by `engineer` at landing time.
2. Cycle-1 lead review-mode fanout (6 `team-*` workers) recorded at `review.md > Per-agent findings`.
3. Cycle-2 lead re-verification recorded at `review.md > Cycle 2 verification > Blocker re-verification (B1–B7)` and `> AC re-tick walk (AC1–AC9)` — all 7 blockers closed, all 9 ACs tick.
4. Retro-phase grep capture into `retro.md > Smoke evidence` (AC9, deliverable in the retro phase) using the 9-step set pre-committed at `plan.md:96`.

## Notes

- AC9's grep set was extended in cycle 2 (B6 fix) from steps 1–8 to steps 1–9 — `plan.md:96` step 11 now names "plan steps 1, 2, 3, 4, 5, 6, 7, 8, 9 — including pm.md:73's `FANOUT_REQUESTED: research:` clause", and `spec.md:43` AC9 evidence text was refreshed to match. Without this fix a future regression at pm.md:73/75 would not be bisectable against AC9 retro evidence.
- The retro phase is the natural owner of AC9's actual grep output capture; this tests.md stub records the verification *shape* (which greps, against which file:lines, mapping to which AC), not the literal grep output.
- No fanout was triggered for this QA run. The qa-fanout heuristic requires ≥ 2 of {unit, integration, e2e} AND ≥ 3 tests in any category — both conditions fail trivially since 0 tests exist (skipped mode).
- Future test harness recommendation carried from 0002 still applies (see `.workflow/0002-feat-fanout-team-research/tests.md > Future test harness recommendation`): a `/dev-smoke-fanout` self-hosting slash command that grep-asserts the fanout output structure. This run would have been a fresh consumer of that harness (plan-mode default-on path); since the harness doesn't exist, the live cycle-1 review fanout dispatch was again the de-facto integration evidence.

## Commands

```bash
# Re-run the AC9 9-step grep set (pre-committed at plan.md:96 step 11) — retro phase captures these into retro.md > Smoke evidence
grep -n "Default = single-pass\|Default = fanout for plan size" .claude/agents/lead.md                        # AC1 (plan step 1)
grep -n "default-on for plan size ∈ {S, M, L} AND existing code; skip XS / pure-greenfield" .claude/skills/fanout-team-agents/SKILL.md  # AC2 (plan step 2)
grep -nE "research:\[a-z0-9,\\-\]\+" .claude/orchestrator.md                                                   # AC3 (plan step 3)
grep -nE "research:\[a-z0-9,\\-\]\+" .claude/skills/fanout-team-agents/SKILL.md                                # AC3 (plan step 4)
grep -n "FANOUT_REQUESTED: research:" .claude/orchestrator.md                                                  # AC4 (plan step 5)
grep -n "research:<question-list>" .claude/skills/fanout-team-agents/SKILL.md                                  # AC5 (plan steps 6, 7)
grep -n "default-on for plan size ∈ {S, M, L} AND existing code" WORKFLOW.md                                   # AC6 (plan step 8)
grep -n "FANOUT_REQUESTED: research:" .claude/agents/pm.md                                                     # AC4 (plan step 9 — added in cycle-2 B6 fix)
git diff -- .workflow/_templates/spec.md                                                                       # AC7 (plan step 10) — expect empty
```
