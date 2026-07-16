---
name: brainstorming
description: Turn a rough idea into an approved design before any code lands — explore context, decompose oversized scope, ask only about UNSPECIFIED requirements, propose 2–3 approaches with a recommendation, and self-review the spec. Use in the `/dev` Phase 1 interview when scope is ambiguous, choices are open-ended, or the request is oversized; also when the user asks to "brainstorm X", "scope this idea", "design a feature", or wants a design conversation before implementation. Skip throwaway scripts, narrow concrete changes, and already-approved specs.
---

# Brainstorming

## Why this exists

Pre-spec discipline for the `/dev` Phase 1 Interview (before `pm`/`lead` writes `spec.md`), and any time a design conversation is needed before code lands. Promise: explore context first, name the unknowns, ask only what the intent didn't pin, propose 2–3 approaches with a recommendation, and self-review before `approved`.

## The 7 principles

### 1. Explore project context BEFORE asking anything

Read `CLAUDE.md`, `.workflow/INDEX.md`, recent commits, and any file the intent names before question 1. Log repo-inferred answers (stack, integration point, convention) as **assumptions**, not facts — surface them at the gate as `Assumptions (inferred — correct me if wrong)`. Full: `references/interview-tactics.md > Explore context before asking anything`.

### 2. Decompose oversized scope BEFORE refining details

Test: does the intent reduce to one approved spec that produces one ship-able thing? If it spans multiple independent subsystems, name the pieces, ask the user which to scope first, and carry the rest to `FOLLOWUPS.md` — this is also what triggers the `epic.md` path. Full: `references/interview-tactics.md > Decompose oversized scope before refining details`.

### 3. Ask only about UNSPECIFIED slots — never re-ask what the intent already pinned

Slot list + triggers: `.claude/agents/pm.md > Spec sections` — minimum floor always asked/pulled, everything else triggered (ask only when the trigger fires, never "just in case"). Frame to **detect, not fill** ("is there a target?" not "what's the target?"); NFR-detection is **mandatory** for any feat/fix shipping runtime code, and a real number becomes an AC (`measured:` clause), never a standalone section. Batch 3–4 questions ordered by the design tree, lead every choice with a recommendation. **Dig loop:** up to 3 batches, each narrower, converging on load-bearing decisions — else surface `[NEEDS CLARIFICATION]`. Ground each consequential AC in a concrete `e.g.: input → expected output` (never invent values), and capture the unhappy path (`on error / at boundary:`; `none — <default>` valid, silence isn't). Frame behavioural questions past-tense/specific, not hypothetical (Mom Test). Full tactics, slot list, and worked examples: `references/interview-tactics.md`.

### 4. Propose 2–3 approaches with a recommendation when "how" is open

Lead with a recommended option + one-line why, show trade-offs for the rest — never a silent pick, never a five-option menu; load the relevant construction-fundamentals skill first (`.claude/rules/fundamentals.md`) — it decides *what* to build, this decides *how to surface the choice*. Record the decision trail (chosen + rejected + why) into the plan; new domain terms go to the spec `Glossary`. Full format + anti-patterns: `references/approach-and-gate.md`.

### 5. HARD-GATE: no code, no `Status: approved`, no `plan.md` until the design is acknowledged

Until the user has seen the design (Outcome + Scope + AC + chosen approach) and said yes: no production code, no spawning `engineer`/`lead` plan mode, no flipping `spec.md` to `approved` — applies even to a one-file utility ("too simple" is the failure mode this gate catches). In `/dev`, the formal gate is Phase 1's Gate. Full: `references/approach-and-gate.md`.

### 6. Visual companion is optional, opt-in, and lives in its own message

Offer only when upcoming questions are genuinely visual (mockups, layout comparisons, diagrams); the offer is its own message, never bundled with a clarifying question. Decide per-question, after acceptance, seen vs read; if declined, proceed text-only. Full rules: `references/visual-companion.md`.

### 7. Spec self-review before `Status: approved` (5 scans)

After the spec is written, walk it once with fresh eyes, fix inline: placeholder/ambiguity scan, content-discipline scan, contradiction scan, scope check, and a verifiability + example + boundary + pre-mortem scan (name the top 3 ways the design could fail). Never mark `approved` while any `[NEEDS CLARIFICATION]` marker remains. Full scan detail: `references/self-review-scans.md`.

## When to skip

Skip this skill only when:

- The spec is already approved and you're entering Phase 2 (implementation / review / test / ship).
- The work is a throwaway one-off script, a single-line config edit, a comment cleanup, or anything you could describe in one sentence and ship in one commit with no design risk.
- The user explicitly says "no design conversation, just do it" *and* the request is small enough that the risk of misreading is genuinely low. (If you're not sure, the answer is "don't skip.")

If the request says "build", "design", "add feature", "scope", "explore", "brainstorm", or "what should we do about X" — do not skip.

## Anti-patterns

- Assuming defaults for slots you didn't ask about, or inventing NFR numbers — the interview missed the slot; don't invent.
- Including triggered sections "just in case" (`Users: end users`, `Constraints: None`) — DELETE instead.
- Picking one approach silently, or offering five options of equal weight — lead with a recommendation among 2–3.
- Combining the Visual Companion offer with a clarifying question — it is always its own message.
- Flipping `Status: approved` while any `[NEEDS CLARIFICATION]` marker remains.

Full list + more: `references/interview-tactics.md > Anti-patterns`, `references/approach-and-gate.md`, `references/visual-companion.md > Anti-patterns`, `references/self-review-scans.md > Anti-pattern`.

## Relation to other skills

Brainstorming is the **pre-spec** skill — it composes, it does not replace:

- [[plan-writing]] — next planning aid once `Status: approved`; decides *how to sequence and verify*. Brainstorming hands off the spec; never bypasses planning.
- Construction-fundamentals skills (run order: `.claude/rules/fundamentals.md`) — load whichever layer applies BEFORE drafting approach options (principle 4). They decide *what* to build; this skill decides *how to surface the choice and get to a yes*.
- [[debug-fundamentals]] — for `Type=fix`, runs *before* this skill: find the cause first, then brainstorm the fix (incl. the regression test).
- [[git-workflow]] — pairs later at ship time: brainstorming produces a spec, plan-writing a plan, git-workflow the commit.

The `/dev` orchestrator (`.claude/orchestrator.md`) is the **caller**: loads this skill at Interview (op 2) and Design (op 3 — `pm`/combined-`lead` spawn). `pm` receives the Q&A and writes `spec.md` — it does *not* re-run the interview.

## References

Pick the matching file:

| File | Read when |
|---|---|
| `references/interview-tactics.md` | Exploring context, decomposing scope, picking which 3–4 slots to ask, framing multi-choice options, `revise` follow-ups, `Type=fix` reproduction, the Mom Test, detect-vs-fill framing, unhappy-path capture |
| `references/approach-and-gate.md` | Framing 2–3 approach options, recording the decision trail, or confirming exactly what the hard-gate blocks |
| `references/self-review-scans.md` | Running the pre-`approved` self-review in full detail |
| `references/visual-companion.md` | The user asked about a visual/mockup, or deciding browser vs terminal per question |
| `references/pre-flight-and-example.md` | Starting a fresh interview (checklist + process flow) or wanting one worked example end-to-end |
