//! The raw process-creation primitive. Private on purpose.
//!
//! This is the **only** place in the workspace that names
//! [`std::process::Command::new`]. The module is declared `mod raw;` — not
//! `pub mod` — so `changeloop_sandbox::raw` cannot be written by any other
//! crate, and the compiler, rather than code review, enforces that every child
//! process goes through [`crate::Spawn`].
//!
//! What this does **not** cover, and no Rust visibility rule could:
//!
//! - A third-party dependency calling [`std::process::Command`] itself. Rust
//!   privacy is a property of this workspace's crates only.
//! - Anything a child process does after `exec`. Grandchildren are covered by
//!   OS sandbox *inheritance*, which is a backend property, not a language one.
//!
//! Both are stated in the crate documentation and tracked in
//! [`crate::exceptions::REGISTER`].

use std::path::Path;
use std::process::{Child, Command};

use crate::SessionPlan;

/// A thin owner of the raw primitive.
///
/// Deliberately not `Deref<Target = Command>`: callers inside this crate reach
/// the builder through [`RawCommand::as_mut`], which keeps every construction
/// site greppable within one file's worth of code.
pub(crate) struct RawCommand(Command);

impl RawCommand {
    pub(crate) fn new(program: &Path) -> Self {
        // The single raw spawn primitive in the workspace.
        Self(Command::new(program))
    }

    pub(crate) fn as_mut(&mut self) -> &mut Command {
        &mut self.0
    }

    pub(crate) fn into_inner(self) -> Command {
        self.0
    }

    pub(crate) fn spawn(&mut self) -> std::io::Result<Child> {
        self.0.spawn()
    }
}

impl std::fmt::Debug for RawCommand {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_tuple("RawCommand").field(&self.0).finish()
    }
}

#[cfg(unix)]
pub(crate) fn apply_session(command: &mut RawCommand, plan: SessionPlan) {
    use std::os::unix::process::CommandExt;

    match plan {
        SessionPlan::Inherit => {}
        SessionPlan::OwnedProcessGroup => {
            command.as_mut().process_group(0);
        }
        SessionPlan::ControllingTerminal { slave } => {
            // SAFETY: `pre_exec` runs between fork and exec in the child. Only
            // async-signal-safe calls are made, no allocation occurs, and the
            // descriptor is owned by the caller for the duration of the spawn.
            unsafe {
                command.as_mut().pre_exec(move || {
                    if libc::setsid() == -1
                        || libc::ioctl(slave, libc::TIOCSCTTY as libc::c_ulong, 0) == -1
                    {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
    }
}

#[cfg(not(unix))]
pub(crate) fn apply_session(_command: &mut RawCommand, _plan: SessionPlan) {}

#[cfg(unix)]
pub(crate) fn terminate_process_group(child: &Child) {
    // The child was placed in a fresh process group at spawn, so a negative PID
    // targets only that owned group and prevents descendant leakage.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
}

#[cfg(not(unix))]
pub(crate) fn terminate_process_group(_child: &Child) {}

#[cfg(unix)]
pub(crate) fn try_wait_owned_group(
    child: &mut Child,
    owned_group: bool,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    if !owned_group {
        return child.try_wait();
    }
    // Observe terminal state without reaping the leader. Keeping the leader as a
    // zombie pins its PID/PGID while descendants are killed, so a fast PID reuse
    // cannot redirect the group signal at an unrelated process.
    let mut information = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
    let result = unsafe {
        libc::waitid(
            libc::P_PID,
            child.id() as libc::id_t,
            information.as_mut_ptr(),
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error());
    }
    let information = unsafe { information.assume_init() };
    if unsafe { information.si_pid() } == 0 {
        return Ok(None);
    }
    terminate_process_group(child);
    child.wait().map(Some)
}

#[cfg(not(unix))]
pub(crate) fn try_wait_owned_group(
    child: &mut Child,
    _owned_group: bool,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    child.try_wait()
}
