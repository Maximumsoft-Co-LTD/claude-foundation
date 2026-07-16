# Approach options & the design gate

Deep reference for SKILL.md principle 4 (propose approaches) and principle 5 (hard-gate). Consult when framing approach options, recording the decision trail, or confirming exactly what the gate blocks.

## Propose 2–3 approaches with a recommendation when "how" is open (principle 4)

If the intent pins *what* but leaves *how* open ("add auth", "store these events", "ship a dashboard"), do not jump to one approach. Surface 2–3 with trade-offs and **lead with your recommended option** and the one-line reason it wins.

Format:
> **Option A (recommended):** <approach> — <why it wins for this context>
> **Option B:** <alternative> — <trade-off>
> **Option C:** <alternative> — <trade-off>
> *Recommendation:* A, because <one sentence>.

If a relevant construction-fundamentals skill applies, load it BEFORE drafting the options (the layers and their run order live in `.claude/rules/fundamentals.md`) — they decide *what* to build; this skill decides *how to surface the choice*.

### Anti-patterns

- **Silently picking one and asking "does this work?"** — that's leading the witness, not exploring. Show ≥ 2 options with a lead.
- **Five-option menus** — punts the choice back to the user. Three with a clear recommendation is the format.

## Record the decision trail — don't let it evaporate once the user picks

Capture the chosen option + the rejected alternatives + the one-line why; that's the ADR the plan already carries in `Summary` / `Alternatives considered` / `Hard-to-reverse decisions` (no new artifact — feed those sections). Likewise, any domain term that surfaced and needed defining goes to the spec `Glossary` ([[ddd-strategic]] principle 3) so spec/plan/code use it verbatim. This is the grill-with-docs discipline: the grilling produces the docs as a by-product, it doesn't bolt them on after.

## HARD-GATE: no code, no `Status: approved`, no `plan.md` until the design is acknowledged (principle 5)

Until the user has seen the design (Outcome + Scope + AC + chosen approach) and said yes, you do not:
- write production code
- spawn `engineer` (or any implement-mode agent)
- spawn `lead` in plan mode
- flip `spec.md` from `Status: draft` to `Status: approved`

"This is too simple to need a design" is the failure mode this gate exists to catch. Even a one-file utility goes through the gate; the design can be three sentences, but it gets presented and approved.

In `/dev`, the formal gate is Phase 1 step 8 (orchestrator runs it with the user).

### Anti-patterns

- **"This is too simple to need a design"** — the simplest projects are where unexamined assumptions hide. A three-sentence design with the user's yes is the minimum; that minimum applies always.
- **Brainstorming with code in flight** — if you've already started writing the code, the brainstorm isn't a brainstorm anymore, it's a rationalization. Stop, present the design, get the yes, then continue.
