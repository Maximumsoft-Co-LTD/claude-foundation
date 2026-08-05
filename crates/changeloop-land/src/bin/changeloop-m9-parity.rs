use changeloop_evidence::{
    mutation_protocol_result, numeric_report_value, parse_json_output, parse_tap_output,
    stable_hash,
};
use changeloop_harness::{
    ConvergenceHarness, FailureClass, FindingState, LandAuthority, ProofFailure, ProofReceipt,
    ProofRequirement, RepairBudget, ReviewContext, ReviewFinding, RiskTrigger,
};
use changeloop_land::{
    ApplyControl, AuthoritySource, ExternalLandAuthority, apply_land, prepare_land, recover_land,
};
use changeloop_policy::{
    AUTO_CLASSIFIER_VERSION, AuthorityChangeRequest, ContextProvenance, ExecutionMode,
    HardBoundary, LifecycleAuthority, OperationKind, PermissionKind, PolicyRequest, Reversibility,
    RuleAction, SandboxCapability, evaluate, may_change_authority,
};
use changeloop_protocol::OperationId;
use changeloop_provider::{Measurement, MoneyMicros, TokenUsage, UsageAccounting, UsageLedger};
use changeloop_snapshot::{AuditKind, SnapshotError, SnapshotManager};
use serde_json::json;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

fn policy_request() -> PolicyRequest {
    PolicyRequest {
        classifier_version: AUTO_CLASSIFIER_VERSION,
        mode: ExecutionMode::Auto,
        configured_action: RuleAction::Auto,
        permission: PermissionKind::FilesystemRead,
        operation: OperationKind::Read,
        paths: vec!["src/lib.rs".into()],
        network_destination: None,
        reversibility: Reversibility::Reversible,
        sandbox: SandboxCapability::ReadOnly,
        lifecycle_authority: LifecycleAuthority::Conversation,
        hard_boundaries: Vec::new(),
    }
}

fn policy_json(request: &PolicyRequest) -> serde_json::Value {
    let decision = evaluate(request);
    json!({"action":decision.action,"reason":decision.reason,"yoloActive":decision.yolo_active})
}

fn requirements() -> BTreeSet<ProofRequirement> {
    [ProofRequirement {
        claim_id: "tests-pass".into(),
        provider: "unit".into(),
    }]
    .into_iter()
    .collect()
}

fn harness(risks: BTreeSet<RiskTrigger>) -> ConvergenceHarness {
    ConvergenceHarness::new_confirmed(
        "change-1",
        "impl-session",
        "rev-1",
        requirements(),
        risks,
        RepairBudget {
            max_operations: 4,
            non_progress_limit: 2,
        },
    )
    .unwrap()
}

fn receipt(revision: &str) -> ProofReceipt {
    ProofReceipt {
        receipt_id: "receipt-1".into(),
        provider: "unit".into(),
        claims: ["tests-pass".into()].into_iter().collect(),
        workspace_revision: revision.into(),
        evidence_hash: "evidence-1".into(),
        completed_at_ms: 2,
    }
}

fn effect_name(effect: &changeloop_harness::TransitionEffect) -> &'static str {
    use changeloop_harness::TransitionEffect::*;
    match effect {
        BuildRequired => "build_required",
        ProofRequired { .. } => "proof_required",
        RepairStarted { .. } => "repair_started",
        FocusedDiagnosisRequired { .. } => "focused_diagnosis_required",
        ReadyToLand => "ready_to_land",
        NarrativeRecorded => "narrative_recorded",
        IndependentReviewRequired { .. } => "independent_review_required",
        ConfigDecisionRequired => "config_decision_required",
        InfrastructurePaused => "infrastructure_paused",
        AuthorityRequired => "authority_required",
        DoomLoopPermissionRequired => "doom_loop_permission_required",
        RepairBudgetExhausted => "repair_budget_exhausted",
        LandTransactionPrepared { .. } => "land_transaction_prepared",
        Landed => "landed",
    }
}

fn phase_name(phase: &changeloop_harness::LifecyclePhase) -> &'static str {
    use changeloop_harness::LifecyclePhase::*;
    match phase {
        Change => "change",
        Build => "build",
        Prove => "prove",
        Repair => "repair",
        Diagnosis => "diagnosis",
        Review => "review",
        ReadyToLand => "ready_to_land",
        Landing => "landing",
        Landed => "landed",
        Paused(_) => "paused",
    }
}

fn snapshot_setup() -> (
    tempfile::TempDir,
    SnapshotManager,
    changeloop_snapshot::CheckpointId,
) {
    let root = tempfile::tempdir().unwrap();
    let worktree = root.path().join("worktree");
    let state = root.path().join("state");
    fs::create_dir_all(&worktree).unwrap();
    fs::write(worktree.join("changed"), "old").unwrap();
    fs::write(worktree.join("unrelated"), "base").unwrap();
    let mut manager = SnapshotManager::new(&worktree, &state).unwrap();
    let pending = manager.begin_step([PathBuf::from("changed")], 1).unwrap();
    fs::write(worktree.join("changed"), "new").unwrap();
    let id = manager
        .commit_step(pending, 2, ["proof-a".into()].into_iter().collect())
        .unwrap();
    fs::write(worktree.join("unrelated"), "user").unwrap();
    (root, manager, id)
}

fn authority(transaction: &str, explicit: bool) -> ExternalLandAuthority {
    ExternalLandAuthority {
        grant: LandAuthority {
            authority_id: "external-grant".into(),
            actor: "user".into(),
            expected_revision: "rev-1".into(),
            explicit,
        },
        source: AuthoritySource::User,
        change_id: "change-1".into(),
        transaction_id: transaction.into(),
        granted_at_ms: 1,
        expires_at_ms: 100,
    }
}

fn setup() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("target");
    let sandbox = root.path().join("sandbox");
    let state = root.path().join("state");
    fs::create_dir_all(&target).unwrap();
    fs::create_dir_all(&sandbox).unwrap();
    fs::write(target.join("a"), b"old").unwrap();
    fs::write(sandbox.join("a"), b"new").unwrap();
    (root, target, sandbox, state)
}

fn prepare(target: &Path, sandbox: &Path, state: &Path, transaction: &str) -> PathBuf {
    prepare_land(
        target,
        sandbox,
        state,
        "change-1",
        transaction,
        "rev-1",
        [PathBuf::from("a")],
        authority(transaction, true),
        10,
    )
    .unwrap()
}

fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    let output = match command.as_str() {
        "evidence-stable-hash" => {
            json!({"digest":stable_hash(&json!({"alpha":1,"beta":[true,"two"]})).unwrap()})
        }
        "evidence-json-valid" => {
            json!({"parsed":parse_json_output("  {\"ok\":true,\"count\":2} ")})
        }
        "evidence-json-invalid" => json!({"parsed":parse_json_output("not json")}),
        "evidence-tap-summary" => json!(
            parse_tap_output("TAP version 13\n1..2\n# tests 2\n# pass 1\n# fail 1\n").unwrap()
        ),
        "evidence-mutation-line" => {
            json!({"result":mutation_protocol_result("noise\nFOUNDATION_MUTATION_RESULT=behavioral-kill\n")})
        }
        "evidence-numeric-nested" => {
            json!({"value":numeric_report_value(&json!({"summary":{"covered":17}}), &["covered"])})
        }
        "policy-passive-read" => policy_json(&policy_request()),
        "policy-plan-write" => {
            let mut request = policy_request();
            request.mode = ExecutionMode::Plan;
            request.permission = PermissionKind::FilesystemWrite;
            request.operation = OperationKind::Write;
            policy_json(&request)
        }
        "policy-yolo-hard-boundary" => {
            let mut request = policy_request();
            request.mode = ExecutionMode::Yolo;
            request.hard_boundaries = vec![HardBoundary::ProofRequired];
            policy_json(&request)
        }
        "policy-yolo-tool-ask" => {
            let mut request = policy_request();
            request.mode = ExecutionMode::Yolo;
            request.configured_action = RuleAction::Ask;
            request.permission = PermissionKind::Shell;
            request.operation = OperationKind::Execute;
            // This legacy parity case measures YOLO suppressing an otherwise
            // eligible per-tool prompt. It is already inside a confirmed
            // change; conversation execution is a separate hard boundary and
            // is covered by policy/app integration regressions.
            request.lifecycle_authority = LifecycleAuthority::ConfirmedChange;
            request.sandbox = SandboxCapability::DangerFullAccess;
            policy_json(&request)
        }
        "policy-doom-loop" => {
            let mut request = policy_request();
            request.permission = PermissionKind::DoomLoop;
            request.operation = OperationKind::Execute;
            policy_json(&request)
        }
        "policy-lifecycle-unconfirmed" => {
            let mut request = policy_request();
            request.permission = PermissionKind::Lifecycle;
            request.operation = OperationKind::Lifecycle;
            request.lifecycle_authority = LifecycleAuthority::Conversation;
            policy_json(&request)
        }
        "policy-untrusted-authority" => {
            let allowed = |provenance, explicit_user_authority| {
                may_change_authority(AuthorityChangeRequest {
                    provenance,
                    explicit_user_authority,
                })
            };
            json!({
                "repository":allowed(ContextProvenance::RepositoryContent, true),
                "web":allowed(ContextProvenance::WebContent, true),
                "model":allowed(ContextProvenance::ModelGenerated, true),
                "explicitUser":allowed(ContextProvenance::UserInput, true),
                "trustedPolicy":allowed(ContextProvenance::TrustedPolicy, false)
            })
        }
        "policy-unknown-classifier" => {
            let mut request = policy_request();
            request.classifier_version += 1;
            policy_json(&request)
        }
        "lifecycle-narrative-no-proof" => {
            let mut state = harness(BTreeSet::new());
            let before = phase_name(state.phase());
            let effect = state.record_agent_narrative("done", 1);
            json!({"effect":effect_name(&effect),"before":before,"after":phase_name(state.phase())})
        }
        "lifecycle-low-risk-ready" => {
            let mut state = harness(BTreeSet::new());
            let build = state.complete_build("rev-1").unwrap();
            let proof = state.record_proof(receipt("rev-1")).unwrap();
            json!({"build":effect_name(&build),"proof":effect_name(&proof),"phase":phase_name(state.phase())})
        }
        "lifecycle-stale-receipt" => {
            let mut state = harness(BTreeSet::new());
            state.complete_build("rev-1").unwrap();
            let accepted = state.record_proof(receipt("rev-old")).is_ok();
            json!({"accepted":accepted,"phase":phase_name(state.phase())})
        }
        "lifecycle-repeat-cause-diagnosis" => {
            let mut state = harness(BTreeSet::new());
            state.complete_build("rev-1").unwrap();
            let failure = || ProofFailure {
                provider: "unit".into(),
                cause_id: "same-cause".into(),
                class: FailureClass::Code,
                summary: "failed".into(),
                observed_at_ms: 3,
            };
            let first = state
                .record_failure(failure(), Some(OperationId::from_stable("repair-1")))
                .unwrap();
            state
                .complete_repair(
                    &OperationId::from_stable("repair-1"),
                    "rev-2",
                    ["unit".into()].into_iter().collect(),
                    "progress-1",
                )
                .unwrap();
            let second = state.record_failure(failure(), None).unwrap();
            json!({"first":effect_name(&first),"second":effect_name(&second),"phase":phase_name(state.phase())})
        }
        "lifecycle-review-hypothesis-rejected" => {
            let mut state = harness([RiskTrigger::SecurityBoundary].into_iter().collect());
            state.complete_build("rev-1").unwrap();
            state.record_proof(receipt("rev-1")).unwrap();
            let accepted = state
                .submit_review(
                    "review-1",
                    ReviewContext {
                        reviewer_session_id: "reviewer".into(),
                        implementation_session_id: "impl-session".into(),
                        clean_context: true,
                        reviewer_model_family: "other".into(),
                        implementation_model_family: "impl".into(),
                        independent_model_family_required: false,
                    },
                    vec![ReviewFinding {
                        state: FindingState::Hypothesis,
                        summary: "maybe".into(),
                        blocking: true,
                        reproduction_evidence: vec![],
                        affected_providers: ["unit".into()].into_iter().collect(),
                        accepted_risk_authority: None,
                    }],
                    4,
                )
                .is_ok();
            json!({"accepted":accepted,"phase":phase_name(state.phase())})
        }
        "lifecycle-requirement-change" => {
            let mut state = harness(BTreeSet::new());
            state.complete_build("rev-1").unwrap();
            state.record_proof(receipt("rev-1")).unwrap();
            let effect = state
                .requirements_changed(
                    "rev-2",
                    requirements(),
                    &["unit".into()].into_iter().collect(),
                )
                .unwrap();
            let stale = state.proof_records().get("unit").is_some_and(|record| {
                !matches!(record.freshness, changeloop_harness::Freshness::Fresh)
            });
            json!({"effect":effect_name(&effect),"freshness":if stale {"stale"} else {"fresh"},"phase":phase_name(state.phase())})
        }
        "snapshot-undo-preserves-unrelated" => {
            let (root, mut manager, id) = snapshot_setup();
            let outcome = manager.undo(&id, 3).unwrap();
            json!({"changed":fs::read_to_string(root.path().join("worktree/changed")).unwrap(),"unrelated":fs::read_to_string(root.path().join("worktree/unrelated")).unwrap(),"invalidated":outcome.invalidated_proof_references,"audit":match outcome.audit.kind { AuditKind::Undo => "undo", AuditKind::Redo => "redo" }})
        }
        "snapshot-redo" => {
            let (root, mut manager, id) = snapshot_setup();
            manager.undo(&id, 3).unwrap();
            manager.redo(4).unwrap();
            json!({"changed":fs::read_to_string(root.path().join("worktree/changed")).unwrap(),"unrelated":fs::read_to_string(root.path().join("worktree/unrelated")).unwrap(),"redoAvailable":manager.redo_available(),"audits":manager.audit_log().len()})
        }
        "snapshot-external-conflict" => {
            let (root, mut manager, id) = snapshot_setup();
            fs::write(root.path().join("worktree/changed"), "external").unwrap();
            let conflict = matches!(
                manager.undo(&id, 3),
                Err(SnapshotError::ExternalModification { .. })
            );
            json!({"conflict":conflict,"content":fs::read_to_string(root.path().join("worktree/changed")).unwrap(),"auditCount":manager.audit_log().len()})
        }
        "authority-denial" => {
            let (_root, target, sandbox, state) = setup();
            let allowed = prepare_land(
                &target,
                &sandbox,
                &state,
                "change-1",
                "tx",
                "rev-1",
                [PathBuf::from("a")],
                authority("tx", false),
                10,
            )
            .is_ok();
            json!({"allowed":allowed,"reason":"explicit_external_authority_required"})
        }
        "telemetry-unknowns" => {
            let mut ledger = UsageLedger::default();
            ledger
                .record(UsageAccounting {
                    pricing_catalog_version: "unpriced".into(),
                    pricing_source: "fixture".into(),
                    provider_request_id: Measurement::Known("req-1".into()),
                    tokens: TokenUsage {
                        input: Measurement::Unknown {
                            reason: "input omitted".into(),
                        },
                        output: Measurement::Known(4),
                        cache_read: Measurement::Unknown {
                            reason: "cache omitted".into(),
                        },
                        cache_write: Measurement::Known(0),
                        reasoning: Measurement::Unknown {
                            reason: "reasoning omitted".into(),
                        },
                    },
                    estimated_cost: Measurement::<MoneyMicros>::Unknown {
                        reason: "pricing unavailable".into(),
                    },
                    provider_reported_cost: Measurement::<MoneyMicros>::Unknown {
                        reason: "provider cost omitted".into(),
                    },
                    quota_remaining: Measurement::Unknown {
                        reason: "quota omitted".into(),
                    },
                    quota_reset_at_ms: Measurement::Unknown {
                        reason: "quota omitted".into(),
                    },
                })
                .unwrap();
            let totals = ledger.totals();
            json!({"inputTokens":totals.input_tokens,"outputTokens":totals.output_tokens,"requestCount":totals.request_count})
        }
        "land-conflict" => {
            let (_root, target, sandbox, state) = setup();
            let journal = prepare(&target, &sandbox, &state, "tx-conflict");
            fs::write(target.join("a"), b"external").unwrap();
            let _ = apply_land(&target, &journal, "rev-1", 11, ApplyControl::default());
            let status: changeloop_land::LandJournal =
                serde_json::from_slice(&fs::read(journal).unwrap()).unwrap();
            json!({"content":String::from_utf8(fs::read(target.join("a")).unwrap()).unwrap(),"overwroteExternal":false,"status":status.status})
        }
        "land-rollback" => {
            let (_root, target, sandbox, state) = setup();
            let journal = prepare(&target, &sandbox, &state, "tx-rollback");
            let _ = apply_land(
                &target,
                &journal,
                "rev-1",
                11,
                ApplyControl {
                    fail_after_paths: Some(1),
                    interrupt_after_paths: None,
                },
            );
            let status: changeloop_land::LandJournal =
                serde_json::from_slice(&fs::read(journal).unwrap()).unwrap();
            json!({"content":String::from_utf8(fs::read(target.join("a")).unwrap()).unwrap(),"status":status.status})
        }
        "land-recovery" => {
            let (_root, target, sandbox, state) = setup();
            let journal = prepare(&target, &sandbox, &state, "tx-recovery");
            let _ = apply_land(
                &target,
                &journal,
                "rev-1",
                11,
                ApplyControl {
                    fail_after_paths: None,
                    interrupt_after_paths: Some(1),
                },
            );
            let recovered = recover_land(&target, &journal, 12).unwrap();
            json!({"content":String::from_utf8(fs::read(target.join("a")).unwrap()).unwrap(),"status":recovered.status,"wasInterrupted":true})
        }
        "land-archive" => {
            let (_root, target, sandbox, state) = setup();
            let journal = prepare(&target, &sandbox, &state, "tx-archive");
            apply_land(&target, &journal, "rev-1", 11, ApplyControl::default()).unwrap();
            let archive = changeloop_land::archive_land(
                &target,
                &journal,
                &state.join("archive"),
                &[],
                &UsageLedger::default(),
                12,
            )
            .unwrap();
            let status: changeloop_land::LandJournal =
                serde_json::from_slice(&fs::read(journal).unwrap()).unwrap();
            json!({"content":fs::read_to_string(target.join("a")).unwrap(),"status":status.status,"changeId":archive.change_id,"commitPerformed":archive.commit_performed,"pushPerformed":archive.push_performed})
        }
        _ => {
            eprintln!("unknown parity case");
            std::process::exit(2);
        }
    };
    println!("{}", serde_json::to_string(&output).unwrap());
}
