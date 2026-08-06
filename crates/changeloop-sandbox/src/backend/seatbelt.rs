//! macOS Seatbelt profile generation.
//!
//! The generator is pure: it takes a [`Policy`] and returns profile text. That
//! makes the profile assertable in a unit test on any platform, which matters
//! because the failure this guards against is a *profile* mistake, not an API
//! mistake — one shipped agent sandbox began its profile with `(allow default)`,
//! inverting an allow-list into a deny-list, and had a working escape chain out
//! of it. You cannot patch your way out of an inverted default, so the first
//! two forms emitted here are always `(version 1)` and `(deny default)`.

use std::path::Path;

use crate::policy::{Destination, NetworkPolicy, Policy, ReadScope};

pub(crate) const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

fn quote(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

/// A path matcher: `subpath` for a directory, `literal` otherwise.
fn matcher(path: &Path) -> &'static str {
    if path.is_dir() { "subpath" } else { "literal" }
}

/// Renders the one coarse deny-by-default profile for a policy.
#[must_use]
pub fn seatbelt_profile(policy: &Policy) -> String {
    let mut profile = String::from("(version 1) (deny default) (allow process*)");

    // Reads are deny-then-allow in principle, and Seatbelt cannot deliver that
    // in practice. macOS executables and script interpreters consult dynamic
    // system paths that are not stable across OS releases; a profile that
    // narrows reads to a declared set aborts `/bin/sh` before it runs a line.
    // So reads stay broad on this backend while write authority stays exact.
    //
    // `ReadScope::Explicit` is therefore *not silently honoured here*. It is
    // honoured by the Landlock and bubblewrap backends, and on this one it is
    // reported as a named gap by `backend::select`, because a policy that looks
    // applied but is not is the exact failure this crate exists to prevent.
    let _ = matches!(policy.readable(), ReadScope::Explicit(_));
    profile.push_str(" (allow file-read*)");

    // A read *deny-list* is expressible here even though a read allow-list is
    // not, so it is honoured rather than reported as a gap. The denials follow
    // the broad allow because the last matching form wins, and the paths named
    // by `ReadScope::Explicit` are re-allowed after them so a single entry file
    // stays readable inside a tree that is otherwise denied.
    if !policy.read_denied_paths().is_empty() {
        for path in policy.read_denied_paths() {
            profile.push_str(&format!(
                " (deny file-read* ({} \"{}\"))",
                matcher(path),
                quote(path)
            ));
        }
        if let ReadScope::Explicit(paths) = policy.readable() {
            for path in paths {
                profile.push_str(&format!(
                    " (allow file-read* ({} \"{}\"))",
                    matcher(path),
                    quote(path)
                ));
            }
        }
    }

    // Writes are allow-only. An empty allow-list therefore means zero write
    // access to the filesystem; `/dev/null` is the single exception, and
    // discarding bytes is not write authority over anything.
    profile.push_str(" (allow file-write* (literal \"/dev/null\")");
    for path in policy.writable_paths() {
        profile.push_str(&format!(" ({} \"{}\")", matcher(path), quote(path)));
    }
    profile.push(')');

    // Network is denied first; destination rules are appended afterwards
    // because the last matching form wins.
    profile.push_str(" (deny network*)");
    if let NetworkPolicy::Egress(rules) = policy.network_policy() {
        for rule in rules {
            match &rule.destination {
                Destination::Tcp { host, port } => {
                    profile.push_str(&format!(
                        " (allow network-outbound (remote tcp \"{host}:{port}\"))"
                    ));
                }
                Destination::UnixSocket(path) => {
                    profile.push_str(&format!(
                        " (allow network-outbound (literal \"{}\"))",
                        quote(path)
                    ));
                }
            }
        }
    }

    profile.push_str(" (allow sysctl-read)");

    // Protected paths are denied last so no earlier allow can reach them. A
    // process able to rewrite the policy that constrains it is not constrained.
    for path in policy.protected_paths() {
        profile.push_str(&format!(
            " (deny file-write* ({} \"{}\"))",
            matcher(path),
            quote(path)
        ));
    }

    profile
}
