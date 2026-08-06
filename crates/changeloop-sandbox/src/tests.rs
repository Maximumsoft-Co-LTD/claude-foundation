//! Unit tests for the planners and the register.
//!
//! Every planner is pure, so the Linux and Windows policies are asserted here
//! on whatever host happens to run the suite. That is the point of the
//! planner/applier split: a profile mistake is caught by a test, not by a
//! report from the one platform nobody develops on.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::backend::{
    BackendKind, EnforcementLevel, IntegrityLevel, LandlockAccess, bubblewrap_arguments,
    landlock_ruleset, restricted_token_plan, seatbelt_profile, select,
};
use crate::exceptions::{self, Grants, REGISTER};
use crate::policy::{Destination, EgressRule, Policy, ReadScope};
use crate::{SandboxError, Spawn};

fn workspace() -> PathBuf {
    PathBuf::from("/repo")
}

// ---------------------------------------------------------------------------
// Deny by default
// ---------------------------------------------------------------------------

#[test]
fn the_profile_denies_before_it_allows_anything() {
    let profile = seatbelt_profile(&Policy::deny_by_default(workspace()));
    let deny_default = profile
        .find("(deny default)")
        .expect("the profile must deny by default");
    let first_allow = profile
        .find("(allow")
        .expect("the profile allows something");
    assert!(
        deny_default < first_allow,
        "an allow form appeared before `(deny default)`, which inverts the allow-list into a \
         deny-list:\n{profile}"
    );
    assert!(
        !profile.contains("(allow default)"),
        "the profile must never contain `(allow default)`"
    );
}

#[test]
fn an_empty_write_allow_list_means_zero_write_access() {
    let profile = seatbelt_profile(&Policy::deny_by_default(workspace()));
    let writes = profile
        .split_once("(allow file-write*")
        .expect("a write form is present")
        .1;
    let writes = writes.split_once(')').expect("the write form closes").0;
    assert_eq!(
        writes.trim(),
        "(literal \"/dev/null\"",
        "an empty writable list must grant nothing but discarding bytes, found: {writes}"
    );
}

#[test]
fn a_write_outside_the_workspace_is_blocked_by_default() {
    let policy = Policy::deny_by_default(workspace()).writable(["/etc"]);
    let error = policy
        .validate()
        .expect_err("a writable path outside the workspace must be refused");
    let message = error.to_string();
    assert!(
        message.contains("/etc") && message.contains("escapes the workspace"),
        "the refusal must name the offending path: {message}"
    );
}

#[test]
fn a_write_outside_the_workspace_needs_a_register_entry_that_grants_it() {
    // A register row exists, but this one does not grant leaving the workspace.
    let policy = Policy::deny_by_default(workspace())
        .writable_outside_workspace("/etc", exceptions::BACKGROUND_JOB_HOST);
    let error = policy.validate().expect_err("the grant is absent");
    assert!(
        matches!(
            error,
            SandboxError::UngrantedException {
                capability: "writing outside the workspace",
                ..
            }
        ),
        "expected an ungranted-exception error, got: {error}"
    );
}

#[test]
fn workspace_scoped_writes_are_allowed_and_appear_in_the_profile() {
    let policy = Policy::deny_by_default(workspace()).writable(["/repo/target"]);
    policy.validate().expect("a workspace-scoped write is fine");
    assert!(
        seatbelt_profile(&policy).contains("/repo/target"),
        "the granted path must appear in the write allow-list"
    );
}

#[test]
fn policy_files_are_denied_after_every_allow() {
    let policy = Policy::deny_by_default(workspace())
        .writable(["/repo"])
        .protect(["/repo/.changeloop/policy.toml"]);
    let profile = seatbelt_profile(&policy);
    let allow = profile
        .find("(allow file-write*")
        .expect("writes are allowed");
    let deny = profile
        .find("(deny file-write* (literal \"/repo/.changeloop/policy.toml\"))")
        .expect("the protected path is denied");
    assert!(
        deny > allow,
        "the protected deny must come last so no earlier allow reaches it:\n{profile}"
    );
}

// ---------------------------------------------------------------------------
// Loud degradation
// ---------------------------------------------------------------------------

#[test]
fn an_unenforced_host_refuses_to_spawn_rather_than_running_unsandboxed() {
    let enforcement = select(&Policy::deny_by_default(workspace()));
    if enforcement.level != EnforcementLevel::Unenforced {
        // This host has a backend. The refusal path is proven by
        // `an_unenforced_enforcement_always_reports_a_reason` and by the
        // Windows/none branches, which are asserted structurally below.
        return;
    }
    let error = Spawn::new("/bin/echo", Policy::deny_by_default(workspace()))
        .spawn()
        .expect_err("a host with no enforcement must refuse");
    assert!(matches!(error, SandboxError::Unenforced { .. }));
}

#[test]
fn a_refusal_names_the_sanctioned_alternative() {
    let error = SandboxError::Unenforced {
        notice: "NO sandbox enforcement is available on this host".to_string(),
    };
    let message = error.to_string();
    assert!(
        message.contains("sanctioned alternative"),
        "a denial that does not say what to do instead makes an agent retry blindly: {message}"
    );
}

#[test]
fn every_non_enforcing_outcome_carries_a_notice_that_says_so() {
    let enforcement = select(&Policy::deny_by_default(workspace()));
    let notice = enforcement.notice();
    assert!(
        !notice.is_empty(),
        "enforcement must always be describable in one sentence"
    );
    match enforcement.level {
        EnforcementLevel::Enforced => assert!(notice.contains("enforced by")),
        EnforcementLevel::Degraded => assert!(notice.contains("PARTLY")),
        EnforcementLevel::Unenforced => assert!(notice.contains("NO sandbox enforcement")),
    }
    assert!(
        notice.contains("descendants:"),
        "the notice must state what grandchildren inherit, which is a backend property rather \
         than a Rust one: {notice}"
    );
}

#[test]
fn an_unenforced_spawn_requires_a_register_entry_that_grants_it() {
    let enforcement = select(&Policy::deny_by_default(workspace()));
    if enforcement.level != EnforcementLevel::Unenforced {
        return;
    }
    let error = Spawn::new("/bin/echo", Policy::deny_by_default(workspace()))
        // A real register row, but one that does not grant unenforced spawning.
        .allow_unenforced(exceptions::GIT_SSH_EGRESS)
        .spawn()
        .expect_err("the grant is absent");
    assert!(matches!(
        error,
        SandboxError::UngrantedException {
            capability: "spawning without OS enforcement",
            ..
        }
    ));
}

// ---------------------------------------------------------------------------
// The escape hatch works where a command-name list does not
// ---------------------------------------------------------------------------

/// The mechanism that demonstrably fails, reproduced here only so the contrast
/// is a test rather than an assertion in prose. It is deliberately not part of
/// the crate's API.
fn command_name_exclusion_list_permits(
    excluded: &[&str],
    program: &Path,
    _arguments: &[String],
) -> bool {
    let name = program
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    excluded.contains(&name.as_str())
}

#[test]
fn a_command_name_list_misses_a_wrapped_invocation_that_the_transport_rule_catches() {
    // `git push` reached through a shell wrapper: argv[0] is the shell.
    let program = Path::new("/bin/sh");
    let arguments = vec![
        "-lc".to_string(),
        "make deploy && git push origin main".to_string(),
    ];

    assert!(
        !command_name_exclusion_list_permits(&["git"], program, &arguments),
        "a name list keyed on `git` cannot match a wrapped invocation, which is exactly why the \
         documented `excludedCommands` bypass failed"
    );

    let policy = Policy::deny_by_default(workspace()).allow_egress(
        EgressRule::new(
            Destination::tcp("github.com", 22),
            "git push and fetch over SSH",
        )
        .under(exceptions::GIT_SSH_EGRESS),
    );
    policy.validate().expect("a transport rule is expressible");
    assert!(
        policy
            .network_policy()
            .permits(&Destination::tcp("github.com", 22)),
        "the transport rule holds regardless of how the process was invoked"
    );

    let plan = Spawn::new(program, policy)
        .arguments(arguments)
        .plan()
        .expect("the plan resolves");
    if plan.enforcement().backend == BackendKind::Seatbelt {
        let profile = plan.profile().expect("seatbelt expresses policy as text");
        assert!(
            profile.contains("(remote tcp \"github.com:22\")"),
            "the destination rule must reach the profile:\n{profile}"
        );
        let deny = profile
            .find("(deny network*)")
            .expect("network denied first");
        let allow = profile.find("(remote tcp").expect("then narrowed");
        assert!(
            deny < allow,
            "the allow must follow the deny to take effect"
        );
    }
}

#[test]
fn the_transport_rule_does_not_widen_to_other_destinations() {
    let policy = Policy::deny_by_default(workspace()).allow_egress(EgressRule::new(
        Destination::tcp("github.com", 22),
        "git push and fetch over SSH",
    ));
    assert!(
        !policy
            .network_policy()
            .permits(&Destination::tcp("evil.example", 22)),
        "an allowance for one host must not become an allowance for a port"
    );
    assert!(
        !policy
            .network_policy()
            .permits(&Destination::tcp("github.com", 443)),
        "an allowance for one port must not become an allowance for a host"
    );
}

#[test]
fn an_egress_rule_without_a_reason_is_refused() {
    let policy = Policy::deny_by_default(workspace())
        .allow_egress(EgressRule::new(Destination::tcp("example.com", 443), "  "));
    assert!(
        policy.validate().is_err(),
        "an allow-list row with no reason cannot be audited later"
    );
}

#[test]
fn a_host_equivalent_socket_needs_its_own_register_entry() {
    let policy = Policy::deny_by_default(workspace()).allow_egress(EgressRule::new(
        Destination::UnixSocket(PathBuf::from("/var/run/docker.sock")),
        "build images",
    ));
    let error = policy
        .validate()
        .expect_err("reaching the container runtime socket is equivalent to owning the host");
    assert!(error.to_string().contains("host-equivalent"));

    let allowed = Policy::deny_by_default(workspace()).allow_egress(
        EgressRule::new(
            Destination::UnixSocket(PathBuf::from("/var/run/docker.sock")),
            "build images",
        )
        .under(exceptions::CONTAINER_RUNTIME_SOCKET),
    );
    allowed
        .validate()
        .expect("the enumerated form of the hole is permitted");
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

#[test]
fn the_register_is_enumerated_sorted_and_complete() {
    let mut previous = "";
    let mut seen = BTreeSet::new();
    for entry in REGISTER {
        assert!(
            entry.id > previous,
            "register rows must be sorted and unique; `{}` follows `{previous}`",
            entry.id
        );
        previous = entry.id;
        assert!(
            seen.insert(entry.id),
            "duplicate register id `{}`",
            entry.id
        );
        assert!(
            !entry.component.trim().is_empty() && entry.component != "various",
            "row `{}` must name a specific component",
            entry.id
        );
        assert!(
            entry.reason.len() > 40,
            "row `{}` must explain why it exists",
            entry.id
        );
        assert!(
            entry.compensating_control.len() > 40,
            "row `{}` must name the compensating control that bounds it",
            entry.id
        );
        assert!(
            !entry.review.trim().is_empty(),
            "row `{}` must say when it is revisited",
            entry.id
        );
    }
}

#[test]
fn every_published_identifier_resolves_to_a_row_and_every_row_is_published() {
    let published: BTreeSet<&str> = exceptions::published_ids()
        .into_iter()
        .map(|id| {
            exceptions::lookup(id)
                .unwrap_or_else(|| panic!("published id `{id}` has no register row"))
                .id
        })
        .collect();
    let rows: BTreeSet<&str> = REGISTER.iter().map(|entry| entry.id).collect();
    assert_eq!(
        published, rows,
        "the published constants and the register must be the same set, or a row exists that no \
         caller can name (dead) or a caller can name a row that is not reviewable (invisible)"
    );
}

#[test]
fn exactly_one_row_grants_a_raw_command_handoff() {
    let granting: Vec<&str> = REGISTER
        .iter()
        .filter(|entry| entry.grants.raw_command)
        .map(|entry| entry.id)
        .collect();
    assert_eq!(
        granting,
        vec!["legacy-command-handoff"],
        "the raw handoff is the one hole in the spawn boundary; more than one row granting it \
         means the boundary is no longer countable"
    );
}

#[test]
fn the_reqwest_configd_guard_is_named_and_the_test_it_names_exists() {
    let entry = exceptions::lookup(exceptions::REQWEST_CONFIGD_PRE_GA).expect("the row exists");
    assert!(
        entry
            .compensating_control
            .contains("REQWEST_CONFIGD_GUARD_TEST"),
        "the row must point at the guard rather than restating it"
    );
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("the crate sits two directories below the workspace root");
    let guard = root.join(exceptions::REQWEST_CONFIGD_GUARD_TEST);
    assert!(
        guard.is_file(),
        "the named pre-GA guard must exist at {}; the register points at it deliberately \
         instead of duplicating it",
        guard.display()
    );
}

#[test]
fn the_register_renders_as_an_auditable_table() {
    let table = exceptions::render_register();
    for entry in REGISTER {
        assert!(
            table.contains(entry.id),
            "row `{}` is missing from the rendered register",
            entry.id
        );
    }
    assert!(table.contains("compensating control"));
    assert!(
        table.contains("raw-command"),
        "the rendered table must show what each row actually grants"
    );
}

#[test]
fn a_row_that_grants_nothing_is_still_a_documented_row() {
    let entry = exceptions::lookup(exceptions::GIT_SSH_EGRESS).expect("the row exists");
    assert_eq!(
        entry.grants,
        Grants {
            raw_command: false,
            unenforced_spawn: false,
            write_outside_workspace: false,
            host_equivalent_socket: false,
        },
        "a transport rule needs no grant; it is registered so the allow-list stays reviewable"
    );
}

// ---------------------------------------------------------------------------
// Platform planners, asserted from any host
// ---------------------------------------------------------------------------

#[test]
fn the_landlock_ruleset_grants_read_broadly_and_write_exactly() {
    let policy = Policy::deny_by_default(workspace()).writable(["/repo/target"]);
    let ruleset = landlock_ruleset(&policy);
    assert!(ruleset.no_new_privs, "Landlock requires no_new_privs");
    assert!(ruleset.deny_all_tcp_connect, "the default denies egress");
    let writable: Vec<&PathBuf> = ruleset
        .rules
        .iter()
        .filter(|rule| rule.access == LandlockAccess::ReadWrite)
        .map(|rule| &rule.path)
        .collect();
    assert_eq!(writable, vec![&PathBuf::from("/repo/target")]);
}

#[test]
fn the_landlock_ruleset_can_only_narrow_egress_by_port() {
    let policy = Policy::deny_by_default(workspace()).allow_egress(EgressRule::new(
        Destination::tcp("github.com", 22),
        "git over SSH",
    ));
    let ruleset = landlock_ruleset(&policy);
    assert!(!ruleset.deny_all_tcp_connect);
    assert_eq!(
        ruleset.allowed_connect_ports,
        vec![22],
        "Landlock network rules are port-based; the host part is not enforceable at this layer \
         and needs an egress proxy"
    );
    assert_eq!(ruleset.minimum_abi, 4, "TCP restrictions arrive at ABI 4");
}

#[test]
fn the_restricted_token_plan_strips_privileges_and_lowers_integrity() {
    let plan = restricted_token_plan(&Policy::deny_by_default(workspace()).writable(["/repo/out"]));
    assert_eq!(plan.integrity_level, IntegrityLevel::Low);
    assert!(plan.deleted_privileges.contains(&"SeDebugPrivilege"));
    assert!(plan.deny_only_groups.contains(&"BUILTIN\\Administrators"));
    assert!(plan.network_denied);
    assert!(
        plan.job_object_kill_on_close,
        "the job object is the Windows analogue of the owned process group"
    );
    assert!(
        plan.separate_account_hides_per_user_installs,
        "the cost of the separate account is recorded rather than discovered in the field"
    );
    assert_eq!(plan.writable_paths, vec![PathBuf::from("/repo/out")]);
}

#[test]
fn bubblewrap_unshares_the_network_only_when_egress_is_fully_denied() {
    let denied = bubblewrap_arguments(&Policy::deny_by_default(workspace()));
    assert!(denied.iter().any(|argument| argument == "--unshare-net"));

    let egress = bubblewrap_arguments(&Policy::deny_by_default(workspace()).allow_egress(
        EgressRule::new(Destination::tcp("github.com", 22), "git over SSH"),
    ));
    assert!(
        !egress.iter().any(|argument| argument == "--unshare-net"),
        "bubblewrap cannot express a destination allow-list, so unsharing here would silently \
         deny the rule instead of applying it"
    );
}

#[test]
fn bubblewrap_binds_writable_paths_and_nothing_else_writably() {
    let policy = Policy::deny_by_default(workspace())
        .writable(["/repo/target"])
        .read_scope(ReadScope::Explicit(vec![workspace()]));
    let arguments = bubblewrap_arguments(&policy);
    let binds: Vec<&String> = arguments
        .iter()
        .enumerate()
        .filter(|(index, argument)| *argument == "--bind" && *index + 1 < arguments.len())
        .map(|(index, _)| &arguments[index + 1])
        .collect();
    assert_eq!(binds, vec![&"/repo/target".to_string()]);
}

#[test]
fn a_read_scope_a_backend_cannot_apply_is_reported_rather_than_silently_dropped() {
    let narrowed =
        Policy::deny_by_default(workspace()).read_scope(ReadScope::Explicit(vec![workspace()]));
    let enforcement = select(&narrowed);
    if enforcement.backend != BackendKind::Seatbelt {
        return;
    }
    assert_eq!(
        enforcement.level,
        EnforcementLevel::Degraded,
        "Seatbelt keeps reads broad, so a narrowed read scope is partly unapplied"
    );
    assert!(
        enforcement.gaps.iter().any(|gap| gap.area == "reads"),
        "the unapplied axis must be named: {}",
        enforcement.notice()
    );
    assert!(
        seatbelt_profile(&narrowed).contains("(allow file-read*)"),
        "the profile must keep reads broad rather than emit one that aborts interpreter startup"
    );
    // The write axis is unaffected: partial enforcement is not no enforcement.
    let policy = narrowed.writable(["/repo/target"]);
    let profile = seatbelt_profile(&policy);
    assert!(profile.contains("/repo/target") && profile.contains("(deny default)"));
}

#[test]
fn the_platform_matrix_reports_a_backend_or_refuses() {
    let enforcement = select(&Policy::deny_by_default(workspace()));
    match enforcement.backend {
        BackendKind::Seatbelt | BackendKind::Landlock | BackendKind::Bubblewrap => {
            assert_ne!(enforcement.level, EnforcementLevel::Unenforced);
        }
        BackendKind::RestrictedToken | BackendKind::None => {
            assert_eq!(
                enforcement.level,
                EnforcementLevel::Unenforced,
                "a backend that cannot apply the policy must not claim to"
            );
            assert!(
                !enforcement.gaps.is_empty(),
                "an unenforced outcome must name what is missing"
            );
        }
    }
}

#[test]
fn a_degraded_or_unenforced_spawn_is_reported_to_the_operator() {
    use std::sync::{Arc, Mutex};

    let captured = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&captured);
    crate::set_degradation_reporter(move |enforcement| {
        if let Ok(mut notices) = sink.lock() {
            notices.push(enforcement.notice());
        }
    });

    let policy = Policy::deny_by_default(workspace());
    let enforcement = select(&policy);
    crate::report(&enforcement);

    let notices = captured.lock().expect("the sink is not poisoned").clone();
    if enforcement.level == EnforcementLevel::Enforced {
        assert!(
            notices.is_empty(),
            "an enforced spawn is not a degradation and must not be reported as one"
        );
    } else {
        assert!(
            !notices.is_empty(),
            "a sandbox that quietly does nothing is worse than none, because the operator \
             believes they have one"
        );
    }
}
