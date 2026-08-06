//! Hand-written serde types for the ACP surface this facade implements.
//!
//! These are written by hand rather than pulled from the upstream `agent-client-protocol`
//! crate on purpose. The facade implements a deliberately narrow slice of ACP
//! and must tolerate fields it does not model; a generated whole-schema binding
//! would couple every `cargo update` of an external crate to the workspace's
//! wire compatibility, and would add a dependency the workspace does not
//! otherwise carry. The cost is that fields outside this slice are opaque —
//! which is exactly the contract stated below, not an accident.
//!
//! Two tolerance rules run through every type here:
//!
//! - **No `deny_unknown_fields`.** A newer client may add fields; they must not
//!   destroy the request. Request types additionally capture unknown top-level
//!   fields into `extra` so they round-trip verbatim.
//! - **Tagged unions keep unknown tags.** [`ContentBlock`] and [`SessionUpdate`]
//!   retain an unrecognized `type`/`sessionUpdate` discriminator together with
//!   its whole body, mirroring `changeloop_protocol::MessagePartBody`. `#[serde(other)]`
//!   is deliberately not used: it matches only a unit variant and would discard
//!   both tag and payload.
//!
//! What is emphatically *not* here is a cross-version conversion layer. ACP's
//! own maintainers shipped a general v1/v2 converter and then deleted it,
//! because the state a lossless translation needs is session-scoped and a
//! schema-level function cannot hold it. One version is negotiated per
//! connection and only that version is spoken.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Unknown top-level members of a request, preserved so they round-trip.
pub type Extra = BTreeMap<String, Value>;

fn is_empty(extra: &Extra) -> bool {
    extra.is_empty()
}

// ---------------------------------------------------------------- initialize

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeRequest {
    pub protocol_version: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_capabilities: Option<ClientCapabilities>,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    #[serde(flatten, default, skip_serializing_if = "is_empty")]
    pub extra: Extra,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fs: Option<FileSystemCapabilities>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<bool>,
    #[serde(flatten, default, skip_serializing_if = "is_empty")]
    pub extra: Extra,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemCapabilities {
    #[serde(default)]
    pub read_text_file: bool,
    #[serde(default)]
    pub write_text_file: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    pub protocol_version: u16,
    pub agent_capabilities: AgentCapabilities,
    pub auth_methods: Vec<AuthMethod>,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub load_session: bool,
    pub prompt_capabilities: PromptCapabilities,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCapabilities {
    pub image: bool,
    pub audio: bool,
    pub embedded_context: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethod {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ------------------------------------------------------------------ sessions

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionRequest {
    pub cwd: String,
    #[serde(default)]
    pub mcp_servers: Vec<Value>,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    #[serde(flatten, default, skip_serializing_if = "is_empty")]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionResponse {
    pub session_id: String,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSessionRequest {
    pub session_id: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub mcp_servers: Vec<Value>,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    #[serde(flatten, default, skip_serializing_if = "is_empty")]
    pub extra: Extra,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSessionResponse {
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub session_id: String,
    #[serde(default)]
    pub prompt: Vec<ContentBlock>,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    #[serde(flatten, default, skip_serializing_if = "is_empty")]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResponse {
    pub stop_reason: StopReason,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

/// Why a prompt turn ended. Every turn resolves at the protocol level, whether
/// the work stopped because it finished or because it was cancelled.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelNotification {
    pub session_id: String,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    #[serde(flatten, default, skip_serializing_if = "is_empty")]
    pub extra: Extra,
}

/// Params of `$/cancel_request`, which names one in-flight request rather than
/// a whole session. Cancelling it cascades to every request descended from it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CancelRequestNotification {
    pub id: crate::jsonrpc::RequestId,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNotification {
    pub session_id: String,
    pub update: SessionUpdate,
    /// Correlation identifiers live here. ACP needed an explicit `messageId`
    /// RFD precisely because clients could not infer message boundaries from a
    /// change of update type — two consecutive same-type messages coalesce.
    /// This facade therefore always names the message and part a chunk came
    /// from instead of leaving the boundary to be guessed.
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

// ----------------------------------------------------------------- reporting

/// The subset of ACP session updates this facade emits.
///
/// An unrecognized `sessionUpdate` tag is retained whole rather than dropped,
/// so a payload minted by a newer peer survives a decode/encode round trip.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum SessionUpdate {
    UserMessageChunk { content: ContentBlock },
    AgentMessageChunk { content: ContentBlock },
    AgentThoughtChunk { content: ContentBlock },
    ToolCall(ToolCall),
    ToolCallUpdate(ToolCallUpdate),
    Unknown { tag: String, body: Value },
}

impl SessionUpdate {
    #[must_use]
    pub fn tag(&self) -> &str {
        match self {
            Self::UserMessageChunk { .. } => "user_message_chunk",
            Self::AgentMessageChunk { .. } => "agent_message_chunk",
            Self::AgentThoughtChunk { .. } => "agent_thought_chunk",
            Self::ToolCall(_) => "tool_call",
            Self::ToolCallUpdate(_) => "tool_call_update",
            Self::Unknown { tag, .. } => tag.as_str(),
        }
    }
}

impl Serialize for SessionUpdate {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut object = match self {
            Self::UserMessageChunk { content }
            | Self::AgentMessageChunk { content }
            | Self::AgentThoughtChunk { content } => {
                serde_json::json!({ "content": content })
            }
            Self::ToolCall(call) => {
                serde_json::to_value(call).map_err(serde::ser::Error::custom)?
            }
            Self::ToolCallUpdate(update) => {
                serde_json::to_value(update).map_err(serde::ser::Error::custom)?
            }
            Self::Unknown { body, .. } => body.clone(),
        };
        let map = object.as_object_mut().ok_or_else(|| {
            serde::ser::Error::custom("a session update must serialize to an object")
        })?;
        map.insert("sessionUpdate".into(), Value::String(self.tag().to_owned()));
        object.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for SessionUpdate {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let body = Value::deserialize(deserializer)?;
        let tag = body
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("a session update requires `sessionUpdate`"))?
            .to_owned();
        let content = || {
            body.get("content")
                .cloned()
                .ok_or_else(|| serde::de::Error::custom("a message chunk requires `content`"))
                .and_then(|value| {
                    serde_json::from_value::<ContentBlock>(value).map_err(serde::de::Error::custom)
                })
        };
        Ok(match tag.as_str() {
            "user_message_chunk" => Self::UserMessageChunk {
                content: content()?,
            },
            "agent_message_chunk" => Self::AgentMessageChunk {
                content: content()?,
            },
            "agent_thought_chunk" => Self::AgentThoughtChunk {
                content: content()?,
            },
            "tool_call" => {
                Self::ToolCall(serde_json::from_value(body).map_err(serde::de::Error::custom)?)
            }
            "tool_call_update" => Self::ToolCallUpdate(
                serde_json::from_value(body).map_err(serde::de::Error::custom)?,
            ),
            _ => Self::Unknown { tag, body },
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub tool_call_id: String,
    pub title: String,
    pub kind: ToolKind,
    pub status: ToolCallStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<ToolCallContent>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locations: Vec<ToolCallLocation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<Value>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdate {
    pub tool_call_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ToolCallStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ToolCallContent>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<Value>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    SwitchMode,
    #[default]
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallLocation {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolCallContent {
    Content { content: ContentBlock },
    Diff(ToolCallDiff),
    Terminal { terminal_id: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallDiff {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_text: Option<String>,
    pub new_text: String,
}

// ------------------------------------------------------------------- content

/// ACP's content union.
///
/// The by-value/by-reference split is native here: [`ContentBlock::ResourceLink`]
/// carries a URI, media type and size and *no bytes*, which is what a
/// `cloop` artifact reference becomes. Nothing large is inlined.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Image {
        data: String,
        mime_type: String,
    },
    Audio {
        data: String,
        mime_type: String,
    },
    ResourceLink {
        uri: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
    },
    Resource {
        resource: Value,
    },
    /// A block type this build does not model, preserved verbatim.
    Unknown {
        tag: String,
        body: Value,
    },
}

impl ContentBlock {
    #[must_use]
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    #[must_use]
    pub fn tag(&self) -> &str {
        match self {
            Self::Text { .. } => "text",
            Self::Image { .. } => "image",
            Self::Audio { .. } => "audio",
            Self::ResourceLink { .. } => "resource_link",
            Self::Resource { .. } => "resource",
            Self::Unknown { tag, .. } => tag.as_str(),
        }
    }
}

impl Serialize for ContentBlock {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let value = match self {
            Self::Text { text } => serde_json::json!({ "type": "text", "text": text }),
            Self::Image { data, mime_type } => {
                serde_json::json!({ "type": "image", "data": data, "mimeType": mime_type })
            }
            Self::Audio { data, mime_type } => {
                serde_json::json!({ "type": "audio", "data": data, "mimeType": mime_type })
            }
            Self::ResourceLink {
                uri,
                name,
                mime_type,
                size,
            } => {
                let mut block = serde_json::json!({
                    "type": "resource_link",
                    "uri": uri,
                    "name": name,
                });
                if let (Some(map), Some(mime_type)) = (block.as_object_mut(), mime_type.as_ref()) {
                    map.insert("mimeType".into(), Value::String(mime_type.clone()));
                }
                if let (Some(map), Some(size)) = (block.as_object_mut(), size) {
                    map.insert("size".into(), Value::Number((*size).into()));
                }
                block
            }
            Self::Resource { resource } => {
                serde_json::json!({ "type": "resource", "resource": resource })
            }
            Self::Unknown { body, .. } => body.clone(),
        };
        value.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ContentBlock {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let body = Value::deserialize(deserializer)?;
        let tag = body
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("a content block requires a string `type`"))?
            .to_owned();
        let string = |field: &str| -> Result<String, D::Error> {
            body.get(field)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| {
                    serde::de::Error::custom(format!("content block `{tag}` requires `{field}`"))
                })
        };
        Ok(match tag.as_str() {
            "text" => Self::Text {
                text: string("text")?,
            },
            "image" => Self::Image {
                data: string("data")?,
                mime_type: string("mimeType")?,
            },
            "audio" => Self::Audio {
                data: string("data")?,
                mime_type: string("mimeType")?,
            },
            "resource_link" => Self::ResourceLink {
                uri: string("uri")?,
                name: body
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                mime_type: body
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                size: body.get("size").and_then(Value::as_u64),
            },
            "resource" => Self::Resource {
                resource: body.get("resource").cloned().unwrap_or(Value::Null),
            },
            _ => Self::Unknown { tag, body },
        })
    }
}

// --------------------------------------------------------------- permissions

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPermissionRequest {
    pub session_id: String,
    pub tool_call: ToolCallUpdate,
    pub options: Vec<PermissionOption>,
    #[serde(rename = "_meta", default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: PermissionOptionKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPermissionResponse {
    pub outcome: PermissionOutcome,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum PermissionOutcome {
    Selected {
        #[serde(rename = "optionId")]
        option_id: String,
    },
    Cancelled,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_request_fields_round_trip_instead_of_failing() {
        let raw = "{\"protocolVersion\":1,\"clientCapabilities\":{\"fs\":{\"readTextFile\":true,\
                   \"writeTextFile\":false},\"futureThing\":42},\"tomorrowField\":[1,2]}";
        let request: InitializeRequest = serde_json::from_str(raw).expect("tolerant decode");
        assert_eq!(request.protocol_version, 1);
        assert!(request.extra.contains_key("tomorrowField"));
        let capabilities = request.client_capabilities.clone().expect("capabilities");
        assert!(capabilities.extra.contains_key("futureThing"));
        let encoded = serde_json::to_value(&request).expect("encode");
        assert_eq!(
            encoded.get("tomorrowField"),
            Some(&serde_json::json!([1, 2]))
        );
    }

    #[test]
    fn unknown_content_and_update_tags_survive_a_round_trip() {
        let block: ContentBlock =
            serde_json::from_str("{\"type\":\"hologram\",\"frames\":3}").expect("decode");
        assert!(matches!(&block, ContentBlock::Unknown { tag, .. } if tag == "hologram"));
        assert_eq!(
            serde_json::to_value(&block).expect("encode"),
            serde_json::json!({ "type": "hologram", "frames": 3 })
        );

        let update: SessionUpdate =
            serde_json::from_str("{\"sessionUpdate\":\"telemetry\",\"n\":1}").expect("decode");
        assert_eq!(update.tag(), "telemetry");
        assert_eq!(
            serde_json::to_value(&update).expect("encode"),
            serde_json::json!({ "sessionUpdate": "telemetry", "n": 1 })
        );
    }

    #[test]
    fn known_updates_encode_with_their_discriminator() {
        let update = SessionUpdate::AgentMessageChunk {
            content: ContentBlock::text("hi"),
        };
        assert_eq!(
            serde_json::to_value(&update).expect("encode"),
            serde_json::json!({
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "hi" },
            })
        );
    }

    #[test]
    fn a_resource_link_carries_no_bytes() {
        let block = ContentBlock::ResourceLink {
            uri: "cloop-artifact:sha256:abc".into(),
            name: "out.bin".into(),
            mime_type: Some("application/octet-stream".into()),
            size: Some(4096),
        };
        let encoded = serde_json::to_value(&block).expect("encode");
        assert_eq!(encoded.get("size"), Some(&serde_json::json!(4096)));
        assert!(encoded.get("data").is_none());
    }
}
