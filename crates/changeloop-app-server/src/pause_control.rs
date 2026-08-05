//! Durable validation around process-local paused agent runtimes.

use changeloop_protocol::{OperationId, SessionId};
pub use changeloop_runtime::ResumeBinding;
use changeloop_storage::{
    RuntimePauseKind, RuntimePauseState, Storage, StorageError, StoredRuntimePause,
};
use serde_json::{Value, json};
use thiserror::Error;

pub struct PauseRequest {
    pub session_id: SessionId,
    pub operation_id: OperationId,
    pub kind: RuntimePauseKind,
    pub detail: Value,
    pub binding: ResumeBinding,
    pub checkpoint: Value,
    pub created_at_ms: u64,
}

#[derive(Debug, Error)]
pub enum PauseControlError {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("paused runtime payload is invalid: {0}")]
    InvalidPayload(#[from] serde_json::Error),
    #[error("paused runtime workspace, tools, or provider binding changed")]
    ResumeBindingMismatch,
    #[error("paused runtime is no longer live; explicit recovery or a fresh run is required")]
    RuntimeNotLive,
}

pub fn persist(storage: &Storage, request: &PauseRequest) -> Result<(), PauseControlError> {
    let payload = json!({
        "detail": request.detail,
        "binding": request.binding,
        "checkpoint": request.checkpoint,
        "liveRuntimeRequired": true,
    });
    storage.save_runtime_pause(
        &request.session_id,
        &request.operation_id,
        request.kind,
        &payload,
        request.created_at_ms,
    )?;
    Ok(())
}

pub fn validate_live_response(
    storage: &Storage,
    operation_id: &OperationId,
    expected_kind: RuntimePauseKind,
    current_binding: &ResumeBinding,
    live_runtime_present: bool,
) -> Result<StoredRuntimePause, PauseControlError> {
    let pause = storage.runtime_pause(operation_id)?;
    if pause.kind != expected_kind {
        return Err(StorageError::PauseKindMismatch(operation_id.clone()).into());
    }
    if pause.state != RuntimePauseState::Waiting {
        return Err(StorageError::PauseNotWaiting(operation_id.clone()).into());
    }
    let stored: ResumeBinding = serde_json::from_value(pause.payload["binding"].clone())?;
    if &stored != current_binding {
        return Err(PauseControlError::ResumeBindingMismatch);
    }
    if !live_runtime_present {
        return Err(PauseControlError::RuntimeNotLive);
    }
    Ok(pause)
}

pub fn resolve(
    storage: &Storage,
    operation_id: &OperationId,
    expected_kind: RuntimePauseKind,
    response: &Value,
    responded_at_ms: u64,
) -> Result<(), PauseControlError> {
    storage.respond_runtime_pause_kind(operation_id, expected_kind, response, responded_at_ms)?;
    Ok(())
}

pub fn cancel(
    storage: &mut Storage,
    operation_id: &OperationId,
    reason: &str,
    cancelled_at_ms: u64,
) -> Result<Value, PauseControlError> {
    let marker = storage.cancel_runtime_pause(operation_id, reason, cancelled_at_ms)?;
    Ok(json!({
        "operationId": operation_id,
        "cancelled": true,
        "terminalEventId": marker.id,
        "cursor": marker.cursor,
    }))
}

pub fn list(storage: &Storage) -> Result<Value, PauseControlError> {
    let pauses = storage
        .runtime_pauses()?
        .into_iter()
        .map(|pause| {
            json!({
                "sessionId": pause.session_id,
                "operationId": pause.operation_id,
                "kind": match pause.kind {
                    RuntimePauseKind::Permission => "permission",
                    RuntimePauseKind::Question => "question",
                    RuntimePauseKind::DoomLoop => "doom_loop",
                },
                "state": match pause.state {
                    RuntimePauseState::Waiting => "waiting",
                    RuntimePauseState::Resolved => "resolved",
                    RuntimePauseState::Cancelled => "cancelled",
                    RuntimePauseState::Interrupted => "interrupted",
                },
                "detail": pause.payload["detail"],
                "createdAtMs": pause.created_at_ms,
                "updatedAtMs": pause.updated_at_ms,
            })
        })
        .collect::<Vec<_>>();
    let active = pauses
        .iter()
        .filter(|pause| pause["state"] == "waiting")
        .count();
    Ok(json!({"operations":pauses,"active":active}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(revision: &str) -> ResumeBinding {
        ResumeBinding {
            workspace_revision: revision.into(),
            tool_schema_sha256: "tools-v1".into(),
            provider_metadata: json!({"provider":"openai","model":"test"}),
        }
    }

    #[test]
    fn response_requires_live_runtime_and_exact_revision_binding() {
        let storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session");
        let operation = OperationId::from_stable("operation");
        storage.create_session(&session, 1).unwrap();
        storage.begin_operation(&session, &operation, 2).unwrap();
        persist(
            &storage,
            &PauseRequest {
                session_id: session,
                operation_id: operation.clone(),
                kind: RuntimePauseKind::Permission,
                detail: json!({"callId":"call-1"}),
                binding: binding("revision-a"),
                checkpoint: json!({"schemaVersion":1}),
                created_at_ms: 3,
            },
        )
        .unwrap();
        let pending = list(&storage).unwrap();
        assert_eq!(pending["active"], 1);
        assert_eq!(pending["operations"][0]["operationId"], "operation");
        assert_eq!(pending["operations"][0]["state"], "waiting");
        assert!(matches!(
            validate_live_response(
                &storage,
                &operation,
                RuntimePauseKind::Permission,
                &binding("revision-b"),
                true
            ),
            Err(PauseControlError::ResumeBindingMismatch)
        ));
        assert!(matches!(
            validate_live_response(
                &storage,
                &operation,
                RuntimePauseKind::Permission,
                &binding("revision-a"),
                false
            ),
            Err(PauseControlError::RuntimeNotLive)
        ));
        validate_live_response(
            &storage,
            &operation,
            RuntimePauseKind::Permission,
            &binding("revision-a"),
            true,
        )
        .unwrap();
        resolve(
            &storage,
            &operation,
            RuntimePauseKind::Permission,
            &json!({"allow":true}),
            4,
        )
        .unwrap();
        assert_eq!(list(&storage).unwrap()["active"], 0);
        assert!(matches!(
            resolve(
                &storage,
                &operation,
                RuntimePauseKind::Permission,
                &json!({"allow":false}),
                5
            ),
            Err(PauseControlError::Storage(StorageError::PauseNotWaiting(_)))
        ));
    }
}
