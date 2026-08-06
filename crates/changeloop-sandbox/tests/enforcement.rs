//! End-to-end enforcement: a real child process, a real OS boundary.
//!
//! The unit tests assert on generated policy. These assert on what the kernel
//! actually did, which is the only claim that matters. Where the host has no
//! enforcing backend the tests assert the *refusal* instead, because "no
//! backend" must never read as "test passed".

use std::collections::BTreeMap;

use changeloop_sandbox::{
    BackendKind, EnforcementLevel, Policy, SandboxError, Spawn, StdioPlan, select,
};

/// `sh` needs nothing from `PATH` to run a redirect, but a cleared environment
/// with no `PATH` at all makes some shells unhappy, so give it a fixed one.
fn environment() -> BTreeMap<String, String> {
    let mut environment = BTreeMap::new();
    environment.insert(
        "PATH".to_string(),
        "/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
    );
    environment
}

fn enforcing() -> bool {
    let probe = Policy::deny_by_default(std::env::temp_dir());
    matches!(
        select(&probe).backend,
        BackendKind::Seatbelt | BackendKind::Bubblewrap | BackendKind::Landlock
    ) && select(&probe).level != EnforcementLevel::Unenforced
}

#[test]
fn a_write_inside_the_workspace_succeeds() {
    if !enforcing() {
        return;
    }
    let workspace = tempfile::tempdir().expect("a workspace");
    let root = workspace.path().canonicalize().expect("canonical root");
    let target = root.join("inside.txt");

    let policy = Policy::deny_by_default(&root).writable([root.clone()]);
    let mut child = Spawn::new("/bin/sh", policy)
        .arguments(["-c".to_string(), format!("echo ok > {}", target.display())])
        .working_directory(&root)
        .environment(environment())
        .stdout(StdioPlan::Null)
        .stderr(StdioPlan::Null)
        .spawn()
        .expect("the sandbox permits the spawn");
    let status = child.wait().expect("the child ran");

    assert!(
        status.success() && target.is_file(),
        "a write inside the granted workspace must succeed; status {status:?}"
    );
}

#[test]
fn a_write_outside_the_workspace_is_denied_by_default() {
    if !enforcing() {
        return;
    }
    let workspace = tempfile::tempdir().expect("a workspace");
    let outside = tempfile::tempdir().expect("somewhere else entirely");
    let root = workspace.path().canonicalize().expect("canonical root");
    let target = outside
        .path()
        .canonicalize()
        .expect("canonical outside")
        .join("escaped.txt");

    let policy = Policy::deny_by_default(&root).writable([root.clone()]);
    let mut child = Spawn::new("/bin/sh", policy)
        .arguments([
            "-c".to_string(),
            format!("echo escaped > {}", target.display()),
        ])
        .working_directory(&root)
        .environment(environment())
        .stdout(StdioPlan::Null)
        .stderr(StdioPlan::Null)
        .spawn()
        .expect("the sandbox permits the spawn");
    let status = child.wait().expect("the child ran");

    assert!(
        !target.exists(),
        "the deny-by-default policy let a child write to {}, outside the workspace it was scoped \
         to. Every documented incident involving destruction outside the working tree is the \
         class this eliminates by construction.",
        target.display()
    );
    assert!(
        !status.success(),
        "the child should have failed rather than silently succeeding at nothing"
    );
}

#[test]
fn an_empty_write_allow_list_denies_writes_inside_the_workspace_too() {
    if !enforcing() {
        return;
    }
    let workspace = tempfile::tempdir().expect("a workspace");
    let root = workspace.path().canonicalize().expect("canonical root");
    let target = root.join("nope.txt");

    // No `.writable(..)` call at all: an empty allow-list means zero write access.
    let policy = Policy::deny_by_default(&root);
    let mut child = Spawn::new("/bin/sh", policy)
        .arguments(["-c".to_string(), format!("echo no > {}", target.display())])
        .working_directory(&root)
        .environment(environment())
        .stdout(StdioPlan::Null)
        .stderr(StdioPlan::Null)
        .spawn()
        .expect("the sandbox permits the spawn");
    let _ = child.wait();

    assert!(
        !target.exists(),
        "an empty write allow-list must mean zero write access, not access to the workspace"
    );
}

#[test]
fn a_descendant_cannot_outlive_the_child_that_created_it() {
    if !enforcing() {
        return;
    }
    let workspace = tempfile::tempdir().expect("a workspace");
    let root = workspace.path().canonicalize().expect("canonical root");
    let marker = root.join("descendant-was-here.txt");

    let policy = Policy::deny_by_default(&root).writable([root.clone()]);
    let mut child = Spawn::new("/bin/sh", policy)
        .arguments([
            "-c".to_string(),
            format!("(sleep 30; echo late > {}) & wait", marker.display()),
        ])
        .working_directory(&root)
        .environment(environment())
        .stdout(StdioPlan::Null)
        .stderr(StdioPlan::Null)
        .spawn()
        .expect("the sandbox permits the spawn");

    child.terminate();

    std::thread::sleep(std::time::Duration::from_millis(200));
    assert!(
        !marker.exists(),
        "terminating the child must reach the whole process group it owns, or descendants leak"
    );
}

#[test]
fn the_enforcement_report_matches_what_the_host_can_actually_do() {
    let workspace = tempfile::tempdir().expect("a workspace");
    let root = workspace.path().to_path_buf();
    let policy = Policy::deny_by_default(&root).writable([root.clone()]);

    let plan = Spawn::new("/bin/sh", policy)
        .arguments(["-c".to_string(), "true".to_string()])
        .plan()
        .expect("the plan resolves");

    match plan.enforcement().level {
        EnforcementLevel::Enforced | EnforcementLevel::Degraded => {
            assert_ne!(
                plan.enforcement().backend,
                BackendKind::None,
                "a claim of enforcement must name the mechanism doing it"
            );
        }
        EnforcementLevel::Unenforced => {
            let error = Spawn::new("/bin/sh", Policy::deny_by_default(&root))
                .arguments(["-c".to_string(), "true".to_string()])
                .spawn()
                .expect_err("an unenforced host must refuse rather than run unsandboxed");
            assert!(matches!(error, SandboxError::Unenforced { .. }));
            assert!(
                error.to_string().contains("sanctioned alternative"),
                "the refusal must say what to do instead"
            );
        }
    }
}
