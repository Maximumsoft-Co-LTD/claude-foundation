---
name: brainstorming
description: Turn a rough idea into an approved design before any code lands — explore context, decompose oversized scope, ask only about UNSPECIFIED requirements, propose 2–3 approaches with a recommendation, and self-review the spec. Use in the `/dev` Phase 1 interview when scope is ambiguous, choices are open-ended, or the request is oversized; also when the user asks to "brainstorm X", "scope this idea", "design a feature", or wants a design conversation before implementation. Skip throwaway scripts, narrow concrete changes, and already-approved specs.
---

# Brainstorming

## Why this exists

Pre-spec discipline for the `/dev` Phase 1 step 6 interview (before `pm` writes `spec.md`), and any time a design conversation is needed before code lands. Promise: explore context first, name the unknowns, ask only what the intent didn't pin, propose 2–3 approaches with a recommendation, and self-review before `approved`.

## The 7 principles

### 1. Explore project context BEFORE asking anything

Read `CLAUDE.md`, `.workflow/INDEX.md`, recent commits, and any file the intent names before question 1. Log repo-inferred answers (stack, integration point, convention) as **assumptions**, not facts — surface them at the gate as `Assumptions (inferred — correct me if wrong)`. Full: `references/interview-tactics.md > Explore context before asking anything`.

### 2. Decompose oversized scope BEFORE refining details

Test: does the intent reduce to one approved spec that produces one ship-able thing? If it spans multiple independent subsystems, name the pieces, ask the user which to scope first, and carry the rest to `FOLLOWUPS.md` — this is also what triggers the `epic.md` path. Full: `references/interview-tactics.md > Decompose oversized scope before refining details`.

### 3. Ask only about UNSPECIFIED slots — never re-ask what the intent already pinned

Authoritative slot list + triggers: `.claude/agents/pm.md > Spec sections`. Minimum floor (always asked/pulled): `Type`, `Goal`, `User Stories` (w/ Given/When/Then AC), `Functional Requirements`, `Success Criteria`, `Ship as`, `Open PR`. Everything else is triggered (`Problem`, `Users`, `User journey`, `Scope — Out`, `NFR`, `DoD`, `Constraints`, `References`, `Reproduction`, `Timebox`, `Discovery notes`, `Carry-over`) — ask only when the trigger fires, never "just in case". Frame to **detect, not fill** ("is there a target?" not "what's the target?"); the NFR-detection question is **mandatory** for any feat/fix shipping runtime code, and a real number becomes an AC (`measured:` clause), never a standalone section. Batch 3–4 questions, ordered by the design tree (resolve the upstream decision first), lead every choice with a recommended option; reserve free-text for genuinely open answers. **Dig loop:** up to 3 batches total when ambiguity is high, each narrower than the last, converging on load-bearing decisions — stop and surface `[NEEDS CLARIFICATION]` if the picture is still open after 3. Ground each consequential AC in a concrete `e.g.: input → expected output` (never invent the values). Capture the unhappy path too — an `on error / at boundary:` line per consequential behavioural AC; `none — <default>` is a valid recorded answer, silence is not. Frame behavioural questions past-tense/specific, not hypothetical (Mom Test). Full tactics + worked examples: `references/interview-tactics.md`.

### 4. Propose 2–3 approaches with a recommendation when "how" is open

Lead with the recommended option + one-line why; show trade-offs for the rest — never a silent single pick, never a five-option menu. Load the relevant construction-fundamentals skill first (run order: `.claude/rules/fundamentals.md`) — it decides *what* to build, this decides *how to surface the choice*. Record the decision trail (chosen + rejected + why) into the plan's `Alternatives considered`/`Hard-to-reverse decisions`; new domain terms go to the spec `Glossary`. Full format + anti-patterns: `references/approach-and-gate.md`.

### 5. HARD-GATE: no code, no `Status: approved`, no `plan.md` until the design is acknowledged

Until the user has seen the design (Outcome + Scope + AC + chosen approach) and said yes: no production code, no spawning `engineer` or `lead` plan mode, no flipping `spec.md` to `approved`. Applies even to a one-file utility — "too simple to need a design" is exactly the failure mode this gate exists to catch. In `/dev`, the formal gate is Phase 1 step 8. Full: `references/approach-and-gate.md`.

### 6. Visual companion is optional, opt-in, and lives in its own message

Offer only when upcoming questions are genuinely visual (UI mockups, layout comparisons, diagrams the user needs to *see*); the offer is its own message, no clarifying question attached. Decide per-question, after acceptance, whether the answer is better seen or read. If declined, proceed text-only. Full rules: `references/visual-companion.md`.

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

- [[plan-writing]] — the next planning aid when complexity warrants it. Once `Status: approved`, planning decides *how to sequence and verify* the work. Brainstorming hands the spec to the plan phase; never bypasses planning.
- The construction-fundamentals skills (run order in `.claude/rules/fundamentals.md`) — load whichever layer the work touches BEFORE drafting approach options in principle 4. They decide *what* to build; this skill decides *how to surface the choice and get to a yes*.
- [[debug-fundamentals]] — for `Type=fix` runs, debug-fundamentals runs *before* this skill: find the actual cause first, then brainstorm the fix (including the regression test the fix step will encode).
- [[git-workflow]] — pairs later at ship time, not here. Brainstorming produces a spec; plan-writing produces a plan; git-workflow lands the commit.

The `/dev` orchestrator (`.claude/orchestrator.md`) is the **caller** in Phase 1: loads this skill at step 6 (interview) and step 7 (spawn `pm`). `pm` receives the Q&A and writes `spec.md` — it does *not* re-run the interview.

## References

Pick the file that matches the friction:

| File | Read when |
|---|---|
| `references/interview-tactics.md` | Exploring context, decomposing scope, picking which 3–4 slots to ask, framing multi-choice options, `revise` follow-ups, `Type=fix` reproduction, the Mom Test, detect-vs-fill framing, unhappy-path capture |
| `references/approach-and-gate.md` | Framing 2–3 approach options, recording the decision trail, or confirming exactly what the hard-gate blocks |
| `references/self-review-scans.md` | Running the pre-`approved` self-review in full detail |
| `references/visual-companion.md` | The user asked about a visual/mockup, or deciding browser vs terminal per question |
| `references/pre-flight-and-example.md` | Starting a fresh interview (checklist + process flow) or wanting one worked example end-to-end |
