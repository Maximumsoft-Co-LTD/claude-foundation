//! Durable, transport-neutral session and ordered-event persistence.

use changeloop_protocol::{
    CURRENT_PROTOCOL_VERSION, Event, EventCursor, EventEnvelope, EventId, MessagePartBody,
    OperationId, PartState, ProtocolDecodeError, SessionId, ToolCallId, decode_event_envelope_json,
    redact_sensitive_text, redact_sensitive_value,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use thiserror::Error;

const SCHEMA_VERSION: u32 = 4;
const DEFAULT_PAGE_SIZE: usize = 100;
const MAX_PAGE_SIZE: usize = 1_000;
const MAX_RETAINED_EVENTS_PER_SESSION: i64 = 50_000;
const RECOVERY_INSTRUCTIONS: &str = "stop all cloop processes, preserve state.db plus matching -wal/-shm files, run cloop doctor, and restore from a verified backup; never delete or replace only one SQLite file";

fn recovery_required(
    code: &'static str,
    path: &Path,
    detail: impl std::fmt::Display,
) -> StorageError {
    StorageError::RecoveryRequired {
        code,
        path: path.to_owned(),
        detail: detail.to_string(),
        instructions: RECOVERY_INSTRUCTIONS,
    }
}

fn verify_integrity(connection: &Connection, path: &Path) -> Result<(), StorageError> {
    let result: String = connection
        .pragma_query_value(None, "quick_check", |row| row.get(0))
        .map_err(|error| recovery_required("integrity_check_failed", path, error))?;
    if result == "ok" {
        Ok(())
    } else {
        Err(recovery_required("integrity_check_failed", path, result))
    }
}

fn verify_logical_integrity(connection: &Connection, path: &Path) -> Result<(), StorageError> {
    let invalid_events: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM events WHERE envelope_json='null'
             OR json_valid(envelope_json)=0
             OR cursor != printf('e:%020d', sequence)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| recovery_required("logical_integrity_check_failed", path, error))?;
    let invalid_pauses: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM runtime_pauses WHERE json_valid(payload_json)=0
             OR (response_json IS NOT NULL AND json_valid(response_json)=0)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| recovery_required("logical_integrity_check_failed", path, error))?;
    let invalid_tool_results: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_executions t
             WHERE t.state NOT IN ('running','completed','interrupted')
                OR (t.state='completed' AND (
                    t.result_event_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM events e
                        WHERE e.event_id=t.result_event_id AND e.session_id=t.session_id
                    )
                ))
                OR (t.state!='completed' AND t.result_event_id IS NOT NULL)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| recovery_required("logical_integrity_check_failed", path, error))?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")
        .and_then(|mut statement| statement.exists([]))
        .map_err(|error| recovery_required("logical_integrity_check_failed", path, error))?;
    if invalid_events == 0
        && invalid_pauses == 0
        && invalid_tool_results == 0
        && !foreign_key_violation
    {
        Ok(())
    } else {
        Err(recovery_required(
            "logical_integrity_check_failed",
            path,
            format!(
                "invalid events={invalid_events}, invalid pauses={invalid_pauses}, invalid tool results={invalid_tool_results}, foreign-key violation={foreign_key_violation}"
            ),
        ))
    }
}

fn sqlite_sidecar(database: &Path, suffix: &str) -> PathBuf {
    let mut path = OsString::from(database.as_os_str());
    path.push(suffix);
    PathBuf::from(path)
}

fn validate_regular_single_link(
    metadata: &std::fs::Metadata,
    database: &Path,
    candidate: &Path,
    code: &'static str,
) -> Result<(), StorageError> {
    if !metadata.file_type().is_file() {
        return Err(recovery_required(
            code,
            database,
            format!("{} must be a regular non-symlink file", candidate.display()),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(recovery_required(
                code,
                database,
                format!("{} must have exactly one hard link", candidate.display()),
            ));
        }
    }
    Ok(())
}

fn validate_existing_sqlite_file(
    database: &Path,
    candidate: &Path,
    code: &'static str,
) -> Result<bool, StorageError> {
    match std::fs::symlink_metadata(candidate) {
        Ok(metadata) => {
            validate_regular_single_link(&metadata, database, candidate, code)?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(recovery_required(code, database, error)),
    }
}

fn open_sqlite_file_nofollow(
    database: &Path,
    candidate: &Path,
    code: &'static str,
) -> Result<File, StorageError> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options
        .open(candidate)
        .map_err(|error| recovery_required(code, database, error))?;
    validate_regular_single_link(
        &file
            .metadata()
            .map_err(|error| recovery_required(code, database, error))?,
        database,
        candidate,
        code,
    )?;
    Ok(file)
}

fn validate_wal_header(database: &Path) -> Result<(), StorageError> {
    let wal = sqlite_sidecar(database, "-wal");
    if !validate_existing_sqlite_file(database, &wal, "wal_path_unsafe")? {
        return Ok(());
    }
    let mut file = open_sqlite_file_nofollow(database, &wal, "wal_read_failed")?;
    let length = file
        .metadata()
        .map_err(|error| recovery_required("wal_read_failed", database, error))?
        .len();
    if length == 0 {
        return Ok(());
    }
    if length < 32 {
        return Err(recovery_required(
            "wal_header_truncated",
            database,
            format!("{} contains only {length} bytes", wal.display()),
        ));
    }
    let mut header = [0_u8; 32];
    file.read_exact(&mut header)
        .map_err(|error| recovery_required("wal_read_failed", database, error))?;
    let magic = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    let version = u32::from_be_bytes([header[4], header[5], header[6], header[7]]);
    if !matches!(magic, 0x377f_0682 | 0x377f_0683) || version != 3_007_000 {
        return Err(recovery_required(
            "wal_header_mismatch",
            database,
            format!("{} has an invalid or mismatched WAL header", wal.display()),
        ));
    }
    Ok(())
}

struct DatabaseParentIdentity {
    path: PathBuf,
    canonical: PathBuf,
    metadata: std::fs::Metadata,
}

impl DatabaseParentIdentity {
    fn capture(database: &Path) -> Result<Self, StorageError> {
        let parent = database
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let metadata = std::fs::symlink_metadata(parent)
            .map_err(|error| recovery_required("database_parent_unsafe", database, error))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(recovery_required(
                "database_parent_unsafe",
                database,
                format!("{} must be a regular directory", parent.display()),
            ));
        }
        Ok(Self {
            path: parent.to_owned(),
            canonical: std::fs::canonicalize(parent)
                .map_err(|error| recovery_required("database_parent_unsafe", database, error))?,
            metadata,
        })
    }

    fn verify(&self, database: &Path) -> Result<(), StorageError> {
        let current = std::fs::symlink_metadata(&self.path)
            .map_err(|error| recovery_required("database_parent_changed", database, error))?;
        if !current.is_dir()
            || current.file_type().is_symlink()
            || std::fs::canonicalize(&self.path)
                .map_err(|error| recovery_required("database_parent_changed", database, error))?
                != self.canonical
        {
            return Err(recovery_required(
                "database_parent_changed",
                database,
                "database parent changed during open",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if current.dev() != self.metadata.dev() || current.ino() != self.metadata.ino() {
                return Err(recovery_required(
                    "database_parent_changed",
                    database,
                    "database parent identity changed during open",
                ));
            }
        }
        Ok(())
    }

    fn canonical_database_path(&self, database: &Path) -> Result<PathBuf, StorageError> {
        let file_name = database.file_name().ok_or_else(|| {
            recovery_required(
                "database_path_unsafe",
                database,
                "database path must name a file",
            )
        })?;
        Ok(self.canonical.join(file_name))
    }
}

fn validate_sqlite_paths(database: &Path) -> Result<bool, StorageError> {
    let exists = validate_existing_sqlite_file(database, database, "database_path_unsafe")?;
    validate_wal_header(database)?;
    let shm = sqlite_sidecar(database, "-shm");
    validate_existing_sqlite_file(database, &shm, "shm_path_unsafe")?;
    Ok(exists)
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("sqlite storage error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("stored protocol data is invalid: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("stored protocol envelope is incompatible: {0}")]
    Protocol(#[from] ProtocolDecodeError),
    #[error("session does not exist: {0}")]
    SessionNotFound(SessionId),
    #[error("event already exists: {0}")]
    DuplicateEvent(EventId),
    #[error("invalid event cursor: {0}")]
    InvalidCursor(String),
    #[error("event cursor does not exist: {0}")]
    CursorNotFound(EventCursor),
    #[error("event cursor {cursor} expired; oldest retained cursor is {oldest}")]
    CursorExpired {
        cursor: EventCursor,
        oldest: EventCursor,
    },
    #[error("event cursor belongs to a different session: {0}")]
    CursorSessionMismatch(EventCursor),
    #[error("page size must be between 1 and {MAX_PAGE_SIZE}")]
    InvalidPageSize,
    #[error("operation does not exist: {0}")]
    OperationNotFound(OperationId),
    #[error("tool call does not exist: {0}")]
    ToolCallNotFound(ToolCallId),
    #[error("tool call is already terminal: {0}")]
    ToolCallTerminal(ToolCallId),
    #[error("event is not a terminal result for tool call: {0}")]
    InvalidToolResultEvent(ToolCallId),
    #[error("operation {operation} does not belong to session {session}")]
    OperationSessionMismatch {
        operation: OperationId,
        session: SessionId,
    },
    #[error("tool call {tool_call} is already owned by another session or operation")]
    ToolCallOwnerMismatch { tool_call: ToolCallId },
    #[error("runtime pause is not awaiting a response: {0}")]
    PauseNotWaiting(OperationId),
    #[error("runtime pause kind does not match response method: {0}")]
    PauseKindMismatch(OperationId),
    #[error("database schema version {found} is newer than supported version {supported}")]
    FutureSchema { found: u32, supported: u32 },
    #[error("database recovery required ({code}) for {path}: {detail}; {instructions}")]
    RecoveryRequired {
        code: &'static str,
        path: PathBuf,
        detail: String,
        instructions: &'static str,
    },
    #[error(
        "session {session} was deleted, but database maintenance failed: {detail}; {instructions}"
    )]
    PostPurgeMaintenance {
        session: SessionId,
        detail: String,
        instructions: &'static str,
    },
    #[error("session {session} reached the retained-event limit {limit}; {instructions}")]
    RetentionPressure {
        session: SessionId,
        limit: i64,
        instructions: &'static str,
    },
    #[error(
        "global session quota reached ({limit}); archive or explicitly delete unreferenced sessions"
    )]
    SessionQuotaPressure { limit: usize },
    #[error("database quota pressure: {bytes} bytes retained; limit is {max_bytes} bytes")]
    DatabaseQuotaPressure { bytes: u64, max_bytes: u64 },
    #[error("event compaction is blocked by pinned cursor {cursor} ({root_kind}:{root_id})")]
    CompactionPinned {
        cursor: EventCursor,
        root_kind: String,
        root_id: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StorageQuotas {
    pub max_sessions: usize,
    pub max_database_bytes: u64,
}

impl Default for StorageQuotas {
    fn default() -> Self {
        Self {
            max_sessions: 10_000,
            max_database_bytes: 4 * 1024 * 1024 * 1024,
        }
    }
}

impl StorageQuotas {
    fn from_environment() -> Self {
        let defaults = Self::default();
        Self {
            max_sessions: std::env::var("CHANGELOOP_MAX_SESSIONS")
                .ok()
                .and_then(|value| value.parse().ok())
                .filter(|value| *value > 0)
                .unwrap_or(defaults.max_sessions),
            max_database_bytes: std::env::var("CHANGELOOP_DATABASE_MAX_BYTES")
                .ok()
                .and_then(|value| value.parse().ok())
                .filter(|value| *value > 0)
                .unwrap_or(defaults.max_database_bytes),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionRuntimeState {
    Active,
    Cancelled,
    Interrupted,
}

impl SessionRuntimeState {
    fn parse(value: &str) -> Self {
        match value {
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            _ => Self::Active,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolExecutionState {
    Running,
    Completed,
    Interrupted,
}

impl ToolExecutionState {
    fn parse(value: &str) -> Self {
        match value {
            "completed" => Self::Completed,
            "interrupted" => Self::Interrupted,
            _ => Self::Running,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolClaim {
    Claimed,
    AlreadyClaimed(ToolExecutionState),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReplayPage {
    pub events: Vec<EventEnvelope>,
    pub next_cursor: Option<EventCursor>,
    pub has_more: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EventCompactionResult {
    pub deleted_events: usize,
    pub audit_event: EventEnvelope,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredDraft {
    pub session_id: SessionId,
    pub project_root: String,
    pub prompt: String,
    pub risk_tier: String,
    pub contract_approved: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSessionSummary {
    pub session_id: SessionId,
    pub runtime_state: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDiagnostic {
    pub exists: bool,
    pub schema_version: Option<u32>,
    pub supported_schema_version: u32,
    pub integrity: &'static str,
    pub migration_required: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePauseKind {
    Permission,
    Question,
    DoomLoop,
}

impl RuntimePauseKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Permission => "permission",
            Self::Question => "question",
            Self::DoomLoop => "doom_loop",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "question" => Self::Question,
            "doom_loop" => Self::DoomLoop,
            _ => Self::Permission,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimePauseState {
    Waiting,
    Resolved,
    Cancelled,
    Interrupted,
}

impl RuntimePauseState {
    fn parse(value: &str) -> Self {
        match value {
            "resolved" => Self::Resolved,
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            _ => Self::Waiting,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct StoredRuntimePause {
    pub session_id: SessionId,
    pub operation_id: OperationId,
    pub kind: RuntimePauseKind,
    pub payload: serde_json::Value,
    pub state: RuntimePauseState,
    pub response: Option<serde_json::Value>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

/// SQLite-backed storage. Its public values are protocol types and do not
/// expose SQLite row IDs or transport-specific concepts.
pub struct Storage {
    connection: Connection,
    path: Option<PathBuf>,
    quotas: StorageQuotas,
    #[cfg(test)]
    fail_post_purge_maintenance: bool,
}

impl Storage {
    pub fn diagnose(path: impl AsRef<Path>) -> Result<DatabaseDiagnostic, StorageError> {
        let path = path.as_ref();
        let parent = DatabaseParentIdentity::capture(path)?;
        if !validate_sqlite_paths(path)? {
            return Ok(DatabaseDiagnostic {
                exists: false,
                schema_version: None,
                supported_schema_version: SCHEMA_VERSION,
                integrity: "not-created",
                migration_required: false,
            });
        }
        let open_path = parent.canonical_database_path(path)?;
        let connection = Connection::open_with_flags(
            &open_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|error| recovery_required("database_open_failed", path, error))?;
        parent.verify(path)?;
        validate_sqlite_paths(path)?;
        verify_integrity(&connection, path)?;
        let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(StorageError::FutureSchema {
                found: version,
                supported: SCHEMA_VERSION,
            });
        }
        if version == SCHEMA_VERSION {
            verify_logical_integrity(&connection, path)?;
        }
        Ok(DatabaseDiagnostic {
            exists: true,
            schema_version: Some(version),
            supported_schema_version: SCHEMA_VERSION,
            integrity: "ok",
            migration_required: version < SCHEMA_VERSION,
        })
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        Self::open_with_quotas(path, StorageQuotas::from_environment())
    }

    pub fn open_with_quotas(
        path: impl AsRef<Path>,
        quotas: StorageQuotas,
    ) -> Result<Self, StorageError> {
        let path = path.as_ref().to_path_buf();
        let parent = DatabaseParentIdentity::capture(&path)?;
        validate_sqlite_paths(&path)?;
        let open_path = parent.canonical_database_path(&path)?;
        let connection = Connection::open_with_flags(
            &open_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|error| recovery_required("database_open_failed", &path, error))?;
        parent.verify(&path)?;
        validate_sqlite_paths(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file = open_sqlite_file_nofollow(&path, &path, "database_permissions_failed")?;
            let mut permissions = file
                .metadata()
                .map_err(|error| recovery_required("database_permissions_failed", &path, error))?
                .permissions();
            permissions.set_mode(0o600);
            file.set_permissions(permissions)
                .map_err(|error| recovery_required("database_permissions_failed", &path, error))?;
        }
        let storage = Self::initialize(connection, true, Some(path.clone()), quotas)?;
        parent.verify(&path)?;
        validate_sqlite_paths(&path)?;
        Ok(storage)
    }

    pub fn open_in_memory() -> Result<Self, StorageError> {
        Self::open_in_memory_with_quotas(StorageQuotas::from_environment())
    }

    pub fn open_in_memory_with_quotas(quotas: StorageQuotas) -> Result<Self, StorageError> {
        Self::initialize(Connection::open_in_memory()?, false, None, quotas)
    }

    fn initialize(
        connection: Connection,
        enable_wal: bool,
        path: Option<PathBuf>,
        quotas: StorageQuotas,
    ) -> Result<Self, StorageError> {
        if let Some(path) = path.as_deref() {
            verify_integrity(&connection, path)?;
        }
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "secure_delete", "ON")?;
        connection.pragma_update(None, "busy_timeout", 5_000_u32)?;
        if enable_wal {
            connection.pragma_update(None, "journal_mode", "WAL")?;
            connection.pragma_update(None, "synchronous", "NORMAL")?;
        }
        if let Err(error) = migrate(&connection) {
            if matches!(error, StorageError::FutureSchema { .. }) {
                return Err(error);
            }
            if let Some(path) = path.as_deref() {
                return Err(StorageError::RecoveryRequired {
                    code: "schema_migration_failed",
                    path: path.to_owned(),
                    detail: error.to_string(),
                    instructions: RECOVERY_INSTRUCTIONS,
                });
            }
            return Err(error);
        }
        if let Some(path) = path.as_deref() {
            verify_integrity(&connection, path)?;
            verify_logical_integrity(&connection, path)?;
        }
        Ok(Self {
            connection,
            path,
            quotas,
            #[cfg(test)]
            fail_post_purge_maintenance: false,
        })
    }

    /// Irreversibly removes one unreferenced session and every SQLite-owned
    /// child row. Callers must enforce lifecycle/evidence retention first.
    pub fn purge_session(&mut self, session_id: &SessionId) -> Result<bool, StorageError> {
        let transaction = self.connection.transaction()?;
        let deleted = transaction.execute(
            "DELETE FROM sessions WHERE id = ?1",
            params![session_id.to_string()],
        )?;
        transaction.commit()?;
        #[cfg(test)]
        let maintenance = if self.fail_post_purge_maintenance {
            Err(rusqlite::Error::InvalidQuery)
        } else {
            self.connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
        };
        #[cfg(not(test))]
        let maintenance = self
            .connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
        if let Err(error) = maintenance {
            return Err(StorageError::PostPurgeMaintenance {
                session: session_id.clone(),
                detail: error.to_string(),
                instructions: "the session deletion committed; do not restore it blindly. Stop other cloop processes, back up state.db, then run cloop doctor before retrying maintenance",
            });
        }
        Ok(deleted > 0)
    }

    /// Open an independent WAL connection to the same durable database. This
    /// lets read-only replay continue while an execution owns another handle.
    /// Process-local in-memory databases intentionally have no peer.
    pub fn open_peer(&self) -> Result<Option<Self>, StorageError> {
        self.path.as_ref().map(Self::open).transpose()
    }

    #[must_use]
    pub fn schema_version(&self) -> u32 {
        self.connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap_or_default()
    }

    fn enforce_database_quota(&self) -> Result<(), StorageError> {
        let page_count: u64 = self
            .connection
            .pragma_query_value(None, "page_count", |row| row.get(0))?;
        let page_size: u64 = self
            .connection
            .pragma_query_value(None, "page_size", |row| row.get(0))?;
        let mut bytes = page_count.saturating_mul(page_size);
        if let Some(path) = &self.path {
            for suffix in ["-wal", "-shm"] {
                let sidecar = sqlite_sidecar(path, suffix);
                if validate_existing_sqlite_file(path, &sidecar, "sidecar_path_unsafe")? {
                    bytes = bytes.saturating_add(
                        std::fs::symlink_metadata(sidecar)
                            .map(|metadata| metadata.len())
                            .unwrap_or(0),
                    );
                }
            }
        }
        if bytes >= self.quotas.max_database_bytes {
            Err(StorageError::DatabaseQuotaPressure {
                bytes,
                max_bytes: self.quotas.max_database_bytes,
            })
        } else {
            Ok(())
        }
    }

    pub fn journal_mode(&self) -> Result<String, StorageError> {
        Ok(self
            .connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))?)
    }

    pub fn create_session(&self, id: &SessionId, created_at_ms: u64) -> Result<(), StorageError> {
        if self
            .connection
            .query_row("SELECT 1 FROM sessions WHERE id=?1", [&id.0], |_| Ok(()))
            .optional()?
            .is_none()
        {
            self.enforce_database_quota()?;
            let sessions: usize =
                self.connection
                    .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;
            if sessions >= self.quotas.max_sessions {
                return Err(StorageError::SessionQuotaPressure {
                    limit: self.quotas.max_sessions,
                });
            }
        }
        self.connection.execute(
            "INSERT OR IGNORE INTO sessions (id, runtime_state, created_at_ms, updated_at_ms) \
             VALUES (?1, 'active', ?2, ?2)",
            params![id.0, as_i64(created_at_ms)],
        )?;
        Ok(())
    }

    pub fn session_state(&self, id: &SessionId) -> Result<SessionRuntimeState, StorageError> {
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT runtime_state FROM sessions WHERE id = ?1",
                [&id.0],
                |row| row.get(0),
            )
            .optional()?;
        value
            .map(|state| SessionRuntimeState::parse(&state))
            .ok_or_else(|| StorageError::SessionNotFound(id.clone()))
    }

    /// Lists durable sessions newest-first for selectors and headless clients.
    /// The bounded result avoids an unbounded UI or protocol response.
    pub fn list_sessions(&self, limit: usize) -> Result<Vec<StoredSessionSummary>, StorageError> {
        let limit = limit.clamp(1, MAX_PAGE_SIZE);
        let mut statement = self.connection.prepare(
            "SELECT id, runtime_state, created_at_ms, updated_at_ms FROM sessions \
             ORDER BY updated_at_ms DESC, id ASC LIMIT ?1",
        )?;
        let rows = statement.query_map([limit as i64], |row| {
            Ok(StoredSessionSummary {
                session_id: SessionId(row.get(0)?),
                runtime_state: row.get(1)?,
                created_at_ms: row.get::<_, i64>(2)?.max(0) as u64,
                updated_at_ms: row.get::<_, i64>(3)?.max(0) as u64,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn save_draft(&self, draft: &StoredDraft) -> Result<(), StorageError> {
        self.enforce_database_quota()?;
        let prompt = redact_sensitive_text(&draft.prompt);
        self.connection.execute(
            "INSERT INTO session_drafts (session_id, project_root, prompt, risk_tier, contract_approved) \
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(session_id) DO UPDATE SET \
             project_root=excluded.project_root, prompt=excluded.prompt, risk_tier=excluded.risk_tier, \
             contract_approved=excluded.contract_approved",
            params![draft.session_id.0, draft.project_root, prompt, draft.risk_tier, draft.contract_approved],
        )?;
        Ok(())
    }

    pub fn load_draft(&self, session_id: &SessionId) -> Result<StoredDraft, StorageError> {
        self.connection.query_row(
            "SELECT project_root, prompt, risk_tier, contract_approved FROM session_drafts WHERE session_id = ?1",
            [&session_id.0],
            |row| Ok(StoredDraft {
                session_id: session_id.clone(),
                project_root: row.get(0)?,
                prompt: row.get(1)?,
                risk_tier: row.get(2)?,
                contract_approved: row.get(3)?,
            }),
        ).optional()?.ok_or_else(|| StorageError::SessionNotFound(session_id.clone()))
    }

    pub fn delete_draft(&self, session_id: &SessionId) -> Result<(), StorageError> {
        self.connection.execute(
            "DELETE FROM session_drafts WHERE session_id = ?1",
            [&session_id.0],
        )?;
        Ok(())
    }

    /// Atomically discard a pending change draft and append its audit event.
    ///
    /// Keeping both operations in one transaction prevents clients from
    /// observing a discarded draft without the durable reason, or an audit
    /// event for a draft that still remains confirmable.
    pub fn discard_draft(
        &mut self,
        session_id: &SessionId,
        emitted_at_ms: u64,
        event: Event,
    ) -> Result<EventEnvelope, StorageError> {
        let transaction = self.connection.transaction()?;
        let deleted = transaction.execute(
            "DELETE FROM session_drafts WHERE session_id = ?1",
            [&session_id.0],
        )?;
        if deleted == 0 {
            return Err(StorageError::SessionNotFound(session_id.clone()));
        }
        let envelope = append_in_transaction(
            &transaction,
            session_id,
            EventId::new(),
            emitted_at_ms,
            event,
        )?;
        transaction.commit()?;
        Ok(envelope)
    }

    pub fn append_event(
        &mut self,
        session_id: &SessionId,
        emitted_at_ms: u64,
        event: Event,
    ) -> Result<EventEnvelope, StorageError> {
        self.append_event_with_id(session_id, EventId::new(), emitted_at_ms, event)
    }

    /// Append an event using a caller-supplied stable ID. Repeating the ID is
    /// rejected, allowing callers to safely detect a retried append.
    pub fn append_event_with_id(
        &mut self,
        session_id: &SessionId,
        event_id: EventId,
        emitted_at_ms: u64,
        event: Event,
    ) -> Result<EventEnvelope, StorageError> {
        self.enforce_database_quota()?;
        let transaction = self.connection.transaction()?;
        let envelope =
            append_in_transaction(&transaction, session_id, event_id, emitted_at_ms, event)?;
        transaction.commit()?;
        Ok(envelope)
    }

    pub fn replay(
        &self,
        session_id: &SessionId,
        after: Option<&EventCursor>,
        limit: Option<usize>,
    ) -> Result<ReplayPage, StorageError> {
        ensure_session(&self.connection, session_id)?;
        let after_sequence = match after {
            Some(cursor) => {
                let requested_sequence = parse_cursor(cursor)?;
                let stored: Option<(String, i64)> = self
                    .connection
                    .query_row(
                        "SELECT session_id, sequence FROM events WHERE cursor = ?1",
                        [&cursor.0],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?;
                let (cursor_session, sequence) = match stored {
                    Some(stored) => stored,
                    None => {
                        let oldest: Option<i64> = self.connection.query_row(
                            "SELECT MIN(sequence) FROM events WHERE session_id=?1",
                            [&session_id.0],
                            |row| row.get(0),
                        )?;
                        if let Some(oldest) = oldest.filter(|oldest| requested_sequence < *oldest) {
                            return Err(StorageError::CursorExpired {
                                cursor: cursor.clone(),
                                oldest: EventCursor(format_cursor(oldest)),
                            });
                        }
                        return Err(StorageError::CursorNotFound(cursor.clone()));
                    }
                };
                if cursor_session != session_id.0 {
                    return Err(StorageError::CursorSessionMismatch(cursor.clone()));
                }
                sequence
            }
            None => 0,
        };
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);
        if !(1..=MAX_PAGE_SIZE).contains(&limit) {
            return Err(StorageError::InvalidPageSize);
        }

        let mut statement = self.connection.prepare(
            "SELECT envelope_json FROM events \
             WHERE session_id = ?1 AND sequence > ?2 ORDER BY sequence ASC LIMIT ?3",
        )?;
        let rows = statement.query_map(
            params![session_id.0, after_sequence, (limit + 1) as i64],
            |row| row.get::<_, String>(0),
        )?;
        let mut events = rows
            .map(|row| Ok(decode_event_envelope_json(&row?)?))
            .collect::<Result<Vec<_>, StorageError>>()?;
        let has_more = events.len() > limit;
        events.truncate(limit);
        let next_cursor = events.last().map(|event| event.cursor.clone());
        Ok(ReplayPage {
            events,
            next_cursor,
            has_more,
        })
    }

    pub fn pin_event_cursor(
        &self,
        session_id: &SessionId,
        cursor: &EventCursor,
        root_kind: &str,
        root_id: &str,
    ) -> Result<(), StorageError> {
        if root_kind.trim().is_empty() || root_id.trim().is_empty() {
            return Err(StorageError::InvalidCursor(cursor.0.clone()));
        }
        parse_cursor(cursor)?;
        let owner: Option<String> = self
            .connection
            .query_row(
                "SELECT session_id FROM events WHERE cursor=?1",
                [&cursor.0],
                |row| row.get(0),
            )
            .optional()?;
        if owner.as_deref() != Some(session_id.0.as_str()) {
            return Err(StorageError::CursorNotFound(cursor.clone()));
        }
        self.connection.execute(
            "INSERT INTO event_pins (cursor,session_id,root_kind,root_id)
             VALUES (?1,?2,?3,?4) ON CONFLICT(cursor,root_kind,root_id) DO NOTHING",
            params![cursor.0, session_id.0, root_kind, root_id],
        )?;
        Ok(())
    }

    pub fn unpin_event_cursor(
        &self,
        cursor: &EventCursor,
        root_kind: &str,
        root_id: &str,
    ) -> Result<bool, StorageError> {
        Ok(self.connection.execute(
            "DELETE FROM event_pins WHERE cursor=?1 AND root_kind=?2 AND root_id=?3",
            params![cursor.0, root_kind, root_id],
        )? > 0)
    }

    pub fn compact_session_events(
        &mut self,
        session_id: &SessionId,
        through: &EventCursor,
        compacted_at_ms: u64,
    ) -> Result<EventCompactionResult, StorageError> {
        let cutoff = parse_cursor(through)?;
        let transaction = self.connection.transaction()?;
        let owner: Option<String> = transaction
            .query_row(
                "SELECT session_id FROM events WHERE cursor=?1",
                [&through.0],
                |row| row.get(0),
            )
            .optional()?;
        if owner.as_deref() != Some(session_id.0.as_str()) {
            return Err(StorageError::CursorNotFound(through.clone()));
        }
        let pinned: Option<(String, String, String)> = transaction
            .query_row(
                "SELECT p.cursor,p.root_kind,p.root_id FROM event_pins p
                 JOIN events e ON e.cursor=p.cursor
                 WHERE p.session_id=?1 AND e.sequence<=?2 ORDER BY e.sequence LIMIT 1",
                params![session_id.0, cutoff],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((cursor, root_kind, root_id)) = pinned {
            return Err(StorageError::CompactionPinned {
                cursor: EventCursor(cursor),
                root_kind,
                root_id,
            });
        }
        let deleted_events = transaction.execute(
            "DELETE FROM events WHERE session_id=?1 AND sequence<=?2",
            params![session_id.0, cutoff],
        )?;
        let audit_event = append_in_transaction(
            &transaction,
            session_id,
            EventId::new(),
            compacted_at_ms,
            Event::SessionStateChanged {
                state: format!("history_compacted_through:{}", through.0),
            },
        )?;
        transaction.commit()?;
        Ok(EventCompactionResult {
            deleted_events,
            audit_event,
        })
    }

    pub fn begin_operation(
        &self,
        session_id: &SessionId,
        operation_id: &OperationId,
        started_at_ms: u64,
    ) -> Result<(), StorageError> {
        self.enforce_database_quota()?;
        ensure_session(&self.connection, session_id)?;
        self.connection.execute(
            "INSERT INTO operations (id, session_id, state, started_at_ms) \
             VALUES (?1, ?2, 'running', ?3)",
            params![operation_id.0, session_id.0, as_i64(started_at_ms)],
        )?;
        Ok(())
    }

    /// Atomically claims a tool call for execution. A resumed agent can query
    /// the returned state and must not replay an existing side effect.
    pub fn claim_tool_call(
        &self,
        session_id: &SessionId,
        operation_id: Option<&OperationId>,
        tool_call_id: &ToolCallId,
    ) -> Result<ToolClaim, StorageError> {
        ensure_session(&self.connection, session_id)?;
        if let Some(operation_id) = operation_id {
            let owner = self
                .connection
                .query_row(
                    "SELECT session_id FROM operations WHERE id=?1",
                    [&operation_id.0],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| StorageError::OperationNotFound(operation_id.clone()))?;
            if owner != session_id.0 {
                return Err(StorageError::OperationSessionMismatch {
                    operation: operation_id.clone(),
                    session: session_id.clone(),
                });
            }
        }
        let inserted = self.connection.execute(
            "INSERT OR IGNORE INTO tool_executions \
             (tool_call_id, session_id, operation_id, state) VALUES (?1, ?2, ?3, 'running')",
            params![
                tool_call_id.0,
                session_id.0,
                operation_id.map(|id| id.0.as_str())
            ],
        )?;
        if inserted == 1 {
            return Ok(ToolClaim::Claimed);
        }
        let (owner_session, owner_operation, state): (String, Option<String>, String) = self.connection.query_row(
            "SELECT session_id, operation_id, state FROM tool_executions WHERE tool_call_id = ?1",
            [&tool_call_id.0],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        if owner_session != session_id.0
            || owner_operation.as_deref() != operation_id.map(|id| id.0.as_str())
        {
            return Err(StorageError::ToolCallOwnerMismatch {
                tool_call: tool_call_id.clone(),
            });
        }
        Ok(ToolClaim::AlreadyClaimed(ToolExecutionState::parse(&state)))
    }

    pub fn complete_tool_call(
        &self,
        tool_call_id: &ToolCallId,
        result_event_id: &EventId,
    ) -> Result<(), StorageError> {
        let result_owner: Option<String> = self
            .connection
            .query_row(
                "SELECT session_id FROM events WHERE event_id = ?1",
                [&result_event_id.0],
                |row| row.get(0),
            )
            .optional()?;
        let tool_owner: Option<String> = self
            .connection
            .query_row(
                "SELECT session_id FROM tool_executions WHERE tool_call_id = ?1",
                [&tool_call_id.0],
                |row| row.get(0),
            )
            .optional()?;
        let Some(tool_owner) = tool_owner else {
            return Err(StorageError::ToolCallNotFound(tool_call_id.clone()));
        };
        if result_owner.as_deref() != Some(tool_owner.as_str()) {
            return Err(StorageError::ToolCallOwnerMismatch {
                tool_call: tool_call_id.clone(),
            });
        }
        let updated = self.connection.execute(
            "UPDATE tool_executions SET state = 'completed', result_event_id = ?2 \
             WHERE tool_call_id = ?1 AND state = 'running'",
            params![tool_call_id.0, result_event_id.0],
        )?;
        if updated == 1 {
            return Ok(());
        }
        let exists = self
            .connection
            .query_row(
                "SELECT 1 FROM tool_executions WHERE tool_call_id = ?1",
                [&tool_call_id.0],
                |_| Ok(()),
            )
            .optional()?;
        match exists {
            Some(()) => Err(StorageError::ToolCallTerminal(tool_call_id.clone())),
            None => Err(StorageError::ToolCallNotFound(tool_call_id.clone())),
        }
    }

    /// Atomically appends a terminal tool-result event and marks the claimed
    /// tool execution completed. A crash can therefore expose neither a
    /// completed claim without its event nor a terminal event whose claim is
    /// still eligible for restart recovery.
    pub fn append_and_complete_tool_call(
        &mut self,
        session_id: &SessionId,
        tool_call_id: &ToolCallId,
        emitted_at_ms: u64,
        event: Event,
    ) -> Result<EventEnvelope, StorageError> {
        let valid_terminal_result = matches!(&event, Event::MessageAppended { message }
            if message.session_id == *session_id && message.parts.iter().any(|part| {
            matches!(part.state, PartState::Completed | PartState::Error)
                && matches!(&part.body, MessagePartBody::ToolResult { tool_call_id: result_id, .. }
                    if result_id == tool_call_id)
        }));
        if !valid_terminal_result {
            return Err(StorageError::InvalidToolResultEvent(tool_call_id.clone()));
        }
        self.enforce_database_quota()?;
        let transaction = self.connection.transaction()?;
        ensure_session(&transaction, session_id)?;
        let claim: Option<(String, String)> = transaction
            .query_row(
                "SELECT session_id, state FROM tool_executions WHERE tool_call_id = ?1",
                [&tool_call_id.0],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((owner, state)) = claim else {
            return Err(StorageError::ToolCallNotFound(tool_call_id.clone()));
        };
        if owner != session_id.0 {
            return Err(StorageError::ToolCallOwnerMismatch {
                tool_call: tool_call_id.clone(),
            });
        }
        if state != "running" {
            return Err(StorageError::ToolCallTerminal(tool_call_id.clone()));
        }
        let envelope = append_in_transaction(
            &transaction,
            session_id,
            EventId::new(),
            emitted_at_ms,
            event,
        )?;
        let updated = transaction.execute(
            "UPDATE tool_executions SET state = 'completed', result_event_id = ?2 \
             WHERE tool_call_id = ?1 AND session_id = ?3 AND state = 'running'",
            params![tool_call_id.0, envelope.id.0, session_id.0],
        )?;
        if updated != 1 {
            return Err(StorageError::ToolCallTerminal(tool_call_id.clone()));
        }
        transaction.commit()?;
        Ok(envelope)
    }

    pub fn cancel_operation(
        &mut self,
        operation_id: &OperationId,
        reason: &str,
        emitted_at_ms: u64,
    ) -> Result<EventEnvelope, StorageError> {
        let transaction = self.connection.transaction()?;
        let session_id = operation_session(&transaction, operation_id)?;
        let reason = redact_sensitive_text(reason);
        transaction.execute(
            "UPDATE operations SET state = 'cancelled', finished_at_ms = ?2, reason = ?3 \
             WHERE id = ?1 AND state IN ('running', 'paused')",
            params![operation_id.0, as_i64(emitted_at_ms), reason],
        )?;
        transaction.execute(
            "UPDATE tool_executions SET state = 'interrupted' \
             WHERE operation_id = ?1 AND state = 'running'",
            [&operation_id.0],
        )?;
        transaction.execute(
            "UPDATE runtime_pauses SET state='cancelled', response_json=?2, updated_at_ms=?3 \
             WHERE operation_id=?1 AND state='waiting'",
            params![
                operation_id.0,
                serde_json::to_string(&serde_json::json!({"cancelled":true,"reason":reason}))?,
                as_i64(emitted_at_ms)
            ],
        )?;
        transaction.execute(
            "UPDATE sessions SET runtime_state = 'cancelled', updated_at_ms = ?2 WHERE id = ?1",
            params![session_id.0, as_i64(emitted_at_ms)],
        )?;
        let envelope = append_in_transaction(
            &transaction,
            &session_id,
            EventId::new(),
            emitted_at_ms,
            Event::Cancelled {
                operation_id: Some(operation_id.clone()),
                reason,
            },
        )?;
        transaction.commit()?;
        Ok(envelope)
    }

    /// Marks work left running by an unclean shutdown as interrupted and
    /// appends terminal cancellation events so replay never leaves it hanging.
    pub fn recover_interrupted_operations(
        &mut self,
        recovered_at_ms: u64,
    ) -> Result<Vec<EventEnvelope>, StorageError> {
        let transaction = self.connection.transaction()?;
        let interrupted = {
            let mut statement = transaction.prepare(
                "SELECT id, session_id FROM operations WHERE state = 'running' ORDER BY rowid",
            )?;
            statement
                .query_map([], |row| {
                    Ok((
                        OperationId::from_stable(row.get::<_, String>(0)?),
                        SessionId::from_stable(row.get::<_, String>(1)?),
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };

        let mut markers = Vec::with_capacity(interrupted.len());
        for (operation_id, session_id) in interrupted {
            transaction.execute(
                "UPDATE operations SET state = 'interrupted', finished_at_ms = ?2, \
                 reason = 'unclean_shutdown' WHERE id = ?1",
                params![operation_id.0, as_i64(recovered_at_ms)],
            )?;
            transaction.execute(
                "UPDATE tool_executions SET state = 'interrupted' \
                 WHERE operation_id = ?1 AND state = 'running'",
                [&operation_id.0],
            )?;
            transaction.execute(
                "UPDATE sessions SET runtime_state = 'interrupted', updated_at_ms = ?2 \
                 WHERE id = ?1",
                params![session_id.0, as_i64(recovered_at_ms)],
            )?;
            markers.push(append_in_transaction(
                &transaction,
                &session_id,
                EventId::new(),
                recovered_at_ms,
                Event::Cancelled {
                    operation_id: Some(operation_id),
                    reason: "unclean_shutdown".into(),
                },
            )?);
        }
        transaction.commit()?;
        Ok(markers)
    }

    pub fn save_runtime_pause(
        &self,
        session_id: &SessionId,
        operation_id: &OperationId,
        kind: RuntimePauseKind,
        payload: &serde_json::Value,
        created_at_ms: u64,
    ) -> Result<(), StorageError> {
        self.enforce_database_quota()?;
        ensure_session(&self.connection, session_id)?;
        let transaction = self.connection.unchecked_transaction()?;
        if operation_session(&transaction, operation_id)? != *session_id {
            return Err(StorageError::OperationNotFound(operation_id.clone()));
        }
        transaction.execute(
            "INSERT INTO runtime_pauses \
             (operation_id, session_id, kind, payload_json, state, created_at_ms, updated_at_ms) \
             VALUES (?1, ?2, ?3, ?4, 'waiting', ?5, ?5) \
             ON CONFLICT(operation_id) DO UPDATE SET kind=excluded.kind, \
             payload_json=excluded.payload_json, state='waiting', response_json=NULL, \
             updated_at_ms=excluded.updated_at_ms",
            params![
                operation_id.0,
                session_id.0,
                kind.as_str(),
                serde_json::to_string(&redact_sensitive_value(payload))?,
                as_i64(created_at_ms)
            ],
        )?;
        transaction.execute(
            "UPDATE operations SET state='paused', finished_at_ms=NULL, reason=?2 WHERE id=?1",
            params![operation_id.0, kind.as_str()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn runtime_pause(
        &self,
        operation_id: &OperationId,
    ) -> Result<StoredRuntimePause, StorageError> {
        self.connection
            .query_row(
                "SELECT session_id, kind, payload_json, state, response_json, \
                 created_at_ms, updated_at_ms FROM runtime_pauses WHERE operation_id=?1",
                [&operation_id.0],
                |row| stored_pause_from_row(operation_id, row),
            )
            .optional()?
            .ok_or_else(|| StorageError::OperationNotFound(operation_id.clone()))
    }

    pub fn runtime_pauses(&self) -> Result<Vec<StoredRuntimePause>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT operation_id, session_id, kind, payload_json, state, response_json, \
             created_at_ms, updated_at_ms FROM runtime_pauses ORDER BY created_at_ms, operation_id",
        )?;
        Ok(statement
            .query_map([], |row| {
                let operation = OperationId::from_stable(row.get::<_, String>(0)?);
                stored_pause_from_row_offset(&operation, row, 1)
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn respond_runtime_pause(
        &self,
        operation_id: &OperationId,
        response: &serde_json::Value,
        responded_at_ms: u64,
    ) -> Result<(), StorageError> {
        let kind = self.runtime_pause(operation_id)?.kind;
        self.respond_runtime_pause_kind(operation_id, kind, response, responded_at_ms)
    }

    pub fn respond_runtime_pause_kind(
        &self,
        operation_id: &OperationId,
        expected_kind: RuntimePauseKind,
        response: &serde_json::Value,
        responded_at_ms: u64,
    ) -> Result<(), StorageError> {
        let updated = self.connection.execute(
            "UPDATE runtime_pauses SET state='resolved', response_json=?2, updated_at_ms=?3 \
             WHERE operation_id=?1 AND state='waiting' AND kind=?4",
            params![
                operation_id.0,
                serde_json::to_string(&redact_sensitive_value(response))?,
                as_i64(responded_at_ms),
                expected_kind.as_str()
            ],
        )?;
        if updated != 1 {
            if self.runtime_pause(operation_id)?.kind != expected_kind {
                return Err(StorageError::PauseKindMismatch(operation_id.clone()));
            }
            return Err(StorageError::PauseNotWaiting(operation_id.clone()));
        }
        Ok(())
    }

    pub fn cancel_runtime_pause(
        &mut self,
        operation_id: &OperationId,
        reason: &str,
        cancelled_at_ms: u64,
    ) -> Result<EventEnvelope, StorageError> {
        let reason = redact_sensitive_text(reason);
        let transaction = self.connection.transaction()?;
        let session_id = operation_session(&transaction, operation_id)?;
        let updated = transaction.execute(
            "UPDATE runtime_pauses SET state='cancelled', response_json=?2, updated_at_ms=?3 \
             WHERE operation_id=?1 AND state='waiting'",
            params![
                operation_id.0,
                serde_json::to_string(&serde_json::json!({"cancelled":true,"reason":reason}))?,
                as_i64(cancelled_at_ms)
            ],
        )?;
        if updated != 1 {
            return Err(StorageError::PauseNotWaiting(operation_id.clone()));
        }
        transaction.execute(
            "UPDATE operations SET state='cancelled', finished_at_ms=?2, reason=?3 \
             WHERE id=?1 AND state='paused'",
            params![operation_id.0, as_i64(cancelled_at_ms), reason],
        )?;
        transaction.execute(
            "UPDATE tool_executions SET state='interrupted' \
             WHERE operation_id=?1 AND state='running'",
            [&operation_id.0],
        )?;
        transaction.execute(
            "UPDATE sessions SET runtime_state='cancelled', updated_at_ms=?2 WHERE id=?1",
            params![session_id.0, as_i64(cancelled_at_ms)],
        )?;
        let event = append_in_transaction(
            &transaction,
            &session_id,
            EventId::new(),
            cancelled_at_ms,
            Event::Cancelled {
                operation_id: Some(operation_id.clone()),
                reason,
            },
        )?;
        transaction.commit()?;
        Ok(event)
    }

    /// Marks pauses that cannot retain their in-memory runtime across process
    /// restart. They remain inspectable, but are never silently replayed.
    pub fn recover_interrupted_pauses(
        &mut self,
        recovered_at_ms: u64,
    ) -> Result<Vec<EventEnvelope>, StorageError> {
        let transaction = self.connection.transaction()?;
        let pauses = {
            let mut statement = transaction.prepare(
                "SELECT operation_id, session_id FROM runtime_pauses \
                 WHERE state='waiting' ORDER BY created_at_ms, operation_id",
            )?;
            statement
                .query_map([], |row| {
                    Ok((
                        OperationId::from_stable(row.get::<_, String>(0)?),
                        SessionId::from_stable(row.get::<_, String>(1)?),
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut markers = Vec::with_capacity(pauses.len());
        for (operation_id, session_id) in pauses {
            transaction.execute(
                "UPDATE runtime_pauses SET state='interrupted', updated_at_ms=?2 \
                 WHERE operation_id=?1 AND state='waiting'",
                params![operation_id.0, as_i64(recovered_at_ms)],
            )?;
            transaction.execute(
                "UPDATE operations SET state='interrupted', finished_at_ms=?2, \
                 reason='paused_runtime_lost' WHERE id=?1 AND state='paused'",
                params![operation_id.0, as_i64(recovered_at_ms)],
            )?;
            transaction.execute(
                "UPDATE sessions SET runtime_state='interrupted', updated_at_ms=?2 WHERE id=?1",
                params![session_id.0, as_i64(recovered_at_ms)],
            )?;
            markers.push(append_in_transaction(
                &transaction,
                &session_id,
                EventId::new(),
                recovered_at_ms,
                Event::Error {
                    code: "paused_runtime_lost".into(),
                    message: format!(
                        "operation {operation_id} was paused when the app-server stopped; explicit recovery is required"
                    ),
                },
            )?);
        }
        transaction.commit()?;
        Ok(markers)
    }
}

fn stored_pause_from_row(
    operation_id: &OperationId,
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<StoredRuntimePause> {
    stored_pause_from_row_offset(operation_id, row, 0)
}

fn stored_pause_from_row_offset(
    operation_id: &OperationId,
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<StoredRuntimePause> {
    let payload: String = row.get(offset + 2)?;
    let response: Option<String> = row.get(offset + 4)?;
    Ok(StoredRuntimePause {
        session_id: SessionId::from_stable(row.get::<_, String>(offset)?),
        operation_id: operation_id.clone(),
        kind: RuntimePauseKind::parse(&row.get::<_, String>(offset + 1)?),
        payload: serde_json::from_str(&payload).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                payload.len(),
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        state: RuntimePauseState::parse(&row.get::<_, String>(offset + 3)?),
        response: response
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?,
        created_at_ms: row.get::<_, i64>(offset + 5)? as u64,
        updated_at_ms: row.get::<_, i64>(offset + 6)? as u64,
    })
}

fn migrate(connection: &Connection) -> Result<(), StorageError> {
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(StorageError::FutureSchema {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    let mut version = version;
    if version == 1 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE session_drafts (
                session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                project_root TEXT NOT NULL,
                prompt TEXT NOT NULL,
                risk_tier TEXT NOT NULL,
                contract_approved INTEGER NOT NULL DEFAULT 0
            );
            PRAGMA user_version = 2;",
        )?;
        transaction.commit()?;
        version = 2;
    }
    if version == 2 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE runtime_pauses (
                operation_id TEXT PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                state TEXT NOT NULL,
                response_json TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            CREATE INDEX runtime_pauses_state ON runtime_pauses(state, created_at_ms);
            PRAGMA user_version = 3;",
        )?;
        transaction.commit()?;
        version = 3;
    }
    if version == 3 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(
            "CREATE TABLE event_pins (
                cursor TEXT NOT NULL REFERENCES events(cursor) ON DELETE RESTRICT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                root_kind TEXT NOT NULL,
                root_id TEXT NOT NULL,
                PRIMARY KEY (cursor, root_kind, root_id)
            );
            CREATE INDEX event_pins_session ON event_pins(session_id, cursor);
            PRAGMA user_version = 4;",
        )?;
        transaction.commit()?;
        return Ok(());
    }
    let transaction = connection.unchecked_transaction()?;
    transaction.execute_batch(
        "CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            runtime_state TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            cursor TEXT NOT NULL UNIQUE,
            emitted_at_ms INTEGER NOT NULL,
            envelope_json TEXT NOT NULL
        );
        CREATE INDEX events_session_sequence ON events(session_id, sequence);
        CREATE TABLE operations (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            state TEXT NOT NULL,
            started_at_ms INTEGER NOT NULL,
            finished_at_ms INTEGER,
            reason TEXT
        );
        CREATE TABLE tool_executions (
            tool_call_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            operation_id TEXT REFERENCES operations(id) ON DELETE SET NULL,
            state TEXT NOT NULL,
            result_event_id TEXT
        );
        CREATE TABLE session_drafts (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            project_root TEXT NOT NULL,
            prompt TEXT NOT NULL,
            risk_tier TEXT NOT NULL,
            contract_approved INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE runtime_pauses (
            operation_id TEXT PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            state TEXT NOT NULL,
            response_json TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX runtime_pauses_state ON runtime_pauses(state, created_at_ms);
        CREATE TABLE event_pins (
            cursor TEXT NOT NULL REFERENCES events(cursor) ON DELETE RESTRICT,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            root_kind TEXT NOT NULL,
            root_id TEXT NOT NULL,
            PRIMARY KEY (cursor, root_kind, root_id)
        );
        CREATE INDEX event_pins_session ON event_pins(session_id, cursor);
        PRAGMA user_version = 4;",
    )?;
    transaction.commit()?;
    Ok(())
}

fn append_in_transaction(
    transaction: &Transaction<'_>,
    session_id: &SessionId,
    event_id: EventId,
    emitted_at_ms: u64,
    event: Event,
) -> Result<EventEnvelope, StorageError> {
    ensure_session(transaction, session_id)?;
    let global_sequence: i64 =
        transaction.query_row("SELECT COALESCE(MAX(sequence), 0) FROM events", [], |row| {
            row.get(0)
        })?;
    if global_sequence >= MAX_RETAINED_EVENTS_PER_SESSION {
        let at_capacity = transaction
            .query_row(
                "SELECT 1 FROM events WHERE session_id=?1 ORDER BY sequence
                 LIMIT 1 OFFSET ?2",
                params![session_id.0, MAX_RETAINED_EVENTS_PER_SESSION - 1],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if at_capacity {
            return Err(StorageError::RetentionPressure {
                session: session_id.clone(),
                limit: MAX_RETAINED_EVENTS_PER_SESSION,
                instructions: "pause the session and export/archive or explicitly delete unreferenced session data; evidence, snapshots, pauses, and audit roots are never pruned automatically",
            });
        }
    }
    if transaction
        .query_row(
            "SELECT 1 FROM events WHERE event_id = ?1",
            [&event_id.0],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(StorageError::DuplicateEvent(event_id));
    }
    let pending_cursor = format!("pending:{}", event_id.0);
    transaction.execute(
        "INSERT INTO events (event_id, session_id, cursor, emitted_at_ms, envelope_json) \
         VALUES (?1, ?2, ?3, ?4, 'null')",
        params![
            event_id.0,
            session_id.0,
            pending_cursor,
            as_i64(emitted_at_ms)
        ],
    )?;
    let sequence = transaction.last_insert_rowid();
    let cursor = EventCursor(format_cursor(sequence));
    let envelope = EventEnvelope {
        protocol_version: CURRENT_PROTOCOL_VERSION,
        id: event_id,
        cursor: cursor.clone(),
        session_id: session_id.clone(),
        emitted_at_ms,
        event,
    };
    let envelope: EventEnvelope =
        serde_json::from_value(redact_sensitive_value(&serde_json::to_value(envelope)?))?;
    let serialized = serde_json::to_string(&envelope)?;
    transaction.execute(
        "UPDATE events SET cursor = ?2, envelope_json = ?3 WHERE sequence = ?1",
        params![sequence, cursor.0, serialized],
    )?;
    Ok(envelope)
}

fn ensure_session(connection: &Connection, session_id: &SessionId) -> Result<(), StorageError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM sessions WHERE id = ?1",
            [&session_id.0],
            |_| Ok(()),
        )
        .optional()?;
    if exists.is_some() {
        Ok(())
    } else {
        Err(StorageError::SessionNotFound(session_id.clone()))
    }
}

fn operation_session(
    transaction: &Transaction<'_>,
    operation_id: &OperationId,
) -> Result<SessionId, StorageError> {
    transaction
        .query_row(
            "SELECT session_id FROM operations WHERE id = ?1",
            [&operation_id.0],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(SessionId::from_stable)
        .ok_or_else(|| StorageError::OperationNotFound(operation_id.clone()))
}

fn format_cursor(sequence: i64) -> String {
    format!("e:{sequence:020}")
}

fn parse_cursor(cursor: &EventCursor) -> Result<i64, StorageError> {
    let value = cursor
        .0
        .strip_prefix("e:")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .ok_or_else(|| StorageError::InvalidCursor(cursor.0.clone()))?;
    Ok(value)
}

fn as_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_protocol::{MessagePartBody, ProtocolDecodeError};
    use tempfile::tempdir;

    fn text_event(value: &str) -> Event {
        Event::SessionStateChanged {
            state: value.into(),
        }
    }

    #[cfg(unix)]
    #[test]
    fn database_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempdir().unwrap();
        let path = directory.path().join("private.db");
        drop(Storage::open(&path).unwrap());

        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o077,
            0
        );
    }

    #[test]
    fn file_database_uses_wal_and_runs_migrations() {
        let directory = tempdir().unwrap();
        let storage = Storage::open(directory.path().join("state.db")).unwrap();
        assert_eq!(storage.schema_version(), SCHEMA_VERSION);
        assert_eq!(storage.journal_mode().unwrap(), "wal");
    }

    #[test]
    fn schema_two_database_adds_runtime_pauses_without_losing_sessions() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("schema-two.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE sessions (
                    id TEXT PRIMARY KEY, runtime_state TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
                );
                CREATE TABLE operations (
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
                    state TEXT NOT NULL, started_at_ms INTEGER NOT NULL,
                    finished_at_ms INTEGER, reason TEXT
                );
                CREATE TABLE events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                    session_id TEXT NOT NULL REFERENCES sessions(id), cursor TEXT NOT NULL UNIQUE,
                    emitted_at_ms INTEGER NOT NULL, envelope_json TEXT NOT NULL
                );
                CREATE TABLE tool_executions (
                    tool_call_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
                    operation_id TEXT REFERENCES operations(id), state TEXT NOT NULL, result_event_id TEXT
                );
                CREATE TABLE session_drafts (
                    session_id TEXT PRIMARY KEY REFERENCES sessions(id), project_root TEXT NOT NULL,
                    prompt TEXT NOT NULL, risk_tier TEXT NOT NULL, contract_approved INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO sessions VALUES ('preserved', 'active', 1, 1);
                PRAGMA user_version = 2;",
            )
            .unwrap();
        drop(connection);
        let storage = Storage::open(&path).unwrap();
        assert_eq!(storage.schema_version(), SCHEMA_VERSION);
        assert_eq!(
            storage
                .session_state(&SessionId::from_stable("preserved"))
                .unwrap(),
            SessionRuntimeState::Active
        );
        assert!(storage.runtime_pauses().unwrap().is_empty());
    }

    #[test]
    fn diagnosis_is_read_only_and_reports_pending_migration() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("diagnose-v2.db");
        let connection = Connection::open(&path).unwrap();
        connection.pragma_update(None, "user_version", 2).unwrap();
        drop(connection);
        let diagnostic = Storage::diagnose(&path).unwrap();
        assert_eq!(diagnostic.schema_version, Some(2));
        assert!(diagnostic.migration_required);
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn replay_uses_stable_exclusive_cursors_without_duplicates() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session-replay");
        storage.create_session(&session, 1).unwrap();
        for value in ["one", "two", "three"] {
            storage
                .append_event(&session, 2, text_event(value))
                .unwrap();
        }

        let first = storage.replay(&session, None, Some(2)).unwrap();
        assert_eq!(first.events.len(), 2);
        assert!(first.has_more);
        let second = storage
            .replay(&session, first.next_cursor.as_ref(), Some(2))
            .unwrap();
        assert_eq!(second.events.len(), 1);
        assert!(!second.has_more);
        assert_ne!(first.events[1].id, second.events[0].id);
    }

    #[test]
    fn persistence_boundary_redacts_canaries_from_database_and_wal() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("privacy.db");
        let mut storage = Storage::open(&path).unwrap();
        let session = SessionId::from_stable("privacy-boundary");
        let operation = OperationId::from_stable("privacy-operation");
        let canary = "sk-canary-storage-7e9b2d";
        storage.create_session(&session, 1).unwrap();
        storage.begin_operation(&session, &operation, 2).unwrap();
        storage
            .append_event(&session, 3, text_event(&format!("OPENAI_API_KEY={canary}")))
            .unwrap();
        storage
            .save_draft(&StoredDraft {
                session_id: session.clone(),
                project_root: directory.path().display().to_string(),
                prompt: format!("Bearer {canary}"),
                risk_tier: "high".into(),
                contract_approved: false,
            })
            .unwrap();
        storage
            .save_runtime_pause(
                &session,
                &operation,
                RuntimePauseKind::Permission,
                &serde_json::json!({"nested":{"message":format!("token={canary}")}}),
                4,
            )
            .unwrap();
        storage
            .respond_runtime_pause(
                &operation,
                &serde_json::json!({"answer":format!("Authorization: Bearer {canary}")}),
                5,
            )
            .unwrap();
        storage
            .connection
            .execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
            .unwrap();

        let replay = storage.replay(&session, None, Some(10)).unwrap();
        assert!(
            serde_json::to_string(&replay.events)
                .unwrap()
                .contains("[REDACTED]")
        );
        let draft = storage.load_draft(&session).unwrap();
        assert!(!draft.prompt.contains(canary));
        let pause = storage.runtime_pause(&operation).unwrap();
        assert!(
            !serde_json::to_string(&pause.payload)
                .unwrap()
                .contains(canary)
        );
        assert!(
            !serde_json::to_string(&pause.response)
                .unwrap()
                .contains(canary)
        );

        for candidate in [path.clone(), path.with_extension("db-wal")] {
            if let Ok(bytes) = std::fs::read(&candidate) {
                assert!(
                    !bytes
                        .windows(canary.len())
                        .any(|window| window == canary.as_bytes()),
                    "secret canary leaked into {}",
                    candidate.display()
                );
            }
        }
    }

    #[test]
    fn replay_rejects_unknown_and_cross_session_cursors() {
        let mut storage = Storage::open_in_memory().unwrap();
        let first_session = SessionId::from_stable("session-first");
        let second_session = SessionId::from_stable("session-second");
        storage.create_session(&first_session, 1).unwrap();
        storage.create_session(&second_session, 1).unwrap();
        let event = storage
            .append_event(&first_session, 2, text_event("one"))
            .unwrap();

        assert!(matches!(
            storage.replay(
                &first_session,
                Some(&EventCursor("e:00000000000000099999".into())),
                None
            ),
            Err(StorageError::CursorNotFound(_))
        ));
        assert!(matches!(
            storage.replay(&second_session, Some(&event.cursor), None),
            Err(StorageError::CursorSessionMismatch(_))
        ));
    }

    #[test]
    fn duplicate_event_ids_are_rejected() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session-idempotent");
        let event_id = EventId::from_stable("event-fixed");
        storage.create_session(&session, 1).unwrap();
        storage
            .append_event_with_id(&session, event_id.clone(), 2, text_event("one"))
            .unwrap();
        assert!(matches!(
            storage.append_event_with_id(&session, event_id, 3, text_event("two")),
            Err(StorageError::DuplicateEvent(_))
        ));
    }

    #[test]
    fn tool_claims_prevent_silent_reexecution() {
        let storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session-tool");
        let operation = OperationId::from_stable("operation-tool");
        let tool_call = ToolCallId::from_stable("tool-call-fixed");
        storage.create_session(&session, 1).unwrap();
        storage.begin_operation(&session, &operation, 2).unwrap();
        assert_eq!(
            storage
                .claim_tool_call(&session, Some(&operation), &tool_call)
                .unwrap(),
            ToolClaim::Claimed
        );
        assert_eq!(
            storage
                .claim_tool_call(&session, Some(&operation), &tool_call)
                .unwrap(),
            ToolClaim::AlreadyClaimed(ToolExecutionState::Running)
        );
    }

    #[test]
    fn ten_thousand_events_replay_exactly_once_across_stable_cursors() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("ten-thousand-events");
        storage.create_session(&session, 1).unwrap();
        for sequence in 1..=10_000_u64 {
            storage
                .append_event(&session, sequence, Event::Heartbeat)
                .unwrap();
        }
        let mut after = None;
        let mut ids = std::collections::BTreeSet::new();
        let mut cursors = Vec::new();
        loop {
            let page = storage
                .replay(&session, after.as_ref(), Some(1_000))
                .unwrap();
            for event in &page.events {
                assert!(
                    ids.insert(event.id.to_string()),
                    "duplicate event ID in replay"
                );
                cursors.push(event.cursor.clone());
            }
            after = page.next_cursor;
            if !page.has_more {
                break;
            }
        }
        assert_eq!(ids.len(), 10_000);
        assert_eq!(cursors.first().unwrap().0, "e:00000000000000000001");
        assert_eq!(cursors.last().unwrap().0, "e:00000000000000010000");
        assert!(
            storage
                .replay(&session, cursors.last(), Some(1_000))
                .unwrap()
                .events
                .is_empty()
        );
    }

    #[test]
    fn event_retention_backpressures_without_pruning_evidence_or_cursors() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("bounded-events");
        storage.create_session(&session, 1).unwrap();
        let first = storage
            .append_event(&session, 2, text_event("first"))
            .unwrap()
            .cursor;
        for index in 1..MAX_RETAINED_EVENTS_PER_SESSION {
            storage
                .append_event(&session, index as u64 + 2, Event::Heartbeat)
                .unwrap();
        }
        let error = storage
            .append_event(&session, 60_000, Event::Heartbeat)
            .unwrap_err();
        assert!(matches!(
            error,
            StorageError::RetentionPressure {
                ref session,
                limit: MAX_RETAINED_EVENTS_PER_SESSION,
                ..
            } if *session == SessionId::from_stable("bounded-events")
        ));
        let retained: i64 = storage
            .connection
            .query_row(
                "SELECT COUNT(*) FROM events WHERE session_id=?1",
                [&session.0],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, MAX_RETAINED_EVENTS_PER_SESSION);
        let replay = storage.replay(&session, Some(&first), Some(1)).unwrap();
        assert_eq!(
            replay.events.len(),
            1,
            "old cursors remain valid at pressure"
        );
    }

    #[test]
    fn global_session_and_database_quotas_backpressure_without_deletion() {
        let storage = Storage::open_in_memory_with_quotas(StorageQuotas {
            max_sessions: 1,
            max_database_bytes: u64::MAX,
        })
        .unwrap();
        let first = SessionId::from_stable("quota-first");
        storage.create_session(&first, 1).unwrap();
        storage.create_session(&first, 2).unwrap();
        assert!(matches!(
            storage.create_session(&SessionId::from_stable("quota-second"), 2),
            Err(StorageError::SessionQuotaPressure { limit: 1 })
        ));
        assert_eq!(storage.list_sessions(10).unwrap().len(), 1);

        let storage = Storage::open_in_memory_with_quotas(StorageQuotas {
            max_sessions: 10,
            max_database_bytes: 1,
        })
        .unwrap();
        assert!(matches!(
            storage.create_session(&SessionId::from_stable("database-pressure"), 1),
            Err(StorageError::DatabaseQuotaPressure { .. })
        ));
        assert!(storage.list_sessions(10).unwrap().is_empty());
    }

    #[test]
    fn explicit_compaction_respects_durable_pins_and_expires_only_deleted_cursors() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("compaction-pins");
        storage.create_session(&session, 1).unwrap();
        let first = storage
            .append_event(&session, 2, text_event("first"))
            .unwrap();
        let second = storage
            .append_event(&session, 3, text_event("second"))
            .unwrap();
        storage
            .append_event(&session, 4, text_event("third"))
            .unwrap();
        storage
            .pin_event_cursor(&session, &first.cursor, "proof", "receipt-1")
            .unwrap();
        storage
            .pin_event_cursor(&session, &first.cursor, "audit", "export-1")
            .unwrap();
        assert!(matches!(
            storage.compact_session_events(&session, &second.cursor, 5),
            Err(StorageError::CompactionPinned {
                root_kind,
                root_id,
                ..
            }) if root_kind == "proof" && root_id == "receipt-1"
        ));
        assert_eq!(
            storage
                .replay(&session, None, Some(10))
                .unwrap()
                .events
                .len(),
            3
        );
        assert!(
            !storage
                .unpin_event_cursor(&first.cursor, "wrong", "receipt-1")
                .unwrap()
        );
        assert!(
            storage
                .unpin_event_cursor(&first.cursor, "proof", "receipt-1")
                .unwrap()
        );
        assert!(matches!(
            storage.compact_session_events(&session, &second.cursor, 6),
            Err(StorageError::CompactionPinned {
                root_kind,
                root_id,
                ..
            }) if root_kind == "audit" && root_id == "export-1"
        ));
        assert!(
            storage
                .unpin_event_cursor(&first.cursor, "audit", "export-1")
                .unwrap()
        );
        let result = storage
            .compact_session_events(&session, &second.cursor, 7)
            .unwrap();
        assert_eq!(result.deleted_events, 2);
        assert!(matches!(
            storage.replay(&session, Some(&first.cursor), Some(1)),
            Err(StorageError::CursorExpired { .. })
        ));
        let retained = storage.replay(&session, None, Some(10)).unwrap();
        assert_eq!(
            retained.events.len(),
            2,
            "third event plus compaction audit"
        );
    }

    #[test]
    fn tool_claims_cannot_cross_session_or_operation_ownership() {
        let storage = Storage::open_in_memory().unwrap();
        let first_session = SessionId::from_stable("first-session");
        let second_session = SessionId::from_stable("second-session");
        let first_operation = OperationId::from_stable("first-operation");
        let second_operation = OperationId::from_stable("second-operation");
        let tool_call = ToolCallId::from_stable("shared-tool-id");
        storage.create_session(&first_session, 1).unwrap();
        storage.create_session(&second_session, 1).unwrap();
        storage
            .begin_operation(&first_session, &first_operation, 2)
            .unwrap();
        storage
            .begin_operation(&second_session, &second_operation, 2)
            .unwrap();
        storage
            .claim_tool_call(&first_session, Some(&first_operation), &tool_call)
            .unwrap();
        assert!(matches!(
            storage.claim_tool_call(&second_session, Some(&second_operation), &tool_call),
            Err(StorageError::ToolCallOwnerMismatch { .. })
        ));
        assert!(matches!(
            storage.claim_tool_call(&first_session, Some(&second_operation), &ToolCallId::new()),
            Err(StorageError::OperationSessionMismatch { .. })
        ));
    }

    #[test]
    fn recovery_terminalizes_operations_tools_and_event_stream() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session-recovery");
        let operation = OperationId::from_stable("operation-recovery");
        let tool_call = ToolCallId::from_stable("tool-call-recovery");
        storage.create_session(&session, 1).unwrap();
        storage.begin_operation(&session, &operation, 2).unwrap();
        storage
            .claim_tool_call(&session, Some(&operation), &tool_call)
            .unwrap();

        let markers = storage.recover_interrupted_operations(3).unwrap();
        assert_eq!(markers.len(), 1);
        assert_eq!(
            storage.session_state(&session).unwrap(),
            SessionRuntimeState::Interrupted
        );
        assert_eq!(
            storage
                .claim_tool_call(&session, Some(&operation), &tool_call)
                .unwrap(),
            ToolClaim::AlreadyClaimed(ToolExecutionState::Interrupted)
        );
        assert!(matches!(markers[0].event, Event::Cancelled { .. }));
        assert!(
            storage
                .recover_interrupted_operations(4)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn explicit_cancellation_is_persisted_as_a_terminal_event() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session-cancel");
        let operation = OperationId::from_stable("operation-cancel");
        storage.create_session(&session, 1).unwrap();
        storage.begin_operation(&session, &operation, 2).unwrap();

        let marker = storage
            .cancel_operation(&operation, "user_cancelled", 3)
            .unwrap();
        assert_eq!(
            storage.session_state(&session).unwrap(),
            SessionRuntimeState::Cancelled
        );
        assert!(matches!(
            marker.event,
            Event::Cancelled { operation_id: Some(ref id), ref reason }
                if id == &operation && reason == "user_cancelled"
        ));
        assert_eq!(
            storage.replay(&session, None, None).unwrap().events,
            vec![marker]
        );
    }

    #[test]
    fn tool_completion_rejects_missing_or_cross_session_result_events() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("tool-owner");
        let other = SessionId::from_stable("other-owner");
        let tool = ToolCallId::from_stable("tool-result-owner");
        storage.create_session(&session, 1).unwrap();
        storage.create_session(&other, 1).unwrap();
        assert_eq!(
            storage.claim_tool_call(&session, None, &tool).unwrap(),
            ToolClaim::Claimed
        );

        assert!(matches!(
            storage.complete_tool_call(&tool, &EventId::from_stable("missing-event")),
            Err(StorageError::ToolCallOwnerMismatch { .. })
        ));
        let foreign = storage.append_event(&other, 2, Event::Heartbeat).unwrap();
        assert!(matches!(
            storage.complete_tool_call(&tool, &foreign.id),
            Err(StorageError::ToolCallOwnerMismatch { .. })
        ));
        assert!(matches!(
            storage.append_and_complete_tool_call(&session, &tool, 3, Event::Heartbeat),
            Err(StorageError::InvalidToolResultEvent(_))
        ));
        assert_eq!(
            storage.claim_tool_call(&session, None, &tool).unwrap(),
            ToolClaim::AlreadyClaimed(ToolExecutionState::Running)
        );
    }

    #[test]
    fn terminal_tool_event_and_claim_commit_atomically_and_recovery_does_not_duplicate() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("atomic-tool-result.db");
        let session = SessionId::from_stable("atomic-tool-session");
        let operation = OperationId::from_stable("atomic-tool-operation");
        let tool = ToolCallId::from_stable("atomic-tool-call");
        let terminal = {
            let mut storage = Storage::open(&path).unwrap();
            storage.create_session(&session, 1).unwrap();
            storage.begin_operation(&session, &operation, 2).unwrap();
            assert_eq!(
                storage
                    .claim_tool_call(&session, Some(&operation), &tool)
                    .unwrap(),
                ToolClaim::Claimed
            );
            storage
                .append_and_complete_tool_call(
                    &session,
                    &tool,
                    3,
                    Event::MessageAppended {
                        message: changeloop_protocol::Message {
                            schema_version: 1,
                            id: changeloop_protocol::MessageId::new(),
                            session_id: session.clone(),
                            created_at_ms: 3,
                            parts: vec![changeloop_protocol::MessagePart {
                                schema_version: 1,
                                id: changeloop_protocol::PartId::new(),
                                state: PartState::Completed,
                                provenance: changeloop_protocol::Provenance::ToolOutput,
                                body: MessagePartBody::ToolResult {
                                    tool_call_id: tool.clone(),
                                    output: Some("ok".into()),
                                    artifact: None,
                                    is_error: false,
                                },
                            }],
                        },
                    },
                )
                .unwrap()
        };

        let mut reopened = Storage::open(&path).unwrap();
        assert_eq!(
            reopened
                .claim_tool_call(&session, Some(&operation), &tool)
                .unwrap(),
            ToolClaim::AlreadyClaimed(ToolExecutionState::Completed)
        );
        let replay = reopened.replay(&session, None, None).unwrap();
        assert_eq!(replay.events, vec![terminal]);
        let recovered = reopened.recover_interrupted_operations(4).unwrap();
        assert_eq!(recovered.len(), 1, "the operation itself was still running");
        assert_eq!(
            reopened
                .claim_tool_call(&session, Some(&operation), &tool)
                .unwrap(),
            ToolClaim::AlreadyClaimed(ToolExecutionState::Completed),
            "operation recovery must not rewrite a terminal tool claim"
        );
        assert_eq!(
            reopened.replay(&session, None, None).unwrap().events.len(),
            2
        );
    }

    #[test]
    fn runtime_pause_response_is_typed_single_use_and_durable() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("paused-session");
        let operation = OperationId::from_stable("paused-operation");
        storage.create_session(&session, 1).unwrap();
        storage.begin_operation(&session, &operation, 2).unwrap();
        storage
            .save_runtime_pause(
                &session,
                &operation,
                RuntimePauseKind::Permission,
                &serde_json::json!({"callId":"tool-1","tool":"shell"}),
                3,
            )
            .unwrap();
        let pause = storage.runtime_pause(&operation).unwrap();
        assert_eq!(pause.state, RuntimePauseState::Waiting);
        assert_eq!(pause.payload["callId"], "tool-1");
        assert!(matches!(
            storage.respond_runtime_pause_kind(
                &operation,
                RuntimePauseKind::Question,
                &serde_json::json!({"answer":"yes"}),
                4
            ),
            Err(StorageError::PauseKindMismatch(id)) if id == operation
        ));
        storage
            .respond_runtime_pause(&operation, &serde_json::json!({"allow":true}), 4)
            .unwrap();
        assert_eq!(
            storage.runtime_pause(&operation).unwrap().response,
            Some(serde_json::json!({"allow":true}))
        );
        assert!(matches!(
            storage.respond_runtime_pause(&operation, &serde_json::json!({"allow":false}), 5),
            Err(StorageError::PauseNotWaiting(id)) if id == operation
        ));
        assert!(storage.recover_interrupted_pauses(6).unwrap().is_empty());
    }

    #[test]
    fn process_restart_marks_waiting_pause_interrupted_without_replay() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("pause.db");
        let session = SessionId::from_stable("crashed-session");
        let operation = OperationId::from_stable("crashed-operation");
        {
            let storage = Storage::open(&path).unwrap();
            storage.create_session(&session, 1).unwrap();
            storage.begin_operation(&session, &operation, 2).unwrap();
            storage
                .save_runtime_pause(
                    &session,
                    &operation,
                    RuntimePauseKind::Question,
                    &serde_json::json!({"callId":"question-1","prompt":"continue?"}),
                    3,
                )
                .unwrap();
        }
        let mut reopened = Storage::open(&path).unwrap();
        let markers = reopened.recover_interrupted_pauses(10).unwrap();
        assert_eq!(markers.len(), 1);
        assert!(
            matches!(markers[0].event, Event::Error { ref code, .. } if code == "paused_runtime_lost")
        );
        assert_eq!(
            reopened.runtime_pause(&operation).unwrap().state,
            RuntimePauseState::Interrupted
        );
        assert_eq!(
            reopened.session_state(&session).unwrap(),
            SessionRuntimeState::Interrupted
        );
        assert!(matches!(
            reopened.respond_runtime_pause(&operation, &serde_json::json!({"answer":"yes"}), 11),
            Err(StorageError::PauseNotWaiting(id)) if id == operation
        ));
    }

    #[test]
    fn cancelling_pause_emits_terminal_event_and_is_single_use() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("cancel-paused-session");
        let operation = OperationId::from_stable("cancel-paused-operation");
        storage.create_session(&session, 1).unwrap();
        storage.begin_operation(&session, &operation, 2).unwrap();
        storage
            .save_runtime_pause(
                &session,
                &operation,
                RuntimePauseKind::DoomLoop,
                &serde_json::json!({"reason":"non_progress"}),
                3,
            )
            .unwrap();
        let marker = storage
            .cancel_runtime_pause(&operation, "user_cancelled", 4)
            .unwrap();
        assert!(matches!(
            marker.event,
            Event::Cancelled { ref reason, .. } if reason == "user_cancelled"
        ));
        assert_eq!(
            storage.runtime_pause(&operation).unwrap().state,
            RuntimePauseState::Cancelled
        );
        assert!(matches!(
            storage.cancel_runtime_pause(&operation, "again", 5),
            Err(StorageError::PauseNotWaiting(id)) if id == operation
        ));
    }

    #[test]
    fn sqlite_replay_preserves_future_minor_unknown_parts_opaquely() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session-future-part");
        storage.create_session(&session, 1).unwrap();
        let inserted = storage
            .append_event(&session, 2, text_event("placeholder"))
            .unwrap();
        let body = serde_json::json!({
            "type": "future_bytes",
            "data": { "bytes": [0, 128, 255], "value": 9007199254740991_u64 }
        });
        let envelope = serde_json::json!({
            "protocol_version": { "major": 1, "minor": 1 },
            "id": inserted.id,
            "cursor": inserted.cursor,
            "session_id": session,
            "emitted_at_ms": 2,
            "event": {
                "type": "message_appended",
                "data": { "message": {
                    "schema_version": 1,
                    "id": "message-future-part",
                    "session_id": "session-future-part",
                    "created_at_ms": 2,
                    "parts": [{
                        "schema_version": 2,
                        "id": "part-future",
                        "state": "completed",
                        "provenance": "tool-output",
                        "body": body
                    }]
                }}
            }
        });
        storage
            .connection
            .execute(
                "UPDATE events SET envelope_json = ?1 WHERE event_id = ?2",
                params![envelope.to_string(), inserted.id.0],
            )
            .unwrap();

        let replayed = storage.replay(&session, None, None).unwrap();
        let Event::MessageAppended { message } = &replayed.events[0].event else {
            panic!("wrong event")
        };
        assert!(matches!(
            &message.parts[0].body,
            MessagePartBody::Unknown { type_name, data }
                if type_name == "future_bytes" && data == &body["data"]
        ));
        assert_eq!(
            serde_json::to_value(&replayed.events[0]).unwrap()["event"]["data"]["message"]["parts"]
                [0]["body"],
            body
        );
    }

    #[test]
    fn sqlite_replay_rejects_unknown_part_at_equal_minor() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("session-invalid-part");
        storage.create_session(&session, 1).unwrap();
        let inserted = storage
            .append_event(&session, 2, text_event("placeholder"))
            .unwrap();
        let mut envelope = serde_json::to_value(&inserted).unwrap();
        envelope["event"] = serde_json::json!({
            "type": "message_appended",
            "data": { "message": {
                "schema_version": 1,
                "id": "message-invalid-part",
                "session_id": "session-invalid-part",
                "created_at_ms": 2,
                "parts": [{
                    "schema_version": 1,
                    "id": "part-invalid",
                    "state": "completed",
                    "provenance": "tool-output",
                    "body": { "type": "not_in_equal_schema", "data": {} }
                }]
            }}
        });
        storage
            .connection
            .execute(
                "UPDATE events SET envelope_json = ?1 WHERE event_id = ?2",
                params![envelope.to_string(), inserted.id.0],
            )
            .unwrap();

        assert!(matches!(
            storage.replay(&session, None, None),
            Err(StorageError::Protocol(
                ProtocolDecodeError::UnknownPartAtEqualVersion { .. }
            ))
        ));
    }

    #[test]
    fn future_schema_is_rejected_without_running_migrations() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("future.db");
        let connection = Connection::open(&path).unwrap();
        connection.pragma_update(None, "user_version", 99).unwrap();
        drop(connection);

        assert!(matches!(
            Storage::open(path),
            Err(StorageError::FutureSchema {
                found: 99,
                supported: SCHEMA_VERSION
            })
        ));
    }

    #[test]
    fn truncated_database_returns_typed_recovery_without_replacement() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("truncated.db");
        let original = b"SQLite format 3\0truncated-canary";
        std::fs::write(&path, original).unwrap();
        let error = match Storage::open(&path) {
            Err(error) => error,
            Ok(_) => panic!("truncated database unexpectedly opened"),
        };
        assert!(matches!(
            error,
            StorageError::RecoveryRequired {
                code: "integrity_check_failed" | "database_open_failed",
                ..
            }
        ));
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(error.to_string().contains("preserve state.db"));
    }

    #[test]
    fn malformed_wal_is_rejected_before_sqlite_can_ignore_or_replace_it() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("wal-mismatch.db");
        drop(Storage::open(&path).unwrap());
        let wal = directory.path().join("wal-mismatch.db-wal");
        let malformed = [0x5a_u8; 32];
        std::fs::write(&wal, malformed).unwrap();
        let error = match Storage::open(&path) {
            Err(error) => error,
            Ok(_) => panic!("malformed WAL unexpectedly opened"),
        };
        assert!(matches!(
            error,
            StorageError::RecoveryRequired {
                code: "wal_header_mismatch",
                ..
            }
        ));
        assert_eq!(std::fs::read(wal).unwrap(), malformed);
    }

    #[cfg(unix)]
    #[test]
    fn database_open_and_diagnose_reject_symlink_and_hardlink_paths() {
        use std::os::unix::fs::symlink;
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.db");
        drop(Storage::open(&source).unwrap());
        let symlink_path = directory.path().join("symlink.db");
        symlink(&source, &symlink_path).unwrap();
        let hardlink_path = directory.path().join("hardlink.db");
        std::fs::hard_link(&source, &hardlink_path).unwrap();

        for path in [&symlink_path, &hardlink_path] {
            assert!(matches!(
                Storage::open(path),
                Err(StorageError::RecoveryRequired {
                    code: "database_path_unsafe",
                    ..
                })
            ));
            assert!(matches!(
                Storage::diagnose(path),
                Err(StorageError::RecoveryRequired {
                    code: "database_path_unsafe",
                    ..
                })
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn database_open_and_diagnose_reject_symlinked_wal() {
        use std::os::unix::fs::symlink;
        let directory = tempdir().unwrap();
        let database = directory.path().join("state.db");
        drop(Storage::open(&database).unwrap());
        let victim = directory.path().join("victim-wal");
        std::fs::write(&victim, [0_u8; 32]).unwrap();
        let wal = sqlite_sidecar(&database, "-wal");
        symlink(&victim, &wal).unwrap();

        for result in [
            Storage::open(&database).map(drop),
            Storage::diagnose(&database).map(drop),
        ] {
            assert!(matches!(
                result,
                Err(StorageError::RecoveryRequired {
                    code: "wal_path_unsafe",
                    ..
                })
            ));
        }
        assert_eq!(std::fs::read(&victim).unwrap(), [0_u8; 32]);
    }

    #[test]
    fn wal_validation_reads_only_the_fixed_header() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("large.db");
        let wal = directory.path().join("large.db-wal");
        let mut file = File::create(&wal).unwrap();
        let mut header = [0_u8; 32];
        header[..4].copy_from_slice(&0x377f_0682_u32.to_be_bytes());
        header[4..8].copy_from_slice(&3_007_000_u32.to_be_bytes());
        std::io::Write::write_all(&mut file, &header).unwrap();
        file.set_len(1024 * 1024 * 1024).unwrap();

        validate_wal_header(&database).unwrap();
    }

    #[test]
    fn interrupted_schema_migration_is_typed_and_preserves_existing_rows() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("partial-migration.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE sessions (
                    id TEXT PRIMARY KEY, runtime_state TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
                );
                CREATE TABLE events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                    session_id TEXT NOT NULL REFERENCES sessions(id), cursor TEXT NOT NULL UNIQUE,
                    emitted_at_ms INTEGER NOT NULL, envelope_json TEXT NOT NULL
                );
                CREATE TABLE operations (
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
                    state TEXT NOT NULL, started_at_ms INTEGER NOT NULL,
                    finished_at_ms INTEGER, reason TEXT
                );
                CREATE TABLE tool_executions (
                    tool_call_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
                    operation_id TEXT REFERENCES operations(id), state TEXT NOT NULL,
                    result_event_id TEXT
                );
                CREATE TABLE session_drafts (
                    session_id TEXT PRIMARY KEY, project_root TEXT NOT NULL,
                    prompt TEXT NOT NULL, risk_tier TEXT NOT NULL,
                    contract_approved INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO sessions VALUES ('preserve-me', 'active', 1, 1);
                PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);
        let error = match Storage::open(&path) {
            Err(error) => error,
            Ok(_) => panic!("partial migration unexpectedly opened"),
        };
        assert!(matches!(
            error,
            StorageError::RecoveryRequired {
                code: "schema_migration_failed",
                ..
            }
        ));
        let connection = Connection::open(path).unwrap();
        let retained: String = connection
            .query_row("SELECT id FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(retained, "preserve-me");
        assert_eq!(
            connection
                .pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn restart_rejects_logically_corrupt_cursor_without_deleting_events() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("logical-corruption.db");
        let session = SessionId::from_stable("logical-session");
        let event_id = {
            let mut storage = Storage::open(&path).unwrap();
            storage.create_session(&session, 1).unwrap();
            storage
                .append_event(&session, 2, Event::Heartbeat)
                .unwrap()
                .id
        };
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE events SET cursor='e:99999999999999999999' WHERE event_id=?1",
                [&event_id.0],
            )
            .unwrap();
        drop(connection);
        let error = match Storage::open(&path) {
            Err(error) => error,
            Ok(_) => panic!("logically corrupt cursor unexpectedly opened"),
        };
        assert!(matches!(
            error,
            StorageError::RecoveryRequired {
                code: "logical_integrity_check_failed",
                ..
            }
        ));
        let connection = Connection::open(path).unwrap();
        let retained: i64 = connection
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(retained, 1);
    }

    #[test]
    fn restart_rejects_completed_tool_claim_without_owned_result_event() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("dangling-tool-result.db");
        let session = SessionId::from_stable("dangling-tool-session");
        let tool = ToolCallId::from_stable("dangling-tool-call");
        {
            let storage = Storage::open(&path).unwrap();
            storage.create_session(&session, 1).unwrap();
            storage.claim_tool_call(&session, None, &tool).unwrap();
            storage
                .connection
                .execute(
                    "UPDATE tool_executions SET state='completed', result_event_id='missing' \
                     WHERE tool_call_id=?1",
                    [&tool.0],
                )
                .unwrap();
        }

        let error = match Storage::open(&path) {
            Err(error) => error,
            Ok(_) => panic!("dangling completed tool claim unexpectedly opened"),
        };
        assert!(matches!(
            error,
            StorageError::RecoveryRequired {
                code: "logical_integrity_check_failed",
                ..
            }
        ));
        let connection = Connection::open(path).unwrap();
        let retained: String = connection
            .query_row(
                "SELECT result_event_id FROM tool_executions WHERE tool_call_id=?1",
                [&tool.0],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, "missing");
    }

    #[test]
    fn purge_reports_committed_delete_when_vacuum_maintenance_fails() {
        let mut storage = Storage::open_in_memory().unwrap();
        let session = SessionId::from_stable("purge-maintenance");
        storage.create_session(&session, 1).unwrap();
        storage.fail_post_purge_maintenance = true;
        let error = storage.purge_session(&session).unwrap_err();
        assert!(matches!(
            error,
            StorageError::PostPurgeMaintenance { session: ref failed, .. } if *failed == session
        ));
        assert!(matches!(
            storage.session_state(&session),
            Err(StorageError::SessionNotFound(_))
        ));
        assert!(error.to_string().contains("deletion committed"));
    }

    #[test]
    fn session_summaries_are_bounded_and_newest_first() {
        let storage = Storage::open_in_memory().unwrap();
        let older = SessionId::from_stable("summary-older");
        let newer = SessionId::from_stable("summary-newer");
        storage.create_session(&older, 10).unwrap();
        storage.create_session(&newer, 20).unwrap();

        let summaries = storage.list_sessions(1).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].session_id, newer);
        assert_eq!(summaries[0].runtime_state, "active");
    }
}
