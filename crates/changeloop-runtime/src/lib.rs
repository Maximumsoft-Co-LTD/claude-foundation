//! Executable, synchronous streaming turn loop. Network and tools are injected.

use std::collections::BTreeMap;

use changeloop_agent::{ChildResult, SubagentRuntime, SubagentSpec};
use changeloop_harness::TransitionEffect;
use changeloop_policy::{DecisionAction, PermissionKind};
use changeloop_project::{
    CancellationToken, InstanceError, OwnedResourceHandle, ProjectInstance, ResourceKind,
};
use changeloop_protocol::{
    Event, Message, MessageId, MessagePart, MessagePartBody, OperationId, PartId, PartState,
    Provenance, SessionId, ToolCallId, redact_sensitive_text,
};
use changeloop_provider::{
    FinishReason, InputMessage, InputPart, InputRole, Measurement, NormalizedRequest,
    ReplayMetadata, StreamEvent, ToolDefinition,
};
use changeloop_session::{ChangeState, Session, SessionError, SessionKind};
use changeloop_storage::{Storage, StorageError, ToolClaim};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

const MAX_RUNTIME_CHECKPOINT_BYTES: usize = 16 * 1024 * 1024;
const MAX_RUNTIME_MESSAGES: usize = 65_536;
const MAX_RUNTIME_REPLAY_ITEMS: usize = 65_536;
const MAX_RUNTIME_TEXT_BYTES: usize = 1024 * 1024;

/// Binds runtime-owned work to its project instance. Project disposal
/// propagates cancellation to model execution, jobs, LSP, and MCP resources.
pub struct ProjectRuntimeScope {
    project_cancellation: CancellationToken,
    resources: Vec<OwnedResourceHandle>,
}

impl ProjectRuntimeScope {
    pub fn attach(
        instance: &mut ProjectInstance,
        operation_name: impl Into<String>,
    ) -> Result<Self, InstanceError> {
        let operation_name = operation_name.into();
        let model = instance.register_owned(ResourceKind::ModelExecution, operation_name)?;
        Ok(Self {
            project_cancellation: instance.cancellation_token(),
            resources: vec![model],
        })
    }

    pub fn register_job(
        &mut self,
        instance: &mut ProjectInstance,
        name: impl Into<String>,
    ) -> Result<OwnedResourceHandle, InstanceError> {
        self.register(instance, ResourceKind::Job, name)
    }

    pub fn register_lsp(
        &mut self,
        instance: &mut ProjectInstance,
        name: impl Into<String>,
    ) -> Result<OwnedResourceHandle, InstanceError> {
        self.register(instance, ResourceKind::Lsp, name)
    }

    pub fn register_mcp(
        &mut self,
        instance: &mut ProjectInstance,
        name: impl Into<String>,
    ) -> Result<OwnedResourceHandle, InstanceError> {
        self.register(instance, ResourceKind::Mcp, name)
    }

    fn register(
        &mut self,
        instance: &mut ProjectInstance,
        kind: ResourceKind,
        name: impl Into<String>,
    ) -> Result<OwnedResourceHandle, InstanceError> {
        let handle = instance.register_owned(kind, name.into())?;
        self.resources.push(handle.clone());
        Ok(handle)
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.project_cancellation.is_cancelled()
            || self
                .resources
                .iter()
                .any(|resource| resource.cancellation_token().is_cancelled())
    }

    #[must_use]
    pub fn resources(&self) -> &[OwnedResourceHandle] {
        &self.resources
    }
}

pub trait StreamingProvider {
    fn stream(&mut self, request: &NormalizedRequest) -> Result<Vec<StreamEvent>, String>;

    fn stream_incremental(
        &mut self,
        request: &NormalizedRequest,
        on_event: &mut dyn FnMut(StreamEvent) -> Result<(), String>,
    ) -> Result<(), String> {
        for event in self.stream(request)? {
            on_event(event)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: ToolCallId,
    pub name: String,
    pub arguments: Value,
    pub permission: PermissionKind,
    pub mutating: bool,
}

pub trait PermissionGate {
    fn decide(&mut self, call: &ToolCall) -> DecisionAction;
}

pub enum ToolDispatch {
    Output(Value),
    Question(String),
    Subagent(Box<SubagentSpec>),
}

pub trait ToolDispatcher {
    fn definitions(&self) -> Vec<ToolDefinition>;
    fn permission(&self, name: &str) -> Option<PermissionKind>;
    fn dispatch(&mut self, call: &ToolCall) -> Result<ToolDispatch, String>;

    /// Identifies calls that may be dispatched together to the child
    /// scheduler. Other tools retain strict provider order.
    fn is_subagent_tool(&self, _name: &str) -> bool {
        false
    }
}

pub trait ChildExecutor {
    fn execute(&mut self, spec: &SubagentSpec) -> Result<ChildResult, String>;

    fn execute_many(&mut self, specs: &[SubagentSpec]) -> Vec<Result<ChildResult, String>> {
        specs.iter().map(|spec| self.execute(spec)).collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Control {
    Continue,
    Steer(String),
    Cancel(String),
}

pub trait ControlSource {
    fn poll(&mut self) -> Control;
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct RuntimeBudget {
    pub max_turns: u16,
    pub max_provider_retries: u16,
    pub max_repair_attempts: u16,
    pub non_progress_limit: u16,
    pub max_context_messages: usize,
    pub keep_recent_messages: usize,
    /// Provider-enforced output ceiling for each request. Child runtimes bind
    /// this to their delegated token budget.
    pub max_output_tokens: Option<u64>,
    /// Aggregate provider input + output token ceiling across the runtime.
    pub max_total_tokens: Option<u64>,
}

impl Default for RuntimeBudget {
    fn default() -> Self {
        Self {
            max_turns: 32,
            max_provider_retries: 3,
            max_repair_attempts: 6,
            non_progress_limit: 2,
            max_context_messages: 64,
            keep_recent_messages: 24,
            max_output_tokens: None,
            max_total_tokens: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Pause {
    Permission(ToolCall),
    Question { call_id: ToolCallId, prompt: String },
    DraftChangeRequired { intent: String },
    RepairBudgetExhausted,
    DoomLoop { handoff: TransitionEffect },
}

#[derive(Clone, Debug, PartialEq)]
pub enum RunOutcome {
    Completed { text: String },
    Paused(Pause),
    Cancelled { reason: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResumeBinding {
    pub workspace_revision: String,
    pub tool_schema_sha256: String,
    pub provider_metadata: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuntimeCheckpoint {
    pub schema_version: u16,
    pub session: Session,
    pub operation_id: OperationId,
    pub binding: ResumeBinding,
    pub budget: RuntimeBudget,
    pub messages: Vec<InputMessage>,
    pub replay: Vec<ReplayMetadata>,
    pub pending_permission: Option<ToolCall>,
    pub pending_authority: Option<ToolCall>,
    pub pending_question: Option<(ToolCallId, String)>,
    pub approved: BTreeMap<String, bool>,
    pub turns: u16,
    pub retries: u16,
    pub repairs: u16,
    pub last_fingerprint: Option<String>,
    pub non_progress: u16,
    pub clock_ms: u64,
    pub tokens_used: u64,
    pub pending_doom_loop: Option<TransitionEffect>,
    pub doom_loop_response: Option<bool>,
}

#[derive(Default)]
struct PendingCall {
    name: String,
    fragments: String,
    arguments: Option<Value>,
}

pub struct AgentRuntime<'a, P, T, G, C, X> {
    pub session: Session,
    operation_id: OperationId,
    storage: &'a mut Storage,
    provider: P,
    tools: T,
    permissions: G,
    control: C,
    child_executor: X,
    subagents: SubagentRuntime,
    budget: RuntimeBudget,
    messages: Vec<InputMessage>,
    replay: Vec<ReplayMetadata>,
    pending_permission: Option<ToolCall>,
    pending_authority: Option<ToolCall>,
    pending_question: Option<(ToolCallId, String)>,
    approved: BTreeMap<String, bool>,
    turns: u16,
    retries: u16,
    repairs: u16,
    last_fingerprint: Option<String>,
    non_progress: u16,
    clock_ms: u64,
    tokens_used: u64,
    pending_doom_loop: Option<TransitionEffect>,
    doom_loop_response: Option<bool>,
}

impl<'a, P, T, G, C, X> AgentRuntime<'a, P, T, G, C, X>
where
    P: StreamingProvider,
    T: ToolDispatcher,
    G: PermissionGate,
    C: ControlSource,
    X: ChildExecutor,
{
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        session: Session,
        operation_id: OperationId,
        storage: &'a mut Storage,
        provider: P,
        tools: T,
        permissions: G,
        control: C,
        child_executor: X,
        budget: RuntimeBudget,
        now_ms: u64,
    ) -> Result<Self, RuntimeError> {
        if !valid_runtime_budget(budget) {
            return Err(RuntimeError::InvalidCheckpoint("invalid runtime budget"));
        }
        storage.create_session(&session.id, now_ms)?;
        storage.begin_operation(&session.id, &operation_id, now_ms)?;
        Ok(Self {
            session,
            operation_id,
            storage,
            provider,
            tools,
            permissions,
            control,
            child_executor,
            subagents: SubagentRuntime::default(),
            budget,
            messages: vec![],
            replay: vec![],
            pending_permission: None,
            pending_authority: None,
            pending_question: None,
            approved: BTreeMap::new(),
            turns: 0,
            retries: 0,
            repairs: 0,
            last_fingerprint: None,
            non_progress: 0,
            clock_ms: now_ms,
            tokens_used: 0,
            pending_doom_loop: None,
            doom_loop_response: None,
        })
    }

    pub fn checkpoint(&self, binding: ResumeBinding) -> RuntimeCheckpoint {
        RuntimeCheckpoint {
            schema_version: 1,
            session: self.session.clone(),
            operation_id: self.operation_id.clone(),
            binding,
            budget: self.budget,
            messages: self.messages.clone(),
            replay: self.replay.clone(),
            pending_permission: self.pending_permission.clone(),
            pending_authority: self.pending_authority.clone(),
            pending_question: self.pending_question.clone(),
            approved: self.approved.clone(),
            turns: self.turns,
            retries: self.retries,
            repairs: self.repairs,
            last_fingerprint: self.last_fingerprint.clone(),
            non_progress: self.non_progress,
            clock_ms: self.clock_ms,
            tokens_used: self.tokens_used,
            pending_doom_loop: self.pending_doom_loop.clone(),
            doom_loop_response: self.doom_loop_response,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_checkpoint(
        checkpoint: RuntimeCheckpoint,
        storage: &'a mut Storage,
        provider: P,
        tools: T,
        permissions: G,
        control: C,
        child_executor: X,
    ) -> Result<Self, RuntimeError> {
        if checkpoint.schema_version != 1 {
            return Err(RuntimeError::CheckpointVersion(checkpoint.schema_version));
        }
        validate_checkpoint(&checkpoint)?;
        Ok(Self {
            session: checkpoint.session,
            operation_id: checkpoint.operation_id,
            storage,
            provider,
            tools,
            permissions,
            control,
            child_executor,
            subagents: SubagentRuntime::default(),
            budget: checkpoint.budget,
            messages: checkpoint.messages,
            replay: checkpoint.replay,
            pending_permission: checkpoint.pending_permission,
            pending_authority: checkpoint.pending_authority,
            pending_question: checkpoint.pending_question,
            approved: checkpoint.approved,
            turns: checkpoint.turns,
            retries: checkpoint.retries,
            repairs: checkpoint.repairs,
            last_fingerprint: checkpoint.last_fingerprint,
            non_progress: checkpoint.non_progress,
            clock_ms: checkpoint.clock_ms,
            tokens_used: checkpoint.tokens_used,
            pending_doom_loop: checkpoint.pending_doom_loop,
            doom_loop_response: checkpoint.doom_loop_response,
        })
    }

    #[must_use]
    pub fn operation_id(&self) -> &OperationId {
        &self.operation_id
    }

    pub fn respond_doom_loop(&mut self, allow: bool) -> Result<(), RuntimeError> {
        if self.pending_doom_loop.is_none() || self.doom_loop_response.is_some() {
            return Err(RuntimeError::NoPendingDoomLoop);
        }
        self.doom_loop_response = Some(allow);
        Ok(())
    }

    pub fn propose_change(&self, id: SessionId, intent: impl Into<String>) -> DraftChange {
        DraftChange {
            session: Session::draft_change(id),
            intent: intent.into(),
        }
    }

    pub fn persist_pause(
        &mut self,
        kind: changeloop_storage::RuntimePauseKind,
        payload: &Value,
        created_at_ms: u64,
    ) -> Result<(), RuntimeError> {
        self.storage.save_runtime_pause(
            &self.session.id,
            &self.operation_id,
            kind,
            payload,
            created_at_ms,
        )?;
        Ok(())
    }

    pub fn confirm_change(&mut self) -> Result<(), RuntimeError> {
        if self.session.kind != SessionKind::Change
            || self.session.change_state != Some(ChangeState::Draft)
        {
            return Err(RuntimeError::NotDraft);
        }
        self.session.change_state = Some(ChangeState::Confirmed);
        Ok(())
    }

    pub fn respond_permission(
        &mut self,
        call_id: &ToolCallId,
        allow: bool,
    ) -> Result<(), RuntimeError> {
        if self
            .pending_permission
            .as_ref()
            .is_none_or(|call| &call.id != call_id)
        {
            return Err(RuntimeError::NoPendingPermission);
        }
        if self.approved.contains_key(&call_id.0) {
            return Err(RuntimeError::NoPendingPermission);
        }
        self.approved.insert(call_id.0.clone(), allow);
        Ok(())
    }

    pub fn answer_question(
        &mut self,
        call_id: &ToolCallId,
        answer: impl Into<String>,
    ) -> Result<(), RuntimeError> {
        if self
            .pending_question
            .as_ref()
            .is_none_or(|(id, _)| id != call_id)
        {
            return Err(RuntimeError::NoPendingQuestion);
        }
        let answer = answer.into();
        if answer.len() > MAX_RUNTIME_TEXT_BYTES || answer.contains('\0') {
            return Err(RuntimeError::InvalidInput);
        }
        self.append_tool_result(call_id, json!({"answer": answer}), false)?;
        self.messages.push(InputMessage {
            role: InputRole::Tool,
            parts: vec![InputPart::ToolResult {
                id: call_id.0.clone(),
                output: json!({"answer": answer}),
                is_error: false,
            }],
        });
        self.pending_question = None;
        Ok(())
    }

    pub fn cancel(&mut self, reason: &str) -> Result<RunOutcome, RuntimeError> {
        if reason.len() > MAX_RUNTIME_TEXT_BYTES || reason.contains('\0') {
            return Err(RuntimeError::InvalidInput);
        }
        if let Some((id, _)) = self.pending_question.take() {
            self.record_tool_output(&id, json!({"error":reason,"interrupted":true}), true)?;
        }
        for call in [
            self.pending_permission.take(),
            self.pending_authority.take(),
        ]
        .into_iter()
        .flatten()
        {
            self.approved.remove(&call.id.0);
            self.claim(&call.id)?;
            self.record_tool_output(&call.id, json!({"error":reason,"interrupted":true}), true)?;
        }
        let cancelled_at = self.tick();
        self.storage
            .cancel_operation(&self.operation_id, reason, cancelled_at)?;
        Ok(RunOutcome::Cancelled {
            reason: reason.to_owned(),
        })
    }

    pub fn run(&mut self, prompt: Option<&str>) -> Result<RunOutcome, RuntimeError> {
        if self.repairs >= self.budget.max_repair_attempts {
            return Ok(RunOutcome::Paused(Pause::RepairBudgetExhausted));
        }
        if let Some(handoff) = self.pending_doom_loop.clone() {
            match self.doom_loop_response.take() {
                None => return Ok(RunOutcome::Paused(Pause::DoomLoop { handoff })),
                Some(true) => {
                    self.pending_doom_loop = None;
                    self.non_progress = 0;
                    self.last_fingerprint = None;
                }
                Some(false) => {
                    self.pending_doom_loop = None;
                    return self.cancel("doom_loop approval denied");
                }
            }
        }
        if let Some(prompt) = prompt {
            if prompt.len() > MAX_RUNTIME_TEXT_BYTES || prompt.contains('\0') {
                return Err(RuntimeError::InvalidInput);
            }
            self.messages.push(InputMessage {
                role: InputRole::User,
                parts: vec![InputPart::Text {
                    text: prompt.into(),
                }],
            });
        }
        if let Some(call) = self.pending_permission.clone() {
            let Some(allow) = self.approved.remove(&call.id.0) else {
                return Ok(RunOutcome::Paused(Pause::Permission(call)));
            };
            self.pending_permission = None;
            if allow {
                if let Some(outcome) = self.execute_call(call)? {
                    return Ok(outcome);
                }
            } else {
                self.claim(&call.id)?;
                self.record_tool_output(&call.id, json!({"error":"permission_denied"}), true)?;
            }
        }
        if let Some(call) = self.pending_authority.clone() {
            if self.session.require_mutation_authority().is_err() {
                return Ok(RunOutcome::Paused(Pause::DraftChangeRequired {
                    intent: format!("tool {} requires confirmed change", call.name),
                }));
            }
            self.pending_authority = None;
            if let Some(outcome) = self.execute_call(call)? {
                return Ok(outcome);
            }
        }
        if let Some((id, prompt)) = self.pending_question.clone() {
            return Ok(RunOutcome::Paused(Pause::Question {
                call_id: id,
                prompt,
            }));
        }
        loop {
            if self.turns >= self.budget.max_turns {
                return Err(RuntimeError::TurnBudget);
            }
            self.turns += 1;
            self.compact_context();
            let request = NormalizedRequest {
                operation_id: self.operation_id.0.clone(),
                model: "selected".into(),
                messages: self.messages.clone(),
                tools: self.tools.definitions(),
                max_output_tokens: self.budget.max_output_tokens,
                replay: self.replay.clone(),
            };
            let mut events = Vec::new();
            // Keep compatibility with providers that emit very small deltas,
            // while bounding hostile or broken streams independently of RAM.
            let output_tokens = self.budget.max_output_tokens.unwrap_or(16_384);
            let max_stream_events = usize::try_from(output_tokens.saturating_mul(4))
                .unwrap_or(65_536)
                .clamp(1_024, 65_536);
            let max_stream_bytes = usize::try_from(output_tokens.saturating_mul(8))
                .unwrap_or(8 * 1024 * 1024)
                .clamp(64 * 1024, 8 * 1024 * 1024);
            let mut stream_bytes = 0usize;
            let mut stream_limit_exceeded = false;
            let session_id = self.session.id.clone();
            let operation_id = self.operation_id.clone();
            let mut stream_control = None;
            let mut stream_calls = BTreeMap::<String, PendingCall>::new();
            let stream_result = {
                let storage = &mut *self.storage;
                let clock_ms = &mut self.clock_ms;
                let control = &mut self.control;
                self.provider.stream_incremental(&request, &mut |event| {
                    let event_bytes = stream_event_size(&event);
                    if events.len() >= max_stream_events
                        || stream_bytes.saturating_add(event_bytes) > max_stream_bytes
                    {
                        stream_limit_exceeded = true;
                        return Err(format!(
                            "provider stream exceeded bounded assembler ({max_stream_events} events/{max_stream_bytes} bytes)"
                        ));
                    }
                    stream_bytes = stream_bytes.saturating_add(event_bytes);
                    match &event {
                        StreamEvent::ToolCallStarted { id, .. }
                            if stream_calls.contains_key(id) =>
                        {
                            return Err(format!("duplicate tool call id: {id}"));
                        }
                        StreamEvent::ToolArgumentsDelta { id, .. } => {
                            let call = stream_calls
                                .get(id)
                                .ok_or_else(|| format!("tool arguments before start: {id}"))?;
                            if call.arguments.is_some() {
                                return Err(format!("tool arguments after completion: {id}"));
                            }
                        }
                        StreamEvent::ToolCallCompleted { id, .. } => {
                            let call = stream_calls
                                .get(id)
                                .ok_or_else(|| format!("tool completion before start: {id}"))?;
                            if call.arguments.is_some() {
                                return Err(format!("duplicate tool completion: {id}"));
                            }
                        }
                        _ => {}
                    }
                    persist_stream_event(storage, &session_id, &operation_id, clock_ms, &event)
                        .map_err(|error| error.to_string())?;
                    match &event {
                        StreamEvent::ToolCallStarted { id, name } => {
                            stream_calls.insert(
                                id.clone(),
                                PendingCall {
                                    name: name.clone(),
                                    ..Default::default()
                                },
                            );
                        }
                        StreamEvent::ToolArgumentsDelta { id, json_fragment } => {
                            if let Some(call) = stream_calls.get_mut(id) {
                                call.fragments.push_str(json_fragment);
                            }
                        }
                        StreamEvent::ToolCallCompleted { id, arguments } => {
                            if let Some(call) = stream_calls.get_mut(id) {
                                call.arguments = Some(arguments.clone());
                            }
                        }
                        _ => {}
                    }
                    events.push(event);
                    let next = control.poll();
                    if next != Control::Continue {
                        terminalize_stream_calls(
                            storage,
                            &session_id,
                            &operation_id,
                            clock_ms,
                            &stream_calls,
                            match &next {
                                Control::Steer(_) => "steered",
                                Control::Cancel(reason) => reason,
                                // Defensive fallback: the enclosing branch
                                // excludes Continue, but runtime control must
                                // never turn an internal inconsistency into a
                                // process panic with owned tools still live.
                                Control::Continue => "runtime_control_inconsistent",
                            },
                        )
                        .map_err(|error| error.to_string())?;
                        stream_control = Some(next);
                        return Err("stream interrupted by runtime control".into());
                    }
                    Ok(())
                })
            };
            let provider_stream_error = match stream_result {
                Ok(()) => {
                    self.retries = 0;
                    None
                }
                Err(error) => {
                    if !events.is_empty() || stream_limit_exceeded {
                        Some(error)
                    } else {
                        self.retries = self.retries.saturating_add(1);
                        if self.retries > self.budget.max_provider_retries {
                            return Err(RuntimeError::Provider(error));
                        }
                        continue;
                    }
                }
            };
            let mut calls = BTreeMap::<String, PendingCall>::new();
            let mut order = Vec::new();
            let mut text = String::new();
            let mut reasoning = String::new();
            let mut turn_replay = Vec::new();
            let mut finish = FinishReason::Unknown;
            let mut steered = false;
            for event in events {
                match event {
                    StreamEvent::OutputDelta { text: delta } => text.push_str(&delta),
                    StreamEvent::ReasoningDelta {
                        text: delta,
                        replay,
                    } => {
                        reasoning.push_str(&delta);
                        if let Some(replay) = replay {
                            if self.replay.len() >= MAX_RUNTIME_REPLAY_ITEMS {
                                self.interrupt_calls(&calls, "replay_budget_exhausted")?;
                                return Err(RuntimeError::ReplayBudget);
                            }
                            self.replay.push(replay.clone());
                            turn_replay.push(replay);
                        }
                    }
                    StreamEvent::ToolCallStarted { id, name } => {
                        if calls.contains_key(&id) {
                            return Err(RuntimeError::MalformedStream(format!(
                                "duplicate tool call id: {id}"
                            )));
                        }
                        order.push(id.clone());
                        calls.insert(
                            id,
                            PendingCall {
                                name,
                                ..Default::default()
                            },
                        );
                    }
                    StreamEvent::ToolArgumentsDelta { id, json_fragment } => calls
                        .get_mut(&id)
                        .ok_or_else(|| RuntimeError::MalformedStream(id.clone()))?
                        .fragments
                        .push_str(&json_fragment),
                    StreamEvent::ToolCallCompleted { id, arguments } => {
                        calls
                            .get_mut(&id)
                            .ok_or_else(|| RuntimeError::MalformedStream(id.clone()))?
                            .arguments = Some(arguments)
                    }
                    StreamEvent::Completed { finish_reason, .. } => finish = finish_reason,
                    StreamEvent::Error { error } => {
                        self.interrupt_calls(&calls, "provider_error")?;
                        return Err(RuntimeError::Provider(error.to_string()));
                    }
                    StreamEvent::Usage { accounting } => {
                        if let Some(limit) = self.budget.max_total_tokens {
                            let known = |measurement: &Measurement<u64>| match measurement {
                                Measurement::Known(value) => Ok(*value),
                                Measurement::Unknown { .. } => Err(RuntimeError::TokenUsageUnknown),
                            };
                            let usage = known(&accounting.tokens.input).and_then(|input| {
                                known(&accounting.tokens.output).map(|output| (input, output))
                            });
                            let (input, output) = match usage {
                                Ok(usage) => usage,
                                Err(error) => {
                                    self.interrupt_calls(&calls, "token_usage_unknown")?;
                                    return Err(error);
                                }
                            };
                            let Some(tokens_used) = self
                                .tokens_used
                                .checked_add(input)
                                .and_then(|tokens| tokens.checked_add(output))
                            else {
                                self.interrupt_calls(&calls, "token_budget_exhausted")?;
                                return Err(RuntimeError::TokenBudget);
                            };
                            self.tokens_used = tokens_used;
                            if tokens_used > limit {
                                self.interrupt_calls(&calls, "token_budget_exhausted")?;
                                return Err(RuntimeError::TokenBudget);
                            }
                        }
                    }
                }
                match self.control.poll() {
                    Control::Cancel(reason) => {
                        self.interrupt_calls(&calls, &reason)?;
                        preserve_interrupted_history(
                            &mut self.messages,
                            &text,
                            &reasoning,
                            turn_replay.last(),
                            &order,
                            &calls,
                            &reason,
                        );
                        let cancelled_at = self.tick();
                        self.storage
                            .cancel_operation(&self.operation_id, &reason, cancelled_at)?;
                        return Ok(RunOutcome::Cancelled { reason });
                    }
                    Control::Steer(steering) => {
                        self.interrupt_calls(&calls, "steered")?;
                        preserve_interrupted_history(
                            &mut self.messages,
                            &text,
                            &reasoning,
                            turn_replay.last(),
                            &order,
                            &calls,
                            "steered",
                        );
                        if steering.len() > MAX_RUNTIME_TEXT_BYTES || steering.contains('\0') {
                            return Err(RuntimeError::InvalidInput);
                        }
                        self.messages.push(InputMessage {
                            role: InputRole::User,
                            parts: vec![InputPart::Text { text: steering }],
                        });
                        steered = true;
                        break;
                    }
                    Control::Continue => {}
                }
            }
            if let Some(control) = stream_control {
                match control {
                    Control::Steer(steering) => {
                        preserve_interrupted_history(
                            &mut self.messages,
                            &text,
                            &reasoning,
                            turn_replay.last(),
                            &order,
                            &calls,
                            "steered",
                        );
                        if steering.len() > MAX_RUNTIME_TEXT_BYTES || steering.contains('\0') {
                            return Err(RuntimeError::InvalidInput);
                        }
                        self.messages.push(InputMessage {
                            role: InputRole::User,
                            parts: vec![InputPart::Text { text: steering }],
                        });
                        continue;
                    }
                    Control::Cancel(reason) => {
                        preserve_interrupted_history(
                            &mut self.messages,
                            &text,
                            &reasoning,
                            turn_replay.last(),
                            &order,
                            &calls,
                            &reason,
                        );
                        let cancelled_at = self.tick();
                        self.storage
                            .cancel_operation(&self.operation_id, &reason, cancelled_at)?;
                        return Ok(RunOutcome::Cancelled { reason });
                    }
                    // A stored Continue is not actionable. Re-enter the loop
                    // instead of panicking and leaking the active operation.
                    Control::Continue => continue,
                }
            }
            if let Some(error) = provider_stream_error {
                self.interrupt_calls(&calls, "provider_interrupted")?;
                return Err(RuntimeError::Provider(error));
            }
            if steered {
                continue;
            }
            if !text.is_empty() || !reasoning.is_empty() {
                let mut parts = Vec::new();
                if !reasoning.is_empty() {
                    parts.push(InputPart::Reasoning {
                        text: reasoning,
                        replay: turn_replay.last().cloned(),
                    });
                }
                if !text.is_empty() {
                    parts.push(InputPart::Text { text: text.clone() });
                }
                self.messages.push(InputMessage {
                    role: InputRole::Assistant,
                    parts,
                });
            }
            let mut outputs = Vec::new();
            let mut scheduled_children = Vec::new();
            for id in order {
                let pending = calls
                    .remove(&id)
                    .ok_or_else(|| RuntimeError::MalformedStream(id.clone()))?;
                let parsed = if pending.fragments.is_empty() {
                    pending.arguments.clone()
                } else {
                    match serde_json::from_str::<Value>(&pending.fragments) {
                        Ok(arguments) => Some(arguments),
                        Err(_) => {
                            self.terminalize_scheduled_calls(
                                &scheduled_children,
                                "partial_tool_arguments",
                            )?;
                            self.terminalize_assembly_failure(
                                &id,
                                &calls,
                                "partial_tool_arguments",
                            )?;
                            return Err(RuntimeError::PartialArguments(id));
                        }
                    }
                };
                if let (Some(parsed), Some(completed)) = (&parsed, &pending.arguments)
                    && parsed != completed
                {
                    self.terminalize_scheduled_calls(
                        &scheduled_children,
                        "tool_argument_mismatch",
                    )?;
                    self.terminalize_assembly_failure(&id, &calls, "tool_argument_mismatch")?;
                    return Err(RuntimeError::ArgumentMismatch(id));
                }
                let Some(arguments) = pending.arguments.or(parsed) else {
                    self.terminalize_scheduled_calls(
                        &scheduled_children,
                        "missing_tool_arguments",
                    )?;
                    self.terminalize_assembly_failure(&id, &calls, "missing_tool_arguments")?;
                    return Err(RuntimeError::PartialArguments(id));
                };
                let Some(definition) = self
                    .tools
                    .definitions()
                    .into_iter()
                    .find(|tool| tool.name == pending.name)
                else {
                    self.terminalize_scheduled_calls(&scheduled_children, "unknown_tool")?;
                    self.terminalize_assembly_failure(&id, &calls, "unknown_tool")?;
                    return Err(RuntimeError::UnknownTool(pending.name));
                };
                let Some(permission) = self.tools.permission(&definition.name) else {
                    self.terminalize_scheduled_calls(
                        &scheduled_children,
                        "unknown_tool_permission",
                    )?;
                    self.terminalize_assembly_failure(&id, &calls, "unknown_tool_permission")?;
                    return Err(RuntimeError::UnknownTool(definition.name));
                };
                let call = ToolCall {
                    id: ToolCallId::from_stable(id.clone()),
                    name: pending.name,
                    arguments,
                    permission,
                    mutating: definition.mutating,
                };
                let progress_marker = format!("{}:{}", call.name, call.arguments);
                match self.permissions.decide(&call) {
                    DecisionAction::Deny => {
                        if !scheduled_children.is_empty()
                            && let Some(outcome) = self
                                .execute_subagent_calls(std::mem::take(&mut scheduled_children))?
                        {
                            return Ok(outcome);
                        }
                        self.claim(&call.id)?;
                        self.record_tool_output(
                            &call.id,
                            json!({"error":"permission_denied"}),
                            true,
                        )?;
                    }
                    DecisionAction::Ask => {
                        if !scheduled_children.is_empty()
                            && let Some(outcome) = self
                                .execute_subagent_calls(std::mem::take(&mut scheduled_children))?
                        {
                            return Ok(outcome);
                        }
                        self.pending_permission = Some(call.clone());
                        return Ok(RunOutcome::Paused(Pause::Permission(call)));
                    }
                    DecisionAction::Allow => {
                        if self.tools.is_subagent_tool(&call.name) {
                            scheduled_children.push(call);
                        } else {
                            if !scheduled_children.is_empty()
                                && let Some(outcome) = self.execute_subagent_calls(
                                    std::mem::take(&mut scheduled_children),
                                )?
                            {
                                return Ok(outcome);
                            }
                            if let Some(outcome) = self.execute_call(call)? {
                                return Ok(outcome);
                            }
                        }
                    }
                }
                outputs.push(progress_marker);
            }
            if !scheduled_children.is_empty()
                && let Some(outcome) = self.execute_subagent_calls(scheduled_children)?
            {
                return Ok(outcome);
            }
            if !outputs.is_empty() {
                let fingerprint = format!("{text}:{outputs:?}");
                if self.last_fingerprint.as_ref() == Some(&fingerprint) {
                    self.non_progress = self.non_progress.saturating_add(1);
                } else {
                    self.non_progress = 0;
                }
                self.last_fingerprint = Some(fingerprint);
                if self.non_progress >= self.budget.non_progress_limit {
                    let handoff = TransitionEffect::DoomLoopPermissionRequired;
                    self.pending_doom_loop = Some(handoff.clone());
                    return Ok(RunOutcome::Paused(Pause::DoomLoop { handoff }));
                }
                continue;
            }
            if !calls.is_empty() || finish == FinishReason::ToolCalls {
                self.interrupt_calls(&calls, "provider_interrupted")?;
                return Err(RuntimeError::InterruptedTool);
            }
            return Ok(RunOutcome::Completed { text });
        }
    }

    /// Starts a user turn with provider-ready multimodal parts. Callers must
    /// resolve artifact bytes just-in-time; checkpoints should retain only
    /// content-addressed references whenever possible.
    pub fn run_with_parts(
        &mut self,
        prompt: &str,
        extra_parts: Vec<InputPart>,
    ) -> Result<RunOutcome, RuntimeError> {
        if prompt.len() > MAX_RUNTIME_TEXT_BYTES
            || prompt.contains('\0')
            || serde_json::to_vec(&extra_parts)?.len() > MAX_RUNTIME_TEXT_BYTES
        {
            return Err(RuntimeError::InvalidInput);
        }
        let mut parts = vec![InputPart::Text {
            text: prompt.into(),
        }];
        parts.extend(extra_parts);
        self.messages.push(InputMessage {
            role: InputRole::User,
            parts,
        });
        self.run(None)
    }

    fn execute_call(&mut self, call: ToolCall) -> Result<Option<RunOutcome>, RuntimeError> {
        if call.mutating
            && let Err(error) = self.session.require_mutation_authority()
        {
            self.pending_authority = Some(call.clone());
            return Ok(Some(RunOutcome::Paused(Pause::DraftChangeRequired {
                intent: format!("tool {} requires mutation: {error}", call.name),
            })));
        }
        self.claim(&call.id)?;
        match self.tools.dispatch(&call) {
            Ok(ToolDispatch::Output(output)) => {
                self.record_tool_output(&call.id, output, false)?;
                Ok(None)
            }
            Ok(ToolDispatch::Question(prompt)) => {
                if !bounded_checkpoint_text(&prompt) {
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(
                        &call.id,
                        json!({"error":"question prompt exceeds runtime bounds"}),
                        true,
                    )?;
                    return if self.repairs >= self.budget.max_repair_attempts {
                        Ok(Some(RunOutcome::Paused(Pause::RepairBudgetExhausted)))
                    } else {
                        Ok(None)
                    };
                }
                self.pending_question = Some((call.id.clone(), prompt.clone()));
                Ok(Some(RunOutcome::Paused(Pause::Question {
                    call_id: call.id,
                    prompt,
                })))
            }
            Ok(ToolDispatch::Subagent(spec)) => {
                let spec = *spec;
                if let Err(error) = self.subagents.register(spec.clone()) {
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(
                        &call.id,
                        json!({"error":error.to_string(),"child_session_id":spec.child_session_id}),
                        true,
                    )?;
                    return if self.repairs >= self.budget.max_repair_attempts {
                        Ok(Some(RunOutcome::Paused(Pause::RepairBudgetExhausted)))
                    } else {
                        Ok(None)
                    };
                }
                if let Err(error) = self.subagents.start(&spec.child_session_id) {
                    self.subagents
                        .release_resources(&spec.child_session_id)
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.subagents
                        .fail(&spec.child_session_id, error.to_string())
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(
                        &call.id,
                        json!({"error":error.to_string(),"child_session_id":spec.child_session_id}),
                        true,
                    )?;
                    return if self.repairs >= self.budget.max_repair_attempts {
                        Ok(Some(RunOutcome::Paused(Pause::RepairBudgetExhausted)))
                    } else {
                        Ok(None)
                    };
                }
                let result = match self.child_executor.execute(&spec) {
                    Ok(result) => result,
                    Err(error) => {
                        // A failed child must become terminal before control
                        // returns to the parent; no active record or claimed
                        // tool call may be stranded.
                        self.subagents
                            .release_resources(&spec.child_session_id)
                            .map_err(|e| RuntimeError::Subagent(e.to_string()))?;
                        self.subagents
                            .fail(&spec.child_session_id, error.clone())
                            .map_err(|e| RuntimeError::Subagent(e.to_string()))?;
                        self.repairs = self.repairs.saturating_add(1);
                        self.record_tool_output(
                            &call.id,
                            json!({"error":error,"child_session_id":spec.child_session_id}),
                            true,
                        )?;
                        return if self.repairs >= self.budget.max_repair_attempts {
                            Ok(Some(RunOutcome::Paused(Pause::RepairBudgetExhausted)))
                        } else {
                            Ok(None)
                        };
                    }
                };
                if let Err(error) = self
                    .subagents
                    .complete(&spec.child_session_id, result.clone())
                {
                    self.subagents
                        .release_resources(&spec.child_session_id)
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.subagents
                        .fail(&spec.child_session_id, error.to_string())
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(
                        &call.id,
                        json!({"error":error.to_string(),"child_session_id":spec.child_session_id}),
                        true,
                    )?;
                    return if self.repairs >= self.budget.max_repair_attempts {
                        Ok(Some(RunOutcome::Paused(Pause::RepairBudgetExhausted)))
                    } else {
                        Ok(None)
                    };
                }
                let typed_result = serde_json::to_value(&result)?;
                self.record_tool_output(
                    &call.id,
                    json!({"typed_subagent_result": typed_result}),
                    false,
                )?;
                Ok(None)
            }
            Err(error) => {
                self.repairs = self.repairs.saturating_add(1);
                self.record_tool_output(&call.id, json!({"error": error}), true)?;
                if self.repairs >= self.budget.max_repair_attempts {
                    Ok(Some(RunOutcome::Paused(Pause::RepairBudgetExhausted)))
                } else {
                    Ok(None)
                }
            }
        }
    }

    fn execute_subagent_calls(
        &mut self,
        calls: Vec<ToolCall>,
    ) -> Result<Option<RunOutcome>, RuntimeError> {
        let mut pending = Vec::with_capacity(calls.len());
        for call in calls {
            self.claim(&call.id)?;
            match self.tools.dispatch(&call) {
                Ok(ToolDispatch::Subagent(spec)) => pending.push((call, *spec)),
                Ok(_) => {
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(
                        &call.id,
                        json!({"error":"subagent tool returned a non-subagent dispatch"}),
                        true,
                    )?;
                }
                Err(error) => {
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(&call.id, json!({"error":error}), true)?;
                }
            }
        }
        let limit = pending
            .iter()
            .map(|(_, spec)| spec.budget.max_parallel_children)
            .min()
            .unwrap_or(1)
            .clamp(1, changeloop_agent::DEFAULT_MAX_PARALLEL_CHILDREN) as usize;
        for (wave_index, wave) in pending.chunks(limit).enumerate() {
            if self.repairs >= self.budget.max_repair_attempts {
                for (call, spec) in wave {
                    self.record_tool_output(
                        &call.id,
                        json!({"error":"repair budget exhausted","child_session_id":spec.child_session_id}),
                        true,
                    )?;
                }
                continue;
            }
            let mut started = Vec::with_capacity(wave.len());
            for (call, spec) in wave {
                if let Err(error) = self.subagents.register(spec.clone()) {
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(
                        &call.id,
                        json!({"error":error.to_string(),"child_session_id":spec.child_session_id}),
                        true,
                    )?;
                    continue;
                }
                if let Err(error) = self.subagents.start(&spec.child_session_id) {
                    self.subagents
                        .release_resources(&spec.child_session_id)
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.subagents
                        .fail(&spec.child_session_id, error.to_string())
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.repairs = self.repairs.saturating_add(1);
                    self.record_tool_output(
                        &call.id,
                        json!({"error":error.to_string(),"child_session_id":spec.child_session_id}),
                        true,
                    )?;
                    continue;
                }
                started.push((call, spec));
            }
            let specs = started
                .iter()
                .map(|(_, spec)| (*spec).clone())
                .collect::<Vec<_>>();
            if specs.is_empty() {
                continue;
            }
            let results = self.child_executor.execute_many(&specs);
            if results.len() != started.len() {
                for (call, spec) in &started {
                    self.subagents
                        .release_resources(&spec.child_session_id)
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.subagents
                        .fail(&spec.child_session_id, "invalid scheduler result count")
                        .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                    self.record_tool_output(
                        &call.id,
                        json!({"error":"invalid scheduler result count","child_session_id":spec.child_session_id}),
                        true,
                    )?;
                }
                let future_start = (wave_index + 1).saturating_mul(limit).min(pending.len());
                for (call, spec) in &pending[future_start..] {
                    self.record_tool_output(
                        &call.id,
                        json!({"error":"child scheduler aborted","child_session_id":spec.child_session_id}),
                        true,
                    )?;
                }
                return Err(RuntimeError::Subagent(
                    "child scheduler returned an invalid result count".into(),
                ));
            }
            for ((call, spec), result) in started.into_iter().zip(results) {
                match result {
                    Ok(result) => {
                        if let Err(error) = self
                            .subagents
                            .complete(&spec.child_session_id, result.clone())
                        {
                            self.subagents
                                .release_resources(&spec.child_session_id)
                                .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                            self.subagents
                                .fail(&spec.child_session_id, error.to_string())
                                .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                            self.repairs = self.repairs.saturating_add(1);
                            self.record_tool_output(
                                &call.id,
                                json!({"error":error.to_string(),"child_session_id":spec.child_session_id}),
                                true,
                            )?;
                            continue;
                        }
                        self.record_tool_output(
                            &call.id,
                            json!({"typed_subagent_result":serde_json::to_value(result)?}),
                            false,
                        )?;
                    }
                    Err(error) => {
                        self.subagents
                            .release_resources(&spec.child_session_id)
                            .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                        self.subagents
                            .fail(&spec.child_session_id, error.clone())
                            .map_err(|failure| RuntimeError::Subagent(failure.to_string()))?;
                        self.repairs = self.repairs.saturating_add(1);
                        self.record_tool_output(
                            &call.id,
                            json!({"error":error,"child_session_id":spec.child_session_id}),
                            true,
                        )?;
                    }
                }
            }
        }
        if self.repairs >= self.budget.max_repair_attempts {
            Ok(Some(RunOutcome::Paused(Pause::RepairBudgetExhausted)))
        } else {
            Ok(None)
        }
    }

    fn claim(&self, id: &ToolCallId) -> Result<(), RuntimeError> {
        match self
            .storage
            .claim_tool_call(&self.session.id, Some(&self.operation_id), id)?
        {
            ToolClaim::Claimed => Ok(()),
            ToolClaim::AlreadyClaimed(state) => {
                Err(RuntimeError::AlreadyClaimed(format!("{state:?}")))
            }
        }
    }

    fn record_tool_output(
        &mut self,
        id: &ToolCallId,
        output: Value,
        is_error: bool,
    ) -> Result<(), RuntimeError> {
        self.append_tool_result(id, output.clone(), is_error)?;
        self.messages.push(InputMessage {
            role: InputRole::Tool,
            parts: vec![InputPart::ToolResult {
                id: id.0.clone(),
                output,
                is_error,
            }],
        });
        Ok(())
    }

    fn append_tool_result(
        &mut self,
        id: &ToolCallId,
        output: Value,
        is_error: bool,
    ) -> Result<(), RuntimeError> {
        let message = Message {
            schema_version: 1,
            id: MessageId::new(),
            session_id: self.session.id.clone(),
            created_at_ms: self.tick(),
            parts: vec![MessagePart {
                schema_version: 1,
                id: PartId::new(),
                state: if is_error {
                    PartState::Error
                } else {
                    PartState::Completed
                },
                provenance: Provenance::ToolOutput,
                body: MessagePartBody::ToolResult {
                    tool_call_id: id.clone(),
                    output: Some(output.to_string()),
                    artifact: None,
                    is_error,
                },
            }],
        };
        let emitted_at = self.tick();
        self.storage.append_and_complete_tool_call(
            &self.session.id,
            id,
            emitted_at,
            Event::MessageAppended { message },
        )?;
        Ok(())
    }

    fn interrupt_calls(
        &mut self,
        calls: &BTreeMap<String, PendingCall>,
        reason: &str,
    ) -> Result<(), RuntimeError> {
        for id in calls.keys() {
            let id = ToolCallId::from_stable(id);
            if self
                .storage
                .claim_tool_call(&self.session.id, Some(&self.operation_id), &id)?
                == ToolClaim::Claimed
            {
                self.record_tool_output(&id, json!({"error":reason,"interrupted":true}), true)?;
            }
        }
        Ok(())
    }

    fn terminalize_assembly_failure(
        &mut self,
        current_id: &str,
        remaining: &BTreeMap<String, PendingCall>,
        reason: &str,
    ) -> Result<(), RuntimeError> {
        let id = ToolCallId::from_stable(current_id);
        self.claim(&id)?;
        self.record_tool_output(&id, json!({"error":reason,"interrupted":true}), true)?;
        self.interrupt_calls(remaining, reason)
    }

    fn terminalize_scheduled_calls(
        &mut self,
        calls: &[ToolCall],
        reason: &str,
    ) -> Result<(), RuntimeError> {
        for call in calls {
            self.claim(&call.id)?;
            self.record_tool_output(&call.id, json!({"error":reason,"interrupted":true}), true)?;
        }
        Ok(())
    }

    fn compact_context(&mut self) {
        if self.messages.len() <= self.budget.max_context_messages {
            return;
        }
        let keep = self.budget.keep_recent_messages.min(self.messages.len());
        let removed = self.messages.len() - keep;
        let mut recent = self.messages.split_off(removed);
        self.messages = vec![InputMessage {
            role: InputRole::Developer,
            parts: vec![InputPart::Text {
                text: format!(
                    "[compacted {removed} earlier messages; provider replay metadata retained]"
                ),
            }],
        }];
        self.messages.append(&mut recent);
    }

    fn tick(&mut self) -> u64 {
        self.clock_ms += 1;
        self.clock_ms
    }
}

#[derive(Clone, Debug)]
pub struct DraftChange {
    pub session: Session,
    pub intent: String,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("unsupported runtime checkpoint schema version {0}")]
    CheckpointVersion(u16),
    #[error("invalid runtime checkpoint: {0}")]
    InvalidCheckpoint(&'static str),
    #[error("no doom_loop decision is pending")]
    NoPendingDoomLoop,
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error(transparent)]
    Session(#[from] SessionError),
    #[error("provider failed: {0}")]
    Provider(String),
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    #[error("malformed provider stream for {0}")]
    MalformedStream(String),
    #[error("partial tool arguments for {0}")]
    PartialArguments(String),
    #[error("partial and completed arguments differ for {0}")]
    ArgumentMismatch(String),
    #[error("provider interrupted a tool call")]
    InterruptedTool,
    #[error("tool call was already claimed: {0}")]
    AlreadyClaimed(String),
    #[error("turn budget exhausted")]
    TurnBudget,
    #[error("token budget exhausted")]
    TokenBudget,
    #[error("provider token usage is unknown under a bounded runtime")]
    TokenUsageUnknown,
    #[error("provider replay metadata exceeded the runtime bound")]
    ReplayBudget,
    #[error("session is not a draft change")]
    NotDraft,
    #[error("no matching pending permission")]
    NoPendingPermission,
    #[error("no matching pending question")]
    NoPendingQuestion,
    #[error("runtime input exceeds its bounded contract")]
    InvalidInput,
    #[error("subagent failed: {0}")]
    Subagent(String),
}

fn validate_checkpoint(checkpoint: &RuntimeCheckpoint) -> Result<(), RuntimeError> {
    let budget = checkpoint.budget;
    if !valid_runtime_budget(budget) {
        return Err(RuntimeError::InvalidCheckpoint("invalid runtime budget"));
    }
    if checkpoint.turns > budget.max_turns
        || checkpoint.retries > budget.max_provider_retries
        || checkpoint.repairs > budget.max_repair_attempts
        || budget
            .max_total_tokens
            .is_some_and(|limit| checkpoint.tokens_used > limit)
        || checkpoint.messages.len() > MAX_RUNTIME_MESSAGES
        || checkpoint.replay.len() > MAX_RUNTIME_REPLAY_ITEMS
    {
        return Err(RuntimeError::InvalidCheckpoint(
            "counter or collection exceeds budget",
        ));
    }
    let pending_count = usize::from(checkpoint.pending_permission.is_some())
        + usize::from(checkpoint.pending_authority.is_some())
        + usize::from(checkpoint.pending_question.is_some());
    if pending_count > 1
        || checkpoint.approved.len() > 1
        || checkpoint.approved.keys().any(|id| {
            checkpoint
                .pending_permission
                .as_ref()
                .is_none_or(|call| &call.id.0 != id)
        })
        || checkpoint.doom_loop_response.is_some() && checkpoint.pending_doom_loop.is_none()
        || (checkpoint.non_progress >= budget.non_progress_limit)
            != checkpoint.pending_doom_loop.is_some()
        || checkpoint
            .pending_doom_loop
            .as_ref()
            .is_some_and(|effect| !matches!(effect, TransitionEffect::DoomLoopPermissionRequired))
    {
        return Err(RuntimeError::InvalidCheckpoint(
            "pending interaction state is inconsistent",
        ));
    }
    if !bounded_checkpoint_text(&checkpoint.binding.workspace_revision)
        || !bounded_checkpoint_text(&checkpoint.binding.tool_schema_sha256)
        || checkpoint
            .pending_question
            .as_ref()
            .is_some_and(|(_, prompt)| !bounded_checkpoint_text(prompt))
        || checkpoint
            .pending_question
            .as_ref()
            .is_some_and(|(id, _)| !bounded_checkpoint_text(&id.0))
        || checkpoint
            .pending_permission
            .as_ref()
            .is_some_and(|call| !valid_checkpoint_call(call))
        || checkpoint
            .pending_authority
            .as_ref()
            .is_some_and(|call| !call.mutating || !valid_checkpoint_call(call))
    {
        return Err(RuntimeError::InvalidCheckpoint(
            "checkpoint identity or prompt is invalid",
        ));
    }
    let encoded = serde_json::to_vec(checkpoint)?;
    if encoded.len() > MAX_RUNTIME_CHECKPOINT_BYTES {
        return Err(RuntimeError::InvalidCheckpoint(
            "checkpoint exceeds byte limit",
        ));
    }
    Ok(())
}

fn valid_runtime_budget(budget: RuntimeBudget) -> bool {
    budget.max_turns > 0
        && budget.max_turns <= 10_000
        && budget.max_provider_retries <= 100
        && budget.max_repair_attempts > 0
        && budget.max_repair_attempts <= 100
        && budget.non_progress_limit > 0
        && budget.non_progress_limit <= 100
        && budget.max_context_messages > 0
        && budget.max_context_messages <= MAX_RUNTIME_MESSAGES
        && budget.keep_recent_messages <= budget.max_context_messages
        && budget.max_output_tokens != Some(0)
        && budget.max_total_tokens != Some(0)
}

fn bounded_checkpoint_text(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_RUNTIME_TEXT_BYTES
        && !value.chars().any(char::is_control)
}

fn valid_checkpoint_call(call: &ToolCall) -> bool {
    bounded_checkpoint_text(&call.id.0)
        && bounded_checkpoint_text(&call.name)
        && serde_json::to_vec(&call.arguments)
            .is_ok_and(|arguments| arguments.len() <= MAX_RUNTIME_TEXT_BYTES)
}

fn stream_event_size(event: &StreamEvent) -> usize {
    match event {
        StreamEvent::OutputDelta { text } => text.len(),
        StreamEvent::ReasoningDelta { text, replay } => {
            text.len()
                + replay
                    .as_ref()
                    .map_or(0, |value| format!("{value:?}").len())
        }
        StreamEvent::ToolCallStarted { id, name } => id.len() + name.len(),
        StreamEvent::ToolArgumentsDelta { id, json_fragment } => id.len() + json_fragment.len(),
        StreamEvent::ToolCallCompleted { id, arguments } => id.len() + arguments.to_string().len(),
        StreamEvent::Usage { accounting } => format!("{accounting:?}").len(),
        StreamEvent::Completed { .. } => 32,
        StreamEvent::Error { error } => {
            error.message.len() + error.code.as_deref().map_or(0, str::len)
        }
    }
}

fn preserve_interrupted_history(
    messages: &mut Vec<InputMessage>,
    text: &str,
    reasoning: &str,
    replay: Option<&ReplayMetadata>,
    order: &[String],
    calls: &BTreeMap<String, PendingCall>,
    reason: &str,
) {
    let mut parts = Vec::new();
    if !reasoning.is_empty() {
        parts.push(InputPart::Reasoning {
            text: reasoning.into(),
            replay: replay.cloned(),
        });
    }
    if !text.is_empty() {
        parts.push(InputPart::Text { text: text.into() });
    }
    for id in order {
        let Some(call) = calls.get(id) else { continue };
        let arguments = call
            .arguments
            .clone()
            .unwrap_or_else(|| json!({"interrupted":true,"partialJson":call.fragments}));
        parts.push(InputPart::ToolCall {
            id: id.clone(),
            name: call.name.clone(),
            arguments,
        });
    }
    if !parts.is_empty() {
        messages.push(InputMessage {
            role: InputRole::Assistant,
            parts,
        });
    }
    for id in order {
        if calls.contains_key(id) {
            messages.push(InputMessage {
                role: InputRole::Tool,
                parts: vec![InputPart::ToolResult {
                    id: id.clone(),
                    output: json!({"error":reason,"interrupted":true}),
                    is_error: true,
                }],
            });
        }
    }
}

fn persist_stream_event(
    storage: &mut Storage,
    session_id: &SessionId,
    operation_id: &OperationId,
    clock_ms: &mut u64,
    event: &StreamEvent,
) -> Result<(), changeloop_storage::StorageError> {
    let (state, body) = match event {
        StreamEvent::OutputDelta { text } => (
            PartState::Running,
            MessagePartBody::Text {
                text: redact_sensitive_text(text),
            },
        ),
        StreamEvent::ReasoningDelta { text, replay } => (
            PartState::Running,
            MessagePartBody::Reasoning {
                text: redact_sensitive_text(text),
                provider_metadata: serde_json::to_value(replay).unwrap_or(Value::Null),
            },
        ),
        StreamEvent::ToolCallStarted { id, name } => (
            PartState::Running,
            MessagePartBody::ToolCall {
                tool_call_id: ToolCallId::from_stable(id),
                name: name.clone(),
                arguments: Value::Null,
            },
        ),
        StreamEvent::ToolArgumentsDelta { id, json_fragment } => (
            PartState::Running,
            MessagePartBody::ToolCall {
                tool_call_id: ToolCallId::from_stable(id),
                name: String::new(),
                arguments: json!({"partialJson":json_fragment}),
            },
        ),
        StreamEvent::ToolCallCompleted { id, arguments } => (
            PartState::Completed,
            MessagePartBody::ToolCall {
                tool_call_id: ToolCallId::from_stable(id),
                name: String::new(),
                arguments: arguments.clone(),
            },
        ),
        StreamEvent::Usage { accounting } => (
            PartState::Completed,
            MessagePartBody::Reasoning {
                text: String::new(),
                provider_metadata: json!({"usage":accounting}),
            },
        ),
        StreamEvent::Completed { finish_reason, .. } => (
            PartState::Completed,
            MessagePartBody::StepFinish {
                operation_id: operation_id.clone(),
                outcome: format!("{finish_reason:?}").to_ascii_lowercase(),
            },
        ),
        StreamEvent::Error { error } => (
            PartState::Error,
            MessagePartBody::Error {
                code: error
                    .code
                    .clone()
                    .unwrap_or_else(|| "provider_error".into()),
                message: redact_sensitive_text(&error.message),
                retryable: error.retryable,
            },
        ),
    };
    *clock_ms = clock_ms.saturating_add(1);
    let message = Message {
        schema_version: 1,
        id: MessageId::new(),
        session_id: session_id.clone(),
        created_at_ms: *clock_ms,
        parts: vec![MessagePart {
            schema_version: 1,
            id: PartId::new(),
            state,
            provenance: Provenance::ModelGenerated,
            body,
        }],
    };
    storage.append_event(session_id, *clock_ms, Event::MessageAppended { message })?;
    Ok(())
}

fn terminalize_stream_calls(
    storage: &mut Storage,
    session_id: &SessionId,
    operation_id: &OperationId,
    clock_ms: &mut u64,
    calls: &BTreeMap<String, PendingCall>,
    reason: &str,
) -> Result<(), StorageError> {
    for id in calls.keys() {
        let tool_call_id = ToolCallId::from_stable(id);
        if storage.claim_tool_call(session_id, Some(operation_id), &tool_call_id)?
            != ToolClaim::Claimed
        {
            continue;
        }
        *clock_ms = clock_ms.saturating_add(1);
        let message = Message {
            schema_version: 1,
            id: MessageId::new(),
            session_id: session_id.clone(),
            created_at_ms: *clock_ms,
            parts: vec![MessagePart {
                schema_version: 1,
                id: PartId::new(),
                state: PartState::Error,
                provenance: Provenance::ToolOutput,
                body: MessagePartBody::ToolResult {
                    tool_call_id: tool_call_id.clone(),
                    output: Some(json!({"error":reason,"interrupted":true}).to_string()),
                    artifact: None,
                    is_error: true,
                },
            }],
        };
        storage.append_and_complete_tool_call(
            session_id,
            &tool_call_id,
            *clock_ms,
            Event::MessageAppended { message },
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use changeloop_agent::{
        ExpectedResultSchema, ModelFloor, ResultKind, SubagentBudget, TaskOutcome, TaskResult,
        TaskScope,
    };
    use changeloop_provider::{
        ErrorCategory, ProviderError, ProviderKind, TokenUsage, UsageAccounting,
    };
    use std::collections::VecDeque;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tempfile::tempdir;

    use super::*;

    struct Provider {
        batches: VecDeque<Result<Vec<StreamEvent>, String>>,
        requests: Vec<NormalizedRequest>,
    }
    impl StreamingProvider for Provider {
        fn stream(&mut self, request: &NormalizedRequest) -> Result<Vec<StreamEvent>, String> {
            self.requests.push(request.clone());
            self.batches.pop_front().expect("provider batch")
        }
    }
    struct Tools {
        calls: usize,
        mutating: bool,
        question: bool,
        fail: bool,
    }
    impl ToolDispatcher for Tools {
        fn definitions(&self) -> Vec<ToolDefinition> {
            vec![ToolDefinition {
                name: "edit".into(),
                description: "fixture".into(),
                input_schema: json!({"type":"object"}),
                mutating: self.mutating,
            }]
        }
        fn permission(&self, name: &str) -> Option<PermissionKind> {
            (name == "edit").then_some(if self.mutating {
                PermissionKind::FilesystemWrite
            } else {
                PermissionKind::FilesystemRead
            })
        }
        fn dispatch(&mut self, call: &ToolCall) -> Result<ToolDispatch, String> {
            self.calls += 1;
            if self.fail {
                Err("tool failed".into())
            } else if self.question {
                Ok(ToolDispatch::Question("continue?".into()))
            } else {
                Ok(ToolDispatch::Output(json!({"seen":call.arguments})))
            }
        }
    }
    struct Gate(DecisionAction);
    impl PermissionGate for Gate {
        fn decide(&mut self, _: &ToolCall) -> DecisionAction {
            self.0
        }
    }
    struct Controls(VecDeque<Control>);
    impl ControlSource for Controls {
        fn poll(&mut self) -> Control {
            self.0.pop_front().unwrap_or(Control::Continue)
        }
    }
    struct Children;
    impl ChildExecutor for Children {
        fn execute(&mut self, _: &SubagentSpec) -> Result<ChildResult, String> {
            Err("unused".into())
        }
    }

    struct BatchTools;

    impl ToolDispatcher for BatchTools {
        fn definitions(&self) -> Vec<ToolDefinition> {
            vec![ToolDefinition {
                name: "spawn_subagent".into(),
                description: "fixture".into(),
                input_schema: json!({"type":"object"}),
                mutating: false,
            }]
        }

        fn permission(&self, name: &str) -> Option<PermissionKind> {
            (name == "spawn_subagent").then_some(PermissionKind::FilesystemRead)
        }

        fn dispatch(&mut self, call: &ToolCall) -> Result<ToolDispatch, String> {
            Ok(ToolDispatch::Subagent(Box::new(SubagentSpec {
                parent_session_id: SessionId::from_stable("batch-parent"),
                child_session_id: SessionId::from_stable(&call.id.0),
                change_id: "change".into(),
                depth: 1,
                task: TaskScope {
                    task_id: call.id.0.clone(),
                    description: "fixture".into(),
                    repositories: vec!["root".into()],
                    paths: vec![format!("src/{}", call.id.0)],
                },
                allowed_tools: Default::default(),
                allowed_permissions: vec![],
                risk_floor: changeloop_provider::RiskTier::Low,
                model_floor: ModelFloor::Fast,
                budget: SubagentBudget::default(),
                expected_result: ExpectedResultSchema {
                    version: 1,
                    kind: ResultKind::TaskResult,
                },
                base_workspace_revision: "head".into(),
            })))
        }

        fn is_subagent_tool(&self, name: &str) -> bool {
            name == "spawn_subagent"
        }
    }

    struct BatchChildren(Arc<AtomicUsize>);

    impl ChildExecutor for BatchChildren {
        fn execute(&mut self, _: &SubagentSpec) -> Result<ChildResult, String> {
            panic!("batch scheduler should be used")
        }

        fn execute_many(&mut self, specs: &[SubagentSpec]) -> Vec<Result<ChildResult, String>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            specs
                .iter()
                .map(|spec| {
                    Ok(ChildResult::TaskResult(TaskResult {
                        outcome: TaskOutcome::Completed,
                        summary: spec.task.task_id.clone(),
                        artifact_refs: vec![],
                        invalidated_claims: Default::default(),
                    }))
                })
                .collect()
        }
    }

    struct DuplicateChildTools;

    impl ToolDispatcher for DuplicateChildTools {
        fn definitions(&self) -> Vec<ToolDefinition> {
            BatchTools.definitions()
        }

        fn permission(&self, name: &str) -> Option<PermissionKind> {
            BatchTools.permission(name)
        }

        fn dispatch(&mut self, call: &ToolCall) -> Result<ToolDispatch, String> {
            let mut base = BatchTools;
            let ToolDispatch::Subagent(spec) = base.dispatch(call)? else {
                unreachable!()
            };
            let mut spec = *spec;
            spec.child_session_id = SessionId::from_stable("duplicate-child");
            Ok(ToolDispatch::Subagent(Box::new(spec)))
        }

        fn is_subagent_tool(&self, name: &str) -> bool {
            BatchTools.is_subagent_tool(name)
        }
    }

    fn tool_batch() -> Vec<StreamEvent> {
        tool_batch_id("call-1")
    }
    fn tool_batch_id(call_id: &str) -> Vec<StreamEvent> {
        vec![
            StreamEvent::ToolCallStarted {
                id: call_id.into(),
                name: "edit".into(),
            },
            StreamEvent::ToolArgumentsDelta {
                id: call_id.into(),
                json_fragment: "{\"path\":".into(),
            },
            StreamEvent::ToolArgumentsDelta {
                id: call_id.into(),
                json_fragment: "\"a.rs\"}".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: call_id.into(),
                arguments: json!({"path":"a.rs"}),
            },
            StreamEvent::Completed {
                response_id: "r1".into(),
                finish_reason: FinishReason::ToolCalls,
            },
        ]
    }
    fn stop_batch(text: &str) -> Vec<StreamEvent> {
        vec![
            StreamEvent::OutputDelta { text: text.into() },
            StreamEvent::Completed {
                response_id: "r2".into(),
                finish_reason: FinishReason::Stop,
            },
        ]
    }

    fn usage(input: u64, output: u64) -> StreamEvent {
        let unknown = || Measurement::Unknown {
            reason: "fixture".into(),
        };
        StreamEvent::Usage {
            accounting: Box::new(UsageAccounting {
                pricing_catalog_version: "fixture".into(),
                pricing_source: "fixture".into(),
                provider_request_id: Measurement::Known("request".into()),
                tokens: TokenUsage {
                    input: Measurement::Known(input),
                    output: Measurement::Known(output),
                    cache_read: unknown(),
                    cache_write: unknown(),
                    reasoning: unknown(),
                },
                estimated_cost: Measurement::Unknown {
                    reason: "fixture".into(),
                },
                provider_reported_cost: Measurement::Unknown {
                    reason: "fixture".into(),
                },
                quota_remaining: unknown(),
                quota_reset_at_ms: unknown(),
            }),
        }
    }
    fn build_runtime<'a>(
        storage: &'a mut Storage,
        session: Session,
        action: DecisionAction,
        mutating: bool,
        batches: Vec<Vec<StreamEvent>>,
        controls: Vec<Control>,
    ) -> AgentRuntime<'a, Provider, Tools, Gate, Controls, Children> {
        AgentRuntime::new(
            session,
            OperationId::from_stable("op-1"),
            storage,
            Provider {
                batches: batches.into_iter().map(Ok).collect(),
                requests: vec![],
            },
            Tools {
                calls: 0,
                mutating,
                question: false,
                fail: false,
            },
            Gate(action),
            Controls(controls.into()),
            Children,
            RuntimeBudget::default(),
            1,
        )
        .unwrap()
    }

    #[test]
    fn assembles_partial_arguments_claims_then_dispatches_end_to_end() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("s1"));
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Allow,
            false,
            vec![tool_batch(), stop_batch("done")],
            vec![],
        );
        assert_eq!(
            runtime.run(Some("inspect")).unwrap(),
            RunOutcome::Completed {
                text: "done".into()
            }
        );
        assert_eq!(runtime.tools.calls, 1);
        assert_eq!(runtime.provider.requests.len(), 2);
        assert!(
            runtime.provider.requests[1]
                .messages
                .iter()
                .any(|message| message.role == InputRole::Tool)
        );
    }

    #[test]
    fn permission_pause_happens_before_claim_and_resume_dispatches_once() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("s2"));
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Ask,
            false,
            vec![tool_batch(), stop_batch("done")],
            vec![],
        );
        let RunOutcome::Paused(Pause::Permission(call)) = runtime.run(Some("inspect")).unwrap()
        else {
            panic!("permission pause")
        };
        assert_eq!(runtime.tools.calls, 0);
        runtime.respond_permission(&call.id, true).unwrap();
        assert_eq!(
            runtime.run(None).unwrap(),
            RunOutcome::Completed {
                text: "done".into()
            }
        );
        assert_eq!(runtime.tools.calls, 1);
    }

    #[test]
    fn denied_permission_claims_and_terminalizes_the_call_before_resume() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("permission-denied"));
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Ask,
            false,
            vec![tool_batch(), stop_batch("continued")],
            vec![],
        );
        let RunOutcome::Paused(Pause::Permission(call)) = runtime.run(Some("inspect")).unwrap()
        else {
            panic!("permission pause expected")
        };
        runtime.respond_permission(&call.id, false).unwrap();
        assert!(matches!(
            runtime.respond_permission(&call.id, true),
            Err(RuntimeError::NoPendingPermission)
        ));
        assert_eq!(
            runtime.run(None).unwrap(),
            RunOutcome::Completed {
                text: "continued".into()
            }
        );
        assert_eq!(runtime.tools.calls, 0);
    }

    #[test]
    fn cancellation_terminalizes_partial_tool_call() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session_id = SessionId::from_stable("s3");
        let session = Session::conversation(session_id.clone());
        let partial = vec![
            StreamEvent::ToolCallStarted {
                id: "call-1".into(),
                name: "edit".into(),
            },
            StreamEvent::ToolArgumentsDelta {
                id: "call-1".into(),
                json_fragment: "{".into(),
            },
        ];
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Allow,
            false,
            vec![partial],
            vec![Control::Continue, Control::Cancel("stop".into())],
        );
        assert_eq!(
            runtime.run(Some("inspect")).unwrap(),
            RunOutcome::Cancelled {
                reason: "stop".into()
            }
        );
        let replay = runtime.storage.replay(&session_id, None, None).unwrap();
        assert!(replay.events.iter().any(|event| matches!(&event.event, Event::MessageAppended { message } if matches!(message.parts[0].body, MessagePartBody::ToolResult { is_error: true, .. }))));
        assert!(
            replay
                .events
                .iter()
                .any(|event| matches!(event.event, Event::Cancelled { .. }))
        );
    }

    #[test]
    fn permission_checkpoint_reconstructs_without_replaying_committed_calls() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("checkpoint-permission"));
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Ask,
            false,
            vec![tool_batch()],
            vec![],
        );
        let RunOutcome::Paused(Pause::Permission(call)) = runtime.run(Some("inspect")).unwrap()
        else {
            panic!("permission pause expected")
        };
        let checkpoint = runtime.checkpoint(ResumeBinding {
            workspace_revision: "revision-a".into(),
            tool_schema_sha256: "tools-a".into(),
            provider_metadata: json!({"provider":"fixture"}),
        });
        drop(runtime);

        let mut resumed = AgentRuntime::from_checkpoint(
            checkpoint,
            &mut storage,
            Provider {
                batches: VecDeque::from([Ok(stop_batch("done"))]),
                requests: vec![],
            },
            Tools {
                calls: 0,
                mutating: false,
                question: false,
                fail: false,
            },
            Gate(DecisionAction::Ask),
            Controls(VecDeque::new()),
            Children,
        )
        .unwrap();
        resumed.respond_permission(&call.id, true).unwrap();
        assert_eq!(
            resumed.run(None).unwrap(),
            RunOutcome::Completed {
                text: "done".into()
            }
        );
        assert_eq!(resumed.tools.calls, 1);
    }

    #[test]
    fn checkpoint_restore_rejects_budget_and_pending_state_forgery() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("hostile-checkpoint"));
        let runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Allow,
            false,
            vec![],
            vec![],
        );
        let checkpoint = runtime.checkpoint(ResumeBinding {
            workspace_revision: "revision-a".into(),
            tool_schema_sha256: "tools-a".into(),
            provider_metadata: json!({"provider":"fixture"}),
        });
        drop(runtime);

        let mut over_budget = checkpoint.clone();
        over_budget.turns = over_budget.budget.max_turns.saturating_add(1);
        assert!(matches!(
            AgentRuntime::from_checkpoint(
                over_budget,
                &mut storage,
                Provider {
                    batches: VecDeque::new(),
                    requests: vec![]
                },
                Tools {
                    calls: 0,
                    mutating: false,
                    question: false,
                    fail: false
                },
                Gate(DecisionAction::Allow),
                Controls(VecDeque::new()),
                Children,
            ),
            Err(RuntimeError::InvalidCheckpoint(_))
        ));

        let mut conflicting = checkpoint;
        let call = ToolCall {
            id: ToolCallId::from_stable("pending"),
            name: "edit".into(),
            arguments: json!({}),
            permission: PermissionKind::FilesystemRead,
            mutating: false,
        };
        conflicting.pending_permission = Some(call.clone());
        conflicting.pending_authority = Some(call);
        assert!(matches!(
            AgentRuntime::from_checkpoint(
                conflicting,
                &mut storage,
                Provider {
                    batches: VecDeque::new(),
                    requests: vec![]
                },
                Tools {
                    calls: 0,
                    mutating: false,
                    question: false,
                    fail: false
                },
                Gate(DecisionAction::Allow),
                Controls(VecDeque::new()),
                Children,
            ),
            Err(RuntimeError::InvalidCheckpoint(_))
        ));
    }

    #[test]
    fn question_checkpoint_accepts_one_answer_and_finishes_claimed_call() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("checkpoint-question"));
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Allow,
            false,
            vec![tool_batch()],
            vec![],
        );
        runtime.tools.question = true;
        let RunOutcome::Paused(Pause::Question { call_id, .. }) = runtime.run(Some("ask")).unwrap()
        else {
            panic!("question pause expected")
        };
        let checkpoint = runtime.checkpoint(ResumeBinding {
            workspace_revision: "revision-a".into(),
            tool_schema_sha256: "tools-a".into(),
            provider_metadata: json!({"provider":"fixture"}),
        });
        drop(runtime);
        let mut resumed = AgentRuntime::from_checkpoint(
            checkpoint,
            &mut storage,
            Provider {
                batches: VecDeque::from([Ok(stop_batch("answered"))]),
                requests: vec![],
            },
            Tools {
                calls: 0,
                mutating: false,
                question: true,
                fail: false,
            },
            Gate(DecisionAction::Allow),
            Controls(VecDeque::new()),
            Children,
        )
        .unwrap();
        resumed.answer_question(&call_id, "yes").unwrap();
        assert!(matches!(
            resumed.answer_question(&call_id, "twice"),
            Err(RuntimeError::NoPendingQuestion)
        ));
        assert_eq!(
            resumed.run(None).unwrap(),
            RunOutcome::Completed {
                text: "answered".into()
            }
        );
    }

    #[test]
    fn mid_stream_steer_terminalizes_started_tool_and_starts_fresh_provider_turn() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session_id = SessionId::from_stable("steer-stream");
        let session = Session::conversation(session_id.clone());
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Allow,
            false,
            vec![tool_batch(), stop_batch("redirected")],
            vec![
                Control::Continue,
                Control::Continue,
                Control::Continue,
                Control::Steer("use the safer approach".into()),
            ],
        );
        assert_eq!(
            runtime.run(Some("initial")).unwrap(),
            RunOutcome::Completed {
                text: "redirected".into()
            }
        );
        assert_eq!(runtime.tools.calls, 0);
        assert_eq!(runtime.provider.requests.len(), 2);
        assert!(runtime.provider.requests[1].messages.iter().any(|message| {
            message.role == InputRole::Assistant
                && message.parts.iter().any(|part| {
                    matches!(
                        part,
                        InputPart::ToolCall { id, arguments, .. }
                            if id == "call-1" && arguments == &json!({"path":"a.rs"})
                    )
                })
        }));
        assert!(runtime.provider.requests[1].messages.iter().any(|message| {
            message.role == InputRole::Tool
                && message.parts.iter().any(|part| {
                    matches!(
                        part,
                        InputPart::ToolResult { id, is_error: true, .. } if id == "call-1"
                    )
                })
        }));
        assert!(runtime.provider.requests[1].messages.iter().any(|message| {
            message.parts.iter().any(
                |part| matches!(part, InputPart::Text { text } if text == "use the safer approach"),
            )
        }));
        let replay = runtime.storage.replay(&session_id, None, None).unwrap();
        assert!(replay.events.iter().any(|event| matches!(
            &event.event,
            Event::MessageAppended { message }
                if message.parts.iter().any(|part| matches!(
                    part.body,
                    MessagePartBody::ToolResult { is_error: true, .. }
                ))
        )));
    }

    #[test]
    fn provider_stream_is_bounded_before_untrusted_output_can_accumulate() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("bounded-stream"));
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Allow,
            false,
            vec![vec![StreamEvent::OutputDelta {
                text: "x".repeat(70 * 1024),
            }]],
            vec![],
        );
        runtime.budget.max_output_tokens = Some(1);
        let error = runtime.run(Some("test bound")).unwrap_err();
        assert!(error.to_string().contains("bounded assembler"));
        assert!(
            !runtime
                .storage
                .replay(&SessionId::from_stable("bounded-stream"), None, None)
                .unwrap()
                .events
                .iter()
                .any(|event| matches!(event.event, Event::MessageAppended { .. }))
        );
    }

    #[test]
    fn mutating_tool_requires_draft_confirmation_and_never_converts_conversation() {
        let mut storage = Storage::open_in_memory().unwrap();
        let conversation = Session::conversation(SessionId::from_stable("conversation"));
        let mut runtime = build_runtime(
            &mut storage,
            conversation,
            DecisionAction::Allow,
            true,
            vec![tool_batch()],
            vec![],
        );
        assert!(matches!(
            runtime.run(Some("change it")).unwrap(),
            RunOutcome::Paused(Pause::DraftChangeRequired { .. })
        ));
        assert_eq!(runtime.session.kind, SessionKind::Conversation);
        assert_eq!(
            runtime.confirm_change().unwrap_err().to_string(),
            RuntimeError::NotDraft.to_string()
        );

        let mut storage = Storage::open_in_memory().unwrap();
        let draft = Session::draft_change(SessionId::from_stable("draft"));
        let mut runtime = build_runtime(
            &mut storage,
            draft,
            DecisionAction::Allow,
            true,
            vec![tool_batch(), stop_batch("built")],
            vec![],
        );
        assert!(matches!(
            runtime.run(Some("change it")).unwrap(),
            RunOutcome::Paused(Pause::DraftChangeRequired { .. })
        ));
        runtime.confirm_change().unwrap();
        assert_eq!(
            runtime.run(None).unwrap(),
            RunOutcome::Completed {
                text: "built".into()
            }
        );
        assert_eq!(runtime.tools.calls, 1);
    }

    #[test]
    fn compaction_retains_provider_replay_metadata() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = Session::conversation(SessionId::from_stable("s4"));
        let mut runtime = build_runtime(
            &mut storage,
            session,
            DecisionAction::Allow,
            false,
            vec![stop_batch("done")],
            vec![],
        );
        runtime.budget.max_context_messages = 2;
        runtime.budget.keep_recent_messages = 1;
        runtime.messages = (0..4)
            .map(|n| InputMessage {
                role: InputRole::User,
                parts: vec![InputPart::Text {
                    text: format!("m{n}"),
                }],
            })
            .collect();
        runtime.replay.push(ReplayMetadata::OpenAi {
            response_id: "response".into(),
            reasoning_item_ids: vec!["reason".into()],
        });
        runtime.replay.push(ReplayMetadata::Anthropic {
            reasoning_signature: "signed-reasoning-fixture".into(),
        });
        runtime.run(None).unwrap();
        assert_eq!(runtime.provider.requests[0].replay.len(), 2);
        assert!(
            matches!(&runtime.provider.requests[0].messages[0].parts[0], InputPart::Text { text } if text.contains("compacted"))
        );
        let checkpoint = runtime.checkpoint(ResumeBinding {
            workspace_revision: "revision".into(),
            tool_schema_sha256: "schema".into(),
            provider_metadata: json!({"provider":"fixture"}),
        });
        let restored: RuntimeCheckpoint =
            serde_json::from_slice(&serde_json::to_vec(&checkpoint).unwrap()).unwrap();
        assert!(restored.replay.iter().any(|metadata| matches!(
            metadata,
            ReplayMetadata::Anthropic { reasoning_signature }
                if reasoning_signature == "signed-reasoning-fixture"
        )));
    }

    #[test]
    fn provider_retry_recovers_within_budget() {
        let mut storage = Storage::open_in_memory().unwrap();
        let provider = Provider {
            batches: VecDeque::from([Err("temporary".into()), Ok(stop_batch("ok"))]),
            requests: vec![],
        };
        let mut runtime = AgentRuntime::new(
            Session::conversation(SessionId::from_stable("retry")),
            OperationId::from_stable("retry-op"),
            &mut storage,
            provider,
            Tools {
                calls: 0,
                mutating: false,
                question: false,
                fail: false,
            },
            Gate(DecisionAction::Allow),
            Controls(VecDeque::new()),
            Children,
            RuntimeBudget::default(),
            1,
        )
        .unwrap();
        assert_eq!(
            runtime.run(Some("hello")).unwrap(),
            RunOutcome::Completed { text: "ok".into() }
        );
        assert_eq!(runtime.provider.requests.len(), 2);
    }

    #[test]
    fn duplicate_provider_tool_call_id_is_rejected_without_panicking() {
        let duplicate = vec![
            StreamEvent::ToolCallStarted {
                id: "duplicate".into(),
                name: "inspect".into(),
            },
            StreamEvent::ToolCallStarted {
                id: "duplicate".into(),
                name: "replace".into(),
            },
            StreamEvent::Completed {
                response_id: "malformed".into(),
                finish_reason: FinishReason::ToolCalls,
            },
        ];
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(SessionId::from_stable("duplicate-tool-call")),
            DecisionAction::Allow,
            false,
            vec![duplicate],
            vec![],
        );

        assert!(matches!(
            runtime.run(Some("inspect")),
            Err(RuntimeError::Provider(message))
                if message == "duplicate tool call id: duplicate"
        ));
        let replay = runtime
            .storage
            .replay(&SessionId::from_stable("duplicate-tool-call"), None, None)
            .unwrap();
        assert!(replay.events.iter().any(|event| matches!(
            &event.event,
            Event::MessageAppended { message }
                if message.parts.iter().any(|part| matches!(
                    part.body,
                    MessagePartBody::ToolResult { is_error: true, .. }
                ))
        )));
    }

    #[test]
    fn malformed_completed_tool_arguments_receive_a_terminal_error() {
        let malformed = vec![
            StreamEvent::ToolCallStarted {
                id: "malformed-call".into(),
                name: "edit".into(),
            },
            StreamEvent::ToolArgumentsDelta {
                id: "malformed-call".into(),
                json_fragment: "{".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: "malformed-call".into(),
                arguments: json!({"valid":"but mismatched"}),
            },
            StreamEvent::Completed {
                response_id: "malformed".into(),
                finish_reason: FinishReason::ToolCalls,
            },
        ];
        let session_id = SessionId::from_stable("malformed-arguments");
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(session_id.clone()),
            DecisionAction::Allow,
            false,
            vec![malformed],
            vec![],
        );

        assert!(matches!(
            runtime.run(Some("inspect")),
            Err(RuntimeError::PartialArguments(id)) if id == "malformed-call"
        ));
        let replay = runtime.storage.replay(&session_id, None, None).unwrap();
        assert!(replay.events.iter().any(|event| matches!(
            &event.event,
            Event::MessageAppended { message }
                if message.parts.iter().any(|part| matches!(
                    part.body,
                    MessagePartBody::ToolResult { is_error: true, .. }
                ))
        )));
    }

    #[test]
    fn in_stream_provider_error_terminalizes_started_tool_calls() {
        let session_id = SessionId::from_stable("provider-error-tool");
        let batch = vec![
            StreamEvent::ToolCallStarted {
                id: "started-call".into(),
                name: "edit".into(),
            },
            StreamEvent::Error {
                error: ProviderError {
                    provider: ProviderKind::OpenAi,
                    category: ErrorCategory::Server,
                    code: Some("overloaded".into()),
                    message: "provider failed".into(),
                    retryable: true,
                    provider_request_id: Some("request".into()),
                    http_status: Some(500),
                    retry_after_ms: None,
                },
            },
        ];
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(session_id.clone()),
            DecisionAction::Allow,
            false,
            vec![batch],
            vec![],
        );

        assert!(matches!(
            runtime.run(Some("inspect")),
            Err(RuntimeError::Provider(_))
        ));
        let replay = runtime.storage.replay(&session_id, None, None).unwrap();
        assert!(replay.events.iter().any(|event| matches!(
            &event.event,
            Event::MessageAppended { message }
                if message.parts.iter().any(|part| matches!(
                    part.body,
                    MessagePartBody::ToolResult { is_error: true, .. }
                ))
        )));
    }

    #[test]
    fn aggregate_token_budget_is_enforced_and_sent_to_provider() {
        let mut storage = Storage::open_in_memory().unwrap();
        let mut batch = vec![usage(3, 3)];
        batch.extend(stop_batch("too expensive"));
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(SessionId::from_stable("tokens")),
            DecisionAction::Allow,
            false,
            vec![batch],
            vec![],
        );
        runtime.budget.max_output_tokens = Some(5);
        runtime.budget.max_total_tokens = Some(5);
        assert!(matches!(
            runtime.run(Some("bounded")),
            Err(RuntimeError::TokenBudget)
        ));
        assert_eq!(runtime.provider.requests[0].max_output_tokens, Some(5));
    }

    #[test]
    fn parallel_provider_child_calls_are_bounded_into_scheduler_waves() {
        let child_batch = vec![
            StreamEvent::ToolCallStarted {
                id: "child-a".into(),
                name: "spawn_subagent".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: "child-a".into(),
                arguments: json!({"task":"a"}),
            },
            StreamEvent::ToolCallStarted {
                id: "child-b".into(),
                name: "spawn_subagent".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: "child-b".into(),
                arguments: json!({"task":"b"}),
            },
            StreamEvent::ToolCallStarted {
                id: "child-c".into(),
                name: "spawn_subagent".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: "child-c".into(),
                arguments: json!({"task":"c"}),
            },
            StreamEvent::ToolCallStarted {
                id: "child-d".into(),
                name: "spawn_subagent".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: "child-d".into(),
                arguments: json!({"task":"d"}),
            },
            StreamEvent::Completed {
                response_id: "children".into(),
                finish_reason: FinishReason::ToolCalls,
            },
        ];
        let batches = Arc::new(AtomicUsize::new(0));
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = AgentRuntime::new(
            Session::conversation(SessionId::from_stable("batch-parent")),
            OperationId::from_stable("batch-op"),
            &mut storage,
            Provider {
                batches: VecDeque::from([Ok(child_batch), Ok(stop_batch("done"))]),
                requests: vec![],
            },
            BatchTools,
            Gate(DecisionAction::Allow),
            Controls(VecDeque::new()),
            BatchChildren(Arc::clone(&batches)),
            RuntimeBudget::default(),
            1,
        )
        .unwrap();
        assert_eq!(
            runtime.run(Some("delegate")).unwrap(),
            RunOutcome::Completed {
                text: "done".into()
            }
        );
        assert_eq!(batches.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn duplicate_child_identity_terminalizes_every_claimed_parallel_call() {
        let child_batch = vec![
            StreamEvent::ToolCallStarted {
                id: "child-a".into(),
                name: "spawn_subagent".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: "child-a".into(),
                arguments: json!({"task":"a"}),
            },
            StreamEvent::ToolCallStarted {
                id: "child-b".into(),
                name: "spawn_subagent".into(),
            },
            StreamEvent::ToolCallCompleted {
                id: "child-b".into(),
                arguments: json!({"task":"b"}),
            },
            StreamEvent::Completed {
                response_id: "children".into(),
                finish_reason: FinishReason::ToolCalls,
            },
        ];
        let batches = Arc::new(AtomicUsize::new(0));
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = AgentRuntime::new(
            Session::conversation(SessionId::from_stable("duplicate-child-parent")),
            OperationId::from_stable("duplicate-child-op"),
            &mut storage,
            Provider {
                batches: VecDeque::from([Ok(child_batch), Ok(stop_batch("done"))]),
                requests: vec![],
            },
            DuplicateChildTools,
            Gate(DecisionAction::Allow),
            Controls(VecDeque::new()),
            BatchChildren(Arc::clone(&batches)),
            RuntimeBudget::default(),
            1,
        )
        .unwrap();

        assert_eq!(
            runtime.run(Some("delegate")).unwrap(),
            RunOutcome::Completed {
                text: "done".into()
            }
        );
        assert_eq!(batches.load(Ordering::SeqCst), 1);
        assert_eq!(runtime.repairs, 1);
    }

    #[test]
    fn semantic_non_progress_hands_off_to_doom_loop_permission() {
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(SessionId::from_stable("doom")),
            DecisionAction::Allow,
            false,
            vec![tool_batch_id("call-a"), tool_batch_id("call-b")],
            vec![],
        );
        runtime.budget.non_progress_limit = 1;
        assert_eq!(
            runtime.run(Some("loop")).unwrap(),
            RunOutcome::Paused(Pause::DoomLoop {
                handoff: TransitionEffect::DoomLoopPermissionRequired
            })
        );
        assert_eq!(runtime.tools.calls, 2);
    }

    #[test]
    fn doom_loop_pause_survives_restart_and_requires_explicit_response() {
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(SessionId::from_stable("doom-restart")),
            DecisionAction::Allow,
            false,
            vec![tool_batch_id("call-a"), tool_batch_id("call-b")],
            vec![],
        );
        runtime.budget.non_progress_limit = 1;
        assert!(matches!(
            runtime.run(Some("loop")).unwrap(),
            RunOutcome::Paused(Pause::DoomLoop { .. })
        ));
        let checkpoint = runtime.checkpoint(ResumeBinding {
            workspace_revision: "revision-a".into(),
            tool_schema_sha256: "policy-bound-tools-a".into(),
            provider_metadata: json!({"provider":"fixture"}),
        });
        drop(runtime);

        let mut resumed = AgentRuntime::from_checkpoint(
            checkpoint,
            &mut storage,
            Provider {
                batches: VecDeque::from([Ok(stop_batch("continued"))]),
                requests: vec![],
            },
            Tools {
                calls: 0,
                mutating: false,
                question: false,
                fail: false,
            },
            Gate(DecisionAction::Allow),
            Controls(VecDeque::new()),
            Children,
        )
        .unwrap();
        assert!(matches!(
            resumed.run(None).unwrap(),
            RunOutcome::Paused(Pause::DoomLoop { .. })
        ));
        assert_eq!(resumed.tools.calls, 0, "restart must not replay tools");
        resumed.respond_doom_loop(true).unwrap();
        assert_eq!(
            resumed.run(None).unwrap(),
            RunOutcome::Completed {
                text: "continued".into()
            }
        );
        assert_eq!(resumed.tools.calls, 0);
    }

    #[test]
    fn question_pauses_until_answer_is_terminally_recorded() {
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(SessionId::from_stable("question")),
            DecisionAction::Allow,
            false,
            vec![tool_batch(), stop_batch("thanks")],
            vec![],
        );
        runtime.tools.question = true;
        let RunOutcome::Paused(Pause::Question { call_id, .. }) = runtime.run(Some("ask")).unwrap()
        else {
            panic!("question pause")
        };
        runtime.answer_question(&call_id, "yes").unwrap();
        assert_eq!(
            runtime.run(None).unwrap(),
            RunOutcome::Completed {
                text: "thanks".into()
            }
        );
    }

    #[test]
    fn repair_budget_pauses_without_replaying_claimed_tool() {
        let mut storage = Storage::open_in_memory().unwrap();
        let mut runtime = build_runtime(
            &mut storage,
            Session::conversation(SessionId::from_stable("repair")),
            DecisionAction::Allow,
            false,
            vec![tool_batch()],
            vec![],
        );
        runtime.tools.fail = true;
        runtime.budget.max_repair_attempts = 1;
        assert_eq!(
            runtime.run(Some("repair")).unwrap(),
            RunOutcome::Paused(Pause::RepairBudgetExhausted)
        );
        assert_eq!(runtime.tools.calls, 1);
    }

    #[test]
    fn project_disposal_propagates_to_all_runtime_owned_resources() {
        let directory = tempdir().unwrap();
        let mut instance = ProjectInstance::new(directory.path().to_path_buf());
        let mut scope = ProjectRuntimeScope::attach(&mut instance, "model-op").unwrap();
        let job = scope.register_job(&mut instance, "test-job").unwrap();
        let lsp = scope.register_lsp(&mut instance, "rust-analyzer").unwrap();
        let mcp = scope.register_mcp(&mut instance, "repository-mcp").unwrap();
        assert_eq!(scope.resources().len(), 4);
        assert!(!scope.is_cancelled());
        assert!(instance.dispose().is_empty());
        assert!(scope.is_cancelled());
        for resource in [job, lsp, mcp] {
            assert_eq!(
                resource.state(),
                changeloop_project::ResourceState::Shutdown
            );
            assert!(resource.cancellation_token().is_cancelled());
        }
    }
}
