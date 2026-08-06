//! One mutating execution per worktree, a restorable snapshot per step, and an
//! expected-revision check in front of every write.
//!
//! Three guarantees are enforced here, and each is enforced structurally rather
//! than by convention:
//!
//! 1. **One mutating execution per worktree.** [`WorktreeMutation`] is the only
//!    type in this crate that writes on an agent's behalf, and the only way to
//!    obtain one is [`WorktreeMutation::begin`], which first takes an exclusive
//!    OS lock keyed by the *canonical worktree path*. The lock directory is
//!    derived from the worktree, not supplied by the caller, so two executions
//!    cannot miss each other by disagreeing about where the lock lives. A second
//!    execution — in this process or any other — fails with
//!    [`StepError::WorktreeBusy`] instead of contending.
//! 2. **A restorable snapshot per step.** A write is only reachable while a step
//!    is open, and only for a path that step declared, so there is no
//!    unsnapshotted write path. The snapshot store is content-addressed and
//!    lives in its own state directory: it is a shadow of the project's content,
//!    never a commit in the user's repository. `begin` refuses a state directory
//!    inside the worktree's Git directory so the shadow can never become part of
//!    the history it exists to protect.
//! 3. **Expected-revision checks.** Every write revalidates the workspace
//!    revision it expected immediately before applying. A mismatch pauses the
//!    path and records a [`ConflictClassification`]; nothing is overwritten.
//!
//! ## Why the revision check is the second line of defence, not the first
//!
//! `changeloop_project::external_change` classifies watcher events against this
//! session's own writes, and it is content-keyed rather than timing-keyed for
//! good reason. But one case is beyond any watcher: if the agent writes A, the
//! user reverts, and the agent writes B inside a single debounce window, the
//! window observes only B. B matches the latest self-write fingerprint, so the
//! event is suppressed as an echo and the user's intervening revert leaves no
//! trace. No watcher can observe a state that never survived to a poll.
//!
//! The expected-revision check on the **second** write is what catches it. The
//! agent's expected revision after write A is A. Before write B lands, the
//! workspace is recaptured and found to hold the user's bytes, not A. That is a
//! mismatch, so B never applies: the path pauses with a classification and both
//! sides survive. See
//! `write_revert_write_inside_one_watcher_window_is_caught_by_the_revision_check`.
//!
//! ## Post-format consistency
//!
//! The watcher's fingerprints are taken over **post-format** bytes — the bytes
//! that actually landed, after every formatter ran. The expected-revision token
//! carried here is consistent with that: [`WorktreeMutation::write`] takes the
//! post-format bytes, and [`WorktreeMutation::write_with`] runs the caller's
//! own format-then-check write and adopts whatever it reports as having landed,
//! after confirming that is what is on disk. A formatter rewrite therefore never
//! reads back as an external edit of the agent's own file.
//!
//! ## Pausing is not gating
//!
//! A conflict retires the diverging paths and pauses them. Paths that did not
//! diverge keep writing: the conflicting write is retried once with the
//! diverging paths retired, so an unrelated user edit cannot stall the whole
//! execution. Resolution is never performed here — [`WorktreeMutation::paused`]
//! surfaces the state for the harness or a human, and
//! [`WorktreeMutation::resume`] clears one pause after they act.

use crate::{
    CheckpointId, PendingCheckpoint, RestoreOutcome, SnapshotError, SnapshotLimits,
    SnapshotManager, normalize_relative,
};
use changeloop_project::external_change::{
    ExternalChangeGuard, PathVerdict, ReconciliationOutcome, SelfWriteFingerprint,
};
use changeloop_project::{
    ConflictClassification, FileFingerprint, LockError, MutationError, MutationLease,
    RevisionError, WatchEvent, WorkspaceRevision,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use thiserror::Error;

/// Worktree-local state root, shared with `changeloop_project::external_change`.
const CHANGELOOP_DIRECTORY: &str = ".changeloop";
/// Lock directory, derived from the worktree so the lease key cannot be
/// side-stepped by pointing two executions at different lock roots.
const LOCK_DIRECTORY: &str = "locks";
const MANIFEST_NAME: &str = "state.json";
/// Upper bound on bytes read back to record a restore as a self-write. Above it
/// the restore is left unrecorded, which degrades the watcher to a conservative
/// external-edit pause — never to a silent overwrite.
const MAX_RECORDED_SELF_WRITE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_GIT_LINE_BYTES: usize = 256;

/// What one mutating execution is allowed to do, and to what.
#[derive(Clone, Debug)]
pub struct MutationRequest {
    /// Worktree the execution may mutate. Canonicalized on `begin`.
    pub worktree: PathBuf,
    /// Directory holding the content-addressed shadow store and its manifest.
    /// It must not live inside the worktree's Git directory.
    pub state_directory: PathBuf,
    /// Session issuing the writes; recorded in every self-write fingerprint.
    pub session_id: String,
    /// Wall-clock horizon after which the lease no longer grants authority.
    /// Expiry removes authority; it never hands authority to anyone else.
    pub expires_at_ms: u64,
    /// Project-relative prefixes the execution may write. `.` means the whole
    /// worktree.
    pub write_scope: Vec<PathBuf>,
    /// Paths fingerprinted up front. Every path a step declares is tracked
    /// automatically, so this is only needed to widen the initial revision.
    pub tracked_paths: Vec<PathBuf>,
    /// Opaque workspace revision token. `None` derives it from Git `HEAD`, so a
    /// checkout, commit or rebase reads as a revision move. Pin it to a constant
    /// to discriminate purely on content.
    pub revision_token: Option<String>,
    pub limits: SnapshotLimits,
}

impl MutationRequest {
    #[must_use]
    pub fn new(
        worktree: impl Into<PathBuf>,
        state_directory: impl Into<PathBuf>,
        session_id: impl Into<String>,
        expires_at_ms: u64,
    ) -> Self {
        Self {
            worktree: worktree.into(),
            state_directory: state_directory.into(),
            session_id: session_id.into(),
            expires_at_ms,
            write_scope: vec![PathBuf::from(".")],
            tracked_paths: Vec::new(),
            revision_token: None,
            limits: SnapshotLimits::default(),
        }
    }

    #[must_use]
    pub fn with_write_scope(mut self, scope: impl IntoIterator<Item = PathBuf>) -> Self {
        self.write_scope = scope.into_iter().collect();
        self
    }

    #[must_use]
    pub fn with_tracked_paths(mut self, paths: impl IntoIterator<Item = PathBuf>) -> Self {
        self.tracked_paths = paths.into_iter().collect();
        self
    }

    #[must_use]
    pub fn with_revision_token(mut self, token: impl Into<String>) -> Self {
        self.revision_token = Some(token.into());
        self
    }

    #[must_use]
    pub const fn with_limits(mut self, limits: SnapshotLimits) -> Self {
        self.limits = limits;
        self
    }
}

#[derive(Debug, Error)]
pub enum StepError {
    #[error(
        "another mutating execution already owns this worktree: {path}; owner metadata: {owner}"
    )]
    WorktreeBusy { path: PathBuf, owner: String },
    #[error("the snapshot shadow store must not live inside the worktree's git directory: {0}")]
    StateInsideGitDirectory(PathBuf),
    #[error("no step is open; a write is only reachable inside a step that snapshots it")]
    NoOpenStep,
    #[error("a step is already open: {0:?}")]
    StepAlreadyOpen(CheckpointId),
    #[error("path {0} was not declared by the open step, so writing it would not be snapshotted")]
    UndeclaredStepPath(PathBuf),
    #[error("cannot access {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    Snapshot(#[from] SnapshotError),
    #[error(transparent)]
    Mutation(#[from] MutationError),
    #[error(transparent)]
    Revision(#[from] RevisionError),
}

/// A write that cleared its expected-revision check and landed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppliedWrite {
    pub path: PathBuf,
    /// Workspace revision token in force after the write.
    pub revision_token: String,
    /// Post-format state now on disk.
    pub written: FileFingerprint,
    /// State the write replaced, mirroring
    /// [`SelfWriteFingerprint::overwrote`].
    pub overwrote: FileFingerprint,
}

/// A write that did not happen because the workspace was not where the agent
/// left it. Both sides survive: nothing on disk was touched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PausedWrite {
    pub path: PathBuf,
    pub classification: ConflictClassification,
    /// Revision the agent expected to find.
    pub expected: FileFingerprint,
    /// Revision actually on disk when the write was checked.
    pub observed: FileFingerprint,
    /// This session's last recorded write to the path, when there was one.
    pub agent: Option<SelfWriteFingerprint>,
    /// Watcher verdict for the same path, when the watcher also saw it. It is
    /// absent exactly in the case this check exists for: a write, a revert and
    /// a second write collapsing into one debounce window.
    pub watcher: Option<PathVerdict>,
    pub paused_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    Applied(AppliedWrite),
    /// Boxed: a pause carries the whole evidence record, and a conflict is the
    /// rare branch. The common `Applied` outcome should not pay for it.
    Paused(Box<PausedWrite>),
}

impl WriteOutcome {
    #[must_use]
    pub const fn applied(&self) -> Option<&AppliedWrite> {
        match self {
            Self::Applied(write) => Some(write),
            Self::Paused(_) => None,
        }
    }

    #[must_use]
    pub fn paused(&self) -> Option<&PausedWrite> {
        match self {
            Self::Paused(write) => Some(write),
            Self::Applied(_) => None,
        }
    }

    fn pause(record: PausedWrite) -> Self {
        Self::Paused(Box::new(record))
    }
}

/// The one mutating execution a worktree may have.
///
/// Holding this value *is* the claim. It is neither `Clone` nor reconstructible
/// from parts, it owns the snapshot manager rather than sharing it, and it
/// releases the worktree lease on drop.
pub struct WorktreeMutation {
    worktree: PathBuf,
    manifest: PathBuf,
    is_git_worktree: bool,
    pinned_token: Option<String>,
    lease: MutationLease,
    snapshots: SnapshotManager,
    guard: ExternalChangeGuard,
    /// Authoritative expected revision. It is pushed into the lease before every
    /// check and refreshed from the lease after every applied write. Paused
    /// paths are retired from it and pinned in `paused` instead, so one
    /// conflicting path cannot stall writes to the rest.
    expected: WorkspaceRevision,
    pending: Option<PendingCheckpoint>,
    step_paths: BTreeSet<PathBuf>,
    paused: BTreeMap<PathBuf, PausedWrite>,
}

impl WorktreeMutation {
    /// Claims the worktree's single mutating execution.
    ///
    /// Fails with [`StepError::WorktreeBusy`] when another execution — in this
    /// process or another — already holds it.
    pub fn begin(request: MutationRequest) -> Result<Self, StepError> {
        let worktree = canonicalize(&request.worktree)?;
        create_directory(&request.state_directory)?;
        let state_directory = canonicalize(&request.state_directory)?;
        if state_directory.starts_with(worktree.join(".git")) {
            return Err(StepError::StateInsideGitDirectory(state_directory));
        }
        let lock_directory = worktree.join(CHANGELOOP_DIRECTORY).join(LOCK_DIRECTORY);
        create_directory(&lock_directory)?;

        let is_git_worktree =
            git_line(&worktree, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true");
        let token = request
            .revision_token
            .clone()
            .unwrap_or_else(|| head_token(&worktree, is_git_worktree));
        let tracked = request
            .tracked_paths
            .iter()
            .map(|path| normalize_relative(path))
            .collect::<Result<BTreeSet<_>, _>>()?;
        let expected = WorkspaceRevision::capture(&worktree, token, tracked)?;

        // The lease is taken before any state is created, so a refused execution
        // leaves no shadow store behind.
        let lease = MutationLease::acquire(
            &lock_directory,
            &worktree,
            request.expires_at_ms,
            expected.clone(),
            request.write_scope,
        )
        .map_err(worktree_busy)?;
        let manifest = state_directory.join(MANIFEST_NAME);
        let snapshots = if manifest.exists() {
            SnapshotManager::load_with_limits(
                &worktree,
                &state_directory,
                &manifest,
                request.limits,
            )?
        } else {
            SnapshotManager::new_with_limits(&worktree, &state_directory, request.limits)?
        };
        let guard = ExternalChangeGuard::new(&worktree, request.session_id);
        Ok(Self {
            worktree,
            manifest,
            is_git_worktree,
            pinned_token: request.revision_token,
            lease,
            snapshots,
            guard,
            expected,
            pending: None,
            step_paths: BTreeSet::new(),
            paused: BTreeMap::new(),
        })
    }

    #[must_use]
    pub fn worktree(&self) -> &Path {
        &self.worktree
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        self.guard.session_id()
    }

    #[must_use]
    pub fn lease_id(&self) -> &str {
        self.lease.id()
    }

    /// Expected workspace revision the next write will be checked against.
    #[must_use]
    pub const fn expected_revision(&self) -> &WorkspaceRevision {
        &self.expected
    }

    /// Read-only view of the shadow store. Restores go through
    /// [`Self::restore_step`] so the expected revision stays truthful.
    #[must_use]
    pub const fn snapshots(&self) -> &SnapshotManager {
        &self.snapshots
    }

    /// Paths paused by an expected-revision mismatch, with the evidence behind
    /// each classification. Resolution belongs to the harness or a human.
    #[must_use]
    pub const fn paused(&self) -> &BTreeMap<PathBuf, PausedWrite> {
        &self.paused
    }

    /// Classifies one debounce window of watcher events against this session's
    /// own writes. Never writes into the watched tree.
    pub fn observe(&mut self, events: &[WatchEvent]) -> ReconciliationOutcome {
        self.guard.observe(events)
    }

    /// Opens the step whose snapshot every write inside it will belong to.
    ///
    /// The declared paths are captured into the shadow store *and* added to the
    /// expected revision, which is why a write outside them is refused: it would
    /// be neither snapshotted nor revision-checked.
    pub fn begin_step(
        &mut self,
        paths: impl IntoIterator<Item = PathBuf>,
        started_at_ms: u64,
    ) -> Result<CheckpointId, StepError> {
        if let Some(pending) = &self.pending {
            return Err(StepError::StepAlreadyOpen(pending.id().clone()));
        }
        let paths = paths
            .into_iter()
            .map(|path| normalize_relative(&path))
            .collect::<Result<BTreeSet<_>, _>>()?;
        let pending = self
            .snapshots
            .begin_step(paths.iter().cloned(), started_at_ms)?;
        let id = pending.id().clone();
        self.track(paths.iter().cloned())?;
        self.pending = Some(pending);
        self.step_paths = paths;
        Ok(id)
    }

    /// Commits the open step and persists the manifest. A commit that cannot be
    /// made durable is rolled back rather than left as history the shadow store
    /// cannot reproduce.
    pub fn commit_step(
        &mut self,
        committed_at_ms: u64,
        proof_references: BTreeSet<String>,
    ) -> Result<CheckpointId, StepError> {
        let pending = self.pending.take().ok_or(StepError::NoOpenStep)?;
        self.step_paths.clear();
        let id = self
            .snapshots
            .commit_step(pending, committed_at_ms, proof_references)?;
        if let Err(error) = self.snapshots.save(&self.manifest) {
            self.snapshots.rollback_unpersisted(&id)?;
            return Err(error.into());
        }
        Ok(id)
    }

    /// Restores one committed step exactly, then re-baselines the expected
    /// revision and records the restored paths as this session's own writes so
    /// the watcher does not misread the harness's restore as a hand edit.
    ///
    /// The restore itself is expected-state checked by the shadow store: a path
    /// an external actor moved since the step aborts the restore rather than
    /// overwriting it.
    pub fn restore_step(
        &mut self,
        checkpoint_id: &CheckpointId,
        occurred_at_ms: u64,
    ) -> Result<RestoreOutcome, StepError> {
        if let Some(pending) = &self.pending {
            return Err(StepError::StepAlreadyOpen(pending.id().clone()));
        }
        let paths = self
            .snapshots
            .checkpoints()
            .iter()
            .find(|checkpoint| &checkpoint.id == checkpoint_id)
            .map(|checkpoint| {
                checkpoint
                    .files
                    .iter()
                    .map(|delta| delta.path.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let token = self.current_token();
        let worktree = self.worktree.clone();
        let before = WorkspaceRevision::capture(&worktree, token.clone(), paths.clone())?;
        let outcome =
            self.snapshots
                .undo_and_save(checkpoint_id, occurred_at_ms, &self.manifest)?;
        let after = WorkspaceRevision::capture(&worktree, token.clone(), paths)?;
        self.expected.token = token;
        for (path, state) in &after.files {
            self.expected.files.insert(path.clone(), state.clone());
            let overwrote = before
                .files
                .get(path)
                .cloned()
                .unwrap_or(FileFingerprint::Missing);
            self.record_restored(path, state, overwrote)?;
        }
        Ok(outcome)
    }

    /// Writes `post_format_bytes` after revalidating the expected revision.
    ///
    /// `post_format_bytes` must be the bytes that will remain on disk once every
    /// formatter has run. Use [`Self::write_with`] when formatting happens
    /// inside the caller's own write transaction.
    pub fn write(
        &mut self,
        relative_path: impl AsRef<Path>,
        post_format_bytes: &[u8],
        now_ms: u64,
    ) -> Result<WriteOutcome, StepError> {
        let path = self.prepare(relative_path.as_ref())?;
        if let Some(record) = self.blocked(&path, now_ms)? {
            return Ok(WriteOutcome::pause(record));
        }
        let token = self.current_token();
        let overwrote = self.fingerprint_of(&path);
        match self.attempt_write(&path, post_format_bytes, now_ms, &token)? {
            Ok(revision) => self
                .adopt_write(&path, post_format_bytes, overwrote, revision)
                .map(WriteOutcome::Applied),
            Err(classification) => {
                if let Some(record) = self.pause_conflict(&path, &classification, now_ms)? {
                    return Ok(WriteOutcome::pause(record));
                }
                // The divergence was on another path and is now retired. Retry
                // once so an unrelated user edit does not gate this write.
                match self.attempt_write(&path, post_format_bytes, now_ms, &token)? {
                    Ok(revision) => self
                        .adopt_write(&path, post_format_bytes, overwrote, revision)
                        .map(WriteOutcome::Applied),
                    Err(classification) => self
                        .force_pause(&path, &classification, now_ms)
                        .map(WriteOutcome::pause),
                }
            }
        }
    }

    /// Deletes a path after revalidating the expected revision. Absence is a
    /// revision like any other.
    pub fn delete(
        &mut self,
        relative_path: impl AsRef<Path>,
        now_ms: u64,
    ) -> Result<WriteOutcome, StepError> {
        let path = self.prepare(relative_path.as_ref())?;
        if let Some(record) = self.blocked(&path, now_ms)? {
            return Ok(WriteOutcome::pause(record));
        }
        let token = self.current_token();
        let overwrote = self.fingerprint_of(&path);
        match self.attempt_delete(&path, now_ms, &token)? {
            Ok(revision) => self
                .adopt_delete(&path, overwrote, revision)
                .map(WriteOutcome::Applied),
            Err(classification) => {
                if let Some(record) = self.pause_conflict(&path, &classification, now_ms)? {
                    return Ok(WriteOutcome::pause(record));
                }
                match self.attempt_delete(&path, now_ms, &token)? {
                    Ok(revision) => self
                        .adopt_delete(&path, overwrote, revision)
                        .map(WriteOutcome::Applied),
                    Err(classification) => self
                        .force_pause(&path, &classification, now_ms)
                        .map(WriteOutcome::pause),
                }
            }
        }
    }

    /// Runs the caller's own format-then-check write behind the same
    /// expected-revision gate.
    ///
    /// `apply` receives the canonical worktree root and the project-relative
    /// path, performs the write, and returns the **post-format** bytes it left
    /// on disk. Those bytes are confirmed against disk before the expected
    /// revision adopts them, so a formatter rewrite is absorbed rather than
    /// misread, and a concurrent overwrite during the write is caught.
    pub fn write_with<F>(
        &mut self,
        relative_path: impl AsRef<Path>,
        now_ms: u64,
        apply: F,
    ) -> Result<WriteOutcome, StepError>
    where
        F: FnOnce(&Path, &Path) -> std::io::Result<Vec<u8>>,
    {
        let path = self.prepare(relative_path.as_ref())?;
        if let Some(record) = self.blocked(&path, now_ms)? {
            return Ok(WriteOutcome::pause(record));
        }
        let token = self.current_token();
        let overwrote = self.fingerprint_of(&path);
        if let Err(classification) = self.authorize(now_ms, &token)? {
            if let Some(record) = self.pause_conflict(&path, &classification, now_ms)? {
                return Ok(WriteOutcome::pause(record));
            }
            if let Err(classification) = self.authorize(now_ms, &token)? {
                return self
                    .force_pause(&path, &classification, now_ms)
                    .map(WriteOutcome::pause);
            }
        }
        let worktree = self.worktree.clone();
        let post_format = apply(&worktree, &path).map_err(|source| StepError::Io {
            path: worktree.join(&path),
            source,
        })?;
        let tracked = self.expected.files.keys().cloned().collect::<Vec<_>>();
        let revision = WorkspaceRevision::capture(&worktree, token, tracked)?;
        let landed = FileFingerprint::File {
            sha256: sha256_hex(&post_format),
            byte_length: post_format.len() as u64,
        };
        if revision.files.get(&path) != Some(&landed) {
            let classification = ConflictClassification::OverlappingExternalEdit {
                changed_paths: vec![path.clone()],
            };
            return self
                .force_pause(&path, &classification, now_ms)
                .map(WriteOutcome::pause);
        }
        self.adopt_write(&path, &post_format, overwrote, revision)
            .map(WriteOutcome::Applied)
    }

    /// Clears one pause after the harness or a human resolved it, re-baselining
    /// that path and the revision token from disk. The mutation never resolves a
    /// pause itself.
    pub fn resume(
        &mut self,
        relative_path: impl AsRef<Path>,
    ) -> Result<Option<PausedWrite>, StepError> {
        let path = normalize_relative(relative_path.as_ref())?;
        let Some(record) = self.paused.remove(&path) else {
            return Ok(None);
        };
        self.guard.resume(&path);
        let token = self.current_token();
        let worktree = self.worktree.clone();
        let captured = WorkspaceRevision::capture(&worktree, token.clone(), [path])?;
        self.expected.token = token;
        self.expected.files.extend(captured.files);
        Ok(Some(record))
    }

    fn prepare(&self, relative_path: &Path) -> Result<PathBuf, StepError> {
        let path = normalize_relative(relative_path)?;
        if self.pending.is_none() {
            return Err(StepError::NoOpenStep);
        }
        if !self.step_paths.contains(&path) {
            return Err(StepError::UndeclaredStepPath(path));
        }
        Ok(path)
    }

    /// Adds paths to the expected revision without disturbing entries already
    /// there, so tracking can widen without silently adopting an external edit.
    fn track(&mut self, paths: impl IntoIterator<Item = PathBuf>) -> Result<(), StepError> {
        let additions = paths
            .into_iter()
            .filter(|path| {
                !self.expected.files.contains_key(path) && !self.paused.contains_key(path)
            })
            .collect::<Vec<_>>();
        if additions.is_empty() {
            return Ok(());
        }
        let worktree = self.worktree.clone();
        let captured =
            WorkspaceRevision::capture(&worktree, self.expected.token.clone(), additions)?;
        self.expected.files.extend(captured.files);
        Ok(())
    }

    fn attempt_write(
        &mut self,
        path: &Path,
        bytes: &[u8],
        now_ms: u64,
        token: &str,
    ) -> Result<Result<WorkspaceRevision, ConflictClassification>, StepError> {
        self.lease.record_attributed_write(self.expected.clone());
        let worktree = self.worktree.clone();
        match self
            .lease
            .write_checked(&worktree, now_ms, token.to_owned(), path, bytes)
        {
            Ok(revision) => Ok(Ok(revision)),
            Err(MutationError::Conflict(classification)) => Ok(Err(classification)),
            Err(other) => Err(other.into()),
        }
    }

    fn attempt_delete(
        &mut self,
        path: &Path,
        now_ms: u64,
        token: &str,
    ) -> Result<Result<WorkspaceRevision, ConflictClassification>, StepError> {
        self.lease.record_attributed_write(self.expected.clone());
        let worktree = self.worktree.clone();
        match self
            .lease
            .delete_checked(&worktree, now_ms, token.to_owned(), path)
        {
            Ok(revision) => Ok(Ok(revision)),
            Err(MutationError::Conflict(classification)) => Ok(Err(classification)),
            Err(other) => Err(other.into()),
        }
    }

    fn authorize(
        &mut self,
        now_ms: u64,
        token: &str,
    ) -> Result<Result<(), ConflictClassification>, StepError> {
        self.lease.record_attributed_write(self.expected.clone());
        let worktree = self.worktree.clone();
        let tracked = self.expected.files.keys().cloned().collect::<Vec<_>>();
        let actual = WorkspaceRevision::capture(&worktree, token.to_owned(), tracked)?;
        match self.lease.authorize_write(now_ms, &actual) {
            Ok(()) => Ok(Ok(())),
            Err(MutationError::Conflict(classification)) => Ok(Err(classification)),
            Err(other) => Err(other.into()),
        }
    }

    fn adopt_write(
        &mut self,
        path: &Path,
        bytes: &[u8],
        overwrote: FileFingerprint,
        revision: WorkspaceRevision,
    ) -> Result<AppliedWrite, StepError> {
        self.expected = revision;
        let written = self.fingerprint_of(path);
        let git_oid = self.git_oid(path);
        self.guard
            .record_self_write(path, bytes, git_oid, overwrote.clone())?;
        Ok(AppliedWrite {
            path: path.to_path_buf(),
            revision_token: self.expected.token.clone(),
            written,
            overwrote,
        })
    }

    fn adopt_delete(
        &mut self,
        path: &Path,
        overwrote: FileFingerprint,
        revision: WorkspaceRevision,
    ) -> Result<AppliedWrite, StepError> {
        self.expected = revision;
        self.guard.record_self_delete(path, overwrote.clone())?;
        Ok(AppliedWrite {
            path: path.to_path_buf(),
            revision_token: self.expected.token.clone(),
            written: FileFingerprint::Missing,
            overwrote,
        })
    }

    fn record_restored(
        &mut self,
        path: &Path,
        state: &FileFingerprint,
        overwrote: FileFingerprint,
    ) -> Result<(), StepError> {
        match state {
            FileFingerprint::Missing => {
                self.guard.record_self_delete(path, overwrote)?;
            }
            FileFingerprint::File { byte_length, .. }
                if *byte_length <= MAX_RECORDED_SELF_WRITE_BYTES =>
            {
                let absolute = self.worktree.join(path);
                let bytes = fs::read(&absolute).map_err(|source| StepError::Io {
                    path: absolute,
                    source,
                })?;
                let git_oid = self.git_oid(path);
                self.guard
                    .record_self_write(path, &bytes, git_oid, overwrote)?;
            }
            // Oversized or non-regular restores stay unrecorded; the watcher
            // then pauses conservatively instead of suppressing.
            _ => {}
        }
        Ok(())
    }

    /// Reports a path already paused, either by this check or by the watcher.
    fn blocked(&mut self, path: &Path, now_ms: u64) -> Result<Option<PausedWrite>, StepError> {
        if let Some(record) = self.paused.get(path) {
            return Ok(Some(record.clone()));
        }
        if !self.guard.is_paused(path) {
            return Ok(None);
        }
        let verdict = self.guard.paused().get(path).cloned();
        let classification = ConflictClassification::OverlappingExternalEdit {
            changed_paths: vec![path.to_path_buf()],
        };
        let record = self.pin_pause(path, &classification, verdict, now_ms)?;
        Ok(Some(record))
    }

    /// Retires the diverging paths from the expected revision and pins them as
    /// paused. Returns the record for `target` when the target itself diverged.
    fn pause_conflict(
        &mut self,
        target: &Path,
        classification: &ConflictClassification,
        now_ms: u64,
    ) -> Result<Option<PausedWrite>, StepError> {
        if matches!(classification, ConflictClassification::RevisionChanged) {
            // A revision move is one workspace-level fact. Report it on the write
            // that discovered it, then re-baseline the token so a single commit
            // cannot cascade into a pause on every tracked path; content
            // divergence still pauses per path.
            self.expected.token = self.current_token();
        }
        let mut target_record = None;
        for path in conflicting_paths(target, classification) {
            let verdict = self.guard.paused().get(&path).cloned();
            let record = self.pin_pause(&path, classification, verdict, now_ms)?;
            if path == target {
                target_record = Some(record);
            }
        }
        Ok(target_record)
    }

    /// Pauses `target` even when the divergence was elsewhere: its write did not
    /// apply, so reporting it as applied would be a lie.
    fn force_pause(
        &mut self,
        target: &Path,
        classification: &ConflictClassification,
        now_ms: u64,
    ) -> Result<PausedWrite, StepError> {
        if let Some(record) = self.pause_conflict(target, classification, now_ms)? {
            return Ok(record);
        }
        let verdict = self.guard.paused().get(target).cloned();
        self.pin_pause(target, classification, verdict, now_ms)
    }

    fn pin_pause(
        &mut self,
        path: &Path,
        classification: &ConflictClassification,
        watcher: Option<PathVerdict>,
        now_ms: u64,
    ) -> Result<PausedWrite, StepError> {
        let worktree = self.worktree.clone();
        let observed = WorkspaceRevision::capture(
            &worktree,
            self.expected.token.clone(),
            [path.to_path_buf()],
        )?;
        let expected = self
            .expected
            .files
            .remove(path)
            .unwrap_or(FileFingerprint::Missing);
        let record = PausedWrite {
            path: path.to_path_buf(),
            classification: classification.clone(),
            expected,
            observed: observed
                .files
                .get(path)
                .cloned()
                .unwrap_or(FileFingerprint::Missing),
            agent: self.guard.self_write(path).cloned(),
            watcher,
            paused_at_ms: now_ms,
        };
        self.paused.insert(path.to_path_buf(), record.clone());
        Ok(record)
    }

    fn fingerprint_of(&self, path: &Path) -> FileFingerprint {
        self.expected
            .files
            .get(path)
            .cloned()
            .unwrap_or(FileFingerprint::Missing)
    }

    fn current_token(&self) -> String {
        self.pinned_token
            .clone()
            .unwrap_or_else(|| head_token(&self.worktree, self.is_git_worktree))
    }

    fn git_oid(&self, path: &Path) -> Option<String> {
        self.is_git_worktree
            .then(|| git_line(&self.worktree, &["hash-object", "--", &slash(path)]))
            .flatten()
    }
}

fn conflicting_paths(target: &Path, classification: &ConflictClassification) -> Vec<PathBuf> {
    match classification {
        ConflictClassification::RevisionChanged => vec![target.to_path_buf()],
        ConflictClassification::ExternalEdit { changed_paths }
        | ConflictClassification::OverlappingExternalEdit { changed_paths } => {
            changed_paths.clone()
        }
    }
}

fn worktree_busy(error: MutationError) -> StepError {
    match error {
        MutationError::Lock(LockError::Held { path, owner }) => {
            StepError::WorktreeBusy { path, owner }
        }
        other => StepError::Mutation(other),
    }
}

fn canonicalize(path: &Path) -> Result<PathBuf, StepError> {
    fs::canonicalize(path).map_err(|source| StepError::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn create_directory(path: &Path) -> Result<(), StepError> {
    fs::create_dir_all(path).map_err(|source| StepError::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Default expected-revision token: the checkout identity of the worktree.
///
/// A commit, checkout or rebase moves it, which reads as
/// [`ConflictClassification::RevisionChanged`]. Callers that want purely
/// content-based discrimination pin the token through
/// [`MutationRequest::with_revision_token`].
fn head_token(worktree: &Path, is_git_worktree: bool) -> String {
    if !is_git_worktree {
        return "worktree".to_owned();
    }
    git_line(worktree, &["rev-parse", "HEAD"])
        .map_or_else(|| "git:unborn".to_owned(), |oid| format!("git:{oid}"))
}

/// Runs one bounded, read-only Git query.
///
/// `changeloop_project` keeps its equivalent helper private, so this is a
/// deliberate minimal restatement rather than a second implementation of the
/// classifier: it reads identity only and never writes to the object database.
fn git_line(root: &Path, arguments: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
        ])
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .current_dir(root)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() || output.stdout.len() > MAX_GIT_LINE_BYTES {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.trim();
    (!line.is_empty()).then(|| line.to_owned())
}

#[cfg(test)]
mod tests;
