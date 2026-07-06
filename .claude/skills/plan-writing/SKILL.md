---
name: plan-writing
description: Write an implementation plan (plan.md) plus an executable, verifiable task list (tasks.md) that maps a spec to dependency-ordered tasks with a required architecture diagram, sized XS/S/M/L. Use when drafting `.workflow/<id>/plan.md` in the /dev workflow (lead agent, Phase 1 step 2), or when the user asks to "write a plan", "plan this feature", "break this down", "draft an RFC". Owns size tiering, the mermaid diagram by Type, current-state mapping, inline AC tagging, runnable-verify and anti-placeholder rules, and the pre-draft self-review. Skip throwaway scripts, single-line config edits, and un-spec'd design conversations.
---

# Plan Writing

## Why this exists

Plans that restate the spec, hide decisions in prose, let "TBD" leak, or lack runnable verifies fail predictably — the first AC check lands at review, not plan time. This skill is the pre-flight for `/dev` Phase 1 step 2 (lead, plan mode) and whenever a plan is being drafted.

## The 10 principles

### 1. Read spec.md + carried follow-ups before anything else

A plan that doesn't map back to spec is blind. Open `spec.md`, list every `Acceptance scenario` (its `AC#`) under each User Story, check `Carried-over follow-ups`. Every task must tie to either an acceptance scenario (`AC#`) or a carried follow-up — if it ties to neither, it's scope-creep and belongs in `FOLLOWUPS.md`, not this plan.

### 2. Set Size before drafting tasks

Size determines which sections are required, which are optional, and which should be deleted. Choose XS / S / M / L using the picker in `references/size-tiering.md`. Wrong size = either bloat (XS work in M template) or under-coverage (M work treated as S). **When borderline, prefer the larger tier** — under-covering costs cycle burn at review; over-covering costs a few skipped sections.

| Size | Trigger signals |
|------|-----------------|
| **XS** | chore / docs, 1 file, no logic change (typo, dep bump, comment cleanup). If you can describe the diff in one sentence, it's XS. |
| **S** | 1 subsystem, ≤ 2 files, simple logic |
| **M** | multi-file in one subsystem, real logic (branching, state, side effects), no contract / schema change |
| **L** | cross-subsystem, schema migration, public API contract change, or any breaking change |

### 3. Map current state before designing (brownfield work)

A plan that touches existing code without first stating what it does today is gambling on assumptions.

**The trigger is the run's `field`, not its Type or Size** (`field` is defined in `references/size-tiering.md > Greenfield vs brownfield`): **brownfield work maps current state; greenfield skips it.** Because greenfield always caps at XS/S and every `fix`/`refactor`/M/L run is brownfield, this subsumes the old "M/L or refactor/fix" trigger *and* closes the gap it left — a **brownfield `feat` that edits existing code is no longer exempt just because it's small** (the "added a feature, broke existing behaviour" hole).

**Map at boundary-depth, not full-depth.** Current state is the load-bearing subset — blast radius, invariants the change must preserve, insertion points — *not* a tour of every file in scope. Code whose internals don't constrain the plan (a contained edit, a flow you won't alter) is read by `engineer` at edit time, not pre-read here; write a one-line pointer in `## To explore at implement` **instead of** walking it, so Current state stays the safety-critical subset rather than growing a second list. Defer mechanics, never a blast-radius invariant. Full stance + the feasibility-read exception: `references/current-state.md > Boundary-depth, not full-depth`. Digest the must-not-break invariants into the `tasks.md > ## Guardrails` header (backticked `` `path#anchor` `` + why each) — that header, not the full `## Current state` map, is the engineer's up-front invariant read; the map stays in `plan.md`, pulled per-task via `[ref:]`.

**Required** (write a `Current state` section before the Architecture diagram), scaled to size:
- **Full section** — any **M** or **L** plan, and any **refactor** or **fix** at any size: entry point · data/control flow · callers/blast-radius · invariants (+ refactor anti-goals / fix bug-path).
- **Proportional note** — a **brownfield `feat` at XS/S**: at minimum the entry point of the code you edit and its blast radius (who else calls the symbol you change), each with `path#anchor`. One to three lines is fine — the point is that you *walked* it, not that you wrote an essay.

**Skip for**:
- **greenfield** work (any size) — new isolated files, nothing to reverse-engineer. Say so in one line under `Summary` so the omission is intentional, not accidental; `programming-fundamentals` owns getting the new shape right.
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

Mark new pieces with `★`. **Code-bearing plans (`feat`/`fix`/`refactor`) MUST carry a `sequenceDiagram`**; a structural diagram is an optional companion. `chore`/`docs`/`spike` are exempt. Templates in `references/diagrams.md`:

| Type | Required diagram (+ optional companion) |
|------|-----------------|
| `feat` | **`sequenceDiagram`** of the new call path; optional `flowchart LR` companion when shape matters |
| `fix` | **`sequenceDiagram`** of the bug path with the fix point marked; optional before/after `flowchart` when the fix changes control flow |
| `refactor` | **`sequenceDiagram`** (call order, unchanged) + before/after `flowchart`/`classDiagram` of the structural shift |
| `chore` / `docs` | one line: `<file> (<change>)` OR `**Impact:** N/A — <reason>` |
| `spike` | `flowchart` with `?` on unanswered nodes |

For XS, even one line counts — keep the section. The discipline is "always have a diagram slot": habit beats exception.

When Current state (principle 3) is present, the Architecture diagram is the *to-be* — show how the existing flow changes. Don't redraw the whole as-is in the to-be diagram; that's the previous section's job.

### 5. Tasks use the strict format: `T### [P?] [AC#] [ref: path#anchor]? action — path#anchor (new|edit|delete) — verify: <command or observable>`

Tasks live in `tasks.md`, grouped into phases (Setup → Foundational → one per User Story in priority order → Polish). Every task has a `T###` id and all four parts. No exceptions. `tasks.md` opens with a **one-line** `> **For humans**` blockquote (plain language — what one task line is; the `T###`/`[P]`/`[AC#]`/`path#anchor` codes are for build agents). Always-on, **not** a triggered section — keep it (one line, don't let it grow); do not strip it in the principle-8 self-review. Brownfield `tasks.md` also opens with a `## Guardrails` header (invariants from `## Current state`, backticked `` `path#anchor` `` each) — the engineer's **only** up-front invariant read. The optional `[ref: path#anchor]?` slot is a lazy pointer to design/contract context beyond the row (`plan#scaffold`, `spec#AC1`, a `test-plan` row, `uxui#S1`), opened when the task starts — this is what keeps `/implement` from front-loading every artifact.

- **T### + [P?]** — sequential id in execution order; add `[P]` only when the task is parallel-safe (different files, no unmet dependency).
- **[AC#]** — which acceptance scenario this task lands (`[DoD]` / `[SC-###]` for a non-AC task). A task with no tag is either scope-creep or evidence that the spec is missing a scenario the work actually delivers — go fix the spec first.
- **action** — imperative, one verb (`add`, `extract`, `wire`, `delete`, `rename`). Not "implement X" — that's a goal, not a task.
- **path#anchor** — a *re-resolvable* location, not a raw line number. Cite the **symbol** for code (`src/users.ts#getUserById`, `PaymentsClient.charge`), or a **unique quoted snippet / heading** for shell, config, markdown, or a spot inside a function with no named symbol (`dev-state-mark.sh#"command -v jq"`, `WORKFLOW.md#"## Type-aware phase matrix"`). The test: any reader must re-find the target with LSP or `grep` *after earlier tasks have already shifted the file* — a bare `:42` goes stale the moment a task above it edits the file, and stale line numbers burn review time. A line number MAY be appended as a write-time hint (`#getUserById (~L42)`), never the sole handle. Use `path (new)` for new files. When the change mimics an existing pattern, cite the precedent by anchor (`mirror src/handlers/orders.ts#createOrder`).
- **verify** — a command (`npm test src/foo.test.ts`, `curl -s :8080/health | jq .status`, `psql -c "\d users"`) or a concrete observable (`column email_verified exists`, `feature flag returns true for opt-in users`). If you would write `manually check` or `visually inspect`, the task is too big — split it until each piece is verifiable atomically. *This is the single highest-leverage rule in this skill.*

### 6. One task → one verify; if not, split

A task that needs multiple verifications is doing multiple things. Split it. Tasks map 1-to-1 to commits in spirit (atomic). The verify clause is what `engineer` runs after the task — write it as if it will literally be executed. (The per-AC *test strategy* — which level proves each scenario — lives in `test-plan.md`, `qa`'s contract at the test phase; a task's verify often becomes one of those tests, but the plan doesn't own the test design.)

### 7. Type-specific rules

- **`feat`** — standard plan. Diagram = flowchart, mark `★`.
- **`fix`** — task 1 in `tasks.md` MUST be "write failing regression test for <bug>" encoded against `spec.md > Reproduction`. *Address the root cause, not the symptom* — if your fix task is "catch the exception" or "guard the null", ask whether the cause is upstream and document why the local fix is correct.
- **`refactor`** — one-line behaviour-equivalence statement in `Summary`: what stays identical and how it gets verified. Lean on the existing suite **where it already covers the touched behaviour**; where it doesn't, the equivalence claim is unverifiable until you pin the current behaviour — so make **task 1 in `tasks.md` a characterization baseline** (golden-master/snapshot of current observable behaviour, captured before the structural change), mirroring how `fix` opens with a regression test.
- **`chore`** — minimal plan. Skip Risks for XS.
- **`docs`** — tasks are doc edits, one per doc file. No test planning.
- **`spike`** — `Out of scope` MUST say "no production code lands from this run — engineer writes `recommendations.md` only". Tasks may be open-ended ("try option A, measure throughput at 1k req/s").

### 8. Self-review before status = draft

Before handing off, walk these scans (and `references/self-review.md` for examples):

- **Summary reads for a non-technical reader** — the `## Summary` + `## Technical Context` + `## Gate check` blocks exist; Summary carries no `path#anchor` (that detail is `Current state`'s job) and links the spec's User Stories rather than restating them. A reader who stops after Summary should already know what changes and how.
- **Anti-placeholder** — no `TBD`, `TODO`, `???`, `appropriate X`, `as needed`, `path/to/file`, hedging modals in tasks.
- **Trigger discipline** — every section in the plan has its trigger firing. No Risks="N/A", no Dependencies="None". DELETE such sections. (Two always-include exceptions: the Diagram — one-line on XS is fine — and `## Phases for this task`, which states the matrix defaults even when there's no deviation; full rule `WORKFLOW.md > Per-task phase plan`.)
- **AC sufficiency, not just coverage** — every task still carries ≥ 1 `[AC#]`, but presence is the floor, not the bar. For each spec acceptance scenario (and its boundary/error scenario): the task(s) tagged with it, taken *together*, must **fully deliver** it (not merely touch it), AND at least one of those tasks' `verify:` clause must be the scenario's actual acceptance check — the `Then <outcome>` is the verify target. **The boundary/error scenario needs its own delivering+verifying task** — a plan that implements only the happy path leaves the boundary the spec explicitly called out unbuilt and unverified. A measurable `measured:` target is an AC too: its verify runs the measurement. A task tagged `[AC1]` that doesn't satisfy AC1, or an AC (or its boundary scenario) whose tagged tasks have no verify that proves it, is coverage on paper only — that is the gap this scan catches.
- **Section integrity** — when Alternatives appears, each rejection cites evidence (load test / incident / spike-NNN), not "feels slower". When Current state appears, every claim cites `path#anchor` (symbol or snippet, not a bare line). When diagram appears, every `★` matches a `new` in Files/tasks and vice versa.
- **Guardrails present** *(brownfield)* — `tasks.md` opens with `## Guardrails` (backticked `` `path#anchor` `` invariants; greenfield → `none`); no invariant left only in `## Current state`/`## To explore` — a miss becomes a `BLOCKER:` at implement.
- **Budget** — each section within its `plan-sections.md` Budget; cap prose, never drop a consumed field (`[AC#]`, `path#anchor`, `verify:`, mermaid).
- **Scaffold integrity** *(M/L)* — the `## Scaffold` section exists; every `★` file in it maps to a `(new)` task (and vice versa); every signature shown is one a task fills; a type whose shape is a decision is shown as a definition, not just a consuming signature; the block stays signatures / type shapes / one-line stubs, not real bodies; no separate `## Folder structure` duplicates the tree.
- **Verify-per-task** — every task's verify is a runnable command or concrete observable, never "manually check".
- **Parallel-phase integrity** *(feat with `Parallelizable: yes` phases)* — there are **≥ 2** such phases (a lone one is pointless); every parallel phase declares `Files touched (exclusive)` and `Depends on: none`; the exclusive sets are **pairwise-disjoint** (no path appears in two parallel phases — count `(new)` paths identically, and treat case-insensitive-filesystem variants like `Index.ts`/`index.ts` as the same path); **no parallel phase imports a symbol *defined in* another parallel phase's exclusive file** (a shared symbol must be pinned in `## Scaffold` and owned by the integration phase or a pre-existing file — file-disjoint is not the same as independent); a final sequential `### Phase <last>: integration` exists and owns the shared glue (barrel/router/DI/lockfile/generated output) + verifies + dep installs; and **any AC delivered across ≥ 2 phases — or partly by a parallel phase and finished in integration — has its acceptance-verifying task in the integration phase** (parallel phases are write-only and run no `verify:`, so an AC whose acceptance check is stranded in a parallel phase can never be verified — put the completing + verifying task in integration). A shared file or symbol in a parallel phase, an overlapping path, fewer than 2 parallel phases, a missing integration phase, or a split AC whose verify lands in a parallel phase means the orchestrator will refuse fanout or the integrator will block — fix it before `draft`.

If any scan fails, fix the plan — do not mark `status: draft`.

### 9. Lead `plan.md` with Summary + Technical Context + Gate check

Lead with `## Summary` (2–3 sentences: the technical approach + why this over the obvious alternative — each User Story = one vertical slice) so reviewers immediately know what changes and how, then:

- **`## Technical Context`** — language/framework, storage, testing, target platform, perf goal (links a `SC-###`), scale. The product-level win lives in the spec's User Stories — link, don't restate. **No `path#anchor` in Summary** — the cited walk is `## Current state`.
- **`## Gate check`** — name the `rules/fundamentals.md` layers this work crosses (trust boundary; ponytail/new-dependency; a11y / concurrency / database / observability), one line each. This is the foundation's stand-in for spec-kit's Constitution Check; a violation needs justification or a plan change, not silent omission.

Always rendered, every Size and Type — one short line is fine on XS, the same "always have the slot" discipline as the diagram (principle 4). `Summary` is the 30-second prose; `Current state` (when present) is the load-bearing `path#anchor`-cited detail — **complements, not duplicates**.

### 10. Scaffold the skeleton before a long build (M/L)

For **M/L** work, add a `## Scaffold` section: one fenced block showing the *target file tree* (★ = new file, ~ = edited) with each new / changed file's **key exported signature(s)** inline (interface / type / function — params → return/error) — the skeleton the gate reviews and the engineer builds first.

- **Required** for M/L · **optional** mini version for S that touches existing code · **skip** XS.
- **Placement:** after the Architecture diagram in `plan.md`; the engineer builds the scaffold first, before the `tasks.md` tasks fill it in.
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
- [ ] Name the construction skill that owns each decision; load at most one targeted `references/<file>` section only if the router summary does not settle the choice:
  - Any non-trivial code → [[programming-fundamentals]]
  - Schema / query / migration / index → [[database-fundamentals]]
  - Backend with real domain logic → [[hexagonal-backend]]
  - System-level / cross-service decisions → [[architecture-fundamentals]]
  - Queue / broker / async worker → [[queue-fundamentals]]
  - A task crossing a **trust boundary** — renders untrusted input into the DOM/HTML, builds a SQL/shell/HTML/template string, or handles auth/session/secrets → [[security-fundamentals]]. **Name the safe construction in the task itself; never write a dangerous sink as shorthand** (render user text with `textContent`, not `innerHTML`; open `security-fundamentals/references/input-and-output.md` only when you need the side-by-side detail). The always-on security rule fires at *code-write* time, so on the combined fast path (skill-loading deliberately light) the **planner** is the first place an injection gets designed out — not the last.
  - Bug with unknown cause → [[debug-fundamentals]] *before* this skill
- [ ] Pick diagram from `Type` (principle 4 table). Code-bearing → `sequenceDiagram` required (XS: ≤3 participants). Even XS keeps the section.
- [ ] Use **LSP first** for existing-code references (definitions, references, diagnostics) before citing `path#anchor` (symbol / snippet, not a bare line). Grep is the fallback.
- [ ] If the change mimics an existing pattern, find that pattern now and have its `path#anchor` ready to cite in tasks.
- [ ] **Map current state** (principle 3) for **brownfield** work (the `field`, not Type/Size) — full section for M/L + refactor/fix, a proportional entry-point + blast-radius note for a brownfield `feat` at XS/S. Walk entry point → flow → callers (LSP find-references) → invariants with `path#anchor` citations, *before* drafting tasks. Skip only for greenfield (brand-new files in an isolated module), chore/docs not touching live code, and spike.
- [ ] For **M/L**, plan the `## Scaffold` (principle 10): the target file tree (★ new · ~ edited) + each new file's key signature — the skeleton the gate reviews and the engineer builds first. Subsumes `## Folder structure` for M/L.

Then draft **plan.md** in order: **Summary → Technical Context → Gate check → Phases for this task → Fanout plan → Current state (if required) → Diagram → Scaffold (M/L) → (size-gated sections) → Rollback → Out of scope**. Then draft **tasks.md**: the `## Guardrails` header (brownfield invariants; greenfield `none`) → phased `T###` tasks (Setup → Foundational → per-User-Story by priority → Polish), each `[AC#]`-tagged with a verify (and a `[ref: path#anchor]` where the task needs design context beyond the row), ending with the AC→task coverage list.

## Section gating by Size

| Section | XS | S | M | L |
|---------|----|----|----|----|
| Summary + Technical Context + Gate check | ✓ | ✓ | ✓ | ✓ |
| Tasks (in `tasks.md`: `T###` + verify + AC tag) | ✓ | ✓ | ✓ | ✓ |
| Task phases (Setup/Foundational/per-US/Polish) | optional | optional | ✓ | ✓ |
| Current state (principle 3) | brownfield → proportional note (entry point + blast radius); greenfield → skip | brownfield → proportional note (full for refactor/fix); greenfield → skip | ✓ | ✓ (+ as-is mermaid for refactor) |
| Guardrails header (in `tasks.md`; digest of Current-state invariants, principle 3) | brownfield → invariants only, else `none` | brownfield → invariants, else `none` | brownfield → ✓ | brownfield → ✓ |
| To explore at implement (deferred internals, principle 3) | skip | brownfield → when boundary-depth deferred internals | brownfield → when deferred | brownfield → when deferred |
| Architecture diagram | one-line / N/A | mini mermaid (3–5 nodes) | full mermaid by Type | full + before/after |
| Scaffold (tree + signatures, principle 10) | skip | optional (when touching existing code) | ✓ required | ✓ required |
| (Optional) Parallelizable phases (in `tasks.md`) | skip | skip | skip | ✓ if >12 tasks; `feat`-only parallel form adds exclusive Files-touched + integration phase |
| Alternatives considered (+ Verified line) | skip | skip | when non-obvious | ✓ |
| Risks | skip | optional | ✓ | ✓ |
| Observability | skip | when feat/fix ships runtime + new op surface | required if feat/fix | ✓ |
| Dependencies (WHEN-only) | skip unless present | skip unless present | skip unless present | when blocking handoffs exist |
| Rollback | skip (revert commit) | skip unless destructive | ✓ if destructive | ✓ runbook |
| Out of scope | skip if no creep risk | skip if no creep risk | when creep risk in implementation | ✓ |

Sections marked `skip` are **DELETED entirely** — no empty headers, no "N/A" lines. Empty sections defeat the minimum-floor principle.

### Optional Phases for L plans

When a `tasks.md` grows past ~12 tasks, group them under named Phases (e.g., `### Phase 1: schema migration`, `### Phase 2: write path`, `### Phase 3: read path`). Each phase has its own ordered tasks with the same strict format. Phases let `engineer` create one `TaskCreate` per phase and one nested task per `T###`, which makes long task lists navigable without forcing them to split into separate `/dev` runs. Phases are *grouping*, not gates — the /dev workflow already gates between Phase 1 and Phase 2 at the spec-approval point.

#### Parallelizable phases (feat-only — the implement-fanout contract)

Phases are *grouping* by default. A `feat` plan MAY additionally mark phases **parallelizable** so the implement step can run one engineer per phase concurrently (`engineer` Mode A returns `FANOUT_REQUESTED: implement:<parallel-phase-list>`; pattern in `.claude/skills/fanout-team-agents/SKILL.md`). This is **feat-only**: `fix` (regression-test-first), `refactor` (characterization-baseline-first), and `spike` (no production code) all carry task-1 ordering that parallel disjoint phases break — never mark their phases parallel.

Mark phases parallel only when there are **≥ 2** of them — a lone `Parallelizable: yes` phase gains no concurrency and just adds a pointless integration phase (the orchestrator's fanout trigger requires ≥ 2 and will fall back to single-pass otherwise). A parallelizable phase declares three fields directly under its `### Phase N: <name>` heading, before its tasks:

- `**Parallelizable:** yes` — this phase's tasks can run concurrently with the other `yes` phases.
- `**Files touched (exclusive):**` — the exact file paths this phase owns. **No other parallel phase may list any of these paths.** The orchestrator computes the pairwise intersection of all parallel phases' exclusive sets before dispatch and **refuses fanout (falls back to one sequential engineer) if any intersection is non-empty** — a declaration alone is not trusted. A shared file (barrel/index, route registration, DI container, lockfile, shared types module, **or any generated/codegen output** — anything a build step rewrites) is therefore **never** a parallel phase's file; it belongs to the integration phase below.
- `**Depends on:** P<n> | none` — a phase that depends on another phase's output is **not** parallelizable with it; a parallel phase must be `none`. (A dependency edge is the other reason the orchestrator refuses fanout.)

Every plan that marks phases parallel MUST end with a final **sequential integration phase** (`### Phase <last>: integration`, `**Parallelizable:** no`). It is the single place that touches **shared glue** (barrel exports, router/DI wiring, lockfile), installs dependencies, **runs the verifies**, and reconciles acceptance — because the parallel phase-engineers are **write-only** (they Edit/Write only their exclusive files and do not run verifies, install deps, touch git, or tick `spec.md`). The per-task `verify:` loop therefore does not run during the parallel phase; qa (step 5) and review (step 6) are the catch.

```
### Phase 4: payments adapter (US2)
**Parallelizable:** yes · **Depends on:** none
**Files touched (exclusive):** src/payments/adapters/stripe.client.ts, src/payments/adapters/stripe.client.test.ts
- [ ] T012 [AC2] add … — `src/payments/adapters/stripe.client.ts#charge` (new) — verify: `npm test src/payments/adapters/stripe.client.test.ts`

### Phase 5: refunds adapter (US3)
**Parallelizable:** yes · **Depends on:** none
**Files touched (exclusive):** src/payments/adapters/refund.client.ts, src/payments/adapters/refund.client.test.ts
- [ ] T013 [AC3] add … — `src/payments/adapters/refund.client.ts#refund` (new) — verify: `npm test src/payments/adapters/refund.client.test.ts`

### Phase 6: integration
**Parallelizable:** no · **Depends on:** P4, P5
- [ ] T014 [AC2][AC3] wire both adapters into the container — `src/payments/container.ts#register` (edit) — verify: `npm test src/payments`
```

## Relation to other skills

This skill **composes**, it does not replace:

- The construction-fundamentals skills (canonical run order in `.claude/rules/fundamentals.md`) — these decide *what to build*. Load the layer(s) the work touches **first**; their output becomes the substance of `Summary` and `tasks.md`.
- [[debug-fundamentals]] — for `fix` plans, run debug-fundamentals first to find the cause, then this skill to encode the fix + regression test.
- [[git-workflow]] — pairs at ship time (Phase 2 step 9). A plan's atomic tasks become atomic commits; the Type slot mirrors the commit `<type>`.

The `lead` agent in plan mode is the *caller* — it invokes this skill before drafting `plan.md`. The skill does not call `lead`.

## When to skip

Skip this skill only when:

- The user is having a conversational "what should we do about X?" exchange that hasn't been spec'd yet — that's brainstorming, not planning.
- The work is a throwaway one-off script, a single-line config edit, or anything you could describe in one sentence and ship in one commit with no design risk.
- You are reviewing an existing plan (use the `review.md` template instead) or running QA on a plan that's already implemented.

If any non-trivial code is about to land in the repo and you're about to write `plan.md`, do not skip.

## Anti-patterns (do not do these)

- **Restating the spec in `Summary`** — link to spec instead. Plan drifts; spec is the source of truth.
- **Pseudocode in tasks** — if the code is ready to write, write it during implementation, not in `tasks.md`. Pseudocode rots and never runs.
- **Hour / day estimates** — planning fallacy makes these wrong by 2–4×. Use `Size` (XS/S/M/L) only.
- **"Considerations" / "Notes" bucket sections** — every insight belongs in a section that drives action (tasks, Risks, Alternatives, Out of scope). Unbounded buckets become dump grounds.
- **Including triggered sections "just in case"** — an empty `Architecture diagram` on an XS string change, a `Risks` section that says "N/A". DELETE the whole section instead. Empty headers defeat the minimum-floor principle.
- **Inventing an Observability line because the template asks for one** — if the run doesn't ship runtime code or add a new operational surface, DELETE the section. Don't invent metric names to fill a slot.
- **`Alternatives considered` without a Verified line** — "rejected: feels slower" is a feeling, not evidence. Each rejection needs a load test, prior incident, profiling result, or spike reference.
- **Verify = "manually check" / "eyeball" / "visually inspect"** — that's not a verify. Name a command or a concrete observable, or split the step.
- **AC tag = "all"** — every task tags specific AC numbers. "All" hides which task actually lands which behaviour.
- **Symptom-patching for `fix`** — "wrap in try/catch", "guard against null" without explaining *why* the null arrives is treating the symptom. Show the root cause in `Summary`; let the fix task name it explicitly.
- **Designing for hypothetical future requirements** — if the spec doesn't ask for it, the plan doesn't plan for it. Carry the idea to `FOLLOWUPS.md` instead.
- **Designing without Current state on existing code** — if the plan touches existing files and the Current state section is missing (or empty, or written from memory instead of LSP-walked), the plan is gambling on assumptions. Either fill the section honestly or — if the work genuinely is greenfield — say so in one line under Approach so the omission is intentional, not accidental.
- **Current state that's just paraphrase, no citations** — "the hook writes state.json then exits" without a `path#anchor` is a guess. Walk it with LSP and cite. If you can't cite, you don't know it.
- **Implementing a new port/boundary without naming its interface first** — if a task creates a new internal port (e.g. a hexagonal port between application and an adapter), the engineer will invent the method signatures and the adapter drifts from the port. Name the interface + signatures (params → return/error) in `## API / event contracts` *before* the tasks that fill them.
- **Unpinned or assumed dependencies** — a task that says "add the `fast-csv` package" with no version, or names a package you didn't confirm exists, invites a hallucinated or typo-squatted dependency. Pin an exact existing version and make the task's verify confirm it resolves (lockfile entry / `npm ls pkg@ver`).
- **Scaffold with real bodies** — a `## Scaffold` block that fills in working logic isn't a skeleton, it's early implementation smuggled past the gate (and it rots the same way pseudocode does). Keep it to the file tree + signatures + at most a one-line stub; the bodies land in the tasks. Conversely, on M/L, *omitting* the Scaffold forces the reviewer to approve a long build from prose alone and the engineer to invent the layout — both are the failure principle 10 exists to prevent.
- **Parallel phases over a shared file** — marking two phases `Parallelizable: yes` when both edit the route table / barrel `index.ts` / DI container / lockfile. Concurrent write-only engineers on the same file race or clobber. The shared file is glue — move it into the sequential integration phase and keep each parallel phase's `Files touched (exclusive)` genuinely disjoint. (Same trap: marking `fix`/`refactor`/`spike` phases parallel — their task-1 ordering forbids it.)

## References

Pick the one that matches the friction:

- `references/size-tiering.md` — XS/S/M/L picker, edge cases (one-file state machine, mechanical sweep across 30 files, type-vs-size collisions), and per-size time budgets.
- `references/diagrams.md` — mermaid templates per Type with worked examples, when to use `flowchart` vs `sequenceDiagram` vs `classDiagram`, and L-plan two-diagram pattern.
- `references/current-state.md` — the LSP-walk technique for mapping existing code, what counts as an invariant, worked examples per Type (feat touching existing API, fix bug-path, refactor anti-goals), and the "no callers / single caller / many callers" framing.
- `references/self-review.md` — the five scans in detail with anti-placeholder regex list and extra checks for M/L plans.
- `references/plan-sections.md` — the authoritative trigger + placement + **Reader (build-time `eng` / plan-time `gate`) + Budget** list for every optional plan section (the template `plan.md` is a clean skeleton that points here); the size-axis companion is `## Section gating by Size` above.

If lead is drafting in plan mode and unsure which to consult, use this map: *Size unclear* → size-tiering; *which mermaid kind* → diagrams; *what does existing code do* → current-state; *plan reads "done" but feels off* → self-review; *which optional sections to include + where* → plan-sections.
