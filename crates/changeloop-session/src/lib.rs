//! Session primitives that keep read-only conversation authority separate from
//! changes, plus the durable transcript those sessions accumulate.
//!
//! The transcript is an append-only log of [`Message`]s carrying typed parts.
//! Four properties are load-bearing and are proved by the tests in this module:
//!
//! - an unknown part round-trips verbatim through store and load,
//! - a part stored under an older schema either renders through an enumerated
//!   downgrade path or fails visibly,
//! - a tool call that stops without a result is sealed with a terminal one,
//! - a large or binary tool output becomes a content-addressed artifact
//!   reference instead of transcript bytes.

use std::collections::{BTreeMap, BTreeSet};

use changeloop_protocol::{
    ArtifactOrigin, ArtifactRef, MAX_ARTIFACT_PREVIEW_BYTES, MAX_PROTOCOL_ID_BYTES, Message,
    MessageId, MessagePart, MessagePartBody, PartId, PartState, Provenance, RenderedPart,
    SessionId, ToolCallId, ToolInterruption, interrupted_tool_result, minimum_part_schema_version,
    render_part_at_schema_version, should_store_by_reference,
};
use changeloop_protocol::{CursorForm, EventCursor};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum SessionKind {
    Conversation,
    Change,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum ChangeState {
    Draft,
    Confirmed,
    Building,
    Proving,
    ReadyToLand,
    Landed,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct Session {
    pub id: SessionId,
    pub kind: SessionKind,
    pub change_state: Option<ChangeState>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SessionError {
    #[error("conversation sessions cannot mutate the workspace")]
    ConversationIsReadOnly,
    #[error("change must be confirmed before mutation")]
    ChangeNotConfirmed,
    #[error("change in terminal state {0:?} cannot mutate the workspace")]
    ChangeIsTerminal(ChangeState),
    #[error("session kind and change state are inconsistent")]
    InvalidShape,
    #[error("session identifier is invalid")]
    InvalidId,
    #[error("message belongs to a different session")]
    ForeignMessage,
    #[error("a message must carry at least one part")]
    EmptyMessage,
    #[error("duplicate part identifier {0} in one message")]
    DuplicatePartId(String),
    #[error("part {0} declares a schema version older than its body requires")]
    PartSchemaTooOld(String),
    #[error("message identifier {0} is already present in the transcript")]
    DuplicateMessageId(String),
    #[error("pagination cursor is not a form this build understands")]
    UnknownCursorForm,
    #[error("pagination cursor is malformed")]
    InvalidCursor,
    #[error("transcript could not be encoded or decoded")]
    CorruptTranscript,
}

impl Session {
    #[must_use]
    pub fn conversation(id: SessionId) -> Self {
        Self {
            id,
            kind: SessionKind::Conversation,
            change_state: None,
        }
    }

    #[must_use]
    pub fn draft_change(id: SessionId) -> Self {
        Self {
            id,
            kind: SessionKind::Change,
            change_state: Some(ChangeState::Draft),
        }
    }

    pub fn require_mutation_authority(&self) -> Result<(), SessionError> {
        self.validate()?;
        match (self.kind, self.change_state) {
            (SessionKind::Conversation, _) => Err(SessionError::ConversationIsReadOnly),
            (SessionKind::Change, Some(ChangeState::Draft) | None) => {
                Err(SessionError::ChangeNotConfirmed)
            }
            (
                SessionKind::Change,
                Some(
                    ChangeState::Confirmed
                    | ChangeState::Building
                    | ChangeState::Proving
                    | ChangeState::ReadyToLand,
                ),
            ) => Ok(()),
            (SessionKind::Change, Some(state @ (ChangeState::Landed | ChangeState::Cancelled))) => {
                Err(SessionError::ChangeIsTerminal(state))
            }
        }
    }

    pub fn validate(&self) -> Result<(), SessionError> {
        if self.id.0.is_empty()
            || self.id.0.len() > MAX_PROTOCOL_ID_BYTES
            || self
                .id
                .0
                .bytes()
                .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        {
            return Err(SessionError::InvalidId);
        }
        match (self.kind, self.change_state) {
            (SessionKind::Conversation, None) | (SessionKind::Change, Some(_)) => Ok(()),
            _ => Err(SessionError::InvalidShape),
        }
    }
}

/// Content-addressed storage for payloads too large, or too binary, to belong
/// in a transcript. The digest is the address, so an identical payload written
/// twice occupies one entry and yields one reference.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactStore {
    blobs: BTreeMap<String, Vec<u8>>,
}

impl ArtifactStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Store `bytes` and return the reference that addresses them.
    pub fn put(&mut self, media_type: &str, bytes: &[u8]) -> ArtifactRef {
        let reference = ArtifactRef::for_bytes(media_type, bytes);
        self.blobs
            .entry(reference.sha256.clone())
            .or_insert_with(|| bytes.to_vec());
        reference
    }

    #[must_use]
    pub fn get(&self, reference: &ArtifactRef) -> Option<&[u8]> {
        self.blobs.get(&reference.sha256).map(Vec::as_slice)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.blobs.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.blobs.is_empty()
    }
}

/// Build the part that carries a tool call's output.
///
/// The by-value/by-reference split is decided here, at insert time, not at
/// render time: anything above [`changeloop_protocol::MAX_INLINE_TOOL_OUTPUT_BYTES`]
/// and anything that is not UTF-8 text is written to `artifacts` and referenced,
/// so the transcript never grows by the size of a tool's output.
pub fn tool_output_part(
    artifacts: &mut ArtifactStore,
    part_id: PartId,
    tool_call_id: ToolCallId,
    media_type: &str,
    bytes: &[u8],
) -> MessagePart {
    if should_store_by_reference(bytes, media_type) {
        let artifact = artifacts.put(media_type, bytes);
        return MessagePart {
            schema_version: minimum_part_schema_version(&MessagePartBody::Artifact {
                artifact: artifact.clone(),
                origin: ArtifactOrigin::tool_output(tool_call_id.clone()),
                preview: None,
            }),
            id: part_id,
            state: PartState::Completed,
            provenance: Provenance::ToolOutput,
            body: MessagePartBody::Artifact {
                preview: preview_of(bytes),
                artifact,
                origin: ArtifactOrigin::tool_output(tool_call_id),
            },
        };
    }
    MessagePart {
        schema_version: changeloop_protocol::BASE_PART_SCHEMA_VERSION,
        id: part_id,
        state: PartState::Completed,
        provenance: Provenance::ToolOutput,
        body: MessagePartBody::ToolResult {
            tool_call_id,
            output: Some(String::from_utf8_lossy(bytes).into_owned()),
            artifact: None,
            is_error: false,
        },
    }
}

/// A truncated, char-boundary-safe rendering of `bytes`, or `None` when they
/// are not text. Derived data only; the artifact stays the source of truth.
fn preview_of(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut end = text.len().min(MAX_ARTIFACT_PREVIEW_BYTES);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    Some(text[..end].to_owned())
}

/// One appended message and the position it occupies in the log.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub sequence: u64,
    pub message: Message,
}

impl TranscriptEntry {
    /// The cursor naming this entry. It names the element, not a distance from
    /// the start, so later appends never move it.
    #[must_use]
    pub fn cursor(&self) -> EventCursor {
        EventCursor::for_sequence(self.sequence)
    }
}

/// One page of messages plus the cursor that resumes after it.
#[derive(Clone, Debug, PartialEq)]
pub struct MessagePage {
    pub messages: Vec<Message>,
    pub next_cursor: Option<EventCursor>,
    pub has_more: bool,
}

/// The durable, append-only message log of one session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transcript {
    pub schema_version: u16,
    pub session_id: SessionId,
    next_sequence: u64,
    entries: Vec<TranscriptEntry>,
}

impl Transcript {
    /// The envelope version of the transcript container itself, distinct from
    /// the per-part schema version each part carries.
    pub const SCHEMA_VERSION: u16 = 1;

    #[must_use]
    pub fn new(session_id: SessionId) -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            session_id,
            next_sequence: 1,
            entries: Vec::new(),
        }
    }

    #[must_use]
    pub fn entries(&self) -> &[TranscriptEntry] {
        &self.entries
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Append `message`, returning the cursor that names it.
    pub fn append(&mut self, message: Message) -> Result<EventCursor, SessionError> {
        if message.session_id != self.session_id {
            return Err(SessionError::ForeignMessage);
        }
        if message.parts.is_empty() {
            return Err(SessionError::EmptyMessage);
        }
        let mut seen = BTreeSet::new();
        for part in &message.parts {
            if !seen.insert(part.id.0.clone()) {
                return Err(SessionError::DuplicatePartId(part.id.0.clone()));
            }
            if part.schema_version < minimum_part_schema_version(&part.body) {
                return Err(SessionError::PartSchemaTooOld(part.id.0.clone()));
            }
        }
        if self
            .entries
            .iter()
            .any(|entry| entry.message.id == message.id)
        {
            return Err(SessionError::DuplicateMessageId(message.id.0.clone()));
        }
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        self.entries.push(TranscriptEntry { sequence, message });
        Ok(EventCursor::for_sequence(sequence))
    }

    /// Tool calls that have not been answered by a result part.
    #[must_use]
    pub fn unanswered_tool_calls(&self) -> Vec<(MessageId, PartId, ToolCallId)> {
        let mut answered = BTreeSet::new();
        for entry in &self.entries {
            for part in &entry.message.parts {
                match &part.body {
                    MessagePartBody::ToolResult { tool_call_id, .. } => {
                        answered.insert(tool_call_id.0.clone());
                    }
                    MessagePartBody::Artifact { origin, .. } => {
                        if let Some(tool_call_id) = &origin.tool_call_id {
                            answered.insert(tool_call_id.0.clone());
                        }
                    }
                    _ => {}
                }
            }
        }
        let mut pending = Vec::new();
        for entry in &self.entries {
            for part in &entry.message.parts {
                if let MessagePartBody::ToolCall { tool_call_id, .. } = &part.body
                    && !answered.contains(&tool_call_id.0)
                {
                    pending.push((
                        entry.message.id.clone(),
                        part.id.clone(),
                        tool_call_id.clone(),
                    ));
                }
            }
        }
        pending
    }

    /// Give every unanswered tool call a terminal result.
    ///
    /// An interrupted call therefore has a terminal result by construction. The
    /// appended message is empty-free: the call returns `None` when nothing was
    /// dangling, so no placeholder message is written for a clean session.
    pub fn seal_unanswered_tool_calls(
        &mut self,
        interruption: ToolInterruption,
        message_id: MessageId,
        created_at_ms: u64,
    ) -> Result<Option<EventCursor>, SessionError> {
        let pending = self.unanswered_tool_calls();
        if pending.is_empty() {
            return Ok(None);
        }
        let mut parts = Vec::with_capacity(pending.len());
        for (owner_id, part_id, _) in &pending {
            let call = self
                .entries
                .iter()
                .filter(|entry| &entry.message.id == owner_id)
                .flat_map(|entry| entry.message.parts.iter())
                .find(|part| &part.id == part_id)
                .ok_or(SessionError::CorruptTranscript)?;
            let result_id = PartId::from_stable(format!("{}::terminal", part_id.0));
            let result = interrupted_tool_result(call, interruption, result_id)
                .ok_or(SessionError::CorruptTranscript)?;
            parts.push(result);
        }
        let message = Message {
            schema_version: 1,
            id: message_id,
            session_id: self.session_id.clone(),
            created_at_ms,
            parts,
        };
        self.append(message).map(Some)
    }

    /// Render every stored part at `target`. Parts written under a newer schema
    /// either take an enumerated downgrade path or come back as a visible
    /// not-representable placeholder; nothing is silently coerced.
    #[must_use]
    pub fn render_at_schema_version(&self, target: u16) -> Vec<RenderedPart> {
        self.entries
            .iter()
            .flat_map(|entry| entry.message.parts.iter())
            .map(|part| render_part_at_schema_version(part, target))
            .collect()
    }

    /// Read one page of messages after `after`.
    ///
    /// The cursor is a keyset position, so a page taken before an append and
    /// resumed after one returns exactly the messages that followed it: no
    /// duplicate, no skip, no dependence on how many messages exist.
    pub fn page(
        &self,
        after: Option<&EventCursor>,
        limit: usize,
    ) -> Result<MessagePage, SessionError> {
        let start_after = match after {
            None => 0,
            Some(cursor) => match cursor.form().map_err(|_| SessionError::InvalidCursor)? {
                CursorForm::Sequence { sequence } => sequence,
                _ => return Err(SessionError::UnknownCursorForm),
            },
        };
        let remaining: Vec<&TranscriptEntry> = self
            .entries
            .iter()
            .filter(|entry| entry.sequence > start_after)
            .collect();
        let taken = &remaining[..remaining.len().min(limit)];
        Ok(MessagePage {
            messages: taken.iter().map(|entry| entry.message.clone()).collect(),
            next_cursor: taken.last().map(|entry| entry.cursor()),
            has_more: remaining.len() > taken.len(),
        })
    }

    /// Serialize the transcript for durable storage.
    pub fn store(&self) -> Result<String, SessionError> {
        serde_json::to_string(self).map_err(|_| SessionError::CorruptTranscript)
    }

    /// Load a stored transcript. Parts this build does not know keep their tag
    /// and payload, so the next [`Transcript::store`] emits them unchanged.
    pub fn load(stored: &str) -> Result<Self, SessionError> {
        serde_json::from_str(stored).map_err(|_| SessionError::CorruptTranscript)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_never_has_mutation_authority() {
        let session = Session::conversation(SessionId::from_stable("session-1"));
        assert_eq!(
            session.require_mutation_authority(),
            Err(SessionError::ConversationIsReadOnly)
        );
    }

    #[test]
    fn draft_requires_confirmation() {
        let mut session = Session::draft_change(SessionId::from_stable("session-2"));
        assert_eq!(
            session.require_mutation_authority(),
            Err(SessionError::ChangeNotConfirmed)
        );
        session.change_state = Some(ChangeState::Confirmed);
        assert_eq!(session.require_mutation_authority(), Ok(()));
    }

    #[test]
    fn terminal_changes_cannot_regain_mutation_authority() {
        let mut session = Session::draft_change(SessionId::from_stable("session-3"));
        for state in [ChangeState::Landed, ChangeState::Cancelled] {
            session.change_state = Some(state);
            assert_eq!(
                session.require_mutation_authority(),
                Err(SessionError::ChangeIsTerminal(state))
            );
        }
    }

    #[test]
    fn restored_sessions_reject_invalid_shape_and_identifier() {
        let conversation_with_change = Session {
            id: SessionId::from_stable("session"),
            kind: SessionKind::Conversation,
            change_state: Some(ChangeState::Confirmed),
        };
        assert_eq!(
            conversation_with_change.validate(),
            Err(SessionError::InvalidShape)
        );
        let change_without_state = Session {
            id: SessionId::from_stable("session"),
            kind: SessionKind::Change,
            change_state: None,
        };
        assert_eq!(
            change_without_state.validate(),
            Err(SessionError::InvalidShape)
        );
        let invalid_id = Session::conversation(SessionId::from_stable("bad id"));
        assert_eq!(invalid_id.validate(), Err(SessionError::InvalidId));
    }

    fn transcript() -> Transcript {
        Transcript::new(SessionId::from_stable("session-transcript"))
    }

    fn message(id: &str, parts: Vec<MessagePart>) -> Message {
        Message {
            schema_version: 1,
            id: MessageId::from_stable(id),
            session_id: SessionId::from_stable("session-transcript"),
            created_at_ms: 1,
            parts,
        }
    }

    fn text_part(id: &str, text: &str) -> MessagePart {
        MessagePart {
            schema_version: changeloop_protocol::BASE_PART_SCHEMA_VERSION,
            id: PartId::from_stable(id),
            state: PartState::Completed,
            provenance: Provenance::ModelGenerated,
            body: MessagePartBody::Text { text: text.into() },
        }
    }

    fn tool_call_part(id: &str, tool_call_id: &str) -> MessagePart {
        MessagePart {
            schema_version: changeloop_protocol::BASE_PART_SCHEMA_VERSION,
            id: PartId::from_stable(id),
            state: PartState::Running,
            provenance: Provenance::ModelGenerated,
            body: MessagePartBody::ToolCall {
                tool_call_id: ToolCallId::from_stable(tool_call_id),
                name: "read_file".into(),
                arguments: serde_json::json!({ "path": "src/lib.rs" }),
            },
        }
    }

    #[test]
    fn unknown_parts_round_trip_verbatim_through_store_and_load() {
        let payload = serde_json::json!({
            "zeta": [1, 2, {"nested": true}],
            "alpha": "kept",
            "middle": null,
        });
        let unknown = MessagePart {
            schema_version: 7,
            id: PartId::from_stable("part-unknown"),
            state: PartState::Completed,
            provenance: Provenance::ModelGenerated,
            body: MessagePartBody::Unknown {
                type_name: "future_part".into(),
                data: payload.clone(),
            },
        };
        let mut log = transcript();
        log.append(message("message-1", vec![unknown.clone()]))
            .unwrap();

        let stored = log.store().unwrap();
        let loaded = Transcript::load(&stored).unwrap();
        let restored = loaded.store().unwrap();
        assert_eq!(
            stored, restored,
            "store->load->store must be byte identical"
        );
        assert_eq!(loaded, log);

        let part = &loaded.entries()[0].message.parts[0];
        assert_eq!(part.schema_version, 7);
        match &part.body {
            MessagePartBody::Unknown { type_name, data } => {
                assert_eq!(type_name, "future_part");
                assert_eq!(data, &payload, "unknown payload must survive verbatim");
            }
            other => panic!("unknown part lost its identity: {other:?}"),
        }
    }

    #[test]
    fn stored_parts_render_through_declared_downgrades_or_visible_placeholders() {
        let mut artifacts = ArtifactStore::new();
        let big = vec![b'a'; 64 * 1024];
        let by_reference = tool_output_part(
            &mut artifacts,
            PartId::from_stable("part-artifact"),
            ToolCallId::from_stable("call-1"),
            "text/plain",
            &big,
        );
        let attachment = MessagePart {
            schema_version: changeloop_protocol::ARTIFACT_PART_SCHEMA_VERSION,
            id: PartId::from_stable("part-attachment"),
            state: PartState::Completed,
            provenance: Provenance::UserInput,
            body: MessagePartBody::Artifact {
                artifact: artifacts.put("application/octet-stream", &[0u8, 159, 146, 150]),
                origin: ArtifactOrigin::attachment(),
                preview: None,
            },
        };
        let opaque = MessagePart {
            schema_version: 7,
            id: PartId::from_stable("part-opaque"),
            state: PartState::Completed,
            provenance: Provenance::ModelGenerated,
            body: MessagePartBody::Unknown {
                type_name: "future_part".into(),
                data: serde_json::json!({ "keep": "me" }),
            },
        };
        let plain = text_part("part-text", "hello");

        let mut log = transcript();
        log.append(message(
            "message-1",
            vec![by_reference, attachment, opaque, plain.clone()],
        ))
        .unwrap();

        let rendered = log.render_at_schema_version(1);

        // Declared downgrade: an artifact attributed to a tool call becomes the
        // v1 tool result that references the same bytes.
        match &rendered[0] {
            RenderedPart::Representable(part) => {
                assert_eq!(part.schema_version, 1);
                match &part.body {
                    MessagePartBody::ToolResult {
                        tool_call_id,
                        output,
                        artifact,
                        is_error,
                    } => {
                        assert_eq!(tool_call_id.0, "call-1");
                        assert!(output.is_none());
                        assert_eq!(artifact.as_ref().unwrap().byte_length, 64 * 1024);
                        assert!(!is_error);
                    }
                    other => panic!("unexpected downgrade target: {other:?}"),
                }
            }
            other => panic!("tool-output artifact must downgrade: {other:?}"),
        }

        // No declared path: an unattributed attachment fails visibly.
        match &rendered[1] {
            RenderedPart::NotRepresentable(placeholder) => {
                assert_eq!(
                    placeholder.reason,
                    changeloop_protocol::NotRepresentableReason::NoDeclaredDowngrade
                );
                assert!(
                    placeholder
                        .placeholder()
                        .contains(changeloop_protocol::NOT_REPRESENTABLE_PLACEHOLDER)
                );
            }
            other => panic!("attachment must not be coerced: {other:?}"),
        }

        // Opaque bodies are never downgraded.
        match &rendered[2] {
            RenderedPart::NotRepresentable(placeholder) => assert_eq!(
                placeholder.reason,
                changeloop_protocol::NotRepresentableReason::OpaqueBody
            ),
            other => panic!("opaque body must not be downgraded: {other:?}"),
        }

        // A part already at the target version is the identity.
        assert_eq!(rendered[3], RenderedPart::Representable(plain));
    }

    #[test]
    fn interrupted_tool_calls_receive_a_terminal_result() {
        let mut log = transcript();
        log.append(message(
            "message-1",
            vec![tool_call_part("part-call", "call-1")],
        ))
        .unwrap();
        assert_eq!(log.unanswered_tool_calls().len(), 1);

        let cursor = log
            .seal_unanswered_tool_calls(
                ToolInterruption::Interrupted,
                MessageId::from_stable("message-seal"),
                2,
            )
            .unwrap();
        assert!(cursor.is_some());
        assert!(log.unanswered_tool_calls().is_empty());

        let sealed = &log.entries()[1].message.parts[0];
        assert_eq!(sealed.state, PartState::Error);
        match &sealed.body {
            MessagePartBody::ToolResult {
                tool_call_id,
                output,
                is_error,
                ..
            } => {
                assert_eq!(tool_call_id.0, "call-1");
                assert!(is_error);
                assert!(output.as_ref().unwrap().contains("interrupted"));
            }
            other => panic!("interrupted call was not sealed: {other:?}"),
        }

        // Sealing is idempotent: an answered call is not sealed twice.
        assert!(
            log.seal_unanswered_tool_calls(
                ToolInterruption::Interrupted,
                MessageId::from_stable("message-seal-2"),
                3,
            )
            .unwrap()
            .is_none()
        );
    }

    #[test]
    fn large_and_binary_tool_output_becomes_an_artifact_reference() {
        let mut artifacts = ArtifactStore::new();
        let big = vec![b'a'; 64 * 1024];
        let part = tool_output_part(
            &mut artifacts,
            PartId::from_stable("part-big"),
            ToolCallId::from_stable("call-big"),
            "text/plain",
            &big,
        );
        assert_eq!(
            part.schema_version,
            changeloop_protocol::ARTIFACT_PART_SCHEMA_VERSION
        );
        let artifact = match &part.body {
            MessagePartBody::Artifact {
                artifact, preview, ..
            } => {
                assert!(preview.as_ref().unwrap().len() <= MAX_ARTIFACT_PREVIEW_BYTES);
                artifact.clone()
            }
            other => panic!("large output was inlined: {other:?}"),
        };
        assert_eq!(artifacts.get(&artifact).unwrap(), big.as_slice());

        let mut log = transcript();
        log.append(message("message-1", vec![part])).unwrap();
        let stored = log.store().unwrap();
        assert!(
            stored.len() < big.len() / 2,
            "transcript must not carry the payload: {} bytes",
            stored.len()
        );

        // Binary payloads go by reference regardless of size.
        let binary = tool_output_part(
            &mut artifacts,
            PartId::from_stable("part-binary"),
            ToolCallId::from_stable("call-binary"),
            "application/octet-stream",
            &[0u8, 159, 146, 150],
        );
        assert!(matches!(binary.body, MessagePartBody::Artifact { .. }));

        // Small text stays inline.
        let small = tool_output_part(
            &mut artifacts,
            PartId::from_stable("part-small"),
            ToolCallId::from_stable("call-small"),
            "text/plain",
            b"ok",
        );
        assert!(matches!(small.body, MessagePartBody::ToolResult { .. }));
    }

    #[test]
    fn pagination_cursors_stay_stable_across_insertions() {
        let mut log = transcript();
        for index in 1..=5 {
            log.append(message(
                &format!("message-{index}"),
                vec![text_part(&format!("part-{index}"), "body")],
            ))
            .unwrap();
        }

        let first = log.page(None, 2).unwrap();
        assert_eq!(first.messages.len(), 2);
        assert!(first.has_more);
        let resume = first.next_cursor.clone().unwrap();

        // Append after the page was taken. A keyset cursor names an element, so
        // the next page is unaffected by how many messages arrived meanwhile.
        for index in 6..=8 {
            log.append(message(
                &format!("message-{index}"),
                vec![text_part(&format!("part-{index}"), "body")],
            ))
            .unwrap();
        }

        let second = log.page(Some(&resume), 2).unwrap();
        let ids: Vec<&str> = second
            .messages
            .iter()
            .map(|message| message.id.0.as_str())
            .collect();
        assert_eq!(ids, ["message-3", "message-4"]);

        // Walking to exhaustion yields every message exactly once, in order.
        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = log.page(cursor.as_ref(), 3).unwrap();
            seen.extend(page.messages.iter().map(|message| message.id.0.clone()));
            if !page.has_more {
                break;
            }
            cursor = page.next_cursor;
        }
        let expected: Vec<String> = (1..=8).map(|index| format!("message-{index}")).collect();
        assert_eq!(seen, expected);

        // A cursor form this build does not know is refused, not guessed at.
        assert_eq!(
            log.page(Some(&EventCursor("future:abc".into())), 1),
            Err(SessionError::UnknownCursorForm)
        );
        assert_eq!(
            log.page(Some(&EventCursor("no-separator".into())), 1),
            Err(SessionError::InvalidCursor)
        );
    }
}
