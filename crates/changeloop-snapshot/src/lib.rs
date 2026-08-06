//! Content-addressed checkpoints that preserve unrelated workspace edits.
//!
//! [`SnapshotManager`] is the shadow store: it records and restores project
//! content without ever committing to the user's repository. [`step`] builds the
//! agent-facing contract on top of it — one mutating execution per worktree, a
//! restorable snapshot per step, and an expected-revision check in front of
//! every write.

pub mod step;

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tempfile::NamedTempFile;
use thiserror::Error;
use uuid::Uuid;

const MAX_SNAPSHOT_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
const BLOB_TEMP_PREFIX: &str = ".changeloop-blob-";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapshotLimits {
    pub max_blob_bytes: u64,
    pub max_blob_files: u64,
}

impl Default for SnapshotLimits {
    fn default() -> Self {
        Self {
            max_blob_bytes: 2 * 1024 * 1024 * 1024,
            max_blob_files: 100_000,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct CheckpointId(pub String);

impl CheckpointId {
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for CheckpointId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileState {
    Missing,
    Regular {
        sha256: String,
        byte_length: u64,
        executable: bool,
    },
}

impl FileState {
    fn hash_label(&self) -> String {
        match self {
            Self::Missing => "missing".into(),
            Self::Regular { sha256, .. } => sha256.clone(),
        }
    }

    fn blob_hash(&self) -> Option<&str> {
        match self {
            Self::Missing => None,
            Self::Regular { sha256, .. } => Some(sha256),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileDelta {
    pub path: PathBuf,
    pub before: FileState,
    pub after: FileState,
}

#[derive(Clone, Debug)]
pub struct PendingCheckpoint {
    id: CheckpointId,
    started_at_ms: u64,
    before: BTreeMap<PathBuf, FileState>,
}

impl PendingCheckpoint {
    #[must_use]
    pub fn id(&self) -> &CheckpointId {
        &self.id
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepCheckpoint {
    pub id: CheckpointId,
    pub started_at_ms: u64,
    pub committed_at_ms: u64,
    pub files: Vec<FileDelta>,
    pub proof_references: BTreeSet<String>,
    pub applied: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditKind {
    Undo,
    Redo,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuditChange {
    pub path: PathBuf,
    pub from_hash: String,
    pub to_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuditRecord {
    pub operation_id: String,
    pub kind: AuditKind,
    pub checkpoint_id: CheckpointId,
    pub occurred_at_ms: u64,
    pub changes: Vec<AuditChange>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestoreOutcome {
    pub audit: AuditRecord,
    pub invalidated_paths: Vec<PathBuf>,
    pub invalidated_proof_references: BTreeSet<String>,
}

#[derive(Debug, Error)]
pub enum SnapshotError {
    #[error("snapshot path escapes the worktree: {0}")]
    PathEscape(PathBuf),
    #[error("snapshot path traverses a symlink: {0}")]
    Symlink(PathBuf),
    #[error("snapshot path is a directory, not a file: {0}")]
    Directory(PathBuf),
    #[error("checkpoint does not exist: {0:?}")]
    CheckpointNotFound(CheckpointId),
    #[error("checkpoint is already undone: {0:?}")]
    AlreadyUndone(CheckpointId),
    #[error("there is no checkpoint available to redo")]
    NoRedo,
    #[error("workspace file changed externally: {path}; expected {expected}, found {actual}")]
    ExternalModification {
        path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("snapshot content is missing for hash {0}")]
    MissingBlob(String),
    #[error("snapshot content failed integrity verification for hash {0}")]
    CorruptBlob(String),
    #[error(
        "snapshot blob quota pressure: {bytes} bytes/{files} files retained; limit is {max_bytes} bytes/{max_files} files"
    )]
    BlobQuotaPressure {
        bytes: u64,
        files: u64,
        max_bytes: u64,
        max_files: u64,
    },
    #[error("snapshot restore failed ({restore}) and rollback also failed ({rollback})")]
    RollbackFailed { restore: String, rollback: String },
    #[error("invalid snapshot manifest: {0}")]
    InvalidManifest(String),
    #[error("snapshot I/O failed for {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum RetentionReason {
    ActiveSession,
    EvidenceReference,
    Redoable,
    RetentionWindow,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CleanupAction {
    Keep { reasons: BTreeSet<RetentionReason> },
    Delete,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CleanupDecision {
    pub checkpoint_id: CheckpointId,
    pub action: CleanupAction,
}

pub struct SnapshotManager {
    worktree: PathBuf,
    #[cfg(unix)]
    worktree_dir: fs::File,
    blob_directory: PathBuf,
    transaction_lock_path: PathBuf,
    limits: SnapshotLimits,
    checkpoints: Vec<StepCheckpoint>,
    redo_stack: Vec<CheckpointId>,
    audit: Vec<AuditRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedSnapshots {
    checkpoints: Vec<StepCheckpoint>,
    redo_stack: Vec<CheckpointId>,
    audit: Vec<AuditRecord>,
}

impl SnapshotManager {
    /// Describes the path-resolution guarantee used by restore operations.
    #[must_use]
    pub const fn path_safety() -> &'static str {
        #[cfg(unix)]
        {
            "dirfd-openat-nofollow"
        }
        #[cfg(not(unix))]
        {
            "portable-best-effort; final path-swap TOCTOU is not closed"
        }
    }

    pub fn new(
        worktree: impl AsRef<Path>,
        state_directory: impl AsRef<Path>,
    ) -> Result<Self, SnapshotError> {
        Self::new_with_limits(worktree, state_directory, SnapshotLimits::default())
    }

    pub fn new_with_limits(
        worktree: impl AsRef<Path>,
        state_directory: impl AsRef<Path>,
        limits: SnapshotLimits,
    ) -> Result<Self, SnapshotError> {
        let worktree = fs::canonicalize(worktree.as_ref()).map_err(|source| SnapshotError::Io {
            path: worktree.as_ref().to_path_buf(),
            source,
        })?;
        let state_directory = state_directory.as_ref();
        fs::create_dir_all(state_directory).map_err(|source| SnapshotError::Io {
            path: state_directory.to_path_buf(),
            source,
        })?;
        let blob_directory = state_directory.join("blobs");
        fs::create_dir_all(&blob_directory).map_err(|source| SnapshotError::Io {
            path: blob_directory.clone(),
            source,
        })?;
        let manager = Self {
            #[cfg(unix)]
            worktree_dir: open_directory_nofollow(&worktree).map_err(|source| {
                SnapshotError::Io {
                    path: worktree.clone(),
                    source,
                }
            })?,
            worktree,
            blob_directory,
            transaction_lock_path: state_directory.join("snapshot.lock"),
            limits,
            checkpoints: Vec::new(),
            redo_stack: Vec::new(),
            audit: Vec::new(),
        };
        let _transaction = manager.acquire_transaction()?;
        manager.remove_stale_blob_temporaries()?;
        Ok(manager)
    }

    pub fn load(
        worktree: impl AsRef<Path>,
        state_directory: impl AsRef<Path>,
        manifest: impl AsRef<Path>,
    ) -> Result<Self, SnapshotError> {
        Self::load_with_limits(
            worktree,
            state_directory,
            manifest,
            SnapshotLimits::default(),
        )
    }

    pub fn load_with_limits(
        worktree: impl AsRef<Path>,
        state_directory: impl AsRef<Path>,
        manifest: impl AsRef<Path>,
        limits: SnapshotLimits,
    ) -> Result<Self, SnapshotError> {
        let mut manager = Self::new_with_limits(worktree, state_directory, limits)?;
        let mut bytes = Vec::new();
        File::open(manifest.as_ref())
            .map_err(|source| SnapshotError::Io {
                path: manifest.as_ref().to_path_buf(),
                source,
            })?
            .take(MAX_SNAPSHOT_MANIFEST_BYTES.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|source| SnapshotError::Io {
                path: manifest.as_ref().to_path_buf(),
                source,
            })?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_SNAPSHOT_MANIFEST_BYTES {
            return Err(SnapshotError::InvalidManifest(format!(
                "manifest exceeds {MAX_SNAPSHOT_MANIFEST_BYTES} bytes"
            )));
        }
        let state: PersistedSnapshots = serde_json::from_slice(&bytes)
            .map_err(|error| SnapshotError::InvalidManifest(error.to_string()))?;
        validate_persisted_snapshots(&state)?;
        manager.checkpoints = state.checkpoints;
        manager.redo_stack = state.redo_stack;
        manager.audit = state.audit;
        Ok(manager)
    }

    pub fn save(&self, manifest: impl AsRef<Path>) -> Result<(), SnapshotError> {
        let manifest = manifest.as_ref();
        let parent = manifest
            .parent()
            .ok_or_else(|| SnapshotError::PathEscape(manifest.to_path_buf()))?;
        fs::create_dir_all(parent).map_err(|source| SnapshotError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
        let mut temporary = NamedTempFile::new_in(parent).map_err(|source| SnapshotError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
        serde_json::to_writer(
            &mut temporary,
            &PersistedSnapshots {
                checkpoints: self.checkpoints.clone(),
                redo_stack: self.redo_stack.clone(),
                audit: self.audit.clone(),
            },
        )
        .map_err(|error| SnapshotError::InvalidManifest(error.to_string()))?;
        if temporary
            .as_file()
            .metadata()
            .map_err(|source| SnapshotError::Io {
                path: temporary.path().to_path_buf(),
                source,
            })?
            .len()
            > MAX_SNAPSHOT_MANIFEST_BYTES
        {
            return Err(SnapshotError::InvalidManifest(format!(
                "manifest exceeds {MAX_SNAPSHOT_MANIFEST_BYTES} bytes"
            )));
        }
        temporary
            .as_file()
            .sync_all()
            .map_err(|source| SnapshotError::Io {
                path: temporary.path().to_path_buf(),
                source,
            })?;
        temporary
            .persist(manifest)
            .map_err(|error| SnapshotError::Io {
                path: manifest.to_path_buf(),
                source: error.error,
            })?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|source| SnapshotError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        Ok(())
    }

    #[must_use]
    pub fn latest_applied_id(&self) -> Option<&CheckpointId> {
        self.checkpoints
            .iter()
            .rev()
            .find(|checkpoint| checkpoint.applied)
            .map(|checkpoint| &checkpoint.id)
    }

    #[must_use]
    pub fn redo_available(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn begin_step(
        &self,
        paths: impl IntoIterator<Item = PathBuf>,
        started_at_ms: u64,
    ) -> Result<PendingCheckpoint, SnapshotError> {
        let mut before = BTreeMap::new();
        for path in paths {
            let relative = normalize_relative(&path)?;
            before.insert(relative.clone(), self.capture(&relative, true)?);
        }
        Ok(PendingCheckpoint {
            id: CheckpointId::new(),
            started_at_ms,
            before,
        })
    }

    pub fn commit_step(
        &mut self,
        pending: PendingCheckpoint,
        committed_at_ms: u64,
        proof_references: BTreeSet<String>,
    ) -> Result<CheckpointId, SnapshotError> {
        let mut files = Vec::new();
        for (path, before) in pending.before {
            let after = self.capture(&path, true)?;
            if before != after {
                files.push(FileDelta {
                    path,
                    before,
                    after,
                });
            }
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        let id = pending.id;
        self.checkpoints.push(StepCheckpoint {
            id: id.clone(),
            started_at_ms: pending.started_at_ms,
            committed_at_ms,
            files,
            proof_references,
            applied: true,
        });
        self.redo_stack.clear();
        Ok(id)
    }

    pub fn undo(
        &mut self,
        checkpoint_id: &CheckpointId,
        occurred_at_ms: u64,
    ) -> Result<RestoreOutcome, SnapshotError> {
        let index = self
            .checkpoints
            .iter()
            .position(|checkpoint| &checkpoint.id == checkpoint_id)
            .ok_or_else(|| SnapshotError::CheckpointNotFound(checkpoint_id.clone()))?;
        if !self.checkpoints[index].applied {
            return Err(SnapshotError::AlreadyUndone(checkpoint_id.clone()));
        }
        let checkpoint = self.checkpoints[index].clone();
        let _transaction = self.acquire_transaction()?;
        self.remove_stale_blob_temporaries()?;
        self.validate_expected(&checkpoint.files, false)?;
        self.restore_all(&checkpoint.files, false)?;
        self.checkpoints[index].applied = false;
        self.redo_stack.push(checkpoint.id.clone());
        Ok(self.record_restore(&checkpoint, AuditKind::Undo, occurred_at_ms))
    }

    pub fn redo(&mut self, occurred_at_ms: u64) -> Result<RestoreOutcome, SnapshotError> {
        let checkpoint_id = self
            .redo_stack
            .last()
            .cloned()
            .ok_or(SnapshotError::NoRedo)?;
        let index = self
            .checkpoints
            .iter()
            .position(|checkpoint| checkpoint.id == checkpoint_id)
            .ok_or_else(|| SnapshotError::CheckpointNotFound(checkpoint_id.clone()))?;
        let checkpoint = self.checkpoints[index].clone();
        let _transaction = self.acquire_transaction()?;
        self.remove_stale_blob_temporaries()?;
        self.validate_expected(&checkpoint.files, true)?;
        self.restore_all(&checkpoint.files, true)?;
        self.checkpoints[index].applied = true;
        self.redo_stack.pop();
        Ok(self.record_restore(&checkpoint, AuditKind::Redo, occurred_at_ms))
    }

    /// Undo and durably persist the updated history. If persistence fails,
    /// restore the workspace and in-memory history to the pre-call state so a
    /// caller does not return with files and the manifest disagreeing.
    pub fn undo_and_save(
        &mut self,
        checkpoint_id: &CheckpointId,
        occurred_at_ms: u64,
        manifest: impl AsRef<Path>,
    ) -> Result<RestoreOutcome, SnapshotError> {
        let audit_len = self.audit.len();
        let outcome = self.undo(checkpoint_id, occurred_at_ms)?;
        if let Err(persist_error) = self.save(manifest) {
            if let Err(rollback_error) = self.redo(occurred_at_ms) {
                return Err(SnapshotError::RollbackFailed {
                    restore: persist_error.to_string(),
                    rollback: rollback_error.to_string(),
                });
            }
            self.audit.truncate(audit_len);
            return Err(persist_error);
        }
        Ok(outcome)
    }

    /// Redo and durably persist the updated history, rolling the workspace
    /// back to the undone state if the manifest cannot be replaced.
    pub fn redo_and_save(
        &mut self,
        occurred_at_ms: u64,
        manifest: impl AsRef<Path>,
    ) -> Result<RestoreOutcome, SnapshotError> {
        let audit_len = self.audit.len();
        let outcome = self.redo(occurred_at_ms)?;
        let checkpoint = outcome.audit.checkpoint_id.clone();
        if let Err(persist_error) = self.save(manifest) {
            if let Err(rollback_error) = self.undo(&checkpoint, occurred_at_ms) {
                return Err(SnapshotError::RollbackFailed {
                    restore: persist_error.to_string(),
                    rollback: rollback_error.to_string(),
                });
            }
            self.audit.truncate(audit_len);
            return Err(persist_error);
        }
        Ok(outcome)
    }

    /// Roll back a checkpoint that was committed in memory but could not be
    /// durably persisted. External overlap is validated before the first
    /// restore, and the failed checkpoint never becomes undo/redo history.
    pub fn rollback_unpersisted(
        &mut self,
        checkpoint_id: &CheckpointId,
    ) -> Result<Vec<PathBuf>, SnapshotError> {
        let index = self
            .checkpoints
            .iter()
            .position(|checkpoint| &checkpoint.id == checkpoint_id)
            .ok_or_else(|| SnapshotError::CheckpointNotFound(checkpoint_id.clone()))?;
        let checkpoint = self.checkpoints[index].clone();
        if !checkpoint.applied {
            return Err(SnapshotError::AlreadyUndone(checkpoint_id.clone()));
        }
        let _transaction = self.acquire_transaction()?;
        self.remove_stale_blob_temporaries()?;
        self.validate_expected(&checkpoint.files, false)?;
        self.restore_all(&checkpoint.files, false)?;
        self.checkpoints.remove(index);
        self.redo_stack.retain(|id| id != checkpoint_id);
        Ok(checkpoint
            .files
            .into_iter()
            .map(|delta| delta.path)
            .collect())
    }

    #[must_use]
    pub fn checkpoints(&self) -> &[StepCheckpoint] {
        &self.checkpoints
    }

    #[must_use]
    pub fn audit_log(&self) -> &[AuditRecord] {
        &self.audit
    }

    #[must_use]
    pub fn cleanup_plan(
        &self,
        now_ms: u64,
        retention_ms: u64,
        active: &BTreeSet<CheckpointId>,
        evidence_referenced: &BTreeSet<CheckpointId>,
    ) -> Vec<CleanupDecision> {
        self.checkpoints
            .iter()
            .map(|checkpoint| {
                let mut reasons = BTreeSet::new();
                if active.contains(&checkpoint.id) {
                    reasons.insert(RetentionReason::ActiveSession);
                }
                if evidence_referenced.contains(&checkpoint.id) {
                    reasons.insert(RetentionReason::EvidenceReference);
                }
                if self.redo_stack.contains(&checkpoint.id) {
                    reasons.insert(RetentionReason::Redoable);
                }
                if now_ms.saturating_sub(checkpoint.committed_at_ms) <= retention_ms {
                    reasons.insert(RetentionReason::RetentionWindow);
                }
                CleanupDecision {
                    checkpoint_id: checkpoint.id.clone(),
                    action: if reasons.is_empty() {
                        CleanupAction::Delete
                    } else {
                        CleanupAction::Keep { reasons }
                    },
                }
            })
            .collect()
    }

    pub fn apply_cleanup(&mut self, decisions: &[CleanupDecision]) -> Result<(), SnapshotError> {
        let _transaction = self.acquire_transaction()?;
        self.remove_stale_blob_temporaries()?;
        let deleted = decisions
            .iter()
            .filter(|decision| matches!(decision.action, CleanupAction::Delete))
            .map(|decision| &decision.checkpoint_id)
            .collect::<BTreeSet<_>>();
        self.checkpoints
            .retain(|checkpoint| !deleted.contains(&checkpoint.id));
        self.redo_stack.retain(|id| !deleted.contains(id));
        let referenced_blobs = self
            .checkpoints
            .iter()
            .flat_map(|checkpoint| checkpoint.files.iter())
            .flat_map(|delta| [delta.before.blob_hash(), delta.after.blob_hash()])
            .flatten()
            .collect::<BTreeSet<_>>();
        let mut removed_blob = false;
        for entry in fs::read_dir(&self.blob_directory).map_err(|source| SnapshotError::Io {
            path: self.blob_directory.clone(),
            source,
        })? {
            let entry = entry.map_err(|source| SnapshotError::Io {
                path: self.blob_directory.clone(),
                source,
            })?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if is_sha256(&name) && !referenced_blobs.contains(name.as_ref()) {
                fs::remove_file(entry.path()).map_err(|source| SnapshotError::Io {
                    path: entry.path(),
                    source,
                })?;
                removed_blob = true;
            }
        }
        #[cfg(unix)]
        if removed_blob {
            File::open(&self.blob_directory)
                .and_then(|directory| directory.sync_all())
                .map_err(|source| SnapshotError::Io {
                    path: self.blob_directory.clone(),
                    source,
                })?;
        }
        #[cfg(not(unix))]
        let _ = removed_blob;
        Ok(())
    }

    fn validate_expected(&self, files: &[FileDelta], for_redo: bool) -> Result<(), SnapshotError> {
        for delta in files {
            let expected = if for_redo {
                &delta.before
            } else {
                &delta.after
            };
            let actual = self.capture(&delta.path, false)?;
            if &actual != expected {
                return Err(SnapshotError::ExternalModification {
                    path: delta.path.clone(),
                    expected: expected.hash_label(),
                    actual: actual.hash_label(),
                });
            }
        }
        Ok(())
    }

    fn restore_all(&self, files: &[FileDelta], for_redo: bool) -> Result<(), SnapshotError> {
        // Verify every desired blob and destination before the first mutation.
        // This prevents a missing/corrupt later blob from leaving an earlier
        // path restored while the rest of the checkpoint remains applied.
        for delta in files {
            self.preflight_restore(
                if for_redo {
                    &delta.after
                } else {
                    &delta.before
                },
                &delta.path,
            )?;
        }
        let mut restored: Vec<&FileDelta> = Vec::new();
        for delta in files {
            let (desired, expected) = if for_redo {
                (&delta.after, &delta.before)
            } else {
                (&delta.before, &delta.after)
            };
            if let Err(error) = self.restore(&delta.path, desired, expected) {
                for applied in restored.into_iter().rev() {
                    let (rollback, installed) = if for_redo {
                        (&applied.before, &applied.after)
                    } else {
                        (&applied.after, &applied.before)
                    };
                    if let Err(rollback_error) = self.restore(&applied.path, rollback, installed) {
                        return Err(SnapshotError::RollbackFailed {
                            restore: error.to_string(),
                            rollback: rollback_error.to_string(),
                        });
                    }
                }
                return Err(error);
            }
            restored.push(delta);
        }
        Ok(())
    }

    fn preflight_restore(&self, state: &FileState, relative: &Path) -> Result<(), SnapshotError> {
        let _ = normalize_relative(relative)?;
        if let FileState::Regular { sha256, .. } = state {
            let blob_path = self.blob_directory.join(sha256);
            let mut blob = open_blob(&blob_path, sha256)?;
            let (observed, _) = hash_stream(&mut blob).map_err(|source| SnapshotError::Io {
                path: blob_path,
                source,
            })?;
            if observed != *sha256 {
                return Err(SnapshotError::CorruptBlob(sha256.clone()));
            }
        }
        Ok(())
    }

    fn record_restore(
        &mut self,
        checkpoint: &StepCheckpoint,
        kind: AuditKind,
        occurred_at_ms: u64,
    ) -> RestoreOutcome {
        let changes = checkpoint
            .files
            .iter()
            .map(|delta| {
                let (from, to) = match kind {
                    AuditKind::Undo => (&delta.after, &delta.before),
                    AuditKind::Redo => (&delta.before, &delta.after),
                };
                AuditChange {
                    path: delta.path.clone(),
                    from_hash: from.hash_label(),
                    to_hash: to.hash_label(),
                }
            })
            .collect::<Vec<_>>();
        let audit = AuditRecord {
            operation_id: Uuid::now_v7().to_string(),
            kind,
            checkpoint_id: checkpoint.id.clone(),
            occurred_at_ms,
            changes,
        };
        self.audit.push(audit.clone());
        RestoreOutcome {
            audit,
            invalidated_paths: checkpoint
                .files
                .iter()
                .map(|delta| delta.path.clone())
                .collect(),
            invalidated_proof_references: checkpoint.proof_references.clone(),
        }
    }

    fn capture(&self, relative: &Path, store_blob: bool) -> Result<FileState, SnapshotError> {
        let relative = normalize_relative(relative)?;
        let path = self.worktree.join(&relative);
        #[cfg(unix)]
        let (mut source, metadata) = match self.open_capture_source_unix(&relative)? {
            Some(source) => {
                let metadata = source.metadata().map_err(|source| SnapshotError::Io {
                    path: path.clone(),
                    source,
                })?;
                (source, metadata)
            }
            None => return Ok(FileState::Missing),
        };
        #[cfg(not(unix))]
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(FileState::Missing);
            }
            Err(source) => return Err(SnapshotError::Io { path, source }),
        };
        if metadata.file_type().is_symlink() {
            return Err(SnapshotError::Symlink(relative.to_path_buf()));
        }
        if !metadata.is_file() {
            return Err(SnapshotError::Directory(relative.to_path_buf()));
        }
        #[cfg(not(unix))]
        let mut source = File::open(&path).map_err(|source| SnapshotError::Io {
            path: path.clone(),
            source,
        })?;
        let _transaction = if store_blob {
            Some(self.acquire_transaction()?)
        } else {
            None
        };
        if store_blob {
            self.remove_stale_blob_temporaries()?;
        }
        let mut temporary = if store_blob {
            Some(
                tempfile::Builder::new()
                    .prefix(BLOB_TEMP_PREFIX)
                    .tempfile_in(&self.blob_directory)
                    .map_err(|source| SnapshotError::Io {
                        path: self.blob_directory.clone(),
                        source,
                    })?,
            )
        } else {
            None
        };
        let (sha256, byte_length) =
            copy_and_hash(&mut source, temporary.as_mut().map(Write::by_ref)).map_err(
                |source| SnapshotError::Io {
                    path: path.clone(),
                    source,
                },
            )?;
        if let Some(temporary) = temporary {
            temporary
                .as_file()
                .sync_all()
                .map_err(|source| SnapshotError::Io {
                    path: temporary.path().to_path_buf(),
                    source,
                })?;
            let blob_path = self.blob_directory.join(&sha256);
            if blob_path.exists() {
                verify_blob_file(&blob_path, &sha256)?;
                return Ok(FileState::Regular {
                    sha256,
                    byte_length,
                    executable: is_executable(&metadata),
                });
            }
            let (retained_bytes, retained_files) = self.blob_inventory()?;
            if retained_files >= self.limits.max_blob_files
                || retained_bytes.saturating_add(byte_length) > self.limits.max_blob_bytes
            {
                return Err(SnapshotError::BlobQuotaPressure {
                    bytes: retained_bytes,
                    files: retained_files,
                    max_bytes: self.limits.max_blob_bytes,
                    max_files: self.limits.max_blob_files,
                });
            }
            match temporary.persist_noclobber(&blob_path) {
                Ok(_) => File::open(&self.blob_directory)
                    .and_then(|directory| directory.sync_all())
                    .map_err(|source| SnapshotError::Io {
                        path: self.blob_directory.clone(),
                        source,
                    })?,
                Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                    verify_blob_file(&blob_path, &sha256)?;
                }
                Err(error) => {
                    return Err(SnapshotError::Io {
                        path: blob_path,
                        source: error.error,
                    });
                }
            }
        }
        Ok(FileState::Regular {
            sha256,
            byte_length,
            executable: is_executable(&metadata),
        })
    }

    #[cfg(unix)]
    fn open_capture_source_unix(&self, relative: &Path) -> Result<Option<File>, SnapshotError> {
        use std::ffi::CString;
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::ffi::OsStrExt;

        let relative = normalize_relative(relative)?;
        let components = relative.components().collect::<Vec<_>>();
        let mut current = self
            .worktree_dir
            .try_clone()
            .map_err(|source| SnapshotError::Io {
                path: self.worktree.clone(),
                source,
            })?;
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(name) = component else {
                return Err(SnapshotError::PathEscape(relative));
            };
            let name = CString::new(name.as_bytes())
                .map_err(|_| SnapshotError::PathEscape(relative.clone()))?;
            let flags = if index + 1 == components.len() {
                libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC
            } else {
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC
            };
            let descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
            if descriptor < 0 {
                let source = std::io::Error::last_os_error();
                let mut metadata = std::mem::MaybeUninit::<libc::stat>::zeroed();
                let is_symlink = unsafe {
                    libc::fstatat(
                        current.as_raw_fd(),
                        name.as_ptr(),
                        metadata.as_mut_ptr(),
                        libc::AT_SYMLINK_NOFOLLOW,
                    ) == 0
                        && (metadata.assume_init().st_mode & libc::S_IFMT) == libc::S_IFLNK
                };
                return if source.kind() == std::io::ErrorKind::NotFound {
                    Ok(None)
                } else if source.raw_os_error() == Some(libc::ELOOP) || is_symlink {
                    Err(SnapshotError::Symlink(relative))
                } else {
                    Err(SnapshotError::Io {
                        path: self.worktree.join(&relative),
                        source,
                    })
                };
            }
            current = unsafe { File::from_raw_fd(descriptor) };
        }
        Ok(Some(current))
    }

    fn acquire_transaction(&self) -> Result<SnapshotTransaction, SnapshotError> {
        let file =
            open_lock_file(&self.transaction_lock_path).map_err(|source| SnapshotError::Io {
                path: self.transaction_lock_path.clone(),
                source,
            })?;
        FileExt::lock_exclusive(&file).map_err(|source| SnapshotError::Io {
            path: self.transaction_lock_path.clone(),
            source,
        })?;
        Ok(SnapshotTransaction { file })
    }

    fn remove_stale_blob_temporaries(&self) -> Result<(), SnapshotError> {
        for entry in fs::read_dir(&self.blob_directory).map_err(|source| SnapshotError::Io {
            path: self.blob_directory.clone(),
            source,
        })? {
            let entry = entry.map_err(|source| SnapshotError::Io {
                path: self.blob_directory.clone(),
                source,
            })?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(BLOB_TEMP_PREFIX)
            {
                fs::remove_file(entry.path()).map_err(|source| SnapshotError::Io {
                    path: entry.path(),
                    source,
                })?;
            }
        }
        Ok(())
    }

    fn blob_inventory(&self) -> Result<(u64, u64), SnapshotError> {
        let mut bytes = 0_u64;
        let mut files = 0_u64;
        for entry in fs::read_dir(&self.blob_directory).map_err(|source| SnapshotError::Io {
            path: self.blob_directory.clone(),
            source,
        })? {
            let entry = entry.map_err(|source| SnapshotError::Io {
                path: self.blob_directory.clone(),
                source,
            })?;
            let name = entry.file_name();
            if !is_sha256(&name.to_string_lossy()) {
                continue;
            }
            let metadata = entry
                .file_type()
                .and_then(|kind| {
                    if kind.is_file() && !kind.is_symlink() {
                        entry.metadata()
                    } else {
                        Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "snapshot blob is not a regular file",
                        ))
                    }
                })
                .map_err(|source| SnapshotError::Io {
                    path: entry.path(),
                    source,
                })?;
            bytes = bytes.saturating_add(metadata.len());
            files = files.saturating_add(1);
        }
        Ok((bytes, files))
    }

    fn restore(
        &self,
        relative: &Path,
        state: &FileState,
        expected: &FileState,
    ) -> Result<(), SnapshotError> {
        #[cfg(unix)]
        {
            self.restore_unix(relative, state, expected)
        }
        #[cfg(not(unix))]
        {
            self.restore_portable(relative, state, expected)
        }
    }

    #[cfg(not(unix))]
    fn restore_portable(
        &self,
        relative: &Path,
        state: &FileState,
        expected: &FileState,
    ) -> Result<(), SnapshotError> {
        let actual = self.capture(relative, false)?;
        if &actual != expected {
            return Err(SnapshotError::ExternalModification {
                path: relative.to_path_buf(),
                expected: expected.hash_label(),
                actual: actual.hash_label(),
            });
        }
        let path = self.secure_path(relative)?;
        match state {
            FileState::Missing => {
                if path.exists() {
                    fs::remove_file(&path).map_err(|source| SnapshotError::Io { path, source })?;
                }
            }
            FileState::Regular {
                sha256, executable, ..
            } => {
                let blob_path = self.blob_directory.join(sha256);
                let mut blob = open_blob(&blob_path, sha256)?;
                let parent = path
                    .parent()
                    .ok_or_else(|| SnapshotError::PathEscape(path.clone()))?;
                self.create_secure_parents(relative)?;
                let mut temporary =
                    NamedTempFile::new_in(parent).map_err(|source| SnapshotError::Io {
                        path: parent.to_path_buf(),
                        source,
                    })?;
                let (observed, _) = copy_and_hash(&mut blob, Some(temporary.as_file_mut()))
                    .map_err(|source| SnapshotError::Io {
                        path: temporary.path().to_path_buf(),
                        source,
                    })?;
                if observed != *sha256 {
                    return Err(SnapshotError::CorruptBlob(sha256.clone()));
                }
                set_executable(temporary.as_file(), *executable).map_err(|source| {
                    SnapshotError::Io {
                        path: temporary.path().to_path_buf(),
                        source,
                    }
                })?;
                temporary
                    .as_file()
                    .sync_all()
                    .map_err(|source| SnapshotError::Io {
                        path: temporary.path().to_path_buf(),
                        source,
                    })?;
                // Close the largest portable symlink-swap window: validate the
                // parent chain again after staging and immediately before the
                // atomic same-directory rename.
                self.reject_symlink_parents(relative)?;
                temporary
                    .persist(&path)
                    .map_err(|error| SnapshotError::Io {
                        path,
                        source: error.error,
                    })?;
            }
        }
        Ok(())
    }

    #[cfg(unix)]
    fn restore_unix(
        &self,
        relative: &Path,
        state: &FileState,
        expected: &FileState,
    ) -> Result<(), SnapshotError> {
        use std::ffi::CString;
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::ffi::OsStrExt;

        let relative = normalize_relative(relative)?;
        // Recheck at the mutation boundary, after preflight. The surrounding
        // snapshot transaction closes the window for cooperating
        // capture/restore/GC processes.
        let actual = self.capture(&relative, false)?;
        if &actual != expected {
            return Err(SnapshotError::ExternalModification {
                path: relative.clone(),
                expected: expected.hash_label(),
                actual: actual.hash_label(),
            });
        }
        let path = self.worktree.join(&relative);
        let mut directory = self
            .worktree_dir
            .try_clone()
            .map_err(|source| SnapshotError::Io {
                path: self.worktree.clone(),
                source,
            })?;
        let components = relative.components().collect::<Vec<_>>();
        for component in &components[..components.len().saturating_sub(1)] {
            let Component::Normal(name) = component else {
                return Err(SnapshotError::PathEscape(relative.clone()));
            };
            let name = CString::new(name.as_bytes())
                .map_err(|_| SnapshotError::PathEscape(relative.clone()))?;
            let mut fd = unsafe {
                libc::openat(
                    directory.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                let created = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o700) };
                if created < 0
                    && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
                {
                    return Err(SnapshotError::Io {
                        path: path.clone(),
                        source: std::io::Error::last_os_error(),
                    });
                }
                fd = unsafe {
                    libc::openat(
                        directory.as_raw_fd(),
                        name.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                };
            }
            if fd < 0 {
                let source = std::io::Error::last_os_error();
                return if source.raw_os_error() == Some(libc::ELOOP) {
                    Err(SnapshotError::Symlink(relative.clone()))
                } else {
                    Err(SnapshotError::Io {
                        path: path.clone(),
                        source,
                    })
                };
            }
            directory = unsafe { fs::File::from_raw_fd(fd) };
        }
        let name = components
            .last()
            .and_then(|component| match component {
                Component::Normal(name) => Some(*name),
                _ => None,
            })
            .ok_or_else(|| SnapshotError::PathEscape(relative.clone()))?;
        let name = CString::new(name.as_bytes())
            .map_err(|_| SnapshotError::PathEscape(relative.clone()))?;
        match state {
            FileState::Missing => {
                let result = unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) };
                if result < 0 {
                    let source = std::io::Error::last_os_error();
                    if source.kind() != std::io::ErrorKind::NotFound {
                        return Err(SnapshotError::Io { path, source });
                    }
                }
            }
            FileState::Regular {
                sha256, executable, ..
            } => {
                let blob_path = self.blob_directory.join(sha256);
                let mut blob = open_blob(&blob_path, sha256)?;
                let temporary_name = CString::new(format!(".changeloop-{}.tmp", Uuid::now_v7()))
                    .map_err(|_| SnapshotError::PathEscape(relative.clone()))?;
                let fd = unsafe {
                    libc::openat(
                        directory.as_raw_fd(),
                        temporary_name.as_ptr(),
                        libc::O_WRONLY
                            | libc::O_CREAT
                            | libc::O_EXCL
                            | libc::O_NOFOLLOW
                            | libc::O_CLOEXEC,
                        0o600,
                    )
                };
                if fd < 0 {
                    return Err(SnapshotError::Io {
                        path,
                        source: std::io::Error::last_os_error(),
                    });
                }
                let mut temporary = unsafe { fs::File::from_raw_fd(fd) };
                let copied = copy_and_hash(&mut blob, Some(&mut temporary)).map_err(|source| {
                    SnapshotError::Io {
                        path: blob_path,
                        source,
                    }
                });
                let observed = match copied {
                    Ok((observed, _)) => observed,
                    Err(error) => {
                        unsafe {
                            libc::unlinkat(directory.as_raw_fd(), temporary_name.as_ptr(), 0);
                        }
                        return Err(error);
                    }
                };
                if observed != *sha256 {
                    unsafe {
                        libc::unlinkat(directory.as_raw_fd(), temporary_name.as_ptr(), 0);
                    }
                    return Err(SnapshotError::CorruptBlob(sha256.clone()));
                }
                let staged = (|| -> std::io::Result<()> {
                    set_executable(&temporary, *executable)?;
                    temporary.sync_all()?;
                    let renamed = if matches!(expected, FileState::Missing) {
                        renameat_noreplace(&directory, &temporary_name, &directory, &name)
                    } else {
                        unsafe {
                            libc::renameat(
                                directory.as_raw_fd(),
                                temporary_name.as_ptr(),
                                directory.as_raw_fd(),
                                name.as_ptr(),
                            )
                        }
                    };
                    if renamed < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    directory.sync_all()
                })();
                if let Err(source) = staged {
                    unsafe {
                        libc::unlinkat(directory.as_raw_fd(), temporary_name.as_ptr(), 0);
                    }
                    return Err(SnapshotError::Io { path, source });
                }
            }
        }
        directory
            .sync_all()
            .map_err(|source| SnapshotError::Io { path, source })?;
        Ok(())
    }

    #[cfg(not(unix))]
    fn create_secure_parents(&self, relative: &Path) -> Result<(), SnapshotError> {
        let relative = normalize_relative(relative)?;
        let parent = relative
            .parent()
            .ok_or_else(|| SnapshotError::PathEscape(relative.clone()))?;
        let mut current = self.worktree.clone();
        for component in parent.components() {
            current.push(component);
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(SnapshotError::Symlink(relative));
                }
                Ok(metadata) if metadata.is_dir() => {}
                Ok(_) => return Err(SnapshotError::Directory(relative)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    match fs::create_dir(&current) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(source) => {
                            return Err(SnapshotError::Io {
                                path: current,
                                source,
                            });
                        }
                    }
                    let metadata =
                        fs::symlink_metadata(&current).map_err(|source| SnapshotError::Io {
                            path: current.clone(),
                            source,
                        })?;
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(SnapshotError::Symlink(relative));
                    }
                }
                Err(source) => {
                    return Err(SnapshotError::Io {
                        path: current,
                        source,
                    });
                }
            }
        }
        Ok(())
    }

    #[cfg(not(unix))]
    fn secure_path(&self, relative: &Path) -> Result<PathBuf, SnapshotError> {
        let relative = normalize_relative(relative)?;
        self.reject_symlink_parents(&relative)?;
        Ok(self.worktree.join(relative))
    }

    #[cfg(not(unix))]
    fn reject_symlink_parents(&self, relative: &Path) -> Result<(), SnapshotError> {
        let mut current = self.worktree.clone();
        for component in relative.components() {
            current.push(component);
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(SnapshotError::Symlink(relative.to_path_buf()));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                Err(source) => {
                    return Err(SnapshotError::Io {
                        path: current,
                        source,
                    });
                }
            }
        }
        Ok(())
    }
}

struct SnapshotTransaction {
    file: File,
}

fn validate_persisted_snapshots(state: &PersistedSnapshots) -> Result<(), SnapshotError> {
    let mut checkpoint_ids = BTreeSet::new();
    for checkpoint in &state.checkpoints {
        if checkpoint.id.0.is_empty() || checkpoint.id.0.len() > 128 {
            return Err(SnapshotError::InvalidManifest(
                "checkpoint ID must contain 1..=128 bytes".into(),
            ));
        }
        if !checkpoint_ids.insert(checkpoint.id.clone()) {
            return Err(SnapshotError::InvalidManifest(format!(
                "duplicate checkpoint ID {:?}",
                checkpoint.id
            )));
        }
        if checkpoint.started_at_ms > checkpoint.committed_at_ms {
            return Err(SnapshotError::InvalidManifest(format!(
                "checkpoint {:?} commits before it starts",
                checkpoint.id
            )));
        }
        let mut paths = BTreeSet::new();
        for delta in &checkpoint.files {
            validate_manifest_path(&delta.path)?;
            if !paths.insert(delta.path.clone()) {
                return Err(SnapshotError::InvalidManifest(format!(
                    "checkpoint {:?} repeats path {:?}",
                    checkpoint.id, delta.path
                )));
            }
            validate_file_state(&delta.before)?;
            validate_file_state(&delta.after)?;
            if delta.before == delta.after {
                return Err(SnapshotError::InvalidManifest(format!(
                    "checkpoint {:?} contains unchanged path {:?}",
                    checkpoint.id, delta.path
                )));
            }
        }
        if checkpoint
            .proof_references
            .iter()
            .any(|reference| reference.is_empty() || reference.len() > 4 * 1024)
        {
            return Err(SnapshotError::InvalidManifest(format!(
                "checkpoint {:?} has an invalid proof reference",
                checkpoint.id
            )));
        }
    }

    let mut redo_ids = BTreeSet::new();
    for id in &state.redo_stack {
        if !redo_ids.insert(id) {
            return Err(SnapshotError::InvalidManifest(format!(
                "redo stack repeats checkpoint {:?}",
                id
            )));
        }
        let checkpoint = state
            .checkpoints
            .iter()
            .find(|checkpoint| &checkpoint.id == id)
            .ok_or_else(|| {
                SnapshotError::InvalidManifest(format!(
                    "redo stack references missing checkpoint {:?}",
                    id
                ))
            })?;
        if checkpoint.applied {
            return Err(SnapshotError::InvalidManifest(format!(
                "redo stack references applied checkpoint {:?}",
                id
            )));
        }
    }

    for audit in &state.audit {
        if audit.operation_id.is_empty() || audit.operation_id.len() > 128 {
            return Err(SnapshotError::InvalidManifest(
                "audit operation ID must contain 1..=128 bytes".into(),
            ));
        }
        if audit.checkpoint_id.0.is_empty() || audit.checkpoint_id.0.len() > 128 {
            return Err(SnapshotError::InvalidManifest(
                "audit checkpoint ID must contain 1..=128 bytes".into(),
            ));
        }
        for change in &audit.changes {
            validate_manifest_path(&change.path)?;
            for label in [&change.from_hash, &change.to_hash] {
                if label != "missing" && !is_sha256(label) {
                    return Err(SnapshotError::InvalidManifest(format!(
                        "audit contains invalid hash label {label:?}"
                    )));
                }
            }
        }
    }
    Ok(())
}

fn validate_manifest_path(path: &Path) -> Result<(), SnapshotError> {
    let normalized = normalize_relative(path)
        .map_err(|error| SnapshotError::InvalidManifest(error.to_string()))?;
    if normalized != path || path.to_string_lossy().len() > 4 * 1024 {
        return Err(SnapshotError::InvalidManifest(format!(
            "snapshot path is not canonical and bounded: {path:?}"
        )));
    }
    Ok(())
}

fn validate_file_state(state: &FileState) -> Result<(), SnapshotError> {
    if let FileState::Regular { sha256, .. } = state
        && !is_sha256(sha256)
    {
        return Err(SnapshotError::InvalidManifest(format!(
            "invalid snapshot blob hash {sha256:?}"
        )));
    }
    Ok(())
}

impl Drop for SnapshotTransaction {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

fn open_lock_file(path: &Path) -> std::io::Result<File> {
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::os::fd::FromRawFd;
        use std::os::unix::ffi::OsStrExt;
        let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "lock path contains NUL")
        })?;
        let fd = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if fd < 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(unsafe { File::from_raw_fd(fd) })
        }
    }
    #[cfg(not(unix))]
    {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(path)
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn open_blob(path: &Path, expected: &str) -> Result<File, SnapshotError> {
    if !is_sha256(expected) {
        return Err(SnapshotError::InvalidManifest(format!(
            "invalid snapshot blob hash {expected:?}"
        )));
    }
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::os::fd::FromRawFd;
        use std::os::unix::ffi::OsStrExt;
        let encoded = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| SnapshotError::CorruptBlob(expected.to_owned()))?;
        let fd = unsafe {
            libc::open(
                encoded.as_ptr(),
                libc::O_RDONLY | libc::O_NONBLOCK | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            return if error.kind() == std::io::ErrorKind::NotFound {
                Err(SnapshotError::MissingBlob(expected.to_owned()))
            } else {
                Err(SnapshotError::CorruptBlob(expected.to_owned()))
            };
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if !file
            .metadata()
            .map_err(|source| SnapshotError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .is_file()
        {
            return Err(SnapshotError::CorruptBlob(expected.to_owned()));
        }
        Ok(file)
    }
    #[cfg(not(unix))]
    {
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| SnapshotError::MissingBlob(expected.to_owned()))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(SnapshotError::CorruptBlob(expected.to_owned()));
        }
        File::open(path).map_err(|_| SnapshotError::MissingBlob(expected.to_owned()))
    }
}

fn verify_blob_file(path: &Path, expected: &str) -> Result<(), SnapshotError> {
    let mut file = open_blob(path, expected)?;
    let (observed, _) = hash_stream(&mut file).map_err(|source| SnapshotError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if observed == expected {
        Ok(())
    } else {
        Err(SnapshotError::CorruptBlob(expected.to_owned()))
    }
}

fn hash_stream(reader: &mut impl Read) -> std::io::Result<(String, u64)> {
    copy_and_hash(reader, None::<&mut File>)
}

fn copy_and_hash<W: Write>(
    reader: &mut impl Read,
    mut destination: Option<W>,
) -> std::io::Result<(String, u64)> {
    let mut hasher = Sha256::new();
    let mut byte_length = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        if let Some(destination) = destination.as_mut() {
            destination.write_all(&buffer[..read])?;
        }
        byte_length = byte_length.saturating_add(u64::try_from(read).unwrap_or(u64::MAX));
    }
    Ok((format!("{:x}", hasher.finalize()), byte_length))
}

fn normalize_relative(path: &Path) -> Result<PathBuf, SnapshotError> {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(SnapshotError::PathEscape(path.to_path_buf()));
            }
        }
    }
    if result.as_os_str().is_empty() {
        return Err(SnapshotError::PathEscape(path.to_path_buf()));
    }
    Ok(result)
}

#[cfg(unix)]
fn open_directory_nofollow(path: &Path) -> std::io::Result<fs::File> {
    use std::ffi::CString;
    use std::os::fd::FromRawFd;
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "path contains NUL"))?;
    let fd = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(unsafe { fs::File::from_raw_fd(fd) })
    }
}

#[cfg(target_os = "macos")]
fn renameat_noreplace(
    source_parent: &File,
    source_name: &std::ffi::CString,
    destination_parent: &File,
    destination_name: &std::ffi::CString,
) -> libc::c_int {
    use std::os::fd::AsRawFd;
    unsafe {
        libc::renameatx_np(
            source_parent.as_raw_fd(),
            source_name.as_ptr(),
            destination_parent.as_raw_fd(),
            destination_name.as_ptr(),
            libc::RENAME_EXCL,
        )
    }
}

#[cfg(target_os = "linux")]
fn renameat_noreplace(
    source_parent: &File,
    source_name: &std::ffi::CString,
    destination_parent: &File,
    destination_name: &std::ffi::CString,
) -> libc::c_int {
    use std::os::fd::AsRawFd;
    unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            source_parent.as_raw_fd(),
            source_name.as_ptr(),
            destination_parent.as_raw_fd(),
            destination_name.as_ptr(),
            libc::RENAME_NOREPLACE,
        ) as libc::c_int
    }
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn renameat_noreplace(
    source_parent: &File,
    source_name: &std::ffi::CString,
    destination_parent: &File,
    destination_name: &std::ffi::CString,
) -> libc::c_int {
    use std::os::fd::AsRawFd;
    // Portable Unix fallback cannot guarantee no-replace. Supported release
    // targets (macOS/Linux) use the atomic implementations above.
    unsafe {
        libc::renameat(
            source_parent.as_raw_fd(),
            source_name.as_ptr(),
            destination_parent.as_raw_fd(),
            destination_name.as_ptr(),
        )
    }
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn set_executable(file: &fs::File, executable: bool) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = file.metadata()?.permissions();
    let mode = if executable {
        permissions.mode() | 0o100
    } else {
        permissions.mode() & !0o111
    };
    permissions.set_mode(mode);
    file.set_permissions(permissions)
}

#[cfg(not(unix))]
fn set_executable(_file: &fs::File, _executable: bool) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests;
