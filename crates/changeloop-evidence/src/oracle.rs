//! The Prove oracle report: coverage delta plus differential testing, joined
//! into one machine-readable evidence part.
//!
//! This module produces a *signal*, never a gate. Nothing here decides whether
//! a change may Land; the harness does that. What it guarantees is that the
//! harness — and the human at Land — is never handed a green suite without
//! being told what that suite did and did not exercise.
//!
//! The report is designed to be rendered without parsing prose: every headline
//! is a typed enum, every count is precomputed, and every "unavailable" case
//! carries its reason.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::coverage::{CoverageDelta, CoverageUnavailable, CoverageVerdict, TouchedFileStatus};
use crate::divergence::{
    DifferentialReport, DifferentialUnavailable, DivergenceClass, DivergenceRank,
};
use crate::{EvidenceError, Receipt};

pub const ORACLE_VERSION: u8 = 1;

/// Receipt extension key. [`Receipt::extensions`] is a flattened map, so the
/// report round-trips through the existing receipt schema without a version
/// bump and without a parallel store.
pub const ORACLE_RECEIPT_EXTENSION: &str = "proveOracle";

/// Attention ordering for warnings. Separate from [`DivergenceRank`] because a
/// warning is never "suppressed"; a suppressed divergence emits no warning.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OracleWarningCode {
    /// The suite executed none of the change's instrumented lines. The single
    /// most important output of the oracle: it converts a green suite from a
    /// false proof into an honest signal.
    SuiteDoesNotExerciseChange,
    /// Specific changed lines were instrumented and never executed.
    ChangedLinesUnexercised,
    /// A touched file does not appear in the coverage report, so its
    /// relationship to the suite is unknown.
    TouchedFileNotMeasured,
    /// No usable coverage evidence at all.
    CoverageUnavailable,
    /// No usable differential evidence at all.
    DifferentialUnavailable,
    /// A ranked behavioural difference the change did not declare.
    UnexpectedDivergence,
    /// A suppression rule matched nothing and should be retired.
    StaleSuppressionRule,
    /// The divergence list was capped.
    DivergencesTruncated,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OracleWarning {
    pub code: OracleWarningCode,
    pub severity: Severity,
    /// The file path, test id, or rule id the warning is about.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub detail: String,
}

/// The headline. Every variant is explicitly *not* a statement of correctness;
/// the strongest available result still only says the suite ran the change.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OracleConfidence {
    /// A behavioural difference the change did not declare. A human must look.
    UnexpectedDivergence,
    /// Coverage or differential evidence is missing. Absence of evidence —
    /// which is never evidence of absence.
    Indeterminate,
    /// The suite ran, but did not exercise part or all of the change.
    GreenButUnexercised,
    /// Every instrumented changed line ran and no undeclared difference
    /// appeared. The strongest signal this oracle can produce, and still not
    /// proof of correctness.
    ChangedPathExercised,
}

impl OracleConfidence {
    /// Deliberately const-false on every variant. Tests are weak evidence; the
    /// oracle never claims otherwise, and a renderer cannot make it.
    pub const fn is_proof_of_correctness(self) -> bool {
        false
    }

    /// True when a human should be paced through this rather than shown a tick.
    pub const fn requires_human_attention(self) -> bool {
        !matches!(self, Self::ChangedPathExercised)
    }
}

/// Precomputed counts so a renderer never re-derives them from the detail lists.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OracleSummary {
    pub confidence: OracleConfidence,
    pub coverage_verdict: CoverageVerdict,
    pub touched_files: usize,
    pub touched_files_not_measured: usize,
    pub touched_lines_covered: usize,
    pub touched_lines_uncovered: usize,
    pub touched_lines_unmeasured: usize,
    pub unexpected_divergences: usize,
    pub expected_divergences: usize,
    pub suppressed_divergences: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highest_divergence_rank: Option<DivergenceRank>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highest_warning_severity: Option<Severity>,
    /// True when either evidence source is unavailable. A renderer must show
    /// the gap rather than an empty section.
    pub evidence_incomplete: bool,
}

/// The complete Prove oracle evidence part for one change at one revision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProveOracleReport {
    pub version: u8,
    pub change_id: String,
    pub candidate_revision: String,
    pub coverage: CoverageDelta,
    pub differential: DifferentialReport,
    /// Sorted by severity descending, then code, then subject. Deterministic.
    pub warnings: Vec<OracleWarning>,
    pub summary: OracleSummary,
}

impl ProveOracleReport {
    /// Join coverage and differential evidence, derive warnings, and compute
    /// the summary. Pure: no I/O, no clock, no environment.
    pub fn new(
        change_id: impl Into<String>,
        candidate_revision: impl Into<String>,
        coverage: CoverageDelta,
        differential: DifferentialReport,
    ) -> Self {
        let mut warnings = Vec::new();
        collect_coverage_warnings(&coverage, &mut warnings);
        collect_differential_warnings(&differential, &mut warnings);
        warnings.sort_by(|left, right| {
            right
                .severity
                .cmp(&left.severity)
                .then_with(|| format!("{:?}", left.code).cmp(&format!("{:?}", right.code)))
                .then_with(|| left.subject.cmp(&right.subject))
        });

        let confidence = confidence(&coverage, &differential);
        let evidence_incomplete =
            matches!(coverage.verdict, CoverageVerdict::Unknown(_)) || !differential.is_available();
        let summary = OracleSummary {
            confidence,
            coverage_verdict: coverage.verdict.clone(),
            touched_files: coverage.touched_files,
            touched_files_not_measured: coverage.files_not_measured,
            touched_lines_covered: coverage.touched_lines_covered,
            touched_lines_uncovered: coverage.touched_lines_uncovered,
            touched_lines_unmeasured: coverage.touched_lines_unmeasured,
            unexpected_divergences: differential.unexpected,
            expected_divergences: differential.expected,
            suppressed_divergences: differential.suppressed,
            highest_divergence_rank: differential.highest_rank(),
            highest_warning_severity: warnings.iter().map(|warning| warning.severity).max(),
            evidence_incomplete,
        };

        Self {
            version: ORACLE_VERSION,
            change_id: change_id.into(),
            candidate_revision: candidate_revision.into(),
            coverage,
            differential,
            warnings,
            summary,
        }
    }

    /// The warning that matters most, if any.
    pub fn headline_warning(&self) -> Option<&OracleWarning> {
        self.warnings.first()
    }

    pub fn warnings_with(&self, code: OracleWarningCode) -> impl Iterator<Item = &OracleWarning> {
        self.warnings
            .iter()
            .filter(move |warning| warning.code == code)
    }

    /// True when the suite provably failed to touch the change. The affordance
    /// a Land renderer keys on to refuse to draw a bare green tick.
    pub fn suite_does_not_exercise_change(&self) -> bool {
        self.coverage.verdict == CoverageVerdict::ChangedPathUnexercised
    }

    /// Attach to a receipt under [`ORACLE_RECEIPT_EXTENSION`], following the
    /// crate's existing flattened-extension convention.
    pub fn attach_to_receipt(&self, receipt: &mut Receipt) -> Result<(), EvidenceError> {
        receipt.extensions.insert(
            ORACLE_RECEIPT_EXTENSION.to_string(),
            serde_json::to_value(self)?,
        );
        Ok(())
    }

    /// Read back a report attached to a receipt. `Ok(None)` means the provider
    /// produced no oracle evidence — which is itself worth surfacing, and is
    /// deliberately distinct from an empty report.
    pub fn from_receipt(receipt: &Receipt) -> Result<Option<Self>, EvidenceError> {
        let Some(value) = receipt.extensions.get(ORACLE_RECEIPT_EXTENSION) else {
            return Ok(None);
        };
        Ok(Some(serde_json::from_value(value.clone())?))
    }

    pub fn to_json(&self) -> Result<Value, EvidenceError> {
        Ok(serde_json::to_value(self)?)
    }
}

/// Confidence precedence, highest concern first:
///
/// 1. any unexpected divergence → [`OracleConfidence::UnexpectedDivergence`];
/// 2. else coverage unknown or differential unavailable →
///    [`OracleConfidence::Indeterminate`];
/// 3. else coverage verdict is anything but fully exercised →
///    [`OracleConfidence::GreenButUnexercised`];
/// 4. else [`OracleConfidence::ChangedPathExercised`].
///
/// Missing evidence outranks a good coverage verdict, and a good coverage
/// verdict never masks a missing one: the warning list carries both regardless.
fn confidence(coverage: &CoverageDelta, differential: &DifferentialReport) -> OracleConfidence {
    if differential.unexpected > 0 {
        return OracleConfidence::UnexpectedDivergence;
    }
    if matches!(coverage.verdict, CoverageVerdict::Unknown(_)) || !differential.is_available() {
        return OracleConfidence::Indeterminate;
    }
    if coverage.verdict.is_evidence_of_exercise() {
        OracleConfidence::ChangedPathExercised
    } else {
        OracleConfidence::GreenButUnexercised
    }
}

fn collect_coverage_warnings(coverage: &CoverageDelta, warnings: &mut Vec<OracleWarning>) {
    match &coverage.verdict {
        CoverageVerdict::Unknown(reason) => warnings.push(OracleWarning {
            code: OracleWarningCode::CoverageUnavailable,
            severity: Severity::High,
            subject: None,
            detail: format!(
                "coverage unavailable ({}); the suite's relationship to this change is unknown, \
                 which is not the same as clean",
                unavailable_label(reason)
            ),
        }),
        CoverageVerdict::ChangedPathUnexercised => warnings.push(OracleWarning {
            code: OracleWarningCode::SuiteDoesNotExerciseChange,
            severity: Severity::Critical,
            subject: None,
            detail: format!(
                "this suite does not exercise the changed path: {} instrumented changed line(s) \
                 across {} file(s) and none were executed",
                coverage.touched_lines_uncovered, coverage.touched_files
            ),
        }),
        CoverageVerdict::NoExecutableChange => warnings.push(OracleWarning {
            code: OracleWarningCode::ChangedLinesUnexercised,
            severity: Severity::Info,
            subject: None,
            detail: "the change touched no instrumented lines; the suite proves nothing about it \
                     either way"
                .into(),
        }),
        CoverageVerdict::ChangedPathPartiallyExercised | CoverageVerdict::ChangedPathExercised => {}
    }

    for file in &coverage.files {
        match file.status {
            TouchedFileStatus::NotInReport | TouchedFileStatus::AmbiguousInReport => {
                warnings.push(OracleWarning {
                    code: OracleWarningCode::TouchedFileNotMeasured,
                    severity: Severity::Medium,
                    subject: Some(file.path.clone()),
                    detail: format!(
                        "{} changed line(s) in this file were not measured ({}); coverage here is \
                         unknown, not zero",
                        file.unmeasured_lines.len(),
                        match file.status {
                            TouchedFileStatus::AmbiguousInReport =>
                                "several coverage entries could be this file",
                            _ => "the file is absent from the coverage report",
                        }
                    ),
                });
            }
            TouchedFileStatus::Measured if !file.uncovered_lines.is_empty() => {
                warnings.push(OracleWarning {
                    code: OracleWarningCode::ChangedLinesUnexercised,
                    severity: Severity::High,
                    subject: Some(file.path.clone()),
                    detail: format!(
                        "{} changed line(s) are instrumented and were never executed: {}",
                        file.uncovered_lines.len(),
                        summarize_lines(&file.uncovered_lines)
                    ),
                });
            }
            _ => {}
        }
    }
}

fn collect_differential_warnings(
    differential: &DifferentialReport,
    warnings: &mut Vec<OracleWarning>,
) {
    if let Some(reason) = &differential.unavailable {
        warnings.push(OracleWarning {
            code: OracleWarningCode::DifferentialUnavailable,
            severity: Severity::Medium,
            subject: None,
            detail: format!(
                "differential evidence unavailable ({}); behaviour at the pre-change revision was \
                 not compared, which is not the same as unchanged",
                differential_label(reason)
            ),
        });
        return;
    }
    for divergence in &differential.divergences {
        if divergence.class != DivergenceClass::Unexpected {
            continue;
        }
        warnings.push(OracleWarning {
            code: OracleWarningCode::UnexpectedDivergence,
            severity: match divergence.rank {
                DivergenceRank::Critical => Severity::Critical,
                DivergenceRank::High => Severity::High,
                DivergenceRank::Medium => Severity::Medium,
                DivergenceRank::Low => Severity::Low,
                _ => Severity::Info,
            },
            subject: Some(divergence.test_id.clone()),
            detail: format!(
                "{:?} -> {:?}: {}",
                divergence.baseline,
                divergence.candidate,
                divergence.rule.rationale()
            ),
        });
    }
    for rule in &differential.stale_suppression_rules {
        warnings.push(OracleWarning {
            code: OracleWarningCode::StaleSuppressionRule,
            severity: Severity::Info,
            subject: Some(rule.clone()),
            detail: "this suppression rule matched no divergence in this run and can be retired"
                .into(),
        });
    }
    if differential.truncated {
        warnings.push(OracleWarning {
            code: OracleWarningCode::DivergencesTruncated,
            severity: Severity::Medium,
            subject: None,
            detail: "the divergence list was capped; more differences exist than are listed".into(),
        });
    }
}

fn unavailable_label(reason: &CoverageUnavailable) -> String {
    match reason {
        CoverageUnavailable::NoToolConfigured => "no coverage tool configured".into(),
        CoverageUnavailable::ReportMissing { expected_path } => {
            format!("no report at {expected_path}")
        }
        CoverageUnavailable::ReportUnreadable { detail } => format!("report unreadable: {detail}"),
        CoverageUnavailable::ReportUnparsable { detail } => format!("report unparsable: {detail}"),
        CoverageUnavailable::TouchedFilesNotInReport => {
            "no touched file appears in the report".into()
        }
        CoverageUnavailable::NoTouchedFiles => "the change touched no files".into(),
    }
}

fn differential_label(reason: &DifferentialUnavailable) -> String {
    match reason {
        DifferentialUnavailable::NoBaselineRevision => "no pre-change revision".into(),
        DifferentialUnavailable::NotAttempted => "the baseline run was not attempted".into(),
        DifferentialUnavailable::BaselineRunFailed { detail } => {
            format!("the baseline run failed: {detail}")
        }
        DifferentialUnavailable::RunUnparsable { detail } => {
            format!("run output unparsable: {detail}")
        }
        DifferentialUnavailable::HarnessMismatch {
            baseline,
            candidate,
        } => format!("harness mismatch: {baseline} vs {candidate}"),
    }
}

/// Render a line set as compact ranges: `12-14, 20`.
fn summarize_lines(lines: &std::collections::BTreeSet<u32>) -> String {
    let mut ranges: Vec<String> = Vec::new();
    let mut iterator = lines.iter().copied();
    let Some(mut start) = iterator.next() else {
        return String::new();
    };
    let mut end = start;
    for line in iterator {
        if line == end + 1 {
            end = line;
            continue;
        }
        ranges.push(range_label(start, end));
        start = line;
        end = line;
    }
    ranges.push(range_label(start, end));
    ranges.join(", ")
}

fn range_label(start: u32, end: u32) -> String {
    if start == end {
        start.to_string()
    } else {
        format!("{start}-{end}")
    }
}
