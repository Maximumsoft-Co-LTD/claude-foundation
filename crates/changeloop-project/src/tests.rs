use super::*;
use changeloop_config::{ConfigLayer, ConfigResolver, ConfigSource};
use serde_json::json;
use std::sync::Mutex;
use tempfile::tempdir;

struct RecordingResource {
    kind: ResourceKind,
    name: &'static str,
    log: Arc<Mutex<Vec<String>>>,
    fail_cancel: bool,
}

impl InstanceResource for RecordingResource {
    fn kind(&self) -> ResourceKind {
        self.kind
    }
    fn cancel(&mut self) -> Result<(), String> {
        self.log
            .lock()
            .unwrap()
            .push(format!("cancel:{}", self.name));
        if self.fail_cancel {
            Err("cancel failed".into())
        } else {
            Ok(())
        }
    }
    fn flush(&mut self) -> Result<(), String> {
        self.log
            .lock()
            .unwrap()
            .push(format!("flush:{}", self.name));
        Ok(())
    }
    fn shutdown(&mut self) -> Result<(), String> {
        self.log
            .lock()
            .unwrap()
            .push(format!("shutdown:{}", self.name));
        Ok(())
    }
}

#[test]
fn instances_are_isolated_and_disposal_is_deterministic() {
    let directory = tempdir().unwrap();
    let first_root = directory.path().join("first");
    let second_root = directory.path().join("second");
    fs::create_dir_all(&first_root).unwrap();
    fs::create_dir_all(&second_root).unwrap();
    let log = Arc::new(Mutex::new(Vec::new()));
    let mut registry = ProjectInstanceRegistry::default();
    let first_token = {
        let first = registry.create(first_root.clone()).unwrap();
        first
            .register(RecordingResource {
                kind: ResourceKind::Watcher,
                name: "watcher",
                log: log.clone(),
                fail_cancel: true,
            })
            .unwrap();
        first
            .register(RecordingResource {
                kind: ResourceKind::Job,
                name: "job",
                log: log.clone(),
                fail_cancel: false,
            })
            .unwrap();
        first.cancellation_token()
    };
    let second_token = registry.create(second_root).unwrap().cancellation_token();
    let failures = registry.dispose(&first_root).unwrap();
    assert!(first_token.is_cancelled());
    assert!(!second_token.is_cancelled());
    assert_eq!(failures.len(), 1);
    assert_eq!(
        *log.lock().unwrap(),
        [
            "cancel:job",
            "cancel:watcher",
            "flush:job",
            "flush:watcher",
            "shutdown:job",
            "shutdown:watcher"
        ]
    );
}

#[cfg(unix)]
#[test]
fn registry_canonicalizes_worktree_aliases_but_keeps_nested_repositories_distinct() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path().join("repository");
    let nested = root.join("nested");
    let alias = directory.path().join("repository-alias");
    fs::create_dir_all(&nested).unwrap();
    symlink(&root, &alias).unwrap();

    let mut registry = ProjectInstanceRegistry::default();
    registry.create(root.clone()).unwrap();
    assert!(matches!(
        registry.create(alias),
        Err(InstanceError::Duplicate(path)) if path == fs::canonicalize(&root).unwrap()
    ));
    registry.create(nested).unwrap();
    assert_eq!(registry.len(), 2);
}

#[test]
fn registry_rejects_missing_and_non_directory_roots() {
    let directory = tempdir().unwrap();
    let missing = directory.path().join("missing");
    let file = directory.path().join("file");
    fs::write(&file, "not a project").unwrap();
    let mut registry = ProjectInstanceRegistry::default();
    assert!(matches!(
        registry.create(missing),
        Err(InstanceError::InvalidRoot(_))
    ));
    assert!(matches!(
        registry.create(file),
        Err(InstanceError::InvalidRoot(_))
    ));
    assert!(registry.is_empty());
}

#[test]
fn leader_lock_rejects_second_server_until_release() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("server.lock");
    let first = LeaderLock::acquire(&path).unwrap();
    assert!(matches!(
        LeaderLock::acquire(&path),
        Err(LockError::Held { .. })
    ));
    drop(first);
    assert!(LeaderLock::acquire(&path).is_ok());
}

#[test]
fn contended_lock_owner_metadata_is_bounded() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("server.lock");
    let mut first = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    first.try_lock_exclusive().unwrap();
    first
        .write_all("x".repeat(MAX_LOCK_OWNER_BYTES as usize + 128).as_bytes())
        .unwrap();
    first.sync_data().unwrap();

    assert!(matches!(
        LeaderLock::acquire(&path),
        Err(LockError::Held { owner, .. })
            if owner.len() <= MAX_LOCK_OWNER_BYTES as usize + " [truncated]".len()
                && owner.ends_with(" [truncated]")
    ));
    drop(first);
}

#[cfg(unix)]
#[test]
fn lock_files_reject_symlinks_hardlinks_and_oversized_owner_metadata() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let victim = directory.path().join("victim");
    fs::write(&victim, "preserve").unwrap();
    let symlink_path = directory.path().join("symlink.lock");
    symlink(&victim, &symlink_path).unwrap();
    assert!(matches!(
        LeaderLock::acquire(&symlink_path),
        Err(LockError::Io { .. })
    ));
    assert_eq!(fs::read_to_string(&victim).unwrap(), "preserve");

    let hardlink_path = directory.path().join("hardlink.lock");
    fs::hard_link(&victim, &hardlink_path).unwrap();
    assert!(matches!(
        LeaderLock::acquire(&hardlink_path),
        Err(LockError::Io { .. })
    ));
    assert_eq!(fs::read_to_string(&victim).unwrap(), "preserve");

    let real_parent = directory.path().join("real-lock-parent");
    fs::create_dir(&real_parent).unwrap();
    let linked_parent = directory.path().join("linked-lock-parent");
    symlink(&real_parent, &linked_parent).unwrap();
    assert!(matches!(
        LeaderLock::acquire(linked_parent.join("server.lock")),
        Err(LockError::Io { .. })
    ));
    assert!(!real_parent.join("server.lock").exists());

    assert!(matches!(
        LeaderLock::acquire_with_endpoint(
            directory.path().join("large.lock"),
            "x".repeat(MAX_LOCK_OWNER_BYTES as usize + 1),
        ),
        Err(LockError::Io { source, .. }) if source.kind() == std::io::ErrorKind::InvalidInput
    ));
}

#[test]
fn conflicts_distinguish_external_from_overlapping_edits() {
    let directory = tempdir().unwrap();
    fs::write(directory.path().join("owned.rs"), "before").unwrap();
    fs::write(directory.path().join("other.rs"), "before").unwrap();
    let paths = [PathBuf::from("owned.rs"), PathBuf::from("other.rs")];
    let expected = WorkspaceRevision::capture(directory.path(), "head", paths.clone()).unwrap();
    fs::write(directory.path().join("other.rs"), "external").unwrap();
    let actual = WorkspaceRevision::capture(directory.path(), "head", paths.clone()).unwrap();
    let scope = BTreeSet::from([PathBuf::from("owned.rs")]);
    assert!(matches!(
        classify_conflict(&expected, &actual, &scope),
        Some(ConflictClassification::ExternalEdit { .. })
    ));
    fs::write(directory.path().join("owned.rs"), "overlap").unwrap();
    let actual = WorkspaceRevision::capture(directory.path(), "head", paths).unwrap();
    assert!(matches!(
        classify_conflict(&expected, &actual, &scope),
        Some(ConflictClassification::OverlappingExternalEdit { .. })
    ));
}

#[test]
fn expired_lease_loses_authority_but_retains_lock() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree");
    fs::create_dir_all(&worktree).unwrap();
    let revision = WorkspaceRevision::capture(&worktree, "head", []).unwrap();
    let lease =
        MutationLease::acquire(directory.path(), &worktree, 10, revision.clone(), []).unwrap();
    assert!(matches!(
        lease.authorize_write(10, &revision),
        Err(MutationError::LeaseExpired)
    ));
    assert!(matches!(
        MutationLease::acquire(directory.path(), &worktree, 20, revision.clone(), []),
        Err(MutationError::Lock(LockError::Held { .. }))
    ));
    drop(lease);
    assert!(MutationLease::acquire(directory.path(), &worktree, 20, revision, []).is_ok());
}

#[test]
fn lease_refuses_write_after_workspace_revision_changes() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree-conflict");
    fs::create_dir_all(&worktree).unwrap();
    fs::write(worktree.join("owned.rs"), "before").unwrap();
    let paths = [PathBuf::from("owned.rs")];
    let expected = WorkspaceRevision::capture(&worktree, "head", paths.clone()).unwrap();
    let lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("owned.rs")],
    )
    .unwrap();
    fs::write(worktree.join("owned.rs"), "external").unwrap();
    let actual = WorkspaceRevision::capture(&worktree, "head", paths).unwrap();

    assert!(matches!(
        lease.authorize_write(50, &actual),
        Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit { .. }
        ))
    ));
}

#[test]
fn targeted_events_only_invalidate_relevant_consumers() {
    let invalidation = targeted_invalidation(&[
        WatchEvent {
            path: "src/lib.rs".into(),
            kind: WatchEventKind::Modify,
        },
        WatchEvent {
            path: "AGENTS.md".into(),
            kind: WatchEventKind::Modify,
        },
    ]);
    assert_eq!(
        invalidation.0,
        BTreeSet::from([
            InvalidationTarget::Instructions,
            InvalidationTarget::LspDiagnostics,
            InvalidationTarget::FormatterState,
            InvalidationTarget::ToolCache,
        ])
    );
}

#[test]
fn nested_config_name_does_not_invalidate_root_effective_config() {
    let invalidation = targeted_invalidation(&[WatchEvent {
        path: "examples/changeloop.json".into(),
        kind: WatchEventKind::Modify,
    }]);
    assert!(
        !invalidation
            .0
            .contains(&InvalidationTarget::EffectiveConfig)
    );
    assert!(!invalidation.0.contains(&InvalidationTarget::ProviderCache));
}

#[test]
fn revision_paths_cannot_escape_project_scope() {
    let directory = tempdir().unwrap();
    assert!(matches!(
        WorkspaceRevision::capture(directory.path(), "head", [PathBuf::from("../secret")]),
        Err(RevisionError::PathEscape(_))
    ));
}

#[test]
fn polling_watcher_reports_create_modify_rename_delete_and_dispatches_targeted() {
    let directory = tempdir().unwrap();
    let mut watcher = PollingWatcher::new(directory.path()).unwrap();
    fs::create_dir_all(directory.path().join("src")).unwrap();
    fs::write(directory.path().join("src/lib.rs"), "one").unwrap();
    let created = watcher.poll().unwrap();
    assert!(created.iter().any(|event| {
        event.path == Path::new("src/lib.rs") && event.kind == WatchEventKind::Create
    }));

    fs::write(directory.path().join("src/lib.rs"), "two").unwrap();
    let modified = watcher.poll().unwrap();
    assert!(modified.iter().any(|event| {
        event.path == Path::new("src/lib.rs") && event.kind == WatchEventKind::Modify
    }));

    fs::rename(
        directory.path().join("src/lib.rs"),
        directory.path().join("src/main.rs"),
    )
    .unwrap();
    let renamed = watcher.poll().unwrap();
    assert!(renamed.iter().any(|event| matches!(
        &event.kind,
        WatchEventKind::Rename { from }
            if event.path == Path::new("src/main.rs") && from == Path::new("src/lib.rs")
    )));
    let invalidation = targeted_invalidation(&renamed);
    assert!(invalidation.0.contains(&InvalidationTarget::LspDiagnostics));

    fs::remove_file(directory.path().join("src/main.rs")).unwrap();
    assert!(
        watcher
            .poll()
            .unwrap()
            .iter()
            .any(|event| event.kind == WatchEventKind::Delete)
    );
}

#[test]
fn polling_watcher_ignores_internal_state_but_tracks_mcp_configuration() {
    let directory = tempdir().unwrap();
    let mut watcher = PollingWatcher::new(directory.path()).unwrap();
    let state = directory.path().join(".changeloop");
    fs::create_dir_all(&state).unwrap();
    fs::write(state.join("state.db"), "runtime").unwrap();
    fs::write(state.join("state.db-wal"), "runtime").unwrap();
    assert!(watcher.poll().unwrap().is_empty());

    fs::write(state.join("mcp.json"), "{}").unwrap();
    let events = watcher.poll().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].path, Path::new(".changeloop/mcp.json"));
    assert_eq!(
        targeted_invalidation(&events).0,
        BTreeSet::from([InvalidationTarget::McpConfiguration])
    );
}

#[test]
fn parent_watcher_stops_at_nested_repository_boundary() {
    let directory = tempdir().unwrap();
    let nested = directory.path().join("nested");
    fs::create_dir_all(nested.join(".git")).unwrap();
    fs::write(nested.join("owned.rs"), "before").unwrap();
    let mut parent = PollingWatcher::new(directory.path()).unwrap();
    let mut child = PollingWatcher::new(&nested).unwrap();

    fs::write(nested.join("owned.rs"), "after").unwrap();
    assert!(parent.poll().unwrap().is_empty());
    assert!(child.poll().unwrap().iter().any(|event| {
        event.path == Path::new("owned.rs") && event.kind == WatchEventKind::Modify
    }));
}

#[cfg(unix)]
#[test]
fn watcher_rejects_root_replacement_and_special_files() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let root = directory.path().join("root");
    let moved = directory.path().join("moved");
    let outside = directory.path().join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret"), "outside").unwrap();
    let mut watcher = PollingWatcher::new(&root).unwrap();
    fs::rename(&root, &moved).unwrap();
    symlink(&outside, &root).unwrap();
    assert!(matches!(watcher.poll(), Err(WatchError::InvalidRoot(_))));

    let fifo_root = directory.path().join("fifo-root");
    fs::create_dir(&fifo_root).unwrap();
    let fifo = fifo_root.join("pipe");
    let fifo_name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
    // SAFETY: `fifo_name` is a valid NUL-terminated path in a temporary directory.
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
    assert!(matches!(
        WorkspaceRevision::capture(&fifo_root, "head", [PathBuf::from("pipe")]),
        Err(RevisionError::UnsupportedFileType(path)) if path == fifo
    ));
    assert!(matches!(
        PollingWatcher::new(&fifo_root),
        Err(WatchError::Io { source, .. }) if source.kind() == std::io::ErrorKind::InvalidData
    ));
}

struct RecordingConsumer(Arc<Mutex<Vec<InvalidationTarget>>>);

impl InvalidationConsumer for RecordingConsumer {
    fn invalidate(&mut self, target: InvalidationTarget, _: &[WatchEvent]) {
        self.0.lock().unwrap().push(target);
    }
}

#[test]
fn dispatcher_notifies_only_subscribed_targeted_consumers() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let mut dispatcher = InvalidationDispatcher::default();
    dispatcher.subscribe(
        InvalidationTarget::EffectiveConfig,
        RecordingConsumer(log.clone()),
    );
    dispatcher.subscribe(
        InvalidationTarget::LspDiagnostics,
        RecordingConsumer(log.clone()),
    );
    dispatcher.dispatch(&[WatchEvent {
        path: PathBuf::from("changeloop.json"),
        kind: WatchEventKind::Modify,
    }]);
    assert_eq!(*log.lock().unwrap(), [InvalidationTarget::EffectiveConfig]);
}

fn resolved(patch: serde_json::Value) -> changeloop_config::ResolvedConfig {
    ConfigResolver::resolve(vec![
        ConfigLayer::from_native_json(ConfigSource::Project, "changeloop.json", 0, patch).unwrap(),
    ])
    .unwrap()
}

#[test]
fn hot_reload_applies_safe_changes_and_atomically_rejects_restart_changes() {
    let mut state = ProjectConfigState::new(ConfigResolver::resolve(Vec::new()).unwrap());
    assert!(matches!(
        state.apply(resolved(json!({"telemetry":{"analytics":true}}))),
        HotReloadDecision::Applied { .. }
    ));
    assert!(state.current().config.telemetry.analytics);

    assert!(matches!(
        state.apply(resolved(json!({"execution":{"maxParallelAgents":9}}))),
        HotReloadDecision::Rejected { .. }
    ));
    assert_eq!(state.current().config.execution.max_parallel_agents, 3);
    assert!(state.current().config.telemetry.analytics);
}

#[test]
fn checked_write_rejects_scope_and_external_overlap_then_refreshes_revision() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree");
    fs::create_dir_all(&worktree).unwrap();
    fs::write(worktree.join("owned.rs"), "before").unwrap();
    let expected = WorkspaceRevision::capture(
        &worktree,
        "head",
        [PathBuf::from("owned.rs"), PathBuf::from("outside.rs")],
    )
    .unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("owned.rs")],
    )
    .unwrap();
    assert!(matches!(
        lease.write_checked(&worktree, 1, "head", "outside.rs", b"bad"),
        Err(MutationError::OutsideScope(_))
    ));
    fs::write(worktree.join("owned.rs"), "external").unwrap();
    assert!(matches!(
        lease.write_checked(&worktree, 2, "head", "owned.rs", b"ours"),
        Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit { .. }
        ))
    ));
    drop(lease);

    let expected =
        WorkspaceRevision::capture(&worktree, "head", [PathBuf::from("owned.rs")]).unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("owned.rs")],
    )
    .unwrap();
    lease
        .write_checked(&worktree, 3, "head", "owned.rs", b"ours")
        .unwrap();
    assert_eq!(
        fs::read_to_string(worktree.join("owned.rs")).unwrap(),
        "ours"
    );
}

#[test]
fn checked_write_requires_predeclared_fingerprint() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree-untracked");
    fs::create_dir_all(&worktree).unwrap();
    let expected = WorkspaceRevision::capture(&worktree, "head", []).unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("src")],
    )
    .unwrap();
    assert!(matches!(
        lease.write_checked(&worktree, 1, "head", "src/new.rs", b"new"),
        Err(MutationError::UntrackedWritePath(_))
    ));
}

#[test]
fn checked_delete_rejects_external_replacement_then_refreshes_missing_revision() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree-delete");
    fs::create_dir_all(&worktree).unwrap();
    fs::write(worktree.join("owned.rs"), "before").unwrap();
    let expected =
        WorkspaceRevision::capture(&worktree, "head", [PathBuf::from("owned.rs")]).unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("owned.rs")],
    )
    .unwrap();
    fs::write(worktree.join("owned.rs"), "external").unwrap();
    assert!(matches!(
        lease.delete_checked(&worktree, 1, "head", "owned.rs"),
        Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit { .. }
        ))
    ));
    assert_eq!(
        fs::read_to_string(worktree.join("owned.rs")).unwrap(),
        "external"
    );
    drop(lease);

    let expected =
        WorkspaceRevision::capture(&worktree, "head", [PathBuf::from("owned.rs")]).unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("owned.rs")],
    )
    .unwrap();
    let revision = lease
        .delete_checked(&worktree, 2, "head", "owned.rs")
        .unwrap();
    assert_eq!(
        revision.files.get(Path::new("owned.rs")),
        Some(&FileFingerprint::Missing)
    );
    assert!(!worktree.join("owned.rs").exists());
}

#[cfg(unix)]
#[test]
fn checked_delete_rejects_symlink_replacement_without_touching_destination() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree-delete-symlink");
    let outside = directory.path().join("outside");
    fs::create_dir_all(&worktree).unwrap();
    fs::write(&outside, "outside").unwrap();
    fs::write(worktree.join("owned.rs"), "before").unwrap();
    let expected =
        WorkspaceRevision::capture(&worktree, "head", [PathBuf::from("owned.rs")]).unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("owned.rs")],
    )
    .unwrap();
    fs::remove_file(worktree.join("owned.rs")).unwrap();
    symlink(&outside, worktree.join("owned.rs")).unwrap();
    assert!(
        lease
            .delete_checked(&worktree, 1, "head", "owned.rs")
            .is_err()
    );
    assert_eq!(fs::read_to_string(&outside).unwrap(), "outside");
    assert!(
        fs::symlink_metadata(worktree.join("owned.rs"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[test]
fn lease_cannot_be_reused_to_write_a_different_worktree() {
    let directory = tempdir().unwrap();
    let protected = directory.path().join("protected");
    let other = directory.path().join("other");
    fs::create_dir(&protected).unwrap();
    fs::create_dir(&other).unwrap();
    fs::write(protected.join("owned.rs"), "protected").unwrap();
    fs::write(other.join("owned.rs"), "other").unwrap();
    let expected =
        WorkspaceRevision::capture(&protected, "head", [PathBuf::from("owned.rs")]).unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &protected,
        100,
        expected,
        [PathBuf::from("owned.rs")],
    )
    .unwrap();
    assert!(matches!(
        lease.write_checked(&other, 1, "head", "owned.rs", b"escape"),
        Err(MutationError::WorktreeMismatch(path)) if path == fs::canonicalize(&other).unwrap()
    ));
    assert_eq!(fs::read_to_string(other.join("owned.rs")).unwrap(), "other");
}

#[cfg(unix)]
#[test]
fn checked_write_never_follows_symlink_outside_worktree() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree-symlink");
    let outside = directory.path().join("outside");
    fs::create_dir_all(&worktree).unwrap();
    fs::create_dir_all(&outside).unwrap();
    symlink(&outside, worktree.join("linked")).unwrap();
    let expected =
        WorkspaceRevision::capture(&worktree, "head", [PathBuf::from("linked/escape.rs")]).unwrap();
    let mut lease = MutationLease::acquire(
        directory.path(),
        &worktree,
        100,
        expected,
        [PathBuf::from("linked")],
    )
    .unwrap();
    assert!(matches!(
        lease.write_checked(&worktree, 1, "head", "linked/escape.rs", b"escape"),
        Err(MutationError::SymlinkBoundary(_))
    ));
    assert!(!outside.join("escape.rs").exists());
}

#[test]
fn independent_worktrees_hold_non_conflicting_leases() {
    let directory = tempdir().unwrap();
    let first = directory.path().join("first");
    let second = directory.path().join("second");
    fs::create_dir_all(&first).unwrap();
    fs::create_dir_all(&second).unwrap();
    let first_revision = WorkspaceRevision::capture(&first, "a", []).unwrap();
    let second_revision = WorkspaceRevision::capture(&second, "b", []).unwrap();
    let first_lease =
        MutationLease::acquire(directory.path(), &first, 10, first_revision, []).unwrap();
    let second_lease =
        MutationLease::acquire(directory.path(), &second, 10, second_revision, []).unwrap();
    assert_ne!(first_lease.path(), second_lease.path());
}

#[test]
fn equivalent_worktree_paths_share_one_mutation_lock() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree");
    fs::create_dir_all(&worktree).unwrap();
    let revision = WorkspaceRevision::capture(&worktree, "head", []).unwrap();
    let lease =
        MutationLease::acquire(directory.path(), &worktree, 100, revision.clone(), []).unwrap();
    let aliased = worktree.join(".");
    assert!(matches!(
        MutationLease::acquire(directory.path(), &aliased, 100, revision, []),
        Err(MutationError::Lock(LockError::Held { .. }))
    ));
    drop(lease);
}

#[test]
fn mutation_lease_rejects_escaping_declared_scope() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree-scope");
    fs::create_dir_all(&worktree).unwrap();
    let revision = WorkspaceRevision::capture(&worktree, "head", []).unwrap();
    assert!(matches!(
        MutationLease::acquire(
            directory.path(),
            &worktree,
            100,
            revision,
            [PathBuf::from("../outside")],
        ),
        Err(MutationError::Revision(RevisionError::PathEscape(_)))
    ));
}

#[test]
fn owned_resources_cancel_and_release_without_cross_instance_leaks() {
    let directory = tempdir().unwrap();
    let first_root = directory.path().join("first");
    let second_root = directory.path().join("second");
    fs::create_dir_all(&first_root).unwrap();
    fs::create_dir_all(&second_root).unwrap();
    let mut registry = ProjectInstanceRegistry::default();
    let first_handle = registry
        .create(first_root.clone())
        .unwrap()
        .register_owned(ResourceKind::ModelExecution, "model")
        .unwrap();
    let second_handle = registry
        .create(second_root.clone())
        .unwrap()
        .register_owned(ResourceKind::Mcp, "mcp")
        .unwrap();
    registry.dispose(&first_root).unwrap();
    assert_eq!(first_handle.state(), ResourceState::Shutdown);
    assert!(first_handle.cancellation_token().is_cancelled());
    assert_eq!(second_handle.state(), ResourceState::Running);
    assert!(!second_handle.cancellation_token().is_cancelled());
    registry.dispose(&second_root).unwrap();
    assert_eq!(second_handle.state(), ResourceState::Shutdown);
}

#[test]
fn controlled_resource_cancels_real_runtime_once_and_stays_instance_scoped() {
    let directory = tempdir().unwrap();
    let first_root = directory.path().join("controlled-first");
    let second_root = directory.path().join("controlled-second");
    fs::create_dir_all(&first_root).unwrap();
    fs::create_dir_all(&second_root).unwrap();
    let first_cancelled = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let second_cancelled = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut registry = ProjectInstanceRegistry::default();
    let first_probe = Arc::clone(&first_cancelled);
    let first_handle = registry
        .create(first_root.clone())
        .unwrap()
        .register_owned_with_cancel(ResourceKind::ModelExecution, "provider", move || {
            first_probe.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
        .unwrap();
    let second_probe = Arc::clone(&second_cancelled);
    registry
        .create(second_root.clone())
        .unwrap()
        .register_owned_with_cancel(ResourceKind::Job, "pty", move || {
            second_probe.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
        .unwrap();

    registry.dispose(&first_root).unwrap();
    assert_eq!(first_cancelled.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(
        second_cancelled.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    assert_eq!(first_handle.state(), ResourceState::Shutdown);
    registry.dispose(&second_root).unwrap();
    assert_eq!(
        second_cancelled.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

#[test]
fn disposal_contains_panics_and_resource_registration_is_bounded() {
    struct PanickingResource;
    impl InstanceResource for PanickingResource {
        fn kind(&self) -> ResourceKind {
            ResourceKind::Watcher
        }
        fn cancel(&mut self) -> Result<(), String> {
            panic!("fixture panic")
        }
        fn flush(&mut self) -> Result<(), String> {
            Ok(())
        }
        fn shutdown(&mut self) -> Result<(), String> {
            Ok(())
        }
    }

    let directory = tempdir().unwrap();
    let mut panicking = ProjectInstance::new(directory.path().to_path_buf());
    panicking.register(PanickingResource).unwrap();
    let failures = panicking.dispose();
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].phase, DisposalPhase::Cancel);
    assert_eq!(failures[0].message, "resource lifecycle hook panicked");

    let mut bounded = ProjectInstance::new(directory.path().to_path_buf());
    for index in 0..MAX_INSTANCE_RESOURCES {
        bounded
            .register_owned(ResourceKind::Cache, format!("cache-{index}"))
            .unwrap();
    }
    assert_eq!(bounded.resource_count(), MAX_INSTANCE_RESOURCES);
    assert!(matches!(
        bounded.register_owned(ResourceKind::Cache, "overflow"),
        Err(InstanceError::ResourceLimit)
    ));
}

#[test]
fn completed_owned_resources_are_removed_without_waiting_for_project_disposal() {
    let directory = tempdir().unwrap();
    let mut instance = ProjectInstance::new(directory.path().to_path_buf());
    let handle = instance
        .register_owned(ResourceKind::ModelExecution, "completed-model")
        .unwrap();
    assert_eq!(instance.resource_count(), 1);
    assert!(instance.release_owned(&handle).unwrap().is_empty());
    assert_eq!(instance.resource_count(), 0);
    assert_eq!(handle.state(), ResourceState::Shutdown);
    assert!(handle.cancellation_token().is_cancelled());
    assert!(instance.release_owned(&handle).unwrap().is_empty());
}

#[test]
fn concurrent_reads_coexist_with_one_mutation_but_second_mutation_is_rejected() {
    let coordinator = ExecutionCoordinator::default();
    let first_read = coordinator.begin_read();
    let second_read = coordinator.begin_read();
    assert_eq!(coordinator.active_readers(), 2);
    let mutation = coordinator.begin_mutation("change-1").unwrap();
    assert_eq!(coordinator.active_mutation().as_deref(), Some("change-1"));
    assert!(matches!(
        coordinator.begin_mutation("change-2"),
        Err(ExecutionConflict::MutationActive { change_id }) if change_id == "change-1"
    ));
    drop(first_read);
    assert_eq!(coordinator.active_readers(), 1);
    drop(second_read);
    drop(mutation);
    assert_eq!(coordinator.active_readers(), 0);
    assert_eq!(coordinator.active_mutation(), None);
    assert!(coordinator.begin_mutation("change-2").is_ok());
}

#[test]
fn execution_coordinator_recovers_from_a_poisoned_mutex() {
    let coordinator = ExecutionCoordinator::default();
    let poisoner = coordinator.clone();
    assert!(
        std::thread::spawn(move || {
            let _state = poisoner.state.lock().unwrap();
            panic!("poison execution state");
        })
        .join()
        .is_err()
    );

    let read = coordinator.begin_read();
    assert_eq!(coordinator.active_readers(), 1);
    let mutation = coordinator.begin_mutation("change-after-poison").unwrap();
    assert_eq!(
        coordinator.active_mutation().as_deref(),
        Some("change-after-poison")
    );
    drop(read);
    drop(mutation);
    assert_eq!(coordinator.active_readers(), 0);
    assert_eq!(coordinator.active_mutation(), None);
}

#[test]
fn leader_election_returns_published_endpoint_to_contender() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("server.lock");
    let LeaderDisposition::Leader(leader) = elect_leader(&path, "unix:///tmp/one.sock").unwrap()
    else {
        panic!("first process must become leader")
    };
    let LeaderDisposition::Connect { metadata } =
        elect_leader(&path, "unix:///tmp/two.sock").unwrap()
    else {
        panic!("second process must connect")
    };
    assert_eq!(metadata.endpoint.as_deref(), Some("unix:///tmp/one.sock"));
    drop(leader);
}

#[test]
fn leader_election_never_connects_to_malformed_owner_metadata() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("malformed-server.lock");
    let owner = open_exclusive_lock(&path, "not-json".into()).unwrap();
    assert!(matches!(
        elect_leader(&path, "unix:///tmp/contender.sock"),
        Err(LockError::Held { owner, .. }) if owner == "not-json"
    ));
    drop(owner);
    assert!(matches!(
        elect_leader(&path, "unix:///tmp/recovered.sock").unwrap(),
        LeaderDisposition::Leader(_)
    ));
}

/// A temporary root short enough that a derived socket path still fits inside
/// `sockaddr_un.sun_path`. macOS's default `TMPDIR` alone is ~66 bytes, which
/// is a property of the test environment, not of the rendezvous.
fn short_tempdir() -> tempfile::TempDir {
    #[cfg(unix)]
    if let Ok(directory) = tempfile::Builder::new().prefix("cl").tempdir_in("/tmp") {
        return directory;
    }
    tempdir().unwrap()
}

#[test]
fn rendezvous_paths_are_derived_from_the_canonical_worktree() {
    let directory = short_tempdir();
    let worktree = directory.path().join("project");
    std::fs::create_dir_all(worktree.join("nested")).unwrap();
    let canonical = std::fs::canonicalize(&worktree).unwrap();

    let direct = Rendezvous::for_worktree(&worktree).unwrap();
    // Three different spellings of one worktree. If the rendezvous were
    // caller-supplied, each of these could name a different lock and two
    // processes would silently both become writers.
    let traversed = Rendezvous::for_worktree(worktree.join("nested/..")).unwrap();
    let trailing = Rendezvous::for_worktree(format!("{}/", worktree.display())).unwrap();

    assert_eq!(direct.root(), canonical);
    assert_eq!(direct.lock_path(), traversed.lock_path());
    assert_eq!(direct.lock_path(), trailing.lock_path());
    assert_eq!(
        direct.socket_path().unwrap(),
        traversed.socket_path().unwrap()
    );
    assert_eq!(
        direct.lock_path().parent(),
        Some(canonical.join(".changeloop").as_path())
    );

    // A second worktree never shares the first one's rendezvous.
    let other = directory.path().join("other");
    std::fs::create_dir_all(&other).unwrap();
    assert_ne!(
        direct.lock_path(),
        Rendezvous::for_worktree(&other).unwrap().lock_path()
    );

    assert!(matches!(
        Rendezvous::for_worktree(directory.path().join("missing")),
        Err(LockError::Io { .. })
    ));
}

#[test]
fn rendezvous_socket_path_is_refused_when_it_exceeds_the_address_limit() {
    let directory = tempdir().unwrap();
    let mut deep = directory.path().to_path_buf();
    for _ in 0..12 {
        deep = deep.join("a-directory-with-a-deliberately-long-name");
    }
    std::fs::create_dir_all(&deep).unwrap();
    let rendezvous = Rendezvous::for_worktree(&deep).unwrap();
    // The lock is a regular file and stays derivable, so write ownership is
    // still decidable even where no socket could be bound.
    assert!(rendezvous.lock_path().starts_with(rendezvous.root()));
    let error = rendezvous.socket_path().unwrap_err();
    assert!(
        error.to_string().contains("socket-address limit"),
        "unexpected message: {error}"
    );
}

#[test]
fn handshake_refuses_an_older_binary_against_a_newer_schema() {
    let server = RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 7);

    let older = RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 6);
    let error = server.accept(older).unwrap_err();
    assert_eq!(
        error,
        HandshakeError::SchemaTooNew {
            client: 6,
            server: 7
        }
    );
    let message = error.to_string();
    assert!(message.contains("store schema 6"), "{message}");
    assert!(message.contains("schema 7"), "{message}");
    assert!(message.contains("upgrade cloop"), "{message}");

    // Same schema attaches; a newer client attaches and simply does not migrate,
    // because the owner holds the writes.
    server.accept(server).unwrap();
    server
        .accept(RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 8))
        .unwrap();

    // A different rendezvous protocol is refused in both directions, and an
    // unversioned owner is refused rather than guessed about.
    assert!(matches!(
        server.accept(RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION + 1, 7)),
        Err(HandshakeError::Protocol { .. })
    ));
    assert!(matches!(
        RendezvousVersion::default().accept(server),
        Err(HandshakeError::Protocol { server: 0, .. })
    ));
    assert!(matches!(
        server.accept(RendezvousVersion::default()),
        Err(HandshakeError::Protocol { client: 0, .. })
    ));
}

#[test]
fn versioned_election_publishes_versions_a_contender_can_refuse() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("versioned.lock");
    let owner_version = RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 9);
    let LeaderDisposition::Leader(leader) =
        elect_leader_versioned(&path, "unix:///tmp/owner.sock", owner_version).unwrap()
    else {
        panic!("first process must become leader")
    };
    let LeaderDisposition::Connect { metadata } = elect_leader_versioned(
        &path,
        "unix:///tmp/stale.sock",
        RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 8),
    )
    .unwrap() else {
        panic!("second process must read the owner metadata")
    };
    assert_eq!(metadata.version, owner_version);
    assert!(matches!(
        metadata
            .version
            .accept(RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 8)),
        Err(HandshakeError::SchemaTooNew { .. })
    ));
    drop(leader);
}

#[test]
fn unversioned_lock_metadata_is_refused_rather_than_assumed_compatible() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("legacy.lock");
    // A lock written by a build that predates versioned metadata.
    let owner = open_exclusive_lock(
        &path,
        r#"{"pid":4242,"endpoint":"unix:///tmp/old.sock"}"#.into(),
    )
    .unwrap();
    let LeaderDisposition::Connect { metadata } = elect_leader_versioned(
        &path,
        "unix:///tmp/new.sock",
        RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 4),
    )
    .unwrap() else {
        panic!("contender must read the legacy metadata")
    };
    assert_eq!(metadata.version, RendezvousVersion::default());
    assert!(matches!(
        metadata
            .version
            .accept(RendezvousVersion::new(RENDEZVOUS_PROTOCOL_VERSION, 4)),
        Err(HandshakeError::Protocol { server: 0, .. })
    ));
    drop(owner);
}

#[test]
fn mutation_lease_renewal_extends_the_deadline_without_reclaiming() {
    let directory = tempdir().unwrap();
    let worktree = directory.path().join("worktree");
    let locks = directory.path().join("locks");
    std::fs::create_dir_all(&worktree).unwrap();
    std::fs::create_dir_all(&locks).unwrap();
    std::fs::write(worktree.join("file.txt"), b"one").unwrap();
    let revision =
        WorkspaceRevision::capture(&worktree, "token", [PathBuf::from("file.txt")]).unwrap();
    let mut lease = MutationLease::acquire(
        &locks,
        &worktree,
        100,
        revision.clone(),
        [PathBuf::from("file.txt")],
    )
    .unwrap();

    assert_eq!(lease.expires_at_ms(), 100);
    assert!(matches!(
        lease.authorize_write(150, &revision),
        Err(MutationError::LeaseExpired)
    ));

    lease.renew(200).unwrap();
    assert_eq!(lease.expires_at_ms(), 200);
    lease.authorize_write(150, &revision).unwrap();

    // Renewal only moves forward; it is not a way to rewrite history.
    assert!(matches!(
        lease.renew(200),
        Err(MutationError::LeaseRenewalNotMonotonic {
            current: 200,
            requested: 200
        })
    ));
    assert!(matches!(
        lease.renew(1),
        Err(MutationError::LeaseRenewalNotMonotonic { .. })
    ));

    // Renewal never affects who holds the lock: a second acquisition of the
    // same derived path is still refused while this lease lives.
    assert!(matches!(
        MutationLease::acquire(&locks, &worktree, 300, revision.clone(), [PathBuf::new()]),
        Err(MutationError::Lock(LockError::Held { .. }))
    ));
    drop(lease);
    assert!(MutationLease::acquire(&locks, &worktree, 300, revision, [PathBuf::new()]).is_ok());
}
