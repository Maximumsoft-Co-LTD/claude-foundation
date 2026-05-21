# Tests: Fanout team agents

**Plan**: [./plan.md](./plan.md)
**Status**: skipped
**Cycle**: 0 of max 3

## Type-aware mode
Pick one. The rest of this doc is filled out only for the active mode.

- [ ] **Full** (type = feat / refactor)
- [ ] **Fix** (type = fix — regression test mandatory)
- [x] **Skipped** (type = chore / docs / spike) — write the reason in `Skipped` and leave the rest blank.

## Skipped

- **Reason**: feat, but the entire diff is markdown — a new skill (`.claude/skills/fanout-team-agents/SKILL.md`), 6 team-agent forks (`.claude/agents/team-*.md`), an agent manifest (`.claude/agents/TEAM.md`), wiring edits to four `/dev` worker agents (`lead.md` / `qa.md` / `engineer.md` / `orchestrator.md`), one template addition (`.workflow/_templates/review.md`), and prose updates (`WORKFLOW.md`). There is no executable production code in this repo and no test harness yet exists here (no `package.json`, `pytest.ini`, `go.mod`, no test runner of any kind). Authoring unit / integration / e2e tests would require standing up a brand-new harness purely to assert that markdown files contain the text they already provably contain. The behaviour that *does* matter — "fanout dispatch actually fans out and produces a synthesised `review.md` with 6 populated agent sections" — was exercised live during the run itself: cycle-1 lead review was the first real end-to-end fanout dispatch, surfaced a critical mechanism finding (agent registry is session-scoped → inline-fallback engaged), filed 8 blocking items in `review.md`, all 8 were resolved in the cycle-1 fix pass, and cycle-2 lead verification returned `pass` with all 10 ACs ticked. That sequence is the integration test for this change — it just lives in `review.md` and `state.json` rather than `tests.md`.

- **Risk accepted**: The recommendation in the next section (build a self-hosting smoke-test slash command that runs `/dev` against a tiny fixture diff and grep-asserts `review.md` carries 6 `### team-<role>` subsections with `Dispatched-as:` provenance) is not built. If the team-agent files drift or `lead.md > Mode B step 1a` regresses, the regression will only be caught the next time a human actually runs `/dev` review on a real diff and notices the missing fanout sections — not in CI. This is acceptable for a workflow-tooling change in a repo with no CI today; it would not be acceptable once a CI layer exists.

## Acceptance-criteria coverage

Every AC in `spec.md > Acceptance criteria` was verified by either (a) `engineer`'s plan-step verify-clause at landing time, (b) `lead`'s cycle-1 review-mode check, or (c) `lead`'s cycle-2 re-verification after the cycle-1 fixes. Status verdicts come from `.workflow/0002-feat-fanout-team-research/review.md` (cycle-1 + cycle-2 sections) and `state.json > notes` ("10/10 ACs tick").

| Spec criterion | Verification artifact | Verified |
|----------------|-----------------------|----------|
| AC1 — fanout skill exists with mechanics + 3 anti-patterns | plan step that landed the skill carried a verify-clause checking 4 mechanics sections + the 3 named failure modes; lead cycle-1 + cycle-2 re-confirmed against `.claude/skills/fanout-team-agents/SKILL.md:67-128` | yes |
| AC2 — 6 `team-*.md` forks exist, YAML `name:` matches slug, `Fork source:` block at top | engineer landed each as its own commit with a verify-clause grep for the YAML `name:` slug and the `Fork source:` block; lead cycle-2 re-checked all 6 files at `.claude/agents/team-{code-reviewer,code-simplifier,comment-analyzer,pr-test-analyzer,silent-failure-hunter,type-design-analyzer}.md` | yes |
| AC3 — `lead.md` review mode dispatches the 6 agents in parallel and synthesises `review.md` | lead cycle-1 itself **was** the first real exercise of this path — the fanout fired end-to-end and produced this run's `review.md` with all 6 `### team-<role>` subsections; lead cycle-2 re-verified the wiring at `lead.md:77` + the synthesis convention at `.workflow/_templates/review.md:24-46` | yes (live-run) |
| AC4 — `lead.md` security mode supports per-bucket fanout on ≥ 2 triggers | wiring landed at `lead.md:110`; cycle-1 review checked the trigger heuristic; cycle-2 verified the single-trigger path remains the existing single-pass flow. Not exercised live because the diff trips zero sensitive-paths buckets (see `state.json > skipped_steps`) — wiring-only verification | yes (wiring) |
| AC5 — `lead.md` plan mode supports opt-in parallel codebase exploration with documented heuristic | wiring + heuristic landed at `lead.md:52`; lead cycle-1 + cycle-2 re-read the heuristic to confirm "≥ 2 independent integration points in `spec.md > Constraints`, sharing no files or symbols" is named in the agent file | yes |
| AC6 — `qa.md` test mode supports opt-in fanout across unit / integration / e2e | wiring + heuristic landed at `qa.md:32` ("≥ 2 categories AND any category ≥ 3 tests"); lead cycle-2 verified default single-pass remains the no-fanout path | yes |
| AC7 — `engineer.md` implement mode supports optional fanout of independent plan slices | wiring + heuristic landed at `engineer.md:27` (L-tier + Phases + disjoint Files-touched); lead cycle-2 verified | yes |
| AC8 — `.workflow/_templates/review.md` accommodates the per-agent shape AND single-reviewer runs | template change landed with the parenthetical "(present only when fanout ran; omit for single-reviewer runs)" at line 24-25; lead cycle-1 + cycle-2 verified the existing `Plan adherence` / `Acceptance-criteria check` / `Findings > Blocking / Non-blocking` sections survive | yes |
| AC9 — `WORKFLOW.md` + `TEAM.md` name the skill, the agents, and fork-source/date | landing commits carried verify-clauses on `WORKFLOW.md > Type-aware phase matrix > Fanout availability`, the `Agent map > team-* row`, and `.claude/agents/TEAM.md > Fork sources` carrying `Fork date: 2026-05-21`; lead cycle-2 re-confirmed | yes |
| AC10 — smoke run produces `review.md` with 6 populated agent sections | this run's own `review.md` is the smoke evidence; `grep -c "^### team-"` returns 6, every section has ≥ 1 finding bullet, every section carries a `Dispatched-as:` line so the inline-fallback path vs. the direct-`subagent_type` path is visible to any reader. Cycle-1 surfaced the session-scoped-registry caveat live; cycle-2 confirmed it's documented in `SKILL.md > Operational caveats` | yes (live-run, with operational caveat documented) |

**Unmapped ACs**: 0. All 10 ACs map to either landing-commit verify-clauses, the cycle-1/cycle-2 review verdicts in `review.md`, or this run's own `review.md` as live-fanout evidence.

## Future test harness recommendation

The natural follow-up — not built here, captured for `retro` / `FOLLOWUPS.md`:

Build a `/dev-smoke-fanout` (or equivalent) self-hosting slash command that:

1. Stages a tiny fixture diff in a scratch worktree (e.g., a 5-line edit to a stub source file under a `tests/fixtures/` path so multiple team agents have something non-trivial to look at).
2. Invokes `/dev` in review-only mode against that fixture.
3. Asserts on the produced `review.md`:
   - `grep -c "^### team-" review.md` returns exactly 6.
   - Every `### team-<role>` subsection contains a `Dispatched-as:` line (so registry-fallback vs. direct dispatch is observable).
   - Every subsection has ≥ 1 finding bullet (no empty stubs, no `Error:` stubs).
   - `Plan adherence` + `Acceptance-criteria check` + `Findings > Blocking / Non-blocking` sections from the synthesis layer are all present.
4. Exits non-zero if any assertion fails.

This would convert AC10's current verify-clause (a `grep -c` against the live run's `review.md`) from "verified once at write time" into "verified on every test run." It would also catch the failure mode that the cycle-1 live dispatch surfaced — agent registry session-scoping silently engaging the inline-fallback path — by making the `Dispatched-as:` provenance line a hard assertion rather than an artifact-only signal.

Out of scope for this run because (a) it requires a test runner this repo doesn't yet have, (b) the live-run already provided the integration-level evidence, and (c) the `Dispatched-as:` provenance line was added in cycle-1 fixes precisely so a future harness *can* assert against it cleanly.

## Sign-off

QA verdict: **skipped**. Type=feat but markdown-only with no executable surface; the live cycle-1 + cycle-2 review-mode dispatch is the de-facto integration test and is recorded in `.workflow/0002-feat-fanout-team-research/review.md`. All 10 ACs mapped, 0 unmapped, 0 blocking findings. Cycle budget unconsumed (`cycles.test = 0`). Recommend a `/dev-smoke-fanout` harness as a follow-up once this repo grows a test runner; capture in `retro` for `FOLLOWUPS.md > Open`.
