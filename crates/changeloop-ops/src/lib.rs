use changeloop_protocol::redact_sensitive_value;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use thiserror::Error;

mod release;
pub use release::*;

mod lifecycle_service;
pub use lifecycle_service::*;

pub mod executor_approval;
pub use executor_approval::{
    ApprovalError, ApprovalProvenance, ApprovalRecord, ApprovalStore, ApprovedExecutor,
    CompiledInExecutor, ExecutorKind, ExecutorRequest, ResolvedExecutor,
};

const MAX_OPS_JSON_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MIGRATION_TREE_ENTRIES: usize = 100_000;
const MAX_MIGRATION_TREE_DEPTH: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxSelection {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunSetup {
    pub version: u16,
    pub provider: String,
    pub model: String,
    pub privacy_disclosure_accepted: bool,
    pub provider_data_disclosure_accepted: bool,
    pub local_only_telemetry: bool,
    pub analytics_enabled: bool,
    pub crash_upload_enabled: bool,
    pub sandbox: SandboxSelection,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxDiagnostic {
    pub requested: SandboxSelection,
    pub workspace_exists: bool,
    pub workspace_writable: bool,
    pub platform_isolation_available: bool,
    pub effective: SandboxSelection,
    pub warning: Option<String>,
}

pub fn provider_data_disclosure(provider: &str) -> Result<&'static str, OpsError> {
    match provider {
        "anthropic" => Ok(
            "Prompts, selected repository context, and tool results are sent to Anthropic under the account's official API data policy.",
        ),
        "openai" => Ok(
            "Prompts, selected repository context, and tool results are sent to OpenAI under the account's official API data policy.",
        ),
        _ => Err(OpsError::InvalidSetup(
            "provider must be 'anthropic' or 'openai'".into(),
        )),
    }
}

pub fn diagnose_sandbox(workspace: &Path, requested: SandboxSelection) -> SandboxDiagnostic {
    let workspace_exists = workspace.is_dir();
    let workspace_writable = workspace
        .metadata()
        .map(|metadata| !metadata.permissions().readonly())
        .unwrap_or(false);
    let platform_isolation_available = cfg!(target_os = "macos") || cfg!(target_os = "linux");
    let (effective, warning) = if requested == SandboxSelection::ReadOnly {
        (SandboxSelection::ReadOnly, None)
    } else if !workspace_exists || !workspace_writable {
        (
            SandboxSelection::ReadOnly,
            Some("workspace mutation is unavailable; downgraded to read-only".into()),
        )
    } else if !platform_isolation_available {
        (
            SandboxSelection::ReadOnly,
            Some("platform isolation is unavailable; downgraded to read-only".into()),
        )
    } else {
        (requested.clone(), None)
    };
    SandboxDiagnostic {
        requested,
        workspace_exists,
        workspace_writable,
        platform_isolation_available,
        effective,
        warning,
    }
}

pub fn save_first_run_setup(path: &Path, setup: &FirstRunSetup) -> Result<(), OpsError> {
    validate_first_run_setup(setup)?;
    // This schema intentionally has no credential field. Credentials are stored
    // separately through CredentialStore/OS keyring.
    write_json_atomic_ops(path, setup)
}

fn validate_first_run_setup(setup: &FirstRunSetup) -> Result<(), OpsError> {
    if setup.version != 1 {
        return Err(OpsError::InvalidSetup(
            "setup schema version must be 1".into(),
        ));
    }
    provider_data_disclosure(&setup.provider)?;
    if setup.model.is_empty()
        || setup.model.len() > 256
        || setup
            .model
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(OpsError::InvalidSetup(
            "model must be non-empty, at most 256 bytes, and contain no control or whitespace characters"
                .into(),
        ));
    }
    if !setup.privacy_disclosure_accepted || !setup.provider_data_disclosure_accepted {
        return Err(OpsError::DisclosureRequired);
    }
    if !setup.local_only_telemetry || setup.analytics_enabled || setup.crash_upload_enabled {
        return Err(OpsError::InvalidSetup(
            "first-run telemetry must remain local with analytics and crash upload disabled".into(),
        ));
    }
    Ok(())
}

pub fn load_first_run_setup(path: &Path) -> Result<Option<FirstRunSetup>, OpsError> {
    match read_limited_json(path, "first-run setup") {
        Ok(bytes) => {
            let setup = serde_json::from_slice(&bytes)?;
            validate_first_run_setup(&setup)?;
            Ok(Some(setup))
        }
        Err(OpsError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn write_json_atomic_ops(path: &Path, value: &impl Serialize) -> Result<(), OpsError> {
    let parent = path
        .parent()
        .ok_or_else(|| OpsError::InvalidSetup("setup path has no parent".into()))?;
    fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec_pretty(value)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_OPS_JSON_BYTES {
        return Err(OpsError::InputTooLarge {
            label: "operations state",
            limit: MAX_OPS_JSON_BYTES,
        });
    }
    write_atomic_bytes_ops(path, &bytes)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationItem {
    pub source: String,
    pub sha256: String,
    pub bytes: u64,
    pub action: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationPlan {
    pub version: u16,
    pub root: String,
    pub items: Vec<MigrationItem>,
    pub conflicts: Vec<String>,
    pub preserves: Vec<String>,
    pub digest: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum JournalState {
    Prepared,
    Completed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Journal {
    state: JournalState,
    plan: MigrationPlan,
    config_hash: Option<String>,
    receipts_hash: Option<String>,
}

pub fn plan(root: &Path) -> Result<MigrationPlan, OpsError> {
    let root = fs::canonicalize(root)?;
    let mut items = Vec::new();
    for (source, action) in [
        ("foundation.json", "create changeloop.json"),
        (".foundation/receipts", "import receipts"),
    ] {
        let path = root.join(source);
        if path.exists() {
            let (sha256, bytes) = hash_tree(&path)?;
            items.push(MigrationItem {
                source: source.into(),
                sha256,
                bytes,
                action: action.into(),
            });
        }
    }
    let conflicts = if root.join("changeloop.json").exists() {
        vec!["changeloop.json already exists".into()]
    } else {
        Vec::new()
    };
    let mut plan = MigrationPlan {
        version: 1,
        root: root.to_string_lossy().into_owned(),
        items,
        conflicts,
        preserves: vec![
            "foundation.json".into(),
            ".foundation/".into(),
            ".workflow/".into(),
        ],
        digest: String::new(),
    };
    plan.digest = plan_digest(&plan)?;
    Ok(plan)
}

pub fn apply(root: &Path, expected_digest: &str) -> Result<MigrationPlan, OpsError> {
    let root = fs::canonicalize(root)?;
    let root = root.as_path();
    let state = root.join(".changeloop");
    fs::create_dir_all(&state)?;
    if !fs::symlink_metadata(&state)?.file_type().is_dir() {
        return Err(OpsError::Symlink(state));
    }
    let lock = open_migration_lock(&state.join("migrate.lock"))?;
    lock.try_lock_exclusive().map_err(|_| OpsError::Locked)?;
    let journal_path = state.join("migration-journal.json");
    if journal_path.exists() {
        if fs::symlink_metadata(&journal_path)?
            .file_type()
            .is_symlink()
        {
            return Err(OpsError::RecoveryJournal(
                "journal must not be a symbolic link".into(),
            ));
        }
        let journal: Journal =
            serde_json::from_slice(&read_limited_json(&journal_path, "migration journal")?)
                .map_err(|error| OpsError::RecoveryJournal(error.to_string()))?;
        if journal.plan.digest != expected_digest {
            return Err(OpsError::PendingMigration {
                pending_digest: journal.plan.digest,
                requested_digest: expected_digest.to_owned(),
            });
        }
        verify_sources(root, &journal.plan)?;
        return recover(root, &journal_path, journal);
    }
    let current = plan(root)?;
    if current.digest != expected_digest {
        return Err(OpsError::PlanChanged);
    }
    if !current.conflicts.is_empty() {
        return Err(OpsError::Conflict);
    }
    let stage = state.join("migration-stage");
    if stage.exists() {
        fs::remove_dir_all(&stage)?;
    }
    fs::create_dir(&stage)?;
    let mut config_hash = None;
    if root.join("foundation.json").exists() {
        let legacy: Value = serde_json::from_slice(&read_limited_json(
            &root.join("foundation.json"),
            "legacy configuration",
        )?)?;
        let bytes = serde_json::to_vec_pretty(&json!({"version":1,"legacyFoundation":legacy}))?;
        write_synced(&stage.join("changeloop.json"), &bytes)?;
        config_hash = Some(digest(&bytes));
    }
    let mut receipts_hash = None;
    if root.join(".foundation/receipts").exists() {
        copy_tree(
            &root.join(".foundation/receipts"),
            &stage.join("legacy-receipts"),
        )?;
        receipts_hash = Some(hash_tree(&stage.join("legacy-receipts"))?.0);
    }
    sync_directory(&stage)?;
    let journal = Journal {
        state: JournalState::Prepared,
        plan: current.clone(),
        config_hash,
        receipts_hash,
    };
    write_journal(&journal_path, &journal)?;
    recover(root, &journal_path, journal)
}

fn open_migration_lock(path: &Path) -> Result<File, OpsError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err(OpsError::RecoveryJournal(
                "migration lock must be a regular non-symlink file".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(OpsError::RecoveryJournal(
            "migration lock must be a regular file".into(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(OpsError::RecoveryJournal(
                "migration lock must have exactly one hard link".into(),
            ));
        }
    }
    Ok(file)
}

fn recover(
    root: &Path,
    journal_path: &Path,
    mut journal: Journal,
) -> Result<MigrationPlan, OpsError> {
    let state = root.join(".changeloop");
    let stage = state.join("migration-stage");
    let receipts_created = promote(
        &stage.join("legacy-receipts"),
        &state.join("legacy-receipts"),
        journal.receipts_hash.as_deref(),
    )?;
    if let Err(error) = promote(
        &stage.join("changeloop.json"),
        &root.join("changeloop.json"),
        journal.config_hash.as_deref(),
    ) {
        if receipts_created {
            rollback_created(
                &state.join("legacy-receipts"),
                journal.receipts_hash.as_deref(),
            )?;
            sync_directory(&state)?;
        }
        return Err(error);
    }
    sync_directory(root)?;
    sync_directory(&state)?;
    journal.state = JournalState::Completed;
    write_journal(journal_path, &journal)?;
    if stage.exists() {
        fs::remove_dir_all(stage)?;
    }
    Ok(journal.plan)
}

fn promote(stage: &Path, target: &Path, expected: Option<&str>) -> Result<bool, OpsError> {
    let Some(expected) = expected else {
        return Ok(false);
    };
    if target.exists() {
        if hash_tree(target)?.0 == expected {
            return Ok(false);
        }
        return Err(OpsError::RecoveryConflict);
    }
    if !stage.exists() {
        return Err(OpsError::RecoveryConflict);
    }
    fs::rename(stage, target)?;
    Ok(true)
}

fn rollback_created(target: &Path, expected: Option<&str>) -> Result<(), OpsError> {
    if target.exists()
        && expected.is_some_and(|hash| hash_tree(target).is_ok_and(|value| value.0 == hash))
    {
        if target.is_dir() {
            fs::remove_dir_all(target)?
        } else {
            fs::remove_file(target)?
        }
    }
    Ok(())
}

fn verify_sources(root: &Path, original: &MigrationPlan) -> Result<(), OpsError> {
    for item in &original.items {
        let (hash, bytes) = hash_tree(&root.join(&item.source))?;
        if hash != item.sha256 || bytes != item.bytes {
            return Err(OpsError::PlanChanged);
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PrivacySession {
    pub id: String,
    pub active: bool,
    pub evidence_refs: u64,
    pub data: Value,
    pub provenance: Vec<String>,
}
pub fn privacy_inspect(path: &Path) -> Result<Value, OpsError> {
    let sessions = read_sessions(path)?;
    Ok(redact(json!({
        "destinations":["selected model provider","explicit external tools"],
        "localOnlyTelemetry":true,
        "retained":{"sessions":sessions.len(),"path":path}
    })))
}

pub fn privacy_inspect_detailed(
    sessions_path: &Path,
    project_root: &Path,
    user_config: &Path,
    provider: Option<&str>,
    analytics_enabled: bool,
    crash_upload_enabled: bool,
) -> Result<Value, OpsError> {
    let sessions = read_sessions(sessions_path)?;
    let provider_destination = provider.map(|name| format!("official {name} API"));
    Ok(redact(json!({
        "localOnlyTelemetry":true,
        "analyticsEnabled":analytics_enabled,
        "crashUploadEnabled":crash_upload_enabled,
        "destinations":{
            "modelProvider":provider_destination,
            "modelProviderData":"prompt and selected context/tool results only during an explicit model execution",
            "externalTools":"only tools explicitly invoked by the user or active change policy",
            "analytics":if analytics_enabled {"configured; no analytics uploader is implemented"} else {"disabled"},
            "crashUpload":if crash_upload_enabled {"configured separately; no crash uploader is implemented"} else {"disabled"}
        },
        "paths":{
            "projectRoot":project_root,
            "projectState":project_root.join(".changeloop"),
            "sessions":sessions_path,
            "userConfig":user_config,
            "credentialStorage":"operating-system credential store (secret values are not persisted in these paths)"
        },
        "retained":{
            "sessions":sessions.len(),
            "sessionIndex":sessions_path,
            "sqlite":project_root.join(".changeloop/state.db"),
            "proofs":project_root.join(".changeloop/proofs"),
            "reviews":project_root.join(".changeloop/reviews"),
            "snapshots":project_root.join(".changeloop/snapshots"),
            "hookAudits":project_root.join(".changeloop/hooks")
        },
        "uploadedByDefault":[]
    })))
}
pub fn privacy_export(path: &Path, id: &str) -> Result<Value, OpsError> {
    let session = read_sessions(path)?.remove(id).ok_or(OpsError::NotFound)?;
    Ok(redact(serde_json::to_value(session)?))
}
pub fn privacy_export_all(path: &Path) -> Result<Value, OpsError> {
    let sessions = read_sessions(path)?;
    Ok(redact(json!({
        "schemaVersion": 1,
        "sessions": sessions,
        "provenanceIncluded": true
    })))
}
pub fn privacy_delete(path: &Path, id: &str) -> Result<(), OpsError> {
    let mut sessions = read_sessions(path)?;
    let session = sessions.get(id).ok_or(OpsError::NotFound)?;
    if session.active || session.evidence_refs > 0 {
        return Err(OpsError::Referenced);
    }
    sessions.remove(id);
    write_sessions(path, &sessions)
}
pub fn privacy_deletable_ids(path: &Path, id: Option<&str>) -> Result<Vec<String>, OpsError> {
    let sessions = read_sessions(path)?;
    match id {
        Some(id) => {
            let session = sessions.get(id).ok_or(OpsError::NotFound)?;
            if session.active || session.evidence_refs > 0 {
                return Err(OpsError::Referenced);
            }
            Ok(vec![id.to_owned()])
        }
        None => Ok(sessions
            .iter()
            .filter(|(_, session)| !session.active && session.evidence_refs == 0)
            .map(|(id, _)| id.clone())
            .collect()),
    }
}
pub fn privacy_delete_unreferenced(path: &Path) -> Result<Vec<String>, OpsError> {
    let mut sessions = read_sessions(path)?;
    let deleted = sessions
        .iter()
        .filter(|(_, session)| !session.active && session.evidence_refs == 0)
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    for id in &deleted {
        sessions.remove(id);
    }
    write_sessions(path, &sessions)?;
    Ok(deleted)
}
pub fn write_privacy_sessions(
    path: &Path,
    sessions: &BTreeMap<String, PrivacySession>,
) -> Result<(), OpsError> {
    write_sessions(path, sessions)
}

pub fn upsert_privacy_session(path: &Path, mut session: PrivacySession) -> Result<(), OpsError> {
    session.data = redact(session.data);
    let mut sessions = read_sessions(path)?;
    sessions.insert(session.id.clone(), session);
    write_sessions(path, &sessions)
}

pub fn update_privacy_lifecycle(
    path: &Path,
    id: &str,
    active: bool,
    evidence_refs: u64,
) -> Result<(), OpsError> {
    let mut sessions = read_sessions(path)?;
    let session = sessions.entry(id.into()).or_insert_with(|| PrivacySession {
        id: id.into(),
        active,
        evidence_refs,
        data: Value::Null,
        provenance: vec!["legacy-operational-state".into()],
    });
    session.active = active;
    session.evidence_refs = evidence_refs;
    write_sessions(path, &sessions)
}

fn read_sessions(path: &Path) -> Result<BTreeMap<String, PrivacySession>, OpsError> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    Ok(serde_json::from_slice(&read_limited_json(
        path,
        "privacy session registry",
    )?)?)
}
fn write_sessions(
    path: &Path,
    sessions: &BTreeMap<String, PrivacySession>,
) -> Result<(), OpsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let redacted = redact_sensitive_value(&serde_json::to_value(sessions)?);
    let bytes = serde_json::to_vec_pretty(&redacted)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_OPS_JSON_BYTES {
        return Err(OpsError::InputTooLarge {
            label: "privacy session registry",
            limit: MAX_OPS_JSON_BYTES,
        });
    }
    write_atomic_bytes_ops(path, &bytes)
}
fn redact(value: Value) -> Value {
    redact_sensitive_value(&value)
}

fn plan_digest(plan: &MigrationPlan) -> Result<String, OpsError> {
    let mut unsigned = plan.clone();
    unsigned.digest.clear();
    Ok(digest(&serde_json::to_vec(&unsigned)?))
}
fn hash_tree(path: &Path) -> Result<(String, u64), OpsError> {
    hash_tree_bounded(path, &mut 0, 0)
}
fn hash_tree_bounded(
    path: &Path,
    entries_seen: &mut usize,
    depth: usize,
) -> Result<(String, u64), OpsError> {
    if depth > MAX_MIGRATION_TREE_DEPTH {
        return Err(OpsError::TraversalDepth {
            limit: MAX_MIGRATION_TREE_DEPTH,
        });
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(OpsError::Symlink(path.to_path_buf()));
    }
    if metadata.is_file() {
        return digest_file(path);
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(path)? {
        *entries_seen = entries_seen.saturating_add(1);
        if *entries_seen > MAX_MIGRATION_TREE_ENTRIES {
            return Err(OpsError::TraversalLimit {
                limit: MAX_MIGRATION_TREE_ENTRIES,
            });
        }
        entries.push(entry?);
    }
    entries.sort_by_key(|entry| entry.file_name());
    let mut manifest = Sha256::new();
    let mut total = 0_u64;
    for entry in entries {
        let (hash, bytes) = hash_tree_bounded(&entry.path(), entries_seen, depth + 1)?;
        total = total.saturating_add(bytes);
        manifest.update(file_name_bytes(&entry.file_name()));
        manifest.update([0]);
        manifest.update(hash.as_bytes());
        manifest.update(bytes.to_be_bytes());
    }
    Ok((format!("{:x}", manifest.finalize()), total))
}

fn file_name_bytes(name: &std::ffi::OsStr) -> Vec<u8> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        name.as_bytes().to_vec()
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        name.encode_wide()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>()
    }
    #[cfg(not(any(unix, windows)))]
    {
        name.to_string_lossy().as_bytes().to_vec()
    }
}
fn copy_tree(source: &Path, destination: &Path) -> Result<(), OpsError> {
    copy_tree_bounded(source, destination, &mut 0, 0)
}
fn copy_tree_bounded(
    source: &Path,
    destination: &Path,
    entries_seen: &mut usize,
    depth: usize,
) -> Result<(), OpsError> {
    if depth > MAX_MIGRATION_TREE_DEPTH {
        return Err(OpsError::TraversalDepth {
            limit: MAX_MIGRATION_TREE_DEPTH,
        });
    }
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        *entries_seen = entries_seen.saturating_add(1);
        if *entries_seen > MAX_MIGRATION_TREE_ENTRIES {
            return Err(OpsError::TraversalLimit {
                limit: MAX_MIGRATION_TREE_ENTRIES,
            });
        }
        let target = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            return Err(OpsError::Symlink(entry.path()));
        }
        if file_type.is_dir() {
            copy_tree_bounded(&entry.path(), &target, entries_seen, depth + 1)?
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    sync_directory(destination)
}
fn write_journal(path: &Path, journal: &Journal) -> Result<(), OpsError> {
    let bytes = serde_json::to_vec_pretty(journal)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_OPS_JSON_BYTES {
        return Err(OpsError::InputTooLarge {
            label: "migration journal",
            limit: MAX_OPS_JSON_BYTES,
        });
    }
    write_atomic_bytes_ops(path, &bytes)
}

static STATE_STAGE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn write_atomic_bytes_ops(path: &Path, bytes: &[u8]) -> Result<(), OpsError> {
    let parent = path
        .parent()
        .ok_or_else(|| OpsError::RecoveryJournal("state path has no parent".into()))?;
    let identity = parent_identity(parent)?;
    let name = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or("state");
    let mut staged = None;
    for _ in 0..32 {
        let sequence = STATE_STAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.{}.{}.stage", std::process::id(), sequence));
        match write_synced(&candidate, bytes) {
            Ok(()) => {
                staged = Some(candidate);
                break;
            }
            Err(OpsError::Io(error)) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    let stage = staged.ok_or_else(|| {
        OpsError::RecoveryJournal("could not allocate a unique state staging file".into())
    })?;
    let result = (|| {
        verify_parent_identity(parent, &identity)?;
        fs::rename(&stage, path)?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&stage);
    }
    result
}

struct ParentIdentity {
    canonical: PathBuf,
    metadata: fs::Metadata,
}

fn parent_identity(parent: &Path) -> Result<ParentIdentity, OpsError> {
    let metadata = fs::symlink_metadata(parent)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(OpsError::Symlink(parent.to_path_buf()));
    }
    Ok(ParentIdentity {
        canonical: fs::canonicalize(parent)?,
        metadata,
    })
}

fn verify_parent_identity(parent: &Path, expected: &ParentIdentity) -> Result<(), OpsError> {
    let current = fs::symlink_metadata(parent)?;
    if !current.is_dir()
        || current.file_type().is_symlink()
        || fs::canonicalize(parent)? != expected.canonical
    {
        return Err(OpsError::Symlink(parent.to_path_buf()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if current.dev() != expected.metadata.dev() || current.ino() != expected.metadata.ino() {
            return Err(OpsError::Symlink(parent.to_path_buf()));
        }
    }
    Ok(())
}
fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), OpsError> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    Ok(())
}
fn sync_directory(path: &Path) -> Result<(), OpsError> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    Ok(())
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn digest_file(path: &Path) -> Result<(String, u64), OpsError> {
    let mut file = File::open(path)?;
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
    Ok((format!("{:x}", digest.finalize()), bytes))
}

fn read_limited_json(path: &Path, label: &'static str) -> Result<Vec<u8>, OpsError> {
    let path_metadata = fs::symlink_metadata(path)?;
    validate_state_file_metadata(&path_metadata, path, label)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options.open(path)?;
    validate_state_file_metadata(&file.metadata()?, path, label)?;
    let mut bytes = Vec::new();
    file.take(MAX_OPS_JSON_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_OPS_JSON_BYTES {
        return Err(OpsError::InputTooLarge {
            label,
            limit: MAX_OPS_JSON_BYTES,
        });
    }
    Ok(bytes)
}

fn validate_state_file_metadata(
    metadata: &fs::Metadata,
    path: &Path,
    label: &'static str,
) -> Result<(), OpsError> {
    if !metadata.file_type().is_file() {
        return Err(OpsError::RecoveryJournal(format!(
            "{label} must be a regular non-symlink file: {}",
            path.display()
        )));
    }
    if metadata.len() > MAX_OPS_JSON_BYTES {
        return Err(OpsError::InputTooLarge {
            label,
            limit: MAX_OPS_JSON_BYTES,
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(OpsError::RecoveryJournal(format!(
                "{label} must have exactly one hard link: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum OpsError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{label} exceeds the safe {limit}-byte limit")]
    InputTooLarge { label: &'static str, limit: u64 },
    #[error("migration plan changed")]
    PlanChanged,
    #[error("migration conflict")]
    Conflict,
    #[error("migration lock held")]
    Locked,
    #[error("migration recovery found conflicting promoted data")]
    RecoveryConflict,
    #[error(
        "migration recovery is pending for plan {pending_digest}; requested plan {requested_digest} cannot replace it"
    )]
    PendingMigration {
        pending_digest: String,
        requested_digest: String,
    },
    #[error("migration recovery journal is invalid: {0}")]
    RecoveryJournal(String),
    #[error("migration source contains a symlink: {0}")]
    Symlink(std::path::PathBuf),
    #[error("migration tree exceeds the safe {limit}-entry limit")]
    TraversalLimit { limit: usize },
    #[error("migration tree exceeds the safe {limit}-level depth limit")]
    TraversalDepth { limit: usize },
    #[error("session not found")]
    NotFound,
    #[error("session active or evidence referenced")]
    Referenced,
    #[error("first-run setup is invalid: {0}")]
    InvalidSetup(String),
    #[error("privacy and provider-data disclosures must be accepted explicitly")]
    DisclosureRequired,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture() -> tempfile::TempDir {
        let root = tempdir().unwrap();
        fs::write(root.path().join("foundation.json"), br#"{"version":1}"#).unwrap();
        fs::create_dir_all(root.path().join(".foundation/receipts/nested")).unwrap();
        fs::write(root.path().join(".foundation/receipts/a.json"), b"abc").unwrap();
        fs::write(
            root.path().join(".foundation/receipts/nested/b.json"),
            b"12345",
        )
        .unwrap();
        fs::create_dir(root.path().join(".workflow")).unwrap();
        root
    }

    #[test]
    fn plan_is_deterministic_and_directory_bytes_are_file_bytes() {
        let root = fixture();
        let first = plan(root.path()).unwrap();
        assert_eq!(first, plan(root.path()).unwrap());
        assert_eq!(
            first
                .items
                .iter()
                .find(|item| item.source.contains("receipts"))
                .unwrap()
                .bytes,
            8
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn migration_hash_distinguishes_non_utf8_receipt_names() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let root = fixture();
        let receipts = root.path().join(".foundation/receipts");
        let first_name = OsString::from_vec(vec![b'x', 0x80]);
        let second_name = OsString::from_vec(vec![b'x', 0x81]);
        fs::write(receipts.join(&first_name), b"same bytes").unwrap();
        let first = plan(root.path()).unwrap();
        fs::rename(receipts.join(first_name), receipts.join(second_name)).unwrap();
        let second = plan(root.path()).unwrap();
        assert_ne!(first.digest, second.digest);
    }

    #[test]
    fn changed_source_rejects_apply_and_conflict_is_reported() {
        let root = fixture();
        let planned = plan(root.path()).unwrap();
        fs::write(root.path().join("foundation.json"), b"{}").unwrap();
        assert!(matches!(
            apply(root.path(), &planned.digest),
            Err(OpsError::PlanChanged)
        ));
        fs::write(root.path().join("changeloop.json"), b"{}").unwrap();
        assert!(!plan(root.path()).unwrap().conflicts.is_empty());
    }

    #[test]
    fn apply_is_idempotent_and_preserves_all_legacy_sources() {
        let root = fixture();
        let planned = plan(root.path()).unwrap();
        assert_eq!(
            apply(root.path(), &planned.digest).unwrap().digest,
            planned.digest
        );
        assert_eq!(
            apply(root.path(), &planned.digest).unwrap().digest,
            planned.digest
        );
        assert!(root.path().join("foundation.json").exists());
        assert!(root.path().join(".foundation/receipts/a.json").exists());
        assert!(root.path().join(".workflow").exists());
        assert_eq!(
            fs::read(
                root.path()
                    .join(".changeloop/legacy-receipts/nested/b.json")
            )
            .unwrap(),
            b"12345"
        );
    }

    #[test]
    fn migration_preserves_unknown_legacy_fields_binary_receipts_and_workflow_bytes() {
        let root = fixture();
        let legacy = json!({
            "version": 12,
            "unknownFutureField": {"nested": [true, 7, "kept"]},
            "execution": {"packetBytes": 1234}
        });
        fs::write(
            root.path().join("foundation.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let binary = [0_u8, 255, 1, 0, 128, 42];
        fs::write(root.path().join(".foundation/receipts/binary.bin"), binary).unwrap();
        fs::write(root.path().join(".workflow/provenance.bin"), binary).unwrap();
        fs::write(root.path().join("unrelated-dirty.txt"), b"user edit").unwrap();

        let planned = plan(root.path()).unwrap();
        apply(root.path(), &planned.digest).unwrap();

        let migrated: Value =
            serde_json::from_slice(&fs::read(root.path().join("changeloop.json")).unwrap())
                .unwrap();
        assert_eq!(migrated["legacyFoundation"], legacy);
        assert_eq!(
            fs::read(root.path().join(".changeloop/legacy-receipts/binary.bin")).unwrap(),
            binary
        );
        assert_eq!(
            fs::read(root.path().join(".workflow/provenance.bin")).unwrap(),
            binary
        );
        assert_eq!(
            fs::read(root.path().join("unrelated-dirty.txt")).unwrap(),
            b"user edit"
        );
    }

    #[cfg(unix)]
    #[test]
    fn migration_plan_is_stable_across_root_symlink_aliases() {
        use std::os::unix::fs::symlink;

        let root = fixture();
        let aliases = tempdir().unwrap();
        let alias = aliases.path().join("migration-root-alias");
        symlink(root.path(), &alias).unwrap();
        assert_eq!(plan(root.path()).unwrap(), plan(&alias).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn workflow_symlink_is_preserved_but_receipt_symlink_is_rejected() {
        use std::os::unix::fs::symlink;

        let root = fixture();
        let outside = root.path().join("outside-provenance");
        fs::write(&outside, b"outside").unwrap();
        let provenance_link = root.path().join(".workflow/provenance-link");
        symlink(&outside, &provenance_link).unwrap();
        let planned = plan(root.path()).unwrap();
        apply(root.path(), &planned.digest).unwrap();
        assert_eq!(fs::read_link(&provenance_link).unwrap(), outside);

        let receipt_link = root.path().join(".foundation/receipts/external-link");
        symlink(root.path().join("outside-provenance"), &receipt_link).unwrap();
        assert!(matches!(
            plan(root.path()),
            Err(OpsError::Symlink(path))
                if path.ends_with(Path::new(".foundation/receipts/external-link"))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn migration_rejects_symlinked_state_before_external_mutation() {
        use std::os::unix::fs::symlink;

        let root = fixture();
        let outside = tempdir().unwrap();
        symlink(outside.path(), root.path().join(".changeloop")).unwrap();
        let planned = plan(root.path()).unwrap();

        assert!(matches!(
            apply(root.path(), &planned.digest),
            Err(OpsError::Symlink(path)) if path.ends_with(".changeloop")
        ));
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[test]
    fn pending_journal_cannot_be_replaced_by_another_plan() {
        let root = fixture();
        let planned = plan(root.path()).unwrap();
        let state = root.path().join(".changeloop");
        let stage = state.join("migration-stage");
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("sentinel"), b"pending transaction").unwrap();
        let journal_path = state.join("migration-journal.json");
        write_journal(
            &journal_path,
            &Journal {
                state: JournalState::Prepared,
                plan: planned.clone(),
                config_hash: None,
                receipts_hash: None,
            },
        )
        .unwrap();

        assert!(matches!(
            apply(root.path(), "another-plan"),
            Err(OpsError::PendingMigration { pending_digest, .. })
                if pending_digest == planned.digest
        ));
        assert_eq!(
            fs::read(stage.join("sentinel")).unwrap(),
            b"pending transaction"
        );
    }

    #[test]
    fn corrupt_or_symlinked_recovery_journal_has_typed_outcome() {
        let root = fixture();
        let planned = plan(root.path()).unwrap();
        let state = root.path().join(".changeloop");
        fs::create_dir_all(&state).unwrap();
        let journal = state.join("migration-journal.json");
        fs::write(&journal, b"not-json").unwrap();
        assert!(matches!(
            apply(root.path(), &planned.digest),
            Err(OpsError::RecoveryJournal(_))
        ));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::remove_file(&journal).unwrap();
            let outside = root.path().join("outside-journal.json");
            fs::write(&outside, b"{}").unwrap();
            symlink(&outside, &journal).unwrap();
            assert!(matches!(
                apply(root.path(), &planned.digest),
                Err(OpsError::RecoveryJournal(_))
            ));
        }
    }

    #[test]
    fn apply_resumes_after_first_promotion_was_interrupted() {
        let root = fixture();
        let planned = plan(root.path()).unwrap();
        let state = root.path().join(".changeloop");
        let stage = state.join("migration-stage");
        fs::create_dir_all(&stage).unwrap();
        let legacy: Value =
            serde_json::from_slice(&fs::read(root.path().join("foundation.json")).unwrap())
                .unwrap();
        let config = serde_json::to_vec_pretty(&json!({
            "version": 1,
            "legacyFoundation": legacy
        }))
        .unwrap();
        fs::write(stage.join("changeloop.json"), &config).unwrap();
        copy_tree(
            &root.path().join(".foundation/receipts"),
            &state.join("legacy-receipts"),
        )
        .unwrap();
        let receipts_hash = hash_tree(&state.join("legacy-receipts")).unwrap().0;
        write_journal(
            &state.join("migration-journal.json"),
            &Journal {
                state: JournalState::Prepared,
                plan: planned.clone(),
                config_hash: Some(digest(&config)),
                receipts_hash: Some(receipts_hash),
            },
        )
        .unwrap();

        assert_eq!(
            apply(root.path(), &planned.digest).unwrap().digest,
            planned.digest
        );
        assert_eq!(
            fs::read(root.path().join("changeloop.json")).unwrap(),
            config
        );
        assert!(!stage.exists());
    }

    #[test]
    fn prepared_recovery_rolls_back_its_first_promotion_on_later_conflict() {
        let root = fixture();
        let planned = plan(root.path()).unwrap();
        let state = root.path().join(".changeloop");
        let stage = state.join("migration-stage");
        fs::create_dir_all(stage.join("legacy-receipts")).unwrap();
        fs::write(stage.join("legacy-receipts/a"), b"receipt").unwrap();
        fs::write(stage.join("changeloop.json"), b"expected").unwrap();
        fs::write(root.path().join("changeloop.json"), b"external").unwrap();
        let journal_path = state.join("migration-journal.json");
        let journal = Journal {
            state: JournalState::Prepared,
            plan: planned,
            config_hash: Some(digest(b"expected")),
            receipts_hash: Some(hash_tree(&stage.join("legacy-receipts")).unwrap().0),
        };
        assert!(matches!(
            recover(root.path(), &journal_path, journal),
            Err(OpsError::RecoveryConflict)
        ));
        assert!(!state.join("legacy-receipts").exists());
        assert_eq!(
            fs::read(root.path().join("changeloop.json")).unwrap(),
            b"external"
        );
    }

    #[test]
    fn privacy_redacts_export_and_delete_guards_references() {
        let root = tempdir().unwrap();
        let path = root.path().join("sessions.json");
        let mut sessions = BTreeMap::new();
        sessions.insert(
            "active".into(),
            PrivacySession {
                id: "active".into(),
                active: true,
                evidence_refs: 0,
                data: json!({"token":"raw"}),
                provenance: vec!["user-input".into()],
            },
        );
        sessions.insert(
            "kept".into(),
            PrivacySession {
                id: "kept".into(),
                active: false,
                evidence_refs: 1,
                data: json!({}),
                provenance: vec![],
            },
        );
        sessions.insert(
            "delete".into(),
            PrivacySession {
                id: "delete".into(),
                active: false,
                evidence_refs: 0,
                data: json!({"nested":{"password":"raw"}}),
                provenance: vec!["tool-output".into()],
            },
        );
        write_privacy_sessions(&path, &sessions).unwrap();
        let exported = privacy_export(&path, "active").unwrap();
        assert_eq!(exported["data"]["token"], "[REDACTED]");
        let all = privacy_export_all(&path).unwrap();
        assert_eq!(all["schemaVersion"], 1);
        assert_eq!(all["sessions"]["active"]["data"]["token"], "[REDACTED]");
        assert!(matches!(
            privacy_delete(&path, "active"),
            Err(OpsError::Referenced)
        ));
        assert!(matches!(
            privacy_delete(&path, "kept"),
            Err(OpsError::Referenced)
        ));
        assert_eq!(privacy_delete_unreferenced(&path).unwrap(), ["delete"]);
        assert!(privacy_export(&path, "active").is_ok());
        assert!(privacy_export(&path, "kept").is_ok());
        assert!(matches!(
            privacy_export(&path, "delete"),
            Err(OpsError::NotFound)
        ));
        assert_eq!(privacy_inspect(&path).unwrap()["retained"]["sessions"], 2);
    }

    #[test]
    fn privacy_session_upsert_and_lifecycle_updates_are_durable() {
        let root = tempdir().unwrap();
        let path = root.path().join("sessions.json");
        upsert_privacy_session(
            &path,
            PrivacySession {
                id: "change".into(),
                active: true,
                evidence_refs: 0,
                data: json!({"prompt":"change","apiToken":"must-not-persist"}),
                provenance: vec!["user-input".into()],
            },
        )
        .unwrap();
        update_privacy_lifecycle(&path, "change", false, 1).unwrap();
        let exported = privacy_export(&path, "change").unwrap();
        assert_eq!(exported["active"], false);
        assert_eq!(exported["evidence_refs"], 1);
        assert_eq!(exported["data"]["apiToken"], "[REDACTED]");
        let raw = fs::read(&path).unwrap();
        assert!(
            !raw.windows("must-not-persist".len())
                .any(|window| { window == "must-not-persist".as_bytes() })
        );
        assert!(matches!(
            privacy_delete(&path, "change"),
            Err(OpsError::Referenced)
        ));
    }

    #[test]
    fn first_run_setup_requires_disclosures_and_never_persists_secrets() {
        let root = tempdir().unwrap();
        let path = root.path().join("config/first-run.json");
        let mut setup = FirstRunSetup {
            version: 1,
            provider: "openai".into(),
            model: "gpt-fixture".into(),
            privacy_disclosure_accepted: false,
            provider_data_disclosure_accepted: true,
            local_only_telemetry: true,
            analytics_enabled: false,
            crash_upload_enabled: false,
            sandbox: SandboxSelection::WorkspaceWrite,
        };
        assert!(matches!(
            save_first_run_setup(&path, &setup),
            Err(OpsError::DisclosureRequired)
        ));
        setup.privacy_disclosure_accepted = true;
        save_first_run_setup(&path, &setup).unwrap();
        assert_eq!(load_first_run_setup(&path).unwrap(), Some(setup));
        let persisted = fs::read_to_string(path).unwrap();
        for secret_field in ["apiKey", "token", "credential", "password", "secret"] {
            assert!(!persisted.contains(secret_field));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.path().join("config/first-run.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o077,
                0
            );
        }
    }

    #[test]
    fn first_run_setup_rejects_oversized_json() {
        let root = tempdir().unwrap();
        let path = root.path().join("first-run.json");
        File::create(&path)
            .unwrap()
            .set_len(MAX_OPS_JSON_BYTES + 1)
            .unwrap();

        assert!(matches!(
            load_first_run_setup(&path),
            Err(OpsError::InputTooLarge {
                label: "first-run setup",
                limit: MAX_OPS_JSON_BYTES
            })
        ));
    }

    #[test]
    fn first_run_setup_never_writes_state_it_cannot_reload() {
        let root = tempdir().unwrap();
        let path = root.path().join("first-run.json");
        fs::write(&path, b"{\"sentinel\":true}\n").unwrap();
        let setup = FirstRunSetup {
            version: 1,
            provider: "openai".into(),
            model: "x".repeat(MAX_OPS_JSON_BYTES as usize),
            privacy_disclosure_accepted: true,
            provider_data_disclosure_accepted: true,
            local_only_telemetry: true,
            analytics_enabled: false,
            crash_upload_enabled: false,
            sandbox: SandboxSelection::ReadOnly,
        };

        assert!(matches!(
            save_first_run_setup(&path, &setup),
            Err(OpsError::InvalidSetup(_))
        ));
        assert_eq!(fs::read(&path).unwrap(), b"{\"sentinel\":true}\n");
    }

    #[test]
    fn first_run_setup_revalidates_persisted_authority() {
        let root = tempdir().unwrap();
        let path = root.path().join("first-run.json");
        for invalid in [
            json!({
                "version":2,"provider":"openai","model":"fixture",
                "privacyDisclosureAccepted":true,"providerDataDisclosureAccepted":true,
                "localOnlyTelemetry":true,"analyticsEnabled":false,
                "crashUploadEnabled":false,"sandbox":"read_only"
            }),
            json!({
                "version":1,"provider":"openai","model":"line\nbreak",
                "privacyDisclosureAccepted":true,"providerDataDisclosureAccepted":true,
                "localOnlyTelemetry":true,"analyticsEnabled":false,
                "crashUploadEnabled":false,"sandbox":"read_only"
            }),
            json!({
                "version":1,"provider":"openai","model":"fixture",
                "privacyDisclosureAccepted":true,"providerDataDisclosureAccepted":true,
                "localOnlyTelemetry":true,"analyticsEnabled":true,
                "crashUploadEnabled":false,"sandbox":"read_only"
            }),
        ] {
            fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert!(matches!(
                load_first_run_setup(&path),
                Err(OpsError::InvalidSetup(_))
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn atomic_setup_write_ignores_predictable_stage_symlink() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let directory = root.path().join("config");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("first-run.json");
        let victim = root.path().join("victim");
        fs::write(&victim, b"do-not-touch").unwrap();
        symlink(&victim, directory.join("first-run.stage")).unwrap();
        let setup = FirstRunSetup {
            version: 1,
            provider: "openai".into(),
            model: "fixture".into(),
            privacy_disclosure_accepted: true,
            provider_data_disclosure_accepted: true,
            local_only_telemetry: true,
            analytics_enabled: false,
            crash_upload_enabled: false,
            sandbox: SandboxSelection::ReadOnly,
        };

        save_first_run_setup(&path, &setup).unwrap();
        assert_eq!(fs::read(victim).unwrap(), b"do-not-touch");
        assert_eq!(load_first_run_setup(&path).unwrap(), Some(setup));
    }

    #[cfg(unix)]
    #[test]
    fn persistent_state_readers_reject_hardlinks() {
        let root = tempdir().unwrap();
        let source = root.path().join("source.json");
        let setup_path = root.path().join("first-run.json");
        fs::write(
            &source,
            br#"{"version":1,"provider":"openai","model":"fixture","privacyDisclosureAccepted":true,"providerDataDisclosureAccepted":true,"localOnlyTelemetry":true,"analyticsEnabled":false,"crashUploadEnabled":false,"sandbox":"read_only"}"#,
        )
        .unwrap();
        fs::hard_link(&source, &setup_path).unwrap();

        assert!(matches!(
            load_first_run_setup(&setup_path),
            Err(OpsError::RecoveryJournal(message)) if message.contains("hard link")
        ));
    }

    #[cfg(unix)]
    #[test]
    fn state_writes_reject_symlinked_parent_directories() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let linked = root.path().join("linked");
        symlink(outside.path(), &linked).unwrap();
        let setup = FirstRunSetup {
            version: 1,
            provider: "openai".into(),
            model: "fixture".into(),
            privacy_disclosure_accepted: true,
            provider_data_disclosure_accepted: true,
            local_only_telemetry: true,
            analytics_enabled: false,
            crash_upload_enabled: false,
            sandbox: SandboxSelection::ReadOnly,
        };

        assert!(save_first_run_setup(&linked.join("first-run.json"), &setup).is_err());
        assert!(write_privacy_sessions(&linked.join("privacy.json"), &BTreeMap::new()).is_err());
        assert!(!outside.path().join("first-run.json").exists());
        assert!(!outside.path().join("privacy.json").exists());
    }

    #[test]
    fn migration_tree_walk_fails_closed_at_entry_budget() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("one"), b"value").unwrap();
        let mut entries_seen = MAX_MIGRATION_TREE_ENTRIES;

        assert!(matches!(
            hash_tree_bounded(root.path(), &mut entries_seen, 0),
            Err(OpsError::TraversalLimit {
                limit: MAX_MIGRATION_TREE_ENTRIES
            })
        ));
        assert!(matches!(
            hash_tree_bounded(root.path(), &mut 0, MAX_MIGRATION_TREE_DEPTH + 1),
            Err(OpsError::TraversalDepth {
                limit: MAX_MIGRATION_TREE_DEPTH
            })
        ));
    }

    #[test]
    fn sandbox_diagnostics_fail_safe_and_privacy_paths_are_exact() {
        let root = tempdir().unwrap();
        let missing = diagnose_sandbox(
            &root.path().join("missing"),
            SandboxSelection::DangerFullAccess,
        );
        assert_eq!(missing.effective, SandboxSelection::ReadOnly);
        assert!(missing.warning.is_some());

        let sessions = root
            .path()
            .join("project/.changeloop/privacy-sessions.json");
        let project = root.path().join("project");
        let user = root.path().join("user-config");
        let report =
            privacy_inspect_detailed(&sessions, &project, &user, Some("anthropic"), false, false)
                .unwrap();
        assert_eq!(
            report["paths"]["sessions"],
            sessions.to_string_lossy().as_ref()
        );
        assert_eq!(
            report["paths"]["userConfig"],
            user.to_string_lossy().as_ref()
        );
        assert_eq!(
            report["destinations"]["modelProvider"],
            "official anthropic API"
        );
        assert_eq!(report["uploadedByDefault"], json!([]));
        let opted_in =
            privacy_inspect_detailed(&sessions, &project, &user, Some("openai"), true, false)
                .unwrap();
        assert_eq!(opted_in["analyticsEnabled"], true);
        assert_eq!(opted_in["crashUploadEnabled"], false);
        assert_eq!(opted_in["destinations"]["crashUpload"], "disabled");
    }
}
