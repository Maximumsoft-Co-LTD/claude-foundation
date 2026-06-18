# Orchestrator reference — Phase 2 guard mechanics

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The Phase-2 step *decisions* stay inline (steps 10–16); this holds the scan/guard mechanics. Read it at the step it names.

### Step 10 — Implement (details)

- **Resume guard:** `--resume` into `step=implement` with `impl_phases_done` a non-empty subset → spawn the **Integration variant directly** (skip the write-intersection check); else normal. Prompt hints: references present → "open every reference first"; feat/fix/refactor → "read `test-plan.md` first, build its edge cases as you implement"; `fix` → "step 1 is the failing regression test, committed before any production fix."
- Confirm AC progression; unticked without a blocker → re-spawn with one correction. **Diff check** (skip if `repo_root` null): `git -C <repo_root> status --porcelain` empty → re-spawn (`spike`→confirm `recommendations.md`; `fix`→confirm HEAD advanced). `FANOUT_REQUESTED: implement:<phases>` → run the 5-step consumer contract (`references/fanout.md > Implement-fanout — orchestrator consumer contract`). "needs user input" → `AskUserQuestion`, re-spawn.

### Step 11 — Review (details)

- Compute the **changed-repo set** = engineer's per-repo changed files, confirmed by `git -C <r> status --porcelain` non-empty or new commits, restricted to `state.repos` else `[repo_root]`. Single-repo → review `repo_root`. Multi-repo → surface fanout (`references/surface-fanout.md`).
- Spawn `lead` review mode. **Model: `sonnet` by default; keep opus** for plan `Size=L`, a `## API/event contracts` section, or a substantial test-**infra** change. Pass `state.json > size`. INDEX → `review`. State: `step=review, cycles.review++`. `FANOUT_REQUESTED: review` → dispatch tiered workers (core 3 for M, full 6 for L) per `## Fanout dispatch`, then re-spawn `lead` (synthesis keeps opus). **Artifact check:** `review.md` first line missing → re-spawn.
- Verdict `fix-required` + `cycles.review` < 2 → `engineer` with findings. ≥2 → escalate (`AskUserQuestion`, max 2). (Multi-repo non-primary blocker → surface, never auto-fix.)

### Step 12 — Security review (details)

**Scan every changed repo** two ways: (1) `git -C <r> diff --name-only` for path-named categories (auth/session, crypto, `.env`/secret, migrations, new network clients); (2) `git -C <r> diff` added lines for content-pattern sinks (`innerHTML`/`outerHTML`/`document.write`/`eval`/`Function`/`dangerouslySetInnerHTML`/jQuery `.html(`, SQL string-building, `exec`/`spawn`/shell). Any sensitive path → fire, record which repos trip (the *security review set* ⊆ changed-repo set). **Carve-out:** a first-party browser-storage round-trip is NOT a `deserialise` trigger unless the diff carries a dangerous sink or crosses a real trust boundary. Also fire on user request. (Recompute the changed-repo set here the same way when review was skipped.)

- Firing: set `security_triggered=true`. Multi-repo → surface fanout. Single-repo → `lead` security mode (`FANOUT_REQUESTED: security:<buckets>` ≥2 → one `team-code-reviewer` per bucket, re-spawn synth). **Artifact check.** `fix-required` `high` → blocking, back to `engineer` then re-spawn `lead` security mode on the new diff (bumps `cycles.review`; >2 escalate). `medium`/`low` → **append to `FOLLOWUPS.md > Open` immediately** (`F-<run-id>-NN`, `security`, `path:line`), proceed. Not firing → `security_triggered=false`.

### Step 13 — Test (details)

- feat/refactor/fix → spawn `qa` execute mode. INDEX → `testing`. State: `step=test, next_step=improve, cycles.test++`. Compute the changed-repo set (multi → surface fanout). **Pass `test-plan.md`** (qa executes it row-by-row). **Dedup:** if step 11 ran `team-pr-test-analyzer`, pass its `review.md` section. **Pass `e2e_visual`** — `off` → unit+integration only. When `on` + UI diff → visual verification pass (screenshot viewports, reuse the open browser; MCP backstop if qa defers — unavailable → `AskUserQuestion` + FOLLOWUPS; validate capture-first before routing a fix). **Artifact check** `tests.md`. `fix` → restate "verify the regression fails pre-fix, passes now." Failing + `cycles.test` < 3 → engineer; ≥3 → escalate. **Plan-contradiction rows** → reconcile before ship (`AskUserQuestion`: match plan or amend contract). **Edge-case gaps**: non-blocking stay, blocking (security/data-integrity) → `AskUserQuestion`. **Coverage floors** advisory (below-floor → batched `AskUserQuestion`, never failing, never block ship).
- chore/docs → write `tests.md > Skipped` stub yourself; `next_step=docs`. spike → skip entirely (`recommendations.md` is the deliverable).

### Step 13½ — Improve (details)

Spawn `engineer` Mode D with type, repo_root/branch, the run's changed-file list (the bound — not engineer discretion), suite green. Bounded behaviour-preserving cleanup of only touched code, re-verify green-or-revert. Commit: `fix` → separate `[improve]` commit; `feat` → leave in the working tree for ship (must NOT commit). `nothing to improve` is normal. **Scope check:** improve touched only the run's changed set, else BLOCKER. **Security re-scan** if `security-sink-touched`. No re-trigger of review/test; overflow → append a `FOLLOWUPS.md` refactor follow-up.
