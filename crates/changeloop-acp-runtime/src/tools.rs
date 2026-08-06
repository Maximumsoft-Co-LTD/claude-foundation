//! The tool surface an ACP client can reach.
//!
//! Three read tools and one deliberately-refused write tool. The write tool is
//! *declared* rather than hidden so the boundary is enforced and observable
//! instead of merely absent: a model that asks to mutate gets a denial the
//! client can render, which is the honest report. Hiding it would make the
//! same request fail as "unknown tool", which misdescribes why.

use std::path::{Path, PathBuf};

use changeloop_policy::PermissionKind;
use changeloop_protocol::Provenance;
use changeloop_provider::ToolDefinition;
use changeloop_runtime::{ToolCall, ToolDispatch, ToolDispatcher};
use changeloop_tools::{ToolError, ToolRuntime};
use serde_json::{Value, json};

pub const READ_FILE: &str = "read_file";
pub const LIST_DIRECTORY: &str = "list_directory";
pub const SEARCH_FILES: &str = "search_files";
pub const WRITE_FILE: &str = "write_file";

/// Bytes a single `read_file` may return inline. Above this the tool layer's
/// own by-reference split would apply; the ACP mapping projects the reference,
/// never the bytes.
const MAX_READ_BYTES: usize = 256 * 1024;
const MAX_SEARCH_MATCHES: usize = 200;

/// Refusal text for a mutation reached through ACP. It names the path that
/// *does* carry authority instead of only saying no.
pub const MUTATION_REFUSAL: &str = "an ACP session is a cloop conversation and carries no \
     workspace-mutation authority; run `cloop run <intent>` and confirm the change with \
     `cloop change confirm <session>` to obtain it";

#[must_use]
pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: READ_FILE.into(),
            description: "Read one repository-relative file as UTF-8 text.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
            }),
            mutating: false,
        },
        ToolDefinition {
            name: LIST_DIRECTORY.into(),
            description: "List the entries of one repository-relative directory.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
            }),
            mutating: false,
        },
        ToolDefinition {
            name: SEARCH_FILES.into(),
            description: "Search repository files beneath a path for a literal string.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "needle": { "type": "string" },
                },
                "required": ["path", "needle"],
            }),
            mutating: false,
        },
        ToolDefinition {
            name: WRITE_FILE.into(),
            description: "Write a repository file. Unavailable in a conversation session; \
                          requires a confirmed cloop change."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "contents": { "type": "string" },
                },
                "required": ["path", "contents"],
            }),
            mutating: true,
        },
    ]
}

/// Dispatches the ACP tool surface against a workspace.
pub struct WorkspaceTools {
    runtime: ToolRuntime,
}

impl WorkspaceTools {
    #[must_use]
    pub const fn new(runtime: ToolRuntime) -> Self {
        Self { runtime }
    }

    fn path_argument(arguments: &Value) -> Result<PathBuf, String> {
        arguments
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "`path` is required and must be a non-empty string".to_owned())
    }
}

impl ToolDispatcher for WorkspaceTools {
    fn definitions(&self) -> Vec<ToolDefinition> {
        tool_definitions()
    }

    fn permission(&self, name: &str) -> Option<PermissionKind> {
        match name {
            READ_FILE | LIST_DIRECTORY | SEARCH_FILES => Some(PermissionKind::FilesystemRead),
            WRITE_FILE => Some(PermissionKind::FilesystemWrite),
            _ => None,
        }
    }

    /// Repository content is not agent-authored. Tagging it as such lets the
    /// context-assembly plane treat it as ingested rather than trusted.
    fn provenance(&self, _name: &str) -> Provenance {
        Provenance::RepositoryContent
    }

    fn dispatch(&mut self, call: &ToolCall) -> Result<ToolDispatch, String> {
        match call.name.as_str() {
            READ_FILE => {
                let path = Self::path_argument(&call.arguments)?;
                let bytes = self
                    .runtime
                    .read(&path, MAX_READ_BYTES)
                    .map_err(describe_tool_error)?;
                let text = String::from_utf8_lossy(&bytes).into_owned();
                Ok(ToolDispatch::Output(
                    json!({ "path": path.display().to_string(), "text": text }),
                ))
            }
            LIST_DIRECTORY => {
                let path = Self::path_argument(&call.arguments)?;
                let entries = self.runtime.list(&path).map_err(describe_tool_error)?;
                Ok(ToolDispatch::Output(json!({
                    "path": path.display().to_string(),
                    "entries": entries
                        .iter()
                        .map(|entry| entry.display().to_string())
                        .collect::<Vec<_>>(),
                })))
            }
            SEARCH_FILES => {
                let path = Self::path_argument(&call.arguments)?;
                let needle = call
                    .arguments
                    .get("needle")
                    .and_then(Value::as_str)
                    .filter(|needle| !needle.is_empty())
                    .ok_or_else(|| "`needle` is required and must be non-empty".to_owned())?;
                let matches = self
                    .runtime
                    .search(&path, needle, MAX_SEARCH_MATCHES)
                    .map_err(describe_tool_error)?;
                Ok(ToolDispatch::Output(json!({
                    "path": path.display().to_string(),
                    "matches": matches
                        .iter()
                        .map(|found| json!({
                            "path": found.path.display().to_string(),
                            "line": found.line,
                            "text": found.text,
                        }))
                        .collect::<Vec<_>>(),
                })))
            }
            // Unreachable in practice: the policy gate denies a filesystem
            // write under conversation authority before dispatch. Kept as a
            // third refusal so no future gate change can turn a wiring mistake
            // into a write.
            WRITE_FILE => Err(MUTATION_REFUSAL.to_owned()),
            other => Err(format!("unknown tool `{other}`")),
        }
    }
}

/// Render a tool failure without leaking an absolute host path into a message
/// the client renders.
fn describe_tool_error(error: ToolError) -> String {
    match error {
        ToolError::PolicyDenied(reason) => format!("denied by policy: {reason}"),
        ToolError::ApprovalRequired(reason) => format!("approval required: {reason}"),
        ToolError::PathOutsideScope(path) => {
            format!("path is outside repository scope: {}", relative(&path))
        }
        ToolError::Symlink(path) => format!("path traverses a symlink: {}", relative(&path)),
        ToolError::Io { path, .. } => format!("could not read {}", relative(&path)),
        other => other.to_string(),
    }
}

fn relative(path: &Path) -> String {
    path.file_name()
        .map_or_else(|| "<path>".to_owned(), |name| name.to_string_lossy().into())
}
