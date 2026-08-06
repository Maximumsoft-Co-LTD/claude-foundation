//! Differential testing against the pre-change revision.
//!
//! # Why this is ranked and suppressed rather than simply reported
//!
//! The published differential-testing result differences an agent patch against
//! a **human oracle patch**. Changeloop has no oracle patch. Differencing the
//! suite at the pre-change revision against the suite at the post-change
//! revision yields "behaviour changed", not "behaviour is wrong" — it flags
//! every *intended* change too. An unranked feed of those is an
//! approval-fatigue generator, and review rate predicts defect-catch with no
//! safe-speed threshold.
//!
//! So every divergence is classified against what the change *declared* it
//! would touch, ranked, and optionally suppressed by an explicit, attributed
//! rule. The classification rule is stated in [`classify`] and is exercised
//! directly by the crate's tests.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::coverage::{TouchedLines, normalize_report_path};
use crate::{EvidenceError, open_regular_nofollow, read_limited_json_reader};

pub const DIVERGENCE_VERSION: u8 = 1;
pub const SUPPRESSION_VERSION: u8 = 1;
pub const MAX_SUPPRESSION_RULES: usize = 1_024;
/// Divergence lists are evidence, not logs. Beyond this the report says so
/// rather than growing without bound.
pub const MAX_REPORTED_DIVERGENCES: usize = 5_000;

/// Observed outcome of one test in one run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TestStatus {
    Passed,
    Failed,
    Errored,
    Skipped,
    /// The test did not exist in this run. Only ever synthesised by the
    /// comparison, never parsed from a harness.
    Absent,
}

impl TestStatus {
    pub const fn is_failure(self) -> bool {
        matches!(self, Self::Failed | Self::Errored)
    }

    pub const fn is_present(self) -> bool {
        !matches!(self, Self::Absent)
    }
}

/// One test's identity and outcome. `file` is the source file the test lives
/// in, when the harness reports it; it drives attribution.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestOutcome {
    pub id: String,
    pub status: TestStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

/// Which harness produced a run. Recorded so a comparison never silently spans
/// two different harnesses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TestHarnessFormat {
    /// Rust `libtest` human output, as emitted by `cargo test`.
    Libtest,
    /// `pytest -v` line output.
    Pytest,
    /// `jest --json` report.
    JestJson,
}

/// One suite execution at one revision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub revision: String,
    pub format: TestHarnessFormat,
    pub tests: Vec<TestOutcome>,
}

impl TestRun {
    pub fn new(
        revision: impl Into<String>,
        format: TestHarnessFormat,
        tests: Vec<TestOutcome>,
    ) -> Self {
        Self {
            revision: revision.into(),
            format,
            tests,
        }
    }

    fn index(&self) -> BTreeMap<&str, &TestOutcome> {
        self.tests
            .iter()
            .map(|test| (test.id.as_str(), test))
            .collect()
    }
}

/// The observable transition between the two runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DivergenceKind {
    /// Passed before, fails or errors now.
    NewlyFailing,
    /// Failed or errored before, passes now.
    NewlyPassing,
    /// Ran before, is skipped now.
    NewlySkipped,
    /// Was skipped before, runs now.
    NoLongerSkipped,
    /// Present before, absent now: deleted, renamed, or silently not collected.
    Removed,
    /// Absent before, present now.
    Added,
    /// Any other status transition.
    StatusChanged,
}

/// Whether the change declared this divergence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DivergenceClass {
    /// The change declared it would affect this test, and the transition is one
    /// a declared change plausibly produces.
    Expected,
    /// Worth a human's attention.
    Unexpected,
    /// Matched an explicit, attributed suppression rule.
    Suppressed,
}

/// Attention ordering. Declared low-to-high so `Ord` sorts ascending and
/// display reverses it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DivergenceRank {
    Suppressed,
    Informational,
    Low,
    Medium,
    High,
    Critical,
}

/// What the change said it would touch. Attribution is computed against this,
/// never against the diff alone, so a change can declare intent the diff cannot
/// express (a renamed test, a behaviour-flag flip).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredIntent {
    /// Files the change touched. Matched against `TestOutcome::file`.
    pub touched_files: BTreeSet<String>,
    /// Test-id patterns the change declares it changes. Same pattern grammar as
    /// suppression: an exact id, or a prefix ending in `*`.
    pub declared_test_patterns: BTreeSet<String>,
}

impl DeclaredIntent {
    pub fn from_touched(touched: &TouchedLines) -> Self {
        Self {
            touched_files: touched.files().map(str::to_string).collect(),
            declared_test_patterns: BTreeSet::new(),
        }
    }

    pub fn declare_test_pattern(&mut self, pattern: impl Into<String>) {
        self.declared_test_patterns.insert(pattern.into());
    }

    /// A divergence is *attributed* when the change declared it: the test's
    /// source file is one the change touched, or the test id matches a declared
    /// pattern.
    fn attributes(&self, test: &Divergence) -> bool {
        if let Some(file) = test.file.as_deref() {
            let candidate = normalize_report_path(file);
            if self
                .touched_files
                .iter()
                .any(|touched| path_matches(touched, &candidate))
            {
                return true;
            }
        }
        self.declared_test_patterns
            .iter()
            .any(|pattern| pattern_matches(pattern, &test.test_id))
    }
}

fn path_matches(touched: &str, candidate: &str) -> bool {
    let touched = normalize_report_path(touched);
    touched == candidate
        || suffix_matches(&touched, candidate)
        || suffix_matches(candidate, &touched)
}

fn suffix_matches(long: &str, short: &str) -> bool {
    if long == short {
        return true;
    }
    if short.is_empty() || long.len() <= short.len() {
        return false;
    }
    long.ends_with(short) && long.as_bytes()[long.len() - short.len() - 1] == b'/'
}

/// Pattern grammar, deliberately tiny so it is auditable: an exact match, or a
/// prefix followed by a single trailing `*`. No regular expressions, no globs
/// that can match across separators unexpectedly.
pub fn pattern_matches(pattern: &str, value: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => value.starts_with(prefix),
        None => pattern == value,
    }
}

/// One classified, ranked behavioural difference between the two revisions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Divergence {
    pub test_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    pub baseline: TestStatus,
    pub candidate: TestStatus,
    pub kind: DivergenceKind,
    pub class: DivergenceClass,
    pub rank: DivergenceRank,
    pub attributed: bool,
    /// Which numbered rule in [`classify`] produced this classification. Stable
    /// across runs and asserted by the tests.
    pub rule: DivergenceRule,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suppressed_by: Option<String>,
}

/// The classification rules, numbered. Serialised so a renderer can explain a
/// ranking without re-implementing it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DivergenceRule {
    /// R0 — an explicit suppression rule matched.
    Suppressed,
    /// R1 — a regression on a path the change never declared it would touch.
    UndeclaredRegression,
    /// R2 — a regression on a declared path. Still unexpected: no change
    /// declares that it intends to break a test.
    DeclaredRegression,
    /// R3 — a test vanished from a path the change never declared.
    UndeclaredRemoval,
    /// R4 — a test vanished from a declared path.
    DeclaredRemoval,
    /// R5 — a test stopped running on a path the change never declared.
    UndeclaredSkip,
    /// R6 — a test stopped running on a declared path.
    DeclaredSkip,
    /// R7 — an improvement or addition the change declared.
    DeclaredImprovement,
    /// R8 — an improvement or addition on a path the change never declared.
    UndeclaredImprovement,
    /// R9 — any other transition on an undeclared path.
    UndeclaredOtherChange,
    /// R10 — any other transition on a declared path.
    DeclaredOtherChange,
}

impl DivergenceRule {
    /// Human-readable statement of the rule, for renderers.
    pub const fn rationale(self) -> &'static str {
        match self {
            Self::Suppressed => "an explicit suppression rule marks this divergence class expected",
            Self::UndeclaredRegression => {
                "a test regressed on a path the change did not declare it would touch"
            }
            Self::DeclaredRegression => {
                "a test regressed on a declared path; a regression is never auto-expected"
            }
            Self::UndeclaredRemoval => {
                "a test disappeared and the change did not declare that file or test"
            }
            Self::DeclaredRemoval => "a test disappeared from a file the change declares it edits",
            Self::UndeclaredSkip => {
                "a test stopped running and the change did not declare that file or test"
            }
            Self::DeclaredSkip => "a test stopped running in a file the change declares it edits",
            Self::DeclaredImprovement => {
                "a test started passing or appeared in a file the change declares it edits"
            }
            Self::UndeclaredImprovement => {
                "a test started passing or appeared outside the declared change surface"
            }
            Self::UndeclaredOtherChange => {
                "the test's status changed outside the declared change surface"
            }
            Self::DeclaredOtherChange => {
                "the test's status changed inside the declared change surface"
            }
        }
    }
}

/// An attributed decision that a divergence class is expected and should stop
/// alarming. Suppression is always attributed: an unattributed suppression is
/// indistinguishable from a bug.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuppressionRule {
    pub id: String,
    /// Test-id pattern: exact, or a prefix ending in `*`.
    pub test_pattern: String,
    /// Restrict to one transition. `None` suppresses any transition for the
    /// matching tests.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<DivergenceKind>,
    pub reason: String,
    pub accepted_by: String,
    pub accepted_at_ms: u64,
}

impl SuppressionRule {
    fn matches(&self, divergence: &Divergence) -> bool {
        pattern_matches(&self.test_pattern, &divergence.test_id)
            && self.kind.is_none_or(|kind| kind == divergence.kind)
    }
}

/// A durable set of suppression rules. Rules that matched nothing are reported
/// back as stale so suppression cannot quietly rot into blanket blindness.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuppressionLedger {
    #[serde(default = "default_suppression_version")]
    pub version: u8,
    #[serde(default)]
    pub rules: Vec<SuppressionRule>,
}

fn default_suppression_version() -> u8 {
    SUPPRESSION_VERSION
}

impl SuppressionLedger {
    pub fn new(rules: Vec<SuppressionRule>) -> Self {
        Self {
            version: SUPPRESSION_VERSION,
            rules,
        }
    }

    pub fn validate(&self) -> Result<(), EvidenceError> {
        if self.version != SUPPRESSION_VERSION {
            return Err(EvidenceError::InvalidContract(format!(
                "suppression ledger version must be {SUPPRESSION_VERSION}"
            )));
        }
        if self.rules.len() > MAX_SUPPRESSION_RULES {
            return Err(EvidenceError::CollectionLimit {
                kind: "suppression rules",
                limit: MAX_SUPPRESSION_RULES,
            });
        }
        let mut ids = BTreeSet::new();
        for rule in &self.rules {
            if rule.id.trim().is_empty() || !ids.insert(rule.id.as_str()) {
                return Err(EvidenceError::InvalidContract(
                    "suppression rule IDs must be non-empty and unique".into(),
                ));
            }
            if rule.test_pattern.trim().is_empty() {
                return Err(EvidenceError::InvalidContract(format!(
                    "suppression rule '{}' needs a test pattern",
                    rule.id
                )));
            }
            // A bare `*` would silence the entire oracle; refuse it by construction.
            if rule.test_pattern.trim() == "*" {
                return Err(EvidenceError::InvalidContract(format!(
                    "suppression rule '{}' may not suppress every test",
                    rule.id
                )));
            }
            if rule.reason.trim().is_empty() || rule.accepted_by.trim().is_empty() {
                return Err(EvidenceError::InvalidContract(format!(
                    "suppression rule '{}' needs a reason and an accepting actor",
                    rule.id
                )));
            }
        }
        Ok(())
    }

    /// Load a ledger. A missing file is an empty ledger, not an error.
    pub fn load(path: impl AsRef<Path>) -> Result<Self, EvidenceError> {
        let path = path.as_ref();
        let mut file = match open_regular_nofollow(path, false) {
            Ok(file) => file,
            Err(EvidenceError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::new(Vec::new()));
            }
            Err(error) => return Err(error),
        };
        let ledger: Self = serde_json::from_slice(&read_limited_json_reader(&mut file)?)?;
        ledger.validate()?;
        Ok(ledger)
    }

    /// Persist the ledger with the same write-temp-then-rename discipline the
    /// receipt store uses.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), EvidenceError> {
        self.validate()?;
        let path = path.as_ref();
        let directory: PathBuf = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        fs::create_dir_all(&directory)?;
        let mut bytes = serde_json::to_vec_pretty(self)?;
        bytes.push(b'\n');
        let temporary = directory.join(format!(".suppressions.{}.tmp", Uuid::now_v7()));
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
        if let Err(error) = fs::rename(&temporary, path) {
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
        Ok(())
    }
}

/// Why differential evidence is absent. As with coverage, none of these may be
/// rendered as a clean result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "reason", content = "detail")]
pub enum DifferentialUnavailable {
    /// No pre-change revision exists (an initial commit, a detached workspace).
    NoBaselineRevision,
    /// Running the suite at the pre-change revision was not attempted.
    NotAttempted,
    /// The baseline run could not complete: build failure, timeout, dirty tree.
    BaselineRunFailed { detail: String },
    /// A run's output could not be parsed into per-test outcomes.
    RunUnparsable { detail: String },
    /// The two runs came from different harnesses and are not comparable.
    HarnessMismatch { baseline: String, candidate: String },
}

impl DifferentialUnavailable {
    pub const fn implies_clean(&self) -> bool {
        false
    }
}

/// Differential evidence for one change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DifferentialReport {
    pub version: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<DifferentialUnavailable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<TestHarnessFormat>,
    /// Sorted by rank descending, then by test id. Deterministic.
    pub divergences: Vec<Divergence>,
    pub baseline_tests: usize,
    pub candidate_tests: usize,
    pub unexpected: usize,
    pub expected: usize,
    pub suppressed: usize,
    /// Rules that matched no divergence in this run. Surfaced so suppressions
    /// can be retired instead of accumulating.
    pub stale_suppression_rules: Vec<String>,
    /// True when the divergence list was capped.
    pub truncated: bool,
}

impl DifferentialReport {
    pub fn unavailable(reason: DifferentialUnavailable) -> Self {
        Self {
            version: DIVERGENCE_VERSION,
            unavailable: Some(reason),
            baseline_revision: None,
            candidate_revision: None,
            format: None,
            divergences: Vec::new(),
            baseline_tests: 0,
            candidate_tests: 0,
            unexpected: 0,
            expected: 0,
            suppressed: 0,
            stale_suppression_rules: Vec::new(),
            truncated: false,
        }
    }

    pub fn is_available(&self) -> bool {
        self.unavailable.is_none()
    }

    /// The highest rank present, ignoring suppressed entries.
    pub fn highest_rank(&self) -> Option<DivergenceRank> {
        self.divergences
            .iter()
            .filter(|divergence| divergence.class != DivergenceClass::Suppressed)
            .map(|divergence| divergence.rank)
            .max()
    }

    pub fn unexpected_divergences(&self) -> impl Iterator<Item = &Divergence> {
        self.divergences
            .iter()
            .filter(|divergence| divergence.class == DivergenceClass::Unexpected)
    }
}

/// Compare a pre-change run against a post-change run, classify and rank every
/// difference, and apply suppression.
pub fn differential_report(
    baseline: &TestRun,
    candidate: &TestRun,
    intent: &DeclaredIntent,
    suppressions: &SuppressionLedger,
) -> DifferentialReport {
    if baseline.format != candidate.format {
        return DifferentialReport::unavailable(DifferentialUnavailable::HarnessMismatch {
            baseline: format!("{:?}", baseline.format),
            candidate: format!("{:?}", candidate.format),
        });
    }

    let before = baseline.index();
    let after = candidate.index();
    let ids: BTreeSet<&str> = before.keys().chain(after.keys()).copied().collect();

    let mut divergences = Vec::new();
    let mut matched_rules: BTreeSet<&str> = BTreeSet::new();
    for id in ids {
        let baseline_test = before.get(id);
        let candidate_test = after.get(id);
        let baseline_status = baseline_test.map_or(TestStatus::Absent, |test| test.status);
        let candidate_status = candidate_test.map_or(TestStatus::Absent, |test| test.status);
        if baseline_status == candidate_status {
            continue;
        }
        let file = candidate_test
            .or(baseline_test)
            .and_then(|test| test.file.clone());
        let kind = kind_of(baseline_status, candidate_status);
        let mut divergence = Divergence {
            test_id: id.to_string(),
            file,
            baseline: baseline_status,
            candidate: candidate_status,
            kind,
            // Placeholders replaced by `classify` below.
            class: DivergenceClass::Unexpected,
            rank: DivergenceRank::Medium,
            attributed: false,
            rule: DivergenceRule::UndeclaredOtherChange,
            suppressed_by: None,
        };
        let attributed = intent.attributes(&divergence);
        let suppression = suppressions
            .rules
            .iter()
            .find(|rule| rule.matches(&divergence));
        if let Some(rule) = suppression {
            matched_rules.insert(rule.id.as_str());
        }
        classify(
            &mut divergence,
            attributed,
            suppression.map(|rule| rule.id.as_str()),
        );
        divergences.push(divergence);
    }

    divergences.sort_by(|left, right| {
        right
            .rank
            .cmp(&left.rank)
            .then_with(|| left.test_id.cmp(&right.test_id))
    });
    let truncated = divergences.len() > MAX_REPORTED_DIVERGENCES;
    divergences.truncate(MAX_REPORTED_DIVERGENCES);

    let unexpected = divergences
        .iter()
        .filter(|divergence| divergence.class == DivergenceClass::Unexpected)
        .count();
    let expected = divergences
        .iter()
        .filter(|divergence| divergence.class == DivergenceClass::Expected)
        .count();
    let suppressed = divergences
        .iter()
        .filter(|divergence| divergence.class == DivergenceClass::Suppressed)
        .count();
    let stale_suppression_rules = suppressions
        .rules
        .iter()
        .filter(|rule| !matched_rules.contains(rule.id.as_str()))
        .map(|rule| rule.id.clone())
        .collect();

    DifferentialReport {
        version: DIVERGENCE_VERSION,
        unavailable: None,
        baseline_revision: Some(baseline.revision.clone()),
        candidate_revision: Some(candidate.revision.clone()),
        format: Some(candidate.format),
        divergences,
        baseline_tests: baseline.tests.len(),
        candidate_tests: candidate.tests.len(),
        unexpected,
        expected,
        suppressed,
        stale_suppression_rules,
        truncated,
    }
}

fn kind_of(baseline: TestStatus, candidate: TestStatus) -> DivergenceKind {
    match (baseline, candidate) {
        (TestStatus::Absent, _) => DivergenceKind::Added,
        (_, TestStatus::Absent) => DivergenceKind::Removed,
        (before, after) if !before.is_failure() && after.is_failure() => {
            DivergenceKind::NewlyFailing
        }
        (before, after) if before.is_failure() && after == TestStatus::Passed => {
            DivergenceKind::NewlyPassing
        }
        (before, TestStatus::Skipped) if before.is_present() => DivergenceKind::NewlySkipped,
        (TestStatus::Skipped, after) if after.is_present() => DivergenceKind::NoLongerSkipped,
        _ => DivergenceKind::StatusChanged,
    }
}

/// # The ranking rule
///
/// Applied in order; the first matching row wins. `attributed` means the change
/// declared the test's file or the test id (see [`DeclaredIntent`]).
///
/// | # | Condition | Class | Rank |
/// |---|---|---|---|
/// | R0 | a suppression rule matches | `Suppressed` | `Suppressed` |
/// | R1 | `NewlyFailing`, unattributed | `Unexpected` | `Critical` |
/// | R2 | `NewlyFailing`, attributed | `Unexpected` | `High` |
/// | R3 | `Removed`, unattributed | `Unexpected` | `Critical` |
/// | R4 | `Removed`, attributed | `Expected` | `Informational` |
/// | R5 | `NewlySkipped`, unattributed | `Unexpected` | `High` |
/// | R6 | `NewlySkipped`, attributed | `Expected` | `Informational` |
/// | R7 | `NewlyPassing` / `NoLongerSkipped` / `Added`, attributed | `Expected` | `Informational` |
/// | R8 | `NewlyPassing` / `NoLongerSkipped` / `Added`, unattributed | `Unexpected` | `Low` |
/// | R9 | any other transition, unattributed | `Unexpected` | `Medium` |
/// | R10 | any other transition, attributed | `Expected` | `Informational` |
///
/// Two properties are deliberate:
///
/// - **A regression is never auto-classified as expected.** R2 lowers the rank
///   of an attributed regression but keeps it `Unexpected`; only an explicit,
///   attributed suppression rule can silence it. No change declares that it
///   intends to break a test.
/// - **Undeclared beats declared.** The transfer gap means "behaviour changed"
///   is uninformative on the declared surface and highly informative off it, so
///   every undeclared row outranks its declared counterpart.
fn classify(divergence: &mut Divergence, attributed: bool, suppressed_by: Option<&str>) {
    divergence.attributed = attributed;
    if let Some(rule_id) = suppressed_by {
        divergence.class = DivergenceClass::Suppressed;
        divergence.rank = DivergenceRank::Suppressed;
        divergence.rule = DivergenceRule::Suppressed;
        divergence.suppressed_by = Some(rule_id.to_string());
        return;
    }
    let (class, rank, rule) = match (divergence.kind, attributed) {
        (DivergenceKind::NewlyFailing, false) => (
            DivergenceClass::Unexpected,
            DivergenceRank::Critical,
            DivergenceRule::UndeclaredRegression,
        ),
        (DivergenceKind::NewlyFailing, true) => (
            DivergenceClass::Unexpected,
            DivergenceRank::High,
            DivergenceRule::DeclaredRegression,
        ),
        (DivergenceKind::Removed, false) => (
            DivergenceClass::Unexpected,
            DivergenceRank::Critical,
            DivergenceRule::UndeclaredRemoval,
        ),
        (DivergenceKind::Removed, true) => (
            DivergenceClass::Expected,
            DivergenceRank::Informational,
            DivergenceRule::DeclaredRemoval,
        ),
        (DivergenceKind::NewlySkipped, false) => (
            DivergenceClass::Unexpected,
            DivergenceRank::High,
            DivergenceRule::UndeclaredSkip,
        ),
        (DivergenceKind::NewlySkipped, true) => (
            DivergenceClass::Expected,
            DivergenceRank::Informational,
            DivergenceRule::DeclaredSkip,
        ),
        (
            DivergenceKind::NewlyPassing | DivergenceKind::NoLongerSkipped | DivergenceKind::Added,
            true,
        ) => (
            DivergenceClass::Expected,
            DivergenceRank::Informational,
            DivergenceRule::DeclaredImprovement,
        ),
        (
            DivergenceKind::NewlyPassing | DivergenceKind::NoLongerSkipped | DivergenceKind::Added,
            false,
        ) => (
            DivergenceClass::Unexpected,
            DivergenceRank::Low,
            DivergenceRule::UndeclaredImprovement,
        ),
        (DivergenceKind::StatusChanged, false) => (
            DivergenceClass::Unexpected,
            DivergenceRank::Medium,
            DivergenceRule::UndeclaredOtherChange,
        ),
        (DivergenceKind::StatusChanged, true) => (
            DivergenceClass::Expected,
            DivergenceRank::Informational,
            DivergenceRule::DeclaredOtherChange,
        ),
    };
    divergence.class = class;
    divergence.rank = rank;
    divergence.rule = rule;
    divergence.suppressed_by = None;
}

/// Detect the harness that produced `text` and parse per-test outcomes.
pub fn parse_test_outcomes(text: &str) -> Option<(TestHarnessFormat, Vec<TestOutcome>)> {
    if let Some(value) = crate::parse_json_output(text)
        && let Some(tests) = parse_jest_json_outcomes(&value)
    {
        return Some((TestHarnessFormat::JestJson, tests));
    }
    if let Some(tests) = parse_pytest_outcomes(text) {
        return Some((TestHarnessFormat::Pytest, tests));
    }
    parse_libtest_outcomes(text).map(|tests| (TestHarnessFormat::Libtest, tests))
}

/// Rust `libtest` human output: `test module::name ... ok`.
///
/// Test ids are prefixed with the binary name when `cargo test` announces one
/// (`Running unittests src/lib.rs (target/debug/deps/foo-abc)`), because the
/// same test path can exist in several binaries.
pub fn parse_libtest_outcomes(text: &str) -> Option<Vec<TestOutcome>> {
    let mut tests = Vec::new();
    let mut binary: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Running ") {
            binary = libtest_binary(rest);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("Doc-tests ") {
            binary = Some(format!("doc:{}", rest.trim()));
            continue;
        }
        let Some(rest) = trimmed.strip_prefix("test ") else {
            continue;
        };
        let Some((name, verdict)) = rest.rsplit_once(" ... ") else {
            continue;
        };
        let status = match verdict.trim() {
            "ok" => TestStatus::Passed,
            "FAILED" => TestStatus::Failed,
            "ignored" => TestStatus::Skipped,
            verdict if verdict.starts_with("ignored,") => TestStatus::Skipped,
            _ => continue,
        };
        let id = match &binary {
            Some(binary) => format!("{binary}::{}", name.trim()),
            None => name.trim().to_string(),
        };
        tests.push(TestOutcome {
            id,
            status,
            file: None,
        });
    }
    (!tests.is_empty()).then_some(tests)
}

fn libtest_binary(rest: &str) -> Option<String> {
    // `unittests src/lib.rs (target/debug/deps/changeloop_evidence-1f2e)`
    let source = rest.split_whitespace().nth(1)?;
    Some(normalize_report_path(source))
}

/// `pytest -v` line output: `tests/test_x.py::test_name PASSED [ 50%]`.
pub fn parse_pytest_outcomes(text: &str) -> Option<Vec<TestOutcome>> {
    let mut tests = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        let Some((id, rest)) = trimmed.split_once(char::is_whitespace) else {
            continue;
        };
        if !id.contains("::") || !id.contains(".py") {
            continue;
        }
        let verdict = rest.split_whitespace().next().unwrap_or_default();
        let status = match verdict {
            "PASSED" | "XPASS" => TestStatus::Passed,
            "FAILED" => TestStatus::Failed,
            "ERROR" => TestStatus::Errored,
            "SKIPPED" | "XFAIL" => TestStatus::Skipped,
            _ => continue,
        };
        let file = id.split("::").next().map(normalize_report_path);
        tests.push(TestOutcome {
            id: normalize_report_path(id),
            status,
            file,
        });
    }
    (!tests.is_empty()).then_some(tests)
}

/// `jest --json`: `testResults[].assertionResults[]` with `fullName` and `status`.
pub fn parse_jest_json_outcomes(report: &Value) -> Option<Vec<TestOutcome>> {
    let suites = report.get("testResults")?.as_array()?;
    let mut tests = Vec::new();
    for suite in suites {
        let file = suite
            .get("name")
            .or_else(|| suite.get("testFilePath"))
            .and_then(Value::as_str)
            .map(normalize_report_path);
        let Some(assertions) = suite.get("assertionResults").and_then(Value::as_array) else {
            continue;
        };
        for assertion in assertions {
            let name = assertion
                .get("fullName")
                .or_else(|| assertion.get("title"))
                .and_then(Value::as_str)?;
            let status = match assertion.get("status").and_then(Value::as_str)? {
                "passed" => TestStatus::Passed,
                "failed" => TestStatus::Failed,
                "pending" | "skipped" | "todo" | "disabled" => TestStatus::Skipped,
                _ => continue,
            };
            let id = match &file {
                Some(file) => format!("{file}::{name}"),
                None => name.to_string(),
            };
            tests.push(TestOutcome {
                id,
                status,
                file: file.clone(),
            });
        }
    }
    (!tests.is_empty()).then_some(tests)
}
