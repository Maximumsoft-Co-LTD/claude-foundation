//! The bubblewrap backend: the Linux default until the Landlock applier ships.
//!
//! Bubblewrap expresses network access as a namespace, which is all-or-nothing.
//! It therefore cannot represent a destination allow-list at all, and
//! [`crate::backend::select`] reports that as a named gap rather than pretending
//! the rules applied.

use std::path::{Path, PathBuf};

use crate::policy::{NetworkPolicy, Policy, ReadScope};

pub(crate) const PRIMARY_EXECUTABLE: &str = "/usr/bin/bwrap";
const FALLBACK_EXECUTABLE: &str = "/bin/bwrap";

/// System paths a restricted-read profile still needs in order to exec anything.
const SYSTEM_READ_PATHS: &[&str] = &[
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/opt",
    "/etc/ld.so.cache",
];

pub(crate) fn executable() -> Option<PathBuf> {
    for candidate in [PRIMARY_EXECUTABLE, FALLBACK_EXECUTABLE] {
        if Path::new(candidate).is_file() {
            return Some(PathBuf::from(candidate));
        }
    }
    None
}

/// Renders the bubblewrap argument vector for a policy, wrapper arguments only.
#[must_use]
pub fn bubblewrap_arguments(policy: &Policy) -> Vec<String> {
    let mut arguments = vec!["--die-with-parent".to_string(), "--new-session".to_string()];
    if matches!(policy.network_policy(), NetworkPolicy::Denied) {
        arguments.push("--unshare-net".to_string());
    }

    match policy.readable() {
        ReadScope::SystemAndWorkspace => {
            arguments.push("--ro-bind".to_string());
            arguments.push("/".to_string());
            arguments.push("/".to_string());
            // The root is bound whole, so a denied read has to be masked
            // rather than simply left unbound. An empty tmpfs over the path is
            // the mask bubblewrap has.
            for path in policy.read_denied_paths() {
                arguments.push("--tmpfs".to_string());
                arguments.push(path.to_string_lossy().into_owned());
            }
        }
        // Nothing is bound except the system paths and the declared set, so a
        // denied read is already unreachable and needs no mask.
        ReadScope::Explicit(paths) => {
            for path in SYSTEM_READ_PATHS {
                if Path::new(path).exists() {
                    arguments.push("--ro-bind".to_string());
                    arguments.push((*path).to_string());
                    arguments.push((*path).to_string());
                }
            }
            for path in paths {
                let rendered = path.to_string_lossy().into_owned();
                arguments.push("--ro-bind".to_string());
                arguments.push(rendered.clone());
                arguments.push(rendered);
            }
            arguments.push("--dev".to_string());
            arguments.push("/dev".to_string());
            arguments.push("--proc".to_string());
            arguments.push("/proc".to_string());
        }
    }

    arguments.push("--chdir".to_string());
    arguments.push(policy.workspace().to_string_lossy().into_owned());

    for path in policy.writable_paths() {
        let rendered = path.to_string_lossy().into_owned();
        arguments.push("--bind".to_string());
        arguments.push(rendered.clone());
        arguments.push(rendered);
    }

    arguments
}
