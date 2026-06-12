---
name: qa-handoff-note
description: Write a `qa-note.md` handoff that lets QA test a change on a deployed environment (dev/staging) by hand — where it lives, how to reach it, what to click/call, what to expect, and what NOT to flag — WITHOUT pulling the repo or running code. The dev→QA bridge for black-box / functional testing, distinct from `tests.md` (automated test results). Use when handing implemented work off to a QA tester in a /dev run (orchestrator/main agent, after review/security, before the test phase), or when the user asks to "write a QA note", "qa handoff", "test notes for QA", "บันทึกส่งงานให้ QA", "qa test บน dev", "qa-note". Owns the four sections (Where & how to access on dev · Focus areas & risk hotspots · Known limits / not covered · Test scenarios) plus the concrete-access, expected-result, no-secrets, and honest-limits rules. Skip for chore/docs/spike (no QA pass) and throwaway scripts.
---

# QA Handoff Note

## Why this exists

QA tests the change on a **running, deployed environment** (dev / staging / UAT) — they open a URL, log in, click through the UI, hit the API. They do **not** clone the repo, install dependencies, or run the source. So the knowledge they need is *access + navigation + expected behaviour*, not build commands: the environment URL, which account and role to log in as, the exact menu path to the new screen, the API endpoint and how to authenticate to it, the test data already sitting in that environment, and the one deliberate gap that *looks* like a bug but isn't.

The implementer's head holds all of that, and none of it survives the handoff on its own. Without a written note QA rediscovers every step by trial and error — or files the deliberate gap as a defect and burns a cycle on something out of scope. `qa-note.md` is the artifact that carries it across, authored *by the side that built the change, for the side that tests it on the environment*.

`tests.md` (the repo's `qa` agent) records **automated** test design + results in code. `qa-note.md` is the **manual / functional** test guide for exercising the deployed build. They complement each other; this note targets the human pass on dev.

## What it is / is not

- **IS** — a black-box test guide for a deployed environment: how to reach the change, what to do, what the correct result looks like, and what's intentionally not done yet. Written from the *tester's* point of view (screens, buttons, endpoints, accounts), not the *coder's* (files, functions).
- **IS NOT** — the acceptance criteria (those live in `spec.md` — link, don't restate), the automated test plan/results (`tests.md`), or anything that assumes the reader can read or run source. **No `npm test`, no "clone and run", no `path#anchor` for QA to inspect** — they can't see the code. If a step needs the repo, it's in the wrong document.

## When to write it

- **In a `/dev` run** — after Review and Security, **before** the Test phase, once the change is **deployed to the dev environment**. The note describes the *deployed* surface QA will actually touch. Write it to `.workflow/<id>/qa-note.md`.
- **Manually** — any time you hand a deployed change to a separate tester.
- **Skip** — `chore` / `docs` / `spike` runs (no QA pass), throwaway scripts, and changes with no user- or API-observable surface on the environment (a pure internal refactor with nothing for a black-box tester to see — that's `tests.md`'s job).

## Inputs — read before writing

Mine these so the note is accurate; QA never sees them:

1. `.workflow/<id>/spec.md` — `Outcome`, `Acceptance criteria` (incl. each `on error / at boundary:` clause), `Type`, `Reproduction` (fix), `Non-goals` / `Scope — Out`. The AC are what the scenarios must exercise.
2. `.workflow/<id>/plan.md` — what was built, blast radius, `Risks`. Feeds Focus areas and Known limits.
3. **The diff** — to know which screens / flows / endpoints actually changed. You translate it into *user-facing* terms for the note; you never paste code into it.
4. **Deployment facts** — the environment URL, what build/branch is on dev, test accounts, feature-flag state. If you don't know these, ask before writing — a note with a guessed URL or account is worse than none.

## The four sections — how to fill each

Bullets, not prose. Write only the sections that carry real content.

### 1. Where & how to access it on dev

Everything QA needs to *reach* the change on the environment:

- **Environment** — the URL/host (`https://dev.example.com`) and what's deployed there (branch/build/tag, so QA confirms they're testing the right version).
- **Login** — the account(s) and **role(s)** to use ("log in as a `store-manager`"). Name the account and where the credentials live (shared QA vault / 1Password / ask the lead) — **never paste a password.**
- **Navigation path** — the literal click path to the changed surface: `Menu → Orders → Refunds → "New refund"`. If it's behind a tab, a search, or a specific record, say which.
- **API (if relevant)** — base URL + the endpoint(s) (`POST /api/v1/refunds`), how to authenticate (where the token comes from, which header), and a sample request body. Frame it for Postman / curl against the dev host, not a local server.
- **Test data** — what already exists on dev to test against (a seeded account, sample order IDs, a record in the right state) — or how to create it through the UI. Saves QA from hunting.
- **Feature flag / config** — any toggle that must be ON for the change to appear, and how it's set on dev.

Rule (the access version of [[plan-writing]]'s verify clause): **every access detail is concrete and real** — the actual URL, the actual account/role, the actual menu path, the actual endpoint. If you'd write "log in as usual" or "go to the refunds page", replace it with the exact account and the exact path. A handoff that assumes the tester already knows where it is isn't a handoff.

### 2. Focus areas & risk hotspots

Where to spend attention — the 1–3 surfaces most likely to break, in tester terms:

- **Hotspots** — the *screen / flow / endpoint* that changed and *why it's risky* (brand-new flow, a tricky multi-step state, a slow/large list, a call to an external system that can fail or time out). No code references — name what the tester sees.
- **Ripple / regression** — existing screens the change could affect, from `plan.md` blast radius: "this also changed the shared currency formatter — re-check the invoice and receipt screens too."
- **Where to push hard** — inputs and sequences worth stressing beyond the happy path: large/empty values, double-submit, a user *without* permission, the boundary number, going back mid-flow.

This is the implementer's honest "if something's wrong, it's probably here" — not the full AC list.

### 3. Known limits / not covered

Protect QA's time and stop false defects:

- **Deliberate out-of-scope** — from `spec.md > Non-goals` / `plan.md > Out of scope`, restated as "don't raise these as bugs."
- **Not on dev yet / shipped-on-purpose rough edges** — a path behind a flag that's OFF, a dependent service still mocked on dev, a follow-up not in this run.
- **Environments / roles / data not exercised** — "only the manager role was wired this run", "email actually sends only on staging, not dev", "mobile layout not in scope."

**Be honest.** A "known limit" is a *deliberate* choice. If something is actually broken on dev, it's a blocker — say so, don't disguise a defect as a footnote. Smuggling a real bug in here is the one thing that makes this section worse than leaving it out.

### 4. Test scenarios

The concrete things to do on the environment, each with the **expected result** so pass/fail is unambiguous:

- **Happy path** — numbered `action → expected`, the main flow that proves the change works on dev. Each line is something QA literally does in the UI/API and what they should see.
- **Edge / error paths** — drive the cases tied to each AC's `on error / at boundary:` clause and (for a fix) the original reproduction: bad input, the limit, the unauthorized user — and the correct response each time.
- These are **the starting set QA runs and extends** — QA still owns final coverage and (if applicable) records the automated side in `tests.md`. The note gives them the on-environment scenarios the implementer already knows matter.

## Type-aware emphasis

The four sections are constant; which leads shifts by `Type`:

- **`feat`** — Section 1 is usually heaviest (a brand-new screen/endpoint to find). Scenarios walk the new flow end to end on dev.
- **`fix`** — **Section 4 leads.** Reproduce the original bug *on dev* using the exact `spec.md > Reproduction` steps, then state what happens now instead. Known limits notes any related-but-unfixed cases.
- **`refactor`** — the change should be **invisible to the tester**: same screens, same results. Section 4 = "behaves identically — here's how to confirm against the previous/prod behaviour"; Known limits names any *intentional* behaviour change so QA doesn't treat it as a regression.

## `qa-note.md` blueprint — copy this, then delete empty sections

```markdown
# QA Note: <title>

**Run**: .workflow/<id>/ · **Type**: feat | fix | refactor
**Spec**: [./spec.md](./spec.md) (acceptance criteria) · **Automated tests**: [./tests.md](./tests.md)
**Environment**: <https://dev.example.com> · **Deployed build**: <branch / tag / build #>

> Black-box guide for testing on the dev environment. Acceptance criteria live in spec.md. No need to run any code.

## 1. Where & how to access it on dev
- **Login**: <account / role> — credentials: <where to get them, NOT the password>
- **Go to**: <Menu → Submenu → Screen> (or: <how to reach the record/state>)
- **API** (if any): `<METHOD> <base-url>/<path>` · auth: <token source / header> · sample body: `{ ... }`
- **Test data**: <seeded account / sample IDs / how to create one>
- **Feature flag / config**: <toggle that must be ON, and how it's set on dev — else delete>

## 2. Focus areas & risk hotspots
- <screen / flow / endpoint> — <why it's risky: new flow / multi-step state / slow list / external call>
- **Also re-check**: <existing screens the change could ripple into>
- **Push hard on**: <inputs / sequences worth stressing>

## 3. Known limits / not covered
- <deliberate out-of-scope — don't raise as a bug>
- <not on dev yet / behind an OFF flag / dependency still mocked>
- <role / environment / data NOT exercised this run>

## 4. Test scenarios
**Happy path**
1. <action on dev> → <expected result>
2. <action on dev> → <expected result>

**Edge / error**
- <bad input / limit / unauthorized user> → <expected behaviour>
<!-- fix: reproduce spec.md Reproduction on dev, then "now does X". refactor: confirm identical to before. -->
```

Fully-filled examples live in `references/` — open **only the one matching your run's `Type`** (don't load them all), for the level of concreteness to aim for:
- `references/example-refund.md` — a `feat` run (order refunds; gateway-backed flow).
- `references/example-fix-coupon.md` — a `fix` run (Section 4 leads: reproduce the bug on dev, then confirm it's gone).

## Quality bar — self-review before handoff

- **Concrete access** — real URL, real account/role, real menu path, real endpoint. No "log in as usual", no "the refunds page".
- **Expected result on every scenario** — each step says what QA should *see*, so a fail is obvious. A scenario with no expected result isn't testable.
- **No code, no repo** — nothing tells QA to clone, install, run, or read source; no `npm test`; no file/function references.
- **No restated AC** — link to `spec.md`; don't copy the criteria.
- **No secrets** — accounts are named with a pointer to where credentials live; passwords/tokens are never inlined (mirrors the repo's `protect-secrets.sh`).
- **Honest limits** — every "known limit" is deliberate, not a hidden bug.
- **Matches what's deployed** — describes the build actually on dev, not the diff's intent.
- **Skimmable** — a tester is oriented in under two minutes.

If a section has nothing real (e.g. no API surface → no API line), **delete it**. An invented hotspot or a guessed URL is worse than its absence.

## Anti-patterns (do not do these)

- **Telling QA to run the code** — "clone the repo", "npm run dev", "npm test". They test the deployed environment; if a step needs source, it's in the wrong doc.
- **Code-level references** — `path#anchor`, function names, file diffs. QA can't see the code; describe the screen/flow/endpoint instead.
- **"Log in as usual" / "go to the right page"** — name the exact account/role and the exact click path.
- **Scenarios with no expected result** — "try creating a refund" isn't a test. "Create a refund for order #1001 → status flips to `Refunded`, customer balance +฿500" is.
- **Pasting a password or token** — name the account and where the credentials live.
- **Restating the acceptance criteria** — link to `spec.md`; a copy drifts.
- **Burying a real bug under "known limitations"** — if it's broken on dev, it's a blocker, not a limit.
- **Writing it before the change is deployed** — you'd be guessing the URL/path/state. Write it once it's actually on dev.
- **A wall of prose** — four skimmable sections, bullets over paragraphs.

## Relation to other skills / artifacts

This skill **composes**; it doesn't replace:

- `spec.md` (owned by `pm`) — source of *what / why* + acceptance criteria. The note points at it; the scenarios exercise the AC on the environment.
- `plan.md` (owned by `lead`) — blast radius + risks are the raw material for Focus areas and Known limits.
- `tests.md` (owned by `qa`) — the **automated** counterpart. `qa-note.md` guides the **manual on-environment** pass; both can run for the same change.
- [[debug-fundamentals]] — for `fix` runs, the reproduction it produced is what Section 4 replays *on dev*.
- [[refactoring-fundamentals]] — for `refactor` runs, the behaviour baseline is what QA confirms stayed identical on the environment.

In a `/dev` run the orchestrator (main agent) is the *caller* — it invokes this skill at handoff. The skill writes the artifact; it does not spawn an agent or change the phase matrix.

## When to skip

- `chore` / `docs` / `spike` runs — no QA pass on the environment.
- Throwaway one-off scripts and single-line edits.
- Pure internal changes with nothing a black-box tester can observe on dev (leave it to `tests.md`).
- When you are the only one testing it and already know the environment cold — though a three-line access + scenario note still usually pays for itself.
