use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::process::Command;

use changeloop_evidence::*;
use serde_json::json;
use tempfile::tempdir;

fn fixture() -> (
    tempfile::TempDir,
    ArtifactStore,
    Receipt,
    ReceiptExpectation,
) {
    let root = tempdir().unwrap();
    let vault = root.path().join(".foundation/evidence");
    let store = ArtifactStore::new(root.path(), &vault).unwrap();
    fs::write(root.path().join("result.log"), "verified output\n").unwrap();
    let artifact = store
        .ingest(
            "change-1",
            "run-1",
            "test",
            root.path(),
            "result.log",
            "command-log",
            true,
        )
        .unwrap();
    let receipt = Receipt {
        version: RECEIPT_VERSION,
        change_id: "change-1".into(),
        provider: "test".into(),
        provider_version: "1".into(),
        adapter: "external".into(),
        adapter_protocol_version: "adapter-v1".into(),
        provider_protocol_version: "provider-v1".into(),
        contract_fingerprint: "contract-a".into(),
        execution_fingerprint: "execution-a".into(),
        provider_fingerprint: "provider-a".into(),
        workspace_hash: "workspace-a".into(),
        workspace_snapshot_id: Some("snapshot-a".into()),
        input_identity: InputIdentity::global("workspace-a").unwrap(),
        claims: BTreeSet::from(["claim-a".into()]),
        status: ReceiptStatus::Pass,
        observed: "command passed".into(),
        provenance: Provenance {
            source: Some("command:test".into()),
            recorded_by: None,
        },
        references: vec![],
        artifacts: vec![artifact],
        proof_run_id: "run-1".into(),
        started_at: "2026-08-04T00:00:00Z".into(),
        finished_at: "2026-08-04T00:00:01Z".into(),
        extensions: BTreeMap::new(),
    };
    let expected = ReceiptExpectation {
        provider_protocol_version: "provider-v1".into(),
        contract_fingerprint: "contract-a".into(),
        provider_fingerprint: "provider-a".into(),
        workspace_hash: "workspace-a".into(),
        input_identity: receipt.input_identity.clone(),
        required_claims: BTreeSet::from(["claim-a".into()]),
    };
    (root, store, receipt, expected)
}

#[test]
fn rust_matches_node_for_valid_stale_and_tampered_receipts() {
    let node_root = tempdir().unwrap();
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../scripts/oracle/evidence-parity.mjs");
    let output = Command::new("node")
        .arg(script)
        .arg(node_root.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let node: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();

    let (root, store, receipt, expected) = fixture();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(root.path().join(&receipt.artifacts[0].path))
                .unwrap()
                .permissions()
                .mode()
                & 0o077,
            0
        );
    }
    let valid = validate_receipt(&receipt, &expected, &store);
    let mut stale = receipt.clone();
    stale.workspace_hash = "workspace-old".into();
    let stale = validate_receipt(&stale, &expected, &store);
    fs::write(root.path().join(&receipt.artifacts[0].path), "tampered\n").unwrap();
    let tampered = validate_receipt(&receipt, &expected, &store);
    let rust = json!([
        {"name":"valid", "validity": valid},
        {"name":"stale", "validity": stale},
        {"name":"tampered", "validity": tampered}
    ]);
    assert_eq!(rust, node);
}

#[test]
fn claim_coverage_and_declared_input_reuse_are_independent() {
    let (_root, store, mut receipt, mut expected) = fixture();
    expected.workspace_hash = "workspace-new".into();
    receipt.input_identity = InputIdentity::declared(
        vec!["src/**".into()],
        vec![InputFile {
            path: "src/lib.rs".into(),
            sha256: "abc".into(),
        }],
    )
    .unwrap();
    expected.input_identity = receipt.input_identity.clone();
    assert_eq!(
        validate_receipt(&receipt, &expected, &store),
        ReceiptValidity::ReusableInputs
    );
    receipt.claims.clear();
    assert_eq!(
        validate_receipt(&receipt, &expected, &store),
        ReceiptValidity::IncompleteClaims
    );
}

#[test]
fn current_receipts_round_trip_without_mutating_final_runs() {
    let (root, _store, receipt, _expected) = fixture();
    let receipts = ReceiptStore::new(root.path().join(".foundation/receipts")).unwrap();
    receipts.record(&receipt).unwrap();
    assert_eq!(receipts.load("change-1", "test").unwrap(), Some(receipt));
    assert_eq!(receipts.load("change-1", "missing").unwrap(), None);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(root.path().join(".foundation/receipts/change-1/test.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "receipt must not be group/world readable");
    }
}

#[test]
fn current_receipt_loading_rejects_oversized_json() {
    let root = tempdir().unwrap();
    let receipts_root = root.path().join("receipts");
    let change_root = receipts_root.join("change-1");
    fs::create_dir_all(&change_root).unwrap();
    fs::File::create(change_root.join("test.json"))
        .unwrap()
        .set_len(16 * 1024 * 1024 + 1)
        .unwrap();
    let receipts = ReceiptStore::new(&receipts_root).unwrap();

    assert!(matches!(
        receipts.load("change-1", "test"),
        Err(EvidenceError::JsonTooLarge { limit: 16_777_216 })
    ));
}

#[test]
fn current_receipt_record_rejects_unbounded_collections_before_writing() {
    let (root, _store, mut receipt, _expected) = fixture();
    receipt.references = vec!["ref".into(); MAX_RECEIPT_ITEMS + 1];
    let receipts_root = root.path().join("receipts");
    let receipts = ReceiptStore::new(&receipts_root).unwrap();

    assert!(matches!(
        receipts.record(&receipt),
        Err(EvidenceError::CollectionLimit {
            kind: "receipt references",
            limit: MAX_RECEIPT_ITEMS
        })
    ));
    assert!(!receipts_root.join("change-1/test.json").exists());
}

#[test]
fn current_receipt_record_never_writes_json_its_loader_rejects() {
    let (root, _store, mut receipt, _expected) = fixture();
    receipt.observed = "x".repeat(16 * 1024 * 1024);
    let receipts_root = root.path().join("receipts");
    let receipts = ReceiptStore::new(&receipts_root).unwrap();

    assert!(matches!(
        receipts.record(&receipt),
        Err(EvidenceError::JsonTooLarge { limit: 16_777_216 })
    ));
    assert!(!receipts_root.join("change-1/test.json").exists());
}

#[test]
fn receipt_store_rejects_wrong_version_identity_and_input_fingerprint() {
    let (root, _store, receipt, _expected) = fixture();
    let receipts = ReceiptStore::new(root.path().join("receipts")).unwrap();

    let mut wrong_version = receipt.clone();
    wrong_version.version = RECEIPT_VERSION - 1;
    assert!(matches!(
        receipts.record(&wrong_version),
        Err(EvidenceError::InvalidReceipt { validity, .. }) if validity == "unsupported-version"
    ));

    let mut wrong_fingerprint = receipt;
    wrong_fingerprint.input_identity.fingerprint = "forged".into();
    assert!(matches!(
        receipts.record(&wrong_fingerprint),
        Err(EvidenceError::InvalidReceipt { validity, .. }) if validity == "input-fingerprint-mismatch"
    ));
}

#[cfg(unix)]
#[test]
fn receipt_store_rejects_symlinked_directories_files_and_hardlinks() {
    use std::os::unix::fs::symlink;

    let (root, _store, receipt, _expected) = fixture();
    let receipts_root = root.path().join("receipts");
    let outside = tempdir().unwrap();
    fs::create_dir_all(&receipts_root).unwrap();
    symlink(outside.path(), receipts_root.join("change-1")).unwrap();
    let receipts = ReceiptStore::new(&receipts_root).unwrap();
    assert!(matches!(
        receipts.record(&receipt),
        Err(EvidenceError::UnsafePath(_))
    ));
    assert!(!outside.path().join("test.json").exists());

    fs::remove_file(receipts_root.join("change-1")).unwrap();
    fs::create_dir(receipts_root.join("change-1")).unwrap();
    let outside_receipt = outside.path().join("receipt.json");
    fs::write(&outside_receipt, serde_json::to_vec(&receipt).unwrap()).unwrap();
    symlink(&outside_receipt, receipts_root.join("change-1/test.json")).unwrap();
    assert!(matches!(
        receipts.load("change-1", "test"),
        Err(EvidenceError::UnsafePath(_))
    ));

    fs::remove_file(receipts_root.join("change-1/test.json")).unwrap();
    fs::hard_link(&outside_receipt, receipts_root.join("change-1/test.json")).unwrap();
    assert!(matches!(
        receipts.load("change-1", "test"),
        Err(EvidenceError::UnsafePath(_))
    ));
}

#[test]
fn readiness_precedence_matches_node_contract() {
    let mut input = ReadinessInput::default();
    assert_eq!(input.status(), ReadinessStatus::Ready);
    input.external_providers.push("review".into());
    assert_eq!(input.status(), ReadinessStatus::NeedsUserDecision);
    input.unavailable_providers.push("test:command".into());
    assert_eq!(input.status(), ReadinessStatus::InfrastructureError);
    input.active_leases.push("T001".into());
    assert_eq!(input.status(), ReadinessStatus::BlockedByActiveWork);
    input.configuration_issues.push("dependency cycle".into());
    assert_eq!(input.status(), ReadinessStatus::ConfigurationError);
    input.pending_tasks.push("T002".into());
    assert_eq!(input.status(), ReadinessStatus::NeedsCodeChange);
}

#[test]
fn finalized_proof_is_immutable_and_tamper_evident() {
    let (root, store, receipt, expected) = fixture();
    let finalizer = ProofFinalizer::new(&store, "proof-v1");
    let receipts = BTreeMap::from([("test".into(), receipt)]);
    let expectations = BTreeMap::from([("test".into(), expected)]);
    let proof = finalizer
        .finalize(
            "change-1",
            "final-1",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &receipts,
            &expectations,
            vec![],
            "2026-08-04T00:00:02Z",
        )
        .unwrap();
    assert!(matches!(
        finalizer.audit("change-1", "final-1"),
        ProofAudit::Valid(_)
    ));
    assert!(matches!(
        finalizer.finalize(
            "change-1",
            "final-1",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &receipts,
            &expectations,
            vec![],
            "later"
        ),
        Err(EvidenceError::ImmutableProofRun)
    ));
    fs::write(root.path().join(&proof.receipts[0].path), "{}\n").unwrap();
    assert_eq!(
        finalizer.audit("change-1", "final-1"),
        ProofAudit::Invalid("receipt-tampered:test".into())
    );
}

#[test]
fn proof_finalization_rejects_provider_and_receipt_identity_mismatch() {
    let (root, store, receipt, expected) = fixture();
    let finalizer = ProofFinalizer::new(&store, "proof-v1");
    let mut extra_receipts = BTreeMap::from([("test".into(), receipt.clone())]);
    extra_receipts.insert("extra".into(), receipt.clone());
    let expectations = BTreeMap::from([("test".into(), expected.clone())]);
    assert!(matches!(
        finalizer.finalize(
            "change-1",
            "provider-mismatch",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &extra_receipts,
            &expectations,
            vec![],
            "2026-08-04T00:00:02Z",
        ),
        Err(EvidenceError::InvalidProofProviderSet)
    ));

    let mut wrong_execution = receipt;
    wrong_execution.execution_fingerprint = "different-execution".into();
    assert!(matches!(
        finalizer.finalize(
            "change-1",
            "identity-mismatch",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &BTreeMap::from([("test".into(), wrong_execution)]),
            &expectations,
            vec![],
            "2026-08-04T00:00:02Z",
        ),
        Err(EvidenceError::InvalidReceipt { validity, .. }) if validity == "proof-identity-mismatch"
    ));
    assert!(
        !root
            .path()
            .join(".foundation/evidence/change-1/identity-mismatch")
            .exists()
    );
}

#[test]
fn proof_audit_rejects_manifest_identity_and_provider_entry_forgery() {
    let (root, store, receipt, expected) = fixture();
    let finalizer = ProofFinalizer::new(&store, "proof-v1");
    finalizer
        .finalize(
            "change-1",
            "audit-identity",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &BTreeMap::from([("test".into(), receipt)]),
            &BTreeMap::from([("test".into(), expected)]),
            vec![],
            "2026-08-04T00:00:02Z",
        )
        .unwrap();
    let manifest = root
        .path()
        .join(".foundation/evidence/change-1/audit-identity/manifest.json");
    let mut proof: ProofManifest = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    proof.version = PROOF_VERSION - 1;
    fs::write(&manifest, serde_json::to_vec_pretty(&proof).unwrap()).unwrap();
    assert_eq!(
        finalizer.audit("change-1", "audit-identity"),
        ProofAudit::Invalid("proof-identity-mismatch".into())
    );

    proof.version = PROOF_VERSION;
    proof.providers = vec!["different".into()];
    fs::write(&manifest, serde_json::to_vec_pretty(&proof).unwrap()).unwrap();
    assert_eq!(
        finalizer.audit("change-1", "audit-identity"),
        ProofAudit::Invalid("proof-provider-manifest-mismatch".into())
    );
}

#[test]
fn artifact_and_proof_identifiers_cannot_escape_the_vault() {
    let (root, store, receipt, expected) = fixture();
    let outside = root.path().join(".foundation/outside-proof");

    assert!(matches!(
        store.ingest(
            "../outside-proof",
            "run-1",
            "test",
            root.path(),
            "result.log",
            "command-log",
            true,
        ),
        Err(EvidenceError::UnsafePath(_))
    ));

    let finalizer = ProofFinalizer::new(&store, "proof-v1");
    let receipts = BTreeMap::from([("test".into(), receipt)]);
    let expectations = BTreeMap::from([("test".into(), expected)]);
    assert!(matches!(
        finalizer.finalize(
            "../outside-proof",
            "final-1",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &receipts,
            &expectations,
            vec![],
            "2026-08-04T00:00:02Z",
        ),
        Err(EvidenceError::UnsafePath(_))
    ));
    assert_eq!(
        finalizer.audit("change-1", "../outside-proof"),
        ProofAudit::Invalid("unsafe-proof-identity".into())
    );
    assert!(!outside.exists());

    let oversized = "a".repeat(257);
    assert!(matches!(
        store.ingest(
            &oversized,
            "run-1",
            "test",
            root.path(),
            "result.log",
            "command-log",
            true,
        ),
        Err(EvidenceError::UnsafePath(_))
    ));
}

#[test]
fn proof_finalization_rejects_unbounded_artifact_counts_before_writing() {
    let (root, store, receipt, expected) = fixture();
    let finalizer = ProofFinalizer::new(&store, "proof-v1");
    let artifact = receipt.artifacts[0].clone();
    let receipts = BTreeMap::from([("test".into(), receipt)]);
    let expectations = BTreeMap::from([("test".into(), expected)]);

    assert!(matches!(
        finalizer.finalize(
            "change-1",
            "too-many",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &receipts,
            &expectations,
            vec![artifact; MAX_PROOF_ARTIFACTS + 1],
            "2026-08-04T00:00:02Z",
        ),
        Err(EvidenceError::CollectionLimit {
            kind: "proof artifacts",
            limit: MAX_PROOF_ARTIFACTS
        })
    ));
    assert!(
        !root
            .path()
            .join(".foundation/evidence/change-1/too-many")
            .exists()
    );
}

#[test]
fn proof_finalization_rejects_required_artifact_marked_missing() {
    let (_root, store, receipt, expected) = fixture();
    let finalizer = ProofFinalizer::new(&store, "proof-v1");
    let missing_required = ArtifactRef {
        path: "missing.log".into(),
        source_path: None,
        kind: "log".into(),
        required: true,
        missing: true,
        quarantined: false,
        sha256: None,
        size: None,
    };
    assert!(matches!(
        finalizer.finalize(
            "change-1",
            "missing-required",
            "workspace-a",
            "snapshot-a",
            "contract-a",
            "execution-a",
            &BTreeMap::from([("test".into(), receipt)]),
            &BTreeMap::from([("test".into(), expected)]),
            vec![missing_required],
            "2026-08-04T00:00:02Z",
        ),
        Err(EvidenceError::InvalidProofArtifact)
    ));
}

#[cfg(unix)]
#[test]
fn artifact_symlink_cannot_escape_workspace() {
    use std::os::unix::fs::symlink;
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret"), "nope").unwrap();
    symlink(outside.path().join("secret"), root.path().join("leak")).unwrap();
    let store = ArtifactStore::new(root.path(), root.path().join(".foundation/evidence")).unwrap();
    assert!(matches!(
        store.ingest("c", "r", "p", root.path(), "leak", "artifact", true),
        Err(EvidenceError::ArtifactNotFile)
    ));
}

#[cfg(unix)]
#[test]
fn artifact_destination_symlink_and_hardlink_are_rejected_without_external_write() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let vault = root.path().join("vault");
    let store = ArtifactStore::new(root.path(), &vault).unwrap();
    let source = root.path().join("result.log");
    fs::write(&source, "immutable-evidence").unwrap();
    let digest = file_digest(&source).unwrap();
    let provider_root = vault.join("change/run/artifacts/provider");
    fs::create_dir_all(&provider_root).unwrap();
    let outside = root.path().join("outside");
    fs::write(&outside, "do-not-touch").unwrap();
    symlink(
        &outside,
        provider_root.join(format!("{}-result.log", &digest[..12])),
    )
    .unwrap();
    assert!(matches!(
        store.ingest(
            "change",
            "run",
            "provider",
            root.path(),
            "result.log",
            "log",
            true,
        ),
        Err(EvidenceError::UnsafePath(_))
    ));
    assert_eq!(fs::read_to_string(&outside).unwrap(), "do-not-touch");

    fs::remove_file(provider_root.join(format!("{}-result.log", &digest[..12]))).unwrap();
    let artifact = store
        .ingest(
            "change",
            "run",
            "provider",
            root.path(),
            "result.log",
            "log",
            true,
        )
        .unwrap();
    fs::hard_link(root.path().join(&artifact.path), root.path().join("alias")).unwrap();
    assert!(!store.validate(&artifact));
}

#[test]
fn javascript_stable_hash_parity_is_exact() {
    // sha256(JSON.stringify({mode:"global",workspaceHash:"abc"}))
    let identity = InputIdentity::global("abc").unwrap();
    assert_eq!(
        identity.fingerprint,
        "7bfd94b60cf80c87596b1050a608bd7985e7668b295639c6cdede2ec2f4840d3"
    );
}

#[test]
fn provider_result_parsers_preserve_unknown_and_measured_results() {
    assert_eq!(parse_json_output(""), None);
    assert_eq!(parse_json_output("{bad"), None);
    assert_eq!(
        numeric_report_value(&json!({"stats":{"tests":7}}), &["totalTests", "tests"]),
        Some(7)
    );
    assert_eq!(
        numeric_report_value(&json!({"totalTests":"7"}), &["totalTests"]),
        None
    );
    assert_eq!(
        mutation_protocol_result("FOUNDATION_MUTATION_RESULT=crash\n"),
        Some(MutationResult::Crash)
    );
    assert_eq!(
        parse_tap_output("TAP version 13\nok 1 - works\n1..1\n# tests 1\n# pass 1\n# fail 0\n"),
        Some(TapSummary {
            total_tests: 1,
            passed: Some(1),
            failed: Some(0),
            format: "tap".into()
        })
    );
    let summary = playwright_report_summary(&json!({"suites":[{"specs":[{
        "annotations":[{"type":"claim","description":"claim-a"}],
        "attachments":[{"path":"trace.zip"}],
        "results":[{"status":"failed"}]
    }]}]}));
    assert_eq!(summary.claims, ["claim-a"]);
    assert_eq!(summary.attachments, ["trace.zip"]);
    assert_eq!((summary.tests, summary.failed, summary.skipped), (1, 1, 0));
}

#[test]
fn contract_rejects_dependency_cycles() {
    let claim = EvidenceClaim {
        id: "claim-a".into(),
        scenario: "works".into(),
        impact: Some("low".into()),
        capabilities: BTreeSet::from(["test".into()]),
        repositories: BTreeSet::new(),
    };
    let provider = |depends_on| ProviderContract {
        capability: "test".into(),
        adapter: "command".into(),
        version: "1".into(),
        command: vec!["test".into()],
        claims: None,
        inputs: vec![],
        depends_on,
        options: BTreeMap::new(),
    };
    let contract = EvidenceContract {
        version: 2,
        claims: vec![claim],
        invariants: vec![],
        providers: BTreeMap::from([
            ("a".into(), provider(BTreeSet::from(["b".into()]))),
            ("b".into(), provider(BTreeSet::from(["a".into()]))),
        ]),
    };
    assert!(
        matches!(contract.validate(&BTreeSet::from(["test".into()])), Err(EvidenceError::InvalidContract(message)) if message.contains("dependency cycle"))
    );
}
