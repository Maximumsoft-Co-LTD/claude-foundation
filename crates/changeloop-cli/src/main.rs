#[cfg(unix)]
use changeloop_app_server::executable::serve_unix;
use changeloop_app_server::executable::{
    AppService, EnvironmentBackend, SurfaceBackend, WireRequest, ensure_tui_supported, run_tui,
    serve_http, serve_stdio,
};
use changeloop_config::{ConfigLayer, ConfigResolver, ConfigSource};
use changeloop_protocol::SessionId;
use changeloop_storage::Storage;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tempfile::NamedTempFile;
use url::Url;

mod legacy;
mod operational;

const EXIT_INVALID_INPUT: i32 = 2;
const EXIT_APPROVAL_REQUIRED: i32 = 3;
const EXIT_AGENT_FAILURE: i32 = 4;
const EXIT_PROOF_FAILURE: i32 = 5;
const EXIT_CANCELLATION: i32 = 6;
const EXIT_LIFECYCLE_REJECTION: i32 = 8;
const EXIT_AUTH_PROVIDER_FAILURE: i32 = 7;
const EXIT_UPDATE_FAILURE: i32 = 9;
const MAX_CLI_ARGUMENTS: usize = 64;
const MAX_CLI_ARGUMENT_BYTES: usize = 1024 * 1024;
const MAX_CLI_TOTAL_ARGUMENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_PUBLIC_IDENTIFIER_BYTES: usize = 256;
const MAX_PUBLIC_PATH_BYTES: usize = 16 * 1024;
const MAX_CLI_JSON_BYTES: u64 = 16 * 1024 * 1024;
const MAX_CLI_JOURNAL_BYTES: u64 = 1024 * 1024;
const MAX_PRIVACY_PURGE_SESSIONS: usize = 100_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivacyPurgeJournal {
    version: u16,
    requested: Option<String>,
    ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StoredPrivacyPurgeJournal {
    Current(PrivacyPurgeJournal),
    Legacy(Vec<String>),
}

#[tokio::main]
async fn main() {
    let result = match collect_cli_arguments() {
        Ok(args) => run(args).await,
        Err(failure) => Err(failure),
    };
    if let Err(failure) = result {
        eprintln!("{}", safe_error_message(&failure.message));
        std::process::exit(failure.code);
    }
}

#[derive(Debug)]
struct CliFailure {
    code: i32,
    message: String,
}

fn collect_cli_arguments() -> Result<Vec<String>, CliFailure> {
    let mut arguments = Vec::new();
    let mut total_bytes = 0_usize;
    for argument in env::args_os().skip(1) {
        if arguments.len() == MAX_CLI_ARGUMENTS {
            return Err(invalid_input("too many command-line arguments"));
        }
        let argument = argument
            .into_string()
            .map_err(|_| invalid_input("command-line arguments must be valid Unicode"))?;
        total_bytes = total_bytes.saturating_add(argument.len());
        if argument.len() > MAX_CLI_ARGUMENT_BYTES
            || total_bytes > MAX_CLI_TOTAL_ARGUMENT_BYTES
            || argument.chars().any(char::is_control)
        {
            return Err(invalid_input(
                "arguments must be at most 1 MiB each and 16 MiB total, with no control characters",
            ));
        }
        arguments.push(argument);
    }
    Ok(arguments)
}

fn unicode_environment() -> BTreeMap<String, String> {
    env::vars_os()
        .filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?)))
        .collect()
}

async fn run(args: Vec<String>) -> Result<(), CliFailure> {
    validate_cli_arguments(&args)?;
    match args.as_slice() {
        [compatibility, api_flag, api, command, values @ ..]
            if compatibility == "legacy-runtime" && api_flag == "--api" =>
        {
            legacy::run(api, command, values).map_err(|failure| CliFailure {
                code: failure.code,
                message: failure.message,
            })
        }
        [flag] if flag == "--help" || flag == "-h" || flag == "help" => {
            print_help();
            Ok(())
        }
        [flag] if flag == "--version" || flag == "version" => {
            println!(
                "changeloop-cli {} (experimental)",
                env!("CARGO_PKG_VERSION")
            );
            Ok(())
        }
        [command] if command == "status" => status(),
        [command] if command == "sessions" => operational::sessions(),
        [command] if command == "resume" => operational::resume(None),
        [command, session] if command == "resume" => {
            validate_public_identifier(session)?;
            operational::resume(Some(session))
        }
        [command, session] if command == "fork" => {
            validate_public_identifier(session)?;
            operational::fork(session)
        }
        [command] if command == "jobs" => operational::jobs(),
        [command, subcommand] if command == "lsp" && subcommand == "status" => {
            operational::language_status(true)
        }
        [command, subcommand] if command == "formatter" && subcommand == "status" => {
            operational::language_status(false)
        }
        [command] if command == "undo" => operational::undo_redo(None, false),
        [command, session] if command == "undo" => {
            validate_public_identifier(session)?;
            operational::undo_redo(Some(session), false)
        }
        [command] if command == "redo" => operational::undo_redo(None, true),
        [command, session] if command == "redo" => {
            validate_public_identifier(session)?;
            operational::undo_redo(Some(session), true)
        }
        [command] if command == "prove" => operational::prove(None),
        [command, change] if command == "prove" => {
            validate_public_identifier(change)?;
            operational::prove(Some(change))
        }
        [command] if command == "review" => operational::review(None),
        [command, change] if command == "review" => {
            validate_public_identifier(change)?;
            operational::review(Some(change))
        }
        [command, change] if command == "land" => {
            validate_public_identifier(change)?;
            operational::land(change)
        }
        [command] if command == "doctor" => doctor(),
        [command, action] if command == "setup" && action == "status" => setup_status(),
        [
            command,
            provider_flag,
            provider,
            model_flag,
            model,
            sandbox_flag,
            sandbox,
            privacy,
            provider_data,
        ] if command == "setup"
            && provider_flag == "--provider"
            && model_flag == "--model"
            && sandbox_flag == "--sandbox"
            && privacy == "--accept-privacy"
            && provider_data == "--accept-provider-data" =>
        {
            setup_command(provider, model, sandbox)
        }
        [command] if command == "models" => models(),
        [command, shell] if command == "completion" => completion(shell),
        [auth, action, provider] if auth == "auth" && action == "login" => {
            auth_login_command(provider)
        }
        [auth, action] if auth == "auth" && action == "list" => auth_list_command(),
        [auth, action, provider] if auth == "auth" && action == "logout" => {
            auth_logout_command(provider)
        }
        [
            command,
            manifest_flag,
            manifest,
            artifact_flag,
            artifact,
            key_flag,
            key,
        ] if command == "update"
            && manifest_flag == "--manifest"
            && artifact_flag == "--artifact"
            && key_flag == "--public-key" =>
        {
            update_command(manifest, artifact, key, None)
        }
        [
            command,
            manifest_flag,
            manifest,
            artifact_flag,
            artifact,
            key_flag,
            key,
            target_flag,
            target,
        ] if command == "update"
            && manifest_flag == "--manifest"
            && artifact_flag == "--artifact"
            && key_flag == "--public-key"
            && target_flag == "--target" =>
        {
            update_command(manifest, artifact, key, Some(target))
        }
        [
            command,
            action,
            manifest_flag,
            manifest,
            key_flag,
            key,
            channel_flag,
            channel,
            offline,
        ] if command == "update"
            && action == "check"
            && manifest_flag == "--channel-manifest"
            && key_flag == "--public-key"
            && channel_flag == "--channel"
            && offline == "--offline" =>
        {
            update_check_command(manifest, key, channel, true)
        }
        [
            command,
            action,
            manifest_flag,
            manifest,
            key_flag,
            key,
            channel_flag,
            channel,
        ] if command == "update"
            && action == "check"
            && manifest_flag == "--channel-manifest"
            && key_flag == "--public-key"
            && channel_flag == "--channel" =>
        {
            update_check_command(manifest, key, channel, false)
        }
        [command, action, target_flag, target]
            if command == "update" && action == "recover" && target_flag == "--target" =>
        {
            validate_public_path(target)?;
            update_recover_command(Path::new(target))
        }
        [command, prompt] if command == "ask" || command == "run" => {
            validate_prompt(prompt)?;
            headless(command, prompt, false).await
        }
        [change, confirm, session] if change == "change" && confirm == "confirm" => {
            validate_public_identifier(session)?;
            headless_control("change.confirm", session).await
        }
        [change, discard, session] if change == "change" && discard == "discard" => {
            validate_public_identifier(session)?;
            headless_control("change.discard", session).await
        }
        [contract, approve, session] if contract == "contract" && approve == "approve" => {
            validate_public_identifier(session)?;
            headless_control("contract.approve", session).await
        }
        [command] if command == "serve" => serve(vec!["--stdio".into()]).await,
        [command, rest @ ..] if command == "serve" => serve(rest.to_vec()).await,
        [command, flag] if command == "migrate" && flag == "--dry-run" => migrate(false, None),
        [command, flag, digest] if command == "migrate" && flag == "--apply" => {
            migrate(true, Some(digest))
        }
        [privacy_cmd, command] if privacy_cmd == "privacy" && command == "inspect" => {
            privacy(command, None)
        }
        [privacy_cmd, command]
            if privacy_cmd == "privacy" && matches!(command.as_str(), "export" | "delete") =>
        {
            privacy(command, None)
        }
        [privacy_cmd, command, id]
            if privacy_cmd == "privacy" && matches!(command.as_str(), "export" | "delete") =>
        {
            validate_public_identifier(id)?;
            privacy(command, Some(id))
        }
        [config, explain, field] if config == "config" && explain == "explain" => {
            validate_config_field(field)?;
            explain_config(field)
        }
        [mcp, add, name, transport, target] if mcp == "mcp" && add == "add" => mcp_add(
            &env::current_dir().map_err(io_failure)?,
            name,
            transport,
            target,
        ),
        [mcp, list] if mcp == "mcp" && list == "list" => {
            print_pretty_json(&mcp_registry(&env::current_dir().map_err(io_failure)?)?)
        }
        [mcp, extensions] if mcp == "mcp" && extensions == "extensions" => {
            extension_status(&env::current_dir().map_err(io_failure)?)
        }
        [mcp, extensions, run, id]
            if mcp == "mcp" && extensions == "extensions" && run == "run" =>
        {
            validate_public_identifier(id)?;
            extension_run(&env::current_dir().map_err(io_failure)?, id, Value::Null)
        }
        [mcp, extensions, run, id, input]
            if mcp == "mcp" && extensions == "extensions" && run == "run" =>
        {
            validate_public_identifier(id)?;
            let input = serde_json::from_str(input).map_err(|error| CliFailure {
                code: EXIT_INVALID_INPUT,
                message: format!("extension input must be JSON: {error}"),
            })?;
            extension_run(&env::current_dir().map_err(io_failure)?, id, input)
        }
        [mcp, remove, name] if mcp == "mcp" && remove == "remove" => {
            mcp_remove(&env::current_dir().map_err(io_failure)?, name)
        }
        [mcp, auth, name] if mcp == "mcp" && auth == "auth" => operational::mcp_auth(name),
        [mcp, auth, refresh, name] if mcp == "mcp" && auth == "auth" && refresh == "refresh" => {
            operational::mcp_auth_refresh(name)
        }
        [mcp, auth, logout, name] if mcp == "mcp" && auth == "auth" && logout == "logout" => {
            operational::mcp_auth_logout(name)
        }
        [] => tui().await,
        [prompt] => {
            validate_prompt(prompt)?;
            headless("ask", prompt, true).await
        }
        _ => Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "invalid command; run 'cloop --help'".into(),
        }),
    }
}

fn validate_cli_arguments(args: &[String]) -> Result<(), CliFailure> {
    if args.len() > MAX_CLI_ARGUMENTS {
        return Err(invalid_input("too many command-line arguments"));
    }
    if args
        .iter()
        .try_fold(0_usize, |total, argument| {
            total.checked_add(argument.len()).filter(|total| {
                argument.len() <= MAX_CLI_ARGUMENT_BYTES
                    && *total <= MAX_CLI_TOTAL_ARGUMENT_BYTES
                    && !argument.chars().any(char::is_control)
            })
        })
        .is_none()
    {
        return Err(invalid_input(
            "arguments must be at most 1 MiB each and 16 MiB total, with no control characters",
        ));
    }
    Ok(())
}

fn validate_prompt(prompt: &str) -> Result<(), CliFailure> {
    if prompt.trim().is_empty() || prompt.len() > MAX_CLI_ARGUMENT_BYTES {
        Err(invalid_input(
            "prompt must be non-empty and at most 1 MiB of valid Unicode",
        ))
    } else {
        Ok(())
    }
}

fn validate_public_identifier(identifier: &str) -> Result<(), CliFailure> {
    if !identifier.is_empty()
        && identifier.len() <= MAX_PUBLIC_IDENTIFIER_BYTES
        && identifier
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        Ok(())
    } else {
        Err(invalid_input(
            "identifier must be 1-256 bytes using letters, numbers, '-', '_' or '.'",
        ))
    }
}

fn validate_public_path(path: &str) -> Result<(), CliFailure> {
    if !path.is_empty() && path.len() <= MAX_PUBLIC_PATH_BYTES {
        Ok(())
    } else {
        Err(invalid_input("path must be 1-16384 bytes"))
    }
}

fn read_regular_bounded_cli(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let path_metadata = fs::symlink_metadata(path)?;
    if !path_metadata.file_type().is_file() || path_metadata.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{} must be a regular non-symlink file no larger than {limit} bytes",
                path.display()
            ),
        ));
    }
    let mut options = OpenOptions::new();
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

fn validate_config_field(field: &str) -> Result<(), CliFailure> {
    if !field.is_empty()
        && field.len() <= MAX_PUBLIC_IDENTIFIER_BYTES
        && field
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        Ok(())
    } else {
        Err(invalid_input("config field name is invalid"))
    }
}

fn invalid_input(message: impl Into<String>) -> CliFailure {
    CliFailure {
        code: EXIT_INVALID_INPUT,
        message: message.into(),
    }
}

fn print_pretty_json(value: &(impl Serialize + ?Sized)) -> Result<(), CliFailure> {
    let rendered = serde_json::to_string_pretty(value).map_err(|_| CliFailure {
        code: EXIT_AGENT_FAILURE,
        message: "failed to serialize the CLI response".into(),
    })?;
    println!("{rendered}");
    Ok(())
}

fn safe_error_message(message: &str) -> String {
    let mut safe = message.to_owned();
    for variable in [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "CHANGELOOP_SERVER_TOKEN",
    ] {
        if let Ok(secret) = env::var(variable)
            && !secret.is_empty()
        {
            safe = safe.replace(&secret, "[REDACTED]");
        }
    }
    safe.chars()
        .take(4096)
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect()
}

fn open_service() -> Result<AppService<EnvironmentBackend>, CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let state = root.join(".changeloop");
    fs::create_dir_all(&state).map_err(io_failure)?;
    let storage = Storage::open(state.join("state.db")).map_err(|error| CliFailure {
        code: EXIT_AGENT_FAILURE,
        message: format!("storage initialization failed without modifying the database: {error}"),
    })?;
    let variables = service_environment(&root)?;
    let backend = environment_backend(variables, &changeloop_ops::OsCredentialStore)?;
    AppService::with_project(storage, backend, &root).map_err(surface_failure)
}

fn service_environment(root: &Path) -> Result<BTreeMap<String, String>, CliFailure> {
    let mut variables = unicode_environment();
    if let Some(setup) =
        changeloop_ops::load_first_run_setup(&first_run_setup_path()?).map_err(ops_failure)?
    {
        variables
            .entry("CHANGELOOP_PROVIDER".into())
            .or_insert(setup.provider);
        variables
            .entry("CHANGELOOP_MODEL".into())
            .or_insert(setup.model);
    }
    if !variables.contains_key("CHANGELOOP_MODE") {
        let mode = match resolve_config(root)?.config.mode {
            changeloop_config::Mode::Auto => "auto",
            changeloop_config::Mode::Ask => "ask",
            changeloop_config::Mode::Plan => "plan",
            changeloop_config::Mode::Yolo => "yolo",
        };
        variables.insert("CHANGELOOP_MODE".into(), mode.into());
    }
    Ok(variables)
}

fn environment_backend(
    mut variables: BTreeMap<String, String>,
    credential_store: &dyn changeloop_ops::CredentialStore,
) -> Result<EnvironmentBackend, CliFailure> {
    use zeroize::Zeroize as _;

    let credential_variable = match variables.get("CHANGELOOP_PROVIDER").map(String::as_str) {
        Some("anthropic") => Some(("anthropic", "ANTHROPIC_API_KEY")),
        Some("openai") => Some(("openai", "OPENAI_API_KEY")),
        _ => None,
    };
    let mut injected_variable = None;
    if let Some((provider, variable)) = credential_variable
        && variables
            .get(variable)
            .is_none_or(|value| value.trim().is_empty())
    {
        let mut credential = credential_store.get(provider).map_err(release_failure)?;
        if let Some(secret) = credential.as_mut() {
            variables.insert(variable.into(), secret.clone());
            injected_variable = Some(variable);
            secret.zeroize();
        }
    }
    let backend = EnvironmentBackend::new(&variables);
    if let Some(variable) = injected_variable
        && let Some(secret) = variables.get_mut(variable)
    {
        secret.zeroize();
    }
    Ok(backend)
}

async fn headless(command: &str, prompt: &str, allow_draft: bool) -> Result<(), CliFailure> {
    let mut service = open_service()?;
    let response = service
        .handle(WireRequest {
            id: "headless".into(),
            method: command.into(),
            params: json!({"prompt":prompt,"allowDraft":allow_draft}),
            token: None,
        })
        .await;
    if let Some(error) = response.error {
        return Err(CliFailure {
            code: wire_error_exit_code(&error.code),
            message: error.message,
        });
    }
    let mut result = response.result.unwrap_or(Value::Null);
    operational::record_invocation(command, prompt, &result)?;
    if command == "run" && result["changeState"] == "confirmed" && result["riskTier"] == "low" {
        let session = result["sessionId"]
            .as_str()
            .ok_or_else(|| CliFailure {
                code: EXIT_AGENT_FAILURE,
                message: "confirmed change response omitted sessionId".into(),
            })?
            .to_owned();
        result["proofResult"] = operational::prove_silent(&session)?;
    }
    print_pretty_json(&result)?;
    if result["approvalRequired"] == true {
        Err(CliFailure {
            code: EXIT_APPROVAL_REQUIRED,
            message: format!(
                "approval required for draft {}; run `cloop contract approve {}` then `cloop change confirm {}`",
                result["sessionId"], result["sessionId"], result["sessionId"]
            ),
        })
    } else {
        Ok(())
    }
}

async fn headless_control(method: &str, session: &str) -> Result<(), CliFailure> {
    let mut service = open_service()?;
    let response = service
        .handle(WireRequest {
            id: "headless-control".into(),
            method: method.into(),
            params: json!({"sessionId":session}),
            token: None,
        })
        .await;
    if let Some(error) = response.error {
        return Err(CliFailure {
            code: wire_error_exit_code(&error.code),
            message: error.message,
        });
    }
    let mut result = response.result.unwrap_or(Value::Null);
    if method == "change.confirm" {
        let risk_tier = operational::promote_confirmed_change(session, &result)?;
        if risk_tier == "low" {
            result["proofResult"] = operational::prove_silent(session)?;
        }
    }
    print_pretty_json(&result)
}

fn wire_error_exit_code(code: &str) -> i32 {
    match code {
        "invalid_request" => EXIT_INVALID_INPUT,
        "approval_required" => EXIT_APPROVAL_REQUIRED,
        "agent_failure" | "storage_failure" | "io_failure" => EXIT_AGENT_FAILURE,
        "cancelled" => EXIT_CANCELLATION,
        "auth_required" | "model_required" | "provider_required" | "provider_failure"
        | "unauthorized" => EXIT_AUTH_PROVIDER_FAILURE,
        _ => EXIT_LIFECYCLE_REJECTION,
    }
}

async fn tui() -> Result<(), CliFailure> {
    ensure_tui_supported().map_err(surface_failure)?;
    let service = open_service()?;
    run_tui(service).await.map_err(surface_failure)
}

async fn serve(args: Vec<String>) -> Result<(), CliFailure> {
    let mut service = open_service()?;
    match args.as_slice() {
        [flag] if flag == "--stdio" => serve_stdio(
            &mut service,
            tokio::io::BufReader::new(tokio::io::stdin()),
            tokio::io::stdout(),
        )
        .await
        .map_err(surface_failure),
        #[cfg(unix)]
        [flag, path] if flag == "--unix" => {
            let token = env::var("CHANGELOOP_SERVER_TOKEN").map_err(|_| CliFailure {
                code: EXIT_AUTH_PROVIDER_FAILURE,
                message: "CHANGELOOP_SERVER_TOKEN is required for Unix service auth".into(),
            })?;
            serve_unix(&mut service, Path::new(path), &token, None)
                .await
                .map_err(surface_failure)
        }
        [flag, address] if flag == "--http" => {
            let token = env::var("CHANGELOOP_SERVER_TOKEN").map_err(|_| CliFailure {
                code: EXIT_AUTH_PROVIDER_FAILURE,
                message: "CHANGELOOP_SERVER_TOKEN is required for HTTP service auth".into(),
            })?;
            let origin = env::var("CHANGELOOP_ALLOWED_ORIGIN").map_err(|_| CliFailure {
                code: EXIT_AUTH_PROVIDER_FAILURE,
                message: "CHANGELOOP_ALLOWED_ORIGIN is required for strict HTTP origin checks"
                    .into(),
            })?;
            let address = address.parse().map_err(|error| CliFailure {
                code: EXIT_INVALID_INPUT,
                message: format!("invalid HTTP address: {error}"),
            })?;
            let config = resolve_config(&env::current_dir().map_err(io_failure)?)?;
            serve_http(
                service,
                address,
                &token,
                &origin,
                config.config.server.event_queue_capacity as usize,
                10_000,
                None,
            )
            .await
            .map_err(surface_failure)
        }
        _ => Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "usage: cloop serve [--stdio|--unix <path>|--http <127.0.0.1:port>]".into(),
        }),
    }
}

fn surface_failure(error: changeloop_app_server::executable::SurfaceError) -> CliFailure {
    let message = error.to_string();
    let code = match error {
        changeloop_app_server::executable::SurfaceError::AuthenticationRequired
        | changeloop_app_server::executable::SurfaceError::ModelRequired
        | changeloop_app_server::executable::SurfaceError::ProviderRequired
        | changeloop_app_server::executable::SurfaceError::Provider(_)
        | changeloop_app_server::executable::SurfaceError::Unauthorized => {
            EXIT_AUTH_PROVIDER_FAILURE
        }
        changeloop_app_server::executable::SurfaceError::Cancelled => EXIT_CANCELLATION,
        changeloop_app_server::executable::SurfaceError::ApprovalRequired(_) => {
            EXIT_APPROVAL_REQUIRED
        }
        changeloop_app_server::executable::SurfaceError::Proof(_) => EXIT_PROOF_FAILURE,
        changeloop_app_server::executable::SurfaceError::Runtime(_)
        | changeloop_app_server::executable::SurfaceError::Project(_)
        | changeloop_app_server::executable::SurfaceError::Storage(_)
        | changeloop_app_server::executable::SurfaceError::Io(_) => EXIT_AGENT_FAILURE,
        changeloop_app_server::executable::SurfaceError::Invalid(_) => EXIT_INVALID_INPUT,
    };
    CliFailure { code, message }
}

fn migrate(apply: bool, digest: Option<&String>) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let result = if apply {
        let digest = digest.ok_or_else(|| invalid_input("migration apply requires a digest"))?;
        changeloop_ops::apply(&root, digest).map_err(ops_failure)?
    } else {
        changeloop_ops::plan(&root).map_err(ops_failure)?
    };
    print_pretty_json(&result)
}
fn privacy(command: &str, id: Option<&String>) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let path = root.join(".changeloop/privacy-sessions.json");
    let telemetry = resolve_config(&root)?.config.telemetry;
    let setup =
        changeloop_ops::load_first_run_setup(&first_run_setup_path()?).map_err(ops_failure)?;
    let provider_environment = service_environment(&root)?;
    let provider = provider_environment
        .get("CHANGELOOP_PROVIDER")
        .map(String::as_str)
        .or_else(|| setup.as_ref().map(|setup| setup.provider.as_str()));
    match command {
        "inspect" => {
            let mut report = changeloop_ops::privacy_inspect_detailed(
                &path,
                &root,
                &user_config_directory()?,
                provider,
                telemetry.analytics,
                telemetry.crash_upload,
            )
            .map_err(ops_failure)?;
            let registry = mcp_registry(&root)?;
            let mcp = registry["servers"]
                .as_object()
                .into_iter()
                .flat_map(|servers| servers.iter())
                .map(|(name, server)| {
                    let transport = server["transport"].as_str().unwrap_or("unknown");
                    let target = server["target"].as_str().unwrap_or("unavailable");
                    let destination = if transport == "http" {
                        Url::parse(target)
                            .map(|mut url| {
                                url.set_query(None);
                                url.set_fragment(None);
                                url.to_string()
                            })
                            .unwrap_or_else(|_| "invalid HTTP destination".into())
                    } else {
                        format!("local {transport} endpoint")
                    };
                    json!({"name":name,"transport":transport,"destination":destination,
                        "contentSentOnlyWhenInvoked":true})
                })
                .collect::<Vec<_>>();
            report["destinations"]["configuredMcp"] = json!(mcp);
            report["destinations"]["configuredWebDomains"] = json!(
                provider_environment
                    .get("CHANGELOOP_WEB_ALLOWED_DOMAINS")
                    .map(|domains| domains
                        .split(',')
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .collect::<Vec<_>>())
                    .unwrap_or_default()
            );
            print_pretty_json(&report)?;
        }
        "export" => print_pretty_json(&match id {
            Some(id) => changeloop_ops::privacy_export(&path, id).map_err(ops_failure)?,
            None => changeloop_ops::privacy_export_all(&path).map_err(ops_failure)?,
        })?,
        "delete" => {
            let deleted = coordinated_privacy_purge(&root, &path, id.map(String::as_str))?;
            print_pretty_json(&json!({"deleted":deleted}))?;
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn coordinated_privacy_purge(
    root: &Path,
    privacy_path: &Path,
    requested: Option<&str>,
) -> Result<Vec<String>, CliFailure> {
    let state_directory = root.join(".changeloop");
    fs::create_dir_all(&state_directory).map_err(io_failure)?;
    if !fs::symlink_metadata(&state_directory)
        .map_err(io_failure)?
        .file_type()
        .is_dir()
    {
        return Err(invalid_input(
            "privacy purge state directory must be a real directory",
        ));
    }
    let journal_path = state_directory.join("privacy-purge.json");
    let lock_path = state_directory.join("privacy-purge.lock");
    let lock = open_privacy_purge_lock(&lock_path)?;
    lock.lock_exclusive().map_err(io_failure)?;
    let journal_exists = match fs::symlink_metadata(&journal_path) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(io_failure(error)),
    };
    let ids: Vec<String> = if journal_exists {
        let stored: StoredPrivacyPurgeJournal = serde_json::from_slice(
            &read_regular_bounded_cli(&journal_path, MAX_CLI_JOURNAL_BYTES).map_err(io_failure)?,
        )
        .map_err(|error| CliFailure {
            code: EXIT_AGENT_FAILURE,
            message: format!("invalid privacy purge recovery journal: {error}"),
        })?;
        let ids = match stored {
            StoredPrivacyPurgeJournal::Current(journal) => {
                if journal.version != 1 || journal.requested.as_deref() != requested {
                    return Err(CliFailure {
                        code: EXIT_LIFECYCLE_REJECTION,
                        message: "pending privacy purge belongs to a different request".into(),
                    });
                }
                journal.ids
            }
            StoredPrivacyPurgeJournal::Legacy(ids) => {
                if requested
                    .is_some_and(|id| ids.len() != 1 || ids.first().map(String::as_str) != Some(id))
                {
                    return Err(CliFailure {
                        code: EXIT_LIFECYCLE_REJECTION,
                        message: "legacy privacy purge journal does not match this request".into(),
                    });
                }
                ids
            }
        };
        validate_privacy_purge_ids(&ids)?;
        // Recovery intent never grants deletion authority. Re-evaluate the
        // current active/evidence guards before touching any backing store.
        for id in &ids {
            changeloop_ops::privacy_deletable_ids(privacy_path, Some(id)).map_err(ops_failure)?;
        }
        ids
    } else {
        let ids =
            changeloop_ops::privacy_deletable_ids(privacy_path, requested).map_err(ops_failure)?;
        validate_privacy_purge_ids(&ids)?;
        let journal_directory = journal_path
            .parent()
            .ok_or_else(|| invalid_input("privacy purge journal path has no parent directory"))?;
        let journal = PrivacyPurgeJournal {
            version: 1,
            requested: requested.map(str::to_owned),
            ids: ids.clone(),
        };
        let bytes = serde_json::to_vec(&journal).map_err(|error| CliFailure {
            code: EXIT_AGENT_FAILURE,
            message: error.to_string(),
        })?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_CLI_JOURNAL_BYTES {
            return Err(invalid_input(
                "privacy purge request exceeds the safe journal limit",
            ));
        }
        let mut temporary = NamedTempFile::new_in(journal_directory).map_err(io_failure)?;
        temporary.write_all(&bytes).map_err(io_failure)?;
        temporary.as_file().sync_all().map_err(io_failure)?;
        temporary
            .persist(&journal_path)
            .map_err(|error| io_failure(error.error))?;
        fs::File::open(journal_directory)
            .and_then(|directory| directory.sync_all())
            .map_err(io_failure)?;
        ids
    };
    let database = root.join(".changeloop/state.db");
    if database.is_file() {
        let mut storage = Storage::open(&database).map_err(|error| CliFailure {
            code: EXIT_AGENT_FAILURE,
            message: format!("privacy purge could not open storage: {error}"),
        })?;
        for id in &ids {
            storage
                .purge_session(&SessionId::from_stable(id))
                .map_err(|error| CliFailure {
                    code: EXIT_AGENT_FAILURE,
                    message: format!("privacy purge failed in SQLite: {error}"),
                })?;
        }
    }
    operational::purge_sessions(&ids)?;
    for id in &ids {
        // Privacy metadata is committed last. If an earlier step fails, the
        // durable journal makes the operation safely retryable.
        match changeloop_ops::privacy_delete(privacy_path, id) {
            Ok(()) | Err(changeloop_ops::OpsError::NotFound) => {}
            Err(error) => return Err(ops_failure(error)),
        }
    }
    fs::remove_file(&journal_path).map_err(io_failure)?;
    if let Some(directory) = journal_path.parent() {
        fs::File::open(directory)
            .and_then(|directory| directory.sync_all())
            .map_err(io_failure)?;
    }
    Ok(ids)
}

fn validate_privacy_purge_ids(ids: &[String]) -> Result<(), CliFailure> {
    if ids.len() > MAX_PRIVACY_PURGE_SESSIONS {
        return Err(invalid_input("privacy purge contains too many sessions"));
    }
    let mut unique = std::collections::BTreeSet::new();
    for id in ids {
        validate_public_identifier(id)?;
        if !unique.insert(id) {
            return Err(invalid_input(
                "privacy purge contains duplicate session identifiers",
            ));
        }
    }
    Ok(())
}

fn open_privacy_purge_lock(path: &Path) -> Result<fs::File, CliFailure> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options.open(path).map_err(io_failure)?;
    let metadata = file.metadata().map_err(io_failure)?;
    if !metadata.file_type().is_file() {
        return Err(invalid_input("privacy purge lock must be a regular file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(invalid_input(
                "privacy purge lock must have exactly one hard link",
            ));
        }
    }
    Ok(file)
}
fn ops_failure(error: changeloop_ops::OpsError) -> CliFailure {
    let code = match error {
        changeloop_ops::OpsError::Referenced
        | changeloop_ops::OpsError::Conflict
        | changeloop_ops::OpsError::PlanChanged
        | changeloop_ops::OpsError::Locked
        | changeloop_ops::OpsError::RecoveryConflict
        | changeloop_ops::OpsError::PendingMigration { .. }
        | changeloop_ops::OpsError::RecoveryJournal(_) => EXIT_LIFECYCLE_REJECTION,
        changeloop_ops::OpsError::Io(_) => EXIT_AGENT_FAILURE,
        _ => EXIT_INVALID_INPUT,
    };
    CliFailure {
        code,
        message: error.to_string(),
    }
}

fn print_help() {
    println!(
        "cloop (experimental)\n\nUSAGE:\n  cloop                       # TUI conversation\n  cloop <prompt>              # read-only conversation\n  cloop ask <question>\n  cloop run <intent>\n  cloop change confirm|discard <session>\n  cloop contract approve <session>\n  cloop resume [session]\n  cloop fork <session>\n  cloop sessions\n  cloop status\n  cloop undo|redo [session]\n  cloop jobs\n  cloop prove|review [change]\n  cloop land <change>\n  cloop lsp status\n  cloop formatter status\n  cloop serve [--stdio|--unix <path>|--http <127.0.0.1:port>]\n  cloop doctor\n  cloop setup --provider <anthropic|openai> --model <model> --sandbox <read-only|workspace-write|danger-full-access> --accept-privacy --accept-provider-data\n  cloop setup status\n  cloop models\n  cloop auth login|logout <anthropic|openai>\n  cloop auth list\n  cloop completion <bash|zsh|fish>\n  cloop update --manifest <path> --artifact <path> --public-key <base64> [--target <path>]\n  cloop update check --channel-manifest <path> --public-key <base64> --channel <stable|beta|preview> [--offline]\n  cloop update recover --target <path>\n  cloop config explain <field>\n  cloop migrate --dry-run\n  cloop migrate --apply <plan-digest>\n  cloop privacy inspect|export [session]|delete [session]\n  cloop mcp add <name> <stdio|unix|http> <target>\n  cloop mcp list|extensions|auth <name>|auth refresh <name>|auth logout <name>|remove <name>\n\nEXIT CODES:\n  2 invalid input, 3 approval required, 4 agent failure, 5 proof failure\n  6 cancelled, 7 auth/provider failure, 8 lifecycle rejection, 9 update failure"
    );
    println!(
        "\nEXPERIMENTAL EXTENSIONS:\n  cloop mcp extensions run <id> [json]  # explicit bounded stdio-v1 handler"
    );
}

fn auth_registry_path() -> Result<std::path::PathBuf, CliFailure> {
    Ok(user_config_directory()?.join("auth-profiles.json"))
}

fn first_run_setup_path() -> Result<std::path::PathBuf, CliFailure> {
    Ok(user_config_directory()?.join("first-run.json"))
}

fn setup_command(provider: &str, model: &str, sandbox: &str) -> Result<(), CliFailure> {
    if !matches!(provider, "anthropic" | "openai") {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "provider must be 'anthropic' or 'openai'".into(),
        });
    }
    if model.is_empty()
        || model.len() > 256
        || model
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message:
                "model must be non-empty, at most 256 bytes, and contain no control or whitespace characters".into(),
        });
    }
    // Validate every fallible disclosure before writing setup state. A failed
    // command must never leave a partially accepted provider configuration.
    let provider_disclosure =
        changeloop_ops::provider_data_disclosure(provider).map_err(ops_failure)?;
    let sandbox = match sandbox {
        "read-only" => changeloop_ops::SandboxSelection::ReadOnly,
        "workspace-write" => changeloop_ops::SandboxSelection::WorkspaceWrite,
        "danger-full-access" => changeloop_ops::SandboxSelection::DangerFullAccess,
        _ => {
            return Err(CliFailure {
                code: EXIT_INVALID_INPUT,
                message: "sandbox must be read-only, workspace-write, or danger-full-access".into(),
            });
        }
    };
    let workspace = env::current_dir().map_err(io_failure)?;
    let diagnostic = changeloop_ops::diagnose_sandbox(&workspace, sandbox);
    let setup = changeloop_ops::FirstRunSetup {
        version: 1,
        provider: provider.into(),
        model: model.into(),
        privacy_disclosure_accepted: true,
        provider_data_disclosure_accepted: true,
        local_only_telemetry: true,
        analytics_enabled: false,
        crash_upload_enabled: false,
        sandbox: diagnostic.effective.clone(),
    };
    let path = first_run_setup_path()?;
    changeloop_ops::save_first_run_setup(&path, &setup).map_err(ops_failure)?;
    print_pretty_json(&json!({
        "configured":true,
        "path":path,
        "provider":provider,
        "model":model,
        "providerDataDisclosure":provider_disclosure,
        "privacyDisclosure":"Workflow data and metrics remain local by default; analytics and crash upload are disabled.",
        "sandbox":diagnostic,
        "credentialNextStep":format!("cloop auth login {provider}"),
        "credentialStorage":"operating-system credential store"
    }))
}

fn setup_status() -> Result<(), CliFailure> {
    let path = first_run_setup_path()?;
    let setup = changeloop_ops::load_first_run_setup(&path).map_err(ops_failure)?;
    print_pretty_json(&json!({
        "configured":setup.is_some(),
        "path":path,
        "setup":setup,
        "credentialStorage":"operating-system credential store"
    }))
}

fn user_config_directory() -> Result<std::path::PathBuf, CliFailure> {
    let variables = unicode_environment();
    if let Some(directory) = user_config_directory_override(&variables) {
        return Ok(directory);
    }
    directories::BaseDirs::new()
        .map(|directories| directories.config_dir().join("changeloop"))
        .ok_or_else(|| CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "cannot resolve user configuration directory; set CHANGELOOP_CONFIG_HOME"
                .into(),
        })
}

fn user_config_directory_override(
    variables: &BTreeMap<String, String>,
) -> Option<std::path::PathBuf> {
    if let Some(path) = variables
        .get("CHANGELOOP_CONFIG_HOME")
        .filter(|value| !value.trim().is_empty())
    {
        return Some(Path::new(path).to_path_buf());
    }
    if let Some(path) = variables
        .get("XDG_CONFIG_HOME")
        .filter(|value| !value.trim().is_empty())
    {
        return Some(Path::new(path).join("changeloop"));
    }
    None
}

fn auth_login_command(provider: &str) -> Result<(), CliFailure> {
    use zeroize::Zeroize as _;
    if !matches!(provider, "anthropic" | "openai") {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "provider must be 'anthropic' or 'openai'".into(),
        });
    }
    let mut secret =
        rpassword::prompt_password(format!("{provider} API credential: ")).map_err(io_failure)?;
    let result = changeloop_ops::auth_login(
        &auth_registry_path()?,
        &changeloop_ops::OsCredentialStore,
        provider,
        &secret,
    );
    secret.zeroize();
    result.map_err(release_failure)?;
    print_pretty_json(&json!({
        "provider": provider,
        "authenticated": true,
        "storage": "operating-system credential store"
    }))
}

fn auth_list_command() -> Result<(), CliFailure> {
    let profiles =
        changeloop_ops::auth_list(&auth_registry_path()?, &changeloop_ops::OsCredentialStore)
            .map_err(release_failure)?;
    print_pretty_json(&profiles)
}

fn auth_logout_command(provider: &str) -> Result<(), CliFailure> {
    if !matches!(provider, "anthropic" | "openai") {
        return Err(invalid_input("provider must be 'anthropic' or 'openai'"));
    }
    changeloop_ops::auth_logout(
        &auth_registry_path()?,
        &changeloop_ops::OsCredentialStore,
        provider,
    )
    .map_err(release_failure)?;
    print_pretty_json(&json!({"provider":provider,"authenticated":false}))
}

fn completion(shell: &str) -> Result<(), CliFailure> {
    print!(
        "{}",
        changeloop_ops::shell_completion(shell).map_err(release_failure)?
    );
    Ok(())
}

fn models() -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let mut environment = service_environment(&root)?;
    let (selected_provider, selected_model) = configure_selected_model(&mut environment);
    let catalog = changeloop_provider_adapters::configured_catalog(&environment);
    let configured = catalog.all();
    print_pretty_json(&json!({
        "maturity":"experimental",
        "configured":configured,
        "selectedProvider":selected_provider,
        "selectedModel":selected_model,
        "source":"provider_router_catalog",
        "note":"authenticated discovery is available to provider clients; this command performs no network access"
    }))
}

fn configure_selected_model(
    environment: &mut BTreeMap<String, String>,
) -> (Option<String>, Option<String>) {
    let selected_provider = environment.get("CHANGELOOP_PROVIDER").cloned();
    let selected_model = environment.get("CHANGELOOP_MODEL").cloned();
    if let (Some(provider), Some(model)) = (&selected_provider, &selected_model) {
        let variable = match provider.as_str() {
            "anthropic" => Some("ANTHROPIC_MODEL"),
            "openai" => Some("OPENAI_MODEL"),
            _ => None,
        };
        if let Some(variable) = variable {
            environment.entry(variable.into()).or_insert(model.clone());
        }
    }
    (selected_provider, selected_model)
}

fn doctor() -> Result<(), CliFailure> {
    use changeloop_ops::CredentialStore as _;
    let executable = env::current_exe().map_err(io_failure)?;
    let root = env::current_dir().map_err(io_failure)?;
    let git_available = env::var_os("PATH")
        .is_some_and(|paths| env::split_paths(&paths).any(|path| path.join("git").is_file()));
    let state = root.join(".changeloop");
    let user_config = user_config_directory()?;
    let setup_path = first_run_setup_path()?;
    let setup = changeloop_ops::load_first_run_setup(&setup_path).map_err(ops_failure)?;
    let sandbox = changeloop_ops::diagnose_sandbox(
        &root,
        setup
            .as_ref()
            .map(|setup| setup.sandbox.clone())
            .unwrap_or(changeloop_ops::SandboxSelection::ReadOnly),
    );
    let pending_update_recovery = executable.parent().is_some_and(|parent| {
        executable.file_name().is_some_and(|name| {
            parent
                .join(format!(".{}.update-journal.json", name.to_string_lossy()))
                .exists()
        })
    });
    let database_path = root.join(".changeloop/state.db");
    let (database_ok, database_diagnostic) = match Storage::diagnose(&database_path) {
        Ok(diagnostic) => (
            true,
            serde_json::to_value(diagnostic).map_err(|_| CliFailure {
                code: EXIT_AGENT_FAILURE,
                message: "failed to serialize the database diagnostic".into(),
            })?,
        ),
        Err(changeloop_storage::StorageError::RecoveryRequired {
            code,
            path,
            detail,
            instructions,
        }) => (
            false,
            json!({"integrity":"recovery-required","code":code,"path":path,
                "detail":detail,"instructions":instructions,"databaseModified":false}),
        ),
        Err(error) => (
            false,
            json!({"integrity":"unavailable","detail":error.to_string(),
                "databaseModified":false}),
        ),
    };
    let credential_store = changeloop_ops::OsCredentialStore;
    print_pretty_json(&json!({
        "ok":git_available && !pending_update_recovery && database_ok,
        "gitAvailable":git_available,
        "stateDirectory":state,
        "paths":{
            "projectRoot":root,
            "projectConfig":root.join("changeloop.json"),
            "projectState":state,
            "sessionDatabase":root.join(".changeloop/state.db"),
            "privacySessions":root.join(".changeloop/privacy-sessions.json"),
            "userConfigDirectory":user_config,
            "userConfig":user_config.join("config.json"),
            "firstRunSetup":setup_path,
            "authRegistry":user_config.join("auth-profiles.json")
        },
        "firstRunConfigured":setup.is_some(),
        "sandbox":sandbox,
        "networkDestinations":{
            "modelProvider":setup.as_ref().map(|setup| format!("official {} API", setup.provider)),
            "web":"only domains allowed by project policy",
            "mcp":"only explicitly configured MCP servers"
        },
        "credentialStore":credential_store.backend_name(),
        "accessibility":{
            "keyboardOnly":true,
            "tuiHelp":"/help",
            "tuiQuit":"/quit or Escape",
            "headlessAlternative":true,
            "structuredJsonStatus":true
        },
        "installMethod":changeloop_ops::detect_install_method(&executable),
        "updatePathSafety":changeloop_ops::update_path_safety(),
        "pendingUpdateRecovery":pending_update_recovery,
        "database":database_diagnostic,
    }))
}

fn update_command(
    manifest_path: &str,
    artifact_path: &str,
    encoded_key: &str,
    target: Option<&String>,
) -> Result<(), CliFailure> {
    validate_public_path(manifest_path)?;
    validate_public_path(artifact_path)?;
    if let Some(target) = target {
        validate_public_path(target)?;
    }
    let manifest: changeloop_ops::SignedUpdateManifest = serde_json::from_slice(
        &read_regular_bounded_cli(Path::new(manifest_path), MAX_CLI_JSON_BYTES)
            .map_err(io_failure)?,
    )
    .map_err(|error| CliFailure {
        code: EXIT_INVALID_INPUT,
        message: format!("invalid update manifest: {error}"),
    })?;
    let key = changeloop_ops::decode_public_key(encoded_key).map_err(release_failure)?;
    let target = match target {
        Some(target) => std::path::PathBuf::from(target),
        None => {
            let executable = env::current_exe().map_err(io_failure)?;
            ensure_implicit_self_update_allowed(&executable)?;
            executable
        }
    };
    changeloop_ops::apply_update_with_self_check(
        &target,
        Path::new(artifact_path),
        &manifest,
        &key,
        env!("CARGO_PKG_VERSION"),
    )
    .map_err(release_failure)?;
    print_pretty_json(&json!({
        "updated": true,
        "target": display_path(&target),
        "version": manifest.manifest.version
    }))
}

fn ensure_implicit_self_update_allowed(executable: &Path) -> Result<(), CliFailure> {
    use changeloop_ops::InstallMethod;
    let instruction = match changeloop_ops::detect_install_method(executable) {
        InstallMethod::Standalone => return Ok(()),
        InstallMethod::Homebrew => "run `brew upgrade changeloop-cli`",
        InstallMethod::Cargo => "run `cargo install changeloop-cli --locked`",
        InstallMethod::Npm => "run `npm update --global changeloop-cli`",
        InstallMethod::Unknown => {
            "use the owning package manager or pass an explicit standalone `--target`"
        }
    };
    Err(CliFailure {
        code: EXIT_INVALID_INPUT,
        message: format!("refusing to self-replace a package-managed installation; {instruction}"),
    })
}

fn update_check_command(
    manifest_path: &str,
    encoded_key: &str,
    channel: &str,
    offline: bool,
) -> Result<(), CliFailure> {
    validate_public_path(manifest_path)?;
    let signed: changeloop_ops::SignedUpdateChannelManifest = serde_json::from_slice(
        &read_regular_bounded_cli(Path::new(manifest_path), MAX_CLI_JSON_BYTES)
            .map_err(io_failure)?,
    )
    .map_err(|error| CliFailure {
        code: EXIT_INVALID_INPUT,
        message: format!("invalid signed channel manifest: {error}"),
    })?;
    let key = changeloop_ops::decode_public_key(encoded_key).map_err(release_failure)?;
    let release =
        changeloop_ops::discover_update(&signed, &key, env!("CARGO_PKG_VERSION"), channel, offline)
            .map_err(release_failure)?;
    print_pretty_json(&json!({
        "channel":channel,
        "currentVersion":env!("CARGO_PKG_VERSION"),
        "update":release,
        "offline":offline,
        "signatureVerified":true
    }))
}

fn update_recover_command(target: &Path) -> Result<(), CliFailure> {
    let recovered = changeloop_ops::recover_update(target).map_err(release_failure)?;
    print_pretty_json(&json!({
        "target":target,
        "recovered":recovered,
        "installMethod":changeloop_ops::detect_install_method(target)
    }))
}

fn release_failure(error: changeloop_ops::ReleaseError) -> CliFailure {
    use changeloop_ops::ReleaseError;
    let code = match error {
        ReleaseError::Credential(_) => EXIT_AUTH_PROVIDER_FAILURE,
        ReleaseError::InvalidProvider
        | ReleaseError::EmptyCredential
        | ReleaseError::InvalidCredential
        | ReleaseError::UnsupportedShell
        | ReleaseError::InvalidPublicKey
        | ReleaseError::InvalidTarget
        | ReleaseError::InvalidVersion
        | ReleaseError::InvalidChannel
        | ReleaseError::InsecureManifestSource
        | ReleaseError::OfflineRemoteSource => EXIT_INVALID_INPUT,
        _ => EXIT_UPDATE_FAILURE,
    };
    CliFailure {
        code,
        message: error.to_string(),
    }
}

fn status() -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let resolved = resolve_config(&root)?;
    let operational = operational::status_value(&root)?;
    let variables = service_environment(&root)?;
    let provider_configured =
        variables.contains_key("CHANGELOOP_PROVIDER") && variables.contains_key("CHANGELOOP_MODEL");
    let provider_ready = environment_backend(variables, &changeloop_ops::OsCredentialStore)?
        .readiness()
        .is_ok();
    let output = json!({
        "maturity": "experimental",
        "repository": root,
        "mode": resolved.config.mode,
        "conversationMutationAllowed": false,
        "providerConfigured": provider_configured,
        "providerReady": provider_ready,
        "onboardingRequired": !provider_ready,
        "nextStep": if provider_ready { Value::Null } else {
            json!("cloop setup status; cloop auth login <anthropic|openai>; cloop doctor")
        },
        "analyticsEnabled": resolved.config.telemetry.analytics,
        "crashUploadEnabled": resolved.config.telemetry.crash_upload,
        "operational": operational,
        "extensions": extension_status_value(&root),
    });
    print_pretty_json(&output)
}

fn explain_config(field: &str) -> Result<(), CliFailure> {
    let root = env::current_dir().map_err(io_failure)?;
    let resolved = resolve_config(&root)?;
    let explanation = resolved.explain(field).map_err(|error| CliFailure {
        code: EXIT_INVALID_INPUT,
        message: error.to_string(),
    })?;
    print_pretty_json(&explanation)
}

fn resolve_config(root: &Path) -> Result<changeloop_config::ResolvedConfig, CliFailure> {
    let mut layers = Vec::new();
    let variables = unicode_environment();
    let legacy_path = root.join("foundation.json");
    if let Some(value) = read_optional_json(&legacy_path)? {
        layers.push(
            ConfigLayer::from_foundation_json(display_path(&legacy_path), &value).map_err(
                |error| CliFailure {
                    code: EXIT_INVALID_INPUT,
                    message: error.to_string(),
                },
            )?,
        );
    }
    let project_path = root.join("changeloop.json");
    if let Some(value) = read_optional_json(&project_path)? {
        layers.push(
            ConfigLayer::from_native_json(
                ConfigSource::Project,
                display_path(&project_path),
                0,
                value,
            )
            .map_err(|error| CliFailure {
                code: EXIT_INVALID_INPUT,
                message: error.to_string(),
            })?,
        );
    }
    if let Ok(user_directory) = user_config_directory() {
        let user_path = user_directory.join("config.json");
        if let Some(value) = read_optional_json(&user_path)? {
            layers.push(
                ConfigLayer::from_native_json(
                    ConfigSource::User,
                    display_path(&user_path),
                    0,
                    value,
                )
                .map_err(|error| CliFailure {
                    code: EXIT_INVALID_INPUT,
                    message: error.to_string(),
                })?,
            );
        }
    }
    layers.push(
        ConfigLayer::from_environment(ConfigSource::LegacyEnvironment, "process", &variables)
            .map_err(|error| CliFailure {
                code: EXIT_INVALID_INPUT,
                message: error.to_string(),
            })?,
    );
    layers.push(
        ConfigLayer::from_environment(ConfigSource::NativeEnvironment, "process", &variables)
            .map_err(|error| CliFailure {
                code: EXIT_INVALID_INPUT,
                message: error.to_string(),
            })?,
    );
    ConfigResolver::resolve(layers).map_err(|error| CliFailure {
        code: EXIT_INVALID_INPUT,
        message: error.to_string(),
    })
}

fn read_optional_json(path: &Path) -> Result<Option<Value>, CliFailure> {
    let bytes = match read_regular_bounded_cli(path, MAX_CLI_JOURNAL_BYTES) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_failure(error)),
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| CliFailure {
            code: EXIT_INVALID_INPUT,
            message: format!("invalid configuration {}: {error}", display_path(path)),
        })
}

fn mcp_registry(root: &Path) -> Result<Value, CliFailure> {
    let path = root.join(".changeloop/mcp.json");
    Ok(read_optional_json(&path)?.unwrap_or_else(|| json!({ "servers": {} })))
}

fn extension_status(root: &Path) -> Result<(), CliFailure> {
    print_pretty_json(&extension_status_value(root))
}

fn extension_status_value(root: &Path) -> Value {
    let report = changeloop_mcp::discover_extensions(root);
    let mut host = changeloop_mcp::ExtensionHost::with_output_limit(root.to_owned(), 1024 * 1024);
    let mut load_failures = Vec::new();
    let discovered = report
        .discovered
        .into_iter()
        .map(|extension| {
            let host_state = match extension.manifest.runtime {
                None => "discovery_only".to_owned(),
                Some(changeloop_mcp::ExtensionRuntime::StdioV1) => {
                    match changeloop_mcp::ExecutableExtensionHandler::new(
                        root,
                        &extension.entry_path,
                        1024 * 1024,
                        changeloop_mcp::ExtensionInputProvenance::UserInput,
                    )
                    .and_then(|handler| {
                        host.register(
                            extension.manifest.id.clone(),
                            extension.manifest.kind,
                            Arc::new(handler),
                        )
                        .map_err(|error| error.to_string())
                    }) {
                        Ok(()) => host
                            .health(&extension.manifest.id)
                            .map(|health| format!("{health:?}").to_ascii_lowercase())
                            .unwrap_or_else(|_| "failed".into()),
                        Err(message) => {
                            load_failures.push(json!({
                                "path":extension.manifest_path,
                                "message":message,
                                "isolated":true
                            }));
                            "failed".into()
                        }
                    }
                }
            };
            json!({
                "id":extension.manifest.id,
                "kind":extension.manifest.kind,
                "version":extension.manifest.version,
                "runtime":extension.manifest.runtime,
                "timeoutMs":extension.manifest.timeout_ms,
                "manifest":extension.manifest_path,
                "entry":extension.entry_path,
                "discovery":"valid",
                "hostState":host_state
            })
        })
        .collect::<Vec<_>>();
    let mut failures = report
        .failures
        .into_iter()
        .map(|failure| json!({"path":failure.path,"message":failure.message,"isolated":true}))
        .collect::<Vec<_>>();
    failures.append(&mut load_failures);
    let loadable_handlers = discovered
        .iter()
        .filter(|extension| extension["hostState"] == "healthy")
        .count();
    json!({
        "maturity":"experimental",
        "discovered":discovered,
        "failures":failures,
        "execution":{
            "available":changeloop_mcp::executable_extension_sandbox_available(),
            "contract":"bounded-stdio-v1",
            "loadableHandlers":loadable_handlers,
            "retention":"probe-only; runtime executions own their own handler host",
            "authority":{"land":false,"expandScope":false,"grantPermission":false,"changePolicy":false},
            "provenance":"mcp-content"
        }
    })
}

fn extension_run(root: &Path, id: &str, input: Value) -> Result<(), CliFailure> {
    let report = changeloop_mcp::discover_extensions(root);
    let extension = report
        .discovered
        .into_iter()
        .find(|extension| extension.manifest.id == id)
        .ok_or_else(|| CliFailure {
            code: EXIT_INVALID_INPUT,
            message: format!("extension '{id}' was not discovered"),
        })?;
    if extension.manifest.runtime != Some(changeloop_mcp::ExtensionRuntime::StdioV1) {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: format!("extension '{id}' does not explicitly declare runtime 'stdio-v1'"),
        });
    }
    let handler = changeloop_mcp::ExecutableExtensionHandler::new(
        root,
        &extension.entry_path,
        1024 * 1024,
        changeloop_mcp::ExtensionInputProvenance::UserInput,
    )
    .map_err(|message| CliFailure {
        code: EXIT_INVALID_INPUT,
        message,
    })?;
    let mut host = changeloop_mcp::ExtensionHost::with_output_limit(root.to_owned(), 1024 * 1024);
    host.register(id.to_owned(), extension.manifest.kind, Arc::new(handler))
        .map_err(|error| CliFailure {
            code: EXIT_AGENT_FAILURE,
            message: error.to_string(),
        })?;
    let output = host
        .invoke(
            id,
            input,
            Duration::from_millis(extension.manifest.timeout_ms.clamp(10, 60_000)),
        )
        .map_err(|error| CliFailure {
            code: EXIT_AGENT_FAILURE,
            message: error.to_string(),
        })?;
    print_pretty_json(&json!({
        "id":id,
        "health":host.health(id).ok(),
        "output":output,
        "provenance":"mcp-content",
        "untrusted":true
    }))
}

fn mcp_add(root: &Path, name: &str, transport: &str, target: &str) -> Result<(), CliFailure> {
    if name.is_empty()
        || name.len() > MAX_PUBLIC_IDENTIFIER_BYTES
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "MCP server name must use letters, numbers, '-', '_' or '.'".into(),
        });
    }
    if !matches!(transport, "stdio" | "unix" | "http") || target.is_empty() {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "MCP transport must be stdio, unix, or http and target must be non-empty"
                .into(),
        });
    }
    validate_public_path(target)?;
    if transport == "http" {
        let endpoint = Url::parse(target)
            .map_err(|_| invalid_input("MCP HTTP target must be an absolute URL"))?;
        let loopback_http = endpoint.scheme() == "http"
            && endpoint
                .host_str()
                .is_some_and(|host| matches!(host, "127.0.0.1" | "::1"));
        if (endpoint.scheme() != "https" && !loopback_http)
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(invalid_input(
                "MCP HTTP target requires HTTPS (or IP loopback HTTP) and no userinfo, query, or fragment",
            ));
        }
    }
    let mut registry = mcp_registry(root)?;
    let servers = registry
        .get_mut("servers")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| CliFailure {
            code: EXIT_INVALID_INPUT,
            message: "invalid .changeloop/mcp.json: servers must be an object".into(),
        })?;
    if servers.contains_key(name) {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: format!("MCP server already exists: {name}"),
        });
    }
    servers.insert(
        name.into(),
        json!({ "transport": transport, "target": target }),
    );
    write_mcp_registry(root, &registry)?;
    print_pretty_json(&json!({
        "name": name,
        "added": true,
        "transport": transport,
        "target": target
    }))
}

fn mcp_remove(root: &Path, name: &str) -> Result<(), CliFailure> {
    validate_public_identifier(name)?;
    let mut registry = mcp_registry(root)?;
    let removed = registry
        .get_mut("servers")
        .and_then(Value::as_object_mut)
        .and_then(|servers| servers.remove(name));
    if removed.is_none() {
        return Err(CliFailure {
            code: EXIT_INVALID_INPUT,
            message: format!("MCP server does not exist: {name}"),
        });
    }
    write_mcp_registry(root, &registry)?;
    print_pretty_json(&json!({"name":name,"removed":true}))
}

fn write_mcp_registry(root: &Path, registry: &Value) -> Result<(), CliFailure> {
    let directory = root.join(".changeloop");
    fs::create_dir_all(&directory).map_err(io_failure)?;
    let directory_metadata = fs::symlink_metadata(&directory).map_err(io_failure)?;
    if !directory_metadata.is_dir() || directory_metadata.file_type().is_symlink() {
        return Err(invalid_input(
            "MCP registry directory must be a regular project-owned directory",
        ));
    }
    let canonical_directory = fs::canonicalize(&directory).map_err(io_failure)?;
    let canonical_root = fs::canonicalize(root).map_err(io_failure)?;
    if canonical_directory.parent() != Some(canonical_root.as_path()) {
        return Err(invalid_input(
            "MCP registry directory resolves outside the project root",
        ));
    }
    let path = directory.join("mcp.json");
    let mut temporary = NamedTempFile::new_in(&directory).map_err(io_failure)?;
    serde_json::to_writer_pretty(&mut temporary, registry).map_err(|error| CliFailure {
        code: EXIT_INVALID_INPUT,
        message: format!("cannot serialize MCP registry: {error}"),
    })?;
    use std::io::Write;
    temporary.write_all(b"\n").map_err(io_failure)?;
    if temporary.as_file().metadata().map_err(io_failure)?.len() > MAX_CLI_JOURNAL_BYTES {
        return Err(invalid_input(format!(
            "MCP registry would exceed the safe {MAX_CLI_JOURNAL_BYTES}-byte limit"
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(io_failure)?;
    }
    temporary.as_file().sync_all().map_err(io_failure)?;
    let current_metadata = fs::symlink_metadata(&directory).map_err(io_failure)?;
    if !current_metadata.is_dir()
        || current_metadata.file_type().is_symlink()
        || fs::canonicalize(&directory).map_err(io_failure)? != canonical_directory
    {
        return Err(invalid_input(
            "MCP registry directory changed while state was staged",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if directory_metadata.dev() != current_metadata.dev()
            || directory_metadata.ino() != current_metadata.ino()
        {
            return Err(invalid_input(
                "MCP registry directory changed while state was staged",
            ));
        }
    }
    temporary
        .persist(&path)
        .map_err(|error| io_failure(error.error))?;
    #[cfg(unix)]
    fs::File::open(&directory)
        .and_then(|directory| directory.sync_all())
        .map_err(io_failure)?;
    Ok(())
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn io_failure(error: std::io::Error) -> CliFailure {
    CliFailure {
        code: EXIT_INVALID_INPUT,
        message: format!("filesystem error: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn help_is_read_only_and_available() {
        assert!(run(vec!["--help".into()]).await.is_ok());
    }

    #[tokio::test]
    async fn unknown_commands_have_a_distinct_invalid_input_code() {
        let failure = run(vec!["unknown".into(), "arguments".into()])
            .await
            .unwrap_err();
        assert_eq!(failure.code, EXIT_INVALID_INPUT);
    }

    #[test]
    fn public_argument_bounds_are_byte_exact_and_unicode_safe() {
        assert!(validate_prompt("อธิบายระบบ authentication 🔐").is_ok());
        assert!(validate_prompt("").is_err());
        assert!(validate_prompt(" \t").is_err());
        assert!(validate_prompt(&"x".repeat(MAX_CLI_ARGUMENT_BYTES)).is_ok());
        assert!(validate_prompt(&"x".repeat(MAX_CLI_ARGUMENT_BYTES + 1)).is_err());
        assert!(validate_public_identifier(&"a".repeat(256)).is_ok());
        assert!(validate_public_identifier(&"a".repeat(257)).is_err());
        assert!(validate_public_identifier("เซสชัน").is_err());
        assert!(validate_public_path("โครงการ/ไฟล์.rs").is_ok());
        assert!(validate_cli_arguments(&vec!["x".into(); 65]).is_err());
        assert!(validate_cli_arguments(&vec!["x".repeat(MAX_CLI_ARGUMENT_BYTES); 17]).is_err());
        assert!(validate_cli_arguments(&["control\nvalue".into()]).is_err());
    }

    #[test]
    fn cli_json_reader_rejects_sparse_oversize_and_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let sparse = root.path().join("sparse.json");
        fs::File::create(&sparse)
            .unwrap()
            .set_len(MAX_CLI_JOURNAL_BYTES + 1)
            .unwrap();
        assert_eq!(
            read_regular_bounded_cli(&sparse, MAX_CLI_JOURNAL_BYTES)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = root.path().join("target.json");
            let link = root.path().join("link.json");
            fs::write(&target, b"{}").unwrap();
            symlink(&target, &link).unwrap();
            assert!(read_regular_bounded_cli(&link, MAX_CLI_JSON_BYTES).is_err());
            assert!(read_optional_json(&link).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn mcp_registry_rejects_symlinked_state_directory() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), root.path().join(".changeloop")).unwrap();

        assert!(write_mcp_registry(root.path(), &json!({"servers": {}})).is_err());
        assert!(!outside.path().join("mcp.json").exists());
    }

    #[test]
    fn mcp_registry_never_writes_state_it_cannot_reload() {
        let root = tempfile::tempdir().unwrap();
        let registry = json!({"servers": {"fixture": {
            "transport": "stdio",
            "target": "x".repeat(MAX_CLI_JOURNAL_BYTES as usize)
        }}});

        assert!(write_mcp_registry(root.path(), &registry).is_err());
        assert!(!root.path().join(".changeloop/mcp.json").exists());
    }

    #[test]
    fn missing_migration_digest_and_serialization_failure_are_typed_not_panics() {
        assert_eq!(migrate(true, None).unwrap_err().code, EXIT_INVALID_INPUT);

        struct FailingSerialization;
        impl Serialize for FailingSerialization {
            fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                Err(serde::ser::Error::custom("injected serialization failure"))
            }
        }
        let failure = print_pretty_json(&FailingSerialization).unwrap_err();
        assert_eq!(failure.code, EXIT_AGENT_FAILURE);
        assert!(!failure.message.contains("injected"));
    }

    #[test]
    fn headless_provider_setup_has_a_distinct_failure_code() {
        let failure =
            surface_failure(changeloop_app_server::executable::SurfaceError::ProviderRequired);
        assert_eq!(failure.code, EXIT_AUTH_PROVIDER_FAILURE);
    }

    #[test]
    fn implicit_self_update_delegates_package_managed_installs() {
        for (path, manager) in [
            (
                "/opt/homebrew/Cellar/changeloop/1/bin/cloop",
                "brew upgrade",
            ),
            ("/Users/test/.cargo/bin/cloop", "cargo install"),
            (
                "/usr/local/lib/node_modules/changeloop-cli/bin/cloop",
                "npm update",
            ),
        ] {
            let failure = ensure_implicit_self_update_allowed(Path::new(path)).unwrap_err();
            assert_eq!(failure.code, EXIT_INVALID_INPUT);
            assert!(failure.message.contains(manager));
        }
        assert!(
            ensure_implicit_self_update_allowed(Path::new("/Applications/cloop/bin/cloop")).is_ok()
        );
    }

    #[test]
    fn surface_failures_have_stable_distinct_exit_codes() {
        assert_eq!(
            surface_failure(changeloop_app_server::executable::SurfaceError::Cancelled).code,
            EXIT_CANCELLATION
        );
        assert_eq!(
            surface_failure(changeloop_app_server::executable::SurfaceError::Runtime(
                "fixture".into()
            ))
            .code,
            EXIT_AGENT_FAILURE
        );
        assert_eq!(
            surface_failure(changeloop_app_server::executable::SurfaceError::Proof(
                "fixture".into()
            ))
            .code,
            EXIT_PROOF_FAILURE
        );
        assert_ne!(EXIT_APPROVAL_REQUIRED, EXIT_LIFECYCLE_REJECTION);
        assert_eq!(EXIT_PROOF_FAILURE, 5);
        assert_ne!(EXIT_PROOF_FAILURE, EXIT_AGENT_FAILURE);
    }

    #[test]
    fn headless_control_preserves_public_wire_exit_codes() {
        assert_eq!(
            wire_error_exit_code("provider_required"),
            EXIT_AUTH_PROVIDER_FAILURE
        );
        assert_eq!(
            wire_error_exit_code("approval_required"),
            EXIT_APPROVAL_REQUIRED
        );
        assert_eq!(wire_error_exit_code("cancelled"), EXIT_CANCELLATION);
        assert_eq!(
            wire_error_exit_code("lifecycle_rejected"),
            EXIT_LIFECYCLE_REJECTION
        );
    }

    #[test]
    fn invalid_auth_provider_is_rejected_before_hidden_input() {
        let failure = auth_login_command("invalid-provider").unwrap_err();
        assert_eq!(failure.code, EXIT_INVALID_INPUT);
        assert!(failure.message.contains("anthropic"));
    }

    #[test]
    fn provider_backend_uses_official_stored_auth_profile() {
        let store = changeloop_ops::MemoryCredentialStore::default();
        changeloop_ops::CredentialStore::set(&store, "openai", "stored-secret").unwrap();
        let variables = BTreeMap::from([
            ("CHANGELOOP_PROVIDER".into(), "openai".into()),
            ("CHANGELOOP_MODEL".into(), "fixture-model".into()),
        ]);
        let backend = environment_backend(variables, &store).unwrap();
        assert!(backend.readiness().is_ok());
    }

    #[test]
    fn auth_profiles_follow_platform_configuration_directories() {
        let xdg = BTreeMap::from([("XDG_CONFIG_HOME".into(), "/config".into())]);
        assert_eq!(
            user_config_directory_override(&xdg)
                .unwrap()
                .join("auth-profiles.json"),
            Path::new("/config/changeloop/auth-profiles.json")
        );
        let override_path = BTreeMap::from([(
            "CHANGELOOP_CONFIG_HOME".into(),
            "/managed/changeloop".into(),
        )]);
        assert_eq!(
            user_config_directory_override(&override_path)
                .unwrap()
                .join("auth-profiles.json"),
            Path::new("/managed/changeloop/auth-profiles.json")
        );
    }

    #[test]
    fn missing_configuration_uses_safe_defaults() {
        let root = std::path::PathBuf::from("path-that-does-not-exist");
        let resolved = resolve_config(&root).unwrap();
        assert!(!resolved.config.telemetry.analytics);
        assert!(!resolved.config.telemetry.crash_upload);
        assert!(resolved.config.web.https_only);
    }

    #[test]
    fn selected_changeloop_model_is_visible_in_provider_catalog() {
        let mut environment = BTreeMap::from([
            ("CHANGELOOP_PROVIDER".into(), "openai".into()),
            ("CHANGELOOP_MODEL".into(), "fixture-model".into()),
        ]);
        let selected = configure_selected_model(&mut environment);
        assert_eq!(
            selected,
            (Some("openai".into()), Some("fixture-model".into()))
        );
        let catalog = changeloop_provider_adapters::configured_catalog(&environment);
        assert_eq!(catalog.all().len(), 1);
        assert_eq!(catalog.all()[0].id, "fixture-model");
        assert_eq!(
            catalog.all()[0].status,
            changeloop_provider_adapters::ModelStatus::Unknown
        );
    }

    #[test]
    fn mcp_registry_add_list_remove_is_atomic_and_separate_from_main_config() {
        let root = tempfile::tempdir().unwrap();
        mcp_add(root.path(), "local-tools", "stdio", "./bin/local-tools").unwrap();
        let registry = mcp_registry(root.path()).unwrap();
        assert_eq!(registry["servers"]["local-tools"]["transport"], "stdio");
        assert!(!root.path().join("changeloop.json").exists());
        mcp_remove(root.path(), "local-tools").unwrap();
        assert!(
            mcp_registry(root.path()).unwrap()["servers"]
                .as_object()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn extension_status_loads_only_explicit_runtimes_and_isolates_bad_manifests() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join(".changeloop/extensions");
        fs::create_dir_all(directory.join("valid")).unwrap();
        fs::write(directory.join("valid/entry.js"), "export default {};").unwrap();
        fs::write(
            directory.join("valid/manifest.json"),
            r#"{"id":"valid","kind":"extension","entry":"entry.js"}"#,
        )
        .unwrap();
        fs::write(directory.join("broken.json"), "not-json").unwrap();
        let status = extension_status_value(root.path());
        assert_eq!(status["discovered"].as_array().unwrap().len(), 1);
        assert_eq!(status["failures"].as_array().unwrap().len(), 1);
        assert_eq!(
            status["execution"]["available"],
            changeloop_mcp::executable_extension_sandbox_available()
        );
        assert_eq!(status["execution"]["contract"], "bounded-stdio-v1");
        assert_eq!(status["execution"]["loadableHandlers"], 0);
        assert_eq!(status["discovered"][0]["hostState"], "discovery_only");
    }

    #[cfg(unix)]
    #[test]
    fn extension_status_and_runner_report_real_handler_health() {
        use std::os::unix::fs::PermissionsExt;

        if !changeloop_mcp::executable_extension_sandbox_available() {
            return;
        }

        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join(".changeloop/extensions/fixture");
        fs::create_dir_all(&directory).unwrap();
        let entry = directory.join("entry.sh");
        fs::write(
            &entry,
            "#!/bin/sh\nprintf '%s' '{\"type\":\"data\",\"data\":{\"ok\":true}}'\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&entry).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&entry, permissions).unwrap();
        fs::write(
            directory.join("manifest.json"),
            r#"{"id":"fixture","kind":"extension","entry":"entry.sh","runtime":"stdio-v1","timeout_ms":10000}"#,
        )
        .unwrap();

        let status = extension_status_value(root.path());
        assert_eq!(status["execution"]["loadableHandlers"], 1);
        assert_eq!(status["discovered"][0]["hostState"], "healthy");
        extension_run(root.path(), "fixture", json!({"task":"test"})).unwrap();
    }
}
