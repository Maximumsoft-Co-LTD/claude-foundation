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

- [ ] **AC1** — **Given** <state>, **When** <action>, **Then** <outcome>.
- [ ] **AC2** — <boundary / on-error> — or `none — <default>`.

> **fix — cover the input domain, not just the reported value.** A ticket names ONE
> input; the defect almost never lives at exactly that input. Before writing AC2,
> walk the parameter's neighbours and pin the ones that would resurrect the same
> symptom: for a number — zero, negative, fractional, out-of-range; for a
> collection — empty, single, larger than the window; for a string — empty, blank,
> wrong case, `null`. Name the ones that break; write `none — <default>` for the
> rest. (Measured 2026-07-30 on `tests/bench/11-recent-window`: 6/6 `/dev` runs
> **and** 6/6 plain-prompt runs fixed a window of `0` and shipped `0.4` still
> returning the whole list — the same bug, one input over, graded 8–10/pass by the
> model judge and caught only by the deterministic oracle.)

## Approach *(required — 1–3 lines: what changes where; fix: repro + expected; brownfield: the invariant not to break, `path#anchor`)*

<...>

## Tasks *(required)*

- [ ] **T001** [AC1] <action> — `path#anchor` (edit) — verify: <command or observable>

## Coverage *(feat/fix/refactor — one line per AC; chore/docs: `n/a — type=<x>`)*

- AC1 → <test / observable check> · Impacted cmd: `<command>`

---
*Assumptions (inferred) · deviations · notes — append below when real, delete otherwise.*
