//! The [`TurnDriver`] implementation.
//!
//! One ACP prompt turn is one or more steps of
//! [`changeloop_runtime::AgentRuntime`]. The runtime is rebuilt from a
//! checkpoint on every step rather than held across them, because it borrows
//! the store for its whole life and a turn suspended on a permission request
//! outlives any one borrow. That is the same shape `cloop`'s own service uses
//! for a durable pause, so nothing here is a second lifecycle.
//!
//! Parts are read back out of the transcript the runtime writes, not out of a
//! side channel: what the client sees and what Land would see are the same
//! record, and the ACP projection is the only difference between them.

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use changeloop_acp::connection::{TurnDriver, TurnStep};
use changeloop_acp::schema::{
    PermissionOption, PermissionOptionKind, PermissionOutcome, StopReason,
};
use changeloop_policy::{ExecutionMode, LifecycleAuthority, RuleAction};
use changeloop_protocol::{
    MessagePart, MessagePartBody, OperationId, PartId, PartState, Provenance, SessionId,
    ToolCallId, minimum_part_schema_version,
};
use changeloop_provider_adapters::CancellationToken;
use changeloop_runtime::{
    AgentRuntime, ChildExecutor, ControlSource, Pause, PermissionGate, ResumeBinding, RunOutcome,
    RuntimeBudget, RuntimeCheckpoint, StreamingProvider, ToolDispatcher,
};
use changeloop_session::Session;
use changeloop_storage::Storage;
use changeloop_tools::{ToolPolicy, ToolRuntime};

use crate::gate::{HarnessGate, NoChildExecutor, TurnControl};
use crate::provider::ProviderFactory;
use crate::tools::{MUTATION_REFUSAL, WorkspaceTools};

/// Option identifiers offered on every permission request.
pub const ALLOW_ONCE: &str = "allow";
pub const REJECT_ONCE: &str = "reject";

/// How the driver binds a workspace and a policy mode.
#[derive(Clone, Debug)]
pub struct DriverConfig {
    pub root: PathBuf,
    pub mode: ExecutionMode,
    pub budget: RuntimeBudget,
}

impl DriverConfig {
    #[must_use]
    pub fn new(root: PathBuf, mode: ExecutionMode) -> Self {
        Self {
            root,
            mode,
            budget: RuntimeBudget::default(),
        }
    }

    /// Resolve the policy mode the way the rest of `cloop` does.
    ///
    /// An unset mode resolves to `ask`, not `auto`: the connected editor is the
    /// human in the loop, and defaulting to the mode that consults it is the
    /// conservative choice for a peer this process did not configure.
    #[must_use]
    pub fn from_environment(root: PathBuf, environment: &BTreeMap<String, String>) -> Self {
        let mode = match environment.get("CHANGELOOP_MODE").map(String::as_str) {
            Some("auto") => ExecutionMode::Auto,
            Some("plan") => ExecutionMode::Plan,
            Some("yolo") => ExecutionMode::Yolo,
            _ => ExecutionMode::Ask,
        };
        Self::new(root, mode)
    }

    fn state_directory(&self) -> PathBuf {
        self.root.join(".changeloop")
    }
}

/// Per-ACP-session runtime state. One connection may hold many sessions, so
/// none of it may live on the driver itself.
struct SessionState {
    session: Session,
    checkpoint: Option<RuntimeCheckpoint>,
    /// Transcript messages already projected onto the wire for this session.
    streamed: usize,
}

enum Phase {
    Idle,
    Start,
    /// The turn is suspended on a permission request. `asked` distinguishes the
    /// step that raises the request from the step that consumes its answer.
    AwaitingPermission {
        call_id: ToolCallId,
        title: String,
        asked: bool,
    },
    Finish(StopReason),
}

enum Action {
    Prompt(String),
    Permission { call_id: ToolCallId, allow: bool },
    Abandon,
}

enum StepOutcome {
    Completed,
    Cancelled,
    Permission {
        call_id: ToolCallId,
        title: String,
    },
    /// The turn cannot continue and the reason is reportable.
    Refused {
        code: &'static str,
        message: String,
        reason: StopReason,
    },
}

/// A [`TurnDriver`] backed by the Changeloop agent runtime.
pub struct AcpRuntimeDriver<F: ProviderFactory> {
    config: DriverConfig,
    factory: F,
    control: TurnControl,
    store: Option<Storage>,
    store_error: Option<String>,
    sessions: BTreeMap<String, SessionState>,
    active: Option<String>,
    phase: Phase,
    prompt: Option<String>,
    pending: VecDeque<MessagePart>,
    resumption: Option<PermissionOutcome>,
}

impl<F: ProviderFactory> AcpRuntimeDriver<F> {
    /// Open the workspace store and bind a provider factory.
    ///
    /// A store that cannot be opened is recorded, not raised: the connection
    /// still initializes and every prompt is answered with the reason, because
    /// an agent that exits during `initialize` tells the editor nothing.
    #[must_use]
    pub fn new(config: DriverConfig, factory: F) -> Self {
        let state = config.state_directory();
        let opened = std::fs::create_dir_all(&state)
            .map_err(|error| error.to_string())
            .and_then(|()| {
                Storage::open(state.join("state.db")).map_err(|error| error.to_string())
            });
        let (store, store_error) = match opened {
            Ok(store) => (Some(store), None),
            Err(error) => (
                None,
                Some(format!(
                    "the workspace store could not be opened, so no turn can be recorded: {error}"
                )),
            ),
        };
        Self {
            config,
            factory,
            control: TurnControl::new(),
            store,
            store_error,
            sessions: BTreeMap::new(),
            active: None,
            phase: Phase::Idle,
            prompt: None,
            pending: VecDeque::new(),
            resumption: None,
        }
    }

    /// Build a driver over an already-open store, for tests and embedders.
    #[must_use]
    pub fn with_store(config: DriverConfig, factory: F, store: Storage) -> Self {
        Self {
            config,
            factory,
            control: TurnControl::new(),
            store: Some(store),
            store_error: None,
            sessions: BTreeMap::new(),
            active: None,
            phase: Phase::Idle,
            prompt: None,
            pending: VecDeque::new(),
            resumption: None,
        }
    }

    /// The cancellation flag the turn loop polls. Exposed so an embedder that
    /// owns a signal handler can stop a turn already inside a model call.
    #[must_use]
    pub fn control(&self) -> TurnControl {
        self.control.clone()
    }

    /// Whether `cloop` would let this ACP session mutate the workspace.
    ///
    /// Always `Some(false)` for a known session: an ACP session is a
    /// conversation and this driver never promotes one.
    #[must_use]
    pub fn mutation_authority(&self, acp_session_id: &str) -> Option<bool> {
        self.sessions
            .get(acp_session_id)
            .map(|state| state.session.require_mutation_authority().is_ok())
    }

    fn refuse(&mut self, code: &'static str, message: impl Into<String>, reason: StopReason) {
        self.pending.push_back(error_part(code, message.into()));
        self.phase = Phase::Finish(reason);
    }

    fn advance(&mut self, action: Action) {
        match self.run_step(action) {
            StepOutcome::Completed => self.phase = Phase::Finish(StopReason::EndTurn),
            StepOutcome::Cancelled => self.phase = Phase::Finish(StopReason::Cancelled),
            StepOutcome::Permission { call_id, title } => {
                self.phase = Phase::AwaitingPermission {
                    call_id,
                    title,
                    asked: false,
                };
            }
            StepOutcome::Refused {
                code,
                message,
                reason,
            } => self.refuse(code, message, reason),
        }
    }

    /// Run one step of the turn against a freshly-bound runtime.
    fn run_step(&mut self, action: Action) -> StepOutcome {
        let Some(acp_session_id) = self.active.clone() else {
            return refused(
                "no_session",
                "the prompt named no session".to_owned(),
                StopReason::Refusal,
            );
        };
        let Some(mut store) = self.store.take() else {
            return refused(
                "storage_unavailable",
                self.store_error
                    .clone()
                    .unwrap_or_else(|| "the workspace store is unavailable".to_owned()),
                StopReason::Refusal,
            );
        };
        let outcome = self.run_bound(&acp_session_id, &mut store, action);
        self.store = Some(store);
        outcome
    }

    #[allow(clippy::too_many_lines)]
    fn run_bound(
        &mut self,
        acp_session_id: &str,
        store: &mut Storage,
        action: Action,
    ) -> StepOutcome {
        let Some(state) = self.sessions.get_mut(acp_session_id) else {
            return refused(
                "no_session",
                format!("session `{acp_session_id}` is unknown to the runtime"),
                StopReason::Refusal,
            );
        };
        let cancel = CancellationToken::default();
        if self.control.is_cancelled() {
            cancel.cancel();
        }

        let artifacts = self.config.state_directory().join("artifacts");
        let tools = match ToolRuntime::new(
            &self.config.root,
            &artifacts,
            ToolPolicy {
                mode: self.config.mode,
                // The tool layer enforces the authority floor; the gate above
                // it decides whether to ask. Keeping the rule here on `auto`
                // means a read stays a passive read and a write is refused as
                // `change_unconfirmed`, whatever the gate does.
                configured_action: RuleAction::Auto,
                lifecycle_authority: LifecycleAuthority::Conversation,
                hard_boundaries: Vec::new(),
            },
        ) {
            Ok(tools) => WorkspaceTools::new(tools),
            Err(error) => {
                return refused(
                    "workspace_unavailable",
                    format!("the workspace tool surface could not be opened: {error}"),
                    StopReason::Refusal,
                );
            }
        };
        let provider = match self.factory.create(cancel) {
            Ok(provider) => provider,
            Err(error) => {
                return refused(error.code(), error.to_string(), StopReason::Refusal);
            }
        };

        let binding = ResumeBinding {
            workspace_revision: "acp-conversation".into(),
            tool_schema_sha256: "acp-conversation".into(),
            provider_metadata: serde_json::json!({ "model": self.factory.model() }),
        };
        // A turn cancelled while a permission request was outstanding leaves the
        // checkpoint holding that request. A new prompt must not silently
        // inherit it: the client abandoned the question, so the call is denied
        // and the fresh turn starts clean.
        let abandoned = matches!(action, Action::Prompt(_))
            .then(|| {
                state
                    .checkpoint
                    .as_ref()
                    .and_then(|checkpoint| checkpoint.pending_permission.as_ref())
                    .map(|call| call.id.clone())
            })
            .flatten();
        let built = match state.checkpoint.take() {
            Some(checkpoint) => AgentRuntime::from_checkpoint(
                checkpoint,
                store,
                provider,
                tools,
                HarnessGate::for_mode(self.config.mode),
                self.control.clone(),
                NoChildExecutor,
            ),
            None => AgentRuntime::new(
                state.session.clone(),
                OperationId::new(),
                store,
                provider,
                tools,
                HarnessGate::for_mode(self.config.mode),
                self.control.clone(),
                NoChildExecutor,
                self.config.budget,
                now_ms(),
            ),
        };
        let mut runtime = match built {
            Ok(runtime) => runtime,
            Err(error) => {
                return refused(
                    "runtime_unavailable",
                    format!("the agent runtime could not start: {error}"),
                    StopReason::Refusal,
                );
            }
        };

        if let Some(call_id) = abandoned {
            let _ = runtime.respond_permission(&call_id, false);
        }
        let result = match action {
            Action::Prompt(prompt) => runtime.run(Some(&prompt)),
            Action::Permission { call_id, allow } => runtime
                .respond_permission(&call_id, allow)
                .and_then(|()| runtime.run(None)),
            Action::Abandon => runtime.cancel("the ACP client cancelled the permission request"),
        };

        let outcome = match result {
            Ok(RunOutcome::Completed { .. }) => StepOutcome::Completed,
            Ok(RunOutcome::Cancelled { .. }) => StepOutcome::Cancelled,
            Ok(RunOutcome::Paused(pause)) => match pause {
                Pause::Permission(call) => StepOutcome::Permission {
                    title: permission_title(&call.name, &call.arguments),
                    call_id: call.id,
                },
                Pause::DraftChangeRequired { intent } => {
                    let _ = runtime.cancel("mutation requires a confirmed cloop change");
                    refused(
                        "change_unconfirmed",
                        format!("{MUTATION_REFUSAL} (requested: {intent})"),
                        StopReason::Refusal,
                    )
                }
                Pause::Question { prompt, .. } => {
                    let _ =
                        runtime.cancel("no free-text question channel exists on this transport");
                    refused(
                        "question_unsupported",
                        format!(
                            "the agent asked a free-text question, which this ACP version has no \
                             channel for: {prompt}"
                        ),
                        StopReason::Refusal,
                    )
                }
                Pause::RepairBudgetExhausted => {
                    let _ = runtime.cancel("repair budget exhausted");
                    refused(
                        "repair_budget_exhausted",
                        "the turn stopped making progress and exhausted its repair budget"
                            .to_owned(),
                        StopReason::MaxTurnRequests,
                    )
                }
                Pause::DoomLoop { .. } => {
                    let _ = runtime.cancel("recovery loop requires human authority");
                    refused(
                        "doom_loop",
                        "the turn is repeating without progress and needs a human decision this \
                         transport cannot carry"
                            .to_owned(),
                        StopReason::MaxTurnRequests,
                    )
                }
            },
            Err(error) => refused(
                "runtime_error",
                format!("the turn failed: {error}"),
                StopReason::Refusal,
            ),
        };

        // Project everything the runtime recorded, including whatever the
        // terminal path above just wrote: a failed turn still produced
        // evidence, and a client that never sees it cannot explain the failure.
        let (parts, total) = project_transcript(&runtime, state.streamed);
        state.streamed = total;
        self.pending.extend(parts);
        // The checkpoint is kept whether the turn completed or was refused, so
        // the next prompt on this session continues the same conversation.
        state.checkpoint = Some(runtime.checkpoint(binding));
        outcome
    }
}

impl<F: ProviderFactory> TurnDriver for AcpRuntimeDriver<F> {
    fn begin(&mut self, session_id: &SessionId, prompt: &[MessagePart]) {
        let key = session_id.0.clone();
        self.sessions.entry(key.clone()).or_insert_with(|| {
            let mut session = Session::conversation(session_id.clone());
            // A malformed identifier would fail deep inside the runtime on
            // every call; normalise it once, here.
            if session.validate().is_err() {
                session = Session::conversation(SessionId::new());
            }
            SessionState {
                session,
                checkpoint: None,
                streamed: 0,
            }
        });
        self.active = Some(key);
        self.pending.clear();
        self.resumption = None;
        self.control.reset();
        let text = flatten_prompt(prompt);
        if text.trim().is_empty() {
            self.phase = Phase::Idle;
            self.refuse(
                "empty_prompt",
                "the prompt carried no content this agent can send to a model",
                StopReason::Refusal,
            );
            return;
        }
        self.prompt = Some(text);
        self.phase = Phase::Start;
    }

    fn next_step(&mut self, resumed: Option<PermissionOutcome>) -> TurnStep {
        if let Some(outcome) = resumed {
            self.resumption = Some(outcome);
        }
        loop {
            if let Some(part) = self.pending.pop_front() {
                return TurnStep::Emit(Box::new(part));
            }
            match std::mem::replace(&mut self.phase, Phase::Idle) {
                Phase::Finish(reason) => return TurnStep::Finish(reason),
                // Reached only if the dispatcher steps a turn this driver never
                // began. Resolving it beats looping.
                Phase::Idle => return TurnStep::Finish(StopReason::EndTurn),
                Phase::Start => {
                    let prompt = self.prompt.take().unwrap_or_default();
                    self.advance(Action::Prompt(prompt));
                }
                Phase::AwaitingPermission {
                    call_id,
                    title,
                    asked: false,
                } => {
                    self.phase = Phase::AwaitingPermission {
                        call_id: call_id.clone(),
                        title: title.clone(),
                        asked: true,
                    };
                    return TurnStep::RequestPermission {
                        tool_call_id: call_id,
                        title,
                        options: permission_options(),
                    };
                }
                Phase::AwaitingPermission {
                    call_id,
                    asked: true,
                    ..
                } => match self.resumption.take() {
                    Some(PermissionOutcome::Selected { option_id }) => {
                        self.advance(Action::Permission {
                            call_id,
                            allow: option_id == ALLOW_ONCE,
                        });
                    }
                    // A cancelled request is not a rejection with extra steps:
                    // the call cannot proceed and the turn must still resolve.
                    Some(PermissionOutcome::Cancelled) | None => self.advance(Action::Abandon),
                },
            }
        }
    }
}

/// Read the transcript tail the runtime just wrote and project it onto parts
/// the ACP mapping understands.
///
/// Two part kinds are withheld and both are noise rather than content: an empty
/// reasoning chunk, which is how the usage-accounting event lands, and the
/// lifecycle step boundary, which the ACP mapping already classifies as
/// unrepresentable. Everything else is forwarded, errors included.
fn project_transcript<P, T, G, C, X>(
    runtime: &AgentRuntime<'_, P, T, G, C, X>,
    already: usize,
) -> (Vec<MessagePart>, usize)
where
    P: StreamingProvider,
    T: ToolDispatcher,
    G: PermissionGate,
    C: ControlSource,
    X: ChildExecutor,
{
    let Ok(messages) = runtime.evidence_messages() else {
        return (Vec::new(), already);
    };
    let total = messages.len();
    let parts = messages
        .into_iter()
        .skip(already)
        .flat_map(|message| message.parts)
        .filter(|part| !is_noise(&part.body))
        .collect();
    (parts, total)
}

fn is_noise(body: &MessagePartBody) -> bool {
    match body {
        MessagePartBody::Reasoning { text, .. } => text.trim().is_empty(),
        MessagePartBody::StepStart { .. } | MessagePartBody::StepFinish { .. } => true,
        _ => false,
    }
}

/// Flatten an ACP prompt into the text the runtime accepts.
///
/// A block the runtime cannot take as text is *named* in the prompt rather
/// than dropped, so the model is told an attachment exists and the user is not
/// answered as though they had not sent one.
fn flatten_prompt(prompt: &[MessagePart]) -> String {
    let mut text = String::new();
    for part in prompt {
        let rendered = match &part.body {
            MessagePartBody::Text { text } => text.clone(),
            MessagePartBody::Source { url, title, .. } => {
                let name = title.clone().unwrap_or_else(|| url.clone());
                format!("[link {name}: {url}]")
            }
            MessagePartBody::Image { artifact, .. }
            | MessagePartBody::Artifact { artifact, .. } => {
                format!(
                    "[attachment {} ({} bytes) stored by reference; binary attachments are not \
                     forwarded to the model over ACP at this version]",
                    artifact.media_type, artifact.byte_length
                )
            }
            other => format!("[unforwarded prompt part: {}]", part_kind(other)),
        };
        if !rendered.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&rendered);
        }
    }
    text
}

fn part_kind(body: &MessagePartBody) -> &'static str {
    match body {
        MessagePartBody::File { .. } => "file",
        MessagePartBody::ToolCall { .. } => "tool_call",
        MessagePartBody::ToolResult { .. } => "tool_result",
        _ => "unmodelled",
    }
}

/// The options every permission request carries.
///
/// `allow_always` is deliberately absent. A standing grant is authority, and
/// authority is not something an attached editor may record.
fn permission_options() -> Vec<PermissionOption> {
    vec![
        PermissionOption {
            option_id: ALLOW_ONCE.into(),
            name: "Allow once".into(),
            kind: PermissionOptionKind::AllowOnce,
        },
        PermissionOption {
            option_id: REJECT_ONCE.into(),
            name: "Reject".into(),
            kind: PermissionOptionKind::RejectOnce,
        },
    ]
}

fn permission_title(name: &str, arguments: &serde_json::Value) -> String {
    arguments
        .get("path")
        .and_then(serde_json::Value::as_str)
        .map_or_else(|| name.to_owned(), |path| format!("{name} {path}"))
}

fn refused(code: &'static str, message: String, reason: StopReason) -> StepOutcome {
    StepOutcome::Refused {
        code,
        message,
        reason,
    }
}

fn error_part(code: &'static str, message: String) -> MessagePart {
    let body = MessagePartBody::Error {
        code: code.to_owned(),
        message,
        retryable: false,
    };
    MessagePart {
        schema_version: minimum_part_schema_version(&body),
        id: PartId::new(),
        state: PartState::Error,
        // Authored by the harness, not by the model and not by the workspace.
        provenance: Provenance::TrustedPolicy,
        body,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}
