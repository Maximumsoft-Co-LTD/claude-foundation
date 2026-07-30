# Test plan: <title>

**Spec**: [./spec.md](./spec.md)
**Plan**: [./plan.md](./plan.md) · **Tasks**: [./tasks.md](./tasks.md)
**Status**: draft | approved
**Mode**: Full (feat / refactor) | Fix (fix)

> **For humans** — one row per spec promise (`AC#`): what each test checks, at which level (unit/integration/e2e). The rest is detail for the test agent.

## Coverage plan *(required)*

One row per spec.md acceptance scenario (`AC#`) — happy path AND its boundary/error scenario are separate rows. Every scenario maps to ≥ 1 planned test; pick the level that owns the behaviour. (e2e opt-in — only when `e2e_visual=on`; under `off`, map a user journey to integration.)

| AC | Evidence (structural / behavioral / rendered / integration / measured / security / manual) | Level (unit / integration / rendered-smoke / e2e / manual) | What the test asserts | Notes |
|----|---------------------------------------------------------------------------------------------|------------------------------------------------------------------|-----------------------|-------|
| AC1 | behavioral | unit | <behaviour the test pins down> | |
| AC1 (on error / boundary) | structural | unit | <unhappy-path assertion> | |
| AC2 (measured: <target>) | measured | integration | <test that runs the measurement> | measured region: `<application operation>` · excludes: `<harness setup>` |

---

## Execution contract *(runnable types)*

Every command names its execution boundary and discovery expectation:
- **Full-suite** (final gate, sets ship-blocking `passing`): `<npm test | pytest | go test ./... | cargo test | aggregator>` · cwd: `<path>` · env/dependencies: `<none or names>` · expected groups/min tests: `<groups/count>`
- **Impacted** (inner cycles): `<vitest related | jest --findRelatedTests | pytest --testmon/-k | go test <pkg> | cargo test <mod>>` · cwd: `<path>` · env/dependencies: `<none or names>` · expected groups/min tests: `<groups/count>` — no related mode → Impacted = full suite (state it).
- **Rendered smoke**: `<command or n/a>` · browser/viewport: `<value>` · required when any AC owns `rendered` evidence; separate from full E2E.

Full suite runs **once per run**; every inner cycle uses Impacted.

---

**Optional sections** — add when it applies, delete the rest:

Edge cases to probe · Out of test scope · Fixtures / data / env · Regression contract (fix) · Baseline (refactor / brownfield feat) · Coverage targets · Visual verification (e2e_visual=on)
