//! Project-owned language-server and formatter lifecycle contracts.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use thiserror::Error;
use uuid::Uuid;

const MAX_FORMATTER_SCOPE_FILES: usize = 256;
const MAX_FORMATTER_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FORMATTER_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_JSON_RPC_HEADER_BYTES: usize = 16 * 1024;
const MAX_JSON_RPC_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_PENDING_JSON_RPC_MESSAGES: usize = 256;
const MAX_PROCESS_TIMEOUT_MS: u64 = 5 * 60 * 1_000;
const MAX_PROCESS_ARGUMENTS: usize = 256;
const MAX_PROCESS_ARGUMENT_BYTES: usize = 256 * 1024;

fn hash_file_streaming(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let before = file.metadata()?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut bytes = 0_u64;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        bytes = bytes.saturating_add(count as u64);
        digest.update(&buffer[..count]);
    }
    let after = file.metadata()?;
    if bytes != before.len() || after.len() != before.len() {
        return Err(std::io::Error::other("file changed while it was hashed"));
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn read_file_bounded(path: &Path, max_bytes: u64) -> std::io::Result<Vec<u8>> {
    let before_path = fs::symlink_metadata(path)?;
    if before_path.file_type().is_symlink() || !before_path.is_file() {
        return Err(std::io::Error::other(
            "file is not a regular non-symlink file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before_path.nlink() != 1 {
            return Err(std::io::Error::other(
                "hardlinked formatter files are unsafe",
            ));
        }
    }
    let file = fs::File::open(path)?;
    let opened = file.metadata()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before_path.dev() != opened.dev()
            || before_path.ino() != opened.ino()
            || opened.nlink() != 1
        {
            return Err(std::io::Error::other(
                "formatter file changed identity while opening",
            ));
        }
    }
    if opened.len() > max_bytes {
        return Err(std::io::Error::other(format!(
            "file exceeds {max_bytes} bytes"
        )));
    }
    let mut bytes = Vec::new();
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(std::io::Error::other(format!(
            "file exceeds {max_bytes} bytes"
        )));
    }
    Ok(bytes)
}

fn validate_process_contract(arguments: &[String], timeout_ms: u64) -> Result<(), String> {
    if !(1..=MAX_PROCESS_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(format!(
            "process timeout must be between 1 and {MAX_PROCESS_TIMEOUT_MS}ms"
        ));
    }
    let argument_bytes = arguments
        .iter()
        .try_fold(0_usize, |total, argument| total.checked_add(argument.len()))
        .unwrap_or(usize::MAX);
    if arguments.len() > MAX_PROCESS_ARGUMENTS || argument_bytes > MAX_PROCESS_ARGUMENT_BYTES {
        return Err(format!(
            "process arguments exceed {MAX_PROCESS_ARGUMENTS} entries or {MAX_PROCESS_ARGUMENT_BYTES} bytes"
        ));
    }
    Ok(())
}

fn configure_sanitized_environment(command: &mut Command) {
    command.env_clear();
    for name in ["PATH", "LANG", "LC_ALL", "TMPDIR"] {
        if let Some(value) = std::env::var_os(name).filter(|value| value.len() <= 32 * 1024) {
            command.env(name, value);
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LifecycleDiagnostic {
    pub code: &'static str,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectExecutable {
    pub path: PathBuf,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolAvailability {
    Available(ProjectExecutable),
    Absent(LifecycleDiagnostic),
    Rejected(LifecycleDiagnostic),
}

/// Resolves only explicitly configured or conventional project-local binaries.
/// It never consults PATH and never downloads missing tools.
pub struct ProjectToolResolver {
    root: PathBuf,
}

impl ProjectToolResolver {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, ResolverError> {
        let root = fs::canonicalize(root.as_ref()).map_err(|source| ResolverError::Io {
            path: root.as_ref().to_path_buf(),
            source,
        })?;
        Ok(Self { root })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn resolve(&self, configured_path: &Path) -> ToolAvailability {
        let relative = match normalize_relative(configured_path) {
            Ok(relative) => relative,
            Err(message) => {
                return ToolAvailability::Rejected(LifecycleDiagnostic {
                    code: "tool_path_outside_project",
                    message,
                });
            }
        };
        let candidate = self.root.join(&relative);
        let canonical = match fs::canonicalize(&candidate) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return ToolAvailability::Absent(LifecycleDiagnostic {
                    code: "project_tool_absent",
                    message: format!(
                        "project-owned executable {} is not installed; no download was attempted",
                        relative.display()
                    ),
                });
            }
            Err(error) => {
                return ToolAvailability::Rejected(LifecycleDiagnostic {
                    code: "project_tool_unreadable",
                    message: format!("cannot inspect {}: {error}", relative.display()),
                });
            }
        };
        if !canonical.starts_with(&self.root) {
            return ToolAvailability::Rejected(LifecycleDiagnostic {
                code: "tool_symlink_outside_project",
                message: format!("{} resolves outside the project", relative.display()),
            });
        }
        let metadata = match fs::metadata(&canonical) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => {
                return ToolAvailability::Rejected(LifecycleDiagnostic {
                    code: "project_tool_not_file",
                    message: format!("{} is not a regular file", relative.display()),
                });
            }
            Err(error) => {
                return ToolAvailability::Rejected(LifecycleDiagnostic {
                    code: "project_tool_unreadable",
                    message: error.to_string(),
                });
            }
        };
        if !is_executable(&metadata) {
            return ToolAvailability::Rejected(LifecycleDiagnostic {
                code: "project_tool_not_executable",
                message: format!("{} is not executable", relative.display()),
            });
        }
        match hash_file_streaming(&canonical) {
            Ok(sha256) => ToolAvailability::Available(ProjectExecutable {
                path: canonical,
                sha256,
            }),
            Err(error) => ToolAvailability::Rejected(LifecycleDiagnostic {
                code: "project_tool_unreadable",
                message: error.to_string(),
            }),
        }
    }

    #[must_use]
    pub fn conventional_candidates(name: &str) -> [PathBuf; 3] {
        [
            PathBuf::from("node_modules/.bin").join(name),
            PathBuf::from(".venv/bin").join(name),
            PathBuf::from("target/debug").join(name),
        ]
    }
}

#[derive(Debug, Error)]
pub enum ResolverError {
    #[error("cannot access project path {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DocumentUri(pub String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextRange {
    pub start: Position,
    pub end: Position,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SymbolRequest {
    pub query: String,
    pub limit: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DefinitionRequest {
    pub document: DocumentUri,
    pub position: Position,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReferencesRequest {
    pub document: DocumentUri,
    pub position: Position,
    pub include_declaration: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiagnosticsRequest {
    pub document: DocumentUri,
    pub expected_version: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnostic {
    pub range: TextRange,
    pub severity: DiagnosticSeverity,
    pub code: Option<String>,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticSource {
    Push,
    Pull,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticFreshness {
    Pending,
    Fresh,
    Stale,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiagnosticSnapshot {
    pub freshness: DiagnosticFreshness,
    pub version: Option<u64>,
    pub source: Option<DiagnosticSource>,
    pub diagnostics: Vec<Diagnostic>,
    pub diagnostic: Option<LifecycleDiagnostic>,
}

#[derive(Clone, Debug)]
struct DocumentDiagnostics {
    expected_version: u64,
    pull_due_at_ms: u64,
    pull_in_flight_since_ms: Option<u64>,
    received_at_ms: Option<u64>,
    received_version: Option<u64>,
    source: Option<DiagnosticSource>,
    diagnostics: Vec<Diagnostic>,
}

pub struct DiagnosticsCoordinator {
    debounce_ms: u64,
    freshness_timeout_ms: u64,
    available: bool,
    documents: BTreeMap<DocumentUri, DocumentDiagnostics>,
}

impl DiagnosticsCoordinator {
    #[must_use]
    pub fn new(debounce_ms: u64, freshness_timeout_ms: u64) -> Self {
        Self {
            debounce_ms,
            freshness_timeout_ms,
            available: true,
            documents: BTreeMap::new(),
        }
    }

    pub fn set_available(&mut self, available: bool) {
        if self.available && !available {
            for entry in self.documents.values_mut() {
                entry.pull_in_flight_since_ms = None;
                entry.received_at_ms = None;
                entry.received_version = None;
                entry.source = None;
                entry.diagnostics.clear();
            }
        }
        self.available = available;
    }

    pub fn file_changed(&mut self, document: DocumentUri, version: u64, now_ms: u64) {
        if self
            .documents
            .get(&document)
            .is_some_and(|entry| version <= entry.expected_version)
        {
            return;
        }
        let entry = self
            .documents
            .entry(document)
            .or_insert(DocumentDiagnostics {
                expected_version: version,
                pull_due_at_ms: now_ms.saturating_add(self.debounce_ms),
                pull_in_flight_since_ms: None,
                received_at_ms: None,
                received_version: None,
                source: None,
                diagnostics: Vec::new(),
            });
        entry.expected_version = version;
        entry.pull_due_at_ms = now_ms.saturating_add(self.debounce_ms);
        entry.pull_in_flight_since_ms = None;
    }

    /// Returns debounced pull requests and marks them in flight.
    pub fn due_pulls(&mut self, now_ms: u64) -> Vec<DiagnosticsRequest> {
        if !self.available {
            return Vec::new();
        }
        self.documents
            .iter_mut()
            .filter(|(_, entry)| {
                let in_flight_fresh = entry.pull_in_flight_since_ms.is_some_and(|started| {
                    now_ms.saturating_sub(started) <= self.freshness_timeout_ms
                });
                let version_fresh = entry
                    .received_version
                    .is_some_and(|version| version >= entry.expected_version);
                let receipt_fresh = entry.received_at_ms.is_some_and(|received| {
                    now_ms.saturating_sub(received) <= self.freshness_timeout_ms
                });
                !in_flight_fresh
                    && now_ms >= entry.pull_due_at_ms
                    && !(version_fresh && receipt_fresh)
            })
            .map(|(document, entry)| {
                entry.pull_in_flight_since_ms = Some(now_ms);
                DiagnosticsRequest {
                    document: document.clone(),
                    expected_version: entry.expected_version,
                }
            })
            .collect()
    }

    /// Stale push diagnostics are ignored instead of being reported as fresh.
    pub fn accept_push(
        &mut self,
        document: &DocumentUri,
        version: u64,
        diagnostics: Vec<Diagnostic>,
        now_ms: u64,
    ) -> bool {
        self.accept(
            document,
            version,
            diagnostics,
            now_ms,
            DiagnosticSource::Push,
        )
    }

    pub fn accept_pull(
        &mut self,
        request: &DiagnosticsRequest,
        diagnostics: Vec<Diagnostic>,
        now_ms: u64,
    ) -> bool {
        self.accept(
            &request.document,
            request.expected_version,
            diagnostics,
            now_ms,
            DiagnosticSource::Pull,
        )
    }

    pub fn accept_pull_unchanged(&mut self, request: &DiagnosticsRequest, now_ms: u64) -> bool {
        let Some(diagnostics) = self
            .documents
            .get(&request.document)
            .map(|entry| entry.diagnostics.clone())
        else {
            return false;
        };
        self.accept_pull(request, diagnostics, now_ms)
    }

    fn accept(
        &mut self,
        document: &DocumentUri,
        version: u64,
        diagnostics: Vec<Diagnostic>,
        now_ms: u64,
        source: DiagnosticSource,
    ) -> bool {
        let Some(entry) = self.documents.get_mut(document) else {
            return false;
        };
        if version != entry.expected_version {
            return false;
        }
        entry.received_version = Some(version);
        entry.received_at_ms = Some(now_ms);
        entry.source = Some(source);
        entry.diagnostics = diagnostics;
        entry.pull_in_flight_since_ms = None;
        true
    }

    #[must_use]
    pub fn snapshot(&self, document: &DocumentUri, now_ms: u64) -> DiagnosticSnapshot {
        if !self.available {
            return DiagnosticSnapshot {
                freshness: DiagnosticFreshness::Unavailable,
                version: None,
                source: None,
                diagnostics: Vec::new(),
                diagnostic: Some(LifecycleDiagnostic {
                    code: "language_server_absent",
                    message: "language server is unavailable; diagnostics were not run".into(),
                }),
            };
        }
        let Some(entry) = self.documents.get(document) else {
            return DiagnosticSnapshot {
                freshness: DiagnosticFreshness::Pending,
                version: None,
                source: None,
                diagnostics: Vec::new(),
                diagnostic: None,
            };
        };
        let freshness = match (entry.received_at_ms, entry.received_version) {
            (Some(received), Some(version))
                if version >= entry.expected_version
                    && now_ms.saturating_sub(received) <= self.freshness_timeout_ms =>
            {
                DiagnosticFreshness::Fresh
            }
            (Some(_), Some(_)) => DiagnosticFreshness::Stale,
            _ => DiagnosticFreshness::Pending,
        };
        DiagnosticSnapshot {
            freshness,
            version: entry.received_version,
            source: entry.source,
            diagnostics: entry.diagnostics.clone(),
            diagnostic: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProcessState {
    Detected,
    Starting,
    Running,
    Failed,
    Stopping,
    Stopped,
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RequestId(pub String);

impl RequestId {
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for RequestId {
    fn default() -> Self {
        Self::new()
    }
}

pub trait ScopedProcessLifecycle {
    fn cancel_pending(&mut self) -> Vec<RequestId>;
    fn dispose(&mut self) -> Vec<RequestId>;
    fn state(&self) -> ProcessState;
}

pub struct ScopedLanguageServer {
    pub project_scope: String,
    pub executable: ProjectExecutable,
    state: ProcessState,
    pending: BTreeSet<RequestId>,
}

impl ScopedLanguageServer {
    #[must_use]
    pub fn detected(project_scope: String, executable: ProjectExecutable) -> Self {
        Self {
            project_scope,
            executable,
            state: ProcessState::Detected,
            pending: BTreeSet::new(),
        }
    }

    pub fn mark_starting(&mut self) {
        self.state = ProcessState::Starting;
    }

    pub fn mark_running(&mut self) {
        self.state = ProcessState::Running;
    }

    pub fn begin_request(&mut self) -> Result<RequestId, ProcessContractError> {
        if self.state != ProcessState::Running {
            return Err(ProcessContractError::NotRunning(self.state));
        }
        let id = RequestId::new();
        self.pending.insert(id.clone());
        Ok(id)
    }

    pub fn finish_request(&mut self, id: &RequestId) -> bool {
        self.pending.remove(id)
    }
}

impl ScopedProcessLifecycle for ScopedLanguageServer {
    fn cancel_pending(&mut self) -> Vec<RequestId> {
        let cancelled = self.pending.iter().cloned().collect();
        self.pending.clear();
        cancelled
    }

    fn dispose(&mut self) -> Vec<RequestId> {
        let cancelled = self.cancel_pending();
        self.state = ProcessState::Disposed;
        cancelled
    }

    fn state(&self) -> ProcessState {
        self.state
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProcessContractError {
    #[error("scoped process is not running: {0:?}")]
    NotRunning(ProcessState),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormatterConfig {
    pub name: String,
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub extensions: BTreeSet<String>,
    /// Additional project-relative files a formatter is declared to mutate.
    /// The runtime snapshots these paths before starting the process.
    pub scope_paths: BTreeSet<PathBuf>,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormatterInvocation {
    pub executable: ProjectExecutable,
    pub arguments: Vec<String>,
    pub input_path: PathBuf,
    pub timeout_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FormatterStatus {
    Unchanged,
    Formatted,
    Failed,
    Cancelled,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProofImpact {
    pub edit_hash: Option<String>,
    pub invalidated_paths: Vec<PathBuf>,
    pub requires_reprove: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormatterResult {
    pub status: FormatterStatus,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
    pub diagnostic: Option<LifecycleDiagnostic>,
    pub proof_impact: ProofImpact,
}

struct FormatterFileDelta {
    path: PathBuf,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}

/// Project-scoped formatter lifecycle. It tracks logical executions so project
/// disposal can deterministically cancel them without affecting another scope.
pub struct ScopedFormatter {
    pub project_scope: String,
    pub config: FormatterConfig,
    pub executable: ProjectExecutable,
    state: ProcessState,
    pending: BTreeSet<RequestId>,
}

impl ScopedFormatter {
    #[must_use]
    pub fn detected(
        project_scope: String,
        config: FormatterConfig,
        executable: ProjectExecutable,
    ) -> Self {
        Self {
            project_scope,
            config,
            executable,
            state: ProcessState::Detected,
            pending: BTreeSet::new(),
        }
    }

    pub fn mark_running(&mut self) {
        self.state = ProcessState::Running;
    }

    pub fn begin_format(&mut self) -> Result<RequestId, ProcessContractError> {
        if self.state != ProcessState::Running {
            return Err(ProcessContractError::NotRunning(self.state));
        }
        let id = RequestId::new();
        self.pending.insert(id.clone());
        Ok(id)
    }

    pub fn finish_format(&mut self, id: &RequestId) -> bool {
        self.pending.remove(id)
    }
}

impl ScopedProcessLifecycle for ScopedFormatter {
    fn cancel_pending(&mut self) -> Vec<RequestId> {
        let cancelled = self.pending.iter().cloned().collect();
        self.pending.clear();
        cancelled
    }

    fn dispose(&mut self) -> Vec<RequestId> {
        let cancelled = self.cancel_pending();
        self.state = ProcessState::Disposed;
        cancelled
    }

    fn state(&self) -> ProcessState {
        self.state
    }
}

impl FormatterConfig {
    pub fn invocation(
        &self,
        resolver: &ProjectToolResolver,
        input_path: &Path,
    ) -> Result<FormatterInvocation, Box<FormatterResult>> {
        if let Err(message) = validate_process_contract(&self.arguments, self.timeout_ms) {
            return Err(Box::new(failed_formatter_result(
                "formatter_configuration_invalid",
                message,
            )));
        }
        let extension = input_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !self.extensions.contains(extension) {
            return Err(Box::new(unavailable_formatter_result(
                "formatter_not_configured_for_file",
                format!("formatter {} does not handle .{extension} files", self.name),
            )));
        }
        match resolver.resolve(&self.executable) {
            ToolAvailability::Available(executable) => Ok(FormatterInvocation {
                executable,
                arguments: self.arguments.clone(),
                input_path: input_path.to_path_buf(),
                timeout_ms: self.timeout_ms,
            }),
            ToolAvailability::Absent(diagnostic) | ToolAvailability::Rejected(diagnostic) => {
                Err(Box::new(FormatterResult {
                    status: FormatterStatus::Unavailable,
                    before_sha256: None,
                    after_sha256: None,
                    diagnostic: Some(diagnostic),
                    proof_impact: ProofImpact {
                        edit_hash: None,
                        invalidated_paths: Vec::new(),
                        requires_reprove: false,
                    },
                }))
            }
        }
    }

    #[must_use]
    pub fn record_output(input_path: &Path, before: &[u8], after: &[u8]) -> FormatterResult {
        let before_sha256 = format!("{:x}", Sha256::digest(before));
        let after_sha256 = format!("{:x}", Sha256::digest(after));
        let changed = before_sha256 != after_sha256;
        let edit_hash = changed.then(|| {
            let mut digest = Sha256::new();
            digest.update(input_path.as_os_str().as_encoded_bytes());
            digest.update(before_sha256.as_bytes());
            digest.update(after_sha256.as_bytes());
            format!("{:x}", digest.finalize())
        });
        FormatterResult {
            status: if changed {
                FormatterStatus::Formatted
            } else {
                FormatterStatus::Unchanged
            },
            before_sha256: Some(before_sha256),
            after_sha256: Some(after_sha256),
            diagnostic: None,
            proof_impact: ProofImpact {
                edit_hash,
                invalidated_paths: changed
                    .then(|| input_path.to_path_buf())
                    .into_iter()
                    .collect(),
                requires_reprove: changed,
            },
        }
    }

    fn record_scoped_outputs(input_path: &Path, files: &[FormatterFileDelta]) -> FormatterResult {
        let Some(input) = files.iter().find(|file| file.path == input_path) else {
            return failed_formatter_result(
                "formatter_input_missing",
                "formatter input is absent from its declared output scope".into(),
            );
        };
        let before_sha256 = input
            .before
            .as_deref()
            .map(|bytes| format!("{:x}", Sha256::digest(bytes)));
        let after_sha256 = input
            .after
            .as_deref()
            .map(|bytes| format!("{:x}", Sha256::digest(bytes)));
        let invalidated_paths = files
            .iter()
            .filter(|file| file.before != file.after)
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        let edit_hash = (!invalidated_paths.is_empty()).then(|| {
            let mut digest = Sha256::new();
            for file in files.iter().filter(|file| file.before != file.after) {
                digest.update(file.path.as_os_str().as_encoded_bytes());
                digest.update([0]);
                digest.update(
                    file.before
                        .as_deref()
                        .map(|bytes| Sha256::digest(bytes).to_vec())
                        .unwrap_or_else(|| vec![0; 32]),
                );
                digest.update(
                    file.after
                        .as_deref()
                        .map(|bytes| Sha256::digest(bytes).to_vec())
                        .unwrap_or_else(|| vec![0; 32]),
                );
            }
            format!("{:x}", digest.finalize())
        });
        FormatterResult {
            status: if invalidated_paths.is_empty() {
                FormatterStatus::Unchanged
            } else {
                FormatterStatus::Formatted
            },
            before_sha256,
            after_sha256,
            diagnostic: None,
            proof_impact: ProofImpact {
                edit_hash,
                requires_reprove: !invalidated_paths.is_empty(),
                invalidated_paths,
            },
        }
    }
}

fn unavailable_formatter_result(code: &'static str, message: String) -> FormatterResult {
    FormatterResult {
        status: FormatterStatus::Unavailable,
        before_sha256: None,
        after_sha256: None,
        diagnostic: Some(LifecycleDiagnostic { code, message }),
        proof_impact: ProofImpact {
            edit_hash: None,
            invalidated_paths: Vec::new(),
            requires_reprove: false,
        },
    }
}

fn normalize_relative(path: &Path) -> Result<PathBuf, String> {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("{} is not a project-relative path", path.display()));
            }
        }
    }
    if result.as_os_str().is_empty() {
        Err("empty executable path is invalid".into())
    } else {
        Ok(result)
    }
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    true
}

/// Configuration for a project-owned language server. The executable must be
/// relative to the project and is resolved by [`ProjectToolResolver`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LanguageServerConfig {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub language_id: String,
    pub request_timeout_ms: u64,
    pub diagnostic_debounce_ms: u64,
    pub diagnostic_freshness_timeout_ms: u64,
}

/// Transport-neutral request for a project process launcher. Production
/// callers use this boundary to require an OS sandbox; repository configuration
/// never receives the launcher or expands its writable paths.
pub struct ProjectProcessSpec<'a> {
    pub root: &'a Path,
    pub executable: &'a Path,
    pub arguments: &'a [String],
    pub writable_paths: &'a [PathBuf],
}

pub trait ProjectProcessLauncher: Send + Sync {
    fn command(&self, spec: ProjectProcessSpec<'_>) -> Result<Command, String>;
}

struct DirectProjectProcessLauncher;

impl ProjectProcessLauncher for DirectProjectProcessLauncher {
    fn command(&self, spec: ProjectProcessSpec<'_>) -> Result<Command, String> {
        let mut command = Command::new(spec.executable);
        command.args(spec.arguments);
        Ok(command)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Location {
    pub uri: DocumentUri,
    pub range: TextRange,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SymbolInformation {
    pub name: String,
    pub kind: u32,
    pub location: Option<Location>,
}

#[derive(Debug, Error)]
pub enum LanguageRuntimeError {
    #[error("invalid language server configuration: {0}")]
    InvalidConfiguration(String),
    #[error("language server executable is unavailable: {0}")]
    Unavailable(String),
    #[error("cannot spawn language server {path}: {source}")]
    Spawn {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("language server I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("language server request {method} timed out after {timeout_ms}ms")]
    Timeout { method: String, timeout_ms: u64 },
    #[error("language server exited unexpectedly: {0}")]
    Crashed(String),
    #[error("language server returned an error for {method}: {message}")]
    Response { method: String, message: String },
    #[error("invalid language server response for {method}: {message}")]
    InvalidResponse { method: String, message: String },
    #[error("language server is already disposed")]
    Disposed,
}

#[derive(Debug)]
enum RpcReadError {
    Io(String),
    Protocol(String),
}

/// A real JSON-RPC language-server child process owned by one project scope.
/// It never searches PATH, downloads tools, or shares a process across roots.
pub struct RunningLanguageServer {
    project_scope: String,
    root: PathBuf,
    config: LanguageServerConfig,
    child: Child,
    stdin: Option<ChildStdin>,
    messages: Receiver<Result<Value, RpcReadError>>,
    reader: Option<JoinHandle<()>>,
    next_id: u64,
    pending: BTreeSet<u64>,
    diagnostics: DiagnosticsCoordinator,
    started: Instant,
    disposed: bool,
    launcher: Arc<dyn ProjectProcessLauncher>,
}

impl RunningLanguageServer {
    pub fn start(
        project_scope: impl Into<String>,
        root: impl AsRef<Path>,
        config: LanguageServerConfig,
    ) -> Result<Self, LanguageRuntimeError> {
        Self::start_with_launcher(
            project_scope,
            root,
            config,
            Arc::new(DirectProjectProcessLauncher),
        )
    }

    pub fn start_with_launcher(
        project_scope: impl Into<String>,
        root: impl AsRef<Path>,
        config: LanguageServerConfig,
        launcher: Arc<dyn ProjectProcessLauncher>,
    ) -> Result<Self, LanguageRuntimeError> {
        validate_process_contract(&config.arguments, config.request_timeout_ms)
            .map_err(LanguageRuntimeError::InvalidConfiguration)?;
        let resolver = ProjectToolResolver::new(root.as_ref())
            .map_err(|error| LanguageRuntimeError::Unavailable(error.to_string()))?;
        let executable = match resolver.resolve(&config.executable) {
            ToolAvailability::Available(executable) => executable,
            ToolAvailability::Absent(diagnostic) | ToolAvailability::Rejected(diagnostic) => {
                return Err(LanguageRuntimeError::Unavailable(diagnostic.message));
            }
        };
        if hash_file_streaming(&executable.path)? != executable.sha256 {
            return Err(LanguageRuntimeError::Unavailable(
                "project language server changed after resolution".into(),
            ));
        }
        let mut command = launcher
            .command(ProjectProcessSpec {
                root: resolver.root(),
                executable: &executable.path,
                arguments: &config.arguments,
                writable_paths: &[],
            })
            .map_err(LanguageRuntimeError::Unavailable)?;
        command
            .current_dir(resolver.root())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        configure_sanitized_environment(&mut command);
        configure_owned_process_group(&mut command);
        let mut child = command
            .spawn()
            .map_err(|source| LanguageRuntimeError::Spawn {
                path: executable.path,
                source,
            })?;
        let Some(stdin) = child.stdin.take() else {
            let _ = terminate_owned_process_group(&mut child);
            return Err(LanguageRuntimeError::Crashed(
                "child stdin was not available".into(),
            ));
        };
        let Some(stdout) = child.stdout.take() else {
            let _ = terminate_owned_process_group(&mut child);
            return Err(LanguageRuntimeError::Crashed(
                "child stdout was not available".into(),
            ));
        };
        let (sender, messages) = mpsc::sync_channel(MAX_PENDING_JSON_RPC_MESSAGES);
        let reader = thread::spawn(move || read_json_rpc(stdout, sender));
        let mut server = Self {
            project_scope: project_scope.into(),
            root: resolver.root().to_path_buf(),
            diagnostics: DiagnosticsCoordinator::new(
                config.diagnostic_debounce_ms,
                config.diagnostic_freshness_timeout_ms,
            ),
            config,
            child,
            stdin: Some(stdin),
            messages,
            reader: Some(reader),
            next_id: 1,
            pending: BTreeSet::new(),
            started: Instant::now(),
            disposed: false,
            launcher,
        };
        let initialize = json!({
            "processId": std::process::id(),
            "rootUri": path_to_file_uri(&server.root),
            "capabilities": {
                "textDocument": { "diagnostic": {} },
                "workspace": { "symbol": {} }
            },
            "clientInfo": { "name": "changeloop", "version": env!("CARGO_PKG_VERSION") }
        });
        server.request("initialize", initialize)?;
        server.notify("initialized", json!({}))?;
        Ok(server)
    }

    #[must_use]
    pub fn project_scope(&self) -> &str {
        &self.project_scope
    }

    pub fn workspace_symbols(
        &mut self,
        request: &SymbolRequest,
    ) -> Result<Vec<SymbolInformation>, LanguageRuntimeError> {
        let value = self.request("workspace/symbol", json!({ "query": request.query }))?;
        let mut symbols = if value.is_null() {
            Vec::new()
        } else {
            value
                .as_array()
                .ok_or_else(|| LanguageRuntimeError::InvalidResponse {
                    method: "workspace/symbol".into(),
                    message: "result must be an array or null".into(),
                })?
                .iter()
                .map(|value| {
                    parse_symbol(value.clone()).ok_or_else(|| {
                        LanguageRuntimeError::InvalidResponse {
                            method: "workspace/symbol".into(),
                            message: "result contains an invalid symbol".into(),
                        }
                    })
                })
                .collect::<Result<Vec<_>, _>>()?
        };
        symbols.truncate(request.limit as usize);
        Ok(symbols)
    }

    pub fn definition(
        &mut self,
        request: &DefinitionRequest,
    ) -> Result<Vec<Location>, LanguageRuntimeError> {
        let value = self.request("textDocument/definition", json!({
            "textDocument": { "uri": request.document.0 },
            "position": { "line": request.position.line, "character": request.position.character }
        }))?;
        parse_locations_checked("textDocument/definition", &value)
    }

    pub fn references(
        &mut self,
        request: &ReferencesRequest,
    ) -> Result<Vec<Location>, LanguageRuntimeError> {
        let value = self.request("textDocument/references", json!({
            "textDocument": { "uri": request.document.0 },
            "position": { "line": request.position.line, "character": request.position.character },
            "context": { "includeDeclaration": request.include_declaration }
        }))?;
        parse_locations_checked("textDocument/references", &value)
    }

    pub fn file_changed(&mut self, document: DocumentUri, version: u64) {
        let now = self.now_ms();
        self.diagnostics.file_changed(document, version, now);
    }

    pub fn open_document(
        &mut self,
        document: DocumentUri,
        version: u64,
        text: &str,
    ) -> Result<(), LanguageRuntimeError> {
        self.file_changed(document.clone(), version);
        self.notify(
            "textDocument/didOpen",
            json!({
                "textDocument": {
                    "uri": document.0,
                    "languageId": self.config.language_id,
                    "version": version,
                    "text": text
                }
            }),
        )
    }

    pub fn change_document(
        &mut self,
        document: DocumentUri,
        version: u64,
        text: &str,
    ) -> Result<(), LanguageRuntimeError> {
        self.file_changed(document.clone(), version);
        self.notify(
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": document.0, "version": version },
                "contentChanges": [{ "text": text }]
            }),
        )
    }

    pub fn diagnostic_snapshot(
        &mut self,
        document: &DocumentUri,
    ) -> Result<DiagnosticSnapshot, LanguageRuntimeError> {
        self.drain_notifications()?;
        Ok(self.diagnostics.snapshot(document, self.now_ms()))
    }

    /// Adjusts future request deadlines without changing process ownership.
    pub fn set_request_timeout_ms(&mut self, timeout_ms: u64) {
        self.config.request_timeout_ms = timeout_ms.clamp(1, MAX_PROCESS_TIMEOUT_MS);
    }

    /// Replaces a failed or unhealthy child with a clean process using the
    /// same project-owned executable and configuration. Diagnostics are not
    /// carried across the process boundary and must become fresh again.
    pub fn restart(&mut self) -> Result<(), LanguageRuntimeError> {
        // Shutdown always performs owned-process cleanup before returning its
        // protocol result. A crashed server is therefore safe to replace even
        // though its graceful shutdown request necessarily failed.
        let _ = self.shutdown();
        let replacement = Self::start_with_launcher(
            self.project_scope.clone(),
            self.root.clone(),
            self.config.clone(),
            Arc::clone(&self.launcher),
        )?;
        *self = replacement;
        Ok(())
    }

    /// Executes debounced pull diagnostics. Push notifications received while
    /// waiting are also recorded with their server-provided document version.
    pub fn poll_diagnostics(
        &mut self,
        document: &DocumentUri,
    ) -> Result<DiagnosticSnapshot, LanguageRuntimeError> {
        self.drain_notifications()?;
        let now = self.now_ms();
        for request in self.diagnostics.due_pulls(now) {
            let response = self.request(
                "textDocument/diagnostic",
                json!({
                    "textDocument": { "uri": request.document.0 }
                }),
            )?;
            let received = self.now_ms();
            match response.get("kind").and_then(Value::as_str) {
                Some("unchanged") => {
                    self.diagnostics.accept_pull_unchanged(&request, received);
                }
                Some("full") => {
                    let items = response
                        .get("items")
                        .and_then(Value::as_array)
                        .ok_or_else(|| LanguageRuntimeError::InvalidResponse {
                            method: "textDocument/diagnostic".into(),
                            message: "full diagnostic result must contain an items array".into(),
                        })?
                        .iter()
                        .map(|value| {
                            parse_diagnostic(value).ok_or_else(|| {
                                LanguageRuntimeError::InvalidResponse {
                                    method: "textDocument/diagnostic".into(),
                                    message: "result contains an invalid diagnostic".into(),
                                }
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    self.diagnostics.accept_pull(&request, items, received);
                }
                _ => {
                    return Err(LanguageRuntimeError::InvalidResponse {
                        method: "textDocument/diagnostic".into(),
                        message: "diagnostic result has an invalid or missing kind".into(),
                    });
                }
            }
        }
        Ok(self.diagnostics.snapshot(document, self.now_ms()))
    }

    pub fn cancel_pending(&mut self) -> Result<usize, LanguageRuntimeError> {
        let ids = self.pending.iter().copied().collect::<Vec<_>>();
        self.pending.clear();
        let mut first_error = None;
        for id in &ids {
            if let Err(error) = self.notify("$/cancelRequest", json!({ "id": id })) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(ids.len()), Err)
    }

    pub fn shutdown(&mut self) -> Result<(), LanguageRuntimeError> {
        if self.disposed {
            return Ok(());
        }
        let _ = self.cancel_pending();
        let shutdown_result = self.request("shutdown", Value::Null);
        let _ = self.notify("exit", Value::Null);
        self.stdin.take();
        let deadline = Instant::now() + Duration::from_millis(self.config.request_timeout_ms);
        loop {
            match self.child.try_wait()? {
                Some(_) => break,
                None if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                None => {
                    terminate_owned_process_group(&mut self.child)?;
                    break;
                }
            }
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        self.disposed = true;
        shutdown_result.map(|_| ())
    }

    fn now_ms(&self) -> u64 {
        self.started
            .elapsed()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), LanguageRuntimeError> {
        if self.disposed {
            return Err(LanguageRuntimeError::Disposed);
        }
        self.write_message(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, LanguageRuntimeError> {
        if self.disposed {
            return Err(LanguageRuntimeError::Disposed);
        }
        if let Some(status) = self.child.try_wait()? {
            return Err(LanguageRuntimeError::Crashed(status.to_string()));
        }
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.pending.insert(id);
        if let Err(error) = self.write_message(&json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params
        })) {
            self.pending.remove(&id);
            return Err(error);
        }
        let deadline = Instant::now() + Duration::from_millis(self.config.request_timeout_ms);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.messages.recv_timeout(remaining) {
                Ok(Ok(message)) if message.get("id").and_then(Value::as_u64) == Some(id) => {
                    self.pending.remove(&id);
                    if let Some(error) = message.get("error") {
                        return Err(LanguageRuntimeError::Response {
                            method: method.into(),
                            message: error.to_string(),
                        });
                    }
                    return Ok(message.get("result").cloned().unwrap_or(Value::Null));
                }
                Ok(Ok(message)) => self.handle_notification(&message),
                Ok(Err(RpcReadError::Protocol(message))) => {
                    self.pending.remove(&id);
                    return Err(LanguageRuntimeError::InvalidResponse {
                        method: method.into(),
                        message,
                    });
                }
                Ok(Err(RpcReadError::Io(message))) => {
                    self.pending.remove(&id);
                    return Err(LanguageRuntimeError::Crashed(message));
                }
                Err(RecvTimeoutError::Timeout) => {
                    self.pending.remove(&id);
                    let _ = self.notify("$/cancelRequest", json!({ "id": id }));
                    self.stdin.take();
                    let _ = terminate_owned_process_group(&mut self.child);
                    self.diagnostics.set_available(false);
                    return Err(LanguageRuntimeError::Timeout {
                        method: method.into(),
                        timeout_ms: self.config.request_timeout_ms,
                    });
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.pending.remove(&id);
                    let status = self.child.try_wait()?.map_or_else(
                        || "response stream disconnected".into(),
                        |status| status.to_string(),
                    );
                    return Err(LanguageRuntimeError::Crashed(status));
                }
            }
        }
    }

    fn write_message(&mut self, value: &Value) -> Result<(), LanguageRuntimeError> {
        let encoded =
            serde_json::to_vec(value).map_err(|error| LanguageRuntimeError::InvalidResponse {
                method: "serialization".into(),
                message: error.to_string(),
            })?;
        if encoded.len() > MAX_JSON_RPC_MESSAGE_BYTES {
            return Err(LanguageRuntimeError::InvalidResponse {
                method: "serialization".into(),
                message: format!("JSON-RPC request exceeds {MAX_JSON_RPC_MESSAGE_BYTES} bytes"),
            });
        }
        let stdin = self.stdin.as_mut().ok_or(LanguageRuntimeError::Disposed)?;
        write!(stdin, "Content-Length: {}\r\n\r\n", encoded.len())?;
        stdin.write_all(&encoded)?;
        stdin.flush()?;
        Ok(())
    }

    fn drain_notifications(&mut self) -> Result<(), LanguageRuntimeError> {
        while let Ok(message) = self.messages.try_recv() {
            match message {
                Ok(message) => self.handle_notification(&message),
                Err(RpcReadError::Protocol(message)) => {
                    return Err(LanguageRuntimeError::InvalidResponse {
                        method: "notification".into(),
                        message,
                    });
                }
                Err(RpcReadError::Io(message)) => {
                    return Err(LanguageRuntimeError::Crashed(message));
                }
            }
        }
        Ok(())
    }

    fn handle_notification(&mut self, message: &Value) {
        if message.get("method").and_then(Value::as_str) != Some("textDocument/publishDiagnostics")
        {
            return;
        }
        let Some(params) = message.get("params") else {
            return;
        };
        let Some(uri) = params.get("uri").and_then(Value::as_str) else {
            return;
        };
        let Some(version) = params.get("version").and_then(Value::as_u64) else {
            return;
        };
        let Some(raw_diagnostics) = params.get("diagnostics").and_then(Value::as_array) else {
            return;
        };
        let Some(diagnostics) = raw_diagnostics
            .iter()
            .map(parse_diagnostic)
            .collect::<Option<Vec<_>>>()
        else {
            // A partially malformed notification must not erase or downgrade
            // the last complete diagnostic set.
            return;
        };
        let now = self.now_ms();
        self.diagnostics
            .accept_push(&DocumentUri(uri.into()), version, diagnostics, now);
    }
}

impl Drop for RunningLanguageServer {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn read_json_rpc(stdout: impl Read, sender: SyncSender<Result<Value, RpcReadError>>) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut raw_headers = Vec::new();
        loop {
            let mut byte = [0_u8; 1];
            match reader.read_exact(&mut byte) {
                Ok(()) => raw_headers.push(byte[0]),
                Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                    if raw_headers.is_empty() {
                        return;
                    }
                    let _ = sender.try_send(Err(RpcReadError::Io(error.to_string())));
                    return;
                }
                Err(error) => {
                    let _ = sender.try_send(Err(RpcReadError::Io(error.to_string())));
                    return;
                }
            }
            if raw_headers.len() > MAX_JSON_RPC_HEADER_BYTES {
                let _ = sender.try_send(Err(RpcReadError::Protocol(format!(
                    "JSON-RPC headers exceed {MAX_JSON_RPC_HEADER_BYTES} bytes"
                ))));
                return;
            }
            if raw_headers.ends_with(b"\r\n\r\n") || raw_headers.ends_with(b"\n\n") {
                break;
            }
        }
        let headers = match std::str::from_utf8(&raw_headers) {
            Ok(headers) => headers,
            Err(_) => {
                let _ = sender.try_send(Err(RpcReadError::Protocol(
                    "JSON-RPC headers are not UTF-8".into(),
                )));
                return;
            }
        };
        let mut content_length = None;
        for header in headers.lines().filter(|line| !line.is_empty()) {
            if header.starts_with([' ', '\t'])
                || header
                    .bytes()
                    .any(|byte| byte.is_ascii_control() && byte != b'\t')
            {
                let _ = sender.try_send(Err(RpcReadError::Protocol(
                    "JSON-RPC header contains invalid controls or folding".into(),
                )));
                return;
            }
            let Some((name, value)) = header.split_once(':') else {
                let _ = sender.try_send(Err(RpcReadError::Protocol(
                    "JSON-RPC header is malformed".into(),
                )));
                return;
            };
            if name.eq_ignore_ascii_case("content-length") {
                if content_length.is_some() {
                    let _ = sender.try_send(Err(RpcReadError::Protocol(
                        "duplicate Content-Length header".into(),
                    )));
                    return;
                }
                content_length = value.trim().parse::<usize>().ok();
            }
        }
        let Some(length) = content_length else {
            let _ = sender.try_send(Err(RpcReadError::Protocol(
                "missing Content-Length header".into(),
            )));
            return;
        };
        if length > MAX_JSON_RPC_MESSAGE_BYTES {
            let _ = sender.try_send(Err(RpcReadError::Protocol(format!(
                "JSON-RPC message exceeds {MAX_JSON_RPC_MESSAGE_BYTES} bytes"
            ))));
            return;
        }
        let mut body = vec![0; length];
        if let Err(error) = reader.read_exact(&mut body) {
            let _ = sender.try_send(Err(RpcReadError::Io(error.to_string())));
            return;
        }
        let parsed = serde_json::from_slice(&body)
            .map_err(|error| RpcReadError::Protocol(error.to_string()))
            .and_then(validate_json_rpc_message);
        if sender.try_send(parsed).is_err() {
            return;
        }
    }
}

fn validate_json_rpc_message(value: Value) -> Result<Value, RpcReadError> {
    let Some(object) = value.as_object() else {
        return Err(RpcReadError::Protocol(
            "JSON-RPC message must be an object".into(),
        ));
    };
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err(RpcReadError::Protocol(
            "JSON-RPC message has an invalid or missing version".into(),
        ));
    }
    let is_notification_or_request = object.get("method").and_then(Value::as_str).is_some();
    let is_response =
        object.contains_key("id") && (object.contains_key("result") ^ object.contains_key("error"));
    if is_notification_or_request && (object.contains_key("result") || object.contains_key("error"))
    {
        return Err(RpcReadError::Protocol(
            "JSON-RPC message ambiguously mixes a method with response fields".into(),
        ));
    }
    if is_response && object.get("id").and_then(Value::as_u64).is_none() {
        return Err(RpcReadError::Protocol(
            "JSON-RPC response id must be an unsigned integer".into(),
        ));
    }
    if !is_notification_or_request && !is_response {
        return Err(RpcReadError::Protocol(
            "JSON-RPC message is neither a request, notification, nor response".into(),
        ));
    }
    Ok(value)
}

fn path_to_file_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    for byte in path.as_os_str().as_encoded_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'/' | b':' | b'-' | b'.' | b'_' | b'~')
        {
            uri.push(char::from(*byte));
        } else {
            use std::fmt::Write as _;
            let _ = write!(uri, "%{byte:02X}");
        }
    }
    uri
}

fn parse_position(value: &Value) -> Option<Position> {
    Some(Position {
        line: value.get("line")?.as_u64()?.try_into().ok()?,
        character: value.get("character")?.as_u64()?.try_into().ok()?,
    })
}

fn parse_range(value: &Value) -> Option<TextRange> {
    Some(TextRange {
        start: parse_position(value.get("start")?)?,
        end: parse_position(value.get("end")?)?,
    })
}

fn parse_location(value: &Value) -> Option<Location> {
    Some(Location {
        uri: DocumentUri(value.get("uri")?.as_str()?.into()),
        range: parse_range(value.get("range")?)?,
    })
}

fn parse_locations_checked(
    method: &str,
    value: &Value,
) -> Result<Vec<Location>, LanguageRuntimeError> {
    if value.is_null() {
        return Ok(Vec::new());
    }
    if let Some(values) = value.as_array() {
        return values
            .iter()
            .map(|value| {
                parse_location(value).ok_or_else(|| LanguageRuntimeError::InvalidResponse {
                    method: method.into(),
                    message: "result contains an invalid location".into(),
                })
            })
            .collect();
    }
    parse_location(value)
        .map(|location| vec![location])
        .ok_or_else(|| LanguageRuntimeError::InvalidResponse {
            method: method.into(),
            message: "result must be a location, location array, or null".into(),
        })
}

fn parse_symbol(value: Value) -> Option<SymbolInformation> {
    Some(SymbolInformation {
        name: value.get("name")?.as_str()?.into(),
        kind: value.get("kind")?.as_u64()?.try_into().ok()?,
        location: value.get("location").and_then(parse_location),
    })
}

fn parse_diagnostic(value: &Value) -> Option<Diagnostic> {
    let severity = match value.get("severity").and_then(Value::as_u64).unwrap_or(3) {
        1 => DiagnosticSeverity::Error,
        2 => DiagnosticSeverity::Warning,
        4 => DiagnosticSeverity::Hint,
        _ => DiagnosticSeverity::Information,
    };
    Some(Diagnostic {
        range: parse_range(value.get("range")?)?,
        severity,
        code: value.get("code").map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string())
        }),
        message: value.get("message")?.as_str()?.into(),
    })
}

impl FormatterConfig {
    /// Runs the configured project-local formatter in place. `{file}` tokens
    /// are expanded to the absolute input path; without a token the path is
    /// appended. Timeout and crash results never masquerade as success.
    pub fn execute(&self, resolver: &ProjectToolResolver, input_path: &Path) -> FormatterResult {
        self.execute_with_launcher(resolver, input_path, &DirectProjectProcessLauncher)
    }

    /// Executes through a caller-owned mandatory sandbox boundary. Launcher
    /// failure is explicit and the formatter process is never started.
    pub fn execute_with_launcher(
        &self,
        resolver: &ProjectToolResolver,
        input_path: &Path,
        launcher: &dyn ProjectProcessLauncher,
    ) -> FormatterResult {
        let invocation = match self.invocation(resolver, input_path) {
            Ok(invocation) => invocation,
            Err(result) => return *result,
        };
        let relative = match normalize_relative(input_path) {
            Ok(path) => path,
            Err(message) => return failed_formatter_result("formatter_path_invalid", message),
        };
        let mut scoped_paths = BTreeSet::from([relative.clone()]);
        for path in &self.scope_paths {
            let path = match normalize_relative(path) {
                Ok(path) => path,
                Err(message) => return failed_formatter_result("formatter_scope_invalid", message),
            };
            scoped_paths.insert(path);
        }
        if scoped_paths.len() > MAX_FORMATTER_SCOPE_FILES {
            return failed_formatter_result(
                "formatter_scope_too_large",
                format!("formatter scope contains more than {MAX_FORMATTER_SCOPE_FILES} files"),
            );
        }
        let mut before = Vec::with_capacity(scoped_paths.len());
        let mut retained_bytes = 0_u64;
        for path in &scoped_paths {
            let require_file = path == &relative;
            let absolute = match validate_formatter_path(resolver.root(), path, require_file) {
                Ok(path) => path,
                Err(message) => {
                    return failed_formatter_result(
                        if require_file {
                            "formatter_input_unreadable"
                        } else {
                            "formatter_scope_invalid"
                        },
                        message,
                    );
                }
            };
            let bytes = match read_file_bounded(&absolute, MAX_FORMATTER_FILE_BYTES) {
                Ok(bytes) => {
                    retained_bytes = retained_bytes.saturating_add(bytes.len() as u64);
                    if retained_bytes > MAX_FORMATTER_TOTAL_BYTES {
                        return failed_formatter_result(
                            "formatter_scope_too_large",
                            format!("formatter scope exceeds {MAX_FORMATTER_TOTAL_BYTES} bytes"),
                        );
                    }
                    Some(bytes)
                }
                Err(error) if !require_file && error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    return failed_formatter_result(
                        "formatter_input_unreadable",
                        error.to_string(),
                    );
                }
            };
            before.push((path.clone(), bytes));
        }
        let absolute = resolver.root().join(&relative);
        let absolute_text = absolute.to_string_lossy().to_string();
        let mut saw_file = false;
        let mut arguments = invocation
            .arguments
            .into_iter()
            .map(|argument| {
                if argument.contains("{file}") {
                    saw_file = true;
                    argument.replace("{file}", &absolute_text)
                } else {
                    argument
                }
            })
            .collect::<Vec<_>>();
        if !saw_file {
            arguments.push(absolute_text);
        }
        match hash_file_streaming(&invocation.executable.path) {
            Ok(current) if current == invocation.executable.sha256 => {}
            Ok(_) => {
                return failed_formatter_result(
                    "formatter_executable_changed",
                    "project formatter changed after resolution".into(),
                );
            }
            Err(error) => {
                return failed_formatter_result(
                    "formatter_executable_unreadable",
                    error.to_string(),
                );
            }
        }
        let writable_paths = scoped_paths.iter().cloned().collect::<Vec<_>>();
        let mut command = match launcher.command(ProjectProcessSpec {
            root: resolver.root(),
            executable: &invocation.executable.path,
            arguments: &arguments,
            writable_paths: &writable_paths,
        }) {
            Ok(command) => command,
            Err(message) => {
                return unavailable_formatter_result("formatter_sandbox_unavailable", message);
            }
        };
        command
            .current_dir(resolver.root())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_sanitized_environment(&mut command);
        configure_owned_process_group(&mut command);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                return failed_formatter_result("formatter_spawn_failed", error.to_string());
            }
        };
        let deadline = Instant::now() + Duration::from_millis(invocation.timeout_ms);
        let execution_failure = loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break None,
                Ok(Some(status)) => {
                    break Some((
                        "formatter_failed",
                        format!("formatter exited with {status}"),
                    ));
                }
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                Ok(None) => {
                    let _ = terminate_owned_process_group(&mut child);
                    break Some((
                        "formatter_timeout",
                        format!("formatter exceeded {}ms", invocation.timeout_ms),
                    ));
                }
                Err(error) => {
                    let _ = terminate_owned_process_group(&mut child);
                    break Some(("formatter_wait_failed", error.to_string()));
                }
            }
        };
        let mut files = Vec::with_capacity(before.len());
        let mut after_bytes = 0_u64;
        for (path, before) in before {
            let absolute = match validate_formatter_path(resolver.root(), &path, false) {
                Ok(path) => path,
                Err(message) => {
                    return conservative_failed_formatter_result(
                        "formatter_output_invalid",
                        message,
                        scoped_paths.iter().cloned().collect(),
                    );
                }
            };
            let after = match read_file_bounded(&absolute, MAX_FORMATTER_FILE_BYTES) {
                Ok(bytes) => {
                    after_bytes = after_bytes.saturating_add(bytes.len() as u64);
                    if after_bytes > MAX_FORMATTER_TOTAL_BYTES {
                        return conservative_failed_formatter_result(
                            "formatter_output_too_large",
                            format!(
                                "formatter output scope exceeds {MAX_FORMATTER_TOTAL_BYTES} bytes"
                            ),
                            scoped_paths.into_iter().collect(),
                        );
                    }
                    Some(bytes)
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    return conservative_failed_formatter_result(
                        "formatter_output_unreadable",
                        error.to_string(),
                        scoped_paths.iter().cloned().collect(),
                    );
                }
            };
            files.push(FormatterFileDelta {
                path,
                before,
                after,
            });
        }
        let mut result = Self::record_scoped_outputs(&relative, &files);
        if let Some((code, message)) = execution_failure {
            result.status = FormatterStatus::Failed;
            result.diagnostic = Some(LifecycleDiagnostic { code, message });
        }
        result
    }
}

fn validate_formatter_path(
    root: &Path,
    relative: &Path,
    require_file: bool,
) -> Result<PathBuf, String> {
    let mut current = root.to_path_buf();
    let components = relative.components().collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(value) = component else {
            return Err(format!("{} is not project-relative", relative.display()));
        };
        current.push(value);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "formatter path traverses a symlink: {}",
                    relative.display()
                ));
            }
            Ok(metadata) if index + 1 < components.len() && !metadata.is_dir() => {
                return Err(format!(
                    "formatter path parent is not a directory: {}",
                    current.display()
                ));
            }
            Ok(metadata) if index + 1 == components.len() && !metadata.is_file() => {
                return Err(format!(
                    "formatter path is not a regular file: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !require_file => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(root.join(relative))
}

#[cfg(unix)]
fn configure_owned_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_owned_process_group(_command: &mut Command) {}

fn terminate_owned_process_group(child: &mut Child) -> std::io::Result<()> {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    child.wait().map(|_| ())
}

fn failed_formatter_result(code: &'static str, message: String) -> FormatterResult {
    FormatterResult {
        status: FormatterStatus::Failed,
        before_sha256: None,
        after_sha256: None,
        diagnostic: Some(LifecycleDiagnostic { code, message }),
        proof_impact: ProofImpact {
            edit_hash: None,
            invalidated_paths: Vec::new(),
            requires_reprove: false,
        },
    }
}

fn conservative_failed_formatter_result(
    code: &'static str,
    message: String,
    invalidated_paths: Vec<PathBuf>,
) -> FormatterResult {
    FormatterResult {
        status: FormatterStatus::Failed,
        before_sha256: None,
        after_sha256: None,
        diagnostic: Some(LifecycleDiagnostic { code, message }),
        proof_impact: ProofImpact {
            edit_hash: None,
            requires_reprove: !invalidated_paths.is_empty(),
            invalidated_paths,
        },
    }
}

#[cfg(test)]
mod tests;
