# Design

## Current state

- `RuntimeTools`, `RuntimeGate`, and `RuntimeProvider` are private structs in
  `crates/changeloop-app-server/src/executable.rs`. App-server constructs them
  internally for confirmed-change runs and durable pauses.
- `changeloop-acp-runtime` builds a read-only turn loop from:
  - `WorkspaceTools` wrapping a single `ToolRuntime` with conversation authority
  - `HarnessGate` evaluating policy with `LifecycleAuthority::Conversation`
  - `AdapterProvider` bridging async provider adapters into `StreamingProvider`
- The two gate implementations share policy evaluation but diverge on process-tool
  contract decoding and hard-boundary handling inside `RuntimeGate`.

## Decisions

- **Decision:** publish the three runtime wiring types and their constructors from
  `changeloop-app-server` rather than moving them into a new crate.
  - **Why:** app-server already owns the authoritative implementations; exporting
    them collapses duplication without a crate split.
  - **Rejected:** extracting a fourth `changeloop-runtime-wiring` crate in D1 —
    scope creep for a wiring-only exposure.

- **Decision:** add explicit read-only constructors that pin conversation authority
  and call the existing `RuntimeTools::new(..., allow_children: false)` path.
  - **Why:** callers must not construct a mutation-capable surface by accident;
    the constructor encodes the authority floor.
  - **Rejected:** documenting "pass `allow_children: false`" without a named
    constructor — too easy to mis-wire.

- **Decision:** publish `RuntimePolicy` and `ProviderExecution` alongside the three
  runtime types so external callers can build a gate and provider without reaching
  into private app-server helpers.
  - **Why:** `RuntimeGate` and `RuntimeProvider` constructors need policy and
    execution configuration inputs that are already stable value types.
  - **Rejected:** a builder trait layer — unnecessary for D1.

- **Decision:** leave ACP on its duplicated wiring for now; record D2 migration as
  follow-up.
  - **Why:** ACP advertises a four-tool surface while `RuntimeTools` exposes the
    full app-server catalog. Swapping wiring requires reconciling tool definitions
    and permission prompts, not just importing constructors.
  - **Rejected:** partial ACP migration that imports only `RuntimeGate` — would
    still leave two tool dispatchers.

## Compatibility and migration

Non-breaking for existing app-server callers: types become public; internal call
sites unchanged. New public API is additive.

ACP migration (D2) can replace `HarnessGate` with `RuntimeGate::read_only`,
`AdapterProvider` with `RuntimeProvider::new`, and eventually `WorkspaceTools`
with a narrowed adapter over `RuntimeTools::read_only`.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| External callers construct mutation-capable tools | `read_only` constructor validates conversation session kind | test |
| Read-only gate diverges from confirmed-change gate | Reuse existing `RuntimeGate::decide`; shared tests for conversation denials | test |
| Published types leak internal mutation hooks | `install_delegation_governor` stays crate-private; only constructors exported | test |
