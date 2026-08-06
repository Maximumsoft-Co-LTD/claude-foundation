//! Land's Prove-evidence rendering contract.
//!
//! These tests pin honesty, not layout. Each one names a way the rendering
//! could quietly become a confident gate: proof language at the strongest
//! confidence, an unexercised change buried under a green summary, missing
//! evidence reading as clean, an unranked divergence wall, or a receipt with no
//! oracle report rendering as nothing at all.

use std::collections::{BTreeMap, BTreeSet};

use changeloop_evidence::{
    CoverageDelta, CoverageUnavailable, DeclaredIntent, DifferentialReport,
    DifferentialUnavailable, InputIdentity, Provenance, RECEIPT_VERSION, Receipt, ReceiptStatus,
    ReceiptStore, Severity, SuppressionLedger, TestHarnessFormat, TestOutcome, TestRun, TestStatus,
    TouchedLines, coverage_delta, differential_report, parse_coverage_report,
};
use changeloop_land::{ProveEvidenceBriefing, ProveEvidenceGap, read_prove_evidence};
use tempfile::tempdir;

const LCOV_ALL_RUN: &str = "\
SF:src/order.rs
DA:10,4
DA:11,2
end_of_record
";

const LCOV_NONE_RUN: &str = "\
SF:src/order.rs
DA:10,0
DA:11,0
end_of_record
";

const LCOV_PARTIAL_RUN: &str = "\
SF:src/order.rs
DA:10,4
DA:11,0
end_of_record
";

fn touched() -> TouchedLines {
    let mut touched = TouchedLines::new();
    touched.extend_file("src/order.rs", [10, 11]);
    touched
}

fn coverage(text: &str) -> CoverageDelta {
    let report = parse_coverage_report(text).expect("report parses");
    coverage_delta(&touched(), Some(&report))
}

fn clean_differential() -> DifferentialReport {
    let run = |revision: &str| {
        TestRun::new(
            revision,
            TestHarnessFormat::Libtest,
            vec![TestOutcome {
                id: "order::totals".into(),
                status: TestStatus::Passed,
                file: Some("src/order.rs".into()),
            }],
        )
    };
    differential_report(
        &run("rev-0"),
        &run("rev-1"),
        &DeclaredIntent::from_touched(&touched()),
        &SuppressionLedger::default(),
    )
}

/// Two undeclared regressions plus an undeclared removal, so the oracle has
/// something to rank and the renderer has to respect that ranking.
fn diverging_differential() -> DifferentialReport {
    let outcome = |id: &str, status: TestStatus| TestOutcome {
        id: id.into(),
        status,
        file: Some("src/elsewhere.rs".into()),
    };
    let baseline = TestRun::new(
        "rev-0",
        TestHarnessFormat::Libtest,
        vec![
            outcome("billing::critical", TestStatus::Passed),
            outcome("billing::skipped", TestStatus::Passed),
            outcome("billing::low", TestStatus::Failed),
        ],
    );
    let candidate = TestRun::new(
        "rev-1",
        TestHarnessFormat::Libtest,
        vec![
            outcome("billing::critical", TestStatus::Failed),
            outcome("billing::skipped", TestStatus::Skipped),
            outcome("billing::low", TestStatus::Passed),
        ],
    );
    differential_report(
        &baseline,
        &candidate,
        &DeclaredIntent::from_touched(&touched()),
        &SuppressionLedger::default(),
    )
}

fn briefing(coverage: CoverageDelta, differential: DifferentialReport) -> ProveEvidenceBriefing {
    ProveEvidenceBriefing::Measured {
        provider: "cargo-test".into(),
        report: Box::new(changeloop_evidence::ProveOracleReport::new(
            "change-1",
            "rev-1",
            coverage,
            differential,
        )),
        further_reports: 0,
    }
}

/// Collapse the hanging-indent wrapping so a detail sentence can be asserted
/// without pinning where the renderer chose to break the line.
fn flat(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn receipt_fixture() -> Receipt {
    Receipt {
        version: RECEIPT_VERSION,
        change_id: "change-1".into(),
        provider: "cargo-test".into(),
        provider_version: "1".into(),
        adapter: "external".into(),
        adapter_protocol_version: "adapter-v1".into(),
        provider_protocol_version: "provider-v1".into(),
        contract_fingerprint: "contract-a".into(),
        execution_fingerprint: "execution-a".into(),
        provider_fingerprint: "provider-a".into(),
        workspace_hash: "workspace-a".into(),
        workspace_snapshot_id: None,
        input_identity: InputIdentity::global("workspace-a").expect("identity"),
        claims: BTreeSet::from(["claim-a".to_string()]),
        status: ReceiptStatus::Pass,
        observed: "command passed".into(),
        provenance: Provenance {
            source: Some("command:cargo-test".into()),
            recorded_by: None,
        },
        references: vec![],
        artifacts: vec![],
        proof_run_id: "run-1".into(),
        started_at: "2026-08-05T00:00:00Z".into(),
        finished_at: "2026-08-05T00:00:01Z".into(),
        extensions: BTreeMap::new(),
    }
}

// --- rule 1: tests are weak evidence at every confidence level -------------

#[test]
fn strongest_confidence_still_renders_as_weak_evidence_and_never_as_proof() {
    let briefing = briefing(coverage(LCOV_ALL_RUN), clean_differential());
    let text = briefing.render();

    assert!(!briefing.is_proof_of_correctness());
    assert!(
        text.contains("Evidence strength: WEAK -- CHANGED PATH EXERCISED (strongest available)"),
        "{text}"
    );
    assert!(text.contains("still not proof of correctness"), "{text}");
    assert!(text.contains("Read the diff."), "{text}");
    for forbidden in ["verified", "proven", "guaranteed", "correctness proved"] {
        assert!(
            !text.to_lowercase().contains(forbidden),
            "strongest confidence must not read as {forbidden}: {text}"
        );
    }
}

#[test]
fn every_confidence_level_opens_with_the_weak_evidence_statement() {
    for (coverage, differential) in [
        (coverage(LCOV_ALL_RUN), clean_differential()),
        (coverage(LCOV_PARTIAL_RUN), clean_differential()),
        (
            CoverageDelta::unavailable(CoverageUnavailable::NoToolConfigured),
            clean_differential(),
        ),
        (coverage(LCOV_ALL_RUN), diverging_differential()),
    ] {
        let briefing = briefing(coverage, differential);
        let text = briefing.render();
        assert!(
            text.contains("Tests are weak evidence."),
            "missing weak-evidence preamble: {text}"
        );
        assert!(
            text.contains("Nothing below is proof of correctness."),
            "missing proof disclaimer: {text}"
        );
        assert!(!briefing.is_proof_of_correctness());
        assert_eq!(briefing.to_json()["proofOfCorrectness"], false);
    }
}

// --- rule 2: what was not exercised comes first ---------------------------

#[test]
fn an_unexercised_change_surfaces_its_warning_above_the_summary() {
    let briefing = briefing(coverage(LCOV_NONE_RUN), clean_differential());
    let text = briefing.render();

    let warning = text
        .find("NOT EXERCISED -- THE SUITE DOES NOT TOUCH THIS CHANGE")
        .expect("unexercised headline is rendered");
    let summary = text
        .find("Evidence strength:")
        .expect("summary is rendered");
    assert!(
        warning < summary,
        "the unexercised warning must precede the summary: {text}"
    );
    assert!(
        text.contains("A green suite here is not evidence about this change at all."),
        "{text}"
    );
    assert!(
        text.contains("none of the 2 instrumented changed line(s) ran"),
        "{text}"
    );
    // The summary must not soften "nothing ran" into "not fully exercised".
    assert!(
        text.contains("Evidence strength: NO EVIDENCE -- THE SUITE DOES NOT EXERCISE THIS CHANGE"),
        "{text}"
    );
    assert_eq!(briefing.to_json()["suiteDoesNotExerciseChange"], true);
}

#[test]
fn partially_exercised_lines_are_listed_before_the_summary() {
    let briefing = briefing(coverage(LCOV_PARTIAL_RUN), clean_differential());
    let text = briefing.render();

    let gaps = text
        .find("NOT EXERCISED / NOT MEASURED")
        .expect("gap block is rendered");
    let summary = text
        .find("Evidence strength:")
        .expect("summary is rendered");
    assert!(gaps < summary, "{text}");
    assert!(
        flat(&text).contains("1 changed line(s) are instrumented and were never executed: 11"),
        "{text}"
    );
    assert!(
        text.contains("Evidence strength: WEAK -- CHANGE NOT FULLY EXERCISED"),
        "{text}"
    );
}

// --- rule 3: unavailable evidence is "not measured", never clean ----------

#[test]
fn unavailable_coverage_renders_as_not_measured_rather_than_clean() {
    let briefing = briefing(
        CoverageDelta::unavailable(CoverageUnavailable::NoToolConfigured),
        clean_differential(),
    );
    let text = briefing.render();

    assert!(text.contains("Evidence strength: NOT MEASURED"), "{text}");
    assert!(
        flat(&text)
            .contains("coverage: not measured -- reason listed above; not measured is not clean"),
        "{text}"
    );
    assert!(
        text.contains("Not measured is not\nthe same as clean"),
        "{text}"
    );
    assert!(text.contains("no coverage tool configured"), "{text}");
    assert_eq!(briefing.to_json()["evidenceIncomplete"], true);
}

#[test]
fn unavailable_differential_renders_as_not_measured_rather_than_unchanged() {
    let briefing = briefing(
        coverage(LCOV_ALL_RUN),
        DifferentialReport::unavailable(DifferentialUnavailable::NoBaselineRevision),
    );
    let text = briefing.render();

    assert!(text.contains("Evidence strength: NOT MEASURED"), "{text}");
    assert!(
        flat(&text).contains(
            "differential: not measured -- behaviour at the pre-change revision was not \
             compared; not measured is not unchanged"
        ),
        "{text}"
    );
    assert!(text.contains("no pre-change revision"), "{text}");
}

// --- rule 4: pacing and the oracle's own ranking ---------------------------

#[test]
fn pacing_surfaces_warning_load_and_highest_severity() {
    let briefing = briefing(coverage(LCOV_NONE_RUN), diverging_differential());
    let text = briefing.render();
    let report = briefing.report().expect("measured");

    assert_eq!(
        report.summary.highest_warning_severity,
        Some(Severity::Critical)
    );
    assert!(
        text.contains(&format!(
            "Attention: {} warning(s); highest severity critical.",
            report.warnings.len()
        )),
        "{text}"
    );
    assert!(
        text.contains("Review rate predicts defect detection with no safe threshold"),
        "{text}"
    );
    assert!(text.contains("do not skim"), "{text}");
    assert_eq!(
        briefing.to_json()["warningCount"],
        report.warnings.len() as u64
    );
}

#[test]
fn divergences_render_in_the_oracles_rank_order() {
    let briefing = briefing(coverage(LCOV_ALL_RUN), diverging_differential());
    let text = briefing.render();

    let critical = text
        .find("billing::critical")
        .expect("critical divergence listed");
    let skipped = text
        .find("billing::skipped")
        .expect("high divergence listed");
    let low = text.find("billing::low").expect("low divergence listed");
    assert!(
        critical < skipped && skipped < low,
        "divergences must keep the oracle's ranking: {text}"
    );
    assert!(
        text.contains("Undeclared behaviour changes, the oracle's ranking, highest first:"),
        "{text}"
    );
    assert!(
        text.contains("Evidence strength: UNDECLARED BEHAVIOUR CHANGE"),
        "{text}"
    );
}

// --- degradation -----------------------------------------------------------

#[test]
fn a_receipt_without_an_oracle_report_degrades_to_not_measured() {
    let briefing = ProveEvidenceBriefing::from_receipt(&receipt_fixture());

    assert_eq!(
        briefing,
        ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::NoOracleReport)
    );
    let text = briefing.render();
    assert!(text.contains("Prove evidence: NOT MEASURED"), "{text}");
    assert!(
        text.contains("Not measured is not the same as clean."),
        "{text}"
    );
    assert!(
        text.contains("Read the diff yourself before you land"),
        "{text}"
    );
    assert!(!briefing.is_proof_of_correctness());
    assert_eq!(briefing.to_json()["measured"], false);
}

#[test]
fn a_missing_receipt_directory_renders_as_not_measured_without_creating_it() {
    let directory = tempdir().expect("temp dir");
    let receipts = directory.path().join("receipts");

    let briefing = read_prove_evidence(&receipts, "change-1");

    assert_eq!(
        briefing,
        ProveEvidenceBriefing::Unmeasured(ProveEvidenceGap::NoReceipts)
    );
    assert!(!receipts.exists(), "reading must not create the store");
    assert!(briefing.render().contains("NOT MEASURED"));
}

#[test]
fn a_stored_receipt_carrying_an_oracle_report_is_read_back_and_rendered() {
    let directory = tempdir().expect("temp dir");
    let receipts = directory.path().join("receipts");
    let store = ReceiptStore::new(&receipts).expect("store");
    let mut receipt = receipt_fixture();
    changeloop_evidence::ProveOracleReport::new(
        "change-1",
        "rev-1",
        coverage(LCOV_NONE_RUN),
        clean_differential(),
    )
    .attach_to_receipt(&mut receipt)
    .expect("attach");
    store.record(&receipt).expect("record");

    let briefing = read_prove_evidence(&receipts, "change-1");

    let report = briefing.report().expect("oracle report is read back");
    assert!(report.suite_does_not_exercise_change());
    assert!(
        briefing
            .render()
            .contains("NOT EXERCISED -- THE SUITE DOES NOT TOUCH THIS CHANGE")
    );
    assert_eq!(briefing.to_json()["provider"], "cargo-test");
}
