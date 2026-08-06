//! The single process-spawn API for Changeloop.
//!
//! # Why one API rather than many checks
//!
//! Six mechanism-distinct enforcement failures are documented in
//! `docs/research/changeloop-agent-runtime-2026.md` §7. Each one is a *different
//! code path that had to remember to enforce policy and empirically did not*: a
//! PTY plugin silently reinterpreting `ask` as `deny`, five of seven production
//! MCP clients running tools with full host privileges, a permission system that
//! fired but did not recognise a destructive expansion, an `(allow default)`
//! profile that bypassed the prompt entirely, a plan mode that acknowledged a
//! prohibition and then violated it, and a mandatory two-person gate that never
//! fired because the agent inherited ambient credentials.
//!
//! The lesson is not "add more chokepoints". It is **coverage**: if every child
//! process is created through one internal spawn API, then "one chokepoint" and
//! "every spawn point is covered" are the same design. In Rust that is a
//! compiler-checked property rather than a review convention — the raw spawn
//! primitive lives in a private module ([`raw`]) and no other crate in this
//! workspace can name it.
//!
//! # Three limits, stated rather than oversold
//!
//! The visibility boundary is **necessary and not sufficient**:
//!
//! 1. **Rust privacy binds only this workspace's crates.** A dependency that
//!    calls [`std::process::Command`] directly escapes it entirely. This is not
//!    hypothetical: `reqwest`'s default features link `system-configuration`,
//!    which does a mach-lookup the default macOS Seatbelt profile denies, and
//!    panics with exit 101 before any Changeloop code runs. The workspace guard
//!    for that case is [`exceptions::REQWEST_CONFIGD_GUARD_TEST`]. Pair this
//!    boundary with a dependency audit; do not treat it as a proof of coverage.
//! 2. **Grandchild coverage rests on OS sandbox *inheritance*, not on Rust.**
//!    Inheritance is not uniform across backends: a Seatbelt profile descends to
//!    children, Landlock filesystem restrictions are inherited but seccomp
//!    filter composition is not equivalent, and a Windows backend that runs the
//!    child under a separate account makes per-user tool installs unreachable.
//!    [`Enforcement::inheritance`] reports which guarantee actually applies.
//! 3. **The allow-list is an unbounded, adversarially-maintained artefact.**
//!    Four filed breakage issues are documented and two were closed "not
//!    planned" by better-resourced vendors: a Rust CLI panicking at exit 101 on
//!    a proxy-config lookup, `excludedCommands` silently failing for SSH so
//!    `git push` breaks, a point release silently breaking a credential CLI, and
//!    a Windows sandbox blocking all Node child spawning. This crate answers
//!    that with **profile coarseness** — one maintained deny-by-default profile
//!    scoped to workspace-write plus network egress, never per-tool profiles —
//!    and with a transport-level bypass plus an enumerated
//!    [`exceptions::REGISTER`], never ad-hoc holes.
//!
//! # Shape of the API
//!
//! [`Policy`] describes what a child may touch. [`Spawn`] is the only way to
//! create a child process. [`SandboxedChild`] owns its lifecycle, including the
//! process group, so descendants cannot outlive it.
//!
//! ```no_run
//! use changeloop_sandbox::{Policy, Spawn, StdioPlan};
//! # fn main() -> Result<(), changeloop_sandbox::SandboxError> {
//! let policy = Policy::deny_by_default("/repo").writable(["/repo/target"]);
//! let mut child = Spawn::new("/bin/echo", policy)
//!     .arguments(["hello"])
//!     .stdout(StdioPlan::Piped)
//!     .spawn()?;
//! let status = child.wait().expect("the child was created");
//! # let _ = status;
//! # Ok(())
//! # }
//! ```
//!
//! # What cannot be done from outside this crate
//!
//! The raw primitive is private. These do not compile:
//!
//! The raw primitive is not nameable:
//!
//! ```compile_fail
//! let _ = changeloop_sandbox::raw::RawCommand::new(std::path::Path::new("/bin/sh"));
//! ```
//!
//! There is no policy-free spawn:
//!
//! ```compile_fail
//! let _ = changeloop_sandbox::Spawn::new("/bin/sh");
//! ```
//!
//! A plan cannot become a command without naming a register entry:
//!
//! ```compile_fail
//! # fn main() -> Result<(), changeloop_sandbox::SandboxError> {
//! let plan = changeloop_sandbox::Spawn::new(
//!     "/bin/sh",
//!     changeloop_sandbox::Policy::deny_by_default("/repo"),
//! )
//! .plan()?;
//! let _command: std::process::Command = plan.into_registered_command()?;
//! # Ok(())
//! # }
//! ```
//!
//! An exception identifier cannot be invented, only chosen from the register:
//!
//! ```compile_fail
//! let _ = changeloop_sandbox::ExceptionId("my-ad-hoc-hole");
//! ```
//!
//! And a sandboxed child does not surrender its inner handle:
//!
//! ```compile_fail
//! # fn main() -> Result<(), changeloop_sandbox::SandboxError> {
//! let child = changeloop_sandbox::Spawn::new(
//!     "/bin/echo",
//!     changeloop_sandbox::Policy::deny_by_default("/repo"),
//! )
//! .spawn()?;
//! let _inner: std::process::Child = child.child;
//! # Ok(())
//! # }
//! ```

pub mod backend;
pub mod exceptions;
pub mod policy;
mod raw;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{ChildStderr, ChildStdin, ChildStdout, ExitStatus, Stdio};
use std::sync::{Mutex, OnceLock};

pub use backend::{
    BackendKind, Enforcement, EnforcementLevel, Gap, Inheritance, IntegrityLevel, LandlockAccess,
    LandlockRule, LandlockRuleset, RestrictedTokenPlan, bubblewrap_arguments, declined,
    landlock_ruleset, restricted_token_plan, seatbelt_profile, select,
};
pub use exceptions::{ExceptionEntry, ExceptionId, Grants};
pub use policy::{Destination, EgressRule, NetworkPolicy, Policy, ReadScope};

/// Everything that can go wrong before a child exists.
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// No backend on this platform can enforce the requested policy, and the
    /// caller did not name a register entry authorising an unenforced spawn.
    ///
    /// This is the loud degradation path. A platform without enforcement
    /// refuses to spawn rather than silently running the child unsandboxed.
    #[error(
        "refusing to spawn: {notice}\n\
         sanctioned alternative: name a register entry via \
         `Spawn::allow_unenforced` if this component is genuinely exempt, or run \
         on a platform with an enforcing backend"
    )]
    Unenforced { notice: String },
    /// A register entry was named but does not exist.
    #[error("sandbox exception `{0}` is not in the register")]
    UnknownException(String),
    /// A register entry exists but does not grant the capability asked of it.
    #[error("sandbox exception `{id}` does not grant {capability}")]
    UngrantedException {
        id: &'static str,
        capability: &'static str,
    },
    /// The policy itself is not expressible: a writable path escapes the
    /// workspace, an egress rule names a host-equivalent socket, and so on.
    #[error("sandbox policy is invalid: {0}")]
    InvalidPolicy(String),
    /// The operating system refused to create the process.
    #[error("process failed to start: {0}")]
    Spawn(#[source] std::io::Error),
}

/// How a child's standard stream is connected.
///
/// [`StdioPlan::Handle`] exists so callers that already own a descriptor (a PTY
/// slave, for instance) can hand it over without needing the spawn primitive.
pub enum StdioPlan {
    Piped,
    Null,
    Inherit,
    Handle(Stdio),
}

impl StdioPlan {
    fn into_stdio(self) -> Stdio {
        match self {
            Self::Piped => Stdio::piped(),
            Self::Null => Stdio::null(),
            Self::Inherit => Stdio::inherit(),
            Self::Handle(handle) => handle,
        }
    }
}

impl std::fmt::Debug for StdioPlan {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = match self {
            Self::Piped => "Piped",
            Self::Null => "Null",
            Self::Inherit => "Inherit",
            Self::Handle(_) => "Handle",
        };
        formatter.write_str(name)
    }
}

/// How the child is attached to a session and a process group.
///
/// Owning the process group at spawn time is what makes descendant cleanup
/// possible at all: a negative PID signal reaches only the group this crate
/// created, so nothing leaks and no unrelated process is hit by PID reuse.
#[derive(Debug, Clone, Copy)]
pub enum SessionPlan {
    /// Inherit the parent's group. Descendants are not collectively killable.
    Inherit,
    /// Place the child in a fresh process group that this crate owns.
    OwnedProcessGroup,
    /// Start a new session and make the given descriptor the controlling
    /// terminal.
    ///
    /// A child with a controlling terminal cannot raise an interactive approval
    /// prompt through the harness. The documented PTY failure is exactly this:
    /// a plugin that could not prompt silently reinterpreted `ask` as `deny` on
    /// one axis and as `allow` on another. Callers must resolve `ask` before
    /// choosing this plan, never inside the child.
    #[cfg(unix)]
    ControllingTerminal { slave: std::os::fd::RawFd },
}

/// What to do when no backend can enforce the policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnenforcedDisposition {
    /// Refuse to spawn. The default, and the only safe default.
    Refuse,
    /// Spawn anyway, because a named register entry authorises it.
    RegisteredException(ExceptionId),
}

/// A resolved, inspectable launch: the argv that will actually be executed and
/// the enforcement that will actually apply.
///
/// Producing a plan performs no side effects, which is what makes the policy
/// unit-testable on platforms whose backend cannot run.
#[derive(Debug, Clone)]
pub struct LaunchPlan {
    program: PathBuf,
    arguments: Vec<String>,
    enforcement: Enforcement,
    profile: Option<String>,
}

impl LaunchPlan {
    /// The binary that will be executed — the backend wrapper when one is used.
    #[must_use]
    pub fn program(&self) -> &Path {
        &self.program
    }

    /// The full argument vector, wrapper arguments included.
    #[must_use]
    pub fn arguments(&self) -> &[String] {
        &self.arguments
    }

    /// What enforcement this plan will actually get.
    #[must_use]
    pub fn enforcement(&self) -> &Enforcement {
        &self.enforcement
    }

    /// The backend profile text, when the backend expresses policy as text.
    ///
    /// Exposed so a test can assert on the policy that will be applied rather
    /// than on the fact that a call was made.
    #[must_use]
    pub fn profile(&self) -> Option<&str> {
        self.profile.as_deref()
    }

    /// Hands a `std::process::Command` back to a caller this workspace does not
    /// yet own, under a named register entry.
    ///
    /// This is the enumerated form of the hole every sandbox eventually grows.
    /// The plan — profile, argv, enforcement — is still built here; only the
    /// final handoff is delegated. The entry must set
    /// [`Grants::raw_command`].
    pub fn into_registered_command(
        self,
        exception: ExceptionId,
    ) -> Result<std::process::Command, SandboxError> {
        let entry = exceptions::require(exception)?;
        if !entry.grants.raw_command {
            return Err(SandboxError::UngrantedException {
                id: entry.id,
                capability: "a raw std::process::Command handoff",
            });
        }
        report(&self.enforcement);
        let mut command = raw::RawCommand::new(&self.program);
        command.as_mut().args(&self.arguments);
        Ok(command.into_inner())
    }
}

/// The only way to create a child process in this workspace.
#[derive(Debug)]
pub struct Spawn {
    program: PathBuf,
    arguments: Vec<String>,
    working_directory: Option<PathBuf>,
    environment: BTreeMap<String, String>,
    clear_environment: bool,
    stdin: StdioPlan,
    stdout: StdioPlan,
    stderr: StdioPlan,
    session: SessionPlan,
    policy: Policy,
    unenforced: UnenforcedDisposition,
    forced_unenforced: Option<ExceptionId>,
}

impl Spawn {
    /// Starts a spawn description. The policy is required, not optional, so
    /// "forgot to apply a policy" is not a reachable state.
    pub fn new(program: impl Into<PathBuf>, policy: Policy) -> Self {
        Self {
            program: program.into(),
            arguments: Vec::new(),
            working_directory: None,
            environment: BTreeMap::new(),
            clear_environment: true,
            stdin: StdioPlan::Null,
            stdout: StdioPlan::Piped,
            stderr: StdioPlan::Piped,
            session: SessionPlan::OwnedProcessGroup,
            policy,
            unenforced: UnenforcedDisposition::Refuse,
            forced_unenforced: None,
        }
    }

    #[must_use]
    pub fn arguments<I, S>(mut self, arguments: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.arguments = arguments.into_iter().map(Into::into).collect();
        self
    }

    #[must_use]
    pub fn working_directory(mut self, directory: impl Into<PathBuf>) -> Self {
        self.working_directory = Some(directory.into());
        self
    }

    /// Sets the child's entire environment. Ambient credentials are dropped by
    /// default; the documented Kiro failure was an agent inheriting the
    /// deploying engineer's credentials past a mandatory gate.
    #[must_use]
    pub fn environment(mut self, environment: BTreeMap<String, String>) -> Self {
        self.environment = environment;
        self
    }

    /// Keeps the parent environment instead of clearing it. Present only
    /// because some legacy call sites still need it; prefer the default.
    #[must_use]
    pub fn inherit_environment(mut self) -> Self {
        self.clear_environment = false;
        self
    }

    #[must_use]
    pub fn stdin(mut self, plan: StdioPlan) -> Self {
        self.stdin = plan;
        self
    }

    #[must_use]
    pub fn stdout(mut self, plan: StdioPlan) -> Self {
        self.stdout = plan;
        self
    }

    #[must_use]
    pub fn stderr(mut self, plan: StdioPlan) -> Self {
        self.stderr = plan;
        self
    }

    #[must_use]
    pub fn session(mut self, plan: SessionPlan) -> Self {
        self.session = plan;
        self
    }

    /// Authorises an unenforced spawn under a named register entry.
    ///
    /// There is deliberately no boolean form of this. Every unenforced spawn in
    /// the workspace is therefore attributable to a register row that names a
    /// component, a reason and a compensating control.
    #[must_use]
    pub fn allow_unenforced(mut self, exception: ExceptionId) -> Self {
        self.unenforced = UnenforcedDisposition::RegisteredException(exception);
        self
    }

    /// Declines enforcement outright, whatever this host could have applied.
    ///
    /// This is not the same as [`Spawn::allow_unenforced`], and keeping the two
    /// apart is the point. `allow_unenforced` means "a backend was wanted and
    /// none exists here"; this means "no isolation was requested". Recording
    /// the difference is what lets the policy layer treat one as an unavailable
    /// capability and the other as a full-access decision, instead of a caller
    /// discovering months later that a deliberate choice and an accident looked
    /// identical in the record.
    #[must_use]
    pub fn without_enforcement(mut self, exception: ExceptionId) -> Self {
        self.forced_unenforced = Some(exception);
        self.unenforced = UnenforcedDisposition::RegisteredException(exception);
        self
    }

    /// Resolves the policy against this host without spawning anything.
    pub fn plan(&self) -> Result<LaunchPlan, SandboxError> {
        self.policy.validate()?;
        let enforcement = match self.forced_unenforced {
            Some(_) => backend::declined(),
            None => backend::select(&self.policy),
        };
        let (program, arguments, profile) =
            backend::launch(&enforcement, &self.policy, &self.program, &self.arguments);
        Ok(LaunchPlan {
            program,
            arguments,
            enforcement,
            profile,
        })
    }

    /// Creates the child process.
    ///
    /// Refuses when nothing can enforce the policy, unless a register entry
    /// granting [`Grants::unenforced_spawn`] was named.
    pub fn spawn(self) -> Result<SandboxedChild, SandboxError> {
        let plan = self.plan()?;
        let enforcement = plan.enforcement.clone();
        if enforcement.level == EnforcementLevel::Unenforced {
            match self.unenforced {
                UnenforcedDisposition::Refuse => {
                    report(&enforcement);
                    return Err(SandboxError::Unenforced {
                        notice: enforcement.notice(),
                    });
                }
                UnenforcedDisposition::RegisteredException(id) => {
                    let entry = exceptions::require(id)?;
                    if !entry.grants.unenforced_spawn {
                        return Err(SandboxError::UngrantedException {
                            id: entry.id,
                            capability: "spawning without OS enforcement",
                        });
                    }
                }
            }
        }
        report(&enforcement);

        let mut command = raw::RawCommand::new(&plan.program);
        {
            let builder = command.as_mut();
            builder.args(&plan.arguments);
            if let Some(directory) = &self.working_directory {
                builder.current_dir(directory);
            }
            if self.clear_environment {
                builder.env_clear();
            }
            builder.envs(&self.environment);
            builder.stdin(self.stdin.into_stdio());
            builder.stdout(self.stdout.into_stdio());
            builder.stderr(self.stderr.into_stdio());
        }
        let owned_group = matches!(self.session, SessionPlan::OwnedProcessGroup);
        raw::apply_session(&mut command, self.session);
        backend::apply_child_restrictions(&mut command, &enforcement, &self.policy);
        let child = command.spawn().map_err(SandboxError::Spawn)?;
        Ok(SandboxedChild {
            child,
            enforcement,
            owned_group,
        })
    }
}

/// A child process whose lifecycle this crate owns.
#[derive(Debug)]
pub struct SandboxedChild {
    child: std::process::Child,
    enforcement: Enforcement,
    owned_group: bool,
}

impl SandboxedChild {
    /// What enforcement this child actually got.
    #[must_use]
    pub fn enforcement(&self) -> &Enforcement {
        &self.enforcement
    }

    #[must_use]
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.child.stdin.take()
    }

    pub fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    pub fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    pub fn wait(&mut self) -> std::io::Result<ExitStatus> {
        self.child.wait()
    }

    /// Observes terminal state without reaping the group leader.
    ///
    /// Keeping the leader as a zombie pins its PID and PGID while descendants
    /// are killed, so a fast PID reuse cannot redirect the group signal at an
    /// unrelated process.
    pub fn try_wait_owned_group(&mut self) -> std::io::Result<Option<ExitStatus>> {
        raw::try_wait_owned_group(&mut self.child, self.owned_group)
    }

    /// Kills the child and every descendant in the group it owns.
    pub fn terminate(&mut self) {
        if self.owned_group {
            raw::terminate_process_group(&self.child);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

type Reporter = Box<dyn Fn(&Enforcement) + Send + Sync>;

fn reporter_slot() -> &'static Mutex<Option<Reporter>> {
    static SLOT: OnceLock<Mutex<Option<Reporter>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn seen_notices() -> &'static Mutex<std::collections::BTreeSet<String>> {
    static SEEN: OnceLock<Mutex<std::collections::BTreeSet<String>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(std::collections::BTreeSet::new()))
}

/// Installs the sink that degradation notices are written to.
///
/// A sandbox that quietly does nothing is worse than no sandbox, because the
/// operator believes they have one. Every non-enforcing spawn emits here.
pub fn set_degradation_reporter<F>(reporter: F)
where
    F: Fn(&Enforcement) + Send + Sync + 'static,
{
    if let Ok(mut slot) = reporter_slot().lock() {
        *slot = Some(Box::new(reporter));
    }
}

fn report(enforcement: &Enforcement) {
    if enforcement.level == EnforcementLevel::Enforced {
        return;
    }
    if let Ok(slot) = reporter_slot().lock()
        && let Some(reporter) = slot.as_ref()
    {
        reporter(enforcement);
        return;
    }
    let notice = enforcement.notice();
    let first_time = seen_notices()
        .lock()
        .map(|mut seen| seen.insert(notice.clone()))
        .unwrap_or(true);
    if first_time {
        eprintln!("changeloop-sandbox: {notice}");
    }
}
