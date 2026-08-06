//! Ownership-based disposal: bounded caches that notify, child processes that
//! are reaped, and a force-dispose path for the exits `Drop` does not cover.
//!
//! # The rule this module implements
//!
//! A watcher, cache, or subprocess registry may only invalidate or classify. It
//! must never author a write, and **never own a resource on another
//! component's behalf**. [`crate::InvalidationDispatcher`] is the first half of
//! that rule. This module is the second: ownership.
//!
//! Every resource here has exactly one owner. A [`BoundedResourceCache`] does
//! not own the things it caches — it tells the owner when an entry leaves, and
//! the owner releases it. A [`ChildProcessRegistry`] does own its children,
//! which is why it is the only place they can be adopted and the only place
//! they are terminated.
//!
//! # Why `Drop` is necessary and not sufficient
//!
//! Rust's ownership gives correct teardown ordering on the common path, and
//! [`crate::ProjectInstance`] leans on it. It does not run on
//! [`std::process::exit`], on abort, on `SIGKILL`, or when a value is
//! [`std::mem::forget`]-ed, and a global cache holding a reference is precisely
//! what prevents ownership from ending in the first place. So the happy path is
//! RAII and the backstop is [`ForceDispose`], which the bootstrap fires from a
//! signal handler and from the panic hook.
//!
//! The failure this is drawn from is single-source and should be read as one
//! incident rather than as three: a shipped competitor's issue tracker
//! documents 70GB+ memory usage traced to instance disposal that left plugins
//! and LRU caches alive, fixed by a retrofit rather than by the original
//! disposal design, plus 4,978 defunct child processes in one `ps` snapshot
//! under watcher-triggered process fan-out. Two distinct mechanisms — cache and
//! plugin disposal, and child reaping — from one project's own reports. The
//! design below is not fitted to that codebase's mistakes; it is fitted to the
//! two mechanisms, which are general.
//!
//! # The three-stage chain
//!
//! 1. A bounded cache evicts an entry and **notifies** its sink, so the owner
//!    disposes the resource the entry was holding. A size cap without an
//!    eviction callback leaves the same leak in a smaller form.
//! 2. [`crate::ProjectInstance::dispose`] releases registered resources in a
//!    defined phase and reverse-registration order, then terminates the child
//!    processes it owns.
//! 3. The bootstrap's [`ForceDispose`] releases whatever is still live when the
//!    process is signalled or panics.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex, MutexGuard, Once, OnceLock, PoisonError};

use changeloop_sandbox::{SandboxError, SandboxedChild, Spawn};
use thiserror::Error;

use crate::InstanceError;

#[cfg(test)]
mod tests;

/// Upper bound on child processes one registry will own at once.
///
/// The evidence for a bound is the 4,978-defunct-process snapshot: a fan-out
/// with no ceiling degrades into an unbounded reap backlog. Refusing loudly at
/// a ceiling is strictly better than accumulating silently below it.
pub const MAX_OWNED_CHILD_PROCESSES: usize = 4_096;

// ---------------------------------------------------------------------------
// Bounded cache with eviction callbacks
// ---------------------------------------------------------------------------

/// Why an entry left the cache. Every departure has exactly one cause, and
/// every cause reaches the sink.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvictionCause {
    /// The cache was at capacity and the least recently used entry was chosen.
    Capacity,
    /// A new value was inserted under an existing key.
    Replaced,
    /// The owner removed the entry explicitly.
    Removed,
    /// The cache itself was disposed, or an insert arrived after disposal.
    Disposed,
}

/// Where evicted entries go so the owner can release them.
///
/// This is the whole point of the type. A bounded map that silently drops an
/// entry holding a live resource — a plugin instance, a provider client, a
/// child process handle — leaks it exactly as surely as an unbounded one, only
/// less visibly. Eviction must notify; it must not merely forget.
pub trait EvictionSink<K, V>: Send {
    fn evicted(&mut self, key: K, value: V, cause: EvictionCause);
}

impl<K, V, F> EvictionSink<K, V> for F
where
    F: FnMut(K, V, EvictionCause) + Send,
{
    fn evicted(&mut self, key: K, value: V, cause: EvictionCause) {
        self(key, value, cause);
    }
}

/// A capacity-bounded, least-recently-used cache that never drops an entry
/// without telling its owner.
///
/// Recency is tracked by a monotonic tick so eviction order is deterministic
/// and testable rather than dependent on map iteration order.
pub struct BoundedResourceCache<K, V>
where
    K: Ord + Clone,
{
    capacity: usize,
    tick: u64,
    entries: BTreeMap<K, (u64, V)>,
    sink: Box<dyn EvictionSink<K, V>>,
    evicted: usize,
    disposed: bool,
}

impl<K, V> BoundedResourceCache<K, V>
where
    K: Ord + Clone,
{
    /// Creates a cache bounded at `capacity` entries. A capacity of zero is
    /// clamped to one, because a cache that can hold nothing would route every
    /// insert straight back to the sink and read as a silent failure.
    pub fn new(capacity: usize, sink: impl EvictionSink<K, V> + 'static) -> Self {
        Self {
            capacity: capacity.max(1),
            tick: 0,
            entries: BTreeMap::new(),
            sink: Box::new(sink),
            evicted: 0,
            disposed: false,
        }
    }

    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// How many entries have reached the sink over this cache's lifetime.
    #[must_use]
    pub fn evicted(&self) -> usize {
        self.evicted
    }

    #[must_use]
    pub fn is_disposed(&self) -> bool {
        self.disposed
    }

    #[must_use]
    pub fn contains_key(&self, key: &K) -> bool {
        self.entries.contains_key(key)
    }

    /// Inserts a value, releasing whatever had to leave to make room.
    ///
    /// Returns [`InstanceError::Disposed`] after disposal, and hands the
    /// rejected value to the sink rather than dropping it, so a late insert
    /// cannot leak the resource it carries.
    pub fn insert(&mut self, key: K, value: V) -> Result<(), InstanceError> {
        if self.disposed {
            self.release(key, value, EvictionCause::Disposed);
            return Err(InstanceError::Disposed);
        }
        self.tick = self.tick.saturating_add(1);
        if let Some((_, previous)) = self.entries.insert(key.clone(), (self.tick, value)) {
            self.release(key, previous, EvictionCause::Replaced);
        }
        while self.entries.len() > self.capacity {
            let Some(victim) = self.least_recently_used() else {
                break;
            };
            let Some((_, value)) = self.entries.remove(&victim) else {
                break;
            };
            self.release(victim, value, EvictionCause::Capacity);
        }
        Ok(())
    }

    /// Reads a value and refreshes its recency.
    pub fn get(&mut self, key: &K) -> Option<&V> {
        self.tick = self.tick.saturating_add(1);
        let tick = self.tick;
        let entry = self.entries.get_mut(key)?;
        entry.0 = tick;
        Some(&entry.1)
    }

    /// Reads a value without changing recency, for observation that must not
    /// perturb the eviction order it is observing.
    pub fn peek(&self, key: &K) -> Option<&V> {
        self.entries.get(key).map(|(_, value)| value)
    }

    /// Removes one entry, routing it through the sink.
    pub fn remove(&mut self, key: &K) -> bool {
        let Some((_, value)) = self.entries.remove(key) else {
            return false;
        };
        self.release(key.clone(), value, EvictionCause::Removed);
        true
    }

    /// Releases every remaining entry, oldest first, and marks the cache
    /// disposed. Idempotent: a second call releases nothing and returns zero.
    pub fn dispose(&mut self) -> usize {
        if self.disposed {
            return 0;
        }
        self.disposed = true;
        let mut ordered = std::mem::take(&mut self.entries)
            .into_iter()
            .map(|(key, (tick, value))| (tick, key, value))
            .collect::<Vec<_>>();
        ordered.sort_by_key(|(tick, _, _)| *tick);
        let released = ordered.len();
        for (_, key, value) in ordered {
            self.release(key, value, EvictionCause::Disposed);
        }
        released
    }

    fn release(&mut self, key: K, value: V, cause: EvictionCause) {
        self.evicted = self.evicted.saturating_add(1);
        self.sink.evicted(key, value, cause);
    }

    fn least_recently_used(&self) -> Option<K> {
        self.entries
            .iter()
            .min_by_key(|(_, (tick, _))| *tick)
            .map(|(key, _)| key.clone())
    }
}

impl<K, V> std::fmt::Debug for BoundedResourceCache<K, V>
where
    K: Ord + Clone,
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BoundedResourceCache")
            .field("capacity", &self.capacity)
            .field("len", &self.entries.len())
            .field("evicted", &self.evicted)
            .field("disposed", &self.disposed)
            .finish()
    }
}

impl<K, V> Drop for BoundedResourceCache<K, V>
where
    K: Ord + Clone,
{
    fn drop(&mut self) {
        self.dispose();
    }
}

impl<K, V> crate::InstanceResource for BoundedResourceCache<K, V>
where
    K: Ord + Clone + Send + 'static,
    V: Send + 'static,
{
    fn kind(&self) -> crate::ResourceKind {
        crate::ResourceKind::Cache
    }

    fn cancel(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        Ok(())
    }

    /// Draining happens in the shutdown phase, after flush, because an owner
    /// notified of an eviction may still need the flushed state of whatever it
    /// is about to release.
    fn shutdown(&mut self) -> Result<(), String> {
        self.dispose();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Child process ownership
// ---------------------------------------------------------------------------

/// Everything that can go wrong when a registry takes ownership of a child.
#[derive(Debug, Error)]
pub enum ChildSpawnError {
    #[error(transparent)]
    Sandbox(#[from] SandboxError),
    #[error(transparent)]
    Instance(#[from] InstanceError),
}

/// An adopted child, named so a disposal report can say what it released.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChildSummary {
    pub name: String,
    pub pid: u32,
}

struct OwnedChild {
    name: Arc<str>,
    pid: u32,
    child: SandboxedChild,
}

/// The single owner of a component's child processes.
///
/// Children are created through [`changeloop_sandbox::Spawn`], which already
/// places each one in a process group it owns; this registry adds the half that
/// crate deliberately leaves to the owner — remembering which children exist,
/// reaping the ones that have exited, and terminating the rest at teardown. It
/// does not introduce a second reaping scheme: reaping is
/// [`SandboxedChild::try_wait_owned_group`] and termination is
/// [`SandboxedChild::terminate`], both of which signal the owned process group
/// so descendants cannot outlive the child.
#[derive(Default)]
pub struct ChildProcessRegistry {
    children: Vec<OwnedChild>,
    reaped: usize,
    disposed: bool,
}

impl ChildProcessRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Takes ownership of an already-created child.
    ///
    /// After disposal the child is terminated immediately rather than accepted,
    /// because a registry that is shutting down must not become the reason a
    /// process survives it.
    pub fn adopt(
        &mut self,
        name: impl Into<Arc<str>>,
        mut child: SandboxedChild,
    ) -> Result<u32, InstanceError> {
        if self.disposed {
            child.terminate();
            return Err(InstanceError::Disposed);
        }
        if self.children.len() >= MAX_OWNED_CHILD_PROCESSES {
            child.terminate();
            return Err(InstanceError::ResourceLimit);
        }
        let pid = child.id();
        self.children.push(OwnedChild {
            name: name.into(),
            pid,
            child,
        });
        Ok(pid)
    }

    /// Creates a child through the sandbox spawn API and owns it from birth,
    /// so there is no window in which a live process has no owner.
    pub fn spawn(
        &mut self,
        name: impl Into<Arc<str>>,
        spawn: Spawn,
    ) -> Result<u32, ChildSpawnError> {
        if self.disposed {
            return Err(InstanceError::Disposed.into());
        }
        if self.children.len() >= MAX_OWNED_CHILD_PROCESSES {
            return Err(InstanceError::ResourceLimit.into());
        }
        let child = spawn.spawn()?;
        Ok(self.adopt(name, child)?)
    }

    #[must_use]
    pub fn live(&self) -> usize {
        self.children.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.children.is_empty()
    }

    /// How many children this registry has reaped or terminated.
    #[must_use]
    pub fn reaped(&self) -> usize {
        self.reaped
    }

    #[must_use]
    pub fn is_disposed(&self) -> bool {
        self.disposed
    }

    #[must_use]
    pub fn live_children(&self) -> Vec<ChildSummary> {
        self.children
            .iter()
            .map(|owned| ChildSummary {
                name: owned.name.to_string(),
                pid: owned.pid,
            })
            .collect()
    }

    /// Reaps every child that has already exited, returning how many were
    /// released.
    ///
    /// This is the answer to defunct-process accumulation. A runtime that only
    /// reaps at teardown holds a zombie for every exited child in between, and
    /// under watcher-triggered fan-out that backlog is what reaches five
    /// figures. Call it on the same cadence as the fan-out that produces the
    /// children.
    pub fn reap_finished(&mut self) -> usize {
        let mut reaped = 0;
        self.children.retain_mut(|owned| {
            match owned.child.try_wait_owned_group() {
                Ok(Some(_)) => {
                    reaped += 1;
                    false
                }
                Ok(None) => true,
                // The child is gone and no status is retrievable — there is
                // nothing left to own, and keeping the row would mean signalling
                // a PID this registry no longer holds.
                Err(_) => {
                    reaped += 1;
                    false
                }
            }
        });
        self.reaped = self.reaped.saturating_add(reaped);
        reaped
    }

    /// Terminates and reaps every remaining child in reverse adoption order.
    /// Idempotent: a second call releases nothing and returns zero.
    pub fn dispose(&mut self) -> usize {
        if self.disposed {
            return 0;
        }
        self.disposed = true;
        let mut released = 0;
        while let Some(mut owned) = self.children.pop() {
            owned.child.terminate();
            released += 1;
        }
        self.reaped = self.reaped.saturating_add(released);
        released
    }
}

impl std::fmt::Debug for ChildProcessRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ChildProcessRegistry")
            .field("live", &self.children.len())
            .field("reaped", &self.reaped)
            .field("disposed", &self.disposed)
            .finish()
    }
}

impl Drop for ChildProcessRegistry {
    fn drop(&mut self) {
        self.dispose();
    }
}

// ---------------------------------------------------------------------------
// Force dispose
// ---------------------------------------------------------------------------

/// What caused a force-dispose. Recorded because "we tore down because the
/// operator asked" and "we tore down because something panicked" are different
/// operational events even though the release path is identical.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisposalTrigger {
    Signal,
    Panic,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForceDisposeFailure {
    pub name: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForceDisposeReport {
    pub trigger: DisposalTrigger,
    /// Hooks that ran on this pass, in the order they ran.
    pub released: Vec<String>,
    /// Hooks skipped because a previous pass already ran them.
    pub already_disposed: usize,
    pub failures: Vec<ForceDisposeFailure>,
    /// A re-entrant call — a hook that triggered disposal again on this thread
    /// — returns without touching the registry.
    pub reentrant: bool,
}

/// Identifies one registered hook so it can be withdrawn again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ForceDisposeToken(u64);

type ForceHookFn = Box<dyn FnMut() -> Result<(), String> + Send>;

struct ForceHook {
    token: ForceDisposeToken,
    name: Arc<str>,
    ran: bool,
    hook: ForceHookFn,
}

#[derive(Default)]
struct ForceState {
    next_token: u64,
    hooks: Vec<ForceHook>,
}

/// The bootstrap backstop for the exits `Drop` does not cover.
///
/// Hooks run in reverse registration order — the same direction
/// [`crate::ProjectInstance`] disposes its resources — each inside
/// [`std::panic::catch_unwind`], so a component that panics while being
/// released cannot prevent the rest from being released. A hook runs at most
/// once; registering after a pass still gets a run on the next one.
#[derive(Default)]
pub struct ForceDispose {
    state: Mutex<ForceState>,
}

thread_local! {
    static FORCE_DISPOSE_IN_PROGRESS: Cell<bool> = const { Cell::new(false) };
}

struct ReentrancyGuard;

impl Drop for ReentrancyGuard {
    fn drop(&mut self) {
        FORCE_DISPOSE_IN_PROGRESS.with(|flag| flag.set(false));
    }
}

impl ForceDispose {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a release hook. Hooks must not register or dispose against
    /// this same instance; that is what [`ForceDisposeReport::reentrant`]
    /// reports rather than deadlocks on.
    pub fn register<F>(&self, name: impl Into<Arc<str>>, hook: F) -> ForceDisposeToken
    where
        F: FnMut() -> Result<(), String> + Send + 'static,
    {
        let mut state = self.lock();
        state.next_token = state.next_token.saturating_add(1);
        let token = ForceDisposeToken(state.next_token);
        state.hooks.push(ForceHook {
            token,
            name: name.into(),
            ran: false,
            hook: Box::new(hook),
        });
        token
    }

    /// Withdraws a hook whose owner released itself normally. Returns whether
    /// the hook was still registered.
    pub fn deregister(&self, token: ForceDisposeToken) -> bool {
        let mut state = self.lock();
        let before = state.hooks.len();
        state.hooks.retain(|hook| hook.token != token);
        state.hooks.len() != before
    }

    #[must_use]
    pub fn registered(&self) -> usize {
        self.lock().hooks.len()
    }

    /// Releases everything still registered.
    pub fn dispose(&self, trigger: DisposalTrigger) -> ForceDisposeReport {
        if FORCE_DISPOSE_IN_PROGRESS.with(|flag| flag.replace(true)) {
            return ForceDisposeReport {
                trigger,
                released: Vec::new(),
                already_disposed: 0,
                failures: Vec::new(),
                reentrant: true,
            };
        }
        let _guard = ReentrancyGuard;
        let mut report = ForceDisposeReport {
            trigger,
            released: Vec::new(),
            already_disposed: 0,
            failures: Vec::new(),
            reentrant: false,
        };
        let mut state = self.lock();
        for hook in state.hooks.iter_mut().rev() {
            if hook.ran {
                report.already_disposed += 1;
                continue;
            }
            // Marked before running: a hook that panics is spent, not retried.
            hook.ran = true;
            let name = hook.name.to_string();
            let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| (hook.hook)()))
                .unwrap_or_else(|_| Err("force-dispose hook panicked".into()));
            match outcome {
                Ok(()) => report.released.push(name),
                Err(message) => {
                    report.released.push(name.clone());
                    report.failures.push(ForceDisposeFailure { name, message });
                }
            }
        }
        report
    }

    fn lock(&self) -> MutexGuard<'_, ForceState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl std::fmt::Debug for ForceDispose {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ForceDispose")
            .field("registered", &self.lock().hooks.len())
            .finish()
    }
}

/// Withdraws its hook when the owner goes away normally, so a released
/// component does not stay reachable from the process-wide backstop. That
/// reachability is the leak shape the evidence describes.
pub struct ForceDisposeGuard {
    owner: Arc<ForceDispose>,
    token: ForceDisposeToken,
}

impl ForceDisposeGuard {
    #[must_use]
    pub fn token(&self) -> ForceDisposeToken {
        self.token
    }
}

impl std::fmt::Debug for ForceDisposeGuard {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ForceDisposeGuard")
            .field("token", &self.token)
            .finish()
    }
}

impl Drop for ForceDisposeGuard {
    fn drop(&mut self) {
        self.owner.deregister(self.token);
    }
}

/// Registers a hook and returns the guard that withdraws it again.
pub fn register_guarded<F>(
    owner: &Arc<ForceDispose>,
    name: impl Into<Arc<str>>,
    hook: F,
) -> ForceDisposeGuard
where
    F: FnMut() -> Result<(), String> + Send + 'static,
{
    let token = owner.register(name, hook);
    ForceDisposeGuard {
        owner: Arc::clone(owner),
        token,
    }
}

/// The process-wide backstop the bootstrap fires from a signal handler and from
/// the panic hook.
#[must_use]
pub fn process_force_dispose() -> Arc<ForceDispose> {
    static PROCESS: OnceLock<Arc<ForceDispose>> = OnceLock::new();
    Arc::clone(PROCESS.get_or_init(|| Arc::new(ForceDispose::new())))
}

/// Chains a panic-triggered force-dispose onto the existing panic hook.
///
/// Disposal runs *before* the previous hook, because the previous hook is where
/// an abort-on-panic policy takes effect and nothing runs after that. Installing
/// is process-global and irreversible, so it happens once, at the bootstrap.
pub fn install_panic_force_dispose() {
    static INSTALLED: Once = Once::new();
    INSTALLED.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let _ = process_force_dispose().dispose(DisposalTrigger::Panic);
            previous(info);
        }));
    });
}
