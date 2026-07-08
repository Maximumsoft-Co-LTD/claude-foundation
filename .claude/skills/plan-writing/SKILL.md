---
name: plan-writing
description: Write an implementation plan (plan.md) plus an executable, verifiable task list (tasks.md) that maps a spec to dependency-ordered tasks with a required architecture diagram, sized XS/S/M/L. Use when drafting `.workflow/<id>/plan.md` in the /dev workflow (lead agent, Phase 1 step 2), or when the user asks to "write a plan", "plan this feature", "break this down", "draft an RFC". Owns size tiering, the mermaid diagram by Type, current-state mapping, inline AC tagging, runnable-verify and anti-placeholder rules, and the pre-draft self-review. Skip throwaway scripts, single-line config edits, and un-spec'd design conversations.
---

# Plan Writing

Pre-flight for `/dev` Phase 1 step 2 (lead, plan mode) and any plan draft. Plans that restate the spec, hide decisions in prose, let "TBD" leak, or lack runnable verifies fail at review, not plan time.

## The 10 principles

### 1. Read spec.md + carried follow-ups first

List every `Acceptance scenario` (`AC#`) per User Story; check `Carried-over follow-ups`. Every task ties to an `AC#` or a carried follow-up — else it's scope-creep → `FOLLOWUPS.md`.

### 2. Set Size before drafting tasks

Size gates which sections are required/optional/deleted. Pick XS/S/M/L (`references/size-tiering.md`). Borderline → **larger tier** — under-covering burns a review cycle; over-covering costs a few skipped sections.

| Size | Trigger signals |
|------|-----------------|
| **XS** | chore/docs, 1 file, no logic change (typo, dep bump, comment). Diff describable in one sentence. |
| **S** | 1 subsystem, ≤ 2 files, simple logic |
| **M** | multi-file in one subsystem, real logic (branching/state/side effects), no contract/schema change |
| **L** | cross-subsystem, schema migration, public API contract change, or any breaking change |

### 3. Map current state before designing (brownfield)

Trigger is the run's **`field`** (`references/size-tiering.md > Greenfield vs brownfield`), not Type/Size: **brownfield maps; greenfield skips.** Every `fix`/`refactor`/M/L is brownfield; a small brownfield `feat` editing existing code is not exempt.

**Boundary-depth, not full-depth** — map the load-bearing subset (blast radius, invariants to preserve, insertion points), not every file. Contained internals you won't alter → one-line pointer in `## To explore at implement` (read by `engineer` at edit time), never a walk. Never defer a blast-radius invariant. Full stance + feasibility-read exception: `references/current-state.md > Boundary-depth, not full-depth`. Digest must-not-break invariants into `tasks.md > ## Guardrails` (backticked `` `path#anchor` `` + why each) — the engineer's only up-front invariant read; the map stays in `plan.md`, pulled per-task via `[ref:]`.

**Required** (`## Current state` before the diagram), scaled to size:
- **Full section** — any M/L, any refactor/fix at any size: entry point · flow · callers/blast-radius · invariants (+ refactor anti-goals / fix bug-path).
- **Proportional note** — brownfield `feat` at XS/S: entry point of edited code + its blast radius, each `path#anchor`. 1–3 lines — the point is you *walked* it.

**Skip**: greenfield (say so in one line under Summary; `programming-fundamentals` owns the new shape) · chore/docs not touching live paths · spike (findings → `recommendations.md`).

**Fields** (this order; every claim cites `path#anchor` via LSP go-to-def/find-refs, not memory; anchor format in principle 5):
1. **Entry point(s)** — where execution begins for the changed path (route handler, CLI subcommand, cron, queue consumer, hook, entry fn).
2. **Data/control flow** — 3–7 bullets, one hop each, `path#anchor`. Walk with LSP, don't paraphrase.
3. **Callers/blast radius** — LSP find-references per symbol you rename/delete/change-contract-of. "N callers; non-obvious: X (`path#anchor`), Y". "No callers — safe" is valid and load-bearing.
4. **Invariants** — silent assumptions to preserve or *explicitly* break: ordering, idempotency, fail-open/closed, error-swallowing, txn boundaries, single-writer, retries, timeouts, encoding. One line + `path#anchor` each; the new code preserves each or the plan calls out the break.
5. **Anti-goals** *(refactor)* — behaviours that stay identical, paired with Approach's equivalence statement; the suite pins these.
6. **Bug path** *(fix)* — route of the bad data/call input→symptom, wrong step marked `← BUG`. The as-is of the failure; the diagram shows the fix.

**L** + non-trivial refactor: also draw an "as-is" mermaid beside the "to-be" diagram. M and smaller: prose bullets. Field-by-field examples + LSP-walk technique: `references/current-state.md`.

### 4. Architecture diagram, always

Mark new pieces `★`. **Code-bearing (`feat`/`fix`/`refactor`) MUST carry a `sequenceDiagram`**; a structural diagram is an optional companion. `chore`/`docs`/`spike` exempt. Templates: `references/diagrams.md`.

| Type | Required diagram (+ optional companion) |
|------|-----------------|
| `feat` | **`sequenceDiagram`** of the new call path; optional `flowchart LR` when shape matters |
| `fix` | **`sequenceDiagram`** of the bug path w/ fix point marked; optional before/after `flowchart` |
| `refactor` | **`sequenceDiagram`** (call order, unchanged) + before/after `flowchart`/`classDiagram` |
| `chore`/`docs` | one line: `<file> (<change>)` OR `**Impact:** N/A — <reason>` |
| `spike` | `flowchart` with `?` on unanswered nodes |

XS keeps the slot (one line counts). When Current state is present, the diagram is *to-be* — don't redraw the as-is.

### 5. Strict task format

`T### [P?] [AC#] [ref: path#anchor]? action — path#anchor (new|edit|delete) — verify: <command or observable>`

Tasks live in `tasks.md`, phased (Setup → Foundational → one per User Story by priority → Polish). Every task has a `T###` id and all four parts, no exceptions. `tasks.md` opens with a **one-line** `> **For humans**` blockquote (what one task line is; the codes are for build agents — keep it, don't grow it, don't strip it in self-review). Brownfield `tasks.md` also opens with `## Guardrails` (invariants from `## Current state`, backticked `` `path#anchor` `` each) — the engineer's **only** up-front invariant read. `[ref: path#anchor]?` is a lazy pointer to design/contract context beyond the row (`plan#scaffold`, `spec#AC1`, a test-plan row, `uxui#S1`), opened when the task starts — this keeps `/implement` from front-loading every artifact.

- **T### + [P?]** — sequential id in execution order; add `[P]` only when parallel-safe (different files, no unmet dependency).
- **[AC#]** — the acceptance scenario this task lands (`[DoD]`/`[SC-###]` for a non-AC task). No tag = scope-creep or a missing spec scenario — fix the spec first.
- **action** — imperative, one verb (`add`, `extract`, `wire`, `delete`, `rename`). Not "implement X" — that's a goal.
- **path#anchor** — a *re-resolvable* location, not a raw line. Cite the **symbol** (`src/users.ts#getUserById`) or a **unique snippet/heading** for shell/config/markdown (`dev-state-mark.sh#"command -v jq"`). Must re-find with LSP/grep *after earlier tasks shift the file* — a bare `:42` goes stale. A line number is allowed only as a write-time hint (`#getUserById (~L42)`), never the sole handle. `path (new)` for new files; cite the precedent when mimicking a pattern (`mirror src/handlers/orders.ts#createOrder`).
- **verify** — a command (`npm test src/foo.test.ts`, `curl -s :8080/health | jq .status`, `psql -c "\d users"`) or a concrete observable (`column email_verified exists`). "manually check"/"visually inspect" = task too big, split it. *Single highest-leverage rule in this skill.*

### 6. One task → one verify; else split

Multiple verifies = multiple things → split. Tasks are atomic (1-to-1 to commits in spirit). `engineer` runs the verify literally after the task. The per-AC *test strategy* (which level proves each scenario) lives in `test-plan.md` (`qa`'s contract), not here.

### 7. Type-specific rules

- **`feat`** — standard plan.
- **`fix`** — task 1 in `tasks.md` MUST be "write failing regression test for <bug>" against `spec.md > Reproduction`. Address the **root cause**, not the symptom — if the fix is "catch the exception"/"guard the null", document why the local fix is correct rather than upstream.
- **`refactor`** — one-line behaviour-equivalence in `Summary`. Lean on the existing suite where it covers the touched behaviour; where it doesn't, **task 1 = characterization baseline** (golden-master/snapshot of current behaviour, captured before the change), mirroring `fix`'s regression test.
- **`chore`** — minimal plan; skip Risks for XS.
- **`docs`** — one task per doc file; no test planning.
- **`spike`** — `Out of scope` MUST say "no production code lands — engineer writes `recommendations.md` only". Tasks may be open-ended.

### 8. Self-review before status = draft

Walk these (detail + examples: `references/self-review.md`). If any fails, fix before `draft`:

- **Summary for a non-technical reader** — `## Summary` + `## Technical Context` + `## Gate check` present; Summary carries no `path#anchor` (that's Current state's job) and links User Stories rather than restating them.
- **Anti-placeholder** — no `TBD`/`TODO`/`???`/`appropriate X`/`as needed`/`path/to/file`/hedging modals in tasks.
- **Trigger discipline** — every present section's trigger fires; DELETE `Risks: N/A`/`Dependencies: None`. Always-include exceptions: the Diagram (one line on XS) and `## Phases for this task` (states matrix defaults even with no deviation; `WORKFLOW.md > Per-task phase plan`).
- **AC sufficiency, not just coverage** — every task carries ≥ 1 `[AC#]`, but presence is the floor. The tasks per scenario, *together*, must **fully deliver** it, and ≥ 1 of their `verify:` clauses must be the scenario's actual acceptance check (the `Then <outcome>`). **The boundary/error scenario needs its own delivering+verifying task** — happy-path-only leaves it unbuilt. A `measured:` target is an AC — its verify runs the measurement.
- **Section integrity** — Alternatives rejections cite evidence (load test/incident/spike), not "feels slower"; Current-state claims cite `path#anchor`; every `★` matches a `new` in tasks and vice versa.
- **Guardrails present** *(brownfield)* — `tasks.md` opens with `## Guardrails` (greenfield → `none`); no invariant left only in `## Current state`/`## To explore` — a miss becomes a `BLOCKER:` at implement.
- **Budget** — each section within its `plan-sections.md` Budget; cap prose, never drop `[AC#]`/`path#anchor`/`verify:`/mermaid.
- **Scaffold integrity** *(M/L)* — `## Scaffold` exists; every `★` file maps to a `(new)` task (and vice versa); every signature is one a task fills; a decision-bearing type is shown as a definition; block stays signatures/type-shapes/one-line stubs; no separate `## Folder structure`.
- **Verify-per-task** — every verify is a runnable command or concrete observable.
- **Parallel-phase integrity** *(feat with parallel phases)* — the contract below (≥ 2 parallel phases, pairwise-disjoint exclusive file sets, no cross-phase symbol import, a sequential integration phase owning shared glue + verifies, any split AC's acceptance-verifying task in integration). A violation makes the orchestrator refuse fanout or the integrator block — fix before `draft`.

### 9. Lead plan.md with Summary + Technical Context + Gate check

- **`## Summary`** — 2–3 sentences: the approach + why over the obvious alternative (each User Story = one vertical slice). No `path#anchor` (that's Current state).
- **`## Technical Context`** — language/framework, storage, testing, target platform, perf goal (links `SC-###`), scale. Link the spec's product win, don't restate.
- **`## Gate check`** — the `rules/fundamentals.md` layers this crosses (trust boundary; ponytail/new-dependency; a11y/concurrency/db/observability), one line each. This is the foundation's Constitution Check; a violation needs justification or a plan change.

Always rendered, every Size/Type (one line fine on XS). Summary = 30-second prose; Current state (when present) = the cited detail — complement, not duplicate.

### 10. Scaffold the skeleton before a long build (M/L)

`## Scaffold`: one fenced block, target file tree (★ new · ~ edited) with each new/changed file's **key exported signature(s)** inline — the skeleton the gate reviews and the engineer builds first.

- **Required** M/L · optional mini for S touching existing code · skip XS.
- **Placement** after the diagram; engineer builds the scaffold before the `tasks.md` tasks fill it.
- **Subsumes `## Folder structure`** for M/L (don't write both). Keep a separate `## API / event contracts` only when a transport contract/port needs field-level/error-code detail richer than the one-line signature.
- **Show decision-bearing type shapes as definitions** — a discriminated union, value object, or state enum where the wrong shape leaves an *illegal state representable* ([[programming-fundamentals]]). Don't expand every DTO — only types whose *shape is itself a choice*.
- **Skeleton, not implementation** — signatures + type shapes + at most a one-line stub body (`throw new Error('not implemented')`) inside the fence. Real bodies rot (see anti-patterns).

```
src/payments/                          ★ new module
  domain/charge.types.ts      ★  type ChargeResult = { ok: true; receiptId: string } | { ok: false; reason: DeclineReason }
  ports/charge.port.ts        ★  interface ChargeProvider { charge(r: ChargeReq): Promise<ChargeResult> }
  app/charge.usecase.ts       ★  chargeOrder(orderId: string): Promise<Receipt>
  adapters/stripe.client.ts   ★  class StripeClient implements ChargeProvider
  orders/order.service.ts     ~  + call chargeOrder() in placeOrder()
```

## Draft order

Work the 10 principles top-down — they're in execution order (spec → size → current state → diagram → task format → self-review), loading each decision's construction skill via `.claude/rules/fundamentals.md` (**trust boundary → [[security-fundamentals]]**; the planner is where injection gets designed out — name `textContent` not `innerHTML` in the task). Then draft **plan.md**: Summary → Technical Context → Gate check → Phases for this task → Fanout plan → Current state (if required) → Diagram → Scaffold (M/L) → (size-gated sections) → Rollback → Out of scope. Then **tasks.md**: `## Guardrails` (brownfield invariants; greenfield `none`) → phased `T###` tasks → AC→task coverage list.

## Section gating by Size

| Section | XS | S | M | L |
|---------|----|----|----|----|
| Summary + Technical Context + Gate check | ✓ | ✓ | ✓ | ✓ |
| Tasks (in `tasks.md`: `T###` + verify + AC tag) | ✓ | ✓ | ✓ | ✓ |
| Task phases (Setup/Foundational/per-US/Polish) | optional | optional | ✓ | ✓ |
| Current state (principle 3) | brownfield → proportional note (entry point + blast radius); greenfield → skip | brownfield → proportional note (full for refactor/fix); greenfield → skip | ✓ | ✓ (+ as-is mermaid for refactor) |
| Guardrails header (in `tasks.md`; digest of Current-state invariants) | brownfield → invariants, else `none` | brownfield → invariants, else `none` | brownfield → ✓ | brownfield → ✓ |
| To explore at implement (deferred internals) | skip | brownfield → when deferred | brownfield → when deferred | brownfield → when deferred |
| Architecture diagram | one-line / N/A | mini mermaid (3–5 nodes) | full mermaid by Type | full + before/after |
| Scaffold (tree + signatures) | skip | optional (when touching existing code) | ✓ required | ✓ required |
| (Optional) Parallelizable phases (in `tasks.md`) | skip | skip | skip | ✓ if >12 tasks; feat-only |
| Alternatives considered (+ Verified line) | skip | skip | when non-obvious | ✓ |
| Risks | skip | optional | ✓ | ✓ |
| Observability | skip | when feat/fix ships runtime + new op surface | required if feat/fix | ✓ |
| Dependencies (WHEN-only) | skip unless present | skip unless present | skip unless present | when blocking handoffs exist |
| Rollback | skip (revert commit) | skip unless destructive | ✓ if destructive | ✓ runbook |
| Out of scope | skip if no creep risk | skip if no creep risk | when creep risk | ✓ |

Sections marked `skip` are **DELETED entirely** — no empty headers, no "N/A" lines.

### Phases for L plans

When `tasks.md` grows past ~12 tasks, group them under named phases (`### Phase 1: schema migration`, etc.), each with its own ordered `T###` tasks. `engineer` creates one `TaskCreate` per phase + one nested task per `T###`. Phases are *grouping*, not gates — `/dev` already gates between Phase 1 and Phase 2 at spec-approval.

#### Parallelizable phases (feat-only — the implement-fanout contract)

A `feat` plan MAY mark phases **parallelizable** so implement runs one engineer per phase concurrently (`engineer` Mode A returns `FANOUT_REQUESTED: implement:<phase-list>`; pattern in `fanout-team-agents/SKILL.md`). **feat-only** — `fix`/`refactor`/`spike` carry task-1 ordering that parallel phases break.

Mark parallel only with **≥ 2** such phases (a lone one gains no concurrency; the orchestrator falls back to sequential). Each parallelizable phase declares, under its `### Phase N:` heading:

- `**Parallelizable:** yes`
- `**Files touched (exclusive):**` — the exact paths this phase owns. **No other parallel phase may list any of these.** The orchestrator computes the pairwise intersection and **refuses fanout if any is non-empty** — a shared file (barrel/index, route registration, DI container, lockfile, shared types, any codegen output) is never a parallel phase's file; it belongs to integration.
- `**Depends on:** P<n> | none` — a parallel phase must be `none` (a dependency edge also makes the orchestrator refuse fanout).

Every plan that marks phases parallel MUST end with a sequential **integration phase** (`### Phase <last>: integration`, `**Parallelizable:** no`). It is the single place that touches shared glue, installs deps, **runs the verifies**, and reconciles acceptance — parallel phase-engineers are **write-only** (Edit/Write only their exclusive files; no verifies, deps, git, or `spec.md` ticks). qa (step 5) + review (step 6) are the catch.

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

Composes, doesn't replace. Load the construction-fundamentals layer(s) the work touches **first** (run order: `.claude/rules/fundamentals.md`) — their output is the substance of `Summary` + `tasks.md`; `fix` plans run [[debug-fundamentals]] first. [[git-workflow]] pairs at ship time (atomic tasks → atomic commits). Skip triggers are in the frontmatter.

## Anti-patterns

- **Hour/day estimates** — planning fallacy makes these wrong by 2–4×. Use `Size` only.
- **"Considerations"/"Notes" bucket sections** — every insight goes in a section that drives action (tasks, Risks, Alternatives, Out of scope). Buckets become dumps.
- **Designing for hypothetical future requirements** — if the spec doesn't ask, the plan doesn't plan for it. Carry to `FOLLOWUPS.md`.
- **Unpinned/assumed dependencies** — "add fast-csv" with no version, or a package you didn't confirm exists, invites a hallucinated/typo-squatted dep. Pin an exact existing version; verify it resolves (lockfile / `npm ls pkg@ver`).
- **Implementing a new port/boundary without naming its interface first** — the engineer will invent signatures and the adapter drifts. Name interface + signatures in `## API / event contracts` before the tasks that fill them.
- **Empty triggered sections** — an `Architecture diagram: N/A` on an XS string change, a `Risks: N/A`. DELETE the whole section. Also: don't invent an Observability line to fill a slot; don't write `Alternatives` without a Verified line; don't tag a task `[AC#]: all`.

## References

Pick by friction:
- `references/size-tiering.md` — XS/S/M/L picker, edge cases, greenfield/brownfield `field`, per-size budgets.
- `references/diagrams.md` — mermaid templates per Type, `flowchart` vs `sequenceDiagram` vs `classDiagram`, L-plan two-diagram pattern.
- `references/current-state.md` — LSP-walk technique, what counts as an invariant, worked examples per Type, the caller-count framing.
- `references/self-review.md` — the six scans in detail with the anti-placeholder regex list and extra M/L checks.
- `references/plan-sections.md` — the authoritative trigger + placement + Reader + Budget list for every optional plan section (size-axis companion is `## Section gating by Size` above).
