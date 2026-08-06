//! Bootstrap-level force dispose.
//!
//! [`changeloop_project::ProjectInstance`] releases what it owns through `Drop`
//! on the common path. This module covers the paths `Drop` does not reach: a
//! termination signal, and a panic that unwinds past the owner. Both funnel into
//! the one process-wide registry
//! ([`changeloop_project::disposal::process_force_dispose`]) so there is a
//! single answer to "what is still live", not one per exit route.
//!
//! A disposal path that only runs on the happy exit is the bug this exists to
//! avoid.

use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use changeloop_project::disposal::{
    DisposalTrigger, ForceDispose, ForceDisposeGuard, install_panic_force_dispose,
    process_force_dispose, register_guarded,
};

/// How often the watcher checks whether a termination signal arrived. Signal
/// handlers may only set a flag, so the release itself — which allocates, locks
/// and waits on child processes — has to happen on an ordinary thread.
const SIGNAL_POLL_INTERVAL: Duration = Duration::from_millis(5);

/// Releases everything still registered when the process is signalled.
///
/// Installed at the bootstrap and dropped when the bootstrap returns, which
/// unregisters the handlers and restores the default disposition. Panic-triggered
/// disposal is installed separately by
/// [`ForceDisposeSignalGuard::install_with_panic_hook`], because installing a
/// panic hook is process-global and irreversible.
pub struct ForceDisposeSignalGuard {
    #[cfg(unix)]
    requested: Arc<AtomicBool>,
    #[cfg(unix)]
    stopping: Arc<AtomicBool>,
    #[cfg(unix)]
    completed: Arc<AtomicUsize>,
    #[cfg(unix)]
    registrations: Vec<signal_hook::SigId>,
    #[cfg(unix)]
    watcher: Option<JoinHandle<()>>,
}

impl ForceDisposeSignalGuard {
    /// Registers signal-triggered force-dispose only.
    pub fn install() -> io::Result<Self> {
        #[cfg(unix)]
        {
            use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};

            let requested = Arc::new(AtomicBool::new(false));
            let stopping = Arc::new(AtomicBool::new(false));
            let completed = Arc::new(AtomicUsize::new(0));
            let mut registrations = Vec::with_capacity(3);
            for signal in [SIGHUP, SIGINT, SIGTERM] {
                match signal_hook::flag::register(signal, Arc::clone(&requested)) {
                    Ok(registration) => registrations.push(registration),
                    Err(error) => {
                        for registration in registrations.drain(..) {
                            signal_hook::low_level::unregister(registration);
                        }
                        return Err(error);
                    }
                }
            }

            let watch_requested = Arc::clone(&requested);
            let watch_stopping = Arc::clone(&stopping);
            let watch_completed = Arc::clone(&completed);
            let watcher = std::thread::Builder::new()
                .name("cloop-force-dispose".into())
                .spawn(move || {
                    while !watch_stopping.load(Ordering::Acquire) {
                        if watch_requested.swap(false, Ordering::AcqRel) {
                            let _ = process_force_dispose().dispose(DisposalTrigger::Signal);
                            watch_completed.fetch_add(1, Ordering::AcqRel);
                        }
                        std::thread::sleep(SIGNAL_POLL_INTERVAL);
                    }
                })?;

            Ok(Self {
                requested,
                stopping,
                completed,
                registrations,
                watcher: Some(watcher),
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self {})
        }
    }

    /// Registers signal-triggered force-dispose and chains panic-triggered
    /// force-dispose onto the existing panic hook.
    ///
    /// Kept separate from [`ForceDisposeSignalGuard::install`] because the panic
    /// hook cannot be uninstalled: this belongs at a real bootstrap, not
    /// anywhere a guard is created and dropped.
    pub fn install_with_panic_hook() -> io::Result<Self> {
        let guard = Self::install()?;
        install_panic_force_dispose();
        Ok(guard)
    }

    /// How many signal-triggered disposal passes have completed.
    #[must_use]
    pub fn dispose_passes(&self) -> usize {
        #[cfg(unix)]
        {
            self.completed.load(Ordering::Acquire)
        }
        #[cfg(not(unix))]
        {
            0
        }
    }

    /// Blocks until at least `passes` disposal passes have completed, or the
    /// timeout elapses. Returns whether the count was reached.
    pub fn wait_for_dispose(&self, passes: usize, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.dispose_passes() >= passes {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(SIGNAL_POLL_INTERVAL);
        }
    }
}

impl std::fmt::Debug for ForceDisposeSignalGuard {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ForceDisposeSignalGuard")
            .field("dispose_passes", &self.dispose_passes())
            .finish()
    }
}

impl Drop for ForceDisposeSignalGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            for registration in self.registrations.drain(..) {
                signal_hook::low_level::unregister(registration);
            }
            self.stopping.store(true, Ordering::Release);
            self.requested.store(false, Ordering::Release);
            if let Some(watcher) = self.watcher.take() {
                let _ = watcher.join();
            }
        }
    }
}

/// Process-wide signal and panic backstop for a bootstrap that never opens an
/// `AppService`, such as `cloop acp`.
pub struct ProcessBootstrapForceDispose {
    _signal_guard: ForceDisposeSignalGuard,
}

impl ProcessBootstrapForceDispose {
    /// Registers signal-triggered force-dispose and chains panic-triggered
    /// force-dispose onto the existing panic hook.
    pub fn install() -> io::Result<Self> {
        Ok(Self {
            _signal_guard: ForceDisposeSignalGuard::install_with_panic_hook()?,
        })
    }
}

/// Bootstrap that links a service-owned force-dispose registry to the
/// process-wide backstop for exits `Drop` does not reach.
pub struct BootstrapForceDispose {
    _signal_guard: ForceDisposeSignalGuard,
    _service_enrolment: ForceDisposeGuard,
}

impl BootstrapForceDispose {
    /// Installs the process backstop and enrols `service_disposer` with
    /// [`process_force_dispose`].
    pub fn install_with_service_disposer(
        service_disposer: Arc<ForceDispose>,
    ) -> io::Result<Self> {
        let signal_guard = ForceDisposeSignalGuard::install_with_panic_hook()?;
        let disposer = Arc::clone(&service_disposer);
        let service_enrolment = register_guarded(
            &process_force_dispose(),
            "app-service",
            move || {
                let report = disposer.dispose(DisposalTrigger::Signal);
                match report.failures.first() {
                    Some(failure) => Err(format!("{}: {}", failure.name, failure.message)),
                    None => Ok(()),
                }
            },
        );
        Ok(Self {
            _signal_guard: signal_guard,
            _service_enrolment: service_enrolment,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_project::ProjectInstance;
    use changeloop_project::disposal::process_force_dispose;
    use std::sync::atomic::AtomicUsize;

    /// Raising a signal is process-wide, so the two tests that do it take turns.
    /// Without this they would observe each other's disposal passes.
    static SIGNAL_TURN: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[cfg(unix)]
    fn wait_until(condition: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if condition() {
                return true;
            }
            std::thread::sleep(SIGNAL_POLL_INTERVAL);
        }
        condition()
    }

    #[cfg(unix)]
    #[test]
    fn sigterm_force_disposes_what_is_still_registered() {
        let _turn = SIGNAL_TURN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let released = Arc::new(AtomicUsize::new(0));
        let _guard = ForceDisposeSignalGuard::install().expect("signal handlers install");
        let counter = Arc::clone(&released);
        let _hook = changeloop_project::disposal::register_guarded(
            &process_force_dispose(),
            "sigterm-probe",
            move || {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        );

        // The handler replaces the default disposition, so this process is not
        // terminated; it is asked to release.
        assert_eq!(unsafe { libc::raise(libc::SIGTERM) }, 0);

        assert!(
            wait_until(|| released.load(Ordering::SeqCst) > 0),
            "a termination signal must run the disposal path, not only the happy exit"
        );
        assert_eq!(
            released.load(Ordering::SeqCst),
            1,
            "and run it exactly once"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_signalled_project_releases_its_children_without_drop() {
        let _turn = SIGNAL_TURN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = tempfile::tempdir().unwrap();
        let _guard = ForceDisposeSignalGuard::install().expect("signal handlers install");
        let instance = ProjectInstance::new(directory.path().to_path_buf());
        let token = instance.cancellation_token();
        let children = instance.children();
        let _hook = instance.register_force_dispose(&process_force_dispose());
        // Stands in for process::exit / abort / SIGKILL: Drop will not run.
        std::mem::forget(instance);

        assert_eq!(unsafe { libc::raise(libc::SIGTERM) }, 0);

        assert!(wait_until(|| children.lock().unwrap().is_disposed()));
        assert!(token.is_cancelled());
    }

    #[cfg(unix)]
    #[test]
    fn bootstrap_links_service_disposer_to_process_registry() {
        let _turn = SIGNAL_TURN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let service_disposer = Arc::new(ForceDispose::new());
        let released = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&released);
        let _project_hook = register_guarded(&service_disposer, "probe", move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        let _bootstrap = BootstrapForceDispose::install_with_service_disposer(service_disposer)
            .expect("service bootstrap installs");

        assert_eq!(unsafe { libc::raise(libc::SIGTERM) }, 0);

        assert!(
            wait_until(|| released.load(Ordering::SeqCst) > 0),
            "the process backstop must reach the service registry on SIGTERM"
        );
    }

    #[cfg(unix)]
    #[test]
    fn signalled_service_releases_children_without_drop() {
        let _turn = SIGNAL_TURN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = tempfile::tempdir().unwrap();
        let service_disposer = Arc::new(ForceDispose::new());
        let _bootstrap =
            BootstrapForceDispose::install_with_service_disposer(Arc::clone(&service_disposer))
                .expect("service bootstrap installs");
        let instance = ProjectInstance::new(directory.path().to_path_buf());
        let token = instance.cancellation_token();
        let children = instance.children();
        let _hook = instance.register_force_dispose(&service_disposer);
        std::mem::forget(instance);

        assert_eq!(unsafe { libc::raise(libc::SIGTERM) }, 0);

        assert!(wait_until(|| children.lock().unwrap().is_disposed()));
        assert!(token.is_cancelled());
    }

    #[test]
    fn process_bootstrap_installs_without_error() {
        let _bootstrap =
            ProcessBootstrapForceDispose::install().expect("process bootstrap installs");
    }
}
