use changeloop_project::legacy::{
    LegacyError, relevant_snapshot, repository_catalog, repository_state, selected_repositories,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_LEGACY_JSON_BYTES: u64 = 16 * 1024 * 1024;

const PROVIDERS: &[(&str, &str)] = &[
    (
        "test",
        "Executable behavioral checks for the declared claim.",
    ),
    (
        "discovery",
        "Expected tests were found and the discovered count meets the floor.",
    ),
    (
        "browser",
        "Rendered behavior in a real browser with the required input capability.",
    ),
    (
        "mutation",
        "A deliberate behavioral fault is detected by the evidence suite.",
    ),
    (
        "state-identity",
        "State before, during, or after the change belongs to the intended actor and revision.",
    ),
    (
        "integration",
        "Multiple components or external boundaries work together.",
    ),
    (
        "compatibility",
        "Public or persisted contracts remain compatible across supported versions.",
    ),
    (
        "performance",
        "Measured latency, throughput, resource, or size budgets are met.",
    ),
    (
        "security-static",
        "Static security checks cover the changed trust boundary and unsafe sinks.",
    ),
    (
        "cross-repo-contract",
        "Producer and consumer repositories agree on the same versioned contract.",
    ),
    (
        "review",
        "Independent risk review covers the declared claims and unresolved findings.",
    ),
    (
        "acceptance",
        "A named human accepts an explicitly subjective product or experience decision.",
    ),
    (
        "static-analysis",
        "Compilation, type checking, linting, and applicable static quality gates pass.",
    ),
    (
        "data-migration",
        "Schema or data evolution is forward-safe, backward-compatible, and rollback-aware.",
    ),
    (
        "accessibility",
        "Rendered semantics, keyboard use, focus, contrast, and assistive access meet policy.",
    ),
    (
        "resilience",
        "Timeout, retry, partial-failure, recovery, and degraded-dependency behavior is proven.",
    ),
    (
        "observability",
        "Required logs, metrics, traces, and alerts expose success and failure safely.",
    ),
    (
        "deployment",
        "Packaging, configuration, rollout health checks, and rollback behavior are proven.",
    ),
    (
        "dependency-supply-chain",
        "Dependency vulnerability, license, lockfile, and provenance policy passes.",
    ),
];

#[derive(Debug)]
pub struct LegacyFailure {
    pub code: i32,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelTier<'a> {
    family: &'a str,
    fallback_tier: Option<&'a str>,
    purposes: &'a [&'a str],
}

#[derive(Serialize)]
struct ModelPolicy<'a> {
    fast: ModelTier<'a>,
    standard: ModelTier<'a>,
    deep: ModelTier<'a>,
}

pub fn run(api: &str, command: &str, values: &[String]) -> Result<(), LegacyFailure> {
    if !matches!(api, "12" | "13") {
        return blocked("legacy runtime API must be 12 or 13", 2);
    }
    let root = std::env::current_dir().map_err(io_failure)?;
    initialize_state(&root)?;
    match command {
        "api-version" => println!("{api}"),
        "version" => println!("{}", if api == "12" { "2.6.0" } else { "2.7.0" }),
        "models" => print_models(),
        "providers" => print_providers(),
        "changes" => print_changes(&root)?,
        "repos" => print_repositories(&root, values.first().map(String::as_str))?,
        "hash" => {
            let id = values
                .first()
                .ok_or_else(|| legacy_error("hash requires a change"))?;
            let state = runtime_state(&root, id)?;
            let revision = state
                .get("contractRevision")
                .or_else(|| state.get("revision"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let snapshot = relevant_snapshot(&root, id, revision).map_err(project_failure)?;
            persist_snapshot(&root, &snapshot)?;
            println!("{}", snapshot.workspace_hash);
        }
        "doctor" => print_doctor(&root, api, values.iter().any(|value| value == "--json"))?,
        _ => return blocked(&format!("runtime command '{command}' is not registered"), 1),
    }
    Ok(())
}

fn print_models() {
    let policy = ModelPolicy {
        fast: ModelTier {
            family: "haiku",
            fallback_tier: Some("standard"),
            purposes: &["inventory", "logs", "mechanical-docs"],
        },
        standard: ModelTier {
            family: "sonnet",
            fallback_tier: Some("deep"),
            purposes: &["implementation", "tests", "focused-investigation"],
        },
        deep: ModelTier {
            family: "opus",
            fallback_tier: None,
            purposes: &[
                "architecture",
                "security",
                "migration",
                "independent-review",
            ],
        },
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&policy).expect("policy serializes")
    );
}

fn print_providers() {
    for (provider, contract) in PROVIDERS {
        println!("{provider}\t{contract}");
    }
    println!(
        "CONFIG test-discovery\t{{\"test\":{{\"adapter\":\"test-discovery\",\"command\":[\"<project-test-command>\"],\"report\":\"<workspace-relative-structured-json-report>\",\"minimum\":1,\"timeoutMs\":120000}}}}"
    );
}

fn print_repositories(root: &Path, change_id: Option<&str>) -> Result<(), LegacyFailure> {
    let catalog = repository_catalog(root).map_err(project_failure)?;
    let selected = change_id
        .map(|id| selected_repositories(root, id).map_err(project_failure))
        .transpose()?
        .map(|rows| {
            rows.into_iter()
                .map(|row| row.id)
                .collect::<std::collections::BTreeSet<_>>()
        });
    for repository in &catalog.repositories {
        let (state, head) = repository_state(repository);
        let mut fields = vec![
            repository.id.clone(),
            repository.kind.clone(),
            repository.relative_path.clone(),
            state.into(),
            head.as_deref()
                .map(|value| &value[..12.min(value.len())])
                .unwrap_or("-")
                .into(),
        ];
        if let Some(selected) = &selected {
            fields.push(
                if selected.contains(&repository.id) {
                    "selected"
                } else {
                    "excluded"
                }
                .into(),
            );
        }
        println!("{}", fields.join("\t"));
    }
    for repository in catalog.drift {
        eprintln!(
            "WARNING: unregistered submodule '{}'",
            repository.path.to_string_lossy()
        );
    }
    Ok(())
}

fn print_changes(root: &Path) -> Result<(), LegacyFailure> {
    let changes = root.join("openspec/changes");
    let mut active = directories(&changes)?;
    active.retain(|id| id != "archive");
    if active.is_empty() {
        println!("No active changes.");
    }
    for id in &active {
        let runtime_path = root.join(".foundation/runtime").join(format!("{id}.json"));
        if !runtime_path.exists() {
            println!("{id}\tuntracked\tunknown\tclaude-foundation doctor --change {id}");
            continue;
        }
        let state = read_json(&runtime_path)?;
        let status = state["status"].as_str().unwrap_or("unknown");
        let schema = state["schema"].as_str().unwrap_or("unknown");
        let revision = state
            .get("contractRevision")
            .or_else(|| state.get("revision"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let current = relevant_snapshot(root, id, revision).map_err(project_failure)?;
        persist_snapshot(root, &current)?;
        let proof_path = root
            .join(".foundation/receipts")
            .join(id)
            .join("proof.json");
        let proof = proof_path
            .exists()
            .then(|| read_json(&proof_path))
            .transpose()?;
        let readiness = if proof.as_ref().is_some_and(|proof| {
            proof["status"] == "pass" && proof["workspaceHash"] == current.workspace_hash
        }) {
            "ready-to-land"
        } else if status == "proven" {
            "stale-proof"
        } else {
            status
        };
        let next = match readiness {
            "ready-to-land" => format!("claude-foundation land check {id}"),
            "stale-proof" => format!("claude-foundation proof readiness {id}"),
            "change" => format!("claude-foundation change validate {id}"),
            "building" => format!("claude-foundation proof readiness {id}"),
            _ => format!("claude-foundation doctor --change {id}"),
        };
        println!("{id}\t{readiness}\t{schema}\t{next}");
    }
    let active = active
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    for file in files_with_extension(&root.join(".foundation/runtime"), "json")? {
        let id = file
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        if active.contains(&id) {
            continue;
        }
        match read_json(&file) {
            Ok(state) if state["status"] == "archived" => {}
            Ok(state) => println!(
                "{}\torphan-runtime\t{}\tmissing-active-change",
                id,
                state["schema"].as_str().unwrap_or("unknown")
            ),
            Err(_) => println!("{id}\torphan-runtime\tunknown\tinvalid-runtime-json"),
        }
    }
    Ok(())
}

fn print_doctor(root: &Path, api: &str, json_output: bool) -> Result<(), LegacyFailure> {
    let catalog = repository_catalog(root).map_err(project_failure)?;
    let orphan_count = files_with_extension(&root.join(".foundation/runtime"), "json")?
        .into_iter()
        .filter(|path| {
            let id = path.file_stem().unwrap_or_default();
            !root.join("openspec/changes").join(id).is_dir()
        })
        .count();
    let checks = vec![
        json!({"level":"ok","name":"protocol-bundle","detail":format!("runtime API {api}")}),
        json!({"level":if catalog.drift.is_empty(){"ok"}else{"warn"},"name":"repository-topology","detail":format!("{} repository node(s)",catalog.repositories.len())}),
        json!({"level":if orphan_count==0{"ok"}else{"warn"},"name":"runtime-state","detail":if orphan_count==0{"no orphan active runtime state".into()}else{format!("{orphan_count} orphan runtime(s)")}}),
    ];
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({"version":1,"stage":"prove","checks":checks}))
                .unwrap()
        );
    } else {
        for check in checks {
            println!(
                "{:<5} {}: {}",
                check["level"].as_str().unwrap_or("").to_ascii_uppercase(),
                check["name"].as_str().unwrap_or(""),
                check["detail"].as_str().unwrap_or("")
            );
        }
    }
    Ok(())
}

fn initialize_state(root: &Path) -> Result<(), LegacyFailure> {
    for relative in [
        ".foundation/runtime",
        ".foundation/receipts",
        ".foundation/logs",
        ".foundation/evidence",
        ".foundation/snapshots",
        ".foundation/transactions",
        ".foundation/plans",
        ".foundation/leases",
        ".foundation/attestations",
        ".foundation/authority",
        ".foundation/instruction-manifests",
        "openspec/changes",
    ] {
        fs::create_dir_all(root.join(relative)).map_err(io_failure)?;
    }
    Ok(())
}

fn persist_snapshot(
    root: &Path,
    snapshot: &changeloop_project::legacy::WorkspaceSnapshot,
) -> Result<(), LegacyFailure> {
    let value = json!({
        "version":snapshot.version,
        "id":snapshot.id,
        "changeId":snapshot.change_id,
        "workspace":snapshot.workspace,
        "workspaceHash":snapshot.workspace_hash,
        "revision":snapshot.revision,
        "fileCount":snapshot.file_count,
        "createdAt":format!("unix-ms:{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()),
    });
    let path = root
        .join(".foundation/snapshots")
        .join(format!("{}.json", snapshot.change_id));
    fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(&value).unwrap()),
    )
    .map_err(io_failure)
}

fn runtime_state(root: &Path, id: &str) -> Result<Value, LegacyFailure> {
    let path = root.join(".foundation/runtime").join(format!("{id}.json"));
    if !path.exists() {
        return blocked(&format!("unknown change '{id}'"), 1);
    }
    read_json(&path)
}

fn directories(path: &Path) -> Result<Vec<String>, LegacyFailure> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut values = fs::read_dir(path)
        .map_err(io_failure)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    values.sort();
    Ok(values)
}

fn files_with_extension(path: &Path, extension: &str) -> Result<Vec<PathBuf>, LegacyFailure> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut values = fs::read_dir(path)
        .map_err(io_failure)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().is_some_and(|value| value == extension))
        .collect::<Vec<_>>();
    values.sort();
    Ok(values)
}

fn read_json(path: &Path) -> Result<Value, LegacyFailure> {
    serde_json::from_slice(
        &read_regular_bounded_legacy(path, MAX_LEGACY_JSON_BYTES).map_err(io_failure)?,
    )
    .map_err(|error| LegacyFailure {
        code: 1,
        message: format!("BLOCKED: invalid JSON: {} ({error})", path.display()),
    })
}

fn read_regular_bounded_legacy(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let path_metadata = fs::symlink_metadata(path)?;
    if !path_metadata.file_type().is_file() || path_metadata.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{} must be a regular non-symlink file no larger than {limit} bytes",
                path.display()
            ),
        ));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} changed or exceeds the safe read limit", path.display()),
        ));
    }
    let mut bytes = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} exceeds the safe {limit}-byte limit", path.display()),
        ));
    }
    Ok(bytes)
}

fn project_failure(error: LegacyError) -> LegacyFailure {
    legacy_error(&error.to_string())
}

fn io_failure(error: std::io::Error) -> LegacyFailure {
    legacy_error(&error.to_string())
}

fn legacy_error(message: &str) -> LegacyFailure {
    LegacyFailure {
        code: 1,
        message: format!("BLOCKED: {message}"),
    }
}

fn blocked<T>(message: &str, code: i32) -> Result<T, LegacyFailure> {
    Err(LegacyFailure {
        code,
        message: format!("BLOCKED: {message}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_json_reader_rejects_sparse_oversize_and_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let sparse = root.path().join("sparse.json");
        fs::File::create(&sparse)
            .unwrap()
            .set_len(MAX_LEGACY_JSON_BYTES + 1)
            .unwrap();
        assert!(read_json(&sparse).is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = root.path().join("target.json");
            let link = root.path().join("link.json");
            fs::write(&target, b"{}").unwrap();
            symlink(&target, &link).unwrap();
            assert!(read_json(&link).is_err());
        }
    }
}
