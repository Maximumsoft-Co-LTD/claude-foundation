# Task line format — full detail

Deep reference for SKILL.md principle 5 (strict task format) and principle 6 (one task → one verify). Consult when writing or reviewing `tasks.md` rows.

## The format string

`T### [P?] [AC#] [ref: path#anchor]? action — path#anchor (new|edit|delete) — verify: <command or observable>`

Tasks live in `tasks.md`, phased (Setup → Foundational → one per User Story by priority → Polish). Every task has a `T###` id and all four parts, no exceptions. `tasks.md` opens with a **one-line** `> **For humans**` blockquote (what one task line is; the codes are for build agents — keep it, don't grow it, don't strip it in self-review). Brownfield `tasks.md` also opens with `## Guardrails` (invariants from `## Current state`, backticked `` `path#anchor` `` each) — the engineer's **only** up-front invariant read. `[ref: path#anchor]?` is a lazy pointer to design/contract context beyond the row (`plan#scaffold`, `spec#AC1`, a test-plan row, `uxui#S1`), opened when the task starts — this keeps `/implement` from front-loading every artifact.

## The four parts, in full

- **T### + [P?]** — sequential id in execution order; add `[P]` only when parallel-safe (different files, no unmet dependency).
- **[AC#]** — the acceptance scenario this task lands (`[DoD]`/`[SC-###]` for a non-AC task). No tag = scope-creep or a missing spec scenario — fix the spec first.
- **action** — imperative, one verb (`add`, `extract`, `wire`, `delete`, `rename`). Not "implement X" — that's a goal.
- **path#anchor** — a *re-resolvable* location, not a raw line. Cite the **symbol** (`src/users.ts#getUserById`) or a **unique snippet/heading** for shell/config/markdown (`dev-state-mark.sh#"command -v jq"`). Must re-find with LSP/grep *after earlier tasks shift the file* — a bare `:42` goes stale. A line number is allowed only as a write-time hint (`#getUserById (~L42)`), never the sole handle. `path (new)` for new files; cite the precedent when mimicking a pattern (`mirror src/handlers/orders.ts#createOrder`).
- **verify** — a command (`npm test src/foo.test.ts`, `curl -s :8080/health | jq .status`, `psql -c "\d users"`) or a concrete observable (`column email_verified exists`). "manually check"/"visually inspect" = task too big, split it. *Single highest-leverage rule in this skill.*

## Type-specific task-1 rules (principle 7)

- **`fix`** — task 1 is "write failing regression test for <bug>" against `spec.md > Reproduction`. Address the **root cause**, not the symptom — if the fix is "catch the exception"/"guard the null", document why the local fix is correct rather than upstream.
- **`refactor`** — lean on the existing suite where it covers the touched behaviour; where it doesn't, **task 1 = characterization baseline** (golden-master/snapshot of current behaviour, captured before the change), mirroring `fix`'s regression test.
- **`spike`** — the engineer writes `recommendations.md` instead of code; tasks may be open-ended.

## One task → one verify; else split (principle 6)

Multiple verifies = multiple things → split. Tasks are atomic (1-to-1 to commits in spirit). `engineer` runs the verify literally after the task. The per-AC *test strategy* (which level proves each scenario) lives in `test-plan.md` (`qa`'s contract), not here.
