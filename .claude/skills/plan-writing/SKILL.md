---
name: plan-writing
description: Write an implementation plan (plan.md) plus an executable, verifiable task list (tasks.md) that maps a spec to dependency-ordered tasks with a required architecture diagram, sized XS/S/M/L. Use when drafting `.workflow/<id>/plan.md` in the /dev workflow (lead agent, Phase 1 Plan), or when the user asks to "write a plan", "plan this feature", "break this down", "draft an RFC". Owns size tiering, the mermaid diagram by Type, current-state mapping, inline AC tagging, runnable-verify and anti-placeholder rules, and the pre-draft self-review. Skip throwaway scripts, single-line config edits, and un-spec'd design conversations.
---

# Plan Writing

Pre-flight for `/dev` Phase 1 Plan (lead, plan mode) and any plan draft. Plans that restate the spec, hide decisions in prose, leak "TBD", or lack runnable verifies fail at review.

## The 10 principles

### 1. Read spec.md + carried follow-ups first

List every `Acceptance scenario` (`AC#`) per User Story; check `Carried-over follow-ups`. Every task ties to an `AC#` or a carried follow-up — else it's scope-creep → `FOLLOWUPS.md`.

### 2. Set Size before drafting tasks

Size gates which sections are required/optional/deleted. Pick XS/S/M/L by files touched, logic, and contract/schema reach; borderline → **larger tier**. Four-tier table + edge cases: `references/size-tiering.md`.

### 3. Map current state before designing (brownfield)

Trigger is the run's **`field`** (canonical def: `references/size-tiering.md > Greenfield vs brownfield`), not Type/Size — brownfield maps, greenfield skips. **Skip**: greenfield · chore/docs off live paths · spike.

**Boundary-depth only** — blast radius, invariants, insertion points, cited `path#anchor` via LSP; defer contained internals to `## To explore at implement`, never a blast-radius invariant. Digest invariants into `tasks.md > ## Guardrails`.

**Required**, scaled to size — full section (M/L, refactor/fix): entry point · flow · callers · invariants (+ anti-goals/bug-path); a 1–3 line note (brownfield `feat` XS/S); as-is mermaid (L / non-trivial refactor). Fields, LSP-walk, worked examples per Type: `references/current-state.md`.

### 4. Architecture diagram, always

Mark new pieces `★`. **Code-bearing (`feat`/`fix`/`refactor`) MUST carry a `sequenceDiagram`**, optionally paired with a structural `flowchart`/`classDiagram`; `chore`/`docs` = one line; `spike` = `flowchart` with `?` on unanswered nodes. XS keeps the slot; with Current state present the diagram is *to-be*. Templates per Type: `references/diagrams.md`.

### 5. Strict task format

`T### [P?] [AC#] [ref: path#anchor]? action — path#anchor (new|edit|delete) — verify: <command or observable>`

Every task in `tasks.md` carries all four parts, no exceptions — **T### + [P?]** · **[AC#]** (no tag = scope-creep) · **action** (one imperative verb) · **path#anchor** (re-resolvable, never a bare line number) · **verify** (runnable command or concrete observable; *single highest-leverage rule in this skill*). `tasks.md` opens with `> **For humans**` + `## Guardrails` (brownfield); `[ref:]` lazily points to context beyond the row. Phasing, anchor rules + rationale per part: `references/task-format.md`.

### 6. One task → one verify; else split

Multiple verifies = multiple things → split. Tasks are atomic (1-to-1 to commits in spirit); `engineer` runs the verify literally after the task. Per-AC *test strategy* lives in `test-plan.md` (`qa`'s contract), not here.

### 7. Type-specific rules

Detail: `references/task-format.md > Type-specific task-1 rules`.

- **`feat`** — standard plan.
- **`fix`** — task 1 MUST be a failing regression test against `spec.md > Reproduction`; fix the root cause, not the symptom.
- **`refactor`** — one-line behaviour-equivalence in `Summary`; uncovered touched behaviour → task 1 = characterization baseline.
- **`chore`** — minimal plan; skip Risks for XS.
- **`docs`** — one task per doc file; no test planning.
- **`spike`** — `Out of scope` MUST say "no production code lands — `recommendations.md` only".

### 8. Self-review before status = draft

Walk these before `draft` — full scans + examples in `references/self-review.md`; any failure → fix first:

- **Anti-placeholder** (Scan 1) — `tasks.md` tasks placeholder-free.
- **AC sufficiency** (Scan 2) — tags are the floor: tasks deliver each scenario, ≥ 1 `verify:` runs the acceptance check, boundary/error + `measured:` covered.
- **Section integrity** (Scans 3–4) — diagram ↔ tasks both ways; Current-state claims cite `path#anchor`; Alternatives cite evidence.
- **Verify-per-task** (Scan 5) — command or concrete observable, every task.
- **Summary readable** (Scan 6) — Summary/Technical Context/Gate check present.
- **Trigger discipline** — every present section's trigger fires; DELETE empty sections.
- **Guardrails present** *(brownfield)* — no invariant left only in Current state/To-explore (miss = `BLOCKER:`).
- **Budget** — within `plan-sections.md` Budgets; never drop `[AC#]`/`path#anchor`/`verify:`/mermaid.
- **Scaffold integrity** *(M/L)* — Scaffold ↔ tasks (`self-review.md > Extra checks`).
- **Parallel-phase integrity** *(feat)* — fanout contract holds (`references/parallel-phases.md`).

### 9. Lead plan.md with Summary + Technical Context + Gate check

- **`## Summary`** — 2–3 sentences: approach + why over the obvious alternative (one vertical slice per User Story).
- **`## Technical Context`** — language/framework, storage, testing, platform, perf goal (links `SC-###`), scale.
- **`## Gate check`** — the `rules/fundamentals.md` layers this crosses, one line each — the foundation's Constitution Check: a violation needs justification or a plan change.

Always rendered, every Size/Type (one line fine on XS). Summary = 30-second prose; Current state (when present) = the cited detail — complement, not duplicate.

### 10. Scaffold the skeleton before a long build (M/L)

`## Scaffold`: one fenced block — target file tree (★ new · ~ edited) with each file's key exported signature(s) inline; decision-bearing type shapes ([[programming-fundamentals]]) as definitions; skeleton only, real bodies rot. **Required** M/L · optional mini for S touching existing code · skip XS. Subsumes `## Folder structure`. Placement + worked example: `references/plan-sections.md > Scaffold — worked example`.

## Draft order

Work the 10 principles top-down (spec → size → current state → diagram → task format → self-review), loading each decision's construction skill via `.claude/rules/fundamentals.md` (trust boundary → [[security-fundamentals]] — the planner is where injection gets designed out; name `textContent` not `innerHTML` in the task). Draft **plan.md** in the `references/plan-sections.md` placement order (always-required sections first), then **tasks.md**: `## Guardrails` (brownfield invariants; greenfield `none`) → phased `T###` tasks → AC→task coverage list.

## Section gating by Size

Which `plan.md`/`tasks.md` section is required/optional/skipped per XS/S/M/L. `skip` = **DELETE the section entirely** — no empty headers, no "N/A" lines. Authoritative 15-row table: `references/size-tiering.md > Section gating by Size`.

### Phases for L plans

When `tasks.md` grows past ~12 tasks, group them under named phases (`### Phase 1: schema migration`), each with ordered `T###` tasks. `engineer` creates one `TaskCreate` per phase + one nested task per `T###`. Phases are *grouping*, not gates — `/dev` already gates at spec-approval.

#### Parallelizable phases (feat-only — the implement-fanout contract)

A `feat` plan MAY mark **≥ 2** phases parallelizable — one engineer per phase, concurrently. Each declares `**Parallelizable:** yes`, an exclusive pairwise-disjoint `**Files touched**` set, and `**Depends on:** none`; every such plan ends with a sequential **integration phase** owning shared glue and every verify — parallel phase-engineers are write-only. Full contract + worked example: `references/parallel-phases.md`.

## Relation to other skills

Composes, doesn't replace. Load the construction-fundamentals layer(s) the work touches **first** (run order: `.claude/rules/fundamentals.md`) — their output is the substance of `Summary` + `tasks.md`; `fix` plans run [[debug-fundamentals]] first. [[git-workflow]] pairs at ship time (atomic tasks → atomic commits). Skip triggers are in the frontmatter.

## Anti-patterns

- **Hour/day estimates** — planning fallacy makes these wrong by 2–4×; use `Size` only.
- **"Considerations"/"Notes" bucket sections** — every insight goes in a section that drives action.
- **Designing for hypothetical future requirements** — spec didn't ask → `FOLLOWUPS.md`.
- **Unpinned/assumed dependencies** — pin an exact existing version, verify it resolves (`self-review.md > Extra checks > Dependencies concrete`).
- **New port/boundary without a named interface** — name interface + signatures in `## API / event contracts` before the tasks that fill them, or the engineer invents them and the adapter drifts.
- **Empty triggered sections** — DELETE, don't write `N/A`; no filler Observability line, no `Alternatives` without a Verified line, no `[AC#]: all` tag.

## References

Pick the file that matches the friction:

| File | Read when |
|---|---|
| `references/size-tiering.md` | Picking XS/S/M/L, borderline calls, the `field` def, the section-gating table, time budgets |
| `references/diagrams.md` | Choosing the diagram template per Type; the L-plan two-diagram pattern |
| `references/current-state.md` | The LSP-walk, what counts as an invariant, worked examples per Type |
| `references/task-format.md` | Task-line anchor rules per part + type-specific task-1 rules |
| `references/parallel-phases.md` | The fanout contract + a worked phase example |
| `references/self-review.md` | The six scans, anti-placeholder list, extra M/L checks |
| `references/plan-sections.md` | Trigger + placement + Reader + Budget per section; the Scaffold worked example |
