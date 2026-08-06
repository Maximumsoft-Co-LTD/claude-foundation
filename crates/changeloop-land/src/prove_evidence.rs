//! How Land presents Prove evidence to the human who authorises it.
//!
//! This module renders; it never gates. The harness decides whether a change
//! may Land. What this decides is what the human sees while deciding, and the
//! whole design is one claim: **a passing suite is not proof of correctness.**
//!
//! Three rendering rules are load-bearing, and each has a test:
//!
//! 1. **Tests render as weak evidence at every confidence level.**
//!    [`OracleConfidence::is_proof_of_correctness`] is const-false on every
//!    variant; the strongest variant,
//!    [`OracleConfidence::ChangedPathExercised`], is still labelled `WEAK` and
//!    still ends by telling the reader to read the diff. Practitioners treat a
//!    green suite as proof and stop reading the code; a renderer that draws a
//!    confident tick manufactures exactly that bias.
//! 2. **What was *not* exercised is printed above the summary.** The
//!    unexercised and unmeasured block comes first, so it can never be read as
//!    a footnote under a green headline.
//! 3. **Unavailable evidence renders as "not measured", never as clean.**
//!    [`CoverageVerdict::Unknown`] and an unavailable differential each print a
//!    `not measured` line plus the oracle's reason.
//!
//! Pacing is part of the output, not decoration: review *rate* predicts
//! defect-catch with no safe-speed threshold, so the briefing states how many
//! warnings the reader is being asked to absorb and shows the oracle's own
//! ranking rather than an unranked wall.
//!
//! Output is plain ASCII with no colour and no terminal-width probing, matching
//! the rest of the CLI surface, and is hard-wrapped by construction so it
//! survives being embedded in JSON, a log, or a narrow terminal.

use std::fs;
use std::path::Path;

use changeloop_evidence::{
    CoverageVerdict, DivergenceClass, DivergenceKind, DivergenceRank, OracleConfidence,
    OracleWarning, OracleWarningCode, ProveOracleReport, Receipt, ReceiptStore, Severity,
};
use serde_json::{Value, json};

/// Per-file unexercised/unmeasured lines shown before collapsing to a count.
const MAX_LISTED_GAPS: usize = 10;
/// Ranked divergences shown before collapsing to a count.
const MAX_LISTED_DIVERGENCES: usize = 8;

/// Why no oracle report was available. Every variant renders as "not measured";
/// none of them may render as an absence of problems.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProveEvidenceGap {
    /// No receipt exists for this change yet.
    NoReceipts,
    /// Receipts exist, but none carries a Prove oracle report.
    NoOracleReport,
    /// A receipt exists but could not be read or parsed.
    Unreadable(String),
}

impl ProveEvidenceGap {
    fn detail(&self) -> String {
        match self {
            Self::NoReceipts => "this change has no proof receipts".into(),
            Self::NoOracleReport => {
                "no proof receipt carries a Prove oracle report; the provider produced none".into()
            }
            Self::Unreadable(detail) => format!("the receipts could not be read: {detail}"),
        }
    }

    fn code(&self) -> &'static str {
        match self {
            Self::NoReceipts => "no-receipts",
            Self::NoOracleReport => "no-oracle-report",
            Self::Unreadable(_) => "unreadable",
        }
    }
}

/// The Prove evidence Land shows a human, in a form that can be rendered as
/// text or attached to the Land result as JSON.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProveEvidenceBriefing {
    /// No oracle report was found. Rendered as unmeasured, never as clean.
    Unmeasured(ProveEvidenceGap),
    /// An oracle report was found.
    Measured {
        provider: String,
        report: Box<ProveOracleReport>,
        /// Further receipts also carrying an oracle report. Reported so the
        /// reader knows the briefing is not the whole record.
        further_reports: usize,
    },
}

impl ProveEvidenceBriefing {
    /// Read the oracle report a receipt carries, if any. A receipt with no
    /// oracle extension is [`ProveEvidenceGap::NoOracleReport`], not an error:
    /// the absence is itself the evidence.
    pub fn from_receipt(receipt: &Receipt) -> Self {
        match ProveOracleReport::from_receipt(receipt) {
            Ok(Some(report)) => Self::Measured {
                provider: receipt.provider.clone(),
                report: Box::new(report),
                further_reports: 0,
            },
            Ok(None) => Self::Unmeasured(ProveEvidenceGap::NoOracleReport),
            Err(error) => Self::Unmeasured(ProveEvidenceGap::Unreadable(error.to_string())),
        }
    }

    /// This is never true. Kept as an explicit method so a caller that wants to
    /// draw a confident tick has to read the answer first.
    pub fn is_proof_of_correctness(&self) -> bool {
        match self {
            Self::Unmeasured(_) => false,
            Self::Measured { report, .. } => report.summary.confidence.is_proof_of_correctness(),
        }
    }

    pub fn report(&self) -> Option<&ProveOracleReport> {
        match self {
            Self::Unmeasured(_) => None,
            Self::Measured { report, .. } => Some(report),
        }
    }

    /// The plain-text briefing. Sections are ordered deliberately: the weak
    /// evidence statement, then what was not exercised or not measured, then
    /// the summary, then the pacing block and the oracle's own ranking.
    pub fn render(&self) -> String {
        match self {
            Self::Unmeasured(gap) => render_unmeasured(gap),
            Self::Measured {
                provider,
                report,
                further_reports,
            } => render_report(provider, report, *further_reports),
        }
    }

    /// The machine surface. Mirrors the text so a caller does not have to parse
    /// prose, and carries the rendered text so both stay in step.
    pub fn to_json(&self) -> Value {
        let mut value = match self {
            Self::Unmeasured(gap) => json!({
                "measured": false,
                "gap": gap.code(),
                "detail": gap.detail(),
                "evidenceStrength": "not-measured",
            }),
            Self::Measured {
                provider,
                report,
                further_reports,
            } => json!({
                "measured": true,
                "provider": provider,
                "changeId": report.change_id,
                "candidateRevision": report.candidate_revision,
                "evidenceStrength": strength_label(
                    report.summary.confidence,
                    report.suite_does_not_exercise_change(),
                ),
                "confidence": report.summary.confidence,
                "warningCount": report.warnings.len(),
                "highestWarningSeverity": report.summary.highest_warning_severity,
                "highestDivergenceRank": report.summary.highest_divergence_rank,
                "evidenceIncomplete": report.summary.evidence_incomplete,
                "suiteDoesNotExerciseChange": report.suite_does_not_exercise_change(),
                "furtherReports": further_reports,
            }),
        };
        if let Some(object) = value.as_object_mut() {
            object.insert("proofOfCorrectness".into(), Value::Bool(false));
            object.insert("text".into(), Value::String(self.render()));
        }
        value
    }
}

/// Load the Prove oracle briefing for one change from a receipt directory.
///
/// Never creates the directory and never fails: an unreadable or absent record
/// is rendered as unmeasured, which is the honest outcome and the one a Land
/// reader most needs to see.
pub fn read_prove_evidence(receipts_root: &Path, change_id: &str) -> ProveEvidenceBriefing {
    let directory = receipts_root.join(change_id);
    if !directory.is_dir() {
        return ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::NoReceipts);
    }
    let store = match ReceiptStore::new(receipts_root) {
        Ok(store) => store,
        Err(error) => {
            return ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::Unreadable(
                error.to_string(),
            ));
        }
    };
    let mut providers = match fs::read_dir(&directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .filter_map(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .and_then(|name| name.strip_suffix(".json"))
                    .map(str::to_string)
            })
            .collect::<Vec<_>>(),
        Err(error) => {
            return ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::Unreadable(
                error.to_string(),
            ));
        }
    };
    // Deterministic: the same receipt set always produces the same briefing.
    providers.sort();
    if providers.is_empty() {
        return ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::NoReceipts);
    }

    let mut found: Option<(String, ProveOracleReport)> = None;
    let mut further = 0usize;
    let mut failure: Option<String> = None;
    for provider in providers {
        match store.load(change_id, &provider) {
            Ok(Some(receipt)) => match ProveOracleReport::from_receipt(&receipt) {
                Ok(Some(report)) => {
                    if found.is_none() {
                        found = Some((provider, report));
                    } else {
                        further += 1;
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    failure.get_or_insert_with(|| error.to_string());
                }
            },
            Ok(None) => {}
            Err(error) => {
                failure.get_or_insert_with(|| error.to_string());
            }
        }
    }
    match found {
        Some((provider, report)) => ProveEvidenceBriefing::Measured {
            provider,
            report: Box::new(report),
            further_reports: further,
        },
        None => match failure {
            Some(detail) => ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::Unreadable(detail)),
            None => ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::NoOracleReport),
        },
    }
}

const WEAK_EVIDENCE_PREAMBLE: &str = concat!(
    "Tests are weak evidence. A passing suite shows that code ran, not that it\n",
    "is correct. Nothing below is proof of correctness."
);

const PACING_NOTE: &str = concat!(
    "  Review rate predicts defect detection with no safe threshold: reading\n",
    "  faster costs detection continuously. Budget time; do not skim."
);

fn render_unmeasured(gap: &ProveEvidenceGap) -> String {
    let mut out = String::from("Prove evidence: NOT MEASURED\n");
    out.push_str(WEAK_EVIDENCE_PREAMBLE);
    out.push_str("\n\nNOT MEASURED\n");
    out.push_str(&format!(
        "- No Prove oracle report is attached to this change ({}).\n",
        gap.detail()
    ));
    out.push_str(
        "- Nothing here says the suite exercised this change, and nothing here\n  \
         says it did not. Not measured is not the same as clean.\n\n",
    );
    out.push_str("Evidence strength: NOT MEASURED\n");
    out.push_str(
        "There is no evidence to weigh. Read the diff yourself before you land\n\
         this; no automated signal is standing behind it.\n\n",
    );
    out.push_str(
        "Attention: unbounded -- the oracle raised no warnings because it\n\
         produced no report.\n",
    );
    out.push_str(PACING_NOTE);
    out.push('\n');
    out
}

fn render_report(provider: &str, report: &ProveOracleReport, further_reports: usize) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "Prove evidence: change {} at revision {} (provider {provider})\n",
        report.change_id, report.candidate_revision
    ));
    out.push_str(WEAK_EVIDENCE_PREAMBLE);
    out.push('\n');
    if further_reports > 0 {
        out.push_str(&format!(
            "{further_reports} further oracle report(s) exist for this change and are\n\
             not shown here.\n"
        ));
    }
    out.push('\n');

    render_gaps(report, &mut out);
    out.push('\n');

    // `suite_does_not_exercise_change` is the oracle's own affordance for
    // refusing a bare green tick, so it refines the headline inside
    // `GreenButUnexercised` rather than being softened into "not fully".
    let unexercised = report.suite_does_not_exercise_change();
    out.push_str(&format!(
        "Evidence strength: {}\n",
        strength_label(report.summary.confidence, unexercised)
    ));
    out.push_str(confidence_statement(report.summary.confidence, unexercised));
    out.push('\n');
    wrap_into(
        &mut out,
        "  coverage:     ",
        "                ",
        &coverage_line(report),
    );
    wrap_into(
        &mut out,
        "  differential: ",
        "                ",
        &differential_line(report),
    );
    out.push('\n');

    render_pacing(report, &mut out);
    out
}

/// What the suite did **not** do, printed before the summary so it can never be
/// read as a footnote under a green headline.
fn render_gaps(report: &ProveOracleReport, out: &mut String) {
    let gaps: Vec<&OracleWarning> = report
        .warnings
        .iter()
        .filter(|warning| is_gap(warning.code))
        .collect();
    if gaps.is_empty() {
        out.push_str(
            "EXERCISED, NOT CHECKED\n\
             - Nothing was flagged as unexercised or unmeasured. That is the\n  \
               strongest result this oracle produces, and it is still only a\n  \
               statement about which lines ran.\n",
        );
        return;
    }
    if report.suite_does_not_exercise_change() {
        out.push_str(
            "NOT EXERCISED -- THE SUITE DOES NOT TOUCH THIS CHANGE\n\
             A green suite here is not evidence about this change at all.\n",
        );
    } else {
        out.push_str("NOT EXERCISED / NOT MEASURED\n");
    }
    for warning in gaps.iter().take(MAX_LISTED_GAPS) {
        let body = format!(
            "[{}] {}{}",
            severity_label(warning.severity),
            warning
                .subject
                .as_ref()
                .map(|subject| format!("{subject}: "))
                .unwrap_or_default(),
            warning.detail
        );
        wrap_into(out, "- ", "  ", &body);
    }
    if gaps.len() > MAX_LISTED_GAPS {
        out.push_str(&format!(
            "- and {} further unexercised or unmeasured finding(s).\n",
            gaps.len() - MAX_LISTED_GAPS
        ));
    }
    // Totals are only meaningful when something was measured; printing
    // "0 of 0 file(s)" under an unavailable report reads like a clean tally.
    if report.summary.touched_files > 0 {
        wrap_into(
            out,
            "  Totals: ",
            "  ",
            &format!(
                "{} changed line(s) never executed, {} not measured, {} of {} \
                 touched file(s) absent from the coverage report.",
                report.summary.touched_lines_uncovered,
                report.summary.touched_lines_unmeasured,
                report.summary.touched_files_not_measured,
                report.summary.touched_files
            ),
        );
    }
}

/// Hard-wrap at a fixed width with a hanging indent. Fixed rather than probed:
/// the briefing is also embedded in JSON and written to logs, where a terminal
/// width is neither available nor meaningful.
fn wrap_into(out: &mut String, prefix: &str, continuation: &str, text: &str) {
    const WIDTH: usize = 76;
    let mut column = prefix.len();
    out.push_str(prefix);
    for (index, word) in text.split_whitespace().enumerate() {
        if index > 0 {
            if column + 1 + word.len() > WIDTH {
                out.push('\n');
                out.push_str(continuation);
                column = continuation.len();
            } else {
                out.push(' ');
                column += 1;
            }
        }
        out.push_str(word);
        column += word.len();
    }
    out.push('\n');
}

/// How much attention this change is asking for, and the oracle's own ranking.
fn render_pacing(report: &ProveOracleReport, out: &mut String) {
    out.push_str(&format!(
        "Attention: {} warning(s){}.\n",
        report.warnings.len(),
        report
            .summary
            .highest_warning_severity
            .map(|severity| format!("; highest severity {}", severity_label(severity)))
            .unwrap_or_default()
    ));
    out.push_str(PACING_NOTE);
    out.push('\n');
    if report.warnings.is_empty() {
        out.push_str("  A quiet oracle is not a reason to read faster.\n");
    }

    let ranked: Vec<_> = report
        .differential
        .divergences
        .iter()
        .filter(|divergence| divergence.class == DivergenceClass::Unexpected)
        .collect();
    if ranked.is_empty() {
        return;
    }
    out.push_str("  Undeclared behaviour changes, the oracle's ranking, highest first:\n");
    for divergence in ranked.iter().take(MAX_LISTED_DIVERGENCES) {
        out.push_str(&format!(
            "  [{}] {} {}: {:?} -> {:?}\n",
            rank_label(divergence.rank),
            kind_label(divergence.kind),
            divergence.test_id,
            divergence.baseline,
            divergence.candidate,
        ));
        wrap_into(out, "      ", "      ", divergence.rule.rationale());
    }
    if ranked.len() > MAX_LISTED_DIVERGENCES {
        out.push_str(&format!(
            "  and {} further undeclared change(s), lower ranked.\n",
            ranked.len() - MAX_LISTED_DIVERGENCES
        ));
    }
    if report.summary.expected_divergences > 0 || report.summary.suppressed_divergences > 0 {
        out.push_str(&format!(
            "  {} declared and {} suppressed divergence(s) are not listed.\n",
            report.summary.expected_divergences, report.summary.suppressed_divergences
        ));
    }
}

const fn is_gap(code: OracleWarningCode) -> bool {
    matches!(
        code,
        OracleWarningCode::SuiteDoesNotExerciseChange
            | OracleWarningCode::ChangedLinesUnexercised
            | OracleWarningCode::TouchedFileNotMeasured
            | OracleWarningCode::CoverageUnavailable
            | OracleWarningCode::DifferentialUnavailable
    )
}

/// Every label carries `WEAK` or worse. There is no strong label to reach for.
const fn strength_label(confidence: OracleConfidence, unexercised: bool) -> &'static str {
    match confidence {
        OracleConfidence::UnexpectedDivergence => "UNDECLARED BEHAVIOUR CHANGE",
        OracleConfidence::Indeterminate => "NOT MEASURED",
        OracleConfidence::GreenButUnexercised if unexercised => {
            "NO EVIDENCE -- THE SUITE DOES NOT EXERCISE THIS CHANGE"
        }
        OracleConfidence::GreenButUnexercised => "WEAK -- CHANGE NOT FULLY EXERCISED",
        OracleConfidence::ChangedPathExercised => {
            "WEAK -- CHANGED PATH EXERCISED (strongest available)"
        }
    }
}

const fn confidence_statement(confidence: OracleConfidence, unexercised: bool) -> &'static str {
    if unexercised && matches!(confidence, OracleConfidence::GreenButUnexercised) {
        return concat!(
            "The suite ran, passed, and executed none of this change. The green\n",
            "result is about other code. There is no test evidence about this\n",
            "change at all; the only reviewer of these lines is you."
        );
    }
    match confidence {
        OracleConfidence::UnexpectedDivergence => concat!(
            "Behaviour changed in a way this change did not declare. Something\n",
            "moved that nobody asked to move. A human has to look before this\n",
            "lands."
        ),
        OracleConfidence::Indeterminate => concat!(
            "Coverage or differential evidence is missing, so the suite's\n",
            "relationship to this change was not measured. Not measured is not\n",
            "the same as clean; the gap is listed above."
        ),
        OracleConfidence::GreenButUnexercised => concat!(
            "The suite passed without executing all of this change. A green\n",
            "result says nothing about the code that never ran. Read the\n",
            "unexercised lines listed above."
        ),
        OracleConfidence::ChangedPathExercised => concat!(
            "The suite executed every instrumented line this change touched.\n",
            "That is the strongest signal this oracle can produce and it is\n",
            "still not proof of correctness: running a line is not the same as\n",
            "checking it. About one patch in nine that passes every developer\n",
            "test is still incorrect. Read the diff."
        ),
    }
}

fn coverage_line(report: &ProveOracleReport) -> String {
    let summary = &report.summary;
    match &summary.coverage_verdict {
        CoverageVerdict::ChangedPathExercised => format!(
            "every instrumented changed line ran ({} line(s), {} file(s))",
            summary.touched_lines_covered, summary.touched_files
        ),
        CoverageVerdict::ChangedPathPartiallyExercised => format!(
            "partial -- {} of {} instrumented changed line(s) ran",
            summary.touched_lines_covered,
            summary.touched_lines_covered + summary.touched_lines_uncovered
        ),
        CoverageVerdict::ChangedPathUnexercised => format!(
            "none of the {} instrumented changed line(s) ran",
            summary.touched_lines_uncovered
        ),
        CoverageVerdict::NoExecutableChange => {
            "the change touched no instrumented lines; the suite says nothing \
             about it either way"
                .into()
        }
        CoverageVerdict::Unknown(_) => {
            "not measured -- reason listed above; not measured is not clean".into()
        }
    }
}

fn differential_line(report: &ProveOracleReport) -> String {
    if !report.differential.is_available() {
        return "not measured -- behaviour at the pre-change revision was not \
                compared; not measured is not unchanged"
            .into();
    }
    format!(
        "{} undeclared, {} declared, {} suppressed across {} test(s)",
        report.summary.unexpected_divergences,
        report.summary.expected_divergences,
        report.summary.suppressed_divergences,
        report.differential.candidate_tests
    )
}

const fn severity_label(severity: Severity) -> &'static str {
    match severity {
        Severity::Info => "info",
        Severity::Low => "low",
        Severity::Medium => "medium",
        Severity::High => "high",
        Severity::Critical => "critical",
    }
}

const fn rank_label(rank: DivergenceRank) -> &'static str {
    match rank {
        DivergenceRank::Suppressed => "suppressed",
        DivergenceRank::Informational => "info",
        DivergenceRank::Low => "low",
        DivergenceRank::Medium => "medium",
        DivergenceRank::High => "high",
        DivergenceRank::Critical => "critical",
    }
}

const fn kind_label(kind: DivergenceKind) -> &'static str {
    match kind {
        DivergenceKind::NewlyFailing => "newly failing",
        DivergenceKind::NewlyPassing => "newly passing",
        DivergenceKind::NewlySkipped => "newly skipped",
        DivergenceKind::NoLongerSkipped => "no longer skipped",
        DivergenceKind::Removed => "removed",
        DivergenceKind::Added => "added",
        DivergenceKind::StatusChanged => "status changed",
    }
}
