//! Prove-oracle evidence: coverage delta on touched lines, the
//! unexercised-path warning, ranked divergence classification, suppression, and
//! honest degradation when coverage or a baseline run is unavailable.

use std::collections::BTreeSet;

use changeloop_evidence::coverage::{
    CoverageFormat, TouchedFileStatus, parse_cobertura, parse_lcov,
};
use changeloop_evidence::divergence::{
    DIVERGENCE_VERSION, SuppressionLedger, parse_jest_json_outcomes, parse_libtest_outcomes,
    parse_pytest_outcomes,
};
use changeloop_evidence::*;
use serde_json::json;
use tempfile::tempdir;

const LCOV: &str = "\
TN:
SF:src/order.rs
DA:10,4
DA:11,0
DA:12,7
DA:40,1
end_of_record
TN:
SF:src/untouched.rs
DA:1,3
end_of_record
";

fn touched(path: &str, lines: &[u32]) -> TouchedLines {
    let mut touched = TouchedLines::new();
    touched.extend_file(path, lines.iter().copied());
    touched
}

fn report(text: &str) -> CoverageReport {
    parse_coverage_report(text).expect("report parses")
}

// --- coverage delta on touched lines -------------------------------------

#[test]
fn coverage_delta_classifies_touched_lines_as_covered_uncovered_or_unmeasured() {
    // 10 and 12 are instrumented and executed, 11 is instrumented and never
    // executed, 13 has no record at all and must not be called uncovered.
    let delta = coverage_delta(
        &touched("src/order.rs", &[10, 11, 12, 13]),
        Some(&report(LCOV)),
    );

    assert_eq!(
        delta.verdict,
        CoverageVerdict::ChangedPathPartiallyExercised
    );
    assert_eq!(delta.format, Some(CoverageFormat::Lcov));
    assert_eq!(delta.touched_lines_covered, 2);
    assert_eq!(delta.touched_lines_uncovered, 1);
    assert_eq!(delta.touched_lines_unmeasured, 1);

    let file = &delta.files[0];
    assert_eq!(file.status, TouchedFileStatus::Measured);
    assert_eq!(file.covered_lines, BTreeSet::from([10, 12]));
    assert_eq!(file.uncovered_lines, BTreeSet::from([11]));
    assert_eq!(file.unmeasured_lines, BTreeSet::from([13]));
}

#[test]
fn coverage_delta_reports_full_exercise_only_when_every_instrumented_line_ran() {
    let delta = coverage_delta(&touched("src/order.rs", &[10, 12, 40]), Some(&report(LCOV)));
    assert_eq!(delta.verdict, CoverageVerdict::ChangedPathExercised);
    assert!(delta.verdict.is_evidence_of_exercise());
    assert!(!delta.verdict.warrants_warning());
}

#[test]
fn coverage_delta_matches_report_paths_by_component_boundary_suffix() {
    let text = "SF:/build/ci/workspace/src/order.rs\nDA:10,2\nend_of_record\n";
    let delta = coverage_delta(&touched("src/order.rs", &[10]), Some(&report(text)));
    assert_eq!(delta.verdict, CoverageVerdict::ChangedPathExercised);

    // `order.rs` must not match `disorder.rs`: the boundary check forbids it.
    let text = "SF:src/disorder.rs\nDA:10,2\nend_of_record\n";
    let delta = coverage_delta(&touched("order.rs", &[10]), Some(&report(text)));
    assert_eq!(delta.files[0].status, TouchedFileStatus::NotInReport);
}

#[test]
fn coverage_delta_flags_ambiguous_report_paths_instead_of_guessing() {
    let text = "\
SF:packages/a/src/order.rs
DA:10,5
end_of_record
SF:packages/b/src/order.rs
DA:10,0
end_of_record
";
    let delta = coverage_delta(&touched("src/order.rs", &[10]), Some(&report(text)));
    assert_eq!(delta.files[0].status, TouchedFileStatus::AmbiguousInReport);
    assert_eq!(
        delta.verdict,
        CoverageVerdict::Unknown(CoverageUnavailable::TouchedFilesNotInReport)
    );
}

#[test]
fn cobertura_and_lcov_produce_the_same_touched_line_delta() {
    let cobertura = r#"<?xml version="1.0" ?>
<coverage version="1">
  <packages><package name="src"><classes>
    <class name="order" filename="src/order.rs">
      <lines>
        <line number="10" hits="4"/>
        <line number="11" hits="0"/>
        <line number="12" hits="7"/>
      </lines>
    </class>
  </classes></package></packages>
</coverage>
"#;
    let parsed = parse_cobertura(cobertura).expect("cobertura parses");
    assert_eq!(parsed.format(), CoverageFormat::Cobertura);
    let from_xml = coverage_delta(&touched("src/order.rs", &[10, 11, 12]), Some(&parsed));
    let from_lcov = coverage_delta(
        &touched("src/order.rs", &[10, 11, 12]),
        Some(&parse_lcov(LCOV).expect("lcov parses")),
    );
    assert_eq!(
        from_xml.files[0].covered_lines,
        from_lcov.files[0].covered_lines
    );
    assert_eq!(
        from_xml.files[0].uncovered_lines,
        from_lcov.files[0].uncovered_lines
    );
}

#[test]
fn touched_lines_come_from_post_change_numbering_in_a_unified_diff() {
    let diff = "\
diff --git a/src/order.rs b/src/order.rs
--- a/src/order.rs
+++ b/src/order.rs
@@ -8,3 +8,4 @@ fn total() {
 context one
+added ten
+added eleven
-removed
 context twelve
diff --git a/src/gone.rs b/dev/null
--- a/src/gone.rs
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
";
    let touched = TouchedLines::from_unified_diff(diff);
    assert_eq!(
        touched.lines("src/order.rs"),
        Some(&BTreeSet::from([9, 10]))
    );
    // A pure deletion is still a touched file, with no post-change lines.
    assert_eq!(touched.lines("src/gone.rs"), Some(&BTreeSet::new()));
}

#[test]
fn a_wrong_hunk_line_count_cannot_swallow_the_next_file_header() {
    // The header claims six new lines but only four follow. A line that is not
    // diff content must end the hunk anyway.
    let diff = "\
--- a/src/order.rs
+++ b/src/order.rs
@@ -8,4 +8,6 @@
 context
+added
diff --git a/src/other.rs b/src/other.rs
--- a/src/other.rs
+++ b/src/other.rs
@@ -1,1 +1,2 @@
 keep
+new
";
    let touched = TouchedLines::from_unified_diff(diff);
    assert_eq!(touched.lines("src/order.rs"), Some(&BTreeSet::from([9])));
    assert_eq!(touched.lines("src/other.rs"), Some(&BTreeSet::from([2])));
}

#[test]
fn diff_content_that_looks_like_a_file_header_does_not_start_a_new_file() {
    let diff = "\
--- a/schema.sql
+++ b/schema.sql
@@ -1,1 +1,2 @@
 select 1;
+--- not a file header
";
    let touched = TouchedLines::from_unified_diff(diff);
    assert_eq!(touched.len(), 1);
    assert_eq!(touched.lines("schema.sql"), Some(&BTreeSet::from([2])));
}

// --- the unexercised-path warning ----------------------------------------

#[test]
fn unexercised_change_raises_the_critical_suite_does_not_exercise_warning() {
    let delta = coverage_delta(&touched("src/order.rs", &[11]), Some(&report(LCOV)));
    assert_eq!(delta.verdict, CoverageVerdict::ChangedPathUnexercised);

    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        DifferentialReport::unavailable(DifferentialUnavailable::NotAttempted),
    );
    assert!(oracle.suite_does_not_exercise_change());
    let warning = oracle
        .warnings_with(OracleWarningCode::SuiteDoesNotExerciseChange)
        .next()
        .expect("warning fires");
    assert_eq!(warning.severity, Severity::Critical);
    assert!(
        warning
            .detail
            .contains("does not exercise the changed path")
    );
}

#[test]
fn a_changed_line_with_no_coverage_raises_a_per_file_unexercised_warning() {
    let delta = coverage_delta(&touched("src/order.rs", &[10, 11]), Some(&report(LCOV)));
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        available_differential_no_diff(),
    );
    let warning = oracle
        .warnings_with(OracleWarningCode::ChangedLinesUnexercised)
        .next()
        .expect("per-file warning fires");
    assert_eq!(warning.subject.as_deref(), Some("src/order.rs"));
    assert_eq!(warning.severity, Severity::High);
    assert!(warning.detail.contains("11"));
}

#[test]
fn an_unmeasured_changed_line_never_reports_as_unexercised() {
    // Line 13 has no coverage record. It must not produce the
    // "instrumented and never executed" warning.
    let delta = coverage_delta(&touched("src/order.rs", &[10, 12, 13]), Some(&report(LCOV)));
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        available_differential_no_diff(),
    );
    assert_eq!(
        oracle
            .warnings_with(OracleWarningCode::ChangedLinesUnexercised)
            .count(),
        0
    );
    assert_eq!(oracle.summary.touched_lines_unmeasured, 1);
}

// --- honest degradation ---------------------------------------------------

#[test]
fn coverage_unavailable_never_implies_a_clean_result() {
    let delta = CoverageDelta::unavailable(CoverageUnavailable::NoToolConfigured);
    assert!(!delta.verdict.is_evidence_of_exercise());
    assert!(delta.verdict.warrants_warning());

    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        DifferentialReport::unavailable(DifferentialUnavailable::NoBaselineRevision),
    );
    assert_eq!(oracle.summary.confidence, OracleConfidence::Indeterminate);
    assert!(oracle.summary.evidence_incomplete);
    assert!(oracle.summary.confidence.requires_human_attention());
    assert!(!oracle.summary.confidence.is_proof_of_correctness());

    let warning = oracle
        .warnings_with(OracleWarningCode::CoverageUnavailable)
        .next()
        .expect("coverage-unavailable warning fires");
    assert!(warning.detail.contains("not the same as clean"));
    assert!(
        oracle
            .warnings_with(OracleWarningCode::DifferentialUnavailable)
            .next()
            .is_some()
    );
}

#[test]
fn no_coverage_tool_is_distinct_from_a_missing_report_and_from_no_touched_files() {
    assert_eq!(
        coverage_delta(&touched("src/order.rs", &[10]), None).verdict,
        CoverageVerdict::Unknown(CoverageUnavailable::NoToolConfigured)
    );
    assert_eq!(
        coverage_delta(&TouchedLines::new(), Some(&report(LCOV))).verdict,
        CoverageVerdict::Unknown(CoverageUnavailable::NoTouchedFiles)
    );
    let root = tempdir().unwrap();
    let missing = root.path().join("lcov.info");
    assert_eq!(
        read_coverage_report(&missing).unwrap_err(),
        CoverageUnavailable::ReportMissing {
            expected_path: missing.display().to_string()
        }
    );
}

#[test]
fn an_unparsable_report_degrades_rather_than_reporting_zero_coverage() {
    let reason = parse_coverage_report("this is not a coverage report").unwrap_err();
    assert!(matches!(
        reason,
        CoverageUnavailable::ReportUnparsable { .. }
    ));
    assert!(!reason.implies_clean());
}

#[test]
fn a_documentation_only_change_is_no_executable_change_not_a_pass() {
    let text = "SF:src/order.rs\nDA:10,3\nend_of_record\n";
    let delta = coverage_delta(&touched("src/order.rs", &[900, 901]), Some(&report(text)));
    assert_eq!(delta.verdict, CoverageVerdict::NoExecutableChange);
    assert!(!delta.verdict.is_evidence_of_exercise());
}

// --- differential classification and ranking ------------------------------

fn run(revision: &str, tests: &[(&str, TestStatus, Option<&str>)]) -> TestRun {
    TestRun::new(
        revision,
        TestHarnessFormat::Libtest,
        tests
            .iter()
            .map(|(id, status, file)| TestOutcome {
                id: (*id).to_string(),
                status: *status,
                file: file.map(str::to_string),
            })
            .collect(),
    )
}

fn intent(files: &[&str]) -> DeclaredIntent {
    DeclaredIntent {
        touched_files: files.iter().map(|file| (*file).to_string()).collect(),
        declared_test_patterns: BTreeSet::new(),
    }
}

fn available_differential_no_diff() -> DifferentialReport {
    differential_report(
        &run("rev-pre", &[]),
        &run("rev-post", &[]),
        &DeclaredIntent::default(),
        &SuppressionLedger::default(),
    )
}

#[test]
fn undeclared_regression_outranks_declared_regression_and_neither_is_expected() {
    let baseline = run(
        "rev-pre",
        &[
            ("declared::a", TestStatus::Passed, Some("src/order.rs")),
            ("undeclared::b", TestStatus::Passed, Some("src/billing.rs")),
        ],
    );
    let candidate = run(
        "rev-post",
        &[
            ("declared::a", TestStatus::Failed, Some("src/order.rs")),
            ("undeclared::b", TestStatus::Failed, Some("src/billing.rs")),
        ],
    );
    let diff = differential_report(
        &baseline,
        &candidate,
        &intent(&["src/order.rs"]),
        &SuppressionLedger::default(),
    );

    // Sorted by rank descending: the undeclared regression comes first.
    assert_eq!(diff.divergences[0].test_id, "undeclared::b");
    assert_eq!(diff.divergences[0].rank, DivergenceRank::Critical);
    assert_eq!(
        diff.divergences[0].rule,
        DivergenceRule::UndeclaredRegression
    );
    assert_eq!(diff.divergences[1].test_id, "declared::a");
    assert_eq!(diff.divergences[1].rank, DivergenceRank::High);
    assert_eq!(diff.divergences[1].rule, DivergenceRule::DeclaredRegression);

    // A regression is never auto-classified as expected, declared or not.
    assert!(
        diff.divergences
            .iter()
            .all(|divergence| divergence.class == DivergenceClass::Unexpected)
    );
    assert_eq!(diff.unexpected, 2);
    assert_eq!(diff.highest_rank(), Some(DivergenceRank::Critical));
}

#[test]
fn a_declared_improvement_is_expected_and_an_undeclared_one_is_low_ranked() {
    let baseline = run(
        "rev-pre",
        &[("suite::fixed", TestStatus::Failed, Some("src/order.rs"))],
    );
    let candidate = run(
        "rev-post",
        &[
            ("suite::fixed", TestStatus::Passed, Some("src/order.rs")),
            ("suite::new", TestStatus::Passed, Some("src/billing.rs")),
        ],
    );
    let diff = differential_report(
        &baseline,
        &candidate,
        &intent(&["src/order.rs"]),
        &SuppressionLedger::default(),
    );

    let fixed = &diff.divergences[1];
    assert_eq!(fixed.test_id, "suite::fixed");
    assert_eq!(fixed.kind, DivergenceKind::NewlyPassing);
    assert_eq!(fixed.class, DivergenceClass::Expected);
    assert_eq!(fixed.rank, DivergenceRank::Informational);

    let added = &diff.divergences[0];
    assert_eq!(added.test_id, "suite::new");
    assert_eq!(added.kind, DivergenceKind::Added);
    assert_eq!(added.class, DivergenceClass::Unexpected);
    assert_eq!(added.rank, DivergenceRank::Low);
}

#[test]
fn a_removed_test_is_expected_when_declared_and_critical_when_not() {
    let baseline = run(
        "rev-pre",
        &[
            ("declared::gone", TestStatus::Passed, Some("src/order.rs")),
            (
                "undeclared::gone",
                TestStatus::Passed,
                Some("src/billing.rs"),
            ),
        ],
    );
    let diff = differential_report(
        &baseline,
        &run("rev-post", &[]),
        &intent(&["src/order.rs"]),
        &SuppressionLedger::default(),
    );
    let declared = diff
        .divergences
        .iter()
        .find(|divergence| divergence.test_id == "declared::gone")
        .unwrap();
    assert_eq!(declared.class, DivergenceClass::Expected);
    assert_eq!(declared.rule, DivergenceRule::DeclaredRemoval);

    let undeclared = diff
        .divergences
        .iter()
        .find(|divergence| divergence.test_id == "undeclared::gone")
        .unwrap();
    assert_eq!(undeclared.class, DivergenceClass::Unexpected);
    assert_eq!(undeclared.rank, DivergenceRank::Critical);
}

#[test]
fn a_declared_test_pattern_attributes_a_divergence_without_a_file() {
    let mut declared = DeclaredIntent::default();
    declared.declare_test_pattern("legacy::*");
    let diff = differential_report(
        &run("rev-pre", &[("legacy::slow", TestStatus::Passed, None)]),
        &run("rev-post", &[("legacy::slow", TestStatus::Skipped, None)]),
        &declared,
        &SuppressionLedger::default(),
    );
    assert!(diff.divergences[0].attributed);
    assert_eq!(diff.divergences[0].class, DivergenceClass::Expected);
    assert_eq!(diff.divergences[0].rule, DivergenceRule::DeclaredSkip);
}

#[test]
fn divergence_ordering_is_deterministic_for_equal_ranks() {
    let baseline = run(
        "rev-pre",
        &[
            ("zulu", TestStatus::Passed, None),
            ("alpha", TestStatus::Passed, None),
            ("mike", TestStatus::Passed, None),
        ],
    );
    let candidate = run(
        "rev-post",
        &[
            ("zulu", TestStatus::Failed, None),
            ("alpha", TestStatus::Failed, None),
            ("mike", TestStatus::Failed, None),
        ],
    );
    let ordering = |report: &DifferentialReport| -> Vec<String> {
        report
            .divergences
            .iter()
            .map(|divergence| divergence.test_id.clone())
            .collect()
    };
    let first = differential_report(
        &baseline,
        &candidate,
        &DeclaredIntent::default(),
        &SuppressionLedger::default(),
    );
    let second = differential_report(
        &baseline,
        &candidate,
        &DeclaredIntent::default(),
        &SuppressionLedger::default(),
    );
    assert_eq!(ordering(&first), vec!["alpha", "mike", "zulu"]);
    assert_eq!(ordering(&first), ordering(&second));
}

#[test]
fn a_harness_mismatch_degrades_instead_of_comparing_incomparable_runs() {
    let baseline = TestRun::new("rev-pre", TestHarnessFormat::Libtest, vec![]);
    let candidate = TestRun::new("rev-post", TestHarnessFormat::Pytest, vec![]);
    let diff = differential_report(
        &baseline,
        &candidate,
        &DeclaredIntent::default(),
        &SuppressionLedger::default(),
    );
    assert!(!diff.is_available());
    assert!(matches!(
        diff.unavailable,
        Some(DifferentialUnavailable::HarnessMismatch { .. })
    ));
}

// --- suppression ----------------------------------------------------------

fn rule(id: &str, pattern: &str, kind: Option<DivergenceKind>) -> SuppressionRule {
    SuppressionRule {
        id: id.into(),
        test_pattern: pattern.into(),
        kind,
        reason: "flaky under the sandboxed clock".into(),
        accepted_by: "maintainer".into(),
        accepted_at_ms: 1_754_352_000_000,
    }
}

#[test]
fn a_suppression_rule_silences_a_matching_divergence_and_nothing_else() {
    let baseline = run(
        "rev-pre",
        &[
            ("flaky::clock", TestStatus::Passed, Some("src/billing.rs")),
            ("real::break", TestStatus::Passed, Some("src/billing.rs")),
        ],
    );
    let candidate = run(
        "rev-post",
        &[
            ("flaky::clock", TestStatus::Failed, Some("src/billing.rs")),
            ("real::break", TestStatus::Failed, Some("src/billing.rs")),
        ],
    );
    let ledger = SuppressionLedger::new(vec![rule(
        "flaky-clock",
        "flaky::*",
        Some(DivergenceKind::NewlyFailing),
    )]);
    let diff = differential_report(&baseline, &candidate, &DeclaredIntent::default(), &ledger);

    let suppressed = diff
        .divergences
        .iter()
        .find(|divergence| divergence.test_id == "flaky::clock")
        .unwrap();
    assert_eq!(suppressed.class, DivergenceClass::Suppressed);
    assert_eq!(suppressed.rank, DivergenceRank::Suppressed);
    assert_eq!(suppressed.suppressed_by.as_deref(), Some("flaky-clock"));
    assert_eq!(diff.suppressed, 1);
    assert_eq!(diff.unexpected, 1);
    assert_eq!(diff.highest_rank(), Some(DivergenceRank::Critical));
    assert!(diff.stale_suppression_rules.is_empty());

    // A suppressed divergence emits no warning; the surviving one still does.
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        CoverageDelta::unavailable(CoverageUnavailable::NoToolConfigured),
        diff,
    );
    let subjects: Vec<_> = oracle
        .warnings_with(OracleWarningCode::UnexpectedDivergence)
        .filter_map(|warning| warning.subject.clone())
        .collect();
    assert_eq!(subjects, vec!["real::break".to_string()]);
}

#[test]
fn a_suppression_rule_restricted_to_one_kind_does_not_silence_other_kinds() {
    let ledger = SuppressionLedger::new(vec![rule(
        "skips-only",
        "suite::*",
        Some(DivergenceKind::NewlySkipped),
    )]);
    let diff = differential_report(
        &run("rev-pre", &[("suite::a", TestStatus::Passed, None)]),
        &run("rev-post", &[("suite::a", TestStatus::Failed, None)]),
        &DeclaredIntent::default(),
        &ledger,
    );
    assert_eq!(diff.suppressed, 0);
    assert_eq!(diff.divergences[0].class, DivergenceClass::Unexpected);
    assert_eq!(diff.stale_suppression_rules, vec!["skips-only".to_string()]);
}

#[test]
fn a_rule_that_matches_nothing_is_reported_as_stale_rather_than_accumulating() {
    let ledger = SuppressionLedger::new(vec![rule("retired", "gone::*", None)]);
    let diff = differential_report(
        &run("rev-pre", &[("kept::a", TestStatus::Passed, None)]),
        &run("rev-post", &[("kept::a", TestStatus::Passed, None)]),
        &DeclaredIntent::default(),
        &ledger,
    );
    assert_eq!(diff.stale_suppression_rules, vec!["retired".to_string()]);
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        CoverageDelta::unavailable(CoverageUnavailable::NoToolConfigured),
        diff,
    );
    assert_eq!(
        oracle
            .warnings_with(OracleWarningCode::StaleSuppressionRule)
            .count(),
        1
    );
}

#[test]
fn a_suppression_ledger_round_trips_and_refuses_to_silence_everything() {
    let root = tempdir().unwrap();
    let path = root.path().join("state/suppressions.json");
    // A missing ledger is empty, not an error.
    assert!(SuppressionLedger::load(&path).unwrap().rules.is_empty());

    let ledger = SuppressionLedger::new(vec![rule("flaky-clock", "flaky::*", None)]);
    ledger.save(&path).unwrap();
    assert_eq!(SuppressionLedger::load(&path).unwrap(), ledger);

    let blanket = SuppressionLedger::new(vec![rule("all", "*", None)]);
    assert!(blanket.save(&path).is_err());

    let duplicate =
        SuppressionLedger::new(vec![rule("dup", "a::*", None), rule("dup", "b::*", None)]);
    assert!(duplicate.validate().is_err());
}

// --- report assembly, ordering, and receipt binding ------------------------

#[test]
fn confidence_reports_unexpected_divergence_ahead_of_missing_evidence() {
    let diff = differential_report(
        &run("rev-pre", &[("suite::a", TestStatus::Passed, None)]),
        &run("rev-post", &[("suite::a", TestStatus::Failed, None)]),
        &DeclaredIntent::default(),
        &SuppressionLedger::default(),
    );
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        CoverageDelta::unavailable(CoverageUnavailable::NoToolConfigured),
        diff,
    );
    assert_eq!(
        oracle.summary.confidence,
        OracleConfidence::UnexpectedDivergence
    );
    // The missing coverage is still surfaced rather than masked.
    assert!(oracle.summary.evidence_incomplete);
    assert_eq!(
        oracle
            .warnings_with(OracleWarningCode::CoverageUnavailable)
            .count(),
        1
    );
}

#[test]
fn the_strongest_confidence_still_denies_being_proof_of_correctness() {
    let delta = coverage_delta(&touched("src/order.rs", &[10, 12]), Some(&report(LCOV)));
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        available_differential_no_diff(),
    );
    assert_eq!(
        oracle.summary.confidence,
        OracleConfidence::ChangedPathExercised
    );
    assert!(!oracle.summary.confidence.is_proof_of_correctness());
    assert!(!oracle.summary.confidence.requires_human_attention());
    assert!(oracle.warnings.is_empty());
    assert!(!oracle.summary.evidence_incomplete);
}

#[test]
fn a_green_but_unexercised_suite_is_never_the_strongest_confidence() {
    let delta = coverage_delta(&touched("src/order.rs", &[10, 11]), Some(&report(LCOV)));
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        available_differential_no_diff(),
    );
    assert_eq!(
        oracle.summary.confidence,
        OracleConfidence::GreenButUnexercised
    );
    assert!(oracle.summary.confidence.requires_human_attention());
}

#[test]
fn warnings_are_ordered_by_severity_and_are_deterministic() {
    let delta = coverage_delta(
        &{
            let mut touched = TouchedLines::new();
            touched.extend_file("src/order.rs", [11]);
            touched.extend_file("src/absent.rs", [1, 2]);
            touched
        },
        Some(&report(LCOV)),
    );
    let build = || {
        ProveOracleReport::new(
            "change-1",
            "rev-post",
            delta.clone(),
            available_differential_no_diff(),
        )
    };
    let oracle = build();
    let severities: Vec<_> = oracle
        .warnings
        .iter()
        .map(|warning| warning.severity)
        .collect();
    assert!(severities.windows(2).all(|pair| pair[0] >= pair[1]));
    assert_eq!(
        oracle.headline_warning().map(|warning| warning.code),
        Some(OracleWarningCode::SuiteDoesNotExerciseChange)
    );
    assert_eq!(oracle.warnings, build().warnings);
}

#[test]
fn the_report_round_trips_through_a_receipt_extension() {
    let delta = coverage_delta(&touched("src/order.rs", &[10, 11]), Some(&report(LCOV)));
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        available_differential_no_diff(),
    );

    let mut receipt = receipt_fixture();
    assert_eq!(ProveOracleReport::from_receipt(&receipt).unwrap(), None);
    oracle.attach_to_receipt(&mut receipt).unwrap();

    let encoded = serde_json::to_value(&receipt).unwrap();
    // The extension flattens into the receipt, matching the crate's convention.
    assert!(encoded.get(ORACLE_RECEIPT_EXTENSION).is_some());
    let decoded: Receipt = serde_json::from_value(encoded).unwrap();
    assert_eq!(
        ProveOracleReport::from_receipt(&decoded).unwrap(),
        Some(oracle)
    );
}

#[test]
fn the_report_serialises_to_a_stable_machine_readable_shape() {
    let delta = coverage_delta(&touched("src/order.rs", &[11]), Some(&report(LCOV)));
    let oracle = ProveOracleReport::new(
        "change-1",
        "rev-post",
        delta,
        DifferentialReport::unavailable(DifferentialUnavailable::NoBaselineRevision),
    );
    let value = oracle.to_json().unwrap();
    assert_eq!(value["version"], json!(ORACLE_VERSION));
    assert_eq!(value["differential"]["version"], json!(DIVERGENCE_VERSION));
    assert_eq!(
        value["coverage"]["verdict"],
        json!({ "verdict": "changedPathUnexercised" })
    );
    assert_eq!(value["summary"]["confidence"], json!("indeterminate"));
    assert_eq!(
        value["differential"]["unavailable"],
        json!({ "reason": "noBaselineRevision" })
    );
    assert_eq!(
        value["warnings"][0]["code"],
        json!("suite-does-not-exercise-change")
    );
}

// --- test harness output parsing ------------------------------------------

#[test]
fn libtest_pytest_and_jest_outcomes_parse_into_the_same_shape() {
    let libtest = "\
     Running unittests src/lib.rs (target/debug/deps/changeloop_evidence-1f2e)

running 3 tests
test coverage::covers_touched_lines ... ok
test coverage::warns_on_gap ... FAILED
test slow::soak ... ignored
";
    let parsed = parse_libtest_outcomes(libtest).unwrap();
    assert_eq!(parsed.len(), 3);
    assert_eq!(parsed[0].id, "src/lib.rs::coverage::covers_touched_lines");
    assert_eq!(parsed[1].status, TestStatus::Failed);
    assert_eq!(parsed[2].status, TestStatus::Skipped);

    let pytest = "\
tests/test_order.py::test_total PASSED                                   [ 50%]
tests/test_order.py::test_refund FAILED                                  [100%]
";
    let parsed = parse_pytest_outcomes(pytest).unwrap();
    assert_eq!(parsed[0].id, "tests/test_order.py::test_total");
    assert_eq!(parsed[0].file.as_deref(), Some("tests/test_order.py"));
    assert_eq!(parsed[1].status, TestStatus::Failed);

    let jest = json!({
        "testResults": [{
            "name": "/repo/src/order.test.ts",
            "assertionResults": [
                { "fullName": "order totals", "status": "passed" },
                { "fullName": "order refunds", "status": "pending" }
            ]
        }]
    });
    let parsed = parse_jest_json_outcomes(&jest).unwrap();
    assert_eq!(parsed[0].id, "repo/src/order.test.ts::order totals");
    assert_eq!(parsed[1].status, TestStatus::Skipped);

    // Autodetection picks the right harness for each.
    assert_eq!(
        parse_test_outcomes(libtest).unwrap().0,
        TestHarnessFormat::Libtest
    );
    assert_eq!(
        parse_test_outcomes(pytest).unwrap().0,
        TestHarnessFormat::Pytest
    );
    assert_eq!(
        parse_test_outcomes(&jest.to_string()).unwrap().0,
        TestHarnessFormat::JestJson
    );
}

fn receipt_fixture() -> Receipt {
    use std::collections::{BTreeMap, BTreeSet};
    Receipt {
        version: RECEIPT_VERSION,
        change_id: "change-1".into(),
        provider: "test".into(),
        provider_version: "1".into(),
        adapter: "external".into(),
        adapter_protocol_version: "adapter-v1".into(),
        provider_protocol_version: "provider-v1".into(),
        contract_fingerprint: "contract-a".into(),
        execution_fingerprint: "execution-a".into(),
        provider_fingerprint: "provider-a".into(),
        workspace_hash: "workspace-a".into(),
        workspace_snapshot_id: None,
        input_identity: InputIdentity::global("workspace-a").unwrap(),
        claims: BTreeSet::from(["claim-a".into()]),
        status: ReceiptStatus::Pass,
        observed: "command passed".into(),
        provenance: Provenance {
            source: Some("command:test".into()),
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
