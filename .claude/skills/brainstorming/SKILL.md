---
name: brainstorming
description: Turn a rough idea into an approved design before any code lands — explore project context, decompose oversized scope, ask only about UNSPECIFIED requirement slots, propose 2–3 approaches with a recommendation, and self-review the spec for placeholders, contradictions, scope creep, ambiguity, and likely failure modes (verifiability + pre-mortem). Use this skill when the `/dev` Phase 1 interview has ambiguous scope, open-ended product/approach choices, oversized requests, UI work needing visual exploration, or several unclear requirement slots; also use it when the user asks to "brainstorm X", "scope this idea", "design a feature", "what should we do about Y", "explore options for", or otherwise wants a design conversation before implementation. Composes with [[plan-writing]] (the next step after spec is approved) and the construction-fundamentals skills (load whichever decides *what* to build). Skip for throwaway scripts, single-line config edits, narrow concrete `/dev` changes, and tasks where the spec is already approved.
---

# Brainstorming

## Why this exists

Most "we have to rewrite this" stories trace back to one missed beat: the team started coding before the design was real. The intent was a sentence, the AC was implied, the tech stack was assumed, the scope hid two independent subsystems, and three "approaches" later nobody could remember why option B got picked. Catching all of that at brainstorming time costs minutes; catching it at review or in prod costs cycles, weekends, and trust.

This skill is the pre-spec discipline. In the `/dev` workflow it sits at Phase 1 step 6 — the orchestrator's interview — and runs *before* spawning `pm` to write `spec.md`. Outside `/dev` it runs any time the user wants to think through an idea before code lands.

The promise is small: explore context first, name the unknowns honestly, ask only what the intent didn't already pin, propose 2–3 ways to do it with a recommendation, and re-read the spec with fresh eyes before letting status flip to `approved`.

## The 7 principles

### 1. Explore project context BEFORE asking anything

The intent is one sentence; the codebase already has answers. Read `CLAUDE.md`, `.workflow/INDEX.md`, the last few commits, and any file the intent names *before* the first question. The interview gets sharper when you already know which file the feature plugs into, what stack is in play, and which conventions already exist.

Skipping this and going straight to "tell me about X" wastes questions on things the repo would have told you. The orchestrator gets one `AskUserQuestion` batch — don't burn it asking the language when `package.json` is sitting right there.

### 2. Decompose oversized scope BEFORE refining details

If the intent describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), surface that immediately. Don't spend the interview refining details of a request that needs to be broken up first.

The test: can this be one approved spec that produces one ship-able thing? If not, name the pieces, ask the user which one to scope first, and carry the rest to `FOLLOWUPS.md` as candidates for separate `/dev` runs. Inside `/dev`, this is also what triggers the `epic.md` path — the gate will split it anyway, so flag it here.

### 3. Ask only about UNSPECIFIED slots — never re-ask what the intent already pinned

The `spec.md` template (`.workflow/_templates/spec.md`) and `pm.md > Required slots` define what every spec needs:

| Slot | Always required | Conditional |
|------|-----------------|-------------|
| Type, Goal, Users, Scope, AC, Constraints, `Ship as`, `Open PR on ship` | ✓ | |
| Tech stack | ✓ for new projects | |
| Integration points | ✓ for existing code | |
| Reproduction | | required when `Type=fix` |
| Timebox | | required when `Type=spike` |
| Carry-over | | only if any `FOLLOWUPS.md` item is in scope |

Walk the intent. For each slot, decide: *did the user already answer this, or did the repo answer it for them?* Only the **unanswered** slots become interview questions. **Never** assume defaults for slots you didn't ask about — that is the single most common cause of a broken spec.

In `/dev`, the orchestrator's `AskUserQuestion` is one batch of 3–4 questions. Pick the 3–4 most consequential unanswered slots. Prefer multi-choice options with one-line descriptions; reserve free-text for genuinely open answers (`Reproduction` for `fix` runs is the canonical free-text slot).

**Frame behavioural questions in past-tense / specifics, not future opinions.** Adapted from Rob Fitzpatrick's *The Mom Test*: "Would you use a feature that does X?" is hypothetical fluff — the user will say yes and you'll learn nothing. "When did you last hit this problem, and what did you do?" gets you a concrete behaviour to design against. Filter the *answers* the same way — compliments, hypotheticals, and wishlists are not signal. See `references/interview-tactics.md > The Mom Test for spec interviews`.

### 4. Propose 2–3 approaches with a recommendation when "how" is open

If the intent pins *what* but leaves *how* open ("add auth", "store these events", "ship a dashboard"), do not jump to one approach. Surface 2–3 with trade-offs and **lead with your recommended option** and the one-line reason it wins.

Format:
> **Option A (recommended):** <approach> — <why it wins for this context>
> **Option B:** <alternative> — <trade-off>
> **Option C:** <alternative> — <trade-off>
> *Recommendation:* A, because <one sentence>.

Two anti-patterns: (a) silently picking one and asking "does this work?" — that's not exploration, that's leading the witness; (b) listing 5 options of equal weight — that's punting the decision back to the user. Three with a clear lead is the sweet spot.

If a relevant construction-fundamentals skill applies ([[programming-fundamentals]] / [[database-fundamentals]] / [[hexagonal-backend]] / [[architecture-fundamentals]] / [[queue-fundamentals]]), load it BEFORE drafting the options — they decide *what* to build; this skill decides *how to surface the choice*.

### 5. HARD-GATE: no code, no `Status: approved`, no `plan.md` until the design is acknowledged

Until the user has seen the design (Goal + Scope + AC + chosen approach) and said yes, you do not:
- write production code
- spawn `engineer` (or any implement-mode agent)
- spawn `lead` in plan mode
- flip `spec.md` from `Status: draft` to `Status: approved`

"This is too simple to need a design" is the failure mode this gate exists to catch. Even a one-file utility goes through the gate; the design can be three sentences, but it gets presented and approved.

In `/dev`, the formal gate is Phase 1 step 8 (orchestrator runs it with the user). This skill's HARD-GATE is the discipline that makes that step meaningful: when the gate fires, the design is already named explicitly, not hidden in the intent.

### 6. Visual companion is optional, opt-in, and lives in its own message

When upcoming questions are genuinely visual (UI mockups, layout comparisons, architecture diagrams the user needs to *see*), you may offer a browser-based companion. The offer is its own message — no clarifying questions attached, no context summary, just the offer:

> "Some of what we're working on might be easier to explain with a visual. I can render mockups, diagrams, or side-by-side comparisons in the browser. This is opt-in and can be token-heavy — want to try it?"

Two rules: (a) only offer when UI / layout / diagram questions are actually coming up; conceptual or scope questions are text-better. (b) Even after the user accepts, decide *per question* whether the answer is better seen or read. "What does 'personality' mean in this context?" is conceptual → terminal. "Which wizard layout works better?" is visual → browser.

If the user declines, proceed text-only. The companion is a tool, not a mode.

### 7. Spec self-review before `Status: approved` (the 5 scans)

After the spec is written, walk it once with fresh eyes — the five scans below. Fix issues inline; no need to re-review:

1. **Placeholder scan** — any `TBD`, `TODO`, `???`, `appropriate X`, `proper Y`, `as needed`, `etc.`, `see spec`, hedging modals (`should`, `would`, `might`) in slots that should be concrete? Fix or move to `Open questions`.
2. **Contradiction scan** — does any section contradict another? Does the architecture summary match the AC? Does the Scope `In` list contradict an AC? If a contradiction exists, the user hasn't made the call yet — surface it.
3. **Scope check** — is this still one ship-able thing? If decomposition slipped back in during the conversation, split now, not at planning time. The gate will catch it; better to catch it here.
4. **Ambiguity check** — could any AC be read two ways? If yes, pick the reading and make it explicit. `"system handles errors gracefully"` reads two ways; `"on 5xx from upstream, return cached value if <5 min old, else 503"` does not.
5. **Verifiability + pre-mortem scan** — for each AC, can you name the exact command or observable that would verify it? If not, the AC is wishful, not testable — rewrite it so it can be checked. Then name the **top 3 ways this design could fail**: dependency that might not deliver, scope someone could mis-read, AC the implementation could satisfy without satisfying the user. Surface each as a `Risk` (if internal) or an `Open question` (if it needs user input). This is the same "give the agent a way to verify its work" principle Anthropic flags as the single highest-leverage thing in [Claude Code best practices](https://code.claude.com/docs/en/best-practices), applied at spec time — and the pre-mortem half is adapted from the Amazon PR/FAQ's "Top three reasons this product will not succeed" question.

The result of the scans is either a clean spec ready for the gate, or a spec with `Open questions` honestly listing what's still unknown. **Never** mark a spec `approved` while a slot is `TBD — see Open questions`. That is what `Open questions` exists to defer.

## Pre-flight checklist (run top-to-bottom)

Before the first question of the interview:

- [ ] Read `CLAUDE.md`, recent commits (`git log -5 --oneline`), and any file the intent names.
- [ ] Read `.workflow/_templates/spec.md` and `.workflow/FOLLOWUPS.md > Open` — fold any in-scope follow-up IDs into the interview.
- [ ] Read `.claude/agents/pm.md > Required slots` for the full slot list. Walk it: which are answered by the intent + repo, which are genuinely open?
- [ ] Decide the run's `Type` (`feat | fix | refactor | chore | docs | spike`). If genuinely ambiguous, that is question 1.
- [ ] Run the scope-decomposition test — is this one ship-able thing, or multiple? If multiple, surface that BEFORE asking detail questions.
- [ ] Load the relevant construction-fundamentals skill(s) for the work that's coming — they shape the approach options in principle 4:
  - Real code → [[programming-fundamentals]]
  - Schema / query / migration → [[database-fundamentals]]
  - Backend with real domain logic → [[hexagonal-backend]]
  - Cross-service / system-level decisions → [[architecture-fundamentals]]
  - Queue / broker / async worker → [[queue-fundamentals]]
  - Unknown-cause bug → [[debug-fundamentals]] *before* this skill (find the cause, then brainstorm the fix)

Then pick the 3–4 most consequential unanswered slots for the interview batch.

## Process flow

```mermaid
flowchart TD
    A[Read intent + repo context] --> B{Multiple independent subsystems?}
    B -- yes --> C[Decompose: pick one, defer rest to FOLLOWUPS]
    B -- no --> D[Walk required slots]
    C --> D
    D --> E{Type ambiguous?}
    E -- yes --> F[Ask Type first]
    E -- no --> G[Pick 3–4 UNSPECIFIED slots]
    F --> G
    G --> H{UI / layout / diagram questions coming?}
    H -- yes --> I[Offer Visual Companion - own message]
    H -- no --> J[Ask question batch]
    I --> J
    J --> K{Approach 'how' open?}
    K -- yes --> L[Propose 2–3 options with recommendation]
    K -- no --> M[Present design: Goal + Scope + AC + chosen approach]
    L --> M
    M --> N{User approves design?}
    N -- no, revise --> J
    N -- yes --> O[pm writes spec.md]
    O --> P[Self-review: 4 scans, fix inline]
    P --> Q{Gate: orchestrator presents to user}
    Q -- revise --> J
    Q -- approve --> R[Status: approved → plan-writing]
```

**Terminal state in `/dev`:** `Status: approved` and the orchestrator spawns `lead` in plan mode. Outside `/dev`: a clean design doc the user can hand to whatever workflow they use next. The next phase is planning — not implementation, not code-writing. Load [[plan-writing]] only when the plan complexity warrants the full skill body.

## When to skip

Skip this skill only when:

- The spec is already approved and you're entering Phase 2 (implementation / review / test / ship).
- The work is a throwaway one-off script, a single-line config edit, a comment cleanup, or anything you could describe in one sentence and ship in one commit with no design risk.
- The user explicitly says "no design conversation, just do it" *and* the request is small enough that the risk of misreading is genuinely low. (If you're not sure, the answer is "don't skip.")

If the request says "build", "design", "add feature", "scope", "explore", "brainstorm", or "what should we do about X" — do not skip.

## Anti-patterns (do not do these)

- **Assuming defaults for slots you didn't ask about** — "I'll just use React + Tailwind" / "I'll store it in Postgres" when the user said nothing about either. The interview missed the slot or the repo answers it — pick one; don't invent.
- **Burning the question batch on slots the repo already answered** — language, framework, deploy target are usually visible in 30 seconds of reading; don't ask them.
- **Picking one approach silently and asking "does this work?"** — that's leading the witness, not exploring. Show ≥ 2 options with a lead.
- **Five-option menus** — punts the choice back to the user. Three with a clear recommendation is the format.
- **Combining the Visual Companion offer with a clarifying question** — the offer is its own message. Otherwise the user has to answer two things in one reply and one of them gets ignored.
- **One mega-question** — "tell me about goals, constraints, AC, and integration points?" The user answers half of it. Split into 3–4 crisp questions; multi-choice when you can.
- **Flipping `Status: approved` while `Open questions` has open items or any slot is `TBD`** — `approved` means the spec is complete enough to plan against. If something is `TBD`, it isn't.
- **"This is too simple to need a design"** — the simplest projects are where unexamined assumptions hide. A three-sentence design with the user's yes is the minimum; that minimum applies always.
- **Brainstorming with code in flight** — if you've already started writing the code, the brainstorm isn't a brainstorm anymore, it's a rationalization. Stop, present the design, get the yes, then continue.
- **Treating compliments / hypotheticals / wishlists as signal** — from *The Mom Test*: "I love this idea," "I would totally use that," "you should also add X someday" all *feel* like progress and aren't. Filter them out and re-ask about past behaviour ("when did you last hit this?", "what did you do?"). If the only evidence you have is an enthusiastic future-tense quote, the spec isn't ready.

## Relation to other skills

Brainstorming is the **pre-spec** skill — it composes, it does not replace:

- [[plan-writing]] — the next planning aid when complexity warrants it. Once `Status: approved`, planning decides *how to sequence and verify* the work. Brainstorming hands the spec to the plan phase; never bypasses planning.
- [[programming-fundamentals]] / [[database-fundamentals]] / [[hexagonal-backend]] / [[architecture-fundamentals]] / [[queue-fundamentals]] — load whichever applies BEFORE drafting approach options in principle 4. They decide *what* to build; this skill decides *how to surface the choice and get to a yes*.
- [[debug-fundamentals]] — for `Type=fix` runs, debug-fundamentals runs *before* this skill: find the actual cause first, then brainstorm the fix (including the regression test the fix step will encode).
- [[git-workflow]] — pairs later at ship time, not here. Brainstorming produces a spec; plan-writing produces a plan; git-workflow lands the commit.

The `/dev` orchestrator (main agent, defined in `.claude/orchestrator.md`) is the **caller** in Phase 1: it loads this skill before running step 6 (interview) and step 7 (spawn `pm`). The `pm` sub-agent receives the orchestrator's Q&A and writes `spec.md` — it does *not* re-run the interview. This skill is the orchestrator's discipline, not `pm`'s.

## Mini worked example (one-paragraph feature request)

**Intent:** "add a way for users to export their data"

**Step 1 — read repo:** `package.json` shows Next.js + Postgres; `app/api/` has REST handlers; no export-related file. → tech stack is answered; integration point is `app/api/` plus a new download route.

**Step 2 — decomposition check:** one user-visible feature, one subsystem. Single spec works.

**Step 3 — required-slots walk:**
- Type: `feat` (clear from "add a way")
- Goal: answered ("export their data")
- Users: not specified — *ask*
- Scope/AC: not specified — *ask*
- Constraints: stack visible; integration point inferable
- `Ship as`: not specified — defaults to `one-drop`, confirm at gate
- Open PR: default `yes` for feat, confirm at gate

→ **Three open questions to batch:** (1) which user role and entry point, (2) what data and what format (CSV / JSON / both), (3) sync download vs async email with link.

**Step 4 — approach options (after answers come in):** Option A: synchronous CSV download from a new `/api/export` route, recommended for ≤ 100k rows. Option B: background job + email link, better for large exports but adds a queue. Option C: hybrid — sync if under threshold, async otherwise. Lead with A unless answer 2 implied >100k rows.

**Step 5 — present design, get yes, hand to `pm`.** `pm` writes `spec.md` with concrete AC ("CSV download from /api/export, ≤30s for accounts up to 100k rows, columns A/B/C"). **Step 6 — self-review:** scan for `TBD`, contradictions, scope creep, ambiguity. Fix inline. **Step 7 — orchestrator runs the gate.**

That's it. Eight steps, no production code touched, spec is concrete enough to plan against.

## References

Pick the one that matches the friction:

- `references/interview-tactics.md` — picking which 3–4 slots to ask about, framing multi-choice options, handling `revise` follow-ups, the `Type=fix` reproduction question.
- `references/visual-companion.md` — when to offer it (and when not to), per-question decision rule for browser vs terminal, anti-pattern: offering combined with another question.

If you're unsure which to consult: *picking what to ask* → interview-tactics; *the user asked about a visual / mockup* → visual-companion.
