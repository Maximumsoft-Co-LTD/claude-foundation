use super::*;
use std::process::Command;
use tempfile::{TempDir, tempdir};

fn run_git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()
        .expect("git is available");
    assert!(
        output.status.success(),
        "git {arguments:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn empty_repository() -> TempDir {
    let root = tempdir().expect("temporary directory");
    run_git(root.path(), &["init"]);
    run_git(root.path(), &["config", "user.email", "test@example.com"]);
    run_git(root.path(), &["config", "user.name", "Test"]);
    run_git(root.path(), &["config", "commit.gpgsign", "false"]);
    root
}

/// A repository whose only commit holds `src/app.rs` with `committed`.
fn committed_repository(committed: &str) -> TempDir {
    let root = empty_repository();
    fs::create_dir_all(root.path().join("src")).expect("source directory");
    fs::write(root.path().join("src/app.rs"), committed).expect("committed file");
    run_git(root.path(), &["add", "."]);
    run_git(root.path(), &["commit", "-m", "base"]);
    root
}

fn modified(path: &str) -> WatchEvent {
    WatchEvent {
        path: PathBuf::from(path),
        kind: WatchEventKind::Modify,
    }
}

/// Performs the agent-side write the way the runtime does: the bytes recorded
/// are the post-format bytes that landed on disk.
fn agent_writes(guard: &mut ExternalChangeGuard, root: &Path, path: &str, bytes: &str) {
    let overwrote = fingerprint(&root.join(path)).expect("previous state");
    fs::write(root.join(path), bytes).expect("agent write");
    guard
        .record_self_write(path, bytes.as_bytes(), None, overwrote)
        .expect("record self write");
}

#[test]
fn self_write_echo_is_suppressed_and_runs_no_reconciliation() {
    let root = committed_repository("fn main() {}\n");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { run() }\n",
    );

    let outcome = guard.observe(&[modified("src/app.rs")]);

    assert_eq!(outcome.suppressed, vec![PathBuf::from("src/app.rs")]);
    assert!(outcome.paused.is_empty(), "an echo must not pause");
    assert!(
        outcome.surviving_events().is_empty(),
        "a suppressed echo must not reach an invalidation consumer"
    );
    assert!(guard.paused().is_empty());
}

/// The post-format digest is what the fingerprint must hold. A formatter that
/// rewrites the agent's bytes still produces the agent's own echo.
#[test]
fn post_format_bytes_are_the_echo_fingerprint_not_the_requested_bytes() {
    let root = committed_repository("fn main() {}\n");
    let requested = "fn main(){run()}\n";
    let formatted = "fn main() { run() }\n";
    let overwrote = fingerprint(&root.path().join("src/app.rs")).expect("previous state");

    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    fs::write(root.path().join("src/app.rs"), requested).expect("requested write");
    fs::write(root.path().join("src/app.rs"), formatted).expect("formatter rewrite");
    guard
        .record_self_write("src/app.rs", formatted.as_bytes(), None, overwrote)
        .expect("record self write");

    let outcome = guard.observe(&[modified("src/app.rs")]);
    assert_eq!(outcome.suppressed, vec![PathBuf::from("src/app.rs")]);
    assert!(outcome.paused.is_empty());
}

#[test]
fn external_checkout_revert_classifies_and_rewrites_nothing() {
    let root = committed_repository("fn main() {}\n");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { run() }\n",
    );

    // The user discards the agent's edit.
    run_git(root.path(), &["checkout", "--", "src/app.rs"]);

    let outcome = guard.observe(&[modified("src/app.rs")]);

    assert!(outcome.suppressed.is_empty());
    assert_eq!(outcome.paused.len(), 1);
    assert_eq!(
        outcome.paused[0].change,
        ExternalChange::ExternalRevert {
            source: RevertSource::Head
        }
    );
    assert!(guard.is_paused(Path::new("src/app.rs")));
    assert_eq!(
        fs::read_to_string(root.path().join("src/app.rs")).expect("file"),
        "fn main() {}\n",
        "the user's revert must survive; the watcher must never restore its own content"
    );
}

/// VS Code "Discard Changes" restores the staged version when a file is
/// staged, not the HEAD version.
#[test]
fn discard_to_the_staged_version_classifies_as_an_index_revert() {
    let root = committed_repository("fn main() {}\n");
    fs::write(root.path().join("src/app.rs"), "fn main() { staged() }\n").expect("stage edit");
    run_git(root.path(), &["add", "src/app.rs"]);

    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );
    fs::write(root.path().join("src/app.rs"), "fn main() { staged() }\n").expect("discard");

    let outcome = guard.observe(&[modified("src/app.rs")]);
    assert_eq!(
        outcome.paused[0].change,
        ExternalChange::ExternalRevert {
            source: RevertSource::Index
        }
    );
}

#[test]
fn hand_edit_classifies_as_external_edit_and_preserves_both_sides() {
    let root = committed_repository("fn main() {}\n");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );

    // A hand edit that matches neither HEAD nor the index.
    fs::write(root.path().join("src/app.rs"), "fn main() { human() }\n").expect("hand edit");

    let outcome = guard.observe(&[modified("src/app.rs")]);

    assert_eq!(outcome.paused.len(), 1);
    let ExternalChange::ExternalEdit {
        preserved: PreservedSide::Both { agent_copy },
    } = &outcome.paused[0].change
    else {
        panic!("expected both sides preserved, got {:?}", outcome.paused[0]);
    };
    assert_eq!(
        fs::read_to_string(root.path().join("src/app.rs")).expect("file"),
        "fn main() { human() }\n",
        "the user's side stays on disk untouched"
    );
    assert_eq!(
        fs::read_to_string(root.path().join(agent_copy)).expect("conflict copy"),
        "fn main() { agent() }\n",
        "the agent's in-flight side is preserved beside it"
    );
    assert!(
        agent_copy.starts_with(Path::new(".changeloop/conflicts/session-a")),
        "the conflict copy is session-scoped: {}",
        agent_copy.display()
    );
    let agent_digest = format!("{:x}", Sha256::digest(b"fn main() { agent() }\n"));
    assert_eq!(
        outcome.paused[0]
            .agent
            .as_ref()
            .and_then(SelfWriteFingerprint::sha256),
        Some(agent_digest.as_str()),
        "the pause record names the superseded agent write"
    );
    // A preserved conflict copy must not feed the classifier its own tail.
    assert!(!crate::should_record(agent_copy));
}

#[test]
fn repository_without_commits_falls_back_to_external_edit() {
    let root = empty_repository();
    fs::create_dir_all(root.path().join("src")).expect("source directory");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    fs::write(root.path().join("src/app.rs"), "").expect("seed");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );
    fs::write(root.path().join("src/app.rs"), "").expect("user truncates");

    let outcome = guard.observe(&[modified("src/app.rs")]);

    assert_eq!(outcome.paused.len(), 1);
    assert!(
        matches!(
            outcome.paused[0].change,
            ExternalChange::ExternalEdit { .. }
        ),
        "a repository with no HEAD has nothing to compare against and must pause, not accept: {:?}",
        outcome.paused[0].change
    );
}

#[test]
fn delete_then_recreate_in_one_window_is_one_content_changed_event_keyed_by_path() {
    let coalesced = coalesce_by_path(&[
        WatchEvent {
            path: PathBuf::from("src/app.rs"),
            kind: WatchEventKind::Delete,
        },
        WatchEvent {
            path: PathBuf::from("src/app.rs"),
            kind: WatchEventKind::Create,
        },
    ]);
    assert_eq!(coalesced.len(), 1, "atomic replace is one event, not two");
    assert_eq!(coalesced[0].path, PathBuf::from("src/app.rs"));
    assert_eq!(
        coalesced[0].folded,
        vec![WatchEventKind::Delete, WatchEventKind::Create]
    );

    // And the guard classifies the recreated path once, by content.
    let root = committed_repository("fn main() {}\n");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );
    fs::remove_file(root.path().join("src/app.rs")).expect("unlink");
    fs::write(root.path().join("src/app.rs"), "fn main() {}\n").expect("recreate");

    let outcome = guard.observe(&[
        WatchEvent {
            path: PathBuf::from("src/app.rs"),
            kind: WatchEventKind::Delete,
        },
        WatchEvent {
            path: PathBuf::from("src/app.rs"),
            kind: WatchEventKind::Create,
        },
    ]);
    assert_eq!(outcome.paused.len(), 1, "one verdict, keyed by path");
    assert_eq!(
        outcome.paused[0].change,
        ExternalChange::ExternalRevert {
            source: RevertSource::Head
        }
    );
}

/// The agent write and the user's revert collapse into one debounce window, so
/// the event stream is identical in both runs. Only the bytes on disk differ,
/// and only the bytes decide.
#[test]
fn content_equality_not_timing_decides_the_collapsed_window_race() {
    let collapsed = [modified("src/app.rs"), modified("src/app.rs")];

    let echo_root = committed_repository("fn main() {}\n");
    let mut echo_guard = ExternalChangeGuard::new(echo_root.path(), "session-a");
    agent_writes(
        &mut echo_guard,
        echo_root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );
    let echo = echo_guard.observe(&collapsed);

    let race_root = committed_repository("fn main() {}\n");
    let mut race_guard = ExternalChangeGuard::new(race_root.path(), "session-a");
    agent_writes(
        &mut race_guard,
        race_root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );
    // The revert lands inside the same window; no extra event is emitted.
    run_git(race_root.path(), &["checkout", "--", "src/app.rs"]);
    let race = race_guard.observe(&collapsed);

    assert_eq!(echo.suppressed, vec![PathBuf::from("src/app.rs")]);
    assert!(echo.paused.is_empty());
    assert!(race.suppressed.is_empty());
    assert_eq!(
        race.paused[0].change,
        ExternalChange::ExternalRevert {
            source: RevertSource::Head
        },
        "identical events, identical timing, opposite verdicts — decided by content"
    );
}

#[test]
fn a_paused_path_never_re_suppresses_its_retired_self_write() {
    let root = committed_repository("fn main() {}\n");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );
    fs::write(root.path().join("src/app.rs"), "fn main() { human() }\n").expect("hand edit");
    let first = guard.observe(&[modified("src/app.rs")]);
    assert_eq!(first.paused.len(), 1);

    // The user happens to restore exactly the agent's bytes. The pause is a
    // live conflict and must not be cleared by a stale fingerprint.
    fs::write(root.path().join("src/app.rs"), "fn main() { agent() }\n").expect("restore");
    let second = guard.observe(&[modified("src/app.rs")]);

    assert!(second.suppressed.is_empty());
    assert_eq!(second.paused.len(), 1);
    assert!(guard.is_paused(Path::new("src/app.rs")));
    assert!(
        guard.self_write(Path::new("src/app.rs")).is_none(),
        "the superseded self-write record is retired at pause time"
    );
    assert_eq!(
        guard
            .resume(Path::new("src/app.rs"))
            .map(|verdict| verdict.path),
        Some(PathBuf::from("src/app.rs"))
    );
    assert!(!guard.is_paused(Path::new("src/app.rs")));
}

#[test]
fn an_agent_delete_echo_is_suppressed_but_a_user_delete_pauses() {
    let root = committed_repository("fn main() {}\n");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    let overwrote = fingerprint(&root.path().join("src/app.rs")).expect("previous state");
    fs::remove_file(root.path().join("src/app.rs")).expect("agent delete");
    guard
        .record_self_delete("src/app.rs", overwrote)
        .expect("record self delete");
    let echo = guard.observe(&[WatchEvent {
        path: PathBuf::from("src/app.rs"),
        kind: WatchEventKind::Delete,
    }]);
    assert_eq!(echo.suppressed, vec![PathBuf::from("src/app.rs")]);

    // An unrecorded delete of a tracked file deviates from HEAD.
    fs::write(root.path().join("src/lib.rs"), "pub fn f() {}\n").expect("seed");
    run_git(root.path(), &["add", "src/lib.rs"]);
    run_git(root.path(), &["commit", "-m", "lib"]);
    fs::remove_file(root.path().join("src/lib.rs")).expect("user delete");
    let paused = guard.observe(&[WatchEvent {
        path: PathBuf::from("src/lib.rs"),
        kind: WatchEventKind::Delete,
    }]);
    assert!(matches!(
        paused.paused[0].change,
        ExternalChange::ExternalEdit {
            preserved: PreservedSide::UserOnly
        }
    ));
}

#[test]
fn surviving_events_carry_unsuppressed_paths_only() {
    let root = committed_repository("fn main() {}\n");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    agent_writes(
        &mut guard,
        root.path(),
        "src/app.rs",
        "fn main() { agent() }\n",
    );
    fs::write(root.path().join("README.md"), "hand written\n").expect("hand edit");

    let outcome = guard.observe(&[modified("src/app.rs"), modified("README.md")]);

    assert_eq!(outcome.suppressed, vec![PathBuf::from("src/app.rs")]);
    assert_eq!(outcome.surviving_events(), &[modified("README.md")]);
    assert!(!outcome.is_quiet());
}

#[test]
fn the_ledger_is_bounded_and_drops_bytes_before_it_drops_fingerprints() {
    let root = tempdir().expect("temporary directory");
    let mut guard = ExternalChangeGuard::new(root.path(), "session-a");
    for index in 0..(MAX_TRACKED_SELF_WRITES + 8) {
        guard
            .record_self_write(
                format!("file-{index:05}.txt"),
                b"content",
                None,
                FileFingerprint::Missing,
            )
            .expect("record self write");
    }
    assert_eq!(guard.ledger.len(), MAX_TRACKED_SELF_WRITES);
    assert!(guard.self_write(Path::new("file-00000.txt")).is_none());
    assert!(guard.self_write(Path::new("file-01031.txt")).is_some());
    assert!(guard.retained_bytes <= RETAINED_BYTES_BUDGET);
}

#[test]
fn session_scoping_keeps_conflict_copies_apart() {
    let root = committed_repository("fn main() {}\n");
    let mut first = ExternalChangeGuard::new(root.path(), "session/one");
    agent_writes(
        &mut first,
        root.path(),
        "src/app.rs",
        "fn main() { one() }\n",
    );
    fs::write(root.path().join("src/app.rs"), "fn main() { human() }\n").expect("hand edit");
    let outcome = first.observe(&[modified("src/app.rs")]);
    let ExternalChange::ExternalEdit {
        preserved: PreservedSide::Both { agent_copy },
    } = &outcome.paused[0].change
    else {
        panic!("expected both sides preserved");
    };
    assert!(
        agent_copy.starts_with(Path::new(".changeloop/conflicts/session-one/src")),
        "unsafe session identifiers are sanitized into one directory: {}",
        agent_copy.display()
    );
}
