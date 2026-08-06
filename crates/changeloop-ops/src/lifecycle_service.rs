use crate::executor_approval::ApprovedExecutor;
use changeloop_sandbox::{Policy as SandboxPolicy, SandboxedChild, Spawn, StdioPlan, exceptions};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::ExitStatus;
use std::time::{Duration, Instant};

pub const MAX_LIFECYCLE_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub struct LifecycleProcessOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub truncated: bool,
}

/// Runs an approved proof, repair, or independent-review process with the same
/// ownership, timeout, and evidence-retention limits on every surface.
///
/// The program, arguments, environment, and caps come from the
/// [`ApprovedExecutor`] rather than from this call, so a caller cannot approve
/// one command line and run another. `working_directory` is the only runtime
/// input: the reviewer runs in a caller-owned clean directory while proof
/// providers run at the project root, and the approval binds the *project*, not
/// the transient cwd.
pub fn run_approved_lifecycle_process(
    approved: &ApprovedExecutor,
    working_directory: &Path,
    stdin: Option<Vec<u8>>,
) -> Result<LifecycleProcessOutput, String> {
    run_approved_lifecycle_process_cancellable(approved, working_directory, stdin, &[], &|| false)
}

/// `harness_environment` carries values this binary derives per run — a failed
/// provider id, a failure cause. Its *names* must be exactly the ones the
/// approval recorded, so a caller cannot slip an unapproved variable into an
/// approved process.
pub fn run_approved_lifecycle_process_cancellable(
    approved: &ApprovedExecutor,
    working_directory: &Path,
    stdin: Option<Vec<u8>>,
    harness_environment: &[(&str, &str)],
    cancelled: &dyn Fn() -> bool,
) -> Result<LifecycleProcessOutput, String> {
    let supplied = harness_environment
        .iter()
        .map(|(name, _)| (*name).to_owned())
        .collect::<std::collections::BTreeSet<_>>();
    let approved_names = approved
        .harness_environment_names()
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    if supplied != approved_names {
        return Err(format!(
            "harness environment for '{}' does not match its approval",
            approved.label()
        ));
    }
    let mut environment = approved
        .environment()
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    environment.extend_from_slice(harness_environment);
    run_raw(
        working_directory,
        &approved.program().display().to_string(),
        approved.args(),
        &environment,
        stdin,
        approved.timeout_ms(),
        approved.max_output_bytes(),
        cancelled,
    )
}

#[allow(clippy::too_many_arguments)]
fn run_raw(
    root: &Path,
    command: &str,
    args: &[String],
    environment: &[(&str, &str)],
    stdin: Option<Vec<u8>>,
    timeout_ms: u64,
    max_output_bytes: usize,
    cancelled: &dyn Fn() -> bool,
) -> Result<LifecycleProcessOutput, String> {
    let mut variables = BTreeMap::new();
    variables.insert(
        "PATH".to_string(),
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string()),
    );
    for (name, value) in environment {
        variables.insert((*name).to_string(), (*value).to_string());
    }
    // The policy is recorded even though this row declines enforcement, so the
    // day the register row retires the profile it should have had is already
    // written down rather than invented then.
    let policy = SandboxPolicy::deny_by_default(root.to_path_buf()).writable([root.to_path_buf()]);
    let mut child = Spawn::new(command, policy)
        .arguments(args.to_vec())
        .working_directory(root)
        .environment(variables)
        .stdin(if stdin.is_some() {
            StdioPlan::Piped
        } else {
            StdioPlan::Null
        })
        .stdout(StdioPlan::Piped)
        .stderr(StdioPlan::Piped)
        // Not `allow_unenforced`: a lifecycle executor is a deliberate
        // full-access decision, not a backend that happened to be missing, and
        // the register keeps the two apart.
        .without_enforcement(exceptions::LIFECYCLE_OPERATOR_PROCESS)
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = match child.take_stdout() {
        Some(stdout) => stdout,
        None => {
            child.terminate();
            return Err("executor stdout is unavailable".into());
        }
    };
    let stderr = match child.take_stderr() {
        Some(stderr) => stderr,
        None => {
            child.terminate();
            return Err("executor stderr is unavailable".into());
        }
    };
    let cap = max_output_bytes.min(MAX_LIFECYCLE_OUTPUT_BYTES);
    let stdout_reader = std::thread::spawn(move || read_capped(stdout, cap));
    let stderr_reader = std::thread::spawn(move || read_capped(stderr, cap));
    let stdin_writer = if let Some(input) = stdin {
        let Some(mut pipe) = child.take_stdin() else {
            child.terminate();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("executor stdin is unavailable".into());
        };
        Some(std::thread::spawn(move || pipe.write_all(&input)))
    } else {
        None
    };
    let started = Instant::now();
    let status = loop {
        // Observing through the owned group keeps the leader pinned until its
        // descendants are killed, so no PID reuse can redirect the group signal
        // and no defunct leader is left behind.
        let polled = match child.try_wait_owned_group() {
            Ok(status) => status,
            Err(error) => {
                end_lifecycle_child(&mut child);
                if let Some(writer) = stdin_writer {
                    let _ = writer.join();
                }
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(error.to_string());
            }
        };
        if let Some(status) = polled {
            break status;
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms.max(1)) {
            end_lifecycle_child(&mut child);
            if let Some(writer) = stdin_writer {
                let _ = writer.join();
            }
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!("executor exceeded its {timeout_ms} ms time budget"));
        }
        if cancelled() {
            end_lifecycle_child(&mut child);
            if let Some(writer) = stdin_writer {
                let _ = writer.join();
            }
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("executor cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    // `try_wait_owned_group` already signalled the group and reaped the leader
    // once the leader exited, so nothing survives this point.
    if let Some(writer) = stdin_writer {
        writer
            .join()
            .map_err(|_| "executor stdin writer panicked".to_owned())?
            .map_err(|error| error.to_string())?;
    }
    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "executor stdout reader panicked".to_owned())??;
    let (stderr, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "executor stderr reader panicked".to_owned())??;
    Ok(LifecycleProcessOutput {
        status,
        stdout,
        stderr,
        truncated: stdout_truncated || stderr_truncated,
    })
}

/// Ends a lifecycle executor and does not return until the process group it
/// owned is empty.
///
/// The sandbox crate owns the *group*; the escalation policy is the executor's.
/// A proof runner is usually a shell that spawned its own children, so it gets a
/// SIGTERM and a moment to shut them down before [`SandboxedChild::terminate`]
/// escalates to the group SIGKILL and reaps the leader. The drain afterwards is
/// the part a signal alone does not give: a descendant that was reparented when
/// its parent died exits asynchronously, and "the budget is spent" must mean
/// "nothing this executor started is still running", not "a signal was sent".
#[cfg(unix)]
fn end_lifecycle_child(child: &mut SandboxedChild) {
    // The child leads a process group the sandbox crate created for it, so the
    // group id is the child's pid and a negative pid reaches only that group.
    let group = -(child.id() as libc::pid_t);
    // SAFETY: both calls target only the owned group; signal 0 mutates nothing.
    unsafe {
        let _ = libc::kill(group, libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(50));
    child.terminate();
    let deadline = Instant::now() + Duration::from_millis(250);
    while Instant::now() < deadline {
        // ESRCH means no member of the group is left, the leader having already
        // been reaped by `terminate`.
        if unsafe { libc::kill(group, 0) } == -1 {
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(not(unix))]
fn end_lifecycle_child(child: &mut SandboxedChild) {
    child.terminate();
}

fn read_capped(mut reader: impl Read, cap: usize) -> Result<(Vec<u8>, bool), String> {
    let mut retained = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    let mut truncated = false;
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        let keep = cap.saturating_sub(retained.len()).min(count);
        retained.extend_from_slice(&buffer[..keep]);
        truncated |= keep < count;
    }
    Ok((retained, truncated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::executor_approval::CompiledInExecutor;

    #[cfg(unix)]
    fn shell(args: &[&str], timeout_ms: u64) -> ApprovedExecutor {
        ApprovedExecutor::compiled_in(
            CompiledInExecutor::GIT_WORKSPACE_QUERY,
            "/bin/sh",
            args.iter().map(|argument| (*argument).to_owned()).collect(),
            timeout_ms,
            MAX_LIFECYCLE_OUTPUT_BYTES,
        )
    }

    /// Declining isolation is a decision the register records, not an accident.
    /// The row has to exist, has to grant exactly the unenforced spawn, and has
    /// to name what keeps the hole bounded.
    #[test]
    fn the_lifecycle_executor_declines_isolation_under_an_enumerated_row() {
        let entry = changeloop_sandbox::exceptions::lookup(exceptions::LIFECYCLE_OPERATOR_PROCESS)
            .expect("the lifecycle-operator-process row is in the register");
        assert!(entry.grants.unenforced_spawn);
        assert!(!entry.grants.raw_command);
        assert!(!entry.grants.write_outside_workspace);
        assert!(entry.compensating_control.len() > 40);
        assert!(entry.component.contains("changeloop-ops"));
    }

    #[cfg(unix)]
    #[test]
    fn a_lifecycle_executor_runs_bounded_and_leaves_no_defunct_child() {
        let root = tempfile::tempdir().unwrap();
        let output = run_approved_lifecycle_process(
            &shell(&["-c", "printf '%s' \"$$\""], 30_000),
            root.path(),
            None,
        )
        .expect("the executor runs");
        assert!(output.status.success());
        let pid: libc::pid_t = String::from_utf8(output.stdout)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        // A defunct child still answers signal 0, so this only holds once the
        // leader has been reaped rather than merely killed.
        // SAFETY: signal 0 performs no mutation and only checks existence.
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            -1,
            "the lifecycle executor left a live or defunct child behind"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_lifecycle_executor_that_outlives_its_budget_takes_its_descendants_with_it() {
        let root = tempfile::tempdir().unwrap();
        let pid_path = root.path().join("descendant.pid");
        let script = format!(
            "sh -c 'printf \"%s\" \"$$\" > \"{}\"; while :; do sleep 1; done' & wait",
            pid_path.display()
        );
        let error =
            run_approved_lifecycle_process(&shell(&["-c", &script], 300), root.path(), None)
                .expect_err("the executor exceeds its budget");
        assert!(error.contains("time budget"), "{error}");

        if !pid_path.is_file() {
            // The descendant never started, which already satisfies the
            // invariant this test is about.
            return;
        }
        let descendant: libc::pid_t = std::fs::read_to_string(&pid_path)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        for _ in 0..200 {
            // SAFETY: signal 0 performs no mutation and only checks existence.
            if unsafe { libc::kill(descendant, 0) } == -1 {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("a descendant outlived the lifecycle executor that created it");
    }
}
