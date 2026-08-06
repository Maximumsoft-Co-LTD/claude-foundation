//! Executable, policy-gated tools confined to one repository/worktree.

use changeloop_language::{
    FormatterConfig, FormatterResult, FormatterStatus, ProjectProcessLauncher, ProjectToolResolver,
};
use changeloop_policy::{
    AUTO_CLASSIFIER_VERSION, DecisionAction, ExecutionMode, HardBoundary, LifecycleAuthority,
    OperationKind, PermissionKind, PolicyDecision, PolicyRequest, Reversibility, RuleAction,
    SandboxCapability, evaluate,
};
use changeloop_project::{MutationError, MutationLease, WorkspaceRevision};
use changeloop_protocol::redact_sensitive_text;
use changeloop_sandbox::{
    EnforcementLevel, Policy as SandboxPolicy, ReadScope, SandboxedChild, SessionPlan, Spawn,
    StdioPlan, exceptions,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(unix)]
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::Mutex;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;
use thiserror::Error;
use uuid::Uuid;

const SAFE_EXECUTABLE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin";
/// Diagnostics a post-write checker may return inline with its verdict.
const WRITE_CHECK_DIAGNOSTIC_BYTES: usize = 8 * 1024;
/// Upper bound on the checker output the process path retains at all.
const WRITE_CHECK_CAPTURE_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub struct ToolPolicy {
    pub mode: ExecutionMode,
    pub configured_action: RuleAction,
    pub lifecycle_authority: LifecycleAuthority,
    pub hard_boundaries: Vec<HardBoundary>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalRequired {
    pub decision: PolicyDecision,
}

#[derive(Debug, Error)]
pub enum ToolError {
    #[error("tool action denied by policy: {0}")]
    PolicyDenied(&'static str),
    #[error("tool action requires approval: {0}")]
    ApprovalRequired(&'static str),
    #[error("path is outside repository scope: {0}")]
    PathOutsideScope(PathBuf),
    #[error("path traverses a symlink: {0}")]
    Symlink(PathBuf),
    #[error("path is a multiply-linked file and cannot be trusted as repository-owned: {0}")]
    Hardlink(PathBuf),
    #[error("filesystem traversal exceeded its bounded entry or byte limit")]
    TraversalLimit,
    #[error("filesystem operation failed for {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("workspace revision check failed: {0}")]
    Revision(#[from] MutationError),
    #[error("patch precondition failed for {path}: expected {expected}, found {actual}")]
    PatchPrecondition {
        path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("expected SHA-256 must be exactly 64 lowercase hexadecimal characters")]
    InvalidExpectedHash,
    #[error("rename destination already exists: {0}")]
    DestinationExists(PathBuf),
    #[error("required OS sandbox is unavailable")]
    SandboxUnavailable,
    #[error("sandbox writable path is unavailable or outside repository scope: {0}")]
    SandboxPathUnavailable(PathBuf),
    #[error("PTY support is unavailable on this platform")]
    PtyUnavailable,
    #[error("process failed to start: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("executable is outside the repository and trusted system paths: {0}")]
    ExecutableDenied(PathBuf),
    #[error("process arguments reference a protected secret or policy path")]
    ProtectedProcessArgument,
    #[error("process argument count or total size exceeds the bounded limit")]
    ProcessArgumentsTooLarge,
    #[error("process timed out")]
    Timeout,
    #[error("process was cancelled")]
    Cancelled,
    #[error("output limits must be non-zero, inline <= artifact, and artifact <= 64 MiB")]
    InvalidOutputLimits,
    #[error("background job does not exist: {0}")]
    JobNotFound(String),
    #[error("background job is no longer running: {0}")]
    JobNotRunning(String),
    #[error("project background-job limit has been reached")]
    JobLimitReached,
    #[error("PTY input exceeds the per-call limit")]
    JobInputTooLarge,
    #[error("PTY input queue is not writable within the bounded deadline")]
    JobInputBackpressure,
    #[error("artifact path or digest is invalid: {0}")]
    InvalidArtifact(PathBuf),
    #[error("artifact content does not match its metadata: {0}")]
    ArtifactTampered(PathBuf),
    #[error("file read exceeds the {max_bytes}-byte artifact limit: {path}")]
    FileReadTooLarge { path: PathBuf, max_bytes: usize },
    #[error(
        "artifact quota pressure: {bytes} bytes/{files} files retained; limit is {max_bytes} bytes/{max_files} files"
    )]
    ArtifactQuotaPressure {
        bytes: u64,
        files: usize,
        max_bytes: u64,
        max_files: usize,
    },
    #[error("artifact pin-root scan exceeded its safe bound; no artifacts were deleted")]
    ArtifactPinScanPressure,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ArtifactQuota {
    pub max_bytes: u64,
    pub max_files: usize,
}

impl Default for ArtifactQuota {
    fn default() -> Self {
        Self {
            max_bytes: 1024 * 1024 * 1024,
            max_files: 50_000,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactGcReport {
    pub before_bytes: u64,
    pub before_files: usize,
    pub after_bytes: u64,
    pub after_files: usize,
    pub deleted: Vec<String>,
    pub pinned: usize,
    pub pressure: bool,
}

pub struct ToolRuntime {
    root: PathBuf,
    #[cfg(unix)]
    root_handle: File,
    artifact_directory: PathBuf,
    policy: ToolPolicy,
    write_formatters: WriteFormatStage,
    write_checkers: WriteCheckerConfig,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileReadOutput {
    Inline(Vec<u8>),
    Artifact(OutputArtifact),
}

impl ToolRuntime {
    pub fn new(
        root: impl AsRef<Path>,
        artifact_directory: impl AsRef<Path>,
        policy: ToolPolicy,
    ) -> Result<Self, ToolError> {
        let root = fs::canonicalize(root.as_ref()).map_err(|source| ToolError::Io {
            path: root.as_ref().to_path_buf(),
            source,
        })?;
        #[cfg(unix)]
        let root_handle = File::open(&root).map_err(|source| ToolError::Io {
            path: root.clone(),
            source,
        })?;
        let artifact_directory = artifact_directory.as_ref().to_path_buf();
        fs::create_dir_all(&artifact_directory).map_err(|source| ToolError::Io {
            path: artifact_directory.clone(),
            source,
        })?;
        let artifact_directory =
            fs::canonicalize(&artifact_directory).map_err(|source| ToolError::Io {
                path: artifact_directory,
                source,
            })?;
        Ok(Self {
            root,
            #[cfg(unix)]
            root_handle,
            artifact_directory,
            policy,
            write_formatters: WriteFormatStage::default(),
            write_checkers: WriteCheckerConfig::default(),
        })
    }

    /// Installs the formatter half of the write transaction. This is the only
    /// formatter pipeline: callers must not run project formatters again after
    /// a write returns, or the checker would read pre-format bytes and the
    /// reported digest would not describe the file on disk.
    #[must_use]
    pub fn with_write_formatters(mut self, formatters: WriteFormatStage) -> Self {
        self.write_formatters = formatters;
        self
    }

    /// Installs the per-language lint/typecheck mapping that every subsequent
    /// write and patch application must clear before it is reported as
    /// successful. Checkers run after the formatter stage above.
    #[must_use]
    pub fn with_write_checkers(mut self, checkers: WriteCheckerConfig) -> Self {
        self.write_checkers = checkers;
        self
    }

    pub fn read(&self, path: &Path, max_bytes: usize) -> Result<Vec<u8>, ToolError> {
        self.authorize(
            PermissionKind::FilesystemRead,
            OperationKind::Read,
            path,
            SandboxCapability::ReadOnly,
        )?;
        let relative = normalize_relative(path)?;
        #[cfg(not(unix))]
        let path = self.resolve(&relative, true)?;
        #[cfg(unix)]
        let path = self.root.join(&relative);
        #[cfg(unix)]
        let file = secure_open_beneath(
            &self.root_handle,
            &relative,
            libc::O_RDONLY | libc::O_NONBLOCK,
        )?;
        #[cfg(not(unix))]
        let file = File::open(&path).map_err(|source| ToolError::Io {
            path: path.clone(),
            source,
        })?;
        let metadata = file.metadata().map_err(|source| ToolError::Io {
            path: relative.clone(),
            source,
        })?;
        if !metadata.is_file() {
            return Err(ToolError::Io {
                path: relative,
                source: std::io::Error::other("path is not a regular file"),
            });
        }
        reject_hardlinked_file(&file, &path)?;
        let mut bytes = Vec::new();
        let read_limit = u64::try_from(max_bytes)
            .unwrap_or(u64::MAX)
            .saturating_add(1);
        file.take(read_limit)
            .read_to_end(&mut bytes)
            .map_err(|source| ToolError::Io { path, source })?;
        bytes.truncate(max_bytes);
        Ok(bytes)
    }

    /// Reads inline up to `inline_max_bytes`, then stores larger bounded files
    /// as verified content-addressed artifacts. Oversized files never arrive as
    /// silently truncated model context.
    pub fn read_with_artifact(
        &self,
        path: &Path,
        inline_max_bytes: usize,
        artifact_max_bytes: usize,
    ) -> Result<FileReadOutput, ToolError> {
        if inline_max_bytes == 0 || inline_max_bytes > artifact_max_bytes {
            return Err(ToolError::InvalidOutputLimits);
        }
        let bytes = self.read(path, artifact_max_bytes.saturating_add(1))?;
        if bytes.len() > artifact_max_bytes {
            return Err(ToolError::FileReadTooLarge {
                path: path.to_path_buf(),
                max_bytes: artifact_max_bytes,
            });
        }
        if bytes.len() <= inline_max_bytes {
            Ok(FileReadOutput::Inline(bytes))
        } else {
            store_artifact(&self.artifact_directory, &bytes).map(FileReadOutput::Artifact)
        }
    }

    pub fn list(&self, path: &Path) -> Result<Vec<PathBuf>, ToolError> {
        self.authorize(
            PermissionKind::FilesystemRead,
            OperationKind::Read,
            path,
            SandboxCapability::ReadOnly,
        )?;
        let relative = normalize_relative(path)?;
        #[cfg(not(unix))]
        let absolute = self.resolve(&relative, true)?;
        #[cfg(unix)]
        let directory = secure_open_beneath(
            &self.root_handle,
            &relative,
            libc::O_RDONLY | libc::O_DIRECTORY,
        )?;
        #[cfg(unix)]
        let mut entries = list_directory_names(&directory)?
            .into_iter()
            .map(|name| Ok(relative.join(name)))
            .collect::<Result<Vec<_>, ToolError>>()?;
        #[cfg(not(unix))]
        let mut entries = fs::read_dir(&absolute)
            .map_err(|source| ToolError::Io {
                path: absolute.clone(),
                source,
            })?
            .map(|entry| {
                entry
                    .map(|entry| relative.join(entry.file_name()))
                    .map_err(|source| ToolError::Io {
                        path: absolute.clone(),
                        source,
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if entries.len() > 10_000 {
            return Err(ToolError::TraversalLimit);
        }
        entries.sort();
        Ok(entries)
    }

    pub fn search(
        &self,
        path: &Path,
        needle: &str,
        max_matches: usize,
    ) -> Result<Vec<SearchMatch>, ToolError> {
        self.authorize(
            PermissionKind::FilesystemRead,
            OperationKind::Read,
            path,
            SandboxCapability::ReadOnly,
        )?;
        if max_matches == 0 {
            return Ok(Vec::new());
        }
        let relative_root = normalize_relative(path)?;
        #[cfg(not(unix))]
        let root = self.resolve(&relative_root, true)?;
        let mut files = Vec::new();
        #[cfg(unix)]
        collect_regular_files_beneath(&self.root_handle, &relative_root, &mut files)?;
        #[cfg(not(unix))]
        collect_regular_files(&root, &mut files)?;
        files.sort();
        let mut matches = Vec::new();
        for relative in files {
            #[cfg(unix)]
            let file = secure_open_beneath(&self.root_handle, &relative, libc::O_RDONLY)?;
            #[cfg(not(unix))]
            let mut file = File::open(&relative).map_err(|source| ToolError::Io {
                path: relative.clone(),
                source,
            })?;
            reject_hardlinked_file(&file, &relative)?;
            let mut bytes = Vec::new();
            file.take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|source| ToolError::Io {
                    path: relative.clone(),
                    source,
                })?;
            if bytes.len() > 4 * 1024 * 1024 {
                continue;
            }
            let Ok(text) = std::str::from_utf8(&bytes) else {
                continue;
            };
            for (index, line) in text.lines().enumerate() {
                if line.contains(needle) {
                    matches.push(SearchMatch {
                        path: relative
                            .strip_prefix(&self.root)
                            .unwrap_or(&relative)
                            .to_path_buf(),
                        line: index + 1,
                        text: line.to_owned(),
                    });
                    if matches.len() == max_matches {
                        return Ok(matches);
                    }
                }
            }
        }
        Ok(matches)
    }

    /// Writes `content` atomically and then, in the same invocation, runs the
    /// configured formatter followed by the configured lint/typecheck command
    /// for the file's language. The returned verdict reports what ran; an edit
    /// no command cleared is never reported as a clean write.
    pub fn write(
        &self,
        path: &Path,
        content: &[u8],
        lease: &MutationLease,
        now_ms: u64,
        actual_revision: &WorkspaceRevision,
    ) -> Result<VerifiedWrite, ToolError> {
        self.authorize(
            PermissionKind::FilesystemWrite,
            OperationKind::Write,
            path,
            SandboxCapability::WorkspaceWrite,
        )?;
        lease.authorize_write(now_ms, actual_revision)?;
        let relative = normalize_relative(path)?;
        #[cfg(not(unix))]
        let absolute = self.resolve(&relative, false)?;
        #[cfg(unix)]
        secure_atomic_write_beneath(&self.root_handle, &relative, content)?;
        #[cfg(not(unix))]
        atomic_write(&absolute, content)?;
        self.verify_write(&relative, content)
    }

    /// Applies a precondition-checked replacement and then runs the same
    /// format-then-check gate as [`ToolRuntime::write`]. A patch that applies
    /// cleanly is still unverified until a checker says otherwise.
    pub fn apply_patch(
        &self,
        patch: &PatchWrite,
        lease: &MutationLease,
        now_ms: u64,
        actual_revision: &WorkspaceRevision,
    ) -> Result<VerifiedWrite, ToolError> {
        validate_expected_sha256(&patch.expected_sha256)?;
        self.authorize(
            PermissionKind::FilesystemWrite,
            OperationKind::Write,
            &patch.path,
            SandboxCapability::WorkspaceWrite,
        )?;
        lease.authorize_write(now_ms, actual_revision)?;
        let relative = normalize_relative(&patch.path)?;
        #[cfg(not(unix))]
        let absolute = self.resolve(&relative, true)?;
        #[cfg(not(unix))]
        let mut current_file = File::open(&absolute).map_err(|source| ToolError::Io {
            path: absolute.clone(),
            source,
        })?;
        #[cfg(not(unix))]
        reject_hardlinked_file(&current_file, &relative)?;
        #[cfg(not(unix))]
        let mut current = Vec::new();
        #[cfg(not(unix))]
        current_file
            .read_to_end(&mut current)
            .map_err(|source| ToolError::Io {
                path: absolute.clone(),
                source,
            })?;
        #[cfg(not(unix))]
        let actual = format!("{:x}", Sha256::digest(&current));
        #[cfg(not(unix))]
        if actual != patch.expected_sha256 {
            return Err(ToolError::PatchPrecondition {
                path: patch.path.clone(),
                expected: patch.expected_sha256.clone(),
                actual,
            });
        }
        #[cfg(unix)]
        secure_atomic_replace_beneath(
            &self.root_handle,
            &relative,
            &patch.replacement,
            &patch.expected_sha256,
        )?;
        #[cfg(not(unix))]
        atomic_write(&absolute, &patch.replacement)?;
        self.verify_write(&relative, &patch.replacement)
    }

    pub fn delete_file(
        &self,
        path: &Path,
        expected_sha256: &str,
        lease: &MutationLease,
        now_ms: u64,
        actual_revision: &WorkspaceRevision,
    ) -> Result<String, ToolError> {
        validate_expected_sha256(expected_sha256)?;
        self.authorize_paths(
            PermissionKind::FilesystemWrite,
            OperationKind::Write,
            &[path],
            SandboxCapability::WorkspaceWrite,
            // ToolRuntime can also be embedded without the app-server snapshot
            // manager, so the policy boundary must conservatively classify
            // deletion as irreversible even when the standard app path takes
            // a recoverable checkpoint first.
            Reversibility::Irreversible,
        )?;
        lease.authorize_write(now_ms, actual_revision)?;
        let relative = normalize_relative(path)?;
        #[cfg(unix)]
        let actual = secure_delete_beneath(&self.root_handle, &relative, expected_sha256)?;
        #[cfg(not(unix))]
        let actual = {
            let absolute = self.resolve(&relative, true)?;
            let mut file = File::open(&absolute).map_err(|source| ToolError::Io {
                path: absolute.clone(),
                source,
            })?;
            reject_hardlinked_file(&file, &relative)?;
            let actual = sha256_reader(&mut file, &relative)?;
            if actual != expected_sha256 {
                return Err(ToolError::PatchPrecondition {
                    path: relative,
                    expected: expected_sha256.to_owned(),
                    actual,
                });
            }
            fs::remove_file(&absolute).map_err(|source| ToolError::Io {
                path: absolute,
                source,
            })?;
            actual
        };
        Ok(actual)
    }

    pub fn rename_file(
        &self,
        source: &Path,
        destination: &Path,
        expected_sha256: &str,
        lease: &MutationLease,
        now_ms: u64,
        actual_revision: &WorkspaceRevision,
    ) -> Result<String, ToolError> {
        validate_expected_sha256(expected_sha256)?;
        self.authorize_paths(
            PermissionKind::FilesystemWrite,
            OperationKind::Write,
            &[source, destination],
            SandboxCapability::WorkspaceWrite,
            Reversibility::Reversible,
        )?;
        lease.authorize_write(now_ms, actual_revision)?;
        let source = normalize_relative(source)?;
        let destination = normalize_relative(destination)?;
        if source == destination {
            return Err(ToolError::DestinationExists(destination));
        }
        #[cfg(unix)]
        let actual =
            secure_rename_beneath(&self.root_handle, &source, &destination, expected_sha256)?;
        #[cfg(not(unix))]
        let actual = {
            let source_absolute = self.resolve(&source, true)?;
            let destination_absolute = self.resolve(&destination, false)?;
            if destination_absolute.exists() {
                return Err(ToolError::DestinationExists(destination));
            }
            let mut file = File::open(&source_absolute).map_err(|source| ToolError::Io {
                path: source_absolute.clone(),
                source,
            })?;
            reject_hardlinked_file(&file, &source)?;
            let actual = sha256_reader(&mut file, &source)?;
            if actual != expected_sha256 {
                return Err(ToolError::PatchPrecondition {
                    path: source,
                    expected: expected_sha256.to_owned(),
                    actual,
                });
            }
            if let Some(parent) = destination_absolute.parent() {
                fs::create_dir_all(parent).map_err(|source| ToolError::Io {
                    path: parent.to_path_buf(),
                    source,
                })?;
            }
            fs::rename(&source_absolute, &destination_absolute).map_err(|source| {
                ToolError::Io {
                    path: destination_absolute,
                    source,
                }
            })?;
            actual
        };
        Ok(actual)
    }

    pub fn execute(&self, request: &ProcessRequest) -> Result<ProcessOutput, ToolError> {
        let capability = sandbox_capability(request.sandbox)?;
        self.authorize(
            PermissionKind::Shell,
            OperationKind::Execute,
            Path::new("."),
            capability,
        )?;
        run_process(&self.root, &self.artifact_directory, request)
    }

    pub fn run_test(&self, request: &ProcessRequest) -> Result<ProcessOutput, ToolError> {
        let capability = sandbox_capability(request.sandbox)?;
        self.authorize(
            PermissionKind::Test,
            OperationKind::Execute,
            Path::new("."),
            capability,
        )?;
        run_process(&self.root, &self.artifact_directory, request)
    }

    /// Read and verify a content-addressed artifact. Callers cannot substitute
    /// a path outside the owned store or consume bytes changed after capture.
    pub fn read_artifact(&self, artifact: &OutputArtifact) -> Result<Vec<u8>, ToolError> {
        read_verified_artifact(&self.artifact_directory, artifact)
    }

    /// Imports a repository file into the owned content-addressed store after
    /// applying the same scope, symlink, and permission checks as `read`.
    pub fn capture_attachment(
        &self,
        path: &Path,
        max_bytes: usize,
    ) -> Result<OutputArtifact, ToolError> {
        let bytes = self.read(path, max_bytes.saturating_add(1))?;
        if bytes.len() > max_bytes {
            return Err(ToolError::InvalidArtifact(path.to_path_buf()));
        }
        store_artifact(&self.artifact_directory, &bytes)
    }

    pub fn spawn_job(
        &self,
        manager: &mut JobManager,
        kind: JobKind,
        program: &Path,
        arguments: &[String],
        environment: &BTreeMap<String, String>,
    ) -> Result<String, ToolError> {
        self.authorize(
            PermissionKind::Shell,
            OperationKind::Execute,
            Path::new("."),
            SandboxCapability::Unavailable,
        )?;
        if manager.root != self.root {
            return Err(ToolError::PathOutsideScope(manager.root.clone()));
        }
        manager.spawn(kind, program, arguments, environment)
    }

    pub fn git_status(&self, limits: OutputLimits) -> Result<ProcessOutput, ToolError> {
        self.git(
            &[
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.untrackedCache=false",
                "status",
                "--porcelain=v1",
                "--untracked-files=normal",
                "--",
            ],
            limits,
        )
    }

    pub fn git_diff(&self, limits: OutputLimits) -> Result<ProcessOutput, ToolError> {
        self.git(
            &[
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.untrackedCache=false",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--",
            ],
            limits,
        )
    }

    fn git(&self, arguments: &[&str], limits: OutputLimits) -> Result<ProcessOutput, ToolError> {
        self.authorize(
            PermissionKind::Git,
            OperationKind::Read,
            Path::new("."),
            SandboxCapability::ReadOnly,
        )?;
        let request = ProcessRequest {
            program: PathBuf::from("git"),
            arguments: arguments.iter().map(|value| (*value).into()).collect(),
            environment: BTreeMap::from([("GIT_OPTIONAL_LOCKS".into(), "0".into())]),
            timeout: Duration::from_secs(10),
            cancellation: ExecutionCancellation::new(),
            sandbox: SandboxRequirement::BestEffort,
            limits,
        };
        run_process(&self.root, &self.artifact_directory, &request)
    }

    pub fn question(&self, prompt: impl Into<String>) -> Result<QuestionRequest, ToolError> {
        self.authorize(
            PermissionKind::Question,
            OperationKind::Read,
            Path::new("."),
            SandboxCapability::ReadOnly,
        )?;
        Ok(QuestionRequest {
            id: Uuid::now_v7().to_string(),
            prompt: prompt.into(),
        })
    }

    /// Runs the formatter stage of the write transaction on a file that is
    /// already on disk, without a checker. Used by mutations such as rename
    /// that move bytes into a language's scope but do not author them.
    pub fn format_written_file(
        &self,
        path: &Path,
    ) -> Result<Vec<WriteFormatterOutcome>, ToolError> {
        let relative = normalize_relative(path)?;
        self.run_write_formatters(&relative)
    }

    /// Format-then-check gate for a file that has just landed on disk.
    ///
    /// The order is the whole point: the formatter runs first so the checker
    /// reads the bytes that will stay on disk, and the reported digest is read
    /// back from disk after formatting so a caller's self-write fingerprint
    /// still matches a file the formatter rewrote.
    fn verify_write(&self, relative: &Path, written: &[u8]) -> Result<VerifiedWrite, ToolError> {
        // 1. Format.
        let formatter = self.run_write_formatters(relative)?;
        // 2. Digest the post-format bytes. Once any formatter has run, the
        //    requested content is no longer authoritative for what is on disk.
        let sha256 = if formatter.is_empty() {
            format!("{:x}", Sha256::digest(written))
        } else {
            self.digest_on_disk(relative)?
        };
        // 3. Check the formatted file. The verdict reports checkers only: a
        //    project that configures formatters and no checker has configured
        //    no assurance, and must not read as though it had.
        let runs = self
            .write_checkers
            .for_path(relative)
            .iter()
            .map(|checker| self.run_write_check(relative, checker, WriteCheckStage::Check))
            .collect::<Vec<_>>();
        let verdict = if runs.is_empty() {
            WriteVerdict::NotConfigured
        } else {
            WriteVerdict::Checked(runs)
        };
        Ok(VerifiedWrite {
            sha256,
            formatter,
            verdict,
        })
    }

    /// Executes every configured formatter that claims this file's extension,
    /// in configuration order, through the project sandbox the owning session
    /// installed. A repository with no formatter for the extension returns an
    /// empty list and costs nothing.
    fn run_write_formatters(
        &self,
        relative: &Path,
    ) -> Result<Vec<WriteFormatterOutcome>, ToolError> {
        let extension = relative
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let matching = self
            .write_formatters
            .formatters
            .iter()
            .filter(|formatter| formatter.extensions.contains(extension))
            .collect::<Vec<_>>();
        if matching.is_empty() {
            return Ok(Vec::new());
        }
        let resolver = ProjectToolResolver::new(&self.root).map_err(|source| match source {
            changeloop_language::ResolverError::Io { path, source } => {
                ToolError::Io { path, source }
            }
        })?;
        Ok(matching
            .into_iter()
            .map(|formatter| WriteFormatterOutcome {
                name: formatter.name.clone(),
                result: match &self.write_formatters.launcher {
                    Some(launcher) => {
                        formatter.execute_with_launcher(&resolver, relative, launcher.as_ref())
                    }
                    None => formatter.execute(&resolver, relative),
                },
            })
            .collect())
    }

    /// Runs one configured command through the crate's bounded, sandboxed,
    /// timeout-guarded process path. The write has already landed, so a
    /// process that cannot run or does not finish becomes a visible
    /// non-passing verdict rather than an error that hides the mutation.
    fn run_write_check(
        &self,
        relative: &Path,
        command: &WriteCheckCommand,
        stage: WriteCheckStage,
    ) -> WriteCheckRun {
        let request = ProcessRequest {
            program: command.program.clone(),
            arguments: expand_write_check_arguments(&command.arguments, relative),
            environment: BTreeMap::new(),
            timeout: command.timeout,
            cancellation: self.write_checkers.cancellation.clone(),
            sandbox: SandboxRequirement::BestEffort,
            limits: OutputLimits {
                inline_bytes: WRITE_CHECK_DIAGNOSTIC_BYTES,
                artifact_bytes: WRITE_CHECK_CAPTURE_BYTES,
            },
        };
        let (outcome, exit_code, diagnostics) =
            match run_process(&self.root, &self.artifact_directory, &request) {
                Ok(output) if output.status.success() => (
                    WriteCheckOutcome::Passed,
                    output.status.code(),
                    write_check_diagnostics(&output),
                ),
                Ok(output) => (
                    WriteCheckOutcome::Failed,
                    output.status.code(),
                    write_check_diagnostics(&output),
                ),
                Err(ToolError::Timeout) => (
                    WriteCheckOutcome::TimedOut,
                    None,
                    format!("exceeded {} ms", command.timeout.as_millis()),
                ),
                Err(ToolError::Cancelled) => (
                    WriteCheckOutcome::Cancelled,
                    None,
                    "cancelled before completion".to_owned(),
                ),
                Err(error) => (WriteCheckOutcome::Unavailable, None, error.to_string()),
            };
        WriteCheckRun {
            name: command.name.clone(),
            stage,
            outcome,
            exit_code,
            diagnostics,
        }
    }

    /// Digests the bytes actually on disk, refusing to describe a file that a
    /// symlink or a second hard link could point somewhere else. A digest a
    /// caller records as a self-write fingerprint must describe the exact file
    /// the runtime owns.
    fn digest_on_disk(&self, relative: &Path) -> Result<String, ToolError> {
        #[cfg(unix)]
        let mut file = secure_open_beneath(
            &self.root_handle,
            relative,
            libc::O_RDONLY | libc::O_NONBLOCK,
        )?;
        #[cfg(not(unix))]
        let mut file = {
            let absolute = self.resolve(relative, true)?;
            File::open(&absolute).map_err(|source| ToolError::Io {
                path: absolute,
                source,
            })?
        };
        reject_hardlinked_file(&file, relative)?;
        sha256_reader(&mut file, relative)
    }

    fn authorize(
        &self,
        permission: PermissionKind,
        operation: OperationKind,
        path: &Path,
        sandbox: SandboxCapability,
    ) -> Result<(), ToolError> {
        self.authorize_paths(
            permission,
            operation,
            &[path],
            sandbox,
            Reversibility::Reversible,
        )
    }

    fn authorize_paths(
        &self,
        permission: PermissionKind,
        operation: OperationKind,
        paths: &[&Path],
        sandbox: SandboxCapability,
        reversibility: Reversibility,
    ) -> Result<(), ToolError> {
        let decision = evaluate(&PolicyRequest {
            classifier_version: AUTO_CLASSIFIER_VERSION,
            mode: self.policy.mode,
            configured_action: self.policy.configured_action,
            permission,
            operation,
            paths: paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            network_destination: None,
            reversibility,
            sandbox,
            lifecycle_authority: self.policy.lifecycle_authority,
            hard_boundaries: self.policy.hard_boundaries.clone(),
        });
        match decision.action {
            DecisionAction::Allow => Ok(()),
            DecisionAction::Ask => Err(ToolError::ApprovalRequired(decision.reason)),
            DecisionAction::Deny => Err(ToolError::PolicyDenied(decision.reason)),
        }
    }

    #[cfg(not(unix))]
    fn resolve(&self, path: &Path, must_exist: bool) -> Result<PathBuf, ToolError> {
        let relative = normalize_relative(path)?;
        let candidate = self.root.join(&relative);
        reject_symlinks(&self.root, &relative)?;
        if must_exist {
            let canonical = fs::canonicalize(&candidate).map_err(|source| ToolError::Io {
                path: candidate.clone(),
                source,
            })?;
            if !canonical.starts_with(&self.root) {
                return Err(ToolError::PathOutsideScope(path.to_path_buf()));
            }
            Ok(canonical)
        } else {
            Ok(candidate)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchMatch {
    pub path: PathBuf,
    pub line: usize,
    pub text: String,
}

#[derive(Clone, Debug)]
pub struct PatchWrite {
    pub path: PathBuf,
    pub expected_sha256: String,
    pub replacement: Vec<u8>,
}

/// One project-configured command run against a file the tools just wrote.
/// `{file}` expands to the repository-relative path; without the token the
/// path is appended, matching the project formatter contract.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteCheckCommand {
    pub name: String,
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub timeout: Duration,
}

/// The formatter half of the write transaction: the project formatters the
/// runtime runs in place before any checker sees the file, and the sandbox
/// launcher they must be started through.
///
/// This exists so a host application has exactly one formatter pipeline. A
/// second post-write formatting stage outside the runtime would invert the
/// gate into check-then-format and invalidate the digest the write reports.
#[derive(Clone, Default)]
pub struct WriteFormatStage {
    formatters: Vec<FormatterConfig>,
    launcher: Option<Arc<dyn ProjectProcessLauncher>>,
}

impl WriteFormatStage {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends one project formatter. Formatters run in the order registered.
    #[must_use]
    pub fn with_formatter(mut self, formatter: FormatterConfig) -> Self {
        self.formatters.push(formatter);
        self
    }

    #[must_use]
    pub fn with_formatters(
        mut self,
        formatters: impl IntoIterator<Item = FormatterConfig>,
    ) -> Self {
        self.formatters.extend(formatters);
        self
    }

    /// Routes every formatter through a caller-owned mandatory sandbox. Without
    /// one, formatters are launched directly.
    #[must_use]
    pub fn with_launcher(mut self, launcher: Arc<dyn ProjectProcessLauncher>) -> Self {
        self.launcher = Some(launcher);
        self
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.formatters.is_empty()
    }
}

impl std::fmt::Debug for WriteFormatStage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WriteFormatStage")
            .field("formatters", &self.formatters)
            .field("launcher", &self.launcher.is_some())
            .finish()
    }
}

/// One formatter's execution against the file the write just produced, paired
/// with the configured name so a host can report it without re-deriving it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteFormatterOutcome {
    pub name: String,
    pub result: FormatterResult,
}

impl WriteFormatterOutcome {
    /// Whether this formatter left the file in a state it vouches for. The
    /// formatter is the first half of format-then-check, so one that failed,
    /// was cancelled, or could not run leaves the write unverified even when
    /// no checker is configured behind it.
    #[must_use]
    pub fn succeeded(&self) -> bool {
        matches!(
            self.result.status,
            FormatterStatus::Unchanged | FormatterStatus::Formatted
        )
    }
}

/// Data-driven per-language checker mapping consulted after the formatter
/// stage of every successful write. Callers register commands by file
/// extension instead of naming a checker at each tool call site.
#[derive(Clone, Debug, Default)]
pub struct WriteCheckerConfig {
    languages: BTreeMap<String, Vec<WriteCheckCommand>>,
    cancellation: ExecutionCancellation,
}

impl WriteCheckerConfig {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends one lint/typecheck command for one lowercase file extension.
    /// Several checkers may share an extension; they run in registration order.
    #[must_use]
    pub fn with_checker(
        mut self,
        extension: impl Into<String>,
        checker: WriteCheckCommand,
    ) -> Self {
        self.languages
            .entry(extension.into().to_ascii_lowercase())
            .or_default()
            .push(checker);
        self
    }

    /// Shares one cancellation handle with every check this configuration
    /// runs, so an owning session can stop in-flight checkers.
    #[must_use]
    pub fn with_cancellation(mut self, cancellation: ExecutionCancellation) -> Self {
        self.cancellation = cancellation;
        self
    }

    fn for_path(&self, path: &Path) -> &[WriteCheckCommand] {
        path.extension()
            .and_then(|value| value.to_str())
            .and_then(|extension| self.languages.get(&extension.to_ascii_lowercase()))
            .map_or(&[], Vec::as_slice)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteCheckStage {
    Format,
    Check,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteCheckOutcome {
    Passed,
    Failed,
    TimedOut,
    Cancelled,
    Unavailable,
}

/// What one configured command did: which stage it served, how it exited, and
/// the bounded, secret-redacted diagnostics it produced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WriteCheckRun {
    pub name: String,
    pub stage: WriteCheckStage,
    pub outcome: WriteCheckOutcome,
    pub exit_code: Option<i32>,
    pub diagnostics: String,
}

/// Whether the written bytes were checked, and by what.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteVerdict {
    /// No formatter and no checker is configured for this file's language.
    NotConfigured,
    Checked(Vec<WriteCheckRun>),
}

/// A landed write together with what the single write transaction did to it:
/// what each formatter changed, the digest of the resulting bytes, and the
/// gate verdict. The digest is read back from disk after formatting, so a
/// caller's self-write fingerprint still matches the file a formatter rewrote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedWrite {
    pub sha256: String,
    /// Every formatter that claimed this file, in configuration order.
    pub formatter: Vec<WriteFormatterOutcome>,
    pub verdict: WriteVerdict,
}

impl VerifiedWrite {
    /// A write is clean when every command the transaction ran passed: both
    /// halves of the gate count, so a formatter that could not run leaves the
    /// write unverified even though the checker verdict stays
    /// `NotConfigured`. A checker that failed, timed out, was cancelled, or
    /// could not run does the same.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        let formatted = self.formatter.iter().all(WriteFormatterOutcome::succeeded);
        let checked = match &self.verdict {
            WriteVerdict::NotConfigured => true,
            WriteVerdict::Checked(runs) => runs
                .iter()
                .all(|run| run.outcome == WriteCheckOutcome::Passed),
        };
        formatted && checked
    }

    /// The commands that did not pass, in the order they ran.
    pub fn failures(&self) -> impl Iterator<Item = &WriteCheckRun> {
        match &self.verdict {
            WriteVerdict::NotConfigured => [].iter(),
            WriteVerdict::Checked(runs) => runs.as_slice().iter(),
        }
        .filter(|run| run.outcome != WriteCheckOutcome::Passed)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuestionRequest {
    pub id: String,
    pub prompt: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SandboxRequirement {
    None,
    BestEffort,
    Required,
}

#[derive(Clone, Copy, Debug)]
pub struct OutputLimits {
    pub inline_bytes: usize,
    pub artifact_bytes: usize,
}

#[derive(Clone, Debug)]
pub struct ProcessRequest {
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub environment: BTreeMap<String, String>,
    pub timeout: Duration,
    pub cancellation: ExecutionCancellation,
    pub sandbox: SandboxRequirement,
    pub limits: OutputLimits,
}

#[derive(Clone, Debug)]
pub struct ExecutionCancellation(Arc<AtomicBool>);

impl ExecutionCancellation {
    #[must_use]
    pub fn new() -> Self {
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

impl Default for ExecutionCancellation {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
pub struct CapturedOutput {
    pub inline: Vec<u8>,
    pub artifact: Option<OutputArtifact>,
    pub byte_length: u64,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputArtifact {
    pub path: PathBuf,
    pub sha256: String,
    pub byte_length: u64,
    pub media_type: String,
}

#[derive(Clone, Debug)]
pub struct ProcessOutput {
    pub status: ExitStatus,
    pub stdout: CapturedOutput,
    pub stderr: CapturedOutput,
    pub filtered_environment: Vec<String>,
}

fn expand_write_check_arguments(arguments: &[String], relative: &Path) -> Vec<String> {
    let file = relative.to_string_lossy().into_owned();
    let mut saw_file = false;
    let mut expanded = arguments
        .iter()
        .map(|argument| {
            if argument.contains("{file}") {
                saw_file = true;
                argument.replace("{file}", &file)
            } else {
                argument.clone()
            }
        })
        .collect::<Vec<_>>();
    if !saw_file {
        expanded.push(file);
    }
    expanded
}

/// Joins the already bounded and secret-redacted inline capture of a checker
/// so the verdict carries the diagnostics that explain it.
fn write_check_diagnostics(output: &ProcessOutput) -> String {
    let mut text = String::from_utf8_lossy(&output.stdout.inline).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr.inline);
    if !stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    text
}

fn run_process(
    working_directory: &Path,
    artifact_directory: &Path,
    request: &ProcessRequest,
) -> Result<ProcessOutput, ToolError> {
    if request.limits.inline_bytes == 0
        || request.limits.artifact_bytes < request.limits.inline_bytes
        || request.limits.artifact_bytes > 64 * 1024 * 1024
    {
        return Err(ToolError::InvalidOutputLimits);
    }
    validate_executable(working_directory, &request.program)?;
    validate_process_arguments(&request.arguments)?;
    if request.sandbox == SandboxRequirement::Required && !enforcing_backend_available() {
        return Err(ToolError::SandboxUnavailable);
    }
    let (mut environment, filtered_environment) = filter_environment(&request.environment);
    environment.insert("PATH".to_string(), SAFE_EXECUTABLE_PATH.to_string());
    environment.insert(
        "TMPDIR".to_string(),
        artifact_directory.to_string_lossy().into_owned(),
    );

    // One coarse profile: the working tree plus the private scratch directory
    // are writable, nothing else is, and there is no egress. `SandboxRequirement`
    // selects which enumerated register row covers a spawn that cannot get that.
    let policy = SandboxPolicy::deny_by_default(working_directory)
        .writable([working_directory.to_path_buf()])
        .writable_outside_workspace(
            artifact_directory.to_path_buf(),
            exceptions::TOOL_ARTIFACT_SCRATCH,
        );
    let mut spawn = Spawn::new(&request.program, policy)
        .arguments(request.arguments.clone())
        .working_directory(working_directory)
        .environment(environment)
        .stdin(StdioPlan::Inherit)
        .stdout(StdioPlan::Piped)
        .stderr(StdioPlan::Piped)
        .session(SessionPlan::OwnedProcessGroup)
        .allow_unenforced(exceptions::BEST_EFFORT_NO_BACKEND);
    if request.sandbox == SandboxRequirement::None {
        // An explicit unsandboxed request, recorded as such rather than
        // achieved by a backend that happened not to be installed.
        spawn = spawn.without_enforcement(exceptions::HOST_TOOLCHAIN_UNSANDBOXED);
    }
    let mut child = spawn.spawn().map_err(sandbox_error)?;
    let stdout = child
        .take_stdout()
        .ok_or_else(|| ToolError::Spawn(std::io::Error::other("stdout pipe missing")))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| ToolError::Spawn(std::io::Error::other("stderr pipe missing")))?;
    let stdout_reader = spawn_bounded_capture(stdout, request.limits.artifact_bytes);
    let stderr_reader = spawn_bounded_capture(stderr, request.limits.artifact_bytes);
    let started = Instant::now();
    let status = loop {
        if request.cancellation.is_cancelled() {
            child.terminate();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(ToolError::Cancelled);
        }
        if started.elapsed() >= request.timeout {
            child.terminate();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(ToolError::Timeout);
        }
        if let Some(status) = child.try_wait_owned_group().map_err(ToolError::Spawn)? {
            break status;
        }
        thread::sleep(Duration::from_millis(5));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| ToolError::Spawn(std::io::Error::other("stdout reader panicked")))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| ToolError::Spawn(std::io::Error::other("stderr reader panicked")))??;
    Ok(ProcessOutput {
        status,
        stdout: capture_bytes(stdout, artifact_directory, request.limits)?,
        stderr: capture_bytes(stderr, artifact_directory, request.limits)?,
        filtered_environment,
    })
}

/// Maps a spawn refusal onto the tool error vocabulary.
///
/// A refusal is never flattened into "the process failed to start": a host that
/// cannot enforce the policy is a distinct, reportable condition from a binary
/// that would not exec.
fn sandbox_error(error: changeloop_sandbox::SandboxError) -> ToolError {
    match error {
        changeloop_sandbox::SandboxError::Spawn(source) => ToolError::Spawn(source),
        changeloop_sandbox::SandboxError::Unenforced { .. } => ToolError::SandboxUnavailable,
        changeloop_sandbox::SandboxError::InvalidPolicy(_)
        | changeloop_sandbox::SandboxError::UnknownException(_)
        | changeloop_sandbox::SandboxError::UngrantedException { .. } => {
            ToolError::SandboxUnavailable
        }
    }
}

/// Whether this host has a backend that can actually apply a workspace policy.
fn enforcing_backend_available() -> bool {
    let probe = SandboxPolicy::deny_by_default(std::env::temp_dir());
    changeloop_sandbox::select(&probe).level != EnforcementLevel::Unenforced
}

/// Whether a required local OS sandbox adapter is available on this host.
#[must_use]
pub fn required_project_sandbox_available() -> bool {
    enforcing_backend_available()
}

/// Builds a required, network-denied project process sandbox. Only the exact
/// existing repository paths in `writable_paths` and the private scratch
/// directory are writable; the rest of the host is read-only.
pub fn required_project_sandbox_command(
    root: &Path,
    scratch: &Path,
    program: &Path,
    arguments: &[String],
    writable_paths: &[PathBuf],
) -> Result<Command, ToolError> {
    let requested_root = root.to_path_buf();
    let scratch_relative = scratch
        .strip_prefix(&requested_root)
        .map(Path::to_path_buf)
        .map_err(|_| ToolError::SandboxPathUnavailable(scratch.to_path_buf()))?;
    let root = fs::canonicalize(&requested_root).map_err(|source| ToolError::Io {
        path: requested_root,
        source,
    })?;
    validate_executable(&root, program)?;
    let program = if program.components().count() == 1 {
        program.to_path_buf()
    } else {
        let candidate = if program.is_absolute() {
            program.to_path_buf()
        } else {
            root.join(program)
        };
        fs::canonicalize(&candidate).map_err(|source| ToolError::Io {
            path: candidate,
            source,
        })?
    };
    validate_process_arguments(arguments)?;
    let scratch = root.join(scratch_relative);
    create_sandbox_scratch(&root, &scratch)?;
    let scratch = fs::canonicalize(&scratch).map_err(|source| ToolError::Io {
        path: scratch.clone(),
        source,
    })?;
    if !scratch.starts_with(&root) {
        return Err(ToolError::SandboxPathUnavailable(scratch));
    }
    let mut writable = Vec::with_capacity(writable_paths.len());
    for path in writable_paths {
        let relative = normalize_relative(path)?;
        let candidate = root.join(relative);
        let canonical = fs::canonicalize(&candidate)
            .map_err(|_| ToolError::SandboxPathUnavailable(path.clone()))?;
        if !canonical.starts_with(&root)
            || fs::symlink_metadata(&candidate)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(ToolError::SandboxPathUnavailable(path.clone()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if fs::metadata(&canonical)
                .is_ok_and(|metadata| metadata.is_file() && metadata.nlink() != 1)
            {
                return Err(ToolError::SandboxPathUnavailable(path.clone()));
            }
        }
        writable.push(canonical);
    }
    if !enforcing_backend_available() {
        return Err(ToolError::SandboxUnavailable);
    }
    // Reads are narrowed to the worktree here, unlike the coarse tool profile:
    // this launcher's read set is genuinely known.
    writable.push(scratch);
    let policy = SandboxPolicy::deny_by_default(&root)
        .writable(writable)
        .read_scope(ReadScope::Explicit(vec![root.clone()]));
    let plan = Spawn::new(&program, policy)
        .arguments(arguments.to_vec())
        .working_directory(&root)
        .plan()
        .map_err(sandbox_error)?;
    // The one enumerated handoff of a raw command to a caller this crate does
    // not own. The policy, profile and argv above are still built here; only
    // the final `Command` crosses the boundary.
    plan.into_registered_command(exceptions::LEGACY_COMMAND_HANDOFF)
        .map_err(sandbox_error)
}

fn create_sandbox_scratch(root: &Path, scratch: &Path) -> Result<(), ToolError> {
    let relative = scratch
        .strip_prefix(root)
        .map_err(|_| ToolError::SandboxPathUnavailable(scratch.to_path_buf()))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(ToolError::SandboxPathUnavailable(scratch.to_path_buf()));
        };
        current.push(component);
        match fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(source) => {
                return Err(ToolError::Io {
                    path: current,
                    source,
                });
            }
        }
        let metadata = fs::symlink_metadata(&current).map_err(|source| ToolError::Io {
            path: current.clone(),
            source,
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(ToolError::SandboxPathUnavailable(current));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(scratch)
            .map_err(|source| ToolError::Io {
                path: scratch.to_path_buf(),
                source,
            })?
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(scratch, permissions).map_err(|source| ToolError::Io {
            path: scratch.to_path_buf(),
            source,
        })?;
    }
    Ok(())
}

fn sandbox_capability(requirement: SandboxRequirement) -> Result<SandboxCapability, ToolError> {
    if requirement == SandboxRequirement::None {
        // `None` is an explicit unsandboxed request, not a failed attempt to
        // provide isolation. Keep the distinction in the deterministic policy
        // record so AUTO can reject it and YOLO remains visibly full-access.
        return Ok(SandboxCapability::DangerFullAccess);
    }
    if enforcing_backend_available() {
        Ok(SandboxCapability::WorkspaceWrite)
    } else if requirement == SandboxRequirement::Required {
        Err(ToolError::SandboxUnavailable)
    } else {
        Ok(SandboxCapability::Unavailable)
    }
}

struct BoundedProcessCapture {
    retained: Vec<u8>,
    total_bytes: u64,
}

fn spawn_bounded_capture<R: Read + Send + 'static>(
    mut reader: R,
    retain_bytes: usize,
) -> JoinHandle<Result<BoundedProcessCapture, ToolError>> {
    thread::spawn(move || {
        let mut retained = Vec::with_capacity(retain_bytes.min(1024 * 1024));
        let mut total_bytes = 0_u64;
        let mut buffer = [0_u8; 8192];
        loop {
            let count = match reader.read(&mut buffer) {
                Ok(count) => count,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(ToolError::Spawn(error)),
            };
            if count == 0 {
                break;
            }
            total_bytes = total_bytes.saturating_add(count as u64);
            let remaining = retain_bytes.saturating_sub(retained.len());
            retained.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        Ok(BoundedProcessCapture {
            retained,
            total_bytes,
        })
    })
}

fn capture_bytes(
    capture: BoundedProcessCapture,
    artifact_directory: &Path,
    limits: OutputLimits,
) -> Result<CapturedOutput, ToolError> {
    let safe_bytes = std::str::from_utf8(&capture.retained)
        .map(|text| redact_sensitive_text(text).into_bytes())
        .unwrap_or(capture.retained);
    let inline = safe_bytes[..safe_bytes.len().min(limits.inline_bytes)].to_vec();
    let artifact = if capture.total_bytes > limits.inline_bytes as u64 {
        let captured = &safe_bytes[..safe_bytes.len().min(limits.artifact_bytes)];
        Some(store_artifact(artifact_directory, captured)?)
    } else {
        None
    };
    Ok(CapturedOutput {
        inline,
        artifact,
        byte_length: capture.total_bytes,
        truncated: capture.total_bytes > limits.artifact_bytes as u64,
    })
}

fn store_artifact(artifact_directory: &Path, bytes: &[u8]) -> Result<OutputArtifact, ToolError> {
    store_artifact_with_quota(artifact_directory, bytes, artifact_quota_from_environment())
}

fn artifact_quota_from_environment() -> ArtifactQuota {
    let defaults = ArtifactQuota::default();
    ArtifactQuota {
        max_bytes: std::env::var("CHANGELOOP_ARTIFACT_MAX_BYTES")
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|value| *value > 0)
            .unwrap_or(defaults.max_bytes),
        max_files: std::env::var("CHANGELOOP_ARTIFACT_MAX_FILES")
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|value| *value > 0)
            .unwrap_or(defaults.max_files),
    }
}

fn store_artifact_with_quota(
    artifact_directory: &Path,
    bytes: &[u8],
    quota: ArtifactQuota,
) -> Result<OutputArtifact, ToolError> {
    let _transaction = ArtifactStoreTransaction::acquire(artifact_directory)?;
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    let directory = artifact_directory.join(&sha256[..2]);
    if matches!(fs::symlink_metadata(&directory), Ok(metadata) if metadata.file_type().is_symlink())
    {
        return Err(ToolError::InvalidArtifact(directory));
    }
    fs::create_dir_all(&directory).map_err(|source| ToolError::Io {
        path: directory.clone(),
        source,
    })?;
    let canonical_directory = fs::canonicalize(&directory).map_err(|source| ToolError::Io {
        path: directory.clone(),
        source,
    })?;
    if !canonical_directory.starts_with(artifact_directory) {
        return Err(ToolError::InvalidArtifact(directory));
    }
    let destination = directory.join(&sha256);
    if !destination.exists() {
        let (retained_bytes, retained_files, _) = artifact_inventory(artifact_directory)?;
        if retained_files >= quota.max_files
            || retained_bytes.saturating_add(bytes.len() as u64) > quota.max_bytes
        {
            return Err(ToolError::ArtifactQuotaPressure {
                bytes: retained_bytes,
                files: retained_files,
                max_bytes: quota.max_bytes,
                max_files: quota.max_files,
            });
        }
        let mut temporary = NamedTempFile::new_in(&directory).map_err(|source| ToolError::Io {
            path: directory.clone(),
            source,
        })?;
        temporary.write_all(bytes).map_err(|source| ToolError::Io {
            path: temporary.path().to_path_buf(),
            source,
        })?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|source| ToolError::Io {
                path: temporary.path().to_path_buf(),
                source,
            })?;
        match temporary.persist_noclobber(&destination) {
            Ok(_) => File::open(&directory)
                .and_then(|directory| directory.sync_all())
                .map_err(|source| ToolError::Io {
                    path: directory.clone(),
                    source,
                })?,
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(ToolError::Io {
                    path: destination.clone(),
                    source: error.error,
                });
            }
        }
    }
    let artifact = OutputArtifact {
        path: destination,
        sha256,
        byte_length: bytes.len() as u64,
        media_type: if std::str::from_utf8(bytes).is_ok() {
            "text/plain; charset=utf-8".into()
        } else {
            "application/octet-stream".into()
        },
    };
    read_verified_artifact(artifact_directory, &artifact)?;
    refresh_artifact_grace(artifact_directory, &artifact.sha256)?;
    Ok(artifact)
}

fn refresh_artifact_grace(artifact_directory: &Path, digest: &str) -> Result<(), ToolError> {
    #[cfg(unix)]
    let file = {
        let root = File::open(artifact_directory).map_err(|source| ToolError::Io {
            path: artifact_directory.to_path_buf(),
            source,
        })?;
        secure_open_beneath(
            &root,
            &Path::new(&digest[..2]).join(digest),
            libc::O_RDONLY | libc::O_NONBLOCK,
        )?
    };
    #[cfg(not(unix))]
    let file =
        File::open(artifact_directory.join(&digest[..2]).join(digest)).map_err(|source| {
            ToolError::Io {
                path: artifact_directory.to_path_buf(),
                source,
            }
        })?;
    file.set_times(std::fs::FileTimes::new().set_modified(std::time::SystemTime::now()))
        .map_err(|source| ToolError::Io {
            path: artifact_directory.join(&digest[..2]).join(digest),
            source,
        })
}

type ArtifactInventoryEntry = (String, PathBuf, u64, std::time::SystemTime);

fn artifact_inventory(
    artifact_directory: &Path,
) -> Result<(u64, usize, Vec<ArtifactInventoryEntry>), ToolError> {
    let mut bytes = 0_u64;
    let mut files = 0_usize;
    let mut entries = Vec::new();
    for prefix in fs::read_dir(artifact_directory).map_err(|source| ToolError::Io {
        path: artifact_directory.to_owned(),
        source,
    })? {
        let prefix = prefix.map_err(|source| ToolError::Io {
            path: artifact_directory.to_owned(),
            source,
        })?;
        let prefix_path = prefix.path();
        let metadata = fs::symlink_metadata(&prefix_path).map_err(|source| ToolError::Io {
            path: prefix_path.clone(),
            source,
        })?;
        if metadata.file_type().is_symlink() {
            return Err(ToolError::InvalidArtifact(prefix_path));
        }
        let prefix_name = prefix.file_name().to_string_lossy().to_ascii_lowercase();
        if !metadata.is_dir()
            || prefix_name.len() != 2
            || !prefix_name.bytes().all(|b| b.is_ascii_hexdigit())
        {
            continue;
        }
        for item in fs::read_dir(&prefix_path).map_err(|source| ToolError::Io {
            path: prefix_path.clone(),
            source,
        })? {
            let item = item.map_err(|source| ToolError::Io {
                path: prefix_path.clone(),
                source,
            })?;
            let path = item.path();
            let metadata = fs::symlink_metadata(&path).map_err(|source| ToolError::Io {
                path: path.clone(),
                source,
            })?;
            let digest = item.file_name().to_string_lossy().to_ascii_lowercase();
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || digest.len() != 64
                || !digest.bytes().all(|b| b.is_ascii_hexdigit())
                || !digest.starts_with(&prefix_name)
            {
                return Err(ToolError::InvalidArtifact(path));
            }
            bytes = bytes.saturating_add(metadata.len());
            files += 1;
            entries.push((
                digest,
                path,
                metadata.len(),
                metadata
                    .modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            ));
        }
    }
    Ok((bytes, files, entries))
}

pub fn gc_project_artifacts(
    project_root: &Path,
    quota: ArtifactQuota,
) -> Result<ArtifactGcReport, ToolError> {
    gc_project_artifacts_with_grace(project_root, quota, Duration::from_secs(60 * 60))
}

pub fn gc_project_artifacts_with_grace(
    project_root: &Path,
    quota: ArtifactQuota,
    active_grace: Duration,
) -> Result<ArtifactGcReport, ToolError> {
    let artifact_directory = project_root.join(".changeloop/artifacts");
    if !artifact_directory.exists() {
        return Ok(ArtifactGcReport {
            before_bytes: 0,
            before_files: 0,
            after_bytes: 0,
            after_files: 0,
            deleted: Vec::new(),
            pinned: 0,
            pressure: false,
        });
    }
    let artifact_directory =
        fs::canonicalize(&artifact_directory).map_err(|source| ToolError::Io {
            path: artifact_directory,
            source,
        })?;
    let _transaction = ArtifactStoreTransaction::acquire(&artifact_directory)?;
    let (before_bytes, before_files, mut entries) = artifact_inventory(&artifact_directory)?;
    let pins = collect_project_artifact_pins(project_root)?;
    let now = std::time::SystemTime::now();
    entries.sort_by(|left, right| left.3.cmp(&right.3).then_with(|| left.0.cmp(&right.0)));
    let mut after_bytes = before_bytes;
    let mut after_files = before_files;
    let mut deleted = Vec::new();
    for (digest, path, bytes, modified) in entries {
        if after_bytes <= quota.max_bytes && after_files <= quota.max_files {
            break;
        }
        let recent = now.duration_since(modified).unwrap_or_default() < active_grace;
        if pins.contains(&digest) || recent {
            continue;
        }
        _transaction.remove_artifact(&artifact_directory, &path)?;
        after_bytes = after_bytes.saturating_sub(bytes);
        after_files = after_files.saturating_sub(1);
        deleted.push(digest);
    }
    Ok(ArtifactGcReport {
        before_bytes,
        before_files,
        after_bytes,
        after_files,
        deleted,
        pinned: pins.len(),
        pressure: after_bytes > quota.max_bytes || after_files > quota.max_files,
    })
}

struct ArtifactStoreTransaction {
    #[cfg(unix)]
    file: File,
}

impl ArtifactStoreTransaction {
    fn acquire(artifact_directory: &Path) -> Result<Self, ToolError> {
        #[cfg(unix)]
        {
            let file = File::open(artifact_directory).map_err(|source| ToolError::Io {
                path: artifact_directory.to_path_buf(),
                source,
            })?;
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
                return Err(ToolError::Io {
                    path: artifact_directory.to_path_buf(),
                    source: std::io::Error::last_os_error(),
                });
            }
            Ok(Self { file })
        }
        #[cfg(not(unix))]
        {
            let _ = artifact_directory;
            Ok(Self {})
        }
    }

    fn remove_artifact(&self, artifact_directory: &Path, path: &Path) -> Result<(), ToolError> {
        let relative = path
            .strip_prefix(artifact_directory)
            .map_err(|_| ToolError::InvalidArtifact(path.to_path_buf()))?;
        #[cfg(unix)]
        {
            let parent_path = relative
                .parent()
                .ok_or_else(|| ToolError::InvalidArtifact(path.to_path_buf()))?;
            let file_name = relative
                .file_name()
                .ok_or_else(|| ToolError::InvalidArtifact(path.to_path_buf()))?;
            use std::os::unix::ffi::OsStrExt;
            let file_name = CString::new(file_name.as_bytes())
                .map_err(|_| ToolError::InvalidArtifact(path.to_path_buf()))?;
            let parent =
                secure_open_beneath(&self.file, parent_path, libc::O_RDONLY | libc::O_DIRECTORY)?;
            if unsafe { libc::unlinkat(parent.as_raw_fd(), file_name.as_ptr(), 0) } != 0 {
                return Err(ToolError::Io {
                    path: path.to_path_buf(),
                    source: std::io::Error::last_os_error(),
                });
            }
            parent.sync_all().map_err(|source| ToolError::Io {
                path: path.to_path_buf(),
                source,
            })?;
            Ok(())
        }
        #[cfg(not(unix))]
        {
            fs::remove_file(path).map_err(|source| ToolError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    }
}

#[cfg(unix)]
impl Drop for ArtifactStoreTransaction {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

fn collect_project_artifact_pins(project_root: &Path) -> Result<BTreeSet<String>, ToolError> {
    const MAX_PIN_FILES: usize = 20_000;
    const MAX_PIN_BYTES: u64 = 256 * 1024 * 1024;
    let state = project_root.join(".changeloop");
    let roots = [
        state.join("state.db"),
        state.join("state.db-wal"),
        state.join("privacy-sessions.json"),
        state.join("operational.json"),
        state.join("proofs"),
        state.join("reviews"),
        state.join("snapshots"),
        state.join("hooks"),
    ];
    let mut pending = roots.to_vec();
    let mut files = 0_usize;
    let mut bytes = 0_u64;
    let mut pins = BTreeSet::new();
    while let Some(path) = pending.pop() {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(source) => return Err(ToolError::Io { path, source }),
        };
        if metadata.file_type().is_symlink() {
            return Err(ToolError::InvalidArtifact(path));
        }
        if metadata.is_dir() {
            for entry in fs::read_dir(&path).map_err(|source| ToolError::Io {
                path: path.clone(),
                source,
            })? {
                pending.push(
                    entry
                        .map_err(|source| ToolError::Io {
                            path: path.clone(),
                            source,
                        })?
                        .path(),
                );
            }
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let file = open_read_nofollow(&path)?;
        let metadata = file.metadata().map_err(|source| ToolError::Io {
            path: path.clone(),
            source,
        })?;
        if !metadata.is_file() {
            return Err(ToolError::InvalidArtifact(path));
        }
        files += 1;
        bytes = bytes.saturating_add(metadata.len());
        if files > MAX_PIN_FILES || bytes > MAX_PIN_BYTES {
            return Err(ToolError::ArtifactPinScanPressure);
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            collect_hex_digests(name.as_bytes(), &mut pins);
        }
        let mut content = Vec::new();
        file.take(metadata.len().saturating_add(1))
            .read_to_end(&mut content)
            .map_err(|source| ToolError::Io {
                path: path.clone(),
                source,
            })?;
        if content.len() as u64 != metadata.len() {
            return Err(ToolError::ArtifactPinScanPressure);
        }
        collect_hex_digests(&content, &mut pins);
    }
    Ok(pins)
}

fn open_read_nofollow(path: &Path) -> Result<File, ToolError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    options.open(path).map_err(|source| ToolError::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn collect_hex_digests(content: &[u8], output: &mut BTreeSet<String>) {
    for window in content.windows(64) {
        if window.iter().all(u8::is_ascii_hexdigit) {
            output.insert(String::from_utf8_lossy(window).to_ascii_lowercase());
        }
    }
}

fn read_verified_artifact(
    artifact_directory: &Path,
    artifact: &OutputArtifact,
) -> Result<Vec<u8>, ToolError> {
    let valid_digest = artifact.sha256.len() == 64
        && artifact
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase());
    if !valid_digest {
        return Err(ToolError::InvalidArtifact(artifact.path.clone()));
    }
    let expected = artifact_directory
        .join(&artifact.sha256[..2])
        .join(&artifact.sha256);
    if artifact.path != expected {
        return Err(ToolError::InvalidArtifact(artifact.path.clone()));
    }
    #[cfg(unix)]
    let file = {
        let root = File::open(artifact_directory).map_err(|source| ToolError::Io {
            path: artifact_directory.to_path_buf(),
            source,
        })?;
        let relative = Path::new(&artifact.sha256[..2]).join(&artifact.sha256);
        let file = secure_open_beneath(&root, &relative, libc::O_RDONLY | libc::O_NONBLOCK)?;
        reject_hardlinked_file(&file, &relative)?;
        file
    };
    #[cfg(not(unix))]
    let file = {
        let metadata = fs::symlink_metadata(&artifact.path).map_err(|source| ToolError::Io {
            path: artifact.path.clone(),
            source,
        })?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(ToolError::InvalidArtifact(artifact.path.clone()));
        }
        let canonical = fs::canonicalize(&artifact.path).map_err(|source| ToolError::Io {
            path: artifact.path.clone(),
            source,
        })?;
        if !canonical.starts_with(artifact_directory) {
            return Err(ToolError::InvalidArtifact(artifact.path.clone()));
        }
        File::open(&canonical).map_err(|source| ToolError::Io {
            path: canonical,
            source,
        })?
    };
    let metadata = file.metadata().map_err(|source| ToolError::Io {
        path: artifact.path.clone(),
        source,
    })?;
    if !metadata.is_file() || metadata.len() != artifact.byte_length {
        return Err(ToolError::ArtifactTampered(artifact.path.clone()));
    }
    let mut bytes = Vec::new();
    file.take(artifact.byte_length.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|source| ToolError::Io {
            path: artifact.path.clone(),
            source,
        })?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != artifact.sha256 || bytes.len() as u64 != artifact.byte_length {
        return Err(ToolError::ArtifactTampered(artifact.path.clone()));
    }
    Ok(bytes)
}

fn filter_environment(
    environment: &BTreeMap<String, String>,
) -> (BTreeMap<String, String>, Vec<String>) {
    const SECRET_MARKERS: [&str; 10] = [
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PASSWD",
        "API_KEY",
        "CREDENTIAL",
        "COOKIE",
        "PRIVATE",
        "ACCESS_KEY",
        "AUTH",
    ];
    let mut safe = BTreeMap::new();
    let mut filtered = Vec::new();
    for (name, value) in environment {
        let upper = name.to_ascii_uppercase();
        let execution_control = upper == "PATH"
            || upper == "ENV"
            || upper == "BASH_ENV"
            || upper == "SHELLOPTS"
            || upper == "CDPATH"
            || upper == "GLOBIGNORE"
            || upper == "PYTHONPATH"
            || upper == "RUBYOPT"
            || upper == "PERL5OPT"
            || upper == "NODE_OPTIONS"
            || upper == "GIT_DIR"
            || upper == "GIT_WORK_TREE"
            || upper == "SSH_AUTH_SOCK"
            || upper.starts_with("LD_")
            || upper.starts_with("DYLD_")
            || upper.starts_with("GIT_CONFIG");
        if execution_control || SECRET_MARKERS.iter().any(|marker| upper.contains(marker)) {
            filtered.push(name.clone());
        } else {
            safe.insert(name.clone(), value.clone());
        }
    }
    (safe, filtered)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobKind {
    Background,
    Pty,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobState {
    Running,
    Exited,
    Cancelled,
}

pub struct JobRecord {
    pub id: String,
    pub kind: JobKind,
    pub state: JobState,
    child: SandboxedChild,
    pty_writer: Option<File>,
    stdout: Arc<Mutex<BoundedJobOutput>>,
    stderr: Arc<Mutex<BoundedJobOutput>>,
    readers: Vec<JoinHandle<()>>,
}

const JOB_OUTPUT_LIMIT: usize = 1024 * 1024;
const MAX_PROJECT_JOBS: usize = 128;
const MAX_JOB_INPUT_BYTES: usize = 64 * 1024;
const JOB_INPUT_DEADLINE: Duration = Duration::from_millis(250);

#[derive(Debug, Default)]
struct BoundedJobOutput {
    bytes: Vec<u8>,
    total_bytes: u64,
    truncated: bool,
}

impl BoundedJobOutput {
    fn append(&mut self, bytes: &[u8]) {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len() as u64);
        let remaining = JOB_OUTPUT_LIMIT.saturating_sub(self.bytes.len());
        self.bytes
            .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        self.truncated |= bytes.len() > remaining;
    }

    fn snapshot(&self) -> JobOutput {
        let bytes = std::str::from_utf8(&self.bytes)
            .map(|text| redact_sensitive_text(text).into_bytes())
            .unwrap_or_else(|_| self.bytes.clone());
        JobOutput {
            bytes,
            total_bytes: self.total_bytes,
            truncated: self.truncated,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobOutput {
    pub bytes: Vec<u8>,
    pub total_bytes: u64,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobStatus {
    pub id: String,
    pub kind: JobKind,
    pub state: JobState,
    pub stdout: JobOutput,
    pub stderr: JobOutput,
}

pub struct JobManager {
    root: PathBuf,
    jobs: BTreeMap<String, JobRecord>,
}

impl JobManager {
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        let root = fs::canonicalize(&root).unwrap_or(root);
        Self {
            root,
            jobs: BTreeMap::new(),
        }
    }

    fn spawn(
        &mut self,
        kind: JobKind,
        program: &Path,
        arguments: &[String],
        environment: &BTreeMap<String, String>,
    ) -> Result<String, ToolError> {
        let existing = self.jobs.keys().cloned().collect::<Vec<_>>();
        for id in existing {
            self.poll(&id)?;
        }
        if self
            .jobs
            .values()
            .filter(|job| job.state == JobState::Running)
            .count()
            >= MAX_PROJECT_JOBS
        {
            return Err(ToolError::JobLimitReached);
        }
        let (environment, _) = filter_environment(environment);
        let stdout = Arc::new(Mutex::new(BoundedJobOutput::default()));
        let stderr = Arc::new(Mutex::new(BoundedJobOutput::default()));
        let (child, pty_writer, readers) = match kind {
            JobKind::Background => spawn_background(
                &self.root,
                program,
                arguments,
                &environment,
                Arc::clone(&stdout),
                Arc::clone(&stderr),
            )?,
            JobKind::Pty => spawn_pty(
                &self.root,
                program,
                arguments,
                &environment,
                Arc::clone(&stdout),
            )?,
        };
        let id = Uuid::now_v7().to_string();
        self.jobs.insert(
            id.clone(),
            JobRecord {
                id: id.clone(),
                kind,
                state: JobState::Running,
                child,
                pty_writer,
                stdout,
                stderr,
                readers,
            },
        );
        Ok(id)
    }

    pub fn write_stdin(&mut self, id: &str, bytes: &[u8]) -> Result<(), ToolError> {
        let job = self
            .jobs
            .get_mut(id)
            .ok_or_else(|| ToolError::JobNotFound(id.into()))?;
        if job.kind != JobKind::Pty || job.state != JobState::Running {
            return Err(ToolError::JobNotRunning(id.into()));
        }
        let writer = job
            .pty_writer
            .as_mut()
            .ok_or_else(|| ToolError::JobNotRunning(id.into()))?;
        write_job_stdin(writer, bytes)
    }

    pub fn poll(&mut self, id: &str) -> Result<JobState, ToolError> {
        let job = self
            .jobs
            .get_mut(id)
            .ok_or_else(|| ToolError::JobNotFound(id.into()))?;
        if job.state == JobState::Running
            && job
                .child
                .try_wait_owned_group()
                .map_err(ToolError::Spawn)?
                .is_some()
        {
            job.state = JobState::Exited;
            // A process exit can race its pipe-reader threads. Join them before
            // publishing the terminal state so callers never observe an
            // "exited" job with output that appears later.
            for reader in job.readers.drain(..) {
                let _ = reader.join();
            }
        }
        Ok(job.state)
    }

    pub fn status(&mut self, id: &str) -> Result<JobStatus, ToolError> {
        let state = self.poll(id)?;
        let job = self
            .jobs
            .get(id)
            .ok_or_else(|| ToolError::JobNotFound(id.into()))?;
        Ok(JobStatus {
            id: job.id.clone(),
            kind: job.kind,
            state,
            stdout: lock_recover(&job.stdout).snapshot(),
            stderr: lock_recover(&job.stderr).snapshot(),
        })
    }

    pub fn list(&mut self) -> Vec<JobStatus> {
        let ids: Vec<String> = self.jobs.keys().cloned().collect();
        ids.into_iter()
            .filter_map(|id| self.status(&id).ok())
            .collect()
    }

    pub fn cancel(&mut self, id: &str) -> Result<(), ToolError> {
        let job = self
            .jobs
            .get_mut(id)
            .ok_or_else(|| ToolError::JobNotFound(id.into()))?;
        if job.state == JobState::Running {
            job.child.terminate();
            job.state = JobState::Cancelled;
            job.pty_writer.take();
            for reader in job.readers.drain(..) {
                let _ = reader.join();
            }
        }
        Ok(())
    }

    pub fn dispose(&mut self) {
        for job in self.jobs.values_mut() {
            if job.state == JobState::Running {
                job.child.terminate();
                job.state = JobState::Cancelled;
            }
            job.pty_writer.take();
            for reader in job.readers.drain(..) {
                let _ = reader.join();
            }
        }
    }
}

impl Drop for JobManager {
    fn drop(&mut self) {
        self.dispose();
    }
}

type SpawnedJob = (SandboxedChild, Option<File>, Vec<JoinHandle<()>>);

/// The policy a background or interactive job would get.
///
/// It is built even though the job currently declines enforcement, so the shape
/// of the eventual profile is stated in one place rather than invented at the
/// moment someone wires it. The register rows `background-job-host` and
/// `pty-controlling-terminal` record why it is not applied yet.
fn background_job_policy(root: &Path) -> SandboxPolicy {
    SandboxPolicy::deny_by_default(root).writable([root.to_path_buf()])
}

/// Jobs run with a cleared environment and a fixed executable search path, so a
/// credential in the operator's shell is not inherited by an agent-driven
/// process.
fn job_environment(environment: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut prepared = environment.clone();
    prepared.insert("PATH".to_string(), SAFE_EXECUTABLE_PATH.to_string());
    prepared
}

fn spawn_background(
    root: &Path,
    program: &Path,
    arguments: &[String],
    environment: &BTreeMap<String, String>,
    stdout: Arc<Mutex<BoundedJobOutput>>,
    stderr: Arc<Mutex<BoundedJobOutput>>,
) -> Result<SpawnedJob, ToolError> {
    validate_executable(root, program)?;
    validate_process_arguments(arguments)?;
    let mut child = Spawn::new(program, background_job_policy(root))
        .arguments(arguments.to_vec())
        .working_directory(root)
        .environment(job_environment(environment))
        .stdin(StdioPlan::Null)
        .stdout(StdioPlan::Piped)
        .stderr(StdioPlan::Piped)
        .session(SessionPlan::OwnedProcessGroup)
        .without_enforcement(exceptions::BACKGROUND_JOB_HOST)
        .spawn()
        .map_err(sandbox_error)?;
    let stdout_reader = child
        .take_stdout()
        .ok_or_else(|| ToolError::Spawn(std::io::Error::other("stdout pipe missing")))?;
    let stderr_reader = child
        .take_stderr()
        .ok_or_else(|| ToolError::Spawn(std::io::Error::other("stderr pipe missing")))?;
    Ok((
        child,
        None,
        vec![
            spawn_output_reader(stdout_reader, stdout),
            spawn_output_reader(stderr_reader, stderr),
        ],
    ))
}

fn spawn_output_reader<R: Read + Send + 'static>(
    mut reader: R,
    output: Arc<Mutex<BoundedJobOutput>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => lock_recover(&output).append(&buffer[..count]),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(1));
                }
                Err(_) => break,
            }
        }
    })
}

#[cfg(unix)]
fn write_job_stdin(writer: &mut File, bytes: &[u8]) -> Result<(), ToolError> {
    if bytes.len() > MAX_JOB_INPUT_BYTES {
        return Err(ToolError::JobInputTooLarge);
    }
    let descriptor = writer.as_raw_fd();
    let original_flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if original_flags < 0
        || unsafe { libc::fcntl(descriptor, libc::F_SETFL, original_flags | libc::O_NONBLOCK) } != 0
    {
        return Err(ToolError::Spawn(std::io::Error::last_os_error()));
    }
    let deadline = Instant::now() + JOB_INPUT_DEADLINE;
    let result = (|| {
        let mut written = 0;
        while written < bytes.len() {
            let now = Instant::now();
            if now >= deadline {
                return Err(ToolError::JobInputBackpressure);
            }
            let timeout = deadline
                .saturating_duration_since(now)
                .as_millis()
                .min(i32::MAX as u128) as i32;
            let mut poll = libc::pollfd {
                fd: descriptor,
                events: libc::POLLOUT,
                revents: 0,
            };
            let ready = unsafe { libc::poll(&mut poll, 1, timeout) };
            if ready == 0 {
                return Err(ToolError::JobInputBackpressure);
            }
            if ready < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(ToolError::Spawn(error));
            }
            let count = unsafe {
                libc::write(
                    descriptor,
                    bytes[written..].as_ptr().cast(),
                    bytes.len() - written,
                )
            };
            if count > 0 {
                written += count as usize;
                continue;
            }
            let error = std::io::Error::last_os_error();
            if matches!(
                error.kind(),
                std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
            ) {
                continue;
            }
            return Err(ToolError::Spawn(error));
        }
        Ok(())
    })();
    let restore = unsafe { libc::fcntl(descriptor, libc::F_SETFL, original_flags) };
    if restore != 0 && result.is_ok() {
        return Err(ToolError::Spawn(std::io::Error::last_os_error()));
    }
    result
}

#[cfg(not(unix))]
fn write_job_stdin(writer: &mut File, bytes: &[u8]) -> Result<(), ToolError> {
    if bytes.len() > MAX_JOB_INPUT_BYTES {
        return Err(ToolError::JobInputTooLarge);
    }
    writer.write_all(bytes).map_err(ToolError::Spawn)
}

fn lock_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(unix)]
fn spawn_pty(
    root: &Path,
    program: &Path,
    arguments: &[String],
    environment: &BTreeMap<String, String>,
    stdout: Arc<Mutex<BoundedJobOutput>>,
) -> Result<SpawnedJob, ToolError> {
    use std::os::fd::{AsRawFd, FromRawFd};

    validate_executable(root, program)?;
    validate_process_arguments(arguments)?;
    let mut master = -1;
    let mut slave = -1;
    let result = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result != 0 {
        return Err(ToolError::Spawn(std::io::Error::last_os_error()));
    }
    let master = unsafe { File::from_raw_fd(master) };
    let slave = unsafe { File::from_raw_fd(slave) };
    let slave_fd = slave.as_raw_fd();
    // The session setup — setsid plus claiming the controlling terminal — is
    // owned by the sandbox crate, because it is part of creating the process.
    // The approval decision is resolved before we get here and never inside the
    // child: a child holding a controlling terminal cannot raise a prompt, and
    // the documented PTY failure is exactly a plugin that could not prompt
    // silently reinterpreting `ask`.
    let child = Spawn::new(program, background_job_policy(root))
        .arguments(arguments.to_vec())
        .working_directory(root)
        .environment(job_environment(environment))
        .stdin(StdioPlan::Handle(Stdio::from(
            slave.try_clone().map_err(ToolError::Spawn)?,
        )))
        .stdout(StdioPlan::Handle(Stdio::from(
            slave.try_clone().map_err(ToolError::Spawn)?,
        )))
        .stderr(StdioPlan::Handle(Stdio::from(slave)))
        .session(SessionPlan::ControllingTerminal { slave: slave_fd })
        .without_enforcement(exceptions::PTY_CONTROLLING_TERMINAL)
        .spawn()
        .map_err(sandbox_error)?;
    let reader = master.try_clone().map_err(ToolError::Spawn)?;
    Ok((
        child,
        Some(master),
        vec![spawn_output_reader(reader, stdout)],
    ))
}

#[cfg(not(unix))]
fn spawn_pty(
    _root: &Path,
    _program: &Path,
    _arguments: &[String],
    _environment: &BTreeMap<String, String>,
    _stdout: Arc<Mutex<BoundedJobOutput>>,
) -> Result<SpawnedJob, ToolError> {
    Err(ToolError::PtyUnavailable)
}

fn normalize_relative(path: &Path) -> Result<PathBuf, ToolError> {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ToolError::PathOutsideScope(path.to_path_buf()));
            }
        }
    }
    Ok(result)
}

fn validate_expected_sha256(value: &str) -> Result<(), ToolError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(ToolError::InvalidExpectedHash)
    }
}

fn validate_executable(root: &Path, program: &Path) -> Result<(), ToolError> {
    if program.as_os_str().is_empty() {
        return Err(ToolError::ExecutableDenied(program.to_path_buf()));
    }
    if program.components().count() == 1 {
        // Bare names resolve only through SAFE_EXECUTABLE_PATH, which is
        // installed after env_clear and cannot be replaced by tool input.
        return Ok(());
    }
    let candidate = if program.is_absolute() {
        program.to_path_buf()
    } else {
        root.join(normalize_relative(program)?)
    };
    let canonical = fs::canonicalize(&candidate).map_err(|source| ToolError::Io {
        path: candidate,
        source,
    })?;
    if !program.is_absolute() {
        return canonical
            .starts_with(root)
            .then_some(())
            .ok_or_else(|| ToolError::ExecutableDenied(program.to_path_buf()));
    }
    let trusted = [
        Path::new("/bin"),
        Path::new("/usr/bin"),
        Path::new("/usr/sbin"),
        Path::new("/sbin"),
        Path::new("/usr/local/bin"),
        Path::new("/opt/homebrew/bin"),
    ];
    if canonical.starts_with(root)
        || trusted.iter().any(|directory| {
            fs::canonicalize(directory).is_ok_and(|directory| canonical.starts_with(directory))
        })
    {
        Ok(())
    } else {
        Err(ToolError::ExecutableDenied(program.to_path_buf()))
    }
}

fn validate_process_arguments(arguments: &[String]) -> Result<(), ToolError> {
    if arguments.len() > 4_096
        || arguments
            .iter()
            .map(String::len)
            .try_fold(0_usize, usize::checked_add)
            .is_none_or(|bytes| bytes > 1024 * 1024)
    {
        return Err(ToolError::ProcessArgumentsTooLarge);
    }
    for argument in arguments {
        let normalized = argument.replace('\\', "/").to_ascii_lowercase();
        if normalized.contains(".env")
            || normalized.contains(".git")
            || normalized.contains(".changeloop")
            || [".pem", ".key", ".p12", ".pfx"]
                .iter()
                .any(|extension| normalized.contains(extension))
        {
            return Err(ToolError::ProtectedProcessArgument);
        }
    }
    Ok(())
}

#[cfg(unix)]
fn secure_open_beneath(
    root: &File,
    relative: &Path,
    final_flags: libc::c_int,
) -> Result<File, ToolError> {
    use std::os::unix::ffi::OsStrExt;

    let relative = normalize_relative(relative)?;
    let components = relative.components().collect::<Vec<_>>();
    let duplicated = unsafe { libc::fcntl(root.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 3) };
    if duplicated < 0 {
        return Err(ToolError::Io {
            path: relative,
            source: std::io::Error::last_os_error(),
        });
    }
    let mut current = unsafe { File::from_raw_fd(duplicated) };
    if components.is_empty() {
        return Ok(current);
    }
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err(ToolError::PathOutsideScope(relative));
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| ToolError::PathOutsideScope(relative.clone()))?;
        let flags = if index + 1 == components.len() {
            final_flags | libc::O_NOFOLLOW | libc::O_CLOEXEC
        } else {
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC
        };
        let descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        if descriptor < 0 {
            let source = std::io::Error::last_os_error();
            return if source.raw_os_error() == Some(libc::ELOOP) {
                Err(ToolError::Symlink(relative))
            } else {
                Err(ToolError::Io {
                    path: relative,
                    source,
                })
            };
        }
        current = unsafe { File::from_raw_fd(descriptor) };
    }
    Ok(current)
}

#[cfg(unix)]
fn list_directory_names(directory: &File) -> Result<Vec<std::ffi::OsString>, ToolError> {
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStringExt;

    let duplicate = unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 3) };
    if duplicate < 0 {
        return Err(ToolError::Io {
            path: PathBuf::from("."),
            source: std::io::Error::last_os_error(),
        });
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe { libc::close(duplicate) };
        return Err(ToolError::Io {
            path: PathBuf::from("."),
            source: std::io::Error::last_os_error(),
        });
    }
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if name != b"." && name != b".." {
            names.push(std::ffi::OsString::from_vec(name.to_vec()));
        }
    }
    unsafe { libc::closedir(stream) };
    Ok(names)
}

#[cfg(unix)]
fn collect_regular_files_beneath(
    root: &File,
    relative: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), ToolError> {
    const MAX_SEARCH_FILES: usize = 20_000;
    let directory = secure_open_beneath(
        root,
        relative,
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NONBLOCK,
    )?;
    for name in list_directory_names(&directory)? {
        let child = relative.join(name);
        let opened = match secure_open_beneath(root, &child, libc::O_RDONLY | libc::O_NONBLOCK) {
            Ok(opened) => opened,
            Err(ToolError::Symlink(_)) => continue,
            Err(error) => return Err(error),
        };
        let metadata = opened.metadata().map_err(|source| ToolError::Io {
            path: child.clone(),
            source,
        })?;
        if metadata.is_dir() {
            collect_regular_files_beneath(root, &child, files)?;
        } else if metadata.is_file() {
            reject_hardlinked_file(&opened, &child)?;
            files.push(child);
            if files.len() > MAX_SEARCH_FILES {
                return Err(ToolError::TraversalLimit);
            }
        }
    }
    Ok(())
}

fn reject_hardlinked_file(file: &File, path: &Path) -> Result<(), ToolError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if file
            .metadata()
            .map_err(|source| ToolError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .nlink()
            > 1
        {
            return Err(ToolError::Hardlink(path.to_path_buf()));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn secure_parent_beneath(
    root: &File,
    relative: &Path,
    create_missing: bool,
) -> Result<(File, CString), ToolError> {
    use std::os::unix::ffi::OsStrExt;

    let relative = normalize_relative(relative)?;
    let mut components = relative.components().collect::<Vec<_>>();
    let Some(Component::Normal(file_name)) = components.pop() else {
        return Err(ToolError::PathOutsideScope(relative));
    };
    let file_name = CString::new(file_name.as_bytes())
        .map_err(|_| ToolError::PathOutsideScope(relative.clone()))?;
    let duplicated = unsafe { libc::fcntl(root.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 3) };
    if duplicated < 0 {
        return Err(ToolError::Io {
            path: relative,
            source: std::io::Error::last_os_error(),
        });
    }
    let mut current = unsafe { File::from_raw_fd(duplicated) };
    for component in components {
        let Component::Normal(name) = component else {
            return Err(ToolError::PathOutsideScope(relative));
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| ToolError::PathOutsideScope(relative.clone()))?;
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let mut descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        if descriptor < 0
            && create_missing
            && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
        {
            if unsafe { libc::mkdirat(current.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
                let source = std::io::Error::last_os_error();
                if source.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(ToolError::Io {
                        path: relative,
                        source,
                    });
                }
            }
            descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        }
        if descriptor < 0 {
            let source = std::io::Error::last_os_error();
            return if source.raw_os_error() == Some(libc::ELOOP) {
                Err(ToolError::Symlink(relative))
            } else {
                Err(ToolError::Io {
                    path: relative,
                    source,
                })
            };
        }
        current = unsafe { File::from_raw_fd(descriptor) };
    }
    Ok((current, file_name))
}

#[cfg(unix)]
fn secure_atomic_write_beneath(
    root: &File,
    relative: &Path,
    bytes: &[u8],
) -> Result<(), ToolError> {
    secure_atomic_write_beneath_checked(root, relative, bytes, None)
}

#[cfg(unix)]
fn secure_atomic_replace_beneath(
    root: &File,
    relative: &Path,
    bytes: &[u8],
    expected_sha256: &str,
) -> Result<(), ToolError> {
    secure_atomic_write_beneath_checked(root, relative, bytes, Some(expected_sha256))
}

#[cfg(unix)]
fn secure_atomic_write_beneath_checked(
    root: &File,
    relative: &Path,
    bytes: &[u8],
    expected_sha256: Option<&str>,
) -> Result<(), ToolError> {
    use std::os::unix::fs::MetadataExt;

    let relative = normalize_relative(relative)?;
    let (parent, destination) = secure_parent_beneath(root, &relative, expected_sha256.is_none())?;
    let existing = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            destination.as_ptr(),
            libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    let mode = if existing >= 0 {
        let existing = unsafe { File::from_raw_fd(existing) };
        existing
            .metadata()
            .map_err(|source| ToolError::Io {
                path: relative.clone(),
                source,
            })?
            .mode()
            & 0o7777
    } else {
        let source = std::io::Error::last_os_error();
        if source.kind() != std::io::ErrorKind::NotFound {
            return if source.raw_os_error() == Some(libc::ELOOP) {
                Err(ToolError::Symlink(relative))
            } else {
                Err(ToolError::Io {
                    path: relative,
                    source,
                })
            };
        }
        0o600
    };
    let temporary_name = CString::new(format!(".changeloop-tmp-{}", Uuid::now_v7()))
        .expect("UUID temporary name has no NUL");
    let temporary_fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            temporary_name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if temporary_fd < 0 {
        return Err(ToolError::Io {
            path: relative,
            source: std::io::Error::last_os_error(),
        });
    }
    let mut temporary = unsafe { File::from_raw_fd(temporary_fd) };
    let result = (|| {
        temporary
            .write_all(bytes)
            .and_then(|_| temporary.sync_all())
            .map_err(|source| ToolError::Io {
                path: relative.clone(),
                source,
            })?;
        if unsafe { libc::fchmod(temporary.as_raw_fd(), mode as libc::mode_t) } != 0 {
            return Err(ToolError::Io {
                path: relative.clone(),
                source: std::io::Error::last_os_error(),
            });
        }
        temporary.sync_all().map_err(|source| ToolError::Io {
            path: relative.clone(),
            source,
        })?;
        if let Some(expected) = expected_sha256 {
            let descriptor = unsafe {
                libc::openat(
                    parent.as_raw_fd(),
                    destination.as_ptr(),
                    libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if descriptor < 0 {
                return Err(ToolError::Io {
                    path: relative.clone(),
                    source: std::io::Error::last_os_error(),
                });
            }
            let mut current = unsafe { File::from_raw_fd(descriptor) };
            reject_hardlinked_file(&current, &relative)?;
            let actual = sha256_reader(&mut current, &relative)?;
            if actual != expected {
                return Err(ToolError::PatchPrecondition {
                    path: relative.clone(),
                    expected: expected.to_owned(),
                    actual,
                });
            }
        }
        if unsafe {
            libc::renameat(
                parent.as_raw_fd(),
                temporary_name.as_ptr(),
                parent.as_raw_fd(),
                destination.as_ptr(),
            )
        } != 0
        {
            return Err(ToolError::Io {
                path: relative.clone(),
                source: std::io::Error::last_os_error(),
            });
        }
        parent.sync_all().map_err(|source| ToolError::Io {
            path: relative.clone(),
            source,
        })?;
        Ok(())
    })();
    if result.is_err() {
        unsafe {
            libc::unlinkat(parent.as_raw_fd(), temporary_name.as_ptr(), 0);
        }
    }
    result
}

#[cfg(unix)]
fn secure_file_hash_at(
    parent: &File,
    name: &CString,
    relative: &Path,
) -> Result<(String, std::fs::Metadata), ToolError> {
    let descriptor = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        let source = std::io::Error::last_os_error();
        return if source.raw_os_error() == Some(libc::ELOOP) {
            Err(ToolError::Symlink(relative.to_path_buf()))
        } else {
            Err(ToolError::Io {
                path: relative.to_path_buf(),
                source,
            })
        };
    }
    let mut file = unsafe { File::from_raw_fd(descriptor) };
    let metadata = file.metadata().map_err(|source| ToolError::Io {
        path: relative.to_path_buf(),
        source,
    })?;
    if !metadata.is_file() {
        return Err(ToolError::Io {
            path: relative.to_path_buf(),
            source: std::io::Error::other("path is not a regular file"),
        });
    }
    reject_hardlinked_file(&file, relative)?;
    let hash = sha256_reader(&mut file, relative)?;
    Ok((hash, metadata))
}

#[cfg(unix)]
fn secure_delete_beneath(
    root: &File,
    relative: &Path,
    expected_sha256: &str,
) -> Result<String, ToolError> {
    let relative = normalize_relative(relative)?;
    let (parent, name) = secure_parent_beneath(root, &relative, false)?;
    let (actual, _) = secure_file_hash_at(&parent, &name, &relative)?;
    if actual != expected_sha256 {
        return Err(ToolError::PatchPrecondition {
            path: relative,
            expected: expected_sha256.to_owned(),
            actual,
        });
    }
    if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) } != 0 {
        return Err(ToolError::Io {
            path: relative,
            source: std::io::Error::last_os_error(),
        });
    }
    parent.sync_all().map_err(|source| ToolError::Io {
        path: relative,
        source,
    })?;
    Ok(actual)
}

#[cfg(unix)]
fn secure_rename_beneath(
    root: &File,
    source: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<String, ToolError> {
    use std::os::unix::fs::MetadataExt;

    let source = normalize_relative(source)?;
    let destination = normalize_relative(destination)?;
    let (source_parent, source_name) = secure_parent_beneath(root, &source, false)?;
    let (destination_parent, destination_name) = secure_parent_beneath(root, &destination, true)?;
    let (actual, source_metadata) = secure_file_hash_at(&source_parent, &source_name, &source)?;
    if actual != expected_sha256 {
        return Err(ToolError::PatchPrecondition {
            path: source,
            expected: expected_sha256.to_owned(),
            actual,
        });
    }

    let destination_descriptor = unsafe {
        libc::openat(
            destination_parent.as_raw_fd(),
            destination_name.as_ptr(),
            libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    let case_only_same_inode = if destination_descriptor >= 0 {
        let destination_file = unsafe { File::from_raw_fd(destination_descriptor) };
        let metadata = destination_file
            .metadata()
            .map_err(|source| ToolError::Io {
                path: destination.clone(),
                source,
            })?;
        if metadata.dev() != source_metadata.dev() || metadata.ino() != source_metadata.ino() {
            return Err(ToolError::DestinationExists(destination));
        }
        true
    } else {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            false
        } else if error.raw_os_error() == Some(libc::ELOOP) {
            return Err(ToolError::Symlink(destination));
        } else {
            return Err(ToolError::Io {
                path: destination,
                source: error,
            });
        }
    };

    let result = if case_only_same_inode {
        unsafe {
            libc::renameat(
                source_parent.as_raw_fd(),
                source_name.as_ptr(),
                destination_parent.as_raw_fd(),
                destination_name.as_ptr(),
            )
        }
    } else {
        renameat_noreplace(
            &source_parent,
            &source_name,
            &destination_parent,
            &destination_name,
        )
    };
    if result != 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            return Err(ToolError::DestinationExists(destination));
        }
        return Err(ToolError::Io {
            path: destination,
            source: error,
        });
    }
    source_parent
        .sync_all()
        .map_err(|source_error| ToolError::Io {
            path: source,
            source: source_error,
        })?;
    destination_parent
        .sync_all()
        .map_err(|source| ToolError::Io {
            path: destination,
            source,
        })?;
    Ok(actual)
}

#[cfg(target_os = "macos")]
fn renameat_noreplace(
    source_parent: &File,
    source_name: &CString,
    destination_parent: &File,
    destination_name: &CString,
) -> libc::c_int {
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
    source_name: &CString,
    destination_parent: &File,
    destination_name: &CString,
) -> libc::c_int {
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
    source_name: &CString,
    destination_parent: &File,
    destination_name: &CString,
) -> libc::c_int {
    unsafe {
        libc::renameat(
            source_parent.as_raw_fd(),
            source_name.as_ptr(),
            destination_parent.as_raw_fd(),
            destination_name.as_ptr(),
        )
    }
}

fn sha256_reader(reader: &mut impl Read, path: &Path) -> Result<String, ToolError> {
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer).map_err(|source| ToolError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(not(unix))]
fn reject_symlinks(root: &Path, relative: &Path) -> Result<(), ToolError> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(ToolError::Symlink(relative.to_path_buf()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(source) => {
                return Err(ToolError::Io {
                    path: current,
                    source,
                });
            }
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), ToolError> {
    let parent = path
        .parent()
        .ok_or_else(|| ToolError::PathOutsideScope(path.to_path_buf()))?;
    fs::create_dir_all(parent).map_err(|source| ToolError::Io {
        path: parent.to_path_buf(),
        source,
    })?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|source| ToolError::Io {
        path: parent.to_path_buf(),
        source,
    })?;
    temporary.write_all(bytes).map_err(|source| ToolError::Io {
        path: temporary.path().to_path_buf(),
        source,
    })?;
    if let Ok(metadata) = fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|source| ToolError::Io {
                path: temporary.path().to_path_buf(),
                source,
            })?;
    }
    temporary.persist(path).map_err(|error| ToolError::Io {
        path: path.to_path_buf(),
        source: error.error,
    })?;
    Ok(())
}

#[cfg(not(unix))]
fn collect_regular_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), ToolError> {
    let entries = fs::read_dir(root).map_err(|source| ToolError::Io {
        path: root.to_path_buf(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| ToolError::Io {
            path: root.to_path_buf(),
            source,
        })?;
        let file_type = entry.file_type().map_err(|source| ToolError::Io {
            path: entry.path(),
            source,
        })?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_regular_files(&entry.path(), files)?;
        } else if file_type.is_file() {
            files.push(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
