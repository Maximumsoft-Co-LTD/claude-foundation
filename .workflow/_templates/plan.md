# Plan: <title>

**Spec**: [./spec.md](./spec.md)
**Type**: feat | fix | refactor | chore | docs | spike
**Size**: XS | S | M | L
**Field**: greenfield | brownfield
**Status**: draft | approved | done

## Outcome *(required)*

- **Before**: <how the system behaves today>
- **After**: <how it behaves once these Steps land>
- **Benefit**: → spec.md > Outcome

## Approach *(required)*

<2–3 sentences: the strategy + why this over the obvious alternative>

## Phases for this task *(required)*

<matrix defaults for type=<feat | fix | refactor | chore | docs | spike> — no deviations>

## Fanout plan *(required)*

No fanout — single-pass.

## Architecture diagram *(required)*

```mermaid
flowchart LR
  A[Client] --> B[★ New handler]
  B --> C[(DB)]
```

## Steps *(required)*

Format: `<action> — path#anchor (new | edit | delete) — verify: <command or observable> [AC#]` · use `[DoD]` for a Definition-of-Done item.

1. <action> — `path/to/file.ext#symbolOrSnippet` (new) — verify: `npm test path/to/foo.test.ts` [AC1]

---

**Optional sections** — add when its trigger fires, delete the rest:

Folder structure · Scaffold · Current state · Risks · Rollback

- Section triggers + size gating → **plan-writing > references/plan-sections.md** & **SKILL.md**
- Strict Steps format + self-review → **lead.md > Mode A (Plan)**
- Diagram shape by Type → **plan-writing > references/diagrams.md**
