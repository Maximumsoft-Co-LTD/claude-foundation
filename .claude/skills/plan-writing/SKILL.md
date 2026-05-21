---
name: plan-writing
description: Write an implementation plan that maps a spec to executable steps, sized for the work, with an architecture diagram. Use this skill when drafting `.workflow/<id>/plan.md` in the /dev workflow (lead agent, Phase 1 step 2), OR when the user asks to "write a plan", "plan this feature", "design the implementation", "break this down into steps", "draft an RFC". Owns the size tiering (XS/S/M/L), the always-required architecture diagram (mermaid by Type), inline AC tagging, anti-placeholder rules, and the pre-draft self-review. Composes with the construction-fundamentals skills (programming/database/hexagonal/architecture/queue) — load the relevant construction skill first to decide *what* to build; this skill decides *how to sequence and document* what you build. Skip for throwaway scripts, conversational "what should we do about X" exchanges that haven't been spec'd yet.
---

# Plan Writing

## Why this exists

Plans fail in predictable ways: they re-state the spec instead of decomposing it, they hide approach-decisions in prose, they let "TBD" and "appropriate error handling" leak through, they describe a feature without showing where it plugs into the system, and they ship without acceptance-criteria traceability — so the first time AC1 gets verified is during review, by which point the cycle budget is already half-spent.

A plan that scales with the work, carries a diagram, and ties every step to an AC catches those failures at *plan time* — minutes spent here save hours in review/test cycles (DORA: shift-left validation cuts rework ~40%). This skill is the pre-flight for the `/dev` workflow's Phase 1 step 2 (lead agent, plan mode), and the standard whenever a plan is being drafted.

## The 7 principles

### 1. Read spec.md + carried follow-ups before anything else
Plan that doesn't map back to spec = blind. Open `spec.md`, list the acceptance criteria, check `Carried-over follow-ups`. Every plan step must tie to either an acceptance criterion or a carried follow-up — if it ties to neither, it's scope-creep.

### 2. Set Size before drafting Steps
Size determines which sections are required. Choose XS / S / M / L using the signals in `references/size-tiering.md`. Wrong size = either bloat (XS work in M template) or under-coverage (M work treated as S). When borderline, prefer the larger tier — under-covering is more expensive than over-covering.

| Size | Trigger signals |
|------|-----------------|
| **XS** | chore / docs, 1 file, no logic change (e.g., bump dep, fix typo) |
| **S** | 1 subsystem, ≤ 2 files, simple logic |
| **M** | multi-file in one subsystem, real logic, no contract / schema change |
| **L** | cross-subsystem, schema migration, public API contract change, breaking change |

### 3. Architecture diagram is required, always
Pick the cheapest form that conveys the change. Mark new pieces with `★`. Diagram type defaults from `Type` (full templates in `references/diagrams.md`):

| Type | Default diagram |
|------|-----------------|
| `feat` | `flowchart LR` showing where the new piece plugs in |
| `fix` | `sequenceDiagram` of bug path + fix point, OR before/after flowchart |
| `refactor` | before/after `flowchart` or `classDiagram` of the structural shift |
| `chore` / `docs` | one line: `<file> (<change>)` OR `**Impact:** N/A — <reason>` |
| `spike` | `flowchart` with `?` on unanswered nodes |

For XS, even one line counts — keep the section, never delete it.

### 4. Steps use the strict format: action — path:line — verify — [AC#]
Every step has all four parts. No exceptions.

- **action**: imperative, one verb (`add`, `extract`, `wire`, `delete`, `rename`). Not "implement X" — that's a goal, not a step.
- **path:line**: concrete location. Use `path:new` for new files. Existing code requires LSP-verified line numbers, not guesses.
- **verify**: a command (`npm test src/foo.test.ts`) or an observable (`/health returns 200`, `column exists in schema`). If you can't say how the step is verified, the step is too big — split it.
- **[AC#]**: which acceptance criterion this step lands. A step with no AC tag is either scope-creep or a missing AC in the spec.

### 5. One step → one verify; if not, split
A step that needs multiple verifications is doing multiple things. Split it. Steps map 1-to-1 to commits in spirit (atomic). The verify command/observable is also what `qa` will hand to its test suite — write it as if QA will literally run it.

### 6. Alternatives considered (M/L feat/refactor only, when non-obvious)
1–2 bullets: `<approach X> — rejected: <reason>`. The point isn't documentation — it's the *forcing function* that makes the author think before committing. If the approach is obviously the only reasonable one, skip the section.

### 7. Self-review before status = draft
Before handing off to the orchestrator/engineer, walk `references/self-review.md`:

- Anti-placeholder scan: no "TBD", no "appropriate error handling", no "see spec", no "etc.", no `path/to/file`.
- AC coverage: every `spec.md > Acceptance criteria` checkbox appears in at least one `[AC#]` tag.
- Diagram-vs-files alignment: every new component in the diagram has a row in `Files touched`; every new file has a node in the diagram.
- Verify-per-step completeness: every step has a `verify:` clause that names a command or an observable, not "manually check".

If any check fails, fix the plan — don't mark `status: draft`.

## Pre-flight checklist (run top-to-bottom)

Before writing any section of plan.md:

- [ ] Read `spec.md` and `Carried-over follow-ups`.
- [ ] Decide `Type` matches what spec says.
- [ ] Pick `Size` from the signal table (or `references/size-tiering.md` for edge cases).
- [ ] Load relevant construction skill(s):
  - Backend code with domain logic → [[hexagonal-backend]]
  - Schema, query, migration, index → [[database-fundamentals]]
  - System-level / cross-service decisions → [[architecture-fundamentals]]
  - Queue / broker / async worker → [[queue-fundamentals]]
  - Any non-trivial code → [[programming-fundamentals]]
  - Bug with unknown cause → [[debug-fundamentals]] before *this* skill
- [ ] Decide diagram type from `Type` (table in principle 3).
- [ ] Use LSP for existing-code references (definitions, references, diagnostics) before citing `path:line`.

Then draft in order: Approach → Diagram → Steps → Files touched → (size-gated sections) → Rollback → Out of scope.

## Section gating by Size

| Section | XS | S | M | L |
|---------|----|----|----|----|
| Approach (2–3 sent) | ✓ | ✓ | ✓ | ✓ |
| Step order line | skip | optional | ✓ | ✓ |
| Architecture diagram | one-line / N/A | mini mermaid | full | full + before/after |
| Steps (with verify + AC tag) | ✓ (verify optional) | ✓ | ✓ | ✓ |
| Files touched | ✓ | ✓ | ✓ | ✓ |
| Alternatives considered | skip | skip | when non-obvious | ✓ |
| Risks | skip | optional | ✓ | ✓ |
| Observability | N/A | required if feat/fix | required if feat/fix | ✓ |
| Dependencies | skip unless present | skip unless present | skip unless present | ✓ |
| Rollback | "revert commit" line | "revert commit" or specific | ✓ if destructive | ✓ |
| Out of scope | ✓ | ✓ | ✓ | ✓ |

Sections marked `skip` should be deleted, not left empty. Empty sections are noise that erodes the size-gating discipline.

## Relation to other skills

This skill **composes**, it does not replace:

- [[programming-fundamentals]] / [[database-fundamentals]] / [[hexagonal-backend]] / [[architecture-fundamentals]] / [[queue-fundamentals]] — these decide *what to build*. Load the relevant one **first**; their output becomes the substance of `Approach` and `Steps`.
- [[debug-fundamentals]] — for `fix` plans, run debug-fundamentals first to find the cause, then this skill to encode the fix + regression test.
- [[git-workflow]] — pairs at ship time (Phase 2 step 9). A plan's atomic Steps become atomic commits; the Type slot mirrors the commit `<type>`.
- `lead` agent (plan mode) is the *caller* — it invokes this skill before drafting `plan.md`.

## When to skip

Skip this skill only when:

- The user is having a conversational "what should we do about X?" exchange that hasn't been spec'd yet — that's brainstorming, not planning.
- The work is a throwaway one-off script or a single-line config edit with no logic.
- You are not actually about to write a plan file — e.g., reviewing an existing plan, in which case use the review templates instead.

If any non-trivial code is about to land in the repo, do not skip.

## Anti-patterns (do not do these)

- **Restating the spec in `Approach`** — link to spec instead. Plan drifts; spec is source of truth.
- **Pseudocode in Steps** — if the code is ready to write, write it during implementation, not in the plan. Pseudocode rots and never runs.
- **Hour/day estimates** — planning fallacy makes these wrong by 2–4×. Use `Size` (XS/S/M/L) only.
- **"Considerations" / "Notes" bucket sections** — every insight belongs in a section that drives action (Steps, Risks, Alternatives, Out of scope). Unbounded buckets become dump grounds.
- **Diagram deletion for small work** — even XS keeps the section, even if the content is a one-liner. Habit beats exception.
- **Verify = "manually check"** — that's not a verify. Name a command or a concrete observable, or split the step.
- **AC tag = "all"** — every step tags specific AC numbers; "all" hides which step actually lands which behaviour.

## References

- `references/size-tiering.md` — full XS/S/M/L picker, edge cases, signals from file count + type
- `references/diagrams.md` — mermaid templates per Type with worked examples
- `references/self-review.md` — pre-draft checklist + anti-placeholder regex patterns
