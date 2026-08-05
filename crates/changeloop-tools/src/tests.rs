use super::*;
use changeloop_policy::{ExecutionMode, LifecycleAuthority, RuleAction};
use changeloop_project::{MutationLease, WorkspaceRevision};
use std::thread;
use tempfile::tempdir;

fn runtime(root: &Path, artifacts: &Path) -> ToolRuntime {
    ToolRuntime::new(
        root,
        artifacts,
        ToolPolicy {
            mode: ExecutionMode::Auto,
            configured_action: RuleAction::Allow,
            lifecycle_authority: LifecycleAuthority::ConfirmedChange,
            hard_boundaries: Vec::new(),
        },
    )
    .unwrap()
}

fn limits() -> OutputLimits {
    OutputLimits {
        inline_bytes: 4,
        artifact_bytes: 16,
    }
}

#[test]
fn scoped_read_list_and_search_do_not_follow_outside_paths() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    fs::create_dir(root.path().join("src")).unwrap();
    fs::write(root.path().join("src/a.txt"), "needle one\nother").unwrap();
    let tools = runtime(root.path(), artifacts.path());

    assert_eq!(tools.read(Path::new("src/a.txt"), 6).unwrap(), b"needle");
    assert_eq!(
        tools.list(Path::new("src")).unwrap(),
        [PathBuf::from("src/a.txt")]
    );
    assert_eq!(
        tools.search(Path::new("src"), "needle", 10).unwrap().len(),
        1
    );
    assert!(matches!(
        tools.read(Path::new("../outside"), 10),
        Err(ToolError::PathOutsideScope(_))
    ));
}

#[test]
fn scoped_read_handles_the_largest_limit_without_overflow() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    fs::write(root.path().join("small.txt"), b"complete").unwrap();
    let tools = runtime(root.path(), artifacts.path());

    assert_eq!(
        tools.read(Path::new("small.txt"), usize::MAX).unwrap(),
        b"complete"
    );
}

#[test]
fn writes_and_patches_require_current_revision_and_precondition() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let locks = tempdir().unwrap();
    fs::write(root.path().join("file.txt"), "before").unwrap();
    let paths = [PathBuf::from("file.txt")];
    let expected = WorkspaceRevision::capture(root.path(), "head", paths.clone()).unwrap();
    let lease = MutationLease::acquire(
        locks.path(),
        root.path(),
        100,
        expected.clone(),
        paths.clone(),
    )
    .unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let before_hash = format!("{:x}", Sha256::digest(b"before"));
    assert!(matches!(
        tools.apply_patch(
            &PatchWrite {
                path: "file.txt".into(),
                expected_sha256: "not-a-digest".into(),
                replacement: b"must-not-land".to_vec(),
            },
            &lease,
            50,
            &expected,
        ),
        Err(ToolError::InvalidExpectedHash)
    ));
    assert!(matches!(
        tools.apply_patch(
            &PatchWrite {
                path: "file.txt".into(),
                expected_sha256: "0".repeat(64),
                replacement: b"must-not-land".to_vec(),
            },
            &lease,
            50,
            &expected,
        ),
        Err(ToolError::PatchPrecondition { .. })
    ));
    assert_eq!(fs::read(root.path().join("file.txt")).unwrap(), b"before");
    assert!(
        fs::read_dir(root.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".changeloop-tmp-")),
        "failed patch preconditions must remove staged temporary files"
    );
    tools
        .apply_patch(
            &PatchWrite {
                path: "file.txt".into(),
                expected_sha256: before_hash,
                replacement: b"after".to_vec(),
            },
            &lease,
            50,
            &expected,
        )
        .unwrap();
    assert_eq!(fs::read(root.path().join("file.txt")).unwrap(), b"after");

    let changed = WorkspaceRevision::capture(root.path(), "head", paths).unwrap();
    assert!(matches!(
        tools.write(Path::new("file.txt"), b"overwrite", &lease, 51, &changed),
        Err(ToolError::Revision(MutationError::Conflict(_)))
    ));
}

#[cfg(unix)]
#[test]
fn delete_and_rename_are_preconditioned_noclobber_and_symlink_safe() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let locks = tempdir().unwrap();
    fs::write(root.path().join("delete.txt"), "delete-me").unwrap();
    let delete_paths = [PathBuf::from("delete.txt")];
    let delete_revision =
        WorkspaceRevision::capture(root.path(), "head", delete_paths.clone()).unwrap();
    let delete_lease = MutationLease::acquire(
        locks.path(),
        root.path(),
        100,
        delete_revision.clone(),
        delete_paths,
    )
    .unwrap();
    let tools = runtime(root.path(), artifacts.path());
    assert!(matches!(
        tools.delete_file(
            Path::new("delete.txt"),
            &"0".repeat(64),
            &delete_lease,
            50,
            &delete_revision
        ),
        Err(ToolError::PatchPrecondition { .. })
    ));
    assert!(root.path().join("delete.txt").is_file());
    let delete_hash = format!("{:x}", Sha256::digest(b"delete-me"));
    assert_eq!(
        tools
            .delete_file(
                Path::new("delete.txt"),
                &delete_hash,
                &delete_lease,
                50,
                &delete_revision
            )
            .unwrap(),
        delete_hash
    );
    assert!(!root.path().join("delete.txt").exists());
    drop(delete_lease);

    fs::write(root.path().join("source.txt"), "rename-me").unwrap();
    fs::write(root.path().join("occupied.txt"), "preserve").unwrap();
    symlink(
        root.path().join("occupied.txt"),
        root.path().join("symlink.txt"),
    )
    .unwrap();
    let rename_paths = [
        PathBuf::from("source.txt"),
        PathBuf::from("occupied.txt"),
        PathBuf::from("symlink.txt"),
        PathBuf::from("renamed.txt"),
    ];
    let rename_revision =
        WorkspaceRevision::capture(root.path(), "head", rename_paths.clone()).unwrap();
    let rename_lease = MutationLease::acquire(
        locks.path(),
        root.path(),
        100,
        rename_revision.clone(),
        rename_paths,
    )
    .unwrap();
    let rename_hash = format!("{:x}", Sha256::digest(b"rename-me"));
    assert!(matches!(
        tools.rename_file(
            Path::new("source.txt"),
            Path::new("occupied.txt"),
            &rename_hash,
            &rename_lease,
            50,
            &rename_revision
        ),
        Err(ToolError::DestinationExists(_))
    ));
    assert_eq!(
        fs::read_to_string(root.path().join("occupied.txt")).unwrap(),
        "preserve"
    );
    assert!(matches!(
        tools.rename_file(
            Path::new("source.txt"),
            Path::new("symlink.txt"),
            &rename_hash,
            &rename_lease,
            50,
            &rename_revision
        ),
        Err(ToolError::Symlink(_))
    ));
    tools
        .rename_file(
            Path::new("source.txt"),
            Path::new("renamed.txt"),
            &rename_hash,
            &rename_lease,
            50,
            &rename_revision,
        )
        .unwrap();
    assert!(!root.path().join("source.txt").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("renamed.txt")).unwrap(),
        "rename-me"
    );
}

#[cfg(unix)]
#[test]
fn case_only_rename_preserves_content_on_sensitive_and_insensitive_filesystems() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let locks = tempdir().unwrap();
    fs::write(root.path().join("case.txt"), "case-content").unwrap();
    let paths = [PathBuf::from("case.txt"), PathBuf::from("CASE.txt")];
    let revision = WorkspaceRevision::capture(root.path(), "head", paths.clone()).unwrap();
    let lease =
        MutationLease::acquire(locks.path(), root.path(), 100, revision.clone(), paths).unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let hash = format!("{:x}", Sha256::digest(b"case-content"));
    tools
        .rename_file(
            Path::new("case.txt"),
            Path::new("CASE.txt"),
            &hash,
            &lease,
            50,
            &revision,
        )
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("CASE.txt")).unwrap(),
        "case-content"
    );
}

#[cfg(unix)]
#[test]
fn rename_commit_never_clobbers_a_destination_created_after_preflight() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("source.txt"), "source").unwrap();
    let root_handle = File::open(root.path()).unwrap();
    let (source_parent, source_name) =
        secure_parent_beneath(&root_handle, Path::new("source.txt"), false).unwrap();
    let (destination_parent, destination_name) =
        secure_parent_beneath(&root_handle, Path::new("destination.txt"), false).unwrap();
    assert!(!root.path().join("destination.txt").exists());

    fs::write(root.path().join("destination.txt"), "external").unwrap();
    assert_ne!(
        renameat_noreplace(
            &source_parent,
            &source_name,
            &destination_parent,
            &destination_name,
        ),
        0
    );
    assert_eq!(
        std::io::Error::last_os_error().kind(),
        std::io::ErrorKind::AlreadyExists
    );
    assert_eq!(
        fs::read_to_string(root.path().join("source.txt")).unwrap(),
        "source"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("destination.txt")).unwrap(),
        "external"
    );
}

#[cfg(unix)]
#[test]
fn descriptor_relative_mutations_support_non_utf8_names_when_the_filesystem_does() {
    use std::os::unix::ffi::OsStringExt;

    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let locks = tempdir().unwrap();
    let source = PathBuf::from(std::ffi::OsString::from_vec(b"source-\xff".to_vec()));
    let destination = PathBuf::from(std::ffi::OsString::from_vec(b"destination-\xfe".to_vec()));
    if let Err(error) = fs::write(root.path().join(&source), "non-utf8") {
        if error.raw_os_error() == Some(libc::EILSEQ) {
            // APFS rejects this byte sequence before Changeloop sees it.
            return;
        }
        panic!("failed to create non-UTF-8 fixture: {error}");
    }
    let paths = [source.clone(), destination.clone()];
    let revision = WorkspaceRevision::capture(root.path(), "head", paths.clone()).unwrap();
    let lease =
        MutationLease::acquire(locks.path(), root.path(), 100, revision.clone(), paths).unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let hash = format!("{:x}", Sha256::digest(b"non-utf8"));
    tools
        .rename_file(&source, &destination, &hash, &lease, 50, &revision)
        .unwrap();
    assert_eq!(
        fs::read(root.path().join(&destination)).unwrap(),
        b"non-utf8"
    );
}

#[test]
fn rename_creates_scoped_nested_parents_without_touching_siblings() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let locks = tempdir().unwrap();
    fs::write(root.path().join("source.txt"), "nested").unwrap();
    fs::write(root.path().join("sibling.txt"), "preserve").unwrap();
    let destination = PathBuf::from("nested/deep/destination.txt");
    let paths = [PathBuf::from("source.txt"), destination.clone()];
    let revision = WorkspaceRevision::capture(root.path(), "head", paths.clone()).unwrap();
    let lease =
        MutationLease::acquire(locks.path(), root.path(), 100, revision.clone(), paths).unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let hash = format!("{:x}", Sha256::digest(b"nested"));
    tools
        .rename_file(
            Path::new("source.txt"),
            &destination,
            &hash,
            &lease,
            50,
            &revision,
        )
        .unwrap();
    assert_eq!(fs::read(root.path().join(destination)).unwrap(), b"nested");
    assert_eq!(
        fs::read(root.path().join("sibling.txt")).unwrap(),
        b"preserve"
    );
}

#[cfg(unix)]
#[test]
fn dirfd_operations_resist_root_replacement_symlinks_and_external_hardlinks() {
    use std::os::unix::fs::symlink;

    let container = tempdir().unwrap();
    let root = container.path().join("root");
    let moved = container.path().join("moved-root");
    let outside = container.path().join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(root.join("owned.txt"), "owned").unwrap();
    fs::write(outside.join("owned.txt"), "outside").unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(&root, artifacts.path());

    symlink(&outside, root.join("escape")).unwrap();
    assert!(
        secure_atomic_write_beneath(
            &tools.root_handle,
            Path::new("escape/escaped.txt"),
            b"must-not-escape"
        )
        .is_err()
    );
    assert!(!outside.join("escaped.txt").exists());

    fs::rename(&root, &moved).unwrap();
    symlink(&outside, &root).unwrap();
    assert_eq!(tools.read(Path::new("owned.txt"), 32).unwrap(), b"owned");
    secure_atomic_write_beneath(&tools.root_handle, Path::new("owned.txt"), b"updated").unwrap();
    assert_eq!(fs::read(moved.join("owned.txt")).unwrap(), b"updated");
    assert_eq!(fs::read(outside.join("owned.txt")).unwrap(), b"outside");

    let external = outside.join("secret.txt");
    fs::write(&external, "secret").unwrap();
    fs::hard_link(&external, moved.join("linked.txt")).unwrap();
    assert!(matches!(
        tools.read(Path::new("linked.txt"), 32),
        Err(ToolError::Hardlink(_))
    ));
}

#[test]
fn process_filters_secrets_and_spills_bounded_output_to_artifact() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec![
            "-c".into(),
            "printf '%s:%s' \"$SAFE\" \"${API_TOKEN-unset}\"".into(),
        ],
        environment: BTreeMap::from([
            ("SAFE".into(), "visible".into()),
            ("API_TOKEN".into(), "secret".into()),
        ]),
        timeout: Duration::from_secs(2),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::BestEffort,
        limits: limits(),
    };
    let output = tools.execute(&request).unwrap();
    assert!(output.status.success());
    assert_eq!(output.filtered_environment, ["API_TOKEN"]);
    assert_eq!(output.stdout.inline, b"visi");
    let artifact = output.stdout.artifact.unwrap();
    assert_eq!(tools.read_artifact(&artifact).unwrap(), b"visible:unset");
    assert_eq!(artifact.byte_length, 13);
    assert_eq!(artifact.media_type, "text/plain; charset=utf-8");
    assert_eq!(artifact.path.file_name().unwrap(), artifact.sha256.as_str());
    assert!(!output.stdout.truncated);

    let mut truncated_request = request;
    truncated_request.arguments = vec!["-c".into(), "printf 12345678901234567890".into()];
    let truncated = tools.run_test(&truncated_request).unwrap();
    assert!(truncated.stdout.truncated);
    let truncated_artifact = truncated.stdout.artifact.unwrap();
    assert_eq!(tools.read_artifact(&truncated_artifact).unwrap().len(), 16);
    assert_eq!(truncated_artifact.byte_length, 16);
}

#[test]
fn process_resolution_environment_output_and_argument_limits_fail_closed() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let request = ProcessRequest {
        program: "printf".into(),
        arguments: vec!["token=sk-super-secret-value".into()],
        environment: BTreeMap::from([
            ("PATH".into(), root.path().display().to_string()),
            ("LD_PRELOAD".into(), "/tmp/evil.so".into()),
            ("SAFE".into(), "yes".into()),
        ]),
        timeout: Duration::from_secs(2),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::None,
        limits: OutputLimits {
            inline_bytes: 4,
            artifact_bytes: 1024,
        },
    };
    let output = tools.execute(&request).unwrap();
    assert_eq!(output.filtered_environment, ["LD_PRELOAD", "PATH"]);
    let artifact = output.stdout.artifact.unwrap();
    let retained = tools.read_artifact(&artifact).unwrap();
    assert!(!retained.windows(2).any(|window| window == b"sk"));
    assert!(String::from_utf8(retained).unwrap().contains("[REDACTED]"));

    let outside = tempdir().unwrap();
    let executable = outside.path().join("outside-tool");
    fs::write(&executable, "not executed").unwrap();
    let mut denied = request.clone();
    denied.program = executable;
    denied.arguments.clear();
    assert!(matches!(
        tools.execute(&denied),
        Err(ToolError::ExecutableDenied(_))
    ));

    let mut protected = request.clone();
    protected.arguments = vec!["cat .env".into()];
    assert!(matches!(
        tools.execute(&protected),
        Err(ToolError::ProtectedProcessArgument)
    ));
    let mut oversized = request;
    oversized.arguments = vec!["x".repeat(1024 * 1024 + 1)];
    assert!(matches!(
        tools.execute(&oversized),
        Err(ToolError::ProcessArgumentsTooLarge)
    ));
}

#[test]
fn foreground_process_output_is_streamed_into_a_bounded_capture() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec!["-c".into(), "head -c 5000000 /dev/zero".into()],
        environment: BTreeMap::new(),
        timeout: Duration::from_secs(5),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::None,
        limits: OutputLimits {
            inline_bytes: 128,
            artifact_bytes: 1024,
        },
    };
    let output = tools.execute(&request).unwrap();
    assert_eq!(output.stdout.byte_length, 5_000_000);
    assert_eq!(output.stdout.inline.len(), 128);
    assert_eq!(
        tools
            .read_artifact(output.stdout.artifact.as_ref().unwrap())
            .unwrap()
            .len(),
        1024
    );
    assert!(output.stdout.truncated);

    let mut invalid = request;
    invalid.limits.inline_bytes = 1025;
    assert!(matches!(
        tools.execute(&invalid),
        Err(ToolError::InvalidOutputLimits)
    ));
}

#[cfg(unix)]
#[test]
fn foreground_completion_kills_pipe_holding_descendants_before_joining_readers() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let started = Instant::now();
    let output = tools
        .execute(&ProcessRequest {
            program: "/bin/sh".into(),
            arguments: vec!["-c".into(), "sleep 30 & printf leader-exited".into()],
            environment: BTreeMap::new(),
            timeout: Duration::from_secs(2),
            cancellation: ExecutionCancellation::new(),
            sandbox: SandboxRequirement::None,
            limits: OutputLimits {
                inline_bytes: 128,
                artifact_bytes: 1024,
            },
        })
        .unwrap();
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(output.stdout.inline, b"leader-exited");
}

#[test]
fn content_addressed_artifacts_deduplicate_and_detect_tampering() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec!["-c".into(), "printf content-addressed".into()],
        environment: BTreeMap::new(),
        timeout: Duration::from_secs(2),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::BestEffort,
        limits: limits(),
    };
    let first = tools.execute(&request).unwrap().stdout.artifact.unwrap();
    let second = tools.execute(&request).unwrap().stdout.artifact.unwrap();
    assert_eq!(first, second);
    assert_eq!(tools.read_artifact(&first).unwrap(), b"content-addresse");

    fs::write(&first.path, b"tampered").unwrap();
    assert!(matches!(
        tools.read_artifact(&first),
        Err(ToolError::ArtifactTampered(_))
    ));
}

#[test]
fn artifact_reader_rejects_forged_paths() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let bytes = b"outside";
    let forged = OutputArtifact {
        path: outside.path().join("outside"),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        media_type: "application/octet-stream".into(),
    };
    fs::write(&forged.path, bytes).unwrap();
    assert!(matches!(
        tools.read_artifact(&forged),
        Err(ToolError::InvalidArtifact(_))
    ));
}

#[cfg(unix)]
#[test]
fn artifact_reader_rejects_external_hardlinks_before_reading_content() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec!["-c".into(), "printf artifact".into()],
        environment: BTreeMap::new(),
        timeout: Duration::from_secs(2),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::None,
        limits: limits(),
    };
    let artifact = tools.execute(&request).unwrap().stdout.artifact.unwrap();
    let external = outside.path().join("external");
    fs::write(&external, tools.read_artifact(&artifact).unwrap()).unwrap();
    fs::remove_file(&artifact.path).unwrap();
    fs::hard_link(&external, &artifact.path).unwrap();

    assert!(matches!(
        tools.read_artifact(&artifact),
        Err(ToolError::Hardlink(_))
    ));
}

#[cfg(unix)]
#[test]
fn artifact_store_rejects_symlinked_digest_directory() {
    use std::os::unix::fs::symlink;

    let artifacts = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let bytes = b"symlink-escape";
    let digest = format!("{:x}", Sha256::digest(bytes));
    symlink(outside.path(), artifacts.path().join(&digest[..2])).unwrap();

    assert!(matches!(
        store_artifact(artifacts.path(), bytes),
        Err(ToolError::InvalidArtifact(_))
    ));
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn required_sandbox_uses_adapter_or_fails_closed_and_timeout_cleans_process() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let mut request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec!["-c".into(), "sleep 2".into()],
        environment: BTreeMap::new(),
        timeout: Duration::from_millis(20),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::Required,
        limits: limits(),
    };
    let required = run_process(root.path(), artifacts.path(), &request);
    if sandbox_adapter().is_some() {
        assert!(matches!(required, Err(ToolError::Timeout)));
    } else {
        assert!(matches!(required, Err(ToolError::SandboxUnavailable)));
    }
    request.sandbox = SandboxRequirement::BestEffort;
    assert!(matches!(
        run_process(root.path(), artifacts.path(), &request),
        Err(ToolError::Timeout)
    ));
}

#[test]
fn auto_policy_does_not_claim_unsandboxed_shell_is_workspace_sandboxed() {
    assert_eq!(
        sandbox_capability(SandboxRequirement::None).unwrap(),
        changeloop_policy::SandboxCapability::DangerFullAccess
    );
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = ToolRuntime::new(
        root.path(),
        artifacts.path(),
        ToolPolicy {
            mode: ExecutionMode::Auto,
            configured_action: RuleAction::Auto,
            lifecycle_authority: LifecycleAuthority::ConfirmedChange,
            hard_boundaries: Vec::new(),
        },
    )
    .unwrap();
    let request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec!["-c".into(), "true".into()],
        environment: BTreeMap::new(),
        timeout: Duration::from_secs(1),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::BestEffort,
        limits: limits(),
    };
    let result = tools.execute(&request);
    if sandbox_adapter().is_some() {
        assert!(result.unwrap().status.success());
    } else {
        assert!(matches!(
            result,
            Err(ToolError::ApprovalRequired("auto_requires_confirmation"))
        ));
    }
}

#[test]
fn auto_policy_treats_direct_delete_as_irreversible_without_snapshot_assumptions() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let locks = tempdir().unwrap();
    fs::write(root.path().join("delete.txt"), "preserve").unwrap();
    let paths = [PathBuf::from("delete.txt")];
    let revision = WorkspaceRevision::capture(root.path(), "head", paths.clone()).unwrap();
    let lease =
        MutationLease::acquire(locks.path(), root.path(), 100, revision.clone(), paths).unwrap();
    let tools = ToolRuntime::new(
        root.path(),
        artifacts.path(),
        ToolPolicy {
            mode: ExecutionMode::Auto,
            configured_action: RuleAction::Auto,
            lifecycle_authority: LifecycleAuthority::ConfirmedChange,
            hard_boundaries: Vec::new(),
        },
    )
    .unwrap();
    let hash = format!("{:x}", Sha256::digest(b"preserve"));
    assert!(matches!(
        tools.delete_file(Path::new("delete.txt"), &hash, &lease, 50, &revision),
        Err(ToolError::ApprovalRequired(_))
    ));
    assert_eq!(
        fs::read(root.path().join("delete.txt")).unwrap(),
        b"preserve"
    );
}

#[test]
fn cancellation_and_background_job_cleanup_are_terminal() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let cancellation = ExecutionCancellation::new();
    let request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec!["-c".into(), "sleep 2".into()],
        environment: BTreeMap::new(),
        timeout: Duration::from_secs(2),
        cancellation: cancellation.clone(),
        sandbox: SandboxRequirement::BestEffort,
        limits: limits(),
    };
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(20));
        cancellation.cancel();
    });
    assert!(matches!(
        run_process(root.path(), artifacts.path(), &request),
        Err(ToolError::Cancelled)
    ));

    let mut jobs = JobManager::new(root.path().to_path_buf());
    let tools = runtime(root.path(), artifacts.path());
    let id = tools
        .spawn_job(
            &mut jobs,
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 2".into()],
            &BTreeMap::new(),
        )
        .unwrap();
    assert_eq!(jobs.poll(&id).unwrap(), JobState::Running);
    jobs.dispose();
    assert_eq!(jobs.poll(&id).unwrap(), JobState::Cancelled);
}

#[cfg(unix)]
#[test]
fn project_job_count_and_stdin_backpressure_are_bounded() {
    let root = tempdir().unwrap();
    let mut jobs = JobManager::new(root.path().to_path_buf());
    for _ in 0..MAX_PROJECT_JOBS {
        jobs.spawn(
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 5".into()],
            &BTreeMap::new(),
        )
        .unwrap();
    }
    assert!(matches!(
        jobs.spawn(
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 5".into()],
            &BTreeMap::new()
        ),
        Err(ToolError::JobLimitReached)
    ));
    jobs.dispose();

    let mut descriptors = [-1; 2];
    assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
    let _reader = unsafe { File::from_raw_fd(descriptors[0]) };
    let mut writer = unsafe { File::from_raw_fd(descriptors[1]) };
    let original = unsafe { libc::fcntl(writer.as_raw_fd(), libc::F_GETFL) };
    assert!(original >= 0);
    assert_eq!(
        unsafe {
            libc::fcntl(
                writer.as_raw_fd(),
                libc::F_SETFL,
                original | libc::O_NONBLOCK,
            )
        },
        0
    );
    let fill = [0_u8; 8192];
    loop {
        let count = unsafe { libc::write(writer.as_raw_fd(), fill.as_ptr().cast(), fill.len()) };
        if count < 0 {
            assert_eq!(
                std::io::Error::last_os_error().kind(),
                std::io::ErrorKind::WouldBlock
            );
            break;
        }
    }
    assert_eq!(
        unsafe { libc::fcntl(writer.as_raw_fd(), libc::F_SETFL, original) },
        0
    );
    let started = Instant::now();
    assert!(matches!(
        write_job_stdin(&mut writer, b"x"),
        Err(ToolError::JobInputBackpressure)
    ));
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(matches!(
        write_job_stdin(&mut writer, &vec![0; MAX_JOB_INPUT_BYTES + 1]),
        Err(ToolError::JobInputTooLarge)
    ));
}

#[test]
fn cancelling_a_job_joins_readers_before_publishing_terminal_state() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let mut jobs = JobManager::new(root.path().to_path_buf());
    let id = tools
        .spawn_job(
            &mut jobs,
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "printf before-cancel; sleep 30".into()],
            &BTreeMap::new(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while jobs.status(&id).unwrap().stdout.bytes.is_empty() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(2));
    }
    jobs.cancel(&id).unwrap();
    let first = jobs.status(&id).unwrap();
    thread::sleep(Duration::from_millis(20));
    let second = jobs.status(&id).unwrap();
    assert_eq!(first.state, JobState::Cancelled);
    assert_eq!(first, second);
    let record = jobs.jobs.get(&id).unwrap();
    assert!(record.readers.is_empty());
    assert!(record.pty_writer.is_none());
}

#[test]
fn many_short_lived_jobs_publish_all_output_before_terminal_state() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let mut jobs = JobManager::new(root.path().to_path_buf());
    let ids: Vec<_> = (0..64)
        .map(|index| {
            tools
                .spawn_job(
                    &mut jobs,
                    JobKind::Background,
                    Path::new("/bin/sh"),
                    &["-c".into(), format!("printf job-{index}")],
                    &BTreeMap::new(),
                )
                .unwrap()
        })
        .collect();
    for (index, id) in ids.iter().enumerate() {
        let deadline = Instant::now() + Duration::from_secs(2);
        let status = loop {
            let status = jobs.status(id).unwrap();
            if status.state != JobState::Running || Instant::now() >= deadline {
                break status;
            }
            thread::sleep(Duration::from_millis(1));
        };
        assert_eq!(status.state, JobState::Exited);
        assert_eq!(status.stdout.bytes, format!("job-{index}").as_bytes());
    }
}

#[cfg(unix)]
#[test]
fn disposing_one_job_manager_does_not_cancel_another_project_job() {
    let first_root = tempdir().unwrap();
    let second_root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let first_tools = runtime(first_root.path(), artifacts.path());
    let second_tools = runtime(second_root.path(), artifacts.path());
    let mut first_jobs = JobManager::new(first_root.path().to_path_buf());
    let mut second_jobs = JobManager::new(second_root.path().to_path_buf());
    let first = first_tools
        .spawn_job(
            &mut first_jobs,
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 30".into()],
            &BTreeMap::new(),
        )
        .unwrap();
    let second = second_tools
        .spawn_job(
            &mut second_jobs,
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 30".into()],
            &BTreeMap::new(),
        )
        .unwrap();
    first_jobs.dispose();
    assert_eq!(first_jobs.poll(&first).unwrap(), JobState::Cancelled);
    assert_eq!(second_jobs.poll(&second).unwrap(), JobState::Running);
    second_jobs.dispose();
    assert_eq!(second_jobs.poll(&second).unwrap(), JobState::Cancelled);
}

#[test]
fn pty_job_accepts_scoped_stdin_and_reaches_terminal_state() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let mut jobs = JobManager::new(root.path().to_path_buf());
    let id = tools
        .spawn_job(
            &mut jobs,
            JobKind::Pty,
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "test -t 0 && test -t 1 && read line && printf 'received:%s' \"$line\"".into(),
            ],
            &BTreeMap::new(),
        )
        .unwrap();
    jobs.write_stdin(&id, b"done\n").unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    while jobs.poll(&id).unwrap() == JobState::Running && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(jobs.poll(&id).unwrap(), JobState::Exited);
    let status = jobs.status(&id).unwrap();
    let output = String::from_utf8_lossy(&status.stdout.bytes);
    assert!(output.contains("received:done"), "{output}");
}

#[test]
fn background_jobs_capture_bounded_output_and_report_status() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let mut jobs = JobManager::new(root.path().to_path_buf());
    let id = tools
        .spawn_job(
            &mut jobs,
            JobKind::Background,
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "head -c 1100000 /dev/zero | tr '\\0' x; printf err >&2".into(),
            ],
            &BTreeMap::new(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while jobs.poll(&id).unwrap() == JobState::Running && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    let status = jobs.status(&id).unwrap();
    assert_eq!(status.state, JobState::Exited);
    assert_eq!(status.stdout.bytes.len(), JOB_OUTPUT_LIMIT);
    assert!(status.stdout.truncated);
    assert_eq!(status.stdout.total_bytes, 1_100_000);
    assert_eq!(status.stderr.bytes, b"err");
    assert_eq!(jobs.list().len(), 1);
}

#[test]
fn poisoned_job_output_mutex_is_recovered_without_panicking_status() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let mut jobs = JobManager::new(root.path().to_path_buf());
    let id = tools
        .spawn_job(
            &mut jobs,
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "printf recovered".into()],
            &BTreeMap::new(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while jobs.poll(&id).unwrap() == JobState::Running && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }

    let output = Arc::clone(&jobs.jobs.get(&id).unwrap().stdout);
    let poisoner = thread::spawn(move || {
        let _guard = output.lock().unwrap();
        panic!("intentional poison");
    });
    assert!(poisoner.join().is_err());

    let status = jobs.status(&id).unwrap();
    assert_eq!(status.state, JobState::Exited);
    assert_eq!(status.stdout.bytes, b"recovered");
}

#[test]
fn process_and_job_readers_retry_interrupted_reads_without_losing_output() {
    struct InterruptedOnce {
        interrupted: bool,
        content: std::io::Cursor<Vec<u8>>,
    }

    impl Read for InterruptedOnce {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if !self.interrupted {
                self.interrupted = true;
                return Err(std::io::Error::from(std::io::ErrorKind::Interrupted));
            }
            self.content.read(buffer)
        }
    }

    let foreground = spawn_bounded_capture(
        InterruptedOnce {
            interrupted: false,
            content: std::io::Cursor::new(b"foreground".to_vec()),
        },
        128,
    )
    .join()
    .unwrap()
    .unwrap();
    assert_eq!(foreground.retained, b"foreground");

    let output = Arc::new(Mutex::new(BoundedJobOutput::default()));
    spawn_output_reader(
        InterruptedOnce {
            interrupted: false,
            content: std::io::Cursor::new(b"background".to_vec()),
        },
        Arc::clone(&output),
    )
    .join()
    .unwrap();
    assert_eq!(lock_recover(&output).snapshot().bytes, b"background");
}

#[cfg(unix)]
#[test]
fn exited_job_kills_pipe_holding_descendants_before_joining_readers() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let mut jobs = JobManager::new(root.path().to_path_buf());
    let id = tools
        .spawn_job(
            &mut jobs,
            JobKind::Background,
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 30 & printf leader-exited".into()],
            &BTreeMap::new(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while jobs.poll(&id).unwrap() == JobState::Running && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(
        Instant::now() < deadline,
        "poll blocked on a descendant-held pipe"
    );
    let status = jobs.status(&id).unwrap();
    assert_eq!(status.state, JobState::Exited);
    assert_eq!(status.stdout.bytes, b"leader-exited");
}

#[test]
fn required_sandbox_cannot_write_outside_workspace_when_available() {
    let Some(_) = sandbox_adapter() else {
        return;
    };
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let destination = outside.path().join("escape");
    let request = ProcessRequest {
        program: "/bin/sh".into(),
        arguments: vec!["-c".into(), "printf denied > \"$DESTINATION\"".into()],
        environment: BTreeMap::from([(
            "DESTINATION".into(),
            destination.to_string_lossy().into_owned(),
        )]),
        timeout: Duration::from_secs(2),
        cancellation: ExecutionCancellation::new(),
        sandbox: SandboxRequirement::Required,
        limits: limits(),
    };
    let root_path = fs::canonicalize(root.path()).unwrap();
    let artifact_path = fs::canonicalize(artifacts.path()).unwrap();
    let output = run_process(&root_path, &artifact_path, &request).unwrap();
    assert!(!output.status.success());
    assert!(!destination.exists());
}

#[cfg(unix)]
#[test]
fn required_project_sandbox_limits_writes_to_exact_declared_files() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempdir().unwrap();
    let allowed = root.path().join("allowed.txt");
    let undeclared = root.path().join("undeclared.txt");
    fs::write(&allowed, "before").unwrap();
    fs::write(&undeclared, "user-owned").unwrap();
    let script = root.path().join("formatter.sh");
    fs::write(
        &script,
        "#!/bin/sh\nprintf allowed > \"$1\"\nprintf escaped > \"$2\"\n",
    )
    .unwrap();
    let mut permissions = fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script, permissions).unwrap();
    let arguments = vec![
        allowed.to_string_lossy().into_owned(),
        undeclared.to_string_lossy().into_owned(),
    ];
    let command = required_project_sandbox_command(
        root.path(),
        &root.path().join("scratch"),
        &script,
        &arguments,
        &[PathBuf::from("allowed.txt")],
    );
    if !required_project_sandbox_available() {
        assert!(matches!(command, Err(ToolError::SandboxUnavailable)));
        assert_eq!(fs::read_to_string(&allowed).unwrap(), "before");
        return;
    }
    let mut command = command.unwrap();
    let output = command
        .current_dir(root.path())
        .env_clear()
        .env("PATH", SAFE_EXECUTABLE_PATH)
        .output()
        .unwrap();
    assert!(!output.status.success(), "undeclared write must be denied");
    assert_eq!(
        fs::read_to_string(&allowed).unwrap(),
        "allowed",
        "sandbox status {:?}, stderr: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read_to_string(&undeclared).unwrap(), "user-owned");
}

#[test]
fn git_and_question_tools_are_executable_contracts() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let status = Command::new("git")
        .args(["init", "-q"])
        .current_dir(root.path())
        .status()
        .unwrap();
    assert!(status.success());
    fs::write(root.path().join("new.txt"), "new").unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let output = tools
        .git_status(OutputLimits {
            inline_bytes: 100,
            artifact_bytes: 100,
        })
        .unwrap();
    assert!(String::from_utf8_lossy(&output.stdout.inline).contains("new.txt"));
    let question = tools.question("continue?").unwrap();
    assert_eq!(question.prompt, "continue?");
}

#[cfg(unix)]
#[test]
fn git_read_tools_disable_repository_hooks_and_option_like_paths() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    assert!(
        Command::new("git")
            .args(["init", "-q"])
            .current_dir(root.path())
            .status()
            .unwrap()
            .success()
    );

    let marker = root.path().join("hook-ran");
    let hook = root.path().join("hostile-hook.sh");
    fs::write(
        &hook,
        format!("#!/bin/sh\nprintf invoked > '{}'\n", marker.display()),
    )
    .unwrap();
    let mut permissions = fs::metadata(&hook).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&hook, permissions).unwrap();
    fs::write(root.path().join(".gitattributes"), "*.secret diff=evil\n").unwrap();
    fs::write(root.path().join("tracked.secret"), "before\n").unwrap();
    assert!(
        Command::new("git")
            .args(["add", "--", ".gitattributes", "tracked.secret"])
            .current_dir(root.path())
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("git")
            .args(["config", "diff.evil.textconv", hook.to_str().unwrap()])
            .current_dir(root.path())
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("git")
            .args(["config", "core.fsmonitor", hook.to_str().unwrap()])
            .current_dir(root.path())
            .status()
            .unwrap()
            .success()
    );
    fs::write(root.path().join("tracked.secret"), "after\n").unwrap();
    fs::write(root.path().join("--option-like"), "untracked\n").unwrap();

    let tools = runtime(root.path(), artifacts.path());
    let limits = OutputLimits {
        inline_bytes: 4096,
        artifact_bytes: 4096,
    };
    let diff = tools.git_diff(limits).unwrap();
    assert!(diff.status.success());
    assert!(!marker.exists(), "git diff executed repository textconv");
    let status = tools.git_status(limits).unwrap();
    assert!(status.status.success());
    assert!(!marker.exists(), "git status executed repository fsmonitor");
    assert!(String::from_utf8_lossy(&status.stdout.inline).contains("--option-like"));
}

#[test]
fn artifact_quota_and_gc_preserve_proof_snapshot_and_audit_pins() {
    let project = tempdir().unwrap();
    let artifacts = project.path().join(".changeloop/artifacts");
    fs::create_dir_all(&artifacts).unwrap();
    let artifacts = fs::canonicalize(artifacts).unwrap();
    let quota = ArtifactQuota {
        max_bytes: 1024,
        max_files: 10,
    };
    let proof = store_artifact_with_quota(&artifacts, b"proof-pinned", quota).unwrap();
    let snapshot = store_artifact_with_quota(&artifacts, b"snapshot-pinned", quota).unwrap();
    let audit = store_artifact_with_quota(&artifacts, b"audit-pinned", quota).unwrap();
    let unreferenced = store_artifact_with_quota(&artifacts, b"collect-me", quota).unwrap();
    fs::create_dir_all(project.path().join(".changeloop/proofs")).unwrap();
    fs::create_dir_all(project.path().join(".changeloop/snapshots/session")).unwrap();
    fs::create_dir_all(project.path().join(".changeloop/hooks")).unwrap();
    fs::write(
        project.path().join(".changeloop/proofs/change.json"),
        format!("{{\"evidenceHash\":\"sha256:{}\"}}", proof.sha256),
    )
    .unwrap();
    fs::write(
        project
            .path()
            .join(".changeloop/snapshots/session/state.json"),
        format!("{{\"sha256\":\"{}\"}}", snapshot.sha256),
    )
    .unwrap();
    fs::write(
        project.path().join(".changeloop/hooks/session.json"),
        format!("{{\"artifact\":\"{}\"}}", audit.sha256),
    )
    .unwrap();

    let report = gc_project_artifacts_with_grace(
        project.path(),
        ArtifactQuota {
            max_bytes: 1024,
            max_files: 3,
        },
        Duration::ZERO,
    )
    .unwrap();
    assert_eq!(report.deleted, [unreferenced.sha256]);
    for pinned in [&proof, &snapshot, &audit] {
        assert!(pinned.path.is_file());
    }
    let pressure = gc_project_artifacts_with_grace(
        project.path(),
        ArtifactQuota {
            max_bytes: 1,
            max_files: 1,
        },
        Duration::ZERO,
    )
    .unwrap();
    assert!(pressure.pressure);
    assert!(proof.path.is_file() && snapshot.path.is_file() && audit.path.is_file());
}

#[test]
fn artifact_write_quota_backpressures_without_overwriting_existing_content() {
    let directory = tempdir().unwrap();
    let artifact_root = fs::canonicalize(directory.path()).unwrap();
    let quota = ArtifactQuota {
        max_bytes: 4,
        max_files: 1,
    };
    let first = store_artifact_with_quota(&artifact_root, b"four", quota).unwrap();
    assert!(matches!(
        store_artifact_with_quota(&artifact_root, b"next", quota),
        Err(ToolError::ArtifactQuotaPressure { .. })
    ));
    assert_eq!(
        read_verified_artifact(&artifact_root, &first).unwrap(),
        b"four"
    );
}

#[test]
fn file_read_promotes_large_output_to_verified_artifact_without_truncation() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    fs::write(root.path().join("large.txt"), b"complete-content").unwrap();
    let tools = runtime(root.path(), artifacts.path());
    let output = tools
        .read_with_artifact(Path::new("large.txt"), 4, 64)
        .unwrap();
    let FileReadOutput::Artifact(artifact) = output else {
        panic!("expected artifact-backed file read")
    };
    assert_eq!(artifact.byte_length, 16);
    assert_eq!(tools.read_artifact(&artifact).unwrap(), b"complete-content");

    assert!(matches!(
        tools.read_with_artifact(Path::new("large.txt"), 4, 8),
        Err(ToolError::FileReadTooLarge { max_bytes: 8, .. })
    ));
}

#[cfg(unix)]
#[test]
fn concurrent_artifact_writes_deduplicate_and_enforce_quota_atomically() {
    let same_directory = tempdir().unwrap();
    let same_root = fs::canonicalize(same_directory.path()).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let writers: Vec<_> = (0..8)
        .map(|_| {
            let root = same_root.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                store_artifact_with_quota(
                    &root,
                    b"same-content",
                    ArtifactQuota {
                        max_bytes: 12,
                        max_files: 1,
                    },
                )
            })
        })
        .collect();
    let artifacts: Vec<_> = writers
        .into_iter()
        .map(|writer| writer.join().unwrap().unwrap())
        .collect();
    assert!(artifacts.windows(2).all(|pair| pair[0] == pair[1]));
    assert_eq!(artifact_inventory(&same_root).unwrap().1, 1);

    let limited_directory = tempdir().unwrap();
    let limited_root = fs::canonicalize(limited_directory.path()).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let writers: Vec<_> = (0..8)
        .map(|index| {
            let root = limited_root.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                store_artifact_with_quota(
                    &root,
                    format!("payload-{index}").as_bytes(),
                    ArtifactQuota {
                        max_bytes: 64,
                        max_files: 1,
                    },
                )
            })
        })
        .collect();
    let results: Vec<_> = writers
        .into_iter()
        .map(|writer| writer.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(
        results
            .iter()
            .filter(|result| result.is_err())
            .all(|result| { matches!(result, Err(ToolError::ArtifactQuotaPressure { .. })) })
    );
    assert_eq!(artifact_inventory(&limited_root).unwrap().1, 1);
}

#[test]
fn default_gc_grace_keeps_fresh_artifacts_available_for_pending_pin_writes() {
    let project = tempdir().unwrap();
    let artifacts = project.path().join(".changeloop/artifacts");
    fs::create_dir_all(&artifacts).unwrap();
    let artifacts = fs::canonicalize(artifacts).unwrap();
    let artifact = store_artifact_with_quota(
        &artifacts,
        b"pending-proof",
        ArtifactQuota {
            max_bytes: 1024,
            max_files: 10,
        },
    )
    .unwrap();

    let report = gc_project_artifacts(
        project.path(),
        ArtifactQuota {
            max_bytes: 0,
            max_files: 0,
        },
    )
    .unwrap();
    assert!(report.deleted.is_empty());
    assert!(report.pressure);
    assert!(artifact.path.is_file());
}

#[test]
fn deduplicating_an_old_artifact_refreshes_grace_for_the_new_pending_pin() {
    let project = tempdir().unwrap();
    let artifacts = project.path().join(".changeloop/artifacts");
    fs::create_dir_all(&artifacts).unwrap();
    let artifacts = fs::canonicalize(artifacts).unwrap();
    let quota = ArtifactQuota {
        max_bytes: 1024,
        max_files: 10,
    };
    let original = store_artifact_with_quota(&artifacts, b"reused-proof", quota).unwrap();
    File::open(&original.path)
        .unwrap()
        .set_times(
            std::fs::FileTimes::new()
                .set_modified(std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1)),
        )
        .unwrap();

    let reused = store_artifact_with_quota(&artifacts, b"reused-proof", quota).unwrap();
    assert_eq!(reused, original);
    let report = gc_project_artifacts(
        project.path(),
        ArtifactQuota {
            max_bytes: 0,
            max_files: 0,
        },
    )
    .unwrap();
    assert!(report.deleted.is_empty());
    assert!(reused.path.is_file());
}

#[cfg(unix)]
#[test]
fn missing_mutation_source_does_not_create_parent_directories() {
    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let locks = tempdir().unwrap();
    let path = PathBuf::from("missing/deep/file.txt");
    let paths = [path.clone()];
    let revision = WorkspaceRevision::capture(root.path(), "head", paths.clone()).unwrap();
    let lease =
        MutationLease::acquire(locks.path(), root.path(), 100, revision.clone(), paths).unwrap();
    let tools = runtime(root.path(), artifacts.path());

    assert!(
        tools
            .delete_file(&path, &"0".repeat(64), &lease, 50, &revision)
            .is_err()
    );
    assert!(
        !root.path().join("missing").exists(),
        "validating a missing delete source must not mutate the workspace"
    );
}

#[cfg(unix)]
#[test]
fn filesystem_read_rejects_a_fifo_without_waiting_for_a_writer() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let root = tempdir().unwrap();
    let artifacts = tempdir().unwrap();
    let fifo = root.path().join("hostile-fifo");
    let fifo_name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);

    let tools = runtime(root.path(), artifacts.path());
    assert!(matches!(
        tools.read(Path::new("hostile-fifo"), 1024),
        Err(ToolError::Io { .. })
    ));
}
