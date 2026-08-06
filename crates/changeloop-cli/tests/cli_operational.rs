use changeloop_protocol::{
    Event, Message, MessageId, MessagePart, MessagePartBody, PartId, PartState, Provenance,
    SessionId,
};
use changeloop_storage::Storage;
use serde::Deserialize;
use std::fs;
use std::process::Command;
use tempfile::tempdir;

fn command(root: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_cloop"));
    command.current_dir(root);
    // Record-auth keys and executor approvals are trust roots: they refuse a
    // path inside the project. Keep the isolated config as a sibling.
    let config_home = root.parent().expect("temp project has a parent").join(format!(
        "{}-cloop-config",
        root.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("project")
    ));
    command.env("CHANGELOOP_CONFIG_HOME", config_home);
    command.env("XDG_DATA_HOME", root.join("isolated-data"));
    command.env_remove("ANTHROPIC_API_KEY");
    command.env_remove("OPENAI_API_KEY");
    command
}

fn assert_single_json(stdout: &[u8]) -> serde_json::Value {
    let mut deserializer = serde_json::Deserializer::from_slice(stdout);
    let value = serde_json::Value::deserialize(&mut deserializer).unwrap();
    deserializer.end().unwrap();
    value
}

#[test]
fn help_and_completion_cover_operational_commands() {
    let root = tempdir().unwrap();
    let help = command(root.path()).arg("--help").output().unwrap();
    assert!(help.status.success());
    let help = String::from_utf8(help.stdout).unwrap();
    for command in [
        "sessions",
        "resume [session]",
        "fork <session>",
        "undo|redo",
        "jobs",
        "prove|review [change]",
        "land <change>",
        "lsp status",
        "formatter status",
        "mcp list|extensions|auth",
    ] {
        assert!(help.contains(command), "help omitted {command}");
    }
    for shell in ["bash", "zsh", "fish"] {
        let output = command(root.path())
            .args(["completion", shell])
            .output()
            .unwrap();
        assert!(output.status.success(), "completion failed for {shell}");
        assert!(String::from_utf8(output.stdout).unwrap().contains("cloop"));
    }
}

#[test]
fn privacy_delete_purges_sqlite_operational_and_privacy_indexes() {
    let root = tempdir().unwrap();
    let state_dir = root.path().join(".changeloop");
    fs::create_dir_all(&state_dir).unwrap();
    let session = SessionId::from_stable("purge-me");
    let mut storage = Storage::open(state_dir.join("state.db")).unwrap();
    storage.create_session(&session, 1).unwrap();
    let secret = "private-prompt-raw-sqlite";
    storage
        .append_event(
            &session,
            2,
            Event::MessageAppended {
                message: Message {
                    schema_version: 1,
                    id: MessageId::new(),
                    session_id: session.clone(),
                    created_at_ms: 2,
                    parts: vec![MessagePart {
                        schema_version: 1,
                        id: PartId::new(),
                        state: PartState::Completed,
                        provenance: Provenance::UserInput,
                        body: MessagePartBody::Text {
                            text: secret.into(),
                        },
                    }],
                },
            },
        )
        .unwrap();
    drop(storage);
    fs::write(
        state_dir.join("operational.json"),
        serde_json::to_vec(&serde_json::json!({
            "sessions":{"purge-me":{"kind":"conversation","prompt":"private prompt","created_at_ms":1}},
            "changes":{},"jobs":{}
        }))
        .unwrap(),
    )
    .unwrap();
    // Simulate interruption immediately after the recoverable journal commit.
    fs::write(
        state_dir.join("privacy-purge.json"),
        serde_json::to_vec(&vec!["purge-me"]).unwrap(),
    )
    .unwrap();
    changeloop_ops::upsert_privacy_session(
        &state_dir.join("privacy-sessions.json"),
        changeloop_ops::PrivacySession {
            id: "purge-me".into(),
            active: false,
            evidence_refs: 0,
            data: serde_json::json!({"prompt":"private prompt"}),
            provenance: vec!["user-input".into()],
        },
    )
    .unwrap();

    let first = command(root.path())
        .args(["privacy", "delete", "purge-me"])
        .spawn()
        .unwrap();
    let second = command(root.path())
        .args(["privacy", "delete", "purge-me"])
        .spawn()
        .unwrap();
    let statuses = [
        first.wait_with_output().unwrap(),
        second.wait_with_output().unwrap(),
    ];
    assert_eq!(
        statuses
            .iter()
            .filter(|output| output.status.success())
            .count(),
        1
    );
    assert!(
        !fs::read_to_string(state_dir.join("operational.json"))
            .unwrap()
            .contains("purge-me")
    );
    assert!(
        changeloop_ops::privacy_export(&state_dir.join("privacy-sessions.json"), "purge-me")
            .is_err()
    );
    let storage = Storage::open(state_dir.join("state.db")).unwrap();
    assert!(storage.replay(&session, None, None).is_err());
    assert!(!state_dir.join("privacy-purge.json").exists());
    drop(storage);
    for path in [state_dir.join("state.db"), state_dir.join("state.db-wal")] {
        if path.is_file() {
            let bytes = fs::read(path).unwrap();
            assert!(
                !bytes
                    .windows(secret.len())
                    .any(|window| window == secret.as_bytes())
            );
        }
    }
}

#[test]
fn privacy_recovery_journal_cannot_bypass_active_reference_guard() {
    let root = tempdir().unwrap();
    let state_dir = root.path().join(".changeloop");
    fs::create_dir_all(&state_dir).unwrap();
    let session = SessionId::from_stable("active-session");
    let storage = Storage::open(state_dir.join("state.db")).unwrap();
    storage.create_session(&session, 1).unwrap();
    drop(storage);
    fs::write(
        state_dir.join("operational.json"),
        serde_json::to_vec(&serde_json::json!({
            "sessions":{"active-session":{"kind":"change","prompt":"retain","created_at_ms":1}},
            "changes":{},"jobs":{}
        }))
        .unwrap(),
    )
    .unwrap();
    changeloop_ops::upsert_privacy_session(
        &state_dir.join("privacy-sessions.json"),
        changeloop_ops::PrivacySession {
            id: "active-session".into(),
            active: true,
            evidence_refs: 1,
            data: serde_json::json!({"prompt":"retain"}),
            provenance: vec!["user-input".into()],
        },
    )
    .unwrap();
    fs::write(
        state_dir.join("privacy-purge.json"),
        serde_json::to_vec(&vec!["active-session"]).unwrap(),
    )
    .unwrap();

    let status = command(root.path())
        .args(["privacy", "delete", "active-session"])
        .status()
        .unwrap();
    assert!(!status.success());
    assert!(
        fs::read_to_string(state_dir.join("operational.json"))
            .unwrap()
            .contains("active-session")
    );
    assert!(
        changeloop_ops::privacy_export(&state_dir.join("privacy-sessions.json"), "active-session")
            .is_ok()
    );
    let storage = Storage::open(state_dir.join("state.db")).unwrap();
    assert!(storage.replay(&session, None, None).is_ok());
}

#[test]
fn privacy_recovery_journal_cannot_expand_the_requested_session_scope() {
    let root = tempdir().unwrap();
    let state_dir = root.path().join(".changeloop");
    fs::create_dir_all(&state_dir).unwrap();
    for id in ["requested-session", "different-session"] {
        changeloop_ops::upsert_privacy_session(
            &state_dir.join("privacy-sessions.json"),
            changeloop_ops::PrivacySession {
                id: id.into(),
                active: false,
                evidence_refs: 0,
                data: serde_json::json!({"prompt":id}),
                provenance: vec!["user-input".into()],
            },
        )
        .unwrap();
    }
    fs::write(
        state_dir.join("privacy-purge.json"),
        serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "requested": "different-session",
            "ids": ["different-session"]
        }))
        .unwrap(),
    )
    .unwrap();

    let output = command(root.path())
        .args(["privacy", "delete", "requested-session"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(8));
    assert!(output.stdout.is_empty());
    for id in ["requested-session", "different-session"] {
        assert!(
            changeloop_ops::privacy_export(&state_dir.join("privacy-sessions.json"), id).is_ok(),
            "mismatched recovery journal deleted {id}"
        );
    }
}

#[test]
fn exit_codes_distinguish_invalid_auth_and_lifecycle_rejection() {
    let root = tempdir().unwrap();
    assert_eq!(
        command(root.path())
            .args(["unknown", "arguments"])
            .status()
            .unwrap()
            .code(),
        Some(2)
    );
    assert_eq!(
        command(root.path())
            .args(["ask", "inspect only"])
            .status()
            .unwrap()
            .code(),
        Some(7)
    );
    assert_eq!(
        command(root.path()).arg("undo").status().unwrap().code(),
        Some(8)
    );
}

#[test]
fn public_arguments_fail_closed_without_output_or_option_ambiguity() {
    let root = tempdir().unwrap();
    let long_identifier = "x".repeat(257);
    for arguments in [
        vec!["ask".into(), "".into()],
        vec!["ask".into(), "line\ncontrol".into()],
        vec!["resume".into(), "../escape".into()],
        vec!["resume".into(), long_identifier],
        vec!["auth".into(), "logout".into(), "unknown-provider".into()],
        vec![
            "setup".into(),
            "--model".into(),
            "model".into(),
            "--provider".into(),
            "openai".into(),
            "--sandbox".into(),
            "read-only".into(),
            "--accept-privacy".into(),
            "--accept-provider-data".into(),
        ],
    ] {
        let output = command(root.path()).args(arguments).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert_eq!(stderr.lines().count(), 1);
    }
    assert!(!root.path().join("isolated-config/first-run.json").exists());
}

#[cfg(unix)]
#[test]
fn non_unicode_argv_is_a_typed_invalid_input_not_a_panic() {
    use std::os::unix::ffi::OsStringExt;

    let root = tempdir().unwrap();
    let output = command(root.path())
        .arg(std::ffi::OsString::from_vec(vec![0xff, b'x']))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert_eq!(
        stderr.trim(),
        "command-line arguments must be valid Unicode"
    );
    assert!(!stderr.to_ascii_lowercase().contains("panic"));

    let status = command(root.path())
        .env(
            "UNRELATED_INVALID_UNICODE",
            std::ffi::OsString::from_vec(vec![0xff]),
        )
        .arg("status")
        .output()
        .unwrap();
    assert!(status.status.success());
    assert_single_json(&status.stdout);
}

#[test]
fn structured_read_commands_emit_exactly_one_json_value() {
    let root = tempdir().unwrap();
    for arguments in [
        &["status"][..],
        &["sessions"][..],
        &["jobs"][..],
        &["models"][..],
        &["setup", "status"][..],
        &["privacy", "inspect"][..],
        &["mcp", "list"][..],
        &["mcp", "extensions"][..],
    ] {
        let output = command(root.path()).args(arguments).output().unwrap();
        assert!(
            output.status.success(),
            "{:?}: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr)
        );
        assert_single_json(&output.stdout);
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn stderr_redacts_configured_secrets_and_unknown_command_points_to_help() {
    let root = tempdir().unwrap();
    let secret = "stderr-secret-canary";
    let output = command(root.path())
        .env("OPENAI_API_KEY", secret)
        .args(["mcp", "extensions", "run", secret])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(!stderr.contains(secret));
    assert!(stderr.contains("[REDACTED]"));
    assert_eq!(stderr.lines().count(), 1);

    let unknown = command(root.path())
        .args(["definitely-unknown", "argument"])
        .output()
        .unwrap();
    assert_eq!(unknown.status.code(), Some(2));
    assert!(unknown.stdout.is_empty());
    assert_eq!(
        String::from_utf8(unknown.stderr).unwrap().trim(),
        "invalid command; run 'cloop --help'"
    );
}

#[test]
fn omitted_session_selects_newest_by_timestamp_not_identifier_order() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join(".changeloop")).unwrap();
    fs::write(
        root.path().join(".changeloop/operational.json"),
        r#"{
          "sessions": {
            "z-older": {"kind":"conversation","prompt":"old","created_at_ms":1},
            "a-newer": {"kind":"conversation","prompt":"new","created_at_ms":2}
          },
          "changes": {}, "jobs": {}
        }"#,
    )
    .unwrap();
    let output = command(root.path()).arg("resume").output().unwrap();
    assert!(output.status.success());
    let value = assert_single_json(&output.stdout);
    assert_eq!(value["sessionId"], "a-newer");
}

#[test]
fn mcp_registry_mutations_are_single_json_and_reject_credential_bearing_urls() {
    let root = tempdir().unwrap();
    let added = command(root.path())
        .args(["mcp", "add", "local", "stdio", "./bin/server"])
        .output()
        .unwrap();
    assert!(added.status.success());
    assert_eq!(assert_single_json(&added.stdout)["added"], true);

    for target in [
        "http://example.test/messages",
        "https://user:secret@example.test/messages",
        "https://example.test/messages?token=secret",
    ] {
        let rejected = command(root.path())
            .args(["mcp", "add", "remote", "http", target])
            .output()
            .unwrap();
        assert_eq!(rejected.status.code(), Some(2));
        assert!(rejected.stdout.is_empty());
        let registry: serde_json::Value =
            serde_json::from_slice(&fs::read(root.path().join(".changeloop/mcp.json")).unwrap())
                .unwrap();
        assert!(registry["servers"].get("remote").is_none());
    }

    let removed = command(root.path())
        .args(["mcp", "remove", "local"])
        .output()
        .unwrap();
    assert!(removed.status.success());
    assert_eq!(assert_single_json(&removed.stdout)["removed"], true);
}

#[test]
fn conversation_attempt_does_not_mutate_repository_content() {
    let root = tempdir().unwrap();
    Command::new("git")
        .args(["init", "-q"])
        .current_dir(root.path())
        .status()
        .unwrap();
    fs::write(root.path().join("tracked.txt"), "before").unwrap();
    Command::new("git")
        .args(["add", "tracked.txt"])
        .current_dir(root.path())
        .status()
        .unwrap();
    Command::new("git")
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-qm",
            "initial",
        ])
        .current_dir(root.path())
        .status()
        .unwrap();

    let status = command(root.path())
        .args(["ask", "explain tracked.txt"])
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(7));
    assert_eq!(
        fs::read_to_string(root.path().join("tracked.txt")).unwrap(),
        "before"
    );
    let diff = Command::new("git")
        .args(["diff", "--exit-code", "--", "tracked.txt"])
        .current_dir(root.path())
        .status()
        .unwrap();
    assert!(diff.success());
}

#[test]
fn resume_and_fork_preserve_read_only_session_authority() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join(".changeloop")).unwrap();
    fs::write(
        root.path().join(".changeloop/operational.json"),
        r#"{
          "sessions": {
            "source": {
              "kind": "change",
              "prompt": "inspect and implement",
              "created_at_ms": 1
            }
          },
          "changes": {},
          "jobs": {}
        }"#,
    )
    .unwrap();

    let resumed = command(root.path())
        .args(["resume", "source"])
        .output()
        .unwrap();
    assert!(resumed.status.success());
    let resumed: serde_json::Value = serde_json::from_slice(&resumed.stdout).unwrap();
    assert_eq!(resumed["sessionId"], "source");
    assert_eq!(resumed["resumed"], false);
    assert_eq!(resumed["inspected"], true);
    assert_eq!(resumed["runtimeState"], "not_connected");
    assert_eq!(resumed["mutationAllowed"], false);

    let forked = command(root.path())
        .args(["fork", "source"])
        .output()
        .unwrap();
    assert!(forked.status.success());
    let forked: serde_json::Value = serde_json::from_slice(&forked.stdout).unwrap();
    assert_eq!(forked["sessionKind"], "conversation");
    assert_eq!(forked["mutationAllowed"], false);
    let state: serde_json::Value = serde_json::from_slice(
        &fs::read(root.path().join(".changeloop/operational.json")).unwrap(),
    )
    .unwrap();
    let fork_id = forked["sessionId"].as_str().unwrap();
    assert_eq!(state["sessions"][fork_id]["parent_session_id"], "source");
    assert_eq!(state["sessions"][fork_id]["kind"], "conversation");
    assert_eq!(state["changes"], serde_json::json!({}));
}
