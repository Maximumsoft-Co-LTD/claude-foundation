use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

fn cloop(root: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_cloop"))
        .current_dir(root)
        .env("CHANGELOOP_CONFIG_HOME", root.join("isolated-config"))
        .env("XDG_DATA_HOME", root.join("isolated-data"))
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("OPENAI_API_KEY")
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn operational_discovery_and_completions_are_headless() {
    let root = tempfile::tempdir().unwrap();
    for command in [["doctor"].as_slice(), ["models"].as_slice()] {
        let output = cloop(root.path(), command);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap();
    }
    for shell in ["bash", "zsh", "fish"] {
        let output = cloop(root.path(), &["completion", shell]);
        assert!(output.status.success());
        assert!(String::from_utf8(output.stdout).unwrap().contains("cloop"));
    }
    assert_eq!(
        cloop(root.path(), &["completion", "powershell"])
            .status
            .code(),
        Some(2)
    );
    assert_eq!(
        cloop(root.path(), &["auth", "logout", "other"])
            .status
            .code(),
        Some(2)
    );
}

#[test]
fn tampered_update_has_distinct_update_failure_exit_code() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("cloop-target");
    let artifact = root.path().join("artifact");
    let manifest_path = root.path().join("manifest.json");
    fs::write(&target, b"old").unwrap();
    fs::write(&artifact, b"tampered").unwrap();

    let expected = b"expected artifact";
    let key = SigningKey::from_bytes(&[11; 32]);
    let manifest = changeloop_ops::UpdateManifest {
        schema_version: changeloop_ops::UPDATE_MANIFEST_SCHEMA_VERSION,
        version: "9.0.0".into(),
        target_triple: changeloop_ops::current_update_target_triple()
            .unwrap()
            .into(),
        artifact_kind: changeloop_ops::UpdateArtifactKind::StandaloneExecutable,
        artifact_sha256: changeloop_ops::sha256(expected),
        artifact_size: expected.len() as u64,
    };
    let signature = STANDARD.encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes());
    fs::write(
        &manifest_path,
        serde_json::to_vec(&changeloop_ops::SignedUpdateManifest {
            manifest,
            signature,
        })
        .unwrap(),
    )
    .unwrap();
    let public = STANDARD.encode(key.verifying_key().to_bytes());
    let output = cloop(
        root.path(),
        &[
            "update",
            "--manifest",
            manifest_path.to_str().unwrap(),
            "--artifact",
            artifact.to_str().unwrap(),
            "--public-key",
            &public,
            "--target",
            target.to_str().unwrap(),
        ],
    );
    assert_eq!(output.status.code(), Some(9));
    assert_eq!(fs::read(&target).unwrap(), b"old");
}

#[test]
fn completions_are_syntax_checked_and_cover_nested_public_commands() {
    let root = tempfile::tempdir().unwrap();
    let required = [
        "confirm",
        "discard",
        "approve",
        "--accept-provider-data",
        "--dry-run",
        "--channel-manifest",
        "recover",
        "extensions",
        "refresh",
        "--http",
    ];
    for shell in ["bash", "zsh", "fish"] {
        let output = cloop(root.path(), &["completion", shell]);
        assert!(output.status.success());
        let script = String::from_utf8(output.stdout).unwrap();
        for value in required {
            assert!(script.contains(value), "{shell} omitted {value}");
        }
        let mut checker = match Command::new(shell)
            .arg("-n")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => panic!("cannot launch {shell}: {error}"),
        };
        checker
            .stdin
            .take()
            .unwrap()
            .write_all(script.as_bytes())
            .unwrap();
        let checked = checker.wait_with_output().unwrap();
        assert!(
            checked.status.success(),
            "{shell} syntax: {}",
            String::from_utf8_lossy(&checked.stderr)
        );
    }
}

#[test]
fn setup_failure_is_atomic_and_status_models_stay_consistent() {
    let root = tempfile::tempdir().unwrap();
    let setup_path = root.path().join("isolated-config/first-run.json");
    let invalid = cloop(
        root.path(),
        &[
            "setup",
            "--provider",
            "other",
            "--model",
            "model",
            "--sandbox",
            "read-only",
            "--accept-privacy",
            "--accept-provider-data",
        ],
    );
    assert_eq!(invalid.status.code(), Some(2));
    assert!(!setup_path.exists(), "failed setup wrote partial state");

    let valid = cloop(
        root.path(),
        &[
            "setup",
            "--provider",
            "openai",
            "--model",
            "gpt-fixture",
            "--sandbox",
            "read-only",
            "--accept-privacy",
            "--accept-provider-data",
        ],
    );
    assert!(
        valid.status.success(),
        "{}",
        String::from_utf8_lossy(&valid.stderr)
    );
    let setup_status: serde_json::Value =
        serde_json::from_slice(&cloop(root.path(), &["setup", "status"]).stdout).unwrap();
    let models: serde_json::Value =
        serde_json::from_slice(&cloop(root.path(), &["models"]).stdout).unwrap();
    let status: serde_json::Value =
        serde_json::from_slice(&cloop(root.path(), &["status"]).stdout).unwrap();
    assert_eq!(setup_status["setup"]["provider"], "openai");
    assert_eq!(models["selectedProvider"], "openai");
    assert_eq!(models["selectedModel"], "gpt-fixture");
    assert_eq!(status["providerConfigured"], true);
    assert_eq!(status["providerReady"], false);
    assert_eq!(status["onboardingRequired"], true);

    let invalid_auth = cloop(root.path(), &["auth", "login", "other"]);
    assert_eq!(invalid_auth.status.code(), Some(2));
    assert!(
        !root
            .path()
            .join("isolated-config/auth-profiles.json")
            .exists()
    );
}

#[test]
fn signed_update_install_and_interrupted_recovery_are_end_to_end() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("cloop-target");
    let artifact = root.path().join("artifact");
    let manifest_path = root.path().join("manifest.json");
    fs::write(&target, b"old executable").unwrap();
    let candidate = fs::read(env!("CARGO_BIN_EXE_cloop")).unwrap();
    fs::write(&artifact, &candidate).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&artifact, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let key = SigningKey::from_bytes(&[17; 32]);
    let manifest = changeloop_ops::UpdateManifest {
        schema_version: changeloop_ops::UPDATE_MANIFEST_SCHEMA_VERSION,
        version: "99.0.0".into(),
        target_triple: changeloop_ops::current_update_target_triple()
            .unwrap()
            .into(),
        artifact_kind: changeloop_ops::UpdateArtifactKind::StandaloneExecutable,
        artifact_sha256: changeloop_ops::sha256(&candidate),
        artifact_size: candidate.len() as u64,
    };
    let signature = STANDARD.encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes());
    fs::write(
        &manifest_path,
        serde_json::to_vec(&changeloop_ops::SignedUpdateManifest {
            manifest,
            signature,
        })
        .unwrap(),
    )
    .unwrap();
    let public = STANDARD.encode(key.verifying_key().to_bytes());
    let channel_manifest = changeloop_ops::UpdateChannelManifest {
        version: changeloop_ops::UPDATE_MANIFEST_SCHEMA_VERSION,
        releases: vec![changeloop_ops::UpdateRelease {
            version: "99.0.0".into(),
            channel: "stable".into(),
            target_triple: changeloop_ops::current_update_target_triple()
                .unwrap()
                .into(),
            artifact_kind: changeloop_ops::UpdateArtifactKind::StandaloneExecutable,
            manifest_source: manifest_path.to_string_lossy().into_owned(),
            artifact_source: artifact.to_string_lossy().into_owned(),
        }],
    };
    let channel_signature = STANDARD.encode(
        key.sign(&serde_json::to_vec(&channel_manifest).unwrap())
            .to_bytes(),
    );
    let channel_path = root.path().join("channel.json");
    fs::write(
        &channel_path,
        serde_json::to_vec(&changeloop_ops::SignedUpdateChannelManifest {
            manifest: channel_manifest,
            signature: channel_signature,
        })
        .unwrap(),
    )
    .unwrap();
    let checked = cloop(
        root.path(),
        &[
            "update",
            "check",
            "--channel-manifest",
            channel_path.to_str().unwrap(),
            "--public-key",
            &public,
            "--channel",
            "stable",
            "--offline",
        ],
    );
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
    let checked: serde_json::Value = serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(checked["signatureVerified"], true);
    assert_eq!(checked["update"]["version"], "99.0.0");
    let installed = cloop(
        root.path(),
        &[
            "update",
            "--manifest",
            manifest_path.to_str().unwrap(),
            "--artifact",
            artifact.to_str().unwrap(),
            "--public-key",
            &public,
            "--target",
            target.to_str().unwrap(),
        ],
    );
    assert!(
        installed.status.success(),
        "{}",
        String::from_utf8_lossy(&installed.stderr)
    );
    assert_eq!(fs::read(&target).unwrap(), candidate);

    // Recreate an interruption after backup but before replacement promotion.
    let backup = root.path().join(".cloop-target.update-backup");
    fs::rename(&target, &backup).unwrap();
    fs::write(
        root.path().join(".cloop-target.update-stage"),
        b"future executable",
    )
    .unwrap();
    fs::write(
        root.path().join(".cloop-target.update-journal.json"),
        serde_json::to_vec(&serde_json::json!({
            "state":"prepared",
            "original_sha256":changeloop_ops::sha256(&candidate),
            "replacement_sha256":changeloop_ops::sha256(b"future executable"),
            "version":"100.0.0"
        }))
        .unwrap(),
    )
    .unwrap();
    let recovered = cloop(
        root.path(),
        &["update", "recover", "--target", target.to_str().unwrap()],
    );
    assert!(
        recovered.status.success(),
        "{}",
        String::from_utf8_lossy(&recovered.stderr)
    );
    assert_eq!(fs::read(&target).unwrap(), candidate);
    assert!(
        !root
            .path()
            .join(".cloop-target.update-journal.json")
            .exists()
    );
}

#[cfg(unix)]
#[test]
fn legacy_alias_invokes_the_same_cli_surface() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let alias = root.path().join("claude-foundation");
    symlink(env!("CARGO_BIN_EXE_cloop"), &alias).unwrap();
    let output = Command::new(alias).arg("--version").output().unwrap();
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("changeloop-cli")
    );
}
