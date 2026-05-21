# Interview tactics

The interview is one `AskUserQuestion` batch (in `/dev`) or a short series of focused questions (outside `/dev`). This reference is the field guide for making it land.

## Pick the 3–4 most consequential UNSPECIFIED slots

Walk `.claude/agents/pm.md > Required slots` and `.workflow/_templates/spec.md`. For each slot, classify:

1. **Pinned by the intent** — the user already said it. Don't re-ask.
2. **Pinned by the repo** — `package.json`, `README.md`, recent commits, or the file the intent names answers it. Don't ask.
3. **Open** — neither the intent nor the repo answers it.

Of the open slots, pick the 3–4 with the highest **consequence × ambiguity**: the slots where a wrong guess would cascade through the spec, plan, and code. Skip slots that have safe defaults the gate can still flip (e.g., `Open PR on ship: yes` for feat — defaults work, confirm at gate).

### Consequence ranking (rule of thumb)

| Slot | Consequence if wrong | Ask priority |
|------|----------------------|--------------|
| Type (when ambiguous) | Whole workflow branches differently | Always ask first if ambiguous |
| Acceptance criteria | Defines what "done" means | Always ask if open |
| Scope (`Out / non-goals`) | Hidden subsystems will surface at planning | Ask if anything could expand |
| Constraints (tech stack for new code, integration points for existing) | Wrong stack = whole plan wrong | Always ask if neither intent nor repo answers |
| Reproduction (`Type=fix`) | Regression test depends on it | Always free-text, always ask |
| Timebox (`Type=spike`) | Spike runs forever otherwise | Always ask, default 1 day if user shrugs |
| Users / context | Shapes AC and approach | Ask if non-obvious |
| Ship as / Open PR | Has safe defaults | Skip if running short on slots |

## Question shape — multi-choice > open-ended > free-text

`AskUserQuestion` lets you set 2–4 options per question plus an "Other" escape hatch. Prefer multi-choice — the user picks in one click, you get structured input, and the options themselves educate the user about the trade-off space.

### Multi-choice template

```
Question: <one specific question, ends with "?">
Header: <≤12 char chip>
Options:
  - Label: <1–5 words, the recommended option first with "(Recommended)" suffix>
    Description: <1 sentence: what this means + main implication>
  - Label: <alternative>
    Description: <1 sentence: trade-off>
  - (optional 3rd / 4th)
```

The "Other" option is added automatically; do not list it yourself.

### When to use free-text (open-ended)

Free-text is right when the answer is genuinely descriptive:
- `Reproduction` for `Type=fix` — never multi-choice; the user needs to type steps.
- A goal restatement that the intent left vague — "what does 'done' look like for you in one sentence?"
- A constraint the user knows that the repo can't show you — e.g., a compliance deadline.

Don't reach for free-text just because picking options feels hard. Hard-to-design options usually means the question is too broad — split it.

## Framing multi-choice options

Two failure modes:

1. **Loaded options** — Option A is described as a paragraph of upside, Option B as a one-line "but harder." That's not exploration. Match the depth and tone.
2. **False-binary** — "REST vs GraphQL?" when the actual choice has 3+ shapes (REST, GraphQL, RPC, file-based export). Add the third option even if it loses; the user can see the space.

### Worked example — Type=feat, "export user data"

✅ Good:
> Q: How should users receive the export?
> Header: Delivery
> Options:
> - Sync download (Recommended) — Browser downloads the CSV directly. Works for ≤ 100k rows / ≤ 30s; simplest path.
> - Async email link — Background job builds the file, emails a signed link. Best for large accounts; adds a queue.
> - Hybrid (sync up to threshold, async above) — Picks the right one per request. Most complex; only worth it if account sizes vary widely.

❌ Bad (loaded):
> Q: Should we use a queue?
> Options:
> - Yes (queue + email link, scalable, future-proof, recommended)
> - No (just download)

❌ Bad (false binary):
> Q: Sync or async?
> Options:
> - Sync
> - Async

## Handling `revise` follow-ups (in `/dev`)

If the user picks `revise <notes>` at the gate (Phase 1 step 8), you don't necessarily re-run a full batch. Decide:

- **Notes affect requirements** (changed AC, added scope, changed users) → re-interview only the affected slots. A 1–2 question batch is fine.
- **Notes are spec-only** (rewording, clarifying an existing slot, fixing a contradiction) → don't re-interview. Edit `spec.md > Open questions` with the notes and re-spawn `pm` for a spec patch.
- **Notes affect approach** (user wants Option B instead of A) → no interview; update the design, re-present, get the yes, re-spawn `pm`.

Don't treat `revise` as "start over." It's surgical.

## The `Type=fix` reproduction question

`Reproduction` is the most important free-text answer in `/dev`. The regression test depends on it.

Ask shape:
> Q: How do we make the bug appear? Walk us through the steps that trigger it, what you expected to happen, and what actually happens.

Three things the answer must contain:
1. **Steps** — concrete enough to encode in a test. "Click X, then Y, then Z" or "POST /api/foo with body {…}".
2. **Expected** — what the user thought would happen.
3. **Actual** — what does happen (with the error message / wrong value if there is one).

If the answer is missing one of these, ask one targeted follow-up. **Do not invent steps.** A spec with invented reproduction means the regression test is testing the wrong thing — and the bug will come back.

## Anti-patterns specific to the interview

- **Asking about a slot the intent already answered** — wastes a question. Re-read the intent before each question.
- **Five-option menus** — too many choices; the user defaults to the first or refuses to pick. Three with a lead is the format.
- **Combining two questions** — "What stack and what's the deploy target?" forces the user to answer both or one well. Split.
- **Free-text when multi-choice works** — "How should users authenticate?" with no options. Give them email/password vs OAuth vs SSO vs magic link and let them pick.
- **No "Recommended" tag** — without a lead the user is forced to evaluate cold. If you genuinely don't have a preference, say so in the question text and offer all options equally — but that's rare.
- **Designing the question batch without reading `FOLLOWUPS.md`** — the interview is the time to fold in carry-overs. If a follow-up could be in scope, ask "should we also handle <follow-up X> in this run?" as one of the batch slots.
