# Run: <title>

> **XS micro-lane** — the single artifact replacing spec.md / plan.md / tasks.md / test-plan.md at `size=XS`. Same contract core (Goal · Type · `AC#` · `T###`+`verify:` · Coverage); `SIZE_UPGRADE: S` re-emits the full four-artifact set. S and above never use this file.

**ID**: `NNNN-type-slug`
**Type**: feat | fix | refactor | chore | docs | spike
**Size**: XS
**Field**: greenfield | brownfield
**Status**: draft | approved | done
**Open PR on ship**: yes | no

## Goal *(required)*

<one sentence: what changes, for whom / why now>

## Acceptance *(required — the contract; per-line confirmed at the gate)*

- [ ] **AC1** `[evidence:behavioral]` — **Given** <state>, **When** <action>, **Then** <outcome>.
- [ ] **AC2** `[evidence:structural]` — <boundary / on-error> — or `none — <default>`.

> **fix — cover the input domain, not just the reported value.** A ticket names ONE
> input; the defect almost never lives at exactly that input. Before writing AC2,
> walk the parameter's neighbours and pin the ones that would resurrect the same
> symptom: for a number — zero, negative, fractional, out-of-range; for a
> collection — empty, single, larger than the window; for a string — empty, blank,
> wrong case, `null`. Name the ones that break; write `none — <default>` for the
> rest. (The classic miss: a ticket reporting a window of `0` gets fixed while
> `0.4` still returns the whole list — the same bug, one input over.)

## Approach *(required — 1–3 lines: what changes where; fix: repro + expected; brownfield: the invariant not to break, `path#anchor`)*

<...>

## Tasks *(required)*

- [ ] **T001** [AC1] <action> — `path#anchor` (edit) — verify: <command or observable>

## Coverage *(feat/fix/refactor — one line per AC; chore/docs: `n/a — type=<x>`)*

- AC1 `[evidence:behavioral]` → <test / observable check> · Impacted cmd: `<command>`

## Execution contract *(feat/fix/refactor)*

- **Impacted**: `<command>` · cwd: `<path>` · env/dependencies: `<none or names>` · expected groups/min tests: `<groups/count>`
- **Full-suite**: `<command>` · cwd: `<path>` · env/dependencies: `<none or names>` · expected groups/min tests: `<groups/count>`
- **Rendered smoke**: `<command or n/a — no rendered evidence>` · viewport/browser: `<value>`

---
*Assumptions (inferred) · deviations · notes — append below when real, delete otherwise.*
