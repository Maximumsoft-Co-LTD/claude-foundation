//! The Windows restricted-token backend.
//!
//! # Status: planner only, and the crate says so out loud
//!
//! The plan below is derived and unit-tested on every platform. Nothing applies
//! it, because the Win32 binding crate is not vendored in this workspace. That
//! is why [`crate::backend::select`] returns
//! [`crate::EnforcementLevel::Unenforced`] on Windows and why [`crate::Spawn`]
//! refuses rather than running the child with the operator's full privileges.
//!
//! Enabling the `windows-restricted-token` feature fails the build on purpose.
//! The alternative — a feature that compiles into a sandbox which does not
//! sandbox — is precisely the failure this crate exists to prevent, and it is
//! the shape of the documented `(allow default)` incident.
//!
//! One further Windows-specific constraint is recorded rather than designed
//! around: a comparable Windows agent sandbox blocks Node from spawning any
//! child process at all, which would break most of the predominantly Node MCP
//! ecosystem. See the `mcp-stdio-server` register row.

#[cfg(feature = "windows-restricted-token")]
compile_error!(
    "the `windows-restricted-token` feature is a placeholder: the Win32 binding crate that would \
     apply the restricted token is not vendored in this workspace. Enabling it would produce a \
     sandbox that silently enforces nothing, so the build fails instead. Remove the feature and \
     rely on the loud refusal in `Spawn::spawn`, or vendor the binding and implement `apply`."
);

use std::path::PathBuf;

use crate::policy::{NetworkPolicy, Policy};

/// The integrity level the child token is lowered to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrityLevel {
    Low,
    Untrusted,
}

/// What a restricted token would be built from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestrictedTokenPlan {
    /// Groups converted to deny-only, so the child cannot use them for access.
    pub deny_only_groups: Vec<&'static str>,
    /// Privileges removed from the token entirely.
    pub deleted_privileges: Vec<&'static str>,
    pub integrity_level: IntegrityLevel,
    /// Directories granted an explicit ACE for the restricted SID.
    pub writable_paths: Vec<PathBuf>,
    /// The child is placed in a job object that dies with the parent, which is
    /// the Windows analogue of the owned process group used elsewhere.
    pub job_object_kill_on_close: bool,
    pub network_denied: bool,
    /// Stated rather than discovered later: running the child under a separate
    /// sandbox account makes per-user tool installations unreachable to it.
    pub separate_account_hides_per_user_installs: bool,
}

/// Derives the restricted-token plan for a policy. Pure.
#[must_use]
pub fn restricted_token_plan(policy: &Policy) -> RestrictedTokenPlan {
    RestrictedTokenPlan {
        deny_only_groups: vec![
            "BUILTIN\\Administrators",
            "BUILTIN\\Power Users",
            "NT AUTHORITY\\INTERACTIVE",
        ],
        deleted_privileges: vec![
            "SeDebugPrivilege",
            "SeTcbPrivilege",
            "SeLoadDriverPrivilege",
            "SeBackupPrivilege",
            "SeRestorePrivilege",
            "SeTakeOwnershipPrivilege",
            "SeImpersonatePrivilege",
        ],
        integrity_level: IntegrityLevel::Low,
        writable_paths: policy.writable_paths().to_vec(),
        job_object_kill_on_close: true,
        network_denied: matches!(policy.network_policy(), NetworkPolicy::Denied),
        separate_account_hides_per_user_installs: true,
    }
}
