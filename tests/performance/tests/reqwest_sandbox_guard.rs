//! Workspace invariant: `reqwest` must never be linked with its default features,
//! and `system-configuration` must never enter `Cargo.lock`.
//!
//! This is a regression guard, not a fix. The workspace is currently correct; the
//! test exists so it cannot silently stop being correct.

use std::fs;
use std::path::{Path, PathBuf};

const BANNED_FEATURE: &str = "macos-system-configuration";
const BANNED_CRATE: &str = "system-configuration";

const BACKGROUND: &str = "\
WHY THIS MATTERS
  reqwest's default features include `macos-system-configuration`, which links the
  `system-configuration` crate. That crate does a mach-lookup for
  `com.apple.SystemConfiguration.configd` to read the system proxy settings, and the
  default macOS Seatbelt profile DENIES that lookup. The lookup panics, so any
  sandboxed process that touches an HTTP client aborts with exit code 101 before
  doing any work. It fails at process start, not at first request, so ordinary tests
  will not catch it. The same bug was reproduced against OpenAI's Codex CLI and
  closed \"not planned\" upstream: no ecosystem fix is coming, and the only defence
  is never linking the crate at all.

HOW TO FIX
  Declare reqwest once, in the workspace root Cargo.toml:

      reqwest = { version = \"0.12\", default-features = false,
                  features = [\"blocking\", \"json\", \"rustls-tls\", \"stream\"] }

  and inherit it from member crates with `reqwest.workspace = true`. Never add
  `macos-system-configuration` to the feature list; if you need something reqwest's
  defaults would have provided, name that feature explicitly instead.
  If a transitive dependency pulled `system-configuration` back into the lockfile,
  locate it with `cargo tree -i system-configuration` and turn the feature off at
  its source.";

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("tests/performance sits two directories below the workspace root")
        .to_path_buf()
}

/// Every `Cargo.toml` in the workspace: the root manifest plus each member directory.
fn manifests(root: &Path) -> Vec<PathBuf> {
    let mut found = vec![root.join("Cargo.toml")];
    for parent in ["crates", "tests"] {
        let Ok(entries) = fs::read_dir(root.join(parent)) else {
            continue;
        };
        for entry in entries.flatten() {
            let manifest = entry.path().join("Cargo.toml");
            if manifest.is_file() {
                found.push(manifest);
            }
        }
    }
    found.sort();
    found
}

/// Extracts each `reqwest` dependency declaration as `(line number, spec text)`.
/// Handles `reqwest = "..."`, inline tables (including multi-line ones),
/// `reqwest.workspace = true`, and `[…dependencies.reqwest]` tables.
fn reqwest_specs(manifest: &str) -> Vec<(usize, String)> {
    let mut specs = Vec::new();
    let mut section = String::new();
    let mut lines = manifest.lines().enumerate().peekable();
    while let Some((index, raw)) = lines.next() {
        let line = raw.trim();
        if let Some(header) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = header.replace(['"', '\''], "");
            if section.ends_with(".reqwest") && section.contains("dependencies") {
                let mut spec = String::new();
                while lines
                    .peek()
                    .is_some_and(|(_, l)| !l.trim().starts_with('['))
                {
                    let (_, body) = lines.next().expect("peeked line is present");
                    spec.push_str(body.trim());
                    spec.push(' ');
                }
                specs.push((index + 1, spec));
            }
            continue;
        }
        if !section.ends_with("dependencies") {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key != "reqwest" && !key.starts_with("reqwest.") {
            continue;
        }
        let mut spec = match key.strip_prefix("reqwest.") {
            Some(field) => format!("{field} = {}", value.trim()),
            None => value.trim().to_string(),
        };
        while spec.matches('{').count() > spec.matches('}').count() {
            let Some((_, continuation)) = lines.next() else {
                break;
            };
            spec.push(' ');
            spec.push_str(continuation.trim());
        }
        specs.push((index + 1, spec));
    }
    specs
}

/// Describes why a declaration is unsafe, or `None` when it is fine.
fn violation(spec: &str) -> Option<&'static str> {
    let compact: String = spec.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.contains(BANNED_FEATURE) {
        return Some("explicitly enables the `macos-system-configuration` feature");
    }
    // A workspace-inherited dependency carries the root declaration, checked separately.
    if compact.contains("workspace=true") {
        return None;
    }
    if !compact.contains("default-features=false") {
        return Some("does not set `default-features = false`, so reqwest's defaults apply");
    }
    None
}

#[test]
fn reqwest_never_enables_default_features() {
    let root = workspace_root();
    let mut failures = Vec::new();
    for manifest in manifests(&root) {
        let text = fs::read_to_string(&manifest)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", manifest.display()));
        let relative = manifest.strip_prefix(&root).unwrap_or(&manifest);
        for (line, spec) in reqwest_specs(&text) {
            if let Some(reason) = violation(&spec) {
                failures.push(format!(
                    "  {}:{line} -> `reqwest = {}` {reason}",
                    relative.display(),
                    spec.trim()
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "\n\nreqwest is declared with default features enabled:\n{}\n\n{BACKGROUND}\n",
        failures.join("\n")
    );
}

#[test]
fn system_configuration_never_enters_the_lockfile() {
    let root = workspace_root();
    let lockfile = root.join("Cargo.lock");
    let text = fs::read_to_string(&lockfile)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", lockfile.display()));
    let offenders: Vec<&str> = text
        .lines()
        .filter_map(|line| line.trim().strip_prefix("name = \""))
        .filter_map(|name| name.strip_suffix('"'))
        .filter(|name| name.starts_with(BANNED_CRATE))
        .collect();
    assert!(
        offenders.is_empty(),
        "\n\nCargo.lock now contains the banned crate(s): {}\n\
         Something re-enabled a feature that links macOS SystemConfiguration.\n\n{BACKGROUND}\n",
        offenders.join(", ")
    );
}

/// Proves the guard above can actually fail: the same predicates, run against
/// deliberately wrong declarations.
mod guard_detects_regressions {
    use super::{reqwest_specs, violation};

    #[test]
    fn bare_version_and_explicit_defaults_are_rejected() {
        let manifest = "[dependencies]\nreqwest = \"0.12\"\n";
        let specs = reqwest_specs(manifest);
        assert_eq!(specs.len(), 1, "bare version declaration must be seen");
        assert!(violation(&specs[0].1).is_some());
        assert!(violation("{ version = \"0.12\" }").is_some());
        assert!(
            violation("{ workspace = true, features = [\"macos-system-configuration\"] }")
                .is_some()
        );
    }

    #[test]
    fn correct_declarations_are_accepted() {
        assert!(violation("{ version = \"0.12\", default-features = false }").is_none());
        assert!(violation("workspace = true").is_none());
    }
}
