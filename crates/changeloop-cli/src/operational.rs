use super::{
    CliFailure, EXIT_INVALID_INPUT, EXIT_LIFECYCLE_REJECTION, EXIT_PROOF_FAILURE, io_failure,
    mcp_registry, prove_oracle,
};
use changeloop_harness::{
    CleanReviewRequest, CleanReviewResult, ConvergenceHarness, FailureClass, Freshness,
    IndependentReviewer, LandAuthority, LifecyclePhase, ProofFailure, ProofReceipt,
    ProofRequirement, RepairBudget, RepairStatus, RiskTrigger, TransitionEffect,
};
use changeloop_land::{
    ApplyControl, AuthoritySource, ExternalLandAuthority, LandError, apply_land_checked,
    archive_land, prepare_land, read_prove_evidence,
};
use changeloop_language::{ProjectToolResolver, ToolAvailability};
use changeloop_mcp::{KeyringOAuthTokenStore, OAuthClient, OAuthTokenStore};
use changeloop_protocol::{OperationId, SessionId, redact_sensitive_text, redact_sensitive_value};
use changeloop_provider::UsageLedger;
use changeloop_snapshot::SnapshotManager;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
#[cfg(unix)]
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;

/// Variables the harness sets on a repair command. Their names are part of the
/// approval; their values are derived per failure by this binary.
const REPAIR_HARNESS_ENVIRONMENT: [&str; 2] =
    ["CHANGELOOP_FAILED_PROVIDER", "CHANGELOOP_FAILURE_CAUSE"];

const MAX_OPERATIONAL_STATE_BYTES: u64 = 16 * 1024 * 1024;
pub(crate) const MAX_OPERATIONAL_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_OPERATIONAL_ARTIFACT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_LAND_PROJECTION_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct OperationalState {
    sessions: BTreeMap<String, SessionRecord>,
    changes: BTreeMap<String, ChangeRecord>,
    jobs: BTreeMap<String, JobRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SessionRecord {
    kind: String,
    prompt: String,
    created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_session_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ChangeRecord {
    session_id: String,
    expected_revision: String,
    proof: Option<ProofReceipt>,
    reviewed: bool,
    landed: bool,
    land_operation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    convergence: Option<ConvergenceHarness>,
    #[serde(default = "default_risk_tier")]
    risk_tier: String,
    #[serde(default = "default_risk_triggers")]
    risk_triggers: BTreeSet<RiskTrigger>,
}

fn default_risk_tier() -> String {
    // Legacy state predates deterministic risk classification. Treating an
    // absent tier as low would silently weaken the independent-review gate.
    "high".into()
}

fn default_risk_triggers() -> BTreeSet<RiskTrigger> {
    BTreeSet::from([RiskTrigger::SecurityBoundary])
}

fn classify_risk_triggers(intent: &str, tier: &str) -> BTreeSet<RiskTrigger> {
    let normalized = intent.to_ascii_lowercase();
    let mut triggers = BTreeSet::new();
    for (signals, trigger) in [
        (
            &["auth", "authorization", "permission"][..],
            RiskTrigger::AuthenticationAuthorization,
        ),
        (
            &["public api", "breaking", "compatib"][..],
            RiskTrigger::PublicApiCompatibility,
        ),
        (
            &["migration", "database", "schema", "persistent"][..],
            RiskTrigger::MigrationPersistentData,
        ),
        (
            &["concurr", "race", "parallel", "lock"][..],
            RiskTrigger::Concurrency,
        ),
        (
            &["irreversible", "delete", "destructive"][..],
            RiskTrigger::IrreversibleAction,
        ),
        (
            &["security", "secret", "credential", "sandbox"][..],
            RiskTrigger::SecurityBoundary,
        ),
        (
            &["multi-repo", "multiple repos", "cross-repo"][..],
            RiskTrigger::MultiRepositoryContract,
        ),
        (
            &["anomal", "conflicting evidence", "evidence conflict"][..],
            RiskTrigger::AnomalousEvidence,
        ),
    ] {
        if signals.iter().any(|signal| normalized.contains(signal)) {
            triggers.insert(trigger);
        }
    }
    if triggers.is_empty() {
        match tier {
            "medium" => {
                triggers.insert(RiskTrigger::PublicApiCompatibility);
            }
            "high" => {
                triggers.insert(RiskTrigger::SecurityBoundary);
            }
            _ => {}
        }
    }
    triggers
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofProviderConfig {
    id: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_claims")]
    claims: BTreeSet<String>,
    #[serde(default)]
    failure_class: ConfiguredFailureClass,
    #[serde(default)]
    repair_command: Option<String>,
    #[serde(default)]
    repair_args: Vec<String>,
    #[serde(default = "default_executor_timeout_ms")]
    timeout_ms: u64,
    /// Set only by the compiled-in provider. Repository configuration cannot
    /// opt into or impersonate an internal executor through deserialization.
    #[serde(skip)]
    builtin_hardened_git: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewerConfig {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_executor_timeout_ms")]
    timeout_ms: u64,
}

#[cfg(test)]
const MAX_EXECUTOR_OUTPUT_BYTES: usize = changeloop_ops::MAX_LIFECYCLE_OUTPUT_BYTES;

const fn default_executor_timeout_ms() -> u64 {
    120_000
}

fn lifecycle_hook_audit(root: &Path, event: changeloop_mcp::HookEvent, input: Value) -> Value {
    if !env::var("CHANGELOOP_PERMISSION_MCP").is_ok_and(|value| value.eq_ignore_ascii_case("allow"))
    {
        return json!({"contractVersion":1,"event":event,"policy":"advisory",
            "enabled":false,"reason":"explicit trusted MCP allow is required",
            "outputProvenance":"mcp-content","invocations":[]});
    }
    let discovery = changeloop_mcp::discover_extensions(root);
    let mut host = changeloop_mcp::ExtensionHost::with_output_limit(root.to_owned(), 1024 * 1024);
    let mut subscriptions = Vec::new();
    let mut invocations = discovery
        .failures
        .into_iter()
        .map(|failure| {
            json!({"id":Value::Null,"status":"discovery-failed",
            "error":redact_sensitive_text(&failure.message),"isolated":true})
        })
        .collect::<Vec<_>>();
    for extension in discovery.discovered {
        if extension.manifest.kind != changeloop_mcp::ExtensionKind::Hook
            || extension.manifest.runtime != Some(changeloop_mcp::ExtensionRuntime::StdioV1)
            || !extension.manifest.hook_events.contains(&event)
        {
            continue;
        }
        let id = extension.manifest.id.clone();
        let timeout = Duration::from_millis(extension.manifest.timeout_ms.clamp(10, 5_000));
        match changeloop_mcp::ExecutableExtensionHandler::new(
            root,
            &extension.entry_path,
            1024 * 1024,
            changeloop_mcp::ExtensionInputProvenance::ToolOutput,
        )
        .and_then(|handler| {
            host.register_hook(id.clone(), [event], Arc::new(handler))
                .map_err(|error| error.to_string())
        }) {
            Ok(()) => subscriptions.push((id, timeout)),
            Err(error) => invocations.push(json!({"id":id,"status":"load-failed",
                "error":redact_sensitive_text(&error),"isolated":true})),
        }
    }
    subscriptions.sort_by(|left, right| left.0.cmp(&right.0));
    for (id, timeout) in subscriptions {
        invocations.push(match host.invoke(&id, input.clone(), timeout) {
            Ok(_) => json!({"id":id,"status":"completed","isolated":true}),
            Err(error) => json!({"id":id,"status":"failed",
                "error":redact_sensitive_text(&error.to_string()),"isolated":true}),
        });
    }
    json!({"contractVersion":1,"event":event,"policy":"advisory","enabled":true,
        "inputProvenance":"trusted-policy","outputProvenance":"mcp-content",
        "authorityAccepted":false,"invocations":invocations})
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ConfiguredFailureClass {
    #[default]
    Code,
    Config,
    Infrastructure,
    AuthorityRequired,
}

impl From<ConfiguredFailureClass> for FailureClass {
    fn from(value: ConfiguredFailureClass) -> Self {
        match value {
            ConfiguredFailureClass::Code => Self::Code,
            ConfiguredFailureClass::Config => Self::Config,
            ConfiguredFailureClass::Infrastructure => Self::Infrastructure,
            ConfiguredFailureClass::AuthorityRequired => Self::AuthorityRequired,
        }
    }
}

fn default_claims() -> BTreeSet<String> {
    BTreeSet::from(["workspace-valid".into()])
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct JobRecord {
    state: String,
    kind: String,
}

pub(super) fn record_invocation(
    command: &str,
    prompt: &str,
    result: &Value,
) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let session_id = result["sessionId"]
        .as_str()
        .ok_or_else(|| invalid("provider response did not include a session ID"))?;
    let kind = result["sessionKind"].as_str().unwrap_or("conversation");
    let mut state = load_state(&root)?;
    state.sessions.insert(
        session_id.into(),
        SessionRecord {
            kind: kind.into(),
            prompt: redact_sensitive_text(prompt),
            created_at_ms: now_ms(),
            parent_session_id: None,
        },
    );
    // Only the explicit run surface creates mutation lifecycle state.
    if command == "run" && result["changeState"] == "confirmed" {
        state.changes.insert(
            session_id.into(),
            ChangeRecord {
                session_id: session_id.into(),
                expected_revision: workspace_revision(&root)?,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: result["riskTier"].as_str().unwrap_or("low").into(),
                risk_triggers: classify_risk_triggers(
                    prompt,
                    result["riskTier"].as_str().unwrap_or("low"),
                ),
            },
        );
    }
    save_state(&root, &state)?;
    changeloop_ops::upsert_privacy_session(
        &privacy_path(&root),
        changeloop_ops::PrivacySession {
            id: session_id.into(),
            active: command == "run",
            evidence_refs: 0,
            data: json!({"kind":kind,"prompt":redact_sensitive_text(prompt),
                "result":redact_sensitive_value(result)}),
            provenance: vec!["user-input".into(), "model-generated".into()],
        },
    )
    .map_err(super::ops_failure)
}

pub(super) fn promote_confirmed_change(
    session_id: &str,
    result: &Value,
) -> Result<String, CliFailure> {
    safe_identifier(session_id)?;
    let root = env::current_dir().map_err(io_failure)?;
    let mut state = load_state(&root)?;
    let risk_tier = result["riskTier"].as_str().unwrap_or("low").to_owned();
    state
        .sessions
        .entry(session_id.into())
        .and_modify(|session| session.kind = "change".into())
        .or_insert(SessionRecord {
            kind: "change".into(),
            prompt: "[persisted draft confirmed]".into(),
            created_at_ms: now_ms(),
            parent_session_id: None,
        });
    state
        .changes
        .entry(session_id.into())
        .or_insert(ChangeRecord {
            session_id: session_id.into(),
            expected_revision: workspace_revision(&root)?,
            proof: None,
            reviewed: false,
            landed: false,
            land_operation: None,
            convergence: None,
            risk_tier: risk_tier.clone(),
            risk_triggers: result["riskTriggers"]
                .as_array()
                .and_then(|value| serde_json::from_value(Value::Array(value.clone())).ok())
                .unwrap_or_else(|| classify_risk_triggers("", &risk_tier)),
        });
    save_state(&root, &state)?;
    changeloop_ops::update_privacy_lifecycle(&privacy_path(&root), session_id, true, 0)
        .map_err(super::ops_failure)?;
    Ok(risk_tier)
}

pub(super) fn purge_sessions(ids: &[String]) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let mut state = load_state(&root)?;
    for id in ids {
        state.sessions.remove(id);
        state.changes.remove(id);
    }
    save_state(&root, &state)
}

pub(super) fn sessions() -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let state = load_state(&root)?;
    print_json(json!({ "sessions": state.sessions, "changes": state.changes }));
    Ok(())
}

pub(super) fn resume(session: Option<&String>) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let state = load_state(&root)?;
    let session_id = selected_session(&state, session)?;
    let record = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| invalid(format!("session does not exist: {session_id}")))?;
    print_json(json!({
        "sessionId": session_id,
        "sessionKind": record.kind,
        "prompt": record.prompt,
        "resumed": false,
        "inspected": true,
        "runtimeState": "not_connected",
        "reason": "the local operational record has no attached live app-server runtime; no provider or tool execution was resumed",
        "mutationAuthorityStored": record.kind == "change",
        "mutationAllowed": false,
    }));
    Ok(())
}

pub(super) fn fork(session: &str) -> Result<(), CliFailure> {
    safe_identifier(session)?;
    let root = env::current_dir().map_err(io_failure)?;
    let mut state = load_state(&root)?;
    let source = state
        .sessions
        .get(session)
        .cloned()
        .ok_or_else(|| invalid(format!("session does not exist: {session}")))?;
    let fork_id = SessionId::new().to_string();
    state.sessions.insert(
        fork_id.clone(),
        SessionRecord {
            kind: "conversation".into(),
            prompt: source.prompt,
            created_at_ms: now_ms(),
            parent_session_id: Some(session.into()),
        },
    );
    save_state(&root, &state)?;
    print_json(json!({
        "sessionId": fork_id,
        "sessionKind": "conversation",
        "forkedFrom": session,
        "mutationAllowed": false,
    }));
    Ok(())
}

pub(super) fn jobs() -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    print_json(json!({ "jobs": load_state(&root)?.jobs }));
    Ok(())
}

pub(super) fn status_value(root: &Path) -> Result<Value, CliFailure> {
    let state = load_state(root)?;
    Ok(json!({
        "sessionCount": state.sessions.len(),
        "changeCount": state.changes.len(),
        "activeChanges": state.changes.values().filter(|change| !change.landed).count(),
        "jobCount": state.jobs.len()
    }))
}

pub(super) fn language_status(lsp: bool) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let resolver = ProjectToolResolver::new(&root).map_err(|error| invalid(error.to_string()))?;
    let names: &[&str] = if lsp {
        &[
            "rust-analyzer",
            "typescript-language-server",
            "pyright-langserver",
        ]
    } else {
        &["rustfmt", "prettier", "black"]
    };
    let tools = names
        .iter()
        .map(|name| {
            let availability = ProjectToolResolver::conventional_candidates(name)
                .iter()
                .map(|candidate| resolver.resolve(candidate))
                .find(|candidate| matches!(candidate, ToolAvailability::Available(_)));
            match availability {
                Some(ToolAvailability::Available(executable)) => {
                    json!({"name":name,"status":"available","path":executable.path})
                }
                _ => json!({
                    "name":name,
                    "status":"absent",
                    "diagnostic":"project-owned executable not found; no download attempted"
                }),
            }
        })
        .collect::<Vec<_>>();
    print_json(json!({"kind":if lsp {"lsp"} else {"formatter"},"tools":tools}));
    Ok(())
}

pub(super) fn prove(change: Option<&String>) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let change = selected_change(&load_state(&root)?, change)?;
    print_json(prove_at(&root, &change)?);
    Ok(())
}

pub(super) fn prove_silent(change: &str) -> Result<Value, CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    prove_at(&root, change)
}

fn prove_at(root: &Path, change: &str) -> Result<Value, CliFailure> {
    safe_identifier(change)?;
    let before_hooks = lifecycle_hook_audit(
        root,
        changeloop_mcp::HookEvent::BeforeProve,
        json!({"schemaVersion":1,"changeId":change,"phase":"prove",
            "provenance":"trusted-policy",
            "authority":{"lifecycle":false,"permissions":false,"land":false}}),
    );
    let (providers, providers_digest) = proof_providers(root)?;
    // Authority for every repository-configured provider is resolved before any
    // lifecycle state is touched, so an unapproved provider refuses without
    // half-advancing the change.
    let mut approved_providers = BTreeMap::new();
    let mut approved_repairs = BTreeMap::new();
    for provider in &providers {
        if !provider.builtin_hardened_git {
            approved_providers.insert(
                provider.id.clone(),
                authorize_configured_executor(&executor_request(
                    root,
                    changeloop_ops::ExecutorKind::ProofProvider,
                    &provider.id,
                    &provider.command,
                    &provider.args,
                    &[],
                    provider.timeout_ms,
                    &providers_digest,
                ))?,
            );
        }
        // A repair command runs unattended after a failure, so its authority is
        // resolved up front too rather than at the moment the lifecycle is
        // least able to refuse.
        if let Some(command) = provider.repair_command.as_deref() {
            approved_repairs.insert(
                provider.id.clone(),
                authorize_configured_executor(&executor_request(
                    root,
                    changeloop_ops::ExecutorKind::RepairCommand,
                    &provider.id,
                    command,
                    &provider.repair_args,
                    &REPAIR_HARNESS_ENVIRONMENT,
                    provider.timeout_ms,
                    &providers_digest,
                ))?,
            );
        }
    }
    // Oracle configuration is read before the providers run because it decides
    // which provider's output carries per-test outcomes. A bad configuration is
    // a diagnostic, never a Prove failure.
    let (oracle_config, oracle_config_error) = prove_oracle::ProveOracleConfig::load(root);
    let mut candidate = prove_oracle::CandidateCollector::default();
    let mut state = load_state(root)?;
    let record = change_mut(&mut state, change)?;
    ensure_not_landed(record)?;
    let revision = workspace_revision(root)?;
    if let Err(error) = prepare_convergence(record, &providers, &revision) {
        save_state(root, &state)?;
        return Err(error);
    }

    let mut executed = Vec::new();
    let mut reused = Vec::new();
    for provider in &providers {
        let is_fresh = record
            .convergence
            .as_ref()
            .and_then(|harness| harness.proof_records().get(&provider.id))
            .is_some_and(|proof| {
                proof.freshness == Freshness::Fresh
                    && proof.fresh_for_revision == revision
                    && provider.claims.is_subset(&proof.receipt.claims)
            });
        if is_fresh {
            reused.push(provider.id.clone());
            continue;
        }
        let execution = if provider.builtin_hardened_git {
            run_hardened_git(root, &provider.args, provider.timeout_ms)
        } else {
            // Repository content chose this program. Authority for it was
            // resolved before any provider ran, so a refusal cannot leave the
            // lifecycle half-advanced.
            let approved = approved_providers
                .get(provider.id.as_str())
                .ok_or_else(|| lifecycle("proof provider lost its approval"))?;
            run_approved_command(approved, root, None, &[])
        };
        let output = match execution {
            Ok(output) => output,
            Err(error) => {
                let failure = ProofFailure {
                    provider: provider.id.clone(),
                    cause_id: format!("{}-spawn", provider.id),
                    class: FailureClass::Infrastructure,
                    summary: error.clone(),
                    observed_at_ms: now_ms(),
                };
                record_failure(record, failure)?;
                save_state(root, &state)?;
                return Err(CliFailure {
                    code: EXIT_PROOF_FAILURE,
                    message: format!("proof provider '{}' could not start: {error}", provider.id),
                });
            }
        };
        if !output.status.success() {
            let summary = proof_output_summary(&output);
            let cause_id = format!("{}-{:x}", provider.id, Sha256::digest(summary.as_bytes()));
            let failure = ProofFailure {
                provider: provider.id.clone(),
                cause_id,
                class: provider.failure_class.into(),
                summary: summary.clone(),
                observed_at_ms: now_ms(),
            };
            let effect = record_failure(record, failure.clone())?;
            if let Some(repair) = approved_repairs.get(provider.id.as_str()) {
                apply_configured_repair(root, record, provider, repair, &failure, effect)?;
                save_state(root, &state)?;
                // Reload the durable lifecycle and rerun only receipts that the
                // repair invalidated. Harness repair budget/doom-loop gates make
                // this recursion bounded.
                return prove_at(root, change);
            }
            save_state(root, &state)?;
            return Err(CliFailure {
                code: EXIT_PROOF_FAILURE,
                message: format!("proof provider '{}' failed: {summary}", provider.id),
            });
        }
        candidate.observe(
            &oracle_config,
            &provider.id,
            &output.stdout,
            output.truncated,
        );
        let mut evidence = Sha256::new();
        evidence.update(&output.stdout);
        evidence.update(&output.stderr);
        evidence.update(output.status.code().unwrap_or_default().to_le_bytes());
        let receipt = ProofReceipt {
            receipt_id: format!("{}-{}", provider.id, OperationId::new()),
            provider: provider.id.clone(),
            claims: provider.claims.clone(),
            workspace_revision: revision.clone(),
            evidence_hash: format!("sha256:{:x}", evidence.finalize()),
            completed_at_ms: now_ms(),
        };
        record
            .convergence
            .as_mut()
            .ok_or_else(|| lifecycle("proof convergence state disappeared"))?
            .record_proof(receipt.clone())
            .map_err(|error| lifecycle(error.to_string()))?;
        record.proof = Some(receipt);
        executed.push(provider.id.clone());
    }
    record.expected_revision = revision.clone();
    record.reviewed = false;
    let after_hooks = lifecycle_hook_audit(
        root,
        changeloop_mcp::HookEvent::AfterProve,
        json!({"schemaVersion":1,"changeId":change,"phase":"prove","status":"passed",
            "provenance":"trusted-policy",
            "authority":{"lifecycle":false,"permissions":false,"land":false}}),
    );
    let hook_directory = root.join(".changeloop/proofs");
    write_private_artifact_json(
        root,
        &hook_directory.join(format!("{change}.hooks.json")),
        &json!({"schemaVersion":1,"changeId":change,
            "policy":"advisory","before":before_hooks.clone(),"after":after_hooks.clone()}),
    )?;
    // Commit the lifecycle state only after its required local proof audit is
    // durable. An artifact failure must not leave a persisted passed proof.
    save_state(root, &state)?;
    changeloop_ops::update_privacy_lifecycle(&privacy_path(root), change, true, 1)
        .map_err(super::ops_failure)?;
    // Evidence, never a gate. The oracle runs after the lifecycle state is
    // durable so that nothing it does — including failing outright — can change
    // whether this Prove passed. What it can change is whether the human at
    // Land is shown what the suite did and did not exercise.
    let oracle = prove_oracle::record(
        root,
        &oracle_config,
        prove_oracle::OracleInputs {
            change,
            revision: &revision,
            diff: review_diff(root).map_err(|error| error.message),
            config_error: oracle_config_error,
            claims: providers
                .iter()
                .flat_map(|provider| provider.claims.iter().cloned())
                .collect(),
            candidate,
        },
    );
    Ok(
        json!({"change":change,"proof":"passed","executedProviders":executed,
        "reusedProviders":reused,"phase":record_phase(load_state(root)?.changes.get(change)),
        "oracle":oracle,
        "hooks":{"before":before_hooks,"after":after_hooks}}),
    )
}

pub(super) fn review(change: Option<&String>) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let change = selected_change(&load_state(&root)?, change)?;
    review_at(&root, &change)
}

fn review_at(root: &Path, change: &str) -> Result<(), CliFailure> {
    safe_identifier(change)?;
    let before_hooks = lifecycle_hook_audit(
        root,
        changeloop_mcp::HookEvent::BeforeReview,
        json!({"schemaVersion":1,"changeId":change,"phase":"review",
            "provenance":"trusted-policy",
            "authority":{"lifecycle":false,"permissions":false,"land":false}}),
    );
    let approved_reviewer = approved_reviewer(root)?;
    let mut state = load_state(root)?;
    let record = change_mut(&mut state, change)?;
    ensure_not_landed(record)?;
    let revision = workspace_revision(root)?;
    if revision != record.expected_revision {
        if let Some(harness) = record.convergence.as_mut() {
            harness.workspace_revision_mismatch(&revision);
        }
        record.reviewed = false;
        save_state(root, &state)?;
        return Err(lifecycle("review rejected stale proof"));
    }
    let harness = record
        .convergence
        .as_mut()
        .ok_or_else(|| lifecycle("review requires deterministic proof"))?;
    if *harness.phase() != LifecyclePhase::Review {
        return Err(lifecycle(format!(
            "review requires review phase; current phase is {:?}",
            harness.phase()
        )));
    }
    let attempt_id = format!("review-{}", OperationId::new());
    let artifact_root = root.join(".changeloop/reviews").join(&attempt_id);
    create_private_operational_directory(root, &artifact_root).map_err(io_failure)?;
    let diff_artifact = artifact_root.join("diff.patch");
    let diff = review_diff(root)?;
    write_private_artifact(root, &diff_artifact, &diff)?;
    let agreement_artifact = artifact_root.join("agreement.json");
    write_private_artifact_json(
        root,
        &agreement_artifact,
        &json!({
            "changeId": change,
            "implementationSessionId": record.session_id,
            "expectedRevision": record.expected_revision
        }),
    )?;
    let evidence_artifact = artifact_root.join("evidence.json");
    write_private_artifact_json(root, &evidence_artifact, harness.proof_records())?;
    let reviewer_session_id = format!("independent-review-{}", OperationId::new());
    let packet = CleanReviewRequest {
        reviewer_session_id,
        implementation_session_id: record.session_id.clone(),
        diff_artifact: diff_artifact.display().to_string(),
        agreement_artifact: agreement_artifact.display().to_string(),
        evidence_artifacts: vec![evidence_artifact.display().to_string()],
        residual_risks: vec!["risk-triggered independent review required".into()],
        risk_triggers: harness.risk_triggers().clone(),
    };
    let mut reviewer = CommandReviewer {
        approved: approved_reviewer,
        root: root.to_path_buf(),
    };
    harness
        .run_independent_review(
            attempt_id.clone(),
            env::var("CHANGELOOP_PROVIDER")
                .unwrap_or_else(|_| "unknown-implementation-family".into()),
            true,
            packet,
            &mut reviewer,
        )
        .map_err(|error| lifecycle(error.to_string()))?;
    let attempt = harness
        .review_attempt_history()
        .last()
        .ok_or_else(|| lifecycle("submitted review attempt was not retained"))?;
    record.reviewed = attempt.passed;
    let passed = attempt.passed;
    let classified =
        attempt
            .findings
            .iter()
            .fold(BTreeMap::<String, usize>::new(), |mut counts, finding| {
                *counts
                    .entry(format!("{:?}", finding.state).to_lowercase())
                    .or_default() += 1;
                counts
            });
    let after_hooks = lifecycle_hook_audit(
        root,
        changeloop_mcp::HookEvent::AfterReview,
        json!({"schemaVersion":1,"changeId":change,"phase":"review",
            "status":if passed {"passed"} else {"changes-required"},
            "provenance":"trusted-policy",
            "authority":{"lifecycle":false,"permissions":false,"land":false}}),
    );
    write_private_artifact_json(
        root,
        &artifact_root.join("hooks.json"),
        &json!({"schemaVersion":1,"changeId":change,
            "policy":"advisory","before":before_hooks.clone(),"after":after_hooks.clone()}),
    )?;
    save_state(root, &state)?;
    print_json(
        json!({"change":change,"review":if passed {"accepted"} else {"changes_required"},
        "attemptId":attempt_id,"cleanContext":true,"findingClasses":classified,
        "hooks":{"before":before_hooks,"after":after_hooks}}),
    );
    if passed {
        Ok(())
    } else {
        Err(lifecycle(
            "verified review findings require a changed build and fresh proof",
        ))
    }
}

pub(super) fn land(change: &str) -> Result<(), CliFailure> {
    print_json(land_at(&env::current_dir().map_err(io_failure)?, change)?);
    Ok(())
}

fn land_at(root: &Path, change: &str) -> Result<Value, CliFailure> {
    safe_identifier(change)?;
    let mut state = load_state(root)?;
    let record = change_mut(&mut state, change)?;
    ensure_not_landed(record)?;
    let observed_revision = workspace_revision(root)?;
    if observed_revision != record.expected_revision {
        if let Some(harness) = record.convergence.as_mut() {
            harness.workspace_revision_mismatch(&observed_revision);
        }
        record.reviewed = false;
        save_state(root, &state)?;
        return Err(lifecycle(
            "Land rejected: workspace revision does not match change",
        ));
    }
    let harness = record
        .convergence
        .as_mut()
        .ok_or_else(|| lifecycle("Land rejected: proof is incomplete"))?;
    if !record.reviewed || *harness.phase() != LifecyclePhase::ReadyToLand {
        return Err(lifecycle(
            "Land rejected: fresh proof and review are required",
        ));
    }
    // Present the Prove evidence before the projection is applied, so the
    // person landing sees what the suite did and did not exercise rather than a
    // bare success line. This renders; it never gates. The briefing goes to
    // stderr so stdout stays a single JSON document, and is repeated inside
    // that document so a non-interactive caller cannot miss it.
    let prove_evidence = read_prove_evidence(&root.join(".changeloop/receipts"), change);
    eprintln!("{}", prove_evidence.render());
    let operation = OperationId::new();
    let transaction = harness
        .request_land(
            LandAuthority {
                authority_id: format!("cli-explicit-{}", now_ms()),
                actor: "user".into(),
                expected_revision: observed_revision.clone(),
                explicit: true,
            },
            operation.clone(),
        )
        .map_err(|error| lifecycle(error.to_string()))?;
    let transaction_id = transaction.transaction_id.to_string();
    let paths = changed_paths(root)?;
    let sandbox = stage_land_projection(root, change, &transaction_id, &paths)?;
    let now = now_ms();
    let authority = ExternalLandAuthority {
        grant: LandAuthority {
            authority_id: transaction.authority_id.clone(),
            actor: "user".into(),
            expected_revision: observed_revision.clone(),
            explicit: true,
        },
        source: AuthoritySource::User,
        change_id: change.into(),
        transaction_id: transaction_id.clone(),
        granted_at_ms: now,
        expires_at_ms: now.saturating_add(5 * 60 * 1000),
    };
    let journal = prepare_land(
        root,
        &sandbox,
        &root.join(".changeloop"),
        change,
        &transaction_id,
        &observed_revision,
        paths,
        authority,
        now,
    )
    .map_err(|error| lifecycle(error.to_string()))?;
    let applied = apply_land_checked(
        root,
        &journal,
        now_ms(),
        ApplyControl::default(),
        |locked_root| {
            workspace_revision(locked_root).map_err(|error| LandError::RevisionProbe(error.message))
        },
    )
    .map_err(|error| lifecycle(error.to_string()))?;
    let locked_revision = applied.observed_after;
    harness
        .complete_land(
            &transaction.transaction_id,
            true,
            &applied.observed_before,
            &locked_revision,
        )
        .map_err(|error| lifecycle(error.to_string()))?;
    let archive = archive_land(
        root,
        &journal,
        &root.join(".changeloop/archive"),
        harness.review_attempt_history(),
        &UsageLedger::default(),
        now_ms(),
    )
    .map_err(|error| lifecycle(error.to_string()))?;
    record.landed = true;
    record.land_operation = Some(operation.to_string());
    save_state(root, &state)?;
    changeloop_ops::update_privacy_lifecycle(&privacy_path(root), change, false, 1)
        .map_err(super::ops_failure)?;
    Ok(
        json!({"change":change,"landed":true,"revision":locked_revision,
        "transaction":transaction.transaction_id,"archive":archive,"commitPerformed":false,
        "pushPerformed":false,"proveEvidence":prove_evidence.to_json()}),
    )
}

pub(super) fn undo_redo(session: Option<&String>, redo: bool) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    undo_redo_at(&root, session, redo)
}

fn undo_redo_at(root: &Path, session: Option<&String>, redo: bool) -> Result<(), CliFailure> {
    let mut state = load_state(root)?;
    let session = session
        .cloned()
        .or_else(|| state.sessions.keys().next_back().cloned())
        .ok_or_else(|| lifecycle("no session is available"))?;
    safe_identifier(&session)?;
    let directory = root.join(".changeloop/snapshots").join(&session);
    let manifest = directory.join("state.json");
    if !manifest.is_file() {
        return Err(lifecycle(format!(
            "no snapshot history is available for session {session}"
        )));
    }
    let mut snapshots = SnapshotManager::load(root, &directory, &manifest)
        .map_err(|error| lifecycle(error.to_string()))?;
    let outcome = if redo {
        snapshots.redo_and_save(now_ms(), &manifest)
    } else {
        let checkpoint = snapshots
            .latest_applied_id()
            .cloned()
            .ok_or_else(|| lifecycle("no applied checkpoint is available"))?;
        snapshots.undo_and_save(&checkpoint, now_ms(), &manifest)
    }
    .map_err(|error| lifecycle(error.to_string()))?;
    let restored_revision = workspace_revision(root)?;
    if let Some(change) = state
        .changes
        .values_mut()
        .find(|change| change.session_id == session)
    {
        change.proof = None;
        change.reviewed = false;
        change.expected_revision = restored_revision.clone();
        if let Some(harness) = change.convergence.as_mut() {
            harness.workspace_revision_mismatch(restored_revision);
        }
    }
    save_state(root, &state)?;
    print_json(
        json!({"session":session,"operation":if redo {"redo"} else {"undo"},
        "audit":outcome.audit,"proofInvalidated":outcome.invalidated_proof_references}),
    );
    Ok(())
}

fn selected_session(
    state: &OperationalState,
    requested: Option<&String>,
) -> Result<String, CliFailure> {
    let selected = requested
        .cloned()
        .or_else(|| {
            state
                .sessions
                .iter()
                .max_by(|(left_id, left), (right_id, right)| {
                    left.created_at_ms
                        .cmp(&right.created_at_ms)
                        .then_with(|| left_id.cmp(right_id))
                })
                .map(|(id, _)| id.clone())
        })
        .ok_or_else(|| lifecycle("no session is available"))?;
    safe_identifier(&selected)?;
    Ok(selected)
}

fn selected_change(
    state: &OperationalState,
    requested: Option<&String>,
) -> Result<String, CliFailure> {
    let selected = requested
        .cloned()
        .or_else(|| {
            state
                .changes
                .iter()
                .filter(|(_, record)| !record.landed)
                .max_by(|(left_id, _), (right_id, _)| {
                    let left_created = state
                        .sessions
                        .get(*left_id)
                        .map_or(0, |session| session.created_at_ms);
                    let right_created = state
                        .sessions
                        .get(*right_id)
                        .map_or(0, |session| session.created_at_ms);
                    left_created
                        .cmp(&right_created)
                        .then_with(|| left_id.cmp(right_id))
                })
                .map(|(id, _)| id.clone())
        })
        .ok_or_else(|| lifecycle("no active change is available"))?;
    safe_identifier(&selected)?;
    if !state.changes.contains_key(&selected) {
        return Err(invalid(format!("change does not exist: {selected}")));
    }
    Ok(selected)
}

pub(super) fn mcp_auth(name: &str) -> Result<(), CliFailure> {
    safe_identifier(name)?;
    let root = env::current_dir().map_err(io_failure)?;
    let registry = mcp_registry(&root)?;
    let target = registry["servers"][name]["target"]
        .as_str()
        .ok_or_else(|| invalid(format!("MCP server does not exist: {name}")))?;
    let base = Url::parse(target)
        .map_err(|_| invalid("MCP OAuth requires an HTTP(S) server target URL"))?;
    if base.scheme() != "https"
        && !(base.scheme() == "http"
            && base
                .host_str()
                .is_some_and(|host| matches!(host, "127.0.0.1" | "::1" | "localhost")))
    {
        return Err(invalid("MCP OAuth requires HTTPS except on loopback"));
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(io_failure)?;
    listener.set_nonblocking(true).map_err(io_failure)?;
    let callback_port = listener.local_addr().map_err(io_failure)?.port();
    let client = OAuthClient {
        client_id: "changeloop-cli".into(),
        authorization_endpoint: base
            .join("authorize")
            .map_err(|error| invalid(error.to_string()))?,
        token_endpoint: base
            .join("token")
            .map_err(|error| invalid(error.to_string()))?,
        redirect_uri: Url::parse(&format!("http://127.0.0.1:{callback_port}/callback"))
            .expect("loopback callback URL is valid"),
        scopes: vec!["mcp.tools".into()],
    };
    let authorization = client
        .begin_authorization()
        .map_err(|error| invalid(error.to_string()))?;
    let authorization_url = authorization.authorization_url.to_string();
    print_json(json!({"server":name,"authorizationUrl":authorization_url,
        "grant":"authorization_code","pkce":"S256",
        "callback":client.redirect_uri.to_string(),"waiting":true}));
    let code = receive_oauth_callback(&listener, &authorization.state, Duration::from_secs(180))?;
    let token = client
        .exchange_code(
            &authorization,
            &authorization.state,
            &code,
            Duration::from_secs(30),
        )
        .map_err(|error| invalid(error.to_string()))?;
    changeloop_mcp::replace_oauth_token(
        &KeyringOAuthTokenStore::new("changeloop-mcp"),
        name,
        &token,
    )
    .map_err(|error| invalid(error.to_string()))?;
    print_json(
        json!({"server":name,"authenticated":true,"storage":"os-keyring",
        "scope":token.scope,"expiresIn":token.expires_in}),
    );
    Ok(())
}

pub(super) fn mcp_auth_refresh(name: &str) -> Result<(), CliFailure> {
    safe_identifier(name)?;
    let root = env::current_dir().map_err(io_failure)?;
    let client = mcp_oauth_client(
        &root,
        name,
        Url::parse("http://127.0.0.1/callback").unwrap(),
    )?;
    let store = KeyringOAuthTokenStore::new("changeloop-mcp");
    let current = store
        .load(name)
        .map_err(|error| invalid(error.to_string()))?
        .ok_or_else(|| invalid(format!("MCP server is not authenticated: {name}")))?;
    let refresh = current
        .refresh_token
        .as_deref()
        .ok_or_else(|| invalid("OAuth server did not issue a refresh token"))?;
    let mut token = client
        .refresh(refresh, Duration::from_secs(30))
        .map_err(|error| invalid(error.to_string()))?;
    if token.refresh_token.is_none() {
        token.refresh_token.clone_from(&current.refresh_token);
    }
    changeloop_mcp::replace_oauth_token(&store, name, &token)
        .map_err(|error| invalid(error.to_string()))?;
    print_json(json!({"server":name,"refreshed":true,"storage":"os-keyring"}));
    Ok(())
}

pub(super) fn mcp_auth_logout(name: &str) -> Result<(), CliFailure> {
    safe_identifier(name)?;
    let root = env::current_dir().map_err(io_failure)?;
    let client = mcp_oauth_client(
        &root,
        name,
        Url::parse("http://127.0.0.1/callback").unwrap(),
    )?;
    let store = KeyringOAuthTokenStore::new("changeloop-mcp");
    let revocation_result = if let Some(token) = store
        .load(name)
        .map_err(|error| invalid(error.to_string()))?
    {
        let registry = mcp_registry(&root)?;
        let target = registry["servers"][name]["target"]
            .as_str()
            .ok_or_else(|| invalid(format!("MCP server does not exist: {name}")))?;
        let revocation = Url::parse(target)
            .and_then(|base| base.join("revoke"))
            .map_err(|error| invalid(error.to_string()))?;
        client
            .revoke(&revocation, &token.access_token, Duration::from_secs(30))
            .map_err(|error| invalid(error.to_string()))
    } else {
        Ok(())
    };
    // Local logout is authoritative even if the remote endpoint is down. The
    // caller still receives a typed revocation error after local deletion.
    store
        .delete(name)
        .map_err(|error| invalid(error.to_string()))?;
    revocation_result?;
    print_json(json!({"server":name,"authenticated":false,"revoked":true}));
    Ok(())
}

fn mcp_oauth_client(root: &Path, name: &str, redirect_uri: Url) -> Result<OAuthClient, CliFailure> {
    let registry = mcp_registry(root)?;
    let target = registry["servers"][name]["target"]
        .as_str()
        .ok_or_else(|| invalid(format!("MCP server does not exist: {name}")))?;
    let base = Url::parse(target)
        .map_err(|_| invalid("MCP OAuth requires an HTTP(S) server target URL"))?;
    Ok(OAuthClient {
        client_id: "changeloop-cli".into(),
        authorization_endpoint: base
            .join("authorize")
            .map_err(|error| invalid(error.to_string()))?,
        token_endpoint: base
            .join("token")
            .map_err(|error| invalid(error.to_string()))?,
        redirect_uri,
        scopes: vec!["mcp.tools".into()],
    })
}

fn receive_oauth_callback(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, CliFailure> {
    let started = Instant::now();
    loop {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    return Err(invalid("OAuth callback peer was not loopback"));
                }
                // Accepted sockets may inherit O_NONBLOCK on macOS. The
                // callback body is bounded by a read timeout, so normalize it
                // to blocking mode before reading the single HTTP request.
                stream.set_nonblocking(false).map_err(io_failure)?;
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .map_err(io_failure)?;
                let mut buffer = Vec::new();
                loop {
                    let mut chunk = [0_u8; 1024];
                    let count = stream.read(&mut chunk).map_err(io_failure)?;
                    if count == 0 {
                        return Err(invalid("OAuth callback ended before HTTP headers"));
                    }
                    buffer.extend_from_slice(&chunk[..count]);
                    if buffer.len() > 16 * 1024 {
                        return Err(invalid("OAuth callback headers were too large"));
                    }
                    if buffer.windows(4).any(|part| part == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = std::str::from_utf8(&buffer)
                    .map_err(|_| invalid("OAuth callback was not valid HTTP"))?;
                let head = request
                    .split_once("\r\n\r\n")
                    .map(|(head, _)| head)
                    .ok_or_else(|| invalid("OAuth callback request was malformed"))?;
                let mut lines = head.split("\r\n");
                let mut request_line = lines
                    .next()
                    .ok_or_else(|| invalid("OAuth callback request was malformed"))?
                    .split(' ');
                let (method, target, version) = (
                    request_line.next(),
                    request_line.next(),
                    request_line.next(),
                );
                if method != Some("GET")
                    || version != Some("HTTP/1.1")
                    || request_line.next().is_some()
                    || !target.is_some_and(|target| target.starts_with("/callback?"))
                {
                    return Err(invalid("OAuth callback request line was invalid"));
                }
                let mut headers = BTreeMap::new();
                for line in lines {
                    if line.starts_with([' ', '\t']) {
                        return Err(invalid("OAuth callback folded headers are forbidden"));
                    }
                    let (name, value) = line
                        .split_once(':')
                        .ok_or_else(|| invalid("OAuth callback header was malformed"))?;
                    let name = name.to_ascii_lowercase();
                    if headers.insert(name, value.trim()).is_some() {
                        return Err(invalid("OAuth callback duplicate headers are forbidden"));
                    }
                }
                let local = listener.local_addr().map_err(io_failure)?;
                let expected_host = format!("{}:{}", local.ip(), local.port());
                if headers.get("host").copied() != Some(expected_host.as_str()) {
                    return Err(invalid(
                        "OAuth callback Host header did not match the listener",
                    ));
                }
                let target = target.expect("validated above");
                let callback = Url::parse(&format!("http://127.0.0.1{target}"))
                    .map_err(|_| invalid("OAuth callback URL was malformed"))?;
                if callback.path() != "/callback" {
                    return Err(invalid("OAuth callback path was invalid"));
                }
                let mut parameters = BTreeMap::new();
                for (name, value) in callback.query_pairs() {
                    if parameters
                        .insert(name.into_owned(), value.into_owned())
                        .is_some()
                    {
                        return Err(invalid("OAuth callback parameter was duplicated"));
                    }
                }
                if parameters.contains_key("error") {
                    return Err(invalid("OAuth authorization failed at the provider"));
                }
                let state = parameters
                    .get("state")
                    .ok_or_else(|| invalid("OAuth callback omitted state"))?;
                if state != expected_state {
                    return Err(invalid("OAuth callback state did not match"));
                }
                let code = parameters
                    .get("code")
                    .ok_or_else(|| invalid("OAuth callback omitted code"))?;
                if code.is_empty() || code.len() > 4096 || code.chars().any(char::is_control) {
                    return Err(invalid("OAuth callback code was invalid"));
                }
                let response = "HTTP/1.1 200 OK\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: 51\r\nconnection: close\r\n\r\nAuthentication received. You may close this window.\n";
                let _ = stream.write_all(response.as_bytes());
                return Ok(code.clone());
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::Interrupted
                    || error.raw_os_error() == Some(35) =>
            {
                if started.elapsed() >= timeout {
                    return Err(invalid("OAuth callback timed out"));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(io_failure(error)),
        }
    }
}

fn change_mut<'a>(
    state: &'a mut OperationalState,
    change: &str,
) -> Result<&'a mut ChangeRecord, CliFailure> {
    state
        .changes
        .get_mut(change)
        .ok_or_else(|| invalid(format!("change does not exist: {change}")))
}

fn ensure_not_landed(change: &ChangeRecord) -> Result<(), CliFailure> {
    if change.landed {
        Err(lifecycle("change is already landed"))
    } else {
        Ok(())
    }
}

/// Reads the configured proof providers together with the digest of the file
/// that supplied them. The digest is part of every approval derived from this
/// configuration, so editing the file voids the approvals it produced.
fn proof_providers(root: &Path) -> Result<(Vec<ProofProviderConfig>, String), CliFailure> {
    let path = root.join(".changeloop/proof-providers.json");
    let mut digest = changeloop_ops::executor_approval::absent_config_digest();
    let providers = match read_regular_bounded(&path, MAX_OPERATIONAL_CONFIG_BYTES) {
        Ok(bytes) => {
            digest = changeloop_ops::executor_approval::config_digest(&bytes);
            serde_json::from_slice::<Vec<ProofProviderConfig>>(&bytes)
                .map_err(|error| invalid(format!("invalid {}: {error}", path.display())))?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => vec![ProofProviderConfig {
            id: "git-diff-check".into(),
            command: "git".into(),
            args: vec!["diff".into(), "--check".into()],
            claims: default_claims(),
            failure_class: ConfiguredFailureClass::Code,
            repair_command: None,
            repair_args: Vec::new(),
            timeout_ms: default_executor_timeout_ms(),
            builtin_hardened_git: true,
        }],
        Err(error) => return Err(io_failure(error)),
    };
    if providers.is_empty()
        || providers.iter().any(|provider| {
            safe_identifier(&provider.id).is_err()
                || provider.command.is_empty()
                || provider.claims.is_empty()
        })
    {
        return Err(invalid("proof provider configuration is empty or invalid"));
    }
    let unique = providers
        .iter()
        .map(|provider| provider.id.as_str())
        .collect::<BTreeSet<_>>();
    if unique.len() != providers.len() {
        return Err(invalid("proof provider IDs must be unique"));
    }
    Ok((providers, digest))
}

/// Builds the approval request for a configured proof provider, its repair
/// command, or a reviewer. Every field here is inside the approval digest.
#[allow(clippy::too_many_arguments)]
fn executor_request(
    root: &Path,
    kind: changeloop_ops::ExecutorKind,
    label: &str,
    program: &str,
    args: &[String],
    harness_environment_names: &[&str],
    timeout_ms: u64,
    config_digest: &str,
) -> changeloop_ops::ExecutorRequest {
    changeloop_ops::ExecutorRequest {
        root: root.to_path_buf(),
        kind,
        label: label.to_owned(),
        program: program.to_owned(),
        args: args.to_vec(),
        environment: Vec::new(),
        harness_environment_names: harness_environment_names
            .iter()
            .map(|name| (*name).to_owned())
            .collect(),
        timeout_ms,
        max_output_bytes: changeloop_ops::MAX_LIFECYCLE_OUTPUT_BYTES,
        config_digest: config_digest.to_owned(),
    }
}

fn proof_requirements(providers: &[ProofProviderConfig]) -> BTreeSet<ProofRequirement> {
    providers
        .iter()
        .flat_map(|provider| {
            provider.claims.iter().map(|claim| ProofRequirement {
                claim_id: claim.clone(),
                provider: provider.id.clone(),
            })
        })
        .collect()
}

fn prepare_convergence(
    record: &mut ChangeRecord,
    providers: &[ProofProviderConfig],
    revision: &str,
) -> Result<(), CliFailure> {
    if record.convergence.is_none() {
        let mut harness = ConvergenceHarness::new_confirmed(
            &record.session_id,
            &record.session_id,
            revision,
            proof_requirements(providers),
            record.risk_triggers.clone(),
            RepairBudget::default(),
        )
        .map_err(|error| lifecycle(error.to_string()))?;
        harness
            .complete_build(revision)
            .map_err(|error| lifecycle(error.to_string()))?;
        record.expected_revision = revision.into();
        record.convergence = Some(harness);
        return Ok(());
    }

    let harness = record
        .convergence
        .as_mut()
        .ok_or_else(|| lifecycle("convergence state disappeared after initialization"))?;
    match harness.phase().clone() {
        LifecyclePhase::Build => {
            harness
                .complete_build(revision)
                .map_err(|error| lifecycle(error.to_string()))?;
        }
        LifecyclePhase::Repair => {
            let operation = harness
                .repair_history()
                .iter()
                .rev()
                .find(|operation| operation.status == RepairStatus::Running)
                .cloned()
                .ok_or_else(|| lifecycle("repair phase has no running operation"))?;
            let effect = harness
                .complete_repair(
                    &operation.operation_id,
                    revision,
                    BTreeSet::from([operation.failed_provider]),
                    revision,
                )
                .map_err(|error| lifecycle(error.to_string()))?;
            reject_paused_repair(effect)?;
        }
        LifecyclePhase::Diagnosis => {
            let failure = harness
                .failure_history()
                .last()
                .cloned()
                .ok_or_else(|| lifecycle("diagnosis phase has no failure"))?;
            let operation_id = OperationId::new();
            harness
                .complete_diagnosis(&failure.cause_id, operation_id.clone())
                .map_err(|error| lifecycle(error.to_string()))?;
            let effect = harness
                .complete_repair(
                    &operation_id,
                    revision,
                    BTreeSet::from([failure.provider]),
                    revision,
                )
                .map_err(|error| lifecycle(error.to_string()))?;
            reject_paused_repair(effect)?;
        }
        LifecyclePhase::Change => {
            harness
                .confirm_changed_requirements()
                .map_err(|error| lifecycle(error.to_string()))?;
            let all = providers
                .iter()
                .map(|provider| provider.id.clone())
                .collect();
            harness
                .complete_changed_build(revision, &all)
                .map_err(|error| lifecycle(error.to_string()))?;
        }
        LifecyclePhase::Prove | LifecyclePhase::Review | LifecyclePhase::ReadyToLand
            if revision == record.expected_revision => {}
        LifecyclePhase::Prove | LifecyclePhase::Review | LifecyclePhase::ReadyToLand => {
            let all = providers
                .iter()
                .map(|provider| provider.id.clone())
                .collect::<BTreeSet<_>>();
            harness
                .requirements_changed(revision, proof_requirements(providers), &all)
                .map_err(|error| lifecycle(error.to_string()))?;
            harness
                .confirm_changed_requirements()
                .map_err(|error| lifecycle(error.to_string()))?;
            harness
                .complete_changed_build(revision, &all)
                .map_err(|error| lifecycle(error.to_string()))?;
        }
        LifecyclePhase::Paused(reason) => {
            return Err(lifecycle(format!("proof is paused: {reason:?}")));
        }
        LifecyclePhase::Landing | LifecyclePhase::Landed => {
            return Err(lifecycle("proof cannot run during or after Land"));
        }
    }
    record.expected_revision = revision.into();
    Ok(())
}

fn reject_paused_repair(effect: TransitionEffect) -> Result<(), CliFailure> {
    match effect {
        TransitionEffect::DoomLoopPermissionRequired => {
            Err(lifecycle("doom_loop permission is required"))
        }
        TransitionEffect::RepairBudgetExhausted => Err(lifecycle("repair budget is exhausted")),
        _ => Ok(()),
    }
}

fn record_failure(
    record: &mut ChangeRecord,
    failure: ProofFailure,
) -> Result<TransitionEffect, CliFailure> {
    let harness = record
        .convergence
        .as_mut()
        .ok_or_else(|| lifecycle("proof failure has no convergence state"))?;
    let effect = harness
        .record_failure(failure, Some(OperationId::new()))
        .map_err(|error| lifecycle(error.to_string()))?;
    if matches!(effect, TransitionEffect::DoomLoopPermissionRequired) {
        return Err(lifecycle("doom_loop permission is required"));
    }
    Ok(effect)
}

fn apply_configured_repair(
    root: &Path,
    record: &mut ChangeRecord,
    provider: &ProofProviderConfig,
    repair: &changeloop_ops::ApprovedExecutor,
    failure: &ProofFailure,
    mut effect: TransitionEffect,
) -> Result<(), CliFailure> {
    let harness = record
        .convergence
        .as_mut()
        .ok_or_else(|| lifecycle("repair has no convergence state"))?;
    if let TransitionEffect::FocusedDiagnosisRequired { cause_id } = effect {
        // Focused diagnosis is explicit and deterministic here: the same typed
        // cause was reproduced twice. The repair process receives it in the
        // environment and remains bounded by the harness operation budget.
        effect = harness
            .complete_diagnosis(&cause_id, OperationId::new())
            .map_err(|error| lifecycle(error.to_string()))?;
    }
    let TransitionEffect::RepairStarted { operation_id } = effect else {
        return Err(lifecycle(format!(
            "repair cannot run after lifecycle effect {effect:?}"
        )));
    };
    let output = run_approved_command(
        repair,
        root,
        None,
        &[
            ("CHANGELOOP_FAILED_PROVIDER", failure.provider.as_str()),
            ("CHANGELOOP_FAILURE_CAUSE", failure.cause_id.as_str()),
        ],
    )
    .map_err(|error| CliFailure {
        code: EXIT_PROOF_FAILURE,
        message: format!("repair executor for '{}' failed: {error}", provider.id),
    })?;
    if !output.status.success() {
        return Err(CliFailure {
            code: EXIT_PROOF_FAILURE,
            message: format!(
                "repair executor for '{}' failed: {}",
                provider.id,
                proof_output_summary(&output)
            ),
        });
    }
    let revision = workspace_revision(root)?;
    let mut fingerprint = Sha256::new();
    fingerprint.update(revision.as_bytes());
    fingerprint.update(&output.stdout);
    fingerprint.update(&output.stderr);
    let completed = harness
        .complete_repair(
            &operation_id,
            &revision,
            BTreeSet::from([provider.id.clone()]),
            format!("sha256:{:x}", fingerprint.finalize()),
        )
        .map_err(|error| lifecycle(error.to_string()))?;
    reject_paused_repair(completed)?;
    record.expected_revision = revision;
    Ok(())
}

#[derive(Debug)]
pub(crate) struct BoundedOutput {
    pub(crate) status: std::process::ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
    pub(crate) truncated: bool,
}

/// Runs an executable this binary compiled in. The register entry names why no
/// operator approval is required: nothing about the program or its arguments
/// came from repository content.
pub(crate) fn run_compiled_in_command(
    register: changeloop_ops::CompiledInExecutor,
    root: &Path,
    command: &str,
    args: &[String],
    environment: &[(&str, &str)],
    stdin: Option<Vec<u8>>,
    timeout_ms: u64,
) -> Result<BoundedOutput, String> {
    let approved = changeloop_ops::ApprovedExecutor::compiled_in(
        register,
        command,
        args.to_vec(),
        timeout_ms,
        changeloop_ops::MAX_LIFECYCLE_OUTPUT_BYTES,
    )
    .with_compiled_in_environment(
        environment
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect(),
    );
    run_approved_command(&approved, root, stdin, &[])
}

/// Runs an executable the operator approved for this project. Everything but
/// the working directory, stdin, and harness-derived environment values comes
/// from the approval.
pub(crate) fn run_approved_command(
    approved: &changeloop_ops::ApprovedExecutor,
    working_directory: &Path,
    stdin: Option<Vec<u8>>,
    harness_environment: &[(&str, &str)],
) -> Result<BoundedOutput, String> {
    let output = changeloop_ops::run_approved_lifecycle_process_cancellable(
        approved,
        working_directory,
        stdin,
        harness_environment,
        &|| false,
    )?;
    Ok(BoundedOutput {
        status: output.status,
        stdout: output.stdout,
        stderr: output.stderr,
        truncated: output.truncated,
    })
}

/// The trusted approval store path, in the operator's configuration directory.
/// Never inside the repository — a store the repository can write is not a
/// gate.
pub(crate) fn approval_store_path() -> Result<PathBuf, CliFailure> {
    #[cfg(test)]
    if let Some(path) = tests::approval_store_override() {
        return Ok(path);
    }
    Ok(changeloop_ops::ApprovalStore::path_in(
        &super::user_config_directory()?,
    ))
}

/// Re-derives every lifecycle executable the repository currently configures.
/// Both `approve grant` and the refusal message come from this one derivation,
/// so what an operator is shown is what will run.
pub(crate) fn configured_executors(
    root: &Path,
) -> Result<Vec<changeloop_ops::ExecutorRequest>, CliFailure> {
    let mut requests = Vec::new();
    let (providers, providers_digest) = proof_providers(root)?;
    for provider in &providers {
        if !provider.builtin_hardened_git {
            requests.push(executor_request(
                root,
                changeloop_ops::ExecutorKind::ProofProvider,
                &provider.id,
                &provider.command,
                &provider.args,
                &[],
                provider.timeout_ms,
                &providers_digest,
            ));
        }
        if let Some(command) = provider.repair_command.as_deref() {
            requests.push(executor_request(
                root,
                changeloop_ops::ExecutorKind::RepairCommand,
                &provider.id,
                command,
                &provider.repair_args,
                &REPAIR_HARNESS_ENVIRONMENT,
                provider.timeout_ms,
                &providers_digest,
            ));
        }
    }
    if let Ok((reviewer, digest)) = reviewer_config(root) {
        requests.push(executor_request(
            root,
            changeloop_ops::ExecutorKind::Reviewer,
            "reviewer",
            &reviewer.command,
            &reviewer.args,
            &[],
            reviewer.timeout_ms,
            &digest,
        ));
    }
    requests.extend(prove_oracle::configured_baseline_executor(root));
    Ok(requests)
}

pub(super) fn approve_list() -> Result<(), CliFailure> {
    let store = changeloop_ops::ApprovalStore::load(&approval_store_path()?)
        .map_err(|error| invalid(error.to_string()))?;
    print_json(json!({
        "version": changeloop_ops::executor_approval::APPROVAL_STORE_VERSION,
        "approvals": store.approvals(),
    }));
    Ok(())
}

pub(super) fn approve_revoke(digest: &str) -> Result<(), CliFailure> {
    let path = approval_store_path()?;
    let mut store =
        changeloop_ops::ApprovalStore::load(&path).map_err(|error| invalid(error.to_string()))?;
    let removed = store
        .revoke(digest)
        .map_err(|error| invalid(error.to_string()))?;
    print_json(json!({"digest": digest, "revoked": removed}));
    Ok(())
}

/// Grants approvals for the executables the repository configures *right now*.
///
/// There is no digest parameter: a repository must not be able to print a
/// convincing grant string for content it does not have. Everything recorded
/// here was re-read from disk in this call and is displayed before it is
/// written.
pub(super) fn approve_grant(
    kind: Option<&str>,
    label: Option<&str>,
    reviewer_family: Option<&str>,
    confirmed: bool,
) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let selected_kind = match kind {
        None => None,
        Some("proof-provider") => Some(changeloop_ops::ExecutorKind::ProofProvider),
        Some("repair-command") => Some(changeloop_ops::ExecutorKind::RepairCommand),
        Some("reviewer") => Some(changeloop_ops::ExecutorKind::Reviewer),
        Some("oracle-baseline") => Some(changeloop_ops::ExecutorKind::OracleBaseline),
        Some(other) => {
            return Err(invalid(format!("unknown executor kind '{other}'")));
        }
    };
    let requests = configured_executors(&root)?
        .into_iter()
        .filter(|request| selected_kind.is_none_or(|kind| request.kind == kind))
        .filter(|request| label.is_none_or(|label| request.label == label))
        .collect::<Vec<_>>();
    if requests.is_empty() {
        return Err(invalid(
            "this project configures no lifecycle executable matching that selection",
        ));
    }

    let mut resolved = Vec::new();
    for request in &requests {
        resolved.push(
            changeloop_ops::executor_approval::resolve(request)
                .map_err(|error| invalid(error.to_string()))?,
        );
    }
    let pending = resolved
        .iter()
        .map(|entry| {
            json!({
                "kind": entry.request.kind,
                "label": entry.request.label,
                "program": entry.resolved_program.display().to_string(),
                "programDigest": entry.program_digest,
                "args": entry.request.args,
                "harnessEnvironment": entry.request.harness_environment_names,
                "timeoutMs": entry.request.timeout_ms,
                "maxOutputBytes": entry.request.max_output_bytes,
                "configDigest": entry.request.config_digest,
                "digest": entry.digest,
            })
        })
        .collect::<Vec<_>>();
    if !confirmed {
        print_json(json!({
            "status": "confirmation-required",
            "root": root.display().to_string(),
            "pending": pending,
            "next": "re-run with --yes to record these approvals",
        }));
        return Err(CliFailure {
            code: super::EXIT_APPROVAL_REQUIRED,
            message: "review the executables above, then re-run with --yes".into(),
        });
    }
    if resolved
        .iter()
        .any(|entry| entry.request.kind == changeloop_ops::ExecutorKind::Reviewer)
        && reviewer_family.is_none_or(|family| family.trim().is_empty())
    {
        return Err(invalid(
            "granting a reviewer approval requires --reviewer-family; the independence gate reads it instead of the reviewer's own output",
        ));
    }

    let path = approval_store_path()?;
    let mut store =
        changeloop_ops::ApprovalStore::load(&path).map_err(|error| invalid(error.to_string()))?;
    for entry in &resolved {
        let family = if entry.request.kind == changeloop_ops::ExecutorKind::Reviewer {
            reviewer_family.map(str::to_owned)
        } else {
            None
        };
        store
            .grant(entry, changeloop_ops::ApprovalProvenance::User, family)
            .map_err(|error| invalid(error.to_string()))?;
    }
    print_json(json!({
        "status": "granted",
        "root": root.display().to_string(),
        "store": path.display().to_string(),
        "granted": pending,
    }));
    Ok(())
}

/// Turns a repository-configured executable into authority, or refuses with the
/// approval-required exit code and the exact grant command.
pub(crate) fn authorize_configured_executor(
    request: &changeloop_ops::ExecutorRequest,
) -> Result<changeloop_ops::ApprovedExecutor, CliFailure> {
    let store = approval_store_path()?;
    changeloop_ops::executor_approval::authorize(&store, request).map_err(|error| match error {
        changeloop_ops::ApprovalError::Required(resolved) => CliFailure {
            code: super::EXIT_APPROVAL_REQUIRED,
            message: format!(
                "'{}' is not approved to run for this project.\n  {} {}\n  {} sha256 {}\n  approve with: cloop approve grant {} {}",
                resolved.request.label,
                resolved.resolved_program.display(),
                resolved.request.args.join(" "),
                resolved.request.kind,
                resolved.program_digest,
                resolved.request.kind,
                resolved.request.label,
            ),
        },
        other => CliFailure {
            code: EXIT_INVALID_INPUT,
            message: other.to_string(),
        },
    })
}

/// Run Git for trusted built-in read-only operations without inheriting
/// executable repository hooks or user/system configuration. Diff drivers are
/// disabled separately because attributes and config can otherwise turn a
/// read-only diff into arbitrary process execution.
pub(crate) fn run_hardened_git(
    root: &Path,
    args: &[String],
    timeout_ms: u64,
) -> Result<BoundedOutput, String> {
    run_hardened_git_with_environment(root, args, timeout_ms, &[])
}

fn run_hardened_git_with_environment(
    root: &Path,
    args: &[String],
    timeout_ms: u64,
    initial_environment: &[(&str, &str)],
) -> Result<BoundedOutput, String> {
    let mut hardened = vec![
        "-c".to_owned(),
        "core.hooksPath=/dev/null".to_owned(),
        "-c".to_owned(),
        "core.fsmonitor=false".to_owned(),
        "-c".to_owned(),
        "core.untrackedCache=false".to_owned(),
    ];
    for (index, arg) in args.iter().enumerate() {
        hardened.push(arg.clone());
        if index == 0 && arg == "diff" {
            hardened.push("--no-ext-diff".to_owned());
            hardened.push("--no-textconv".to_owned());
        }
    }
    let mut environment = initial_environment.to_vec();
    // Append security values last so even an accidentally supplied conflicting
    // environment cannot override the fail-closed Git policy.
    environment.extend_from_slice(&[
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_CONFIG_NOSYSTEM", "1"),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_PAGER", "cat"),
    ]);
    run_compiled_in_command(
        changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
        root,
        "git",
        &hardened,
        &environment,
        None,
        timeout_ms,
    )
}

fn proof_output_summary(output: &BoundedOutput) -> String {
    let bytes = if output.stderr.is_empty() {
        &output.stdout
    } else {
        &output.stderr
    };
    let summary = String::from_utf8_lossy(bytes).trim().to_owned();
    if summary.is_empty() {
        format!("exit status {}", output.status)
    } else {
        let mut summary = summary.chars().take(4096).collect::<String>();
        if output.truncated {
            summary.push_str(" [output truncated]");
        }
        summary
    }
}

fn review_diff(root: &Path) -> Result<Vec<u8>, CliFailure> {
    let tracked = run_hardened_git(
        root,
        &[
            "diff".into(),
            "--binary".into(),
            "--".into(),
            ".".into(),
            ":(exclude).changeloop".into(),
        ],
        30_000,
    )
    .map_err(lifecycle)?;
    if !tracked.status.success() || tracked.truncated {
        return Err(lifecycle(
            "independent review diff failed or exceeded the bounded output limit",
        ));
    }
    let untracked = run_hardened_git(
        root,
        &[
            "ls-files".into(),
            "--others".into(),
            "--exclude-standard".into(),
            "-z".into(),
            "--".into(),
            ".".into(),
            ":(exclude).changeloop".into(),
        ],
        30_000,
    )
    .map_err(lifecycle)?;
    if !untracked.status.success() || untracked.truncated {
        return Err(lifecycle(
            "independent review could not enumerate untracked files",
        ));
    }
    let mut combined = tracked.stdout;
    for raw_path in untracked
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
    {
        let path = String::from_utf8(raw_path.to_vec()).map_err(|_| {
            lifecycle("independent review cannot represent a non-UTF-8 untracked path")
        })?;
        let addition = run_hardened_git(
            root,
            &[
                "diff".into(),
                "--binary".into(),
                "--no-index".into(),
                "--".into(),
                "/dev/null".into(),
                path,
            ],
            30_000,
        )
        .map_err(lifecycle)?;
        if addition.status.code() != Some(1) || addition.truncated {
            return Err(lifecycle(
                "independent review could not capture an untracked file",
            ));
        }
        if combined.len().saturating_add(addition.stdout.len())
            > MAX_OPERATIONAL_ARTIFACT_BYTES as usize
        {
            return Err(lifecycle(
                "independent review diff exceeded the bounded output limit",
            ));
        }
        combined.extend_from_slice(&addition.stdout);
    }
    Ok(combined)
}

fn reviewer_config(root: &Path) -> Result<(ReviewerConfig, String), CliFailure> {
    let path = root.join(".changeloop/reviewer.json");
    let bytes = read_regular_bounded(&path, MAX_OPERATIONAL_CONFIG_BYTES).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            lifecycle(format!(
                "independent review is blocked: attach a clean reviewer in {}",
                path.display()
            ))
        } else {
            io_failure(error)
        }
    })?;
    let config: ReviewerConfig = serde_json::from_slice(&bytes)
        .map_err(|error| invalid(format!("invalid {}: {error}", path.display())))?;
    if config.command.trim().is_empty() {
        return Err(invalid("reviewer command must not be empty"));
    }
    let digest = changeloop_ops::executor_approval::config_digest(&bytes);
    Ok((config, digest))
}

/// Authorizes the configured reviewer. The model family the independence gate
/// tests comes back on the approval, not from the reviewer's own output.
fn approved_reviewer(root: &Path) -> Result<changeloop_ops::ApprovedExecutor, CliFailure> {
    let (config, digest) = reviewer_config(root)?;
    let approved = authorize_configured_executor(&executor_request(
        root,
        changeloop_ops::ExecutorKind::Reviewer,
        "reviewer",
        &config.command,
        &config.args,
        &[],
        config.timeout_ms,
        &digest,
    ))?;
    if approved.reviewer_model_family().is_none() {
        return Err(lifecycle(
            "the reviewer approval records no model family; re-grant it with one",
        ));
    }
    Ok(approved)
}

struct CommandReviewer {
    approved: changeloop_ops::ApprovedExecutor,
    root: PathBuf,
}

impl IndependentReviewer for CommandReviewer {
    fn review(&mut self, request: &CleanReviewRequest) -> Result<CleanReviewResult, String> {
        let clean = tempfile::tempdir().map_err(|error| error.to_string())?;
        let copy_artifact = |source: &str, name: &str| -> Result<String, String> {
            let source = PathBuf::from(source);
            let root = fs::canonicalize(&self.root).map_err(|error| error.to_string())?;
            let parent = source
                .parent()
                .ok_or_else(|| format!("clean review artifact has no parent: {name}"))?;
            let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
            if !canonical_parent.starts_with(&root) {
                return Err(format!(
                    "clean review artifact escapes project scope: {name}"
                ));
            }
            let destination = clean.path().join(name);
            copy_regular_nofollow_bounded(
                &self.root,
                &source,
                &destination,
                MAX_OPERATIONAL_ARTIFACT_BYTES,
            )
            .map_err(|error| error.to_string())?;
            Ok(name.to_owned())
        };
        let clean_request = CleanReviewRequest {
            reviewer_session_id: request.reviewer_session_id.clone(),
            implementation_session_id: request.implementation_session_id.clone(),
            diff_artifact: copy_artifact(&request.diff_artifact, "diff.patch")?,
            agreement_artifact: copy_artifact(&request.agreement_artifact, "agreement.json")?,
            evidence_artifacts: request
                .evidence_artifacts
                .iter()
                .enumerate()
                .map(|(index, artifact)| copy_artifact(artifact, &format!("evidence-{index}.json")))
                .collect::<Result<Vec<_>, _>>()?,
            residual_risks: request.residual_risks.clone(),
            risk_triggers: request.risk_triggers.clone(),
        };
        let input = serde_json::to_vec(&clean_request).map_err(|error| error.to_string())?;
        let output = run_approved_command(&self.approved, clean.path(), Some(input), &[])?;
        if !output.status.success() {
            return Err(format!(
                "reviewer process failed: {}",
                proof_output_summary(&output)
            ));
        }
        if output.truncated {
            return Err("reviewer output exceeded the 1 MiB limit".into());
        }
        let mut result: CleanReviewResult = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("reviewer returned invalid typed findings: {error}"))?;
        // The independence gate must not read its input from the process it is
        // gating. The family is whatever the operator recorded when approving
        // this reviewer; a process claiming a different one is in breach of the
        // contract it was approved under, not merely mistaken.
        let approved_family = self
            .approved
            .reviewer_model_family()
            .ok_or("the reviewer approval records no model family")?;
        if !result.reviewer_model_family.is_empty()
            && result.reviewer_model_family != approved_family
        {
            return Err(format!(
                "reviewer reported model family '{}' but was approved as '{approved_family}'",
                redact_sensitive_text(&result.reviewer_model_family)
            ));
        }
        result.reviewer_model_family = approved_family.to_owned();
        Ok(result)
    }
}

fn record_phase(record: Option<&ChangeRecord>) -> Value {
    record
        .and_then(|record| record.convergence.as_ref())
        .map(|harness| json!(harness.phase()))
        .unwrap_or(Value::Null)
}

fn changed_paths(root: &Path) -> Result<Vec<PathBuf>, CliFailure> {
    let tracked = run_compiled_in_command(
        changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
        root,
        "git",
        &[
            "diff".into(),
            "--name-only".into(),
            "-z".into(),
            "HEAD".into(),
            "--".into(),
            ".".into(),
        ],
        &[],
        None,
        30_000,
    )
    .map_err(lifecycle)?;
    let untracked = run_compiled_in_command(
        changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
        root,
        "git",
        &[
            "ls-files".into(),
            "--others".into(),
            "--exclude-standard".into(),
            "-z".into(),
            "--".into(),
            ".".into(),
        ],
        &[],
        None,
        30_000,
    )
    .map_err(lifecycle)?;
    if !tracked.status.success()
        || !untracked.status.success()
        || tracked.truncated
        || untracked.truncated
    {
        return Err(lifecycle("could not enumerate Land projection"));
    }
    let mut paths = tracked
        .stdout
        .split(|byte| *byte == 0)
        .chain(untracked.stdout.split(|byte| *byte == 0))
        .filter(|bytes| !bytes.is_empty())
        .map(|bytes| PathBuf::from(String::from_utf8_lossy(bytes).into_owned()))
        .filter(|path| !path.starts_with(".changeloop"))
        .collect::<BTreeSet<_>>();
    paths.retain(|path| !path.as_os_str().is_empty());
    if paths.is_empty() {
        return Err(lifecycle("Land rejected: change has no file projection"));
    }
    Ok(paths.into_iter().collect())
}

fn stage_land_projection(
    root: &Path,
    change: &str,
    transaction: &str,
    paths: &[PathBuf],
) -> Result<PathBuf, CliFailure> {
    let sandbox = root
        .join(".changeloop/land-sandboxes")
        .join(change)
        .join(transaction);
    create_private_operational_directory(root, &sandbox).map_err(io_failure)?;
    for path in paths {
        if path.is_absolute()
            || path
                .components()
                .any(|component| !matches!(component, std::path::Component::Normal(_)))
        {
            return Err(lifecycle(format!(
                "unsafe Land projection path: {}",
                path.display()
            )));
        }
        let source = root.join(path);
        match fs::symlink_metadata(&source) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                let destination = sandbox.join(path);
                if let Some(parent) = destination.parent() {
                    create_private_operational_directory(root, parent).map_err(io_failure)?;
                }
                copy_regular_nofollow_bounded(
                    root,
                    &source,
                    &destination,
                    MAX_LAND_PROJECTION_FILE_BYTES,
                )
                .map_err(io_failure)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => {
                // The changeloop-land identity/apply contract accepts regular
                // single-link files or Missing only. Never dereference or
                // reinterpret a repository symlink as projection content.
                return Err(lifecycle(format!(
                    "unsupported Land path: {}",
                    path.display()
                )));
            }
            Err(error) => return Err(io_failure(error)),
        }
    }
    Ok(sandbox)
}

fn record_authenticator() -> Result<changeloop_evidence::authenticated_record::RecordAuthenticator, CliFailure> {
    let store = approval_store_path()?;
    let directory = store
        .parent()
        .ok_or_else(|| invalid("operator configuration path has no parent"))?;
    Ok(changeloop_evidence::authenticated_record::RecordAuthenticator::new(directory))
}

fn bounded_binding_digest(path: &Path, limit: u64) -> Result<String, CliFailure> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(changeloop_ops::executor_approval::absent_config_digest());
        }
        Err(error) => return Err(io_failure(error)),
    };
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(invalid(format!(
            "lifecycle authority binding is not a bounded regular file: {}",
            path.display()
        )));
    }
    let bytes = fs::read(path).map_err(io_failure)?;
    Ok(changeloop_ops::executor_approval::config_digest(&bytes))
}

/// Everything outside the Git/workspace revision that can change what Prove or
/// Review means. The MAC authenticates these bindings as well as the state
/// bytes, so editing repository config or revoking an executable approval
/// invalidates readiness even though `.changeloop` is excluded from the
/// workspace hash.
fn lifecycle_authority_bindings(root: &Path) -> Result<BTreeMap<String, String>, CliFailure> {
    Ok(BTreeMap::from([
        (
            "proof-providers".into(),
            bounded_binding_digest(
                &root.join(".changeloop/proof-providers.json"),
                MAX_OPERATIONAL_CONFIG_BYTES,
            )?,
        ),
        (
            "reviewer".into(),
            bounded_binding_digest(
                &root.join(".changeloop/reviewer.json"),
                MAX_OPERATIONAL_CONFIG_BYTES,
            )?,
        ),
        (
            "prove-oracle".into(),
            bounded_binding_digest(
                &root.join(".changeloop/prove-oracle.json"),
                MAX_OPERATIONAL_CONFIG_BYTES,
            )?,
        ),
        (
            "executor-approvals".into(),
            bounded_binding_digest(&approval_store_path()?, 4 * 1024 * 1024)?,
        ),
    ]))
}

/// Clears every field that could advance or suppress lifecycle authority while
/// preserving session and change intent. This is how legacy unsigned state,
/// a tampered payload, or a lost operator key degrades: history remains
/// inspectable, but Prove and Review must run again before Land.
fn clear_unauthenticated_authority(state: &mut OperationalState) {
    for change in state.changes.values_mut() {
        change.proof = None;
        change.reviewed = false;
        change.land_operation = None;
        change.convergence = None;
    }
}

fn load_state(root: &Path) -> Result<OperationalState, CliFailure> {
    let path = root.join(".changeloop/operational.json");
    match read_regular_bounded(&path, MAX_OPERATIONAL_STATE_BYTES) {
        Ok(bytes) => {
            let mut state: OperationalState =
                serde_json::from_slice(&bytes).map_err(|error| invalid(error.to_string()))?;
            // Validate shape before deciding whether the state carries
            // authority. A malformed convergence record remains an error rather
            // than being hidden by the conservative authority-clearing migration.
            for (change_id, change) in &state.changes {
                if let Some(harness) = &change.convergence {
                    harness.validate_restored().map_err(|error| {
                        invalid(format!(
                            "invalid restored convergence state for {change_id}: {error}"
                        ))
                    })?;
                }
            }
            let authenticated = record_authenticator().is_ok_and(|authenticator| {
                authenticator
                    .load_sidecar(&path)
                    .and_then(|sidecar| {
                        if lifecycle_authority_bindings(root)
                            .map_or(true, |bindings| bindings != sidecar.bindings)
                        {
                            return Err(
                                changeloop_evidence::authenticated_record::RecordAuthError::Invalid,
                            );
                        }
                        authenticator.verify(
                            root,
                            "operational-state",
                            "operational",
                            &bytes,
                            &sidecar,
                        )
                    })
                    .is_ok()
            });
            if !authenticated {
                clear_unauthenticated_authority(&mut state);
            }
            Ok(state)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(OperationalState::default())
        }
        Err(error) => Err(io_failure(error)),
    }
}

pub(crate) fn read_regular_bounded(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let path_metadata = fs::symlink_metadata(path)?;
    if path_metadata.file_type().is_symlink() || !path_metadata.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} must be a regular non-symlink file", path.display()),
        ));
    }
    if path_metadata.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} exceeds the safe {limit}-byte limit", path.display()),
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1
            || metadata.dev() != path_metadata.dev()
            || metadata.ino() != path_metadata.ino()
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} changed identity or is hardlinked", path.display()),
            ));
        }
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

pub(crate) fn create_private_operational_directory(
    root: &Path,
    directory: &Path,
) -> std::io::Result<()> {
    let root_metadata = fs::symlink_metadata(root)?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} must be a real project directory", root.display()),
        ));
    }
    let canonical_root = fs::canonicalize(root)?;
    let relative = directory.strip_prefix(root).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{} is outside project root", directory.display()),
        )
    })?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(component) = component else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "private directory path is not normalized",
            ));
        };
        current.push(component);
        let created = match fs::create_dir(&current) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
            Err(error) => return Err(error),
        };
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} is not a private directory", current.display()),
            ));
        }
        if !fs::canonicalize(&current)?.starts_with(&canonical_root) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} escapes project root", current.display()),
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = metadata.permissions().mode();
            if !created && mode & 0o700 != 0o700 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!(
                        "{} does not grant existing owner read/write/traverse authority",
                        current.display()
                    ),
                ));
            }
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&current, permissions)?;
        }
    }
    Ok(())
}

fn write_private_bytes(root: &Path, path: &Path, bytes: &[u8], limit: u64) -> std::io::Result<()> {
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} exceeds the safe {limit}-byte limit", path.display()),
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "private file has no parent",
        )
    })?;
    create_private_operational_directory(root, parent)?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    let canonical_parent = fs::canonicalize(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} is not a replaceable private file", path.display()),
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("{} is hardlinked", path.display()),
                ));
            }
        }
    }
    let temporary = parent.join(format!(".{}.tmp", OperationId::new()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_CLOEXEC);
    }
    let mut file = options.open(&temporary)?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(file);
    verify_directory_identity(parent, &parent_metadata, &canonical_parent)?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    verify_directory_identity(parent, &parent_metadata, &canonical_parent)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

fn verify_directory_identity(
    directory: &Path,
    expected: &fs::Metadata,
    canonical: &Path,
) -> std::io::Result<()> {
    let current = fs::symlink_metadata(directory)?;
    if current.file_type().is_symlink()
        || !current.is_dir()
        || fs::canonicalize(directory)? != canonical
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} changed identity", directory.display()),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if current.dev() != expected.dev() || current.ino() != expected.ino() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} changed identity", directory.display()),
            ));
        }
    }
    Ok(())
}

fn copy_regular_nofollow_bounded(
    source_scope: &Path,
    source: &Path,
    destination: &Path,
    limit: u64,
) -> std::io::Result<()> {
    let scope_metadata = fs::symlink_metadata(source_scope)?;
    if scope_metadata.file_type().is_symlink() || !scope_metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} must be a real source scope", source_scope.display()),
        ));
    }
    let canonical_scope = fs::canonicalize(source_scope)?;
    let source_parent = source.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "copy source has no parent",
        )
    })?;
    let source_parent_metadata = fs::symlink_metadata(source_parent)?;
    let canonical_source_parent = fs::canonicalize(source_parent)?;
    if source_parent_metadata.file_type().is_symlink()
        || !source_parent_metadata.is_dir()
        || !canonical_source_parent.starts_with(&canonical_scope)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} escapes the source scope", source.display()),
        ));
    }
    let source_path_metadata = fs::symlink_metadata(source)?;
    if source_path_metadata.file_type().is_symlink()
        || !source_path_metadata.is_file()
        || source_path_metadata.len() > limit
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} must be a bounded regular file", source.display()),
        ));
    }
    let mut source_options = fs::OpenOptions::new();
    source_options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        source_options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let mut source_file = source_options.open(source)?;
    let source_metadata = source_file.metadata()?;
    if !source_metadata.is_file() || source_metadata.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{} changed or exceeds the safe copy limit",
                source.display()
            ),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if source_metadata.nlink() != 1
            || source_metadata.dev() != source_path_metadata.dev()
            || source_metadata.ino() != source_path_metadata.ino()
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} changed identity or is hardlinked", source.display()),
            ));
        }
    }
    let parent = destination.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "copy destination has no parent",
        )
    })?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    let canonical_parent = fs::canonicalize(parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} is not a safe copy directory", parent.display()),
        ));
    }
    let mut destination_options = fs::OpenOptions::new();
    destination_options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let executable = source_metadata.permissions().mode() & 0o111 != 0;
        destination_options
            .mode(if executable { 0o700 } else { 0o600 })
            .custom_flags(libc::O_CLOEXEC);
    }
    let mut destination_file = destination_options.open(destination)?;
    let copied = match std::io::copy(
        &mut std::io::Read::by_ref(&mut source_file).take(limit.saturating_add(1)),
        &mut destination_file,
    ) {
        Ok(copied) if copied <= limit => copied,
        Ok(_) => {
            drop(destination_file);
            let _ = fs::remove_file(destination);
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "{} exceeds the safe {limit}-byte copy limit",
                    source.display()
                ),
            ));
        }
        Err(error) => {
            drop(destination_file);
            let _ = fs::remove_file(destination);
            return Err(error);
        }
    };
    if copied != source_metadata.len() {
        drop(destination_file);
        let _ = fs::remove_file(destination);
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} changed length during copy", source.display()),
        ));
    }
    destination_file.sync_all()?;
    let final_source = fs::symlink_metadata(source)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if final_source.dev() != source_metadata.dev()
            || final_source.ino() != source_metadata.ino()
            || final_source.nlink() != 1
        {
            drop(destination_file);
            let _ = fs::remove_file(destination);
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} changed identity during copy", source.display()),
            ));
        }
    }
    verify_directory_identity(
        source_parent,
        &source_parent_metadata,
        &canonical_source_parent,
    )?;
    verify_directory_identity(parent, &parent_metadata, &canonical_parent)?;
    Ok(())
}

fn write_private_artifact(root: &Path, path: &Path, bytes: &[u8]) -> Result<(), CliFailure> {
    write_private_bytes(root, path, bytes, MAX_OPERATIONAL_ARTIFACT_BYTES).map_err(io_failure)
}

fn write_private_artifact_json(
    root: &Path,
    path: &Path,
    value: &impl Serialize,
) -> Result<(), CliFailure> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| invalid(format!("could not serialize private artifact: {error}")))?;
    write_private_artifact(root, path, &bytes)
}

fn save_state(root: &Path, state: &OperationalState) -> Result<(), CliFailure> {
    let path = root.join(".changeloop/operational.json");
    let bytes = serde_json::to_vec_pretty(state).map_err(|error| invalid(error.to_string()))?;
    write_private_bytes(root, &path, &bytes, MAX_OPERATIONAL_STATE_BYTES).map_err(io_failure)?;
    // Payload first, sidecar second. A crash between them leaves history to
    // inspect but no authority — the safe failure direction.
    let authenticator = record_authenticator()?;
    let sidecar = authenticator
        .sign(
            root,
            "operational-state",
            "operational",
            &bytes,
            lifecycle_authority_bindings(root)?,
        )
        .map_err(|error| lifecycle(format!("could not authenticate operational state: {error}")))?;
    authenticator
        .write_sidecar(&path, &sidecar)
        .map_err(|error| lifecycle(format!("could not persist operational authentication: {error}")))?;
    Ok(())
}

fn privacy_path(root: &Path) -> PathBuf {
    root.join(".changeloop/privacy-sessions.json")
}

fn workspace_revision(root: &Path) -> Result<String, CliFailure> {
    let head = run_compiled_in_command(
        changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
        root,
        "git",
        &["rev-parse".into(), "HEAD".into()],
        &[],
        None,
        30_000,
    )
    .map_err(lifecycle)?;
    let status = run_compiled_in_command(
        changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
        root,
        "git",
        &[
            "status".into(),
            "--porcelain=v1".into(),
            "-z".into(),
            "--untracked-files=all".into(),
            "--".into(),
            ".".into(),
            ":(exclude).changeloop".into(),
        ],
        &[],
        None,
        30_000,
    )
    .map_err(lifecycle)?;
    if !head.status.success() || !status.status.success() || head.truncated || status.truncated {
        return Err(invalid(
            "operational lifecycle requires bounded Git HEAD/status output",
        ));
    }
    let mut digest = Sha256::new();
    digest.update(&head.stdout);
    digest.update(&status.stdout);
    for path in paths_to_hash_from_porcelain(&status.stdout)? {
        hash_operational_path(&mut digest, &root.join(path)).map_err(io_failure)?;
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn paths_to_hash_from_porcelain(status: &[u8]) -> Result<Vec<PathBuf>, CliFailure> {
    let entries = status
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    let mut paths = Vec::new();
    let mut index = 0;
    while index < entries.len() {
        let entry = entries[index];
        if entry.len() < 4 || entry[2] != b' ' || entry[3..].is_empty() {
            return Err(invalid(
                "Git status returned malformed porcelain v1 -z output",
            ));
        }
        let state = &entry[..2];
        let deleted = state.contains(&b'D');
        if !deleted {
            paths.push(path_from_git_bytes(&entry[3..])?);
        }
        if state.contains(&b'R') || state.contains(&b'C') {
            index += 1;
            if index >= entries.len() || entries[index].is_empty() {
                return Err(invalid(
                    "Git status omitted the source path for a rename or copy",
                ));
            }
        }
        index += 1;
    }
    Ok(paths)
}

#[cfg(unix)]
fn path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf, CliFailure> {
    Ok(PathBuf::from(OsString::from_vec(bytes.to_vec())))
}

#[cfg(not(unix))]
fn path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf, CliFailure> {
    String::from_utf8(bytes.to_vec())
        .map(PathBuf::from)
        .map_err(|_| invalid("Git status returned a path that is not valid UTF-8"))
}

fn hash_operational_path(digest: &mut Sha256, path: &Path) -> std::io::Result<()> {
    let path_metadata = fs::symlink_metadata(path)?;
    if path_metadata.file_type().is_symlink() {
        digest.update(b"symlink\0");
        digest.update(
            fs::read_link(path)?
                .as_os_str()
                .to_string_lossy()
                .as_bytes(),
        );
        return Ok(());
    }
    if !path_metadata.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} is not a regular file or symlink", path.display()),
        ));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let mut file = options.open(path)?;
    if !file.metadata()?.file_type().is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{} changed while computing workspace revision",
                path.display()
            ),
        ));
    }
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Ok(());
        }
        digest.update(&buffer[..read]);
    }
}

fn safe_identifier(value: &str) -> Result<(), CliFailure> {
    if !value.is_empty()
        && value.len() <= 256
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        Ok(())
    } else {
        Err(invalid(
            "identifier must be 1-256 bytes using letters, numbers, '-', '_' or '.'",
        ))
    }
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn print_json(value: Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(&value).expect("JSON serializes")
    );
}

fn invalid(message: impl Into<String>) -> CliFailure {
    CliFailure {
        code: EXIT_INVALID_INPUT,
        message: message.into(),
    }
}

fn lifecycle(message: impl Into<String>) -> CliFailure {
    CliFailure {
        code: EXIT_LIFECYCLE_REJECTION,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests run in parallel threads of one process, so the trusted store
    // location cannot come from an environment variable without racing. A
    // thread-local seam keeps each test's operator configuration its own.
    thread_local! {
        static APPROVAL_STORE: std::cell::RefCell<Option<PathBuf>> =
            const { std::cell::RefCell::new(None) };
    }

    pub(super) fn approval_store_override() -> Option<PathBuf> {
        Some(
            APPROVAL_STORE
                .with(|cell| cell.borrow().clone())
                .unwrap_or_else(|| {
                    let home = tempdir().expect("an operator configuration directory");
                    let path = home.path().join("executor-approvals.json");
                    APPROVAL_HOME.with(|slot| *slot.borrow_mut() = Some(home));
                    APPROVAL_STORE.with(|slot| *slot.borrow_mut() = Some(path.clone()));
                    path
                }),
        )
    }

    // An operator configuration directory outside the repository, kept alive for
    // the duration of the test thread.
    thread_local! {
        static APPROVAL_HOME: std::cell::RefCell<Option<tempfile::TempDir>> =
            const { std::cell::RefCell::new(None) };
    }

    /// Grants every executable the repository at `root` currently configures,
    /// into an operator store outside it — the same derivation
    /// `cloop approve grant` performs.
    fn approve_configured(root: &Path) {
        let path = APPROVAL_STORE
            .with(|cell| cell.borrow().clone())
            .unwrap_or_else(|| {
                let home = tempdir().expect("an operator configuration directory");
                let path = home.path().join("executor-approvals.json");
                APPROVAL_HOME.with(|slot| *slot.borrow_mut() = Some(home));
                APPROVAL_STORE.with(|slot| *slot.borrow_mut() = Some(path.clone()));
                path
            });
        let requests = configured_executors(root).expect("configuration resolves");
        let mut store = changeloop_ops::ApprovalStore::load(&path).expect("store loads");
        for request in &requests {
            let resolved =
                changeloop_ops::executor_approval::resolve(request).expect("program resolves");
            // The reviewer fixtures in these tests report this family; the
            // approval is what the independence gate reads, so the two must
            // agree exactly.
            let family = (request.kind == changeloop_ops::ExecutorKind::Reviewer)
                .then(|| "fixture-reviewer".to_owned());
            store
                .grant(&resolved, changeloop_ops::ApprovalProvenance::User, family)
                .expect("approval is recorded");
        }
    }

    /// Grants one reviewer approval directly, for tests that drive
    /// `CommandReviewer` without a repository configuration file.
    fn approved_test_reviewer(
        root: &Path,
        program: &str,
        args: &[String],
        family: &str,
    ) -> changeloop_ops::ApprovedExecutor {
        let path = root.join("test-approvals.json");
        APPROVAL_STORE.with(|cell| *cell.borrow_mut() = Some(path.clone()));
        let request = executor_request(
            root,
            changeloop_ops::ExecutorKind::Reviewer,
            "reviewer",
            program,
            args,
            &[],
            5_000,
            &changeloop_ops::executor_approval::config_digest(b"test"),
        );
        let resolved =
            changeloop_ops::executor_approval::resolve(&request).expect("program resolves");
        let mut store = changeloop_ops::ApprovalStore::load(&path).expect("store loads");
        store
            .grant(
                &resolved,
                changeloop_ops::ApprovalProvenance::User,
                Some(family.to_owned()),
            )
            .expect("approval is recorded");
        authorize_configured_executor(&request).expect("the granted reviewer is approved")
    }

    /// Points this thread's approval lookups at an empty operator store, so
    /// nothing the repository configures is authorized.
    fn approve_nothing() {
        let home = tempdir().expect("an operator configuration directory");
        let path = home.path().join("executor-approvals.json");
        APPROVAL_HOME.with(|cell| *cell.borrow_mut() = Some(home));
        APPROVAL_STORE.with(|cell| *cell.borrow_mut() = Some(path));
    }
    use tempfile::tempdir;

    #[test]
    fn legacy_change_without_risk_tier_fails_closed() {
        let record: ChangeRecord = serde_json::from_value(json!({
            "session_id":"legacy",
            "expected_revision":"revision",
            "proof":null,
            "reviewed":false,
            "landed":false,
            "land_operation":null
        }))
        .unwrap();
        assert_eq!(record.risk_tier, "high");
    }

    #[test]
    fn operational_inputs_reject_sparse_oversize_and_invalid_restored_authority() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        let state_path = root.path().join(".changeloop/operational.json");
        fs::File::create(&state_path)
            .unwrap()
            .set_len(MAX_OPERATIONAL_STATE_BYTES + 1)
            .unwrap();
        assert!(
            load_state(root.path())
                .unwrap_err()
                .message
                .contains("limit")
        );

        let harness = ConvergenceHarness::new_confirmed(
            "change",
            "session",
            "revision",
            BTreeSet::from([ProofRequirement {
                claim_id: "claim".into(),
                provider: "provider".into(),
            }]),
            BTreeSet::new(),
            RepairBudget::default(),
        )
        .unwrap();
        let state = OperationalState {
            changes: BTreeMap::from([(
                "change".into(),
                ChangeRecord {
                    session_id: "session".into(),
                    expected_revision: "revision".into(),
                    proof: None,
                    reviewed: false,
                    landed: false,
                    land_operation: None,
                    convergence: Some(harness),
                    risk_tier: "high".into(),
                    risk_triggers: BTreeSet::new(),
                },
            )]),
            ..OperationalState::default()
        };
        let mut value = serde_json::to_value(state).unwrap();
        value["changes"]["change"]["convergence"]["requirements"] = json!([]);
        fs::write(&state_path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            load_state(root.path())
                .unwrap_err()
                .message
                .contains("invalid restored")
        );
    }

    #[test]
    fn oversized_operational_save_preserves_prior_durable_state() {
        let root = tempdir().unwrap();
        let state_directory = root.path().join(".changeloop");
        fs::create_dir_all(&state_directory).unwrap();
        let state_path = state_directory.join("operational.json");
        fs::write(&state_path, b"{}\n").unwrap();
        let state = OperationalState {
            sessions: BTreeMap::from([(
                "session".into(),
                SessionRecord {
                    kind: "conversation".into(),
                    prompt: "x".repeat(MAX_OPERATIONAL_STATE_BYTES as usize),
                    created_at_ms: 1,
                    parent_session_id: None,
                },
            )]),
            ..OperationalState::default()
        };

        assert!(
            save_state(root.path(), &state)
                .unwrap_err()
                .message
                .contains("limit")
        );
        assert_eq!(fs::read(&state_path).unwrap(), b"{}\n");
    }

    #[cfg(unix)]
    #[test]
    fn operational_inputs_reject_symlinks() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let owned = root.path().join(".changeloop");
        fs::create_dir_all(&owned).unwrap();
        let outside = root.path().join("outside.json");
        fs::write(&outside, b"{}").unwrap();

        symlink(&outside, owned.join("operational.json")).unwrap();
        assert!(load_state(root.path()).is_err());
        symlink(&outside, owned.join("proof-providers.json")).unwrap();
        assert!(proof_providers(root.path()).is_err());
        symlink(&outside, owned.join("reviewer.json")).unwrap();
        assert!(reviewer_config(root.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn operational_save_rejects_symlinked_state_directory() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        symlink(outside.path(), root.path().join(".changeloop")).unwrap();

        assert!(save_state(root.path(), &OperationalState::default()).is_err());
        assert!(!outside.path().join("operational.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn private_artifacts_reject_symlink_hardlink_and_oversize_substitution() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir(root.path().join(".changeloop")).unwrap();
        symlink(outside.path(), root.path().join(".changeloop/proofs")).unwrap();
        let redirected = root.path().join(".changeloop/proofs/change.json");
        assert!(write_private_artifact(root.path(), &redirected, b"safe").is_err());
        assert!(!outside.path().join("change.json").exists());

        fs::remove_file(root.path().join(".changeloop/proofs")).unwrap();
        fs::create_dir(root.path().join(".changeloop/proofs")).unwrap();
        let outside_file = outside.path().join("outside.json");
        fs::write(&outside_file, b"unchanged").unwrap();
        symlink(&outside_file, &redirected).unwrap();
        assert!(write_private_artifact(root.path(), &redirected, b"safe").is_err());
        assert_eq!(fs::read(&outside_file).unwrap(), b"unchanged");

        fs::remove_file(&redirected).unwrap();
        fs::hard_link(&outside_file, &redirected).unwrap();
        assert!(write_private_artifact(root.path(), &redirected, b"safe").is_err());
        assert_eq!(fs::read(&outside_file).unwrap(), b"unchanged");

        let oversized = vec![0_u8; MAX_OPERATIONAL_ARTIFACT_BYTES as usize + 1];
        assert!(
            write_private_artifact(
                root.path(),
                &root.path().join(".changeloop/proofs/oversized.json"),
                &oversized,
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn bounded_copy_rejects_symlink_hardlink_fifo_and_sparse_oversize() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let destination = tempdir().unwrap();
        let regular = root.path().join("regular");
        fs::write(&regular, b"content").unwrap();
        let link = root.path().join("link");
        symlink(&regular, &link).unwrap();
        assert!(
            copy_regular_nofollow_bounded(
                root.path(),
                &link,
                &destination.path().join("link"),
                1024,
            )
            .is_err()
        );

        let hardlink = root.path().join("hardlink");
        fs::hard_link(&regular, &hardlink).unwrap();
        assert!(
            copy_regular_nofollow_bounded(
                root.path(),
                &hardlink,
                &destination.path().join("hardlink"),
                1024,
            )
            .is_err()
        );

        let fifo = root.path().join("fifo");
        assert!(
            Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        assert!(
            copy_regular_nofollow_bounded(
                root.path(),
                &fifo,
                &destination.path().join("fifo"),
                1024,
            )
            .is_err()
        );

        let oversized = root.path().join("oversized");
        fs::File::create(&oversized).unwrap().set_len(1025).unwrap();
        assert!(
            copy_regular_nofollow_bounded(
                root.path(),
                &oversized,
                &destination.path().join("oversized"),
                1024,
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn land_projection_copies_owned_regular_files_and_rejects_special_inputs() {
        use std::os::unix::fs::{PermissionsExt, symlink};

        let root = tempdir().unwrap();
        let regular = root.path().join("regular.sh");
        fs::write(&regular, b"#!/bin/sh\n").unwrap();
        fs::set_permissions(&regular, fs::Permissions::from_mode(0o755)).unwrap();
        let sandbox = stage_land_projection(
            root.path(),
            "change",
            "regular",
            &[PathBuf::from("regular.sh")],
        )
        .unwrap();
        let staged = sandbox.join("regular.sh");
        assert_eq!(fs::read(&staged).unwrap(), b"#!/bin/sh\n");
        assert_ne!(
            fs::metadata(&staged).unwrap().permissions().mode() & 0o111,
            0
        );

        let symlink_path = root.path().join("link");
        symlink(&regular, &symlink_path).unwrap();
        assert!(
            stage_land_projection(root.path(), "change", "symlink", &[PathBuf::from("link")],)
                .is_err()
        );

        let hardlink = root.path().join("hardlink");
        fs::hard_link(&regular, &hardlink).unwrap();
        assert!(
            stage_land_projection(
                root.path(),
                "change",
                "hardlink",
                &[PathBuf::from("hardlink")],
            )
            .is_err()
        );

        let fifo = root.path().join("fifo");
        assert!(
            Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        assert!(
            stage_land_projection(root.path(), "change", "fifo", &[PathBuf::from("fifo")],)
                .is_err()
        );

        let oversized = root.path().join("oversized");
        fs::File::create(&oversized)
            .unwrap()
            .set_len(MAX_LAND_PROJECTION_FILE_BYTES + 1)
            .unwrap();
        assert!(
            stage_land_projection(
                root.path(),
                "change",
                "oversized",
                &[PathBuf::from("oversized")],
            )
            .is_err()
        );
    }

    fn git_root() -> tempfile::TempDir {
        let root = tempdir().unwrap();
        Command::new("git")
            .args(["init", "-q"])
            .current_dir(root.path())
            .status()
            .unwrap();
        fs::write(root.path().join("file.txt"), "initial").unwrap();
        Command::new("git")
            .args(["add", "file.txt"])
            .current_dir(root.path())
            .status()
            .unwrap();
        Command::new("git")
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "-qm",
                "initial",
            ])
            .current_dir(root.path())
            .status()
            .unwrap();
        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        fs::write(
            root.path().join(".changeloop/reviewer.json"),
            serde_json::to_vec(&json!({
                "command":"sh",
                "args":["-c","cat >/dev/null; printf '%s' '{\"reviewerModelFamily\":\"fixture-reviewer\",\"findings\":[],\"completedAtMs\":1}'"]
            }))
            .unwrap(),
        )
        .unwrap();
        root
    }

    /// Writes a repository-configured proof provider that runs `script`.
    fn seed_configured_provider(root: &Path, script: &Path, body: &str) {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;
        fs::write(script, format!("#!/bin/sh\n{body}\n")).unwrap();
        #[cfg(unix)]
        fs::set_permissions(script, fs::Permissions::from_mode(0o755)).unwrap();
        fs::create_dir_all(root.join(".changeloop")).unwrap();
        fs::write(
            root.join(".changeloop/proof-providers.json"),
            serde_json::to_vec(&json!([{
                "id":"configured","command":script.display().to_string(),
                "args":[],"claims":["configured-claim"]
            }]))
            .unwrap(),
        )
        .unwrap();
    }

    /// Prove must not spawn a program the repository chose and the operator
    /// never approved, and must say so with the approval-required code.
    #[cfg(unix)]
    #[test]
    fn prove_refuses_an_unapproved_repository_provider_without_spawning_it() {
        let root = git_root();
        let sentinel = root.path().join("provider-ran");
        let script = root.path().join("provider.sh");
        seed_configured_provider(
            root.path(),
            &script,
            &format!("touch '{}'", sentinel.display()),
        );
        seed_test_change(root.path(), "unapproved");
        approve_nothing();

        let error =
            prove_at(root.path(), "unapproved").expect_err("an unapproved provider refuses");
        assert_eq!(error.code, crate::EXIT_APPROVAL_REQUIRED, "{error:?}");
        assert!(error.message.contains("cloop approve grant"), "{error:?}");
        assert!(
            !sentinel.exists(),
            "the unapproved provider was spawned anyway"
        );
    }

    /// The approval is over bytes, not over a name. Rewriting the approved
    /// program is exactly the attack, so it must void the approval.
    #[cfg(unix)]
    #[test]
    fn rewriting_an_approved_provider_voids_its_approval() {
        let root = git_root();
        let script = root.path().join("provider.sh");
        seed_configured_provider(root.path(), &script, "exit 0");
        seed_test_change(root.path(), "swapped");
        approve_configured(root.path());
        prove_at(root.path(), "swapped").expect("the approved provider runs");

        let sentinel = root.path().join("swapped-ran");
        seed_configured_provider(
            root.path(),
            &script,
            &format!("touch '{}'", sentinel.display()),
        );
        seed_test_change(root.path(), "swapped");
        let error =
            prove_at(root.path(), "swapped").expect_err("the rewritten program is not approved");
        assert_eq!(error.code, crate::EXIT_APPROVAL_REQUIRED, "{error:?}");
        assert!(!sentinel.exists(), "the swapped program was spawned anyway");
    }

    /// Editing the configuration that supplied a command voids the approval it
    /// produced, even when the program on disk is untouched.
    #[cfg(unix)]
    #[test]
    fn editing_the_provider_configuration_voids_its_approval() {
        let root = git_root();
        let script = root.path().join("provider.sh");
        seed_configured_provider(root.path(), &script, "exit 0");
        seed_test_change(root.path(), "edited");
        approve_configured(root.path());
        prove_at(root.path(), "edited").expect("the approved provider runs");

        fs::write(
            root.path().join(".changeloop/proof-providers.json"),
            serde_json::to_vec(&json!([{
                "id":"configured","command":script.display().to_string(),
                "args":["--now-with-arguments"],"claims":["configured-claim"]
            }]))
            .unwrap(),
        )
        .unwrap();
        seed_test_change(root.path(), "edited");
        let error =
            prove_at(root.path(), "edited").expect_err("the edited configuration is not approved");
        assert_eq!(error.code, crate::EXIT_APPROVAL_REQUIRED, "{error:?}");
    }

    /// The independence gate reads the approval, so a reviewer cannot promote
    /// itself by reporting a different family than the one it was approved as.
    #[cfg(unix)]
    #[test]
    fn a_reviewer_reporting_an_unapproved_model_family_is_refused() {
        let root = tempdir().unwrap();
        for (name, content) in [
            ("diff.patch", "diff"),
            ("agreement.json", "{}"),
            ("evidence.json", "{}"),
        ] {
            fs::write(root.path().join(name), content).unwrap();
        }
        let mut reviewer = CommandReviewer {
            approved: approved_test_reviewer(
                root.path(),
                "sh",
                &[
                    "-c".to_owned(),
                    "cat >/dev/null; printf '%s' '{\"reviewerModelFamily\":\"impersonated\",\"findings\":[],\"completedAtMs\":1}'".to_owned(),
                ],
                "approved-family",
            ),
            root: root.path().to_owned(),
        };
        let error = reviewer
            .review(&CleanReviewRequest {
                reviewer_session_id: "review".into(),
                implementation_session_id: "implementation".into(),
                diff_artifact: root.path().join("diff.patch").display().to_string(),
                agreement_artifact: root.path().join("agreement.json").display().to_string(),
                evidence_artifacts: vec![root.path().join("evidence.json").display().to_string()],
                residual_risks: vec![],
                risk_triggers: BTreeSet::from([RiskTrigger::SecurityBoundary]),
            })
            .expect_err("a reviewer cannot rename its own model family");
        assert!(error.contains("approved as 'approved-family'"), "{error}");
    }

    fn seed_test_change(root: &Path, change: &str) {
        let revision = workspace_revision(root).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            change.into(),
            ChangeRecord {
                session_id: change.into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "high".into(),
                risk_triggers: default_risk_triggers(),
            },
        );
        save_state(root, &state).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn prove_artifact_failure_does_not_persist_passed_operational_state() {
        use std::os::unix::fs::symlink;

        let root = git_root();
        let outside = tempdir().unwrap();
        fs::write(root.path().join("file.txt"), "changed").unwrap();
        seed_test_change(root.path(), "artifact-failure");
        let proofs = root.path().join(".changeloop/proofs");
        fs::create_dir_all(&proofs).unwrap();
        let outside_hook = outside.path().join("hooks.json");
        fs::write(&outside_hook, b"unchanged").unwrap();
        symlink(&outside_hook, proofs.join("artifact-failure.hooks.json")).unwrap();

        assert!(prove_at(root.path(), "artifact-failure").is_err());
        let state = load_state(root.path()).unwrap();
        let change = &state.changes["artifact-failure"];
        assert!(change.proof.is_none());
        assert!(change.convergence.is_none());
        assert_eq!(fs::read(&outside_hook).unwrap(), b"unchanged");
    }

    #[test]
    fn workspace_revision_parses_delete_rename_spaces_and_newlines() {
        let parsed = paths_to_hash_from_porcelain(
            b" D deleted.txt\0?? space name.txt\0R  renamed\nfile.txt\0old name.txt\0",
        )
        .unwrap();
        assert_eq!(
            parsed,
            vec![
                PathBuf::from("space name.txt"),
                PathBuf::from("renamed\nfile.txt")
            ]
        );
        assert!(paths_to_hash_from_porcelain(b"R  destination\0").is_err());

        let renamed = git_root();
        let renamed_path = renamed.path().join("renamed file\nsecond line.txt");
        fs::rename(renamed.path().join("file.txt"), &renamed_path).unwrap();
        fs::write(&renamed_path, "renamed payload").unwrap();
        seed_test_change(renamed.path(), "rename");
        approve_configured(renamed.path());
        prove_at(renamed.path(), "rename").unwrap();
        review_at(renamed.path(), "rename").unwrap();
        let review_patch = fs::read_dir(renamed.path().join(".changeloop/reviews"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
            .join("diff.patch");
        let review_patch = fs::read_to_string(review_patch).unwrap();
        assert!(review_patch.contains("+renamed payload"));

        let deleted = git_root();
        fs::remove_file(deleted.path().join("file.txt")).unwrap();
        seed_test_change(deleted.path(), "delete");
        approve_configured(deleted.path());
        prove_at(deleted.path(), "delete").unwrap();
        review_at(deleted.path(), "delete").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn workspace_revision_preserves_non_utf8_porcelain_paths() {
        use std::os::unix::ffi::OsStrExt;

        let parsed = paths_to_hash_from_porcelain(b"?? non-utf8-\xff\0").unwrap();
        assert_eq!(parsed[0].as_os_str().as_bytes(), b"non-utf8-\xff");
    }

    #[cfg(unix)]
    #[test]
    fn private_writes_do_not_upgrade_read_only_directory_authority() {
        use std::os::unix::fs::PermissionsExt;

        let root = git_root();
        let state_path = root.path().join(".changeloop/operational.json");
        fs::write(&state_path, b"original").unwrap();
        let directory = root.path().join(".changeloop");
        for restricted_mode in [0o500, 0o300, 0o600] {
            fs::set_permissions(&directory, fs::Permissions::from_mode(restricted_mode)).unwrap();
            let error = write_private_bytes(root.path(), &state_path, b"replacement", 1024)
                .expect_err("restricted directory authority must not be expanded");
            let observed_mode = fs::metadata(&directory).unwrap().permissions().mode() & 0o777;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
            assert_eq!(observed_mode, restricted_mode);
            assert_eq!(fs::read(&state_path).unwrap(), b"original");
        }
    }

    #[test]
    fn conversation_record_never_creates_change_authority_or_workspace_edit() {
        let root = git_root();
        let mut state = OperationalState::default();
        state.sessions.insert(
            "conversation".into(),
            SessionRecord {
                kind: "conversation".into(),
                prompt: "inspect".into(),
                created_at_ms: 1,
                parent_session_id: None,
            },
        );
        save_state(root.path(), &state).unwrap();
        assert!(load_state(root.path()).unwrap().changes.is_empty());
        assert_eq!(
            fs::read_to_string(root.path().join("file.txt")).unwrap(),
            "initial"
        );
    }

    #[test]
    fn fork_is_read_only_and_retains_parent_provenance() {
        let root = git_root();
        let mut state = OperationalState::default();
        state.sessions.insert(
            "source".into(),
            SessionRecord {
                kind: "change".into(),
                prompt: "implement safely".into(),
                created_at_ms: 1,
                parent_session_id: None,
            },
        );
        save_state(root.path(), &state).unwrap();

        let mut state = load_state(root.path()).unwrap();
        let source = state.sessions["source"].clone();
        let fork_id = SessionId::from_stable("fork").to_string();
        state.sessions.insert(
            fork_id.clone(),
            SessionRecord {
                kind: "conversation".into(),
                prompt: source.prompt,
                created_at_ms: 2,
                parent_session_id: Some("source".into()),
            },
        );
        save_state(root.path(), &state).unwrap();

        let loaded = load_state(root.path()).unwrap();
        assert_eq!(loaded.sessions[&fork_id].kind, "conversation");
        assert_eq!(
            loaded.sessions[&fork_id].parent_session_id.as_deref(),
            Some("source")
        );
        assert!(loaded.changes.is_empty());
    }

    #[test]
    fn land_is_proof_review_and_revision_gated_with_distinct_exit_code() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented change").unwrap();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "high".into(),
                risk_triggers: default_risk_triggers(),
            },
        );
        save_state(root.path(), &state).unwrap();
        assert_eq!(
            land_at(root.path(), "change").unwrap_err().code,
            EXIT_LIFECYCLE_REJECTION
        );
        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();
        assert_eq!(
            land_at(root.path(), "change").unwrap_err().code,
            EXIT_LIFECYCLE_REJECTION
        );
        review_at(root.path(), "change").unwrap();
        let result = land_at(root.path(), "change").unwrap();
        // Prove now writes an oracle report, so Land reads one back rather than
        // reporting no evidence at all. With no coverage tool and no baseline
        // configured that report is still explicit about what it did not
        // measure: a green proof run must never arrive as a confident gate.
        let evidence = &result["proveEvidence"];
        assert_eq!(evidence["measured"], true);
        assert_eq!(evidence["provider"], prove_oracle::ORACLE_RECEIPT_PROVIDER);
        assert_eq!(evidence["proofOfCorrectness"], false);
        assert_eq!(evidence["evidenceIncomplete"], true);
        assert_eq!(evidence["evidenceStrength"], "NOT MEASURED");
        let text = evidence["text"].as_str().unwrap();
        assert!(text.contains("Tests are weak evidence."), "{text}");
        // The renderer hard-wraps, so assert on a fragment rather than a line.
        assert!(text.contains("not the same as clean"), "{text}");
        assert!(text.contains("coverage unavailable"), "{text}");
        let landed = load_state(root.path()).unwrap();
        assert!(landed.changes["change"].landed);
        let transaction = landed.changes["change"].land_operation.as_ref().unwrap();
        assert!(
            root.path()
                .join(".changeloop/land-transactions/change")
                .join(transaction)
                .join("journal.json")
                .is_file()
        );
        let privacy = changeloop_ops::privacy_export(&privacy_path(root.path()), "change").unwrap();
        assert_eq!(privacy["active"], false);
        assert_eq!(privacy["evidence_refs"], 1);
        assert!(
            root.path()
                .join(".changeloop/archive/change.json")
                .is_file()
        );
    }

    /// Register a change that is ready for its first Prove run at the current
    /// workspace revision.
    fn ready_change(root: &Path) {
        let revision = workspace_revision(root).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "high".into(),
                risk_triggers: default_risk_triggers(),
            },
        );
        save_state(root, &state).unwrap();
    }

    const LIBTEST_PASSING: &str = "\
running 2 tests
test order::totals ... ok
test order::rounding ... ok

test result: ok. 2 passed; 0 failed; 0 ignored
";

    /// Everything the oracle needs to measure both arms. All of it lives inside
    /// `.changeloop/`, which the change diff excludes, so the only touched file
    /// is the one the test actually edits.
    fn measurable_oracle_project(root: &Path) {
        fs::write(
            root.join(".changeloop/baseline-output.txt"),
            LIBTEST_PASSING,
        )
        .unwrap();
        fs::write(
            root.join(".changeloop/lcov.info"),
            "SF:file.txt\nDA:1,4\nend_of_record\n",
        )
        .unwrap();
        fs::write(
            root.join(".changeloop/proof-providers.json"),
            serde_json::to_vec(&json!([{
                "id":"suite","command":"sh",
                "args":["-c","cat .changeloop/baseline-output.txt"],
                "claims":["suite-valid"]
            }]))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            root.join(".changeloop/prove-oracle.json"),
            serde_json::to_vec(&json!({
                "coverageReport":".changeloop/lcov.info",
                "testProvider":"suite",
                "baseline":{"outputPath":".changeloop/baseline-output.txt"}
            }))
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn prove_writes_an_oracle_receipt_that_land_reads_back() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented change").unwrap();
        measurable_oracle_project(root.path());
        ready_change(root.path());

        approve_configured(root.path());
        let result = prove_at(root.path(), "change").unwrap();

        assert_eq!(result["oracle"]["recorded"], true);
        let receipt = root
            .path()
            .join(".changeloop/receipts/change")
            .join(format!("{}.json", prove_oracle::ORACLE_RECEIPT_PROVIDER));
        let stored: Value = serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
        assert!(
            stored[changeloop_evidence::ORACLE_RECEIPT_EXTENSION].is_object(),
            "the receipt must carry the oracle extension: {stored}"
        );
        // Land reads exactly this root, so the join must hold without changing
        // `changeloop-land`.
        let briefing = read_prove_evidence(&root.path().join(".changeloop/receipts"), "change");
        let report = briefing
            .report()
            .expect("Land reads the oracle report back");
        assert_eq!(report.change_id, "change");
        assert_eq!(
            report.summary.coverage_verdict,
            changeloop_evidence::CoverageVerdict::ChangedPathExercised
        );
    }

    #[test]
    fn land_renders_a_measured_briefing_after_a_prove_run_that_produced_coverage() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented change").unwrap();
        measurable_oracle_project(root.path());
        ready_change(root.path());

        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();
        review_at(root.path(), "change").unwrap();
        let evidence = land_at(root.path(), "change").unwrap()["proveEvidence"].clone();

        assert_eq!(evidence["measured"], true);
        assert_eq!(evidence["evidenceIncomplete"], false);
        assert_eq!(
            evidence["evidenceStrength"],
            "WEAK -- CHANGED PATH EXERCISED (strongest available)"
        );
        // Measured is still never proof: the strongest briefing this oracle can
        // produce is weak evidence that ends by sending the reader to the diff.
        assert_eq!(evidence["proofOfCorrectness"], false);
        let text = evidence["text"].as_str().unwrap();
        assert!(!text.starts_with("Prove evidence: NOT MEASURED"), "{text}");
        assert!(text.contains("Tests are weak evidence."), "{text}");
    }

    #[test]
    fn a_prove_run_without_a_coverage_tool_records_unknown_coverage_not_a_clean_one() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented change").unwrap();
        ready_change(root.path());

        let result = prove_at(root.path(), "change").unwrap();

        assert_eq!(result["oracle"]["recorded"], true);
        let briefing = read_prove_evidence(&root.path().join(".changeloop/receipts"), "change");
        let report = briefing
            .report()
            .expect("an unconfigured project still gets a report");
        assert_eq!(
            report.summary.coverage_verdict,
            changeloop_evidence::CoverageVerdict::Unknown(
                changeloop_evidence::CoverageUnavailable::NoToolConfigured
            )
        );
        assert!(report.summary.evidence_incomplete);
        let text = briefing.render();
        assert!(text.contains("coverage unavailable"), "{text}");
        assert!(text.contains("which is not the same as clean"), "{text}");
    }

    #[test]
    fn a_prove_run_without_a_baseline_records_the_differential_as_unavailable() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented change").unwrap();
        ready_change(root.path());

        prove_at(root.path(), "change").unwrap();

        let briefing = read_prove_evidence(&root.path().join(".changeloop/receipts"), "change");
        let report = briefing.report().expect("report exists");
        // The field is present and carries its reason. Omitting it would render
        // as an empty divergence list, which reads as clean.
        assert!(!report.differential.is_available());
        assert!(report.differential.unavailable.is_some());
        assert!(report.differential.divergences.is_empty());
        assert!(
            report
                .warnings_with(changeloop_evidence::OracleWarningCode::DifferentialUnavailable)
                .next()
                .is_some(),
            "a missing baseline must warn: {:?}",
            report.warnings
        );
    }

    #[test]
    fn a_configured_baseline_produces_a_differential_and_seeds_the_suppression_ledger() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented change").unwrap();
        measurable_oracle_project(root.path());
        ready_change(root.path());

        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();

        let briefing = read_prove_evidence(&root.path().join(".changeloop/receipts"), "change");
        let report = briefing.report().expect("report exists");
        assert!(report.differential.is_available());
        assert_eq!(report.differential.baseline_tests, 2);
        assert_eq!(report.differential.candidate_tests, 2);
        assert_eq!(report.summary.unexpected_divergences, 0);
        let ledger = changeloop_evidence::SuppressionLedger::load(
            root.path().join(".changeloop/suppressions.json"),
        )
        .expect("the seeded ledger round-trips");
        assert!(ledger.rules.is_empty());
    }

    fn commit_all(root: &Path, message: &str) {
        Command::new("git")
            .args(["add", "-A"])
            .current_dir(root)
            .status()
            .unwrap();
        Command::new("git")
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "-qm",
                message,
            ])
            .current_dir(root)
            .status()
            .unwrap();
    }

    #[test]
    fn a_worktree_baseline_run_surfaces_an_undeclared_divergence() {
        let root = git_root();
        // Committed at HEAD, so the detached worktree at the pre-change
        // revision replays it as the baseline suite result.
        fs::write(root.path().join("suite-output.txt"), LIBTEST_PASSING).unwrap();
        commit_all(root.path(), "suite fixture");
        fs::write(root.path().join("file.txt"), "implemented change").unwrap();
        fs::write(
            root.path().join(".changeloop/proof-providers.json"),
            serde_json::to_vec(&json!([{
                "id":"suite","command":"sh",
                "args":["-c","printf 'test order::totals ... ok\\ntest order::rounding ... FAILED\\n'"],
                "claims":["suite-valid"]
            }]))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            root.path().join(".changeloop/prove-oracle.json"),
            serde_json::to_vec(&json!({
                "testProvider":"suite",
                "baseline":{"command":"sh","args":["-c","cat suite-output.txt"]}
            }))
            .unwrap(),
        )
        .unwrap();
        ready_change(root.path());

        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();

        let briefing = read_prove_evidence(&root.path().join(".changeloop/receipts"), "change");
        let report = briefing.report().expect("report exists");
        assert!(report.differential.is_available());
        assert_eq!(report.summary.unexpected_divergences, 1);
        assert_eq!(
            report.summary.confidence,
            changeloop_evidence::OracleConfidence::UnexpectedDivergence
        );
        // The throwaway worktree never outlives the run.
        assert_eq!(
            fs::read_dir(root.path().join(".changeloop/baseline"))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn a_failing_prove_run_records_no_oracle_report() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "trailing whitespace \n").unwrap();
        ready_change(root.path());

        assert_eq!(
            prove_at(root.path(), "change").unwrap_err().code,
            EXIT_PROOF_FAILURE
        );

        // Evidence is never fabricated for a run that did not finish.
        assert!(!root.path().join(".changeloop/receipts").exists());
        assert_eq!(
            read_prove_evidence(&root.path().join(".changeloop/receipts"), "change"),
            changeloop_land::ProveEvidenceBriefing::Unmeasured(
                changeloop_land::ProveEvidenceGap::NoReceipts
            )
        );
    }

    #[test]
    fn proof_failure_has_distinct_exit_code() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "trailing whitespace \n").unwrap();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "low".into(),
                risk_triggers: BTreeSet::new(),
            },
        );
        save_state(root.path(), &state).unwrap();
        assert_eq!(
            prove_at(root.path(), "change").unwrap_err().code,
            EXIT_PROOF_FAILURE
        );
    }

    #[test]
    fn failed_provider_can_be_repaired_without_rerunning_fresh_provider() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "change one").unwrap();
        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        fs::write(root.path().join("failure.flag"), "fail").unwrap();
        fs::write(
            root.path().join(".changeloop/proof-providers.json"),
            serde_json::to_vec(&json!([
                {"id":"diff","command":"git","args":["diff","--check"],"claims":["diff-valid"]},
                {"id":"focused","command":"sh","args":["-c","test ! -f failure.flag"],"claims":["focused-valid"]}
            ]))
            .unwrap(),
        )
        .unwrap();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "high".into(),
                risk_triggers: default_risk_triggers(),
            },
        );
        save_state(root.path(), &state).unwrap();

        approve_configured(root.path());
        assert_eq!(prove_at(root.path(), "change").unwrap_err().code, 5);
        fs::remove_file(root.path().join("failure.flag")).unwrap();
        fs::write(root.path().join("file.txt"), "change two").unwrap();
        prove_at(root.path(), "change").unwrap();

        let state = load_state(root.path()).unwrap();
        let harness = state.changes["change"].convergence.as_ref().unwrap();
        assert_eq!(harness.phase(), &LifecyclePhase::Review);
        assert!(
            harness.proof_records()["diff"]
                .reused_from_revision
                .is_some()
        );
        assert_eq!(harness.repair_history().len(), 1);
    }

    #[test]
    fn attached_repair_executor_runs_automatically_then_targeted_proof_converges() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented").unwrap();
        fs::write(root.path().join("failure.flag"), "fail").unwrap();
        fs::write(
            root.path().join(".changeloop/proof-providers.json"),
            serde_json::to_vec(&json!([
                {"id":"diff","command":"git","args":["diff","--check"],"claims":["diff-valid"]},
                {"id":"focused","command":"sh","args":["-c","test ! -f failure.flag"],
                 "claims":["focused-valid"],"repairCommand":"sh",
                 "repairArgs":["-c","rm failure.flag"]}
            ]))
            .unwrap(),
        )
        .unwrap();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "high".into(),
                risk_triggers: default_risk_triggers(),
            },
        );
        save_state(root.path(), &state).unwrap();

        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();
        assert!(!root.path().join("failure.flag").exists());
        let state = load_state(root.path()).unwrap();
        let harness = state.changes["change"].convergence.as_ref().unwrap();
        assert_eq!(harness.repair_history().len(), 1);
        assert_eq!(harness.phase(), &LifecyclePhase::Review);
        assert!(
            harness.proof_records()["diff"]
                .reused_from_revision
                .is_some()
        );
    }

    #[test]
    fn bounded_executor_drains_large_output_without_deadlock_and_caps_retention() {
        let root = tempdir().unwrap();
        let output = run_compiled_in_command(
            changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
            root.path(),
            "sh",
            &["-c".into(), "yes x | head -c 2097152".into()],
            &[],
            None,
            30_000,
        )
        .unwrap();
        assert!(output.status.success());
        assert!(output.truncated);
        assert_eq!(output.stdout.len(), MAX_EXECUTOR_OUTPUT_BYTES);
    }

    #[cfg(unix)]
    #[test]
    fn hardened_git_blocks_hooks_diff_drivers_and_global_system_config_execution() {
        use std::os::unix::fs::PermissionsExt;

        let root = git_root();
        let sentinel = root.path().join("git-side-effect");
        let executable = root.path().join("malicious-git-config.sh");
        fs::write(
            &executable,
            format!("#!/bin/sh\ntouch '{}'\n", sentinel.display()),
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&executable, permissions).unwrap();

        fs::write(root.path().join(".gitattributes"), "file.txt diff=evil\n").unwrap();
        fs::write(root.path().join("file.txt"), "changed\n").unwrap();
        for (key, value) in [
            ("diff.evil.command", executable.to_str().unwrap()),
            ("diff.evil.textconv", executable.to_str().unwrap()),
        ] {
            assert!(
                Command::new("git")
                    .args(["config", "--local", key, value])
                    .current_dir(root.path())
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let raw = run_compiled_in_command(
            changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
            root.path(),
            "git",
            &["diff".into(), "--ext-diff".into(), "--textconv".into()],
            &[],
            None,
            5_000,
        )
        .unwrap();
        assert!(raw.status.success());
        assert!(sentinel.exists(), "malicious diff fixture did not execute");
        fs::remove_file(&sentinel).unwrap();

        let hardened = run_hardened_git(root.path(), &["diff".into()], 30_000).unwrap();
        assert!(hardened.status.success());
        assert!(!sentinel.exists(), "hardened diff executed a diff driver");

        for key in ["diff.evil.command", "diff.evil.textconv"] {
            assert!(
                Command::new("git")
                    .args(["config", "--local", "--unset-all", key])
                    .current_dir(root.path())
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let config_contents = format!(
            "[diff \"evil\"]\n\tcommand = {}\n\ttextconv = {}\n",
            executable.display(),
            executable.display()
        );
        let global_config = root.path().join("hostile-global.gitconfig");
        let system_config = root.path().join("hostile-system.gitconfig");
        fs::write(&global_config, &config_contents).unwrap();
        fs::write(&system_config, &config_contents).unwrap();

        for (key, config) in [
            ("GIT_CONFIG_GLOBAL", &global_config),
            ("GIT_CONFIG_SYSTEM", &system_config),
        ] {
            let environment = if key == "GIT_CONFIG_SYSTEM" {
                vec![
                    ("GIT_CONFIG_GLOBAL", "/dev/null"),
                    (key, config.to_str().unwrap()),
                ]
            } else {
                vec![(key, config.to_str().unwrap())]
            };
            let raw = run_compiled_in_command(
                changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
                root.path(),
                "git",
                &["diff".into(), "--ext-diff".into(), "--textconv".into()],
                &environment,
                None,
                30_000,
            )
            .unwrap();
            assert!(raw.status.success());
            assert!(sentinel.exists(), "hostile {key} fixture did not execute");
            fs::remove_file(&sentinel).unwrap();
        }

        let hostile_environment = [
            ("GIT_CONFIG_GLOBAL", global_config.to_str().unwrap()),
            ("GIT_CONFIG_SYSTEM", system_config.to_str().unwrap()),
            ("GIT_CONFIG_NOSYSTEM", "0"),
        ];
        let hardened = run_hardened_git_with_environment(
            root.path(),
            &["diff".into()],
            30_000,
            &hostile_environment,
        )
        .unwrap();
        assert!(hardened.status.success());
        assert!(
            !sentinel.exists(),
            "hardened diff executed global or system config"
        );

        let hooks = root.path().join("hostile-hooks");
        fs::create_dir(&hooks).unwrap();
        fs::copy(&executable, hooks.join("pre-commit")).unwrap();
        assert!(
            Command::new("git")
                .args([
                    "config",
                    "--local",
                    "core.hooksPath",
                    hooks.to_str().unwrap(),
                ])
                .current_dir(root.path())
                .status()
                .unwrap()
                .success()
        );
        for (key, value) in [("user.name", "Test"), ("user.email", "test@example.test")] {
            assert!(
                Command::new("git")
                    .args(["config", "--local", key, value])
                    .current_dir(root.path())
                    .status()
                    .unwrap()
                    .success()
            );
        }
        assert!(
            Command::new("git")
                .args(["add", "file.txt"])
                .current_dir(root.path())
                .status()
                .unwrap()
                .success()
        );
        let committed = run_hardened_git(
            root.path(),
            &["commit".into(), "-m".into(), "hardened".into()],
            30_000,
        )
        .unwrap();
        assert!(committed.status.success());
        assert!(
            !sentinel.exists(),
            "hardened Git executed a repository hook"
        );
    }

    #[cfg(unix)]
    #[test]
    fn bounded_executor_timeout_terminates_descendant_process_group() {
        let root = tempdir().unwrap();
        let started = Instant::now();
        let error = run_compiled_in_command(
            changeloop_ops::CompiledInExecutor::GIT_WORKSPACE_QUERY,
            root.path(),
            "sh",
            &["-c".into(), "sleep 30 & echo $! > child.pid; wait".into()],
            &[],
            None,
            50,
        )
        .unwrap_err();
        assert!(error.contains("time budget"));
        assert!(started.elapsed() < Duration::from_secs(2));
        let pid: libc::pid_t = fs::read_to_string(root.path().join("child.pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        // SAFETY: signal 0 performs no mutation and only checks existence.
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    }

    #[test]
    fn review_rejects_receipts_after_external_workspace_change() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented").unwrap();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "low".into(),
                risk_triggers: BTreeSet::new(),
            },
        );
        save_state(root.path(), &state).unwrap();
        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();
        fs::write(root.path().join("file.txt"), "changed after proof").unwrap();
        assert!(review_at(root.path(), "change").is_err());
        let state = load_state(root.path()).unwrap();
        assert!(!state.changes["change"].reviewed);
        let harness = state.changes["change"].convergence.as_ref().unwrap();
        assert_eq!(harness.phase(), &LifecyclePhase::Change);
        assert!(matches!(
            harness.proof_records()["git-diff-check"].freshness,
            Freshness::Stale(changeloop_harness::StaleReason::WorkspaceRevisionMismatch)
        ));
    }

    #[test]
    fn snapshot_undo_invalidates_proof_review_and_harness_freshness() {
        let root = git_root();
        let session = "snapshot-proof-session".to_owned();
        let directory = root.path().join(".changeloop/snapshots").join(&session);
        let manifest = directory.join("state.json");
        let mut snapshots = SnapshotManager::new(root.path(), &directory).unwrap();
        let pending = snapshots
            .begin_step([PathBuf::from("file.txt")], 1)
            .unwrap();
        fs::write(root.path().join("file.txt"), "implemented").unwrap();
        snapshots
            .commit_step(pending, 2, BTreeSet::from(["git-diff-check".into()]))
            .unwrap();
        snapshots.save(&manifest).unwrap();

        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: session.clone(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "high".into(),
                risk_triggers: default_risk_triggers(),
            },
        );
        save_state(root.path(), &state).unwrap();
        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();
        review_at(root.path(), "change").unwrap();
        assert!(load_state(root.path()).unwrap().changes["change"].reviewed);

        undo_redo_at(root.path(), Some(&session), false).unwrap();
        let state = load_state(root.path()).unwrap();
        let change = &state.changes["change"];
        assert!(change.proof.is_none());
        assert!(!change.reviewed);
        let harness = change.convergence.as_ref().unwrap();
        assert_eq!(harness.phase(), &LifecyclePhase::Change);
        assert!(harness.proof_records().values().all(|proof| matches!(
            proof.freshness,
            Freshness::Stale(changeloop_harness::StaleReason::WorkspaceRevisionMismatch)
        )));
        assert_eq!(harness.review_attempt_history().len(), 1);
    }

    #[test]
    fn nonblocking_review_hypothesis_is_persisted_but_not_promoted_to_defect() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented").unwrap();
        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        fs::write(
            root.path().join(".changeloop/reviewer.json"),
            serde_json::to_vec(&json!({
                "command":"sh",
                "args":["-c","cat >/dev/null; printf '%s' '{\"reviewerModelFamily\":\"fixture-reviewer\",\"findings\":[{\"state\":\"hypothesis\",\"summary\":\"possible edge case\",\"blocking\":false,\"reproductionEvidence\":[],\"affectedProviders\":[]}],\"completedAtMs\":1}'"]
            }))
            .unwrap(),
        )
        .unwrap();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "high".into(),
                risk_triggers: default_risk_triggers(),
            },
        );
        save_state(root.path(), &state).unwrap();
        approve_configured(root.path());
        prove_at(root.path(), "change").unwrap();
        review_at(root.path(), "change").unwrap();

        let state = load_state(root.path()).unwrap();
        let attempts = state.changes["change"]
            .convergence
            .as_ref()
            .unwrap()
            .review_attempt_history();
        assert_eq!(attempts.len(), 1);
        assert_eq!(
            attempts[0].findings[0].state,
            changeloop_harness::FindingState::Hypothesis
        );
        assert!(attempts[0].passed);
    }

    #[test]
    fn command_reviewer_receives_only_staged_artifacts_not_implementation_state() {
        let root = tempdir().unwrap();
        fs::write(
            root.path().join("operational.json"),
            "implementation-chat-secret-canary",
        )
        .unwrap();
        for (name, content) in [
            ("diff.patch", "diff"),
            ("agreement.json", "{}"),
            ("evidence.json", "{}"),
        ] {
            fs::write(root.path().join(name), content).unwrap();
        }
        let mut reviewer = CommandReviewer {
            approved: approved_test_reviewer(
                root.path(),
                "sh",
                &[
                    "-c".to_owned(),
                    "cat >/dev/null; if [ -e operational.json ]; then exit 23; fi; printf '%s' '{\"reviewerModelFamily\":\"clean-family\",\"findings\":[],\"completedAtMs\":1}'".to_owned(),
                ],
                "clean-family",
            ),
            root: root.path().to_owned(),
        };
        let result = reviewer
            .review(&CleanReviewRequest {
                reviewer_session_id: "review".into(),
                implementation_session_id: "implementation".into(),
                diff_artifact: root.path().join("diff.patch").display().to_string(),
                agreement_artifact: root.path().join("agreement.json").display().to_string(),
                evidence_artifacts: vec![root.path().join("evidence.json").display().to_string()],
                residual_risks: vec![],
                risk_triggers: BTreeSet::from([RiskTrigger::SecurityBoundary]),
            })
            .unwrap();
        assert_eq!(result.reviewer_model_family, "clean-family");
    }

    #[test]
    fn authenticated_operational_state_restores_authority_while_tampering_clears_only_authority() {
        let root = git_root();
        let _ = approval_store_override();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.sessions.insert(
            "change".into(),
            SessionRecord {
                kind: "change".into(),
                prompt: "preserve this intent".into(),
                created_at_ms: 1,
                parent_session_id: None,
            },
        );
        let mut harness = ConvergenceHarness::new_confirmed(
            "change",
            "change",
            &revision,
            BTreeSet::from([ProofRequirement {
                claim_id: "claim".into(),
                provider: "provider".into(),
            }]),
            BTreeSet::new(),
            RepairBudget::default(),
        )
        .unwrap();
        harness.complete_build(&revision).unwrap();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: Some(harness),
                risk_tier: "low".into(),
                risk_triggers: BTreeSet::new(),
            },
        );
        save_state(root.path(), &state).unwrap();
        assert!(
            load_state(root.path()).unwrap().changes["change"]
                .convergence
                .is_some()
        );

        let path = root.path().join(".changeloop/operational.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["sessions"]["change"]["prompt"] = json!("forged authority payload");
        fs::write(&path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();

        let recovered = load_state(root.path()).unwrap();
        assert_eq!(
            recovered.sessions["change"].prompt,
            "forged authority payload",
            "legacy/tampered content remains inspectable"
        );
        assert!(
            recovered.changes["change"].convergence.is_none(),
            "tampered state must not restore lifecycle authority"
        );
        assert!(!recovered.changes["change"].reviewed);
        assert!(recovered.changes["change"].proof.is_none());
    }

    #[test]
    fn changing_lifecycle_config_or_losing_the_key_stales_authenticated_state() {
        let root = git_root();
        let _ = approval_store_override();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        let mut harness = ConvergenceHarness::new_confirmed(
            "change",
            "change",
            &revision,
            BTreeSet::from([ProofRequirement {
                claim_id: "claim".into(),
                provider: "provider".into(),
            }]),
            BTreeSet::new(),
            RepairBudget::default(),
        )
        .unwrap();
        harness.complete_build(&revision).unwrap();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: Some(harness),
                risk_tier: "low".into(),
                risk_triggers: BTreeSet::new(),
            },
        );
        save_state(root.path(), &state).unwrap();
        fs::write(
            root.path().join(".changeloop/proof-providers.json"),
            b"[]",
        )
        .unwrap();
        assert!(
            load_state(root.path()).unwrap().changes["change"]
                .convergence
                .is_none(),
            "editing config outside the workspace hash must stale authority"
        );

        fs::remove_file(root.path().join(".changeloop/proof-providers.json")).unwrap();
        save_state(root.path(), &state).unwrap();
        let key = changeloop_evidence::authenticated_record::RecordAuthenticator::key_path_in(
            approval_store_path().unwrap().parent().unwrap(),
        );
        fs::remove_file(key).unwrap();
        assert!(
            load_state(root.path()).unwrap().changes["change"]
                .convergence
                .is_none(),
            "lost key must require fresh proof, not trust old state"
        );
    }

    #[test]
    fn repeated_non_progress_persists_doom_loop_pause() {
        let root = git_root();
        fs::write(root.path().join("file.txt"), "implemented").unwrap();
        fs::create_dir_all(root.path().join(".changeloop")).unwrap();
        fs::write(
            root.path().join(".changeloop/proof-providers.json"),
            serde_json::to_vec(&json!([{
                "id":"always-fails","command":"sh","args":["-c","exit 1"],
                "claims":["failure-detected"]
            }]))
            .unwrap(),
        )
        .unwrap();
        let revision = workspace_revision(root.path()).unwrap();
        let mut state = OperationalState::default();
        state.changes.insert(
            "change".into(),
            ChangeRecord {
                session_id: "change".into(),
                expected_revision: revision,
                proof: None,
                reviewed: false,
                landed: false,
                land_operation: None,
                convergence: None,
                risk_tier: "low".into(),
                risk_triggers: BTreeSet::new(),
            },
        );
        // Approval is itself a lifecycle-authority binding, so establish it
        // before signing the initial state. Re-granting after this point is
        // idempotent and does not change the store bytes.
        approve_configured(root.path());
        save_state(root.path(), &state).unwrap();

        for _ in 0..3 {
            assert!(prove_at(root.path(), "change").is_err());
        }
        let error = prove_at(root.path(), "change").unwrap_err();
        assert!(error.message.contains("doom_loop"));
        let state = load_state(root.path()).unwrap();
        assert!(matches!(
            state.changes["change"]
                .convergence
                .as_ref()
                .unwrap()
                .phase(),
            LifecyclePhase::Paused(changeloop_harness::PauseReason::DoomLoopPermissionRequired)
        ));
    }

    #[test]
    fn oauth_loopback_callback_extracts_code_and_state() {
        use std::net::TcpStream;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let receiver = std::thread::spawn(move || {
            receive_oauth_callback(&listener, "fixture-state", Duration::from_secs(2)).unwrap()
        });
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .write_all(
                format!("GET /callback?code=fixture-code&state=fixture-state HTTP/1.1\r\nhost: 127.0.0.1:{}\r\n\r\n", address.port()).as_bytes(),
            )
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert_eq!(receiver.join().unwrap(), "fixture-code");
    }

    #[test]
    fn oauth_loopback_callback_rejects_host_duplicates_and_state_confusion() {
        use std::net::TcpStream;

        for request in [
            "GET /callback?code=ok&state=expected HTTP/1.1\r\nhost: attacker.invalid\r\n\r\n"
                .to_owned(),
            "GET /callback?code=ok&state=expected&state=other HTTP/1.1\r\nhost: {host}\r\n\r\n"
                .to_owned(),
            "GET /callback?code=ok&state=wrong HTTP/1.1\r\nhost: {host}\r\n\r\n".to_owned(),
            "POST /callback?code=ok&state=expected HTTP/1.1\r\nhost: {host}\r\n\r\n".to_owned(),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = listener.local_addr().unwrap();
            let receiver = std::thread::spawn(move || {
                receive_oauth_callback(&listener, "expected", Duration::from_secs(2))
            });
            let rendered = request.replace("{host}", &format!("127.0.0.1:{}", address.port()));
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(rendered.as_bytes()).unwrap();
            drop(stream);
            assert!(receiver.join().unwrap().is_err());
        }
    }

    #[test]
    fn optional_change_selects_latest_active_and_rejects_unknown() {
        let mut state = OperationalState::default();
        for (id, landed) in [("a-landed", true), ("b-active", false)] {
            state.changes.insert(
                id.into(),
                ChangeRecord {
                    session_id: id.into(),
                    expected_revision: "revision".into(),
                    proof: None,
                    reviewed: false,
                    landed,
                    land_operation: None,
                    convergence: None,
                    risk_tier: "low".into(),
                    risk_triggers: BTreeSet::new(),
                },
            );
        }
        assert_eq!(selected_change(&state, None).unwrap(), "b-active");
        assert_eq!(
            selected_change(&state, Some(&"a-landed".into())).unwrap(),
            "a-landed"
        );
        assert!(selected_change(&state, Some(&"missing".into())).is_err());
    }

    #[test]
    fn optional_change_uses_creation_time_instead_of_lexical_identifier_order() {
        let mut state = OperationalState::default();
        for (id, created_at_ms) in [("z-older", 1), ("a-newer", 2)] {
            state.sessions.insert(
                id.into(),
                SessionRecord {
                    kind: "change".into(),
                    prompt: "fixture".into(),
                    created_at_ms,
                    parent_session_id: None,
                },
            );
            state.changes.insert(
                id.into(),
                ChangeRecord {
                    session_id: id.into(),
                    expected_revision: "revision".into(),
                    proof: None,
                    reviewed: false,
                    landed: false,
                    land_operation: None,
                    convergence: None,
                    risk_tier: "low".into(),
                    risk_triggers: BTreeSet::new(),
                },
            );
        }
        assert_eq!(selected_change(&state, None).unwrap(), "a-newer");
    }
}
