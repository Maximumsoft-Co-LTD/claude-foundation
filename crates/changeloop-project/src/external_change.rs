//! Classification of watcher events against the session's own writes.
//!
//! One rule governs this module: a watcher, cache, or subprocess registry may
//! only invalidate or classify. It must never author a write into the watched
//! tree, and never own a file on another component's behalf. A watcher that
//! "restores" its last-known-good content silently destroys a deliberate
//! `git checkout` or a "Discard Changes"; nothing here can do that, because
//! nothing here writes into the watched tree.
//!
//! The algorithm is content-first:
//!
//! 1. Every agent-issued write records a [`SelfWriteFingerprint`] for its path,
//!    taken over the **post-format** bytes that actually landed on disk.
//! 2. Every watcher event hashes the current disk content *before* deciding
//!    anything.
//! 3. Disk equals the fingerprint: the event is this session's own echo. It is
//!    suppressed and no reconciliation runs.
//! 4. Disk differs: the harness never compares against "what should be there"
//!    and rewrites. It classifies as [`ExternalChange::ExternalRevert`] when the
//!    content is a state Git already holds, otherwise as
//!    [`ExternalChange::ExternalEdit`], and pauses the path either way.

use crate::{
    FileFingerprint, RevisionError, WatchEvent, WatchEventKind, fingerprint, normalize_relative,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Session-scoped side location for preserved agent content. It sits under
/// `.changeloop/`, which the watcher never records, so preserving a conflict
/// can never feed the classifier its own tail.
pub const CONFLICT_DIRECTORY: &str = "conflicts";

const CHANGELOOP_DIRECTORY: &str = ".changeloop";
const CONFLICT_SUFFIX: &str = "cloop-conflict";
const MAX_TRACKED_SELF_WRITES: usize = 1_024;
const MAX_RETAINED_FILE_BYTES: usize = 1024 * 1024;
const RETAINED_BYTES_BUDGET: usize = 8 * 1024 * 1024;
const MAX_GIT_LINE_BYTES: usize = 256;

/// What one agent-issued write put on disk, and what it replaced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelfWriteFingerprint {
    /// Session that issued the write.
    pub session_id: String,
    /// Post-format state that landed on disk. `Missing` records a delete.
    ///
    /// This must be the digest of the bytes on disk *after* every formatter
    /// ran, not of the requested bytes: a formatter rewrite would otherwise
    /// read back as an external edit of the agent's own file.
    pub written: FileFingerprint,
    /// Blob object id when the path was tracked at write time. Recorded for the
    /// pause record only, deliberately *not* part of the echo predicate:
    /// untracked paths and repositories without commits have no object id, and
    /// a formatter can produce bytes Git never hashed.
    pub git_oid: Option<String>,
    /// State the write replaced.
    pub overwrote: FileFingerprint,
}

impl SelfWriteFingerprint {
    #[must_use]
    pub fn sha256(&self) -> Option<&str> {
        match &self.written {
            FileFingerprint::File { sha256, .. } => Some(sha256),
            _ => None,
        }
    }

    #[must_use]
    pub fn byte_length(&self) -> Option<u64> {
        match &self.written {
            FileFingerprint::File { byte_length, .. } => Some(*byte_length),
            _ => None,
        }
    }

    /// Content equality is the only echo discriminator. Timing is never
    /// consulted: an agent write and a user revert that collapse into one
    /// debounce window are still told apart by what is on disk.
    #[must_use]
    pub fn is_echo_of(&self, disk: &FileFingerprint) -> bool {
        &self.written == disk
    }
}

/// Git state the current disk content was found to match.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevertSource {
    Head,
    Index,
    Stash,
}

/// Where the agent's in-flight version ended up when a user edit won the file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PreservedSide {
    /// Both sides survive: the user's bytes stay on disk untouched and the
    /// agent's in-flight bytes were copied to this project-relative path.
    Both { agent_copy: PathBuf },
    /// No agent write was in flight for this path, so there is only one side.
    UserOnly,
    /// The agent's side could not be preserved. The user's bytes are still
    /// untouched; the pause reports the loss instead of hiding it.
    Unavailable { reason: String },
}

/// Verdict for one path. Every variant is non-destructive.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExternalChange {
    /// Disk holds exactly what this session wrote. Suppress, do not reconcile.
    SelfWriteEcho,
    /// Disk holds a state Git already has. Pause pending edits; write nothing.
    ExternalRevert { source: RevertSource },
    /// Disk holds content nobody recorded. Pause pending edits; write nothing
    /// into the watched tree, and preserve the agent's side beside it.
    ExternalEdit { preserved: PreservedSide },
}

/// One paused path and the evidence behind its classification.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathVerdict {
    pub path: PathBuf,
    pub change: ExternalChange,
    /// Content found on disk at classification time.
    pub disk: FileFingerprint,
    /// The agent write this event superseded, when there was one.
    pub agent: Option<SelfWriteFingerprint>,
    /// Raw watcher kinds folded into this observation.
    pub folded: Vec<WatchEventKind>,
}

/// Result of classifying one debounce window.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReconciliationOutcome {
    /// Paths whose events were this session's own echo.
    pub suppressed: Vec<PathBuf>,
    /// Paths paused for a human or the harness to resolve.
    pub paused: Vec<PathVerdict>,
    surviving: Vec<WatchEvent>,
}

impl ReconciliationOutcome {
    /// Events that survive echo suppression and may be dispatched for
    /// invalidation. A suppressed echo never reaches a consumer, so no
    /// reconciliation runs for the agent's own write.
    #[must_use]
    pub fn surviving_events(&self) -> &[WatchEvent] {
        &self.surviving
    }

    #[must_use]
    pub fn is_quiet(&self) -> bool {
        self.paused.is_empty()
    }
}

/// One content-changed observation, keyed by path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoalescedEvent {
    pub path: PathBuf,
    /// Raw kinds folded into this observation, in arrival order.
    pub folded: Vec<WatchEventKind>,
}

/// Folds a debounce window into one observation per path.
///
/// `git checkout` replaces a file atomically by unlinking and recreating it,
/// and some watcher backends report that as delete-then-create rather than
/// modify. Keying by path rather than by inode makes the pair a single
/// content-changed event, so the recreated file is classified once against its
/// content instead of twice against a vanished identity.
#[must_use]
pub fn coalesce_by_path(events: &[WatchEvent]) -> Vec<CoalescedEvent> {
    let mut folded: BTreeMap<PathBuf, Vec<WatchEventKind>> = BTreeMap::new();
    for event in events {
        folded
            .entry(event.path.clone())
            .or_default()
            .push(event.kind.clone());
        if let WatchEventKind::Rename { from } = &event.kind {
            folded
                .entry(from.clone())
                .or_default()
                .push(event.kind.clone());
        }
    }
    folded
        .into_iter()
        .map(|(path, folded)| CoalescedEvent { path, folded })
        .collect()
}

struct LedgerEntry {
    fingerprint: SelfWriteFingerprint,
    /// Post-format bytes retained so the agent's side can be preserved if a
    /// user edit wins the file. Dropped first when the budget is exceeded;
    /// losing them costs preservation, never classification correctness.
    retained: Option<Vec<u8>>,
}

/// Records this session's writes and classifies watcher events against them.
///
/// The guard has exactly one write path, [`Self::preserve`], and it targets
/// `.changeloop/conflicts/` only. There is no code path here that writes a
/// watched file.
pub struct ExternalChangeGuard {
    root: PathBuf,
    session_id: String,
    ledger: BTreeMap<PathBuf, LedgerEntry>,
    order: Vec<PathBuf>,
    retained_bytes: usize,
    paused: BTreeMap<PathBuf, PathVerdict>,
}

impl ExternalChangeGuard {
    #[must_use]
    pub fn new(root: impl AsRef<Path>, session_id: impl Into<String>) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
            session_id: session_id.into(),
            ledger: BTreeMap::new(),
            order: Vec::new(),
            retained_bytes: 0,
            paused: BTreeMap::new(),
        }
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Records one agent-issued write.
    ///
    /// `post_format_bytes` must be the bytes on disk *after* formatters ran.
    /// Passing the requested bytes instead reintroduces the failure this module
    /// exists to prevent: the agent's own formatted file reads back as an
    /// external edit.
    pub fn record_self_write(
        &mut self,
        relative_path: impl AsRef<Path>,
        post_format_bytes: &[u8],
        git_oid: Option<String>,
        overwrote: FileFingerprint,
    ) -> Result<(), RevisionError> {
        let path = normalize_relative(relative_path.as_ref())?;
        let written = FileFingerprint::File {
            sha256: format!("{:x}", Sha256::digest(post_format_bytes)),
            byte_length: post_format_bytes.len() as u64,
        };
        let retained = (post_format_bytes.len() <= MAX_RETAINED_FILE_BYTES)
            .then(|| post_format_bytes.to_vec());
        self.remember(
            path,
            SelfWriteFingerprint {
                session_id: self.session_id.clone(),
                written,
                git_oid,
                overwrote,
            },
            retained,
        );
        Ok(())
    }

    /// Records one agent-issued delete. Absence is a state like any other, and
    /// its echo is suppressed by the same content comparison.
    pub fn record_self_delete(
        &mut self,
        relative_path: impl AsRef<Path>,
        overwrote: FileFingerprint,
    ) -> Result<(), RevisionError> {
        let path = normalize_relative(relative_path.as_ref())?;
        self.remember(
            path,
            SelfWriteFingerprint {
                session_id: self.session_id.clone(),
                written: FileFingerprint::Missing,
                git_oid: None,
                overwrote,
            },
            None,
        );
        Ok(())
    }

    #[must_use]
    pub fn self_write(&self, relative_path: &Path) -> Option<&SelfWriteFingerprint> {
        self.ledger
            .get(relative_path)
            .map(|entry| &entry.fingerprint)
    }

    #[must_use]
    pub fn paused(&self) -> &BTreeMap<PathBuf, PathVerdict> {
        &self.paused
    }

    #[must_use]
    pub fn is_paused(&self, relative_path: &Path) -> bool {
        self.paused.contains_key(relative_path)
    }

    /// Clears one pause after a human or the harness resolved it. Resolution is
    /// the caller's act; the guard never resolves a pause by writing.
    pub fn resume(&mut self, relative_path: &Path) -> Option<PathVerdict> {
        self.paused.remove(relative_path)
    }

    /// Classifies one debounce window of watcher events. Never writes into the
    /// watched tree.
    pub fn observe(&mut self, events: &[WatchEvent]) -> ReconciliationOutcome {
        let git = GitContext::probe(&self.root);
        let mut suppressed = Vec::new();
        let mut echoed = BTreeSet::new();
        let mut paused = Vec::new();

        for event in coalesce_by_path(events) {
            // Hash disk first. Every branch below is a function of content.
            let disk = match fingerprint(&self.root.join(&event.path)) {
                Ok(value) => value,
                Err(error) => {
                    let verdict = PathVerdict {
                        path: event.path.clone(),
                        change: ExternalChange::ExternalEdit {
                            preserved: PreservedSide::Unavailable {
                                reason: error.to_string(),
                            },
                        },
                        disk: FileFingerprint::Missing,
                        agent: self.self_write(&event.path).cloned(),
                        folded: event.folded,
                    };
                    paused.push(verdict.clone());
                    self.pause(verdict);
                    continue;
                }
            };

            // A paused path never re-suppresses: its self-write record was
            // retired at pause time, so restoring the agent's bytes by hand
            // cannot silently clear a live conflict.
            let is_echo = !self.is_paused(&event.path)
                && self
                    .self_write(&event.path)
                    .is_some_and(|recorded| recorded.is_echo_of(&disk));
            if is_echo {
                echoed.insert(event.path.clone());
                suppressed.push(event.path);
                continue;
            }

            let agent = self.self_write(&event.path).cloned();
            let change = match git.revert_source(&event.path, &disk) {
                Some(source) => ExternalChange::ExternalRevert { source },
                None => ExternalChange::ExternalEdit {
                    preserved: self.preserve(&event.path),
                },
            };
            let verdict = PathVerdict {
                path: event.path,
                change,
                disk,
                agent,
                folded: event.folded,
            };
            paused.push(verdict.clone());
            self.pause(verdict);
        }

        let surviving = events
            .iter()
            .filter(|event| !is_fully_echoed(event, &echoed))
            .cloned()
            .collect();
        ReconciliationOutcome {
            suppressed,
            paused,
            surviving,
        }
    }

    fn remember(
        &mut self,
        path: PathBuf,
        fingerprint: SelfWriteFingerprint,
        retained: Option<Vec<u8>>,
    ) {
        self.forget(&path);
        self.retained_bytes = self
            .retained_bytes
            .saturating_add(retained.as_ref().map_or(0, Vec::len));
        self.order.push(path.clone());
        self.ledger.insert(
            path,
            LedgerEntry {
                fingerprint,
                retained,
            },
        );
        // Over budget, drop retained bytes oldest-first but keep the
        // fingerprint: echo detection survives, only preservation degrades.
        let mut index = 0;
        while self.retained_bytes > RETAINED_BYTES_BUDGET && index < self.order.len() {
            let key = self.order[index].clone();
            if let Some(entry) = self.ledger.get_mut(&key)
                && let Some(bytes) = entry.retained.take()
            {
                self.retained_bytes = self.retained_bytes.saturating_sub(bytes.len());
            }
            index += 1;
        }
        // Over capacity, evict whole records oldest-first. An evicted path loses
        // echo detection, which can only over-report an external edit — the
        // conservative direction.
        while self.order.len() > MAX_TRACKED_SELF_WRITES {
            let key = self.order.remove(0);
            if let Some(entry) = self.ledger.remove(&key) {
                self.retained_bytes = self
                    .retained_bytes
                    .saturating_sub(entry.retained.map_or(0, |bytes| bytes.len()));
            }
        }
    }

    fn forget(&mut self, path: &Path) {
        if let Some(previous) = self.ledger.remove(path) {
            self.retained_bytes = self
                .retained_bytes
                .saturating_sub(previous.retained.map_or(0, |bytes| bytes.len()));
        }
        self.order.retain(|value| value != path);
    }

    fn pause(&mut self, verdict: PathVerdict) {
        // Retire the self-write record. A superseded fingerprint must never
        // suppress a later event on the same path.
        self.forget(&verdict.path);
        self.paused.insert(verdict.path.clone(), verdict);
    }

    /// Copies the agent's in-flight bytes to a session-scoped side location so
    /// neither side is silently discarded, following Syncthing's
    /// `.sync-conflict-*` precedent rather than picking a winner. The user's
    /// bytes on disk are never touched.
    fn preserve(&mut self, path: &Path) -> PreservedSide {
        let Some(entry) = self.ledger.get_mut(path) else {
            return PreservedSide::UserOnly;
        };
        let Some(bytes) = entry.retained.take() else {
            return PreservedSide::Unavailable {
                reason: "the agent's in-flight bytes were not retained for this path".to_owned(),
            };
        };
        self.retained_bytes = self.retained_bytes.saturating_sub(bytes.len());
        match self.write_conflict_copy(path, &bytes) {
            Ok(agent_copy) => PreservedSide::Both { agent_copy },
            Err(source) => PreservedSide::Unavailable {
                reason: format!("cannot preserve the agent's version: {source}"),
            },
        }
    }

    fn write_conflict_copy(&self, path: &Path, bytes: &[u8]) -> Result<PathBuf, std::io::Error> {
        let directory = self
            .root
            .join(CHANGELOOP_DIRECTORY)
            .join(CONFLICT_DIRECTORY)
            .join(sanitize(&self.session_id))
            .join(path.parent().unwrap_or_else(|| Path::new("")));
        // The single write in this module is anchored under `.changeloop/`.
        // Anything else would be a write-on-watcher-event path.
        if !directory.starts_with(self.root.join(CHANGELOOP_DIRECTORY)) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "conflict copy escapes the changeloop state directory",
            ));
        }
        fs::create_dir_all(&directory)?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file");
        let digest = format!("{:x}", Sha256::digest(bytes));
        let (stem, extension) = match name.rsplit_once('.') {
            Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
            _ => (name, String::new()),
        };
        let file = directory.join(format!(
            "{stem}.{CONFLICT_SUFFIX}-{}{extension}",
            &digest[..16]
        ));
        fs::write(&file, bytes)?;
        Ok(file
            .strip_prefix(&self.root)
            .unwrap_or(file.as_path())
            .to_path_buf())
    }
}

fn is_fully_echoed(event: &WatchEvent, echoed: &BTreeSet<PathBuf>) -> bool {
    if !echoed.contains(&event.path) {
        return false;
    }
    match &event.kind {
        WatchEventKind::Rename { from } => echoed.contains(from),
        _ => true,
    }
}

fn sanitize(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .take(64)
        .collect::<String>();
    if cleaned.is_empty() {
        "session".to_owned()
    } else {
        cleaned
    }
}

/// Read-only view of the states Git already holds for this worktree.
struct GitContext {
    root: PathBuf,
    inside_worktree: bool,
    has_head: bool,
}

impl GitContext {
    fn probe(root: &Path) -> Self {
        let inside_worktree =
            git_line(root, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true");
        let has_head = inside_worktree
            && git_line(root, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_some();
        Self {
            root: root.to_path_buf(),
            inside_worktree,
            has_head,
        }
    }

    /// Is the content now on disk a state Git already holds?
    ///
    /// A repository with no commits, a path that was never tracked, or a
    /// directory that is not a repository at all has no such state. The answer
    /// is then `None`, which pauses conservatively as an external edit rather
    /// than accepting a change it cannot account for.
    fn revert_source(&self, relative: &Path, disk: &FileFingerprint) -> Option<RevertSource> {
        if !self.inside_worktree || !self.has_head {
            return None;
        }
        let spec = slash(relative);
        match disk {
            // Absence is a state. Disk matches HEAD only when HEAD has no such
            // path; deleting a tracked file deviates from HEAD and is an edit.
            FileFingerprint::Missing => self
                .object(&format!("HEAD:{spec}"))
                .is_none()
                .then_some(RevertSource::Head),
            FileFingerprint::File { .. } => {
                let disk_oid = self.hash_object(&spec)?;
                [
                    ("HEAD:", RevertSource::Head),
                    (":", RevertSource::Index),
                    ("stash@{0}:", RevertSource::Stash),
                ]
                .into_iter()
                .find(|(prefix, _)| {
                    self.object(&format!("{prefix}{spec}")).as_deref() == Some(disk_oid.as_str())
                })
                .map(|(_, source)| source)
            }
            _ => None,
        }
    }

    fn object(&self, spec: &str) -> Option<String> {
        git_line(&self.root, &["rev-parse", "--verify", "--quiet", spec])
    }

    /// Object id Git would give the worktree file, with the same clean filters
    /// Git applied when it stored the blob being compared against.
    fn hash_object(&self, spec: &str) -> Option<String> {
        git_line(&self.root, &["hash-object", "--", spec])
    }
}

/// Runs one bounded, read-only Git query.
///
/// `output` waits on the child, so the watcher path can never accumulate
/// defunct children under event fan-out.
fn git_line(root: &Path, arguments: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
        ])
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .current_dir(root)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() || output.stdout.len() > MAX_GIT_LINE_BYTES {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.trim();
    (!line.is_empty()).then(|| line.to_owned())
}

fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests;
