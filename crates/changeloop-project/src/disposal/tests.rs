use super::*;
use crate::{ProjectInstance, ResourceKind};
use changeloop_sandbox::{EnforcementLevel, Policy, StdioPlan, select};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tempfile::tempdir;

// ---------------------------------------------------------------------------
// Bounded caches with eviction callbacks
// ---------------------------------------------------------------------------

/// A resource that is only released when somebody is told to release it.
/// Dropping it without a notification is the leak under test.
struct Leasable {
    label: &'static str,
}

#[test]
fn bounded_cache_evicts_to_the_owner_rather_than_forgetting() {
    let released = Arc::new(Mutex::new(Vec::new()));
    let sink_log = Arc::clone(&released);
    let mut cache = BoundedResourceCache::new(2, move |key: u32, value: Leasable, cause| {
        // The owner — not the cache — performs the release.
        sink_log
            .lock()
            .unwrap()
            .push(format!("{key}:{}:{cause:?}", value.label));
    });

    let resource = |label| Leasable { label };

    cache.insert(1, resource("plugin-a")).unwrap();
    cache.insert(2, resource("plugin-b")).unwrap();
    // Touching 1 makes 2 the least recently used, so the third insert must
    // choose 2 and must say so.
    assert!(cache.get(&1).is_some());
    cache.insert(3, resource("plugin-c")).unwrap();

    assert_eq!(cache.len(), 2);
    assert!(!cache.contains_key(&2));
    assert_eq!(*released.lock().unwrap(), ["2:plugin-b:Capacity"]);

    cache.insert(1, resource("plugin-a2")).unwrap();
    cache.remove(&3);
    assert_eq!(
        *released.lock().unwrap(),
        [
            "2:plugin-b:Capacity",
            "1:plugin-a:Replaced",
            "3:plugin-c:Removed"
        ]
    );

    // Disposal drains the remainder oldest-first, still through the sink.
    assert_eq!(cache.dispose(), 1);
    assert_eq!(
        released.lock().unwrap().last().map(String::as_str),
        Some("1:plugin-a2:Disposed")
    );
    assert_eq!(
        cache.evicted(),
        4,
        "every entry that left reached the owner"
    );
    assert!(cache.is_empty());
}

#[test]
fn cache_disposal_is_idempotent_and_a_late_insert_is_released_not_leaked() {
    let released = Arc::new(Mutex::new(Vec::new()));
    let sink_log = Arc::clone(&released);
    let mut cache = BoundedResourceCache::new(4, move |key: &'static str, _: u32, cause| {
        sink_log.lock().unwrap().push(format!("{key}:{cause:?}"));
    });
    cache.insert("live", 1).unwrap();

    assert_eq!(cache.dispose(), 1);
    assert_eq!(cache.dispose(), 0, "second disposal releases nothing");
    assert!(cache.is_disposed());

    // A disposed cache must not become a place resources go to die quietly.
    assert!(matches!(
        cache.insert("late", 2),
        Err(crate::InstanceError::Disposed)
    ));
    assert_eq!(
        *released.lock().unwrap(),
        ["live:Disposed", "late:Disposed"]
    );
}

#[test]
fn dropping_a_cache_still_notifies_the_owner() {
    let released = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&released);
    {
        let mut cache = BoundedResourceCache::new(8, move |_: u8, _: u8, _| {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        cache.insert(1, 1).unwrap();
        cache.insert(2, 2).unwrap();
    }
    assert_eq!(released.load(Ordering::SeqCst), 2);
}

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

/// Whether this host has a backend that can actually enforce a policy. Where it
/// cannot, `Spawn` refuses by design and there is no child to reap.
fn enforcement_available(workspace: &Path) -> bool {
    select(&Policy::deny_by_default(workspace)).level != EnforcementLevel::Unenforced
}

#[cfg(unix)]
fn probe_spawn(workspace: &Path, script: &str) -> Spawn {
    Spawn::new("/bin/sh", Policy::deny_by_default(workspace))
        .arguments(["-c", script])
        .stdout(StdioPlan::Null)
        .stderr(StdioPlan::Null)
}

/// Whether the kernel still has a status to hand out for this PID. A defunct
/// (zombie) child answers `waitpid`; a reaped one answers `ECHILD`.
#[cfg(unix)]
fn is_defunct(pid: u32) -> bool {
    let mut status = 0;
    let result = unsafe { libc::waitpid(pid as libc::pid_t, &mut status, libc::WNOHANG) };
    result > 0
}

#[cfg(unix)]
#[test]
fn a_child_fan_out_leaves_no_defunct_process_behind() {
    let directory = tempdir().unwrap();
    let workspace = directory.path();
    if !enforcement_available(workspace) {
        return;
    }

    const FAN_OUT: usize = 24;
    let mut registry = ChildProcessRegistry::new();
    let mut pids = Vec::new();
    for index in 0..FAN_OUT {
        let pid = registry
            .spawn(format!("fan-out-{index}"), probe_spawn(workspace, "exit 0"))
            .expect("the sandbox backend can create a child on this host");
        pids.push(pid);
    }
    assert_eq!(registry.live(), FAN_OUT);

    // Reaping on the same cadence as the fan-out is what keeps the backlog at
    // zero; a runtime that waits until teardown holds one zombie per exit.
    let deadline = Instant::now() + Duration::from_secs(30);
    while registry.live() > 0 && Instant::now() < deadline {
        registry.reap_finished();
        std::thread::sleep(Duration::from_millis(5));
    }

    assert_eq!(registry.live(), 0, "every exited child was reaped");
    assert_eq!(registry.reaped(), FAN_OUT);
    let defunct = pids
        .iter()
        .copied()
        .filter(|pid| is_defunct(*pid))
        .collect::<Vec<_>>();
    assert!(
        defunct.is_empty(),
        "these fan-out children are still defunct: {defunct:?}"
    );
}

#[cfg(unix)]
#[test]
fn child_registry_disposal_is_idempotent_and_refuses_late_adoption() {
    let directory = tempdir().unwrap();
    let workspace = directory.path();
    if !enforcement_available(workspace) {
        return;
    }

    let mut registry = ChildProcessRegistry::new();
    let long_lived = registry
        .spawn("sleeper", probe_spawn(workspace, "sleep 120"))
        .expect("the sandbox backend can create a child on this host");
    assert_eq!(registry.live(), 1);
    assert_eq!(registry.live_children()[0].pid, long_lived);

    assert_eq!(registry.dispose(), 1);
    assert_eq!(registry.dispose(), 0, "second disposal releases nothing");
    assert!(!is_defunct(long_lived), "the group leader was reaped");

    // A disposed registry must terminate rather than accept, so a late adoption
    // cannot be the reason a process outlives its owner.
    let orphan = probe_spawn(workspace, "sleep 120")
        .spawn()
        .expect("the sandbox backend can create a child on this host");
    let orphan_pid = orphan.id();
    assert!(matches!(
        registry.adopt("late", orphan),
        Err(crate::InstanceError::Disposed)
    ));
    assert!(!is_defunct(orphan_pid));
    assert_eq!(registry.live(), 0);
}

#[cfg(unix)]
#[test]
fn instance_disposal_releases_resources_then_children_in_order() {
    struct OrderProbe {
        log: Arc<Mutex<Vec<String>>>,
        children: Arc<Mutex<ChildProcessRegistry>>,
    }

    impl crate::InstanceResource for OrderProbe {
        fn kind(&self) -> ResourceKind {
            ResourceKind::Lsp
        }
        fn cancel(&mut self) -> Result<(), String> {
            self.log.lock().unwrap().push("cancel:plugin".into());
            Ok(())
        }
        fn flush(&mut self) -> Result<(), String> {
            self.log.lock().unwrap().push("flush:plugin".into());
            Ok(())
        }
        fn shutdown(&mut self) -> Result<(), String> {
            // The plugin can still reach its child process here, which is the
            // whole reason children are torn down after this phase.
            let live = self.children.lock().unwrap().live();
            self.log
                .lock()
                .unwrap()
                .push(format!("shutdown:plugin(children={live})"));
            Ok(())
        }
    }

    let directory = tempdir().unwrap();
    let workspace = directory.path();
    if !enforcement_available(workspace) {
        return;
    }

    let log = Arc::new(Mutex::new(Vec::new()));
    let mut instance = ProjectInstance::new(workspace.to_path_buf());
    let pid = instance
        .spawn_child("plugin-backend", probe_spawn(workspace, "sleep 120"))
        .expect("the sandbox backend can create a child on this host");

    // Registered after the child, so reverse order puts the cache first.
    let cache_log = Arc::clone(&log);
    let mut cache = BoundedResourceCache::new(2, move |key: &'static str, _: u8, cause| {
        cache_log
            .lock()
            .unwrap()
            .push(format!("evict:{key}:{cause:?}"));
    });
    cache.insert("provider-client", 1).unwrap();
    instance.register(cache).unwrap();
    instance
        .register(OrderProbe {
            log: Arc::clone(&log),
            children: instance.children(),
        })
        .unwrap();

    instance.dispose();

    assert_eq!(
        *log.lock().unwrap(),
        [
            "cancel:plugin",
            "flush:plugin",
            "shutdown:plugin(children=1)",
            "evict:provider-client:Disposed",
        ]
    );
    assert_eq!(instance.live_children(), 0);
    assert!(
        !is_defunct(pid),
        "the owned child was terminated and reaped"
    );
    assert!(instance.dispose().is_empty(), "disposal is idempotent");
}

// ---------------------------------------------------------------------------
// Force dispose
// ---------------------------------------------------------------------------

#[test]
fn force_dispose_releases_every_hook_even_when_one_panics() {
    let disposer = Arc::new(ForceDispose::new());
    let log = Arc::new(Mutex::new(Vec::new()));

    for name in ["cache", "plugins"] {
        let entry = Arc::clone(&log);
        disposer.register(name, move || {
            entry.lock().unwrap().push(name.to_string());
            Ok(())
        });
    }
    disposer.register("wedged", || panic!("component came apart during teardown"));
    let tail = Arc::clone(&log);
    disposer.register("children", move || {
        tail.lock().unwrap().push("children".into());
        Ok(())
    });

    let report = disposer.dispose(DisposalTrigger::Signal);

    // Reverse registration order, and the panic did not stop the rest.
    assert_eq!(report.released, ["children", "wedged", "plugins", "cache"]);
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.failures[0].name, "wedged");
    assert_eq!(report.failures[0].message, "force-dispose hook panicked");
    assert_eq!(*log.lock().unwrap(), ["children", "plugins", "cache"]);
    assert!(!report.reentrant);
}

#[test]
fn force_dispose_is_idempotent_and_reentrancy_does_not_deadlock() {
    let disposer = Arc::new(ForceDispose::new());
    let runs = Arc::new(AtomicUsize::new(0));

    let counter = Arc::clone(&runs);
    disposer.register("counted", move || {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });
    let nested = Arc::clone(&disposer);
    let reentrant = Arc::new(Mutex::new(None));
    let observed = Arc::clone(&reentrant);
    disposer.register("reentrant", move || {
        // A hook that triggers disposal again must be told so, not blocked on
        // a lock its own caller holds.
        *observed.lock().unwrap() = Some(nested.dispose(DisposalTrigger::Panic).reentrant);
        Ok(())
    });

    let first = disposer.dispose(DisposalTrigger::Manual);
    assert_eq!(first.released.len(), 2);
    assert!(reentrant.lock().unwrap().unwrap());

    let second = disposer.dispose(DisposalTrigger::Manual);
    assert!(second.released.is_empty());
    assert_eq!(second.already_disposed, 2);
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    // A hook registered after a pass still gets released on the next one.
    let later = Arc::clone(&runs);
    disposer.register("registered-later", move || {
        later.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });
    assert_eq!(
        disposer.dispose(DisposalTrigger::Manual).released,
        ["registered-later"]
    );
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[test]
fn a_guard_withdraws_its_hook_so_a_released_owner_stays_unreachable() {
    let disposer = Arc::new(ForceDispose::new());
    let ran = Arc::new(AtomicUsize::new(0));
    {
        let counter = Arc::clone(&ran);
        let _guard = register_guarded(&disposer, "scoped", move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        assert_eq!(disposer.registered(), 1);
    }
    assert_eq!(disposer.registered(), 0);
    assert!(
        disposer
            .dispose(DisposalTrigger::Signal)
            .released
            .is_empty()
    );
    assert_eq!(ran.load(Ordering::SeqCst), 0);
}

#[test]
fn an_instance_force_disposes_its_children_when_drop_is_bypassed() {
    let directory = tempdir().unwrap();
    let workspace = directory.path();
    let disposer = Arc::new(ForceDispose::new());
    let instance = ProjectInstance::new(workspace.to_path_buf());
    let token = instance.cancellation_token();
    let children = instance.children();
    let _guard = instance.register_force_dispose(&disposer);

    #[cfg(unix)]
    let pid = if enforcement_available(workspace) {
        Some(
            children
                .lock()
                .unwrap()
                .spawn("plugin-backend", probe_spawn(workspace, "sleep 120"))
                .expect("the sandbox backend can create a child on this host"),
        )
    } else {
        None
    };

    // `std::mem::forget` stands in for the exits Drop does not cover:
    // process::exit, abort, SIGKILL. The force-dispose path is the only thing
    // left that can release this instance's resources.
    std::mem::forget(instance);

    let report = disposer.dispose(DisposalTrigger::Signal);
    assert_eq!(report.released.len(), 1);
    assert!(report.failures.is_empty());
    assert!(token.is_cancelled());
    assert!(children.lock().unwrap().is_disposed());
    assert_eq!(children.lock().unwrap().live(), 0);
    #[cfg(unix)]
    if let Some(pid) = pid {
        assert!(!is_defunct(pid), "the child was terminated and reaped");
    }
}

#[test]
fn a_panic_triggers_the_process_force_dispose_backstop() {
    install_panic_force_dispose();
    let released = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&released);
    let _guard = register_guarded(&process_force_dispose(), "panic-probe", move || {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });

    let outcome = std::panic::catch_unwind(|| panic!("bootstrap component came apart"));
    assert!(outcome.is_err());
    assert!(
        released.load(Ordering::SeqCst) >= 1,
        "the panic hook must release what Drop will not reach"
    );
}
