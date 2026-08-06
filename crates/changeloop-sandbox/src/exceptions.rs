//! The enumerated exception register.
//!
//! Every shipped sandbox surveyed carries at least one per-component exception:
//! one containerises stdio extensions individually, another exempts the language
//! server, a third ships a weaker nested-sandbox mode for Docker. The question
//! is therefore never *whether* exceptions exist but whether they are
//! **enumerated**. An ad-hoc hole is invisible in review and unbounded in
//! effect; a register row names a component, the backends it applies to, why it
//! exists, and the compensating control that makes it tolerable.
//!
//! [`ExceptionId`] cannot be constructed outside this crate. The only way to
//! obtain one is to reference a constant published here, so "add a hole" and
//! "add a reviewable row to this file" are the same edit.

use crate::SandboxError;
use crate::backend::BackendKind;

/// A register key. Constructible only from the constants in this module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ExceptionId(pub(crate) &'static str);

impl ExceptionId {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for ExceptionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

/// What a register row actually permits. Absent grants are denials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grants {
    /// Hands a `std::process::Command` to a caller outside this crate.
    pub raw_command: bool,
    /// Spawns when no backend can enforce the policy.
    pub unenforced_spawn: bool,
    /// Grants write access to a path outside the workspace.
    pub write_outside_workspace: bool,
    /// Allows egress to a socket whose reachability equals host control.
    pub host_equivalent_socket: bool,
}

impl Grants {
    const NONE: Self = Self {
        raw_command: false,
        unenforced_spawn: false,
        write_outside_workspace: false,
        host_equivalent_socket: false,
    };
}

/// One enumerated exception.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExceptionEntry {
    pub id: &'static str,
    /// The component that needs it. Never "various".
    pub component: &'static str,
    /// The backends the exception applies to. Empty means every backend.
    pub backends: &'static [BackendKind],
    pub reason: &'static str,
    /// What keeps the hole bounded. A row without one is a bug.
    pub compensating_control: &'static str,
    pub grants: Grants,
    /// When this row is expected to be revisited or retired.
    pub review: &'static str,
}

/// The `reqwest`/`configd` case, kept as a named pre-GA regression guard.
///
/// The workspace guard already exists at this path and is **not** duplicated
/// here; the register merely names it so the exception row and its compensating
/// control point at a test that actually runs.
pub const REQWEST_CONFIGD_GUARD_TEST: &str = "tests/performance/tests/reqwest_sandbox_guard.rs";

pub const LEGACY_COMMAND_HANDOFF: ExceptionId = ExceptionId("legacy-command-handoff");
pub const LIFECYCLE_OPERATOR_PROCESS: ExceptionId = ExceptionId("lifecycle-operator-process");
pub const HOST_TOOLCHAIN_UNSANDBOXED: ExceptionId = ExceptionId("host-toolchain-unsandboxed");
pub const BEST_EFFORT_NO_BACKEND: ExceptionId = ExceptionId("best-effort-no-backend");
pub const BACKGROUND_JOB_HOST: ExceptionId = ExceptionId("background-job-host");
pub const PTY_CONTROLLING_TERMINAL: ExceptionId = ExceptionId("pty-controlling-terminal");
pub const WINDOWS_NO_ENFORCEMENT: ExceptionId = ExceptionId("windows-no-enforcement");
pub const MCP_STDIO_SERVER: ExceptionId = ExceptionId("mcp-stdio-server");
pub const GIT_SSH_EGRESS: ExceptionId = ExceptionId("git-ssh-egress");
pub const NESTED_CONTAINER_DEGRADED: ExceptionId = ExceptionId("nested-container-degraded");
pub const CONTAINER_RUNTIME_SOCKET: ExceptionId = ExceptionId("container-runtime-socket");
pub const REQWEST_CONFIGD_PRE_GA: ExceptionId = ExceptionId("reqwest-configd-pre-ga");
pub const TOOL_ARTIFACT_SCRATCH: ExceptionId = ExceptionId("tool-artifact-scratch");

/// The register. Sorted by id; the audit test enforces that.
pub const REGISTER: &[ExceptionEntry] = &[
    ExceptionEntry {
        id: "background-job-host",
        component: "changeloop-tools::JobManager background jobs",
        backends: &[],
        reason: "Long-running background jobs are still spawned on the host. They \
                 predate this crate and their output re-enters model context outside \
                 a turn, which is a context-assembly concern as much as a sandbox one.",
        compensating_control: "Jobs are harness-owned objects with bounded output capture, an \
                               owned process group so no descendant outlives the job, a cleared \
                               environment, and a fixed executable search path.",
        grants: Grants {
            unenforced_spawn: true,
            ..Grants::NONE
        },
        review: "Fold into the enforced path once background jobs carry a workspace policy.",
    },
    ExceptionEntry {
        id: "best-effort-no-backend",
        component: "changeloop-tools::run_process with SandboxRequirement::BestEffort",
        backends: &[BackendKind::None],
        reason: "Best-effort callers run on hosts where no backend is installed — a Linux \
                 image without bubblewrap, or Windows. Refusing would make the tool \
                 unusable there.",
        compensating_control: "The degradation is reported through the crate reporter rather than \
                               being silent, and callers that cannot tolerate it use \
                               SandboxRequirement::Required, which refuses.",
        grants: Grants {
            unenforced_spawn: true,
            ..Grants::NONE
        },
        review: "Retires when every supported platform has an enforcing backend.",
    },
    ExceptionEntry {
        id: "container-runtime-socket",
        component: "egress rules naming a container runtime socket",
        backends: &[],
        reason: "A Unix-socket allowance can hand over the host: reaching the container \
                 runtime socket is equivalent to root on the machine the sandbox runs on.",
        compensating_control: "Never granted by default. The policy validator refuses such a rule \
                               unless this row is named explicitly, so the hole is visible in the \
                               diff that opens it.",
        grants: Grants {
            host_equivalent_socket: true,
            ..Grants::NONE
        },
        review: "Permanent guard rail; the row exists so the grant is never implicit.",
    },
    ExceptionEntry {
        id: "git-ssh-egress",
        component: "git push and fetch over SSH",
        backends: &[],
        reason: "The documented scoped bypass in a comparable product exempts filesystem \
                 restrictions only, so git push over SSH still failed behind an \
                 allow-list covering HTTP but not port 22. That issue was closed \"not \
                 planned\" with the workaround \"disable the sandbox\".",
        compensating_control: "Expressed as a transport-level destination rule (host, port 22), \
                               which holds for wrapped and nested invocations where a \
                               command-name list matches nothing.",
        grants: Grants::NONE,
        review: "Stable. Revisit only if the egress backend gains destination-level TLS policy.",
    },
    ExceptionEntry {
        id: "host-toolchain-unsandboxed",
        component: "changeloop-tools::run_process with SandboxRequirement::None",
        backends: &[],
        reason: "The policy layer resolves a small set of project toolchain invocations \
                 — formatters and checkers — that are declared not to require OS \
                 isolation.",
        compensating_control: "The executable must resolve inside the repository or a fixed \
                               trusted system path, arguments are validated against protected \
                               paths, the environment is cleared, and output is bounded and \
                               redacted.",
        grants: Grants {
            unenforced_spawn: true,
            ..Grants::NONE
        },
        review: "Shrinks as formatters move under the enforced path.",
    },
    ExceptionEntry {
        id: "legacy-command-handoff",
        component: "changeloop-app-server::executable project process launcher",
        backends: &[],
        reason: "One caller outside this crate still consumes a std::process::Command \
                 directly. Changing its signature is not possible from inside this \
                 change's ownership boundary.",
        compensating_control: "The policy, profile and argv are still built by this crate; only \
                               the final handoff is delegated. The row is what keeps the \
                               remaining call site countable.",
        grants: Grants {
            raw_command: true,
            ..Grants::NONE
        },
        review: "Retires when the launcher accepts a Spawn rather than a Command.",
    },
    ExceptionEntry {
        id: "lifecycle-operator-process",
        component: "changeloop-ops::run_lifecycle_process proof, repair and review executors",
        backends: &[],
        reason: "A lifecycle executor is whatever the repository's proof configuration names, \
                 and proof commands routinely resolve dependencies over the network. A \
                 deny-by-default profile with no egress would break them on hosts where the \
                 backend cannot express a destination allow-list, which is every backend but \
                 Seatbelt. Isolation is therefore declined outright rather than half-applied.",
        compensating_control: "The spawn is still built here: the environment is cleared apart \
                               from a declared set, the working directory is pinned to the \
                               workspace root, output is bounded, a hard timeout and a \
                               cancellation check bound the lifetime, and the child owns a \
                               process group so no descendant outlives the executor.",
        grants: Grants {
            unenforced_spawn: true,
            ..Grants::NONE
        },
        review: "Retires when egress can be expressed per destination on every supported backend.",
    },
    ExceptionEntry {
        id: "mcp-stdio-server",
        component: "changeloop-mcp stdio server processes",
        backends: &[BackendKind::RestrictedToken],
        reason: "Five of seven surveyed production MCP clients run tools with full host \
                 privileges, so wrapping them is the point. But one vendor's Windows \
                 sandbox blocks Node from spawning any child process, which would break \
                 most of the predominantly Node MCP ecosystem the same argument insists \
                 on wrapping.",
        compensating_control: "Separate sandboxed process on backends that support it; on the \
                               restricted-token backend the server is refused rather than run \
                               with host privileges, unless this row is named.",
        grants: Grants {
            unenforced_spawn: true,
            ..Grants::NONE
        },
        review: "Blocked on a Windows backend that permits child creation.",
    },
    ExceptionEntry {
        id: "nested-container-degraded",
        component: "any backend running inside a container",
        backends: &[BackendKind::Landlock, BackendKind::Bubblewrap],
        reason: "Weaker nested-sandbox modes exist precisely because strong isolation \
                 breaks inside containers; namespace creation is commonly unavailable to \
                 an unprivileged process there.",
        compensating_control: "Enforcement is reported as Degraded with the specific gap named, \
                               so the operator is told which guarantee is missing rather than \
                               believing the full one applies.",
        grants: Grants::NONE,
        review: "Tracks upstream container runtime support for unprivileged namespaces.",
    },
    ExceptionEntry {
        id: "pty-controlling-terminal",
        component: "changeloop-tools interactive PTY jobs",
        backends: &[],
        reason: "A child holding a controlling terminal cannot raise an approval prompt \
                 through the harness. The documented PTY failure is exactly this: a \
                 plugin unable to prompt silently reinterpreted ask as deny on one axis \
                 and as allow on another.",
        compensating_control: "Approval is resolved before the PTY child is created, never inside \
                               it; the child gets a fresh session and an owned terminal so it \
                               cannot reach the parent's.",
        grants: Grants {
            unenforced_spawn: true,
            ..Grants::NONE
        },
        review: "Retires when PTY jobs run under a workspace policy.",
    },
    ExceptionEntry {
        id: "reqwest-configd-pre-ga",
        component: "any Changeloop binary linking an HTTP client",
        backends: &[BackendKind::Seatbelt],
        reason: "The default macOS Seatbelt profile denies mach-lookup to the system \
                 configuration daemon. reqwest's default features link a crate that \
                 panics on the resulting null, so a sandboxed Rust CLI aborts with exit \
                 101 before doing any work. Reproduced against another vendor's CLI and \
                 closed \"not planned\" upstream alongside three duplicates.",
        compensating_control: "A workspace regression guard asserts reqwest is never declared with \
                               default features and that the offending crate never enters the \
                               lockfile. See REQWEST_CONFIGD_GUARD_TEST.",
        grants: Grants::NONE,
        review: "Pre-GA gate. The guard is permanent; no upstream fix is coming.",
    },
    ExceptionEntry {
        id: "tool-artifact-scratch",
        component: "changeloop-tools artifact and scratch directory",
        backends: &[],
        reason: "Bounded process output is captured to an artifact directory the caller \
                 supplies, which is not required to sit inside the working tree. A child that \
                 cannot write its own captured output cannot run at all.",
        compensating_control: "The directory is canonicalised at construction, it is the only \
                               path outside the workspace the profile grants, and it is also the \
                               child's TMPDIR so scratch writes land inside it rather than in a \
                               shared system location.",
        grants: Grants {
            write_outside_workspace: true,
            ..Grants::NONE
        },
        review: "Retires when the artifact directory is required to live under the worktree.",
    },
    ExceptionEntry {
        id: "windows-no-enforcement",
        component: "every spawn on Windows",
        backends: &[BackendKind::RestrictedToken],
        reason: "The restricted-token backend has a tested planner but no vendored Win32 \
                 binding, so nothing applies it. A sandbox that silently does nothing is \
                 worse than none, because the operator believes they have one.",
        compensating_control: "Spawns refuse by default on Windows and say why. Enabling the \
                               windows-restricted-token feature fails the build rather than \
                               producing a sandbox that does not sandbox.",
        grants: Grants {
            unenforced_spawn: true,
            ..Grants::NONE
        },
        review: "Retires when the restricted-token applier ships.",
    },
];

/// Looks a register row up.
#[must_use]
pub fn lookup(id: ExceptionId) -> Option<&'static ExceptionEntry> {
    REGISTER.iter().find(|entry| entry.id == id.0)
}

pub(crate) fn require(id: ExceptionId) -> Result<&'static ExceptionEntry, SandboxError> {
    lookup(id).ok_or_else(|| SandboxError::UnknownException(id.0.to_string()))
}

/// Every identifier this crate publishes, for audit.
#[must_use]
pub fn published_ids() -> Vec<ExceptionId> {
    vec![
        BACKGROUND_JOB_HOST,
        BEST_EFFORT_NO_BACKEND,
        CONTAINER_RUNTIME_SOCKET,
        GIT_SSH_EGRESS,
        HOST_TOOLCHAIN_UNSANDBOXED,
        LEGACY_COMMAND_HANDOFF,
        LIFECYCLE_OPERATOR_PROCESS,
        MCP_STDIO_SERVER,
        NESTED_CONTAINER_DEGRADED,
        PTY_CONTROLLING_TERMINAL,
        REQWEST_CONFIGD_PRE_GA,
        TOOL_ARTIFACT_SCRATCH,
        WINDOWS_NO_ENFORCEMENT,
    ]
}

/// Renders the register as an auditable table.
///
/// Kept in the crate rather than in a document so it cannot drift from the rows
/// the code actually honours.
#[must_use]
pub fn render_register() -> String {
    let mut text = String::from("| id | component | backends | grants | compensating control |\n");
    text.push_str("|---|---|---|---|---|\n");
    for entry in REGISTER {
        let backends = if entry.backends.is_empty() {
            "all".to_string()
        } else {
            entry
                .backends
                .iter()
                .map(|backend| backend.as_str().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let mut grants = Vec::new();
        if entry.grants.raw_command {
            grants.push("raw-command");
        }
        if entry.grants.unenforced_spawn {
            grants.push("unenforced-spawn");
        }
        if entry.grants.write_outside_workspace {
            grants.push("write-outside-workspace");
        }
        if entry.grants.host_equivalent_socket {
            grants.push("host-equivalent-socket");
        }
        if grants.is_empty() {
            grants.push("none");
        }
        text.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            entry.id,
            entry.component,
            backends,
            grants.join(" + "),
            entry.compensating_control
        ));
    }
    text
}
