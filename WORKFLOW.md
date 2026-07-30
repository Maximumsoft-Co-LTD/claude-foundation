# Workflow

A spec-driven, two-phase pipeline (interview → plan → Contract Gate → autonomous build) that scales machinery to evidence. **Fast first:** cut round-trips, re-reads, duplicate ledgers, and unjustified spawns, never required verification. **Floor:** Contract Gate and state/resume for every run; code-type Test + Ship Gate; triggered independent Review/Security; the security scan and fix/refactor contracts.

**Version 2.12.0** — tracks the release in [`VERSION`](VERSION) (source of truth) and [`CHANGELOG.md`](CHANGELOG.md).

Primary entry point: `/dev <intent>` (or `/dev --resume <id>`). The command detects context (new vs. existing codebase) and runs the same two-phase flow, branching on **run type** so a `chore` isn't dragged through e2e and a `fix` reproduces before it changes anything. Same artifacts either way, in `.workflow/<id>/`.

**Team mode** ([below](#team-mode--run-one-role-on-its-own)) splits that flow into role-scoped commands — `/spec` (pm), `/dev-plan` (lead), `/test-plan` (qa), `/uxui-plan` (uxui), `/implement` (Phase 2) — each writing into the **same** `.workflow/<id>/` run so the artifacts compose exactly as a one-shot `/dev` run; `/dev --resume <id>` (or `/implement`) carries it the rest of the way.

> **Orchestration runs in the main agent, not a sub-agent** — a sub-agent **cannot call `AskUserQuestion`**, so `/dev` loads [`.claude/orchestrator.md`](.claude/orchestrator.md) and the main agent runs the interview + drives the flow; sub-agents (`pm`, `lead`, `engineer`, `qa`, `retro`) do the file work, mostly fanning out their own helpers directly (mechanics: [`fanout-dispatch.md`](.claude/orchestrator/references/fanout-dispatch.md)). `state.json` stays single-writer regardless — helpers never write it.

## Flow at a glance

The happy path with its three feedback loops (test, review, security): diamonds are decision points, the dotted edge is the `--resume` re-entry, and phase numbers match the [type-aware matrix](#type-aware-phase-matrix) below. **Test runs before review** so reviewers judge a green suite; every blocking finding loops back through implement → test before ship.

```mermaid
flowchart TD
    Start(["/dev &lt;intent&gt;"]) --> Setup["Setup (orchestrator)<br/>read INDEX · pick NNNN-type-slug · create folder · copy state.json"]

    subgraph P1["Phase 1 — Requirements (interactive)"]
        direction TB
        S1["1. Interview + spec<br/>main/fork when warm · combined lead only by proof"]
        S2["2. Plan<br/>same Design executor"]
        S2T["Test plan<br/>same executor · separate qa only by proof"]
        S3{"3. Contract Gate"}
        S1 --> S2 --> S2T --> S3
    end

    Setup --> S1
    S3 -- "revise (incremental, in-run) / swap" --> S1
    S3 -- "approve" --> S4

    subgraph P2["Phase 2 — Implementation (autonomous)"]
        direction TB
        S4["4. Implement<br/>engineer · fix → failing test first"]
        S5{"5. Change Gate · Test<br/>Impacted · AC evidence"}
        S6{"6. Change Gate · Review<br/>semantic + contract risk"}
        S7{"7. Security<br/>trigger-based · lead"}
        SG{"Ship Gate<br/>Full + lint/type/static"}
        S8["8. Docs touch-up<br/>engineer"]
        S9["9. Ship<br/>engineer · opt-in commit/PR (default no)"]
        S10["10. Retro<br/>retro.md · memory + skill candidates"]
        S4 --> S5
        S5 -- "pass" --> S6
        S6 -- "pass" --> S7
        S7 -- "pass / not triggered" --> SG --> S8 --> S9 --> S10
    end

    S5 -- "fail · ≤3 cycles" --> S4
    S6 -- "blocking · ≤2 cycles" --> S4
    S7 -- "high finding" --> S4

    S10 --> Skill["skill-creator<br/>per user-approved candidate"]
    Skill --> Done(["Summary · done"])

    Resume(["/dev --resume &lt;id&gt;"]) -. "continue from state.json cursor" .-> P2
```

## Naming convention

A stable, sortable run ID so every artifact, index row, and resume cursor points at the same run: **`NNNN-<type>-<kebab-slug>`**

- `NNNN` — 4-digit sequential counter; `orchestrator` reads `.workflow/INDEX.md` to pick the next.
- `<type>` — conventional-commits: `feat` | `fix` | `refactor` | `chore` | `docs` | `spike`
- `<kebab-slug>` — ≤5 words, lowercase, hyphenated. No dates (the index tracks them).

Examples: `0001-feat-todolist-app`, `0003-fix-login-redirect`, `0004-refactor-auth-middleware`.

## Folder layout

One self-contained folder per run, plus the shared registry and templates.

```
.workflow/
├── INDEX.md                       # registry: id, type, title, status, dates
├── FOLLOWUPS.md                   # carry-over items surfaced by past retros
├── _templates/                    # blueprints — copy, don't edit in place
│   ├── spec.md  plan.md  test-plan.md  uxui-plan.md
│   ├── review.md  tests.md  security.md  recommendations.md
│   ├── retro.md  epic.md
│   └── state.json                 # per-run resume cursor
├── 0001-feat-todolist-app/
│   ├── state.json  spec.md  plan.md  test-plan.md
│   ├── review.md  security.md     # security.md only if the review fired
│   ├── tests.md  retro.md
└── 0003-fix-login-redirect/ ...
```

Rules:
- One folder per run — never mix work.
- `_templates/` is the source of truth for shape — copy on start, never edit in place.
- `INDEX.md` append-only on start, status-updated as phases progress; `retro` writes `Finished`.
- `FOLLOWUPS.md` shared — `retro` appends, `pm` reads each interview for in-scope carry-overs.
- `state.json` is the per-run resume cursor, written after each step.
- Parallel runs are independent (folder IDs); overlapping files → `lead` flags it in `risks`.

## Artifacts

Every artifact has a template in [`.workflow/_templates/`](.workflow/_templates/) (filename = template name). Agents copy the template into the run folder and fill it in — never write freeform.

| File | Owner | Purpose |
|---------|---------------|----------|
| `spec.md` | current Design executor (main/fork/combined `lead`); `pm` only in proof-gated split chain or `/spec` | **Goal**, **User Stories** (P1/P2/P3, Given/When/Then **acceptance scenarios** with `AC#` ids), **Functional Requirements** (FR-###), **Success Criteria** (SC-###), key entities/edge cases/users/scope, **Type**, bug-repro (fix), timebox (spike), assumptions |
| `run.md` | orchestrator (XS micro-lane) | **Single XS artifact** replacing spec/plan/tasks/test-plan — same contract core (Goal, `**Type**:`, `AC#`, `T###`+`verify:`, Coverage); `SIZE_UPGRADE: S` re-emits the four files (`xs-s-fast-path.md`) |
| `context.md` | main; explorer only for a material context gap | **Shared brownfield-M/L understand map** — seeded from the repo ledger and a bounded walk, built once so later phases do not re-walk |
| `plan.md` | current Design executor | **Summary** + **Technical Context** + **Gate check**, phases, architecture, current state, files, risks, rollback |
| `tasks.md` | current Design executor | Dependency-ordered `T### [AC#] … verify:` tasks tied to acceptance scenarios |
| `test-plan.md` | current Design executor; separate `qa` only by proof | Coverage per AC, edge cases, fixtures/env, regression/baseline contract and targets |
| `uxui-plan.md` | `uxui` (team mode) | **Design-time UX plan** for UI work — Scenes, ASCII wireframes, Scenarios, UX direction & components, AC↔scene mapping. Written by `/uxui-plan` (not a linear state-machine step); `frontend-design` builds from it, `qa`'s Visual verification checks against it |
| `review.md` | main for mechanical work · independent `lead` for runtime M/L/security | Tasks-adherence + **acceptance verification** against `spec.md` |
| `security.md` | `lead` (security mode) | Security findings; only when the diff trips the sensitive-paths trigger |
| `tests.md` | main for known harness · `qa` only by tooling/context proof | **Test execution record** — AC↔test mapping, results, regression check, coverage, edge gaps |
| `recommendations.md` | `engineer` (spike) | Spike deliverable — what we learned, recommended next step. Replaces test/ship phases. |
| `retro.md` | main; `retro` only for substantial synthesis | What worked, what to change, memory + skill candidates, commit/PR refs |
| `epic.md` | `lead` (rare) | Decomposition into slices when `Ship as: staged` + ≥2 capabilities |
| `state.json` | `orchestrator` | Resume cursor plus workload route, orchestrator turn budget, foreground worker lifecycle, reported/observed spawns, and separated elapsed/active/human/worker/reconcile timing |

## Contract Gate

The workflow runs this deterministic check before human approval; it is also available by hand / pre-commit / CI:

```sh
sh .claude/hooks/artifact-lint.sh --contract .workflow/<id>/
```

Per directory it runs the type-aware artifact checks plus required-artifact validation, unresolved-marker detection, and exact AC-set equality across spec/run, tasks, test plan, and UX map. Human approval then validates intent and hard-to-reverse decisions instead of recounting structure. Prints `[OK]`/`[FAIL]`, exits non-zero on failure, and remains POSIX `sh` + standard `grep`/`awk`. Fixtures: [`run-artifact-lint-tests.sh`](.claude/hooks/tests/run-artifact-lint-tests.sh).

## Type-aware phase matrix

Type decides *which* phases run: `orchestrator` **skips or specializes** some by `Type` — ✓ runs, `skip` records "skipped — type=<x>" and moves on, `light` is a thinner pass. (How *much* machinery each phase gets is orthogonal — `.claude/orchestrator/references/size-execution.md`.)

| Phase | feat | fix | refactor | chore | docs | spike |
|-------|------|-----|----------|-------|------|-------|
| 1. Interview + spec | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (timeboxed) |
| 2. Plan | ✓ | ✓ (task 1 = regression test) | ✓ (equivalence note; baseline-capture task 1 if coverage thin) | ✓ | ✓ | ✓ (exploration plan) |
| 2½. Test plan | ✓ | ✓ (regression contract) | ✓ (baseline contract) | skip | skip | skip |
| 3. Gate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4. Implement | ✓ | ✓ (regression test FIRST, then fix) | ✓ | ✓ | ✓ | ✓ (exploration) |
| 5. Test | ✓ | ✓ (regression must pass) | ✓ (verify vs captured baseline) | skip | skip | skip |
| 6. Review | ✓ | ✓ | ✓ | ✓ · skip @XS | ✓ · skip @XS | light |
| 7. Security review | trigger-based | trigger-based | trigger-based | trigger-based | trigger-based | skip |
| 8. Docs touch-up | ✓ | optional | optional | optional | ✓ | skip |
| 9. Ship (stage + opt-in commit/PR) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 10. Retro | ✓ · **no `retro.md` @XS** | ✓ · **no `retro.md` @XS** | ✓ · **no `retro.md` @XS** | ✓ · **no `retro.md` @XS** | ✓ · **no `retro.md` @XS** | ✓ |

**Required vs optional — the phase contract.** Required for every run:
**Interview + spec · Plan · Contract Gate · Implement**. For code-bearing
`feat`/`fix`/`refactor`, **Test plan · Change Gate Test · Ship Gate** are also
required. Independent **Review** becomes required when runtime behaviour is M/L
or Implement was volume-routed to Sonnet; a fired **Security review** is required.
These checks cannot be gate-skipped. `chore`/`docs`/`spike` keep their matrix
specializations. Optional work is **Docs touch-up · commit/PR Ship effects ·
Retro · non-triggered lightweight Review** and may be set to `light`/`skip`,
recorded in `state.json > phase_plan` + `skipped_steps`.

Two things stay on no matter what you skip, because both are near-free and cover a
failure you cannot see afterwards: **the `state.json` writes** (they are what
`--resume` keys off, and cutting them makes runs drift) and **the security-trigger scan**
(a name-only path check, not the review; it costs one pass over the changed-file
list and is the only thing standing between a trust-boundary diff and silence). If
you want the trigger scan off too, say so — it is one line — but it is off by
choice, never by default.

**Three authoritative quality gates.** Contract Gate owns artifact structure,
cross-artifact AC equality, declared evidence classes, and command execution
contracts. Change Gate owns actual executable/observable AC evidence (`tests.md`),
validates evidence level plus expected test groups/minimum discovery, and adds
independent semantic/risk review when triggered. Ship Gate owns one final
Full-suite + lint/type/static run per converged diff. Engineer task verifies are
local implementation feedback, not a second AC ledger; Review consumes Test
evidence and does not rerun or copy every AC row.

**Retro at XS writes no `retro.md` — and this one is safe to cut on argument, not just measurement.**
Close still runs: `done_at` is stamped, `INDEX` moves to done, follow-ups are appended, and the
run's deltas fold into `.workflow/KNOWLEDGE.md` (that fold is the part that pays — it is what makes
the *next* run cheaper). What goes is the retrospective *document* for a one-line change nobody
will reopen. **Why it is safe:** Close runs after Ship, so nothing it does can change the delivered
code — a retro cannot make the diff better or worse. Measured: Close is **22% of an XS run's
stamped wall clock**. When Review + Docs + Retro were skipped together the judge fell 9 → 8, so the
quality cost lived in Review or Docs; Retro is provably not where it came from, and it is the only
one of the three that can be cut on a proof rather than a hope. M/L keep the full retro.

**Ship commit — opt-in, default `no`.** Ship always runs (isolates the diff, scans secrets); whether it commits/pushes/PRs is the gate's call — lever + `commit_on_ship` mechanics: `.claude/orchestrator/references/gate.md`. Independent of `fix`/`refactor`'s in-`implement` commits for the regression/baseline contract — those land at Implement, not here.

**Review at XS for `chore`/`docs` — default skip.** A size×type default, not a per-line deviation. Mechanics: `.claude/orchestrator/references/size-execution.md` (Review row).

**Defaulting Review/Docs/Retro to `skip` at XS was measured and rejected.** Turning phases off does not make the run cheap — the cost is not in the phases but in boot and Design — and quality fell with them. They stay **optional** (you can skip any of them at the gate); they are just not off by default.

**Test plan.** Design-time coverage/edge-case/regression contract, signed off at the gate, run at Test. Authorship by size: `.claude/orchestrator/references/size-execution.md` (Test-plan row).

**Greenfield vs brownfield (the `field`).** Gates the brownfield **understand → lock → change** discipline (greenfield skips both). Canonical def + picker: `plan-writing > references/size-tiering.md > Greenfield vs brownfield`.

### Security trigger

Security review runs when the diff touches any of: auth/session/token, password handling, crypto primitives, SQL/query building, raw HTML rendering, file/path handling, exec/shell, deserialisation of untrusted input, secret-bearing files (env/config), or new external network endpoints. **Not a trigger on its own — first-party browser-storage round-trip:** the app reading back its own single-user `localStorage`/`sessionStorage`/`IndexedDB` via `JSON.parse` is *not* untrusted deserialisation and does not fire Security review — **provided** the diff has no dangerous sink (`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`Function`/`dangerouslySetInnerHTML`/jQuery `.html()`/any HTML-injection sink — **open list**; any such sink is itself a "raw HTML rendering" trigger and fires regardless). It also fires when the stored data crosses a real trust boundary (multi-user/shared-device threat model, or data written by a server or another principal). `orchestrator` decides; `lead` executes in security mode via the inline checklist. **One spawn:** the trigger check runs before Review, and a fired trigger extends the same `lead` review spawn with security mode (`review.md` + `security.md` from one spawn, opus) — the phase, its blocking semantics, and the matrix row are unchanged.

### Rendered smoke + E2E/visual

Cheap real-browser **rendered smoke** is required whenever an AC declares
`rendered` evidence: visibility, contrast, focus indication, critical viewport and
interaction. jsdom/happy-dom can prove structure/logic but cannot satisfy that row.
Full browser **e2e + visual/a11y** remains opt-in through
`state.json > e2e_visual`; `off` removes slow journeys/snapshots, not rendered
evidence. Mechanics: `qa.md` and `phase-2-guards.md > Test`.

### Workload route and foreground workers

Every run records `work_profile`, `risk`, `ambiguity`, `evidence`, `volume`, and
`coupling`. Ambiguity controls Interview depth; evidence controls Test; volume
controls Implement; risk controls Review/Security; coupling controls context/fanout;
field controls understand/lock. Size remains the ceiling. Phase workers are
foreground with a structured terminal result; ordinary background phase spawns are
guard-blocked, preventing partial-tree decisions and Reconcile work.

### Per-task phase plan (deviation from the matrix)

The matrix is the **default, not the final word**. `lead` writes a reasoned **`## Phases for this task`** block. **Review** and **Docs** are discretionary unless a Review trigger fires; Test is discretionary only for non-code types the matrix already skips. A disposition turning an optional matrix-`✓` into `light`/`skip` is a **deviation**: tag it `(deviates from matrix)` with a one-line justification.

**Plan-authored deviations:** `lead` may proactively vary only optional **Review and Docs**. It may not pre-skip Interview + Spec, Plan, Contract Gate, Implement, code-type Test/Ship Gate, a fired Review/Security check, or the security-trigger scan. Commit/PR effects and Retro remain gate options.

**The gate owns the deviation, not the plan** — every optional deviation needs explicit per-line confirmation, never a plain `approve`; required quality gates refuse a skip. Lever syntax + state mechanics: `.claude/orchestrator/references/gate.md`.

This subsection is the **canonical definition**; `plan.md`, `lead.md`, and `orchestrator.md` point here.

### Fanout plan & size-aware execution (split out)

Two canonical blocks live in their own reference files (gate-owned, unchanged in force):
- **Fanout plan** (the gated `## Fanout plan` block `lead` declares, the gate lever, telemetry) → [`.claude/orchestrator/references/fanout-dispatch.md`](.claude/orchestrator/references/fanout-dispatch.md).
- **Size-aware execution matrix** (how much machinery each phase gets per XS/S/M/L, the patch lane, fanout availability, the multi-repo boundary) → [`.claude/orchestrator/references/size-execution.md`](.claude/orchestrator/references/size-execution.md).

## Skill routing

Skill-per-decision routing, triggers, and full run order: `.claude/rules/fundamentals.md` (always-on router). Load the narrowest skill for the current decision.

### Skill-load budget (critical path)

Default: load no full skill body on the hot path — at most one targeted `references/<file>` section. Canonical: `.claude/rules/fundamentals.md` + `CLAUDE.md > Working agreements`.

Phase names below match the matrix; row numbers stay display-only in the table and diagram. The orchestrator runs setup actions (read INDEX, pick ID, create folder, copy state.json, append INDEX row) before phase 1 — its op 1 (Setup); the orchestrator script now counts **9 ops** (Setup · Interview · Design · Gate · Implement · Test · Review+Security · Ship · Close), local to that file.

## Phase 1 — Requirements (interactive)

Turn a rough intent into a signed-off spec + plan + test plan before code. The resolver keeps Design inline/fork when interview and code map are warm at any size, otherwise uses one combined `lead`. The L `pm → lead → qa` split requires independent substantial slices; size alone never triggers it. Gate confirms every AC.

## Phase 2 — Implementation (autonomous after approval)

Build and prove the contract. Micro implementation stays inline; substantial planned generation (≥3 code tasks/files, a test-fix loop, or >~2K expected output) routes once to a bounded Sonnet engineer even when main Opus is warm. Known tests, docs, ordinary git commands, and Retro stay inline. Runtime-behaviour M/L gets one independent Review, and Security gets isolation when triggered. Each worker records its spawn proof; size alone proves neither a spawn nor an Opus escalation.

## Scope: when to split (rare path)

**Default:** one `/dev` run, regardless of file/step count or layers touched. Crossing DB + API + UI is normal full-stack work, NOT a reason to split.

`lead` enters epic mode **only when both are true**:
1. The spec lists ≥ 2 capabilities that can ship to users independently, **and**
2. `Ship as: staged` is set in `spec.md`.

If only one is true → one `plan.md`. A heavy plan (say >15 steps) gets a note in `plan.md > Risks` ("scope is on the larger side") — **do not split**. The `Ship as` answer is captured in the Phase 1 interview and recorded in `spec.md` frontmatter — the user's call, not the planner's.

### Epic mode flow

1. `lead` writes [`epic.md`](.workflow/_templates/epic.md) (2–5 vertical slices, each independently shippable) instead of `plan.md`.
2. `INDEX.md` status for this ID = `epic`. No implementation runs against this folder.
3. `lead` recommends a starting slice and opens a child `/dev` run (e.g. `0006-feat-audit-viewer`) with `Parent: 0005-feat-audit-system` in its `spec.md`.
4. Remaining slices are separate `/dev` runs later, each referencing the same parent.
5. User can `swap <n>` at the gate to pick a different first slice.

## Agent map

Five sub-agents drive the `/dev` file work, plus the team-mode `uxui` designer (spawned only by `/uxui-plan`). The **orchestrator is not a sub-agent** — the main agent plays that role, per [`.claude/orchestrator.md`](.claude/orchestrator.md). Models + tools per agent: [`.claude/agents/INDEX.md`](.claude/agents/INDEX.md) (canonical).

| Role | Where it runs | Phase steps | Reads | Writes |
|------|---------------|-------------|-------|--------|
| `orchestrator` | main agent | drives all + interview | user input, INDEX, FOLLOWUPS, `state.json` | INDEX, `state.json`, follow-up cursor |
| `pm` | sub-agent | 1 (spec) | intent, interview Q&A, FOLLOWUPS | `spec.md` |
| `lead` | sub-agent | 2, 6, 7 | `spec.md`, codebase, diff | `plan.md`/`tasks.md`/`epic.md`, `review.md`, `security.md` |
| `engineer` | sub-agent | 4, 8, 9 | `tasks.md`, `plan.md`, `spec.md`, diff | source, commit, PR |
| `qa` | sub-agent | 2½, 5 | `spec.md`, `plan.md`, `tasks.md`, `test-plan.md`, diff | `test-plan.md`, `tests.md` |
| `retro` | sub-agent | 10 | all artifacts, diff, memory/skills, FOLLOWUPS | `retro.md`, INDEX, FOLLOWUPS |
| `uxui` | sub-agent (team) | `/uxui-plan` only | `spec.md`, design system | `uxui-plan.md` |
| `team-*` | workers | fanout phases (1,2,4,5,6,7) | scoped question/area/slice | findings only, no artifact write |

**Sub-agent constraints** (full mechanics: [`fanout-dispatch.md`](.claude/orchestrator/references/fanout-dispatch.md)): splittable agents (`pm`/`lead`/`qa`/`engineer`/self-splitting `team-*`) hold `Agent` and direct-nest helpers one level deep, never writing `state.json`; a multi-repo run additionally splits test/review/security one helper per changed repo (Implement/gate/ship stay pinned to `repo_root`). Sub-agents can't call `AskUserQuestion` — ambiguity returns `BLOCKER:` and the orchestrator surfaces it. **Skill handoff:** when `retro` surfaces candidates and the user approves, the orchestrator invokes `skill-creator` for each — never silently.

### Anti-bias rule

Review is checklist-driven regardless of executor. Runtime-behaviour M/L changes use a cold `lead` for independence; mechanical/docs/config changes may stay inline. Size alone does not buy a reviewer or fanout.

## Team mode — run one role on its own

Build the same artifacts role-by-role instead of one monolithic run, each writing into the **same `.workflow/<id>/` folder** so they compose; carry it the rest of the way with `/dev --resume <id>`. **Cost note:** team mode skips the XS–M combined fast path (`/spec` always spawns `pm`), so anything below L prefers one-shot `/dev` when a single flow will do.

| Command | Role | Writes | Notes |
|---------|------|--------|-------|
| [`/spec`](.claude/commands/spec.md) | `pm` | `spec.md` | Runs the interview, `pm` writes the spec; stops at `step=spec`. Pass a run id (not an intent) to refine an existing spec. |
| [`/dev-plan`](.claude/commands/dev-plan.md) | `lead` (plan) | `plan.md`/`epic.md` | Needs a ready spec; stops at `step=plan`. No gate, no implement. |
| [`/test-plan`](.claude/commands/test-plan.md) | `qa` (test-plan) | `test-plan.md` | Needs a spec; spec-only if no plan yet. None for `chore`/`docs`/`spike`. |
| [`/uxui-plan`](.claude/commands/uxui-plan.md) | `uxui` | `uxui-plan.md` | UI only — Scenes, wireframes, Scenarios, AC↔scene mapping; not a linear step. |
| [`/implement`](.claude/commands/implement.md) | `engineer`+`lead`+`qa`+`retro` | source, `review.md`, `tests.md`, `retro.md`, commit/PR | **Phase 2 entry point** — confirms spec+plan+test-plan ready, gates if unapproved, then runs the full autonomous build. Interchangeable with `/dev --resume <id>` mid-build. |

Same main-agent-as-orchestrator + spawn-guard mechanics as `/dev`. Typical flow: `/spec` → `/dev-plan`+`/test-plan`+`/uxui-plan` (if UI) fired together **in parallel**, each writing its own `state.<slice>.json` shard → `/implement` (gate folds the shards → build → ship). Full sharding + backfill mechanics: [`team-mode-sharding.md`](.claude/orchestrator/references/team-mode-sharding.md).

## Example: `/dev create todolist app`

S-size greenfield: one interview batch → inline artifacts → Contract Gate → optional volume-routed Sonnet Implement → Change Gate → Ship Gate → merged Docs+Ship worker → inline Retro. **One baseline Docs+Ship spawn, up to two when Implement volume fires; Security may add isolation.**

## Example: `/dev fix login redirect loop`

`spec.md` (fix, repro: admin login loops to `/login`) → regression-first plan → Contract Gate → Implement → Change Gate confirms fails-before/passes-now + semantic/security review → Ship Gate → optional commit → Retro.

## Example: `/dev refactor extract pricing engine from OrderService`

M-size brownfield with warm context: main writes the equivalence plan + golden-master contract inline → Contract Gate → bounded Sonnet Implement → Change Gate runs Impacted + independent semantic review → Ship Gate runs Full/lint/static → deterministic ship + Retro inline.

## Example: `/dev spike compare bullmq vs sidekiq`

`spec.md` (spike, 1-day timebox, deliverable=recommendation) → `lead` writes an exploration plan → gate (runs interview→plan→gate→implement→review→retro only) → `approve` → engineer explores both, writes `recommendations.md` → light review → retro → user decides on follow-up `feat` runs.

## Stop conditions

Where the run pauses, loops, or escalates instead of charging ahead.

- `revise` at the gate (or free-form chat) → targeted in-run edit of the affected sections only, re-verify, re-present. Never a fresh Phase 1.
- `skip <n>`/`run <n>` at Contract Gate changes optional work only. Code-type Test plan/Test/Ship Gate, triggered independent Review/Security, and the always-required phases refuse. Optional Docs, commit/PR effects, Retro, and non-triggered lightweight Review are recorded in `phase_plan`.
- Test failures → fix → re-run, ≤3 cycles, then escalate.
- Reviewer blocking issues → fix → re-test → re-review, ≤2 cycles, then escalate.
- Security `high` finding → fix → re-test → re-review → re-security, counts against the review budget.
- Any agent unsure → stop and ask, never invent requirements.
- Context exhaustion / cancel → `/dev --resume <id>` continues from `state.json`'s recorded step.
