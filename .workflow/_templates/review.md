# Review: <title>

**Plan**: [./plan.md](./plan.md) · **Tasks**: [./tasks.md](./tasks.md)
**Test evidence**: [./tests.md](./tests.md)
**Reviewed**: YYYY-MM-DD
**Verdict**: pass | fix-required
**Cycle**: 1 of max 2

## Tasks adherence *(required)*

One row per task (`tasks.md`) — no skipping rows. A deviation needs a one-line reason.

- [x] T001 — implemented as planned
- [ ] T002 — deviation: <what + why>

## Test evidence consumed *(required)*

Consume the authoritative AC rows from `tests.md`; do not copy or rerun them.

- Status: impacted-passing | passing | failing | skipped
- AC rows: <mapped>/<total> · unmapped: <ids or none> · blocking gaps: <none or summary>

## Contract-risk checks *(required when risk exists)*

Only checks tests cannot prove well: public API/schema, shared invariants, error handling, data loss, concurrency, measured targets, or an AC marked untestable. No risk → `none`.

- [ ] <risk / AC id> — evidence: `path:line` → pass | blocking

## Non-AC slot check *(required when spec has a Definition of Done or Constraints)*

- [ ] DoD: <item> — concrete artifact present? evidence: `path:line` (missing = **blocking**)
- [ ] Constraint: <constraint> — diff honours it? evidence: `path:line` (violation = **blocking**)

## Findings *(required)*

### Blocking

- `path:line` — issue → suggested fix

### Non-blocking

- `path:line` — note (carried to retro)

## Sign-off *(required)*

pass | fix-required → see Test

---

**Fanout-only sections** — add when that fanout ran:

- **Per-agent findings** — ≥ 2 review workers on one repo's diff; each `### team-<role>` with `**Dispatched-as**:` as its first line
- **Per-repo review** — one `### Repo: <path>` per changed repo; Test evidence / Verdict / Cycle stay global

Shape → **lead.md > Mode B (Review)** · per-repo → **orchestrator/references/fanout-dispatch.md > Lead — Mode B**.
