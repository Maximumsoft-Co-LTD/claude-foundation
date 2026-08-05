//! Project/worktree-scoped lifecycle, concurrency, and invalidation primitives.

pub mod legacy;

use changeloop_config::{HotReloadPlan, ReloadImpact, ResolvedConfig};
use changeloop_language::RunningLanguageServer;
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{
    Arc, Mutex, MutexGuard,
    atomic::{AtomicBool, AtomicU8, Ordering},
};
use thiserror::Error;
use uuid::Uuid;

const MAX_LOCK_OWNER_BYTES: u64 = 64 * 1024;
const MAX_INSTANCE_RESOURCES: usize = 4_096;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ProjectInstanceId(pub String);

impl ProjectInstanceId {
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for ProjectInstanceId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Watcher,
    Lsp,
    Formatter,
    Pty,
    Job,
    ModelExecution,
    Mcp,
    Cache,
    Database,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ResourceState {
    Running = 0,
    Cancelled = 1,
    Flushed = 2,
    Shutdown = 3,
}

/// Observable handle for a project-owned process or task. The instance keeps
/// the authority to dispose it; consumers only observe cancellation/state.
#[derive(Clone, Debug)]
pub struct OwnedResourceHandle {
    id: Arc<str>,
    name: Arc<str>,
    kind: ResourceKind,
    state: Arc<AtomicU8>,
    cancellation: CancellationToken,
}

impl OwnedResourceHandle {
    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn kind(&self) -> ResourceKind {
        self.kind
    }

    #[must_use]
    pub fn state(&self) -> ResourceState {
        match self.state.load(Ordering::Acquire) {
            0 => ResourceState::Running,
            1 => ResourceState::Cancelled,
            2 => ResourceState::Flushed,
            _ => ResourceState::Shutdown,
        }
    }

    #[must_use]
    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }
}

struct OwnedResource {
    handle: OwnedResourceHandle,
    cancel_hook: Option<Box<dyn Fn() + Send + Sync>>,
}

impl InstanceResource for OwnedResource {
    fn id(&self) -> Option<&str> {
        Some(&self.handle.id)
    }

    fn kind(&self) -> ResourceKind {
        self.handle.kind
    }

    fn cancel(&mut self) -> Result<(), String> {
        self.handle.cancellation.cancel();
        if let Some(cancel) = self.cancel_hook.take() {
            cancel();
        }
        self.handle
            .state
            .store(ResourceState::Cancelled as u8, Ordering::Release);
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        self.handle
            .state
            .store(ResourceState::Flushed as u8, Ordering::Release);
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), String> {
        self.handle
            .state
            .store(ResourceState::Shutdown as u8, Ordering::Release);
        Ok(())
    }
}

pub trait InstanceResource: Send {
    fn id(&self) -> Option<&str> {
        None
    }
    fn kind(&self) -> ResourceKind;
    fn cancel(&mut self) -> Result<(), String>;
    fn flush(&mut self) -> Result<(), String>;
    fn shutdown(&mut self) -> Result<(), String>;
}

#[derive(Clone)]
pub struct ProjectLanguageServerHandle(Arc<Mutex<RunningLanguageServer>>);

impl ProjectLanguageServerHandle {
    pub fn lock(&self) -> Result<MutexGuard<'_, RunningLanguageServer>, String> {
        self.0
            .lock()
            .map_err(|_| "language server lock is poisoned".into())
    }
}

struct ProjectLanguageServerResource {
    server: Arc<Mutex<RunningLanguageServer>>,
}

impl InstanceResource for ProjectLanguageServerResource {
    fn kind(&self) -> ResourceKind {
        ResourceKind::Lsp
    }

    fn cancel(&mut self) -> Result<(), String> {
        self.server
            .lock()
            .map_err(|_| "language server lock is poisoned".to_string())?
            .cancel_pending()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn flush(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), String> {
        self.server
            .lock()
            .map_err(|_| "language server lock is poisoned".to_string())?
            .shutdown()
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisposalPhase {
    Cancel,
    Flush,
    Shutdown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisposalFailure {
    pub kind: ResourceKind,
    pub phase: DisposalPhase,
    pub message: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InstanceError {
    #[error("project instance is already disposed")]
    Disposed,
    #[error("project/worktree instance already exists: {0}")]
    Duplicate(PathBuf),
    #[error("project/worktree instance does not exist: {0}")]
    NotFound(PathBuf),
    #[error("project/worktree root is not a real directory: {0}")]
    InvalidRoot(PathBuf),
    #[error("project instance reached its bounded resource limit")]
    ResourceLimit,
}

pub struct ProjectInstance {
    pub id: ProjectInstanceId,
    root: PathBuf,
    cancellation: CancellationToken,
    resources: Vec<Box<dyn InstanceResource>>,
    disposed: bool,
}

impl ProjectInstance {
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self {
            id: ProjectInstanceId::new(),
            root,
            cancellation: CancellationToken::new(),
            resources: Vec::new(),
            disposed: false,
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub fn register(
        &mut self,
        resource: impl InstanceResource + 'static,
    ) -> Result<(), InstanceError> {
        self.ensure_active()?;
        self.ensure_resource_capacity()?;
        self.resources.push(Box::new(resource));
        Ok(())
    }

    /// Registers a cancellable project-owned job, LSP, MCP connection, model
    /// execution, or other lifecycle resource without exposing disposal power.
    pub fn register_owned(
        &mut self,
        kind: ResourceKind,
        name: impl Into<Arc<str>>,
    ) -> Result<OwnedResourceHandle, InstanceError> {
        self.ensure_active()?;
        self.ensure_resource_capacity()?;
        let handle = OwnedResourceHandle {
            id: Arc::from(Uuid::now_v7().to_string()),
            name: name.into(),
            kind,
            state: Arc::new(AtomicU8::new(ResourceState::Running as u8)),
            cancellation: CancellationToken::new(),
        };
        self.resources.push(Box::new(OwnedResource {
            handle: handle.clone(),
            cancel_hook: None,
        }));
        Ok(handle)
    }

    /// Registers a resource whose real runtime cancellation is owned by this
    /// instance. The hook is invoked exactly once during release/disposal and
    /// remains scoped to this project instance.
    pub fn register_owned_with_cancel<F>(
        &mut self,
        kind: ResourceKind,
        name: impl Into<Arc<str>>,
        cancel: F,
    ) -> Result<OwnedResourceHandle, InstanceError>
    where
        F: Fn() + Send + Sync + 'static,
    {
        self.ensure_active()?;
        self.ensure_resource_capacity()?;
        let handle = OwnedResourceHandle {
            id: Arc::from(Uuid::now_v7().to_string()),
            name: name.into(),
            kind,
            state: Arc::new(AtomicU8::new(ResourceState::Running as u8)),
            cancellation: CancellationToken::new(),
        };
        self.resources.push(Box::new(OwnedResource {
            handle: handle.clone(),
            cancel_hook: Some(Box::new(cancel)),
        }));
        Ok(handle)
    }

    /// Completes and removes one owned resource without waiting for project
    /// disposal. All lifecycle phases still run deterministically.
    pub fn release_owned(
        &mut self,
        handle: &OwnedResourceHandle,
    ) -> Result<Vec<DisposalFailure>, InstanceError> {
        self.ensure_active()?;
        let Some(index) = self
            .resources
            .iter()
            .position(|resource| resource.id() == Some(handle.id()))
        else {
            return Ok(Vec::new());
        };
        let mut resource = self.resources.remove(index);
        let mut failures = Vec::new();
        collect_failure(resource.as_mut(), DisposalPhase::Cancel, &mut failures);
        collect_failure(resource.as_mut(), DisposalPhase::Flush, &mut failures);
        collect_failure(resource.as_mut(), DisposalPhase::Shutdown, &mut failures);
        Ok(failures)
    }

    /// Transfers a running language server into this project instance. The
    /// returned handle permits requests, while only the instance owns disposal.
    pub fn register_language_server(
        &mut self,
        server: RunningLanguageServer,
    ) -> Result<ProjectLanguageServerHandle, InstanceError> {
        self.ensure_active()?;
        self.ensure_resource_capacity()?;
        let server = Arc::new(Mutex::new(server));
        self.resources.push(Box::new(ProjectLanguageServerResource {
            server: Arc::clone(&server),
        }));
        Ok(ProjectLanguageServerHandle(server))
    }

    #[must_use]
    pub fn resource_count(&self) -> usize {
        self.resources.len()
    }

    pub fn ensure_active(&self) -> Result<(), InstanceError> {
        if self.disposed {
            Err(InstanceError::Disposed)
        } else {
            Ok(())
        }
    }

    fn ensure_resource_capacity(&self) -> Result<(), InstanceError> {
        if self.resources.len() >= MAX_INSTANCE_RESOURCES {
            Err(InstanceError::ResourceLimit)
        } else {
            Ok(())
        }
    }

    /// Cancels, flushes, then shuts down resources in reverse registration order.
    /// Every phase runs even if an earlier resource fails.
    pub fn dispose(&mut self) -> Vec<DisposalFailure> {
        if self.disposed {
            return Vec::new();
        }
        self.disposed = true;
        self.cancellation.cancel();
        let mut failures = Vec::new();
        for resource in self.resources.iter_mut().rev() {
            collect_failure(resource.as_mut(), DisposalPhase::Cancel, &mut failures);
        }
        for resource in self.resources.iter_mut().rev() {
            collect_failure(resource.as_mut(), DisposalPhase::Flush, &mut failures);
        }
        for resource in self.resources.iter_mut().rev() {
            collect_failure(resource.as_mut(), DisposalPhase::Shutdown, &mut failures);
        }
        self.resources.clear();
        failures
    }
}

fn collect_failure(
    resource: &mut dyn InstanceResource,
    phase: DisposalPhase,
    failures: &mut Vec<DisposalFailure>,
) {
    let kind = resource.kind();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match phase {
        DisposalPhase::Cancel => resource.cancel(),
        DisposalPhase::Flush => resource.flush(),
        DisposalPhase::Shutdown => resource.shutdown(),
    }))
    .unwrap_or_else(|_| Err("resource lifecycle hook panicked".into()));
    if let Err(message) = result {
        failures.push(DisposalFailure {
            kind,
            phase,
            message,
        });
    }
}

impl Drop for ProjectInstance {
    fn drop(&mut self) {
        self.dispose();
    }
}

#[derive(Default)]
pub struct ProjectInstanceRegistry {
    instances: BTreeMap<PathBuf, ProjectInstance>,
}

impl ProjectInstanceRegistry {
    pub fn create(&mut self, root: PathBuf) -> Result<&mut ProjectInstance, InstanceError> {
        let key = fs::canonicalize(&root).map_err(|_| InstanceError::InvalidRoot(root.clone()))?;
        let metadata =
            fs::symlink_metadata(&key).map_err(|_| InstanceError::InvalidRoot(root.clone()))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err(InstanceError::InvalidRoot(root));
        }
        match self.instances.entry(key.clone()) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                Ok(entry.insert(ProjectInstance::new(key)))
            }
            std::collections::btree_map::Entry::Occupied(_) => Err(InstanceError::Duplicate(key)),
        }
    }

    pub fn get_mut(&mut self, root: &Path) -> Result<&mut ProjectInstance, InstanceError> {
        let key = normalized_absolute(root);
        self.instances
            .get_mut(&key)
            .ok_or(InstanceError::NotFound(key))
    }

    pub fn dispose(&mut self, root: &Path) -> Result<Vec<DisposalFailure>, InstanceError> {
        let key = normalized_absolute(root);
        let mut instance = self
            .instances
            .remove(&key)
            .ok_or(InstanceError::NotFound(key))?;
        Ok(instance.dispose())
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.instances.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.instances.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HotReloadDecision {
    Applied { plan: HotReloadPlan },
    Rejected { plan: HotReloadPlan, reason: String },
}

/// Holds the effective config for one project. Changes that require project or
/// server restart are rejected atomically, so a failed reload cannot partially
/// alter the running instance.
pub struct ProjectConfigState {
    current: ResolvedConfig,
}

impl ProjectConfigState {
    #[must_use]
    pub fn new(current: ResolvedConfig) -> Self {
        Self { current }
    }

    #[must_use]
    pub fn current(&self) -> &ResolvedConfig {
        &self.current
    }

    pub fn apply(&mut self, candidate: ResolvedConfig) -> HotReloadDecision {
        let plan = HotReloadPlan::between(&self.current, &candidate);
        if matches!(
            plan.highest_impact,
            Some(ReloadImpact::RestartProject | ReloadImpact::RestartServer)
        ) {
            return HotReloadDecision::Rejected {
                plan,
                reason: "configuration change requires a controlled restart".to_owned(),
            };
        }
        self.current = candidate;
        HotReloadDecision::Applied { plan }
    }
}

#[derive(Debug, Error)]
pub enum WatchError {
    #[error("watch root does not exist or is not a directory: {0}")]
    InvalidRoot(PathBuf),
    #[error("cannot scan watched path {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

pub trait ProjectWatcher: Send {
    fn poll(&mut self) -> Result<Vec<WatchEvent>, WatchError>;
}

/// Portable production watcher that requires no downloaded helper process.
/// It never follows symlinked directories and reports paths relative to root.
pub struct PollingWatcher {
    root: PathBuf,
    known: BTreeMap<PathBuf, FileFingerprint>,
    #[cfg(unix)]
    root_identity: (u64, u64),
}

impl PollingWatcher {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, WatchError> {
        let root = normalized_absolute(root.as_ref());
        if !root.is_dir() {
            return Err(WatchError::InvalidRoot(root));
        }
        let metadata = fs::symlink_metadata(&root).map_err(|source| WatchError::Io {
            path: root.clone(),
            source,
        })?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err(WatchError::InvalidRoot(root));
        }
        #[cfg(unix)]
        let root_identity = {
            use std::os::unix::fs::MetadataExt;
            (metadata.dev(), metadata.ino())
        };
        let known = scan_tree(&root)?;
        Ok(Self {
            root,
            known,
            #[cfg(unix)]
            root_identity,
        })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
}

impl ProjectWatcher for PollingWatcher {
    fn poll(&mut self) -> Result<Vec<WatchEvent>, WatchError> {
        let metadata = fs::symlink_metadata(&self.root).map_err(|source| WatchError::Io {
            path: self.root.clone(),
            source,
        })?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err(WatchError::InvalidRoot(self.root.clone()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if (metadata.dev(), metadata.ino()) != self.root_identity {
                return Err(WatchError::InvalidRoot(self.root.clone()));
            }
        }
        let current = scan_tree(&self.root)?;
        let mut deleted = self
            .known
            .iter()
            .filter(|(path, _)| !current.contains_key(*path))
            .map(|(path, fingerprint)| (path.clone(), fingerprint.clone()))
            .collect::<Vec<_>>();
        let mut created = current
            .iter()
            .filter(|(path, _)| !self.known.contains_key(*path))
            .map(|(path, fingerprint)| (path.clone(), fingerprint.clone()))
            .collect::<Vec<_>>();
        let mut events = self
            .known
            .iter()
            .filter_map(|(path, before)| {
                current
                    .get(path)
                    .filter(|after| *after != before)
                    .map(|_| WatchEvent {
                        path: path.clone(),
                        kind: WatchEventKind::Modify,
                    })
            })
            .collect::<Vec<_>>();

        // Pair unambiguous identical fingerprints as renames. Ambiguous copies
        // remain delete/create events, which is conservative for invalidation.
        let mut consumed_created = BTreeSet::new();
        for (old_path, old_fingerprint) in &deleted {
            let matches = created
                .iter()
                .enumerate()
                .filter(|(index, (_, value))| {
                    !consumed_created.contains(index) && value == old_fingerprint
                })
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            if matches.len() == 1 {
                let index = matches[0];
                consumed_created.insert(index);
                events.push(WatchEvent {
                    path: created[index].0.clone(),
                    kind: WatchEventKind::Rename {
                        from: old_path.clone(),
                    },
                });
            }
        }
        deleted.retain(|(old_path, old_fingerprint)| {
            !events.iter().any(|event| {
                matches!(&event.kind, WatchEventKind::Rename { from } if from == old_path)
                    && current.get(&event.path) == Some(old_fingerprint)
            })
        });
        for (path, _) in deleted {
            events.push(WatchEvent {
                path: path.clone(),
                kind: WatchEventKind::Delete,
            });
        }
        for (index, (path, _)) in created.drain(..).enumerate() {
            if !consumed_created.contains(&index) {
                events.push(WatchEvent {
                    path,
                    kind: WatchEventKind::Create,
                });
            }
        }
        events.sort_by(|a, b| a.path.cmp(&b.path));
        self.known = current;
        Ok(events)
    }
}

pub trait InvalidationConsumer {
    fn invalidate(&mut self, target: InvalidationTarget, events: &[WatchEvent]);
}

#[derive(Default)]
pub struct InvalidationDispatcher {
    consumers: BTreeMap<InvalidationTarget, Vec<Box<dyn InvalidationConsumer + Send>>>,
}

impl InvalidationDispatcher {
    pub fn subscribe(
        &mut self,
        target: InvalidationTarget,
        consumer: impl InvalidationConsumer + Send + 'static,
    ) {
        self.consumers
            .entry(target)
            .or_default()
            .push(Box::new(consumer));
    }

    pub fn dispatch(&mut self, events: &[WatchEvent]) -> InvalidationSet {
        let invalidations = targeted_invalidation(events);
        for target in &invalidations.0 {
            if let Some(consumers) = self.consumers.get_mut(target) {
                for consumer in consumers {
                    consumer.invalidate(*target, events);
                }
            }
        }
        invalidations
    }
}

#[derive(Debug, Error)]
pub enum LockError {
    #[error("lock is already held: {path}; owner metadata: {owner}")]
    Held { path: PathBuf, owner: String },
    #[error("cannot access lock {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

pub struct LeaderLock {
    file: File,
    path: PathBuf,
}

impl LeaderLock {
    pub fn acquire(path: impl AsRef<Path>) -> Result<Self, LockError> {
        let path = path.as_ref().to_path_buf();
        open_exclusive_lock(&path, format!("pid={}", std::process::id()))
            .map(|file| Self { file, path })
    }

    pub fn acquire_with_endpoint(
        path: impl AsRef<Path>,
        endpoint: impl Into<String>,
    ) -> Result<Self, LockError> {
        let path = path.as_ref().to_path_buf();
        let metadata = LeaderMetadata {
            pid: std::process::id(),
            endpoint: Some(endpoint.into()),
        };
        let encoded = serde_json::to_string(&metadata).map_err(|error| LockError::Io {
            path: path.clone(),
            source: std::io::Error::other(error),
        })?;
        if encoded.len() as u64 > MAX_LOCK_OWNER_BYTES {
            return Err(LockError::Io {
                path: path.clone(),
                source: std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "leader endpoint metadata exceeds the safe limit",
                ),
            });
        }
        open_exclusive_lock(&path, encoded).map(|file| Self { file, path })
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderMetadata {
    pub pid: u32,
    pub endpoint: Option<String>,
}

pub enum LeaderDisposition {
    Leader(LeaderLock),
    Connect { metadata: LeaderMetadata },
}

/// Elects a local server leader. A contender only receives `Connect` when the
/// lock owner published a parseable endpoint; otherwise acquisition fails with
/// recovery metadata instead of guessing where to connect.
pub fn elect_leader(
    path: impl AsRef<Path>,
    endpoint: impl Into<String>,
) -> Result<LeaderDisposition, LockError> {
    let path = path.as_ref();
    match LeaderLock::acquire_with_endpoint(path, endpoint) {
        Ok(lock) => Ok(LeaderDisposition::Leader(lock)),
        Err(LockError::Held { path, owner }) => {
            match serde_json::from_str::<LeaderMetadata>(&owner) {
                Ok(metadata) if metadata.endpoint.is_some() => {
                    Ok(LeaderDisposition::Connect { metadata })
                }
                _ => Err(LockError::Held { path, owner }),
            }
        }
        Err(error) => Err(error),
    }
}

impl Drop for LeaderLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileFingerprint {
    Missing,
    Directory,
    File { sha256: String, byte_length: u64 },
    Symlink { target: PathBuf },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceRevision {
    /// Usually the Git HEAD/index identity; opaque to this crate.
    pub token: String,
    pub files: BTreeMap<PathBuf, FileFingerprint>,
}

#[derive(Debug, Error)]
pub enum RevisionError {
    #[error("revision path escapes the project root: {0}")]
    PathEscape(PathBuf),
    #[error("cannot fingerprint {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("revision path is not a regular file, directory, or symlink: {0}")]
    UnsupportedFileType(PathBuf),
}

impl WorkspaceRevision {
    pub fn capture(
        root: &Path,
        token: impl Into<String>,
        paths: impl IntoIterator<Item = PathBuf>,
    ) -> Result<Self, RevisionError> {
        let mut files = BTreeMap::new();
        for path in paths {
            let relative = normalize_relative(&path)?;
            files.insert(relative.clone(), fingerprint(&root.join(&relative))?);
        }
        Ok(Self {
            token: token.into(),
            files,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConflictClassification {
    RevisionChanged,
    ExternalEdit { changed_paths: Vec<PathBuf> },
    OverlappingExternalEdit { changed_paths: Vec<PathBuf> },
}

#[must_use]
pub fn classify_conflict(
    expected: &WorkspaceRevision,
    actual: &WorkspaceRevision,
    write_scope: &BTreeSet<PathBuf>,
) -> Option<ConflictClassification> {
    if expected.token != actual.token {
        return Some(ConflictClassification::RevisionChanged);
    }
    let changed_paths = expected
        .files
        .iter()
        .filter(|(path, value)| actual.files.get(*path) != Some(*value))
        .map(|(path, _)| path.clone())
        .collect::<Vec<_>>();
    if changed_paths.is_empty() {
        return None;
    }
    let overlaps = changed_paths.iter().any(|changed| {
        write_scope
            .iter()
            .any(|allowed| changed == allowed || changed.starts_with(allowed))
    });
    Some(if overlaps {
        ConflictClassification::OverlappingExternalEdit { changed_paths }
    } else {
        ConflictClassification::ExternalEdit { changed_paths }
    })
}

#[derive(Debug, Error)]
pub enum MutationError {
    #[error(transparent)]
    Lock(#[from] LockError),
    #[error("mutation lease expired and requires explicit renewal")]
    LeaseExpired,
    #[error("workspace changed since the lease was granted: {0:?}")]
    Conflict(ConflictClassification),
    #[error(transparent)]
    Revision(#[from] RevisionError),
    #[error("write path is outside the declared lease scope: {0}")]
    OutsideScope(PathBuf),
    #[error("write path was not fingerprinted when the lease was granted: {0}")]
    UntrackedWritePath(PathBuf),
    #[error("write path crosses a symlink and is unsafe: {0}")]
    SymlinkBoundary(PathBuf),
    #[error("write root does not match the worktree protected by this lease: {0}")]
    WorktreeMismatch(PathBuf),
    #[error("cannot write {path}: {source}")]
    WriteIo {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

/// Exclusive worktree lease. Expiry removes authority but retains the lock
/// until explicit drop; expiry never grants authority to another process.
pub struct MutationLease {
    id: String,
    file: File,
    path: PathBuf,
    worktree: PathBuf,
    expires_at_ms: u64,
    expected: WorkspaceRevision,
    write_scope: BTreeSet<PathBuf>,
}

#[derive(Clone, Default)]
pub struct ExecutionCoordinator {
    state: Arc<Mutex<ExecutionState>>,
}

#[derive(Default)]
struct ExecutionState {
    readers: usize,
    mutation: Option<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExecutionConflict {
    #[error("mutating execution is already active for change {change_id}")]
    MutationActive { change_id: String },
}

pub struct ExecutionPermit {
    state: Arc<Mutex<ExecutionState>>,
    kind: ExecutionPermitKind,
}

enum ExecutionPermitKind {
    Read,
    Mutation,
}

impl ExecutionCoordinator {
    #[must_use]
    pub fn begin_read(&self) -> ExecutionPermit {
        lock_execution_state(&self.state).readers += 1;
        ExecutionPermit {
            state: Arc::clone(&self.state),
            kind: ExecutionPermitKind::Read,
        }
    }

    pub fn begin_mutation(
        &self,
        change_id: impl Into<String>,
    ) -> Result<ExecutionPermit, ExecutionConflict> {
        let change_id = change_id.into();
        let mut state = lock_execution_state(&self.state);
        if let Some(active) = &state.mutation {
            return Err(ExecutionConflict::MutationActive {
                change_id: active.clone(),
            });
        }
        state.mutation = Some(change_id);
        drop(state);
        Ok(ExecutionPermit {
            state: Arc::clone(&self.state),
            kind: ExecutionPermitKind::Mutation,
        })
    }

    #[must_use]
    pub fn active_readers(&self) -> usize {
        lock_execution_state(&self.state).readers
    }

    #[must_use]
    pub fn active_mutation(&self) -> Option<String> {
        lock_execution_state(&self.state).mutation.clone()
    }
}

fn lock_execution_state(state: &Mutex<ExecutionState>) -> MutexGuard<'_, ExecutionState> {
    state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Drop for ExecutionPermit {
    fn drop(&mut self) {
        let mut state = lock_execution_state(&self.state);
        match self.kind {
            ExecutionPermitKind::Read => state.readers = state.readers.saturating_sub(1),
            ExecutionPermitKind::Mutation => state.mutation = None,
        }
    }
}

impl MutationLease {
    pub fn acquire(
        lock_directory: &Path,
        worktree: &Path,
        expires_at_ms: u64,
        expected: WorkspaceRevision,
        write_scope: impl IntoIterator<Item = PathBuf>,
    ) -> Result<Self, MutationError> {
        let id = Uuid::now_v7().to_string();
        let canonical_worktree =
            fs::canonicalize(worktree).map_err(|source| MutationError::WriteIo {
                path: worktree.to_path_buf(),
                source,
            })?;
        if !canonical_worktree.is_dir() {
            return Err(MutationError::WriteIo {
                path: canonical_worktree,
                source: std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "worktree is not a directory",
                ),
            });
        }
        let path = lock_directory.join(format!(
            "mutation-{}.lock",
            path_digest(&canonical_worktree)
        ));
        let file = open_exclusive_lock(&path, format!("lease={id}"))?;
        let write_scope = write_scope
            .into_iter()
            .map(|scope| {
                if scope == Path::new(".") {
                    Ok(PathBuf::new())
                } else {
                    normalize_relative(&scope)
                }
            })
            .collect::<Result<BTreeSet<_>, _>>()?;
        Ok(Self {
            id,
            file,
            path,
            worktree: canonical_worktree,
            expires_at_ms,
            expected,
            write_scope,
        })
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn authorize_write(
        &self,
        now_ms: u64,
        actual: &WorkspaceRevision,
    ) -> Result<(), MutationError> {
        if now_ms >= self.expires_at_ms {
            return Err(MutationError::LeaseExpired);
        }
        if let Some(conflict) = classify_conflict(&self.expected, actual, &self.write_scope) {
            return Err(MutationError::Conflict(conflict));
        }
        Ok(())
    }

    /// Refresh after a successful write attributed to this lease.
    pub fn record_attributed_write(&mut self, revision: WorkspaceRevision) {
        self.expected = revision;
    }

    /// Performs a write only after recapturing the expected revision. The
    /// caller supplies the current opaque Git/index token; file fingerprints
    /// are always recomputed by this method.
    pub fn write_checked(
        &mut self,
        root: &Path,
        now_ms: u64,
        actual_token: impl Into<String>,
        relative_path: impl AsRef<Path>,
        bytes: &[u8],
    ) -> Result<WorkspaceRevision, MutationError> {
        let canonical_root = fs::canonicalize(root).map_err(|source| MutationError::WriteIo {
            path: root.to_path_buf(),
            source,
        })?;
        if canonical_root != self.worktree {
            return Err(MutationError::WorktreeMismatch(canonical_root));
        }
        let relative_path = normalize_relative(relative_path.as_ref())?;
        if !self
            .write_scope
            .iter()
            .any(|scope| relative_path == *scope || relative_path.starts_with(scope))
        {
            return Err(MutationError::OutsideScope(relative_path));
        }
        if !self.expected.files.contains_key(&relative_path) {
            return Err(MutationError::UntrackedWritePath(relative_path));
        }
        ensure_no_symlink_boundary(&canonical_root, &relative_path)?;
        let tracked = self.expected.files.keys().cloned().collect::<Vec<_>>();
        let actual = WorkspaceRevision::capture(&canonical_root, actual_token, tracked.clone())?;
        self.authorize_write(now_ms, &actual)?;
        let expected_fingerprint = actual
            .files
            .get(&relative_path)
            .ok_or_else(|| MutationError::UntrackedWritePath(relative_path.clone()))?;
        write_without_symlink_race(&canonical_root, &relative_path, expected_fingerprint, bytes)?;
        let revision = WorkspaceRevision::capture(&self.worktree, actual.token, tracked)?;
        let written_fingerprint = FileFingerprint::File {
            sha256: format!("{:x}", Sha256::digest(bytes)),
            byte_length: bytes.len() as u64,
        };
        if revision.files.get(&relative_path) != Some(&written_fingerprint) {
            return Err(MutationError::Conflict(
                ConflictClassification::OverlappingExternalEdit {
                    changed_paths: vec![relative_path],
                },
            ));
        }
        self.record_attributed_write(revision.clone());
        Ok(revision)
    }

    /// Deletes one fingerprinted path under this lease. The expected
    /// workspace revision is revalidated immediately before the no-follow
    /// unlink, and authority is refreshed only after the path is confirmed
    /// missing.
    pub fn delete_checked(
        &mut self,
        root: &Path,
        now_ms: u64,
        actual_token: impl Into<String>,
        relative_path: impl AsRef<Path>,
    ) -> Result<WorkspaceRevision, MutationError> {
        let canonical_root = fs::canonicalize(root).map_err(|source| MutationError::WriteIo {
            path: root.to_path_buf(),
            source,
        })?;
        if canonical_root != self.worktree {
            return Err(MutationError::WorktreeMismatch(canonical_root));
        }
        let relative_path = normalize_relative(relative_path.as_ref())?;
        if !self
            .write_scope
            .iter()
            .any(|scope| relative_path == *scope || relative_path.starts_with(scope))
        {
            return Err(MutationError::OutsideScope(relative_path));
        }
        if !self.expected.files.contains_key(&relative_path) {
            return Err(MutationError::UntrackedWritePath(relative_path));
        }
        ensure_no_symlink_boundary(&canonical_root, &relative_path)?;
        let tracked = self.expected.files.keys().cloned().collect::<Vec<_>>();
        let actual = WorkspaceRevision::capture(&canonical_root, actual_token, tracked.clone())?;
        self.authorize_write(now_ms, &actual)?;
        let expected_fingerprint = actual
            .files
            .get(&relative_path)
            .ok_or_else(|| MutationError::UntrackedWritePath(relative_path.clone()))?;
        delete_without_symlink_race(&canonical_root, &relative_path, expected_fingerprint)?;
        let revision = WorkspaceRevision::capture(&self.worktree, actual.token, tracked)?;
        if revision.files.get(&relative_path) != Some(&FileFingerprint::Missing) {
            return Err(MutationError::Conflict(
                ConflictClassification::OverlappingExternalEdit {
                    changed_paths: vec![relative_path],
                },
            ));
        }
        self.record_attributed_write(revision.clone());
        Ok(revision)
    }
}

#[cfg(unix)]
fn delete_without_symlink_race(
    root: &Path,
    relative: &Path,
    expected: &FileFingerprint,
) -> Result<(), MutationError> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;

    if !matches!(expected, FileFingerprint::File { .. }) {
        return Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![relative.to_path_buf()],
            },
        ));
    }
    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value),
            _ => Err(MutationError::OutsideScope(relative.to_path_buf())),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (file_name, parents) = components
        .split_last()
        .ok_or_else(|| MutationError::OutsideScope(relative.to_path_buf()))?;
    let root_name =
        CString::new(root.as_os_str().as_bytes()).map_err(|_| MutationError::WriteIo {
            path: root.to_path_buf(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "root contains NUL"),
        })?;
    let root_descriptor = unsafe {
        libc::open(
            root_name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if root_descriptor < 0 {
        return Err(MutationError::WriteIo {
            path: root.to_path_buf(),
            source: std::io::Error::last_os_error(),
        });
    }
    let mut directory = unsafe { File::from_raw_fd(root_descriptor) };
    for component in parents {
        let name = CString::new(component.as_bytes()).map_err(|_| MutationError::WriteIo {
            path: relative.to_path_buf(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path component contains NUL",
            ),
        })?;
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(MutationError::SymlinkBoundary(relative.to_path_buf()));
        }
        directory = unsafe { File::from_raw_fd(descriptor) };
    }
    let name = CString::new(file_name.as_bytes()).map_err(|_| MutationError::WriteIo {
        path: relative.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "file name contains NUL"),
    })?;
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        return Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![relative.to_path_buf()],
            },
        ));
    }
    let mut file = unsafe { File::from_raw_fd(descriptor) };
    if &fingerprint_open_file(&mut file, relative)? != expected {
        return Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![relative.to_path_buf()],
            },
        ));
    }
    let opened = file.metadata().map_err(|source| MutationError::WriteIo {
        path: relative.to_path_buf(),
        source,
    })?;
    let mut path_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe {
        libc::fstatat(
            directory.as_raw_fd(),
            name.as_ptr(),
            path_stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } < 0
    {
        return Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![relative.to_path_buf()],
            },
        ));
    }
    let path_stat = unsafe { path_stat.assume_init() };
    if opened.dev() != path_stat.st_dev as u64
        || opened.ino() != path_stat.st_ino
        || path_stat.st_mode & libc::S_IFMT != libc::S_IFREG
    {
        return Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![relative.to_path_buf()],
            },
        ));
    }
    if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } < 0 {
        return Err(MutationError::WriteIo {
            path: relative.to_path_buf(),
            source: std::io::Error::last_os_error(),
        });
    }
    directory
        .sync_all()
        .map_err(|source| MutationError::WriteIo {
            path: relative.to_path_buf(),
            source,
        })
}

#[cfg(not(unix))]
fn delete_without_symlink_race(
    root: &Path,
    relative: &Path,
    expected: &FileFingerprint,
) -> Result<(), MutationError> {
    if &fingerprint(&root.join(relative))? != expected {
        return Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![relative.to_path_buf()],
            },
        ));
    }
    fs::remove_file(root.join(relative)).map_err(|source| MutationError::WriteIo {
        path: relative.to_path_buf(),
        source,
    })
}

#[cfg(unix)]
fn write_without_symlink_race(
    root: &Path,
    relative: &Path,
    expected: &FileFingerprint,
    bytes: &[u8],
) -> Result<(), MutationError> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value),
            _ => Err(MutationError::OutsideScope(relative.to_path_buf())),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (file_name, parents) = components
        .split_last()
        .ok_or_else(|| MutationError::OutsideScope(relative.to_path_buf()))?;
    let root_name =
        CString::new(root.as_os_str().as_bytes()).map_err(|_| MutationError::WriteIo {
            path: root.to_path_buf(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "root contains NUL"),
        })?;
    // SAFETY: root_name is NUL-terminated and canonical; O_NOFOLLOW pins the
    // exact worktree directory.
    let root_descriptor = unsafe {
        libc::open(
            root_name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if root_descriptor < 0 {
        return Err(MutationError::WriteIo {
            path: root.to_path_buf(),
            source: std::io::Error::last_os_error(),
        });
    }
    // SAFETY: descriptor is a newly-owned successful open result.
    let mut directory = unsafe { File::from_raw_fd(root_descriptor) };
    for component in parents {
        let name = CString::new(component.as_bytes()).map_err(|_| MutationError::WriteIo {
            path: relative.to_path_buf(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path component contains NUL",
            ),
        })?;
        // SAFETY: openat is anchored and rejects a symlink component.
        let mut descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
        {
            // SAFETY: mkdirat creates only this exact anchored component.
            if unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o755) } < 0
                && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
            {
                return Err(MutationError::WriteIo {
                    path: relative.to_path_buf(),
                    source: std::io::Error::last_os_error(),
                });
            }
            descriptor = unsafe {
                libc::openat(
                    directory.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
        }
        if descriptor < 0 {
            return Err(MutationError::SymlinkBoundary(relative.to_path_buf()));
        }
        // SAFETY: descriptor is a newly-owned successful openat result.
        directory = unsafe { File::from_raw_fd(descriptor) };
    }
    let name = CString::new(file_name.as_bytes()).map_err(|_| MutationError::WriteIo {
        path: relative.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "file name contains NUL"),
    })?;
    let flags = match expected {
        FileFingerprint::Missing => {
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC
        }
        FileFingerprint::File { .. } => libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        FileFingerprint::Symlink { .. } => {
            return Err(MutationError::SymlinkBoundary(relative.to_path_buf()));
        }
        FileFingerprint::Directory => {
            return Err(MutationError::WriteIo {
                path: relative.to_path_buf(),
                source: std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "write destination is a directory",
                ),
            });
        }
    };
    // SAFETY: openat is anchored to the pinned parent and refuses a final
    // symlink; O_EXCL preserves a previously missing-path expectation.
    let descriptor = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags, 0o644) };
    if descriptor < 0 {
        let source = std::io::Error::last_os_error();
        return if matches!(
            source.kind(),
            std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::NotFound
        ) {
            Err(MutationError::Conflict(
                ConflictClassification::OverlappingExternalEdit {
                    changed_paths: vec![relative.to_path_buf()],
                },
            ))
        } else {
            Err(MutationError::WriteIo {
                path: relative.to_path_buf(),
                source,
            })
        };
    }
    // SAFETY: descriptor is a newly-owned successful openat result.
    let mut file = unsafe { File::from_raw_fd(descriptor) };
    if matches!(expected, FileFingerprint::File { .. })
        && &fingerprint_open_file(&mut file, relative)? != expected
    {
        return Err(MutationError::Conflict(
            ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![relative.to_path_buf()],
            },
        ));
    }
    file.set_len(0).map_err(|source| MutationError::WriteIo {
        path: relative.to_path_buf(),
        source,
    })?;
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.write_all(bytes))
        .and_then(|_| file.sync_data())
        .map_err(|source| MutationError::WriteIo {
            path: relative.to_path_buf(),
            source,
        })
}

#[cfg(not(unix))]
fn write_without_symlink_race(
    root: &Path,
    relative: &Path,
    _: &FileFingerprint,
    bytes: &[u8],
) -> Result<(), MutationError> {
    let destination = root.join(relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|source| MutationError::WriteIo {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    fs::write(&destination, bytes).map_err(|source| MutationError::WriteIo {
        path: destination,
        source,
    })
}

fn fingerprint_open_file(file: &mut File, path: &Path) -> Result<FileFingerprint, MutationError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|source| MutationError::WriteIo {
            path: path.to_path_buf(),
            source,
        })?;
    let mut digest = Sha256::new();
    let mut byte_length = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|source| MutationError::WriteIo {
                path: path.to_path_buf(),
                source,
            })?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
        byte_length = byte_length.saturating_add(read as u64);
    }
    Ok(FileFingerprint::File {
        sha256: format!("{:x}", digest.finalize()),
        byte_length,
    })
}

impl Drop for MutationLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WatchEventKind {
    Create,
    Modify,
    Delete,
    Rename { from: PathBuf },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchEvent {
    pub path: PathBuf,
    pub kind: WatchEventKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum InvalidationTarget {
    EffectiveConfig,
    Instructions,
    GitState,
    LspDiagnostics,
    FormatterState,
    ToolCache,
    ProviderCache,
    McpConfiguration,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InvalidationSet(pub BTreeSet<InvalidationTarget>);

#[must_use]
pub fn targeted_invalidation(events: &[WatchEvent]) -> InvalidationSet {
    let mut targets = BTreeSet::new();
    for event in events {
        invalidate_path(&event.path, &mut targets);
        if let WatchEventKind::Rename { from } = &event.kind {
            invalidate_path(from, &mut targets);
        }
    }
    InvalidationSet(targets)
}

fn invalidate_path(path: &Path, targets: &mut BTreeSet<InvalidationTarget>) {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if matches!(path.to_str(), Some("changeloop.json" | "foundation.json")) {
        targets.insert(InvalidationTarget::EffectiveConfig);
        targets.insert(InvalidationTarget::ProviderCache);
    }
    if matches!(filename, "AGENTS.md" | "CLAUDE.md") {
        targets.insert(InvalidationTarget::Instructions);
    }
    if path.components().any(|part| part.as_os_str() == ".git") {
        targets.insert(InvalidationTarget::GitState);
    }
    if path == Path::new(".changeloop/mcp.json") {
        targets.insert(InvalidationTarget::McpConfiguration);
    }
    if matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java")
    ) {
        targets.extend([
            InvalidationTarget::LspDiagnostics,
            InvalidationTarget::FormatterState,
            InvalidationTarget::ToolCache,
        ]);
    }
    if matches!(
        filename,
        "Cargo.toml" | "Cargo.lock" | "package.json" | "package-lock.json"
    ) {
        targets.extend([
            InvalidationTarget::LspDiagnostics,
            InvalidationTarget::FormatterState,
            InvalidationTarget::ToolCache,
        ]);
    }
}

fn open_exclusive_lock(path: &Path, metadata: String) -> Result<File, LockError> {
    if metadata.len() as u64 > MAX_LOCK_OWNER_BYTES {
        return Err(LockError::Io {
            path: path.to_path_buf(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "lock owner metadata exceeds the safe limit",
            ),
        });
    }
    let mut file = open_lock_destination(path).map_err(|source| LockError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let file_metadata = file.metadata().map_err(|source| LockError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if !file_metadata.file_type().is_file() {
        return Err(LockError::Io {
            path: path.to_path_buf(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "lock destination is not a regular file",
            ),
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if file_metadata.uid() != unsafe { libc::geteuid() } || file_metadata.nlink() != 1 {
            return Err(LockError::Io {
                path: path.to_path_buf(),
                source: std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "lock owner or link count is unsafe",
                ),
            });
        }
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|source| LockError::Io {
                path: path.to_path_buf(),
                source,
            })?;
    }
    if let Err(source) = file.try_lock_exclusive() {
        let mut owner_bytes = Vec::new();
        let _ = std::io::Read::by_ref(&mut file)
            .take(MAX_LOCK_OWNER_BYTES.saturating_add(1))
            .read_to_end(&mut owner_bytes);
        let truncated = u64::try_from(owner_bytes.len()).unwrap_or(u64::MAX) > MAX_LOCK_OWNER_BYTES;
        owner_bytes.truncate(MAX_LOCK_OWNER_BYTES as usize);
        let mut owner = String::from_utf8_lossy(&owner_bytes).into_owned();
        if truncated {
            owner.push_str(" [truncated]");
        }
        if source.kind() == std::io::ErrorKind::WouldBlock {
            return Err(LockError::Held {
                path: path.to_path_buf(),
                owner,
            });
        }
        return Err(LockError::Io {
            path: path.to_path_buf(),
            source,
        });
    }
    file.set_len(0).map_err(|source| LockError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    file.seek(SeekFrom::Start(0))
        .map_err(|source| LockError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    file.write_all(metadata.as_bytes())
        .map_err(|source| LockError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    file.sync_data().map_err(|source| LockError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(file)
}

#[cfg(unix)]
fn open_lock_destination(path: &Path) -> Result<File, std::io::Error> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;

    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let before = fs::symlink_metadata(parent)?;
    if !before.file_type().is_dir() || before.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "lock parent must be a real directory",
        ));
    }
    let parent_name = CString::new(parent.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "lock parent contains NUL")
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "lock path has no file name",
        )
    })?;
    let file_name = CString::new(file_name.as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "lock name contains NUL")
    })?;
    // SAFETY: parent_name is NUL-terminated; O_NOFOLLOW rejects a
    // final-component replacement before the descriptor is pinned.
    let directory_descriptor = unsafe {
        libc::open(
            parent_name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if directory_descriptor < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: descriptor is a newly-owned successful open result.
    let directory = unsafe { File::from_raw_fd(directory_descriptor) };
    let opened = directory.metadata()?;
    if opened.dev() != before.dev()
        || opened.ino() != before.ino()
        || opened.uid() != unsafe { libc::geteuid() }
        || opened.mode() & 0o022 != 0
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "lock parent changed or has unsafe ownership/permissions",
        ));
    }
    // SAFETY: openat is anchored to the validated parent and refuses a final
    // symlink. The descriptor is transferred immediately into File.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            file_name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: descriptor is a newly-owned successful openat result.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(not(unix))]
fn open_lock_destination(path: &Path) -> Result<File, std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path)
}

fn fingerprint(path: &Path) -> Result<FileFingerprint, RevisionError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(FileFingerprint::Missing);
        }
        Err(source) => {
            return Err(RevisionError::Io {
                path: path.to_path_buf(),
                source,
            });
        }
    };
    if metadata.file_type().is_symlink() {
        return fs::read_link(path)
            .map(|target| FileFingerprint::Symlink { target })
            .map_err(|source| RevisionError::Io {
                path: path.to_path_buf(),
                source,
            });
    }
    if metadata.is_dir() {
        return Ok(FileFingerprint::Directory);
    }
    if !metadata.file_type().is_file() {
        return Err(RevisionError::UnsupportedFileType(path.to_path_buf()));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let mut file = options.open(path).map_err(|source| RevisionError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let opened_metadata = file.metadata().map_err(|source| RevisionError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if !opened_metadata.file_type().is_file()
            || opened_metadata.dev() != metadata.dev()
            || opened_metadata.ino() != metadata.ino()
        {
            return Err(RevisionError::Io {
                path: path.to_path_buf(),
                source: std::io::Error::other("file changed during fingerprint open"),
            });
        }
    }
    let mut digest = Sha256::new();
    let mut byte_length = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|source| RevisionError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
        byte_length = byte_length.saturating_add(read as u64);
    }
    Ok(FileFingerprint::File {
        sha256: format!("{:x}", digest.finalize()),
        byte_length,
    })
}

fn normalize_relative(path: &Path) -> Result<PathBuf, RevisionError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(RevisionError::PathEscape(path.to_path_buf()));
            }
        }
    }
    Ok(normalized)
}

fn normalized_absolute(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn path_digest(path: &Path) -> String {
    format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()))
}

fn scan_tree(root: &Path) -> Result<BTreeMap<PathBuf, FileFingerprint>, WatchError> {
    let mut result = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|source| WatchError::Io {
            path: directory.clone(),
            source,
        })?;
        for entry in entries {
            let entry = entry.map_err(|source| WatchError::Io {
                path: directory.clone(),
                source,
            })?;
            let absolute = entry.path();
            let relative = absolute
                .strip_prefix(root)
                .map_err(|_| WatchError::InvalidRoot(root.to_path_buf()))?
                .to_path_buf();
            let metadata = fs::symlink_metadata(&absolute).map_err(|source| WatchError::Io {
                path: absolute.clone(),
                source,
            })?;
            if should_record(&relative) {
                let value = fingerprint(&absolute).map_err(|error| match error {
                    RevisionError::Io { path, source } => WatchError::Io { path, source },
                    RevisionError::PathEscape(path) => WatchError::InvalidRoot(path),
                    RevisionError::UnsupportedFileType(path) => WatchError::Io {
                        path,
                        source: std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "watched entry has an unsupported file type",
                        ),
                    },
                })?;
                result.insert(relative.clone(), value);
            }
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && should_descend(root, &absolute, &relative)
            {
                pending.push(absolute);
            }
        }
    }
    Ok(result)
}

fn should_record(relative: &Path) -> bool {
    let mut components = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        });
    match (components.next(), components.next(), components.next()) {
        // Runtime databases, locks, checkpoints, and artifacts are outputs of
        // Changeloop itself. Only the declared MCP registry is configuration.
        (Some(".changeloop"), Some("mcp.json"), None) => true,
        (Some(".changeloop"), _, _) => false,
        _ => true,
    }
}

fn should_descend(root: &Path, absolute: &Path, relative: &Path) -> bool {
    let mut components = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        });
    let first = components.next().unwrap_or_default();
    if matches!(first, "target" | "node_modules") {
        return false;
    }
    // A nested repository/worktree owns its own watcher and lifecycle. The
    // parent records the mount directory but must not classify child edits as
    // external modifications of the parent instance.
    if absolute != root && absolute.join(".git").exists() {
        return false;
    }
    let second = components.next().unwrap_or_default();
    !matches!(
        (first, second),
        (".git", "objects" | "logs") | (".changeloop", "artifacts")
    )
}

fn ensure_no_symlink_boundary(root: &Path, relative: &Path) -> Result<(), MutationError> {
    let mut cursor = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            return Err(MutationError::OutsideScope(relative.to_path_buf()));
        };
        cursor.push(value);
        match fs::symlink_metadata(&cursor) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(MutationError::SymlinkBoundary(relative.to_path_buf()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(source) => {
                return Err(MutationError::WriteIo {
                    path: cursor,
                    source,
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
