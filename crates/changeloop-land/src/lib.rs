//! Explicit-authority Land transactions. This crate applies file projections;
//! it never creates commits, pushes branches, or manufactures authority.

use changeloop_harness::{LandAuthority, ReviewAttempt};
use changeloop_project::LeaderLock;
use changeloop_provider::{UsageLedger, UsageTotals};
use changeloop_snapshot::SnapshotManager;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tempfile::NamedTempFile;
use thiserror::Error;

mod pinned;
pub mod prove_evidence;
use pinned::PinnedEntry;

pub use prove_evidence::{ProveEvidenceBriefing, ProveEvidenceGap, read_prove_evidence};

const MAX_LAND_JSON_BYTES: u64 = 16 * 1024 * 1024;
const MAX_LAND_ENTRIES: usize = 10_000;
const MAX_LAND_REVIEW_ATTEMPTS: usize = 10_000;
const MAX_LAND_IDENTIFIER_BYTES: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthoritySource {
    User,
    Operator,
    ExternalReviewer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLandAuthority {
    pub grant: LandAuthority,
    pub source: AuthoritySource,
    pub change_id: String,
    pub transaction_id: String,
    pub granted_at_ms: u64,
    pub expires_at_ms: u64,
}

impl ExternalLandAuthority {
    pub fn validate(
        &self,
        change: &str,
        transaction: &str,
        revision: &str,
        now: u64,
    ) -> Result<(), LandError> {
        if !self.grant.explicit
            || self.grant.authority_id.is_empty()
            || self.grant.actor.is_empty()
            || self.change_id != change
            || self.transaction_id != transaction
            || self.grant.expected_revision != revision
            || self.granted_at_ms > now
            || now >= self.expires_at_ms
        {
            Err(LandError::AuthorityDenied)
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum PathIdentity {
    Missing,
    File {
        sha256: String,
        bytes: u64,
        executable: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandEntry {
    pub path: PathBuf,
    pub before: PathIdentity,
    pub after: PathIdentity,
    pub backup: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandPlan {
    pub change_id: String,
    pub transaction_id: String,
    pub expected_revision: String,
    pub sandbox_path: PathBuf,
    pub projection_hash: String,
    pub entries: Vec<LandEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LandJournalStatus {
    Prepared,
    Applying,
    Verified,
    RollingBack,
    RolledBack,
    ManualRecovery,
    Archived,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandJournal {
    pub version: u16,
    pub status: LandJournalStatus,
    pub plan: LandPlan,
    pub authority: ExternalLandAuthority,
    pub applied_paths: Vec<PathBuf>,
    pub in_flight_paths: Vec<PathBuf>,
    pub failure: Option<String>,
    pub recovery_error: Option<String>,
    pub checkpoint_id: Option<String>,
    pub updated_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ApplyControl {
    pub fail_after_paths: Option<usize>,
    pub interrupt_after_paths: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct CheckedLandOutcome {
    pub journal: LandJournal,
    pub observed_before: String,
    pub observed_after: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LandArchive {
    pub version: u16,
    pub change_id: String,
    pub transaction_id: String,
    pub projection_hash: String,
    pub authority: ExternalLandAuthority,
    pub review_attempts: Vec<ReviewAttempt>,
    pub usage_totals: UsageTotals,
    pub archived_at_ms: u64,
    pub commit_performed: bool,
    pub push_performed: bool,
}

#[allow(clippy::too_many_arguments)]
pub fn prepare_land(
    target: &Path,
    sandbox: &Path,
    state: &Path,
    change: &str,
    transaction: &str,
    revision: &str,
    paths: impl IntoIterator<Item = PathBuf>,
    authority: ExternalLandAuthority,
    now: u64,
) -> Result<PathBuf, LandError> {
    validate_identifier(change)?;
    validate_identifier(transaction)?;
    validate_directory_root(target)?;
    validate_directory_root(sandbox)?;
    validate_directory_root_if_exists(state)?;
    authority.validate(change, transaction, revision, now)?;
    let paths = paths
        .into_iter()
        .take(MAX_LAND_ENTRIES.saturating_add(1))
        .collect::<Vec<_>>();
    if paths.len() > MAX_LAND_ENTRIES {
        return Err(LandError::CollectionLimit {
            kind: "Land paths",
            limit: MAX_LAND_ENTRIES,
        });
    }
    let root = state
        .join("land-transactions")
        .join(change)
        .join(transaction);
    if root.join("journal.json").exists() {
        return Err(LandError::TransactionExists);
    }
    if root.exists() {
        // A directory without a journal is an interrupted prepare. No target
        // mutation can precede the durable journal, so it is safe to restart.
        fs::remove_dir_all(&root)?;
    }
    fs::create_dir_all(root.join("backup"))?;
    let mut entries = Vec::new();
    let mut unique = BTreeSet::new();
    for (index, path) in paths.into_iter().enumerate() {
        let path = safe_relative(&path)?;
        if !unique.insert(path.clone()) {
            return Err(LandError::DuplicatePath(path));
        }
        let target_path = scoped_path(target, &path)?;
        let sandbox_path = scoped_path(sandbox, &path)?;
        let before = identity(&target_path)?;
        let after = identity(&sandbox_path)?;
        let backup = if before == PathIdentity::Missing {
            None
        } else {
            let relative = PathBuf::from("backup").join(index.to_string());
            copy_regular(&target_path, &root.join(&relative))?;
            Some(relative)
        };
        entries.push(LandEntry {
            path,
            before,
            after,
            backup,
        });
    }
    let plan = LandPlan {
        change_id: change.into(),
        transaction_id: transaction.into(),
        expected_revision: revision.into(),
        sandbox_path: sandbox.to_path_buf(),
        projection_hash: projection_hash(&entries)?,
        entries,
    };
    let journal = LandJournal {
        version: 1,
        status: LandJournalStatus::Prepared,
        plan,
        authority,
        applied_paths: vec![],
        in_flight_paths: vec![],
        failure: None,
        recovery_error: None,
        checkpoint_id: None,
        updated_at_ms: now,
    };
    let path = root.join("journal.json");
    save_journal(&path, &journal)?;
    Ok(path)
}

pub fn apply_land(
    target: &Path,
    journal_path: &Path,
    revision: &str,
    now: u64,
    control: ApplyControl,
) -> Result<LandJournal, LandError> {
    validate_directory_root(target)?;
    let _lock = LeaderLock::acquire(target.join(".changeloop/land.lock"))?;
    apply_land_locked(target, journal_path, revision, now, control)
}

/// Recomputes the workspace revision while the exclusive project lock is
/// held, preventing a stale caller-provided revision from authorizing Land.
/// The post-apply revision is captured under the same lock for the harness to
/// commit without reopening a validation gap.
pub fn apply_land_checked<F>(
    target: &Path,
    journal_path: &Path,
    now: u64,
    control: ApplyControl,
    mut revision: F,
) -> Result<CheckedLandOutcome, LandError>
where
    F: FnMut(&Path) -> Result<String, LandError>,
{
    validate_directory_root(target)?;
    let _lock = LeaderLock::acquire(target.join(".changeloop/land.lock"))?;
    let observed_before = revision(target)?;
    if load_journal(journal_path)?.plan.expected_revision != observed_before {
        return Err(LandError::RevisionConflict);
    }
    let journal = apply_land_locked(target, journal_path, &observed_before, now, control)?;
    let observed_after = revision(target)?;
    Ok(CheckedLandOutcome {
        journal,
        observed_before,
        observed_after,
    })
}

fn apply_land_locked(
    target: &Path,
    journal_path: &Path,
    revision: &str,
    now: u64,
    control: ApplyControl,
) -> Result<LandJournal, LandError> {
    let mut journal = load_journal(journal_path)?;
    journal.authority.validate(
        &journal.plan.change_id,
        &journal.plan.transaction_id,
        revision,
        now,
    )?;
    if revision != journal.plan.expected_revision {
        return Err(LandError::RevisionConflict);
    }
    if journal.status == LandJournalStatus::Verified {
        return Ok(journal);
    }
    if journal.status != LandJournalStatus::Prepared {
        return Err(LandError::RecoveryRequired);
    }
    let snapshot_root = journal_path
        .parent()
        .ok_or_else(|| LandError::UnsafePath(journal_path.into()))?
        .join("snapshots");
    let mut snapshots = SnapshotManager::new(target, &snapshot_root)?;
    let pending = snapshots.begin_step(
        journal.plan.entries.iter().map(|entry| entry.path.clone()),
        now,
    )?;
    journal.status = LandJournalStatus::Applying;
    save_at(journal_path, &mut journal, now)?;
    let outcome = apply_entries(target, journal_path, &mut journal, now, control);
    if matches!(outcome, Err(LandError::Interrupted)) {
        return Err(LandError::Interrupted);
    }
    if let Err(error) = outcome {
        let message = error.to_string();
        rollback(target, journal_path, &mut journal, &message, now)?;
        return Err(LandError::ApplyRolledBack(message));
    }
    let checkpoint = snapshots.commit_step(pending, now, BTreeSet::new())?;
    snapshots.save(snapshot_root.join("state.json"))?;
    journal.checkpoint_id = Some(checkpoint.0);
    journal.status = LandJournalStatus::Verified;
    save_at(journal_path, &mut journal, now)?;
    Ok(journal)
}

fn apply_entries(
    target: &Path,
    journal_path: &Path,
    journal: &mut LandJournal,
    now: u64,
    control: ApplyControl,
) -> Result<(), LandError> {
    for (index, entry) in journal.plan.entries.clone().into_iter().enumerate() {
        // The parent directory is opened once, here, and every check and
        // mutation below goes through that descriptor. Re-resolving the name
        // between the check and the write is exactly the window this closes.
        let destination =
            PinnedEntry::resolve(target, &entry.path, entry.after != PathIdentity::Missing)?;
        if destination.identity()? != entry.before {
            return Err(LandError::TargetConflict(entry.path));
        }
        journal.in_flight_paths = vec![entry.path.clone()];
        save_at(journal_path, journal, now)?;
        if entry.after == PathIdentity::Missing {
            destination.remove_regular_if_exists()?;
        } else {
            let source_path = scoped_path(&journal.plan.sandbox_path, &entry.path)?;
            let mut source = open_regular_nofollow(&source_path)?;
            validate_regular_single_link(&source.metadata()?, &source_path)?;
            let executable = matches!(
                entry.after,
                PathIdentity::File {
                    executable: true,
                    ..
                }
            );
            destination.replace_with(&mut source, executable, &index.to_string())?;
        }
        if destination.identity()? != entry.after {
            return Err(LandError::ProjectionMismatch(entry.path));
        }
        journal.applied_paths.push(entry.path.clone());
        journal.in_flight_paths.clear();
        save_at(journal_path, journal, now)?;
        let count = journal.applied_paths.len();
        if control.interrupt_after_paths == Some(count) {
            return Err(LandError::Interrupted);
        }
        if control.fail_after_paths == Some(count) {
            return Err(LandError::InjectedFailure);
        }
    }
    Ok(())
}

pub fn recover_land(
    target: &Path,
    journal_path: &Path,
    now: u64,
) -> Result<LandJournal, LandError> {
    validate_directory_root(target)?;
    let _lock = LeaderLock::acquire(target.join(".changeloop/land.lock"))?;
    let mut journal = load_journal(journal_path)?;
    if matches!(
        journal.status,
        LandJournalStatus::Applying | LandJournalStatus::RollingBack
    ) {
        rollback(
            target,
            journal_path,
            &mut journal,
            "interrupted transaction",
            now,
        )?;
    }
    Ok(journal)
}

fn rollback(
    target: &Path,
    journal_path: &Path,
    journal: &mut LandJournal,
    reason: &str,
    now: u64,
) -> Result<(), LandError> {
    journal.status = LandJournalStatus::RollingBack;
    journal.failure = Some(reason.into());
    save_at(journal_path, journal, now)?;
    let transaction_root = journal_path
        .parent()
        .ok_or_else(|| LandError::UnsafePath(journal_path.into()))?;
    for (index, entry) in journal.plan.entries.clone().into_iter().enumerate().rev() {
        if !journal.applied_paths.contains(&entry.path)
            && !journal.in_flight_paths.contains(&entry.path)
        {
            continue;
        }
        // Rollback restores through the same pinned descriptor, so an attacker
        // cannot redirect the restore either.
        let destination = PinnedEntry::resolve(target, &entry.path, entry.backup.is_some())?;
        let current = destination.identity()?;
        if current == entry.before {
            continue;
        }
        if current != entry.after && current != PathIdentity::Missing {
            journal.status = LandJournalStatus::ManualRecovery;
            journal.recovery_error = Some(format!("divergent target: {}", entry.path.display()));
            save_at(journal_path, journal, now)?;
            return Err(LandError::ManualRecovery(entry.path));
        }
        if let Some(backup) = entry.backup {
            let backup_path = transaction_root.join(backup);
            let mut source = open_regular_nofollow(&backup_path)?;
            validate_regular_single_link(&source.metadata()?, &backup_path)?;
            let executable = matches!(
                entry.before,
                PathIdentity::File {
                    executable: true,
                    ..
                }
            );
            destination.replace_with(&mut source, executable, &format!("rollback-{index}"))?;
        } else {
            destination.remove_regular_if_exists()?;
        }
        if destination.identity()? != entry.before {
            return Err(LandError::RollbackVerification(entry.path));
        }
    }
    journal.status = LandJournalStatus::RolledBack;
    journal.applied_paths.clear();
    journal.in_flight_paths.clear();
    save_at(journal_path, journal, now)
}

pub fn archive_land(
    target: &Path,
    journal_path: &Path,
    archive_dir: &Path,
    reviews: &[ReviewAttempt],
    usage: &UsageLedger,
    now: u64,
) -> Result<LandArchive, LandError> {
    validate_directory_root(target)?;
    if reviews.len() > MAX_LAND_REVIEW_ATTEMPTS {
        return Err(LandError::CollectionLimit {
            kind: "Land review attempts",
            limit: MAX_LAND_REVIEW_ATTEMPTS,
        });
    }
    let _lock = LeaderLock::acquire(target.join(".changeloop/land.lock"))?;
    let mut journal = load_journal(journal_path)?;
    if !matches!(
        journal.status,
        LandJournalStatus::Verified | LandJournalStatus::Archived
    ) {
        return Err(LandError::NotVerified);
    }
    for entry in &journal.plan.entries {
        if identity(&scoped_path(target, &entry.path)?)? != entry.after {
            return Err(LandError::ProjectionMismatch(entry.path.clone()));
        }
    }
    let mut archive = LandArchive {
        version: 1,
        change_id: journal.plan.change_id.clone(),
        transaction_id: journal.plan.transaction_id.clone(),
        projection_hash: journal.plan.projection_hash.clone(),
        authority: journal.authority.clone(),
        review_attempts: reviews.to_vec(),
        usage_totals: usage.totals(),
        archived_at_ms: now,
        commit_performed: false,
        push_performed: false,
    };
    fs::create_dir_all(archive_dir)?;
    validate_directory_root(archive_dir)?;
    let archive_path = archive_dir.join(format!("{}.json", journal.plan.change_id));
    if archive_path.exists() {
        let existing: LandArchive = serde_json::from_slice(&read_limited_json(&archive_path)?)?;
        if existing.review_attempts.len() > MAX_LAND_REVIEW_ATTEMPTS {
            return Err(LandError::CollectionLimit {
                kind: "Land review attempts",
                limit: MAX_LAND_REVIEW_ATTEMPTS,
            });
        }
        if existing.transaction_id != archive.transaction_id
            || existing.projection_hash != archive.projection_hash
        {
            return Err(LandError::ArchiveConflict);
        }
        archive = existing;
    } else {
        write_json_atomic(&archive_path, &archive)?;
    }
    journal.status = LandJournalStatus::Archived;
    save_at(journal_path, &mut journal, now)?;
    let journal_parent = journal_path
        .parent()
        .ok_or_else(|| LandError::UnsafePath(journal_path.into()))?;
    remove_tree_if_exists(&journal_parent.join("backup"))?;
    remove_tree_if_exists(&journal_parent.join("stage"))?;
    Ok(archive)
}

fn projection_hash(entries: &[LandEntry]) -> Result<String, LandError> {
    let values = entries
        .iter()
        .map(|entry| (&entry.path, &entry.after))
        .collect::<Vec<_>>();
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&values)?)
    ))
}

fn identity(path: &Path) -> Result<PathIdentity, LandError> {
    let path_metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PathIdentity::Missing);
        }
        Err(error) => return Err(error.into()),
    };
    validate_regular_single_link(&path_metadata, path)?;
    let mut file = open_regular_nofollow(path)?;
    let metadata = file.metadata()?;
    validate_regular_single_link(&metadata, path)?;
    let mut digest = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
        bytes = bytes.saturating_add(u64::try_from(read).unwrap_or(u64::MAX));
    }
    #[cfg(unix)]
    let executable = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    };
    #[cfg(not(unix))]
    let executable = false;
    Ok(PathIdentity::File {
        sha256: format!("{:x}", digest.finalize()),
        bytes,
        executable,
    })
}

fn copy_regular(source: &Path, destination: &Path) -> Result<(), LandError> {
    let mut source_file = open_regular_nofollow(source)?;
    validate_regular_single_link(&source_file.metadata()?, source)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
        let parent_identity = ParentIdentity::capture(parent)?;
        let mut temporary = NamedTempFile::new_in(parent)?;
        std::io::copy(&mut source_file, &mut temporary)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = source_file.metadata()?.permissions().mode() & 0o777;
            temporary
                .as_file()
                .set_permissions(fs::Permissions::from_mode(mode))?;
        }
        temporary.as_file().sync_all()?;
        parent_identity.verify(parent)?;
        temporary
            .persist(destination)
            .map_err(|error| error.error)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        return Ok(());
    }
    Err(LandError::UnsafePath(destination.into()))
}

fn open_regular_nofollow(path: &Path) -> Result<File, LandError> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    Ok(options.open(path)?)
}

fn validate_regular_single_link(metadata: &fs::Metadata, path: &Path) -> Result<(), LandError> {
    if !metadata.file_type().is_file() {
        return Err(LandError::UnsupportedPath(path.into()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(LandError::UnsupportedPath(path.into()));
        }
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), LandError> {
    if !value.is_empty()
        && value.len() <= MAX_LAND_IDENTIFIER_BYTES
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        Ok(())
    } else {
        Err(LandError::UnsafeIdentifier(value.into()))
    }
}
#[cfg_attr(unix, allow(dead_code))]
fn remove_regular_if_exists(path: &Path) -> Result<(), LandError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Ok(fs::remove_file(path)?),
        Ok(_) => Err(LandError::UnsupportedPath(path.into())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
fn remove_tree_if_exists(path: &Path) -> Result<(), LandError> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
fn safe_relative(path: &Path) -> Result<PathBuf, LandError> {
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => output.push(value),
            Component::CurDir => {}
            _ => return Err(LandError::UnsafePath(path.into())),
        }
    }
    if output.as_os_str().is_empty() {
        Err(LandError::UnsafePath(path.into()))
    } else {
        Ok(output)
    }
}
fn scoped_path(root: &Path, relative: &Path) -> Result<PathBuf, LandError> {
    validate_directory_root(root)?;
    let relative = safe_relative(relative)?;
    let mut candidate = root.to_path_buf();
    for component in relative.components() {
        candidate.push(component.as_os_str());
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(LandError::UnsupportedPath(candidate));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(root.join(relative))
}

fn validate_directory_root(path: &Path) -> Result<(), LandError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        Ok(())
    } else {
        Err(LandError::UnsafePath(path.into()))
    }
}

fn validate_directory_root_if_exists(path: &Path) -> Result<(), LandError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(LandError::UnsafePath(path.into())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
fn load_journal(path: &Path) -> Result<LandJournal, LandError> {
    let journal: LandJournal = serde_json::from_slice(&read_limited_json(path)?)?;
    if journal.plan.entries.len() > MAX_LAND_ENTRIES {
        return Err(LandError::CollectionLimit {
            kind: "Land paths",
            limit: MAX_LAND_ENTRIES,
        });
    }
    if journal.version != 1
        || projection_hash(&journal.plan.entries)? != journal.plan.projection_hash
        || validate_identifier(&journal.plan.change_id).is_err()
        || validate_identifier(&journal.plan.transaction_id).is_err()
        || !journal.authority.grant.explicit
        || journal.authority.grant.authority_id.is_empty()
        || journal.authority.grant.actor.is_empty()
        || journal.authority.change_id != journal.plan.change_id
        || journal.authority.transaction_id != journal.plan.transaction_id
        || journal.authority.grant.expected_revision != journal.plan.expected_revision
    {
        return Err(LandError::JournalCorrupt);
    }
    for (index, entry) in journal.plan.entries.iter().enumerate() {
        safe_relative(&entry.path)?;
        if entry.backup.as_deref()
            != (entry.before != PathIdentity::Missing)
                .then(|| PathBuf::from("backup").join(index.to_string()))
                .as_deref()
        {
            return Err(LandError::JournalCorrupt);
        }
    }
    Ok(journal)
}
fn read_limited_json(path: &Path) -> Result<Vec<u8>, LandError> {
    let path_metadata = fs::symlink_metadata(path)?;
    validate_regular_single_link(&path_metadata, path)?;
    if path_metadata.len() > MAX_LAND_JSON_BYTES {
        return Err(LandError::JsonTooLarge {
            limit: MAX_LAND_JSON_BYTES,
        });
    }
    let file = open_regular_nofollow(path)?;
    let metadata = file.metadata()?;
    validate_regular_single_link(&metadata, path)?;
    if metadata.len() > MAX_LAND_JSON_BYTES {
        return Err(LandError::JsonTooLarge {
            limit: MAX_LAND_JSON_BYTES,
        });
    }
    let mut bytes = Vec::new();
    file.take(MAX_LAND_JSON_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_LAND_JSON_BYTES {
        return Err(LandError::JsonTooLarge {
            limit: MAX_LAND_JSON_BYTES,
        });
    }
    Ok(bytes)
}
fn save_at(path: &Path, journal: &mut LandJournal, now: u64) -> Result<(), LandError> {
    journal.updated_at_ms = now;
    save_journal(path, journal)
}
fn save_journal(path: &Path, journal: &LandJournal) -> Result<(), LandError> {
    write_json_atomic(path, journal)
}
fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), LandError> {
    let parent = path
        .parent()
        .ok_or_else(|| LandError::UnsafePath(path.into()))?;
    fs::create_dir_all(parent)?;
    let parent_identity = ParentIdentity::capture(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temporary, value)?;
    temporary.write_all(b"\n")?;
    if temporary.as_file().metadata()?.len() > MAX_LAND_JSON_BYTES {
        return Err(LandError::JsonTooLarge {
            limit: MAX_LAND_JSON_BYTES,
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    temporary.as_file().sync_all()?;
    parent_identity.verify(parent)?;
    temporary.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

struct ParentIdentity {
    canonical: PathBuf,
    metadata: fs::Metadata,
}

impl ParentIdentity {
    fn capture(parent: &Path) -> Result<Self, LandError> {
        let metadata = fs::symlink_metadata(parent)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(LandError::UnsafePath(parent.into()));
        }
        Ok(Self {
            canonical: fs::canonicalize(parent)?,
            metadata,
        })
    }

    fn verify(&self, parent: &Path) -> Result<(), LandError> {
        let current = fs::symlink_metadata(parent)?;
        if !current.is_dir()
            || current.file_type().is_symlink()
            || fs::canonicalize(parent)? != self.canonical
        {
            return Err(LandError::ParentChanged(parent.into()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if current.dev() != self.metadata.dev() || current.ino() != self.metadata.ino() {
                return Err(LandError::ParentChanged(parent.into()));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum LandError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Lock(#[from] changeloop_project::LockError),
    #[error(transparent)]
    Snapshot(#[from] changeloop_snapshot::SnapshotError),
    #[error("explicit external Land authority denied")]
    AuthorityDenied,
    #[error("Land transaction already exists")]
    TransactionExists,
    #[error("duplicate Land path: {0}")]
    DuplicatePath(PathBuf),
    #[error("unsafe Land path: {0}")]
    UnsafePath(PathBuf),
    #[error("unsafe Land identifier: {0}")]
    UnsafeIdentifier(String),
    #[error("Land state parent changed during transaction: {0}")]
    ParentChanged(PathBuf),
    #[error("unsupported Land path type: {0}")]
    UnsupportedPath(PathBuf),
    #[error("workspace revision conflict")]
    RevisionConflict,
    #[error("workspace revision probe failed: {0}")]
    RevisionProbe(String),
    #[error("target changed during Land: {0}")]
    TargetConflict(PathBuf),
    #[error("post-apply projection mismatch: {0}")]
    ProjectionMismatch(PathBuf),
    #[error("Land recovery is required before apply")]
    RecoveryRequired,
    #[error("Land apply was interrupted")]
    Interrupted,
    #[error("injected Land apply failure")]
    InjectedFailure,
    #[error("Land apply failed and rolled back: {0}")]
    ApplyRolledBack(String),
    #[error("Land rollback requires manual recovery: {0}")]
    ManualRecovery(PathBuf),
    #[error("Land rollback verification failed: {0}")]
    RollbackVerification(PathBuf),
    #[error("Land transaction is not verified")]
    NotVerified,
    #[error("Land archive conflicts with existing state")]
    ArchiveConflict,
    #[error("Land journal failed its integrity check")]
    JournalCorrupt,
    #[error("Land JSON exceeds the safe {limit}-byte limit")]
    JsonTooLarge { limit: u64 },
    #[error("{kind} exceeds the safe {limit}-item limit")]
    CollectionLimit { kind: &'static str, limit: usize },
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_harness::{ReviewAttempt, ReviewContext};
    use tempfile::tempdir;

    /// The point of holding the descriptor is that the write goes to the
    /// directory Land checked, even after the *name* of that directory has been
    /// re-pointed somewhere else. No race is needed to show it: pin first, swap
    /// the name, then write.
    #[cfg(unix)]
    #[test]
    fn a_pinned_entry_writes_through_the_directory_it_opened_not_the_name_it_came_from() {
        let root = tempdir().unwrap();
        let elsewhere = tempdir().unwrap();
        fs::create_dir_all(root.path().join("nested")).unwrap();
        fs::write(root.path().join("nested/file.txt"), b"before").unwrap();

        let pinned =
            PinnedEntry::resolve(root.path(), Path::new("nested/file.txt"), false).unwrap();
        assert!(matches!(
            pinned.identity().unwrap(),
            PathIdentity::File { .. }
        ));

        fs::rename(root.path().join("nested"), root.path().join("detached")).unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), root.path().join("nested")).unwrap();

        let staged = root.path().join("staged");
        fs::write(&staged, b"after").unwrap();
        let mut source = File::open(&staged).unwrap();
        pinned.replace_with(&mut source, false, "swap").unwrap();

        assert_eq!(
            fs::read(root.path().join("detached/file.txt")).unwrap(),
            b"after",
            "the write did not land in the directory that was checked"
        );
        assert!(
            !elsewhere.path().join("file.txt").exists(),
            "the write followed the swapped name instead of the pinned descriptor"
        );
    }

    /// Resolution refuses a symlinked component rather than traversing it, so a
    /// symlink planted before Land starts is not a way in either.
    #[cfg(unix)]
    #[test]
    fn a_pinned_entry_refuses_a_symlinked_parent_component() {
        let root = tempdir().unwrap();
        let elsewhere = tempdir().unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), root.path().join("nested")).unwrap();
        let error = PinnedEntry::resolve(root.path(), Path::new("nested/file.txt"), false)
            .expect_err("a symlinked component is refused");
        assert!(matches!(error, LandError::UnsupportedPath(_)), "{error:?}");
    }

    /// A symlink *at the leaf* is not an identity Land will act on, so it can
    /// neither be read through nor silently replaced.
    #[cfg(unix)]
    #[test]
    fn a_pinned_entry_refuses_a_symlinked_leaf() {
        let root = tempdir().unwrap();
        let outside = root.path().join("outside.txt");
        fs::write(&outside, b"outside").unwrap();
        std::os::unix::fs::symlink(&outside, root.path().join("file.txt")).unwrap();
        let pinned = PinnedEntry::resolve(root.path(), Path::new("file.txt"), false).unwrap();
        assert!(matches!(
            pinned.identity(),
            Err(LandError::UnsupportedPath(_))
        ));
        assert!(matches!(
            pinned.remove_regular_if_exists(),
            Err(LandError::UnsupportedPath(_))
        ));
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
    }

    /// An absent leaf is `Missing`, and removing it is success — the same
    /// contract the path-based helpers had.
    #[cfg(unix)]
    #[test]
    fn a_pinned_entry_reports_an_absent_leaf_as_missing() {
        let root = tempdir().unwrap();
        let pinned = PinnedEntry::resolve(root.path(), Path::new("absent.txt"), false).unwrap();
        assert_eq!(pinned.identity().unwrap(), PathIdentity::Missing);
        pinned.remove_regular_if_exists().unwrap();
    }

    fn authority(explicit: bool, expires: u64) -> ExternalLandAuthority {
        ExternalLandAuthority {
            grant: LandAuthority {
                authority_id: "grant-1".into(),
                actor: "user".into(),
                expected_revision: "rev-1".into(),
                explicit,
            },
            source: AuthoritySource::User,
            change_id: "change-1".into(),
            transaction_id: "tx-1".into(),
            granted_at_ms: 1,
            expires_at_ms: expires,
        }
    }

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let root = tempdir().unwrap();
        let target = root.path().join("target");
        let sandbox = root.path().join("sandbox");
        let state = root.path().join("state");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&sandbox).unwrap();
        fs::write(target.join("a.txt"), b"old-a").unwrap();
        fs::write(target.join("b.txt"), b"old-b").unwrap();
        fs::write(sandbox.join("a.txt"), b"new-a").unwrap();
        fs::write(sandbox.join("b.txt"), b"new-b").unwrap();
        (root, target, sandbox, state)
    }

    #[test]
    fn authority_is_external_scoped_and_expiring() {
        let (_root, target, sandbox, state) = setup();
        assert!(matches!(
            prepare_land(
                &target,
                &sandbox,
                &state,
                "change-1",
                "tx-1",
                "rev-1",
                [PathBuf::from("a.txt")],
                authority(false, 100),
                10
            ),
            Err(LandError::AuthorityDenied)
        ));
        assert!(matches!(
            prepare_land(
                &target,
                &sandbox,
                &state,
                "change-1",
                "tx-1",
                "rev-1",
                [PathBuf::from("a.txt")],
                authority(true, 10),
                10
            ),
            Err(LandError::AuthorityDenied)
        ));
    }

    #[test]
    fn recovery_rejects_oversized_journal_before_mutation() {
        let (_root, target, _sandbox, state) = setup();
        fs::create_dir_all(&state).unwrap();
        let journal = state.join("land.json");
        File::create(&journal)
            .unwrap()
            .set_len(MAX_LAND_JSON_BYTES + 1)
            .unwrap();

        assert!(matches!(
            recover_land(&target, &journal, 10),
            Err(LandError::JsonTooLarge {
                limit: MAX_LAND_JSON_BYTES
            })
        ));
        assert_eq!(fs::read(target.join("a.txt")).unwrap(), b"old-a");
    }

    #[test]
    fn prepare_rejects_unbounded_path_count_before_creating_state() {
        let (_root, target, sandbox, state) = setup();
        let paths = std::iter::repeat_n(PathBuf::from("a.txt"), MAX_LAND_ENTRIES + 1);

        assert!(matches!(
            prepare_land(
                &target,
                &sandbox,
                &state,
                "change-1",
                "tx-1",
                "rev-1",
                paths,
                authority(true, 100),
                10,
            ),
            Err(LandError::CollectionLimit {
                kind: "Land paths",
                limit: MAX_LAND_ENTRIES
            })
        ));
        assert!(!state.join("land-transactions/change-1/tx-1").exists());
    }

    #[test]
    fn prepare_rejects_path_shaped_identifiers_before_creating_state() {
        let (_root, target, sandbox, state) = setup();
        let mut escaped = authority(true, 100);
        escaped.change_id = "../../outside".into();

        assert!(matches!(
            prepare_land(
                &target,
                &sandbox,
                &state,
                "../../outside",
                "tx-1",
                "rev-1",
                [PathBuf::from("a.txt")],
                escaped,
                10,
            ),
            Err(LandError::UnsafeIdentifier(_))
        ));
        assert!(!state.exists());
    }

    #[cfg(unix)]
    #[test]
    fn prepare_rejects_symlinked_roots_and_hardlinked_files() {
        use std::os::unix::fs::symlink;
        let (root, target, sandbox, state) = setup();
        let target_link = root.path().join("target-link");
        symlink(&target, &target_link).unwrap();
        assert!(matches!(
            prepare_land(
                &target_link,
                &sandbox,
                &state,
                "change-1",
                "tx-1",
                "rev-1",
                [PathBuf::from("a.txt")],
                authority(true, 100),
                10,
            ),
            Err(LandError::UnsafePath(_))
        ));

        let victim = root.path().join("victim");
        fs::write(&victim, b"victim-content").unwrap();
        fs::remove_file(target.join("a.txt")).unwrap();
        fs::hard_link(&victim, target.join("a.txt")).unwrap();
        assert!(matches!(
            prepare_land(
                &target,
                &sandbox,
                &state,
                "change-1",
                "tx-1",
                "rev-1",
                [PathBuf::from("a.txt")],
                authority(true, 100),
                10,
            ),
            Err(LandError::UnsupportedPath(_))
        ));
        assert_eq!(fs::read(victim).unwrap(), b"victim-content");
    }

    #[cfg(unix)]
    #[test]
    fn journal_reader_rejects_symlink_and_hardlink_substitution() {
        use std::os::unix::fs::symlink;
        for hardlink in [false, true] {
            let (_root, target, sandbox, state) = setup();
            let journal = prepare_land(
                &target,
                &sandbox,
                &state,
                "change-1",
                "tx-1",
                "rev-1",
                [PathBuf::from("a.txt")],
                authority(true, 100),
                10,
            )
            .unwrap();
            let source = journal.with_extension("source");
            fs::rename(&journal, &source).unwrap();
            if hardlink {
                fs::hard_link(&source, &journal).unwrap();
            } else {
                symlink(&source, &journal).unwrap();
            }
            assert!(matches!(
                apply_land(&target, &journal, "rev-1", 11, ApplyControl::default()),
                Err(LandError::UnsupportedPath(_))
            ));
            assert_eq!(fs::read(target.join("a.txt")).unwrap(), b"old-a");
        }
    }

    #[test]
    fn forged_backup_path_fails_journal_integrity_before_recovery() {
        let (_root, target, sandbox, state) = setup();
        let journal_path = prepare_land(
            &target,
            &sandbox,
            &state,
            "change-1",
            "tx-1",
            "rev-1",
            [PathBuf::from("a.txt")],
            authority(true, 100),
            10,
        )
        .unwrap();
        let mut journal = load_journal(&journal_path).unwrap();
        journal.plan.entries[0].backup = Some(PathBuf::from("../../outside"));
        save_journal(&journal_path, &journal).unwrap();

        assert!(matches!(
            recover_land(&target, &journal_path, 11),
            Err(LandError::JournalCorrupt)
        ));
        assert_eq!(fs::read(target.join("a.txt")).unwrap(), b"old-a");
    }

    #[test]
    fn conflict_never_overwrites_external_content() {
        let (_root, target, sandbox, state) = setup();
        let journal = prepare_land(
            &target,
            &sandbox,
            &state,
            "change-1",
            "tx-1",
            "rev-1",
            [PathBuf::from("a.txt")],
            authority(true, 100),
            10,
        )
        .unwrap();
        fs::write(target.join("a.txt"), b"external").unwrap();
        assert!(matches!(
            apply_land(&target, &journal, "rev-1", 11, ApplyControl::default()),
            Err(LandError::ApplyRolledBack(_))
        ));
        assert_eq!(fs::read(target.join("a.txt")).unwrap(), b"external");
        assert_eq!(
            load_journal(&journal).unwrap().status,
            LandJournalStatus::RolledBack
        );
    }

    #[test]
    fn checked_land_recomputes_revision_under_lock_before_mutation() {
        let (_root, target, sandbox, state) = setup();
        let journal = prepare_land(
            &target,
            &sandbox,
            &state,
            "change-1",
            "tx-1",
            "rev-1",
            [PathBuf::from("a.txt")],
            authority(true, 100),
            10,
        )
        .unwrap();
        assert!(matches!(
            apply_land_checked(&target, &journal, 11, ApplyControl::default(), |_| {
                Ok("externally-changed".into())
            }),
            Err(LandError::RevisionConflict)
        ));
        assert_eq!(fs::read_to_string(target.join("a.txt")).unwrap(), "old-a");
        assert_eq!(
            load_journal(&journal).unwrap().status,
            LandJournalStatus::Prepared
        );
    }

    #[test]
    fn failed_apply_rolls_back_and_interruption_recovers() {
        let (_root, target, sandbox, state) = setup();
        let journal = prepare_land(
            &target,
            &sandbox,
            &state,
            "change-1",
            "tx-1",
            "rev-1",
            [PathBuf::from("a.txt"), PathBuf::from("b.txt")],
            authority(true, 100),
            10,
        )
        .unwrap();
        assert!(matches!(
            apply_land(
                &target,
                &journal,
                "rev-1",
                11,
                ApplyControl {
                    fail_after_paths: Some(1),
                    interrupt_after_paths: None
                }
            ),
            Err(LandError::ApplyRolledBack(_))
        ));
        assert_eq!(fs::read(target.join("a.txt")).unwrap(), b"old-a");
        assert_eq!(
            load_journal(&journal).unwrap().status,
            LandJournalStatus::RolledBack
        );

        let journal2 = prepare_land(
            &target,
            &sandbox,
            &state,
            "change-1",
            "tx-2",
            "rev-1",
            [PathBuf::from("a.txt")],
            ExternalLandAuthority {
                transaction_id: "tx-2".into(),
                ..authority(true, 100)
            },
            12,
        )
        .unwrap();
        assert!(matches!(
            apply_land(
                &target,
                &journal2,
                "rev-1",
                13,
                ApplyControl {
                    interrupt_after_paths: Some(1),
                    fail_after_paths: None
                }
            ),
            Err(LandError::Interrupted)
        ));
        assert_eq!(fs::read(target.join("a.txt")).unwrap(), b"new-a");
        let recovered = recover_land(&target, &journal2, 14).unwrap();
        assert_eq!(recovered.status, LandJournalStatus::RolledBack);
        assert_eq!(fs::read(target.join("a.txt")).unwrap(), b"old-a");
    }

    #[test]
    fn verified_land_archives_review_and_usage_without_commit_or_push() {
        let (_root, target, sandbox, state) = setup();
        let journal = prepare_land(
            &target,
            &sandbox,
            &state,
            "change-1",
            "tx-1",
            "rev-1",
            [PathBuf::from("a.txt")],
            authority(true, 100),
            10,
        )
        .unwrap();
        apply_land(&target, &journal, "rev-1", 11, ApplyControl::default()).unwrap();
        let reviews = vec![ReviewAttempt {
            attempt_id: "review-1".into(),
            context: ReviewContext {
                reviewer_session_id: "reviewer".into(),
                implementation_session_id: "implementation".into(),
                clean_context: true,
                reviewer_model_family: "family-b".into(),
                implementation_model_family: "family-a".into(),
                independent_model_family_required: true,
            },
            findings: vec![],
            completed_at_ms: 9,
            passed: true,
            workspace_revision: "rev-1".into(),
            risk_triggers: BTreeSet::new(),
        }];
        let archive = archive_land(
            &target,
            &journal,
            &state.join("archive"),
            &reviews,
            &UsageLedger::default(),
            12,
        )
        .unwrap();
        assert_eq!(archive.review_attempts, reviews);
        assert!(!archive.commit_performed && !archive.push_performed);
        assert_eq!(
            load_journal(&journal).unwrap().status,
            LandJournalStatus::Archived
        );
    }

    #[cfg(unix)]
    #[test]
    fn archive_rejects_symlinked_directory_without_external_write() {
        use std::os::unix::fs::symlink;
        let (root, target, sandbox, state) = setup();
        let journal = prepare_land(
            &target,
            &sandbox,
            &state,
            "change-1",
            "tx-1",
            "rev-1",
            [PathBuf::from("a.txt")],
            authority(true, 100),
            10,
        )
        .unwrap();
        apply_land(&target, &journal, "rev-1", 11, ApplyControl::default()).unwrap();
        let outside = root.path().join("outside-archive");
        fs::create_dir(&outside).unwrap();
        let archive_link = root.path().join("archive-link");
        symlink(&outside, &archive_link).unwrap();

        assert!(matches!(
            archive_land(
                &target,
                &journal,
                &archive_link,
                &[],
                &UsageLedger::default(),
                12,
            ),
            Err(LandError::UnsafePath(_))
        ));
        assert!(!outside.join("change-1.json").exists());
        assert_eq!(
            load_journal(&journal).unwrap().status,
            LandJournalStatus::Verified
        );
    }
}
