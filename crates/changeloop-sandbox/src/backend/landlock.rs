//! The Linux Landlock + seccomp backend.
//!
//! Landlock is the kernel's unprivileged filesystem-access-restriction module;
//! seccomp filters syscalls. Together they give a deny-by-default profile with
//! no helper binary and no namespace, which is what makes them the right
//! long-term Linux answer rather than bubblewrap.
//!
//! # What is compiled where
//!
//! The **planner** below — policy to ruleset — is compiled and unit-tested on
//! every platform. The **applier** is behind the `linux-landlock` feature and
//! `target_os = "linux"`, because it is a sequence of raw syscalls that cannot
//! be exercised anywhere else. Feature-gating the part that cannot be tested,
//! rather than shipping it untested and hoping, is the point: the default Linux
//! build uses bubblewrap and says so.
//!
//! # Named limits
//!
//! - Landlock's network restrictions are **port-based**, not host-based. A rule
//!   naming `github.com:22` narrows to "TCP connect on port 22"; the host part
//!   is not enforceable at this layer and needs an egress proxy.
//! - Filesystem restrictions are inherited by descendants, but seccomp filter
//!   *composition* is not equivalent, so a descendant's effective filter can
//!   differ from the child's. That asymmetry is reported as
//!   [`crate::Inheritance::FilesystemInheritedOnly`].

use std::path::PathBuf;

use crate::policy::{Destination, NetworkPolicy, Policy, ReadScope};

/// The access a rule grants over a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandlockAccess {
    ReadOnly,
    ReadWrite,
}

/// One `path_beneath` rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandlockRule {
    pub path: PathBuf,
    pub access: LandlockAccess,
}

/// The full ruleset a policy implies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandlockRuleset {
    /// Minimum Landlock ABI required. ABI 4 is where TCP restrictions arrive,
    /// so a policy with egress rules needs a newer kernel than one without.
    pub minimum_abi: u32,
    pub rules: Vec<LandlockRule>,
    /// True when no TCP connect is permitted at all.
    pub deny_all_tcp_connect: bool,
    /// Ports permitted for outbound connections. Hosts are not expressible.
    pub allowed_connect_ports: Vec<u16>,
    /// Landlock requires `no_new_privs`, which also blocks setuid escalation.
    pub no_new_privs: bool,
}

/// Derives the ruleset for a policy. Pure; no syscalls, no filesystem probing.
#[must_use]
pub fn landlock_ruleset(policy: &Policy) -> LandlockRuleset {
    let mut rules = Vec::new();
    match policy.readable() {
        ReadScope::SystemAndWorkspace => {
            rules.push(LandlockRule {
                path: PathBuf::from("/"),
                access: LandlockAccess::ReadOnly,
            });
        }
        ReadScope::Explicit(paths) => {
            for path in paths {
                rules.push(LandlockRule {
                    path: path.clone(),
                    access: LandlockAccess::ReadOnly,
                });
            }
        }
    }
    for path in policy.writable_paths() {
        rules.push(LandlockRule {
            path: path.clone(),
            access: LandlockAccess::ReadWrite,
        });
    }

    let (deny_all_tcp_connect, allowed_connect_ports, minimum_abi) = match policy.network_policy() {
        NetworkPolicy::Denied => (true, Vec::new(), 4),
        NetworkPolicy::Egress(egress) => {
            let mut ports: Vec<u16> = egress
                .iter()
                .filter_map(|rule| match &rule.destination {
                    Destination::Tcp { port, .. } => Some(*port),
                    Destination::UnixSocket(_) => None,
                })
                .collect();
            ports.sort_unstable();
            ports.dedup();
            (false, ports, 4)
        }
    };

    LandlockRuleset {
        minimum_abi,
        rules,
        deny_all_tcp_connect,
        allowed_connect_ports,
        no_new_privs: true,
    }
}

#[cfg(all(target_os = "linux", feature = "linux-landlock"))]
pub(crate) fn apply(command: &mut crate::raw::RawCommand, policy: &Policy) {
    use std::os::unix::process::CommandExt;

    let ruleset = landlock_ruleset(policy);
    // SAFETY: `pre_exec` runs between fork and exec. The closure performs only
    // syscalls, allocates nothing, and returns an error rather than continuing
    // if any restriction cannot be installed — a child that could not be
    // confined must not run.
    unsafe {
        command.as_mut().pre_exec(move || {
            linux::install(&ruleset)?;
            Ok(())
        });
    }
}

#[cfg(not(all(target_os = "linux", feature = "linux-landlock")))]
pub(crate) fn apply(_command: &mut crate::raw::RawCommand, _policy: &Policy) {}

#[cfg(all(target_os = "linux", feature = "linux-landlock"))]
mod linux {
    use super::{LandlockAccess, LandlockRuleset};

    // Landlock syscall numbers are identical across the architectures the
    // syscalls were introduced on.
    const SYS_LANDLOCK_CREATE_RULESET: libc::c_long = 444;
    const SYS_LANDLOCK_ADD_RULE: libc::c_long = 445;
    const SYS_LANDLOCK_RESTRICT_SELF: libc::c_long = 446;

    const LANDLOCK_RULE_PATH_BENEATH: libc::c_int = 1;

    const READ_ACCESS: u64 = 0x4 /* read_file */ | 0x8 /* read_dir */ | 0x1 /* execute */;
    const WRITE_ACCESS: u64 = 0x2 /* write_file */
        | 0x10 /* remove_dir */
        | 0x20 /* remove_file */
        | 0x40 /* make_char */
        | 0x80 /* make_dir */
        | 0x100 /* make_reg */
        | 0x200 /* make_sock */
        | 0x400 /* make_fifo */
        | 0x800 /* make_block */
        | 0x1000 /* make_sym */;

    #[repr(C)]
    struct RulesetAttribute {
        handled_access_fs: u64,
        handled_access_net: u64,
    }

    #[repr(C)]
    struct PathBeneathAttribute {
        allowed_access: u64,
        parent_fd: i32,
    }

    pub(super) fn install(ruleset: &LandlockRuleset) -> std::io::Result<()> {
        if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        let attribute = RulesetAttribute {
            handled_access_fs: READ_ACCESS | WRITE_ACCESS,
            handled_access_net: if ruleset.deny_all_tcp_connect { 1 } else { 0 },
        };
        let fd = unsafe {
            libc::syscall(
                SYS_LANDLOCK_CREATE_RULESET,
                &attribute as *const RulesetAttribute,
                core::mem::size_of::<RulesetAttribute>(),
                0,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let fd = fd as libc::c_int;
        for rule in &ruleset.rules {
            let Ok(path) = std::ffi::CString::new(rule.path.to_string_lossy().as_bytes()) else {
                continue;
            };
            let parent = unsafe { libc::open(path.as_ptr(), libc::O_PATH | libc::O_CLOEXEC) };
            if parent < 0 {
                continue;
            }
            let allowed = match rule.access {
                LandlockAccess::ReadOnly => READ_ACCESS,
                LandlockAccess::ReadWrite => READ_ACCESS | WRITE_ACCESS,
            };
            let beneath = PathBeneathAttribute {
                allowed_access: allowed,
                parent_fd: parent,
            };
            let added = unsafe {
                libc::syscall(
                    SYS_LANDLOCK_ADD_RULE,
                    fd,
                    LANDLOCK_RULE_PATH_BENEATH,
                    &beneath as *const PathBeneathAttribute,
                    0,
                )
            };
            unsafe { libc::close(parent) };
            if added != 0 {
                unsafe { libc::close(fd) };
                return Err(std::io::Error::last_os_error());
            }
        }
        let restricted = unsafe { libc::syscall(SYS_LANDLOCK_RESTRICT_SELF, fd, 0) };
        unsafe { libc::close(fd) };
        if restricted != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}
