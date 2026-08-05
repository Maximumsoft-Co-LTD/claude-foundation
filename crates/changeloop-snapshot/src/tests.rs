use super::*;
use std::sync::{Arc, Barrier};
use tempfile::tempdir;

fn setup() -> (tempfile::TempDir, tempfile::TempDir, SnapshotManager) {
    let worktree = tempdir().unwrap();
    let state = tempdir().unwrap();
    let manager = SnapshotManager::new(worktree.path(), state.path()).unwrap();
    (worktree, state, manager)
}

#[test]
fn undo_restores_only_files_changed_by_the_step() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("edited.txt"), "before").unwrap();
    fs::write(worktree.path().join("deleted.txt"), "keep").unwrap();
    fs::write(worktree.path().join("unrelated.txt"), "user-before").unwrap();
    fs::write(worktree.path().join("declared-unchanged.txt"), "original").unwrap();
    let pending = manager
        .begin_step(
            [
                "edited.txt".into(),
                "deleted.txt".into(),
                "created.txt".into(),
                "declared-unchanged.txt".into(),
            ],
            1,
        )
        .unwrap();
    fs::write(worktree.path().join("edited.txt"), "after").unwrap();
    fs::remove_file(worktree.path().join("deleted.txt")).unwrap();
    fs::write(worktree.path().join("created.txt"), "new").unwrap();
    fs::write(worktree.path().join("unrelated.txt"), "user-after").unwrap();
    let id = manager
        .commit_step(pending, 2, BTreeSet::from(["proof-1".into()]))
        .unwrap();
    fs::write(
        worktree.path().join("declared-unchanged.txt"),
        "later-user-edit",
    )
    .unwrap();

    let outcome = manager.undo(&id, 3).unwrap();
    assert_eq!(
        fs::read_to_string(worktree.path().join("edited.txt")).unwrap(),
        "before"
    );
    assert_eq!(
        fs::read_to_string(worktree.path().join("deleted.txt")).unwrap(),
        "keep"
    );
    assert!(!worktree.path().join("created.txt").exists());
    assert_eq!(
        fs::read_to_string(worktree.path().join("unrelated.txt")).unwrap(),
        "user-after"
    );
    assert_eq!(
        fs::read_to_string(worktree.path().join("declared-unchanged.txt")).unwrap(),
        "later-user-edit"
    );
    assert_eq!(outcome.invalidated_paths.len(), 3);
    assert!(outcome.invalidated_proof_references.contains("proof-1"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for entry in fs::read_dir(state.path().join("blobs")).unwrap() {
            let mode = entry.unwrap().metadata().unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0, "snapshot blobs must be owner-only");
        }
    }
}

#[test]
fn overlap_is_detected_before_any_file_is_restored() {
    let (worktree, _state, mut manager) = setup();
    fs::write(worktree.path().join("a.txt"), "a0").unwrap();
    fs::write(worktree.path().join("b.txt"), "b0").unwrap();
    let pending = manager
        .begin_step(["a.txt".into(), "b.txt".into()], 1)
        .unwrap();
    fs::write(worktree.path().join("a.txt"), "a1").unwrap();
    fs::write(worktree.path().join("b.txt"), "b1").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    fs::write(worktree.path().join("b.txt"), "external").unwrap();

    assert!(matches!(
        manager.undo(&id, 3),
        Err(SnapshotError::ExternalModification { .. })
    ));
    assert_eq!(
        fs::read_to_string(worktree.path().join("a.txt")).unwrap(),
        "a1"
    );
    assert_eq!(
        fs::read_to_string(worktree.path().join("b.txt")).unwrap(),
        "external"
    );
    assert!(manager.audit_log().is_empty());
}

#[test]
fn corrupt_later_blob_is_preflighted_before_any_file_is_restored() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("a.txt"), "a0").unwrap();
    fs::write(worktree.path().join("b.txt"), "b0").unwrap();
    let pending = manager
        .begin_step(["a.txt".into(), "b.txt".into()], 1)
        .unwrap();
    fs::write(worktree.path().join("a.txt"), "a1").unwrap();
    fs::write(worktree.path().join("b.txt"), "b1").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    let b_before = manager
        .checkpoints()
        .iter()
        .find(|checkpoint| checkpoint.id == id)
        .unwrap()
        .files
        .iter()
        .find(|delta| delta.path == Path::new("b.txt"))
        .unwrap()
        .before
        .blob_hash()
        .unwrap()
        .to_owned();
    fs::write(state.path().join("blobs").join(b_before), "corrupt").unwrap();

    assert!(matches!(
        manager.undo(&id, 3),
        Err(SnapshotError::CorruptBlob(_))
    ));
    assert_eq!(
        fs::read_to_string(worktree.path().join("a.txt")).unwrap(),
        "a1"
    );
    assert_eq!(
        fs::read_to_string(worktree.path().join("b.txt")).unwrap(),
        "b1"
    );
    assert!(manager.audit_log().is_empty());
}

#[test]
fn redo_reapplies_change_and_both_operations_are_audited() {
    let (worktree, _state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step(["file.txt".into()], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "after").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    manager.undo(&id, 3).unwrap();
    let redo = manager.redo(4).unwrap();

    assert_eq!(
        fs::read_to_string(worktree.path().join("file.txt")).unwrap(),
        "after"
    );
    assert_eq!(redo.audit.kind, AuditKind::Redo);
    assert_eq!(manager.audit_log().len(), 2);
}

#[test]
fn persisted_manager_resumes_undo_and_redo_state() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step(["file.txt".into()], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "after").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    let manifest = state.path().join("state.json");
    manager.save(&manifest).unwrap();

    let mut resumed = SnapshotManager::load(worktree.path(), state.path(), &manifest).unwrap();
    assert_eq!(resumed.latest_applied_id(), Some(&id));
    resumed.undo(&id, 3).unwrap();
    resumed.save(&manifest).unwrap();
    let mut resumed = SnapshotManager::load(worktree.path(), state.path(), &manifest).unwrap();
    assert!(resumed.redo_available());
    resumed.redo(4).unwrap();
    assert_eq!(
        fs::read_to_string(worktree.path().join("file.txt")).unwrap(),
        "after"
    );
}

#[test]
fn undo_save_failure_rolls_workspace_and_history_back() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step(["file.txt".into()], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "after").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    let invalid_manifest = state.path().join("manifest-directory");
    fs::create_dir(&invalid_manifest).unwrap();

    assert!(manager.undo_and_save(&id, 3, &invalid_manifest).is_err());
    assert_eq!(
        fs::read_to_string(worktree.path().join("file.txt")).unwrap(),
        "after"
    );
    assert_eq!(manager.latest_applied_id(), Some(&id));
    assert!(!manager.redo_available());
    assert!(manager.audit_log().is_empty());
}

#[test]
fn redo_save_failure_restores_the_undone_workspace_and_history() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step(["file.txt".into()], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "after").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    manager.undo(&id, 3).unwrap();
    let audit_before = manager.audit_log().to_vec();
    let invalid_manifest = state.path().join("manifest-directory");
    fs::create_dir(&invalid_manifest).unwrap();

    assert!(manager.redo_and_save(4, &invalid_manifest).is_err());
    assert_eq!(
        fs::read_to_string(worktree.path().join("file.txt")).unwrap(),
        "before"
    );
    assert!(manager.latest_applied_id().is_none());
    assert!(manager.redo_available());
    assert_eq!(manager.audit_log(), audit_before);
}

#[test]
fn load_rejects_an_oversized_manifest() {
    let worktree = tempdir().unwrap();
    let state = tempdir().unwrap();
    let manifest = state.path().join("snapshots.json");
    fs::File::create(&manifest)
        .unwrap()
        .set_len(MAX_SNAPSHOT_MANIFEST_BYTES + 1)
        .unwrap();

    assert!(matches!(
        SnapshotManager::load(worktree.path(), state.path(), &manifest),
        Err(SnapshotError::InvalidManifest(message)) if message.contains("exceeds")
    ));
}

#[test]
fn save_does_not_persist_a_manifest_that_load_would_reject() {
    let (_worktree, state, mut manager) = setup();
    let manifest = state.path().join("snapshots.json");
    manager.audit.push(AuditRecord {
        operation_id: "x".repeat(MAX_SNAPSHOT_MANIFEST_BYTES as usize),
        kind: AuditKind::Undo,
        checkpoint_id: CheckpointId("checkpoint".into()),
        occurred_at_ms: 1,
        changes: Vec::new(),
    });

    assert!(matches!(
        manager.save(&manifest),
        Err(SnapshotError::InvalidManifest(message)) if message.contains("exceeds")
    ));
    assert!(!manifest.exists());
}

#[test]
fn failed_oversized_save_preserves_last_durable_manifest() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step([PathBuf::from("file.txt")], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "after").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    let manifest = state.path().join("snapshots.json");
    manager.save(&manifest).unwrap();

    manager.audit.push(AuditRecord {
        operation_id: "x".repeat(MAX_SNAPSHOT_MANIFEST_BYTES as usize),
        kind: AuditKind::Undo,
        checkpoint_id: id.clone(),
        occurred_at_ms: 3,
        changes: Vec::new(),
    });
    assert!(matches!(
        manager.save(&manifest),
        Err(SnapshotError::InvalidManifest(_))
    ));

    let recovered = SnapshotManager::load(worktree.path(), state.path(), &manifest).unwrap();
    assert_eq!(recovered.latest_applied_id(), Some(&id));
    assert!(recovered.audit_log().is_empty());
}

#[test]
fn load_rejects_unknown_fields_and_invalid_internal_references() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step([PathBuf::from("file.txt")], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "after").unwrap();
    manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    let manifest = state.path().join("snapshots.json");
    manager.save(&manifest).unwrap();
    let original: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();

    let mut unknown = original.clone();
    unknown["unexpected"] = serde_json::json!(true);
    fs::write(&manifest, serde_json::to_vec(&unknown).unwrap()).unwrap();
    assert!(matches!(
        SnapshotManager::load(worktree.path(), state.path(), &manifest),
        Err(SnapshotError::InvalidManifest(_))
    ));

    let mut dangling_redo = original;
    // CheckpointId is a newtype and therefore serializes as a string.
    dangling_redo["redo_stack"] = serde_json::json!(["missing"]);
    fs::write(&manifest, serde_json::to_vec(&dangling_redo).unwrap()).unwrap();
    assert!(matches!(
        SnapshotManager::load(worktree.path(), state.path(), &manifest),
        Err(SnapshotError::InvalidManifest(message)) if message.contains("missing checkpoint")
    ));
}

#[test]
fn load_rejects_unsafe_paths_and_invalid_blob_hashes() {
    let (worktree, state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step([PathBuf::from("file.txt")], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "after").unwrap();
    manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    let manifest = state.path().join("snapshots.json");
    manager.save(&manifest).unwrap();
    let original: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();

    let mut escaped = original.clone();
    escaped["checkpoints"][0]["files"][0]["path"] = serde_json::json!("../outside");
    fs::write(&manifest, serde_json::to_vec(&escaped).unwrap()).unwrap();
    assert!(matches!(
        SnapshotManager::load(worktree.path(), state.path(), &manifest),
        Err(SnapshotError::InvalidManifest(_))
    ));

    let mut invalid_hash = original;
    invalid_hash["checkpoints"][0]["files"][0]["before"]["Regular"]["sha256"] =
        serde_json::json!("not-a-hash");
    fs::write(&manifest, serde_json::to_vec(&invalid_hash).unwrap()).unwrap();
    assert!(matches!(
        SnapshotManager::load(worktree.path(), state.path(), &manifest),
        Err(SnapshotError::InvalidManifest(message)) if message.contains("blob hash")
    ));
}

#[test]
fn concurrent_blob_writers_enforce_quota_atomically() {
    let worktree = tempdir().unwrap();
    let state = tempdir().unwrap();
    fs::write(worktree.path().join("a.txt"), "aaaa").unwrap();
    fs::write(worktree.path().join("b.txt"), "bbbb").unwrap();
    let limits = SnapshotLimits {
        max_blob_bytes: 4,
        max_blob_files: 1,
    };
    let first = SnapshotManager::new_with_limits(worktree.path(), state.path(), limits).unwrap();
    let second = SnapshotManager::new_with_limits(worktree.path(), state.path(), limits).unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let run = |manager: SnapshotManager, path: &'static str, barrier: Arc<Barrier>| {
        std::thread::spawn(move || {
            barrier.wait();
            manager.begin_step([PathBuf::from(path)], 1)
        })
    };
    let first = run(first, "a.txt", Arc::clone(&barrier));
    let second = run(second, "b.txt", Arc::clone(&barrier));
    barrier.wait();
    let results = [first.join().unwrap(), second.join().unwrap()];

    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(SnapshotError::BlobQuotaPressure { .. })))
            .count(),
        1
    );
    assert_eq!(
        fs::read_dir(state.path().join("blobs"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| is_sha256(&entry.file_name().to_string_lossy()))
            .count(),
        1
    );
}

#[test]
fn stale_owned_blob_temporary_is_removed_and_dedup_bypasses_full_quota() {
    let worktree = tempdir().unwrap();
    let state = tempdir().unwrap();
    fs::create_dir_all(state.path().join("blobs")).unwrap();
    let stale = state
        .path()
        .join("blobs")
        .join(format!("{BLOB_TEMP_PREFIX}crashed"));
    fs::write(&stale, "partial").unwrap();
    fs::write(worktree.path().join("a.txt"), "same").unwrap();
    fs::write(worktree.path().join("b.txt"), "same").unwrap();
    let manager = SnapshotManager::new_with_limits(
        worktree.path(),
        state.path(),
        SnapshotLimits {
            max_blob_bytes: 4,
            max_blob_files: 1,
        },
    )
    .unwrap();
    assert!(!stale.exists());
    manager.begin_step([PathBuf::from("a.txt")], 1).unwrap();
    manager.begin_step([PathBuf::from("b.txt")], 2).unwrap();
}

#[test]
fn corrupt_existing_cas_entry_is_never_silently_reused() {
    let worktree = tempdir().unwrap();
    let state = tempdir().unwrap();
    fs::write(worktree.path().join("file.txt"), "trusted").unwrap();
    let manager = SnapshotManager::new(worktree.path(), state.path()).unwrap();
    let digest = format!("{:x}", Sha256::digest(b"trusted"));
    fs::write(state.path().join("blobs").join(&digest), "tampered").unwrap();

    assert!(matches!(
        manager.begin_step([PathBuf::from("file.txt")], 1),
        Err(SnapshotError::CorruptBlob(found)) if found == digest
    ));
}

#[cfg(unix)]
#[test]
fn restore_boundary_recheck_preserves_file_created_after_preflight() {
    let (worktree, _state, manager) = setup();
    fs::write(worktree.path().join("source.txt"), "desired").unwrap();
    let pending = manager
        .begin_step([PathBuf::from("source.txt")], 1)
        .unwrap();
    let desired = pending.before.get(Path::new("source.txt")).unwrap();
    fs::write(worktree.path().join("target.txt"), "external").unwrap();

    assert!(matches!(
        manager.restore(Path::new("target.txt"), desired, &FileState::Missing),
        Err(SnapshotError::ExternalModification { .. })
    ));
    assert_eq!(
        fs::read_to_string(worktree.path().join("target.txt")).unwrap(),
        "external"
    );
}

#[cfg(unix)]
#[test]
fn symlinked_cas_entry_is_rejected_without_reading_target() {
    use std::os::unix::fs::symlink;
    let worktree = tempdir().unwrap();
    let state = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(worktree.path().join("file.txt"), "trusted").unwrap();
    fs::write(outside.path().join("secret"), "trusted").unwrap();
    let manager = SnapshotManager::new(worktree.path(), state.path()).unwrap();
    let digest = format!("{:x}", Sha256::digest(b"trusted"));
    symlink(
        outside.path().join("secret"),
        state.path().join("blobs").join(&digest),
    )
    .unwrap();

    assert!(matches!(
        manager.begin_step([PathBuf::from("file.txt")], 1),
        Err(SnapshotError::CorruptBlob(found)) if found == digest
    ));
}

#[test]
fn cleanup_respects_active_evidence_redo_and_retention_references() {
    let (worktree, _state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "zero").unwrap();
    let mut ids = Vec::new();
    for (time, value) in [(1, "one"), (2, "two"), (3, "three"), (99, "four")] {
        let pending = manager.begin_step(["file.txt".into()], time).unwrap();
        fs::write(worktree.path().join("file.txt"), value).unwrap();
        ids.push(manager.commit_step(pending, time, BTreeSet::new()).unwrap());
    }
    manager.undo(&ids[2], 100).unwrap_err(); // later overlapping step prevents non-linear undo
    manager.undo(&ids[3], 100).unwrap();
    let plan = manager.cleanup_plan(
        100,
        5,
        &BTreeSet::from([ids[0].clone()]),
        &BTreeSet::from([ids[1].clone()]),
    );
    assert!(matches!(plan[0].action, CleanupAction::Keep { .. }));
    assert!(matches!(plan[1].action, CleanupAction::Keep { .. }));
    assert!(matches!(plan[2].action, CleanupAction::Delete));
    assert!(matches!(plan[3].action, CleanupAction::Keep { .. }));
}

#[test]
fn unpersisted_rollback_preserves_overlap_and_removes_only_safe_checkpoint() {
    let (worktree, _state, mut manager) = setup();
    fs::write(worktree.path().join("file.txt"), "before").unwrap();
    let pending = manager.begin_step([PathBuf::from("file.txt")], 1).unwrap();
    fs::write(worktree.path().join("file.txt"), "mutated").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    fs::write(worktree.path().join("file.txt"), "external").unwrap();

    assert!(matches!(
        manager.rollback_unpersisted(&id),
        Err(SnapshotError::ExternalModification { .. })
    ));
    assert_eq!(
        fs::read_to_string(worktree.path().join("file.txt")).unwrap(),
        "external"
    );
    assert_eq!(manager.checkpoints().len(), 1);
    assert!(manager.audit_log().is_empty());

    fs::write(worktree.path().join("file.txt"), "mutated").unwrap();
    assert_eq!(
        manager.rollback_unpersisted(&id).unwrap(),
        [PathBuf::from("file.txt")]
    );
    assert_eq!(
        fs::read_to_string(worktree.path().join("file.txt")).unwrap(),
        "before"
    );
    assert!(manager.checkpoints().is_empty());
    assert!(manager.audit_log().is_empty());
}

#[test]
fn path_escape_is_rejected() {
    let (_worktree, _state, manager) = setup();
    assert!(matches!(
        manager.begin_step([PathBuf::from("../outside")], 1),
        Err(SnapshotError::PathEscape(_))
    ));
}

#[cfg(unix)]
#[test]
fn symlink_targets_and_symlink_parents_are_rejected() {
    use std::os::unix::fs::symlink;
    let (worktree, _state, manager) = setup();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret"), "secret").unwrap();
    symlink(outside.path().join("secret"), worktree.path().join("link")).unwrap();
    symlink(outside.path(), worktree.path().join("dir-link")).unwrap();
    assert!(matches!(
        manager.begin_step([PathBuf::from("link")], 1),
        Err(SnapshotError::Symlink(_))
    ));
    assert!(matches!(
        manager.begin_step([PathBuf::from("dir-link/secret")], 1),
        Err(SnapshotError::Symlink(_))
    ));
}

#[cfg(unix)]
#[test]
fn undo_rejects_parent_replaced_by_symlink_without_touching_outside() {
    use std::os::unix::fs::symlink;
    let (worktree, _state, mut manager) = setup();
    let outside = tempdir().unwrap();
    fs::create_dir(worktree.path().join("nested")).unwrap();
    fs::write(worktree.path().join("nested/file"), "before").unwrap();
    fs::write(outside.path().join("file"), "outside").unwrap();
    let pending = manager
        .begin_step([PathBuf::from("nested/file")], 1)
        .unwrap();
    fs::write(worktree.path().join("nested/file"), "after").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();
    fs::remove_file(worktree.path().join("nested/file")).unwrap();
    fs::remove_dir(worktree.path().join("nested")).unwrap();
    symlink(outside.path(), worktree.path().join("nested")).unwrap();

    assert!(matches!(
        manager.undo(&id, 3),
        Err(SnapshotError::Symlink(_))
    ));
    assert_eq!(
        fs::read_to_string(outside.path().join("file")).unwrap(),
        "outside"
    );
    assert!(manager.audit_log().is_empty());
}

#[cfg(unix)]
#[test]
fn restore_uses_pinned_worktree_dirfd_when_root_path_is_replaced() {
    use std::os::unix::fs::symlink;
    let container = tempdir().unwrap();
    let worktree = container.path().join("worktree");
    let moved = container.path().join("moved-worktree");
    let outside = tempdir().unwrap();
    let state = tempdir().unwrap();
    fs::create_dir(&worktree).unwrap();
    fs::write(worktree.join("file"), "before").unwrap();
    fs::write(outside.path().join("file"), "replacement-tree").unwrap();
    let mut manager = SnapshotManager::new(&worktree, state.path()).unwrap();
    let pending = manager.begin_step([PathBuf::from("file")], 1).unwrap();
    fs::write(worktree.join("file"), "after").unwrap();
    let id = manager.commit_step(pending, 2, BTreeSet::new()).unwrap();

    fs::rename(&worktree, &moved).unwrap();
    symlink(outside.path(), &worktree).unwrap();
    manager.undo(&id, 3).unwrap();

    assert_eq!(fs::read_to_string(moved.join("file")).unwrap(), "before");
    assert_eq!(
        fs::read_to_string(outside.path().join("file")).unwrap(),
        "replacement-tree"
    );
    assert_eq!(SnapshotManager::path_safety(), "dirfd-openat-nofollow");
}

#[cfg(unix)]
#[test]
fn capture_rejects_a_fifo_without_waiting_for_a_writer() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let (worktree, _state, manager) = setup();
    let fifo = worktree.path().join("hostile-fifo");
    let fifo_name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);

    assert!(matches!(
        manager.begin_step([PathBuf::from("hostile-fifo")], 1),
        Err(SnapshotError::Directory(path)) if path == Path::new("hostile-fifo")
    ));
}
