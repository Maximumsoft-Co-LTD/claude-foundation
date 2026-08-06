//! An Agent Client Protocol (ACP) server facade over the Changeloop session
//! surface.
//!
//! ACP is the editor–agent standard introduced by Zed and since adopted by
//! JetBrains and others: JSON-RPC 2.0 over a subprocess's stdio, the same
//! transport shape as LSP, so an agent that speaks it runs wherever LSP runs.
//! Without this crate `cloop` cannot be driven from any ACP client.
//!
//! # The stance this facade takes
//!
//! ACP inverts roles relative to `cloop`: the editor client owns the UI, the
//! workspace mediation and — in the general case — the permission decision.
//! `cloop`'s central bet is that the harness owns authority. So ACP is adopted
//! as a **facade**, not as the native model:
//!
//! - Sessions are `changeloop_session::Session` values with a real
//!   `changeloop_session::Transcript`. There is no parallel session model.
//! - An ACP session is created as a *conversation*, which under `cloop`'s own
//!   rules carries no workspace-mutation authority. An attached editor does not
//!   confer it; [`Connection::mutation_authority`] reports what `cloop` decided.
//! - `session/request_permission` is implemented because the protocol requires
//!   it, and it is how an ACP client surfaces a prompt to a human. It is a
//!   presentation channel, not a transfer of authority.
//!
//! # Three lessons taken from ACP's own history
//!
//! 1. **No cross-version converter.** ACP's maintainers built a general v1↔v2
//!    conversion layer, shipped it, and deleted it as "doing more harm than
//!    good since there are plenty of unrepresentable states". Exactly one
//!    version is negotiated per connection and only that version is spoken;
//!    see [`version`].
//! 2. **Explicit identifiers, never inferred boundaries.** ACP needed a
//!    dedicated `messageId` RFD after inferring message boundaries from a
//!    change of update type proved insufficient — two consecutive same-type
//!    messages coalesce. Every streamed update here names its message and part
//!    id in `_meta`; see [`connection`].
//! 3. **Unrepresentable states surface.** A `cloop` part with no ACP shape is
//!    reported by name rather than flattened into prose; see [`mapping`].
//!
//! # Shape
//!
//! ```text
//! bytes ──▶ jsonrpc::decode_line ──▶ Connection::handle_line ──▶ Vec<Outgoing>
//!                                          │
//!                                          ├── version::ProtocolState  (one version, no mixing)
//!                                          ├── mapping::map_part       (cloop part ▸ ACP update)
//!                                          ├── cancel::CancelTree      (cascading cancellation)
//!                                          └── TurnDriver              (the runtime port)
//! ```
//!
//! [`Connection`] performs no I/O, so every protocol property is provable
//! without a subprocess. [`stdio::serve`] is the thin loop that adds one.
//!
//! # Status
//!
//! Implemented: JSON-RPC framing and errors, `initialize` with version
//! negotiation, `session/new`, `session/load` with cursor replay,
//! `session/prompt` with streamed updates, `session/cancel`,
//! `$/cancel_request`, and agent-to-client `session/request_permission`.
//!
//! Not implemented: `authenticate` (no auth methods are advertised, and it
//! answers with an error rather than pretending), the client-side `fs/*` and
//! `terminal/*` calls an agent may make, session modes, slash commands, and
//! `plan` updates. Model and tool execution arrive through [`TurnDriver`];
//! this crate ships only [`testing::ScriptedDriver`] as an implementation.

pub mod cancel;
pub mod connection;
pub mod jsonrpc;
pub mod mapping;
pub mod schema;
pub mod stdio;
pub mod testing;
pub mod version;

pub use cancel::{CancelTree, ScopeId};
pub use connection::{AgentConfig, Connection, IdSource, TurnDriver, TurnStep, method};
pub use jsonrpc::{ErrorObject, Incoming, Outgoing, Request, RequestId, Response};
pub use mapping::{PartProjection, PromptMappingError, map_part, prompt_to_parts};
pub use schema::{ContentBlock, PermissionOption, PermissionOutcome, SessionUpdate, StopReason};
pub use stdio::{ServeOutcome, serve_stdio};
pub use version::{
    ProtocolState, SUPPORTED_PROTOCOL_VERSIONS, VersionError, latest_supported_version,
    negotiate_version,
};
