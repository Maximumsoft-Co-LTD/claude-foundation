# Size Tiering for Plans

Size gates which `plan.md` sections are required/optional/deleted. Borderline → **larger tier** — under-covering burns a review cycle; over-covering costs a few skipped sections. XS floor: describable in one sentence.

> **Machinery estimate is tie-broken differently.** The plan-section rule above stays conservative (sections are cheap). For the orchestrator's **machinery** estimate (`state.json > size` — how many spawns the run gets), a borderline XS/S or S/M with **no hard risk flag** (persisted-data/schema/API-contract change, security-sensitive path, cross-repo coupling, migration) picks the **smaller** tier: `SIZE_UPGRADE` ratchets up mid-run if the code walk proves bigger, while over-sized machinery never shrinks. Borderline M/L → **L** always.

## The four tiers

| Size | Files | Logic | Contract / schema | Subsystem reach | Typical Types |
|------|-------|-------|-------------------|-----------------|---------------|
| **XS** | 1 | none | no | none | chore, docs |
| **S**  | ≤ ~5 (one understood surface) | simple | no | 1 | fix, small feat, small refactor |
| **M**  | ≤ ~10 | real | no | 1 | feat, refactor |
| **L**  | any | real | **yes** (or breaking) | ≥ 2 | feat, refactor, fix at a seam |

"Real logic" = branching, state, side effects. "Simple logic" = one branch, no state. "Contract/schema" = public REST/gRPC API, DB schema, queue message shape, IPC, event payload.

> **File count is a proxy, not a gate.** A **self-contained greenfield module** caps at **S regardless of file count** — a 3-file vanilla CRUD app is S, not M. Blast radius, not file spread (see the greenfield def below).

## Greenfield vs brownfield (the `field` classification) — canonical

Orthogonal to size, every run is one of two **fields**, recorded in `state.json > field`. This is the **canonical definition** — `orchestrator.md`, `lead.md`, `WORKFLOW.md`, and `plan-writing > principle 3` point here.

- **greenfield** — new, isolated code: nothing imports it yet, no published contract, no integration with existing code, first-party storage only. Same condition as the self-contained-module S-cap, so **greenfield is always XS/S**.
- **brownfield** — modifies/extends existing behaviour, or wires new code into existing paths. The default: **every `fix`, every `refactor`, and every M/L run is brownfield**. A mixed run (new isolated module *plus* an edit to existing code) is **brownfield** — the integration carries the risk.

`field` is estimated by the orchestrator at digest time and re-derived by `lead` at plan time. Like `size` it **ratchets one way**: a greenfield estimate the code walk reveals to be an integration upgrades via a first-line `FIELD_UPGRADE: brownfield — <reason>` signal; it never moves back.

**What `field` gates** — brownfield turns these on, greenfield skips ("nothing to preserve; got the shape right the first time"):
- **Understand** — a `Current state` map before designing (`plan-writing > principle 3`). All brownfield.
- **Lock** — a characterization baseline pinning touched behaviour *before* it's edited (`test-plan.md > Baseline`), for brownfield `feat`/`refactor`; `fix` locks via its regression contract instead.

## Picker — answer in order

1. **Touches a public contract or schema?** (REST/gRPC API, DB schema migration, queue message format, public signature, breaking change) → **L**. Stop.
2. **Crosses >1 subsystem in a way that *couples* them?** (API + worker that must agree; two bounded contexts; a service + a sibling sharing its contract) → **L**. Stop. It's *coupling*, not raw count — the same trivial edit swept across N **independent** surfaces is a parallel sweep (see Signals → "Wide but shallow"), sized by its deepest single surface.
3. **Real logic to design?** (branching, state machine, retry policy, ordering, concurrency) → **M** if single-subsystem — **unless it's a self-contained greenfield module**, which caps at **S** (logic is real but blast radius ~zero).
4. **>2 files, OR any logic at all?** → **S**.
5. **Single file, no logic, no user/caller-visible change?** (typo, dep bump, doc edit, formatter, comment) → **XS**.

Two answers equally true → plan `Size`: pick **larger**; machinery (`state.json > size`): risk flag present → larger, none → **smaller** (header note). Exception: the greenfield S-cap is a *defined route*, not a torn case — don't round a hermetic new module up to M for having several CRUD features.

## Scorecard fallback — calibrate the picker

Use when borderline. It **calibrates** the tier; it doesn't replace the hard picker stops. Score the deepest single surface.

| Factor | 0 | 1 | 2 |
|--------|---|---|---|
| Layers touched | 1 | 2–3 | 4+ |
| Data change | none | field/index/config | migration/backfill/rewrite |
| Cache complexity | none | simple TTL/read-through | invalidation/fallback/race-prone |
| Deployment risk | normal deploy | flag/config/rollout toggle | migration/rollback/restore |
| Observability | existing | one metric/log/trace | dashboard/alert/runbook/SLO |
| Security/compliance | no sensitive data | existing auth/privacy path | PII/secrets/signature/audit/auth boundary |
| Test scope | unit/static only | unit + integration | e2e/contract/perf/recovery |

| Score | Size |
|-------|------|
| 0–2 | XS / patch lane (when the patch-lane rule also holds) |
| 3–5 | S |
| 6–8 | M |
| 9–11 | L |
| 12+ | L; consider epic/split only if the spec has independently shippable slices |

Hard overrides win over the arithmetic:
- Public API/event/schema migration/backfill → at least L.
- Auth/session/crypto/secrets/PII or other real trust boundary → at least M; L when it also changes a public contract or compliance surface.
- Queue/broker/async worker delivery semantics → at least M, often L.
- Self-contained greenfield module stays capped at S unless it adds a public contract, real schema, or existing-code integration.
- Wide-but-shallow multi-repo sweep scores the **deepest single repo surface** — no points for repo count.

## Worked examples

Calibration examples — apply hard overrides after scoring.

| Example task | Score | Size | Why | Measurable done |
|--------------|-------|------|-----|-----------------|
| Add unread-count badge in a Next.js inbox using an existing API | 2 | XS/S | UI change, existing API, no new contract. Patch lane only if display-only + one file. | Badge updates after a new message; unit + component tests pass. |
| Add the same config line to one file in each of several independent repos | 2 | XS | Wide-but-shallow sweep: one trivial edit per repo, no shared contract. Repo count drives parallel verify, not size. | Each repo has the line; per-repo static/smoke check passes. |
| Create one Go endpoint listing `conversations` from MongoDB with pagination | 3 | S | Single service path, existing repository pattern, no contract break. | p95 < 300ms on 1,000-conversation dataset; unit + handler/repo tests pass. |
| Add a one-line guard for a known bug inside an existing function | 3 | S | Tiny diff, but behaviour changes and fix requires a regression test first. | Regression test fails pre-fix, passes on current code. |
| Publish inbound messages via RabbitMQ + persist normalized messages in MongoDB | 5 | M | Queue + persistence + integration tests; delivery semantics/ack need design. | Message stored once, acked once; duplicate delivery idempotent. |
| Add Redis session cache for active chat assignment | 5 | M | Cache expiry, fallback, race conditions need design; state-consistency risk. | Lookup p95 < 50ms; MongoDB fallback verified; expiry/race tests pass. |
| Add webhook signature verification to an existing inbound endpoint | 6 | M | Existing endpoint + auth boundary; trust-boundary design + negative tests. | Invalid signature rejected; valid proceeds; no secret logged; security review passes. |
| Add ClickHouse analytics ingestion for message volume by channel | 8 | M | Batching/idempotency, dashboard query risk, observability. | Dashboard shows per-channel volume < 5min of event time; duplicates don't double-count. |
| Add MongoDB migration/backfill for `conversation_id` index used by existing queries | 9 | L | Schema/index/backfill is a hard override: rollback, deploy sequencing, plan verification. | Backfill completes on staging; query plan uses the index; rollback documented. |
| Change a public API/event schema used by multiple services | 10 | L | Coupled multi-service contract; per-repo review can't see version skew. | Producer + consumer contract tests pass; generated clients consistent. |
| Self-contained greenfield todolist app with localStorage | 4 | S | Real UI/state logic but isolated: no callers, no contract, first-party storage. Greenfield cap → S. | Add/edit/delete/filter/persist pass unit + integration; no e2e unless opted in. |
| Consolidated chat inbox spanning Next.js, Go, RabbitMQ, Redis, MongoDB, ClickHouse | 13 | L / split | UI, API, cache, queue, persistence, analytics, security, E2E. | Split into independently shippable slices where possible. |

## Signals that override file count

File count is a proxy; each signal pushes size up or down regardless, with its worked example inline:

- **One file, real logic** (branching/state/retry, a 200-line state machine) → at least S, often M. Logic density beats file count; a state machine also earns a diagram, per-transition AC tags, and observability.
- **One file, public API signature or DB migration** → L. Contract changes are always L. Blast radius decides, not line count — a one-line guard inside a function is S (fix → regression test first); a one-line change to a public API is L.
- **Many files, pure rename/formatter/mechanical sweep** → still XS/S. No design risk.
- **Many files, "ripple from removing one thing"** → S or M by the call sites' logic. *Design* of the removal is what bumps it.
- **Wide but shallow — a parallel sweep of the same trivial edit across N *independent* surfaces** (a 2-line health registration added to 7 sibling services + one compose edit): size by the **single deepest surface** (here the compose/infra edit, S), not the count — *only when all hold*: (a) each edit trivial + near-identical, (b) surfaces **independent** (no shared contract), (c) deepest single surface ≤ M. Width drives **parallel review/test fan-out** (`fanout-team-agents > surface fanout`), not ceremony; **shallow ≠ safe** — each surface still gets its own runtime verify. **Coupled** surfaces (shared proto/DB/contract in lockstep) = the L in picker step 2 + a cross-repo coherence check.
- **Security-sensitive path** (auth, crypto, exec, deserialise of untrusted input, raw SQL, file/path) → bump one tier *when the security review fires*. **Exception — first-party browser-storage round-trip:** `JSON.parse` of the app's own `localStorage`/`sessionStorage`/`IndexedDB` single-user data isn't untrusted deserialisation → **no** bump (`WORKFLOW.md > Security trigger`) — *unless* it crosses a real trust boundary (multi-user/shared-device, server-written) or flows to a dangerous sink (`innerHTML`/`dangerouslySetInnerHTML`/`eval`/…).
- **Self-contained greenfield module** → cap at **S** even with multi-feature CRUD (a vanilla-JS todolist: add/edit/delete/filter/persist, 3 files, localStorage — several ACs of real logic, but a hermetic module → S not M). M-tier machinery prices blast radius + cross-component coordination; a hermetic module has neither. Re-enters M when something depends on it, it grows a contract/schema, or it integrates with existing code.
- **Introduces a queue/broker/async worker/pub-sub** → at least M, often L. The delivery/idempotency/retry/ordering contract needs documentation even for one consumer file.
- **"Looks like a chore but it's a feature"** — "bump library X" but the new version changes default error handling, so call sites behave differently → **feat**, S/M. User-visible behaviour change = not a chore; re-pick Type first, then Size.
- **Docs-only but many files** — mechanical rename across 30 guides → **XS** ("find/replace + spot-check" is the whole procedure). Rewriting a guide because the *system* changed is the doc step of that system change's own plan, not docs-only.
- **Spike** — size is exploration scope, not code spread (none lands). Most spikes S/M; use `Timebox` in `spec.md`.
- **Full-stack (DB + API + UI)** — default = single L plan, single run. Three layers is normal, NOT a split reason. Split only when `Ship as: staged` AND the spec lists ≥ 2 independently shippable capabilities (`WORKFLOW.md > Scope`).

## Section gating by Size

The authoritative table for `SKILL.md > Section gating by Size` — per XS/S/M/L, which `plan.md`/`tasks.md` content is required/optional/deleted. `skip` = *delete the section*, not leave it empty.

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

## Plan-write time budget

| Size | Time | Notes |
|------|------|-------|
| XS | 2–5 min | Almost entirely template fill-in |
| S | 5–15 min | Real thinking about Steps + Diagram |
| M | 20–45 min | Alternatives + Diagram + Risks need thought |
| L | 1–2 hr | Two diagrams + Dependencies + L-grade Rollback runbook |

Spending 2× the budget at any tier = scope grew without a Size bump, or the spec is too vague to plan against — go back to spec, don't paper over with a longer plan.
