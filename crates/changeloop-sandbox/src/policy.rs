//! One coarse, deny-by-default profile.
//!
//! The allow-list is the expensive part of any sandbox, and it is expensive
//! *forever*: a documented point release silently tightened one vendor's macOS
//! profile enough to break a credential CLI inside tool calls with no changelog
//! entry. The answer here is **profile coarseness** — a single maintained
//! profile scoped to workspace-write plus network egress, held as a default to
//! defend rather than an achieved property. There are deliberately no per-tool
//! profiles; a per-component need becomes a row in
//! [`crate::exceptions::REGISTER`], not a new profile.

use std::path::{Path, PathBuf};

use crate::SandboxError;
use crate::exceptions::{self, ExceptionId};

/// How reads are scoped.
///
/// The evidenced asymmetry is reads deny-then-allow, writes allow-only. In
/// practice macOS executables and script interpreters consult dynamic system
/// paths that are not stable across OS releases, so the shipped default keeps
/// reads broad while write authority stays exact. [`ReadScope::Explicit`] is
/// the strict form, used where the read set is genuinely known.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadScope {
    /// System paths plus the workspace are readable; writes remain exact.
    SystemAndWorkspace,
    /// Only these paths are readable.
    Explicit(Vec<PathBuf>),
}

/// A network destination, named at the transport layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Destination {
    /// A host and port. Port 22 is as expressible as port 443, which is the
    /// entire point: `excludedCommands`-style bypasses exempt filesystem
    /// restrictions only, so `git push` over SSH still fails behind an
    /// allow-list that covers HTTP but not port 22.
    Tcp { host: String, port: u16 },
    /// A Unix domain socket.
    UnixSocket(PathBuf),
}

impl Destination {
    #[must_use]
    pub fn tcp(host: impl Into<String>, port: u16) -> Self {
        Self::Tcp {
            host: host.into(),
            port,
        }
    }
}

/// Sockets whose reachability is equivalent to handing over the host.
const HOST_EQUIVALENT_SOCKETS: &[&str] = &[
    "docker.sock",
    "containerd.sock",
    "podman.sock",
    "libvirt-sock",
    "buildkitd.sock",
];

/// One transport-level egress allowance.
///
/// # Why this is not a command-name list
///
/// Command-name exclusion lists demonstrably fail for **wrapped**, **nested**
/// and **non-HTTP** invocations. `git push` reached through `sh -lc "make
/// deploy"` has `argv[0] == "sh"`, so a list keyed on `git` never matches, and
/// SSH is not HTTP so an HTTP-proxy allowance never sees it either. A rule
/// stated as *destination* holds regardless of how the process was invoked,
/// because it is enforced by the backend against the connecting process rather
/// than by a classifier against a command string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressRule {
    pub destination: Destination,
    pub reason: String,
    pub exception: Option<ExceptionId>,
}

impl EgressRule {
    #[must_use]
    pub fn new(destination: Destination, reason: impl Into<String>) -> Self {
        Self {
            destination,
            reason: reason.into(),
            exception: None,
        }
    }

    /// Attaches the register entry that authorises this rule.
    #[must_use]
    pub fn under(mut self, exception: ExceptionId) -> Self {
        self.exception = Some(exception);
        self
    }
}

/// Network posture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetworkPolicy {
    /// No egress at all. The default.
    Denied,
    /// Egress only to enumerated destinations.
    ///
    /// Two limits are worth stating rather than overselling: a default egress
    /// proxy does not terminate TLS, so domain fronting reaches hosts outside
    /// the allow-list; and terminating TLS in order to close that gap breaks
    /// mutual-TLS and certificate-pinning clients.
    Egress(Vec<EgressRule>),
}

impl NetworkPolicy {
    /// Whether a destination is permitted — evaluated against the destination
    /// alone, never against the command that reaches for it.
    #[must_use]
    pub fn permits(&self, destination: &Destination) -> bool {
        match self {
            Self::Denied => false,
            Self::Egress(rules) => rules.iter().any(|rule| &rule.destination == destination),
        }
    }
}

/// What a child process may touch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    workspace: PathBuf,
    writable: Vec<PathBuf>,
    escapes: Vec<(PathBuf, ExceptionId)>,
    readable: ReadScope,
    read_denied: Vec<PathBuf>,
    network: NetworkPolicy,
    protected: Vec<PathBuf>,
}

impl Policy {
    /// The coarse profile: deny everything, then allow workspace-scoped writes
    /// and enumerated egress.
    ///
    /// Starting from deny is not a stylistic preference. A shipped
    /// `(allow default)` Seatbelt profile — an allow-list inverted into a
    /// deny-list — had a working escape chain through a devfs mount and a
    /// symlinked shell. You cannot patch your way out of an inverted default.
    ///
    /// The write allow-list starts **empty**, which means zero write access.
    pub fn deny_by_default(workspace: impl Into<PathBuf>) -> Self {
        Self {
            workspace: workspace.into(),
            writable: Vec::new(),
            escapes: Vec::new(),
            readable: ReadScope::SystemAndWorkspace,
            read_denied: Vec::new(),
            network: NetworkPolicy::Denied,
            protected: Vec::new(),
        }
    }

    #[must_use]
    pub fn workspace(&self) -> &Path {
        &self.workspace
    }

    /// Grants write access to paths inside the workspace.
    #[must_use]
    pub fn writable<I, P>(mut self, paths: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: Into<PathBuf>,
    {
        self.writable.extend(paths.into_iter().map(Into::into));
        self
    }

    /// Grants write access to a path **outside** the workspace under a named
    /// register entry.
    ///
    /// Every incident involving destruction outside the working tree is the
    /// class a workspace-scoped sandbox eliminates by construction, so leaving
    /// the workspace is never an ad-hoc flag.
    #[must_use]
    pub fn writable_outside_workspace(
        mut self,
        path: impl Into<PathBuf>,
        exception: ExceptionId,
    ) -> Self {
        let path = path.into();
        self.escapes.push((path.clone(), exception));
        self.writable.push(path);
        self
    }

    #[must_use]
    pub fn writable_paths(&self) -> &[PathBuf] {
        &self.writable
    }

    #[must_use]
    pub fn read_scope(mut self, scope: ReadScope) -> Self {
        self.readable = scope;
        self
    }

    #[must_use]
    pub fn readable(&self) -> &ReadScope {
        &self.readable
    }

    /// Marks paths the sandboxed process must never read, whatever the read
    /// scope otherwise allows.
    ///
    /// # Why this exists next to [`ReadScope`]
    ///
    /// [`ReadScope::Explicit`] states a read **allow-list**, and the Seatbelt
    /// backend deliberately does not honour it: narrowing macOS reads to a
    /// declared set aborts interpreter startup, so that backend keeps reads
    /// broad and `backend::select` reports the unapplied axis as a gap. A
    /// component that must keep specific trees unreadable — the extension host
    /// keeps the user's home directories and the project tree away from
    /// third-party extension code — therefore cannot express its requirement as
    /// a read scope at all.
    ///
    /// A deny-list is expressible on every backend that has one: Seatbelt emits
    /// the denials after the broad allow so the last matching form wins,
    /// bubblewrap masks each path with a tmpfs when the root is bound
    /// read-only, and Landlock is an allow-list model where a path that is
    /// never granted is already unreachable. Paths named by
    /// [`ReadScope::Explicit`] are re-allowed after the denials, which is how a
    /// single entry file stays readable inside a denied tree.
    #[must_use]
    pub fn deny_read<I, P>(mut self, paths: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: Into<PathBuf>,
    {
        self.read_denied.extend(paths.into_iter().map(Into::into));
        self
    }

    #[must_use]
    pub fn read_denied_paths(&self) -> &[PathBuf] {
        &self.read_denied
    }

    /// Marks paths the sandboxed process must never write, whatever else the
    /// profile allows.
    ///
    /// Changeloop's own policy files belong here: a process that can rewrite
    /// the policy that constrains it is not constrained.
    #[must_use]
    pub fn protect<I, P>(mut self, paths: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: Into<PathBuf>,
    {
        self.protected.extend(paths.into_iter().map(Into::into));
        self
    }

    #[must_use]
    pub fn protected_paths(&self) -> &[PathBuf] {
        &self.protected
    }

    /// Replaces the network posture.
    #[must_use]
    pub fn network(mut self, network: NetworkPolicy) -> Self {
        self.network = network;
        self
    }

    /// Adds one transport-level egress allowance — the escape hatch that works
    /// where a command-name list does not.
    #[must_use]
    pub fn allow_egress(mut self, rule: EgressRule) -> Self {
        match &mut self.network {
            NetworkPolicy::Egress(rules) => rules.push(rule),
            NetworkPolicy::Denied => self.network = NetworkPolicy::Egress(vec![rule]),
        }
        self
    }

    #[must_use]
    pub fn network_policy(&self) -> &NetworkPolicy {
        &self.network
    }

    /// Rejects policies that are not expressible without a register entry.
    pub fn validate(&self) -> Result<(), SandboxError> {
        if self.workspace.as_os_str().is_empty() {
            return Err(SandboxError::InvalidPolicy(
                "workspace root must not be empty".into(),
            ));
        }
        for path in &self.writable {
            if path.starts_with(&self.workspace) {
                continue;
            }
            let authorised = self
                .escapes
                .iter()
                .find(|(escape, _)| escape == path)
                .map(|(_, id)| *id);
            let Some(id) = authorised else {
                return Err(SandboxError::InvalidPolicy(format!(
                    "writable path {} escapes the workspace {} and names no register entry",
                    path.display(),
                    self.workspace.display()
                )));
            };
            let entry = exceptions::require(id)?;
            if !entry.grants.write_outside_workspace {
                return Err(SandboxError::UngrantedException {
                    id: entry.id,
                    capability: "writing outside the workspace",
                });
            }
        }
        if let NetworkPolicy::Egress(rules) = &self.network {
            for rule in rules {
                self.validate_egress(rule)?;
            }
        }
        Ok(())
    }

    fn validate_egress(&self, rule: &EgressRule) -> Result<(), SandboxError> {
        if rule.reason.trim().is_empty() {
            return Err(SandboxError::InvalidPolicy(
                "every egress rule must carry a reason so the allow-list stays auditable".into(),
            ));
        }
        let Destination::UnixSocket(path) = &rule.destination else {
            return Ok(());
        };
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !HOST_EQUIVALENT_SOCKETS.contains(&name.as_str()) {
            return Ok(());
        }
        // Reaching one of these sockets is equivalent to handing over the host,
        // so it is never an ordinary allow-list row.
        let Some(id) = rule.exception else {
            return Err(SandboxError::InvalidPolicy(format!(
                "egress to {} is host-equivalent and requires a register entry",
                path.display()
            )));
        };
        let entry = exceptions::require(id)?;
        if !entry.grants.host_equivalent_socket {
            return Err(SandboxError::UngrantedException {
                id: entry.id,
                capability: "egress to a host-equivalent socket",
            });
        }
        Ok(())
    }
}
