//! Session primitives that keep read-only conversation authority separate from changes.

use changeloop_protocol::{MAX_PROTOCOL_ID_BYTES, SessionId};
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
}
