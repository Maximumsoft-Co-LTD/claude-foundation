use changeloop_project::{ProjectInstanceRegistry, ResourceKind, ResourceState};
use changeloop_protocol::{Event, SessionId};
use changeloop_session::{Session, SessionError};
use changeloop_snapshot::SnapshotManager;
use changeloop_storage::Storage;
use serde_json::json;
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::tempdir;

const FIXTURE_TIMEOUT: Duration = Duration::from_secs(2);
type FixtureError = Box<dyn std::error::Error + Send + Sync>;

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = std::env::args()
        .nth(2)
        .ok_or("mixed fixture name is required")?;
    let started = Instant::now();
    let semantic = match fixture.as_str() {
        "read-only-conversation" => bounded_blocking(conversation_fixture).await?,
        "disposable-worktree-mutation" => bounded_blocking(mutation_fixture).await?,
        "reconnect-replay" => bounded_blocking(reconnect_fixture).await?,
        "child-cancellation" => {
            bounded_blocking(|| {
                super::shutdown::child_sample().map_err(|error| error.to_string())?;
                Ok("child cancellation propagated and released resources")
            })
            .await?
        }
        "jobs" => {
            bounded_blocking(|| {
                super::shutdown::job_sample().map_err(|error| error.to_string())?;
                Ok("background and PTY jobs reached cancelled terminal state")
            })
            .await?
        }
        "project-create-dispose" => bounded_blocking(project_fixture).await?,
        _ => return Err(format!("unknown mixed fixture: {fixture}").into()),
    };
    println!(
        "{}",
        serde_json::to_string(&json!({
            "recordVersion": 1,
            "probe": "mixed-soak-workload",
            "fixture": fixture,
            "semanticVerification": semantic,
            "timeoutMs": FIXTURE_TIMEOUT.as_millis(),
            "durationNs": started.elapsed().as_nanos() as u64,
            "hermetic": true,
        }))?
    );
    Ok(())
}

async fn bounded_blocking<F>(fixture: F) -> Result<&'static str, String>
where
    F: FnOnce() -> Result<&'static str, FixtureError> + Send + 'static,
{
    tokio::time::timeout(FIXTURE_TIMEOUT, tokio::task::spawn_blocking(fixture))
        .await
        .map_err(|_| "mixed fixture timed out".to_owned())?
        .map_err(|error| format!("mixed fixture task failed: {error}"))?
        .map_err(|error| error.to_string())
}

fn conversation_fixture() -> Result<&'static str, FixtureError> {
    let session = Session::conversation(SessionId::from_stable("mixed-read-only"));
    if session.require_mutation_authority() != Err(SessionError::ConversationIsReadOnly) {
        return Err("conversation acquired mutation authority".into());
    }
    Ok("conversation remained read-only")
}

fn mutation_fixture() -> Result<&'static str, FixtureError> {
    let worktree = tempdir()?;
    let state = tempdir()?;
    fs::write(worktree.path().join("target.txt"), "before")?;
    fs::write(worktree.path().join("unrelated.txt"), "user-before")?;
    let mut snapshots = SnapshotManager::new(worktree.path(), state.path())?;
    let pending = snapshots.begin_step([PathBuf::from("target.txt")], 1)?;
    fs::write(worktree.path().join("target.txt"), "after")?;
    let checkpoint = snapshots.commit_step(pending, 2, BTreeSet::new())?;
    fs::write(worktree.path().join("unrelated.txt"), "user-after")?;
    snapshots.undo(&checkpoint, 3)?;
    if fs::read_to_string(worktree.path().join("target.txt"))? != "before"
        || fs::read_to_string(worktree.path().join("unrelated.txt"))? != "user-after"
    {
        return Err("snapshot mutation/undo changed the wrong workspace content".into());
    }
    Ok("mutation reverted and unrelated edit preserved")
}

fn reconnect_fixture() -> Result<&'static str, FixtureError> {
    let root = tempdir()?;
    let database = root.path().join("sessions.db");
    let session = SessionId::from_stable("mixed-reconnect");
    let cursor = {
        let mut storage = Storage::open(&database)?;
        storage.create_session(&session, 1)?;
        storage.append_event(&session, 2, Event::Heartbeat)?;
        storage.append_event(&session, 3, Event::Heartbeat)?;
        storage.append_event(&session, 4, Event::Heartbeat)?;
        let first = storage.replay(&session, None, Some(2))?;
        if first.events.len() != 2 || !first.has_more {
            return Err("initial replay page was not exact".into());
        }
        first.next_cursor.ok_or("replay cursor was missing")?
    };
    let storage = Storage::open(&database)?;
    let resumed = storage.replay(&session, Some(&cursor), Some(2))?;
    if resumed.events.len() != 1 || resumed.has_more {
        return Err("reconnect replay duplicated or lost an event".into());
    }
    let exhausted = storage.replay(&session, resumed.next_cursor.as_ref(), Some(2))?;
    if !exhausted.events.is_empty() {
        return Err("replay after terminal cursor duplicated an event".into());
    }
    Ok("reconnect cursor replayed exactly once")
}

fn project_fixture() -> Result<&'static str, FixtureError> {
    let root = tempdir()?;
    let project_root = root.path().to_path_buf();
    let mut registry = ProjectInstanceRegistry::default();
    let instance = registry.create(project_root.clone())?;
    let instance_id = instance.id.clone();
    let resource = instance.register_owned(ResourceKind::Job, "mixed-project-job")?;
    let cancellation = resource.cancellation_token();
    if registry.len() != 1 || registry.get_mut(&project_root)?.id != instance_id {
        return Err("created project instance was not registered".into());
    }
    let failures = registry.dispose(&project_root)?;
    if !failures.is_empty()
        || !registry.is_empty()
        || resource.state() != ResourceState::Shutdown
        || !cancellation.is_cancelled()
    {
        return Err("project disposal leaked resources or registry state".into());
    }
    Ok("project instance created and disposed without leaks")
}
