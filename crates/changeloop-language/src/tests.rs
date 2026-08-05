use super::*;
use std::process::Command;
use tempfile::tempdir;

#[cfg(unix)]
static PROCESS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(unix)]
fn process_test_guard() -> std::sync::MutexGuard<'static, ()> {
    PROCESS_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(path, permissions).unwrap();
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) {}

#[test]
fn resolver_uses_project_owned_executables_and_reports_absence() {
    let project = tempdir().unwrap();
    fs::create_dir_all(project.path().join("node_modules/.bin")).unwrap();
    let binary = project.path().join("node_modules/.bin/language-server");
    fs::write(&binary, b"server").unwrap();
    make_executable(&binary);
    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    assert!(matches!(
        resolver.resolve(Path::new("node_modules/.bin/language-server")),
        ToolAvailability::Available(_)
    ));
    assert!(matches!(
        resolver.resolve(Path::new("node_modules/.bin/missing")),
        ToolAvailability::Absent(LifecycleDiagnostic {
            code: "project_tool_absent",
            ..
        })
    ));
    assert!(matches!(
        resolver.resolve(Path::new("/usr/bin/server")),
        ToolAvailability::Rejected(_)
    ));
}

#[test]
fn file_uri_percent_encodes_reserved_path_bytes() {
    let path = Path::new("/project/space # percent%.rs");
    assert_eq!(
        path_to_file_uri(path),
        "file:///project/space%20%23%20percent%25.rs"
    );
}

#[cfg(unix)]
#[test]
fn resolver_rejects_project_symlink_to_external_binary() {
    use std::os::unix::fs::symlink;
    let project = tempdir().unwrap();
    let external = tempdir().unwrap();
    let binary = external.path().join("server");
    fs::write(&binary, b"server").unwrap();
    make_executable(&binary);
    symlink(&binary, project.path().join("server")).unwrap();
    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    assert!(matches!(
        resolver.resolve(Path::new("server")),
        ToolAvailability::Rejected(LifecycleDiagnostic {
            code: "tool_symlink_outside_project",
            ..
        })
    ));
}

#[test]
fn diagnostics_are_debounced_versioned_and_expire() {
    let document = DocumentUri("file:///project/src/lib.rs".into());
    let mut coordinator = DiagnosticsCoordinator::new(50, 100);
    coordinator.file_changed(document.clone(), 2, 10);
    assert!(coordinator.due_pulls(59).is_empty());
    let requests = coordinator.due_pulls(60);
    assert_eq!(requests.len(), 1);
    assert!(!coordinator.accept_push(&document, 1, Vec::new(), 61));
    assert!(coordinator.accept_pull(&requests[0], Vec::new(), 70));
    assert_eq!(
        coordinator.snapshot(&document, 170).freshness,
        DiagnosticFreshness::Fresh
    );
    assert_eq!(
        coordinator.snapshot(&document, 171).freshness,
        DiagnosticFreshness::Stale
    );
    assert_eq!(coordinator.due_pulls(171).len(), 1);
}

#[test]
fn diagnostics_reject_regressing_changes_and_in_flight_stale_results() {
    let document = DocumentUri("file:///project/src/lib.rs".into());
    let mut coordinator = DiagnosticsCoordinator::new(10, 100);
    coordinator.file_changed(document.clone(), 2, 0);
    coordinator.file_changed(document.clone(), 1, 5);
    let request = coordinator.due_pulls(10).pop().unwrap();
    assert_eq!(request.expected_version, 2);
    coordinator.file_changed(document.clone(), 3, 11);
    assert!(!coordinator.accept_pull(&request, Vec::new(), 12));
    assert!(!coordinator.accept_push(&document, 4, Vec::new(), 12));
    assert_eq!(
        coordinator.snapshot(&document, 12).freshness,
        DiagnosticFreshness::Pending
    );
    assert_eq!(coordinator.due_pulls(21)[0].expected_version, 3);
}

#[test]
fn availability_loss_invalidates_diagnostics_from_the_old_process() {
    let document = DocumentUri("file:///project/src/lib.rs".into());
    let mut coordinator = DiagnosticsCoordinator::new(0, 100);
    coordinator.file_changed(document.clone(), 1, 0);
    assert!(coordinator.accept_push(&document, 1, Vec::new(), 1));
    coordinator.set_available(false);
    assert_eq!(
        coordinator.snapshot(&document, 2).freshness,
        DiagnosticFreshness::Unavailable
    );
    coordinator.set_available(true);
    let snapshot = coordinator.snapshot(&document, 3);
    assert_eq!(snapshot.freshness, DiagnosticFreshness::Pending);
    assert!(snapshot.diagnostics.is_empty());
    assert_eq!(coordinator.due_pulls(3)[0].expected_version, 1);
}

#[test]
fn unchanged_pull_refreshes_but_does_not_erase_the_last_diagnostics() {
    let document = DocumentUri("file:///project/src/lib.rs".into());
    let mut coordinator = DiagnosticsCoordinator::new(0, 10);
    coordinator.file_changed(document.clone(), 1, 0);
    let diagnostic = Diagnostic {
        range: TextRange {
            start: Position {
                line: 0,
                character: 0,
            },
            end: Position {
                line: 0,
                character: 1,
            },
        },
        severity: DiagnosticSeverity::Warning,
        code: Some("kept".into()),
        message: "keep me".into(),
    };
    assert!(coordinator.accept_push(&document, 1, vec![diagnostic], 1));
    let request = coordinator.due_pulls(12).pop().unwrap();
    assert!(coordinator.accept_pull_unchanged(&request, 13));
    let snapshot = coordinator.snapshot(&document, 13);
    assert_eq!(snapshot.freshness, DiagnosticFreshness::Fresh);
    assert_eq!(snapshot.diagnostics[0].code.as_deref(), Some("kept"));
}

#[test]
fn unavailable_lsp_is_an_explicit_diagnostic_not_success() {
    let document = DocumentUri("file:///project/main.rs".into());
    let mut coordinator = DiagnosticsCoordinator::new(0, 100);
    coordinator.set_available(false);
    let snapshot = coordinator.snapshot(&document, 0);
    assert_eq!(snapshot.freshness, DiagnosticFreshness::Unavailable);
    assert_eq!(snapshot.diagnostic.unwrap().code, "language_server_absent");
}

#[test]
fn scoped_disposal_cancels_pending_requests_without_affecting_peer() {
    let executable = ProjectExecutable {
        path: "server".into(),
        sha256: "hash".into(),
    };
    let mut first = ScopedLanguageServer::detected("project-a".into(), executable.clone());
    let mut second = ScopedLanguageServer::detected("project-b".into(), executable);
    first.mark_running();
    second.mark_running();
    let request = first.begin_request().unwrap();
    let cancelled = first.dispose();
    assert_eq!(cancelled, vec![request]);
    assert_eq!(first.state(), ProcessState::Disposed);
    assert_eq!(second.state(), ProcessState::Running);
    assert!(second.begin_request().is_ok());
}

#[test]
fn formatter_hashes_changes_and_invalidates_proof() {
    let result = FormatterConfig::record_output(Path::new("src/lib.rs"), b"before", b"after");
    assert_eq!(result.status, FormatterStatus::Formatted);
    assert!(result.proof_impact.edit_hash.is_some());
    assert_eq!(
        result.proof_impact.invalidated_paths,
        [PathBuf::from("src/lib.rs")]
    );
    assert!(result.proof_impact.requires_reprove);
    let unchanged = FormatterConfig::record_output(Path::new("src/lib.rs"), b"same", b"same");
    assert_eq!(unchanged.status, FormatterStatus::Unchanged);
    assert!(!unchanged.proof_impact.requires_reprove);
}

#[test]
fn absent_formatter_produces_unavailable_result() {
    let project = tempdir().unwrap();
    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    let config = FormatterConfig {
        name: "rustfmt".into(),
        executable: "tools/rustfmt".into(),
        arguments: vec!["--emit=stdout".into()],
        extensions: BTreeSet::from(["rs".into()]),
        scope_paths: BTreeSet::new(),
        timeout_ms: 1_000,
    };
    let result = config
        .invocation(&resolver, Path::new("src/lib.rs"))
        .unwrap_err();
    assert_eq!(result.status, FormatterStatus::Unavailable);
    assert_eq!(result.diagnostic.unwrap().code, "project_tool_absent");
}

#[test]
fn formatter_disposal_cancels_only_its_scoped_executions() {
    let config = FormatterConfig {
        name: "formatter".into(),
        executable: "tools/formatter".into(),
        arguments: Vec::new(),
        extensions: BTreeSet::from(["rs".into()]),
        scope_paths: BTreeSet::new(),
        timeout_ms: 100,
    };
    let executable = ProjectExecutable {
        path: "tools/formatter".into(),
        sha256: "hash".into(),
    };
    let mut first = ScopedFormatter::detected("first".into(), config.clone(), executable.clone());
    let mut second = ScopedFormatter::detected("second".into(), config, executable);
    first.mark_running();
    second.mark_running();
    let request = first.begin_format().unwrap();
    assert_eq!(first.dispose(), vec![request]);
    assert_eq!(first.state(), ProcessState::Disposed);
    assert!(second.begin_format().is_ok());
}

#[cfg(unix)]
fn compile_fake(root: &Path, name: &str, source: &str) -> PathBuf {
    let source_path = root.join(format!("{name}.rs"));
    let output = root.join("tools").join(name);
    fs::create_dir_all(output.parent().unwrap()).unwrap();
    fs::write(&source_path, source).unwrap();
    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    let status = Command::new(rustc)
        .args(["--edition=2021", "-o"])
        .arg(&output)
        .arg(&source_path)
        .status()
        .unwrap();
    assert!(status.success());
    output
}

#[cfg(unix)]
const FAKE_LSP: &str = r####"
use std::io::{self, BufRead, Read, Write};
use std::time::Duration;

fn send(value: &str) {
    let mut out = io::stdout().lock();
    write!(out, "Content-Length: {}\r\n\r\n{}", value.len(), value).unwrap();
    out.flush().unwrap();
}

fn id(body: &str) -> u64 {
    let tail = body.split("\"id\":").nth(1).unwrap();
    tail.chars().skip_while(|c| c.is_whitespace()).take_while(|c| c.is_ascii_digit())
        .collect::<String>().parse().unwrap()
}

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "normal".into());
    if mode == "env" && std::env::var_os("HOME").is_some() {
        std::fs::write("lsp-home-leaked", b"present").unwrap();
    }
    let stdin = io::stdin();
    let mut input = stdin.lock();
    loop {
        let mut length = None;
        loop {
            let mut header = String::new();
            if input.read_line(&mut header).unwrap() == 0 { return; }
            if header == "\r\n" { break; }
            if header.to_ascii_lowercase().starts_with("content-length:") {
                length = Some(header.split(':').nth(1).unwrap().trim().parse::<usize>().unwrap());
            }
        }
        let mut bytes = vec![0; length.unwrap()];
        input.read_exact(&mut bytes).unwrap();
        let body = String::from_utf8(bytes).unwrap();
        if body.contains("\"method\":\"exit\"") { return; }
        if body.contains("\"method\":\"initialized\"") {
            send(r#"{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///project/main.rs","version":1,"diagnostics":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"severity":2,"code":"push","message":"push warning"}]}}"#);
            if mode == "malformed-push" {
                send(r#"{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///project/main.rs","version":1,"diagnostics":[{"message":"missing range"}]}}"#);
            }
            continue;
        }
        if !body.contains("\"id\":") { continue; }
        let request_id = id(&body);
        if body.contains("workspace/symbol") && mode == "malformed" {
            send(r#"[]"#);
            continue;
        }
        if body.contains("workspace/symbol") && mode == "crash-once" {
            let marker = std::path::Path::new(".fake-lsp-crashed");
            if !marker.exists() {
                std::fs::write(marker, b"crashed").unwrap();
                return;
            }
        }
        if body.contains("workspace/symbol") && mode == "timeout" {
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        if body.contains("workspace/symbol") && mode == "crash" { return; }
        let result = if body.contains("workspace/symbol") && mode == "malformed-payload" {
            r#"{}"#
        } else if body.contains("workspace/symbol") {
            r#"[{"name":"main","kind":12,"location":{"uri":"file:///project/main.rs","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":4}}}}]"#
        } else if body.contains("textDocument/definition") || body.contains("textDocument/references") {
            r#"[{"uri":"file:///project/main.rs","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":4}}}]"#
        } else if body.contains("textDocument/diagnostic") && mode == "malformed-diagnostics" {
            r#"{}"#
        } else if body.contains("textDocument/diagnostic") {
            r#"{"kind":"full","items":[{"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":2}},"severity":1,"code":"pull","message":"pull error"}]}"#
        } else { r#"{}"# };
        send(&format!(r#"{{"jsonrpc":"2.0","id":{},"result":{}}}"#, request_id, result));
    }
}
"####;

#[cfg(unix)]
const FAKE_FORMATTER: &str = r#"
use std::{fs, path::Path, time::Duration};
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args[0].as_str() {
        "timeout" => std::thread::sleep(Duration::from_secs(2)),
        "crash" => std::process::exit(7),
        "crash-after-write" => {
            fs::write(Path::new(&args[1]), "changed before crash").unwrap();
            std::process::exit(7);
        }
        "timeout-after-write" => {
            fs::write(Path::new(&args[1]), "changed before timeout").unwrap();
            std::thread::sleep(Duration::from_secs(2));
        }
        "oversize" => {
            fs::File::create(Path::new(&args[1])).unwrap().set_len(64 * 1024 * 1024 + 1).unwrap();
        }
        "env" => {
            let value = if std::env::var_os("HOME").is_some() { "leaked" } else { "sanitized" };
            fs::write(Path::new(&args[1]), value).unwrap();
        }
        "format" => {
            let path = Path::new(&args[1]);
            let input = fs::read_to_string(path).unwrap();
            fs::write(path, input.replace("bad", "good")).unwrap();
        }
        "multi" => {
            let path = Path::new(&args[1]);
            fs::write(path, "good primary").unwrap();
            fs::write("src/companion.rs", "good companion").unwrap();
        }
        "descendant" => {
            std::process::Command::new("sh")
                .args(["-c", "sleep 0.2; : > formatter-descendant-marker"])
                .status()
                .unwrap();
        }
        _ => std::process::exit(8),
    }
}
"#;

#[cfg(unix)]
fn lsp_config(mode: &str, timeout_ms: u64) -> LanguageServerConfig {
    LanguageServerConfig {
        executable: "tools/fake-lsp".into(),
        arguments: vec![mode.into()],
        language_id: "rust".into(),
        request_timeout_ms: timeout_ms.max(10_000),
        diagnostic_debounce_ms: 0,
        diagnostic_freshness_timeout_ms: 100,
    }
}

#[cfg(unix)]
#[test]
fn real_lsp_process_supports_queries_push_pull_and_shutdown() {
    let _process_guard = process_test_guard();
    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-lsp", FAKE_LSP);
    let mut server =
        RunningLanguageServer::start("project", project.path(), lsp_config("normal", 2_000))
            .unwrap();
    let position = Position {
        line: 0,
        character: 1,
    };
    let document = DocumentUri("file:///project/main.rs".into());
    server.file_changed(document.clone(), 1);
    let symbols = server
        .workspace_symbols(&SymbolRequest {
            query: "main".into(),
            limit: 10,
        })
        .unwrap();
    assert_eq!(symbols[0].name, "main");
    let pushed = server.diagnostic_snapshot(&document).unwrap();
    assert_eq!(pushed.source, Some(DiagnosticSource::Push));
    assert_eq!(
        server
            .definition(&DefinitionRequest {
                document: document.clone(),
                position
            })
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        server
            .references(&ReferencesRequest {
                document: document.clone(),
                position,
                include_declaration: true,
            })
            .unwrap()
            .len(),
        1
    );
    std::thread::sleep(std::time::Duration::from_millis(110));
    let diagnostics = server.poll_diagnostics(&document).unwrap();
    assert_eq!(diagnostics.freshness, DiagnosticFreshness::Fresh);
    assert_eq!(diagnostics.source, Some(DiagnosticSource::Pull));
    assert_eq!(diagnostics.diagnostics[0].code.as_deref(), Some("pull"));
    server.shutdown().unwrap();
}

#[cfg(unix)]
#[test]
fn lsp_timeout_and_crash_are_explicit_failures() {
    let _process_guard = process_test_guard();
    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-lsp", FAKE_LSP);
    let request = SymbolRequest {
        query: "main".into(),
        limit: 10,
    };
    let mut timeout =
        RunningLanguageServer::start("timeout", project.path(), lsp_config("timeout", 2_000))
            .unwrap();
    timeout.set_request_timeout_ms(40);
    assert!(matches!(
        timeout.workspace_symbols(&request),
        Err(LanguageRuntimeError::Timeout { .. })
    ));
    timeout.set_request_timeout_ms(10_000);
    timeout.restart().unwrap();
    timeout.shutdown().unwrap();
    let mut crash =
        RunningLanguageServer::start("crash", project.path(), lsp_config("crash", 2_000)).unwrap();
    assert!(matches!(
        crash.workspace_symbols(&request),
        Err(LanguageRuntimeError::Crashed(_))
    ));
}

#[cfg(unix)]
#[test]
fn malformed_json_rpc_is_rejected_and_crashed_server_can_restart_cleanly() {
    let _process_guard = process_test_guard();
    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-lsp", FAKE_LSP);
    let request = SymbolRequest {
        query: "main".into(),
        limit: 10,
    };
    let mut malformed =
        RunningLanguageServer::start("malformed", project.path(), lsp_config("malformed", 2_000))
            .unwrap();
    assert!(matches!(
        malformed.workspace_symbols(&request),
        Err(LanguageRuntimeError::InvalidResponse { .. })
    ));

    let mut malformed_payload = RunningLanguageServer::start(
        "malformed-payload",
        project.path(),
        lsp_config("malformed-payload", 2_000),
    )
    .unwrap();
    assert!(matches!(
        malformed_payload.workspace_symbols(&request),
        Err(LanguageRuntimeError::InvalidResponse { .. })
    ));

    let mut malformed_diagnostics = RunningLanguageServer::start(
        "malformed-diagnostics",
        project.path(),
        lsp_config("malformed-diagnostics", 2_000),
    )
    .unwrap();
    let document = DocumentUri("file:///project/main.rs".into());
    malformed_diagnostics.file_changed(document.clone(), 1);
    assert!(matches!(
        malformed_diagnostics.poll_diagnostics(&document),
        Err(LanguageRuntimeError::InvalidResponse { .. })
    ));

    let mut restarted =
        RunningLanguageServer::start("restart", project.path(), lsp_config("crash-once", 2_000))
            .unwrap();
    assert!(matches!(
        restarted.workspace_symbols(&request),
        Err(LanguageRuntimeError::Crashed(_))
    ));
    restarted.restart().unwrap();
    assert_eq!(
        restarted.workspace_symbols(&request).unwrap()[0].name,
        "main"
    );
    restarted.shutdown().unwrap();
}

#[cfg(unix)]
#[test]
fn malformed_push_cannot_erase_diagnostics_and_lsp_environment_is_sanitized() {
    let _process_guard = process_test_guard();
    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-lsp", FAKE_LSP);
    let document = DocumentUri("file:///project/main.rs".into());
    let mut malformed_push = RunningLanguageServer::start(
        "malformed-push",
        project.path(),
        lsp_config("malformed-push", 2_000),
    )
    .unwrap();
    malformed_push.file_changed(document.clone(), 1);
    std::thread::sleep(Duration::from_millis(20));
    let snapshot = malformed_push.diagnostic_snapshot(&document).unwrap();
    assert_eq!(snapshot.diagnostics.len(), 1);
    assert_eq!(snapshot.diagnostics[0].code.as_deref(), Some("push"));
    malformed_push.shutdown().unwrap();

    let mut sanitized =
        RunningLanguageServer::start("sanitized-env", project.path(), lsp_config("env", 2_000))
            .unwrap();
    sanitized.shutdown().unwrap();
    assert!(!project.path().join("lsp-home-leaked").exists());
}

#[cfg(unix)]
#[test]
fn process_contract_rejects_unbounded_timeouts_and_arguments() {
    let project = tempdir().unwrap();
    let mut config = lsp_config("normal", u64::MAX);
    assert!(matches!(
        RunningLanguageServer::start("invalid", project.path(), config.clone()),
        Err(LanguageRuntimeError::InvalidConfiguration(_))
    ));
    config.request_timeout_ms = 1_000;
    config.arguments = vec!["x".repeat(MAX_PROCESS_ARGUMENT_BYTES + 1)];
    assert!(matches!(
        RunningLanguageServer::start("invalid", project.path(), config),
        Err(LanguageRuntimeError::InvalidConfiguration(_))
    ));

    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    let formatter = FormatterConfig {
        name: "invalid".into(),
        executable: "missing".into(),
        arguments: Vec::new(),
        extensions: BTreeSet::from(["rs".into()]),
        scope_paths: BTreeSet::new(),
        timeout_ms: u64::MAX,
    };
    let result = formatter
        .invocation(&resolver, Path::new("src/main.rs"))
        .unwrap_err();
    assert_eq!(
        result.diagnostic.unwrap().code,
        "formatter_configuration_invalid"
    );
}

#[cfg(unix)]
#[test]
fn real_formatter_records_created_changes_timeout_and_crash() {
    let _process_guard = process_test_guard();
    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-formatter", FAKE_FORMATTER);
    fs::create_dir_all(project.path().join("src")).unwrap();
    fs::write(project.path().join("src/main.rs"), "bad code").unwrap();
    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    let config = |mode: &str, timeout_ms| FormatterConfig {
        name: "fake".into(),
        executable: "tools/fake-formatter".into(),
        arguments: vec![mode.into(), "{file}".into()],
        extensions: BTreeSet::from(["rs".into()]),
        scope_paths: BTreeSet::new(),
        timeout_ms,
    };
    let formatted = config("format", 10_000).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(
        formatted.status,
        FormatterStatus::Formatted,
        "formatter diagnostic: {:?}",
        formatted.diagnostic
    );
    assert_ne!(formatted.before_sha256, formatted.after_sha256);
    assert_eq!(
        formatted.proof_impact.invalidated_paths,
        [PathBuf::from("src/main.rs")]
    );
    assert_eq!(
        fs::read_to_string(project.path().join("src/main.rs")).unwrap(),
        "good code"
    );
    let timeout = config("timeout", 30).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(timeout.status, FormatterStatus::Failed);
    assert_eq!(timeout.diagnostic.unwrap().code, "formatter_timeout");
    let crash = config("crash", 10_000).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(crash.status, FormatterStatus::Failed);
    assert_eq!(crash.diagnostic.unwrap().code, "formatter_failed");
    let descendant = config("descendant", 30).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(descendant.status, FormatterStatus::Failed);
    assert_eq!(descendant.diagnostic.unwrap().code, "formatter_timeout");
    std::thread::sleep(Duration::from_millis(300));
    assert!(!project.path().join("formatter-descendant-marker").exists());
}

#[cfg(unix)]
#[test]
fn failed_formatter_mutations_still_invalidate_proof_and_environment_is_sanitized() {
    let _process_guard = process_test_guard();
    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-formatter", FAKE_FORMATTER);
    fs::create_dir_all(project.path().join("src")).unwrap();
    let input = project.path().join("src/main.rs");
    fs::write(&input, "before").unwrap();
    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    let config = |mode: &str, timeout_ms| FormatterConfig {
        name: "fake".into(),
        executable: "tools/fake-formatter".into(),
        arguments: vec![mode.into(), "{file}".into()],
        extensions: BTreeSet::from(["rs".into()]),
        scope_paths: BTreeSet::new(),
        timeout_ms,
    };

    let crashed = config("crash-after-write", 10_000).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(crashed.status, FormatterStatus::Failed);
    assert!(crashed.proof_impact.requires_reprove);
    assert_eq!(
        crashed.proof_impact.invalidated_paths,
        [PathBuf::from("src/main.rs")]
    );

    fs::write(&input, "before timeout").unwrap();
    let timed_out = config("timeout-after-write", 30).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(timed_out.status, FormatterStatus::Failed);
    assert!(timed_out.proof_impact.requires_reprove);

    fs::write(&input, "before env").unwrap();
    let sanitized = config("env", 10_000).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(sanitized.status, FormatterStatus::Formatted);
    assert_eq!(fs::read_to_string(&input).unwrap(), "sanitized");

    fs::write(&input, "before oversize").unwrap();
    let oversized = config("oversize", 10_000).execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(oversized.status, FormatterStatus::Failed);
    assert_eq!(
        oversized.diagnostic.unwrap().code,
        "formatter_output_unreadable"
    );
    assert!(oversized.proof_impact.requires_reprove);
}

#[cfg(unix)]
#[test]
fn formatter_rejects_symlink_inputs_and_hashes_declared_multi_file_changes() {
    let _process_guard = process_test_guard();
    use std::os::unix::fs::symlink;

    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-formatter", FAKE_FORMATTER);
    fs::create_dir_all(project.path().join("src")).unwrap();
    let external = tempdir().unwrap();
    let outside = external.path().join("outside.rs");
    fs::write(&outside, "bad outside").unwrap();
    symlink(&outside, project.path().join("src/link.rs")).unwrap();
    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    let mut config = FormatterConfig {
        name: "fake".into(),
        executable: "tools/fake-formatter".into(),
        arguments: vec!["format".into(), "{file}".into()],
        extensions: BTreeSet::from(["rs".into()]),
        scope_paths: BTreeSet::new(),
        timeout_ms: 10_000,
    };
    let rejected = config.execute(&resolver, Path::new("src/link.rs"));
    assert_eq!(rejected.status, FormatterStatus::Failed);
    assert_eq!(
        rejected.diagnostic.unwrap().code,
        "formatter_input_unreadable"
    );
    assert_eq!(fs::read_to_string(&outside).unwrap(), "bad outside");

    let hardlinked = project.path().join("src/hardlinked.rs");
    fs::hard_link(&outside, &hardlinked).unwrap();
    let rejected = config.execute(&resolver, Path::new("src/hardlinked.rs"));
    assert_eq!(rejected.status, FormatterStatus::Failed);
    assert_eq!(
        rejected.diagnostic.unwrap().code,
        "formatter_input_unreadable"
    );
    assert_eq!(fs::read_to_string(&outside).unwrap(), "bad outside");

    fs::write(project.path().join("src/main.rs"), "bad primary").unwrap();
    fs::write(project.path().join("src/companion.rs"), "bad companion").unwrap();
    config.scope_paths = BTreeSet::from([PathBuf::from("../outside.rs")]);
    let unsafe_scope = config.execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(unsafe_scope.status, FormatterStatus::Failed);
    assert_eq!(
        unsafe_scope.diagnostic.unwrap().code,
        "formatter_scope_invalid"
    );
    assert_eq!(
        fs::read_to_string(project.path().join("src/main.rs")).unwrap(),
        "bad primary"
    );
    config.arguments[0] = "multi".into();
    config.scope_paths = BTreeSet::from([PathBuf::from("src/companion.rs")]);
    let formatted = config.execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(
        formatted.status,
        FormatterStatus::Formatted,
        "formatter diagnostic: {:?}",
        formatted.diagnostic
    );
    assert_eq!(
        formatted.proof_impact.invalidated_paths,
        [
            PathBuf::from("src/companion.rs"),
            PathBuf::from("src/main.rs")
        ]
    );
    assert!(formatted.proof_impact.edit_hash.is_some());
    assert!(formatted.proof_impact.requires_reprove);
}

#[test]
fn formatter_missing_declared_input_is_a_typed_failure_not_a_panic() {
    let result = FormatterConfig::record_scoped_outputs(Path::new("src/main.rs"), &[]);
    assert_eq!(result.status, FormatterStatus::Failed);
    assert_eq!(
        result.diagnostic.expect("typed diagnostic").code,
        "formatter_input_missing"
    );
    assert!(!result.proof_impact.requires_reprove);
}

#[test]
fn formatter_rejects_sparse_files_and_oversized_scopes_before_spawning() {
    let _process_guard = process_test_guard();
    let project = tempdir().unwrap();
    compile_fake(project.path(), "fake-formatter", FAKE_FORMATTER);
    fs::create_dir_all(project.path().join("src")).unwrap();
    fs::File::create(project.path().join("src/main.rs"))
        .unwrap()
        .set_len(MAX_FORMATTER_FILE_BYTES + 1)
        .unwrap();
    let resolver = ProjectToolResolver::new(project.path()).unwrap();
    let mut config = FormatterConfig {
        name: "fake".into(),
        executable: "tools/fake-formatter".into(),
        arguments: vec!["format".into(), "{file}".into()],
        extensions: BTreeSet::from(["rs".into()]),
        scope_paths: BTreeSet::new(),
        timeout_ms: 2_000,
    };

    let oversized = config.execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(oversized.status, FormatterStatus::Failed);
    assert_eq!(
        oversized.diagnostic.expect("typed diagnostic").code,
        "formatter_input_unreadable"
    );

    config.scope_paths = (0..MAX_FORMATTER_SCOPE_FILES)
        .map(|index| PathBuf::from(format!("src/extra-{index}.rs")))
        .collect();
    let oversized_scope = config.execute(&resolver, Path::new("src/main.rs"));
    assert_eq!(oversized_scope.status, FormatterStatus::Failed);
    assert_eq!(
        oversized_scope.diagnostic.expect("typed diagnostic").code,
        "formatter_scope_too_large"
    );
}

#[test]
fn json_rpc_reader_rejects_duplicate_and_unbounded_headers_before_allocation() {
    assert!(matches!(
        validate_json_rpc_message(json!({
            "jsonrpc":"2.0","id":1,"method":"malicious","result":{}
        })),
        Err(RpcReadError::Protocol(message)) if message.contains("ambiguously")
    ));
    assert!(matches!(
        validate_json_rpc_message(json!({
            "jsonrpc":"2.0","id":"unexpected","result":{}
        })),
        Err(RpcReadError::Protocol(message)) if message.contains("unsigned integer")
    ));
    let body = br#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
    let valid = format!("Content-Length: {}\r\n\r\n", body.len())
        .into_bytes()
        .into_iter()
        .chain(body.iter().copied())
        .collect::<Vec<_>>();
    let (sender, receiver) = std::sync::mpsc::sync_channel(4);
    read_json_rpc(std::io::Cursor::new(valid), sender);
    assert_eq!(receiver.recv().unwrap().unwrap()["id"], 1);

    let (sender, receiver) = std::sync::mpsc::sync_channel(4);
    read_json_rpc(
        std::io::Cursor::new(b"Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}".to_vec()),
        sender,
    );
    assert!(matches!(
        receiver.recv().unwrap(),
        Err(RpcReadError::Protocol(message)) if message.contains("duplicate")
    ));

    let (sender, receiver) = std::sync::mpsc::sync_channel(4);
    read_json_rpc(
        std::io::Cursor::new(vec![b'x'; MAX_JSON_RPC_HEADER_BYTES + 1]),
        sender,
    );
    assert!(matches!(
        receiver.recv().unwrap(),
        Err(RpcReadError::Protocol(message)) if message.contains("headers exceed")
    ));

    let body = br#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
    let frame = format!("Content-Length: {}\r\n\r\n", body.len())
        .into_bytes()
        .into_iter()
        .chain(body.iter().copied())
        .collect::<Vec<_>>();
    let burst = frame.repeat(MAX_PENDING_JSON_RPC_MESSAGES + 50);
    let (sender, receiver) = std::sync::mpsc::sync_channel(MAX_PENDING_JSON_RPC_MESSAGES);
    read_json_rpc(std::io::Cursor::new(burst), sender);
    assert_eq!(receiver.try_iter().count(), MAX_PENDING_JSON_RPC_MESSAGES);
}
