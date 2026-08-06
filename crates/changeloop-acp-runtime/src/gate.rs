//! The three small ports around the turn loop: who decides, who cancels, and
//! what happens when the model asks for a capability this transport cannot
//! reach.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use changeloop_agent::{ChildResult, SubagentSpec};
use changeloop_policy::{
    AUTO_CLASSIFIER_VERSION, DecisionAction, ExecutionMode, LifecycleAuthority, OperationKind,
    PermissionKind, PolicyRequest, Reversibility, RuleAction, SandboxCapability, evaluate,
};
use changeloop_runtime::{ChildExecutor, Control, ControlSource, PermissionGate, ToolCall};

/// The permission decision, taken by `cloop`'s policy engine.
///
/// The connected ACP client is never consulted about *whether* a call needs
/// asking — only about the answer, and only when this gate returns
/// [`DecisionAction::Ask`]. `lifecycle_authority` is fixed at
/// [`LifecycleAuthority::Conversation`] for the life of the connection, which
/// is what makes every write, shell and test permission a deterministic
/// `change_unconfirmed` denial rather than a prompt an editor could answer its
/// way past.
pub struct HarnessGate {
    mode: ExecutionMode,
    configured_action: RuleAction,
}

impl HarnessGate {
    #[must_use]
    pub const fn new(mode: ExecutionMode, configured_action: RuleAction) -> Self {
        Self {
            mode,
            configured_action,
        }
    }

    /// The mode's default rule.
    ///
    /// `ask` maps to [`RuleAction::Ask`] so that every tool call — including a
    /// passive read, which the auto classifier would otherwise allow silently —
    /// is presented to the attached client. That is the whole reason an editor
    /// implements `session/request_permission`.
    #[must_use]
    pub const fn for_mode(mode: ExecutionMode) -> Self {
        let configured_action = match mode {
            ExecutionMode::Ask => RuleAction::Ask,
            _ => RuleAction::Auto,
        };
        Self::new(mode, configured_action)
    }
}

impl PermissionGate for HarnessGate {
    fn decide(&mut self, call: &ToolCall) -> DecisionAction {
        let operation = if call.mutating {
            OperationKind::Write
        } else {
            match call.permission {
                PermissionKind::Shell | PermissionKind::Test => OperationKind::Execute,
                PermissionKind::WebFetch | PermissionKind::WebSearch => OperationKind::Network,
                PermissionKind::ExternalSideEffect => OperationKind::ExternalSideEffect,
                PermissionKind::Lifecycle => OperationKind::Lifecycle,
                _ => OperationKind::Read,
            }
        };
        evaluate(&PolicyRequest {
            classifier_version: AUTO_CLASSIFIER_VERSION,
            mode: self.mode,
            configured_action: self.configured_action,
            permission: call.permission,
            operation,
            paths: call
                .arguments
                .get("path")
                .and_then(serde_json::Value::as_str)
                .map(|path| vec![path.to_owned()])
                .unwrap_or_default(),
            network_destination: None,
            reversibility: Reversibility::Reversible,
            // An ACP client mediates the workspace through this process, which
            // holds no write lease for a conversation.
            sandbox: SandboxCapability::ReadOnly,
            lifecycle_authority: LifecycleAuthority::Conversation,
            hard_boundaries: Vec::new(),
        })
        .action
    }
}

/// Cancellation reaching the synchronous turn loop.
///
/// The ACP dispatcher cancels between steps; this flag is what stops a turn
/// that is already inside a provider stream, so `session/cancel` terminalizes
/// in-flight tool calls instead of leaving them stranded.
#[derive(Clone, Debug, Default)]
pub struct TurnControl(Arc<AtomicBool>);

impl TurnControl {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

impl ControlSource for TurnControl {
    fn poll(&mut self) -> Control {
        if self.is_cancelled() {
            Control::Cancel("cancelled by the ACP client".into())
        } else {
            Control::Continue
        }
    }
}

/// Delegation is not reachable over this transport.
///
/// A child session needs a delegation grant authored by the harness against a
/// change, and an ACP conversation has none. Returning an error makes the model
/// see a failed tool call it can route around, and makes the client see a
/// failed `tool_call_update`; silently succeeding, or blocking, would be worse
/// than either.
pub struct NoChildExecutor;

pub const DELEGATION_UNAVAILABLE: &str = "subagent delegation is not reachable from an ACP conversation: a child contract requires a \
     harness-authored grant against a confirmed change";

impl ChildExecutor for NoChildExecutor {
    fn execute(&mut self, _spec: &SubagentSpec) -> Result<ChildResult, String> {
        Err(DELEGATION_UNAVAILABLE.to_owned())
    }
}
