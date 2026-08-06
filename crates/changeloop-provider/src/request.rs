//! The canonical per-provider request builders.
//!
//! This module is the *only* place in the workspace that decides whether a
//! reasoning part appears in a provider request, where it appears, and what
//! bytes it carries. It lives in `changeloop-provider` rather than in the
//! adapter crate so that the raw reasoning payload can stay private to
//! [`crate::reasoning`]: the boundary is Rust visibility, not a convention that
//! a future contributor can quietly step over.
//!
//! Adapters own transport, headers, and response parsing. They call in here for
//! the body and cannot assemble one themselves.

use serde_json::{Value, json};
use thiserror::Error;

use crate::reasoning::{
    ReasoningDisposition, ReasoningIdentity, ReasoningIdentityOutcome, ReasoningPart,
};
use crate::{InputMessage, InputPart, InputRole, NormalizedRequest};

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum RequestBuildError {
    #[error("reasoning replay must belong to assistant history")]
    ReasoningOutsideAssistantHistory,
    #[error("image artifact {artifact_id} requires an explicit artifact resolver")]
    UnresolvedImageArtifact { artifact_id: String },
}

/// The reasoning-identity gate.
///
/// Run before building a request for any target — a new model, a new provider,
/// or a new account/deployment of the same provider. Reasoning state tagged
/// with an incompatible identity is stripped **explicitly and wholesale**
/// rather than silently forwarded to a party that cannot decrypt or verify it.
///
/// This gate is independent of execution progress: reasoning parts appear on
/// essentially every tool-using turn, so waiting for a mutation boundary would
/// let incompatible state through on the common path.
pub fn enforce_reasoning_identity(
    messages: &mut [InputMessage],
    target: &ReasoningIdentity,
) -> ReasoningIdentityOutcome {
    let mut outcome = ReasoningIdentityOutcome::default();
    for message in messages.iter_mut() {
        let stripped = message.strip_incompatible_reasoning(target);
        if stripped > 0 {
            outcome.stripped_parts += stripped;
            outcome.stripped_messages += 1;
        }
    }
    outcome
}

/// Applies the identity gate to the session-level replay list, keeping only
/// state the target can actually use.
fn compatible_replay<'a>(
    request: &'a NormalizedRequest,
    target: &ReasoningIdentity,
) -> Option<&'a crate::reasoning::OpaqueReasoning> {
    request
        .replay
        .iter()
        .rev()
        .find(|reasoning| reasoning.disposition_for(target) == ReasoningDisposition::KeepWhole)
}

/// Renders one reasoning part into Anthropic's thinking block, or nothing.
///
/// The only two outcomes are the complete block and no block at all.
fn anthropic_reasoning_block(part: &ReasoningPart, target: &ReasoningIdentity) -> Option<Value> {
    match part.disposition_for(target) {
        ReasoningDisposition::StripWholesale => None,
        ReasoningDisposition::KeepWhole => {
            let signature = part.replay()?.anthropic_signature()?;
            Some(json!({"type":"thinking","thinking":part.text(),"signature":signature}))
        }
    }
}

pub fn anthropic_request_body(
    request: &NormalizedRequest,
    target: &ReasoningIdentity,
    stream: bool,
) -> Result<Value, RequestBuildError> {
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for message in &request.messages {
        let mut content = Vec::new();
        for part in message.parts() {
            match part {
                InputPart::Text { text } => content.push(json!({"type":"text","text":text})),
                InputPart::Reasoning(reasoning) => {
                    if message.role != InputRole::Assistant {
                        return Err(RequestBuildError::ReasoningOutsideAssistantHistory);
                    }
                    if let Some(block) = anthropic_reasoning_block(reasoning, target) {
                        content.push(block);
                    }
                }
                InputPart::ToolCall {
                    id,
                    name,
                    arguments,
                } => content.push(json!({"type":"tool_use","id":id,"name":name,"input":arguments})),
                InputPart::ToolResult {
                    id,
                    output,
                    is_error,
                } => content.push(json!({
                    "type":"tool_result","tool_use_id":id,
                    "content":output.to_string(),"is_error":is_error
                })),
                InputPart::Image {
                    media_type,
                    artifact_id,
                    data_base64,
                } => {
                    let data = data_base64.as_ref().ok_or_else(|| {
                        RequestBuildError::UnresolvedImageArtifact {
                            artifact_id: artifact_id.clone(),
                        }
                    })?;
                    content.push(json!({"type":"image","source":{
                        "type":"base64","media_type":media_type,"data":data
                    }}));
                }
            }
        }
        match message.role {
            InputRole::System | InputRole::Developer => system.extend(content),
            InputRole::User | InputRole::Tool => {
                messages.push(json!({"role":"user","content":content}));
            }
            InputRole::Assistant => messages.push(json!({"role":"assistant","content":content})),
        }
    }
    let tools: Vec<_> = request
        .tools
        .iter()
        .map(|tool| {
            json!({"name":tool.name,
        "description":tool.description,"input_schema":tool.input_schema})
        })
        .collect();
    Ok(
        json!({"model":request.model,"max_tokens":request.max_output_tokens.unwrap_or(4096),
        "system":system,"messages":messages,"tools":tools,"stream":stream}),
    )
}

pub fn openai_request_body(
    request: &NormalizedRequest,
    target: &ReasoningIdentity,
    stream: bool,
) -> Result<Value, RequestBuildError> {
    let mut input = Vec::new();
    for message in &request.messages {
        let role = match message.role {
            InputRole::System => "system",
            InputRole::Developer => "developer",
            InputRole::User | InputRole::Tool => "user",
            InputRole::Assistant => "assistant",
        };
        for part in message.parts() {
            match part {
                InputPart::Text { text } => input.push(json!({"role":role,"content":[{
                    "type": if role == "assistant" { "output_text" } else { "input_text" },"text":text}]})),
                // OpenAI resumes reasoning through the response/item identifiers
                // below. Hidden reasoning is never turned into visible text, and
                // it is never partially reconstructed.
                InputPart::Reasoning(reasoning) => {
                    if message.role != InputRole::Assistant {
                        return Err(RequestBuildError::ReasoningOutsideAssistantHistory);
                    }
                    let _ = reasoning;
                }
                InputPart::ToolCall { id, name, arguments } => input.push(json!({
                    "type":"function_call","call_id":id,"name":name,"arguments":arguments.to_string()})),
                InputPart::ToolResult { id, output, .. } => input.push(json!({
                    "type":"function_call_output","call_id":id,"output":output.to_string()})),
                InputPart::Image { media_type, artifact_id, data_base64 } => {
                    let data = data_base64.as_ref().ok_or_else(|| {
                        RequestBuildError::UnresolvedImageArtifact { artifact_id: artifact_id.clone() }
                    })?;
                    input.push(json!({"role":role,"content":[{
                        "type":"input_image",
                        "image_url":format!("data:{media_type};base64,{data}")
                    }]}));
                }
            }
        }
    }
    let tools: Vec<_> = request
        .tools
        .iter()
        .map(|tool| {
            json!({"type":"function","name":tool.name,
        "description":tool.description,"parameters":tool.input_schema,"strict":true})
        })
        .collect();
    let mut body =
        json!({"model":request.model,"input":input,"tools":tools,"stream":stream,"store":false});
    if let Some(limit) = request.max_output_tokens {
        body["max_output_tokens"] = json!(limit);
    }
    if let Some(response_id) = compatible_replay(request, target).and_then(|reasoning| {
        // The gate already proved compatibility; a non-OpenAI payload cannot
        // reach here because identity carries the provider.
        reasoning.openai_response_id()
    }) {
        body["previous_response_id"] = json!(response_id);
    }
    Ok(body)
}
