//! Cross-process proof that the app-server owns all writes.
//!
//! These tests re-execute this same test binary as a genuinely separate
//! operating-system process. A `fork` would not prove anything here: the child
//! would inherit both the open file description carrying the `flock` and the
//! in-process lease table, so it would legitimately share the writer role. Only
//! an `exec`'d process starts with neither.

use changeloop_storage::{Storage, StorageError};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use tempfile::tempdir;

/// Set on the re-executed child to select its role.
const CHILD_ROLE: &str = "CHANGELOOP_STORAGE_WRITER_CHILD";
/// Database the child should try to own.
const CHILD_DATABASE: &str = "CHANGELOOP_STORAGE_WRITER_DATABASE";

const EXIT_REFUSED: i32 = 17;
const EXIT_ACQUIRED: i32 = 18;
const EXIT_UNEXPECTED: i32 = 19;

fn child_database() -> PathBuf {
    PathBuf::from(std::env::var_os(CHILD_DATABASE).expect("child database path"))
}

fn spawn_child(role: &str, test: &str, database: &Path) -> Command {
    let mut command = Command::new(std::env::current_exe().expect("test binary path"));
    command
        .args(["--exact", test, "--nocapture", "--test-threads", "1"])
        .env(CHILD_ROLE, role)
        .env(CHILD_DATABASE, database);
    command
}

fn wait_for(path: &Path, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if path.exists() {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("timed out waiting for {what} at {}", path.display());
}

#[test]
fn second_process_cannot_acquire_the_writer_role() {
    if std::env::var_os(CHILD_ROLE).is_some() {
        let code = match Storage::open(child_database()) {
            Err(StorageError::WriterHeld { .. }) => EXIT_REFUSED,
            Ok(_) => EXIT_ACQUIRED,
            Err(_) => EXIT_UNEXPECTED,
        };
        std::process::exit(code);
    }

    let directory = tempdir().unwrap();
    let database = directory.path().join("state.db");
    let owner = Storage::open(&database).unwrap();
    let lock = owner
        .writer_lock_path()
        .expect("file-backed storage holds a writer grant")
        .to_path_buf();
    assert!(lock.is_file(), "writer lock must be a real file");

    let refused = spawn_child(
        "refuse",
        "second_process_cannot_acquire_the_writer_role",
        &database,
    )
    .status()
    .unwrap();
    assert_eq!(
        refused.code(),
        Some(EXIT_REFUSED),
        "a second process must be refused the writer role while one is held"
    );

    // The refusal is not permanent: releasing the handle releases the role.
    drop(owner);
    let acquired = spawn_child(
        "acquire",
        "second_process_cannot_acquire_the_writer_role",
        &database,
    )
    .status()
    .unwrap();
    assert_eq!(
        acquired.code(),
        Some(EXIT_ACQUIRED),
        "the writer role must be available once the owner drops it"
    );
}

#[test]
fn killed_writer_releases_the_lock_without_manual_cleanup() {
    if std::env::var_os(CHILD_ROLE).is_some() {
        let database = child_database();
        let storage = Storage::open(&database).expect("child owns the writer role");
        std::fs::write(database.with_extension("ready"), b"owned").unwrap();
        // Held until the parent kills this process. `flock` is chosen exactly
        // for what happens next: the kernel closes the descriptor and drops the
        // lock, so no destructor and no cleanup pass is involved.
        loop {
            std::thread::sleep(Duration::from_secs(1));
            std::hint::black_box(&storage);
        }
    }

    let directory = tempdir().unwrap();
    let database = directory.path().join("state.db");
    let ready = database.with_extension("ready");
    let mut child = spawn_child(
        "hold",
        "killed_writer_releases_the_lock_without_manual_cleanup",
        &database,
    )
    .spawn()
    .unwrap();
    wait_for(&ready, "the child to take the writer role");

    match Storage::open(&database) {
        Err(StorageError::WriterHeld { .. }) => {}
        Ok(_) => panic!("a second process took the writer role from a live owner"),
        Err(error) => panic!("unexpected error contending for the writer role: {error}"),
    }

    // SIGKILL: no unwinding, no Drop, no chance to tidy up.
    child.kill().unwrap();
    child.wait().unwrap();

    let deadline = Instant::now() + Duration::from_secs(30);
    let reclaimed = loop {
        match Storage::open(&database) {
            Ok(storage) => break storage,
            Err(error) if Instant::now() < deadline => {
                assert!(
                    matches!(error, StorageError::WriterHeld { .. }),
                    "unexpected error while waiting for the kernel to release: {error}"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("killed writer's lock was never released: {error}"),
        }
    };
    let lock = reclaimed
        .writer_lock_path()
        .expect("file-backed storage holds a writer grant")
        .to_path_buf();
    assert!(
        lock.is_file(),
        "recovery must not require deleting the lock file by hand"
    );
}
