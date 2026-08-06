//! The ACP agent-side dispatcher.
//!
//! [`Connection`] is a pure state machine: bytes in, frames out, no I/O and no
//! clock. That is what makes the protocol properties testable without a
//! subprocess — every test in this crate drives the same code path a real stdio
//! client would.
//!
//! ## What this owns
//!
//! Framing, version negotiation, session lifecycle, the prompt turn's
//! interleaving with client-side permission requests, cancellation cascade, and
//! cursor replay. Sessions are stored as `changeloop_session::Session` plus a
//! `changeloop_session::Transcript`; there is no second session model.
//!
//! ## What it does not own
//!
//! Running a model or executing a tool. That work reaches the dispatcher
//! through the [`TurnDriver`] port, which a runtime implements. The port is a
//! step machine rather than a closure on purpose: a prompt turn suspends
//! mid-flight while a permission request is outstanding, and a step machine
//! expresses that suspension without requiring an async runtime.

use std::collections::BTreeMap;

use changeloop_protocol::{
    BASE_PART_SCHEMA_VERSION, EventCursor, Message, MessageId, MessagePart, MessagePartBody,
    PartId, PartState, Provenance, SessionId, ToolCallId,
};
use changeloop_session::{ArtifactStore, Session, SessionError, Transcript};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::cancel::{CancelTree, ScopeId};
use crate::jsonrpc::{
    ErrorObject, INVALID_PARAMS, INVALID_REQUEST, Incoming, NOT_INITIALIZED, Notification,
    Outgoing, PROTOCOL_VERSION_MISMATCH, Request, RequestId, Response, ResponseOutcome,
    SESSION_NOT_FOUND, decode_line,
};
use crate::mapping::{PartProjection, map_part, prompt_to_parts};
use crate::schema::{
    AgentCapabilities, AuthMethod, CancelNotification, CancelRequestNotification,
    InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse,
    NewSessionRequest, NewSessionResponse, PermissionOption, PermissionOutcome, PromptCapabilities,
    PromptRequest, PromptResponse, RequestPermissionRequest, RequestPermissionResponse,
    SessionNotification, SessionUpdate, StopReason, ToolCallStatus, ToolCallUpdate,
};
use crate::version::{
    ProtocolState, ProtocolStateError, SUPPORTED_PROTOCOL_VERSIONS, negotiate_version,
};

/// ACP method names this facade speaks.
pub mod method {
    pub const INITIALIZE: &str = "initialize";
    pub const AUTHENTICATE: &str = "authenticate";
    pub const SESSION_NEW: &str = "session/new";
    pub const SESSION_LOAD: &str = "session/load";
    pub const SESSION_PROMPT: &str = "session/prompt";
    pub const SESSION_CANCEL: &str = "session/cancel";
    pub const CANCEL_REQUEST: &str = "$/cancel_request";
    /// Agent to client.
    pub const SESSION_UPDATE: &str = "session/update";
    /// Agent to client.
    pub const SESSION_REQUEST_PERMISSION: &str = "session/request_permission";
}

/// One step of a prompt turn.
#[derive(Clone, Debug, PartialEq)]
pub enum TurnStep {
    /// Stream one part: projected onto an ACP update, correlated by message and
    /// part id, and recorded in the transcript.
    Emit(Box<MessagePart>),
    /// Ask the client to authorize a tool call. The turn suspends until the
    /// client answers or the request is cancelled.
    RequestPermission {
        tool_call_id: ToolCallId,
        title: String,
        options: Vec<PermissionOption>,
    },
    /// End the turn.
    Finish(StopReason),
}

/// The port through which a runtime drives a prompt turn.
pub trait TurnDriver {
    /// Called once when a prompt arrives, with the parts the client sent.
    fn begin(&mut self, session_id: &SessionId, prompt: &[MessagePart]);

    /// Called repeatedly until it returns [`TurnStep::Finish`].
    ///
    /// `resumed` carries the client's answer when the previous step was a
    /// permission request. `PermissionOutcome::Cancelled` means the request was
    /// cancelled rather than answered; the driver decides what that costs.
    fn next_step(&mut self, resumed: Option<PermissionOutcome>) -> TurnStep;
}

/// How the connection mints identifiers.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum IdSource {
    /// UUIDv7, as the rest of the workspace mints identifiers.
    #[default]
    Random,
    /// Monotonic identifiers under a prefix, so tests can assert on them.
    Sequential { prefix: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentConfig {
    pub supported_versions: Vec<u16>,
    pub auth_methods: Vec<AuthMethod>,
    pub replay_page_size: usize,
    pub id_source: IdSource,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            supported_versions: SUPPORTED_PROTOCOL_VERSIONS.to_vec(),
            // No authentication methods: this transport is a local subprocess
            // owned by the client that spawned it.
            auth_methods: Vec::new(),
            replay_page_size: 256,
            id_source: IdSource::default(),
        }
    }
}

/// The outbound permission request a turn is suspended on. Its cancellation
/// scope lives in `pending_permissions`, keyed by the same identifier.
struct AwaitingPermission {
    outbound_id: RequestId,
}

struct ActiveTurn {
    request_id: RequestId,
    scope: ScopeId,
    /// Minted before the first update is streamed, so every chunk of the turn
    /// names the message it belongs to. ACP needed an explicit message-id RFD
    /// for exactly this reason: a client cannot infer a message boundary from a
    /// change of update type, because two consecutive same-type messages
    /// coalesce into one apparent message.
    message_id: MessageId,
    parts: Vec<MessagePart>,
    awaiting: Option<AwaitingPermission>,
    tool_scopes: BTreeMap<String, ScopeId>,
}

struct SessionEntry {
    session: Session,
    transcript: Transcript,
    artifacts: ArtifactStore,
    cwd: String,
    clock_ms: u64,
    turn: Option<ActiveTurn>,
}

struct PendingPermission {
    acp_session_id: String,
    scope: ScopeId,
}

/// An ACP agent connection.
pub struct Connection<D: TurnDriver> {
    driver: D,
    config: AgentConfig,
    protocol: ProtocolState,
    sessions: BTreeMap<String, SessionEntry>,
    cancels: CancelTree,
    pending_permissions: BTreeMap<RequestId, PendingPermission>,
    next_id: u64,
}

impl<D: TurnDriver> Connection<D> {
    #[must_use]
    pub fn new(driver: D, config: AgentConfig) -> Self {
        Self {
            driver,
            config,
            protocol: ProtocolState::default(),
            sessions: BTreeMap::new(),
            cancels: CancelTree::new(),
            pending_permissions: BTreeMap::new(),
            next_id: 0,
        }
    }

    /// The negotiated ACP version, or `None` before `initialize`.
    #[must_use]
    pub fn negotiated_version(&self) -> Option<u16> {
        self.protocol.require().ok()
    }

    /// Whether a session may mutate the workspace, answered by `cloop`'s own
    /// session rules rather than by the attached ACP client. `None` means the
    /// session does not exist.
    #[must_use]
    pub fn mutation_authority(&self, acp_session_id: &str) -> Option<Result<(), SessionError>> {
        self.sessions
            .get(acp_session_id)
            .map(|entry| entry.session.require_mutation_authority())
    }

    /// The transcript a session accumulated, for inspection and persistence.
    #[must_use]
    pub fn transcript(&self, acp_session_id: &str) -> Option<&Transcript> {
        self.sessions
            .get(acp_session_id)
            .map(|entry| &entry.transcript)
    }

    #[must_use]
    pub fn is_scope_cancelled(&self, scope: &ScopeId) -> bool {
        self.cancels.is_cancelled(scope)
    }

    /// Handle one transport line, returning every frame to write back.
    ///
    /// Total by construction: no input reaches a panic, and a line that cannot
    /// be classified produces a JSON-RPC error object rather than terminating
    /// the connection.
    pub fn handle_line(&mut self, line: &str) -> Vec<Outgoing> {
        match decode_line(line) {
            Ok(Incoming::Request(request)) => {
                let id = request.id.clone();
                self.dispatch_request(&request)
                    .unwrap_or_else(|error| vec![Outgoing::Response(Response::failure(id, error))])
            }
            Ok(Incoming::Notification(notification)) => self.handle_notification(&notification),
            Ok(Incoming::Response(response)) => self.handle_response(&response),
            Err(failure) if failure.answerable => {
                vec![Outgoing::Response(Response::failure(
                    failure.id,
                    failure.error,
                ))]
            }
            // JSON-RPC forbids answering a notification, including a malformed
            // one. Ignoring it is the specified behaviour, not a shortcut.
            Err(_) => Vec::new(),
        }
    }

    // -------------------------------------------------------------- requests

    fn dispatch_request(&mut self, request: &Request) -> Result<Vec<Outgoing>, ErrorObject> {
        if request.method == method::INITIALIZE {
            return self.initialize(request);
        }
        // Every non-initialize method is refused until exactly one version has
        // been negotiated, and refused again if it names a different one. This
        // is where "no silent mixing" is enforced on the wire.
        let named = request
            .params
            .as_ref()
            .and_then(|params| params.get("protocolVersion"))
            .and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok());
        self.protocol
            .require_matching(named)
            .map_err(protocol_state_error)?;

        match request.method.as_str() {
            method::AUTHENTICATE => Err(ErrorObject::invalid_params(
                "this agent advertises no authentication methods",
            )),
            method::SESSION_NEW => self.new_session(request),
            method::SESSION_LOAD => self.load_session(request),
            method::SESSION_PROMPT => self.prompt(request),
            _ => Err(ErrorObject::method_not_found(&request.method)),
        }
    }

    fn initialize(&mut self, request: &Request) -> Result<Vec<Outgoing>, ErrorObject> {
        let params: InitializeRequest = decode_params(request.params.as_ref())?;
        let negotiated =
            negotiate_version(params.protocol_version, &self.config.supported_versions).map_err(
                |error| {
                    ErrorObject::new(PROTOCOL_VERSION_MISMATCH, error.to_string()).with_data(
                        serde_json::json!({ "supportedVersions": self.config.supported_versions }),
                    )
                },
            )?;
        self.protocol
            .initialize(negotiated.version)
            .map_err(protocol_state_error)?;
        let response = InitializeResponse {
            protocol_version: negotiated.version,
            agent_capabilities: AgentCapabilities {
                load_session: true,
                prompt_capabilities: PromptCapabilities {
                    image: true,
                    audio: true,
                    embedded_context: true,
                },
            },
            auth_methods: self.config.auth_methods.clone(),
            meta: Some(serde_json::json!({
                "cloop": {
                    "supportedVersions": self.config.supported_versions,
                    "downgraded": negotiated.downgraded,
                }
            })),
        };
        ok(request.id.clone(), &response).map(|frame| vec![frame])
    }

    fn new_session(&mut self, request: &Request) -> Result<Vec<Outgoing>, ErrorObject> {
        let params: NewSessionRequest = decode_params(request.params.as_ref())?;
        let session_id = SessionId::from_stable(self.mint("session"));
        // A `cloop` session, not an ACP-shaped stand-in. Authority to mutate
        // the workspace stays with `cloop`'s change lifecycle: an attached ACP
        // client does not confer it, which is why this is a conversation.
        let session = Session::conversation(session_id.clone());
        session
            .validate()
            .map_err(|error| ErrorObject::new(INVALID_REQUEST, error.to_string()))?;
        self.sessions.insert(
            session_id.0.clone(),
            SessionEntry {
                transcript: Transcript::new(session_id.clone()),
                session,
                artifacts: ArtifactStore::new(),
                cwd: params.cwd,
                clock_ms: 0,
                turn: None,
            },
        );
        ok(
            request.id.clone(),
            &NewSessionResponse {
                session_id: session_id.0,
                meta: None,
            },
        )
        .map(|frame| vec![frame])
    }

    /// Replay a session, optionally from a cursor.
    ///
    /// ACP's `session/load` replays a session as `session/update` notifications
    /// before its response. Resuming from a keyset cursor rather than from the
    /// beginning is carried in `_meta` — the spec's own extension point — so a
    /// client that knows nothing about it still gets a full replay, and a client
    /// that does resumes exactly where it stopped: no duplicate, no skip, and
    /// no dependence on how many messages exist.
    fn load_session(&mut self, request: &Request) -> Result<Vec<Outgoing>, ErrorObject> {
        let params: LoadSessionRequest = decode_params(request.params.as_ref())?;
        let after = params
            .meta
            .as_ref()
            .and_then(|meta| meta.pointer("/cloop/afterCursor"))
            .and_then(Value::as_str)
            .map(|cursor| EventCursor(cursor.to_owned()));
        let limit = params
            .meta
            .as_ref()
            .and_then(|meta| meta.pointer("/cloop/limit"))
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(self.config.replay_page_size)
            .clamp(1, self.config.replay_page_size);

        let entry = self
            .sessions
            .get_mut(&params.session_id)
            .ok_or_else(|| unknown_session(&params.session_id))?;
        if !params.cwd.is_empty() {
            entry.cwd = params.cwd;
        }
        let page = entry
            .transcript
            .page(after.as_ref(), limit)
            .map_err(|error| ErrorObject::invalid_params(error.to_string()))?;

        let mut frames = Vec::new();
        let mut unrepresentable: Vec<&'static str> = Vec::new();
        for message in &page.messages {
            for part in &message.parts {
                match map_part(part, &entry.cwd) {
                    PartProjection::Update(update) => {
                        frames.push(session_update(
                            &params.session_id,
                            &message.id,
                            &part.id,
                            *update,
                        ));
                    }
                    PartProjection::Unrepresentable { part_kind } => {
                        unrepresentable.push(part_kind);
                    }
                }
            }
        }
        let response = LoadSessionResponse {
            meta: Some(serde_json::json!({
                "cloop": {
                    "cursor": page.next_cursor.map(|cursor| cursor.0),
                    "hasMore": page.has_more,
                    "replayedMessages": page.messages.len(),
                    // Named rather than hidden: these parts exist in the
                    // transcript and have no ACP shape at this version.
                    "unrepresentableParts": unrepresentable,
                }
            })),
        };
        frames.push(ok(request.id.clone(), &response)?);
        Ok(frames)
    }

    fn prompt(&mut self, request: &Request) -> Result<Vec<Outgoing>, ErrorObject> {
        let params: PromptRequest = decode_params(request.params.as_ref())?;
        let acp_session_id = params.session_id.clone();
        {
            let entry = self
                .sessions
                .get(&acp_session_id)
                .ok_or_else(|| unknown_session(&acp_session_id))?;
            if entry.turn.is_some() {
                return Err(ErrorObject::new(
                    INVALID_REQUEST,
                    "this session already has a prompt turn in flight",
                ));
            }
        }
        let user_message_id = MessageId::from_stable(self.mint("msg"));
        let agent_message_id = MessageId::from_stable(self.mint("msg"));

        let (prompt_parts, turn_index) = {
            let entry = self
                .sessions
                .get_mut(&acp_session_id)
                .ok_or_else(|| unknown_session(&acp_session_id))?;
            let prompt_parts = prompt_to_parts(&params.prompt, &mut entry.artifacts)
                .map_err(|error| ErrorObject::invalid_params(error.to_string()))?;
            entry.clock_ms += 1;
            let user_message = Message {
                schema_version: 1,
                id: user_message_id,
                session_id: entry.transcript.session_id.clone(),
                created_at_ms: entry.clock_ms,
                parts: prompt_parts.clone(),
            };
            entry
                .transcript
                .append(user_message)
                .map_err(|error| ErrorObject::new(INVALID_REQUEST, error.to_string()))?;
            (prompt_parts, entry.transcript.len())
        };

        let scope = ScopeId::new(format!("turn:{acp_session_id}:{turn_index}"));
        self.cancels
            .open_root(scope.clone())
            .map_err(|error| ErrorObject::new(INVALID_REQUEST, error.to_string()))?;
        if let Some(entry) = self.sessions.get_mut(&acp_session_id) {
            entry.turn = Some(ActiveTurn {
                request_id: request.id.clone(),
                scope,
                message_id: agent_message_id,
                parts: Vec::new(),
                awaiting: None,
                tool_scopes: BTreeMap::new(),
            });
        }

        let session_id = SessionId::from_stable(acp_session_id.clone());
        self.driver.begin(&session_id, &prompt_parts);
        Ok(self.advance_turn(&acp_session_id, None))
    }

    // --------------------------------------------------------- notifications

    fn handle_notification(&mut self, notification: &Notification) -> Vec<Outgoing> {
        match notification.method.as_str() {
            method::SESSION_CANCEL => {
                match decode_params::<CancelNotification>(notification.params.as_ref()) {
                    Ok(params) => self.cancel_session(&params.session_id),
                    Err(_) => Vec::new(),
                }
            }
            method::CANCEL_REQUEST => {
                match decode_params::<CancelRequestNotification>(notification.params.as_ref()) {
                    Ok(params) => self.cancel_request(&params.id),
                    Err(_) => Vec::new(),
                }
            }
            // An unknown notification is ignored, never answered.
            _ => Vec::new(),
        }
    }

    /// Cancel a session's turn, cascading to its tool calls and to any
    /// permission request those tool calls raised.
    fn cancel_session(&mut self, acp_session_id: &str) -> Vec<Outgoing> {
        let Some(scope) = self
            .sessions
            .get(acp_session_id)
            .and_then(|entry| entry.turn.as_ref())
            .map(|turn| turn.scope.clone())
        else {
            return Vec::new();
        };
        self.cancel_scope(acp_session_id, &scope)
    }

    /// Cancel one named request.
    ///
    /// Cancelling the prompt request cancels the whole turn. Cancelling an
    /// outstanding permission request cancels only that subtree and resumes the
    /// turn with a `cancelled` outcome, so the turn still resolves at the
    /// protocol level instead of hanging on an answer that will never come.
    fn cancel_request(&mut self, id: &RequestId) -> Vec<Outgoing> {
        let turn_target = self.sessions.iter().find_map(|(acp_session_id, entry)| {
            entry
                .turn
                .as_ref()
                .filter(|turn| &turn.request_id == id)
                .map(|turn| (acp_session_id.clone(), turn.scope.clone()))
        });
        if let Some((acp_session_id, scope)) = turn_target {
            return self.cancel_scope(&acp_session_id, &scope);
        }
        let Some(pending) = self.pending_permissions.remove(id) else {
            return Vec::new();
        };
        // A tool call that cannot get its permission answered cannot proceed,
        // so the cascade starts at the tool scope that raised the request. It
        // stops there: the turn itself is still live and still resolves.
        let from = self
            .cancels
            .parent(&pending.scope)
            .cloned()
            .unwrap_or_else(|| pending.scope.clone());
        let mut frames = self.emit_cancelled_tools(&pending.acp_session_id, &from);
        if let Some(entry) = self.sessions.get_mut(&pending.acp_session_id)
            && let Some(turn) = entry.turn.as_mut()
        {
            turn.awaiting = None;
        }
        frames
            .extend(self.advance_turn(&pending.acp_session_id, Some(PermissionOutcome::Cancelled)));
        frames
    }

    fn cancel_scope(&mut self, acp_session_id: &str, scope: &ScopeId) -> Vec<Outgoing> {
        let mut frames = self.emit_cancelled_tools(acp_session_id, scope);
        let stale: Vec<RequestId> = self
            .pending_permissions
            .iter()
            .filter(|(_, pending)| self.cancels.is_cancelled(&pending.scope))
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            self.pending_permissions.remove(&id);
        }
        frames.extend(self.finish_turn(acp_session_id, StopReason::Cancelled));
        frames
    }

    /// Mark a subtree cancelled and emit one terminal `tool_call_update` for
    /// every tool call the cascade reached.
    ///
    /// These are emitted even though the turn is ending. Dropping a streaming
    /// delta costs a repaint; dropping a terminal frame leaves the client
    /// permanently wrong about that tool call's state.
    fn emit_cancelled_tools(&mut self, acp_session_id: &str, scope: &ScopeId) -> Vec<Outgoing> {
        let cancelled = self.cancels.cancel(scope);
        let Some(entry) = self.sessions.get(acp_session_id) else {
            return Vec::new();
        };
        let Some(turn) = entry.turn.as_ref() else {
            return Vec::new();
        };
        turn.tool_scopes
            .iter()
            .filter(|(_, tool_scope)| cancelled.contains(tool_scope))
            .filter_map(|(tool_call_id, _)| {
                let notification = SessionNotification {
                    session_id: acp_session_id.to_owned(),
                    update: SessionUpdate::ToolCallUpdate(ToolCallUpdate {
                        tool_call_id: tool_call_id.clone(),
                        status: Some(ToolCallStatus::Failed),
                        ..ToolCallUpdate::default()
                    }),
                    meta: Some(serde_json::json!({
                        "cloop": { "cancelled": true, "messageId": turn.message_id.0 }
                    })),
                };
                serde_json::to_value(&notification).ok().map(|params| {
                    Outgoing::Notification(Notification::new(method::SESSION_UPDATE, Some(params)))
                })
            })
            .collect()
    }

    // -------------------------------------------------------------- responses

    fn handle_response(&mut self, response: &Response) -> Vec<Outgoing> {
        let Some(pending) = self.pending_permissions.remove(&response.id) else {
            // A response to a request this side never sent, or to one already
            // cancelled. Answering it would itself violate JSON-RPC.
            return Vec::new();
        };
        if self.cancels.is_cancelled(&pending.scope) {
            return Vec::new();
        }
        let outcome = match &response.outcome {
            ResponseOutcome::Result(value) => {
                serde_json::from_value::<RequestPermissionResponse>(value.clone())
                    .map_or(PermissionOutcome::Cancelled, |response| response.outcome)
            }
            // A client that errors a permission request has refused it.
            ResponseOutcome::Error(_) => PermissionOutcome::Cancelled,
        };
        self.cancels.close(&pending.scope);
        let decision = match &outcome {
            PermissionOutcome::Selected { option_id } => option_id.clone(),
            PermissionOutcome::Cancelled => "cancelled".to_owned(),
        };
        if let Some(entry) = self.sessions.get_mut(&pending.acp_session_id)
            && let Some(turn) = entry.turn.as_mut()
        {
            turn.awaiting = None;
            // The decision is recorded in the transcript as a `cloop`
            // permission part, so a later replay shows what was authorized.
            turn.parts.push(MessagePart {
                schema_version: BASE_PART_SCHEMA_VERSION,
                id: PartId::new(),
                state: PartState::Completed,
                provenance: Provenance::UserInput,
                body: MessagePartBody::Permission {
                    permission: pending.scope.0.clone(),
                    decision,
                },
            });
        }
        self.advance_turn(&pending.acp_session_id, Some(outcome))
    }

    // ------------------------------------------------------------------ turns

    /// Drive the turn until it suspends on a permission request or finishes.
    fn advance_turn(
        &mut self,
        acp_session_id: &str,
        mut resumed: Option<PermissionOutcome>,
    ) -> Vec<Outgoing> {
        let mut frames = Vec::new();
        loop {
            let Some(state) = self
                .sessions
                .get(acp_session_id)
                .and_then(|entry| entry.turn.as_ref())
                .map(|turn| (turn.scope.clone(), turn.awaiting.is_some()))
            else {
                return frames;
            };
            let (scope, awaiting) = state;
            if awaiting {
                return frames;
            }
            if self.cancels.is_cancelled(&scope) {
                frames.extend(self.finish_turn(acp_session_id, StopReason::Cancelled));
                return frames;
            }
            match self.driver.next_step(resumed.take()) {
                TurnStep::Emit(part) => frames.extend(self.emit_part(acp_session_id, *part)),
                TurnStep::RequestPermission {
                    tool_call_id,
                    title,
                    options,
                } => frames.extend(self.request_permission(
                    acp_session_id,
                    &tool_call_id,
                    title,
                    options,
                )),
                TurnStep::Finish(reason) => {
                    frames.extend(self.finish_turn(acp_session_id, reason));
                    return frames;
                }
            }
        }
    }

    fn emit_part(&mut self, acp_session_id: &str, part: MessagePart) -> Vec<Outgoing> {
        let Some((message_id, cwd, turn_scope, new_tool_scope)) =
            self.record_emitted_part(acp_session_id, &part)
        else {
            return Vec::new();
        };
        if let Some(scope) = new_tool_scope {
            let _ = self.cancels.open_child(&turn_scope, scope);
        }
        match map_part(&part, &cwd) {
            PartProjection::Update(update) => {
                vec![session_update(
                    acp_session_id,
                    &message_id,
                    &part.id,
                    *update,
                )]
            }
            // Recorded in the transcript, absent from the stream, and never
            // reshaped into an ACP update that would misdescribe it.
            PartProjection::Unrepresentable { .. } => Vec::new(),
        }
    }

    fn record_emitted_part(
        &mut self,
        acp_session_id: &str,
        part: &MessagePart,
    ) -> Option<(MessageId, String, ScopeId, Option<ScopeId>)> {
        let entry = self.sessions.get_mut(acp_session_id)?;
        let cwd = entry.cwd.clone();
        let turn = entry.turn.as_mut()?;
        let mut new_tool_scope = None;
        if let MessagePartBody::ToolCall { tool_call_id, .. } = &part.body
            && !turn.tool_scopes.contains_key(&tool_call_id.0)
        {
            let scope = ScopeId::new(format!("tool:{acp_session_id}:{}", tool_call_id.0));
            turn.tool_scopes
                .insert(tool_call_id.0.clone(), scope.clone());
            new_tool_scope = Some(scope);
        }
        turn.parts.push(part.clone());
        Some((
            turn.message_id.clone(),
            cwd,
            turn.scope.clone(),
            new_tool_scope,
        ))
    }

    fn request_permission(
        &mut self,
        acp_session_id: &str,
        tool_call_id: &ToolCallId,
        title: String,
        options: Vec<PermissionOption>,
    ) -> Vec<Outgoing> {
        let outbound_id = RequestId::Text(self.mint("req"));
        let permission_scope = ScopeId::new(format!("perm:{}", request_id_key(&outbound_id)));
        let Some((turn_scope, tool_scope)) =
            self.suspend_turn(acp_session_id, tool_call_id, &outbound_id)
        else {
            return Vec::new();
        };
        if !self.cancels.contains(&tool_scope) {
            let _ = self.cancels.open_child(&turn_scope, tool_scope.clone());
        }
        let _ = self
            .cancels
            .open_child(&tool_scope, permission_scope.clone());
        self.pending_permissions.insert(
            outbound_id.clone(),
            PendingPermission {
                acp_session_id: acp_session_id.to_owned(),
                scope: permission_scope,
            },
        );

        let params = RequestPermissionRequest {
            session_id: acp_session_id.to_owned(),
            tool_call: ToolCallUpdate {
                tool_call_id: tool_call_id.0.clone(),
                status: Some(ToolCallStatus::Pending),
                title: Some(title),
                ..ToolCallUpdate::default()
            },
            options,
            meta: None,
        };
        serde_json::to_value(&params).map_or_else(
            |_| Vec::new(),
            |params| {
                vec![Outgoing::Request(Request::new(
                    outbound_id,
                    method::SESSION_REQUEST_PERMISSION,
                    Some(params),
                ))]
            },
        )
    }

    fn suspend_turn(
        &mut self,
        acp_session_id: &str,
        tool_call_id: &ToolCallId,
        outbound_id: &RequestId,
    ) -> Option<(ScopeId, ScopeId)> {
        let entry = self.sessions.get_mut(acp_session_id)?;
        let turn = entry.turn.as_mut()?;
        let tool_scope = turn
            .tool_scopes
            .entry(tool_call_id.0.clone())
            .or_insert_with(|| ScopeId::new(format!("tool:{acp_session_id}:{}", tool_call_id.0)))
            .clone();
        turn.awaiting = Some(AwaitingPermission {
            outbound_id: outbound_id.clone(),
        });
        Some((turn.scope.clone(), tool_scope))
    }

    /// End the turn: append what was produced to the transcript, close the
    /// cancellation subtree, and answer the original `session/prompt`.
    fn finish_turn(&mut self, acp_session_id: &str, reason: StopReason) -> Vec<Outgoing> {
        let Some(entry) = self.sessions.get_mut(acp_session_id) else {
            return Vec::new();
        };
        let Some(turn) = entry.turn.take() else {
            return Vec::new();
        };
        entry.clock_ms += 1;
        let cursor = if turn.parts.is_empty() {
            // A transcript message must carry at least one part, so an empty
            // turn appends nothing rather than an invalid record.
            None
        } else {
            entry
                .transcript
                .append(Message {
                    schema_version: 1,
                    id: turn.message_id.clone(),
                    session_id: entry.transcript.session_id.clone(),
                    created_at_ms: entry.clock_ms,
                    parts: turn.parts,
                })
                .ok()
        };
        self.cancels.close(&turn.scope);
        if let Some(awaiting) = turn.awaiting {
            self.pending_permissions.remove(&awaiting.outbound_id);
        }
        let response = PromptResponse {
            stop_reason: reason,
            meta: Some(serde_json::json!({
                "cloop": {
                    "messageId": turn.message_id.0,
                    "cursor": cursor.map(|cursor| cursor.0),
                }
            })),
        };
        ok(turn.request_id, &response).map_or_else(|_| Vec::new(), |frame| vec![frame])
    }

    // ------------------------------------------------------------- utilities

    fn mint(&mut self, kind: &str) -> String {
        self.next_id += 1;
        match &self.config.id_source {
            IdSource::Random => PartId::new().0,
            IdSource::Sequential { prefix } => format!("{prefix}-{kind}-{}", self.next_id),
        }
    }
}

fn request_id_key(id: &RequestId) -> String {
    match id {
        RequestId::Number(value) => value.to_string(),
        RequestId::Text(value) => value.clone(),
        RequestId::Null => "null".to_owned(),
    }
}

fn session_update(
    acp_session_id: &str,
    message_id: &MessageId,
    part_id: &PartId,
    update: SessionUpdate,
) -> Outgoing {
    let notification = SessionNotification {
        session_id: acp_session_id.to_owned(),
        update,
        meta: Some(serde_json::json!({
            "cloop": { "messageId": message_id.0, "partId": part_id.0 }
        })),
    };
    Outgoing::Notification(Notification::new(
        method::SESSION_UPDATE,
        serde_json::to_value(&notification).ok(),
    ))
}

/// Decode params, tolerating unknown members and rejecting missing required
/// ones with a proper `invalid params` error rather than a silent default.
fn decode_params<T: DeserializeOwned>(params: Option<&Value>) -> Result<T, ErrorObject> {
    let value = params.cloned().unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|error| ErrorObject::invalid_params(error.to_string()))
}

fn unknown_session(acp_session_id: &str) -> ErrorObject {
    ErrorObject::new(
        SESSION_NOT_FOUND,
        format!("unknown session `{acp_session_id}`"),
    )
}

fn protocol_state_error(error: ProtocolStateError) -> ErrorObject {
    let code = match error {
        ProtocolStateError::NotInitialized => NOT_INITIALIZED,
        ProtocolStateError::AlreadyInitialized { .. }
        | ProtocolStateError::VersionMismatch { .. } => PROTOCOL_VERSION_MISMATCH,
    };
    ErrorObject::new(code, error.to_string())
}

fn ok<T: serde::Serialize>(id: RequestId, value: &T) -> Result<Outgoing, ErrorObject> {
    serde_json::to_value(value)
        .map(|value| Outgoing::Response(Response::success(id, value)))
        .map_err(|error| ErrorObject::new(INVALID_PARAMS, error.to_string()))
}
