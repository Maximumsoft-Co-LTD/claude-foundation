---
name: plan-writing
description: Write an implementation plan that maps a spec to executable, verifiable steps with a required architecture diagram, sized XS/S/M/L. Use when drafting `.workflow/<id>/plan.md` in the /dev workflow (lead agent, Phase 1 step 2), or when the user asks to "write a plan", "plan this feature", "break this down", "draft an RFC". Owns size tiering, the mermaid diagram by Type, current-state mapping, inline AC tagging, runnable-verify and anti-placeholder rules, and the pre-draft self-review. Skip throwaway scripts, single-line config edits, and un-spec'd design conversations.
---

# Plan Writing

## Why this exists

Plans fail in predictable ways: they restate the spec instead of decomposing it, they hide approach-decisions in prose, they let "TBD" and "appropriate error handling" leak through, they describe a feature without showing where it plugs into the system, they say "manually verify" when they should name a command, and they ship without acceptance-criteria traceability — so the first time AC1 actually gets verified is during review, by which point the cycle budget is already half-spent.

A plan that scales with the work, carries a diagram, ties every step to an AC, and gives every step a *runnable verify* catches those failures at plan time — minutes spent here save hours in review and test cycles. This skill is the pre-flight for the `/dev` workflow's Phase 1 step 2 (lead agent, plan mode), and the standard whenever a plan is being drafted in this repo.

## The 10 principles

### 1. Read spec.md + carried follow-ups before anything else

A plan that doesn't map back to spec is blind. Open `spec.md`, list every `Acceptance criteria` checkbox, check `Carried-over follow-ups`. Every plan step must tie to either an acceptance criterion or a carried follow-up — if it ties to neither, it's scope-creep and belongs in `FOLLOWUPS.md`, not this plan.

### 2. Set Size before drafting Steps

Size determines which sections are required, which are optional, and which should be deleted. Choose XS / S / M / L using the picker in `references/size-tiering.md`. Wrong size = either bloat (XS work in M template) or under-coverage (M work treated as S). **When borderline, prefer the larger tier** — under-covering costs cycle burn at review; over-covering costs a few skipped sections.

| Size | Trigger signals |
|------|-----------------|
| **XS** | chore / docs, 1 file, no logic change (typo, dep bump, comment cleanup). If you can describe the diff in one sentence, it's XS. |
| **S** | 1 subsystem, ≤ 2 files, simple logic |
| **M** | multi-file in one subsystem, real logic (branching, state, side effects), no contract / schema change |
| **L** | cross-subsystem, schema migration, public API contract change, or any breaking change |

### 3. Map current state before designing (non-greenfield work)

A plan that touches existing code without first stating what that code does today is gambling. The plan reads as if greenfield, the architecture diagram shows only new pieces, and the engineer discovers each load-bearing invariant by breaking it. Catching this at plan time costs a few LSP queries; catching it at review or production time costs a cycle or a postmortem.

**Required for** (write a full `Current state` section before the Architecture diagram):
- Any **M** or **L** plan
- Any **refactor** or **fix** at any size (including XS/S)

**Skip for**:
- XS/S **feat** that adds entirely new files in an isolated module with no edits to existing code
- **chore** / **docs** that don't touch live code paths
- **spike** (the spike *is* the current-state investigation — record findings in `recommendations.md`, not here)

**Fields** (in this order; cite `path#anchor` for every claim — LSP go-to-definition / find-references is the source, not prose memory; anchor format is defined in principle 5):

1. **Entry point(s)** — where execution begins for the code path being changed. Examples: HTTP route handler, CLI subcommand, cron tick, queue consumer, hook trigger, library entry function.
2. **Data / control flow** — 3–7 bullets tracing how the system behaves today through the file(s) you will touch. One hop per bullet, each citing `path#anchor`. Don't paraphrase — walk it with LSP.
3. **Callers / blast radius** — for each symbol you will rename, delete, or change the contract of: run LSP find-references and summarise. "N callers; non-obvious ones are X (`path#anchor`) and Y (`path#anchor`)". "No callers — safe to change" is a valid answer and explicitly load-bearing.
4. **Invariants the current code relies on** — silent assumptions you must either preserve or *explicitly* break: ordering, idempotency, fail-open vs fail-closed, error-swallowing semantics, transaction boundaries, single-writer assumptions, retry behaviour, timeout defaults, encoding. Each invariant is one line with a `path#anchor` citation. The new code must either preserve each or the plan must call out the break and justify it.
5. **Anti-goals** *(refactor only)* — current behaviours that intentionally stay identical, paired with the behaviour-equivalence statement in Approach. These are what the test suite will pin.
6. **Bug path** *(fix only)* — the exact route the bad data / bad call takes from input to symptom, with the wrong-step marked `← BUG`. This is the as-is of the failure; the Architecture diagram shows the fix.

For **L** tier and any non-trivial **refactor**, also draw an "as-is" mermaid diagram alongside the "to-be" Architecture diagram (principle 4). For M and smaller, prose bullets are usually enough.

Full field-by-field examples + LSP-walk technique are in `references/current-state.md`.

### 4. Architecture diagram is required, always

Pick the cheapest form that conveys the change. Mark new pieces with `★`. Diagram type defaults from the run's `Type` (full templates and worked examples in `references/diagrams.md`):

| Type | Default diagram |
|------|-----------------|
| `feat` | `flowchart LR` showing where the new piece plugs in |
| `fix` | `sequenceDiagram` of the bug path with the fix point marked, OR before/after flowchart |
| `refactor` | before/after `flowchart` or `classDiagram` of the structural shift |
| `chore` / `docs` | one line: `<file> (<change>)` OR `**Impact:** N/A — <reason>` |
| `spike` | `flowchart` with `?` on unanswered nodes |

For XS, even one line counts — keep the section. The discipline is "always have a diagram slot": habit beats exception.

When Current state (principle 3) is present, the Architecture diagram is the *to-be* — show how the existing flow changes. Don't redraw the whole as-is in the to-be diagram; that's the previous section's job.

### 5. Steps use the strict format: `action — path#anchor (new|edit|delete) — verify: <command or observable> [AC#]`

Every step has all four parts. No exceptions.

- **action** — imperative, one verb (`add`, `extract`, `wire`, `delete`, `rename`). Not "implement X" — that's a goal, not a step.
- **path#anchor** — a *re-resolvable* location, not a raw line number. Cite the **symbol** for code (`src/users.ts#getUserById`, `PaymentsClient.charge`), or a **unique quoted snippet / heading** for shell, config, markdown, or a spot inside a function with no named symbol (`dev-state-mark.sh#"command -v jq"`, `WORKFLOW.md#"## Type-aware phase matrix"`). The test: any reader must be able to re-find the target with LSP or `grep` *after earlier steps have already shifted the file* — a bare `:42` goes stale the moment a step above it edits the file, and a plan full of stale line numbers reads as untrustworthy and burns review time on cross-checking. A line number MAY be appended as an explicit write-time hint (`#getUserById (~L42)`), never as the sole handle. Use `path (new)` for new files — the `(new)` disposition already carries "new"; name the symbol-to-add when it helps. When the change mimics an existing pattern, cite the precedent by anchor (e.g., `mirror src/handlers/orders.ts#createOrder`) — a reference that survives edits beats a line range that doesn't.
- **verify** — a command (`npm test src/foo.test.ts`, `curl -s :8080/health | jq .status`, `psql -c "\d users"`) or a concrete observable (`column email_verified exists`, `feature flag returns true for opt-in users`). If you would write `manually check` or `visually inspect`, the step is too big — split it until each piece is verifiable atomically. *This is the single highest-leverage rule in this skill.*
- **[AC#]** — which acceptance criterion this step lands. A step with no AC tag is either scope-creep or evidence that the spec is missing an AC the work actually delivers — go fix the spec first.

### 6. One step → one verify; if not, split

A step that needs multiple verifications is doing multiple things. Split it. Steps map 1-to-1 to commits in spirit (atomic). The verify clause is what `engineer` runs after the step — write it as if it will literally be executed. (The per-AC *test strategy* — which level proves each criterion — lives in `test-plan.md`, `qa`'s contract at the test phase; a step's verify often becomes one of those tests, but the plan doesn't own the test design.)

### 7. Type-specific rules

- **`feat`** — standard plan. Diagram = flowchart, mark `★`.
- **`fix`** — step 1 of `Steps` MUST be "write failing regression test for <bug>" encoded against `spec.md > Reproduction`. *Address the root cause, not the symptom* — if your fix step is "catch the exception" or "guard the null", ask whether the cause is upstream and document why the local fix is correct.
- **`refactor`** — one-line behaviour-equivalence statement in `Approach`: what stays identical and how it gets verified. Lean on the existing suite **where it already covers the touched behaviour**; where it doesn't, the equivalence claim is unverifiable until you pin the current behaviour — so make **step 1 of `Steps` a characterization baseline** (golden-master/snapshot of current observable behaviour, captured before the structural change), mirroring how `fix` opens with a regression test.
- **`chore`** — minimal plan. Skip Risks for XS.
- **`docs`** — Steps are doc edits. Files touched lists every doc file. No test planning.
- **`spike`** — `Out of scope` MUST say "no production code lands from this run — engineer writes `recommendations.md` only". Steps may be open-ended ("try option A, measure throughput at 1k req/s").

### 8. Self-review before status = draft

Before handing off, walk these scans (and `references/self-review.md` for examples):

- **Outcome reads for a non-technical reader** — the `## Outcome` block exists with all three bullets; Before/After carry no `path#anchor` (that detail is `Current state`'s job), and Benefit links to `spec.md > Outcome` rather than restating it. A reader who stops after Outcome should already know what changes and why.
- **Anti-placeholder** — no `TBD`, `TODO`, `???`, `appropriate X`, `as needed`, `path/to/file`, hedging modals in Steps.
- **Trigger discipline** — every section in the plan has its trigger firing. No 1-row Files touched tables, no Risks="N/A", no Dependencies="None". DELETE such sections. (Diagram is the exception — always include, one-line on XS is fine.)
- **AC sufficiency, not just coverage** — every Step still carries ≥1 `[AC#]`, but presence is the floor, not the bar. For each spec AC (its `on error / at boundary:` clause and edge sub-bullets included): the Step(s) tagged with it, taken *together*, must **fully deliver** it (not merely touch it), AND at least one of those Steps' `verify:` clause must be the AC's actual acceptance check — when the spec AC carries an `e.g.: input → expected output` example, that example is the verify target. **The error/boundary clause needs its own delivering+verifying coverage** — a plan that implements only the happy path leaves the boundary the spec explicitly called out unbuilt and unverified. A measurable `measured:` target is an AC too: its verify runs the measurement. A step tagged `[AC1]` that doesn't satisfy AC1, or an AC (or its boundary clause) whose tagged steps have no verify that proves it, is coverage on paper only — that is the gap this scan catches.
- **Section integrity** — when Alternatives appears, each rejection cites evidence (load test / incident / spike-NNN), not "feels slower". When Current state appears, every claim cites `path#anchor` (symbol or snippet, not a bare line). When diagram appears, every `★` matches a `new` in Files/Steps and vice versa.
- **Scaffold integrity** *(M/L)* — the `## Scaffold` section exists; every `★` file in it maps to a `(new)` Step (and vice versa); every signature shown is one a Step fills; a type whose shape is a decision is shown as a definition, not just a consuming signature; the block stays signatures / type shapes / one-line stubs, not real bodies; no separate `## Folder structure` duplicates the tree.
- **Verify-per-step** — every Step's verify is a runnable command or concrete observable, never "manually check".
- **Parallel-phase integrity** *(feat with `Parallelizable: yes` phases)* — there are **≥ 2** such phases (a lone one is pointless); every parallel phase declares `Files touched (exclusive)` and `Depends on: none`; the exclusive sets are **pairwise-disjoint** (no path appears in two parallel phases — count `(new)` paths identically, and treat case-insensitive-filesystem variants like `Index.ts`/`index.ts` as the same path); **no parallel phase imports a symbol *defined in* another parallel phase's exclusive file** (a shared symbol must be pinned in `## Scaffold` and owned by the integration phase or a pre-existing file — file-disjoint is not the same as independent); a final sequential `### Phase <last>: integration` exists and owns the shared glue (barrel/router/DI/lockfile/generated output) + verifies + dep installs; and **any AC delivered across ≥ 2 phases — or partly by a parallel phase and finished in integration — has its acceptance-verifying step in the integration phase** (parallel phases are write-only and run no `verify:`, so an AC whose acceptance check is stranded in a parallel phase can never be verified — put the completing + verifying step in integration). A shared file or symbol in a parallel phase, an overlapping path, fewer than 2 parallel phases, a missing integration phase, or a split AC whose verify lands in a parallel phase means the orchestrator will refuse fanout or the integrator will block — fix it before `draft`.

If any scan fails, fix the plan — do not mark `status: draft`.

### 9. Lead with a plain-language Outcome (Before → After → Benefit)

A plan that opens on `Approach` + steps forces the reviewer to reverse-engineer "what does this even change, and why do I care" out of the technical detail — the readability complaint this principle exists to kill. The fix is a three-line `## Outcome` block at the very top, the first thing rendered, before `Approach`:

- **Before** — how the system / flow behaves today, in one plain-language line. **No `path#anchor`** — the cited walk is `## Current state`.
- **After** — how it behaves once the Steps land.
- **Benefit** — `→ spec.md > Outcome`. The product-level win lives in the spec; link it, don't restate it (a restated benefit drifts from its source).

Always rendered, every Size and Type — one short line per bullet is fine on XS, the same "always have the slot" discipline as the diagram (principle 4). `Outcome.Before` is the 30-second prose summary; `Current state` (when present) is the load-bearing `path#anchor`-cited detail — they are **complements, not duplicates**: write Before even when there is no Current state section, and never paste anchors into Before. The spec carries the same block at the product level; the plan's is the system/behaviour level.

### 10. Scaffold the skeleton before a long build (M/L)

A plan that describes the shape only in prose and a flow diagram still leaves the engineer to invent the concrete file layout and every signature — and the reviewer to approve a long build sight-unseen. For **M/L** work, add a `## Scaffold` section: one fenced block showing the *target file tree* (★ = new file, ~ = edited) with each new / changed file's **key exported signature(s)** inline (interface / type / function — params → return/error). It is the concrete skeleton — what the tree and the contracts look like *after scaffolding, before the bodies are filled in*.

This is the highest-leverage review checkpoint for long work: a wrong structural decision (a misplaced boundary, a signature that leaks the wrong type, a missing port) is cheap to fix in a skeleton and expensive to fix after hundreds of lines are written against it. The gate (Phase 1 step 3) surfaces the Scaffold for M/L, so the user signs off the shape before the autonomous Phase 2 begins; the engineer then builds to it instead of guessing.

- **Required** for M/L · **optional** mini version for S that touches existing code · **skip** XS.
- **Placement:** after the Architecture diagram, before Steps.
- **No redundancy:** for M/L the Scaffold *is* the file-tree view — it **subsumes `## Folder structure`** (don't write both). Keep a separate `## API / event contracts` section only when a transport contract or port needs field-level / error-code detail richer than the one-line signature the Scaffold already carries.
- **Show the key type shapes, not just the signatures.** When a type the signatures consume carries a real decision — a discriminated union, a value object, a state enum, anything where the wrong shape leaves an *illegal state representable* — inline its **definition** in the block, not merely the function signature that takes it. Wrong-type is the most expensive shape error and the cheapest to catch here ([[programming-fundamentals]] — make illegal states unrepresentable): a leaked nullable, a union missing its error arm, a primitive where a value object belonged. Don't expand every DTO — only the types whose *shape is itself a choice* the reviewer should sign off. A type definition is contract, not body, so it belongs in the skeleton.
- **Stays a skeleton, not an implementation:** signatures and type shapes, and at most a one-line stub *body* (`throw new Error('not implemented')` / `raise NotImplementedError`), kept inside the fenced block. Real bodies belong in implementation — pseudocode in a plan rots (see anti-patterns).

```
src/payments/                          ★ new module
  domain/charge.types.ts      ★  type ChargeResult = { ok: true; receiptId: string } | { ok: false; reason: DeclineReason }
  ports/charge.port.ts        ★  interface ChargeProvider { charge(r: ChargeReq): Promise<ChargeResult> }
  app/charge.usecase.ts       ★  chargeOrder(orderId: string): Promise<Receipt>
  adapters/stripe.client.ts   ★  class StripeClient implements ChargeProvider
  orders/order.service.ts     ~  + call chargeOrder() in placeOrder()
```

## Pre-flight checklist (run top-to-bottom)

Before writing any section of plan.md:

- [ ] Read `spec.md` and its `Carried-over follow-ups`.
- [ ] Confirm `Type` matches what the spec says.
- [ ] Pick `Size` from the signal table above (or `references/size-tiering.md` for edge cases). Borderline → larger tier.
- [ ] Load the relevant construction skill(s):
  - Any non-trivial code → [[programming-fundamentals]]
  - Schema / query / migration / index → [[database-fundamentals]]
  - Backend with real domain logic → [[hexagonal-backend]]
  - System-level / cross-service decisions → [[architecture-fundamentals]]
  - Queue / broker / async worker → [[queue-fundamentals]]
  - Bug with unknown cause → [[debug-fundamentals]] *before* this skill
- [ ] Pick diagram type from `Type` (table in principle 4). Even XS keeps the section — one line is fine.
- [ ] Use **LSP first** for existing-code references (definitions, references, diagnostics) before citing `path#anchor` (symbol / snippet, not a bare line). Grep is the fallback.
- [ ] If the change mimics an existing pattern, find that pattern now and have its `path#anchor` ready to cite in Steps.
- [ ] **Map current state** (principle 3) for non-greenfield work — required when Size ∈ {M, L} or Type ∈ {refactor, fix}. Walk entry point → flow → callers (LSP find-references) → invariants with `path#anchor` citations, *before* drafting Steps. Skip only when the work is brand-new files in an isolated module.
- [ ] For **M/L**, plan the `## Scaffold` (principle 10): the target file tree (★ new · ~ edited) + each new file's key signature — the skeleton the gate reviews and the engineer builds first. Subsumes `## Folder structure` for M/L.

Then draft in order: **Outcome → Approach → Current state (if required) → Diagram → Scaffold (M/L) → Steps → Files touched → (size-gated sections) → Rollback → Out of scope**.

## Section gating by Size

| Section | XS | S | M | L |
|---------|----|----|----|----|
| Outcome (Before/After/Benefit) | ✓ | ✓ | ✓ | ✓ |
| Approach (2–3 sent) | ✓ | ✓ | ✓ | ✓ |
| Steps (with verify + AC tag) | ✓ | ✓ | ✓ | ✓ |
| Step order line | skip | optional | ✓ | ✓ |
| Current state (principle 3) | required for refactor/fix; else skip | required when touching existing code OR refactor/fix; else skip | ✓ | ✓ (+ as-is mermaid for refactor) |
| Architecture diagram | one-line / N/A | mini mermaid (3–5 nodes) | full mermaid by Type | full + before/after |
| Scaffold (tree + signatures, principle 10) | skip | optional (when touching existing code) | ✓ required | ✓ required |
| (Optional) Phases above Steps | skip | skip | skip | ✓ if >12 steps; `feat`-only parallel form adds exclusive Files-touched + integration phase |
| Files touched | skip if ≤2 files | when >2 files | ✓ | ✓ |
| Alternatives considered (+ Verified line) | skip | skip | when non-obvious | ✓ |
| Risks | skip | optional | ✓ | ✓ |
| Observability | skip | when feat/fix ships runtime + new op surface | required if feat/fix | ✓ |
| Dependencies (WHEN-only) | skip unless present | skip unless present | skip unless present | when blocking handoffs exist |
| Rollback | skip (revert commit) | skip unless destructive | ✓ if destructive | ✓ runbook |
| Out of scope | skip if no creep risk | skip if no creep risk | when creep risk in implementation | ✓ |

Sections marked `skip` are **DELETED entirely** — no empty headers, no "N/A" lines. Empty sections defeat the minimum-floor principle.

### Optional Phases for L plans

When a L plan grows past ~12 steps, group them under named Phases (e.g., `### Phase 1: schema migration`, `### Phase 2: write path`, `### Phase 3: read path`). Each phase has its own ordered Steps with the same strict format. Phases let `engineer` create one `TaskCreate` per phase and one nested task per step, which makes long plans navigable without forcing them to split into separate `/dev` runs. Phases are *grouping*, not gates — the /dev workflow already gates between Phase 1 and Phase 2 at the spec-approval point.

#### Parallelizable phases (feat-only — the implement-fanout contract)

Phases are *grouping* by default. A `feat` plan MAY additionally mark phases **parallelizable** so the implement step can run one engineer per phase concurrently (`engineer` Mode A returns `FANOUT_REQUESTED: implement:<parallel-phase-list>`; pattern in `.claude/skills/fanout-team-agents/SKILL.md`). This is **feat-only**: `fix` (regression-test-first), `refactor` (characterization-baseline-first), and `spike` (no production code) all carry step-1 ordering that parallel disjoint phases break — never mark their phases parallel.

Mark phases parallel only when there are **≥ 2** of them — a lone `Parallelizable: yes` phase gains no concurrency and just adds a pointless integration phase (the orchestrator's fanout trigger requires ≥ 2 and will fall back to single-pass otherwise). A parallelizable phase declares three fields directly under its `### Phase N: <name>` heading, before its Steps:

- `**Parallelizable:** yes` — this phase's Steps can run concurrently with the other `yes` phases.
- `**Files touched (exclusive):**` — the exact file paths this phase owns. **No other parallel phase may list any of these paths.** The orchestrator computes the pairwise intersection of all parallel phases' exclusive sets before dispatch and **refuses fanout (falls back to one sequential engineer) if any intersection is non-empty** — a declaration alone is not trusted. A shared file (barrel/index, route registration, DI container, lockfile, shared types module, **or any generated/codegen output** — anything a build step rewrites) is therefore **never** a parallel phase's file; it belongs to the integration phase below.
- `**Depends on:** P<n> | none` — a phase that depends on another phase's output is **not** parallelizable with it; a parallel phase must be `none`. (A dependency edge is the other reason the orchestrator refuses fanout.)

Every plan that marks phases parallel MUST end with a final **sequential integration phase** (`### Phase <last>: integration`, `**Parallelizable:** no`). It is the single place that touches **shared glue** (barrel exports, router/DI wiring, lockfile), installs dependencies, **runs the verifies**, and reconciles acceptance — because the parallel phase-engineers are **write-only** (they Edit/Write only their exclusive files and do not run verifies, install deps, touch git, or tick `spec.md`). The per-step `verify:` loop therefore does not run during the parallel phase; review (step 5) and qa (step 7) are the catch.

```
### Phase 1: payments adapter
**Parallelizable:** yes · **Depends on:** none
**Files touched (exclusive):** src/payments/adapters/stripe.client.ts, src/payments/adapters/stripe.client.test.ts
1. add … — `src/payments/adapters/stripe.client.ts#charge` (new) — verify: `npm test src/payments/adapters/stripe.client.test.ts` [AC2]

### Phase 2: refunds adapter
**Parallelizable:** yes · **Depends on:** none
**Files touched (exclusive):** src/payments/adapters/refund.client.ts, src/payments/adapters/refund.client.test.ts
1. add … — `src/payments/adapters/refund.client.ts#refund` (new) — verify: `npm test src/payments/adapters/refund.client.test.ts` [AC3]

### Phase 3: integration
**Parallelizable:** no · **Depends on:** P1, P2
1. wire both adapters into the container — `src/payments/container.ts#register` (edit) — verify: `npm test src/payments` [AC2, AC3]
```

## Relation to other skills

This skill **composes**, it does not replace:

- The construction-fundamentals skills (canonical run order in `.claude/rules/fundamentals.md`) — these decide *what to build*. Load the layer(s) the work touches **first**; their output becomes the substance of `Approach` and `Steps`.
- [[debug-fundamentals]] — for `fix` plans, run debug-fundamentals first to find the cause, then this skill to encode the fix + regression test.
- [[git-workflow]] — pairs at ship time (Phase 2 step 9). A plan's atomic Steps become atomic commits; the Type slot mirrors the commit `<type>`.

The `lead` agent in plan mode is the *caller* — it invokes this skill before drafting `plan.md`. The skill does not call `lead`.

## When to skip

Skip this skill only when:

- The user is having a conversational "what should we do about X?" exchange that hasn't been spec'd yet — that's brainstorming, not planning.
- The work is a throwaway one-off script, a single-line config edit, or anything you could describe in one sentence and ship in one commit with no design risk.
- You are reviewing an existing plan (use the `review.md` template instead) or running QA on a plan that's already implemented.

If any non-trivial code is about to land in the repo and you're about to write `plan.md`, do not skip.

## Anti-patterns (do not do these)

- **Restating the spec in `Approach`** — link to spec instead. Plan drifts; spec is the source of truth.
- **Pseudocode in Steps** — if the code is ready to write, write it during implementation, not in the plan. Pseudocode rots and never runs.
- **Hour / day estimates** — planning fallacy makes these wrong by 2–4×. Use `Size` (XS/S/M/L) only.
- **"Considerations" / "Notes" bucket sections** — every insight belongs in a section that drives action (Steps, Risks, Alternatives, Out of scope). Unbounded buckets become dump grounds.
- **Including triggered sections "just in case"** — an empty `Architecture diagram` on an XS string change, a `Files touched` table with one row, a `Risks` section that says "N/A". DELETE the whole section instead. Empty headers defeat the minimum-floor principle.
- **Inventing an Observability line because the template asks for one** — if the run doesn't ship runtime code or add a new operational surface, DELETE the section. Don't invent metric names to fill a slot.
- **`Alternatives considered` without a Verified line** — "rejected: feels slower" is a feeling, not evidence. Each rejection needs a load test, prior incident, profiling result, or spike reference.
- **Verify = "manually check" / "eyeball" / "visually inspect"** — that's not a verify. Name a command or a concrete observable, or split the step. (Anthropic's single-highest-leverage rule for working with AI coding agents is *give the agent a way to verify its work*. This rule is that rule, applied to plans.)
- **AC tag = "all"** — every step tags specific AC numbers. "All" hides which step actually lands which behaviour.
- **Symptom-patching for `fix`** — "wrap in try/catch", "guard against null" without explaining *why* the null arrives is treating the symptom. Show the root cause in `Approach`; let the fix step name it explicitly.
- **Designing for hypothetical future requirements** — if the spec doesn't ask for it, the plan doesn't plan for it. Carry the idea to `FOLLOWUPS.md` instead.
- **Designing without Current state on existing code** — if the plan touches existing files and the Current state section is missing (or empty, or written from memory instead of LSP-walked), the plan is gambling on assumptions. Either fill the section honestly or — if the work genuinely is greenfield — say so in one line under Approach so the omission is intentional, not accidental.
- **Current state that's just paraphrase, no citations** — "the hook writes state.json then exits" without a `path#anchor` is a guess. Walk it with LSP and cite. If you can't cite, you don't know it.
- **Implementing a new port/boundary without naming its interface first** — if a Step creates a new internal port (e.g. a hexagonal port between application and an adapter), the engineer will invent the method signatures and the adapter drifts from the port. Name the interface + signatures (params → return/error) in `## API / event contracts` *before* the Steps that fill them.
- **Unpinned or assumed dependencies** — a Step that says "add the `fast-csv` package" with no version, or names a package you didn't confirm exists, invites a hallucinated or typo-squatted dependency. Pin an exact existing version and make the Step's verify confirm it resolves (lockfile entry / `npm ls pkg@ver`).
- **Scaffold with real bodies** — a `## Scaffold` block that fills in working logic isn't a skeleton, it's early implementation smuggled past the gate (and it rots the same way pseudocode does). Keep it to the file tree + signatures + at most a one-line stub; the bodies land in the Steps. Conversely, on M/L, *omitting* the Scaffold forces the reviewer to approve a long build from prose alone and the engineer to invent the layout — both are the failure principle 10 exists to prevent.
- **Parallel phases over a shared file** — marking two phases `Parallelizable: yes` when both edit the route table / barrel `index.ts` / DI container / lockfile. Concurrent write-only engineers on the same file race or clobber. The shared file is glue — move it into the sequential integration phase and keep each parallel phase's `Files touched (exclusive)` genuinely disjoint. (Same trap: marking `fix`/`refactor`/`spike` phases parallel — their step-1 ordering forbids it.)

## References

Pick the one that matches the friction:

- `references/size-tiering.md` — XS/S/M/L picker, edge cases (one-file state machine, mechanical sweep across 30 files, type-vs-size collisions), and per-size time budgets.
- `references/diagrams.md` — mermaid templates per Type with worked examples, when to use `flowchart` vs `sequenceDiagram` vs `classDiagram`, and L-plan two-diagram pattern.
- `references/current-state.md` — the LSP-walk technique for mapping existing code, what counts as an invariant, worked examples per Type (feat touching existing API, fix bug-path, refactor anti-goals), and the "no callers / single caller / many callers" framing.
- `references/self-review.md` — the five scans in detail with anti-placeholder regex list and extra checks for M/L plans.

If lead is drafting in plan mode and unsure which to consult, use this map: *Size unclear* → size-tiering; *which mermaid kind* → diagrams; *what does existing code do* → current-state; *plan reads "done" but feels off* → self-review.
