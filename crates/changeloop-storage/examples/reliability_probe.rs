use changeloop_protocol::{Event, EventId, OperationId, SessionId};
use changeloop_storage::{SessionRuntimeState, Storage};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};
use tempfile::tempdir;

const RECORD_VERSION: u32 = 1;

fn main() {
    if let Err(error) = run() {
        eprintln!("reliability probe failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = env::args().skip(1);
    let command = arguments.next().unwrap_or_else(|| "help".into());
    let options = arguments.collect::<Vec<_>>();
    let output = match command.as_str() {
        "replay" => replay_probe(
            option_usize(&options, "--events", 10_000)?,
            option_usize(&options, "--warmups", 1)?,
            option_usize(&options, "--repetitions", 3)?,
        )?,
        "replay-once" => replay_once_command(
            PathBuf::from(option_required(&options, "--database")?),
            option_usize(&options, "--events", 10_000)?,
        )?,
        "shutdown" => shutdown_probe(option_usize(&options, "--repetitions", 3)?)?,
        "soak" => soak_probe(
            option_u64(&options, "--duration-seconds", 5)?,
            option_usize(&options, "--events", 1_000)?,
        )?,
        _ => {
            return Err(
                "usage: reliability_probe replay|shutdown|soak [--events N] [--warmups N] [--repetitions N] [--duration-seconds N]"
                    .into(),
            );
        }
    };
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

fn replay_probe(
    events: usize,
    warmups: usize,
    repetitions: usize,
) -> Result<Value, Box<dyn std::error::Error>> {
    if events == 0 || repetitions == 0 {
        return Err("events and repetitions must be greater than zero".into());
    }
    let directory = tempdir()?;
    let database = directory.path().join("replay.db");
    let session = SessionId::from_stable("performance-replay-v1");
    let mut storage = Storage::open(&database)?;
    storage.create_session(&session, 1)?;
    for index in 0..events {
        storage.append_event_with_id(
            &session,
            EventId::from_stable(format!("performance-event-{index:08}")),
            index as u64 + 2,
            Event::SessionStateChanged {
                state: format!("event-{index:08}"),
            },
        )?;
    }
    drop(storage);

    for _ in 0..warmups {
        replay_child(&database, events)?;
    }
    let mut samples_ns = Vec::with_capacity(repetitions);
    let mut memory_samples = Vec::with_capacity(repetitions);
    for _ in 0..repetitions {
        let started = Instant::now();
        let memory = replay_child(&database, events)?;
        samples_ns.push(started.elapsed().as_nanos() as u64);
        memory_samples.push(memory);
    }
    let max_rss_growth_kib = memory_samples.iter().copied().max().unwrap_or(0);
    const MEMORY_LIMIT_KIB: u64 = 64 * 1024;
    Ok(json!({
        "recordVersion": RECORD_VERSION,
        "probe": "sqlite-event-replay",
        "workloadVersion": "event-replay-v1",
        "cacheVariant": if warmups == 0 { "process-reopen-cold" } else { "process-reopen-warm" },
        "eventCount": events,
        "warmups": warmups,
        "repetitions": repetitions,
        "samplesNs": samples_ns,
        "memorySamplesKiB": memory_samples,
        "maxRssGrowthKiB": max_rss_growth_kib,
        "memoryLimitKiB": MEMORY_LIMIT_KIB,
        "memoryBounded": max_rss_growth_kib <= MEMORY_LIMIT_KIB,
        "databaseBytes": fs::metadata(&database)?.len(),
        "correctness": {"exactCount": true, "exactOrder": true, "duplicates": 0},
    }))
}

fn replay_child(database: &Path, events: usize) -> Result<u64, Box<dyn std::error::Error>> {
    let event_count = events.to_string();
    let output = Command::new(env::current_exe()?)
        .args([
            "replay-once",
            "--database",
            database
                .to_str()
                .ok_or("replay database path is not UTF-8")?,
            "--events",
            &event_count,
        ])
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "replay child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    let value: Value = serde_json::from_slice(&output.stdout)?;
    value["maxRssGrowthKiB"]
        .as_u64()
        .ok_or_else(|| "replay child omitted max RSS growth".into())
}

fn replay_once_command(
    database: PathBuf,
    events: usize,
) -> Result<Value, Box<dyn std::error::Error>> {
    let session = SessionId::from_stable("performance-replay-v1");
    let baseline_rss_kib = current_rss_kib()?;
    let peak_rss_kib = replay_once(&database, &session, events)?;
    Ok(json!({
        "maxRssGrowthKiB": peak_rss_kib.saturating_sub(baseline_rss_kib),
    }))
}

fn replay_once(
    database: &std::path::Path,
    session: &SessionId,
    expected: usize,
) -> Result<u64, Box<dyn std::error::Error>> {
    let storage = Storage::open(database)?;
    let mut cursor = None;
    let mut index = 0_usize;
    let mut ids = HashSet::with_capacity(expected);
    let mut peak_rss_kib = current_rss_kib()?;
    loop {
        let page = storage.replay(session, cursor.as_ref(), Some(1_000))?;
        for envelope in &page.events {
            let expected_id = format!("performance-event-{index:08}");
            if envelope.id.0 != expected_id {
                return Err(format!(
                    "event {index} had ID {}, expected {expected_id}",
                    envelope.id
                )
                .into());
            }
            let Event::SessionStateChanged { state } = &envelope.event else {
                return Err(format!("event {index} had an unexpected type").into());
            };
            if state != &format!("event-{index:08}") {
                return Err(format!("event {index} was out of order").into());
            }
            if !ids.insert(envelope.id.clone()) {
                return Err(format!("duplicate event ID {}", envelope.id).into());
            }
            index += 1;
        }
        peak_rss_kib = peak_rss_kib.max(current_rss_kib()?);
        cursor = page.next_cursor;
        if !page.has_more {
            break;
        }
    }
    if index != expected {
        return Err(format!("replayed {index} events, expected {expected}").into());
    }
    Ok(peak_rss_kib)
}

fn current_rss_kib() -> Result<u64, Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    {
        let status = fs::read_to_string("/proc/self/status")?;
        let line = status
            .lines()
            .find(|line| line.starts_with("VmRSS:"))
            .ok_or("/proc/self/status omitted VmRSS")?;
        return line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| "VmRSS omitted its value".into())?
            .parse::<u64>()
            .map_err(Into::into);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let output = Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()?;
        if !output.status.success() {
            return Err("ps failed while sampling replay RSS".into());
        }
        Ok(String::from_utf8(output.stdout)?.trim().parse()?)
    }
}

fn shutdown_probe(repetitions: usize) -> Result<Value, Box<dyn std::error::Error>> {
    if repetitions == 0 {
        return Err("repetitions must be greater than zero".into());
    }
    let directory = tempdir()?;
    let mut samples_ns = Vec::with_capacity(repetitions);
    for index in 0..repetitions {
        let database = directory.path().join(format!("shutdown-{index}.db"));
        let session = SessionId::from_stable(format!("shutdown-session-{index}"));
        let operation = OperationId::from_stable(format!("shutdown-operation-{index}"));
        let storage = Storage::open(&database)?;
        storage.create_session(&session, 1)?;
        storage.begin_operation(&session, &operation, 2)?;
        drop(storage);

        let started = Instant::now();
        let mut recovered = Storage::open(&database)?;
        let markers = recovered.recover_interrupted_operations(3)?;
        if markers.len() != 1
            || recovered.session_state(&session)? != SessionRuntimeState::Interrupted
        {
            return Err(format!("shutdown recovery {index} did not terminalize owned work").into());
        }
        drop(recovered);
        samples_ns.push(started.elapsed().as_nanos() as u64);
    }
    Ok(json!({
        "recordVersion": RECORD_VERSION,
        "probe": "durable-shutdown-recovery",
        "workloadVersion": "shutdown-recovery-v1",
        "repetitions": repetitions,
        "samplesNs": samples_ns,
        "correctness": {"terminalMarkersPerOperation": 1, "state": "interrupted"},
        "scope": "SQLite-owned operations; process-tree shutdown states require integration fixtures",
    }))
}

fn soak_probe(duration_seconds: u64, events: usize) -> Result<Value, Box<dyn std::error::Error>> {
    if duration_seconds == 0 || events == 0 {
        return Err("duration and events must be greater than zero".into());
    }
    let integrity_start = integrity_snapshot()?;
    let directory = tempdir()?;
    let database = directory.path().join("soak.db");
    let session = SessionId::from_stable("storage-soak-v1");
    let mut storage = Storage::open(&database)?;
    storage.create_session(&session, 1)?;
    for index in 0..events {
        storage.append_event_with_id(
            &session,
            EventId::from_stable(format!("soak-event-{index:08}")),
            index as u64 + 2,
            Event::Heartbeat,
        )?;
    }
    drop(storage);
    let initial_database_bytes = fs::metadata(&database)?.len();
    let target = Duration::from_secs(duration_seconds);
    let started_unix_ms = unix_ms()?;
    let started = Instant::now();
    let mut cycles = 0_u64;
    while started.elapsed() < target {
        let storage = Storage::open(&database)?;
        let mut cursor = None;
        let mut count = 0_usize;
        loop {
            let page = storage.replay(&session, cursor.as_ref(), Some(1_000))?;
            count += page.events.len();
            cursor = page.next_cursor;
            if !page.has_more {
                break;
            }
        }
        if count != events {
            return Err(format!("soak replay returned {count} events, expected {events}").into());
        }
        cycles += 1;
    }
    let elapsed_ns = started.elapsed().as_nanos() as u64;
    let finished_unix_ms = unix_ms()?;
    let final_database_bytes = fs::metadata(&database)?.len();
    let integrity_end = integrity_snapshot()?;
    let integrity_unchanged = integrity_start == integrity_end;
    Ok(json!({
        "recordVersion": 2,
        "probe": "storage-replay-soak",
        "workloadVersion": "storage-soak-v2",
        "requestedDurationSeconds": duration_seconds,
        "elapsedNs": elapsed_ns,
        "startedUnixMs": started_unix_ms,
        "finishedUnixMs": finished_unix_ms,
        "cycles": cycles,
        "eventsPerCycle": events,
        "initialDatabaseBytes": initial_database_bytes,
        "finalDatabaseBytes": final_database_bytes,
        "databaseGrowthBytes": final_database_bytes.saturating_sub(initial_database_bytes),
        "correctness": {"exactCountEveryCycle": true},
        "integrity": {"start":integrity_start,"end":integrity_end,"unchanged":integrity_unchanged},
        "interrupted": false,
        "releaseEligible": duration_seconds >= 8 * 60 * 60
            && elapsed_ns >= duration_seconds.saturating_mul(1_000_000_000)
            && cycles >= 100 && events >= 1_000 && integrity_unchanged,
        "scope": "storage replay diagnostic; full mixed-workload soak requires release infrastructure",
    }))
}

fn unix_ms() -> Result<u64, Box<dyn std::error::Error>> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

fn integrity_snapshot() -> Result<Value, Box<dyn std::error::Error>> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest
        .parent()
        .and_then(Path::parent)
        .ok_or("storage crate has no workspace root")?;
    let executable = env::current_exe()?;
    let source = manifest.join("examples/reliability_probe.rs");
    let cargo_lock = root.join("Cargo.lock");
    let git_revision = command_bytes(root, &["rev-parse", "HEAD"])?;
    let mut tree = Sha256::new();
    tree.update(command_bytes(root, &["diff", "--binary", "HEAD"])?);
    tree.update(command_bytes(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?);
    Ok(json!({
        "probeExecutableSha256": file_sha256(&executable)?,
        "probeSourceSha256": file_sha256(&source)?,
        "cargoLockSha256": file_sha256(&cargo_lock)?,
        "gitRevision": String::from_utf8(git_revision)?.trim(),
        "sourceTreeSha256": format!("{:x}", tree.finalize()),
    }))
}

fn file_sha256(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    Ok(format!("{:x}", Sha256::digest(fs::read(path)?)))
}

fn command_bytes(root: &Path, arguments: &[&str]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()?;
    if !output.status.success() {
        return Err(format!("git {} failed", arguments.join(" ")).into());
    }
    Ok(output.stdout)
}

fn option_usize(
    arguments: &[String],
    name: &str,
    default: usize,
) -> Result<usize, Box<dyn std::error::Error>> {
    Ok(option(arguments, name)?.map_or(Ok(default), |value| value.parse())?)
}

fn option_u64(
    arguments: &[String],
    name: &str,
    default: u64,
) -> Result<u64, Box<dyn std::error::Error>> {
    Ok(option(arguments, name)?.map_or(Ok(default), |value| value.parse())?)
}

fn option<'a>(
    arguments: &'a [String],
    name: &str,
) -> Result<Option<&'a str>, Box<dyn std::error::Error>> {
    let Some(index) = arguments.iter().position(|value| value == name) else {
        return Ok(None);
    };
    arguments
        .get(index + 1)
        .map(|value| Some(value.as_str()))
        .ok_or_else(|| format!("{name} requires a value").into())
}

fn option_required<'a>(
    arguments: &'a [String],
    name: &str,
) -> Result<&'a str, Box<dyn std::error::Error>> {
    option(arguments, name)?.ok_or_else(|| format!("{name} requires a value").into())
}
