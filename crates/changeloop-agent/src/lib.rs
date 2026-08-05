//! Scoped child-session state and deterministic parent validation.

use changeloop_policy::PermissionKind;
use changeloop_protocol::{OperationId, SessionId};
use changeloop_provider::RiskTier;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use thiserror::Error;

pub const DEFAULT_MAX_DEPTH: u16 = 1;
pub const DEFAULT_MAX_PARALLEL_CHILDREN: u16 = 3;
const MAX_CHILD_RECORDS: usize = 10_000;
const MAX_SCOPE_REPOSITORIES: usize = 32;
const MAX_SCOPE_PATHS: usize = 1_024;
const MAX_ALLOWED_TOOLS: usize = 128;
const MAX_ALLOWED_PERMISSIONS: usize = 64;
const MAX_RESOURCES_PER_CHILD: usize = 256;
const MAX_FINDINGS: usize = 1_024;
const MAX_REFERENCES: usize = 10_000;
const MAX_IDENTIFIER_BYTES: usize = 512;
const MAX_TASK_TEXT_BYTES: usize = 64 * 1024;
const MAX_RESULT_TEXT_BYTES: usize = 1024 * 1024;
const MAX_PATCH_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelFloor {
    Fast,
    Standard,
    Deep,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubagentBudget {
    pub max_depth: u16,
    pub max_parallel_children: u16,
    pub max_tokens: u64,
    pub max_time_ms: u64,
    pub max_tool_calls: u64,
}
impl Default for SubagentBudget {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_MAX_DEPTH,
            max_parallel_children: DEFAULT_MAX_PARALLEL_CHILDREN,
            max_tokens: 50_000,
            max_time_ms: 600_000,
            max_tool_calls: 100,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BudgetUsage {
    pub tokens: u64,
    pub elapsed_ms: u64,
    pub tool_calls: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultKind {
    Findings,
    Patch,
    TaskResult,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExpectedResultSchema {
    pub version: u16,
    pub kind: ResultKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskScope {
    pub task_id: String,
    pub description: String,
    pub repositories: Vec<String>,
    /// Repository-relative files or directory prefixes.
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubagentSpec {
    pub parent_session_id: SessionId,
    pub child_session_id: SessionId,
    pub change_id: String,
    pub depth: u16,
    pub task: TaskScope,
    pub allowed_tools: BTreeSet<String>,
    pub allowed_permissions: Vec<PermissionKind>,
    pub risk_floor: RiskTier,
    pub model_floor: ModelFloor,
    pub budget: SubagentBudget,
    pub expected_result: ExpectedResultSchema,
    pub base_workspace_revision: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChildState {
    Pending,
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}
impl ChildState {
    fn active(self) -> bool {
        matches!(self, Self::Pending | Self::Running | Self::Cancelling)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceState {
    Active,
    Released,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnedResource {
    pub id: String,
    pub kind: String,
    pub state: ResourceState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingClassification {
    Verified,
    Hypothesis,
    Disproved,
    AcceptedRisk,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finding {
    pub classification: FindingClassification,
    pub summary: String,
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatchResult {
    pub operation_id: OperationId,
    pub repository: String,
    pub files: Vec<String>,
    pub patch: String,
    pub invalidated_claims: BTreeSet<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskOutcome {
    Completed,
    Partial,
    Blocked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskResult {
    pub outcome: TaskOutcome,
    pub summary: String,
    pub artifact_refs: Vec<String>,
    pub invalidated_claims: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ChildResult {
    Findings(Vec<Finding>),
    Patch(PatchResult),
    TaskResult(TaskResult),
}
impl ChildResult {
    fn kind(&self) -> ResultKind {
        match self {
            Self::Findings(_) => ResultKind::Findings,
            Self::Patch(_) => ResultKind::Patch,
            Self::TaskResult(_) => ResultKind::TaskResult,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChildSessionRecord {
    pub spec: SubagentSpec,
    pub state: ChildState,
    pub usage: BudgetUsage,
    pub resources: Vec<OwnedResource>,
    pub result: Option<ChildResult>,
    pub terminal_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChildAction {
    UseTool {
        tool: String,
        permission: PermissionKind,
        repository: String,
        paths: Vec<String>,
    },
    SpawnChild(Box<SubagentSpec>),
    Land,
    ExpandScope,
    GrantPermission,
    ChangePolicy,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RuntimeError {
    #[error("child session already exists")]
    DuplicateChild,
    #[error("parent child session not found")]
    ParentNotFound,
    #[error("child session not found")]
    ChildNotFound,
    #[error("maximum child depth exceeded")]
    DepthExceeded,
    #[error("maximum parallel children reached")]
    ParallelLimit,
    #[error("child attempted to expand delegated authority")]
    AuthorityExpansion,
    #[error("child action is forbidden: {0}")]
    ForbiddenAction(&'static str),
    #[error("tool is outside child scope")]
    ToolOutsideScope,
    #[error("permission is outside child scope")]
    PermissionOutsideScope,
    #[error("path is outside child scope")]
    PathOutsideScope,
    #[error("repository is outside child scope")]
    RepositoryOutsideScope,
    #[error("child is not running")]
    NotRunning,
    #[error("child budget exhausted")]
    BudgetExhausted,
    #[error("result does not match expected schema")]
    ResultSchemaMismatch,
    #[error("unsupported child result schema version")]
    UnsupportedResultSchema,
    #[error("invalid child session contract")]
    InvalidSpec,
    #[error("child result contains lifecycle authority it cannot grant")]
    ResultAuthorityExpansion,
    #[error("active resources must be released")]
    ResourcesActive,
    #[error("child registry reached its bounded retention limit")]
    RegistryFull,
    #[error("child resource registry reached its bounded limit")]
    ResourceLimit,
    #[error("child resource id is duplicated")]
    DuplicateResource,
    #[error("child budget usage cannot move backwards")]
    UsageRegression,
}

#[derive(Default)]
pub struct SubagentRuntime {
    children: HashMap<SessionId, ChildSessionRecord>,
}

impl SubagentRuntime {
    pub fn register(&mut self, spec: SubagentSpec) -> Result<(), RuntimeError> {
        if self.children.len() >= MAX_CHILD_RECORDS {
            return Err(RuntimeError::RegistryFull);
        }
        if self.children.contains_key(&spec.child_session_id) {
            return Err(RuntimeError::DuplicateChild);
        }
        if spec.depth == 0 || spec.depth > spec.budget.max_depth {
            return Err(RuntimeError::DepthExceeded);
        }
        if spec.child_session_id == spec.parent_session_id
            || spec.change_id.trim().is_empty()
            || spec.task.task_id.trim().is_empty()
            || spec.task.description.trim().is_empty()
            || spec.task.repositories.is_empty()
            || spec.task.paths.is_empty()
            || spec.task.repositories.len() > MAX_SCOPE_REPOSITORIES
            || spec.task.paths.len() > MAX_SCOPE_PATHS
            || spec.allowed_tools.len() > MAX_ALLOWED_TOOLS
            || spec.allowed_permissions.len() > MAX_ALLOWED_PERMISSIONS
            || spec
                .allowed_permissions
                .iter()
                .enumerate()
                .any(|(index, item)| spec.allowed_permissions[index + 1..].contains(item))
            || !bounded_text(&spec.change_id, MAX_IDENTIFIER_BYTES)
            || !bounded_text(&spec.task.task_id, MAX_IDENTIFIER_BYTES)
            || !bounded_text(&spec.task.description, MAX_TASK_TEXT_BYTES)
            || !bounded_text(&spec.base_workspace_revision, MAX_IDENTIFIER_BYTES)
            || spec
                .allowed_tools
                .iter()
                .any(|tool| !bounded_text(tool, MAX_IDENTIFIER_BYTES))
            || spec
                .task
                .repositories
                .iter()
                .chain(&spec.task.paths)
                .any(|value| value.len() > MAX_IDENTIFIER_BYTES)
            || spec.budget.max_depth == 0
            || spec.budget.max_parallel_children == 0
            || spec.budget.max_tokens == 0
            || spec.budget.max_time_ms == 0
            || spec.budget.max_tool_calls == 0
            || !canonical_unique(&spec.task.repositories)
            || !canonical_unique(&spec.task.paths)
        {
            return Err(RuntimeError::InvalidSpec);
        }
        if spec.expected_result.version != 1 {
            return Err(RuntimeError::UnsupportedResultSchema);
        }
        let active_siblings = self
            .children
            .values()
            .filter(|child| {
                child.spec.parent_session_id == spec.parent_session_id && child.state.active()
            })
            .collect::<Vec<_>>();
        let active = active_siblings.len();
        let limit = active_siblings
            .iter()
            .map(|child| child.spec.budget.max_parallel_children)
            .chain(std::iter::once(spec.budget.max_parallel_children))
            .min()
            .unwrap_or(1)
            .min(DEFAULT_MAX_PARALLEL_CHILDREN);
        if active >= usize::from(limit) {
            return Err(RuntimeError::ParallelLimit);
        }
        if let Some(parent) = self.children.get(&spec.parent_session_id) {
            if parent.state != ChildState::Running {
                return Err(RuntimeError::NotRunning);
            }
            validate_delegation(parent, &spec)?;
        } else if spec.depth != 1 {
            return Err(RuntimeError::ParentNotFound);
        }
        self.children.insert(
            spec.child_session_id.clone(),
            ChildSessionRecord {
                spec,
                state: ChildState::Pending,
                usage: BudgetUsage::default(),
                resources: vec![],
                result: None,
                terminal_reason: None,
            },
        );
        Ok(())
    }

    pub fn record(&self, child: &SessionId) -> Option<&ChildSessionRecord> {
        self.children.get(child)
    }

    pub fn start(&mut self, child: &SessionId) -> Result<(), RuntimeError> {
        let record = self
            .children
            .get_mut(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        if record.state != ChildState::Pending {
            return Err(RuntimeError::NotRunning);
        }
        record.state = ChildState::Running;
        Ok(())
    }

    pub fn authorize_action(
        &self,
        child: &SessionId,
        action: &ChildAction,
    ) -> Result<(), RuntimeError> {
        let record = self
            .children
            .get(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        if record.state != ChildState::Running {
            return Err(RuntimeError::NotRunning);
        }
        match action {
            ChildAction::Land => Err(RuntimeError::ForbiddenAction("land")),
            ChildAction::ExpandScope => Err(RuntimeError::ForbiddenAction("expand_scope")),
            ChildAction::GrantPermission => Err(RuntimeError::ForbiddenAction("grant_permission")),
            ChildAction::ChangePolicy => Err(RuntimeError::ForbiddenAction("change_policy")),
            ChildAction::SpawnChild(spec) => validate_delegation(record, spec),
            ChildAction::UseTool {
                tool,
                permission,
                repository,
                paths,
            } => {
                if paths.len() > MAX_SCOPE_PATHS
                    || paths.iter().any(|path| path.len() > MAX_IDENTIFIER_BYTES)
                {
                    return Err(RuntimeError::PathOutsideScope);
                }
                if !record.spec.allowed_tools.contains(tool) {
                    return Err(RuntimeError::ToolOutsideScope);
                }
                if !record.spec.allowed_permissions.contains(permission) {
                    return Err(RuntimeError::PermissionOutsideScope);
                }
                if !record.spec.task.repositories.contains(repository) {
                    return Err(RuntimeError::RepositoryOutsideScope);
                }
                if paths
                    .iter()
                    .any(|path| !path_allowed(path, &record.spec.task.paths))
                {
                    return Err(RuntimeError::PathOutsideScope);
                }
                Ok(())
            }
        }
    }

    pub fn update_usage(
        &mut self,
        child: &SessionId,
        usage: BudgetUsage,
    ) -> Result<(), RuntimeError> {
        let record = self
            .children
            .get_mut(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        if record.state != ChildState::Running {
            return Err(RuntimeError::NotRunning);
        }
        if usage.tokens < record.usage.tokens
            || usage.elapsed_ms < record.usage.elapsed_ms
            || usage.tool_calls < record.usage.tool_calls
        {
            return Err(RuntimeError::UsageRegression);
        }
        record.usage = usage;
        if record.usage.tokens > record.spec.budget.max_tokens
            || record.usage.elapsed_ms > record.spec.budget.max_time_ms
            || record.usage.tool_calls > record.spec.budget.max_tool_calls
        {
            record.state = ChildState::Cancelling;
            record.terminal_reason = Some("budget_exhausted".into());
            return Err(RuntimeError::BudgetExhausted);
        }
        Ok(())
    }

    pub fn add_resource(
        &mut self,
        child: &SessionId,
        id: impl Into<String>,
        kind: impl Into<String>,
    ) -> Result<(), RuntimeError> {
        let record = self
            .children
            .get_mut(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        if record.state != ChildState::Running {
            return Err(RuntimeError::NotRunning);
        }
        let id = id.into();
        let kind = kind.into();
        if record.resources.len() >= MAX_RESOURCES_PER_CHILD {
            return Err(RuntimeError::ResourceLimit);
        }
        if !bounded_text(&id, MAX_IDENTIFIER_BYTES) || !bounded_text(&kind, MAX_IDENTIFIER_BYTES) {
            return Err(RuntimeError::InvalidSpec);
        }
        if record.resources.iter().any(|resource| resource.id == id) {
            return Err(RuntimeError::DuplicateResource);
        }
        record.resources.push(OwnedResource {
            id,
            kind,
            state: ResourceState::Active,
        });
        Ok(())
    }

    /// Propagates cancellation to every transitive child session.
    pub fn cancel_tree(&mut self, parent: &SessionId, reason: impl Into<String>) {
        let reason = truncate_text(reason.into(), MAX_TASK_TEXT_BYTES);
        let reason = if reason.trim().is_empty() {
            "cancelled".to_owned()
        } else {
            reason
        };
        let mut frontier = vec![parent.clone()];
        while let Some(current) = frontier.pop() {
            for child in self.children.values_mut().filter(|candidate| {
                candidate.spec.parent_session_id == current && candidate.state.active()
            }) {
                child.state = ChildState::Cancelling;
                child.terminal_reason = Some(reason.clone());
                frontier.push(child.spec.child_session_id.clone());
            }
        }
    }

    pub fn release_resources(&mut self, child: &SessionId) -> Result<(), RuntimeError> {
        let record = self
            .children
            .get_mut(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        for resource in &mut record.resources {
            resource.state = ResourceState::Released;
        }
        Ok(())
    }

    pub fn finish_cancel(&mut self, child: &SessionId) -> Result<(), RuntimeError> {
        let record = self
            .children
            .get_mut(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        if record.state != ChildState::Cancelling {
            return Err(RuntimeError::NotRunning);
        }
        resources_released(record)?;
        record.state = ChildState::Cancelled;
        Ok(())
    }

    pub fn fail(
        &mut self,
        child: &SessionId,
        reason: impl Into<String>,
    ) -> Result<(), RuntimeError> {
        let reason = reason.into();
        if !bounded_text(&reason, MAX_TASK_TEXT_BYTES) {
            return Err(RuntimeError::InvalidSpec);
        }
        let record = self
            .children
            .get_mut(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        if !record.state.active() {
            return Err(RuntimeError::NotRunning);
        }
        resources_released(record)?;
        record.state = ChildState::Failed;
        record.terminal_reason = Some(reason);
        Ok(())
    }

    pub fn complete(&mut self, child: &SessionId, result: ChildResult) -> Result<(), RuntimeError> {
        let record = self
            .children
            .get_mut(child)
            .ok_or(RuntimeError::ChildNotFound)?;
        if record.state != ChildState::Running {
            return Err(RuntimeError::NotRunning);
        }
        if result.kind() != record.spec.expected_result.kind {
            return Err(RuntimeError::ResultSchemaMismatch);
        }
        validate_child_result(&record.spec, &result)?;
        resources_released(record)?;
        record.result = Some(result);
        record.state = ChildState::Completed;
        Ok(())
    }
}

fn validate_child_result(spec: &SubagentSpec, result: &ChildResult) -> Result<(), RuntimeError> {
    match result {
        ChildResult::Findings(findings) => {
            if findings.len() > MAX_FINDINGS {
                return Err(RuntimeError::ResultSchemaMismatch);
            }
            for finding in findings {
                if finding.classification == FindingClassification::AcceptedRisk {
                    return Err(RuntimeError::ResultAuthorityExpansion);
                }
                if !bounded_text(&finding.summary, MAX_RESULT_TEXT_BYTES)
                    || finding.evidence_refs.len() > MAX_REFERENCES
                    || finding
                        .evidence_refs
                        .iter()
                        .any(|reference| !bounded_text(reference, MAX_IDENTIFIER_BYTES))
                    || (matches!(
                        finding.classification,
                        FindingClassification::Verified | FindingClassification::Disproved
                    ) && finding.evidence_refs.is_empty())
                {
                    return Err(RuntimeError::ResultSchemaMismatch);
                }
            }
        }
        ChildResult::Patch(patch) => {
            if !spec.task.repositories.contains(&patch.repository)
                || !bounded_text(&patch.patch, MAX_PATCH_BYTES)
                || patch.files.len() > MAX_SCOPE_PATHS
                || patch.invalidated_claims.len() > MAX_REFERENCES
                || patch
                    .invalidated_claims
                    .iter()
                    .any(|claim| !bounded_text(claim, MAX_IDENTIFIER_BYTES))
                || !canonical_unique(&patch.files)
                || patch
                    .files
                    .iter()
                    .any(|path| !path_allowed(path, &spec.task.paths))
                || !patch_headers_match_declared_files(patch)
            {
                return Err(RuntimeError::ResultSchemaMismatch);
            }
        }
        ChildResult::TaskResult(task) => {
            if !bounded_text(&task.summary, MAX_RESULT_TEXT_BYTES)
                || task.artifact_refs.len() > MAX_REFERENCES
                || task.invalidated_claims.len() > MAX_REFERENCES
                || task
                    .artifact_refs
                    .iter()
                    .chain(&task.invalidated_claims)
                    .any(|reference| !bounded_text(reference, MAX_IDENTIFIER_BYTES))
            {
                return Err(RuntimeError::ResultSchemaMismatch);
            }
        }
    }
    Ok(())
}

fn patch_headers_match_declared_files(patch: &PatchResult) -> bool {
    patch.patch.lines().all(|line| {
        let Some(header) = line
            .strip_prefix("+++ ")
            .or_else(|| line.strip_prefix("--- "))
        else {
            return true;
        };
        let raw = header.split_whitespace().next().unwrap_or_default();
        if raw == "/dev/null" {
            return true;
        }
        let path = raw
            .strip_prefix("a/")
            .or_else(|| raw.strip_prefix("b/"))
            .unwrap_or(raw);
        patch.files.iter().any(|declared| declared == path)
    })
}

fn bounded_text(value: &str, max_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max_bytes && !value.contains('\0')
}

fn truncate_text(mut value: String, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value
}

fn resources_released(record: &ChildSessionRecord) -> Result<(), RuntimeError> {
    if record
        .resources
        .iter()
        .any(|resource| resource.state == ResourceState::Active)
    {
        Err(RuntimeError::ResourcesActive)
    } else {
        Ok(())
    }
}

fn validate_delegation(
    parent: &ChildSessionRecord,
    child: &SubagentSpec,
) -> Result<(), RuntimeError> {
    let expected_depth = parent
        .spec
        .depth
        .checked_add(1)
        .ok_or(RuntimeError::DepthExceeded)?;
    if child.parent_session_id != parent.spec.child_session_id
        || child.change_id != parent.spec.change_id
        || child.depth != expected_depth
        || child.depth > parent.spec.budget.max_depth
    {
        return Err(RuntimeError::DepthExceeded);
    }
    let expands = child.budget.max_depth > parent.spec.budget.max_depth
        || child.budget.max_parallel_children > parent.spec.budget.max_parallel_children
        || child.budget.max_tokens > parent.spec.budget.max_tokens
        || child.budget.max_time_ms > parent.spec.budget.max_time_ms
        || child.budget.max_tool_calls > parent.spec.budget.max_tool_calls
        || child.risk_floor < parent.spec.risk_floor
        || child.model_floor < parent.spec.model_floor
        || !child.allowed_tools.is_subset(&parent.spec.allowed_tools)
        || child
            .allowed_permissions
            .iter()
            .any(|p| !parent.spec.allowed_permissions.contains(p))
        || child
            .task
            .repositories
            .iter()
            .any(|repository| !parent.spec.task.repositories.contains(repository))
        || child
            .task
            .paths
            .iter()
            .any(|path| !path_allowed(path, &parent.spec.task.paths));
    if expands {
        Err(RuntimeError::AuthorityExpansion)
    } else {
        Ok(())
    }
}

fn path_allowed(path: &str, scopes: &[String]) -> bool {
    let Some(candidate) = normalized(path) else {
        return false;
    };
    if candidate != path {
        return false;
    }
    scopes.iter().any(|scope| {
        normalized(scope).is_some_and(|allowed| {
            candidate == allowed
                || candidate
                    .strip_prefix(&allowed)
                    .is_some_and(|s| s.starts_with('/'))
        })
    })
}

fn normalized(path: &str) -> Option<String> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return None;
    }
    let mut out = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => return None,
            value => out.push(value),
        }
    }
    (!out.is_empty()).then(|| out.join("/"))
}

fn canonical_unique(values: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    values.iter().all(|value| {
        normalized(value).is_some_and(|normalized| normalized == *value && seen.insert(normalized))
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParentMergeContext {
    pub current_workspace_revision: String,
    pub externally_changed_paths: Vec<String>,
    pub sibling_reserved_paths: Vec<String>,
    pub fresh_proof_claims: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProofImpact {
    pub invalidated_claims: BTreeSet<String>,
    pub preserved_claims: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeValidation {
    pub affected_paths: Vec<String>,
    pub proof_impact: ProofImpact,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MergeError {
    #[error("child result is not the completed recorded result")]
    ResultNotRecorded,
    #[error("child result schema does not match its contract")]
    ResultSchemaMismatch,
    #[error("workspace revision changed since child dispatch")]
    WorkspaceRevisionChanged,
    #[error("patch touches a path outside child scope")]
    PathOutsideScope,
    #[error("patch targets a repository outside child scope")]
    RepositoryOutsideScope,
    #[error("patch conflicts with external or sibling work")]
    MergeConflict,
}

pub fn validate_parent_merge(
    record: &ChildSessionRecord,
    result: &ChildResult,
    context: &ParentMergeContext,
) -> Result<MergeValidation, MergeError> {
    if record.state != ChildState::Completed || record.result.as_ref() != Some(result) {
        return Err(MergeError::ResultNotRecorded);
    }
    if result.kind() != record.spec.expected_result.kind {
        return Err(MergeError::ResultSchemaMismatch);
    }
    if context
        .externally_changed_paths
        .iter()
        .chain(&context.sibling_reserved_paths)
        .any(|path| normalized(path).as_deref() != Some(path.as_str()))
    {
        return Err(MergeError::MergeConflict);
    }
    let (paths, invalidated_claims) = match result {
        ChildResult::Findings(_) => (vec![], BTreeSet::new()),
        ChildResult::Patch(patch) => {
            if !record.spec.task.repositories.contains(&patch.repository) {
                return Err(MergeError::RepositoryOutsideScope);
            }
            (patch.files.clone(), patch.invalidated_claims.clone())
        }
        ChildResult::TaskResult(task) => (vec![], task.invalidated_claims.clone()),
    };
    if !paths.is_empty()
        && record.spec.base_workspace_revision != context.current_workspace_revision
    {
        return Err(MergeError::WorkspaceRevisionChanged);
    }
    if paths
        .iter()
        .any(|path| !path_allowed(path, &record.spec.task.paths))
    {
        return Err(MergeError::PathOutsideScope);
    }
    if paths.iter().any(|path| {
        context
            .externally_changed_paths
            .iter()
            .chain(&context.sibling_reserved_paths)
            .any(|other| paths_overlap(path, other))
    }) {
        return Err(MergeError::MergeConflict);
    }
    let preserved_claims = context
        .fresh_proof_claims
        .difference(&invalidated_claims)
        .cloned()
        .collect();
    Ok(MergeValidation {
        affected_paths: paths,
        proof_impact: ProofImpact {
            invalidated_claims,
            preserved_claims,
        },
    })
}

fn paths_overlap(left: &str, right: &str) -> bool {
    normalized(left)
        .zip(normalized(right))
        .is_some_and(|(left, right)| {
            left == right
                || left.starts_with(&format!("{right}/"))
                || right.starts_with(&format!("{left}/"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(parent: &str, child: &str) -> SubagentSpec {
        SubagentSpec {
            parent_session_id: SessionId::from_stable(parent),
            child_session_id: SessionId::from_stable(child),
            change_id: "change-1".into(),
            depth: 1,
            task: TaskScope {
                task_id: "task-1".into(),
                description: "inspect auth".into(),
                repositories: vec!["root".into()],
                paths: vec!["src/auth".into()],
            },
            allowed_tools: BTreeSet::from(["read".into(), "patch".into()]),
            allowed_permissions: vec![
                PermissionKind::FilesystemRead,
                PermissionKind::FilesystemWrite,
            ],
            risk_floor: RiskTier::High,
            model_floor: ModelFloor::Deep,
            budget: SubagentBudget::default(),
            expected_result: ExpectedResultSchema {
                version: 1,
                kind: ResultKind::Patch,
            },
            base_workspace_revision: "revision-1".into(),
        }
    }

    fn patch() -> ChildResult {
        ChildResult::Patch(PatchResult {
            operation_id: OperationId::from_stable("op-1"),
            repository: "root".into(),
            files: vec!["src/auth/login.rs".into()],
            patch: "diff".into(),
            invalidated_claims: BTreeSet::from(["auth-login".into()]),
        })
    }

    #[test]
    fn child_is_scoped_and_cannot_cross_authority() {
        let mut runtime = SubagentRuntime::default();
        let child = SessionId::from_stable("child");
        runtime.register(spec("parent", "child")).unwrap();
        runtime.start(&child).unwrap();
        assert_eq!(
            runtime.authorize_action(&child, &ChildAction::Land),
            Err(RuntimeError::ForbiddenAction("land"))
        );
        assert_eq!(
            runtime.authorize_action(&child, &ChildAction::GrantPermission),
            Err(RuntimeError::ForbiddenAction("grant_permission"))
        );
        assert_eq!(
            runtime.authorize_action(&child, &ChildAction::ChangePolicy),
            Err(RuntimeError::ForbiddenAction("change_policy"))
        );
        assert_eq!(
            runtime.authorize_action(
                &child,
                &ChildAction::UseTool {
                    tool: "patch".into(),
                    permission: PermissionKind::FilesystemWrite,
                    repository: "root".into(),
                    paths: vec!["src/auth/login.rs".into()]
                }
            ),
            Ok(())
        );
        assert_eq!(
            runtime.authorize_action(
                &child,
                &ChildAction::UseTool {
                    tool: "shell".into(),
                    permission: PermissionKind::FilesystemWrite,
                    repository: "root".into(),
                    paths: vec!["src/auth/login.rs".into()]
                }
            ),
            Err(RuntimeError::ToolOutsideScope)
        );
        assert_eq!(
            runtime.authorize_action(
                &child,
                &ChildAction::UseTool {
                    tool: "patch".into(),
                    permission: PermissionKind::FilesystemWrite,
                    repository: "root".into(),
                    paths: vec!["src/other.rs".into()]
                }
            ),
            Err(RuntimeError::PathOutsideScope)
        );
        assert_eq!(
            runtime.authorize_action(
                &child,
                &ChildAction::UseTool {
                    tool: "patch".into(),
                    permission: PermissionKind::FilesystemWrite,
                    repository: "root".into(),
                    paths: vec!["src/auth//login.rs".into()]
                }
            ),
            Err(RuntimeError::PathOutsideScope)
        );
    }

    #[test]
    fn parallel_depth_and_delegation_are_enforced() {
        let mut runtime = SubagentRuntime::default();
        let mut first = spec("parent", "first");
        first.budget.max_parallel_children = 1;
        runtime.register(first).unwrap();
        let mut second = spec("parent", "second");
        second.budget.max_parallel_children = 1;
        assert_eq!(runtime.register(second), Err(RuntimeError::ParallelLimit));
        let first_id = SessionId::from_stable("first");
        runtime.start(&first_id).unwrap();
        let mut grandchild = spec("first", "grandchild");
        grandchild.depth = 2;
        assert_eq!(
            runtime.authorize_action(&first_id, &ChildAction::SpawnChild(Box::new(grandchild))),
            Err(RuntimeError::DepthExceeded)
        );
    }

    #[test]
    fn three_parallel_children_are_the_hard_default_ceiling() {
        let mut runtime = SubagentRuntime::default();
        for child in ["first", "second", "third"] {
            let mut child_spec = spec("parent", child);
            child_spec.budget.max_parallel_children = 99;
            runtime.register(child_spec).unwrap();
        }
        let mut fourth = spec("parent", "fourth");
        fourth.budget.max_parallel_children = 99;
        assert_eq!(runtime.register(fourth), Err(RuntimeError::ParallelLimit));
    }

    #[test]
    fn child_identity_and_scope_must_be_canonical_and_unique() {
        let mut runtime = SubagentRuntime::default();
        let mut self_parent = spec("same", "same");
        assert_eq!(
            runtime.register(self_parent.clone()),
            Err(RuntimeError::InvalidSpec)
        );
        self_parent.child_session_id = SessionId::from_stable("child");
        self_parent.task.paths = vec!["src/auth".into(), "src//auth".into()];
        assert_eq!(
            runtime.register(self_parent),
            Err(RuntimeError::InvalidSpec)
        );

        let mut oversized = spec("parent", "oversized");
        oversized.task.description = "x".repeat(MAX_TASK_TEXT_BYTES + 1);
        assert_eq!(runtime.register(oversized), Err(RuntimeError::InvalidSpec));

        let mut duplicated_permission = spec("parent", "duplicate-permission");
        duplicated_permission
            .allowed_permissions
            .push(PermissionKind::FilesystemRead);
        assert_eq!(
            runtime.register(duplicated_permission),
            Err(RuntimeError::InvalidSpec)
        );
    }

    #[test]
    fn budget_usage_is_monotonic_and_resource_registry_is_bounded() {
        let mut runtime = SubagentRuntime::default();
        let child = SessionId::from_stable("bounded-child");
        runtime.register(spec("parent", "bounded-child")).unwrap();
        runtime.start(&child).unwrap();
        runtime
            .update_usage(
                &child,
                BudgetUsage {
                    tokens: 10,
                    elapsed_ms: 20,
                    tool_calls: 1,
                },
            )
            .unwrap();
        assert_eq!(
            runtime.update_usage(
                &child,
                BudgetUsage {
                    tokens: 9,
                    elapsed_ms: 20,
                    tool_calls: 1,
                }
            ),
            Err(RuntimeError::UsageRegression)
        );
        runtime.add_resource(&child, "resource-0", "job").unwrap();
        assert_eq!(
            runtime.add_resource(&child, "resource-0", "job"),
            Err(RuntimeError::DuplicateResource)
        );
        for index in 1..MAX_RESOURCES_PER_CHILD {
            runtime
                .add_resource(&child, format!("resource-{index}"), "job")
                .unwrap();
        }
        assert_eq!(
            runtime.add_resource(&child, "overflow", "job"),
            Err(RuntimeError::ResourceLimit)
        );
    }

    #[test]
    fn budget_cancel_requires_cleanup() {
        let mut runtime = SubagentRuntime::default();
        let child = SessionId::from_stable("child");
        runtime.register(spec("parent", "child")).unwrap();
        runtime.start(&child).unwrap();
        runtime
            .add_resource(&child, "job-1", "background_job")
            .unwrap();
        assert_eq!(
            runtime.update_usage(
                &child,
                BudgetUsage {
                    tokens: 50_001,
                    elapsed_ms: 1,
                    tool_calls: 1
                }
            ),
            Err(RuntimeError::BudgetExhausted)
        );
        assert_eq!(
            runtime.finish_cancel(&child),
            Err(RuntimeError::ResourcesActive)
        );
        runtime.release_resources(&child).unwrap();
        runtime.finish_cancel(&child).unwrap();
        assert_eq!(runtime.record(&child).unwrap().state, ChildState::Cancelled);
    }

    #[test]
    fn cancellation_propagates_to_descendants() {
        let mut runtime = SubagentRuntime::default();
        let mut child_spec = spec("root", "child");
        child_spec.budget.max_depth = 2;
        runtime.register(child_spec).unwrap();
        let child = SessionId::from_stable("child");
        runtime.start(&child).unwrap();
        let mut grandchild = spec("child", "grandchild");
        grandchild.depth = 2;
        grandchild.budget.max_depth = 2;
        runtime.register(grandchild).unwrap();
        runtime.cancel_tree(&SessionId::from_stable("root"), "cancelled");
        assert_eq!(
            runtime.record(&child).unwrap().state,
            ChildState::Cancelling
        );
        assert_eq!(
            runtime
                .record(&SessionId::from_stable("grandchild"))
                .unwrap()
                .state,
            ChildState::Cancelling
        );
    }

    #[test]
    fn terminal_parent_cannot_register_a_new_child_by_bypassing_action_authorization() {
        let mut runtime = SubagentRuntime::default();
        let parent_id = SessionId::from_stable("parent-child");
        let mut parent = spec("root", "parent-child");
        parent.budget.max_depth = 2;
        runtime.register(parent).unwrap();
        runtime.start(&parent_id).unwrap();
        runtime.release_resources(&parent_id).unwrap();
        runtime.fail(&parent_id, "finished").unwrap();

        let mut child = spec("parent-child", "late-child");
        child.depth = 2;
        child.budget.max_depth = 2;
        assert_eq!(runtime.register(child), Err(RuntimeError::NotRunning));
    }

    #[test]
    fn typed_result_and_resources_gate_completion() {
        let mut runtime = SubagentRuntime::default();
        let child = SessionId::from_stable("child");
        runtime.register(spec("parent", "child")).unwrap();
        runtime.start(&child).unwrap();
        runtime.add_resource(&child, "pty-1", "pty").unwrap();
        assert_eq!(
            runtime.complete(&child, ChildResult::Findings(vec![])),
            Err(RuntimeError::ResultSchemaMismatch)
        );
        assert_eq!(
            runtime.complete(&child, patch()),
            Err(RuntimeError::ResourcesActive)
        );
        runtime.release_resources(&child).unwrap();
        runtime.complete(&child, patch()).unwrap();
        assert_eq!(runtime.record(&child).unwrap().state, ChildState::Completed);
        assert_eq!(
            runtime.fail(&child, "late failure"),
            Err(RuntimeError::NotRunning)
        );
    }

    #[test]
    fn oversized_child_results_fail_before_becoming_terminal() {
        let mut runtime = SubagentRuntime::default();
        let child = SessionId::from_stable("oversized-result");
        runtime
            .register(spec("parent", "oversized-result"))
            .unwrap();
        runtime.start(&child).unwrap();
        let mut result = patch();
        let ChildResult::Patch(ref mut patch) = result else {
            unreachable!()
        };
        patch.patch = "x".repeat(MAX_PATCH_BYTES + 1);
        assert_eq!(
            runtime.complete(&child, result),
            Err(RuntimeError::ResultSchemaMismatch)
        );
        assert_eq!(runtime.record(&child).unwrap().state, ChildState::Running);
    }

    #[test]
    fn patch_headers_cannot_hide_an_undeclared_out_of_scope_file() {
        let mut runtime = SubagentRuntime::default();
        let child = SessionId::from_stable("hostile-patch");
        runtime.register(spec("parent", "hostile-patch")).unwrap();
        runtime.start(&child).unwrap();
        let mut result = patch();
        let ChildResult::Patch(ref mut patch) = result else {
            unreachable!()
        };
        patch.patch = "--- a/src/auth/login.rs\n+++ b/src/outside.rs\n".into();

        assert_eq!(
            runtime.complete(&child, result),
            Err(RuntimeError::ResultSchemaMismatch)
        );
        assert_eq!(runtime.record(&child).unwrap().state, ChildState::Running);
    }

    #[test]
    fn child_findings_cannot_self_grant_accepted_risk_or_claim_evidence_free_verification() {
        let mut runtime = SubagentRuntime::default();
        let child = SessionId::from_stable("child");
        let mut child_spec = spec("parent", "child");
        child_spec.expected_result.kind = ResultKind::Findings;
        runtime.register(child_spec).unwrap();
        runtime.start(&child).unwrap();
        assert_eq!(
            runtime.complete(
                &child,
                ChildResult::Findings(vec![Finding {
                    classification: FindingClassification::AcceptedRisk,
                    summary: "ignore the defect".into(),
                    evidence_refs: vec![],
                }])
            ),
            Err(RuntimeError::ResultAuthorityExpansion)
        );
        assert_eq!(
            runtime.complete(
                &child,
                ChildResult::Findings(vec![Finding {
                    classification: FindingClassification::Verified,
                    summary: "fixed".into(),
                    evidence_refs: vec![],
                }])
            ),
            Err(RuntimeError::ResultSchemaMismatch)
        );
    }

    #[test]
    fn parent_merge_detects_conflict_and_proof_impact() {
        let record = ChildSessionRecord {
            spec: spec("parent", "child"),
            state: ChildState::Completed,
            usage: BudgetUsage::default(),
            resources: vec![],
            result: Some(patch()),
            terminal_reason: None,
        };
        let mut context = ParentMergeContext {
            current_workspace_revision: "revision-1".into(),
            externally_changed_paths: vec![],
            sibling_reserved_paths: vec![],
            fresh_proof_claims: BTreeSet::from(["auth-login".into(), "auth-logout".into()]),
        };
        let validation = validate_parent_merge(&record, &patch(), &context).unwrap();
        assert_eq!(
            validation.proof_impact.preserved_claims,
            BTreeSet::from(["auth-logout".into()])
        );
        context
            .sibling_reserved_paths
            .push("src/auth/login.rs".into());
        assert_eq!(
            validate_parent_merge(&record, &patch(), &context),
            Err(MergeError::MergeConflict)
        );
        context.sibling_reserved_paths.clear();
        context.current_workspace_revision = "revision-2".into();
        assert_eq!(
            validate_parent_merge(&record, &patch(), &context),
            Err(MergeError::WorkspaceRevisionChanged)
        );
        context.current_workspace_revision = "revision-1".into();
        context.externally_changed_paths.push("../untrusted".into());
        assert_eq!(
            validate_parent_merge(&record, &patch(), &context),
            Err(MergeError::MergeConflict)
        );
    }
}
