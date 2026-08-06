//! Platform backends, and an honest account of what each one does not cover.
//!
//! | platform | backend | filesystem | network | grandchildren | status |
//! |---|---|---|---|---|---|
//! | macOS | Seatbelt (`sandbox-exec`) | deny-default, exact writes; reads stay broad | deny-default, destination rules | profile descends to children | enforced; degraded when a narrowed read scope is asked for |
//! | Linux | Landlock + seccomp | deny-default, exact writes | seccomp syscall filter | filesystem inherited; seccomp composition is not equivalent | planner tested, application behind `linux-landlock` |
//! | Linux | bubblewrap | deny-default, exact writes | net namespace, all-or-nothing | namespace descends | enforced when `bwrap` is installed |
//! | Windows | restricted token | planner only | planner only | separate account makes per-user installs unreachable | **refuses to spawn**, see register |
//! | anything else | none | — | — | — | **refuses to spawn** |
//!
//! Every profile *planner* in this module is pure and is unit-tested on every
//! platform. Only application is platform-bound. That split is what lets the
//! Linux and Windows policies be reviewed and tested from a macOS developer
//! machine instead of being asserted and hoped for.

mod bubblewrap;
mod landlock;
mod restricted_token;
mod seatbelt;

use std::path::{Path, PathBuf};

#[cfg(target_os = "linux")]
use crate::policy::NetworkPolicy;
use crate::policy::Policy;

pub use bubblewrap::bubblewrap_arguments;
pub use landlock::{LandlockAccess, LandlockRule, LandlockRuleset, landlock_ruleset};
pub use restricted_token::{IntegrityLevel, RestrictedTokenPlan, restricted_token_plan};
pub use seatbelt::seatbelt_profile;

/// Which mechanism is doing the enforcing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendKind {
    Seatbelt,
    Landlock,
    Bubblewrap,
    RestrictedToken,
    None,
}

impl BackendKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Seatbelt => "seatbelt",
            Self::Landlock => "landlock+seccomp",
            Self::Bubblewrap => "bubblewrap",
            Self::RestrictedToken => "restricted-token",
            Self::None => "none",
        }
    }
}

/// How much of the policy is actually being applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnforcementLevel {
    /// The policy applies as written.
    Enforced,
    /// A backend is applying part of the policy; the missing part is named.
    Degraded,
    /// Nothing is applying the policy.
    Unenforced,
}

/// What happens to processes the child itself creates.
///
/// This is the second stated limit: grandchild coverage is an OS property, not
/// a Rust one, and it is **not uniform across backends**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Inheritance {
    /// The profile descends to every descendant.
    ProfileDescends,
    /// Filesystem restrictions are inherited; syscall filter composition is not
    /// equivalent, so a descendant's effective filter can differ.
    FilesystemInheritedOnly,
    /// The child runs under a separate account, which also makes per-user tool
    /// installs unreachable to it.
    SeparateAccount,
    /// Nothing is inherited, because nothing is applied.
    NotApplicable,
}

impl Inheritance {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProfileDescends => "the profile descends to every descendant",
            Self::FilesystemInheritedOnly => {
                "filesystem restrictions are inherited, but syscall filter composition is not \
                 equivalent, so a descendant's effective filter can differ"
            }
            Self::SeparateAccount => {
                "the child runs under a separate account, which also makes per-user tool installs \
                 unreachable"
            }
            Self::NotApplicable => "nothing is inherited, because nothing is applied",
        }
    }
}

/// A named hole in what is being enforced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Gap {
    pub area: &'static str,
    pub detail: &'static str,
}

/// The resolved enforcement for one spawn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enforcement {
    pub backend: BackendKind,
    pub level: EnforcementLevel,
    pub gaps: Vec<Gap>,
    inheritance: Inheritance,
}

impl Enforcement {
    /// What descendants of this child inherit.
    #[must_use]
    pub fn inheritance(&self) -> Inheritance {
        self.inheritance
    }

    /// A model-facing and operator-facing sentence.
    ///
    /// Per-denial reasons that name the sanctioned alternative are the single
    /// most valuable ergonomic feature reported for a sandbox: an agent told
    /// *why* and *what instead* self-corrects, where one told only "denied"
    /// retries blindly.
    #[must_use]
    pub fn notice(&self) -> String {
        let mut text = match self.level {
            EnforcementLevel::Enforced => {
                format!("policy enforced by the {} backend", self.backend.as_str())
            }
            EnforcementLevel::Degraded => format!(
                "policy only PARTLY enforced by the {} backend",
                self.backend.as_str()
            ),
            EnforcementLevel::Unenforced => format!(
                "NO sandbox enforcement is available on this host (backend: {})",
                self.backend.as_str()
            ),
        };
        text.push_str("; descendants: ");
        text.push_str(self.inheritance.as_str());
        for gap in &self.gaps {
            text.push_str(&format!("; gap [{}]: {}", gap.area, gap.detail));
        }
        text
    }
}

/// Chooses a backend for this host and states what it will and will not do.
#[must_use]
pub fn select(policy: &Policy) -> Enforcement {
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = policy;
    let mut gaps = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if Path::new(seatbelt::SANDBOX_EXEC).is_file() {
            gaps.push(Gap {
                area: "substrate",
                detail: "the macOS sandbox interface has been marked deprecated in its own man \
                         page for years and has no announced successor",
            });
            let level = if matches!(policy.readable(), crate::policy::ReadScope::Explicit(_)) {
                gaps.push(Gap {
                    area: "reads",
                    detail: "Seatbelt cannot narrow reads to a declared set without breaking \
                             interpreter startup, because macOS executables consult dynamic \
                             system paths that are not stable across releases. Reads stay broad \
                             on this backend; write authority is still exact",
                });
                EnforcementLevel::Degraded
            } else {
                EnforcementLevel::Enforced
            };
            return Enforcement {
                backend: BackendKind::Seatbelt,
                level,
                gaps,
                inheritance: Inheritance::ProfileDescends,
            };
        }
        gaps.push(Gap {
            area: "backend",
            detail: "sandbox-exec is not present on this macOS host",
        });
    }

    #[cfg(target_os = "linux")]
    {
        if cfg!(feature = "linux-landlock") {
            gaps.push(Gap {
                area: "seccomp",
                detail: "syscall filter composition is not equivalent to filesystem inheritance, \
                         so a descendant's effective filter can differ from the child's",
            });
            return Enforcement {
                backend: BackendKind::Landlock,
                level: EnforcementLevel::Enforced,
                gaps,
                inheritance: Inheritance::FilesystemInheritedOnly,
            };
        }
        if bubblewrap::executable().is_some() {
            let level = if matches!(policy.network_policy(), NetworkPolicy::Egress(_)) {
                gaps.push(Gap {
                    area: "egress",
                    detail: "bubblewrap expresses network access as all-or-nothing, so a \
                             destination allow-list cannot be applied; the network namespace is \
                             shared instead. Use the seatbelt backend or an egress proxy to \
                             enforce destination rules",
                });
                EnforcementLevel::Degraded
            } else {
                EnforcementLevel::Enforced
            };
            gaps.push(Gap {
                area: "namespaces",
                detail: "namespace creation is commonly unavailable to an unprivileged process \
                         inside a container; see the nested-container-degraded register row",
            });
            return Enforcement {
                backend: BackendKind::Bubblewrap,
                level,
                gaps,
                inheritance: Inheritance::ProfileDescends,
            };
        }
        gaps.push(Gap {
            area: "backend",
            detail: "neither the linux-landlock feature nor a bubblewrap binary is available",
        });
    }

    #[cfg(target_os = "windows")]
    {
        gaps.push(Gap {
            area: "backend",
            detail: "the restricted-token planner is implemented and tested, but no Win32 \
                     applier is vendored in this workspace; see the windows-no-enforcement \
                     register row",
        });
        gaps.push(Gap {
            area: "child-creation",
            detail: "a comparable Windows sandbox blocks Node from spawning any child process, \
                     which would break most of the MCP ecosystem",
        });
        return Enforcement {
            backend: BackendKind::RestrictedToken,
            level: EnforcementLevel::Unenforced,
            gaps,
            inheritance: Inheritance::SeparateAccount,
        };
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        gaps.push(Gap {
            area: "platform",
            detail: "this platform has no implemented backend",
        });
    }

    Enforcement {
        backend: BackendKind::None,
        level: EnforcementLevel::Unenforced,
        gaps,
        inheritance: Inheritance::NotApplicable,
    }
}

/// The enforcement of a spawn that declined isolation outright.
///
/// Distinct from "this host has no backend": the gap text says which it is, so
/// a deliberate full-access decision and an accidental one never look the same
/// in the record.
#[must_use]
pub fn declined() -> Enforcement {
    Enforcement {
        backend: BackendKind::None,
        level: EnforcementLevel::Unenforced,
        gaps: vec![Gap {
            area: "requested",
            detail: "the caller declined isolation for this spawn under a register row; no \
                     backend was attempted",
        }],
        inheritance: Inheritance::NotApplicable,
    }
}

/// Builds the argv the host will actually execute.
pub(crate) fn launch(
    enforcement: &Enforcement,
    policy: &Policy,
    program: &Path,
    arguments: &[String],
) -> (PathBuf, Vec<String>, Option<String>) {
    match enforcement.backend {
        BackendKind::Seatbelt if enforcement.level != EnforcementLevel::Unenforced => {
            let profile = seatbelt::seatbelt_profile(policy);
            let mut wrapped = vec!["-p".to_string(), profile.clone()];
            wrapped.push(program.to_string_lossy().into_owned());
            wrapped.extend(arguments.iter().cloned());
            (
                PathBuf::from(seatbelt::SANDBOX_EXEC),
                wrapped,
                Some(profile),
            )
        }
        BackendKind::Bubblewrap if enforcement.level != EnforcementLevel::Unenforced => {
            let executable = bubblewrap::executable()
                .unwrap_or_else(|| PathBuf::from(bubblewrap::PRIMARY_EXECUTABLE));
            let mut wrapped = bubblewrap::bubblewrap_arguments(policy);
            wrapped.push("--".to_string());
            wrapped.push(program.to_string_lossy().into_owned());
            wrapped.extend(arguments.iter().cloned());
            (executable, wrapped, None)
        }
        // Landlock and seccomp are applied in the child before exec, so the argv
        // is unchanged. The restricted-token and none backends do not wrap.
        _ => (program.to_path_buf(), arguments.to_vec(), None),
    }
}

/// Installs any restriction that has to be applied inside the child.
pub(crate) fn apply_child_restrictions(
    command: &mut crate::raw::RawCommand,
    enforcement: &Enforcement,
    policy: &Policy,
) {
    if enforcement.backend != BackendKind::Landlock {
        return;
    }
    landlock::apply(command, policy);
}
