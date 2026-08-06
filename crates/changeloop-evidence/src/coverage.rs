//! Coverage delta on the lines a change actually touched.
//!
//! A green suite is only evidence about the code it executed. This module turns
//! a standard coverage report (LCOV or Cobertura) plus the change's touched
//! lines into a typed statement about which changed lines the suite exercised.
//!
//! Three honesty rules are load-bearing and are enforced by the types:
//!
//! 1. A touched line with no entry in the coverage report is **unmeasured**,
//!    never "uncovered". Coverage tools emit records only for instrumented
//!    lines, so treating a brace or a comment as uncovered manufactures alarm.
//! 2. A touched file absent from the report is **not measured**, never "zero
//!    coverage". Absence of evidence is not evidence of absence.
//! 3. When no report is available at all the verdict is
//!    [`CoverageVerdict::Unknown`], which carries the reason and can never be
//!    rendered as a clean result.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::open_regular_nofollow;

pub const COVERAGE_VERSION: u8 = 1;

/// Coverage reports are large but not unbounded; refuse anything absurd rather
/// than reading it into memory.
pub const MAX_COVERAGE_REPORT_BYTES: u64 = 64 * 1024 * 1024;

/// Standard coverage interchange formats. Both are emitted by the toolchains
/// this repository orchestrates: `cargo-llvm-cov` and `cargo-tarpaulin`,
/// `pytest-cov`, and `jest --coverage`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoverageFormat {
    Lcov,
    Cobertura,
}

/// Why coverage evidence could not be produced. Every variant means "unknown",
/// and none of them may be rendered as "clean".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "reason", content = "detail")]
pub enum CoverageUnavailable {
    /// The project declares no coverage provider for this language or suite.
    NoToolConfigured,
    /// A report path was expected but nothing exists there.
    ReportMissing { expected_path: String },
    /// The report exists but could not be read (permissions, size, symlink).
    ReportUnreadable { detail: String },
    /// The report was read but matched no known format, or contained no records.
    ReportUnparsable { detail: String },
    /// The report parsed, but none of the touched files appear in it, so the
    /// suite's relationship to the change is unknown rather than absent.
    TouchedFilesNotInReport,
    /// The change touched no files, so there is nothing to measure.
    NoTouchedFiles,
}

impl CoverageUnavailable {
    /// Coverage-unavailable is never a clean result. Kept as an explicit method
    /// so a renderer cannot accidentally treat the absence as a pass.
    pub const fn implies_clean(&self) -> bool {
        false
    }
}

/// The set of lines a change touched, keyed by repository-relative path.
///
/// A file with an empty line set is still touched (a pure deletion, a rename,
/// or a mode change) and still participates in divergence attribution.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TouchedLines {
    files: BTreeMap<String, BTreeSet<u32>>,
}

impl TouchedLines {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a touched file with no specific lines (deletion, rename, mode).
    pub fn touch_file(&mut self, path: impl Into<String>) {
        self.files
            .entry(normalize_report_path(&path.into()))
            .or_default();
    }

    pub fn insert(&mut self, path: impl Into<String>, line: u32) {
        self.files
            .entry(normalize_report_path(&path.into()))
            .or_default()
            .insert(line);
    }

    pub fn extend_file(&mut self, path: impl Into<String>, lines: impl IntoIterator<Item = u32>) {
        self.files
            .entry(normalize_report_path(&path.into()))
            .or_default()
            .extend(lines);
    }

    pub fn files(&self) -> impl Iterator<Item = &str> {
        self.files.keys().map(String::as_str)
    }

    pub fn lines(&self, path: &str) -> Option<&BTreeSet<u32>> {
        self.files.get(&normalize_report_path(path))
    }

    /// True when `path` names one of the touched files, comparing on the same
    /// normalised-suffix rule the coverage matcher uses.
    pub fn contains_file(&self, path: &str) -> bool {
        let candidate = normalize_report_path(path);
        self.files.keys().any(|touched| {
            suffix_matches(touched, &candidate) || suffix_matches(&candidate, touched)
        })
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    pub fn len(&self) -> usize {
        self.files.len()
    }

    /// Derive touched lines from a unified diff. Line numbers are post-change,
    /// which is the numbering every coverage report uses.
    ///
    /// Hunk line budgets are tracked so that diff *content* beginning with
    /// `---` or `+++` (a SQL comment, a Markdown rule) is never mistaken for a
    /// file header.
    pub fn from_unified_diff(diff: &str) -> Self {
        let mut touched = Self::new();
        let mut current: Option<String> = None;
        let mut fallback: Option<String> = None;
        let mut next_line = 0u32;
        let mut old_remaining = 0u32;
        let mut new_remaining = 0u32;
        for line in diff.lines() {
            // Hunk content always begins with a marker byte. Anything else ends
            // the hunk regardless of what the header's line budget claimed, so a
            // wrong or truncated count cannot swallow the next file header.
            if !matches!(
                line.as_bytes().first(),
                Some(b' ' | b'+' | b'-' | b'\\') | None
            ) {
                old_remaining = 0;
                new_remaining = 0;
            }
            let inside_hunk = old_remaining > 0 || new_remaining > 0;
            if !inside_hunk {
                if let Some(rest) = line.strip_prefix("--- ") {
                    fallback = diff_path(rest);
                    current = None;
                    next_line = 0;
                    continue;
                }
                if let Some(rest) = line.strip_prefix("+++ ") {
                    current = diff_path(rest);
                    next_line = 0;
                    match (&current, &fallback) {
                        // Pure deletion: `+++ /dev/null`. The old path is still touched.
                        (None, Some(old)) => touched.touch_file(old.clone()),
                        (Some(new), _) => touched.touch_file(new.clone()),
                        _ => {}
                    }
                    continue;
                }
            }
            if !inside_hunk && line.starts_with("@@") {
                let Some(header) = parse_hunk_header(line) else {
                    continue;
                };
                next_line = header.new_start;
                old_remaining = header.old_count;
                new_remaining = header.new_count;
                continue;
            }
            let Some(path) = current.as_ref() else {
                continue;
            };
            if !inside_hunk {
                continue;
            }
            match line.as_bytes().first() {
                Some(b'+') => {
                    touched.insert(path.clone(), next_line);
                    next_line += 1;
                    new_remaining = new_remaining.saturating_sub(1);
                }
                Some(b'-') => old_remaining = old_remaining.saturating_sub(1),
                Some(b'\\') => {}
                // A context line, including the empty line git emits for one.
                _ => {
                    next_line += 1;
                    new_remaining = new_remaining.saturating_sub(1);
                    old_remaining = old_remaining.saturating_sub(1);
                }
            }
        }
        touched
    }
}

fn diff_path(value: &str) -> Option<String> {
    let path = value.split('\t').next().unwrap_or(value).trim();
    if path.is_empty() || path == "/dev/null" {
        return None;
    }
    let path = path
        .strip_prefix("a/")
        .or_else(|| path.strip_prefix("b/"))
        .unwrap_or(path);
    Some(normalize_report_path(path))
}

struct HunkHeader {
    new_start: u32,
    old_count: u32,
    new_count: u32,
}

/// Parse `@@ -old_start[,old_count] +new_start[,new_count] @@`. A missing count
/// means one line, per the unified diff format.
fn parse_hunk_header(line: &str) -> Option<HunkHeader> {
    let body = line.trim_start_matches('@').trim();
    let mut ranges = body.split_whitespace();
    let old = ranges.next()?.strip_prefix('-')?;
    let new = ranges.next()?.strip_prefix('+')?;
    let range = |value: &str| -> Option<(u32, u32)> {
        let mut parts = value.split(',');
        let start = parts.next()?.trim().parse().ok()?;
        let count = match parts.next() {
            Some(count) => count.trim().parse().ok()?,
            None => 1,
        };
        Some((start, count))
    };
    let (_, old_count) = range(old)?;
    let (new_start, new_count) = range(new)?;
    Some(HunkHeader {
        new_start,
        old_count,
        new_count,
    })
}

/// A parsed coverage report: hit counts per line, per file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoverageReport {
    format: CoverageFormat,
    files: BTreeMap<String, BTreeMap<u32, u64>>,
}

impl CoverageReport {
    pub fn format(&self) -> CoverageFormat {
        self.format
    }

    pub fn files(&self) -> impl Iterator<Item = &str> {
        self.files.keys().map(String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// Resolve a touched path against the report. Report paths vary (absolute,
    /// `./`-prefixed, package-relative), so matching is: exact normalised match
    /// first, then a unique path-component-boundary suffix match in either
    /// direction. More than one non-exact candidate is ambiguous, never a guess.
    fn resolve(&self, touched: &str) -> PathResolution<'_> {
        if let Some(lines) = self.files.get(touched) {
            return PathResolution::Unique(lines);
        }
        let mut matches = self
            .files
            .iter()
            .filter(|(path, _)| suffix_matches(path, touched) || suffix_matches(touched, path));
        match (matches.next(), matches.next()) {
            (Some((_, lines)), None) => PathResolution::Unique(lines),
            (Some(_), Some(_)) => PathResolution::Ambiguous,
            _ => PathResolution::Absent,
        }
    }
}

enum PathResolution<'a> {
    Unique(&'a BTreeMap<u32, u64>),
    Ambiguous,
    Absent,
}

/// Read a coverage report from disk. Failures degrade to a typed
/// [`CoverageUnavailable`] rather than an error, because "coverage is missing"
/// is itself evidence the caller must surface.
pub fn read_coverage_report(path: impl AsRef<Path>) -> Result<String, CoverageUnavailable> {
    let path = path.as_ref();
    let display = path.display().to_string();
    let file = open_regular_nofollow(path, false).map_err(|error| match &error {
        crate::EvidenceError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => {
            CoverageUnavailable::ReportMissing {
                expected_path: display.clone(),
            }
        }
        _ => CoverageUnavailable::ReportUnreadable {
            detail: error.to_string(),
        },
    })?;
    let mut bytes = Vec::new();
    file.take(MAX_COVERAGE_REPORT_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| CoverageUnavailable::ReportUnreadable {
            detail: error.to_string(),
        })?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_COVERAGE_REPORT_BYTES {
        return Err(CoverageUnavailable::ReportUnreadable {
            detail: format!("report exceeds the safe {MAX_COVERAGE_REPORT_BYTES}-byte limit"),
        });
    }
    String::from_utf8(bytes).map_err(|error| CoverageUnavailable::ReportUnreadable {
        detail: error.to_string(),
    })
}

/// Detect and parse a coverage report in any supported format.
pub fn parse_coverage_report(text: &str) -> Result<CoverageReport, CoverageUnavailable> {
    match detect_coverage_format(text) {
        Some(CoverageFormat::Lcov) => parse_lcov(text),
        Some(CoverageFormat::Cobertura) => parse_cobertura(text),
        None => Err(CoverageUnavailable::ReportUnparsable {
            detail: "report matched neither LCOV nor Cobertura".into(),
        }),
    }
}

pub fn detect_coverage_format(text: &str) -> Option<CoverageFormat> {
    if text
        .lines()
        .any(|line| line.trim_start().starts_with("SF:"))
    {
        return Some(CoverageFormat::Lcov);
    }
    if text.contains("<coverage") && text.contains("<line") {
        return Some(CoverageFormat::Cobertura);
    }
    None
}

/// LCOV tracefile: `SF:<path>` opens a record, `DA:<line>,<hits>` reports an
/// instrumented line, `end_of_record` closes it. Repeated records for one file
/// are merged by summing hits, which is what `lcov --add-tracefile` does.
pub fn parse_lcov(text: &str) -> Result<CoverageReport, CoverageUnavailable> {
    let mut files: BTreeMap<String, BTreeMap<u32, u64>> = BTreeMap::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(path) = line.strip_prefix("SF:") {
            let path = normalize_report_path(path.trim());
            files.entry(path.clone()).or_default();
            current = Some(path);
            continue;
        }
        if line == "end_of_record" {
            current = None;
            continue;
        }
        let Some(record) = line.strip_prefix("DA:") else {
            continue;
        };
        let Some(path) = current.as_ref() else {
            continue;
        };
        let mut parts = record.split(',');
        let (Some(number), Some(hits)) = (parts.next(), parts.next()) else {
            continue;
        };
        let (Ok(number), Ok(hits)) = (number.trim().parse::<u32>(), hits.trim().parse::<u64>())
        else {
            continue;
        };
        let entry = files
            .entry(path.clone())
            .or_default()
            .entry(number)
            .or_insert(0);
        *entry = entry.saturating_add(hits);
    }
    finish(files, CoverageFormat::Lcov)
}

/// Cobertura XML. Parsed with a tolerant tag scanner rather than a full XML
/// dependency: only `<class filename=…>` and `<line number=… hits=…>` are
/// load-bearing, and both are attribute-only elements.
pub fn parse_cobertura(text: &str) -> Result<CoverageReport, CoverageUnavailable> {
    let mut files: BTreeMap<String, BTreeMap<u32, u64>> = BTreeMap::new();
    let mut current: Option<String> = None;
    for tag in tags(text) {
        let name = tag_name(tag);
        match name {
            "class" => {
                current = attribute(tag, "filename").map(|path| normalize_report_path(&path));
                if let Some(path) = current.clone() {
                    files.entry(path).or_default();
                }
            }
            "/class" => current = None,
            "line" => {
                let Some(path) = current.as_ref() else {
                    continue;
                };
                let (Some(number), Some(hits)) = (attribute(tag, "number"), attribute(tag, "hits"))
                else {
                    continue;
                };
                let (Ok(number), Ok(hits)) =
                    (number.trim().parse::<u32>(), hits.trim().parse::<u64>())
                else {
                    continue;
                };
                let entry = files
                    .entry(path.clone())
                    .or_default()
                    .entry(number)
                    .or_insert(0);
                *entry = entry.saturating_add(hits);
            }
            _ => {}
        }
    }
    finish(files, CoverageFormat::Cobertura)
}

fn finish(
    files: BTreeMap<String, BTreeMap<u32, u64>>,
    format: CoverageFormat,
) -> Result<CoverageReport, CoverageUnavailable> {
    if files.values().all(BTreeMap::is_empty) {
        return Err(CoverageUnavailable::ReportUnparsable {
            detail: "report contained no per-line records".into(),
        });
    }
    Ok(CoverageReport { format, files })
}

fn tags(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = text;
    std::iter::from_fn(move || {
        loop {
            let start = rest.find('<')?;
            let after = &rest[start + 1..];
            let end = after.find('>')?;
            let tag = &after[..end];
            rest = &after[end + 1..];
            if !tag.starts_with('!') && !tag.starts_with('?') {
                return Some(tag);
            }
        }
    })
}

fn tag_name(tag: &str) -> &str {
    tag.split([' ', '\t', '\n', '\r', '/'])
        .find(|part| !part.is_empty())
        .map(|part| {
            if tag.starts_with('/') {
                // `split` already dropped the slash; restore the closing form.
                &tag[..part.len() + 1]
            } else {
                part
            }
        })
        .unwrap_or("")
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let mut rest = tag;
    while let Some(index) = rest.find(name) {
        let before_ok = index == 0
            || rest.as_bytes()[index - 1].is_ascii_whitespace()
            || rest.as_bytes()[index - 1] == b'<';
        let after = &rest[index + name.len()..];
        let trimmed = after.trim_start();
        if before_ok && let Some(value) = trimmed.strip_prefix('=') {
            let value = value.trim_start();
            let quote = value.chars().next()?;
            if quote == '"' || quote == '\'' {
                let value = &value[1..];
                let end = value.find(quote)?;
                return Some(decode_entities(&value[..end]));
            }
        }
        rest = after;
    }
    None
}

fn decode_entities(value: &str) -> String {
    if !value.contains('&') {
        return value.to_string();
    }
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Why a touched file could or could not be measured.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TouchedFileStatus {
    /// The file appears in the coverage report and its touched lines were classified.
    Measured,
    /// The file does not appear in the report. Coverage is unknown, not zero.
    NotInReport,
    /// More than one report entry could be this file; guessing would be dishonest.
    AmbiguousInReport,
    /// The file is touched but has no post-change lines (deletion, rename, mode).
    NoTouchedLines,
}

/// Per-file coverage of the lines this change touched.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchedFileCoverage {
    pub path: String,
    pub status: TouchedFileStatus,
    /// Touched lines the suite executed at least once.
    pub covered_lines: BTreeSet<u32>,
    /// Touched lines the report says are instrumented and were executed zero times.
    pub uncovered_lines: BTreeSet<u32>,
    /// Touched lines with no record in the report: not instrumented, and
    /// therefore not evidence of anything. Never counted as uncovered.
    pub unmeasured_lines: BTreeSet<u32>,
}

impl TouchedFileCoverage {
    pub fn executable_touched_lines(&self) -> usize {
        self.covered_lines.len() + self.uncovered_lines.len()
    }

    /// True only when the suite executed every instrumented touched line and at
    /// least one such line exists.
    pub fn fully_exercised(&self) -> bool {
        self.status == TouchedFileStatus::Measured
            && self.uncovered_lines.is_empty()
            && !self.covered_lines.is_empty()
    }
}

/// The headline coverage statement. `Unknown` is a first-class outcome and
/// carries its reason so a renderer never has to infer one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "verdict", content = "reason")]
pub enum CoverageVerdict {
    /// Every instrumented touched line ran. The strongest available signal,
    /// and still not proof of correctness.
    ChangedPathExercised,
    /// Some instrumented touched lines ran and some did not, or part of the
    /// change could not be measured.
    ChangedPathPartiallyExercised,
    /// The suite executed none of the instrumented touched lines. This is the
    /// single most important output of this module: a green suite here is not
    /// evidence about the change.
    ChangedPathUnexercised,
    /// The change touched no instrumented lines at all (documentation,
    /// comments, configuration). Not a pass and not a failure.
    NoExecutableChange,
    /// No usable coverage evidence exists. Absence of evidence.
    Unknown(CoverageUnavailable),
}

impl CoverageVerdict {
    /// The only verdict that is positive evidence the suite touched the change.
    pub const fn is_evidence_of_exercise(&self) -> bool {
        matches!(self, Self::ChangedPathExercised)
    }

    /// True when a human should be told the suite's relationship to the change
    /// is weak or unknown.
    pub const fn warrants_warning(&self) -> bool {
        !matches!(self, Self::ChangedPathExercised)
    }
}

/// Coverage evidence for one change: the verdict, the per-file breakdown, and
/// the totals a renderer needs without re-deriving them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageDelta {
    pub version: u8,
    pub verdict: CoverageVerdict,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<CoverageFormat>,
    pub files: Vec<TouchedFileCoverage>,
    pub touched_files: usize,
    pub touched_lines_covered: usize,
    pub touched_lines_uncovered: usize,
    pub touched_lines_unmeasured: usize,
    pub files_not_measured: usize,
}

impl CoverageDelta {
    /// Build the honest "no coverage" delta. Used whenever a report is absent,
    /// unreadable, or unparsable.
    pub fn unavailable(reason: CoverageUnavailable) -> Self {
        Self {
            version: COVERAGE_VERSION,
            verdict: CoverageVerdict::Unknown(reason),
            format: None,
            files: Vec::new(),
            touched_files: 0,
            touched_lines_covered: 0,
            touched_lines_uncovered: 0,
            touched_lines_unmeasured: 0,
            files_not_measured: 0,
        }
    }

    /// Files whose touched lines were measured and include at least one line
    /// the suite never executed.
    pub fn unexercised_files(&self) -> impl Iterator<Item = &TouchedFileCoverage> {
        self.files
            .iter()
            .filter(|file| !file.uncovered_lines.is_empty())
    }
}

/// Compute the coverage delta for the lines a change touched.
///
/// `report` is `None` when the project configured no coverage provider; that is
/// reported as [`CoverageUnavailable::NoToolConfigured`], never as clean.
pub fn coverage_delta(touched: &TouchedLines, report: Option<&CoverageReport>) -> CoverageDelta {
    if touched.is_empty() {
        return CoverageDelta::unavailable(CoverageUnavailable::NoTouchedFiles);
    }
    let Some(report) = report else {
        return CoverageDelta::unavailable(CoverageUnavailable::NoToolConfigured);
    };

    let mut files = Vec::new();
    let mut covered = 0usize;
    let mut uncovered = 0usize;
    let mut unmeasured = 0usize;
    let mut not_measured_files = 0usize;
    let mut measured_files = 0usize;

    for path in touched.files() {
        let lines = touched.lines(path).cloned().unwrap_or_default();
        if lines.is_empty() {
            files.push(TouchedFileCoverage {
                path: path.to_string(),
                status: TouchedFileStatus::NoTouchedLines,
                covered_lines: BTreeSet::new(),
                uncovered_lines: BTreeSet::new(),
                unmeasured_lines: BTreeSet::new(),
            });
            continue;
        }
        let entry = match report.resolve(path) {
            PathResolution::Unique(hits) => {
                measured_files += 1;
                let mut file = TouchedFileCoverage {
                    path: path.to_string(),
                    status: TouchedFileStatus::Measured,
                    covered_lines: BTreeSet::new(),
                    uncovered_lines: BTreeSet::new(),
                    unmeasured_lines: BTreeSet::new(),
                };
                for line in &lines {
                    match hits.get(line) {
                        Some(0) => {
                            file.uncovered_lines.insert(*line);
                        }
                        Some(_) => {
                            file.covered_lines.insert(*line);
                        }
                        // No record: the line is not instrumented. Unmeasured,
                        // deliberately not counted as uncovered.
                        None => {
                            file.unmeasured_lines.insert(*line);
                        }
                    }
                }
                covered += file.covered_lines.len();
                uncovered += file.uncovered_lines.len();
                unmeasured += file.unmeasured_lines.len();
                file
            }
            resolution => {
                not_measured_files += 1;
                unmeasured += lines.len();
                TouchedFileCoverage {
                    path: path.to_string(),
                    status: match resolution {
                        PathResolution::Ambiguous => TouchedFileStatus::AmbiguousInReport,
                        _ => TouchedFileStatus::NotInReport,
                    },
                    covered_lines: BTreeSet::new(),
                    uncovered_lines: BTreeSet::new(),
                    unmeasured_lines: lines.clone(),
                }
            }
        };
        files.push(entry);
    }

    let executable = covered + uncovered;
    let verdict = if measured_files == 0 {
        if not_measured_files == 0 {
            // Every touched file is a deletion or has no post-change lines.
            CoverageVerdict::NoExecutableChange
        } else {
            CoverageVerdict::Unknown(CoverageUnavailable::TouchedFilesNotInReport)
        }
    } else if executable == 0 {
        if not_measured_files == 0 {
            CoverageVerdict::NoExecutableChange
        } else {
            CoverageVerdict::Unknown(CoverageUnavailable::TouchedFilesNotInReport)
        }
    } else if covered == 0 {
        CoverageVerdict::ChangedPathUnexercised
    } else if covered < executable || not_measured_files > 0 {
        // An unmeasured file caps the verdict: full coverage of what we could
        // see is not full coverage of the change.
        CoverageVerdict::ChangedPathPartiallyExercised
    } else {
        CoverageVerdict::ChangedPathExercised
    };

    CoverageDelta {
        version: COVERAGE_VERSION,
        verdict,
        format: Some(report.format()),
        files,
        touched_files: touched.len(),
        touched_lines_covered: covered,
        touched_lines_uncovered: uncovered,
        touched_lines_unmeasured: unmeasured,
        files_not_measured: not_measured_files,
    }
}

/// Normalise a path for comparison: `/` separators, no `./` prefix, no leading
/// slash. Never resolves symlinks and never touches the filesystem.
pub fn normalize_report_path(path: &str) -> String {
    let mut value = path.replace('\\', "/");
    while let Some(rest) = value.strip_prefix("./") {
        value = rest.to_string();
    }
    value.trim_start_matches('/').to_string()
}

/// True when `short` is `long`, or a suffix of `long` starting at a path
/// component boundary.
fn suffix_matches(long: &str, short: &str) -> bool {
    if long == short {
        return true;
    }
    if short.is_empty() || long.len() <= short.len() {
        return false;
    }
    long.ends_with(short) && long.as_bytes()[long.len() - short.len() - 1] == b'/'
}
