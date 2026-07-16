# Interview tactics

> Deep reference for SKILL.md's interview steps — consult for: exploring context, decomposing scope, picking slots, batching questions, the dig loop, framing multi-choice options, `revise` follow-ups, `Type=fix` reproduction, the Mom Test. SKILL.md principles 3 & 7 keep only a one-line anchor for the dig loop, Specification-by-Example, and pre-mortem; full detail for all three lives here.

## Explore context before asking anything (principle 1)

The intent is one sentence; the codebase already has answers. Read `CLAUDE.md`, `.workflow/INDEX.md`, the last few commits, and any file the intent names *before* the first question.

**Log what the repo answered as an assumption, not a fact.** When the repo (not the user) answers a slot — stack from `package.json`, integration point from the file the intent names, a convention from a sibling module — that inference can be wrong. Keep a short running list and hand it to the orchestrator to surface at the gate as `Assumptions (inferred — correct me if wrong)`. A wrong inference silently corrupts the spec; a one-line veto at the gate is cheap.

## Decompose oversized scope before refining details (principle 2)

If the intent describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), surface that immediately.

The test: can this be one approved spec that produces one ship-able thing? If not, name the pieces, ask the user which one to scope first, and carry the rest to `FOLLOWUPS.md` as candidates for separate `/dev` runs. Inside `/dev`, this is also what triggers the `epic.md` path — the gate will split it anyway, so flag it here.

## Pick the 3–4 most consequential UNSPECIFIED slots

Walk `pm.md > Spec sections` + `_templates/spec.md`. Classify each slot — **pinned by intent** (user said it) / **pinned by repo** (`package.json`, `README`, commits, the named file) → don't ask; **open** (neither) → candidate. Of the open ones, ask the 3–4 highest in **consequence × ambiguity**, where a wrong guess cascades through spec/plan/code. Skip slots with safe gate-flippable defaults (`Open PR: yes` for feat). Read `FOLLOWUPS.md` first and fold any in-scope carry-over in as a slot ("also handle `<F-id>` this run?").

### Minimum floor & triggered slots (at a glance)

**Minimum floor (always asked or pulled from intent):** `Type`, `Goal` (one sentence — what's built, for whom, to what outcome), `User Stories` (priority-ordered P1/P2/P3; each carries a value statement + Why-this-priority + Given/When/Then `Acceptance scenarios` — capture the *why / who-benefits* during the interview, not just what "done" is), `Functional Requirements` (FR-###), `Success Criteria` (SC-###, measurable + tech-agnostic), `Ship as`, `Open PR on ship`. AC may be just 1 for XS; each consequential *behavioural* AC also carries an `on error / at boundary:` line (the unhappy-path decision, or an explicit `none — <default>`) and edges live as sub-bullets under the AC they edge (NOT a separate section). Measurable perf/security/a11y targets are themselves ACs (verify = the `measured:` clause), not a separate untestable section — an NFR-class AC carries neither `e.g.` nor `on error / at boundary`.

**Everything else is triggered** — `Problem`, `Users`, `User journey`, `Scope — Out`, `NFR`, `DoD`, `Constraints`, `References / examples to follow`, `Reproduction` (REQUIRED for `Type=fix`), `Timebox` (REQUIRED for `Type=spike`), `Discovery notes`, `Carry-over`. `pm.md > Spec sections` names the trigger condition for each; ask only when it fires.

Walk the intent. For each triggered slot, first decide whether the trigger fires at all. If not, the slot is not just unanswered — it does not exist for this spec. If yes: *did the user already answer this, or did the repo answer it?* Only the **triggered AND unanswered** slots become interview questions. **Never** assume defaults for slots you didn't ask about, and **never** include a triggered section just because the template mentions it.

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

**Sequencing.** Resolve open slots through the dig loop *before* framing approach options (principle 4) — clarification precedes design choice, never the reverse. And if the mandatory NFR-detection question (below) crowds a consequential slot out of batch 1, treat that pressure as a signal to run a second batch, not a reason to drop either question.

## Batching the question set

In `/dev`, the orchestrator's `AskUserQuestion` is **one batch of 3–4 questions by default**. Pick the most consequential unanswered slots and **order them by the design tree** — a decision others hinge on (approach, data shape, actor) is resolved first; never ask a slot cold whose right answer depends on an unanswered upstream one, defer it to a later batch so the prior answer shapes it. Prefer multi-choice options with one-line descriptions, and **lead every choice with a recommended option** (first in the list, labelled `(Recommended)`, one-line why — the harness renders the label) so the user vetoes instead of authoring from scratch; principle 4's "recommend, don't punt" applies to clarifying questions too, not just approach options. Reserve free-text for genuinely open answers (`Reproduction` for `fix` runs is the canonical free-text slot).

## Bounded multi-round digging — when one batch is too shallow

One batch is enough for narrow, concrete work. It is *not* enough for the genuinely ambiguous work this skill claims to own, because the Mom Test is iterative by nature: a good past-behaviour answer opens the next question, and you can't follow that thread inside a single batch. So when ambiguity is high — `Type` still unclear after batch 1, more than ~4 consequential slots open, or a batch-1 answer arrived vague / as "Other" free-text that raised a new unknown — you may run a **second (at most third) batch that digs into what the previous answer revealed**, not new slots picked cold. Three rules: (a) hard cap of **3 batches**; (b) each follow-up batch is *narrower* than the last — you are converging, not re-opening; (c) if the picture is still open after 3 batches, that is itself the finding — stop and surface it as a `[NEEDS CLARIFICATION]` rather than guessing. The default stays one batch; the dig loop is the escape hatch for real ambiguity, not the norm. **The driver is the design tree, not the counter:** keep going while a load-bearing decision (one a later choice depends on) is unresolved; stop when every consequential branch is resolved or explicitly deferred — the 3-batch cap is the safety stop, not a target to fill.

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

## Frame trigger questions to detect, not to fill

Bad: "What are the NFRs?" — assumes there are some, invites TBD. Good: "Is there a measurable perf/security/a11y target that needs a number? If not, we don't write one." The detection question is binary; only on `yes` do you ask for the actual value — and then it becomes an AC (verify = its `measured:` clause), not a separate section.

**The NFR detection question is mandatory for any run that ships runtime code (`feat`/`fix` with a real runtime path)** — ask it even when slots are tight, because a missing-but-needed NFR is the one failure mode that passes every internal-consistency scan and only surfaces in prod. This makes the *question* mandatory, not the *section*: if the answer is "no target needed", there is no NFR — anti-bloat still wins. On a real, measurable number, **render it as an Acceptance criterion** (its `measured:` clause becomes that AC's verify) so it threads through plan/qa/review; do NOT park it in a standalone NFR section, which orphans it (no task, no test, no review row).

## Ground AC in concrete examples (Specification by Example)

The cheapest place to catch a mis-spec'd AC is *before* it's written, by forcing a real `input → expected output`. For every AC whose behaviour isn't self-evident, capture one example and carry it into the spec as an `e.g.:` sub-bullet. **Never invent the values** — an invented example is a guessed requirement in a contract's clothes; if the user can't give one, the AC isn't understood yet → dig or mark `[NEEDS CLARIFICATION]`.

| Abstract AC (hides requirements) | AC + example (surfaces them) |
|----------------------------------|------------------------------|
| "User can export their data" | "User exports their data" · *e.g.:* `account with 200k rows` → `CSV with columns A,B,C, downloaded in <30s` |
| "Search returns relevant results" | "Search returns matches ranked by recency" · *e.g.:* `query "invoice", 3 matches from 2021/2023/2024` → `2024, 2023, 2021 order` |
| "Login rejects bad credentials" | "Login rejects bad credentials without leaking which field was wrong" · *e.g.:* `valid email + wrong password` → `same 401 + message as unknown email` |

The example is where hidden requirements surface *up front* (size limits, formats, timeouts) instead of late in the pre-mortem. Carry it into the spec as an `e.g.:` sub-bullet under the AC (format in `.workflow/_templates/spec.md`). Skip only for AC whose one line is already unambiguous.

## Capture the unhappy path too (on error / at boundary)

For each consequential *behavioural* AC (not an NFR-class measured target), also capture its `on error / at boundary:` behaviour: what happens for bad input, a hit limit, or an unauthorized caller. This is the EARS IF/THEN clause, and it's where AI silently guesses (exports soft-deleted rows, skips the authz check, picks the wrong API among two — the documented #1 "runs but does the wrong thing" failures). Frame it to *detect*, not to fill: "On bad input / over the limit / not allowed — does anything special happen, or is the generic default fine?" An explicit `none — <default>` is a valid recorded answer; silence is not. Carry it into the spec as the `on error / at boundary:` sub-bullet. This question is mandatory for consequential AC for the same reason NFR detection is: the missing-but-needed boundary passes every internal-consistency scan and only bites in prod.

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

**Rule 2 — Ask about specifics in the past, not opinions about the future.** Past behaviour is observable; future opinions are imagination. "Tell me about the last time…" is the single most useful question shape. "Would you use a feature that does X?" is hypothetical fluff — the user will say yes and you'll learn nothing; "When did you last hit this problem, and what did you do?" gets you a concrete behaviour to design against.

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

## Anti-patterns

- **Assuming defaults for slots you didn't ask about** — "I'll just use React + Tailwind" / "I'll store it in Postgres" when the user said nothing about either. The interview missed the slot or the repo answers it — pick one; don't invent.
- **Including triggered sections "just in case"** — `Users: end users` when the actor is singular and obvious, `Constraints: None` when there's no real boundary, `Discovery notes: N/A` when no research ran. These defeat the minimum-floor principle and become placeholder magnets. DELETE the whole section instead.
- **Inventing NFR numbers** — writing "p95 < 200ms" because you felt a target was expected and needed something to fill the blank. If the user didn't give a number and no constraint forces one, there is no NFR — don't write the AC, or replace the value with `[NEEDS CLARIFICATION]`. (When a real number does exist, it's an AC, not a standalone section.)
- **Burning the question batch on slots the repo already answered** — language, framework, deploy target are usually visible in 30 seconds of reading; don't ask them.
- **Asking a dependent question before its prerequisite** — batching "which index?" with "SQL or NoSQL?" wastes the index answer if the store flips. Order questions by the design tree: resolve the upstream decision, let it shape the downstream one.
- **One mega-question** — "tell me about goals, constraints, AC, and integration points?" The user answers half of it. Split into 3–4 crisp questions; multi-choice when you can.
- **Treating compliments / hypotheticals / wishlists as signal** — "I love this idea," "I would totally use that," "add X someday" aren't data. Re-ask about past behaviour ("when did you last hit this?"). If all evidence is future-tense, the spec isn't ready.
