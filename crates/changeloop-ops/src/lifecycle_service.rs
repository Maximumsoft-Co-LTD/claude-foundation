use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

pub const MAX_LIFECYCLE_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub struct LifecycleProcessOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub truncated: bool,
}

/// Runs a configured proof, repair, or independent-review process with the
/// same ownership, timeout, and evidence-retention limits on every surface.
pub fn run_lifecycle_process(
    root: &Path,
    command: &str,
    args: &[String],
    environment: &[(&str, &str)],
    stdin: Option<Vec<u8>>,
    timeout_ms: u64,
) -> Result<LifecycleProcessOutput, String> {
    run_lifecycle_process_cancellable(root, command, args, environment, stdin, timeout_ms, &|| {
        false
    })
}

pub fn run_lifecycle_process_cancellable(
    root: &Path,
    command: &str,
    args: &[String],
    environment: &[(&str, &str)],
    stdin: Option<Vec<u8>>,
    timeout_ms: u64,
    cancelled: &dyn Fn() -> bool,
) -> Result<LifecycleProcessOutput, String> {
    let mut builder = Command::new(command);
    builder
        .args(args)
        .current_dir(root)
        .env_clear()
        .env(
            "PATH",
            std::env::var_os("PATH").unwrap_or_else(|| "/usr/bin:/bin".into()),
        )
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in environment {
        builder.env(name, value);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setpgid is async-signal-safe and runs in the child before exec.
        unsafe {
            builder.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }
    let mut child = builder.spawn().map_err(|error| error.to_string())?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            return Err("executor stdout is unavailable".into());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            return Err("executor stderr is unavailable".into());
        }
    };
    let stdout_reader = std::thread::spawn(move || read_capped(stdout));
    let stderr_reader = std::thread::spawn(move || read_capped(stderr));
    let stdin_writer = if let Some(input) = stdin {
        let Some(mut pipe) = child.stdin.take() else {
            terminate_process_tree(&mut child);
            let _ = child.wait();
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
        let polled = match child.try_wait() {
            Ok(status) => status,
            Err(error) => {
                terminate_process_tree(&mut child);
                let _ = child.wait();
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
            terminate_process_tree(&mut child);
            let _ = child.wait();
            if let Some(writer) = stdin_writer {
                let _ = writer.join();
            }
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!("executor exceeded its {timeout_ms} ms time budget"));
        }
        if cancelled() {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            if let Some(writer) = stdin_writer {
                let _ = writer.join();
            }
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("executor cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    #[cfg(unix)]
    // SAFETY: the child process group is owned by this bounded execution.
    unsafe {
        let _ = libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
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

fn read_capped(mut reader: impl Read) -> Result<(Vec<u8>, bool), String> {
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
        let keep = MAX_LIFECYCLE_OUTPUT_BYTES
            .saturating_sub(retained.len())
            .min(count);
        retained.extend_from_slice(&buffer[..keep]);
        truncated |= keep < count;
    }
    Ok((retained, truncated))
}

fn terminate_process_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    // SAFETY: only signals the process group created above.
    unsafe {
        let group = -(child.id() as libc::pid_t);
        let _ = libc::kill(group, libc::SIGTERM);
        std::thread::sleep(Duration::from_millis(50));
        let _ = libc::kill(group, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    let _ = child.kill();
}
