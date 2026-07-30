# Parallelizable phases — the implement-fanout contract (full detail)

Deep reference for SKILL.md's "Parallelizable phases" heading (under `## Section gating by Size > ### Phases for L plans`) and for principle 8's "Parallel-phase integrity" self-review bullet. Consult when a `feat` plan's phases might run as concurrent engineers.

A `feat` plan MAY mark phases **parallelizable** so implement runs one engineer per phase concurrently (`engineer` Mode A returns `FANOUT_REQUESTED: implement:<phase-list>`; pattern in `fanout-team-agents/SKILL.md`). **feat-only** — `fix`/`refactor`/`spike` carry task-1 ordering that parallel phases break.

Mark parallel only with **≥ 2** such phases (a lone one gains no concurrency; the orchestrator falls back to sequential). Each parallelizable phase declares, under its `### Phase N:` heading:

- `**Parallelizable:** yes`
- `**Files touched (exclusive):**` — the exact paths this phase owns. **No other parallel phase may list any of these.** The orchestrator computes the pairwise intersection and **refuses fanout if any is non-empty** — a shared file (barrel/index, route registration, DI container, lockfile, shared types, any codegen output) is never a parallel phase's file; it belongs to integration.
- `**Depends on:** P<n> | none` — a parallel phase must be `none` (a dependency edge also makes the orchestrator refuse fanout).

Every plan that marks phases parallel MUST end with a sequential **integration phase** (`### Phase <last>: integration`, `**Parallelizable:** no`). It is the single place that touches shared glue, installs deps, and **runs task-level verifies**; Test later owns acceptance evidence — parallel phase-engineers are **write-only** (Edit/Write only their exclusive files; no verifies, deps, git, or `spec.md` ticks). No parallel phase may import a symbol another parallel phase creates — a cross-phase import is integration glue. An AC split across parallel phases keeps its acceptance-verifying task in integration. A violation makes the orchestrator refuse fanout or the integrator block — fix before `draft`. qa (step 5) + review (step 6) are the catch.

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
