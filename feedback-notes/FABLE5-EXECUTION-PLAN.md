# Execution Plan — FABLE5-IMPROVEMENT-PLAN rollout

Companion to `FABLE5-IMPROVEMENT-PLAN.md`. Six batches, each independently shippable with its own verify step and release bump.

## Decision log (owner-confirmed, 2026-07-15)

| Decision | Choice |
|---|---|
| Scope | All of P0–P5 |
| Lead top tier | **sonnet default + opus escalation stays as-is** — no `fable`/`inherit` tier in guard or docs; P1.1's "allow inherit" item is DROPPED |
| Multi-repo boundary (P3.8) | **Scope-out permanently** — fanout stays read/review/test-only; cross-repo implement/ship declared out of scope in docs |
| team-* fork (P3.7) | **Declare detached** from pr-review-toolkit; no upstream audit; record in TEAM.md |

---

## Batch 1 — P0 bug fixes → release v2.6.9 (patch)

| # | File | Change |
|---|---|---|
| 1.1 | `.claude/agents/INDEX.md:11` | pm row `sonnet` → `opus` |
| 1.2 | `.claude/hooks/dev-state-validate.sh:70` | Replace fixed-indent dup-key grep with indent-proof check: `jq --stream` depth-1 key total vs `jq 'keys \| length'` — mismatch ⇒ duplicate key ⇒ block |
| 1.3 | `.claude/orchestrator/references/state-edge-cases.md` | Add caveat: guard Case 3 fails OPEN with 0 or 2+ active runs and no `CLAUDE_DEV_RUN_ID` |
| 1.4 | `.claude/hooks/dev-agent-guard.sh` Case 4 | When a `model` override is present AND the frontmatter pin can't be parsed → **fail closed** with an explicit reason (today: silent allow). No behavior change when parse succeeds |
| 1.5 | `.claude/hooks/dev-agent-guard.sh` Case 6 msg | "an opus main session" → "a higher-tier main session" |
| 1.6 | `.claude/commands/dev.md:15` | Mention test-plan folds into the XS/S combined spawn |
| 1.7 | `WORKFLOW.md:234` | Agent-map fanout scope: add surface (per-repo) axis + step-7 `research:` signal |
| 1.8 | `.claude/hooks/no-direct-main-commit.sh` header | Stamp `OPT-IN — not wired; see CLAUDE.md` |

Verify: `tests/run-artifact-lint-tests.sh` green; hand-test guard Cases 4/6 (valid pin, unparseable pin, Explore w/o model); `jq` dup-key check against a crafted dup file; grep `ddd-strategic` mirror check.

## Batch 2 — P5 Opus 4.8 profile → v2.7.0 (minor, flagship)

| # | File | Change |
|---|---|---|
| 2.1 | `.claude/orchestrator.md` preamble | One line: "Opus 4.8 main session → verify effort ≥ high (xhigh preferred) before Phase 2" |
| 2.2 | `.claude/hooks/artifact-lint.sh` + `settings.json` | Add `--hook` adapter mode (stdin hook JSON → resolve run dir from `file_path` under `.workflow/**` → run checks → emit `additionalContext` warning, **never block**). Wire under PostToolUse `Write\|Edit`. Keep CLI mode intact; extend test suite for adapter |
| 2.3 | `.claude/hooks/lint.sh` | Add typecheck dispatch: `.ts/.tsx` → project-local `tsc --noEmit` (only if `node_modules/.bin/tsc` + tsconfig found; skip silently on >20s — 30s hook timeout); `.py` → `pyright` if present. Go already covered via golangci-lint's govet |
| 2.4 | `.claude/agents/team-code-reviewer.md:23-31` | Remove ≥80 floor + "filter aggressively"; contract becomes "report ALL findings with confidence (0-100) + severity" |
| 2.5 | `.claude/agents/references/lead.md:113` | Synthesis applies the ≥80 gate; sub-80 findings logged as one-line FYIs in `review.md` |
| 2.6 | `.claude/agents/TEAM.md` | Audit-trail entry for 2.4 + **detached declaration** (decision log) — replaces the "follow-up audit" language at `TEAM.md:55` |
| 2.7 | `.claude/orchestrator/references/fanout-plan.md` + `size-execution.md` | `## Fanout plan` default-ON at M/L (lead must justify off, not on); sweep `orchestrator.md` fanout decision points to imperative phrasing ("spawn X when Y") |
| 2.8 | `.claude/agents/engineer.md` (+ `lead.md`) | Add: "small decisions (naming, defaults) — choose, note in artifact, don't BLOCKER" (pm already has its version at `pm.md:28`) |
| 2.9 | `.claude/orchestrator.md:21` | Add "never split a worker brief across turns"; drop the 5-min cache-TTL justification (P1.4, folded here) |

Verify: artifact-lint adapter test (edit a fixture `spec.md` with a TODO → warning fires, no block); lint.sh on a TS file with a type error → exit 2; spawn team-code-reviewer on a small diff → all-findings format.

## Batch 3 — P1 model-tier docs → ships inside v2.7.0

| # | File | Change |
|---|---|---|
| 3.1 | NEW `.claude/orchestrator/references/model-tiers.md` (~200 words) | Single policy note: main = session model; pm = opus (2.6.5 rationale); lead = sonnet default / opus escalation list (unchanged per decision); workers = sonnet; analyzers = haiku + the (previously unwritten) haiku-vs-sonnet rationale; Case 6 floor; escalate-hardest-runs-to-higher-tier guidance from P5.7. Point INDEX.md + guard comments here |
| 3.2 | `.claude/agents/references/lead.md:22` | Mark "sonnet ≈ opus ~½ wall-clock" as generation-dated: "re-validate per model generation" |
| 3.3 | `references/lead.md:96`, `references/pm.md:20`, `references/qa.md:51` | Inline-fallback: `Dispatched-as:` must note the haiku→sonnet tier change |
| 3.4 | `.claude/hooks/dev-agent-guard.sh` Case 6 | Floor model read from `CLAUDE_DEV_FLOOR_MODEL` (default `sonnet`) instead of hard-coded string |

Verify: guard Case 6 with and without the env var; INDEX.md ↔ frontmatter re-scan (all 14 rows).

## Batch 4 — P2 context rations → v2.7.1

| # | File | Change |
|---|---|---|
| 4.1 | `team-mode-sharding.md:11` + `orchestrator.md:33` | Gate fold: after set-compare passes, re-read ONE AC's artifact row per shard (deterministic pick: first AC alphabetically — no randomness available); mismatch ⇒ full re-read |
| 4.2 | `phase-2-guards.md:23` | Security near-miss (path category tripped, no content sink): allow one bounded peek (`git diff -- <file> \| head -200`) before deciding skip |
| 4.3 | `phase-2-guards.md:29` | Failure-aware capture: full suite output on red, `tail -40` on green |

Verify: dry-run a team-built run through the gate fold; confirm phase-2-guards word count stays ~1k (resident-file budget).

## Batch 5 — P3 consolidation → v2.7.2

Order matters (5.1 → 5.2 first; later items touch merged files):

1. **Merge fanout refs 4→2:** `fanout.md` + `fanout-plan.md` + `surface-fanout.md` → NEW `fanout-dispatch.md` (signal regex, registry preflight, 3 axes, gate levers — state each rule ONCE); `implement-fanout.md` stays. Update every pointer: `orchestrator.md`, commands, `WORKFLOW.md`, `skills/fanout-team-agents/references/*`. Target ≤3.2k words (from 3.8k across the three)
2. **Dedup recruit-help boilerplate:** canonical contract lives in `skills/fanout-team-agents/references/dispatch-mechanism.md`; the 7 carrier files keep only cap number + pointer + role-specific stop-line
3. **NEW `references/engineer.md`:** ship-mode detail + pointer to implement-fanout contract; add the "when does an agent get a references file" rule to `INDEX.md`
4. **Non-router skills:** 2-line note in `fundamentals.md` + table in `CLAUDE.md` naming the 10 frontmatter-triggered skills (keeps always-on layer lean)
5. **Hook tests:** `tests/run-hook-tests.sh` covering dev-agent-guard (all 6 cases), dev-state-validate (valid/dup-key/indent-variant), dev-state-mark (foreground/background/team-slice), protect-secrets (allow/deny/bash-dequote) — same fixture pattern as artifact-lint's suite
6. **Split `ui-ux-pro-max`** (6.1k words) into SKILL.md + references/, matching siblings
7. **Multi-repo scope-out (decided):** rewrite `size-execution.md:28` + `surface-fanout.md` (post-merge location) as a permanent design boundary — "cross-repo findings surface to the user; implement/ship stay pinned to repo_root by design"; mirror one line in `WORKFLOW.md`

Verify: full hook test suite green; grep for dangling refs to the 3 deleted fanout files; `ddd-strategic` mirror check; word-count the always-on layer (must not grow).

## Batch 6 — P4 spikes (no release until adopted; each is a `/dev type=spike` candidate)

1. Structured worker returns (schema vs first-line sentinels) — spike + `recommendations.md`
2. Workflow-primitive deterministic fanout for review/security shapes — spike
3. Registry mid-session rescan check — 30-min test on current Claude Code; if rescan works, collapse the `team_registry` branch to a version note
4. qa visual pass via browser-automation MCP vs Playwright-Bash — evaluate, document either way

## Release & house rules

- Every batch: CHANGELOG entry + VERSION bump + brew formula chore (house pattern: `chore(release)` then `chore(brew)`); commits off `main` on a batch branch, one PR per batch.
- After Batches 1/2/3/5: run the `fundamentals.md:55` mirror check (grep `ddd-strategic` across CLAUDE.md / README.md / WORKFLOW.md).
- Stated assumptions (flag if wrong): Case 4 fail-closed is acceptable (a blocked spawn with a clear reason beats a silent tier leak); tsc-per-edit is best-effort with skip-on-slow; deterministic AC pick in 4.1 replaces "random" (hooks/agents have no seeded RNG).
