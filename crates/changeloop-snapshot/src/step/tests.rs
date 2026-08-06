use super::*;
use changeloop_project::WatchEventKind;
use changeloop_project::external_change::ExternalChange;
use tempfile::{TempDir, tempdir};

const HORIZON: u64 = 1_000_000;

struct Fixture {
    worktree: TempDir,
    state: TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            worktree: tempdir().unwrap(),
            state: tempdir().unwrap(),
        }
    }

    fn root(&self) -> PathBuf {
        fs::canonicalize(self.worktree.path()).unwrap()
    }

    fn write_file(&self, relative: &str, contents: &str) {
        let path = self.root().join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn read_file(&self, relative: &str) -> String {
        fs::read_to_string(self.root().join(relative)).unwrap()
    }

    fn request(&self) -> MutationRequest {
        MutationRequest::new(
            self.worktree.path(),
            self.state.path(),
            "session-1",
            HORIZON,
        )
    }

    fn begin(&self) -> WorktreeMutation {
        WorktreeMutation::begin(self.request()).unwrap()
    }
}

fn git(root: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .env("GIT_AUTHOR_NAME", "test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn modified(path: &str) -> WatchEvent {
    WatchEvent {
        path: PathBuf::from(path),
        kind: WatchEventKind::Modify,
    }
}

#[test]
fn a_step_snapshot_restores_the_worktree_exactly() {
    let fixture = Fixture::new();
    fixture.write_file("edited.txt", "before");
    fixture.write_file("removed.txt", "keep");
    fixture.write_file("untouched.txt", "user");
    let mut mutation = fixture.begin();

    mutation
        .begin_step(
            [
                "edited.txt".into(),
                "removed.txt".into(),
                "created.txt".into(),
            ],
            1,
        )
        .unwrap();
    assert!(
        mutation
            .write("edited.txt", b"after", 2)
            .unwrap()
            .applied()
            .is_some()
    );
    assert!(
        mutation
            .write("created.txt", b"new", 3)
            .unwrap()
            .applied()
            .is_some()
    );
    assert!(
        mutation
            .delete("removed.txt", 4)
            .unwrap()
            .applied()
            .is_some()
    );
    let checkpoint = mutation.commit_step(5, BTreeSet::new()).unwrap();

    assert_eq!(fixture.read_file("edited.txt"), "after");
    assert!(!fixture.root().join("removed.txt").exists());

    let outcome = mutation.restore_step(&checkpoint, 6).unwrap();
    assert_eq!(outcome.invalidated_paths.len(), 3);
    assert_eq!(fixture.read_file("edited.txt"), "before");
    assert_eq!(fixture.read_file("removed.txt"), "keep");
    assert!(!fixture.root().join("created.txt").exists());
    // Files the step never declared are untouched by the restore.
    assert_eq!(fixture.read_file("untouched.txt"), "user");
}

#[test]
fn snapshotting_never_touches_the_users_git_history() {
    let fixture = Fixture::new();
    let root = fixture.root();
    git(&root, &["init", "--quiet"]);
    fixture.write_file("tracked.txt", "committed\n");
    git(&root, &["add", "tracked.txt"]);
    git(&root, &["commit", "--quiet", "-m", "initial"]);

    let head_before = git(&root, &["rev-parse", "HEAD"]);
    let commits_before = git(&root, &["rev-list", "--all"]);
    let objects_before = git(&root, &["rev-list", "--all", "--objects"]);
    let reflog_before = git(&root, &["reflog", "--format=%H %gs"]);
    let stash_before = git(&root, &["stash", "list"]);
    let refs_before = git(&root, &["show-ref"]);
    let status_before = git(&root, &["status", "--porcelain", "--untracked-files=no"]);

    let mut mutation = fixture.begin();
    mutation.begin_step(["tracked.txt".into()], 1).unwrap();
    mutation
        .write("tracked.txt", b"agent rewrote this\n", 2)
        .unwrap();
    let checkpoint = mutation.commit_step(3, BTreeSet::new()).unwrap();
    assert_ne!(
        git(&root, &["status", "--porcelain", "--untracked-files=no"]),
        status_before,
        "the agent write must be visible as a working-tree change"
    );
    mutation.restore_step(&checkpoint, 4).unwrap();
    drop(mutation);

    // The shadow store lives outside the repository entirely.
    assert!(!fixture.state.path().starts_with(&root));
    assert_eq!(git(&root, &["rev-parse", "HEAD"]), head_before);
    assert_eq!(git(&root, &["rev-list", "--all"]), commits_before);
    assert_eq!(
        git(&root, &["rev-list", "--all", "--objects"]),
        objects_before
    );
    assert_eq!(git(&root, &["reflog", "--format=%H %gs"]), reflog_before);
    assert_eq!(git(&root, &["stash", "list"]), stash_before);
    assert_eq!(git(&root, &["show-ref"]), refs_before);
    assert_eq!(
        git(&root, &["status", "--porcelain", "--untracked-files=no"]),
        status_before
    );
    assert_eq!(fixture.read_file("tracked.txt"), "committed\n");
}

#[test]
fn the_shadow_store_is_refused_inside_the_users_git_directory() {
    let fixture = Fixture::new();
    let root = fixture.root();
    git(&root, &["init", "--quiet"]);
    let inside = root.join(".git").join("changeloop-snapshots");
    let request = MutationRequest::new(fixture.worktree.path(), &inside, "session-1", HORIZON);
    assert!(matches!(
        WorktreeMutation::begin(request),
        Err(StepError::StateInsideGitDirectory(_))
    ));
}

#[test]
fn a_write_whose_expected_revision_no_longer_matches_pauses_instead_of_overwriting() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    let mut mutation = fixture.begin();
    mutation.begin_step(["a.txt".into()], 1).unwrap();

    // A user edit lands between the step's capture and the agent's write.
    fixture.write_file("a.txt", "user edit");

    let outcome = mutation.write("a.txt", b"agent", 2).unwrap();
    let paused = outcome.paused().expect("the write must pause");
    assert_eq!(paused.path, PathBuf::from("a.txt"));
    assert!(matches!(
        paused.classification,
        ConflictClassification::OverlappingExternalEdit { .. }
    ));
    assert_eq!(
        paused.expected,
        FileFingerprint::File {
            sha256: sha256_hex(b"original"),
            byte_length: 8,
        }
    );
    assert_eq!(
        paused.observed,
        FileFingerprint::File {
            sha256: sha256_hex(b"user edit"),
            byte_length: 9,
        }
    );
    // The user's bytes are still on disk.
    assert_eq!(fixture.read_file("a.txt"), "user edit");
    assert!(mutation.paused().contains_key(Path::new("a.txt")));

    // A retry stays paused until someone resolves it.
    assert!(
        mutation
            .write("a.txt", b"agent again", 3)
            .unwrap()
            .paused()
            .is_some()
    );
    assert_eq!(fixture.read_file("a.txt"), "user edit");

    // Resolution is the caller's act; afterwards the path writes again.
    assert!(mutation.resume("a.txt").unwrap().is_some());
    assert!(
        mutation
            .write("a.txt", b"agent", 4)
            .unwrap()
            .applied()
            .is_some()
    );
    assert_eq!(fixture.read_file("a.txt"), "agent");
}

#[test]
fn write_revert_write_inside_one_watcher_window_is_caught_by_the_revision_check() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    let overwrote = FileFingerprint::File {
        sha256: sha256_hex(b"original"),
        byte_length: 8,
    };

    // Part 1 — the watcher's blind spot, stated as a counterfactual.
    //
    // Had both agent writes landed, the debounce window would only ever observe
    // the final bytes. They match the latest self-write fingerprint, so the
    // window suppresses and the user's intervening revert leaves no trace. No
    // watcher can observe a state that never survived to a poll.
    {
        let counterfactual = tempdir().unwrap();
        let root = fs::canonicalize(counterfactual.path()).unwrap();
        let mut guard = ExternalChangeGuard::new(&root, "session-1");
        guard
            .record_self_write("a.txt", b"agent-A", None, overwrote.clone())
            .unwrap();
        // The user reverts, and the agent's second write overwrites the revert
        // before the window closes.
        guard
            .record_self_write(
                "a.txt",
                b"agent-B",
                None,
                FileFingerprint::File {
                    sha256: sha256_hex(b"original"),
                    byte_length: 8,
                },
            )
            .unwrap();
        fs::write(root.join("a.txt"), b"agent-B").unwrap();
        let outcome = guard.observe(&[modified("a.txt"), modified("a.txt"), modified("a.txt")]);
        assert_eq!(outcome.suppressed, vec![PathBuf::from("a.txt")]);
        assert!(
            outcome.is_quiet(),
            "the window cannot see a revert that did not survive to a poll"
        );
    }

    // Part 2 — the expected-revision check on the second write catches it.
    let mut mutation = fixture.begin();
    mutation.begin_step(["a.txt".into()], 1).unwrap();

    let first = mutation.write("a.txt", b"agent-A", 2).unwrap();
    let applied = first.applied().expect("the first write must apply");
    assert_eq!(applied.overwrote, overwrote);
    assert_eq!(fixture.read_file("a.txt"), "agent-A");

    // The user reverts, entirely inside the debounce window.
    fixture.write_file("a.txt", "original");

    let second = mutation.write("a.txt", b"agent-B", 3).unwrap();
    let paused = second
        .paused()
        .expect("the second write must pause, not overwrite the revert");
    assert!(matches!(
        paused.classification,
        ConflictClassification::OverlappingExternalEdit { .. }
    ));
    assert_eq!(
        paused.expected,
        FileFingerprint::File {
            sha256: sha256_hex(b"agent-A"),
            byte_length: 7,
        },
        "the agent expected the revision it wrote"
    );
    assert_eq!(
        paused.observed,
        FileFingerprint::File {
            sha256: sha256_hex(b"original"),
            byte_length: 8,
        },
        "disk holds the user's revert"
    );
    assert_eq!(
        paused.agent.as_ref().and_then(SelfWriteFingerprint::sha256),
        Some(sha256_hex(b"agent-A").as_str())
    );
    assert!(
        paused.watcher.is_none(),
        "the watcher saw nothing; this pause comes from the revision check alone"
    );
    // The user's revert survives.
    assert_eq!(fixture.read_file("a.txt"), "original");

    // And the window really would have suppressed: replayed now, the guard's
    // own ledger still matches its last self-write rather than disk.
    let outcome = mutation.observe(&[modified("a.txt"), modified("a.txt")]);
    assert!(outcome.suppressed.is_empty());
    assert_eq!(outcome.paused.len(), 1);
    assert!(matches!(
        outcome.paused[0].change,
        ExternalChange::ExternalEdit { .. }
    ));
}

#[test]
fn a_second_mutating_execution_against_the_same_worktree_is_refused() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    let first = fixture.begin();

    let second_state = tempdir().unwrap();
    let request = MutationRequest::new(
        fixture.worktree.path(),
        second_state.path(),
        "session-2",
        HORIZON,
    );
    // A different state directory does not buy a second writer: the lease key is
    // derived from the worktree, not from where the caller keeps its state.
    let refused = WorktreeMutation::begin(request);
    assert!(
        matches!(refused, Err(StepError::WorktreeBusy { .. })),
        "expected WorktreeBusy, got {refused:?}",
        refused = refused
            .map(|_| "a second mutation")
            .map_err(|e| e.to_string())
    );

    drop(first);
    let third = WorktreeMutation::begin(MutationRequest::new(
        fixture.worktree.path(),
        second_state.path(),
        "session-3",
        HORIZON,
    ));
    assert!(
        third.is_ok(),
        "releasing the mutation must free the worktree"
    );
}

#[test]
fn a_write_outside_an_open_step_is_refused() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    fixture.write_file("b.txt", "original");
    let mut mutation = fixture.begin();

    assert!(matches!(
        mutation.write("a.txt", b"agent", 1),
        Err(StepError::NoOpenStep)
    ));
    mutation.begin_step(["a.txt".into()], 1).unwrap();
    assert!(matches!(
        mutation.write("b.txt", b"agent", 2),
        Err(StepError::UndeclaredStepPath(_))
    ));
    assert_eq!(fixture.read_file("b.txt"), "original");
    assert!(matches!(
        mutation.begin_step(["a.txt".into()], 3),
        Err(StepError::StepAlreadyOpen(_))
    ));
}

#[test]
fn a_paused_path_does_not_gate_writes_to_the_rest_of_the_step() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    fixture.write_file("b.txt", "original");
    let mut mutation = fixture.begin();
    mutation
        .begin_step(["a.txt".into(), "b.txt".into()], 1)
        .unwrap();

    // The user edits a path the agent has not written yet.
    fixture.write_file("a.txt", "user edit");

    let outcome = mutation.write("b.txt", b"agent", 2).unwrap();
    assert!(
        outcome.applied().is_some(),
        "an unrelated divergence must not stall this write"
    );
    assert_eq!(fixture.read_file("b.txt"), "agent");
    assert!(mutation.paused().contains_key(Path::new("a.txt")));
    assert_eq!(fixture.read_file("a.txt"), "user edit");

    // The diverged path stays paused.
    assert!(
        mutation
            .write("a.txt", b"agent", 3)
            .unwrap()
            .paused()
            .is_some()
    );
    assert_eq!(fixture.read_file("a.txt"), "user edit");
}

#[test]
fn the_expected_revision_follows_post_format_bytes() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    let mut mutation = fixture.begin();
    mutation.begin_step(["a.txt".into()], 1).unwrap();

    // A format-then-check write transaction: the formatter rewrites what the
    // agent requested, and the post-format bytes are what actually land.
    let outcome = mutation
        .write_with("a.txt", 2, |worktree, relative| {
            let formatted = b"agent\n".to_vec();
            fs::write(worktree.join(relative), &formatted)?;
            Ok(formatted)
        })
        .unwrap();
    let applied = outcome.applied().expect("the formatted write must apply");
    assert_eq!(
        applied.written,
        FileFingerprint::File {
            sha256: sha256_hex(b"agent\n"),
            byte_length: 6,
        }
    );

    // The next write is checked against the post-format bytes, so the
    // formatter's own rewrite is not a false conflict.
    assert!(
        mutation
            .write("a.txt", b"agent again\n", 3)
            .unwrap()
            .applied()
            .is_some()
    );
    assert_eq!(fixture.read_file("a.txt"), "agent again\n");

    // The watcher agrees: the post-format bytes are this session's own echo.
    let outcome = mutation.observe(&[modified("a.txt")]);
    assert_eq!(outcome.suppressed, vec![PathBuf::from("a.txt")]);
}

#[test]
fn a_write_overwritten_during_its_own_transaction_pauses() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    let mut mutation = fixture.begin();
    mutation.begin_step(["a.txt".into()], 1).unwrap();

    let outcome = mutation
        .write_with("a.txt", 2, |worktree, relative| {
            // The caller reports bytes that are not what remained on disk.
            fs::write(worktree.join(relative), b"raced")?;
            Ok(b"agent".to_vec())
        })
        .unwrap();
    assert!(outcome.paused().is_some());
    assert_eq!(fixture.read_file("a.txt"), "raced");
}

#[test]
fn a_git_revision_move_is_reported_once_and_then_discriminates_on_content() {
    let fixture = Fixture::new();
    let root = fixture.root();
    git(&root, &["init", "--quiet"]);
    fixture.write_file("a.txt", "original");
    fixture.write_file("b.txt", "original");
    git(&root, &["add", "."]);
    git(&root, &["commit", "--quiet", "-m", "initial"]);

    let mut mutation = fixture.begin();
    mutation
        .begin_step(["a.txt".into(), "b.txt".into()], 1)
        .unwrap();

    // A commit moves the workspace revision without changing any tracked bytes.
    git(
        &root,
        &["commit", "--quiet", "--allow-empty", "-m", "second"],
    );

    let paused = mutation
        .write("a.txt", b"agent", 2)
        .unwrap()
        .paused()
        .cloned()
        .expect("the revision move must be surfaced");
    assert_eq!(
        paused.classification,
        ConflictClassification::RevisionChanged
    );
    assert_eq!(fixture.read_file("a.txt"), "original");

    // It is reported once. Other paths keep writing on content discrimination.
    assert!(
        mutation
            .write("b.txt", b"agent", 3)
            .unwrap()
            .applied()
            .is_some()
    );
    assert_eq!(fixture.read_file("b.txt"), "agent");
}

#[test]
fn a_pinned_revision_token_discriminates_purely_on_content() {
    let fixture = Fixture::new();
    let root = fixture.root();
    git(&root, &["init", "--quiet"]);
    fixture.write_file("a.txt", "original");
    git(&root, &["add", "."]);
    git(&root, &["commit", "--quiet", "-m", "initial"]);

    let mut mutation =
        WorktreeMutation::begin(fixture.request().with_revision_token("pinned")).unwrap();
    mutation.begin_step(["a.txt".into()], 1).unwrap();
    git(
        &root,
        &["commit", "--quiet", "--allow-empty", "-m", "second"],
    );

    assert!(
        mutation
            .write("a.txt", b"agent", 2)
            .unwrap()
            .applied()
            .is_some()
    );
    assert_eq!(fixture.read_file("a.txt"), "agent");
}

#[test]
fn a_restore_is_recorded_as_this_sessions_own_write() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    let mut mutation = fixture.begin();
    mutation.begin_step(["a.txt".into()], 1).unwrap();
    mutation.write("a.txt", b"agent", 2).unwrap();
    let checkpoint = mutation.commit_step(3, BTreeSet::new()).unwrap();

    mutation.restore_step(&checkpoint, 4).unwrap();
    assert_eq!(fixture.read_file("a.txt"), "original");

    // The watcher must read the harness's own restore as an echo, not a hand
    // edit, and the expected revision must follow it.
    let outcome = mutation.observe(&[modified("a.txt")]);
    assert_eq!(outcome.suppressed, vec![PathBuf::from("a.txt")]);
    mutation.begin_step(["a.txt".into()], 5).unwrap();
    assert!(
        mutation
            .write("a.txt", b"agent again", 6)
            .unwrap()
            .applied()
            .is_some()
    );
}

#[test]
fn a_checkpoint_survives_a_new_mutating_execution() {
    let fixture = Fixture::new();
    fixture.write_file("a.txt", "original");
    let checkpoint = {
        let mut mutation = fixture.begin();
        mutation.begin_step(["a.txt".into()], 1).unwrap();
        mutation.write("a.txt", b"agent", 2).unwrap();
        mutation
            .commit_step(3, BTreeSet::from(["proof-1".into()]))
            .unwrap()
    };

    let mut resumed = fixture.begin();
    assert!(
        resumed
            .snapshots()
            .checkpoints()
            .iter()
            .any(|entry| entry.id == checkpoint)
    );
    let outcome = resumed.restore_step(&checkpoint, 4).unwrap();
    assert!(outcome.invalidated_proof_references.contains("proof-1"));
    assert_eq!(fixture.read_file("a.txt"), "original");
}
