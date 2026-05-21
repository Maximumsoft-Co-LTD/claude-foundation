---
name: plan-writing
description: Write an implementation plan that maps a spec to executable, verifiable steps with a required architecture diagram, sized for the work. Use this skill when drafting `.workflow/<id>/plan.md` in the /dev workflow (lead agent, Phase 1 step 2), OR when the user asks to "write a plan", "plan this feature", "design the implementation", "break this down into steps", "draft an RFC". Owns the size tiering (XS/S/M/L), the always-required architecture diagram (mermaid by Type), inline AC tagging, runnable-verify rule, anti-placeholder rules, and the pre-draft self-review. Composes with the construction-fundamentals skills (programming/database/hexagonal/architecture/queue) — load the relevant construction skill first to decide *what* to build; this skill decides *how to sequence, document, and verify* what you build. Skip for throwaway scripts, single-line config edits, and conversational "what should we do about X" exchanges that haven't been spec'd yet.
---

# Plan Writing

## Why this exists

Plans fail in predictable ways: they restate the spec instead of decomposing it, they hide approach-decisions in prose, they let "TBD" and "appropriate error handling" leak through, they describe a feature without showing where it plugs into the system, they say "manually verify" when they should name a command, and they ship without acceptance-criteria traceability — so the first time AC1 actually gets verified is during review, by which point the cycle budget is already half-spent.

A plan that scales with the work, carries a diagram, ties every step to an AC, and gives every step a *runnable verify* catches those failures at plan time — minutes spent here save hours in review and test cycles. This skill is the pre-flight for the `/dev` workflow's Phase 1 step 2 (lead agent, plan mode), and the standard whenever a plan is being drafted in this repo.

## The 7 principles

### 1. Read spec.md + carried follow-ups before anything else

A plan that doesn't map back to spec is blind. Open `spec.md`, list every `Acceptance criteria` checkbox, check `Carried-over follow-ups`. Every plan step must tie to either an acceptance criterion or a carried follow-up — if it ties to neither, it's scope-creep and belongs in `FOLLOWUPS.md`, not this plan.

### 2. Set Size before drafting Steps

Size determines which sections are required, which are optional, and which should be deleted. Choose XS / S / M / L using the picker in `references/size-tiering.md`. Wrong size = either bloat (XS work in M template) or under-coverage (M work treated as S). **When borderline, prefer the larger tier** — under-covering costs cycle burn at review; over-covering costs a few skipped sections.

| Size | Trigger signals |
|------|-----------------|
| **XS** | chore / docs, 1 file, no logic change (typo, dep bump, comment cleanup). If you can describe the diff in one sentence, it's XS. |
| **S** | 1 subsystem, ≤ 2 files, simple logic |
| **M** | multi-file in one subsystem, real logic (branching, state, side effects), no contract / schema change |
| **L** | cross-subsystem, schema migration, public API contract change, or any breaking change |

### 3. Architecture diagram is required, always

Pick the cheapest form that conveys the change. Mark new pieces with `★`. Diagram type defaults from the run's `Type` (full templates and worked examples in `references/diagrams.md`):

| Type | Default diagram |
|------|-----------------|
| `feat` | `flowchart LR` showing where the new piece plugs in |
| `fix` | `sequenceDiagram` of the bug path with the fix point marked, OR before/after flowchart |
| `refactor` | before/after `flowchart` or `classDiagram` of the structural shift |
| `chore` / `docs` | one line: `<file> (<change>)` OR `**Impact:** N/A — <reason>` |
| `spike` | `flowchart` with `?` on unanswered nodes |

For XS, even one line counts — keep the section, never delete it. The discipline is "always have a diagram slot."

### 4. Steps use the strict format: `action — path:line (new|edit|delete) — verify: <command or observable> [AC#]`

Every step has all four parts. No exceptions.

- **action** — imperative, one verb (`add`, `extract`, `wire`, `delete`, `rename`). Not "implement X" — that's a goal, not a step.
- **path:line** — concrete location. Use `path:new` for new files. Existing-code references require LSP-verified line numbers, not guesses. When the change mimics an existing pattern in the codebase, cite the precedent inline (e.g., `mirror src/handlers/orders.ts:42-78`) — it gives the engineer a working reference.
- **verify** — a command (`npm test src/foo.test.ts`, `curl -s :8080/health | jq .status`, `psql -c "\d users"`) or a concrete observable (`column email_verified exists`, `feature flag returns true for opt-in users`). If you would write `manually check` or `visually inspect`, the step is too big — split it until each piece is verifiable atomically. *This is the single highest-leverage rule in this skill.*
- **[AC#]** — which acceptance criterion this step lands. A step with no AC tag is either scope-creep or evidence that the spec is missing an AC the work actually delivers — go fix the spec first.

### 5. One step → one verify; if not, split

A step that needs multiple verifications is doing multiple things. Split it. Steps map 1-to-1 to commits in spirit (atomic). The verify clause is also what `qa` will hand to its test suite, and what `engineer` will run after the step — write it as if both will literally execute it.

### 6. Type-specific rules

- **`feat`** — standard plan. Diagram = flowchart, mark `★`.
- **`fix`** — step 1 of `Steps` MUST be "write failing regression test for <bug>" encoded against `spec.md > Reproduction`. *Address the root cause, not the symptom* — if your fix step is "catch the exception" or "guard the null", ask whether the cause is upstream and document why the local fix is correct.
- **`refactor`** — one-line behaviour-equivalence statement in `Approach`: what stays identical and how it gets verified (existing suite, character test, golden file). Lean on existing tests first.
- **`chore`** — minimal plan. Skip Risks for XS.
- **`docs`** — Steps are doc edits. Files touched lists every doc file. No test planning.
- **`spike`** — `Out of scope` MUST say "no production code lands from this run — engineer writes `recommendations.md` only". Steps may be open-ended ("try option A, measure throughput at 1k req/s").

### 7. Self-review before status = draft

Before handing off, walk `references/self-review.md`:

- **Anti-placeholder scan** — no `TBD`, `TODO`, `???`, `appropriate error handling`, `proper validation`, `as needed`, `see spec`, `etc.`, `path/to/file`, hedging modals (`should`, `would`, `might`) in Steps.
- **AC coverage** — every `spec.md > Acceptance criteria` checkbox appears in at least one `[AC#]` tag; every step has at least one `[AC#]` tag.
- **Diagram ↔ Files alignment** — every `★` in the diagram has a `new` row in `Files touched`; every `new` row appears as `★` in the diagram. Same rule for `~~strikethrough~~` and `delete`.
- **Verify-per-step completeness** — every step's verify is a command or a concrete observable, never "manually check" / "eyeball".

If any scan fails, fix the plan — do not mark `status: draft`.

## Pre-flight checklist (run top-to-bottom)

Before writing any section of plan.md:

- [ ] Read `spec.md` and its `Carried-over follow-ups`.
- [ ] Confirm `Type` matches what the spec says.
- [ ] Pick `Size` from the signal table above (or `references/size-tiering.md` for edge cases). Borderline → larger tier.
- [ ] Load the relevant construction skill(s):
  - Any non-trivial code → [[programming-fundamentals]]
  - Schema / query / migration / index → [[database-fundamentals]]
  - Backend with real domain logic → [[hexagonal-backend]]
  - System-level / cross-service decisions → [[architecture-fundamentals]]
  - Queue / broker / async worker → [[queue-fundamentals]]
  - Bug with unknown cause → [[debug-fundamentals]] *before* this skill
- [ ] Pick diagram type from `Type` (table in principle 3).
- [ ] Use **LSP first** for existing-code references (definitions, references, diagnostics) before citing `path:line`. Grep is the fallback.
- [ ] If the change mimics an existing pattern, find that pattern now and have its `path:line` ready to cite in Steps.

Then draft in order: **Approach → Diagram → Steps → Files touched → (size-gated sections) → Rollback → Out of scope**.

## Section gating by Size

| Section | XS | S | M | L |
|---------|----|----|----|----|
| Approach (2–3 sent) | ✓ | ✓ | ✓ | ✓ |
| Step order line | skip | optional | ✓ | ✓ |
| Architecture diagram | one-line / N/A | mini mermaid (3–5 nodes) | full mermaid by Type | full + before/after |
| Steps (with verify + AC tag) | ✓ (verify optional) | ✓ | ✓ | ✓ |
| (Optional) Phases above Steps | skip | skip | skip | ✓ if >12 steps |
| Files touched | ✓ | ✓ | ✓ | ✓ |
| Alternatives considered | skip | skip | when non-obvious | ✓ |
| Risks | skip | optional | ✓ | ✓ |
| Observability | N/A | required if feat/fix | required if feat/fix | ✓ |
| Dependencies | skip unless present | skip unless present | skip unless present | ✓ |
| Rollback | "revert commit" line | "revert commit" or specific | ✓ if destructive | ✓ runbook |
| Out of scope | ✓ | ✓ | ✓ | ✓ |

Sections marked `skip` should be deleted, not left empty. Empty sections are noise that erodes the size-gating discipline.

### Optional Phases for L plans

When a L plan grows past ~12 steps, group them under named Phases (e.g., `### Phase 1: schema migration`, `### Phase 2: write path`, `### Phase 3: read path`). Each phase has its own ordered Steps with the same strict format. Phases let `engineer` create one `TaskCreate` per phase and one nested task per step, which makes long plans navigable without forcing them to split into separate `/dev` runs. Phases are *grouping*, not gates — the /dev workflow already gates between Phase 1 and Phase 2 at the spec-approval point.

## Relation to other skills

This skill **composes**, it does not replace:

- [[programming-fundamentals]] / [[database-fundamentals]] / [[hexagonal-backend]] / [[architecture-fundamentals]] / [[queue-fundamentals]] — these decide *what to build*. Load the relevant one **first**; their output becomes the substance of `Approach` and `Steps`.
- [[debug-fundamentals]] — for `fix` plans, run debug-fundamentals first to find the cause, then this skill to encode the fix + regression test.
- [[git-workflow]] — pairs at ship time (Phase 2 step 9). A plan's atomic Steps become atomic commits; the Type slot mirrors the commit `<type>`.

The `lead` agent in plan mode is the *caller* — it invokes this skill before drafting `plan.md`. The skill does not call `lead`.

## When to skip

Skip this skill only when:

- The user is having a conversational "what should we do about X?" exchange that hasn't been spec'd yet — that's brainstorming, not planning.
- The work is a throwaway one-off script, a single-line config edit, or anything you could describe in one sentence and ship in one commit with no design risk.
- You are reviewing an existing plan (use the `review.md` template instead) or running QA on a plan that's already implemented.

If any non-trivial code is about to land in the repo and you're about to write `plan.md`, do not skip.

## Anti-patterns (do not do these)

- **Restating the spec in `Approach`** — link to spec instead. Plan drifts; spec is the source of truth.
- **Pseudocode in Steps** — if the code is ready to write, write it during implementation, not in the plan. Pseudocode rots and never runs.
- **Hour / day estimates** — planning fallacy makes these wrong by 2–4×. Use `Size` (XS/S/M/L) only.
- **"Considerations" / "Notes" bucket sections** — every insight belongs in a section that drives action (Steps, Risks, Alternatives, Out of scope). Unbounded buckets become dump grounds.
- **Diagram deletion for small work** — even XS keeps the section, even if the content is one line. Habit beats exception.
- **Verify = "manually check" / "eyeball" / "visually inspect"** — that's not a verify. Name a command or a concrete observable, or split the step. (Anthropic's single-highest-leverage rule for working with AI coding agents is *give the agent a way to verify its work*. This rule is that rule, applied to plans.)
- **AC tag = "all"** — every step tags specific AC numbers. "All" hides which step actually lands which behaviour.
- **Symptom-patching for `fix`** — "wrap in try/catch", "guard against null" without explaining *why* the null arrives is treating the symptom. Show the root cause in `Approach`; let the fix step name it explicitly.
- **Designing for hypothetical future requirements** — if the spec doesn't ask for it, the plan doesn't plan for it. Carry the idea to `FOLLOWUPS.md` instead.

## References

Pick the one that matches the friction:

- `references/size-tiering.md` — XS/S/M/L picker, edge cases (one-file state machine, mechanical sweep across 30 files, type-vs-size collisions), and per-size time budgets.
- `references/diagrams.md` — mermaid templates per Type with worked examples, when to use `flowchart` vs `sequenceDiagram` vs `classDiagram`, and L-plan two-diagram pattern.
- `references/self-review.md` — the four scans in detail with anti-placeholder regex list and extra checks for M/L plans.

If lead is drafting in plan mode and unsure which to consult, use this map: *Size unclear* → size-tiering; *which mermaid kind* → diagrams; *plan reads "done" but feels off* → self-review.
