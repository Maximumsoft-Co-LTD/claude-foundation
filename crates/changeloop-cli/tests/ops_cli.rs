use serde::Deserialize;
use std::{fs, process::Command};

fn cloop(root: &std::path::Path, args: &[&str]) -> std::process::Output {
    let config_home = root.parent().expect("temp project has a parent").join(format!(
        "{}-cloop-config",
        root.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("project")
    ));
    Command::new(env!("CARGO_BIN_EXE_cloop"))
        .current_dir(root)
        .env("CHANGELOOP_CONFIG_HOME", config_home)
        .env("XDG_DATA_HOME", root.join("isolated-data"))
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("OPENAI_API_KEY")
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn migrate_dry_run_apply_and_idempotent_cli() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("foundation.json"), br#"{"version":1}"#).unwrap();
    fs::create_dir(root.path().join(".workflow")).unwrap();
    let dry = cloop(root.path(), &["migrate", "--dry-run"]);
    assert!(dry.status.success());
    let plan: serde_json::Value = serde_json::from_slice(&dry.stdout).unwrap();
    let digest = plan["digest"].as_str().unwrap();
    for _ in 0..2 {
        let applied = cloop(root.path(), &["migrate", "--apply", digest]);
        assert!(
            applied.status.success(),
            "{}",
            String::from_utf8_lossy(&applied.stderr)
        );
    }
    assert!(root.path().join("foundation.json").exists());
    assert!(root.path().join(".workflow").exists());
}

#[test]
fn config_explain_reports_effective_value_and_source_precedence_as_single_json() {
    let root = tempfile::tempdir().unwrap();
    let user_config = root.path().join("isolated-config");
    fs::create_dir_all(&user_config).unwrap();
    fs::write(root.path().join("changeloop.json"), br#"{"mode":"ask"}"#).unwrap();
    fs::write(user_config.join("config.json"), br#"{"mode":"plan"}"#).unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_cloop"))
        .current_dir(root.path())
        .env("CHANGELOOP_CONFIG_HOME", &user_config)
        .env("XDG_DATA_HOME", root.path().join("isolated-data"))
        .env("CHANGELOOP_MODE", "auto")
        .args(["config", "explain", "mode"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let mut deserializer = serde_json::Deserializer::from_slice(&output.stdout);
    let explanation = serde_json::Value::deserialize(&mut deserializer).unwrap();
    deserializer.end().unwrap();
    assert_eq!(explanation["value"], "auto");
    assert_eq!(explanation["selectedSource"], "native-environment");
    assert_eq!(explanation["selectedOrigin"], "process");
    assert!(
        explanation["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|candidate| candidate["source"] == "project" && candidate["value"] == "ask")
    );

    let invalid = cloop(root.path(), &["config", "explain", "../../secret"]);
    assert_eq!(invalid.status.code(), Some(2));
    assert!(invalid.stdout.is_empty());
}

#[test]
fn changed_plan_and_guarded_delete_have_lifecycle_exit_code() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("foundation.json"), b"{}").unwrap();
    let dry = cloop(root.path(), &["migrate", "--dry-run"]);
    let plan: serde_json::Value = serde_json::from_slice(&dry.stdout).unwrap();
    fs::write(root.path().join("foundation.json"), b"{\"changed\":true}").unwrap();
    let changed = cloop(
        root.path(),
        &["migrate", "--apply", plan["digest"].as_str().unwrap()],
    );
    assert_eq!(changed.status.code(), Some(8));

    fs::create_dir_all(root.path().join(".changeloop")).unwrap();
    fs::write(
        root.path().join(".changeloop/privacy-sessions.json"),
        br#"{"active":{"id":"active","active":true,"evidence_refs":0,"data":{},"provenance":[]}}"#,
    )
    .unwrap();
    let guarded = cloop(root.path(), &["privacy", "delete", "active"]);
    assert_eq!(guarded.status.code(), Some(8));
}

#[test]
fn migration_recovery_journal_failures_have_lifecycle_exit_code() {
    let corrupt = tempfile::tempdir().unwrap();
    fs::write(corrupt.path().join("foundation.json"), b"{}").unwrap();
    let dry = cloop(corrupt.path(), &["migrate", "--dry-run"]);
    let plan: serde_json::Value = serde_json::from_slice(&dry.stdout).unwrap();
    fs::create_dir_all(corrupt.path().join(".changeloop")).unwrap();
    fs::write(
        corrupt.path().join(".changeloop/migration-journal.json"),
        b"not-json",
    )
    .unwrap();
    let failed = cloop(
        corrupt.path(),
        &["migrate", "--apply", plan["digest"].as_str().unwrap()],
    );
    assert_eq!(failed.status.code(), Some(8));
    assert!(String::from_utf8_lossy(&failed.stderr).contains("recovery journal"));

    let pending = tempfile::tempdir().unwrap();
    fs::write(pending.path().join("foundation.json"), b"{}").unwrap();
    let first = cloop(pending.path(), &["migrate", "--dry-run"]);
    let first: serde_json::Value = serde_json::from_slice(&first.stdout).unwrap();
    assert!(
        cloop(
            pending.path(),
            &["migrate", "--apply", first["digest"].as_str().unwrap()]
        )
        .status
        .success()
    );
    fs::write(
        pending.path().join("foundation.json"),
        b"{\"changed\":true}",
    )
    .unwrap();
    let second = cloop(pending.path(), &["migrate", "--dry-run"]);
    let second: serde_json::Value = serde_json::from_slice(&second.stdout).unwrap();
    let failed = cloop(
        pending.path(),
        &["migrate", "--apply", second["digest"].as_str().unwrap()],
    );
    assert_eq!(failed.status.code(), Some(8));
    assert!(String::from_utf8_lossy(&failed.stderr).contains("recovery is pending"));
}

#[test]
fn migration_filesystem_failure_has_agent_failure_exit_code() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("foundation.json"), b"{}").unwrap();
    let dry = cloop(root.path(), &["migrate", "--dry-run"]);
    let plan: serde_json::Value = serde_json::from_slice(&dry.stdout).unwrap();
    fs::write(root.path().join(".changeloop"), b"not a directory").unwrap();
    let failed = cloop(
        root.path(),
        &["migrate", "--apply", plan["digest"].as_str().unwrap()],
    );
    assert_eq!(failed.status.code(), Some(4));
}
