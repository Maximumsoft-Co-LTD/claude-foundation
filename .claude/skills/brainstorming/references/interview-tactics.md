# Interview tactics

> Deep reference for SKILL.md's interview steps — consult for: picking slots, framing multi-choice options, `revise` follow-ups, `Type=fix` reproduction, the Mom Test. The **dig loop, Specification-by-Example, and pre-mortem are owned inline by SKILL.md principles 3 & 7**; only their extra detail lives here.

## Pick the 3–4 most consequential UNSPECIFIED slots

Walk `pm.md > Spec sections` + `_templates/spec.md`. Classify each slot — **pinned by intent** (user said it) / **pinned by repo** (`package.json`, `README`, commits, the named file) → don't ask; **open** (neither) → candidate. Of the open ones, ask the 3–4 highest in **consequence × ambiguity**, where a wrong guess cascades through spec/plan/code. Skip slots with safe gate-flippable defaults (`Open PR: yes` for feat). Read `FOLLOWUPS.md` first and fold any in-scope carry-over in as a slot ("also handle `<F-id>` this run?").

### Consequence ranking (rule of thumb)

| Slot | Consequence if wrong | Ask priority |
|------|----------------------|--------------|
| Type (when ambiguous) | Whole workflow branches differently | Always ask first if ambiguous |
| Acceptance criteria | Defines what "done" means | Always ask if open |
| Scope (`Out / non-goals`) | Hidden subsystems surface at planning | Ask if anything could expand |
| Constraints (stack for new code, integration points for existing) | Wrong stack = whole plan wrong | Always ask if neither intent nor repo answers |
| Reproduction (`Type=fix`) | Regression test depends on it | Always free-text, always ask |
| Timebox (`Type=spike`) | Spike runs forever otherwise | Always ask, default 1 day if user shrugs |
| NFR detection (perf / security / a11y) | A missing-but-needed NFR passes every consistency scan, breaks only in prod | Mandatory **binary** ask for feat/fix shipping runtime code; `yes` → an AC (verify = `measured:`), `no` → nothing |
| Error/boundary per consequential behavioural AC | A silently-guessed unhappy path is the #1 "runs but does the wrong thing" failure | Mandatory **detect** ask per consequential behavioural AC (NFR-class measured ACs exempt); `none — <default>` valid, silence isn't |
| Users / context | Shapes AC and approach | Ask if non-obvious |
| Ship as / Open PR | Has safe defaults | Skip if running short on slots |

### Then order by the design tree, not just consequence

Consequence tells you *which* slots matter; the design tree tells you *what order*. Decisions depend on each other — the right AC depends on the chosen approach, the right data shape on the actor, the right index on the store. **Resolve the upstream slot first; never ask a dependent slot cold while its parent is open** (you'd guess against an unconfirmed assumption and re-ask once it flips). So **batch 1** = the roots nothing depends on (Type, approach, actor, the load-bearing Constraint); **later batches** = what a batch-1 answer shapes — the dig loop (SKILL.md principle 3) walks these. E.g. "add export": resolve transport (sync/async) in batch 1 because it shapes the format question — don't ask both at once.

## Question shape — multi-choice > open-ended > free-text

`AskUserQuestion` takes 2–4 options + an auto "Other". Prefer multi-choice: one click, structured input, and the options themselves teach the trade-off space.

```
Question: <one specific question, ends with "?">
Header: <≤12 char chip>
Options:
  - Label: <1–5 words; recommended option FIRST with "(Recommended)" suffix>
    Description: <1 sentence: what it means + main implication>
  - Label: <alternative>  /  Description: <trade-off>
  - (optional 3rd / 4th)
```

The "Other" option is added automatically; don't list it. **Free-text** only when the answer is genuinely descriptive: `Reproduction` (fix), a one-sentence "what does done look like?", or a constraint the repo can't show (e.g. a compliance deadline). Hard-to-design options usually means the question is too broad — split it, don't punt to free-text.

## Framing multi-choice options

Two failure modes: **loaded** (Option A = a paragraph of upside, B = a one-line "but harder" — match depth and tone) and **false-binary** ("REST vs GraphQL?" when RPC / file-export also fit — add the third even if it loses, so the user sees the space).

### Worked example — "export user data" (the canonical one; reused throughout)

✅ Good:
> Q: How should users receive the export? · Header: Delivery
> - **Sync download (Recommended)** — Browser downloads the CSV. ≤ 100k rows / ≤ 30s; simplest path.
> - **Async email link** — Background job builds the file, emails a signed link. For large accounts; adds a queue.
> - **Hybrid** (sync ≤ threshold, async above) — Right one per request. Most complex; only if sizes vary widely.

❌ Loaded: "Should we use a queue? — Yes (scalable, future-proof, recommended) / No (just download)".
❌ False-binary: "Sync or async?" with only those two when a hybrid exists.

## Ground AC in concrete examples (Specification by Example)

The cheapest place to catch a mis-spec'd AC is *before* it's written, by forcing a real `input → expected output`. For every AC whose behaviour isn't self-evident, capture one example and carry it into the spec as an `e.g.:` sub-bullet. **Never invent the values** — an invented example is a guessed requirement in a contract's clothes; if the user can't give one, the AC isn't understood yet → dig or mark `[NEEDS CLARIFICATION]`.

| Abstract AC (hides requirements) | AC + example (surfaces them) |
|----------------------------------|------------------------------|
| "User can export their data" | "User exports their data" · *e.g.:* `account with 200k rows` → `CSV with columns A,B,C, downloaded in <30s` |
| "Search returns relevant results" | "Search returns matches ranked by recency" · *e.g.:* `query "invoice", 3 matches from 2021/2023/2024` → `2024, 2023, 2021 order` |
| "Login rejects bad credentials" | "Login rejects bad credentials without leaking which field was wrong" · *e.g.:* `valid email + wrong password` → `same 401 + message as unknown email` |

## Handling `revise` follow-ups (in `/dev`)

`revise <notes>` at the gate (orchestrator step 9) or free-form chat about the spec/plan is an incremental in-run edit, never a fresh Phase 1. Route by what the notes touch:

- **Requirements** (changed AC, added scope, changed users) → re-interview only the affected slots (a 1–2 question batch is fine); re-spawn `pm` spec-patch.
- **Spec-only** (rewording, clarifying a slot, fixing a contradiction) → no interview; `pm` spec-patch in place — resolve/add `[NEEDS CLARIFICATION]` at the spot.
- **Approach-only** (Option B instead of A, requirements unchanged) → no interview, skip `pm`; `lead` plan-revise on the affected steps (no re-fanout, no LSP re-walk).

Surgical, not "start over".

## The `Type=fix` reproduction question

The most important free-text answer in `/dev` — the regression test depends on it. Ask: *"How do we make the bug appear? Walk through the steps, what you expected, and what actually happens."* The answer must carry three things: **Steps** (concrete enough to encode — "POST /api/foo {…}"), **Expected**, **Actual** (with the error / wrong value). Missing one → one targeted follow-up. **Never invent steps** — invented repro means the regression test tests the wrong thing and the bug comes back.

## The Mom Test for spec interviews

Adapted from Rob Fitzpatrick's *The Mom Test* — three rules for getting useful information out of an interview. The same failure modes appear interviewing about a feature, refactor scope, or bug repro.

**Rule 1 — Talk about their life, not your idea.** Ask about the problem they already have; the moment you describe the solution you've stopped learning and started selling.

| Don't ask | Ask instead |
|-----------|-------------|
| "Would you use an export feature?" | "How do you currently get data out when you need it?" |
| "Do you think a dashboard would help?" | "How do you keep tabs on the metrics that matter right now?" |
| "Want a notification when X happens?" | "What do you do today to know X has happened?" |

**Rule 2 — Ask about specifics in the past, not opinions about the future.** Past behaviour is observable; future opinions are imagination. "Tell me about the last time…" is the single most useful question shape.

| Don't ask | Ask instead |
|-----------|-------------|
| "Would you pay for this?" | "Tell me about the last time you paid to solve this — what, how much, did it work?" |
| "How often would you export?" | "When did you last export data? What format, and what did you do with the file?" |
| "Would this be useful?" | "Walk me through the last time you needed this and didn't have it — what did you do instead?" |

**Rule 3 — Talk less, listen more.** Silence is a tool; when the user trails off, don't fill the gap — they usually continue with the most honest sentence. In `AskUserQuestion`: no 200-word framing, no pre-answering in option labels, no bundled follow-ups. One question, lean framing.

**Three types of bad data** — when an answer feels great, check it isn't one of these:
- **Compliments** ("I love this," "you should build it") — praise, not data. Redirect to the last time they tried to solve it themselves.
- **Hypothetical fluff** ("I'd probably use it," "in theory…") — future-tense, conditional. Redirect to the last time the problem came up.
- **Wishlists** ("you should also add Y") — projections wearing requirement's clothes. Ignore for this spec; log to `FOLLOWUPS.md` if multiple users recur with concrete examples.

**When the user IS the user** (internal feature, solo project, the engineer themselves) — same rules, shifted tells:
- Compliments → **self-justification** ("this'll make us so much faster"). Redirect: which past task, faster by how much?
- Hypothetical fluff → **scope-creep enthusiasm** ("while we're in here, also…"). Redirect: real pain on a real task last week, or a tidy-up wish?
- Wishlists → **gold-plating** ("make it generic for reuse later"). Redirect: name one concrete second use case that exists today, or defer.

## Pre-mortem at the gate

The 5th self-review scan (SKILL.md principle 7), from the Amazon PR/FAQ. Shape: *"It's three weeks from now, this shipped and disappointed — name the top three reasons."* Three, not fewer. Classify each and act:

| Reason category | What to do |
|-----------------|------------|
| **Mis-spec'd AC** — satisfied but the user wasn't | Rewrite the AC so satisfying it satisfies the user (often add a concrete example). |
| **Hidden dependency** — something we don't own had to deliver | Add a `Risks` bullet; surface as `[NEEDS CLARIFICATION]` if it changes the plan. |
| **Scope mis-read** — team builds something different from what was meant | Add a `Scope > In/Out` sentence that makes the intended reading unambiguous. |
| **Approach risk** — the chosen option was wrong for this context | Reconsider the principle-4 approach options before locking the spec. |
| **Operational gap** — works in dev, breaks in prod | Promote to `Constraints` or add an observability AC. |

It's not a Risks dump (things that *might* go wrong) — it asks which you'd be most *embarrassed* about in three weeks.
