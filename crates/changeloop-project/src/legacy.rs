//! Deterministic compatibility primitives for Foundation runtime API 12/13.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use thiserror::Error;

const EXCLUDED: &[&str] = &[
    ".git",
    ".foundation",
    ".workflow",
    "node_modules",
    "coverage",
    "test-results",
    "playwright-report",
];
const MAX_LEGACY_CONFIG_BYTES: u64 = 16 * 1024 * 1024;
const MAX_GITMODULES_BYTES: u64 = 1024 * 1024;
const MAX_GIT_METADATA_BYTES: u64 = 128 * 1024 * 1024;
const MAX_SIMPLE_GIT_OUTPUT_BYTES: u64 = 1024 * 1024;
const MAX_SNAPSHOT_FILES: usize = 1_000_000;

#[derive(Debug, Error)]
pub enum LegacyError {
    #[error("filesystem operation failed for {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid JSON in {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("{0}")]
    Contract(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub version: u8,
    pub id: String,
    pub change_id: String,
    pub workspace: PathBuf,
    pub workspace_hash: String,
    pub revision: u64,
    pub file_count: usize,
}

pub fn stable_hash(value: &Value) -> Result<String, LegacyError> {
    let bytes = serde_json::to_vec(value).map_err(|source| LegacyError::Json {
        path: PathBuf::from("<value>"),
        source,
    })?;
    Ok(hex_digest(&bytes))
}

pub fn directory_hash(directory: &Path) -> Result<String, LegacyError> {
    let mut files = Vec::new();
    collect(directory, directory, &mut files, &|_| true)?;
    hash_entries(directory, &files)
}

pub fn relevant_snapshot(
    root: &Path,
    change_id: &str,
    revision: u64,
) -> Result<WorkspaceSnapshot, LegacyError> {
    let workspace = canonical_or_absolute(root)?;
    let current_change = format!("openspec/changes/{change_id}");
    let allowed = |relative: &Path| {
        let text = slash(relative);
        if relative
            .components()
            .any(|part| EXCLUDED.contains(&part.as_os_str().to_string_lossy().as_ref()))
        {
            return false;
        }
        if text.starts_with("openspec/changes/archive/") {
            return false;
        }
        if text.starts_with("openspec/changes/")
            && text != current_change
            && !text.starts_with(&format!("{current_change}/"))
        {
            return false;
        }
        text != format!("{current_change}/execution.yaml")
    };
    let mut hash = Sha256::new();
    let file_count = if let Some(entries) = git_workspace_entries(&workspace, &allowed)? {
        for (relative, identity) in &entries {
            hash.update(relative.as_bytes());
            hash.update([0]);
            hash.update(identity.as_bytes());
            hash.update([0]);
        }
        entries.len()
    } else {
        let mut files = Vec::new();
        collect(&workspace, &workspace, &mut files, &allowed)?;
        files.sort_by_key(|path| slash(path.strip_prefix(&workspace).unwrap_or(path)));
        for path in &files {
            let relative = slash(path.strip_prefix(&workspace).unwrap_or(path));
            hash.update(relative.as_bytes());
            hash.update([0]);
            hash.update(entry_identity(path)?.as_bytes());
            hash.update([0]);
        }
        files.len()
    };
    hash.update(format!("foundation-contract-revision:{revision}").as_bytes());
    let workspace_hash = format!("{:x}", hash.finalize());
    Ok(WorkspaceSnapshot {
        version: 1,
        id: format!("snapshot-{}", &workspace_hash[..20]),
        change_id: change_id.into(),
        workspace,
        workspace_hash,
        revision,
        file_count,
    })
}

pub fn workspace_manifest(
    root: &Path,
    change_id: &str,
    exclude_change: bool,
) -> Result<BTreeMap<String, String>, LegacyError> {
    let root = canonical_or_absolute(root)?;
    let base = format!("openspec/changes/{change_id}");
    let mut files = Vec::new();
    collect(&root, &root, &mut files, &|relative| {
        let text = slash(relative);
        if relative
            .components()
            .any(|part| EXCLUDED.contains(&part.as_os_str().to_string_lossy().as_ref()))
            || text.starts_with("openspec/changes/archive/")
        {
            return false;
        }
        !(text.starts_with("openspec/changes/")
            && (exclude_change || (text != base && !text.starts_with(&format!("{base}/")))))
    })?;
    files
        .into_iter()
        .map(|path| {
            let relative = slash(path.strip_prefix(&root).unwrap_or(&path));
            entry_identity(&path).map(|identity| (relative, identity))
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCatalog {
    pub version: u8,
    pub repositories: Vec<Repository>,
    pub discovered: Vec<Repository>,
    pub drift: Vec<Repository>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub path: PathBuf,
    #[serde(default)]
    pub relative_path: String,
    #[serde(default = "write_mode")]
    pub mode: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub allow_outside_root: bool,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
}

fn write_mode() -> String {
    "write".into()
}

#[derive(Deserialize)]
struct RepositoryFile {
    version: u8,
    repositories: Vec<Repository>,
}

pub fn repository_catalog(root: &Path) -> Result<RepositoryCatalog, LegacyError> {
    let root = canonical_or_absolute(root)?;
    let discovered = discovered_submodules(&root)?;
    let config_path = root.join("openspec/repositories.yaml");
    let configured = if config_path.exists() {
        read_json::<RepositoryFile>(&config_path)?
    } else {
        RepositoryFile {
            version: 1,
            repositories: vec![],
        }
    };
    if configured.version != 1 {
        return Err(LegacyError::Contract(
            "openspec/repositories.yaml requires version 1 and a repositories array".into(),
        ));
    }
    let configured_paths = configured
        .repositories
        .iter()
        .map(|item| slash(&item.path))
        .collect::<BTreeSet<_>>();
    let configured_ids = configured
        .repositories
        .iter()
        .map(|item| item.id.clone())
        .collect::<BTreeSet<_>>();
    let mut rows = vec![Repository {
        id: "root".into(),
        kind: "root".into(),
        path: root.clone(),
        relative_path: ".".into(),
        mode: "write".into(),
        role: Some("control-plane".into()),
        depends_on: vec![],
        allow_outside_root: false,
        name: None,
        url: None,
        branch: None,
    }];
    for discovered_repository in &discovered {
        let configured_match = configured.repositories.iter().find(|item| {
            item.path == discovered_repository.path || item.id == discovered_repository.id
        });
        rows.push(
            configured_match
                .cloned()
                .unwrap_or_else(|| discovered_repository.clone()),
        );
    }
    rows.extend(configured.repositories.into_iter().filter(|configured| {
        !discovered
            .iter()
            .any(|item| item.path == configured.path || item.id == configured.id)
    }));
    validate_repositories(&root, &mut rows)?;
    let drift = discovered
        .iter()
        .filter(|item| {
            !configured_paths.contains(&slash(&item.path)) && !configured_ids.contains(&item.id)
        })
        .cloned()
        .collect();
    Ok(RepositoryCatalog {
        version: 1,
        repositories: rows,
        discovered,
        drift,
    })
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SelectionEntry {
    Id(String),
    Detailed {
        id: String,
        mode: Option<String>,
        #[serde(default, rename = "dependsOn")]
        depends_on: Vec<String>,
    },
}

#[derive(Deserialize)]
struct SelectionFile {
    version: u8,
    repositories: Vec<SelectionEntry>,
}

pub fn selected_repositories(root: &Path, change_id: &str) -> Result<Vec<Repository>, LegacyError> {
    let catalog = repository_catalog(root)?;
    let path = root
        .join("openspec/changes")
        .join(change_id)
        .join("repositories.yaml");
    let selection = if path.exists() {
        read_json::<SelectionFile>(&path)?
    } else {
        SelectionFile {
            version: 1,
            repositories: vec![SelectionEntry::Detailed {
                id: "root".into(),
                mode: Some("write".into()),
                depends_on: vec![],
            }],
        }
    };
    if selection.version != 1 || selection.repositories.is_empty() {
        return Err(LegacyError::Contract(format!(
            "{change_id}/repositories.yaml requires version 1 and a non-empty repositories array"
        )));
    }
    let mut rows = Vec::new();
    let mut seen = BTreeSet::new();
    for entry in selection.repositories {
        let (id, mode, dependencies) = match entry {
            SelectionEntry::Id(id) => (id, None, None),
            SelectionEntry::Detailed {
                id,
                mode,
                depends_on,
            } => (id, mode, (!depends_on.is_empty()).then_some(depends_on)),
        };
        let mut repository = catalog
            .repositories
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .ok_or_else(|| {
                LegacyError::Contract(format!(
                    "{change_id}/repositories.yaml references unknown repository '{id}'"
                ))
            })?;
        if !seen.insert(id.clone()) {
            return Err(LegacyError::Contract(format!(
                "{change_id}/repositories.yaml repeats '{id}'"
            )));
        }
        if let Some(mode) = mode {
            repository.mode = mode;
        }
        if let Some(dependencies) = dependencies {
            repository.depends_on = dependencies;
        }
        rows.push(repository);
    }
    let selected = rows
        .iter()
        .map(|item| item.id.as_str())
        .collect::<BTreeSet<_>>();
    for repository in &rows {
        for dependency in &repository.depends_on {
            if !selected.contains(dependency.as_str()) {
                return Err(LegacyError::Contract(format!(
                    "change '{change_id}' must select dependency '{dependency}' for repository '{}'",
                    repository.id
                )));
            }
        }
    }
    Ok(rows)
}

pub fn repository_state(repository: &Repository) -> (&'static str, Option<String>) {
    if !repository.path.exists() {
        return ("missing", None);
    }
    // Git normally walks up through parent directories. A configured plain
    // directory nested inside another repository must not inherit the
    // parent's HEAD or dirty state and masquerade as an independent repo.
    let Some(top_level) = git(&repository.path, &["rev-parse", "--show-toplevel"]) else {
        return ("not-git", None);
    };
    let Ok(top_level) = fs::canonicalize(top_level) else {
        return ("not-git", None);
    };
    let Ok(repository_root) = fs::canonicalize(&repository.path) else {
        return ("not-git", None);
    };
    if top_level != repository_root {
        return ("not-git", None);
    }
    let head = git(&repository.path, &["rev-parse", "HEAD"]);
    let Some(head) = head else {
        return ("not-git", None);
    };
    let dirty = git(&repository.path, &["status", "--porcelain"])
        .is_none_or(|value| !value.trim().is_empty());
    (if dirty { "dirty" } else { "clean" }, Some(head))
}

fn discovered_submodules(root: &Path) -> Result<Vec<Repository>, LegacyError> {
    let path = root.join(".gitmodules");
    if !path.exists() {
        return Ok(vec![]);
    }
    let bytes = read_bounded(&path, MAX_GITMODULES_BYTES)?;
    let text = String::from_utf8(bytes)
        .map_err(|_| LegacyError::Contract(format!("{} is not valid UTF-8", path.display())))?;
    let mut rows = Vec::new();
    let mut current: Option<Repository> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if let Some(name) = line
            .strip_prefix("[submodule \"")
            .and_then(|value| value.strip_suffix("\"]"))
        {
            if let Some(row) = current
                .take()
                .filter(|item| !item.path.as_os_str().is_empty())
            {
                rows.push(row);
            }
            current = Some(Repository {
                id: slugify(name),
                kind: "submodule".into(),
                path: PathBuf::new(),
                relative_path: String::new(),
                mode: "write".into(),
                role: None,
                depends_on: vec![],
                allow_outside_root: false,
                name: Some(name.into()),
                url: None,
                branch: None,
            });
        } else if let Some((field, value)) = line.split_once('=')
            && let Some(row) = current.as_mut()
        {
            match field.trim() {
                "path" => row.path = PathBuf::from(value.trim()),
                "url" => row.url = Some(value.trim().into()),
                "branch" => row.branch = Some(value.trim().into()),
                _ => {}
            }
        }
    }
    if let Some(row) = current.filter(|item| !item.path.as_os_str().is_empty()) {
        rows.push(row);
    }
    Ok(rows)
}

fn validate_repositories(root: &Path, rows: &mut [Repository]) -> Result<(), LegacyError> {
    let mut ids = BTreeSet::new();
    let mut paths = BTreeSet::new();
    for row in rows.iter_mut() {
        if row.id.is_empty()
            || !row
                .id
                .chars()
                .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == '-')
            || !row
                .id
                .chars()
                .next()
                .is_some_and(|value| value.is_ascii_alphanumeric())
        {
            return Err(LegacyError::Contract(format!(
                "invalid repository id '{}'",
                row.id
            )));
        }
        if !ids.insert(row.id.clone()) {
            return Err(LegacyError::Contract(format!(
                "duplicate repository id '{}'",
                row.id
            )));
        }
        if !["root", "submodule", "git", "external"].contains(&row.kind.as_str()) {
            return Err(LegacyError::Contract(format!(
                "repository '{}' has invalid type '{}'",
                row.id, row.kind
            )));
        }
        if !["read", "write"].contains(&row.mode.as_str()) {
            return Err(LegacyError::Contract(format!(
                "repository '{}' mode must be read|write",
                row.id
            )));
        }
        let absolute = if row.path.is_absolute() {
            canonical_or_absolute(&row.path)?
        } else {
            canonical_or_absolute(&root.join(&row.path))?
        };
        if !absolute.starts_with(root) && !row.allow_outside_root {
            return Err(LegacyError::Contract(format!(
                "repository '{}' path escapes the control root; set allowOutsideRoot only for an explicitly trusted sibling repository",
                row.id
            )));
        }
        let relative = absolute
            .strip_prefix(root)
            .ok()
            .filter(|value| !value.as_os_str().is_empty())
            .map(slash)
            .unwrap_or_else(|| ".".into());
        if !paths.insert(relative.clone()) {
            return Err(LegacyError::Contract(format!(
                "duplicate repository path '{relative}'"
            )));
        }
        row.path = absolute;
        row.relative_path = relative;
    }
    for row in rows.iter() {
        for dependency in &row.depends_on {
            if !ids.contains(dependency) {
                return Err(LegacyError::Contract(format!(
                    "repository '{}' depends on unknown repository '{}'",
                    row.id, dependency
                )));
            }
        }
    }
    Ok(())
}

fn collect(
    root: &Path,
    directory: &Path,
    files: &mut Vec<PathBuf>,
    allowed: &impl Fn(&Path) -> bool,
) -> Result<(), LegacyError> {
    if files.len() >= MAX_SNAPSHOT_FILES {
        return Err(LegacyError::Contract(format!(
            "workspace snapshot exceeds the {MAX_SNAPSHOT_FILES}-file limit"
        )));
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|source| LegacyError::Io {
            path: directory.to_path_buf(),
            source,
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|source| LegacyError::Io {
            path: directory.to_path_buf(),
            source,
        })?;
    if entries.len() > MAX_SNAPSHOT_FILES.saturating_sub(files.len()) {
        return Err(LegacyError::Contract(format!(
            "workspace snapshot exceeds the {MAX_SNAPSHOT_FILES}-file limit"
        )));
    }
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(&path);
        if !allowed(relative) {
            continue;
        }
        let kind = entry.file_type().map_err(|source| LegacyError::Io {
            path: path.clone(),
            source,
        })?;
        if kind.is_dir() {
            collect(root, &path, files, allowed)?;
        } else if kind.is_file() || kind.is_symlink() {
            if files.len() == MAX_SNAPSHOT_FILES {
                return Err(LegacyError::Contract(format!(
                    "workspace snapshot exceeds the {MAX_SNAPSHOT_FILES}-file limit"
                )));
            }
            files.push(path);
        }
    }
    Ok(())
}

fn hash_entries(root: &Path, files: &[PathBuf]) -> Result<String, LegacyError> {
    let mut ordered = files.to_vec();
    ordered.sort_by_key(|path| slash(path.strip_prefix(root).unwrap_or(path)));
    let mut hash = Sha256::new();
    for path in ordered {
        hash.update(slash(path.strip_prefix(root).unwrap_or(&path)).as_bytes());
        hash.update([0]);
        hash.update(entry_identity(&path)?.as_bytes());
        hash.update([0]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn entry_identity(path: &Path) -> Result<String, LegacyError> {
    let metadata = fs::symlink_metadata(path).map_err(|source| LegacyError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if metadata.file_type().is_symlink() {
        return fs::read_link(path)
            .map(|target| format!("symlink:{}", target.to_string_lossy()))
            .map_err(|source| LegacyError::Io {
                path: path.to_path_buf(),
                source,
            });
    }
    let mut file = File::open(path).map_err(|source| LegacyError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|source| LegacyError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, LegacyError> {
    let bytes = read_bounded(path, MAX_LEGACY_CONFIG_BYTES)?;
    serde_json::from_slice(&bytes).map_err(|source| LegacyError::Json {
        path: path.to_path_buf(),
        source,
    })
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, LegacyError> {
    let mut file = File::open(path).map_err(|source| LegacyError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let metadata = file.metadata().map_err(|source| LegacyError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(LegacyError::Contract(format!(
            "{} must be a regular file no larger than {limit} bytes",
            path.display()
        )));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|source| LegacyError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        return Err(LegacyError::Contract(format!(
            "{} grew beyond the {limit}-byte limit while being read",
            path.display()
        )));
    }
    Ok(bytes)
}

fn canonical_or_absolute(path: &Path) -> Result<PathBuf, LegacyError> {
    if path.exists() {
        return fs::canonicalize(path).map_err(|source| LegacyError::Io {
            path: path.to_path_buf(),
            source,
        });
    }
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|current| current.join(path))
            .map_err(|source| LegacyError::Io {
                path: path.to_path_buf(),
                source,
            })
    }
}

fn git(root: &Path, arguments: &[&str]) -> Option<String> {
    git_bytes_limited(root, arguments, MAX_SIMPLE_GIT_OUTPUT_BYTES)
        .ok()
        .flatten()
        .map(|output| String::from_utf8_lossy(&output).trim().to_owned())
}

fn git_workspace_entries(
    root: &Path,
    allowed: &impl Fn(&Path) -> bool,
) -> Result<Option<Vec<(String, String)>>, LegacyError> {
    let Some(index) = git_bytes(root, &["ls-files", "-s", "-z"])? else {
        return Ok(None);
    };
    let Some(status) = git_bytes(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?
    else {
        return Ok(None);
    };
    let mut indexed = HashMap::<String, (String, String)>::new();
    for row in index.split(|byte| *byte == 0).filter(|row| !row.is_empty()) {
        let text = String::from_utf8_lossy(row);
        let Some((metadata, path)) = text.split_once('\t') else {
            continue;
        };
        let mut fields = metadata.split_whitespace();
        let (Some(mode), Some(oid)) = (fields.next(), fields.next()) else {
            continue;
        };
        indexed.insert(path.into(), (mode.into(), oid.into()));
    }
    let status_rows = status
        .split(|byte| *byte == 0)
        .filter(|row| !row.is_empty())
        .map(|row| String::from_utf8_lossy(row).into_owned())
        .collect::<Vec<_>>();
    let mut dirty = BTreeSet::new();
    let mut index_position = 0;
    while index_position < status_rows.len() {
        let row = &status_rows[index_position];
        if row.len() >= 3 {
            dirty.insert(row[3..].to_owned());
            let status = row.as_bytes();
            if (status[0] == b'R'
                || status[0] == b'C'
                || status
                    .get(1)
                    .is_some_and(|value| matches!(value, b'R' | b'C')))
                && status_rows.get(index_position + 1).is_some()
            {
                index_position += 1;
                dirty.insert(status_rows[index_position].clone());
            }
        }
        index_position += 1;
    }
    let mut paths = indexed
        .keys()
        .chain(dirty.iter())
        .filter(|path| allowed(Path::new(path)))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    paths.sort();
    paths
        .into_iter()
        .map(|relative| {
            let identity = if dirty.contains(&relative) {
                match indexed.get(&relative) {
                    Some((mode, oid)) if mode == "160000" => format!("gitlink:{oid}"),
                    _ if root.join(&relative).exists() => entry_identity(&root.join(&relative))?,
                    _ => "deleted".into(),
                }
            } else {
                indexed
                    .get(&relative)
                    .map(|(_, oid)| oid.clone())
                    .unwrap_or_else(|| "missing".into())
            };
            Ok((relative, identity))
        })
        .collect::<Result<Vec<_>, LegacyError>>()
        .map(Some)
}

fn git_bytes(root: &Path, arguments: &[&str]) -> Result<Option<Vec<u8>>, LegacyError> {
    git_bytes_limited(root, arguments, MAX_GIT_METADATA_BYTES)
}

fn git_bytes_limited(
    root: &Path,
    arguments: &[&str],
    limit: u64,
) -> Result<Option<Vec<u8>>, LegacyError> {
    let mut child = Command::new("git")
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
        ])
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .current_dir(root)
        .spawn()
        .map_err(|source| LegacyError::Io {
            path: root.to_path_buf(),
            source,
        })?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| LegacyError::Contract("git stdout pipe was not available".to_owned()))?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut stdout)
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|source| LegacyError::Io {
            path: root.to_path_buf(),
            source,
        })?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        let _ = child.kill();
        let _ = child.wait();
        return Err(LegacyError::Contract(format!(
            "git metadata exceeds the {limit}-byte limit"
        )));
    }
    let status = child.wait().map_err(|source| LegacyError::Io {
        path: root.to_path_buf(),
        source,
    })?;
    Ok(status.success().then_some(bytes))
}

fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn slugify(value: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for character in value.trim().to_ascii_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !result.is_empty() {
                result.push('-');
            }
            result.push(character);
            separator = false;
        } else {
            separator = true;
        }
        if result.len() >= 64 {
            break;
        }
    }
    if result.is_empty() {
        "change".into()
    } else {
        result
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {arguments:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_git(root: &Path) {
        run_git(root, &["init"]);
        run_git(root, &["config", "user.email", "test@example.com"]);
        run_git(root, &["config", "user.name", "Test"]);
    }

    fn repository(path: PathBuf) -> Repository {
        Repository {
            id: "fixture".into(),
            kind: "git".into(),
            path,
            relative_path: ".".into(),
            mode: "write".into(),
            role: None,
            depends_on: vec![],
            allow_outside_root: false,
            name: None,
            url: None,
            branch: None,
        }
    }

    #[test]
    fn hashes_files_paths_and_symlink_targets_deterministically() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("b.txt"), "b").unwrap();
        fs::write(root.path().join("a.txt"), "a").unwrap();
        let first = directory_hash(root.path()).unwrap();
        let second = directory_hash(root.path()).unwrap();
        assert_eq!(first, second);
        fs::write(root.path().join("a.txt"), "changed").unwrap();
        assert_ne!(first, directory_hash(root.path()).unwrap());
    }

    #[test]
    fn relevant_snapshot_excludes_machine_state_and_other_changes() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join(".foundation")).unwrap();
        fs::create_dir_all(root.path().join("openspec/changes/current")).unwrap();
        fs::create_dir_all(root.path().join("openspec/changes/other")).unwrap();
        fs::write(root.path().join("source.rs"), "one").unwrap();
        fs::write(root.path().join(".foundation/state"), "ignored").unwrap();
        fs::write(
            root.path().join("openspec/changes/current/tasks.md"),
            "kept",
        )
        .unwrap();
        fs::write(
            root.path().join("openspec/changes/other/tasks.md"),
            "ignored",
        )
        .unwrap();
        let before = relevant_snapshot(root.path(), "current", 2).unwrap();
        fs::write(root.path().join(".foundation/state"), "still ignored").unwrap();
        assert_eq!(
            before,
            relevant_snapshot(root.path(), "current", 2).unwrap()
        );
        fs::write(root.path().join("source.rs"), "two").unwrap();
        assert_ne!(
            before.workspace_hash,
            relevant_snapshot(root.path(), "current", 2)
                .unwrap()
                .workspace_hash
        );
    }

    #[test]
    fn topology_validates_dependencies_and_normalizes_paths() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("openspec")).unwrap();
        fs::create_dir(root.path().join("service")).unwrap();
        fs::write(
            root.path().join("openspec/repositories.yaml"),
            r#"{"version":1,"repositories":[{"id":"service","type":"git","path":"service","dependsOn":["root"]}]}"#,
        )
        .unwrap();
        let catalog = repository_catalog(root.path()).unwrap();
        assert_eq!(catalog.repositories[1].relative_path, "service");
        assert_eq!(catalog.repositories[1].depends_on, ["root"]);

        fs::create_dir_all(root.path().join("openspec/changes/demo")).unwrap();
        fs::write(
            root.path().join("openspec/changes/demo/repositories.yaml"),
            r#"{"version":1,"repositories":["root",{"id":"service","mode":"read"}]}"#,
        )
        .unwrap();
        let selected = selected_repositories(root.path(), "demo").unwrap();
        assert_eq!(selected[1].mode, "read");
    }

    #[test]
    fn topology_rejects_oversized_sparse_configuration_before_allocating() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("openspec")).unwrap();
        let path = root.path().join("openspec/repositories.yaml");
        File::create(&path)
            .unwrap()
            .set_len(MAX_LEGACY_CONFIG_BYTES + 1)
            .unwrap();

        let error = repository_catalog(root.path()).unwrap_err();
        assert!(
            matches!(error, LegacyError::Contract(message) if message.contains("regular file no larger"))
        );
    }

    #[test]
    fn topology_rejects_oversized_sparse_gitmodules_before_allocating() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(".gitmodules");
        File::create(&path)
            .unwrap()
            .set_len(MAX_GITMODULES_BYTES + 1)
            .unwrap();

        let error = repository_catalog(root.path()).unwrap_err();
        assert!(
            matches!(error, LegacyError::Contract(message) if message.contains("regular file no larger"))
        );
    }

    #[test]
    fn repository_state_does_not_inherit_parent_git_repository() {
        let root = tempfile::tempdir().unwrap();
        init_git(root.path());
        fs::write(root.path().join("root.txt"), "root").unwrap();
        run_git(root.path(), &["add", "."]);
        run_git(root.path(), &["commit", "-m", "root"]);
        let plain = root.path().join("plain-child");
        fs::create_dir(&plain).unwrap();
        assert_eq!(
            repository_state(&repository(plain.clone())),
            ("not-git", None)
        );

        init_git(&plain);
        fs::write(plain.join("nested.txt"), "nested").unwrap();
        run_git(&plain, &["add", "."]);
        run_git(&plain, &["commit", "-m", "nested"]);
        assert_eq!(repository_state(&repository(plain)).0, "clean");
    }

    #[cfg(unix)]
    #[test]
    fn repository_inspection_disables_project_configured_fsmonitor() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        init_git(root.path());
        fs::write(root.path().join("tracked.txt"), "tracked").unwrap();
        run_git(root.path(), &["add", "."]);
        run_git(root.path(), &["commit", "-m", "fixture"]);
        let hook = root.path().join("hostile-fsmonitor.sh");
        fs::write(
            &hook,
            "#!/bin/sh\ntouch \"$(dirname \"$0\")/fsmonitor-invoked\"\nexit 0\n",
        )
        .unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        run_git(
            root.path(),
            &["config", "core.fsmonitor", hook.to_str().unwrap()],
        );

        assert_eq!(
            repository_state(&repository(root.path().to_path_buf())).0,
            "dirty"
        );
        relevant_snapshot(root.path(), "demo", 1).unwrap();
        assert!(!root.path().join("fsmonitor-invoked").exists());
    }

    #[test]
    fn git_metadata_capture_fails_closed_when_output_exceeds_limit() {
        let root = tempfile::tempdir().unwrap();
        init_git(root.path());
        fs::write(root.path().join("tracked.txt"), "tracked").unwrap();
        run_git(root.path(), &["add", "."]);
        run_git(root.path(), &["commit", "-m", "fixture"]);

        assert!(matches!(
            git_bytes_limited(root.path(), &["rev-parse", "HEAD"], 1),
            Err(LegacyError::Contract(message)) if message.contains("git metadata exceeds")
        ));
    }

    #[test]
    fn git_snapshot_handles_binary_dirty_rename_and_case_distinct_paths() {
        let root = tempfile::tempdir().unwrap();
        init_git(root.path());
        fs::write(root.path().join("binary.bin"), [0_u8, 255, 0, 128]).unwrap();
        fs::write(root.path().join("Case.txt"), "upper").unwrap();
        fs::write(root.path().join("case.txt"), "lower").unwrap();
        run_git(root.path(), &["add", "."]);
        run_git(root.path(), &["commit", "-m", "fixture"]);
        let clean = relevant_snapshot(root.path(), "demo", 1).unwrap();
        let case_distinct = fs::read_dir(root.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| matches!(entry.file_name().to_str(), Some("Case.txt" | "case.txt")))
            .count()
            == 2;

        fs::write(root.path().join("binary.bin"), [0_u8, 254, 0, 128]).unwrap();
        run_git(root.path(), &["mv", "Case.txt", "Renamed.txt"]);
        let dirty = relevant_snapshot(root.path(), "demo", 1).unwrap();
        assert_ne!(clean.workspace_hash, dirty.workspace_hash);
        assert_eq!(dirty.file_count, if case_distinct { 4 } else { 3 });
    }

    #[test]
    fn git_snapshot_uses_index_identity_for_sparse_missing_files() {
        let root = tempfile::tempdir().unwrap();
        init_git(root.path());
        fs::write(root.path().join("visible.txt"), "visible").unwrap();
        fs::write(root.path().join("sparse.txt"), "tracked but absent").unwrap();
        run_git(root.path(), &["add", "."]);
        run_git(root.path(), &["commit", "-m", "fixture"]);
        let populated = relevant_snapshot(root.path(), "demo", 1).unwrap();

        run_git(
            root.path(),
            &["update-index", "--skip-worktree", "sparse.txt"],
        );
        fs::remove_file(root.path().join("sparse.txt")).unwrap();
        let sparse = relevant_snapshot(root.path(), "demo", 1).unwrap();
        assert_eq!(populated.workspace_hash, sparse.workspace_hash);
        assert_eq!(sparse.file_count, 2);
    }

    #[test]
    fn uninitialized_submodule_is_discovered_without_inheriting_parent_state() {
        let root = tempfile::tempdir().unwrap();
        init_git(root.path());
        fs::write(
            root.path().join(".gitmodules"),
            "[submodule \"vendor/demo\"]\n\tpath = vendor/demo\n\turl = ../demo.git\n",
        )
        .unwrap();
        fs::create_dir_all(root.path().join("vendor/demo")).unwrap();
        let catalog = repository_catalog(root.path()).unwrap();
        let submodule = catalog
            .repositories
            .iter()
            .find(|item| item.kind == "submodule")
            .unwrap();
        assert_eq!(submodule.relative_path, "vendor/demo");
        assert_eq!(repository_state(submodule), ("not-git", None));
    }
}
