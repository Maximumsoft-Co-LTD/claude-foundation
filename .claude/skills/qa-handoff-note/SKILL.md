---
name: qa-handoff-note
description: Write a `qa-note.md` handoff that lets QA hand-test a change on a deployed environment (dev/staging) WITHOUT pulling the repo — distinct from `tests.md` (automated results). Use on explicit request when handing implemented work off to a QA tester, e.g. "write a QA note", "qa handoff", "test notes for QA", "บันทึกส่งงานให้ QA", "qa test บน dev", "qa-note". This skill is not an automatic `/dev` phase; invoke it manually after the change is deployed or when the user asks. Skip for chore/docs/spike (no QA pass) and throwaway scripts.
---

# QA Handoff Note

## Why this exists

QA tests on a **deployed environment** — they need access, navigation, expected behaviour, and test data, not code. Without a written note, QA rediscovers every step by trial-and-error or files a deliberate gap as a defect. `qa-note.md` carries the implementer's knowledge to the tester.

Complements `tests.md` (automated); this note targets the manual on-environment pass.

## What it is / is not

- **IS** — a black-box test guide for a deployed environment: how to reach the change, what to do, what the correct result looks like, and what's intentionally not done yet. Written from the *tester's* point of view (screens, buttons, endpoints, accounts), not the *coder's* (files, functions).
- **IS NOT** — the acceptance criteria (those live in `spec.md` — link, don't restate), the automated test plan + results (`test-plan.md` / `tests.md`), or anything that assumes the reader can read or run source. **No `npm test`, no "clone and run", no `path#anchor` for QA to inspect** — they can't see the code. If a step needs the repo, it's in the wrong document.

## When to write it

- **Manual `/dev` handoff** — after implementation and any required review/security checks, once the change is **deployed to the dev environment** and the user asks for a handoff note. The note describes the *deployed* surface QA will actually touch. Write it to `.workflow/<id>/qa-note.md`. The core `/dev` orchestrator does not run this automatically.
- **Manually outside `/dev`** — any time you hand a deployed change to a separate tester.
- **Skip** — `chore` / `docs` / `spike` runs (no QA pass), throwaway scripts, and changes with no user- or API-observable surface on the environment (a pure internal refactor with nothing for a black-box tester to see — that's `tests.md`'s job).

## Inputs — read before writing

Mine these so the note is accurate; QA never sees them:

1. `.workflow/<id>/spec.md` — `User Stories` / acceptance scenarios (`AC#`, incl. each boundary/error scenario), `Type`, `Reproduction` (fix), `Non-goals` / `Scope — Out`. The AC are what the scenarios must exercise.
2. `.workflow/<id>/plan.md` — what was built, blast radius, `Risks`. Feeds Focus areas and Known limits.
3. **The diff** — to know which screens / flows / endpoints actually changed. You translate it into *user-facing* terms for the note; you never paste code into it.
4. **Deployment facts** — the environment URL, what build/branch is on dev, test accounts, feature-flag state. If you don't know these, ask before writing — a note with a guessed URL or account is worse than none.

## The four sections

Bullets, not prose; write only sections that carry real content. How to fill each + the copyable blueprint: `references/note-structure.md`.

1. **Where & how to access it on dev** — environment URL + deployed build, login account/role (credential *location*, never a password), the record/state/endpoint to reach, feature-flag/config toggles. Every access detail concrete and real — no "log in as usual".
2. **Focus areas & risk hotspots** — the 1–3 riskiest surfaces in tester terms, ripple/regression screens from `plan.md` blast radius, where to push hard beyond the happy path. The honest "if something's wrong, it's probably here" — not the full AC list.
3. **Known limits / not covered** — deliberate out-of-scope ("don't raise as bugs"), not-on-dev-yet (OFF flag, mocked dependency), roles/environments/data not exercised. A known limit is a *deliberate* choice; a broken thing on dev is a blocker, never a footnote.
4. **Test scenarios** — numbered `action → expected` happy path plus edge/error paths tied to each AC's boundary/error clause (and a fix's original reproduction). The starting set; QA owns final coverage in `tests.md`.

**Type-aware emphasis** — sections are constant, the lead shifts: `feat` → Section 1, `fix` → Section 4 (replay the reproduction), `refactor` → invisible change, behaviour-unchanged checks. Detail: `references/note-structure.md > Type-aware emphasis`.

**Quality bar** (self-review): concrete access, expected result on every scenario, no code/repo, no restated AC, no secrets, honest limits, matches what's deployed, skimmable — else delete it. **Anti-patterns**: telling QA to run code, code-level references, vague access, scenarios without expected results, pasted credentials, restated AC, buried bugs, writing pre-deploy, walls of prose. Both in full: `references/note-structure.md`.

## Relation to other skills / artifacts

- `spec.md` (owned by `pm`) — AC source. Scenarios exercise the AC on the environment.
- `plan.md` (owned by `lead`) — blast radius + risks → Focus areas and Known limits.
- `tests.md` (owned by `qa`) — automated counterpart. Both can run for the same change.
- [[debug-fundamentals]] — `fix` reproduction → Section 4 replays on dev.
- [[refactoring-fundamentals]] — `refactor` behaviour baseline → QA confirms on the environment.

In `/dev`, the orchestrator calls this only when the user explicitly asks. No agent spawned, no phase matrix change.

## When to skip

- `chore` / `docs` / `spike` runs — no QA pass on the environment.
- Throwaway one-off scripts and single-line edits.
- Pure internal changes with nothing a black-box tester can observe on dev (leave it to `tests.md`).
- When you are the only one testing it and already know the environment cold — though a three-line access + scenario note still usually pays for itself.

## Reference files

| File | Read when |
|---|---|
| `references/note-structure.md` | Writing the note — per-section guidance, type-aware emphasis, the blueprint, quality bar, anti-patterns |
| `references/example-refund.md` | Worked `feat` example (order refunds) |
| `references/example-fix-coupon.md` | Worked `fix` example (coupon bug) |
