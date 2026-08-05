//! Deterministic convergence from a confirmed change to an explicit Land.
//! Agent prose is audit context only; typed evidence and authority drive state.

use std::collections::{BTreeMap, BTreeSet};

use changeloop_protocol::OperationId;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

const MAX_ID_BYTES: usize = 512;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_REQUIREMENTS: usize = 1_024;
const MAX_HISTORY_RECORDS: usize = 10_000;
const MAX_REVIEW_FINDINGS: usize = 1_024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecyclePhase {
    Change,
    Build,
    Prove,
    Repair,
    Diagnosis,
    Review,
    ReadyToLand,
    Landing,
    Landed,
    Paused(PauseReason),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PauseReason {
    Infrastructure,
    AuthorityRequired,
    ConfigDecisionRequired,
    RepairBudgetExhausted,
    DoomLoopPermissionRequired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskTrigger {
    AuthenticationAuthorization,
    PublicApiCompatibility,
    MigrationPersistentData,
    Concurrency,
    IrreversibleAction,
    SecurityBoundary,
    MultiRepositoryContract,
    AnomalousEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofRequirement {
    pub claim_id: String,
    pub provider: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofReceipt {
    pub receipt_id: String,
    pub provider: String,
    pub claims: BTreeSet<String>,
    pub workspace_revision: String,
    pub evidence_hash: String,
    pub completed_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StaleReason {
    Repair,
    RequirementChange,
    ReviewFinding,
    WorkspaceRevisionMismatch,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", content = "reason")]
pub enum Freshness {
    Fresh,
    Stale(StaleReason),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofRecord {
    pub receipt: ProofReceipt,
    pub freshness: Freshness,
    pub fresh_for_revision: String,
    pub reused_from_revision: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureClass {
    Code,
    Config,
    Infrastructure,
    AuthorityRequired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofFailure {
    pub provider: String,
    pub cause_id: String,
    pub class: FailureClass,
    pub summary: String,
    pub observed_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairBudget {
    pub max_operations: u16,
    pub non_progress_limit: u16,
}

impl Default for RepairBudget {
    fn default() -> Self {
        Self {
            max_operations: 6,
            non_progress_limit: 2,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepairStatus {
    Running,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairOperation {
    pub operation_id: OperationId,
    pub cause_id: String,
    pub failed_provider: String,
    pub ordinal: u16,
    pub status: RepairStatus,
    pub before_revision: String,
    pub after_revision: Option<String>,
    pub progress_fingerprint: Option<String>,
    pub invalidated_providers: BTreeSet<String>,
}

/// Typed result returned by the implementation worker after one bounded repair.
/// The driver must compute the revision and fingerprint from observed workspace
/// state; narrative model output is deliberately insufficient.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    pub workspace_revision: String,
    pub progress_fingerprint: String,
    pub invalidated_providers: BTreeSet<String>,
}

/// Executes proof and repair operations. Implementations are responsible for
/// attaching real provider processes; the harness only advances from typed
/// receipts and observed repair results.
pub trait ConvergenceDriver {
    fn prove(
        &mut self,
        provider: &str,
        workspace_revision: &str,
    ) -> Result<ProofReceipt, ProofFailure>;

    fn repair(
        &mut self,
        operation: &RepairOperation,
        failure: &ProofFailure,
    ) -> Result<RepairResult, String>;

    fn diagnose(&mut self, cause_id: &str, failures: &[ProofFailure]) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingState {
    Verified,
    Hypothesis,
    Disproved,
    AcceptedRisk,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedRiskAuthority {
    pub authority_id: String,
    pub actor: String,
    pub rationale: String,
    pub accepted_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFinding {
    pub state: FindingState,
    pub summary: String,
    pub blocking: bool,
    pub reproduction_evidence: Vec<String>,
    pub affected_providers: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_risk_authority: Option<AcceptedRiskAuthority>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewContext {
    pub reviewer_session_id: String,
    pub implementation_session_id: String,
    pub clean_context: bool,
    pub reviewer_model_family: String,
    pub implementation_model_family: String,
    pub independent_model_family_required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAttempt {
    pub attempt_id: String,
    pub context: ReviewContext,
    pub findings: Vec<ReviewFinding>,
    pub completed_at_ms: u64,
    pub passed: bool,
    #[serde(default)]
    pub workspace_revision: String,
    #[serde(default)]
    pub risk_triggers: BTreeSet<RiskTrigger>,
}

/// Minimal packet allowed into a clean reviewer session. It intentionally does
/// not contain implementation chat or model reasoning history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanReviewRequest {
    pub reviewer_session_id: String,
    pub implementation_session_id: String,
    pub diff_artifact: String,
    pub agreement_artifact: String,
    pub evidence_artifacts: Vec<String>,
    pub residual_risks: Vec<String>,
    pub risk_triggers: BTreeSet<RiskTrigger>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanReviewResult {
    pub reviewer_model_family: String,
    pub findings: Vec<ReviewFinding>,
    pub completed_at_ms: u64,
}

/// A real reviewer adapter creates a separate child/provider session and
/// returns typed findings. There is no default or synthetic pass implementation.
pub trait IndependentReviewer {
    fn review(&mut self, request: &CleanReviewRequest) -> Result<CleanReviewResult, String>;
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandAuthority {
    pub authority_id: String,
    pub actor: String,
    pub expected_revision: String,
    pub explicit: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandTransaction {
    pub transaction_id: OperationId,
    pub change_id: String,
    pub expected_revision: String,
    pub authority_id: String,
    pub authority_actor: String,
    pub authority_explicit: bool,
    pub exclusive_project_lock_required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeRecord {
    pub text: String,
    pub recorded_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type", content = "data")]
pub enum TransitionEffect {
    BuildRequired,
    ProofRequired { providers: BTreeSet<String> },
    RepairStarted { operation_id: OperationId },
    FocusedDiagnosisRequired { cause_id: String },
    ConfigDecisionRequired,
    InfrastructurePaused,
    AuthorityRequired,
    DoomLoopPermissionRequired,
    RepairBudgetExhausted,
    IndependentReviewRequired { triggers: BTreeSet<RiskTrigger> },
    ReadyToLand,
    LandTransactionPrepared { transaction_id: OperationId },
    Landed,
    NarrativeRecorded,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvergenceHarness {
    change_id: String,
    implementation_session_id: String,
    phase: LifecyclePhase,
    workspace_revision: String,
    requirements: BTreeSet<ProofRequirement>,
    proofs: BTreeMap<String, ProofRecord>,
    failures: Vec<ProofFailure>,
    cause_counts: BTreeMap<String, u16>,
    repairs: Vec<RepairOperation>,
    repair_budget: RepairBudget,
    last_progress_fingerprint: Option<String>,
    consecutive_non_progress: u16,
    risk_triggers: BTreeSet<RiskTrigger>,
    review_attempts: Vec<ReviewAttempt>,
    narratives: Vec<NarrativeRecord>,
    land_transaction: Option<LandTransaction>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConvergenceHarnessWire {
    change_id: String,
    implementation_session_id: String,
    phase: LifecyclePhase,
    workspace_revision: String,
    requirements: BTreeSet<ProofRequirement>,
    proofs: BTreeMap<String, ProofRecord>,
    failures: Vec<ProofFailure>,
    cause_counts: BTreeMap<String, u16>,
    repairs: Vec<RepairOperation>,
    repair_budget: RepairBudget,
    last_progress_fingerprint: Option<String>,
    consecutive_non_progress: u16,
    risk_triggers: BTreeSet<RiskTrigger>,
    review_attempts: Vec<ReviewAttempt>,
    narratives: Vec<NarrativeRecord>,
    land_transaction: Option<LandTransaction>,
}

impl<'de> Deserialize<'de> for ConvergenceHarness {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = ConvergenceHarnessWire::deserialize(deserializer)?;
        let state = Self {
            change_id: wire.change_id,
            implementation_session_id: wire.implementation_session_id,
            phase: wire.phase,
            workspace_revision: wire.workspace_revision,
            requirements: wire.requirements,
            proofs: wire.proofs,
            failures: wire.failures,
            cause_counts: wire.cause_counts,
            repairs: wire.repairs,
            repair_budget: wire.repair_budget,
            last_progress_fingerprint: wire.last_progress_fingerprint,
            consecutive_non_progress: wire.consecutive_non_progress,
            risk_triggers: wire.risk_triggers,
            review_attempts: wire.review_attempts,
            narratives: wire.narratives,
            land_transaction: wire.land_transaction,
        };
        state
            .validate_restored()
            .map_err(serde::de::Error::custom)?;
        Ok(state)
    }
}

impl ConvergenceHarness {
    pub fn new_confirmed(
        change_id: impl Into<String>,
        implementation_session_id: impl Into<String>,
        workspace_revision: impl Into<String>,
        requirements: BTreeSet<ProofRequirement>,
        risk_triggers: BTreeSet<RiskTrigger>,
        repair_budget: RepairBudget,
    ) -> Result<Self, HarnessError> {
        let change_id = change_id.into();
        let implementation_session_id = implementation_session_id.into();
        let workspace_revision = workspace_revision.into();
        if requirements.is_empty()
            || requirements.len() > MAX_REQUIREMENTS
            || repair_budget.max_operations == 0
            || repair_budget.max_operations > 100
            || repair_budget.non_progress_limit == 0
            || repair_budget.non_progress_limit > 100
            || !bounded_identity(&change_id)
            || !bounded_identity(&implementation_session_id)
            || !bounded_identity(&workspace_revision)
            || requirements.iter().any(|requirement| {
                !bounded_identity(&requirement.claim_id) || !bounded_identity(&requirement.provider)
            })
        {
            return Err(HarnessError::InvalidConfiguration);
        }
        Ok(Self {
            change_id,
            implementation_session_id,
            phase: LifecyclePhase::Build,
            workspace_revision,
            requirements,
            proofs: BTreeMap::new(),
            failures: Vec::new(),
            cause_counts: BTreeMap::new(),
            repairs: Vec::new(),
            repair_budget,
            last_progress_fingerprint: None,
            consecutive_non_progress: 0,
            risk_triggers,
            review_attempts: Vec::new(),
            narratives: Vec::new(),
            land_transaction: None,
        })
    }

    #[must_use]
    pub fn phase(&self) -> &LifecyclePhase {
        &self.phase
    }

    #[must_use]
    pub fn proof_records(&self) -> &BTreeMap<String, ProofRecord> {
        &self.proofs
    }

    #[must_use]
    pub fn repair_history(&self) -> &[RepairOperation] {
        &self.repairs
    }

    #[must_use]
    pub fn failure_history(&self) -> &[ProofFailure] {
        &self.failures
    }

    #[must_use]
    pub fn review_attempt_history(&self) -> &[ReviewAttempt] {
        &self.review_attempts
    }

    pub fn risk_triggers(&self) -> &BTreeSet<RiskTrigger> {
        &self.risk_triggers
    }

    /// Validate authority-bearing state after deserialization. Persistence is
    /// an audit/recovery mechanism, never a way to bypass lifecycle methods.
    pub fn validate_restored(&self) -> Result<(), HarnessError> {
        if self.requirements.is_empty()
            || self.requirements.len() > MAX_REQUIREMENTS
            || self.proofs.len() > MAX_REQUIREMENTS
            || self.failures.len() > MAX_HISTORY_RECORDS
            || self.repairs.len() > MAX_HISTORY_RECORDS
            || self.review_attempts.len() > MAX_HISTORY_RECORDS
            || self.narratives.len() > MAX_HISTORY_RECORDS
            || self.repair_budget.max_operations == 0
            || self.repair_budget.max_operations > 100
            || self.repair_budget.non_progress_limit == 0
            || self.repair_budget.non_progress_limit > 100
            || self.repairs.len() > usize::from(self.repair_budget.max_operations)
            || !bounded_identity(&self.change_id)
            || !bounded_identity(&self.implementation_session_id)
            || !bounded_identity(&self.workspace_revision)
            || self.requirements.iter().any(|requirement| {
                !bounded_identity(&requirement.claim_id) || !bounded_identity(&requirement.provider)
            })
        {
            return Err(HarnessError::InvalidRestoredState(
                "invalid bounds or identity",
            ));
        }
        let required_providers = self
            .requirements
            .iter()
            .map(|requirement| requirement.provider.as_str())
            .collect::<BTreeSet<_>>();
        if self.proofs.iter().any(|(provider, proof)| {
            let expected_claims = self
                .requirements
                .iter()
                .filter(|requirement| requirement.provider == *provider)
                .map(|requirement| &requirement.claim_id)
                .collect::<BTreeSet<_>>();
            provider != &proof.receipt.provider
                || !required_providers.contains(provider.as_str())
                || !bounded_identity(&proof.receipt.receipt_id)
                || !bounded_identity(&proof.receipt.provider)
                || !bounded_identity(&proof.receipt.workspace_revision)
                || proof.receipt.completed_at_ms == 0
                || proof.receipt.claims.len() > MAX_REQUIREMENTS
                || proof
                    .receipt
                    .claims
                    .iter()
                    .any(|claim| !bounded_identity(claim))
                || !expected_claims
                    .iter()
                    .all(|claim| proof.receipt.claims.contains(*claim))
                || proof.receipt.evidence_hash.is_empty()
                || proof.receipt.evidence_hash.len() > MAX_ID_BYTES
                || proof.receipt.evidence_hash.chars().any(char::is_control)
                || !bounded_identity(&proof.fresh_for_revision)
                || proof
                    .reused_from_revision
                    .as_ref()
                    .is_some_and(|revision| !bounded_identity(revision))
        }) {
            return Err(HarnessError::InvalidRestoredState("invalid proof record"));
        }
        if self.failures.iter().any(|failure| {
            !bounded_identity(&failure.provider)
                || !bounded_identity(&failure.cause_id)
                || failure.summary.len() > MAX_TEXT_BYTES
                || failure.observed_at_ms == 0
        }) {
            return Err(HarnessError::InvalidRestoredState(
                "invalid failure history",
            ));
        }
        let mut expected_cause_counts = BTreeMap::<String, u16>::new();
        for failure in &self.failures {
            let count = expected_cause_counts
                .entry(failure.cause_id.clone())
                .or_default();
            *count = count.saturating_add(1);
        }
        if self.cause_counts != expected_cause_counts {
            return Err(HarnessError::InvalidRestoredState(
                "failure counts mismatch",
            ));
        }
        let mut repair_ids = BTreeSet::new();
        if self.repairs.iter().enumerate().any(|(index, repair)| {
            repair.ordinal != u16::try_from(index + 1).unwrap_or(u16::MAX)
                || !repair_ids.insert(repair.operation_id.to_string())
                || !bounded_identity(&repair.cause_id)
                || !bounded_identity(&repair.failed_provider)
                || !required_providers.contains(repair.failed_provider.as_str())
                || !self.failures.iter().any(|failure| {
                    failure.cause_id == repair.cause_id
                        && failure.provider == repair.failed_provider
                })
                || !bounded_identity(&repair.before_revision)
                || repair
                    .after_revision
                    .as_ref()
                    .is_some_and(|revision| !bounded_identity(revision))
                || repair
                    .progress_fingerprint
                    .as_ref()
                    .is_some_and(|fingerprint| !bounded_identity(fingerprint))
                || repair.invalidated_providers.iter().any(|provider| {
                    !bounded_identity(provider) || !required_providers.contains(provider.as_str())
                })
                || (repair.status == RepairStatus::Running
                    && (repair.after_revision.is_some()
                        || repair.progress_fingerprint.is_some()
                        || !repair.invalidated_providers.is_empty()))
                || (repair.status == RepairStatus::Completed
                    && (repair.after_revision.is_none()
                        || repair.progress_fingerprint.is_none()
                        || !repair
                            .invalidated_providers
                            .contains(&repair.failed_provider)))
        }) {
            return Err(HarnessError::InvalidRestoredState("invalid repair history"));
        }
        let running_repairs = self
            .repairs
            .iter()
            .filter(|repair| repair.status == RepairStatus::Running)
            .count();
        if (self.phase == LifecyclePhase::Repair && running_repairs != 1)
            || (self.phase != LifecyclePhase::Repair && running_repairs != 0)
        {
            return Err(HarnessError::InvalidRestoredState("repair phase mismatch"));
        }
        let completed_fingerprints = self
            .repairs
            .iter()
            .filter(|repair| repair.status == RepairStatus::Completed)
            .filter_map(|repair| repair.progress_fingerprint.as_ref())
            .collect::<Vec<_>>();
        let expected_last_fingerprint = completed_fingerprints.last().copied();
        let expected_non_progress = expected_last_fingerprint.map_or(0, |last| {
            completed_fingerprints
                .iter()
                .rev()
                .take_while(|fingerprint| *fingerprint == &last)
                .count()
                .saturating_sub(1)
        });
        if self.last_progress_fingerprint.as_ref() != expected_last_fingerprint
            || usize::from(self.consecutive_non_progress) != expected_non_progress
            || (self.phase == LifecyclePhase::Paused(PauseReason::DoomLoopPermissionRequired)
                && self.consecutive_non_progress < self.repair_budget.non_progress_limit)
        {
            return Err(HarnessError::InvalidRestoredState(
                "repair progress counters mismatch",
            ));
        }
        let mut review_ids = BTreeSet::new();
        if self.review_attempts.iter().any(|attempt| {
            attempt.findings.len() > MAX_REVIEW_FINDINGS
                || !bounded_identity(&attempt.attempt_id)
                || attempt.completed_at_ms == 0
                || !review_ids.insert(attempt.attempt_id.as_str())
                || attempt.passed == attempt.findings.iter().any(|finding| finding.blocking)
                || !attempt.context.clean_context
                || attempt.context.reviewer_session_id == attempt.context.implementation_session_id
                || attempt.context.implementation_session_id != self.implementation_session_id
                || !bounded_identity(&attempt.context.reviewer_session_id)
                || !bounded_identity(&attempt.context.reviewer_model_family)
                || !bounded_identity(&attempt.context.implementation_model_family)
                || !bounded_identity(&attempt.workspace_revision)
                || attempt.risk_triggers != self.risk_triggers
                || (attempt.context.independent_model_family_required
                    && attempt.context.reviewer_model_family
                        == attempt.context.implementation_model_family)
                || attempt.findings.iter().any(|finding| {
                    finding.summary.trim().is_empty()
                        || finding.summary.len() > MAX_TEXT_BYTES
                        || finding.summary.chars().any(char::is_control)
                        || finding.reproduction_evidence.len() > MAX_REQUIREMENTS
                        || finding.reproduction_evidence.iter().any(|evidence| {
                            evidence.trim().is_empty()
                                || evidence.len() > MAX_TEXT_BYTES
                                || evidence.chars().any(char::is_control)
                        })
                        || finding.affected_providers.len() > MAX_REQUIREMENTS
                        || finding
                            .affected_providers
                            .iter()
                            .any(|provider| !bounded_identity(provider))
                        || (finding.blocking
                            && (finding.state != FindingState::Verified
                                || finding.reproduction_evidence.is_empty()
                                || finding.affected_providers.is_empty()))
                        || (finding.state == FindingState::AcceptedRisk
                            && finding
                                .accepted_risk_authority
                                .as_ref()
                                .is_none_or(|authority| {
                                    !bounded_identity(&authority.authority_id)
                                        || !bounded_identity(&authority.actor)
                                        || authority.rationale.trim().is_empty()
                                        || authority.rationale.len() > MAX_TEXT_BYTES
                                        || authority.accepted_at_ms == 0
                                }))
                        || (finding.state != FindingState::AcceptedRisk
                            && finding.accepted_risk_authority.is_some())
                })
        }) {
            return Err(HarnessError::InvalidRestoredState("invalid review history"));
        }
        if self
            .narratives
            .iter()
            .any(|record| record.text.len() > MAX_TEXT_BYTES)
        {
            return Err(HarnessError::InvalidRestoredState(
                "narrative exceeds limit",
            ));
        }
        let authority_revision = match (&self.phase, &self.land_transaction) {
            (LifecyclePhase::Landed, Some(transaction)) => &transaction.expected_revision,
            _ => &self.workspace_revision,
        };
        let proof_required = matches!(
            self.phase,
            LifecyclePhase::Review
                | LifecyclePhase::ReadyToLand
                | LifecyclePhase::Landing
                | LifecyclePhase::Landed
        );
        if proof_required && !self.all_requirements_fresh_for(authority_revision) {
            return Err(HarnessError::InvalidRestoredState(
                "phase requires fresh proof",
            ));
        }
        let review_required = !self.risk_triggers.is_empty()
            && matches!(
                self.phase,
                LifecyclePhase::ReadyToLand | LifecyclePhase::Landing | LifecyclePhase::Landed
            );
        if review_required
            && self.review_attempts.last().is_none_or(|attempt| {
                !attempt.passed || attempt.workspace_revision != *authority_revision
            })
        {
            return Err(HarnessError::InvalidRestoredState(
                "phase requires passed review",
            ));
        }
        match (&self.phase, &self.land_transaction) {
            (LifecyclePhase::Landing | LifecyclePhase::Landed, Some(transaction))
                if transaction.change_id == self.change_id
                    && transaction.exclusive_project_lock_required
                    && transaction.authority_explicit
                    && bounded_identity(&transaction.authority_id)
                    && bounded_identity(&transaction.authority_actor)
                    && bounded_identity(&transaction.expected_revision)
                    && (self.phase == LifecyclePhase::Landed
                        || transaction.expected_revision == self.workspace_revision) => {}
            (LifecyclePhase::Landing | LifecyclePhase::Landed, _) => {
                return Err(HarnessError::InvalidRestoredState(
                    "Land transaction missing",
                ));
            }
            (_, None) => {}
            (_, Some(_)) => {
                return Err(HarnessError::InvalidRestoredState(
                    "unexpected Land transaction",
                ));
            }
        }
        Ok(())
    }

    /// Narrative completion is retained for audit/context only.
    pub fn record_agent_narrative(
        &mut self,
        text: impl Into<String>,
        recorded_at_ms: u64,
    ) -> TransitionEffect {
        let mut text = text.into();
        if text.len() > MAX_TEXT_BYTES {
            let mut boundary = MAX_TEXT_BYTES;
            while !text.is_char_boundary(boundary) {
                boundary -= 1;
            }
            text.truncate(boundary);
        }
        if self.narratives.len() == MAX_HISTORY_RECORDS {
            self.narratives.remove(0);
        }
        self.narratives.push(NarrativeRecord {
            text,
            recorded_at_ms,
        });
        TransitionEffect::NarrativeRecorded
    }

    pub fn complete_build(
        &mut self,
        workspace_revision: impl Into<String>,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Build)?;
        let workspace_revision = workspace_revision.into();
        if !bounded_identity(&workspace_revision) {
            return Err(HarnessError::InvalidConfiguration);
        }
        if !self.proofs.is_empty() && workspace_revision != self.workspace_revision {
            return Err(HarnessError::BuildImpactRequired);
        }
        self.workspace_revision = workspace_revision;
        self.phase = LifecyclePhase::Prove;
        Ok(TransitionEffect::ProofRequired {
            providers: self.missing_providers(),
        })
    }

    /// Drive bounded prove -> repair -> targeted prove convergence until proof
    /// is complete or a policy/user pause is reached. A repair invalidates only
    /// the providers declared by its observed result; fresh receipts for all
    /// other providers are carried forward by `complete_repair`.
    pub fn converge<D: ConvergenceDriver>(
        &mut self,
        driver: &mut D,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Prove)?;
        loop {
            let providers = self.missing_providers();
            let mut repaired = false;
            for provider in providers {
                match driver.prove(&provider, &self.workspace_revision) {
                    Ok(receipt) => {
                        let effect = self.record_proof(receipt)?;
                        if !matches!(effect, TransitionEffect::ProofRequired { .. }) {
                            return Ok(effect);
                        }
                    }
                    Err(failure) => {
                        let repair_id = OperationId::new();
                        let mut effect = self.record_failure(failure.clone(), Some(repair_id))?;
                        if let TransitionEffect::FocusedDiagnosisRequired { ref cause_id } = effect
                        {
                            driver
                                .diagnose(cause_id, &self.failures)
                                .map_err(HarnessError::Executor)?;
                            effect = self.complete_diagnosis(cause_id, OperationId::new())?;
                        }
                        let TransitionEffect::RepairStarted { operation_id } = effect else {
                            return Ok(effect);
                        };
                        let operation = self
                            .repairs
                            .iter()
                            .find(|operation| operation.operation_id == operation_id)
                            .cloned()
                            .ok_or(HarnessError::RepairNotFound)?;
                        let repaired_result = driver
                            .repair(&operation, &failure)
                            .map_err(HarnessError::Executor)?;
                        let effect = self.complete_repair(
                            &operation_id,
                            repaired_result.workspace_revision,
                            repaired_result.invalidated_providers,
                            repaired_result.progress_fingerprint,
                        )?;
                        if !matches!(effect, TransitionEffect::ProofRequired { .. }) {
                            return Ok(effect);
                        }
                        repaired = true;
                        break;
                    }
                }
            }
            if !repaired {
                // An empty provider set can only occur after the last receipt
                // has already transitioned out of Prove above.
                return Err(HarnessError::ProofIncomplete);
            }
        }
    }

    pub fn record_proof(
        &mut self,
        receipt: ProofReceipt,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Prove)?;
        if receipt.workspace_revision != self.workspace_revision {
            return Err(HarnessError::StaleReceipt);
        }
        let expected_claims = self
            .requirements
            .iter()
            .filter(|requirement| requirement.provider == receipt.provider)
            .map(|requirement| requirement.claim_id.clone())
            .collect::<BTreeSet<_>>();
        if expected_claims.is_empty() || !expected_claims.is_subset(&receipt.claims) {
            return Err(HarnessError::IncompleteReceipt);
        }
        if !bounded_identity(&receipt.receipt_id)
            || !bounded_identity(&receipt.provider)
            || !bounded_identity(&receipt.workspace_revision)
            || receipt.claims.len() > MAX_REQUIREMENTS
            || receipt.claims.iter().any(|claim| !bounded_identity(claim))
            || receipt.evidence_hash.is_empty()
            || receipt.evidence_hash.len() > MAX_ID_BYTES
            || receipt.evidence_hash.chars().any(char::is_control)
            || receipt.completed_at_ms == 0
        {
            return Err(HarnessError::IncompleteReceipt);
        }
        self.proofs.insert(
            receipt.provider.clone(),
            ProofRecord {
                fresh_for_revision: self.workspace_revision.clone(),
                reused_from_revision: None,
                freshness: Freshness::Fresh,
                receipt,
            },
        );
        self.advance_after_proof()
    }

    pub fn record_failure(
        &mut self,
        failure: ProofFailure,
        repair_operation_id: Option<OperationId>,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Prove)?;
        if self.failures.len() == MAX_HISTORY_RECORDS
            || !bounded_identity(&failure.provider)
            || !bounded_identity(&failure.cause_id)
            || failure.summary.len() > MAX_TEXT_BYTES
            || failure.observed_at_ms == 0
            || !self
                .requirements
                .iter()
                .any(|requirement| requirement.provider == failure.provider)
        {
            return Err(HarnessError::InvalidFailureData);
        }
        let next_cause_count = self
            .cause_counts
            .get(&failure.cause_id)
            .copied()
            .unwrap_or_default()
            .saturating_add(1);
        let repair_id = if failure.class == FailureClass::Code
            && next_cause_count < 2
            && self.repairs.len() < usize::from(self.repair_budget.max_operations)
        {
            let operation_id = repair_operation_id
                .as_ref()
                .ok_or(HarnessError::RepairOperationIdRequired)?;
            if self
                .repairs
                .iter()
                .any(|operation| &operation.operation_id == operation_id)
            {
                return Err(HarnessError::DuplicateOperationId);
            }
            Some(operation_id.clone())
        } else {
            None
        };
        self.failures.push(failure.clone());
        self.cause_counts
            .insert(failure.cause_id.clone(), next_cause_count);
        match failure.class {
            FailureClass::Code => {
                if next_cause_count >= 2 {
                    self.phase = LifecyclePhase::Diagnosis;
                    return Ok(TransitionEffect::FocusedDiagnosisRequired {
                        cause_id: failure.cause_id,
                    });
                }
                if self.repairs.len() >= usize::from(self.repair_budget.max_operations) {
                    self.phase = LifecyclePhase::Paused(PauseReason::RepairBudgetExhausted);
                    return Ok(TransitionEffect::RepairBudgetExhausted);
                }
                self.start_repair(
                    failure.cause_id,
                    failure.provider,
                    repair_id.expect("repair ID validated before recording failure"),
                )
            }
            FailureClass::Config => {
                self.phase = LifecyclePhase::Paused(PauseReason::ConfigDecisionRequired);
                Ok(TransitionEffect::ConfigDecisionRequired)
            }
            FailureClass::Infrastructure => {
                self.phase = LifecyclePhase::Paused(PauseReason::Infrastructure);
                Ok(TransitionEffect::InfrastructurePaused)
            }
            FailureClass::AuthorityRequired => {
                self.phase = LifecyclePhase::Paused(PauseReason::AuthorityRequired);
                Ok(TransitionEffect::AuthorityRequired)
            }
        }
    }

    pub fn complete_diagnosis(
        &mut self,
        cause_id: &str,
        repair_operation_id: OperationId,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Diagnosis)?;
        if self.cause_counts.get(cause_id).copied().unwrap_or_default() < 2 {
            return Err(HarnessError::DiagnosisCauseMismatch);
        }
        if self
            .failures
            .last()
            .map(|failure| failure.cause_id.as_str())
            != Some(cause_id)
        {
            return Err(HarnessError::DiagnosisCauseMismatch);
        }
        let failed_provider = self
            .failures
            .iter()
            .rev()
            .find(|failure| failure.cause_id == cause_id)
            .map(|failure| failure.provider.clone())
            .ok_or(HarnessError::DiagnosisCauseMismatch)?;
        self.start_repair(cause_id.to_owned(), failed_provider, repair_operation_id)
    }

    fn start_repair(
        &mut self,
        cause_id: String,
        failed_provider: String,
        operation_id: OperationId,
    ) -> Result<TransitionEffect, HarnessError> {
        if self.repairs.len() >= usize::from(self.repair_budget.max_operations) {
            self.phase = LifecyclePhase::Paused(PauseReason::RepairBudgetExhausted);
            return Ok(TransitionEffect::RepairBudgetExhausted);
        }
        if self
            .repairs
            .iter()
            .any(|operation| operation.operation_id == operation_id)
        {
            return Err(HarnessError::DuplicateOperationId);
        }
        self.repairs.push(RepairOperation {
            operation_id: operation_id.clone(),
            cause_id,
            failed_provider,
            ordinal: self.repairs.len() as u16 + 1,
            status: RepairStatus::Running,
            before_revision: self.workspace_revision.clone(),
            after_revision: None,
            progress_fingerprint: None,
            invalidated_providers: BTreeSet::new(),
        });
        self.phase = LifecyclePhase::Repair;
        Ok(TransitionEffect::RepairStarted { operation_id })
    }

    pub fn complete_repair(
        &mut self,
        operation_id: &OperationId,
        new_revision: impl Into<String>,
        invalidated_providers: BTreeSet<String>,
        progress_fingerprint: impl Into<String>,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Repair)?;
        if invalidated_providers.is_empty() {
            return Err(HarnessError::EmptyRepairImpact);
        }
        let new_revision = new_revision.into();
        let fingerprint = progress_fingerprint.into();
        if !bounded_identity(&new_revision) || !bounded_identity(&fingerprint) {
            return Err(HarnessError::InvalidRepairImpact);
        }
        let operation = self
            .repairs
            .iter_mut()
            .find(|operation| &operation.operation_id == operation_id)
            .ok_or(HarnessError::RepairNotFound)?;
        if operation.status != RepairStatus::Running {
            return Err(HarnessError::RepairNotRunning);
        }
        if !invalidated_providers.contains(&operation.failed_provider)
            || invalidated_providers.iter().any(|provider| {
                !self
                    .requirements
                    .iter()
                    .any(|item| &item.provider == provider)
            })
        {
            return Err(HarnessError::InvalidRepairImpact);
        }
        operation.status = RepairStatus::Completed;
        operation.after_revision = Some(new_revision.clone());
        operation.progress_fingerprint = Some(fingerprint.clone());
        operation.invalidated_providers = invalidated_providers.clone();

        for (provider, proof) in &mut self.proofs {
            if invalidated_providers.contains(provider) {
                proof.freshness = Freshness::Stale(StaleReason::Repair);
            } else if proof.freshness == Freshness::Fresh {
                proof.reused_from_revision = Some(proof.fresh_for_revision.clone());
                proof.fresh_for_revision = new_revision.clone();
            }
        }
        self.workspace_revision = new_revision;
        if self.last_progress_fingerprint.as_ref() == Some(&fingerprint) {
            self.consecutive_non_progress = self.consecutive_non_progress.saturating_add(1);
        } else {
            self.consecutive_non_progress = 0;
        }
        self.last_progress_fingerprint = Some(fingerprint);
        if self.consecutive_non_progress >= self.repair_budget.non_progress_limit {
            self.phase = LifecyclePhase::Paused(PauseReason::DoomLoopPermissionRequired);
            return Ok(TransitionEffect::DoomLoopPermissionRequired);
        }
        self.phase = LifecyclePhase::Prove;
        Ok(TransitionEffect::ProofRequired {
            providers: self.missing_providers(),
        })
    }

    pub fn requirements_changed(
        &mut self,
        new_revision: impl Into<String>,
        requirements: BTreeSet<ProofRequirement>,
        affected_providers: &BTreeSet<String>,
    ) -> Result<TransitionEffect, HarnessError> {
        let new_revision = new_revision.into();
        if requirements.is_empty()
            || requirements.len() > MAX_REQUIREMENTS
            || !bounded_identity(&new_revision)
            || requirements.iter().any(|requirement| {
                !bounded_identity(&requirement.claim_id) || !bounded_identity(&requirement.provider)
            })
        {
            return Err(HarnessError::InvalidConfiguration);
        }
        let known_providers = self
            .requirements
            .iter()
            .chain(&requirements)
            .map(|requirement| requirement.provider.as_str())
            .collect::<BTreeSet<_>>();
        if affected_providers
            .iter()
            .any(|provider| !known_providers.contains(provider.as_str()))
        {
            return Err(HarnessError::InvalidConfiguration);
        }
        self.workspace_revision = new_revision;
        self.requirements = requirements;
        let required_providers = self
            .requirements
            .iter()
            .map(|requirement| requirement.provider.clone())
            .collect::<BTreeSet<_>>();
        self.proofs
            .retain(|provider, _| required_providers.contains(provider));
        let affected_providers = affected_providers
            .intersection(&required_providers)
            .cloned()
            .collect::<BTreeSet<_>>();
        self.invalidate(&affected_providers, StaleReason::RequirementChange);
        self.phase = LifecyclePhase::Change;
        self.land_transaction = None;
        Ok(TransitionEffect::BuildRequired)
    }

    /// Record an out-of-band workspace edit. All existing receipts become
    /// stale and the lifecycle returns to Change; this never authorizes the
    /// external content or silently advances Build.
    pub fn workspace_revision_mismatch(
        &mut self,
        observed_revision: impl Into<String>,
    ) -> TransitionEffect {
        let providers = self.proofs.keys().cloned().collect::<BTreeSet<_>>();
        self.workspace_revision = observed_revision.into();
        self.invalidate(&providers, StaleReason::WorkspaceRevisionMismatch);
        self.phase = LifecyclePhase::Change;
        self.land_transaction = None;
        TransitionEffect::BuildRequired
    }

    pub fn confirm_changed_requirements(&mut self) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Change)?;
        self.phase = LifecyclePhase::Build;
        Ok(TransitionEffect::BuildRequired)
    }

    /// Complete a post-Change build while declaring exactly which proof
    /// providers the build invalidated. Unaffected receipts are carried forward
    /// with explicit reuse provenance.
    pub fn complete_changed_build(
        &mut self,
        workspace_revision: impl Into<String>,
        invalidated_providers: &BTreeSet<String>,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Build)?;
        let workspace_revision = workspace_revision.into();
        if !bounded_identity(&workspace_revision) {
            return Err(HarnessError::InvalidConfiguration);
        }
        let required_providers = self
            .requirements
            .iter()
            .map(|requirement| requirement.provider.as_str())
            .collect::<BTreeSet<_>>();
        if invalidated_providers
            .iter()
            .any(|provider| !required_providers.contains(provider.as_str()))
        {
            return Err(HarnessError::InvalidRepairImpact);
        }
        self.workspace_revision = workspace_revision;
        self.invalidate(invalidated_providers, StaleReason::RequirementChange);
        self.phase = LifecyclePhase::Prove;
        self.advance_after_proof()
    }

    pub fn submit_review(
        &mut self,
        attempt_id: impl Into<String>,
        context: ReviewContext,
        findings: Vec<ReviewFinding>,
        completed_at_ms: u64,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Review)?;
        let attempt_id = attempt_id.into();
        if !context.clean_context
            || context.reviewer_session_id == context.implementation_session_id
            || context.implementation_session_id != self.implementation_session_id
            || !bounded_identity(&attempt_id)
            || !bounded_identity(&context.reviewer_session_id)
            || !bounded_identity(&context.reviewer_model_family)
            || !bounded_identity(&context.implementation_model_family)
            || findings.len() > MAX_REVIEW_FINDINGS
            || self.review_attempts.len() == MAX_HISTORY_RECORDS
            || completed_at_ms == 0
        {
            return Err(HarnessError::ReviewNotIndependent);
        }
        if context.independent_model_family_required
            && context.reviewer_model_family == context.implementation_model_family
        {
            return Err(HarnessError::ReviewModelFamilyNotIndependent);
        }
        if findings.iter().any(|finding| {
            finding.blocking
                && (finding.state != FindingState::Verified
                    || finding.reproduction_evidence.is_empty())
        }) {
            return Err(HarnessError::UnverifiedBlockingFinding);
        }
        if findings
            .iter()
            .any(|finding| finding.blocking && finding.affected_providers.is_empty())
        {
            return Err(HarnessError::BlockingFindingMissingImpact);
        }
        if findings.iter().any(|finding| {
            (finding.state == FindingState::AcceptedRisk
                && finding
                    .accepted_risk_authority
                    .as_ref()
                    .is_none_or(|authority| {
                        !bounded_identity(&authority.authority_id)
                            || !bounded_identity(&authority.actor)
                            || authority.rationale.trim().is_empty()
                            || authority.rationale.len() > MAX_TEXT_BYTES
                            || authority.accepted_at_ms == 0
                    }))
                || (finding.state != FindingState::AcceptedRisk
                    && finding.accepted_risk_authority.is_some())
        }) {
            return Err(HarnessError::AcceptedRiskAuthorityRequired);
        }
        let required_providers = self
            .requirements
            .iter()
            .map(|requirement| requirement.provider.as_str())
            .collect::<BTreeSet<_>>();
        if findings.iter().any(|finding| {
            finding.summary.trim().is_empty()
                || finding.summary.len() > MAX_TEXT_BYTES
                || finding.summary.chars().any(char::is_control)
                || finding.reproduction_evidence.len() > MAX_REQUIREMENTS
                || finding.reproduction_evidence.iter().any(|evidence| {
                    evidence.trim().is_empty()
                        || evidence.len() > MAX_TEXT_BYTES
                        || evidence.chars().any(char::is_control)
                })
                || finding.affected_providers.len() > MAX_REQUIREMENTS
                || finding
                    .affected_providers
                    .iter()
                    .any(|provider| !required_providers.contains(provider.as_str()))
        }) {
            return Err(HarnessError::InvalidReviewData);
        }
        if self
            .review_attempts
            .iter()
            .any(|attempt| attempt.attempt_id == attempt_id)
        {
            return Err(HarnessError::DuplicateReviewAttempt);
        }
        let passed = !findings.iter().any(|finding| finding.blocking);
        if !passed {
            let affected = findings
                .iter()
                .filter(|finding| finding.blocking)
                .flat_map(|finding| finding.affected_providers.iter().cloned())
                .collect::<BTreeSet<_>>();
            self.invalidate(&affected, StaleReason::ReviewFinding);
        }
        self.review_attempts.push(ReviewAttempt {
            attempt_id,
            context,
            findings,
            completed_at_ms,
            passed,
            workspace_revision: self.workspace_revision.clone(),
            risk_triggers: self.risk_triggers.clone(),
        });
        if passed {
            self.phase = LifecyclePhase::ReadyToLand;
            Ok(TransitionEffect::ReadyToLand)
        } else {
            self.phase = LifecyclePhase::Change;
            Ok(TransitionEffect::BuildRequired)
        }
    }

    /// Run a risk-triggered review through an explicitly attached clean
    /// reviewer. The adapter receives only diff/agreement/evidence/residual
    /// risk artifacts and must return typed findings from a separate session.
    #[allow(clippy::too_many_arguments)]
    pub fn run_independent_review<R: IndependentReviewer>(
        &mut self,
        attempt_id: impl Into<String>,
        implementation_model_family: impl Into<String>,
        independent_model_family_required: bool,
        request: CleanReviewRequest,
        reviewer: &mut R,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Review)?;
        if request.reviewer_session_id == request.implementation_session_id
            || request.implementation_session_id != self.implementation_session_id
            || request.diff_artifact.is_empty()
            || request.agreement_artifact.is_empty()
            || request.evidence_artifacts.is_empty()
            || request.evidence_artifacts.len() > MAX_REQUIREMENTS
            || request.residual_risks.len() > MAX_REQUIREMENTS
            || !bounded_identity(&request.reviewer_session_id)
            || !bounded_identity(&request.implementation_session_id)
            || !bounded_identity(&request.diff_artifact)
            || !bounded_identity(&request.agreement_artifact)
            || request
                .evidence_artifacts
                .iter()
                .any(|artifact| !bounded_identity(artifact))
            || request
                .residual_risks
                .iter()
                .any(|risk| risk.trim().is_empty() || risk.len() > MAX_TEXT_BYTES)
            || request.risk_triggers != self.risk_triggers
        {
            return Err(HarnessError::ReviewNotIndependent);
        }
        let result = reviewer.review(&request).map_err(HarnessError::Executor)?;
        self.submit_review(
            attempt_id,
            ReviewContext {
                reviewer_session_id: request.reviewer_session_id,
                implementation_session_id: request.implementation_session_id,
                clean_context: true,
                reviewer_model_family: result.reviewer_model_family,
                implementation_model_family: implementation_model_family.into(),
                independent_model_family_required,
            },
            result.findings,
            result.completed_at_ms,
        )
    }

    pub fn request_land(
        &mut self,
        authority: LandAuthority,
        transaction_id: OperationId,
    ) -> Result<LandTransaction, HarnessError> {
        self.require_phase(&LifecyclePhase::ReadyToLand)?;
        if !authority.explicit
            || !bounded_identity(&authority.authority_id)
            || !bounded_identity(&authority.actor)
            || authority.expected_revision != self.workspace_revision
        {
            return Err(HarnessError::LandAuthorityRequired);
        }
        if !self.all_requirements_fresh() {
            return Err(HarnessError::ProofIncomplete);
        }
        let transaction = LandTransaction {
            transaction_id,
            change_id: self.change_id.clone(),
            expected_revision: self.workspace_revision.clone(),
            authority_id: authority.authority_id,
            authority_actor: authority.actor,
            authority_explicit: authority.explicit,
            exclusive_project_lock_required: true,
        };
        self.land_transaction = Some(transaction.clone());
        self.phase = LifecyclePhase::Landing;
        Ok(transaction)
    }

    pub fn complete_land(
        &mut self,
        transaction_id: &OperationId,
        exclusive_project_lock_held: bool,
        observed_workspace_revision: &str,
        committed_revision: impl Into<String>,
    ) -> Result<TransitionEffect, HarnessError> {
        self.require_phase(&LifecyclePhase::Landing)?;
        let transaction = self
            .land_transaction
            .as_ref()
            .ok_or(HarnessError::LandTransactionMissing)?;
        if &transaction.transaction_id != transaction_id {
            return Err(HarnessError::LandTransactionMismatch);
        }
        if !exclusive_project_lock_held
            || transaction.expected_revision != observed_workspace_revision
        {
            return Err(HarnessError::LandTransactionRejected);
        }
        let committed_revision = committed_revision.into();
        if !bounded_identity(&committed_revision) {
            return Err(HarnessError::LandTransactionRejected);
        }
        self.workspace_revision = committed_revision;
        self.phase = LifecyclePhase::Landed;
        Ok(TransitionEffect::Landed)
    }

    fn advance_after_proof(&mut self) -> Result<TransitionEffect, HarnessError> {
        if !self.all_requirements_fresh() {
            return Ok(TransitionEffect::ProofRequired {
                providers: self.missing_providers(),
            });
        }
        if self.risk_triggers.is_empty() {
            self.phase = LifecyclePhase::ReadyToLand;
            Ok(TransitionEffect::ReadyToLand)
        } else {
            self.phase = LifecyclePhase::Review;
            Ok(TransitionEffect::IndependentReviewRequired {
                triggers: self.risk_triggers.clone(),
            })
        }
    }

    fn all_requirements_fresh(&self) -> bool {
        self.all_requirements_fresh_for(&self.workspace_revision)
    }

    fn all_requirements_fresh_for(&self, revision: &str) -> bool {
        self.requirements.iter().all(|requirement| {
            self.proofs.get(&requirement.provider).is_some_and(|proof| {
                proof.freshness == Freshness::Fresh
                    && proof.fresh_for_revision == revision
                    && proof.receipt.claims.contains(&requirement.claim_id)
            })
        })
    }

    fn missing_providers(&self) -> BTreeSet<String> {
        self.requirements
            .iter()
            .filter(|requirement| {
                self.proofs.get(&requirement.provider).is_none_or(|proof| {
                    proof.freshness != Freshness::Fresh
                        || proof.fresh_for_revision != self.workspace_revision
                        || !proof.receipt.claims.contains(&requirement.claim_id)
                })
            })
            .map(|requirement| requirement.provider.clone())
            .collect()
    }

    fn invalidate(&mut self, providers: &BTreeSet<String>, reason: StaleReason) {
        for (provider, proof) in &mut self.proofs {
            if providers.contains(provider) {
                proof.freshness = Freshness::Stale(reason.clone());
            } else if proof.freshness == Freshness::Fresh {
                proof.reused_from_revision = Some(proof.fresh_for_revision.clone());
                proof.fresh_for_revision = self.workspace_revision.clone();
            }
        }
    }

    fn require_phase(&self, expected: &LifecyclePhase) -> Result<(), HarnessError> {
        if &self.phase == expected {
            Ok(())
        } else {
            Err(HarnessError::InvalidPhase {
                expected: expected.clone(),
                actual: self.phase.clone(),
            })
        }
    }
}

fn bounded_identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_BYTES && !value.chars().any(char::is_control)
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum HarnessError {
    #[error("invalid harness configuration")]
    InvalidConfiguration,
    #[error("invalid restored harness state: {0}")]
    InvalidRestoredState(&'static str),
    #[error("invalid phase: expected {expected:?}, actual {actual:?}")]
    InvalidPhase {
        expected: LifecyclePhase,
        actual: LifecyclePhase,
    },
    #[error("proof receipt is stale")]
    StaleReceipt,
    #[error("proof receipt does not cover required claims")]
    IncompleteReceipt,
    #[error("repair operation ID is required")]
    RepairOperationIdRequired,
    #[error("duplicate repair operation ID")]
    DuplicateOperationId,
    #[error("diagnosis cause does not have two matching failures")]
    DiagnosisCauseMismatch,
    #[error("repair operation not found")]
    RepairNotFound,
    #[error("repair operation is not running")]
    RepairNotRunning,
    #[error("repair must declare invalidated proof providers")]
    EmptyRepairImpact,
    #[error("repair impact must include the failed provider and only required providers")]
    InvalidRepairImpact,
    #[error("proof failure data exceeds limits or references an unknown provider")]
    InvalidFailureData,
    #[error("build changed revision with existing proof; targeted impact is required")]
    BuildImpactRequired,
    #[error("review is not independent and clean")]
    ReviewNotIndependent,
    #[error("review requires an independent model family")]
    ReviewModelFamilyNotIndependent,
    #[error("review data exceeds limits or references an unknown proof provider")]
    InvalidReviewData,
    #[error("blocking review finding must be verified with reproduction evidence")]
    UnverifiedBlockingFinding,
    #[error("blocking review finding must identify affected proof providers")]
    BlockingFindingMissingImpact,
    #[error("duplicate review attempt")]
    DuplicateReviewAttempt,
    #[error("accepted review risk requires explicit recorded authority and rationale")]
    AcceptedRiskAuthorityRequired,
    #[error("attached lifecycle executor failed: {0}")]
    Executor(String),
    #[error("proof is incomplete")]
    ProofIncomplete,
    #[error("explicit Land authority is required")]
    LandAuthorityRequired,
    #[error("Land transaction is missing")]
    LandTransactionMissing,
    #[error("Land transaction ID does not match")]
    LandTransactionMismatch,
    #[error("Land transaction lock or revision check failed")]
    LandTransactionRejected,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn requirement(claim: &str, provider: &str) -> ProofRequirement {
        ProofRequirement {
            claim_id: claim.into(),
            provider: provider.into(),
        }
    }
    fn harness(risk: BTreeSet<RiskTrigger>, budget: RepairBudget) -> ConvergenceHarness {
        ConvergenceHarness::new_confirmed(
            "change-1",
            "implementation-session",
            "rev-1",
            BTreeSet::from([requirement("tests", "test"), requirement("lint", "static")]),
            risk,
            budget,
        )
        .unwrap()
    }
    fn receipt(provider: &str, claim: &str, revision: &str) -> ProofReceipt {
        ProofReceipt {
            receipt_id: format!("receipt-{provider}-{revision}"),
            provider: provider.into(),
            claims: BTreeSet::from([claim.into()]),
            workspace_revision: revision.into(),
            evidence_hash: "sha256:evidence".into(),
            completed_at_ms: 10,
        }
    }
    fn failure(cause: &str) -> ProofFailure {
        ProofFailure {
            provider: "test".into(),
            cause_id: cause.into(),
            class: FailureClass::Code,
            summary: "failed".into(),
            observed_at_ms: 20,
        }
    }
    fn reach_prove(harness: &mut ConvergenceHarness) {
        harness.complete_build("rev-1").unwrap();
    }
    fn prove_all(harness: &mut ConvergenceHarness, revision: &str) {
        harness
            .record_proof(receipt("test", "tests", revision))
            .unwrap();
        harness
            .record_proof(receipt("static", "lint", revision))
            .unwrap();
    }

    #[test]
    fn narrative_completion_cannot_advance_or_prove() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        assert_eq!(
            harness.record_agent_narrative("all tests passed", 1),
            TransitionEffect::NarrativeRecorded
        );
        assert_eq!(harness.phase(), &LifecyclePhase::Build);
        reach_prove(&mut harness);
        harness.record_agent_narrative("proof complete", 2);
        assert_eq!(harness.phase(), &LifecyclePhase::Prove);
    }

    #[test]
    fn restored_state_cannot_forge_ready_or_land_authority() {
        let mut forged_ready = harness(BTreeSet::new(), RepairBudget::default());
        forged_ready.phase = LifecyclePhase::ReadyToLand;
        assert_eq!(
            forged_ready.validate_restored(),
            Err(HarnessError::InvalidRestoredState(
                "phase requires fresh proof"
            ))
        );

        let mut valid = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut valid);
        prove_all(&mut valid, "rev-1");
        assert_eq!(valid.validate_restored(), Ok(()));

        valid.land_transaction = Some(LandTransaction {
            transaction_id: OperationId::from_stable("forged-land"),
            change_id: "other-change".into(),
            expected_revision: "rev-1".into(),
            authority_id: "forged-authority".into(),
            authority_actor: "forged-actor".into(),
            authority_explicit: true,
            exclusive_project_lock_required: true,
        });
        assert_eq!(
            valid.validate_restored(),
            Err(HarnessError::InvalidRestoredState(
                "unexpected Land transaction"
            ))
        );

        let mut encoded =
            serde_json::to_value(harness(BTreeSet::new(), RepairBudget::default())).unwrap();
        encoded["phase"] = serde_json::json!("ready_to_land");
        assert!(serde_json::from_value::<ConvergenceHarness>(encoded).is_err());
    }

    #[test]
    fn restored_state_rejects_duplicate_history_and_bounds_narrative() {
        let mut state = harness(BTreeSet::new(), RepairBudget::default());
        state.record_agent_narrative("x".repeat(MAX_TEXT_BYTES + 100), 1);
        assert_eq!(state.narratives[0].text.len(), MAX_TEXT_BYTES);
        state.review_attempts = vec![
            ReviewAttempt {
                attempt_id: "duplicate".into(),
                context: ReviewContext {
                    reviewer_session_id: "review-a".into(),
                    implementation_session_id: "implementation-session".into(),
                    clean_context: true,
                    reviewer_model_family: "family-b".into(),
                    implementation_model_family: "family-a".into(),
                    independent_model_family_required: false,
                },
                findings: vec![],
                completed_at_ms: 1,
                passed: true,
                workspace_revision: "rev-1".into(),
                risk_triggers: BTreeSet::new(),
            },
            ReviewAttempt {
                attempt_id: "duplicate".into(),
                context: ReviewContext {
                    reviewer_session_id: "review-b".into(),
                    implementation_session_id: "implementation-session".into(),
                    clean_context: true,
                    reviewer_model_family: "family-c".into(),
                    implementation_model_family: "family-a".into(),
                    independent_model_family_required: false,
                },
                findings: vec![],
                completed_at_ms: 2,
                passed: true,
                workspace_revision: "rev-1".into(),
                risk_triggers: BTreeSet::new(),
            },
        ];
        assert_eq!(
            state.validate_restored(),
            Err(HarnessError::InvalidRestoredState("invalid review history"))
        );
    }

    #[test]
    fn repair_invalidates_only_affected_providers_and_reuses_fresh_proof() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        harness
            .record_proof(receipt("static", "lint", "rev-1"))
            .unwrap();
        harness
            .record_failure(
                failure("test-failure"),
                Some(OperationId::from_stable("repair-1")),
            )
            .unwrap();
        let effect = harness
            .complete_repair(
                &OperationId::from_stable("repair-1"),
                "rev-2",
                BTreeSet::from(["test".into()]),
                "fingerprint-1",
            )
            .unwrap();
        assert_eq!(
            effect,
            TransitionEffect::ProofRequired {
                providers: BTreeSet::from(["test".into()])
            }
        );
        let static_proof = &harness.proof_records()["static"];
        assert_eq!(static_proof.fresh_for_revision, "rev-2");
        assert_eq!(static_proof.reused_from_revision.as_deref(), Some("rev-1"));
    }

    #[test]
    fn second_same_cause_requires_focused_diagnosis() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        harness
            .record_failure(failure("same"), Some(OperationId::from_stable("repair-1")))
            .unwrap();
        harness
            .complete_repair(
                &OperationId::from_stable("repair-1"),
                "rev-2",
                BTreeSet::from(["test".into()]),
                "progress-1",
            )
            .unwrap();
        let effect = harness.record_failure(failure("same"), None).unwrap();
        assert_eq!(
            effect,
            TransitionEffect::FocusedDiagnosisRequired {
                cause_id: "same".into()
            }
        );
        assert_eq!(harness.phase(), &LifecyclePhase::Diagnosis);
    }

    #[test]
    fn rejected_repair_operation_id_does_not_mutate_failure_history() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        assert_eq!(
            harness.record_failure(failure("missing-id"), None),
            Err(HarnessError::RepairOperationIdRequired)
        );
        assert!(harness.failure_history().is_empty());
        assert!(harness.cause_counts.is_empty());
        assert_eq!(harness.phase(), &LifecyclePhase::Prove);

        harness
            .record_failure(
                failure("first"),
                Some(OperationId::from_stable("duplicate")),
            )
            .unwrap();
        harness
            .complete_repair(
                &OperationId::from_stable("duplicate"),
                "rev-2",
                BTreeSet::from(["test".into()]),
                "progress",
            )
            .unwrap();
        let history_len = harness.failure_history().len();
        assert_eq!(
            harness.record_failure(
                failure("second"),
                Some(OperationId::from_stable("duplicate")),
            ),
            Err(HarnessError::DuplicateOperationId)
        );
        assert_eq!(harness.failure_history().len(), history_len);
        assert!(!harness.cause_counts.contains_key("second"));
    }

    #[test]
    fn diagnosis_completion_is_bound_to_the_failure_that_triggered_it() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        harness
            .record_failure(failure("older"), Some(OperationId::from_stable("repair-1")))
            .unwrap();
        harness
            .complete_repair(
                &OperationId::from_stable("repair-1"),
                "rev-2",
                BTreeSet::from(["test".into()]),
                "progress-1",
            )
            .unwrap();
        harness.record_failure(failure("older"), None).unwrap();
        harness
            .complete_diagnosis("older", OperationId::from_stable("repair-2"))
            .unwrap();
        harness
            .complete_repair(
                &OperationId::from_stable("repair-2"),
                "rev-3",
                BTreeSet::from(["test".into()]),
                "progress-2",
            )
            .unwrap();
        harness
            .record_failure(
                failure("current"),
                Some(OperationId::from_stable("repair-3")),
            )
            .unwrap();
        harness
            .complete_repair(
                &OperationId::from_stable("repair-3"),
                "rev-4",
                BTreeSet::from(["test".into()]),
                "progress-3",
            )
            .unwrap();
        harness.record_failure(failure("current"), None).unwrap();

        assert_eq!(
            harness.complete_diagnosis("older", OperationId::from_stable("wrong-cause")),
            Err(HarnessError::DiagnosisCauseMismatch)
        );
    }

    #[test]
    fn repeated_non_progress_pauses_for_doom_loop_permission() {
        let mut harness = harness(
            BTreeSet::new(),
            RepairBudget {
                max_operations: 6,
                non_progress_limit: 1,
            },
        );
        reach_prove(&mut harness);
        harness
            .record_failure(failure("a"), Some(OperationId::from_stable("r1")))
            .unwrap();
        harness
            .complete_repair(
                &OperationId::from_stable("r1"),
                "rev-2",
                BTreeSet::from(["test".into()]),
                "same-output",
            )
            .unwrap();
        harness
            .record_failure(failure("b"), Some(OperationId::from_stable("r2")))
            .unwrap();
        let effect = harness
            .complete_repair(
                &OperationId::from_stable("r2"),
                "rev-3",
                BTreeSet::from(["test".into()]),
                "same-output",
            )
            .unwrap();
        assert_eq!(effect, TransitionEffect::DoomLoopPermissionRequired);
        assert_eq!(
            harness.phase(),
            &LifecyclePhase::Paused(PauseReason::DoomLoopPermissionRequired)
        );
    }

    #[test]
    fn budget_exhaustion_never_weakens_evidence_requirements() {
        let mut harness = harness(
            BTreeSet::new(),
            RepairBudget {
                max_operations: 1,
                non_progress_limit: 5,
            },
        );
        reach_prove(&mut harness);
        harness
            .record_failure(failure("a"), Some(OperationId::from_stable("r1")))
            .unwrap();
        harness
            .complete_repair(
                &OperationId::from_stable("r1"),
                "rev-2",
                BTreeSet::from(["test".into()]),
                "one",
            )
            .unwrap();
        let effect = harness
            .record_failure(failure("b"), Some(OperationId::from_stable("r2")))
            .unwrap();
        assert_eq!(effect, TransitionEffect::RepairBudgetExhausted);
        assert_eq!(
            harness.phase(),
            &LifecyclePhase::Paused(PauseReason::RepairBudgetExhausted)
        );
        assert!(!harness.all_requirements_fresh());
    }

    #[test]
    fn requirement_change_returns_to_change_and_invalidates_targeted_proof() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        assert_eq!(harness.phase(), &LifecyclePhase::ReadyToLand);
        harness
            .requirements_changed(
                "rev-2",
                harness.requirements.clone(),
                &BTreeSet::from(["test".into()]),
            )
            .unwrap();
        assert_eq!(harness.phase(), &LifecyclePhase::Change);
        assert_eq!(
            harness.proof_records()["test"].freshness,
            Freshness::Stale(StaleReason::RequirementChange)
        );
        assert_eq!(
            harness.proof_records()["static"].fresh_for_revision,
            "rev-2"
        );
    }

    #[test]
    fn requirement_change_prunes_removed_provider_receipts() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        harness
            .requirements_changed(
                "rev-2",
                BTreeSet::from([requirement("tests", "test")]),
                &BTreeSet::from(["static".into()]),
            )
            .unwrap();
        assert!(!harness.proof_records().contains_key("static"));
        assert_eq!(harness.validate_restored(), Ok(()));
    }

    #[test]
    fn changed_build_rejects_unknown_proof_invalidation_provider() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        harness
            .requirements_changed(
                "rev-2",
                harness.requirements.clone(),
                &BTreeSet::from(["test".into()]),
            )
            .unwrap();
        harness.confirm_changed_requirements().unwrap();

        assert_eq!(
            harness.complete_changed_build("rev-2", &BTreeSet::from(["typo".into()])),
            Err(HarnessError::InvalidRepairImpact)
        );
        assert_eq!(harness.phase(), &LifecyclePhase::Build);
    }

    #[test]
    fn changed_build_with_no_missing_proof_advances_without_an_empty_prove_dead_end() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        harness
            .requirements_changed("rev-2", harness.requirements.clone(), &BTreeSet::new())
            .unwrap();
        harness.confirm_changed_requirements().unwrap();

        assert_eq!(
            harness
                .complete_changed_build("rev-2", &BTreeSet::new())
                .unwrap(),
            TransitionEffect::ReadyToLand
        );
        assert_eq!(harness.phase(), &LifecyclePhase::ReadyToLand);
    }

    #[test]
    fn risky_change_requires_clean_independent_review_and_verified_blockers() {
        let mut harness = harness(
            BTreeSet::from([RiskTrigger::SecurityBoundary]),
            RepairBudget::default(),
        );
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        assert_eq!(harness.phase(), &LifecyclePhase::Review);
        let context = ReviewContext {
            reviewer_session_id: "review-session".into(),
            implementation_session_id: "implementation-session".into(),
            clean_context: true,
            reviewer_model_family: "family-b".into(),
            implementation_model_family: "family-a".into(),
            independent_model_family_required: true,
        };
        let hypothesis = ReviewFinding {
            state: FindingState::Hypothesis,
            summary: "maybe".into(),
            blocking: true,
            reproduction_evidence: vec![],
            affected_providers: BTreeSet::new(),
            accepted_risk_authority: None,
        };
        assert_eq!(
            harness
                .submit_review("attempt-1", context.clone(), vec![hypothesis], 30)
                .unwrap_err(),
            HarnessError::UnverifiedBlockingFinding
        );
        let effect = harness
            .submit_review("attempt-2", context, vec![], 31)
            .unwrap();
        assert_eq!(effect, TransitionEffect::ReadyToLand);
        assert_eq!(harness.review_attempt_history().len(), 1);
    }

    #[test]
    fn restored_ready_state_rejects_review_from_an_older_revision() {
        let mut harness = harness(
            BTreeSet::from([RiskTrigger::SecurityBoundary]),
            RepairBudget::default(),
        );
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        let context = ReviewContext {
            reviewer_session_id: "review-session".into(),
            implementation_session_id: "implementation-session".into(),
            clean_context: true,
            reviewer_model_family: "family-b".into(),
            implementation_model_family: "family-a".into(),
            independent_model_family_required: true,
        };
        harness
            .submit_review("attempt-1", context, vec![], 30)
            .unwrap();
        harness.workspace_revision = "rev-2".into();
        for proof in harness.proofs.values_mut() {
            proof.fresh_for_revision = "rev-2".into();
        }
        assert_eq!(
            harness.validate_restored(),
            Err(HarnessError::InvalidRestoredState(
                "phase requires passed review"
            ))
        );
    }

    #[test]
    fn verified_review_blocker_returns_to_change_and_invalidates_affected_proof() {
        let mut harness = harness(
            BTreeSet::from([RiskTrigger::Concurrency]),
            RepairBudget::default(),
        );
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        let context = ReviewContext {
            reviewer_session_id: "review-session".into(),
            implementation_session_id: "implementation-session".into(),
            clean_context: true,
            reviewer_model_family: "family-b".into(),
            implementation_model_family: "family-a".into(),
            independent_model_family_required: false,
        };
        let blocker = ReviewFinding {
            state: FindingState::Verified,
            summary: "race reproduced".into(),
            blocking: true,
            reproduction_evidence: vec!["fixture://race".into()],
            affected_providers: BTreeSet::from(["test".into()]),
            accepted_risk_authority: None,
        };
        assert_eq!(
            harness
                .submit_review("attempt-1", context, vec![blocker], 30)
                .unwrap(),
            TransitionEffect::BuildRequired
        );
        assert_eq!(harness.phase(), &LifecyclePhase::Change);
        assert_eq!(
            harness.proof_records()["test"].freshness,
            Freshness::Stale(StaleReason::ReviewFinding)
        );
        assert!(!harness.review_attempt_history()[0].passed);
    }

    #[test]
    fn accepted_risk_requires_authority_and_survives_serialization() {
        let mut harness = harness(
            BTreeSet::from([RiskTrigger::SecurityBoundary]),
            RepairBudget::default(),
        );
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        let context = ReviewContext {
            reviewer_session_id: "review-session".into(),
            implementation_session_id: "implementation-session".into(),
            clean_context: true,
            reviewer_model_family: "family-b".into(),
            implementation_model_family: "family-a".into(),
            independent_model_family_required: true,
        };
        let mut finding = ReviewFinding {
            state: FindingState::AcceptedRisk,
            summary: "documented residual risk".into(),
            blocking: false,
            reproduction_evidence: vec!["evidence://residual".into()],
            affected_providers: BTreeSet::new(),
            accepted_risk_authority: None,
        };
        assert_eq!(
            harness
                .submit_review(
                    "missing-authority",
                    context.clone(),
                    vec![finding.clone()],
                    30
                )
                .unwrap_err(),
            HarnessError::AcceptedRiskAuthorityRequired
        );
        finding.accepted_risk_authority = Some(AcceptedRiskAuthority {
            authority_id: "authority-1".into(),
            actor: "release-owner".into(),
            rationale: "bounded exposure".into(),
            accepted_at_ms: 31,
        });
        harness
            .submit_review("accepted", context, vec![finding], 32)
            .unwrap();
        let restored: ConvergenceHarness =
            serde_json::from_slice(&serde_json::to_vec(&harness).unwrap()).unwrap();
        assert_eq!(restored.phase(), &LifecyclePhase::ReadyToLand);
        assert_eq!(restored.review_attempt_history().len(), 1);
        assert_eq!(
            restored.review_attempt_history()[0].findings[0]
                .accepted_risk_authority
                .as_ref()
                .unwrap()
                .actor,
            "release-owner"
        );
    }

    #[test]
    fn proof_never_lands_automatically_and_land_is_transactional() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        assert_eq!(harness.phase(), &LifecyclePhase::ReadyToLand);
        assert!(harness.land_transaction.is_none());
        let denied = LandAuthority {
            authority_id: "approval".into(),
            actor: "user".into(),
            expected_revision: "rev-1".into(),
            explicit: false,
        };
        assert_eq!(
            harness
                .request_land(denied, OperationId::from_stable("land-1"))
                .unwrap_err(),
            HarnessError::LandAuthorityRequired
        );
        let allowed = LandAuthority {
            authority_id: "approval".into(),
            actor: "user".into(),
            expected_revision: "rev-1".into(),
            explicit: true,
        };
        let transaction = harness
            .request_land(allowed, OperationId::from_stable("land-1"))
            .unwrap();
        assert!(transaction.exclusive_project_lock_required);
        assert_eq!(harness.phase(), &LifecyclePhase::Landing);
        assert_eq!(
            harness
                .complete_land(&transaction.transaction_id, false, "rev-1", "commit-1")
                .unwrap_err(),
            HarnessError::LandTransactionRejected
        );
        harness
            .complete_land(&transaction.transaction_id, true, "rev-1", "commit-1")
            .unwrap();
        assert_eq!(harness.phase(), &LifecyclePhase::Landed);
        assert_eq!(harness.validate_restored(), Ok(()));
    }

    #[test]
    fn landed_restore_binds_proof_and_review_to_the_pre_land_revision() {
        let mut harness = harness(
            BTreeSet::from([RiskTrigger::SecurityBoundary]),
            RepairBudget::default(),
        );
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        harness
            .submit_review(
                "review-1",
                ReviewContext {
                    reviewer_session_id: "review-session".into(),
                    implementation_session_id: "implementation-session".into(),
                    clean_context: true,
                    reviewer_model_family: "family-b".into(),
                    implementation_model_family: "family-a".into(),
                    independent_model_family_required: true,
                },
                vec![],
                30,
            )
            .unwrap();
        let transaction = harness
            .request_land(
                LandAuthority {
                    authority_id: "approval".into(),
                    actor: "user".into(),
                    expected_revision: "rev-1".into(),
                    explicit: true,
                },
                OperationId::from_stable("land-risky"),
            )
            .unwrap();
        harness
            .complete_land(&transaction.transaction_id, true, "rev-1", "commit-1")
            .unwrap();
        assert_eq!(harness.validate_restored(), Ok(()));

        harness.proofs.get_mut("test").unwrap().fresh_for_revision = "forged".into();
        assert_eq!(
            harness.validate_restored(),
            Err(HarnessError::InvalidRestoredState(
                "phase requires fresh proof"
            ))
        );
    }

    struct RepairDriver {
        test_attempts: usize,
        prove_calls: Vec<String>,
    }

    impl ConvergenceDriver for RepairDriver {
        fn prove(
            &mut self,
            provider: &str,
            workspace_revision: &str,
        ) -> Result<ProofReceipt, ProofFailure> {
            self.prove_calls.push(provider.into());
            match provider {
                "static" => Ok(receipt("static", "lint", workspace_revision)),
                "test" if self.test_attempts == 0 => {
                    self.test_attempts += 1;
                    Err(failure("compile-error"))
                }
                "test" => Ok(receipt("test", "tests", workspace_revision)),
                _ => unreachable!(),
            }
        }

        fn repair(
            &mut self,
            operation: &RepairOperation,
            _: &ProofFailure,
        ) -> Result<RepairResult, String> {
            assert_eq!(operation.failed_provider, "test");
            Ok(RepairResult {
                workspace_revision: "rev-2".into(),
                progress_fingerprint: "sha256:changed".into(),
                invalidated_providers: BTreeSet::from(["test".into()]),
            })
        }

        fn diagnose(&mut self, _: &str, _: &[ProofFailure]) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn convergence_executes_repair_and_targeted_reprove_without_replaying_fresh_receipt() {
        let mut harness = harness(BTreeSet::new(), RepairBudget::default());
        reach_prove(&mut harness);
        // Establish static proof first so the repair can demonstrate receipt reuse.
        harness
            .record_proof(receipt("static", "lint", "rev-1"))
            .unwrap();
        let mut driver = RepairDriver {
            test_attempts: 0,
            prove_calls: Vec::new(),
        };
        assert_eq!(
            harness.converge(&mut driver).unwrap(),
            TransitionEffect::ReadyToLand
        );
        assert_eq!(driver.prove_calls, ["test", "test"]);
        assert_eq!(harness.repair_history().len(), 1);
        let static_proof = &harness.proof_records()["static"];
        assert_eq!(static_proof.fresh_for_revision, "rev-2");
        assert_eq!(static_proof.reused_from_revision.as_deref(), Some("rev-1"));
    }

    struct Reviewer {
        observed: Option<CleanReviewRequest>,
    }

    impl IndependentReviewer for Reviewer {
        fn review(&mut self, request: &CleanReviewRequest) -> Result<CleanReviewResult, String> {
            self.observed = Some(request.clone());
            Ok(CleanReviewResult {
                reviewer_model_family: "family-b".into(),
                findings: vec![ReviewFinding {
                    state: FindingState::Hypothesis,
                    summary: "consider a wider race test".into(),
                    blocking: false,
                    reproduction_evidence: Vec::new(),
                    affected_providers: BTreeSet::new(),
                    accepted_risk_authority: None,
                }],
                completed_at_ms: 50,
            })
        }
    }

    #[test]
    fn independent_review_uses_clean_artifact_only_packet_and_typed_findings() {
        let mut harness = harness(
            BTreeSet::from([RiskTrigger::Concurrency]),
            RepairBudget::default(),
        );
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        let packet = CleanReviewRequest {
            reviewer_session_id: "clean-reviewer-session".into(),
            implementation_session_id: "implementation-session".into(),
            diff_artifact: "artifact://diff".into(),
            agreement_artifact: "artifact://agreement".into(),
            evidence_artifacts: vec!["artifact://proof".into()],
            residual_risks: vec!["concurrency".into()],
            risk_triggers: BTreeSet::from([RiskTrigger::Concurrency]),
        };
        let mut reviewer = Reviewer { observed: None };
        assert_eq!(
            harness
                .run_independent_review(
                    "review-1",
                    "family-a",
                    true,
                    packet.clone(),
                    &mut reviewer,
                )
                .unwrap(),
            TransitionEffect::ReadyToLand
        );
        assert_eq!(reviewer.observed, Some(packet));
        assert_eq!(harness.review_attempt_history()[0].findings.len(), 1);
    }

    #[test]
    fn clean_review_packet_cannot_omit_or_replace_required_risk_triggers() {
        let mut harness = harness(
            BTreeSet::from([
                RiskTrigger::Concurrency,
                RiskTrigger::MigrationPersistentData,
            ]),
            RepairBudget::default(),
        );
        reach_prove(&mut harness);
        prove_all(&mut harness, "rev-1");
        let packet = CleanReviewRequest {
            reviewer_session_id: "reviewer".into(),
            implementation_session_id: "implementation-session".into(),
            diff_artifact: "artifact://diff".into(),
            agreement_artifact: "artifact://agreement".into(),
            evidence_artifacts: vec!["artifact://proof".into()],
            residual_risks: vec![],
            risk_triggers: BTreeSet::from([RiskTrigger::Concurrency]),
        };
        let mut reviewer = Reviewer { observed: None };
        assert_eq!(
            harness
                .run_independent_review("review", "family-a", true, packet, &mut reviewer)
                .unwrap_err(),
            HarnessError::ReviewNotIndependent
        );
        assert!(reviewer.observed.is_none());
        assert!(harness.review_attempt_history().is_empty());
    }
}
