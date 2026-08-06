use super::*;
use changeloop_policy::PermissionKind;
use changeloop_protocol::SessionId;
use changeloop_runtime::{PermissionGate, ToolDispatcher};
use changeloop_session::SessionKind;
use serde_json::json;
use std::fs;

fn conversation_session() -> Session {
    Session::conversation(SessionId::new())
}

fn policy_call(path: &str, mutating: bool) -> ToolCall {
    ToolCall {
        id: changeloop_protocol::ToolCallId::new(),
        name: if mutating {
            "write_file".into()
        } else {
            "read_file".into()
        },
        arguments: json!({ "path": path }),
        permission: if mutating {
            PermissionKind::FilesystemWrite
        } else {
            PermissionKind::FilesystemRead
        },
        mutating,
    }
}

#[test]
fn runtime_wiring_types_are_public_and_constructible() {
    let execution = ProviderExecution::new(
        ProviderKind::OpenAi,
        "gpt-4.1".into(),
        AuthProfile::explicit(ProviderKind::OpenAi, "fixture-key").unwrap(),
        ReqwestTransport::default(),
        None,
    );
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _provider = RuntimeProvider::new(
        execution,
        CancellationToken::default(),
        runtime.handle().clone(),
        RiskTier::Medium,
    );
    let _gate = RuntimeGate::read_only(RuntimePolicy::default());
}

#[test]
fn read_only_tools_require_a_conversation_session() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join(".changeloop/artifacts")).unwrap();
    let change = Session {
        id: SessionId::new(),
        kind: SessionKind::Change,
        change_state: Some(ChangeState::Confirmed),
    };
    assert!(matches!(
        RuntimeTools::read_only(
            root.path(),
            &root.path().join(".changeloop/artifacts"),
            &change,
            RuntimePolicy::default(),
        ),
        Err(SurfaceError::Invalid(_))
    ));
}

#[test]
fn read_only_tools_refuse_mutation() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join(".changeloop/artifacts")).unwrap();
    fs::write(root.path().join("sample.txt"), "hello").unwrap();
    let mut tools = RuntimeTools::read_only(
        root.path(),
        &root.path().join(".changeloop/artifacts"),
        &conversation_session(),
        RuntimePolicy {
            filesystem_write: RuleAction::Allow,
            ..RuntimePolicy::default()
        },
    )
    .unwrap();
    let call = ToolCall {
        id: changeloop_protocol::ToolCallId::new(),
        name: "write_file".into(),
        arguments: json!({
            "schema_version": 1,
            "path": "sample.txt",
            "contents": "mutated"
        }),
        permission: PermissionKind::FilesystemWrite,
        mutating: true,
    };
    let error = tools.dispatch(&call).unwrap_err();
    assert!(
        error.contains("mutation capability is unavailable"),
        "unexpected error: {error}"
    );
}

#[test]
fn read_only_gate_denies_writes_and_process_tools() {
    let policy = RuntimePolicy {
        mode: ExecutionMode::Yolo,
        filesystem_write: RuleAction::Allow,
        shell: RuleAction::Allow,
        test: RuleAction::Allow,
        ..RuntimePolicy::default()
    };
    let mut gate = RuntimeGate::read_only(policy.clone());
    assert_eq!(
        gate.decide(&policy_call("src/lib.rs", true)),
        DecisionAction::Deny
    );
    for (name, permission, mutating) in [
        ("shell", PermissionKind::Shell, true),
        ("run_test", PermissionKind::Test, false),
        ("spawn_job", PermissionKind::Shell, true),
    ] {
        let call = ToolCall {
            id: changeloop_protocol::ToolCallId::new(),
            name: name.into(),
            arguments: json!({
                "program":"/usr/bin/true",
                "arguments":[],
                "sandbox":"required",
                "schema_version":1,
                "timeout_ms":1000,
                "inline_bytes":1024,
                "artifact_bytes":4096
            }),
            permission,
            mutating,
        };
        assert_eq!(
            gate.decide(&call),
            DecisionAction::Deny,
            "conversation unexpectedly authorized {name}"
        );
    }
    let mut confirmed = RuntimeGate::new(policy, LifecycleAuthority::ConfirmedChange);
    assert_eq!(
        confirmed.decide(&policy_call("src/lib.rs", true)),
        DecisionAction::Allow
    );
}
