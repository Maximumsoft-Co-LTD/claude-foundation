---
name: plan-writing
description: Write an implementation plan (plan.md) plus an executable, verifiable task list (tasks.md) that maps a spec to dependency-ordered tasks with a required architecture diagram, sized XS/S/M/L. Use when drafting `.workflow/<id>/plan.md` in the /dev workflow (lead agent, Phase 1 Plan), or when the user asks to "write a plan", "plan this feature", "break this down", "draft an RFC". Owns size tiering, the mermaid diagram by Type, current-state mapping, inline AC tagging, runnable-verify and anti-placeholder rules, and the pre-draft self-review. Skip throwaway scripts, single-line config edits, and un-spec'd design conversations.
---

# Plan Writing

Plans that restate the spec, hide decisions in prose, leak "TBD", or lack runnable verifies fail at review.

## The 10 principles

### 1. Read spec.md + carried follow-ups first

Every `Acceptance scenario` (`AC#`) per User Story + `Carried-over follow-ups`. Every task ties to an `AC#` or carried follow-up — else scope-creep → `FOLLOWUPS.md`.

### 2. Set Size before drafting tasks

Size gates required/optional/deleted sections. Pick XS/S/M/L by files touched, logic, contract/schema reach; borderline → **larger tier**. Table + edge cases: `references/size-tiering.md`.

### 3. Map current state before designing (brownfield)

Trigger: run's **`field`** (`references/size-tiering.md > Greenfield vs brownfield`), not Type/Size — brownfield maps, greenfield skips (+ chore/docs off live paths, spike). **Boundary-depth only**: blast radius, invariants, insertion points via LSP, cited `path#anchor` — defer internals to `## To explore at implement` (never a blast-radius invariant); digest invariants into `tasks.md > ## Guardrails`. Scaled to size: full (M/L, refactor/fix) vs 1–3 line note (brownfield `feat` XS/S). Full: `references/current-state.md`.

### 4. Architecture diagram, always

Mark new pieces `★`. **Code-bearing (`feat`/`fix`/`refactor`) MUST carry a `sequenceDiagram`**, optionally + a structural `flowchart`/`classDiagram`; `chore`/`docs` = one line; `spike` = `flowchart` with `?` on unanswered nodes. XS keeps the slot; Current state present → diagram is *to-be*. Templates: `references/diagrams.md`.

### 5. Strict task format

`T### [P?] [AC#] [ref: path#anchor]? action — path#anchor (new|edit|delete) — verify: <command or observable>`

All four parts, no exceptions — **T### + [P?]** · **[AC#]** (no tag = scope-creep) · **action** (one imperative verb) · **path#anchor** (re-resolvable, never a bare line number) · **verify** (command or observable — *single highest-leverage rule in this skill*). `tasks.md` opens `> **For humans**` + `## Guardrails` (brownfield); `[ref:]` points beyond it. Anchor rules: `references/task-format.md`.

### 6. One task → one verify; else split

Multiple verifies = multiple things → split. Tasks are atomic (1-to-1 to commits); `engineer` runs the verify. Per-AC test strategy: `test-plan.md` (`qa`'s contract), not here.

### 7. Type-specific rules

Detail: `references/task-format.md > Type-specific task-1 rules`.

- **`feat`** — standard plan.
- **`fix`** — task 1: failing regression test against `spec.md > Reproduction`; fix root cause, not symptom.
- **`refactor`** — one-line behaviour-equivalence in `Summary`; uncovered behaviour → task 1 = characterization baseline.
- **`chore`** — minimal plan; skip Risks at XS.
- **`docs`** — one task per doc file; no test planning.
- **`spike`** — `Out of scope`: "no production code lands — `recommendations.md` only".

### 8. Self-review before status = draft

Walk before `draft` — scans + examples: `references/self-review.md`; any failure → fix first:

- **Anti-placeholder** (Scan 1) — `tasks.md` placeholder-free.
- **AC sufficiency** (Scan 2) — tags are the floor: deliver each scenario, ≥ 1 `verify:` proves it, boundary/error + `measured:` covered.
- **Section integrity** (Scans 3–4) — diagram ↔ tasks; Current-state cites `path#anchor`; Alternatives cite evidence.
- **Verify-per-task** (Scan 5) — command or observable, every task.
- **Summary readable** (Scan 6) — Summary/Technical Context/Gate check present.
- **Trigger discipline** — every section's trigger fires; DELETE empty sections.
- **Guardrails** *(brownfield)* — no invariant only in Current state/To-explore (miss = `BLOCKER:`); **each line says no more than its citation** (a quote's scope is not a licence to generalise), and **none makes an `AC#` unachievable** — a guardrail that blocks an acceptance criterion is a contradiction to raise (`BLOCKER:`), not to obey. A wrong guardrail costs more than a missing one, because it is the engineer's only up-front invariant read and it gets followed.
- **Budget** — within `plan-sections.md` Budgets; never drop `[AC#]`/`path#anchor`/`verify:`/mermaid.
- **Scaffold integrity** *(M/L)* — Scaffold ↔ tasks (`self-review.md`).
- **Parallel-phase integrity** *(feat)* — fanout contract holds (`references/parallel-phases.md`).

### 9. Lead plan.md with Summary + Technical Context + Gate check

- **`## Summary`** — 2–3 sentences: approach + why over the alternative (one slice per User Story).
- **`## Technical Context`** — language/framework, storage, testing, platform, perf goal (`SC-###`), scale.
- **`## Gate check`** — `rules/fundamentals.md` layers crossed, one line each — a violation needs justification or a plan change.

Always rendered every Size/Type (one line OK at XS); Summary = 30-second prose, Current state (when present) = cited detail, not duplicate.

### 10. Scaffold the skeleton before a long build (M/L)

`## Scaffold`: one fenced block — target file tree (★ new · ~ edited) with each file's key exported signature(s); decision-bearing type shapes ([[programming-fundamentals]]) as definitions, skeleton only. **Required** M/L · optional mini for S touching existing code · skip XS. Subsumes `## Folder structure`. Worked example: `references/plan-sections.md > Scaffold — worked example`.

## Draft order

Work the 10 principles top-down; composes, doesn't replace — load each construction-fundamentals layer via `.claude/rules/fundamentals.md` first (trust boundary → [[security-fundamentals]] before drafting; `fix` plans run [[debug-fundamentals]]), its output becoming `Summary` + `tasks.md`'s substance. Draft **plan.md** in `references/plan-sections.md` placement order (required sections first), then **tasks.md**: `## Guardrails` (brownfield invariants; greenfield `none`) → phased `T###` tasks → AC→task coverage list. [[git-workflow]] pairs at ship (atomic tasks → commits). Skip triggers: frontmatter.

## Section gating by Size

Which `plan.md`/`tasks.md` section is required/optional/skipped per XS/S/M/L. `skip` = **DELETE the section** — no empty headers, no "N/A" lines. Table: `references/size-tiering.md > Section gating by Size`.

### Phases for L plans

Past ~12 tasks, group `tasks.md` under named phases (`### Phase 1: schema migration`) of ordered `T###` tasks; `engineer` creates one `TaskCreate` per phase + nested task per `T###`. Grouping, not gates — `/dev` gates at spec-approval.

#### Parallelizable phases (feat-only — the implement-fanout contract)

A `feat` plan MAY mark **≥ 2** phases parallelizable — one engineer per phase, concurrently, each declaring `**Parallelizable:** yes`, exclusive pairwise-disjoint `**Files touched**`, `**Depends on:** none`; ending in a sequential **integration phase** owning shared glue + every verify (parallel phase-engineers are write-only). Contract: `references/parallel-phases.md`.

## Anti-patterns

- **Hour/day estimates** — planning fallacy, 2–4× wrong; `Size` only.
- **"Considerations"/"Notes" buckets** — route insight into an action-driving section.
- **Hypothetical future requirements** — spec didn't ask → `FOLLOWUPS.md`.
- **Unpinned/assumed dependencies** — pin an exact version, verify it resolves (`self-review.md > Extra checks`).
- **Unnamed new port/boundary** — name interface + signatures in `## API / event contracts` before the tasks that fill them (`plan-sections.md`).
- **Empty triggered sections** — DELETE, not `N/A`; no filler Observability line, no `Alternatives` without a Verified line, no `[AC#]: all` tag.

## References

| File | Read when |
|---|---|
| `references/size-tiering.md` | Picking XS/S/M/L, borderline calls, `field` def, section-gating table, time budgets |
| `references/diagrams.md` | Diagram template per Type; L-plan two-diagram pattern |
| `references/current-state.md` | LSP-walk, invariant criteria, worked examples per Type |
| `references/task-format.md` | Anchor rules per part + type-specific task-1 rules |
| `references/parallel-phases.md` | Fanout contract + worked phase example |
| `references/self-review.md` | Six scans, anti-placeholder list, extra M/L checks |
| `references/plan-sections.md` | Trigger + placement + Reader + Budget per section; Scaffold worked example |
