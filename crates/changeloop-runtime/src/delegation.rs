//! Harness-authored delegation contracts.
//!
//! A model may *request* delegation. It never authors the contract. The
//! objective, tool grant, path scope, budgets, depth, concurrency and expected
//! result schema are all derived here from a [`DelegationGrant`] the harness
//! installed before the turn started, and from the [`DelegationProfile`] that
//! the resolved agent profile carries. The only fields a request contributes
//! are the child's identifier and its task text.
//!
//! Scope of the guarantee. This plane decides *who writes the contract* and
//! *what authority it can carry*. It does not address inter-agent
//! misalignment — a cold-started child cannot see a constraint the parent was
//! given mid-session, and nothing here changes that. Read-only children are
//! the only shape a model request can reach: a write-capable contract requires
//! a harness caller to ask for [`DelegationPurpose::Implementation`]
//! explicitly, under a profile that permits writes, because the evidence
//! oracle available to this workspace is not strong enough to make parallel
//! writers safe.

use std::collections::BTreeSet;

use changeloop_agent::{
    DEFAULT_MAX_PARALLEL_CHILDREN, ExpectedResultSchema, ModelFloor, ResultKind, SubagentBudget,
    SubagentSpec, TaskScope,
};
use changeloop_config::{ContractAuthor, DelegationProfile};
use changeloop_policy::PermissionKind;
use changeloop_protocol::SessionId;
use changeloop_provider::RiskTier;
use thiserror::Error;

const MAX_GRANT_ENTRIES: usize = 128;
const MAX_IDENTIFIER_BYTES: usize = 512;
const MAX_TASK_TEXT_BYTES: usize = 64 * 1024;

/// What a delegation is for. The harness selects it; a request cannot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DelegationPurpose {
    /// A reviewer that shares none of the parent's history. The one delegation
    /// pattern with evidence behind it, and the first one shipped.
    CleanContextReview,
    /// Read-only exploration reporting typed findings.
    Investigation,
    /// A write-capable child. Reachable only from harness code, never from a
    /// model request.
    Implementation,
}

impl DelegationPurpose {
    #[must_use]
    pub fn permits_writes(self) -> bool {
        matches!(self, Self::Implementation)
    }

    /// A reviewer starts from an empty transcript; that isolation is the point
    /// of the pattern, not an optimisation.
    #[must_use]
    pub fn requires_clean_context(self) -> bool {
        matches!(self, Self::CleanContextReview)
    }

    fn expected_kind(self) -> ResultKind {
        match self {
            Self::CleanContextReview | Self::Investigation => ResultKind::Findings,
            Self::Implementation => ResultKind::Patch,
        }
    }
}

/// The parent-owned authority envelope. The harness installs it; it is the
/// ceiling every authored contract is derived from and can never exceed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DelegationGrant {
    pub change_id: String,
    pub parent_session_id: SessionId,
    /// Depth of the session holding this grant. A child is authored one deeper.
    pub parent_depth: u16,
    pub repositories: Vec<String>,
    pub paths: Vec<String>,
    /// Tools a read-only child may use.
    pub read_tools: BTreeSet<String>,
    /// Tools added only for a write-capable child.
    pub write_tools: BTreeSet<String>,
    pub risk_floor: RiskTier,
    pub model_floor: ModelFloor,
    pub budget: SubagentBudget,
    pub base_workspace_revision: String,
}

/// The model-influenceable surface of a delegation. Everything absent from
/// this struct is harness-owned by construction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DelegationRequest {
    pub child_session_id: SessionId,
    pub task_id: String,
    pub description: String,
}

/// A contract the harness authored. The inner spec is private and there is no
/// constructor outside [`DelegationGovernor::author`], so a contract cannot be
/// assembled or widened by any other caller.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DelegationContract {
    spec: SubagentSpec,
    purpose: DelegationPurpose,
}

impl DelegationContract {
    #[must_use]
    pub fn spec(&self) -> &SubagentSpec {
        &self.spec
    }

    #[must_use]
    pub fn purpose(&self) -> DelegationPurpose {
        self.purpose
    }

    /// Always [`ContractAuthor::Harness`]: no other value can produce a
    /// contract.
    #[must_use]
    pub fn author(&self) -> ContractAuthor {
        ContractAuthor::Harness
    }

    #[must_use]
    pub fn clean_context(&self) -> bool {
        self.purpose.requires_clean_context()
    }

    #[must_use]
    pub fn into_spec(self) -> SubagentSpec {
        self.spec
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum DelegationError {
    #[error("delegation is disabled for this profile")]
    Disabled,
    #[error("delegation profile carries an unrecognized mode")]
    UnknownMode,
    #[error("delegation contracts must be harness-authored")]
    ContractAuthorNotHarness,
    #[error("the requested contract is not the contract the harness authored")]
    ModelAuthoredContract,
    #[error("child write authority is denied by this profile")]
    WritesDenied,
    #[error("clean-context review is withdrawn by this profile")]
    ReviewWithdrawn,
    #[error("delegation depth limit reached; the spawn tool is withheld")]
    DepthExhausted,
    #[error("delegation concurrency limit exceeded")]
    ConcurrencyExceeded,
    #[error("delegation request is malformed")]
    InvalidRequest,
    #[error("delegation grant is malformed")]
    InvalidGrant,
}

/// Authors delegation contracts from a harness grant and a resolved profile.
pub struct DelegationGovernor {
    profile: DelegationProfile,
    grant: DelegationGrant,
    /// The purpose a *model request* resolves to. Read-only by construction;
    /// there is no setter that can move it to `Implementation`.
    requested_purpose: DelegationPurpose,
}

impl DelegationGovernor {
    /// Fails closed: an unknown mode, a non-harness contract author, or a
    /// malformed grant yields no governor at all rather than a permissive one.
    pub fn new(
        profile: DelegationProfile,
        grant: DelegationGrant,
    ) -> Result<Self, DelegationError> {
        if !profile.mode.is_known() {
            return Err(DelegationError::UnknownMode);
        }
        if !profile.is_enabled() {
            return Err(DelegationError::Disabled);
        }
        if !profile.contracts_are_harness_authored() {
            return Err(DelegationError::ContractAuthorNotHarness);
        }
        if !valid_grant(&grant) {
            return Err(DelegationError::InvalidGrant);
        }
        let requested_purpose = if profile.clean_context_review {
            DelegationPurpose::CleanContextReview
        } else {
            DelegationPurpose::Investigation
        };
        Ok(Self {
            profile,
            grant,
            requested_purpose,
        })
    }

    #[must_use]
    pub fn profile(&self) -> &DelegationProfile {
        &self.profile
    }

    #[must_use]
    pub fn grant(&self) -> &DelegationGrant {
        &self.grant
    }

    /// The purpose any model-originated request resolves to. Never a
    /// write-capable one.
    #[must_use]
    pub fn requested_purpose(&self) -> DelegationPurpose {
        self.requested_purpose
    }

    /// Concurrent children allowed in one wave. Exceeding it fails loudly
    /// rather than queueing. The child registry's own hard ceiling binds below
    /// a larger profile value.
    #[must_use]
    pub fn concurrency_limit(&self) -> usize {
        usize::from(self.effective_parallel_children())
    }

    // Both ceilings are non-zero: `valid_grant` rejects a zero budget, so the
    // clamps below cannot invert.
    fn effective_parallel_children(&self) -> u16 {
        let ceiling = DEFAULT_MAX_PARALLEL_CHILDREN.min(self.grant.budget.max_parallel_children);
        u16::from(self.profile.max_concurrency).clamp(1, ceiling)
    }

    fn effective_max_depth(&self) -> u16 {
        u16::from(self.profile.max_depth).clamp(1, self.grant.budget.max_depth)
    }

    /// Builds the contract for one delegation. Every authority-bearing field
    /// comes from the grant and the profile; the request contributes identity
    /// and task text only.
    pub fn author(
        &self,
        purpose: DelegationPurpose,
        request: &DelegationRequest,
    ) -> Result<DelegationContract, DelegationError> {
        if !valid_request(request) || request.child_session_id == self.grant.parent_session_id {
            return Err(DelegationError::InvalidRequest);
        }
        match purpose {
            DelegationPurpose::CleanContextReview if !self.profile.clean_context_review => {
                return Err(DelegationError::ReviewWithdrawn);
            }
            DelegationPurpose::Implementation if !self.profile.permits_writes() => {
                return Err(DelegationError::WritesDenied);
            }
            _ => {}
        }
        let max_depth = self.effective_max_depth();
        let depth = self
            .grant
            .parent_depth
            .checked_add(1)
            .ok_or(DelegationError::DepthExhausted)?;
        if depth > max_depth {
            return Err(DelegationError::DepthExhausted);
        }
        let (allowed_tools, allowed_permissions) = if purpose.permits_writes() {
            let tools = self
                .grant
                .read_tools
                .union(&self.grant.write_tools)
                .cloned()
                .collect();
            (
                tools,
                vec![
                    PermissionKind::FilesystemRead,
                    PermissionKind::FilesystemWrite,
                ],
            )
        } else {
            (
                self.grant.read_tools.clone(),
                vec![PermissionKind::FilesystemRead],
            )
        };
        Ok(DelegationContract {
            spec: SubagentSpec {
                parent_session_id: self.grant.parent_session_id.clone(),
                child_session_id: request.child_session_id.clone(),
                change_id: self.grant.change_id.clone(),
                depth,
                task: TaskScope {
                    task_id: request.task_id.clone(),
                    description: request.description.clone(),
                    repositories: self.grant.repositories.clone(),
                    paths: self.grant.paths.clone(),
                },
                allowed_tools,
                allowed_permissions,
                risk_floor: self.grant.risk_floor,
                model_floor: self.grant.model_floor,
                budget: SubagentBudget {
                    max_depth,
                    max_parallel_children: self.effective_parallel_children(),
                    max_tokens: self.grant.budget.max_tokens,
                    max_time_ms: self.grant.budget.max_time_ms,
                    max_tool_calls: self.grant.budget.max_tool_calls,
                },
                expected_result: ExpectedResultSchema {
                    version: 1,
                    kind: purpose.expected_kind(),
                },
                base_workspace_revision: self.grant.base_workspace_revision.clone(),
            },
            purpose,
        })
    }

    /// Accepts a dispatcher-supplied spec as a *request only*. The harness
    /// re-authors the contract from its own grant and refuses the call unless
    /// the supplied spec is exactly what the harness would have written. A
    /// widened tool grant, an extra path, a larger budget, a deeper spawn or a
    /// different result schema all diverge and are refused.
    pub fn accept(&self, requested: &SubagentSpec) -> Result<DelegationContract, DelegationError> {
        let contract = self.author(
            self.requested_purpose,
            &DelegationRequest {
                child_session_id: requested.child_session_id.clone(),
                task_id: requested.task.task_id.clone(),
                description: requested.task.description.clone(),
            },
        )?;
        if &contract.spec != requested {
            return Err(DelegationError::ModelAuthoredContract);
        }
        Ok(contract)
    }
}

fn valid_request(request: &DelegationRequest) -> bool {
    bounded(&request.task_id, MAX_IDENTIFIER_BYTES)
        && bounded(&request.description, MAX_TASK_TEXT_BYTES)
}

fn valid_grant(grant: &DelegationGrant) -> bool {
    let budget = &grant.budget;
    bounded(&grant.change_id, MAX_IDENTIFIER_BYTES)
        && bounded(&grant.base_workspace_revision, MAX_IDENTIFIER_BYTES)
        && !grant.repositories.is_empty()
        && !grant.paths.is_empty()
        && !grant.read_tools.is_empty()
        && grant.repositories.len() <= MAX_GRANT_ENTRIES
        && grant.paths.len() <= MAX_GRANT_ENTRIES
        && grant.read_tools.len() + grant.write_tools.len() <= MAX_GRANT_ENTRIES
        && grant
            .repositories
            .iter()
            .chain(&grant.paths)
            .chain(&grant.read_tools)
            .chain(&grant.write_tools)
            .all(|value| bounded(value, MAX_IDENTIFIER_BYTES))
        && budget.max_depth > 0
        && budget.max_parallel_children > 0
        && budget.max_tokens > 0
        && budget.max_time_ms > 0
        && budget.max_tool_calls > 0
}

fn bounded(value: &str, max_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max_bytes && !value.contains('\0')
}

/// A read-only grant for a clean-context reviewer, expressed once so callers
/// do not hand-roll one and drift. Its depth ceiling is 3, the documented cap;
/// a profile may lower it but never raise it.
#[must_use]
pub fn read_only_grant(
    change_id: impl Into<String>,
    parent_session_id: SessionId,
    repositories: Vec<String>,
    paths: Vec<String>,
    read_tools: BTreeSet<String>,
    base_workspace_revision: impl Into<String>,
) -> DelegationGrant {
    DelegationGrant {
        change_id: change_id.into(),
        parent_session_id,
        parent_depth: 0,
        repositories,
        paths,
        read_tools,
        write_tools: BTreeSet::new(),
        risk_floor: RiskTier::Medium,
        model_floor: ModelFloor::Standard,
        budget: SubagentBudget {
            max_depth: 3,
            ..SubagentBudget::default()
        },
        base_workspace_revision: base_workspace_revision.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_config::DelegationMode;

    fn grant() -> DelegationGrant {
        read_only_grant(
            "change-1",
            SessionId::from_stable("parent"),
            vec!["root".into()],
            vec!["src/auth".into()],
            BTreeSet::from(["read_file".into()]),
            "revision-1",
        )
    }

    fn request() -> DelegationRequest {
        DelegationRequest {
            child_session_id: SessionId::from_stable("child"),
            task_id: "task-1".into(),
            description: "review the auth change".into(),
        }
    }

    fn governor() -> DelegationGovernor {
        DelegationGovernor::new(DelegationProfile::default(), grant()).unwrap()
    }

    #[test]
    fn harness_authors_the_contract_and_a_model_request_only_names_the_task() {
        let contract = governor().accept(&{
            let mut spec = governor()
                .author(DelegationPurpose::CleanContextReview, &request())
                .unwrap()
                .into_spec();
            spec.task.description = "review the auth change".into();
            spec
        });
        let contract = contract.unwrap();
        assert_eq!(contract.author(), ContractAuthor::Harness);
        assert!(contract.clean_context());
        assert_eq!(contract.spec().change_id, "change-1");
        assert_eq!(contract.spec().task.paths, vec!["src/auth".to_owned()]);
        assert_eq!(
            contract.spec().expected_result,
            ExpectedResultSchema {
                version: 1,
                kind: ResultKind::Findings
            }
        );
    }

    #[test]
    fn a_model_supplied_contract_is_refused() {
        let governor = governor();
        let mut widened = governor
            .author(DelegationPurpose::CleanContextReview, &request())
            .unwrap()
            .into_spec();
        widened.allowed_tools.insert("write_file".into());
        assert_eq!(
            governor.accept(&widened),
            Err(DelegationError::ModelAuthoredContract)
        );

        let mut escaped = governor
            .author(DelegationPurpose::CleanContextReview, &request())
            .unwrap()
            .into_spec();
        escaped.task.paths.push("src/billing".into());
        assert_eq!(
            governor.accept(&escaped),
            Err(DelegationError::ModelAuthoredContract)
        );

        let mut richer = governor
            .author(DelegationPurpose::CleanContextReview, &request())
            .unwrap()
            .into_spec();
        richer.budget.max_tokens += 1;
        assert_eq!(
            governor.accept(&richer),
            Err(DelegationError::ModelAuthoredContract)
        );

        let mut writer = governor
            .author(DelegationPurpose::CleanContextReview, &request())
            .unwrap()
            .into_spec();
        writer.allowed_permissions = vec![PermissionKind::FilesystemWrite];
        assert_eq!(
            governor.accept(&writer),
            Err(DelegationError::ModelAuthoredContract)
        );
    }

    #[test]
    fn a_model_request_can_never_reach_write_authority() {
        let profile = DelegationProfile {
            mode: DelegationMode::ReadAndWrite,
            ..DelegationProfile::default()
        };
        let governor = DelegationGovernor::new(profile, grant()).unwrap();
        assert_eq!(
            governor.requested_purpose(),
            DelegationPurpose::CleanContextReview
        );
        let requested = governor
            .author(DelegationPurpose::CleanContextReview, &request())
            .unwrap()
            .into_spec();
        assert_eq!(
            requested.allowed_permissions,
            vec![PermissionKind::FilesystemRead]
        );
        assert!(!requested.allowed_tools.contains("write_file"));
        // The harness may still author a writer explicitly.
        let writer = governor
            .author(DelegationPurpose::Implementation, &request())
            .unwrap();
        assert_eq!(writer.spec().expected_result.kind, ResultKind::Patch);
    }

    #[test]
    fn read_only_profiles_deny_write_capable_contracts() {
        assert_eq!(
            governor().author(DelegationPurpose::Implementation, &request()),
            Err(DelegationError::WritesDenied)
        );
    }

    #[test]
    fn disabled_unknown_and_model_authored_profiles_produce_no_governor() {
        let disabled = DelegationProfile {
            mode: DelegationMode::Disabled,
            ..DelegationProfile::default()
        };
        assert_eq!(
            DelegationGovernor::new(disabled, grant()).err(),
            Some(DelegationError::Disabled)
        );

        let model = DelegationProfile {
            contract_author: ContractAuthor::Model,
            ..DelegationProfile::default()
        };
        assert_eq!(
            DelegationGovernor::new(model, grant()).err(),
            Some(DelegationError::ContractAuthorNotHarness)
        );

        let unknown = DelegationProfile {
            mode: DelegationMode::Unknown {
                tag: "read-and-write-and-land".into(),
                body: serde_json::Value::Null,
            },
            ..DelegationProfile::default()
        };
        assert_eq!(
            DelegationGovernor::new(unknown, grant()).err(),
            Some(DelegationError::UnknownMode)
        );

        let mut empty = grant();
        empty.read_tools.clear();
        assert_eq!(
            DelegationGovernor::new(DelegationProfile::default(), empty).err(),
            Some(DelegationError::InvalidGrant)
        );
    }

    #[test]
    fn depth_and_concurrency_caps_come_from_the_profile() {
        let profile = DelegationProfile {
            max_depth: 2,
            max_concurrency: 8,
            ..DelegationProfile::default()
        };
        let mut deep = grant();
        deep.parent_depth = 2;
        assert_eq!(
            DelegationGovernor::new(profile.clone(), deep)
                .unwrap()
                .author(DelegationPurpose::CleanContextReview, &request()),
            Err(DelegationError::DepthExhausted)
        );

        let governor = DelegationGovernor::new(profile, grant()).unwrap();
        // The registry's hard ceiling binds below the profile's larger value.
        assert_eq!(
            governor.concurrency_limit(),
            usize::from(DEFAULT_MAX_PARALLEL_CHILDREN)
        );
        let spec = governor
            .author(DelegationPurpose::CleanContextReview, &request())
            .unwrap()
            .into_spec();
        assert_eq!(spec.depth, 1);
        assert_eq!(spec.budget.max_depth, 2);
    }

    #[test]
    fn clean_context_review_can_be_withdrawn_without_becoming_a_writer() {
        let profile = DelegationProfile {
            clean_context_review: false,
            ..DelegationProfile::default()
        };
        let governor = DelegationGovernor::new(profile, grant()).unwrap();
        assert_eq!(
            governor.requested_purpose(),
            DelegationPurpose::Investigation
        );
        assert_eq!(
            governor.author(DelegationPurpose::CleanContextReview, &request()),
            Err(DelegationError::ReviewWithdrawn)
        );
        let spec = governor
            .author(DelegationPurpose::Investigation, &request())
            .unwrap()
            .into_spec();
        assert_eq!(
            spec.allowed_permissions,
            vec![PermissionKind::FilesystemRead]
        );
    }

    #[test]
    fn malformed_requests_are_refused_before_a_contract_exists() {
        let governor = governor();
        let mut blank = request();
        blank.description = "   ".into();
        assert_eq!(
            governor.author(DelegationPurpose::Investigation, &blank),
            Err(DelegationError::InvalidRequest)
        );
        let mut self_parent = request();
        self_parent.child_session_id = SessionId::from_stable("parent");
        assert_eq!(
            governor.author(DelegationPurpose::Investigation, &self_parent),
            Err(DelegationError::InvalidRequest)
        );
    }
}
