//! Language-neutral evidence contracts ported from the Foundation Node runtime.
//!
//! Evidence is data, not agent narrative. A passing receipt is useful only while
//! its protocol, contract, provider, inputs, workspace, claims, and artifacts are
//! all current. Final proof copies receipts into an immutable, content-checked run.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

pub mod coverage;
pub mod divergence;
pub mod oracle;

pub use coverage::{
    CoverageDelta, CoverageFormat, CoverageReport, CoverageUnavailable, CoverageVerdict,
    TouchedFileCoverage, TouchedFileStatus, TouchedLines, coverage_delta, parse_coverage_report,
    read_coverage_report,
};
pub use divergence::{
    DeclaredIntent, DifferentialReport, DifferentialUnavailable, Divergence, DivergenceClass,
    DivergenceKind, DivergenceRank, DivergenceRule, SuppressionLedger, SuppressionRule,
    TestHarnessFormat, TestOutcome, TestRun, TestStatus, differential_report, parse_test_outcomes,
};
pub use oracle::{
    ORACLE_RECEIPT_EXTENSION, ORACLE_VERSION, OracleConfidence, OracleSummary, OracleWarning,
    OracleWarningCode, ProveOracleReport, Severity,
};

pub const EVIDENCE_VERSION: u8 = 2;
pub const RECEIPT_VERSION: u8 = 6;
pub const PROOF_VERSION: u8 = 2;
const MAX_EVIDENCE_JSON_BYTES: u64 = 16 * 1024 * 1024;
const MAX_EVIDENCE_IDENTIFIER_BYTES: usize = 256;
pub const MAX_PROOF_RECEIPTS: usize = 1_024;
pub const MAX_PROOF_ARTIFACTS: usize = 10_000;
pub const MAX_RECEIPT_ITEMS: usize = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceClaim {
    pub id: String,
    pub scenario: String,
    #[serde(default)]
    pub impact: Option<String>,
    pub capabilities: BTreeSet<String>,
    #[serde(default)]
    pub repositories: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderContract {
    pub capability: String,
    pub adapter: String,
    #[serde(default = "default_provider_version")]
    pub version: String,
    #[serde(default)]
    pub command: Vec<String>,
    #[serde(default)]
    pub claims: Option<BTreeSet<String>>,
    #[serde(default)]
    pub inputs: Vec<String>,
    #[serde(default)]
    pub depends_on: BTreeSet<String>,
    #[serde(flatten)]
    pub options: BTreeMap<String, Value>,
}

fn default_provider_version() -> String {
    "1".into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceContract {
    pub version: u8,
    pub claims: Vec<EvidenceClaim>,
    #[serde(default)]
    pub invariants: Vec<Value>,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderContract>,
}

impl EvidenceContract {
    pub fn validate(&self, known_capabilities: &BTreeSet<String>) -> Result<(), EvidenceError> {
        if !matches!(self.version, 1 | 2) || self.claims.is_empty() {
            return Err(EvidenceError::InvalidContract(
                "version must be 1 or 2 and at least one claim is required".into(),
            ));
        }
        let mut ids = BTreeSet::new();
        for claim in &self.claims {
            if claim.id.trim().is_empty() || !ids.insert(claim.id.clone()) {
                return Err(EvidenceError::InvalidContract(
                    "claim IDs must be non-empty and unique".into(),
                ));
            }
            if claim.scenario.trim().is_empty() || claim.capabilities.is_empty() {
                return Err(EvidenceError::InvalidContract(format!(
                    "claim '{}' needs a scenario and capabilities",
                    claim.id
                )));
            }
            if let Some(capability) = claim
                .capabilities
                .iter()
                .find(|capability| !known_capabilities.contains(*capability))
            {
                return Err(EvidenceError::InvalidContract(format!(
                    "claim '{}' uses unknown capability '{capability}'",
                    claim.id
                )));
            }
        }
        for (provider, config) in &self.providers {
            if !valid_provider_id(provider) {
                return Err(EvidenceError::InvalidContract(format!(
                    "invalid provider instance id '{provider}'"
                )));
            }
            if !known_capabilities.contains(&config.capability) {
                return Err(EvidenceError::InvalidContract(format!(
                    "provider '{provider}' requires a known capability"
                )));
            }
            if config.adapter != "external"
                && (config.command.is_empty() || config.command.iter().any(|part| part.is_empty()))
            {
                return Err(EvidenceError::InvalidContract(format!(
                    "provider '{provider}' requires a non-empty command"
                )));
            }
            if config.depends_on.contains(provider) {
                return Err(EvidenceError::InvalidContract(format!(
                    "provider '{provider}' cannot depend on itself"
                )));
            }
            if let Some(dependency) = config
                .depends_on
                .iter()
                .find(|dependency| !self.providers.contains_key(*dependency))
            {
                return Err(EvidenceError::InvalidContract(format!(
                    "provider '{provider}' depends on unknown provider '{dependency}'"
                )));
            }
            let declared = self.claims_for_provider(provider)?;
            if let Some(configured) = &config.claims
                && configured != &declared
            {
                return Err(EvidenceError::InvalidContract(format!(
                    "provider '{provider}' must cover every declared claim"
                )));
            }
            for input in &config.inputs {
                ensure_relative(input).map_err(|_| {
                    EvidenceError::InvalidContract(format!(
                        "provider '{provider}' inputs must be workspace-relative"
                    ))
                })?;
            }
        }
        if let Some(issue) = self.topology_issues().first() {
            return Err(EvidenceError::InvalidContract(issue.clone()));
        }
        Ok(())
    }

    pub fn topology_issues(&self) -> Vec<String> {
        fn visit(
            provider: &str,
            providers: &BTreeMap<String, ProviderContract>,
            visiting: &mut BTreeSet<String>,
            visited: &mut BTreeSet<String>,
            trail: &mut Vec<String>,
            issues: &mut Vec<String>,
        ) {
            if visiting.contains(provider) {
                let mut cycle = trail.clone();
                cycle.push(provider.into());
                issues.push(format!("provider dependency cycle: {}", cycle.join(" -> ")));
                return;
            }
            if visited.contains(provider) {
                return;
            }
            let Some(config) = providers.get(provider) else {
                return;
            };
            visiting.insert(provider.into());
            trail.push(provider.into());
            for dependency in &config.depends_on {
                visit(dependency, providers, visiting, visited, trail, issues);
            }
            trail.pop();
            visiting.remove(provider);
            visited.insert(provider.into());
        }
        let mut issues = Vec::new();
        let mut visiting = BTreeSet::new();
        let mut visited = BTreeSet::new();
        for provider in self.providers.keys() {
            visit(
                provider,
                &self.providers,
                &mut visiting,
                &mut visited,
                &mut Vec::new(),
                &mut issues,
            );
        }
        issues.sort();
        issues.dedup();
        issues
    }

    pub fn claims_for_provider(&self, provider: &str) -> Result<BTreeSet<String>, EvidenceError> {
        let config = self
            .providers
            .get(provider)
            .ok_or_else(|| EvidenceError::UnknownProvider(provider.into()))?;
        Ok(self
            .claims
            .iter()
            .filter(|claim| claim.capabilities.contains(&config.capability))
            .map(|claim| claim.id.clone())
            .collect())
    }

    pub fn fingerprint(&self, change: &ChangeContract) -> Result<String, EvidenceError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Fingerprint<'a> {
            intent: &'a str,
            impact: &'a str,
            coupling: &'a str,
            review_required: bool,
            review_policy: &'a Value,
            acceptance: &'a Value,
            claims: &'a [EvidenceClaim],
            invariants: &'a [Value],
        }
        stable_hash(&Fingerprint {
            intent: &change.intent,
            impact: &change.impact,
            coupling: &change.coupling,
            review_required: change.review_required,
            review_policy: &change.review_policy,
            acceptance: &change.acceptance,
            claims: &self.claims,
            invariants: &self.invariants,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeContract {
    pub intent: String,
    pub impact: String,
    pub coupling: String,
    pub review_required: bool,
    #[serde(default)]
    pub review_policy: Value,
    #[serde(default)]
    pub acceptance: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputFile {
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputIdentity {
    pub mode: InputMode,
    pub patterns: Vec<String>,
    pub files: Vec<InputFile>,
    pub fingerprint: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputMode {
    Global,
    Declared,
}

impl InputIdentity {
    pub fn global(workspace_hash: &str) -> Result<Self, EvidenceError> {
        let fingerprint = stable_hash(&serde_json::json!({
            "mode": "global",
            "workspaceHash": workspace_hash
        }))?;
        Ok(Self {
            mode: InputMode::Global,
            patterns: vec![],
            files: vec![],
            fingerprint,
        })
    }

    pub fn declared(
        patterns: Vec<String>,
        mut files: Vec<InputFile>,
    ) -> Result<Self, EvidenceError> {
        let mut patterns: Vec<_> = patterns
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        patterns.sort();
        files.sort_by(|left, right| left.path.cmp(&right.path));
        let fingerprint = stable_hash(&serde_json::json!({
            "mode": "declared",
            "patterns": patterns,
            "files": files
        }))?;
        Ok(Self {
            mode: InputMode::Declared,
            patterns,
            files,
            fingerprint,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRef {
    pub path: String,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub required: bool,
    #[serde(default)]
    pub missing: bool,
    #[serde(default)]
    pub quarantined: bool,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct ArtifactStore {
    project_root: PathBuf,
    vault_root: PathBuf,
}

impl ArtifactStore {
    pub fn new(
        project_root: impl AsRef<Path>,
        vault_root: impl AsRef<Path>,
    ) -> Result<Self, EvidenceError> {
        let project_root = canonical_or_create(project_root.as_ref())?;
        let vault_root = canonical_or_create(vault_root.as_ref())?;
        if !path_inside(&project_root, &vault_root) {
            return Err(EvidenceError::ArtifactEscapesVault);
        }
        Ok(Self {
            project_root,
            vault_root,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ingest(
        &self,
        change_id: &str,
        proof_run_id: &str,
        provider: &str,
        workspace: impl AsRef<Path>,
        source: impl AsRef<Path>,
        kind: &str,
        required: bool,
    ) -> Result<ArtifactRef, EvidenceError> {
        validate_identifier(change_id)?;
        validate_identifier(proof_run_id)?;
        validate_identifier(provider)?;
        let workspace = workspace.as_ref().canonicalize()?;
        let source = source.as_ref();
        let candidate = if source.is_absolute() {
            source.to_path_buf()
        } else {
            workspace.join(source)
        };
        let source_metadata = match fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !required => {
                return Ok(ArtifactRef {
                    path: normalize(source),
                    source_path: None,
                    kind: kind.into(),
                    required,
                    missing: true,
                    quarantined: false,
                    sha256: None,
                    size: None,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(EvidenceError::MissingArtifact(normalize(source)));
            }
            Err(error) => return Err(error.into()),
        };
        if source_metadata.file_type().is_symlink() || !source_metadata.is_file() {
            return Err(EvidenceError::ArtifactNotFile);
        }
        #[cfg(unix)]
        if unix_link_count(&source_metadata) != 1 {
            return Err(EvidenceError::ArtifactNotFile);
        }
        if !candidate.exists() {
            if !required {
                return Ok(ArtifactRef {
                    path: normalize(source),
                    source_path: None,
                    kind: kind.into(),
                    required,
                    missing: true,
                    quarantined: false,
                    sha256: None,
                    size: None,
                });
            }
            return Err(EvidenceError::MissingArtifact(normalize(source)));
        }
        let real_source = candidate.canonicalize()?;
        if !path_inside(&self.project_root, &real_source) && !path_inside(&workspace, &real_source)
        {
            return Err(EvidenceError::ArtifactEscapesWorkspace);
        }
        if !real_source.is_file() {
            return Err(EvidenceError::ArtifactNotFile);
        }
        let safe_name = sanitize_name(
            real_source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("artifact"),
        );
        let provider_root = self
            .vault_root
            .join(change_id)
            .join(proof_run_id)
            .join("artifacts")
            .join(provider);
        create_directory_inside(&self.vault_root, &provider_root)?;
        let temporary = provider_root.join(format!(".artifact.{}.tmp", Uuid::now_v7()));
        let mut source_file = open_regular_nofollow(&real_source, true)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut temporary_file = options.open(&temporary)?;
        let mut digest = Sha256::new();
        let mut size = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        let copy_result = (|| -> Result<(), std::io::Error> {
            loop {
                let read = source_file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                temporary_file.write_all(&buffer[..read])?;
                digest.update(&buffer[..read]);
                size = size.saturating_add(u64::try_from(read).unwrap_or(u64::MAX));
            }
            temporary_file.sync_all()
        })();
        if let Err(error) = copy_result {
            drop(temporary_file);
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
        drop(temporary_file);
        let digest = format!("{:x}", digest.finalize());
        let destination = provider_root.join(format!("{}-{safe_name}", &digest[..12]));
        match fs::hard_link(&temporary, &destination) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let mut existing = open_regular_nofollow(&destination, true)?;
                if digest_reader(&mut existing)? != digest || existing.metadata()?.len() != size {
                    let _ = fs::remove_file(&temporary);
                    return Err(EvidenceError::ArtifactCollision);
                }
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(error.into());
            }
        }
        fs::remove_file(&temporary)?;
        sync_directory(&provider_root)?;
        Ok(ArtifactRef {
            path: relative_normalized(&self.project_root, &destination)?,
            source_path: Some(
                relative_normalized(&workspace, &real_source)
                    .unwrap_or_else(|_| normalize(&real_source)),
            ),
            kind: kind.into(),
            required,
            missing: false,
            quarantined: false,
            sha256: Some(digest),
            size: Some(size),
        })
    }

    pub fn validate(&self, artifact: &ArtifactRef) -> bool {
        if artifact.missing {
            return !artifact.required && artifact.sha256.is_none() && artifact.size.is_none();
        }
        if ensure_relative(&artifact.path).is_err() {
            return false;
        }
        let path = self.project_root.join(&artifact.path);
        let Ok(real) = path.canonicalize() else {
            return false;
        };
        if !path_inside(&self.vault_root, &real) {
            return false;
        }
        let Ok(mut file) = open_regular_nofollow(&path, true) else {
            return false;
        };
        matches!(digest_reader(&mut file), Ok(digest) if artifact.sha256.as_deref() == Some(digest.as_str()))
            && file
                .metadata()
                .map(|meta| Some(meta.len()) == artifact.size)
                .unwrap_or(false)
    }

    fn run_root(&self, change_id: &str, proof_run_id: &str) -> PathBuf {
        self.vault_root.join(change_id).join(proof_run_id)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReceiptStatus {
    Pass,
    Fail,
    Inconclusive,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub source: Option<String>,
    pub recorded_by: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub version: u8,
    pub change_id: String,
    pub provider: String,
    pub provider_version: String,
    pub adapter: String,
    pub adapter_protocol_version: String,
    pub provider_protocol_version: String,
    pub contract_fingerprint: String,
    pub execution_fingerprint: String,
    pub provider_fingerprint: String,
    pub workspace_hash: String,
    pub workspace_snapshot_id: Option<String>,
    pub input_identity: InputIdentity,
    pub claims: BTreeSet<String>,
    pub status: ReceiptStatus,
    pub observed: String,
    pub provenance: Provenance,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    pub proof_run_id: String,
    pub started_at: String,
    pub finished_at: String,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Clone, Debug)]
pub struct ReceiptExpectation {
    pub provider_protocol_version: String,
    pub contract_fingerprint: String,
    pub provider_fingerprint: String,
    pub workspace_hash: String,
    pub input_identity: InputIdentity,
    pub required_claims: BTreeSet<String>,
}

/// Mutable current-receipt index. Finalization copies these records into an
/// immutable proof run; replacing a current receipt never alters prior proof.
#[derive(Clone, Debug)]
pub struct ReceiptStore {
    root: PathBuf,
}

impl ReceiptStore {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, EvidenceError> {
        let root = canonical_or_create(root.as_ref())?;
        Ok(Self { root })
    }

    pub fn record(&self, receipt: &Receipt) -> Result<(), EvidenceError> {
        validate_receipt_integrity(receipt)?;
        validate_identifier(&receipt.change_id)?;
        validate_identifier(&receipt.provider)?;
        let directory = self.root.join(&receipt.change_id);
        let mut bytes = serde_json::to_vec_pretty(receipt)?;
        bytes.push(b'\n');
        enforce_json_size(bytes.len())?;
        create_directory_inside(&self.root, &directory)?;
        let destination = directory.join(format!("{}.json", receipt.provider));
        let temporary = directory.join(format!(".{}.{}.tmp", receipt.provider, Uuid::now_v7()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
        if let Err(error) = fs::rename(&temporary, &destination) {
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
        sync_directory(&directory)?;
        Ok(())
    }

    pub fn load(&self, change_id: &str, provider: &str) -> Result<Option<Receipt>, EvidenceError> {
        validate_identifier(change_id)?;
        validate_identifier(provider)?;
        let directory = self.root.join(change_id);
        let path = directory.join(format!("{provider}.json"));
        let mut file = match open_regular_nofollow(&path, true) {
            Ok(file) => file,
            Err(EvidenceError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        let real_directory = directory.canonicalize()?;
        if !path_inside(&self.root, &real_directory) {
            return Err(EvidenceError::UnsafePath(normalize(directory)));
        }
        let receipt = serde_json::from_slice(&read_limited_json_reader(&mut file)?)?;
        validate_receipt_integrity(&receipt)?;
        if receipt.change_id != change_id || receipt.provider != provider {
            return Err(EvidenceError::InvalidReceipt {
                provider: provider.into(),
                validity: "identity-mismatch".into(),
            });
        }
        Ok(Some(receipt))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReceiptValidity {
    Valid,
    ReusableInputs,
    InvalidReceiptVersion,
    InvalidIdentity,
    ProviderVersionStale,
    ContractStale,
    ProviderFingerprintStale,
    Stale,
    ProviderInputsStale,
    Fail,
    Inconclusive,
    Error,
    IncompleteClaims,
    InvalidArtifacts,
    ExternalObservationMissing,
    ExternalProvenanceMissing,
    ExternalEvidenceMissing,
}

pub fn validate_receipt(
    receipt: &Receipt,
    expected: &ReceiptExpectation,
    artifacts: &ArtifactStore,
) -> ReceiptValidity {
    if receipt.version != RECEIPT_VERSION {
        return ReceiptValidity::InvalidReceiptVersion;
    }
    if validate_receipt_collections(receipt).is_err() {
        return ReceiptValidity::InvalidIdentity;
    }
    if receipt.provider_protocol_version != expected.provider_protocol_version {
        return ReceiptValidity::ProviderVersionStale;
    }
    if receipt.contract_fingerprint != expected.contract_fingerprint {
        return ReceiptValidity::ContractStale;
    }
    if receipt.provider_fingerprint != expected.provider_fingerprint {
        return ReceiptValidity::ProviderFingerprintStale;
    }
    let reusable = if receipt.workspace_hash != expected.workspace_hash {
        receipt.input_identity.mode == InputMode::Declared
            && expected.input_identity.mode == InputMode::Declared
            && receipt.input_identity.fingerprint == expected.input_identity.fingerprint
    } else {
        false
    };
    if receipt.workspace_hash != expected.workspace_hash && !reusable {
        return ReceiptValidity::Stale;
    }
    if validate_input_identity_integrity(receipt).is_err() {
        return ReceiptValidity::ProviderInputsStale;
    }
    if receipt.input_identity.fingerprint != expected.input_identity.fingerprint {
        return ReceiptValidity::ProviderInputsStale;
    }
    match receipt.status {
        ReceiptStatus::Fail => return ReceiptValidity::Fail,
        ReceiptStatus::Inconclusive => return ReceiptValidity::Inconclusive,
        ReceiptStatus::Error => return ReceiptValidity::Error,
        ReceiptStatus::Pass => {}
    }
    if !expected.required_claims.is_subset(&receipt.claims) {
        return ReceiptValidity::IncompleteClaims;
    }
    if receipt
        .artifacts
        .iter()
        .any(|artifact| !artifacts.validate(artifact))
    {
        return ReceiptValidity::InvalidArtifacts;
    }
    if receipt.adapter == "external" {
        if receipt.observed.trim().is_empty() {
            return ReceiptValidity::ExternalObservationMissing;
        }
        if receipt
            .provenance
            .source
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        {
            return ReceiptValidity::ExternalProvenanceMissing;
        }
        if receipt.artifacts.is_empty() && receipt.references.is_empty() {
            return ReceiptValidity::ExternalEvidenceMissing;
        }
    }
    if reusable {
        ReceiptValidity::ReusableInputs
    } else {
        ReceiptValidity::Valid
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReadinessStatus {
    NeedsCodeChange,
    ConfigurationError,
    BlockedByActiveWork,
    InfrastructureError,
    NeedsUserDecision,
    Ready,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReadinessInput {
    pub pending_tasks: Vec<String>,
    pub configuration_issues: Vec<String>,
    pub active_leases: Vec<String>,
    pub unavailable_providers: Vec<String>,
    pub external_providers: Vec<String>,
}

impl ReadinessInput {
    pub fn status(&self) -> ReadinessStatus {
        if !self.pending_tasks.is_empty() {
            ReadinessStatus::NeedsCodeChange
        } else if !self.configuration_issues.is_empty() {
            ReadinessStatus::ConfigurationError
        } else if !self.active_leases.is_empty() {
            ReadinessStatus::BlockedByActiveWork
        } else if !self.unavailable_providers.is_empty() {
            ReadinessStatus::InfrastructureError
        } else if !self.external_providers.is_empty() {
            ReadinessStatus::NeedsUserDecision
        } else {
            ReadinessStatus::Ready
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptManifestEntry {
    pub provider: String,
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofManifest {
    pub version: u8,
    pub proof_protocol_version: String,
    pub change_id: String,
    pub proof_run_id: String,
    pub status: String,
    pub workspace_hash: String,
    pub workspace_snapshot_id: String,
    pub contract_fingerprint: String,
    pub execution_fingerprint: String,
    pub providers: Vec<String>,
    pub receipts: Vec<ReceiptManifestEntry>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProofAudit {
    Valid(Box<ProofManifest>),
    Invalid(String),
}

pub struct ProofFinalizer<'a> {
    store: &'a ArtifactStore,
    proof_protocol_version: String,
}

impl<'a> ProofFinalizer<'a> {
    pub fn new(store: &'a ArtifactStore, proof_protocol_version: impl Into<String>) -> Self {
        Self {
            store,
            proof_protocol_version: proof_protocol_version.into(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn finalize(
        &self,
        change_id: &str,
        proof_run_id: &str,
        workspace_hash: &str,
        workspace_snapshot_id: &str,
        contract_fingerprint: &str,
        execution_fingerprint: &str,
        receipts: &BTreeMap<String, Receipt>,
        expectations: &BTreeMap<String, ReceiptExpectation>,
        proof_artifacts: Vec<ArtifactRef>,
        created_at: &str,
    ) -> Result<ProofManifest, EvidenceError> {
        validate_identifier(change_id)?;
        validate_identifier(proof_run_id)?;
        for provider in receipts.keys().chain(expectations.keys()) {
            validate_identifier(provider)?;
        }
        if receipts.len() > MAX_PROOF_RECEIPTS || expectations.len() > MAX_PROOF_RECEIPTS {
            return Err(EvidenceError::CollectionLimit {
                kind: "proof receipts",
                limit: MAX_PROOF_RECEIPTS,
            });
        }
        if proof_artifacts.len() > MAX_PROOF_ARTIFACTS {
            return Err(EvidenceError::CollectionLimit {
                kind: "proof artifacts",
                limit: MAX_PROOF_ARTIFACTS,
            });
        }
        if receipts.keys().collect::<BTreeSet<_>>() != expectations.keys().collect::<BTreeSet<_>>()
        {
            return Err(EvidenceError::InvalidProofProviderSet);
        }
        let run_root = self.store.run_root(change_id, proof_run_id);
        let manifest_path = run_root.join("manifest.json");
        if manifest_path.exists() {
            return Err(EvidenceError::ImmutableProofRun);
        }
        for (provider, expectation) in expectations {
            let receipt = receipts
                .get(provider)
                .ok_or_else(|| EvidenceError::InvalidReceipt {
                    provider: provider.clone(),
                    validity: "missing".into(),
                })?;
            if receipt.provider != *provider || receipt.change_id != change_id {
                return Err(EvidenceError::InvalidReceipt {
                    provider: provider.clone(),
                    validity: "identity-mismatch".into(),
                });
            }
            if receipt.workspace_hash != workspace_hash
                || receipt.workspace_snapshot_id.as_deref() != Some(workspace_snapshot_id)
                || receipt.contract_fingerprint != contract_fingerprint
                || receipt.execution_fingerprint != execution_fingerprint
            {
                return Err(EvidenceError::InvalidReceipt {
                    provider: provider.clone(),
                    validity: "proof-identity-mismatch".into(),
                });
            }
            let validity = validate_receipt(receipt, expectation, self.store);
            if validity != ReceiptValidity::Valid {
                return Err(EvidenceError::InvalidReceipt {
                    provider: provider.clone(),
                    validity: serde_json::to_value(validity)?
                        .as_str()
                        .unwrap_or("invalid")
                        .into(),
                });
            }
        }
        if proof_artifacts
            .iter()
            .any(|artifact| !self.store.validate(artifact))
        {
            return Err(EvidenceError::InvalidProofArtifact);
        }
        let receipts_root = run_root.join("receipts");
        create_directory_inside(&self.store.vault_root, &receipts_root)?;
        let mut entries = Vec::new();
        for (provider, receipt) in receipts {
            let path = receipts_root.join(format!("{provider}.json"));
            let bytes = serialized_json_bytes(receipt)?;
            entries.push(ReceiptManifestEntry {
                provider: provider.clone(),
                path: relative_normalized(&self.store.project_root, &path)?,
                sha256: hex_digest(&bytes),
                size: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
            });
        }
        let proof = ProofManifest {
            version: PROOF_VERSION,
            proof_protocol_version: self.proof_protocol_version.clone(),
            change_id: change_id.into(),
            proof_run_id: proof_run_id.into(),
            status: "pass".into(),
            workspace_hash: workspace_hash.into(),
            workspace_snapshot_id: workspace_snapshot_id.into(),
            contract_fingerprint: contract_fingerprint.into(),
            execution_fingerprint: execution_fingerprint.into(),
            providers: entries.iter().map(|entry| entry.provider.clone()).collect(),
            receipts: entries,
            artifacts: proof_artifacts,
            created_at: created_at.into(),
        };
        // Validate the complete manifest before publishing any receipt. The
        // manifest is the commit marker, and a failed preflight must leave no
        // half-created immutable run behind.
        serialized_json_bytes(&proof)?;
        let mut written_receipts = Vec::new();
        for (provider, receipt) in receipts {
            let path = receipts_root.join(format!("{provider}.json"));
            if let Err(error) = write_new_json(&path, receipt) {
                for written in &written_receipts {
                    let _ = fs::remove_file(written);
                }
                let _ = sync_directory(&receipts_root);
                return Err(error);
            }
            written_receipts.push(path);
        }
        if let Err(error) = write_new_json(&manifest_path, &proof) {
            for written in &written_receipts {
                let _ = fs::remove_file(written);
            }
            let _ = sync_directory(&receipts_root);
            return Err(error);
        }
        sync_directory(&run_root)?;
        Ok(proof)
    }

    pub fn audit(&self, change_id: &str, proof_run_id: &str) -> ProofAudit {
        if validate_identifier(change_id).is_err() || validate_identifier(proof_run_id).is_err() {
            return ProofAudit::Invalid("unsafe-proof-identity".into());
        }
        let run_root = self.store.run_root(change_id, proof_run_id);
        let manifest_path = run_root.join("manifest.json");
        let Ok(real_run_root) = run_root.canonicalize() else {
            return ProofAudit::Invalid("missing-proof".into());
        };
        if !path_inside(&self.store.vault_root, &real_run_root) {
            return ProofAudit::Invalid("unsafe-proof-path".into());
        }
        let Ok(mut manifest_file) = open_regular_nofollow(&manifest_path, true) else {
            return ProofAudit::Invalid("missing-proof".into());
        };
        let Ok(bytes) = read_limited_json_reader(&mut manifest_file) else {
            return ProofAudit::Invalid("missing-proof".into());
        };
        let Ok(proof) = serde_json::from_slice::<ProofManifest>(&bytes) else {
            return ProofAudit::Invalid("invalid-proof".into());
        };
        if proof.version != PROOF_VERSION
            || proof.change_id != change_id
            || proof.proof_run_id != proof_run_id
        {
            return ProofAudit::Invalid("proof-identity-mismatch".into());
        }
        if proof.receipts.len() > MAX_PROOF_RECEIPTS
            || proof.providers.len() > MAX_PROOF_RECEIPTS
            || proof.artifacts.len() > MAX_PROOF_ARTIFACTS
        {
            return ProofAudit::Invalid("proof-collection-limit".into());
        }
        if proof.status != "pass" {
            return ProofAudit::Invalid("missing-proof".into());
        }
        if proof.proof_protocol_version != self.proof_protocol_version {
            return ProofAudit::Invalid("proof-version-stale".into());
        }
        if proof.receipts.is_empty() {
            return ProofAudit::Invalid("missing-receipt-manifest".into());
        }
        let entry_providers = proof
            .receipts
            .iter()
            .map(|entry| entry.provider.clone())
            .collect::<Vec<_>>();
        let unique_providers = entry_providers.iter().collect::<BTreeSet<_>>();
        if proof.providers != entry_providers
            || unique_providers.len() != entry_providers.len()
            || entry_providers
                .iter()
                .any(|provider| validate_identifier(provider).is_err())
        {
            return ProofAudit::Invalid("proof-provider-manifest-mismatch".into());
        }
        for entry in &proof.receipts {
            let path = self.store.project_root.join(&entry.path);
            let expected_path = run_root
                .join("receipts")
                .join(format!("{}.json", entry.provider));
            if path != expected_path {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            }
            let Ok(real) = path.canonicalize() else {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            };
            if !path_inside(&run_root, &real) {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            }
            let Ok(mut receipt_file) = open_regular_nofollow(&path, true) else {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            };
            if digest_reader(&mut receipt_file).ok().as_deref() != Some(&entry.sha256)
                || receipt_file.metadata().map(|m| m.len()).ok() != Some(entry.size)
            {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            }
            let Ok(mut receipt_file) = open_regular_nofollow(&path, true) else {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            };
            let Ok(receipt_bytes) = read_limited_json_reader(&mut receipt_file) else {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            };
            let Ok(receipt) = serde_json::from_slice::<Receipt>(&receipt_bytes) else {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            };
            if validate_receipt_integrity(&receipt).is_err()
                || receipt.version != RECEIPT_VERSION
                || receipt.provider != entry.provider
                || receipt.change_id != proof.change_id
                || receipt.workspace_hash != proof.workspace_hash
                || receipt.workspace_snapshot_id.as_deref()
                    != Some(proof.workspace_snapshot_id.as_str())
                || receipt.contract_fingerprint != proof.contract_fingerprint
                || receipt.execution_fingerprint != proof.execution_fingerprint
            {
                return ProofAudit::Invalid(format!("receipt-tampered:{}", entry.provider));
            }
            if receipt
                .artifacts
                .iter()
                .any(|artifact| !self.store.validate(artifact))
            {
                return ProofAudit::Invalid(format!("artifact-tampered:{}", entry.provider));
            }
        }
        if proof
            .artifacts
            .iter()
            .any(|artifact| !self.store.validate(artifact))
        {
            return ProofAudit::Invalid("proof-artifact-tampered".into());
        }
        ProofAudit::Valid(Box::new(proof))
    }
}

pub fn stable_hash<T: Serialize>(value: &T) -> Result<String, EvidenceError> {
    let bytes = serde_json::to_vec(value)?;
    Ok(hex_digest(&bytes))
}

pub fn file_digest(path: impl AsRef<Path>) -> Result<String, EvidenceError> {
    let mut file = File::open(path)?;
    digest_reader(&mut file)
}

fn digest_reader(file: &mut File) -> Result<String, EvidenceError> {
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(crate) fn read_limited_json_reader(file: &mut File) -> Result<Vec<u8>, EvidenceError> {
    let mut bytes = Vec::new();
    file.take(MAX_EVIDENCE_JSON_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_EVIDENCE_JSON_BYTES {
        return Err(EvidenceError::JsonTooLarge {
            limit: MAX_EVIDENCE_JSON_BYTES,
        });
    }
    Ok(bytes)
}

fn validate_receipt_collections(receipt: &Receipt) -> Result<(), EvidenceError> {
    for (kind, count) in [
        ("receipt claims", receipt.claims.len()),
        ("receipt references", receipt.references.len()),
        ("receipt artifacts", receipt.artifacts.len()),
        ("receipt input files", receipt.input_identity.files.len()),
        (
            "receipt input patterns",
            receipt.input_identity.patterns.len(),
        ),
        ("receipt extensions", receipt.extensions.len()),
    ] {
        if count > MAX_RECEIPT_ITEMS {
            return Err(EvidenceError::CollectionLimit {
                kind,
                limit: MAX_RECEIPT_ITEMS,
            });
        }
    }
    Ok(())
}

fn validate_receipt_integrity(receipt: &Receipt) -> Result<(), EvidenceError> {
    validate_receipt_collections(receipt)?;
    if receipt.version != RECEIPT_VERSION {
        return Err(EvidenceError::InvalidReceipt {
            provider: receipt.provider.clone(),
            validity: "unsupported-version".into(),
        });
    }
    validate_identifier(&receipt.change_id)?;
    validate_identifier(&receipt.provider)?;
    validate_identifier(&receipt.proof_run_id)?;
    if [
        receipt.provider_version.as_str(),
        receipt.adapter.as_str(),
        receipt.adapter_protocol_version.as_str(),
        receipt.provider_protocol_version.as_str(),
        receipt.contract_fingerprint.as_str(),
        receipt.execution_fingerprint.as_str(),
        receipt.provider_fingerprint.as_str(),
        receipt.workspace_hash.as_str(),
        receipt.started_at.as_str(),
        receipt.finished_at.as_str(),
    ]
    .iter()
    .any(|value| value.trim().is_empty())
    {
        return Err(EvidenceError::InvalidReceipt {
            provider: receipt.provider.clone(),
            validity: "missing-identity-field".into(),
        });
    }
    validate_input_identity_integrity(receipt)?;
    for artifact in &receipt.artifacts {
        if artifact.missing
            && (artifact.required || artifact.sha256.is_some() || artifact.size.is_some())
            || !artifact.missing
                && (artifact.sha256.as_deref().is_none_or(str::is_empty)
                    || artifact.size.is_none()
                    || ensure_relative(&artifact.path).is_err())
        {
            return Err(EvidenceError::InvalidReceipt {
                provider: receipt.provider.clone(),
                validity: "invalid-artifact-reference".into(),
            });
        }
    }
    Ok(())
}

fn validate_input_identity_integrity(receipt: &Receipt) -> Result<(), EvidenceError> {
    let canonical_identity = match receipt.input_identity.mode {
        InputMode::Global => {
            if !receipt.input_identity.patterns.is_empty()
                || !receipt.input_identity.files.is_empty()
            {
                return Err(EvidenceError::InvalidReceipt {
                    provider: receipt.provider.clone(),
                    validity: "invalid-global-inputs".into(),
                });
            }
            InputIdentity::global(&receipt.workspace_hash)?
        }
        InputMode::Declared => {
            for pattern in &receipt.input_identity.patterns {
                ensure_relative(pattern)?;
            }
            let mut paths = BTreeSet::new();
            for file in &receipt.input_identity.files {
                ensure_relative(&file.path)?;
                if file.sha256.trim().is_empty() || !paths.insert(file.path.clone()) {
                    return Err(EvidenceError::InvalidReceipt {
                        provider: receipt.provider.clone(),
                        validity: "invalid-declared-inputs".into(),
                    });
                }
            }
            InputIdentity::declared(
                receipt.input_identity.patterns.clone(),
                receipt.input_identity.files.clone(),
            )?
        }
    };
    if canonical_identity != receipt.input_identity {
        return Err(EvidenceError::InvalidReceipt {
            provider: receipt.provider.clone(),
            validity: "input-fingerprint-mismatch".into(),
        });
    }
    Ok(())
}

pub fn provider_fingerprint(value: &Value) -> Result<String, EvidenceError> {
    stable_hash(value)
}

pub fn execution_fingerprint(
    adapter_protocol_version: &str,
    providers: &BTreeMap<String, ProviderContract>,
    services: &BTreeMap<String, Value>,
) -> Result<String, EvidenceError> {
    stable_hash(&serde_json::json!({
        "adapterProtocolVersion": adapter_protocol_version,
        "providers": providers,
        "services": services
    }))
}

/// Parse provider JSON output exactly as the Node runtime: blank or malformed is unknown.
pub fn parse_json_output(value: &str) -> Option<Value> {
    let text = value.trim();
    if text.is_empty() {
        None
    } else {
        serde_json::from_str(text).ok()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TapSummary {
    pub total_tests: u64,
    pub passed: Option<u64>,
    pub failed: Option<u64>,
    pub format: String,
}

pub fn parse_tap_output(value: &str) -> Option<TapSummary> {
    if !value.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with("TAP version")
            || line.starts_with("ok ")
            || line == "ok"
            || line.starts_with("not ok")
    }) {
        return None;
    }
    let mut tests = None;
    let mut passed = None;
    let mut failed = None;
    let mut plan = None;
    for line in value.lines() {
        let line = line.trim();
        if let Some(number) = line.strip_prefix("# tests ") {
            tests = number.trim().parse().ok();
        }
        if let Some(number) = line.strip_prefix("# pass ") {
            passed = number.trim().parse().ok();
        }
        if let Some(number) = line.strip_prefix("# fail ") {
            failed = number.trim().parse().ok();
        }
        if let Some(number) = line.strip_prefix("1..") {
            plan = number.trim().parse().ok();
        }
    }
    Some(TapSummary {
        total_tests: tests.or(plan)?,
        passed,
        failed,
        format: "tap".into(),
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationResult {
    BehavioralKill,
    TestFailure,
    Survived,
    Crash,
    Timeout,
    NotApplied,
}

pub fn mutation_protocol_result(value: &str) -> Option<MutationResult> {
    for line in value.lines() {
        if let Some(result) = line.strip_prefix("FOUNDATION_MUTATION_RESULT=")
            && let Some(result) = parse_mutation_result(result)
        {
            return Some(result);
        }
    }
    let parsed = parse_json_output(value)?;
    parse_mutation_result(
        parsed
            .get("foundationMutationResult")
            .or_else(|| parsed.get("mutationResult"))?
            .as_str()?,
    )
}

fn parse_mutation_result(value: &str) -> Option<MutationResult> {
    match value {
        "behavioral-kill" => Some(MutationResult::BehavioralKill),
        "test-failure" => Some(MutationResult::TestFailure),
        "survived" => Some(MutationResult::Survived),
        "crash" => Some(MutationResult::Crash),
        "timeout" => Some(MutationResult::Timeout),
        "not-applied" => Some(MutationResult::NotApplied),
        _ => None,
    }
}

pub fn numeric_report_value(report: &Value, keys: &[&str]) -> Option<u64> {
    let object = report.as_object()?;
    for container in [
        Some(object),
        object.get("summary").and_then(Value::as_object),
        object.get("stats").and_then(Value::as_object),
    ]
    .into_iter()
    .flatten()
    {
        for key in keys {
            if let Some(number) = container.get(*key).and_then(Value::as_u64) {
                return Some(number);
            }
        }
    }
    None
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaywrightSummary {
    pub claims: Vec<String>,
    pub attachments: Vec<String>,
    pub tests: u64,
    pub failed: u64,
    pub skipped: u64,
}

pub fn playwright_report_summary(report: &Value) -> PlaywrightSummary {
    fn visit(
        value: &Value,
        summary: &mut PlaywrightSummary,
        claims: &mut BTreeSet<String>,
        attachments: &mut BTreeSet<String>,
    ) {
        let Some(object) = value.as_object() else {
            if let Some(values) = value.as_array() {
                for value in values {
                    visit(value, summary, claims, attachments);
                }
            }
            return;
        };
        if let Some(values) = object.get("annotations").and_then(Value::as_array) {
            for annotation in values {
                if annotation.get("type").and_then(Value::as_str) == Some("claim")
                    && let Some(description) = annotation.get("description").and_then(Value::as_str)
                {
                    claims.insert(description.into());
                }
            }
        }
        if let Some(values) = object.get("attachments").and_then(Value::as_array) {
            for attachment in values {
                if let Some(path) = attachment.get("path").and_then(Value::as_str) {
                    attachments.insert(path.into());
                }
            }
        }
        if let Some(results) = object.get("results").and_then(Value::as_array) {
            summary.tests += 1;
            let statuses: Vec<_> = results
                .iter()
                .filter_map(|result| result.get("status").and_then(Value::as_str))
                .collect();
            if statuses
                .iter()
                .any(|status| matches!(*status, "failed" | "timedOut" | "interrupted"))
            {
                summary.failed += 1;
            } else if !statuses.is_empty() && statuses.iter().all(|status| *status == "skipped") {
                summary.skipped += 1;
            }
        }
        for child in object.values() {
            visit(child, summary, claims, attachments);
        }
    }
    let mut summary = PlaywrightSummary::default();
    let mut claims = BTreeSet::new();
    let mut attachments = BTreeSet::new();
    visit(report, &mut summary, &mut claims, &mut attachments);
    summary.claims = claims.into_iter().collect();
    summary.attachments = attachments.into_iter().collect();
    summary
}

fn hex_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn valid_provider_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_EVIDENCE_IDENTIFIER_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn ensure_relative(value: &str) -> Result<(), EvidenceError> {
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(EvidenceError::UnsafePath(value.into()));
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), EvidenceError> {
    if valid_provider_id(value) {
        Ok(())
    } else {
        Err(EvidenceError::UnsafePath(value.into()))
    }
}

fn canonical_or_create(path: &Path) -> Result<PathBuf, EvidenceError> {
    fs::create_dir_all(path)?;
    Ok(path.canonicalize()?)
}

fn create_directory_inside(root: &Path, target: &Path) -> Result<(), EvidenceError> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| EvidenceError::UnsafePath(normalize(target)))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(EvidenceError::UnsafePath(normalize(target)));
        };
        current.push(component);
        match fs::create_dir(&current) {
            Ok(()) => {
                if let Some(parent) = current.parent() {
                    sync_directory(parent)?;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(EvidenceError::UnsafePath(normalize(&current)));
        }
        let canonical = current.canonicalize()?;
        if !path_inside(root, &canonical) {
            return Err(EvidenceError::UnsafePath(normalize(&current)));
        }
    }
    Ok(())
}

pub(crate) fn open_regular_nofollow(
    path: &Path,
    reject_hardlinks: bool,
) -> Result<File, EvidenceError> {
    let before = fs::symlink_metadata(path)?;
    if before.file_type().is_symlink() || !before.is_file() {
        return Err(EvidenceError::UnsafePath(normalize(path)));
    }
    #[cfg(unix)]
    if reject_hardlinks && unix_link_count(&before) != 1 {
        return Err(EvidenceError::UnsafePath(normalize(path)));
    }
    let file = File::open(path)?;
    let after = file.metadata()?;
    if !after.is_file() {
        return Err(EvidenceError::UnsafePath(normalize(path)));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev()
            || before.ino() != after.ino()
            || reject_hardlinks && after.nlink() != 1
        {
            return Err(EvidenceError::UnsafePath(normalize(path)));
        }
    }
    Ok(file)
}

#[cfg(unix)]
fn unix_link_count(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.nlink()
}

fn sync_directory(path: &Path) -> Result<(), EvidenceError> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    Ok(())
}

fn path_inside(parent: &Path, candidate: &Path) -> bool {
    candidate == parent || candidate.starts_with(parent)
}

fn relative_normalized(parent: &Path, path: &Path) -> Result<String, EvidenceError> {
    Ok(path
        .strip_prefix(parent)
        .map_err(|_| EvidenceError::UnsafePath(normalize(path)))?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn normalize(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().replace('\\', "/")
}

fn sanitize_name(value: &str) -> String {
    let result: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '-'
            }
        })
        .collect();
    if result.is_empty() {
        "artifact".into()
    } else {
        result
    }
}

fn write_new_json(path: &Path, value: &impl Serialize) -> Result<(), EvidenceError> {
    let bytes = serialized_json_bytes(value)?;
    let parent = path
        .parent()
        .ok_or_else(|| EvidenceError::UnsafePath(normalize(path)))?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(EvidenceError::UnsafePath(normalize(parent)));
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            EvidenceError::ImmutableProofRun
        } else {
            EvidenceError::Io(error)
        }
    })?;
    if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    sync_directory(parent)?;
    Ok(())
}

fn serialized_json_bytes(value: &impl Serialize) -> Result<Vec<u8>, EvidenceError> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    enforce_json_size(bytes.len())?;
    Ok(bytes)
}

fn enforce_json_size(length: usize) -> Result<(), EvidenceError> {
    if u64::try_from(length).unwrap_or(u64::MAX) > MAX_EVIDENCE_JSON_BYTES {
        Err(EvidenceError::JsonTooLarge {
            limit: MAX_EVIDENCE_JSON_BYTES,
        })
    } else {
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum EvidenceError {
    #[error("invalid evidence contract: {0}")]
    InvalidContract(String),
    #[error("unknown provider '{0}'")]
    UnknownProvider(String),
    #[error("unsafe path: {0}")]
    UnsafePath(String),
    #[error("required artifact is missing: {0}")]
    MissingArtifact(String),
    #[error("artifact escapes the project workspace")]
    ArtifactEscapesWorkspace,
    #[error("artifact vault must be contained by the project")]
    ArtifactEscapesVault,
    #[error("artifact is not a regular file")]
    ArtifactNotFile,
    #[error("artifact destination collides with different content")]
    ArtifactCollision,
    #[error("provider '{provider}' has invalid receipt: {validity}")]
    InvalidReceipt { provider: String, validity: String },
    #[error("proof artifact is invalid")]
    InvalidProofArtifact,
    #[error("proof providers and expectations must match exactly")]
    InvalidProofProviderSet,
    #[error("proof run is immutable")]
    ImmutableProofRun,
    #[error("evidence JSON exceeds the safe {limit}-byte limit")]
    JsonTooLarge { limit: u64 },
    #[error("{kind} exceeds the safe {limit}-item limit")]
    CollectionLimit { kind: &'static str, limit: usize },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Generate a collision-resistant proof run ID without granting lifecycle authority.
pub fn new_proof_run_id() -> String {
    format!("proof-{}", Uuid::now_v7())
}
