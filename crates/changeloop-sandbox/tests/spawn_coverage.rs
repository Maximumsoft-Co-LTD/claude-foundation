//! The coverage ledger.
//!
//! "One chokepoint" and "every spawn point is covered" are the same design only
//! if the second half is actually true. Rust visibility makes
//! [`changeloop_sandbox`]'s own primitive unreachable, but it cannot retroactively
//! move call sites that already exist in other crates. This test counts them.
//!
//! The rule it enforces is narrow and durable: **a crate that creates processes
//! directly must be listed here, with a reason.** A new crate that starts
//! spawning fails the build until someone either routes it through
//! [`changeloop_sandbox::Spawn`] or writes down why it cannot. That keeps the
//! remaining surface countable rather than letting it drift back to "every code
//! path had to remember".

use std::fs;
use std::path::{Path, PathBuf};

/// A crate that still creates processes without going through the spawn API.
struct UnwiredCrate {
    name: &'static str,
    reason: &'static str,
}

/// The ledger. Shrinking it is the work; growing it silently is the failure.
const UNWIRED: &[UnwiredCrate] = &[
    UnwiredCrate {
        name: "changeloop-app-server",
        reason: "Consumes a std::process::Command from the tools crate via the \
                 legacy-command-handoff register row, and runs `git` directly for revision \
                 queries. Wiring it requires changing a signature this change does not own.",
    },
    UnwiredCrate {
        name: "changeloop-cli",
        reason: "Runs `git` and `mkfifo` for operational subcommands on the developer's own \
                 machine, outside any agent turn.",
    },
    UnwiredCrate {
        name: "changeloop-language",
        reason: "Probes the project toolchain to resolve formatters and checkers. The resolved \
                 launch itself already goes through the tools crate. The remaining direct site is \
                 the fallback ProjectProcessLauncher, whose trait returns a std::process::Command; \
                 wiring it needs either that signature (owned by the app-server implementor) or a \
                 second raw-command register row, which the register audit forbids.",
    },
    UnwiredCrate {
        name: "changeloop-project",
        reason: "Runs `git` for workspace revision and external-change detection.",
    },
    UnwiredCrate {
        name: "changeloop-snapshot",
        reason: "Runs `git` to build snapshot steps. Snapshot construction is harness-owned \
                 rather than agent-driven, so the child's argv never comes from a model.",
    },
];

/// Files that are allowed to name the primitive because they *are* the boundary.
fn is_sanctioned(path: &Path) -> bool {
    path.ends_with("changeloop-sandbox/src/raw.rs")
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("the crate sits two directories below the workspace root")
        .to_path_buf()
}

/// Production sources only: test modules and examples spawn helpers freely and
/// are not part of the runtime surface this ledger is about.
fn is_production_source(path: &Path) -> bool {
    if path.extension().is_none_or(|extension| extension != "rs") {
        return false;
    }
    let text = path.to_string_lossy();
    if !text.contains("/src/") {
        return false;
    }
    if text.contains("/tests/") || text.contains("/examples/") || text.contains("/benches/") {
        return false;
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    !(name == "tests.rs" || name.ends_with("_tests.rs"))
}

fn collect(directory: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, found);
        } else if is_production_source(&path) {
            found.push(path);
        }
    }
}

/// Counts occurrences of the raw primitive, ignoring longer identifiers that
/// merely end in it (`RawCommand::new`) and lines that are documentation.
fn names_the_primitive(text: &str) -> bool {
    // Built at runtime so this file does not match its own scan.
    let needle = concat!("Command", "::new");
    text.lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .any(|line| {
            let mut offset = 0;
            while let Some(index) = line[offset..].find(needle) {
                let absolute = offset + index;
                let preceding = line[..absolute].chars().next_back();
                let is_suffix_of_identifier =
                    preceding.is_some_and(|c| c.is_alphanumeric() || c == '_');
                if !is_suffix_of_identifier {
                    return true;
                }
                offset = absolute + needle.len();
            }
            false
        })
}

fn crate_name_of(path: &Path, root: &Path) -> String {
    path.strip_prefix(root.join("crates"))
        .ok()
        .and_then(|relative| relative.components().next())
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[test]
fn every_crate_that_spawns_directly_is_in_the_ledger() {
    let root = workspace_root();
    let mut sources = Vec::new();
    collect(&root.join("crates"), &mut sources);
    assert!(
        sources.len() > 20,
        "the scan found only {} source files, which means it is not looking where it thinks",
        sources.len()
    );

    let ledger: Vec<&str> = UNWIRED.iter().map(|entry| entry.name).collect();
    let mut unregistered = Vec::new();
    for path in &sources {
        if is_sanctioned(path) {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        if !names_the_primitive(&text) {
            continue;
        }
        let owner = crate_name_of(path, &root);
        if owner == "changeloop-sandbox" {
            unregistered.push(format!(
                "  {} — the sandbox crate must name the primitive only in src/raw.rs",
                path.strip_prefix(&root).unwrap_or(path).display()
            ));
            continue;
        }
        if !ledger.contains(&owner.as_str()) {
            unregistered.push(format!(
                "  {} (crate {owner})",
                path.strip_prefix(&root).unwrap_or(path).display()
            ));
        }
    }

    assert!(
        unregistered.is_empty(),
        "\n\nThese production sources create processes without going through \
         changeloop_sandbox::Spawn, and their crate is not in the ledger:\n{}\n\n\
         Route the call through `changeloop_sandbox::Spawn`, or add the crate to `UNWIRED` in \
         this file with a reason. The claim this crate makes is coverage, and an unlisted spawn \
         site is exactly the shape of the six documented enforcement failures: a code path that \
         had to remember to enforce policy and did not.\n",
        unregistered.join("\n")
    );
}

#[test]
fn the_ledger_contains_no_stale_rows() {
    let root = workspace_root();
    let mut sources = Vec::new();
    collect(&root.join("crates"), &mut sources);

    let mut spawning = Vec::new();
    for path in &sources {
        if is_sanctioned(path) {
            continue;
        }
        if fs::read_to_string(path).is_ok_and(|text| names_the_primitive(&text)) {
            spawning.push(crate_name_of(path, &root));
        }
    }

    let stale: Vec<&str> = UNWIRED
        .iter()
        .map(|entry| entry.name)
        .filter(|name| !spawning.iter().any(|owner| owner == name))
        .collect();
    assert!(
        stale.is_empty(),
        "these ledger rows describe crates that no longer spawn directly and should be deleted, \
         so the ledger keeps measuring something real: {stale:?}"
    );
}

#[test]
fn the_tools_crate_is_fully_wired() {
    let ledger: Vec<&str> = UNWIRED.iter().map(|entry| entry.name).collect();
    assert!(
        !ledger.contains(&"changeloop-tools"),
        "changeloop-tools owns the agent-facing process, filesystem and job surface. It is the \
         one crate this change wires end to end, so it must never reappear in the ledger."
    );
}

/// The MCP crate is the one the register singles out by evidence: five of seven
/// surveyed production MCP clients run tools with full host privileges, and an
/// MCP stdio server is untrusted third-party code executing on the user's
/// machine. Its row is retired, and putting it back would mean re-growing a
/// second copy of the Seatbelt and bubblewrap adapters.
#[test]
fn the_mcp_crate_is_fully_wired() {
    let ledger: Vec<&str> = UNWIRED.iter().map(|entry| entry.name).collect();
    assert!(
        !ledger.contains(&"changeloop-mcp"),
        "changeloop-mcp runs untrusted third-party server and extension processes. It routes \
         every spawn through changeloop_sandbox::Spawn, so it must never reappear in the ledger."
    );
}

#[test]
fn every_ledger_row_states_a_reason() {
    for entry in UNWIRED {
        assert!(
            entry.reason.len() > 40,
            "ledger row `{}` must say why it is still unwired",
            entry.name
        );
    }
}
