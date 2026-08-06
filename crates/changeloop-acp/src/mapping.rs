//! Translation between `cloop`'s message-part union and ACP's content union.
//!
//! This is a *projection*, not a converter. Where `cloop` carries a part ACP
//! has no shape for — a unified-diff patch string, a snapshot digest, a
//! lifecycle step boundary — the mapping says so by name instead of flattening
//! it into prose. Silently coercing an unrepresentable part is the exact
//! failure ACP's deleted v1/v2 conversion layer taught: unrepresentable states
//! must surface, not be invented around.
//!
//! Direction matters for what a loss means:
//!
//! - **Agent to client** (`map_part`): an unrepresentable part is reported as
//!   [`PartProjection::Unrepresentable`] and omitted from the stream. Nothing
//!   the model produced is silently reshaped into something it did not say.
//! - **Client to agent** (`prompt_to_parts`): an unrepresentable block is a
//!   hard error. Dropping part of a user's prompt and answering anyway is worse
//!   than refusing the turn.

use base64::Engine as _;
use changeloop_protocol::{
    ArtifactOrigin, ArtifactOriginKind, ArtifactRef, MessagePart, MessagePartBody, PartId,
    PartState, Provenance,
};
use changeloop_session::ArtifactStore;
use thiserror::Error;

use crate::schema::{
    ContentBlock, SessionUpdate, ToolCall, ToolCallContent, ToolCallStatus, ToolCallUpdate,
    ToolKind,
};

/// URI scheme naming a `cloop` content-addressed artifact. The digest is the
/// address, so the link is stable and a client can fetch or cache by it.
pub const ARTIFACT_URI_SCHEME: &str = "cloop-artifact";

/// What one `cloop` part becomes on the ACP wire.
#[derive(Clone, Debug, PartialEq)]
pub enum PartProjection {
    /// The part projects onto an ACP session update.
    Update(Box<SessionUpdate>),
    /// ACP has no shape for this part at the negotiated version. The part kind
    /// is named so the omission is auditable rather than invisible.
    Unrepresentable { part_kind: &'static str },
}

impl PartProjection {
    fn update(update: SessionUpdate) -> Self {
        Self::Update(Box::new(update))
    }
}

/// Project one stored `cloop` part onto an ACP session update.
///
/// `cwd` is the session's working directory, used to render workspace-relative
/// file paths as absolute `file://` URIs the way ACP clients expect.
#[must_use]
pub fn map_part(part: &MessagePart, cwd: &str) -> PartProjection {
    match &part.body {
        MessagePartBody::Text { text } => {
            let content = ContentBlock::text(text);
            PartProjection::update(if part.provenance == Provenance::UserInput {
                SessionUpdate::UserMessageChunk { content }
            } else {
                SessionUpdate::AgentMessageChunk { content }
            })
        }
        MessagePartBody::Reasoning { text, .. } => {
            PartProjection::update(SessionUpdate::AgentThoughtChunk {
                content: ContentBlock::text(text),
            })
        }
        MessagePartBody::ToolCall {
            tool_call_id,
            name,
            arguments,
        } => PartProjection::update(SessionUpdate::ToolCall(ToolCall {
            tool_call_id: tool_call_id.0.clone(),
            title: if name.is_empty() {
                tool_call_id.0.clone()
            } else {
                name.clone()
            },
            kind: tool_kind_for(name),
            status: tool_status_for(part.state),
            content: Vec::new(),
            locations: Vec::new(),
            raw_input: Some(arguments.clone()),
        })),
        MessagePartBody::ToolResult {
            tool_call_id,
            output,
            artifact,
            is_error,
        } => {
            let content = match (output, artifact) {
                (Some(output), _) => vec![ToolCallContent::Content {
                    content: ContentBlock::text(output),
                }],
                (None, Some(artifact)) => vec![ToolCallContent::Content {
                    content: artifact_link(artifact, None),
                }],
                (None, None) => Vec::new(),
            };
            PartProjection::update(SessionUpdate::ToolCallUpdate(ToolCallUpdate {
                tool_call_id: tool_call_id.0.clone(),
                status: Some(if *is_error {
                    ToolCallStatus::Failed
                } else {
                    ToolCallStatus::Completed
                }),
                content: Some(content),
                ..ToolCallUpdate::default()
            }))
        }
        // A payload held by reference becomes ACP's by-reference content block:
        // URI, media type and size, and no bytes. Tool-attributed artifacts
        // ride on the tool call they belong to so a client can correlate them.
        MessagePartBody::Artifact {
            artifact, origin, ..
        } => {
            let link = artifact_link(artifact, origin.path.as_deref());
            match (&origin.kind, &origin.tool_call_id) {
                (ArtifactOriginKind::ToolOutput, Some(tool_call_id)) => {
                    PartProjection::update(SessionUpdate::ToolCallUpdate(ToolCallUpdate {
                        tool_call_id: tool_call_id.0.clone(),
                        status: Some(tool_status_for(part.state)),
                        content: Some(vec![ToolCallContent::Content { content: link }]),
                        ..ToolCallUpdate::default()
                    }))
                }
                _ => PartProjection::update(SessionUpdate::AgentMessageChunk { content: link }),
            }
        }
        MessagePartBody::File { path, artifact } => {
            PartProjection::update(SessionUpdate::AgentMessageChunk {
                content: ContentBlock::ResourceLink {
                    uri: file_uri(cwd, path),
                    name: path.clone(),
                    mime_type: Some(artifact.media_type.clone()),
                    size: Some(artifact.byte_length),
                },
            })
        }
        // An image is stored by reference in `cloop`; ACP's `image` block wants
        // inline base64. Re-inlining the bytes here would defeat the very
        // by-reference split the part exists to express, so the link form is
        // used and the media type is preserved.
        MessagePartBody::Image { artifact, alt } => {
            PartProjection::update(SessionUpdate::AgentMessageChunk {
                content: ContentBlock::ResourceLink {
                    uri: artifact_uri(artifact),
                    name: alt.clone().unwrap_or_else(|| artifact.id.0.clone()),
                    mime_type: Some(artifact.media_type.clone()),
                    size: Some(artifact.byte_length),
                },
            })
        }
        MessagePartBody::Source { url, title, .. } => {
            PartProjection::update(SessionUpdate::AgentMessageChunk {
                content: ContentBlock::ResourceLink {
                    uri: url.clone(),
                    name: title.clone().unwrap_or_else(|| url.clone()),
                    mime_type: None,
                    size: None,
                },
            })
        }
        MessagePartBody::Question { prompt } => {
            PartProjection::update(SessionUpdate::AgentMessageChunk {
                content: ContentBlock::text(prompt),
            })
        }
        MessagePartBody::Error { code, message, .. } => {
            PartProjection::update(SessionUpdate::AgentMessageChunk {
                content: ContentBlock::text(format!("[{code}] {message}")),
            })
        }
        // Everything below is `cloop`'s own lifecycle and evidence vocabulary.
        // ACP has no update shape for any of it, and inventing one would put a
        // state on the wire that no ACP client can interpret.
        MessagePartBody::Patch { .. } => PartProjection::Unrepresentable { part_kind: "patch" },
        MessagePartBody::Snapshot { .. } => PartProjection::Unrepresentable {
            part_kind: "snapshot",
        },
        MessagePartBody::Retry { .. } => PartProjection::Unrepresentable { part_kind: "retry" },
        MessagePartBody::Compaction { .. } => PartProjection::Unrepresentable {
            part_kind: "compaction",
        },
        MessagePartBody::Permission { .. } => PartProjection::Unrepresentable {
            part_kind: "permission",
        },
        MessagePartBody::StepStart { .. } => PartProjection::Unrepresentable {
            part_kind: "step_start",
        },
        MessagePartBody::StepFinish { .. } => PartProjection::Unrepresentable {
            part_kind: "step_finish",
        },
        MessagePartBody::Subagent { .. } => PartProjection::Unrepresentable {
            part_kind: "subagent",
        },
        MessagePartBody::ReviewFinding { .. } => PartProjection::Unrepresentable {
            part_kind: "review_finding",
        },
        MessagePartBody::Unknown { .. } => PartProjection::Unrepresentable {
            part_kind: "unknown",
        },
        _ => PartProjection::Unrepresentable {
            part_kind: "unmodelled",
        },
    }
}

fn tool_status_for(state: PartState) -> ToolCallStatus {
    match state {
        PartState::Partial => ToolCallStatus::Pending,
        PartState::Running => ToolCallStatus::InProgress,
        PartState::Completed => ToolCallStatus::Completed,
        PartState::Error => ToolCallStatus::Failed,
    }
}

/// Best-effort classification for the tool-call icon a client shows. It is
/// presentation only: a wrong guess costs an icon, never correctness.
fn tool_kind_for(name: &str) -> ToolKind {
    let name = name.to_ascii_lowercase();
    if name.contains("read") || name.contains("cat") {
        ToolKind::Read
    } else if name.contains("write") || name.contains("patch") || name.contains("edit") {
        ToolKind::Edit
    } else if name.contains("delete") || name.contains("remove") {
        ToolKind::Delete
    } else if name.contains("rename") || name.contains("move") {
        ToolKind::Move
    } else if name.contains("grep") || name.contains("search") || name.contains("glob") {
        ToolKind::Search
    } else if name.contains("bash") || name.contains("exec") || name.contains("process") {
        ToolKind::Execute
    } else if name.contains("fetch") || name.contains("http") {
        ToolKind::Fetch
    } else {
        ToolKind::Other
    }
}

#[must_use]
pub fn artifact_uri(artifact: &ArtifactRef) -> String {
    format!("{ARTIFACT_URI_SCHEME}:sha256:{}", artifact.sha256)
}

fn artifact_link(artifact: &ArtifactRef, name: Option<&str>) -> ContentBlock {
    ContentBlock::ResourceLink {
        uri: artifact_uri(artifact),
        name: name.unwrap_or(artifact.id.0.as_str()).to_owned(),
        mime_type: Some(artifact.media_type.clone()),
        size: Some(artifact.byte_length),
    }
}

fn file_uri(cwd: &str, path: &str) -> String {
    let trimmed = cwd.trim_end_matches('/');
    if trimmed.is_empty() {
        format!("file:///{}", path.trim_start_matches('/'))
    } else if trimmed.starts_with('/') {
        format!("file://{trimmed}/{path}")
    } else {
        format!("file:///{trimmed}/{path}")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum PromptMappingError {
    #[error("prompt content block `{tag}` has no representation in the cloop part union")]
    UnrepresentableBlock { tag: String },
    #[error("prompt content block `{tag}` carries data that is not valid base64")]
    InvalidBase64 { tag: String },
    #[error("a prompt must carry at least one content block")]
    EmptyPrompt,
}

/// Turn an ACP prompt into the parts a `cloop` message carries.
///
/// Inline binary content is written to `artifacts` and referenced, so a large
/// pasted image does not become transcript bytes. Anything with no `cloop`
/// representation fails the whole prompt rather than being dropped from it.
pub fn prompt_to_parts(
    blocks: &[ContentBlock],
    artifacts: &mut ArtifactStore,
) -> Result<Vec<MessagePart>, PromptMappingError> {
    if blocks.is_empty() {
        return Err(PromptMappingError::EmptyPrompt);
    }
    let engine = base64::engine::general_purpose::STANDARD;
    let mut parts = Vec::with_capacity(blocks.len());
    for block in blocks {
        let body = match block {
            ContentBlock::Text { text } => MessagePartBody::Text { text: text.clone() },
            ContentBlock::Image { data, mime_type } => {
                let bytes = engine
                    .decode(data)
                    .map_err(|_| PromptMappingError::InvalidBase64 {
                        tag: "image".into(),
                    })?;
                MessagePartBody::Image {
                    artifact: artifacts.put(mime_type, &bytes),
                    alt: None,
                }
            }
            // `cloop` has no audio part. Rather than invent one, the payload
            // lands in content-addressed storage as a referenced attachment,
            // which is lossless and already an enumerated part shape.
            ContentBlock::Audio { data, mime_type } => {
                let bytes = engine
                    .decode(data)
                    .map_err(|_| PromptMappingError::InvalidBase64 {
                        tag: "audio".into(),
                    })?;
                MessagePartBody::Artifact {
                    artifact: artifacts.put(mime_type, &bytes),
                    origin: ArtifactOrigin::attachment(),
                    preview: None,
                }
            }
            ContentBlock::ResourceLink { uri, name, .. } => MessagePartBody::Source {
                url: uri.clone(),
                retrieved_at_ms: 0,
                title: Some(name.clone()).filter(|name| !name.is_empty()),
            },
            ContentBlock::Resource { resource } => {
                let bytes = serde_json::to_vec(resource).unwrap_or_default();
                MessagePartBody::Artifact {
                    artifact: artifacts.put("application/json", &bytes),
                    origin: ArtifactOrigin::attachment(),
                    preview: None,
                }
            }
            ContentBlock::Unknown { tag, .. } => {
                return Err(PromptMappingError::UnrepresentableBlock { tag: tag.clone() });
            }
        };
        parts.push(MessagePart {
            schema_version: changeloop_protocol::minimum_part_schema_version(&body),
            id: PartId::new(),
            state: PartState::Completed,
            provenance: Provenance::UserInput,
            body,
        });
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_protocol::ToolCallId;

    fn part(body: MessagePartBody, state: PartState, provenance: Provenance) -> MessagePart {
        MessagePart {
            schema_version: changeloop_protocol::minimum_part_schema_version(&body),
            id: PartId::from_stable("part-1"),
            state,
            provenance,
            body,
        }
    }

    #[test]
    fn text_provenance_decides_user_versus_agent_chunk() {
        let agent = map_part(
            &part(
                MessagePartBody::Text { text: "hi".into() },
                PartState::Completed,
                Provenance::ModelGenerated,
            ),
            "/repo",
        );
        assert!(matches!(
            agent,
            PartProjection::Update(update) if update.tag() == "agent_message_chunk"
        ));
        let user = map_part(
            &part(
                MessagePartBody::Text { text: "hi".into() },
                PartState::Completed,
                Provenance::UserInput,
            ),
            "/repo",
        );
        assert!(matches!(
            user,
            PartProjection::Update(update) if update.tag() == "user_message_chunk"
        ));
    }

    #[test]
    fn a_tool_artifact_rides_on_its_tool_call_by_reference() {
        let artifact = ArtifactRef::for_bytes("application/octet-stream", &[0_u8; 64]);
        let projected = map_part(
            &part(
                MessagePartBody::Artifact {
                    artifact: artifact.clone(),
                    origin: ArtifactOrigin::tool_output(ToolCallId::from_stable("call-9")),
                    preview: None,
                },
                PartState::Completed,
                Provenance::ToolOutput,
            ),
            "/repo",
        );
        let PartProjection::Update(update) = projected else {
            panic!("expected a projection");
        };
        let SessionUpdate::ToolCallUpdate(update) = *update else {
            panic!("expected a tool_call_update");
        };
        assert_eq!(update.tool_call_id, "call-9");
        let content = update.content.expect("content");
        assert_eq!(
            content,
            vec![ToolCallContent::Content {
                content: ContentBlock::ResourceLink {
                    uri: format!("cloop-artifact:sha256:{}", artifact.sha256),
                    name: artifact.id.0.clone(),
                    mime_type: Some("application/octet-stream".into()),
                    size: Some(64),
                },
            }]
        );
    }

    #[test]
    fn cloop_lifecycle_parts_are_named_unrepresentable_not_flattened() {
        use changeloop_protocol::OperationId;
        let cases = [
            (
                MessagePartBody::Patch {
                    operation_id: OperationId::from_stable("op"),
                    patch: "@@".into(),
                },
                "patch",
            ),
            (
                MessagePartBody::StepStart {
                    operation_id: OperationId::from_stable("op"),
                    label: "build".into(),
                },
                "step_start",
            ),
            (
                MessagePartBody::ReviewFinding {
                    classification: "blocking".into(),
                    summary: "s".into(),
                    blocking: true,
                },
                "review_finding",
            ),
            (
                MessagePartBody::Unknown {
                    type_name: "future".into(),
                    data: serde_json::Value::Null,
                },
                "unknown",
            ),
        ];
        for (body, expected) in cases {
            assert_eq!(
                map_part(
                    &part(body, PartState::Completed, Provenance::ModelGenerated),
                    "/repo"
                ),
                PartProjection::Unrepresentable {
                    part_kind: expected
                }
            );
        }
    }

    #[test]
    fn inline_prompt_binary_becomes_a_stored_artifact_reference() {
        let mut artifacts = ArtifactStore::new();
        let data = base64::engine::general_purpose::STANDARD.encode([1_u8, 2, 3, 4]);
        let parts = prompt_to_parts(
            &[
                ContentBlock::text("look at this"),
                ContentBlock::Image {
                    data,
                    mime_type: "image/png".into(),
                },
            ],
            &mut artifacts,
        )
        .expect("mapping");
        assert_eq!(parts.len(), 2);
        assert_eq!(artifacts.len(), 1);
        let MessagePartBody::Image { artifact, .. } = &parts[1].body else {
            panic!("expected an image part");
        };
        assert_eq!(artifacts.get(artifact), Some([1_u8, 2, 3, 4].as_slice()));
        assert!(
            parts
                .iter()
                .all(|part| part.provenance == Provenance::UserInput)
        );
    }

    #[test]
    fn an_unrepresentable_prompt_block_fails_the_turn_rather_than_being_dropped() {
        let mut artifacts = ArtifactStore::new();
        let error = prompt_to_parts(
            &[
                ContentBlock::text("keep"),
                ContentBlock::Unknown {
                    tag: "hologram".into(),
                    body: serde_json::json!({ "type": "hologram" }),
                },
            ],
            &mut artifacts,
        )
        .expect_err("must refuse");
        assert_eq!(
            error,
            PromptMappingError::UnrepresentableBlock {
                tag: "hologram".into()
            }
        );
    }

    #[test]
    fn file_parts_render_absolute_file_uris() {
        let artifact = ArtifactRef::for_bytes("text/plain", b"x");
        let projected = map_part(
            &part(
                MessagePartBody::File {
                    path: "src/lib.rs".into(),
                    artifact,
                },
                PartState::Completed,
                Provenance::RepositoryContent,
            ),
            "/repo/",
        );
        let PartProjection::Update(update) = projected else {
            panic!("expected a projection");
        };
        let SessionUpdate::AgentMessageChunk {
            content: ContentBlock::ResourceLink { uri, .. },
        } = *update
        else {
            panic!("expected a resource link");
        };
        assert_eq!(uri, "file:///repo/src/lib.rs");
    }
}
