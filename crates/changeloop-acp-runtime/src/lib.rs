//! The runtime behind the ACP facade.
//!
//! [`changeloop_acp`] implements the Agent Client Protocol completely at the
//! protocol layer and stops at one port, [`changeloop_acp::TurnDriver`]. This
//! crate is the implementation of that port which actually runs an agent turn:
//! a model call through a provider adapter, tool dispatch through
//! [`changeloop_tools::ToolRuntime`], streamed parts read back out of the
//! durable transcript, permission requests raised by
//! [`changeloop_runtime::AgentRuntime`] and presented over the wire, and a
//! terminal stop reason.
//!
//! # Why this is a separate crate
//!
//! `changeloop-acp` is a pure protocol state machine with no I/O and no
//! runtime dependency; that is what makes every protocol property provable
//! without a subprocess. Putting a provider, a tool runtime and a storage
//! handle inside it would destroy that. The split is the same one the facade
//! already draws — protocol on one side of `TurnDriver`, execution on the
//! other — expressed as a crate boundary instead of a module boundary.
//!
//! # The authority boundary
//!
//! An ACP session is a [`changeloop_session::Session::conversation`]. Under
//! `cloop`'s own rules a conversation carries **no workspace-mutation
//! authority**, and nothing in this crate can grant it:
//!
//! - The session is never promoted. [`AcpRuntimeDriver`] never calls
//!   `propose_change` or `confirm_change`; there is no code path from an ACP
//!   message to a `Change` session.
//! - The policy gate is pinned to
//!   [`changeloop_policy::LifecycleAuthority::Conversation`], so
//!   [`changeloop_policy::evaluate`] denies every write, shell and test
//!   permission with `change_unconfirmed` before dispatch is reached — and it
//!   denies them the same way in YOLO mode, because change authority is an
//!   intrinsic policy input rather than a boundary a mode can suppress.
//! - [`changeloop_tools::ToolRuntime`] is constructed with the same
//!   conversation authority, so a mutating call is refused a second time at the
//!   tool layer even if a gate were wrong.
//! - `session/request_permission` offers only *once* options. An ACP client
//!   cannot record a standing grant, and its answer is applied through
//!   [`changeloop_runtime::AgentRuntime::respond_permission`] for exactly the
//!   one tool call that raised it. The harness decided that the call needed
//!   asking; the client only supplied the answer.
//!
//! A mutating intent is therefore reported over the protocol, naming `cloop`'s
//! own change-confirmation path, rather than being performed.
//!
//! # Honest degradation
//!
//! Every turn resolves. A missing provider, a missing model, missing
//! credentials, an unopenable store, a provider error, a refused delegation:
//! each becomes a visible [`changeloop_protocol::MessagePartBody::Error`] part
//! on the wire followed by a terminal stop reason. Nothing waits for a
//! capability that will not arrive, and nothing pretends a capability exists.

pub mod driver;
pub mod gate;
pub mod provider;
pub mod testing;
pub mod tools;

use std::collections::BTreeMap;
use std::path::PathBuf;

pub use driver::{AcpRuntimeDriver, DriverConfig};
pub use gate::{HarnessGate, NoChildExecutor, TurnControl};
pub use provider::{AdapterProvider, EnvProviderFactory, ProviderFactory, ProviderSetupError};
pub use tools::{WorkspaceTools, tool_definitions};

/// Build the driver `cloop acp` serves with, from this process's working
/// directory and environment.
///
/// Infallible on purpose. A workspace that cannot be opened, a provider that is
/// not configured and an absent credential are all reported to the connected
/// client as protocol-level errors, because an ACP agent that exits during
/// `initialize` tells the editor nothing about why.
#[must_use]
pub fn stdio_driver() -> AcpRuntimeDriver<EnvProviderFactory> {
    let environment: BTreeMap<String, String> = std::env::vars_os()
        .filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?)))
        .collect();
    let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    AcpRuntimeDriver::new(
        DriverConfig::from_environment(root, &environment),
        EnvProviderFactory::from_environment(&environment),
    )
}
