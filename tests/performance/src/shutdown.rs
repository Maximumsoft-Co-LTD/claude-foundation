use changeloop_agent::{
    ChildState, ExpectedResultSchema, ModelFloor, ResultKind, SubagentBudget, SubagentRuntime,
    SubagentSpec, TaskScope,
};
use changeloop_app_server::{
    ClientQueue, QueueError, ShutdownAction, ShutdownMachine, ShutdownState,
};
use changeloop_language::{LanguageServerConfig, RunningLanguageServer};
use changeloop_policy::{ExecutionMode, LifecycleAuthority, RuleAction};
use changeloop_protocol::SessionId;
use changeloop_provider::RiskTier;
use changeloop_tools::{JobKind, JobManager, JobState, ToolPolicy, ToolRuntime};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tempfile::tempdir;

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let repetitions = std::env::args()
        .skip_while(|value| value != "--repetitions")
        .nth(1)
        .map_or(Ok(3), |value| value.parse::<usize>())?;
    let mut provider = Vec::with_capacity(repetitions);
    let mut idle = Vec::with_capacity(repetitions);
    let mut child = Vec::with_capacity(repetitions);
    let mut jobs = Vec::with_capacity(repetitions);
    let mut lsp = Vec::with_capacity(repetitions);
    let mut backpressure = Vec::with_capacity(repetitions);
    for _ in 0..repetitions {
        idle.push(idle_sample()?);
        provider.push(super::router::cancellation_sample().await?);
        child.push(child_sample()?);
        jobs.push(job_sample()?);
        lsp.push(lsp_sample()?);
        backpressure.push(backpressure_sample()?);
    }
    println!(
        "{}",
        serde_json::to_string(&json!({
            "recordVersion": 1,
            "probe": "graceful-shutdown-states",
            "workloadVersion": "shutdown-states-v1",
            "repetitions": repetitions,
            "thresholdMs": 2000,
            "states": [
                state("idle", idle),
                state("streaming-provider-mock", provider),
                state("child-agent-resources", child),
                state("pty-and-background-jobs", jobs),
                state("project-owned-lsp", lsp),
                state("backpressured-client", backpressure),
            ],
            "correctness": {"allTerminal": true, "forcedCleanupTimeouts": 0},
        }))?
    );
    Ok(())
}

fn idle_sample() -> Result<u64, Box<dyn std::error::Error>> {
    let mut shutdown = ShutdownMachine::default();
    let started = Instant::now();
    shutdown.begin(0, 2_000, 0);
    if shutdown.poll(0) != ShutdownAction::Complete
        || shutdown.state
            != (ShutdownState::Stopped {
                stopped_at_ms: 0,
                forced: false,
            })
    {
        return Err("idle shutdown did not stop cleanly without forced cleanup".into());
    }
    Ok(started.elapsed().as_nanos() as u64)
}

pub(crate) fn child_sample() -> Result<u64, Box<dyn std::error::Error>> {
    let parent = SessionId::from_stable("shutdown-parent");
    let child = SessionId::from_stable("shutdown-child");
    let mut runtime = SubagentRuntime::default();
    runtime.register(SubagentSpec {
        parent_session_id: parent.clone(),
        child_session_id: child.clone(),
        change_id: "change".into(),
        depth: 1,
        task: TaskScope {
            task_id: "shutdown".into(),
            description: "fixture".into(),
            repositories: vec!["repo".into()],
            paths: vec!["src".into()],
        },
        allowed_tools: BTreeSet::new(),
        allowed_permissions: vec![],
        risk_floor: RiskTier::Low,
        model_floor: ModelFloor::Fast,
        budget: SubagentBudget::default(),
        expected_result: ExpectedResultSchema {
            version: 1,
            kind: ResultKind::TaskResult,
        },
        base_workspace_revision: "rev".into(),
    })?;
    runtime.start(&child)?;
    runtime.add_resource(&child, "fixture", "process")?;
    let started = Instant::now();
    runtime.cancel_tree(&parent, "shutdown");
    runtime.release_resources(&child)?;
    runtime.finish_cancel(&child)?;
    if runtime.record(&child).map(|record| record.state) != Some(ChildState::Cancelled) {
        return Err("child was not terminal".into());
    }
    Ok(started.elapsed().as_nanos() as u64)
}

pub(crate) fn job_sample() -> Result<u64, Box<dyn std::error::Error>> {
    let root = tempdir()?;
    let artifacts = tempdir()?;
    let tools = ToolRuntime::new(
        root.path(),
        artifacts.path(),
        ToolPolicy {
            mode: ExecutionMode::Yolo,
            configured_action: RuleAction::Allow,
            lifecycle_authority: LifecycleAuthority::ConfirmedChange,
            hard_boundaries: vec![],
        },
    )?;
    let mut manager = JobManager::new(root.path().to_path_buf());
    let arguments = vec!["-c".into(), "sleep 30".into()];
    let background = tools.spawn_job(
        &mut manager,
        JobKind::Background,
        Path::new("/bin/sh"),
        &arguments,
        &BTreeMap::new(),
    )?;
    let pty = tools.spawn_job(
        &mut manager,
        JobKind::Pty,
        Path::new("/bin/sh"),
        &arguments,
        &BTreeMap::new(),
    )?;
    let started = Instant::now();
    manager.dispose();
    if manager.poll(&background)? != JobState::Cancelled
        || manager.poll(&pty)? != JobState::Cancelled
    {
        return Err("job cleanup was not terminal".into());
    }
    Ok(started.elapsed().as_nanos() as u64)
}

fn lsp_sample() -> Result<u64, Box<dyn std::error::Error>> {
    let root = tempdir()?;
    let tools = root.path().join("tools");
    fs::create_dir(&tools)?;
    let executable = tools.join("fake-lsp");
    fs::copy(std::env::current_exe()?, &executable)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700))?;
    }
    let mut server = RunningLanguageServer::start(
        "shutdown-lsp",
        root.path(),
        LanguageServerConfig {
            executable: PathBuf::from("tools/fake-lsp"),
            arguments: vec!["fake-lsp".into()],
            language_id: "fixture".into(),
            // Process startup can be delayed substantially when the full
            // workspace test suite is serialized under CI load. The shutdown
            // duration is measured only after initialize succeeds, so a wider
            // fixture deadline improves determinism without weakening the
            // two-second shutdown gate.
            request_timeout_ms: 5_000,
            diagnostic_debounce_ms: 0,
            diagnostic_freshness_timeout_ms: 100,
        },
    )?;
    let started = Instant::now();
    server.shutdown()?;
    Ok(started.elapsed().as_nanos() as u64)
}

fn backpressure_sample() -> Result<u64, Box<dyn std::error::Error>> {
    let mut queue = ClientQueue::new(2)?;
    queue.enqueue_heartbeat(1)?;
    queue.enqueue_heartbeat(2)?;
    let started = Instant::now();
    let result = queue.enqueue_heartbeat(3);
    while queue.pop().is_some() {}
    if result
        != Err(QueueError::Backpressure {
            capacity: 2,
            disconnect_required: true,
        })
        || !queue.is_empty()
    {
        return Err("backpressured client did not terminate cleanly".into());
    }
    Ok(started.elapsed().as_nanos() as u64)
}

fn state(name: &str, samples_ns: Vec<u64>) -> Value {
    json!({"state":name,"samplesNs":samples_ns,"terminal":true})
}

pub fn fake_lsp() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let mut stdout = std::io::stdout();
    loop {
        let mut length = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                return Ok(());
            }
            if line == "\r\n" || line == "\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = Some(value.trim().parse::<usize>()?);
            }
        }
        let mut body = vec![0; length.ok_or("missing content length")?];
        reader.read_exact(&mut body)?;
        let message: Value = serde_json::from_slice(&body)?;
        if message["method"] == "exit" {
            return Ok(());
        }
        if let Some(id) = message.get("id") {
            let result = if message["method"] == "initialize" {
                json!({"capabilities":{}})
            } else {
                Value::Null
            };
            let response = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"result":result}))?;
            write!(stdout, "Content-Length: {}\r\n\r\n", response.len())?;
            stdout.write_all(&response)?;
            stdout.flush()?;
        }
    }
}
