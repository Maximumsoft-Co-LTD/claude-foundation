//! The join between Prove and Land: turn a passing Prove run into a durable
//! [`ProveOracleReport`] that `changeloop-land` can read back.
//!
//! `changeloop-evidence` knows how to *compute* the oracle and
//! `changeloop-land` knows how to *render* it. Nothing wrote one. This module
//! is that write, and it is bound by three rules:
//!
//! 1. **It never gates.** Prove's verdict is decided entirely by its proof
//!    providers. Every failure in here degrades to a diagnostic on the Prove
//!    result; none of them can turn a passing Prove into a failing one.
//! 2. **It never fabricates.** A report is written only from evidence actually
//!    observed in this run. Missing coverage becomes
//!    [`CoverageUnavailable`], a missing baseline becomes
//!    [`DifferentialUnavailable`], and neither may be omitted — an omitted
//!    field would render as clean.
//! 3. **It never claims more than it measured.** With no coverage tool and no
//!    baseline configured the report still exists and still says so, which is
//!    what makes Land's "not measured" honest rather than absent.
//!
//! The expensive arm — re-running the suite at the pre-change revision — is
//! strictly opt-in through `.changeloop/prove-oracle.json`. Unconfigured, this
//! module costs one `git diff` and one file read.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use changeloop_evidence::{
    CoverageDelta, CoverageUnavailable, DeclaredIntent, DifferentialReport,
    DifferentialUnavailable, InputIdentity, ProveOracleReport, Provenance, RECEIPT_VERSION,
    Receipt, ReceiptStatus, ReceiptStore, SuppressionLedger, TestHarnessFormat, TestOutcome,
    TestRun, TouchedLines, coverage_delta, differential_report, parse_coverage_report,
    parse_test_outcomes, read_coverage_report,
};
use changeloop_protocol::OperationId;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::operational::{
    MAX_OPERATIONAL_CONFIG_BYTES, create_private_operational_directory, now_ms,
    read_regular_bounded, run_bounded_command, run_hardened_git,
};

/// Receipt provider id for the oracle record. Lowercase and hyphenated because
/// `changeloop-evidence` validates receipt identifiers as path-safe.
pub(crate) const ORACLE_RECEIPT_PROVIDER: &str = "prove-oracle";
const ORACLE_CONFIG_FILE: &str = ".changeloop/prove-oracle.json";
/// The suppression store, durable and hand-editable, next to the other
/// `.changeloop/` operational configuration.
const SUPPRESSIONS_FILE: &str = ".changeloop/suppressions.json";
/// The receipts root `changeloop_land::read_prove_evidence` is pointed at by
/// `land_at`. Land must find the report without changing `changeloop-land`.
const RECEIPTS_DIRECTORY: &str = ".changeloop/receipts";
const BASELINE_WORKTREE_DIRECTORY: &str = ".changeloop/baseline";
const MAX_BASELINE_OUTPUT_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_BASELINE_TIMEOUT_MS: u64 = 600_000;
const MAX_BASELINE_TIMEOUT_MS: u64 = 3_600_000;
const GIT_WORKTREE_TIMEOUT_MS: u64 = 60_000;

/// Opt-in oracle configuration, read from `.changeloop/prove-oracle.json`.
///
/// Every field is optional and an absent file is a valid configuration: the
/// oracle then reports honestly that nothing was measured.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub(crate) struct ProveOracleConfig {
    /// Repository-relative path to an LCOV or Cobertura report produced by the
    /// project's own coverage tooling. Absent means no coverage tool, which is
    /// [`CoverageUnavailable::NoToolConfigured`] and never "clean".
    coverage_report: Option<String>,
    /// Which proof provider's stdout carries per-test outcomes. Absent means
    /// the first provider whose output parses is used.
    test_provider: Option<String>,
    /// Test-id patterns this project declares the change may legitimately move,
    /// beyond what the diff can express.
    declared_test_patterns: Vec<String>,
    /// How to obtain the pre-change suite result. Absent means the differential
    /// arm was not attempted, which is recorded, never omitted.
    baseline: Option<BaselineConfig>,
}

/// Two ways to obtain a pre-change run, checked in this order:
/// a recorded snapshot of the suite output, or a command re-run in a detached
/// worktree at the pre-change revision.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
struct BaselineConfig {
    /// Repository-relative path to a recorded pre-change suite output.
    output_path: Option<String>,
    /// Command re-run at the pre-change revision in a throwaway worktree.
    command: Option<String>,
    args: Vec<String>,
    timeout_ms: Option<u64>,
}

impl ProveOracleConfig {
    /// Load the configuration. A missing file is the default configuration; an
    /// unreadable or malformed one degrades to the default *and* reports why,
    /// because silently ignoring it would make "not measured" look intentional.
    pub(crate) fn load(root: &Path) -> (Self, Option<String>) {
        let path = root.join(ORACLE_CONFIG_FILE);
        match read_regular_bounded(&path, MAX_OPERATIONAL_CONFIG_BYTES) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(config) => (config, None),
                Err(error) => (
                    Self::default(),
                    Some(format!("invalid {}: {error}", path.display())),
                ),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Self::default(), None),
            Err(error) => (
                Self::default(),
                Some(format!("could not read {}: {error}", path.display())),
            ),
        }
    }
}

/// Collects the candidate (post-change) suite outcomes from proof provider
/// output as Prove executes, so the differential arm never re-runs the suite it
/// already ran.
#[derive(Debug, Default)]
pub(crate) struct CandidateCollector {
    observed: Option<(TestHarnessFormat, Vec<TestOutcome>)>,
    diagnostic: Option<String>,
    considered: bool,
}

impl CandidateCollector {
    /// Offer one executed provider's output. The first provider that yields
    /// per-test outcomes wins; when the configuration names a provider, only
    /// that one is considered.
    pub(crate) fn observe(
        &mut self,
        config: &ProveOracleConfig,
        provider_id: &str,
        stdout: &[u8],
        truncated: bool,
    ) {
        if config
            .test_provider
            .as_deref()
            .is_some_and(|designated| designated != provider_id)
            || self.observed.is_some()
        {
            return;
        }
        self.considered = true;
        if truncated {
            self.diagnostic.get_or_insert(format!(
                "proof provider '{provider_id}' output was truncated; per-test outcomes could not \
                 be parsed"
            ));
            return;
        }
        match parse_test_outcomes(&String::from_utf8_lossy(stdout)) {
            Some((format, tests)) => self.observed = Some((format, tests)),
            None => {
                self.diagnostic.get_or_insert(format!(
                    "proof provider '{provider_id}' produced no parsable per-test output"
                ));
            }
        }
    }

    fn resolve(self) -> Result<(TestHarnessFormat, Vec<TestOutcome>), DifferentialUnavailable> {
        if let Some(observed) = self.observed {
            return Ok(observed);
        }
        let detail = self.diagnostic.unwrap_or_else(|| {
            if self.considered {
                "the candidate suite produced no per-test output".into()
            } else {
                "the candidate suite was not executed in this Prove run (proof was reused)".into()
            }
        });
        Err(DifferentialUnavailable::RunUnparsable { detail })
    }
}

/// Everything the oracle needs from the Prove run itself.
pub(crate) struct OracleInputs<'a> {
    pub(crate) change: &'a str,
    pub(crate) revision: &'a str,
    /// The change's unified diff, or why it could not be produced.
    pub(crate) diff: Result<Vec<u8>, String>,
    /// Why `.changeloop/prove-oracle.json` was ignored, if it was. Surfaced so
    /// a broken configuration cannot masquerade as a deliberate "not measured".
    pub(crate) config_error: Option<String>,
    pub(crate) claims: BTreeSet<String>,
    pub(crate) candidate: CandidateCollector,
}

/// Produce a [`ProveOracleReport`] and persist it where Land reads.
///
/// Returns the machine surface for Prove's own result. It never returns an
/// error: a Prove run that cannot record evidence still passed, and Land will
/// then honestly render "NOT MEASURED".
pub(crate) fn record(
    root: &Path,
    config: &ProveOracleConfig,
    mut inputs: OracleInputs<'_>,
) -> Value {
    let mut diagnostics: Vec<String> = Vec::new();
    if let Some(detail) = &inputs.config_error {
        diagnostics.push(format!("oracle configuration ignored: {detail}"));
    }

    let (touched, diff_error) = match &inputs.diff {
        Ok(diff) => (
            TouchedLines::from_unified_diff(&String::from_utf8_lossy(diff)),
            None,
        ),
        Err(detail) => (TouchedLines::new(), Some(detail.clone())),
    };
    if let Some(detail) = &diff_error {
        diagnostics.push(format!("change diff unavailable: {detail}"));
    }

    let coverage = coverage_evidence(root, config, &touched, diff_error.as_deref());
    let differential = differential_evidence(
        root,
        config,
        &touched,
        inputs.revision,
        std::mem::take(&mut inputs.candidate),
        &mut diagnostics,
    );
    let report = ProveOracleReport::new(inputs.change, inputs.revision, coverage, differential);

    match persist(root, &inputs, &report) {
        Ok(()) => summary(&report, true, diagnostics),
        Err(detail) => {
            diagnostics.push(format!("oracle receipt was not recorded: {detail}"));
            summary(&report, false, diagnostics)
        }
    }
}

fn summary(report: &ProveOracleReport, recorded: bool, diagnostics: Vec<String>) -> Value {
    json!({
        "recorded": recorded,
        "receiptProvider": ORACLE_RECEIPT_PROVIDER,
        "confidence": report.summary.confidence,
        "coverageVerdict": report.summary.coverage_verdict,
        "evidenceIncomplete": report.summary.evidence_incomplete,
        "warnings": report.warnings.len(),
        "proofOfCorrectness": false,
        "diagnostics": diagnostics,
    })
}

// --- coverage arm ----------------------------------------------------------

fn coverage_evidence(
    root: &Path,
    config: &ProveOracleConfig,
    touched: &TouchedLines,
    diff_error: Option<&str>,
) -> CoverageDelta {
    if let Some(detail) = diff_error {
        // Without the diff there are no touched lines to measure. Reporting
        // that as "no touched files" would read as a change that cannot be
        // measured rather than a measurement that failed.
        return CoverageDelta::unavailable(CoverageUnavailable::ReportUnreadable {
            detail: format!("the change diff could not be produced: {detail}"),
        });
    }
    let Some(configured) = config.coverage_report.as_deref() else {
        // No coverage tool: `coverage_delta` yields `NoToolConfigured`, which
        // can never render as clean.
        return coverage_delta(touched, None);
    };
    let path = match project_relative(root, configured) {
        Ok(path) => path,
        Err(detail) => {
            return CoverageDelta::unavailable(CoverageUnavailable::ReportUnreadable { detail });
        }
    };
    match read_coverage_report(&path).and_then(|text| parse_coverage_report(&text)) {
        Ok(report) => coverage_delta(touched, Some(&report)),
        Err(reason) => CoverageDelta::unavailable(reason),
    }
}

// --- differential arm ------------------------------------------------------

fn differential_evidence(
    root: &Path,
    config: &ProveOracleConfig,
    touched: &TouchedLines,
    revision: &str,
    candidate: CandidateCollector,
    diagnostics: &mut Vec<String>,
) -> DifferentialReport {
    // Resolve the candidate first: without post-change outcomes there is
    // nothing to compare, and re-running the suite at the baseline would be
    // expensive work that cannot be used.
    let (format, tests) = match candidate.resolve() {
        Ok(observed) => observed,
        Err(reason) => return DifferentialReport::unavailable(reason),
    };
    let Some(baseline_config) = config.baseline.as_ref() else {
        return DifferentialReport::unavailable(DifferentialUnavailable::NotAttempted);
    };
    let baseline = match baseline_run(root, baseline_config) {
        Ok(run) => run,
        Err(reason) => return DifferentialReport::unavailable(reason),
    };

    let mut intent = DeclaredIntent::from_touched(touched);
    for pattern in &config.declared_test_patterns {
        intent.declare_test_pattern(pattern.clone());
    }
    let ledger = suppression_ledger(root, diagnostics);
    differential_report(
        &baseline,
        &TestRun::new(revision, format, tests),
        &intent,
        &ledger,
    )
}

fn baseline_run(root: &Path, config: &BaselineConfig) -> Result<TestRun, DifferentialUnavailable> {
    if let Some(configured) = config.output_path.as_deref() {
        return recorded_baseline(root, configured);
    }
    let Some(command) = config.command.as_deref().filter(|value| !value.is_empty()) else {
        return Err(DifferentialUnavailable::NotAttempted);
    };
    executed_baseline(root, command, config)
}

/// A pre-change suite output the project recorded earlier. Cheap, and the only
/// arm available when the pre-change revision cannot be checked out.
fn recorded_baseline(root: &Path, configured: &str) -> Result<TestRun, DifferentialUnavailable> {
    let path = project_relative(root, configured)
        .map_err(|detail| DifferentialUnavailable::BaselineRunFailed { detail })?;
    let bytes = read_regular_bounded(&path, MAX_BASELINE_OUTPUT_BYTES).map_err(|error| {
        DifferentialUnavailable::BaselineRunFailed {
            detail: format!("recorded baseline output at {configured}: {error}"),
        }
    })?;
    match parse_test_outcomes(&String::from_utf8_lossy(&bytes)) {
        Some((format, tests)) => Ok(TestRun::new("recorded-baseline", format, tests)),
        None => Err(DifferentialUnavailable::RunUnparsable {
            detail: format!("recorded baseline output at {configured} has no per-test outcomes"),
        }),
    }
}

/// Re-run the suite at the pre-change revision in a detached throwaway
/// worktree. The working tree is never touched, and the worktree is removed
/// whether or not the run succeeded.
fn executed_baseline(
    root: &Path,
    command: &str,
    config: &BaselineConfig,
) -> Result<TestRun, DifferentialUnavailable> {
    let head = run_hardened_git(
        root,
        &["rev-parse".into(), "HEAD".into()],
        GIT_WORKTREE_TIMEOUT_MS,
    )
    .ok()
    .filter(|output| output.status.success())
    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    .filter(|head| !head.is_empty())
    .ok_or(DifferentialUnavailable::NoBaselineRevision)?;

    let parent = root.join(BASELINE_WORKTREE_DIRECTORY);
    create_private_operational_directory(root, &parent).map_err(|error| {
        DifferentialUnavailable::BaselineRunFailed {
            detail: format!("baseline worktree directory: {error}"),
        }
    })?;
    let worktree = parent.join(format!("run-{}", OperationId::new()));
    let worktree_argument = worktree.display().to_string();
    let added = run_hardened_git(
        root,
        &[
            "worktree".into(),
            "add".into(),
            "--detach".into(),
            "--force".into(),
            worktree_argument.clone(),
            head.clone(),
        ],
        GIT_WORKTREE_TIMEOUT_MS,
    );
    match added {
        Ok(output) if output.status.success() => {}
        Ok(output) => {
            remove_worktree(root, &worktree_argument);
            return Err(DifferentialUnavailable::BaselineRunFailed {
                detail: format!(
                    "could not check out the pre-change revision: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            });
        }
        Err(error) => {
            return Err(DifferentialUnavailable::BaselineRunFailed {
                detail: format!("could not check out the pre-change revision: {error}"),
            });
        }
    }

    let timeout = config
        .timeout_ms
        .unwrap_or(DEFAULT_BASELINE_TIMEOUT_MS)
        .min(MAX_BASELINE_TIMEOUT_MS);
    let outcome = run_bounded_command(&worktree, command, &config.args, &[], None, timeout);
    remove_worktree(root, &worktree_argument);

    let output = outcome.map_err(|error| DifferentialUnavailable::BaselineRunFailed {
        detail: format!("baseline command '{command}' could not run: {error}"),
    })?;
    if output.truncated {
        return Err(DifferentialUnavailable::RunUnparsable {
            detail: format!("baseline command '{command}' output was truncated"),
        });
    }
    // A non-zero exit is normal for a suite with failures; the outcomes still
    // parse and are still the honest baseline. Only unparsable output is fatal.
    match parse_test_outcomes(&String::from_utf8_lossy(&output.stdout)) {
        Some((format, tests)) => Ok(TestRun::new(head, format, tests)),
        None => Err(DifferentialUnavailable::RunUnparsable {
            detail: format!("baseline command '{command}' produced no per-test outcomes"),
        }),
    }
}

fn remove_worktree(root: &Path, worktree: &str) {
    let _ = run_hardened_git(
        root,
        &[
            "worktree".into(),
            "remove".into(),
            "--force".into(),
            worktree.into(),
        ],
        GIT_WORKTREE_TIMEOUT_MS,
    );
    let _ = fs::remove_dir_all(worktree);
    let _ = run_hardened_git(
        root,
        &["worktree".into(), "prune".into()],
        GIT_WORKTREE_TIMEOUT_MS,
    );
}

/// The durable suppression store. An unreadable or invalid ledger suppresses
/// nothing: failing open here would silently hide divergences, so the empty
/// ledger — which classifies every difference — is the safe degrade.
fn suppression_ledger(root: &Path, diagnostics: &mut Vec<String>) -> SuppressionLedger {
    let path = root.join(SUPPRESSIONS_FILE);
    let existed = path.exists();
    match SuppressionLedger::load(&path) {
        Ok(ledger) => {
            if !existed && let Err(error) = ledger.save(&path) {
                diagnostics.push(format!("suppression ledger could not be seeded: {error}"));
            }
            ledger
        }
        Err(error) => {
            diagnostics.push(format!(
                "suppression ledger at {} was ignored and nothing was suppressed: {error}",
                path.display()
            ));
            SuppressionLedger::new(Vec::new())
        }
    }
}

// --- persistence -----------------------------------------------------------

fn persist(
    root: &Path,
    inputs: &OracleInputs<'_>,
    report: &ProveOracleReport,
) -> Result<(), String> {
    let receipts = root.join(RECEIPTS_DIRECTORY);
    create_private_operational_directory(root, &receipts).map_err(|error| error.to_string())?;
    let store = ReceiptStore::new(&receipts).map_err(|error| error.to_string())?;
    let mut receipt = oracle_receipt(inputs, report)?;
    report
        .attach_to_receipt(&mut receipt)
        .map_err(|error| error.to_string())?;
    store.record(&receipt).map_err(|error| error.to_string())
}

fn oracle_receipt(
    inputs: &OracleInputs<'_>,
    report: &ProveOracleReport,
) -> Result<Receipt, String> {
    let execution = serde_json::to_vec(report).map_err(|error| error.to_string())?;
    let claims = if inputs.claims.is_empty() {
        BTreeSet::from([ORACLE_RECEIPT_PROVIDER.to_string()])
    } else {
        inputs.claims.clone()
    };
    let observed_at = rfc3339_utc(now_ms());
    Ok(Receipt {
        version: RECEIPT_VERSION,
        change_id: inputs.change.to_owned(),
        provider: ORACLE_RECEIPT_PROVIDER.to_owned(),
        provider_version: env!("CARGO_PKG_VERSION").to_owned(),
        adapter: "changeloop-cli".into(),
        adapter_protocol_version: "1".into(),
        provider_protocol_version: "1".into(),
        contract_fingerprint: fingerprint(&[
            ORACLE_RECEIPT_PROVIDER.as_bytes(),
            inputs.change.as_bytes(),
        ]),
        execution_fingerprint: fingerprint(&[&execution]),
        provider_fingerprint: fingerprint(&[
            ORACLE_RECEIPT_PROVIDER.as_bytes(),
            env!("CARGO_PKG_VERSION").as_bytes(),
        ]),
        workspace_hash: inputs.revision.to_owned(),
        workspace_snapshot_id: None,
        input_identity: InputIdentity::global(inputs.revision)
            .map_err(|error| error.to_string())?,
        claims,
        status: ReceiptStatus::Pass,
        observed: "prove oracle evidence: coverage delta on the change's touched lines and \
                   differential test outcomes against the pre-change revision"
            .into(),
        provenance: Provenance {
            source: Some("changeloop-cli:prove".into()),
            recorded_by: Some("cloop".into()),
        },
        references: Vec::new(),
        artifacts: Vec::new(),
        proof_run_id: format!("prove-{}", OperationId::new()),
        started_at: observed_at.clone(),
        finished_at: observed_at,
        extensions: BTreeMap::new(),
    })
}

fn fingerprint(parts: &[&[u8]]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_le_bytes());
        digest.update(part);
    }
    format!("sha256:{:x}", digest.finalize())
}

/// Resolve a configured repository-relative path. Absolute paths and traversal
/// are refused so configuration cannot point the oracle outside the project.
fn project_relative(root: &Path, configured: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(configured);
    if configured.is_empty() || candidate.is_absolute() {
        return Err(format!("'{configured}' must be a repository-relative path"));
    }
    let mut resolved = root.to_path_buf();
    for component in candidate.components() {
        match component {
            std::path::Component::Normal(part) => resolved.push(part),
            std::path::Component::CurDir => {}
            _ => {
                return Err(format!(
                    "'{configured}' must not traverse outside the project"
                ));
            }
        }
    }
    Ok(resolved)
}

/// Receipt timestamps are RFC 3339 UTC. The workspace carries no date
/// dependency, so the civil-from-days conversion is done here.
fn rfc3339_utc(milliseconds: u64) -> String {
    let seconds = milliseconds / 1_000;
    let millis = milliseconds % 1_000;
    let (year, month, day) = civil_from_days((seconds / 86_400) as i64);
    let time = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        time / 3_600,
        (time % 3_600) / 60,
        time % 60
    )
}

/// Howard Hinnant's `civil_from_days`, for days since the Unix epoch.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const LIBTEST_OUTPUT: &str = "\
running 2 tests
test order::totals ... ok
test order::rounding ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
";

    #[test]
    fn rfc3339_matches_a_known_instant() {
        assert_eq!(rfc3339_utc(1_754_352_000_123), "2025-08-05T00:00:00.123Z");
        assert_eq!(rfc3339_utc(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn configured_paths_may_not_escape_the_project() {
        let root = Path::new("/project");
        assert_eq!(
            project_relative(root, "target/lcov.info").unwrap(),
            Path::new("/project/target/lcov.info")
        );
        assert!(project_relative(root, "/etc/passwd").is_err());
        assert!(project_relative(root, "../outside").is_err());
        assert!(project_relative(root, "").is_err());
    }

    #[test]
    fn a_reused_proof_run_reports_an_unparsable_candidate_rather_than_silence() {
        let reason = CandidateCollector::default().resolve().unwrap_err();
        let DifferentialUnavailable::RunUnparsable { detail } = reason else {
            panic!("a candidate that never ran must be reported, not omitted");
        };
        assert!(detail.contains("was not executed"), "{detail}");
    }

    #[test]
    fn the_configured_test_provider_is_the_only_one_observed() {
        let config = ProveOracleConfig {
            test_provider: Some("suite".into()),
            ..ProveOracleConfig::default()
        };
        let mut collector = CandidateCollector::default();
        collector.observe(&config, "lint", LIBTEST_OUTPUT.as_bytes(), false);
        assert!(collector.resolve().is_err());

        let mut collector = CandidateCollector::default();
        collector.observe(&config, "suite", LIBTEST_OUTPUT.as_bytes(), false);
        let (format, tests) = collector.resolve().expect("designated provider parses");
        assert_eq!(format, TestHarnessFormat::Libtest);
        assert_eq!(tests.len(), 2);
    }

    #[test]
    fn truncated_provider_output_is_never_treated_as_an_empty_suite() {
        let mut collector = CandidateCollector::default();
        collector.observe(
            &ProveOracleConfig::default(),
            "suite",
            LIBTEST_OUTPUT.as_bytes(),
            true,
        );
        let DifferentialUnavailable::RunUnparsable { detail } = collector.resolve().unwrap_err()
        else {
            panic!("truncated output must be unavailable, not clean");
        };
        assert!(detail.contains("truncated"), "{detail}");
    }

    #[test]
    fn the_suppression_ledger_is_seeded_and_round_trips() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        let path = root.path().join(SUPPRESSIONS_FILE);

        let mut diagnostics = Vec::new();
        let seeded = suppression_ledger(root.path(), &mut diagnostics);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert!(path.is_file(), "the ledger must become a durable store");
        assert!(seeded.rules.is_empty());

        let ledger = SuppressionLedger::new(vec![changeloop_evidence::SuppressionRule {
            id: "flaky-clock".into(),
            test_pattern: "time::*".into(),
            kind: None,
            reason: "known clock flake".into(),
            accepted_by: "maintainer".into(),
            accepted_at_ms: 1,
        }]);
        ledger.save(&path).unwrap();

        let mut diagnostics = Vec::new();
        let reloaded = suppression_ledger(root.path(), &mut diagnostics);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(reloaded, ledger);
    }

    #[test]
    fn an_invalid_suppression_ledger_suppresses_nothing_and_says_so() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        fs::write(
            root.path().join(SUPPRESSIONS_FILE),
            br#"{"version":1,"rules":[{"id":"wide","testPattern":"*","reason":"r","acceptedBy":"a","acceptedAtMs":1}]}"#,
        )
        .unwrap();

        let mut diagnostics = Vec::new();
        let ledger = suppression_ledger(root.path(), &mut diagnostics);

        assert!(
            ledger.rules.is_empty(),
            "a rejected ledger suppresses nothing"
        );
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        assert!(diagnostics[0].contains("nothing was suppressed"));
    }

    #[test]
    fn no_coverage_tool_reports_unknown_rather_than_clean() {
        let root = tempdir().unwrap();
        let mut touched = TouchedLines::new();
        touched.extend_file("src/order.rs", [10, 11]);

        let delta = coverage_evidence(root.path(), &ProveOracleConfig::default(), &touched, None);

        assert_eq!(
            delta.verdict,
            changeloop_evidence::CoverageVerdict::Unknown(CoverageUnavailable::NoToolConfigured)
        );
    }

    #[test]
    fn a_configured_but_missing_coverage_report_is_reported_as_missing() {
        let root = tempdir().unwrap();
        let config = ProveOracleConfig {
            coverage_report: Some("target/lcov.info".into()),
            ..ProveOracleConfig::default()
        };
        let mut touched = TouchedLines::new();
        touched.extend_file("src/order.rs", [10]);

        let delta = coverage_evidence(root.path(), &config, &touched, None);

        assert!(matches!(
            delta.verdict,
            changeloop_evidence::CoverageVerdict::Unknown(
                CoverageUnavailable::ReportMissing { .. }
            )
        ));
    }
}
