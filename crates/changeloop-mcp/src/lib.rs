//! MCP transports, official OAuth contracts, and failure-isolated extensions.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use changeloop_policy::{
    AUTO_CLASSIFIER_VERSION, DecisionAction, ExecutionMode, HardBoundary, LifecycleAuthority,
    OperationKind, PermissionKind, PolicyRequest, Reversibility, RuleAction, SandboxCapability,
    evaluate,
};
use changeloop_sandbox::{
    EnforcementLevel, Policy as SandboxPolicy, ReadScope, SandboxError, SandboxedChild, Spawn,
    StdioPlan, exceptions,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Component, Path, PathBuf};
use std::process::{ChildStdin, ChildStdout};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;
use url::Url;
use uuid::Uuid;
use zeroize::Zeroize;

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_OAUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_OAUTH_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_MCP_TRANSPORT_BYTES: usize = 16 * 1024 * 1024;
const MAX_MCP_CONNECTIONS: usize = 256;
const MAX_MCP_TOOLS: usize = 1_024;
const MAX_MCP_RESOURCE_PATHS: usize = 1_024;
const MAX_MCP_IDENTIFIER_BYTES: usize = 256;
const MAX_EXTENSION_INPUT_BYTES: usize = 1024 * 1024;
const MAX_EXTENSIONS: usize = 1_024;
const MAX_EXTENSION_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    #[must_use]
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

impl Default for Cancellation {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TransportLimits {
    pub max_request_bytes: usize,
    pub max_response_bytes: usize,
}

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("MCP request exceeds {limit} bytes")]
    RequestTooLarge { limit: usize },
    #[error("MCP response exceeds {limit} bytes")]
    ResponseTooLarge { limit: usize },
    #[error("MCP request was cancelled")]
    Cancelled,
    #[error("MCP transport I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("MCP HTTP transport failed: {0}")]
    Http(String),
    #[error("MCP transport is disposed")]
    Disposed,
    /// Nothing on this host can enforce the server's policy, and no register
    /// entry authorised running it anyway.
    ///
    /// This is the loud path. An MCP stdio server is untrusted third-party code
    /// executing on the user's machine — five of seven surveyed production MCP
    /// clients run tools with full host privileges — so "no backend" resolves to
    /// a refusal that says so, never to a silent host-privileged spawn.
    #[error("MCP stdio server refused: {0}")]
    SandboxUnavailable(String),
}

pub trait McpTransport: Send {
    fn request(
        &mut self,
        message: &[u8],
        cancellation: &Cancellation,
    ) -> Result<Vec<u8>, TransportError>;
    fn close(&mut self);
}

/// The one coarse profile an MCP stdio server runs under.
///
/// Deny by default, then exactly two allowances: the project tree is writable,
/// because a server that cannot write its own workspace cannot do useful work,
/// and nothing else is. Reads stay broad because the ecosystem is predominantly
/// Node and Python and interpreter startup consults dynamic system paths.
/// Network egress is denied; a server that needs a destination gets a
/// transport-level rule in the sandbox register, never an ad-hoc hole here.
fn stdio_server_policy(working_directory: &Path) -> SandboxPolicy {
    // Seatbelt matches its filters against the *resolved* path of the file being
    // touched, so an unresolved workspace (`/var/...` where the real path is
    // `/private/var/...` on macOS) would produce a profile that silently grants
    // nothing.
    let workspace = std::fs::canonicalize(working_directory)
        .unwrap_or_else(|_| working_directory.to_path_buf());
    SandboxPolicy::deny_by_default(workspace.clone()).writable([workspace])
}

pub struct StdioTransport {
    child: SandboxedChild,
    stdin: ChildStdin,
    stdout: Option<BufReader<ChildStdout>>,
    limits: TransportLimits,
    disposed: bool,
}

impl StdioTransport {
    /// Starts an MCP stdio server inside the sandbox.
    ///
    /// Refuses when no backend on this host can enforce
    /// [`stdio_server_policy`]. Use [`StdioTransport::spawn_unenforced`] to run
    /// one anyway under the `mcp-stdio-server` register row.
    pub fn spawn(
        program: &Path,
        arguments: &[String],
        working_directory: &Path,
        limits: TransportLimits,
    ) -> Result<Self, TransportError> {
        Self::launch(program, arguments, working_directory, limits, false)
    }

    /// Starts an MCP stdio server on a host that cannot enforce the policy,
    /// under the enumerated `mcp-stdio-server` register row.
    ///
    /// The row exists because one vendor's Windows sandbox blocks Node from
    /// spawning any child process, which would break most of the predominantly
    /// Node MCP ecosystem the wrapping argument insists on protecting. Naming it
    /// is the only way to get a host-privileged MCP server, and the degradation
    /// is reported through [`changeloop_sandbox::set_degradation_reporter`]
    /// rather than being silent.
    pub fn spawn_unenforced(
        program: &Path,
        arguments: &[String],
        working_directory: &Path,
        limits: TransportLimits,
    ) -> Result<Self, TransportError> {
        Self::launch(program, arguments, working_directory, limits, true)
    }

    fn launch(
        program: &Path,
        arguments: &[String],
        working_directory: &Path,
        limits: TransportLimits,
        allow_unenforced: bool,
    ) -> Result<Self, TransportError> {
        validate_transport_limits(limits)?;
        if arguments.len() > 64
            || arguments.iter().any(|argument| {
                argument.len() > 16 * 1024 || argument.chars().any(char::is_control)
            })
            || arguments.iter().map(String::len).sum::<usize>() > 64 * 1024
        {
            return Err(TransportError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "MCP stdio arguments exceed safe bounds",
            )));
        }
        let mut spawn = Spawn::new(program, stdio_server_policy(working_directory))
            .arguments(arguments.to_vec())
            .working_directory(working_directory)
            .stdin(StdioPlan::Piped)
            .stdout(StdioPlan::Piped)
            .stderr(StdioPlan::Null);
        if allow_unenforced {
            spawn = spawn.allow_unenforced(exceptions::MCP_STDIO_SERVER);
        }
        let mut child = spawn.spawn().map_err(transport_sandbox_error)?;
        let stdin = match child.take_stdin() {
            Some(stdin) => stdin,
            None => {
                child.terminate();
                return Err(std::io::Error::other("MCP child stdin is unavailable").into());
            }
        };
        let stdout = match child.take_stdout() {
            Some(stdout) => Some(BufReader::new(stdout)),
            None => {
                child.terminate();
                return Err(std::io::Error::other("MCP child stdout is unavailable").into());
            }
        };
        Ok(Self {
            child,
            stdin,
            stdout,
            limits,
            disposed: false,
        })
    }

    /// What enforcement this server actually got, so a caller can record a
    /// degraded backend rather than assuming the full profile applied.
    #[must_use]
    pub fn enforcement(&self) -> &changeloop_sandbox::Enforcement {
        self.child.enforcement()
    }
}

/// Maps a spawn refusal onto the transport vocabulary.
///
/// A host that cannot enforce the policy is never flattened into "the process
/// failed to start": the operator has to be able to tell a missing backend from
/// a missing binary.
fn transport_sandbox_error(error: SandboxError) -> TransportError {
    match error {
        SandboxError::Spawn(source) => TransportError::Io(source),
        other => TransportError::SandboxUnavailable(other.to_string()),
    }
}

impl McpTransport for StdioTransport {
    fn request(
        &mut self,
        message: &[u8],
        cancellation: &Cancellation,
    ) -> Result<Vec<u8>, TransportError> {
        validate_request(message, self.limits, cancellation, self.disposed)?;
        self.stdin.write_all(message)?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;
        let mut reader = self.stdout.take().ok_or(TransportError::Disposed)?;
        let max_response_bytes = self.limits.max_response_bytes;
        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let result = read_bounded_line(&mut reader, max_response_bytes);
            let _ = sender.send((reader, result));
        });
        loop {
            match receiver.recv_timeout(Duration::from_millis(5)) {
                Ok((reader, result)) => {
                    self.stdout = Some(reader);
                    if result.is_err() {
                        self.close();
                    }
                    return result;
                }
                Err(mpsc::RecvTimeoutError::Timeout) if cancellation.is_cancelled() => {
                    self.close();
                    return Err(TransportError::Cancelled);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.close();
                    return Err(TransportError::Disposed);
                }
            }
        }
    }

    fn close(&mut self) {
        if !self.disposed {
            // `terminate` signals the process group the sandbox crate created
            // for this child and then reaps the leader, so no descendant
            // outlives the transport and no defunct entry is left behind.
            self.child.terminate();
            self.disposed = true;
        }
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(unix)]
pub struct UnixTransport {
    stream: std::os::unix::net::UnixStream,
    limits: TransportLimits,
    disposed: bool,
}

#[cfg(unix)]
impl UnixTransport {
    pub fn connect(path: &Path, limits: TransportLimits) -> Result<Self, TransportError> {
        validate_transport_limits(limits)?;
        let stream = std::os::unix::net::UnixStream::connect(path)?;
        stream.set_read_timeout(Some(Duration::from_millis(10)))?;
        Ok(Self {
            stream,
            limits,
            disposed: false,
        })
    }
}

#[cfg(unix)]
impl McpTransport for UnixTransport {
    fn request(
        &mut self,
        message: &[u8],
        cancellation: &Cancellation,
    ) -> Result<Vec<u8>, TransportError> {
        validate_request(message, self.limits, cancellation, self.disposed)?;
        self.stream.write_all(message)?;
        self.stream.write_all(b"\n")?;
        let mut response = Vec::new();
        loop {
            if cancellation.is_cancelled() {
                self.close();
                return Err(TransportError::Cancelled);
            }
            let mut byte = [0_u8; 1];
            match std::io::Read::read(&mut self.stream, &mut byte) {
                Ok(0) => return Ok(response),
                Ok(_) if byte[0] == b'\n' => return Ok(response),
                Ok(_) => {
                    response.push(byte[0]);
                    if response.len() > self.limits.max_response_bytes {
                        self.close();
                        return Err(TransportError::ResponseTooLarge {
                            limit: self.limits.max_response_bytes,
                        });
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(error) => return Err(error.into()),
            }
        }
    }

    fn close(&mut self) {
        if !self.disposed {
            let _ = self.stream.shutdown(std::net::Shutdown::Both);
            self.disposed = true;
        }
    }
}

pub trait HttpClient: Send {
    fn post(
        &mut self,
        endpoint: &Url,
        body: &[u8],
        cancellation: &Cancellation,
        max_response_bytes: usize,
    ) -> Result<Vec<u8>, String>;

    fn close(&mut self, _endpoint: &Url) {}
}

/// HTTPS MCP client with redirects and ambient cookies disabled. Authentication
/// is supplied explicitly so browser state can never cross the trust boundary.
pub struct ReqwestHttpClient {
    client: reqwest::blocking::Client,
    bearer_token: Option<String>,
    session_id: Option<String>,
}

impl ReqwestHttpClient {
    pub fn new(timeout: Duration, bearer_token: Option<String>) -> Result<Self, TransportError> {
        if bearer_token.as_ref().is_some_and(|token| {
            token.is_empty()
                || token.len() > MAX_OAUTH_RESPONSE_BYTES
                || token.chars().any(char::is_control)
        }) {
            return Err(TransportError::Http("invalid bearer token".into()));
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| TransportError::Http(error.to_string()))?;
        Ok(Self {
            client,
            bearer_token,
            session_id: None,
        })
    }
}

impl Drop for ReqwestHttpClient {
    fn drop(&mut self) {
        self.bearer_token.zeroize();
        self.session_id.zeroize();
    }
}

impl HttpClient for ReqwestHttpClient {
    fn post(
        &mut self,
        endpoint: &Url,
        body: &[u8],
        cancellation: &Cancellation,
        max_response_bytes: usize,
    ) -> Result<Vec<u8>, String> {
        if endpoint.scheme() != "https" && !is_loopback_http(endpoint) {
            return Err("MCP HTTP requires HTTPS except for loopback testing".into());
        }
        if cancellation.is_cancelled() {
            return Err("request cancelled".into());
        }
        let mut request = self
            .client
            .post(endpoint.clone())
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", MCP_PROTOCOL_VERSION)
            .body(body.to_vec());
        if let Some(token) = &self.bearer_token {
            request = request.bearer_auth(token);
        }
        if let Some(session_id) = &self.session_id {
            request = request.header("mcp-session-id", session_id);
        }
        let response = request.send().map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("MCP HTTP returned {}", response.status()));
        }
        if let Some(session_id) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
        {
            if session_id.is_empty()
                || session_id.len() > MAX_MCP_IDENTIFIER_BYTES
                || session_id.chars().any(char::is_control)
            {
                return Err("invalid MCP session identifier".into());
            }
            self.session_id = Some(session_id.to_owned());
        }
        let is_event_stream = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("text/event-stream"));
        if response
            .content_length()
            .is_some_and(|length| length > max_response_bytes as u64)
        {
            return Err(format!("MCP response exceeds {max_response_bytes} bytes"));
        }
        let mut bytes = Vec::new();
        response
            .take(
                u64::try_from(max_response_bytes)
                    .unwrap_or(u64::MAX)
                    .saturating_add(1),
            )
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() > max_response_bytes {
            return Err(format!("MCP response exceeds {max_response_bytes} bytes"));
        }
        if cancellation.is_cancelled() {
            return Err("request cancelled".into());
        }
        if is_event_stream {
            extract_sse_json(&bytes)
        } else {
            Ok(bytes)
        }
    }

    fn close(&mut self, endpoint: &Url) {
        let Some(session_id) = self.session_id.take() else {
            return;
        };
        let mut request = self
            .client
            .delete(endpoint.clone())
            .header("mcp-session-id", session_id)
            .header("mcp-protocol-version", MCP_PROTOCOL_VERSION);
        if let Some(token) = &self.bearer_token {
            request = request.bearer_auth(token);
        }
        let _ = request.send();
    }
}

fn extract_sse_json(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "MCP SSE response is not UTF-8")?;
    let mut payload = None;
    for event in text.split("\n\n") {
        let data = event
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if !data.is_empty() {
            payload = Some(data.into_bytes());
        }
    }
    payload.ok_or_else(|| "MCP SSE response contained no data event".into())
}

fn is_loopback_http(endpoint: &Url) -> bool {
    endpoint.scheme() == "http"
        && endpoint
            .host_str()
            .is_some_and(|host| matches!(host, "127.0.0.1" | "::1"))
}

fn validate_http_endpoint(endpoint: &Url) -> Result<(), String> {
    if (endpoint.scheme() == "https" || is_loopback_http(endpoint))
        && endpoint.host_str().is_some()
        && endpoint.username().is_empty()
        && endpoint.password().is_none()
        && endpoint.query().is_none()
        && endpoint.fragment().is_none()
    {
        Ok(())
    } else {
        Err("MCP endpoint requires HTTPS (or literal loopback HTTP) without credentials, query, or fragment".into())
    }
}

pub struct HttpTransport<C: HttpClient> {
    client: C,
    endpoint: Url,
    limits: TransportLimits,
    disposed: bool,
}

impl<C: HttpClient> HttpTransport<C> {
    #[must_use]
    pub fn new(client: C, endpoint: Url, limits: TransportLimits) -> Self {
        Self {
            client,
            endpoint,
            limits,
            disposed: false,
        }
    }
}

impl<C: HttpClient> McpTransport for HttpTransport<C> {
    fn request(
        &mut self,
        message: &[u8],
        cancellation: &Cancellation,
    ) -> Result<Vec<u8>, TransportError> {
        validate_request(message, self.limits, cancellation, self.disposed)?;
        validate_http_endpoint(&self.endpoint).map_err(TransportError::Http)?;
        let response = self
            .client
            .post(
                &self.endpoint,
                message,
                cancellation,
                self.limits.max_response_bytes,
            )
            .map_err(TransportError::Http)?;
        if cancellation.is_cancelled() {
            return Err(TransportError::Cancelled);
        }
        if response.len() > self.limits.max_response_bytes {
            return Err(TransportError::ResponseTooLarge {
                limit: self.limits.max_response_bytes,
            });
        }
        Ok(response)
    }

    fn close(&mut self) {
        if !self.disposed {
            self.client.close(&self.endpoint);
            self.disposed = true;
        }
    }
}

impl<C: HttpClient> Drop for HttpTransport<C> {
    fn drop(&mut self) {
        self.close();
    }
}

fn validate_request(
    message: &[u8],
    limits: TransportLimits,
    cancellation: &Cancellation,
    disposed: bool,
) -> Result<(), TransportError> {
    if disposed {
        return Err(TransportError::Disposed);
    }
    if cancellation.is_cancelled() {
        return Err(TransportError::Cancelled);
    }
    validate_transport_limits(limits)?;
    if message.len() > limits.max_request_bytes {
        return Err(TransportError::RequestTooLarge {
            limit: limits.max_request_bytes,
        });
    }
    Ok(())
}

fn validate_transport_limits(limits: TransportLimits) -> Result<(), TransportError> {
    if limits.max_request_bytes == 0
        || limits.max_response_bytes == 0
        || limits.max_request_bytes > MAX_MCP_TRANSPORT_BYTES
        || limits.max_response_bytes > MAX_MCP_TRANSPORT_BYTES
    {
        Err(TransportError::Http(
            "MCP transport limits must be between 1 byte and 16 MiB".into(),
        ))
    } else {
        Ok(())
    }
}

fn read_bounded_line(
    reader: &mut impl BufRead,
    max_bytes: usize,
) -> Result<Vec<u8>, TransportError> {
    let mut response = Vec::new();
    loop {
        let (consumed, found_newline) = {
            let available = reader.fill_buf()?;
            if available.is_empty() {
                break;
            }
            let consumed = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(available.len(), |position| position + 1);
            response.extend_from_slice(&available[..consumed]);
            (consumed, available[consumed - 1] == b'\n')
        };
        reader.consume(consumed);
        if response.len() > max_bytes {
            return Err(TransportError::ResponseTooLarge { limit: max_bytes });
        }
        if found_newline {
            response.pop();
            break;
        }
    }
    Ok(response)
}

#[derive(Clone, Debug)]
pub struct OAuthClient {
    pub client_id: String,
    pub authorization_endpoint: Url,
    pub token_endpoint: Url,
    pub redirect_uri: Url,
    pub scopes: Vec<String>,
}

#[derive(Clone)]
pub struct OAuthAuthorization {
    pub state: String,
    pub code_verifier: String,
    pub code_challenge: String,
    pub authorization_url: Url,
}

impl std::fmt::Debug for OAuthAuthorization {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OAuthAuthorization")
            .field("state", &"[REDACTED]")
            .field("code_verifier", &"[REDACTED]")
            .field("code_challenge", &self.code_challenge)
            .field("authorization_url", &self.authorization_url)
            .finish()
    }
}

impl Drop for OAuthAuthorization {
    fn drop(&mut self) {
        self.code_verifier.zeroize();
    }
}

#[derive(Clone)]
pub struct OAuthTokenRequest {
    pub grant_type: &'static str,
    pub code: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub code_verifier: String,
}

impl std::fmt::Debug for OAuthTokenRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OAuthTokenRequest")
            .field("grant_type", &self.grant_type)
            .field("code", &"[REDACTED]")
            .field("client_id", &self.client_id)
            .field("redirect_uri", &self.redirect_uri)
            .field("code_verifier", &"[REDACTED]")
            .finish()
    }
}

impl Drop for OAuthTokenRequest {
    fn drop(&mut self) {
        self.code.zeroize();
        self.code_verifier.zeroize();
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OAuthTokenSet {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

impl std::fmt::Debug for OAuthTokenSet {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OAuthTokenSet")
            .field("access_token", &"[REDACTED]")
            .field("token_type", &self.token_type)
            .field("expires_in", &self.expires_in)
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field("scope", &self.scope)
            .finish()
    }
}

impl Drop for OAuthTokenSet {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OAuthError {
    #[error("OAuth callback state does not match")]
    StateMismatch,
    #[error("OAuth authorization code is empty")]
    MissingCode,
    #[error("OAuth endpoint must use HTTPS (loopback HTTP is allowed for callbacks/tests)")]
    InsecureEndpoint,
    #[error("OAuth HTTP request failed: {0}")]
    Http(String),
    #[error("OAuth token response is invalid: {0}")]
    InvalidResponse(String),
    #[error("OAuth credential storage failed: {0}")]
    Storage(String),
    #[error("OAuth client or callback configuration is invalid: {0}")]
    InvalidConfiguration(String),
    #[error("OAuth response exceeds {0} bytes")]
    ResponseTooLarge(usize),
}

impl OAuthClient {
    pub fn begin_authorization(&self) -> Result<OAuthAuthorization, OAuthError> {
        self.validate()?;
        let state = format!("{}{}", Uuid::now_v7(), Uuid::now_v7()).replace('-', "");
        let code_verifier = format!("{}{}", Uuid::now_v7(), Uuid::now_v7()).replace('-', "");
        let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
        let mut authorization_url = self.authorization_endpoint.clone();
        authorization_url
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", self.redirect_uri.as_str())
            .append_pair("scope", &self.scopes.join(" "))
            .append_pair("state", &state)
            .append_pair("code_challenge", &code_challenge)
            .append_pair("code_challenge_method", "S256");
        Ok(OAuthAuthorization {
            state,
            code_verifier,
            code_challenge,
            authorization_url,
        })
    }

    pub fn validate(&self) -> Result<(), OAuthError> {
        validate_browser_endpoint(&self.authorization_endpoint)?;
        validate_oauth_endpoint(&self.token_endpoint)?;
        if self.client_id.is_empty()
            || self.client_id.len() > 256
            || self
                .client_id
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
            || self.scopes.len() > 64
            || self.scopes.iter().any(|scope| {
                scope.is_empty()
                    || scope.len() > 256
                    || scope
                        .chars()
                        .any(|character| character.is_control() || character.is_whitespace())
            })
        {
            return Err(OAuthError::InvalidConfiguration(
                "client ID or scopes are invalid".into(),
            ));
        }
        let redirect_host = self.redirect_uri.host_str();
        if self.redirect_uri.scheme() != "http"
            || !matches!(redirect_host, Some("127.0.0.1" | "::1"))
            || self.redirect_uri.port().is_none_or(|port| port == 0)
            || self.redirect_uri.path() != "/callback"
            || self.redirect_uri.query().is_some()
            || self.redirect_uri.fragment().is_some()
            || !self.redirect_uri.username().is_empty()
            || self.redirect_uri.password().is_some()
        {
            return Err(OAuthError::InvalidConfiguration(
                "redirect URI must be an exact loopback-IP HTTP callback".into(),
            ));
        }
        Ok(())
    }

    pub fn token_request(
        &self,
        authorization: &OAuthAuthorization,
        callback_state: &str,
        code: &str,
    ) -> Result<OAuthTokenRequest, OAuthError> {
        self.validate()?;
        if authorization.state != callback_state {
            return Err(OAuthError::StateMismatch);
        }
        let expected_challenge =
            URL_SAFE_NO_PAD.encode(Sha256::digest(authorization.code_verifier.as_bytes()));
        if authorization.state.len() < 64
            || authorization.code_verifier.len() < 43
            || authorization.code_verifier.len() > 128
            || expected_challenge != authorization.code_challenge
        {
            return Err(OAuthError::InvalidConfiguration(
                "authorization PKCE/state binding is invalid".into(),
            ));
        }
        if code.is_empty() || code.len() > 4096 || code.chars().any(char::is_control) {
            return Err(OAuthError::MissingCode);
        }
        Ok(OAuthTokenRequest {
            grant_type: "authorization_code",
            code: code.into(),
            client_id: self.client_id.clone(),
            redirect_uri: self.redirect_uri.to_string(),
            code_verifier: authorization.code_verifier.clone(),
        })
    }

    /// Exchange an authorization code using RFC 7636 PKCE. The client does
    /// not follow redirects and has no cookie jar.
    pub fn exchange_code(
        &self,
        authorization: &OAuthAuthorization,
        callback_state: &str,
        code: &str,
        timeout: Duration,
    ) -> Result<OAuthTokenSet, OAuthError> {
        let request = self.token_request(authorization, callback_state, code)?;
        validate_oauth_endpoint(&self.token_endpoint)?;
        oauth_form_request(
            &self.token_endpoint,
            &[
                ("grant_type", request.grant_type),
                ("code", request.code.as_str()),
                ("client_id", request.client_id.as_str()),
                ("redirect_uri", request.redirect_uri.as_str()),
                ("code_verifier", request.code_verifier.as_str()),
            ],
            timeout,
        )
    }

    pub fn refresh(
        &self,
        refresh_token: &str,
        timeout: Duration,
    ) -> Result<OAuthTokenSet, OAuthError> {
        self.validate()?;
        if refresh_token.is_empty()
            || refresh_token.len() > MAX_OAUTH_RESPONSE_BYTES
            || refresh_token.chars().any(char::is_control)
        {
            return Err(OAuthError::InvalidResponse("empty refresh token".into()));
        }
        oauth_form_request(
            &self.token_endpoint,
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", self.client_id.as_str()),
                ("scope", self.scopes.join(" ").as_str()),
            ],
            timeout,
        )
    }

    pub fn revoke(
        &self,
        revocation_endpoint: &Url,
        token: &str,
        timeout: Duration,
    ) -> Result<(), OAuthError> {
        self.validate()?;
        validate_oauth_endpoint(revocation_endpoint)?;
        validate_oauth_timeout(timeout)?;
        if token.is_empty()
            || token.len() > MAX_OAUTH_RESPONSE_BYTES
            || token.chars().any(char::is_control)
        {
            return Err(OAuthError::InvalidResponse(
                "invalid revocation token".into(),
            ));
        }
        let client = oauth_http_client(timeout)?;
        let response = client
            .post(revocation_endpoint.clone())
            .form(&[("token", token), ("client_id", self.client_id.as_str())])
            .send()
            .map_err(|error| OAuthError::Http(error.to_string()))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(OAuthError::Http(format!(
                "revocation endpoint returned {}",
                response.status()
            )))
        }
    }
}

fn validate_oauth_endpoint(endpoint: &Url) -> Result<(), OAuthError> {
    if (endpoint.scheme() == "https" || is_oauth_loopback_http(endpoint))
        && endpoint.fragment().is_none()
        && endpoint.username().is_empty()
        && endpoint.password().is_none()
        && endpoint.host_str().is_some()
        && endpoint.query().is_none()
    {
        Ok(())
    } else {
        Err(OAuthError::InsecureEndpoint)
    }
}

fn validate_browser_endpoint(endpoint: &Url) -> Result<(), OAuthError> {
    if !((endpoint.scheme() == "https" || is_oauth_loopback_http(endpoint))
        && endpoint.fragment().is_none()
        && endpoint.username().is_empty()
        && endpoint.password().is_none()
        && endpoint.host_str().is_some())
    {
        return Err(OAuthError::InsecureEndpoint);
    }
    if endpoint.query_pairs().any(|(name, _)| {
        matches!(
            name.as_ref(),
            "response_type"
                | "client_id"
                | "redirect_uri"
                | "scope"
                | "state"
                | "code_challenge"
                | "code_challenge_method"
        )
    }) {
        return Err(OAuthError::InvalidConfiguration(
            "authorization endpoint contains a reserved OAuth parameter".into(),
        ));
    }
    Ok(())
}

fn is_oauth_loopback_http(endpoint: &Url) -> bool {
    endpoint.scheme() == "http"
        && endpoint
            .host_str()
            .is_some_and(|host| matches!(host, "127.0.0.1" | "::1"))
}

fn validate_oauth_timeout(timeout: Duration) -> Result<(), OAuthError> {
    if timeout.is_zero() || timeout > MAX_OAUTH_TIMEOUT {
        Err(OAuthError::InvalidConfiguration(
            "timeout must be between 1 ms and 120 seconds".into(),
        ))
    } else {
        Ok(())
    }
}

fn oauth_http_client(timeout: Duration) -> Result<reqwest::blocking::Client, OAuthError> {
    validate_oauth_timeout(timeout)?;
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| OAuthError::Http(error.to_string()))
}

fn oauth_form_request(
    endpoint: &Url,
    form: &[(&str, &str)],
    timeout: Duration,
) -> Result<OAuthTokenSet, OAuthError> {
    let mut response = oauth_http_client(timeout)?
        .post(endpoint.clone())
        .form(form)
        .send()
        .map_err(|error| OAuthError::Http(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(OAuthError::Http(format!(
            "token endpoint returned {status}"
        )));
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
    {
        return Err(OAuthError::InvalidResponse(
            "token endpoint must return application/json".into(),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_OAUTH_RESPONSE_BYTES as u64)
    {
        return Err(OAuthError::ResponseTooLarge(MAX_OAUTH_RESPONSE_BYTES));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take((MAX_OAUTH_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| OAuthError::Http(error.to_string()))?;
    if bytes.len() > MAX_OAUTH_RESPONSE_BYTES {
        return Err(OAuthError::ResponseTooLarge(MAX_OAUTH_RESPONSE_BYTES));
    }
    let parsed = serde_json::from_slice(&bytes)
        .map_err(|error| OAuthError::InvalidResponse(error.to_string()));
    bytes.zeroize();
    let token: OAuthTokenSet = parsed?;
    validate_token_set(&token)?;
    Ok(token)
}

fn validate_token_set(token: &OAuthTokenSet) -> Result<(), OAuthError> {
    if token.access_token.is_empty()
        || token.access_token.len() > MAX_OAUTH_RESPONSE_BYTES
        || token.access_token.chars().any(char::is_control)
        || !token.token_type.eq_ignore_ascii_case("bearer")
        || token.refresh_token.as_ref().is_some_and(|refresh| {
            refresh.is_empty()
                || refresh.len() > MAX_OAUTH_RESPONSE_BYTES
                || refresh.chars().any(char::is_control)
        })
        || token
            .scope
            .as_ref()
            .is_some_and(|scope| scope.len() > 4096 || scope.chars().any(char::is_control))
    {
        return Err(OAuthError::InvalidResponse(
            "invalid bearer token response".into(),
        ));
    }
    Ok(())
}

pub trait OAuthTokenStore {
    fn load(&self, server: &str) -> Result<Option<OAuthTokenSet>, OAuthError>;
    fn save(&self, server: &str, token: &OAuthTokenSet) -> Result<(), OAuthError>;
    fn delete(&self, server: &str) -> Result<(), OAuthError>;
}

/// Replace a stored token without abandoning the last usable credential when
/// the credential backend reports a partial write failure. The original error
/// remains authoritative; a failed rollback is included without token data.
pub fn replace_oauth_token(
    store: &impl OAuthTokenStore,
    server: &str,
    token: &OAuthTokenSet,
) -> Result<(), OAuthError> {
    validate_oauth_store_key(server)?;
    validate_token_set(token)?;
    let previous = store.load(server)?;
    if let Err(write_error) = store.save(server, token) {
        let rollback = match previous.as_ref() {
            Some(previous) => store.save(server, previous),
            None => store.delete(server),
        };
        return match rollback {
            Ok(()) => Err(write_error),
            Err(rollback_error) => Err(OAuthError::Storage(format!(
                "credential replacement failed and rollback failed: {write_error}; {rollback_error}"
            ))),
        };
    }
    Ok(())
}

/// OS credential-store backed persistence. Tokens are never written to the
/// MCP registry or session database.
pub struct KeyringOAuthTokenStore {
    service: String,
}

impl KeyringOAuthTokenStore {
    #[must_use]
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, server: &str) -> Result<keyring::Entry, OAuthError> {
        validate_oauth_store_key(server)?;
        if self.service.is_empty()
            || self.service.len() > MAX_MCP_IDENTIFIER_BYTES
            || self.service.chars().any(char::is_control)
        {
            return Err(OAuthError::Storage(
                "invalid credential service name".into(),
            ));
        }
        keyring::Entry::new(&self.service, server)
            .map_err(|error| OAuthError::Storage(error.to_string()))
    }
}

impl OAuthTokenStore for KeyringOAuthTokenStore {
    fn load(&self, server: &str) -> Result<Option<OAuthTokenSet>, OAuthError> {
        match self.entry(server)?.get_password() {
            Ok(mut secret) => {
                let parsed = serde_json::from_str(&secret)
                    .map_err(|error| OAuthError::Storage(error.to_string()));
                secret.zeroize();
                let token = parsed?;
                validate_token_set(&token)?;
                Ok(Some(token))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(OAuthError::Storage(error.to_string())),
        }
    }

    fn save(&self, server: &str, token: &OAuthTokenSet) -> Result<(), OAuthError> {
        validate_token_set(token)?;
        let entry = self.entry(server)?;
        let mut secret =
            serde_json::to_string(token).map_err(|error| OAuthError::Storage(error.to_string()))?;
        let result = entry
            .set_password(&secret)
            .map_err(|error| OAuthError::Storage(error.to_string()));
        secret.zeroize();
        result
    }

    fn delete(&self, server: &str) -> Result<(), OAuthError> {
        match self.entry(server)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(OAuthError::Storage(error.to_string())),
        }
    }
}

fn validate_oauth_store_key(server: &str) -> Result<(), OAuthError> {
    if server.is_empty()
        || server.len() > MAX_MCP_IDENTIFIER_BYTES
        || server
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        Err(OAuthError::Storage(
            "invalid credential account name".into(),
        ))
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provenance {
    McpContent,
    ModelGenerated,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub provenance: Provenance,
    /// Tool names, schemas, and descriptions originate outside the trust
    /// boundary and can never carry authority into the agent context.
    #[serde(default)]
    pub untrusted: bool,
}

#[derive(Clone, Debug)]
pub struct McpCallPolicy {
    pub mode: ExecutionMode,
    pub configured_action: RuleAction,
    pub lifecycle_authority: LifecycleAuthority,
    pub hard_boundaries: Vec<HardBoundary>,
    /// `None` permits any tool exposed by this explicitly configured server.
    /// A set restricts calls even when the general MCP permission is allowed.
    pub allowed_tools: Option<std::collections::BTreeSet<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: Value,
    pub provenance: Provenance,
    pub untrusted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct McpServerCapabilities {
    pub protocol_version: String,
    #[serde(default)]
    pub capabilities: Value,
    #[serde(default)]
    pub server_info: Value,
    pub provenance: Provenance,
    pub untrusted: bool,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[serde(default)]
    jsonrpc: Option<String>,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnectionState {
    Connected,
    Failed,
    Disposed,
}

struct Connection {
    state: ConnectionState,
    transport: Box<dyn McpTransport>,
}

pub struct McpConnectionManager {
    project_scope: PathBuf,
    connections: BTreeMap<String, Connection>,
    max_result_bytes: usize,
}

#[derive(Debug, Error)]
pub enum McpError {
    #[error("MCP connection already exists: {0}")]
    Duplicate(String),
    #[error("MCP connection does not exist: {0}")]
    NotFound(String),
    #[error("MCP connection is not active: {0}")]
    Inactive(String),
    #[error("MCP call denied by policy: {0}")]
    Policy(&'static str),
    #[error("MCP tool is outside the configured allowlist: {0}")]
    ToolDenied(String),
    #[error("MCP resource path is outside project scope: {0}")]
    OutsideProjectScope(PathBuf),
    #[error("MCP result exceeds {limit} bytes")]
    OutputTooLarge { limit: usize },
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("invalid MCP response: {0}")]
    Json(#[from] serde_json::Error),
    #[error("MCP JSON-RPC error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("MCP protocol version is unsupported: {0}")]
    UnsupportedProtocol(String),
    #[error("invalid MCP input: {0}")]
    InvalidInput(&'static str),
    #[error("MCP collection {kind} exceeds {limit} items")]
    CollectionLimit { kind: &'static str, limit: usize },
}

impl McpConnectionManager {
    #[must_use]
    pub fn new(project_scope: PathBuf) -> Self {
        Self {
            project_scope: resolve_path(&project_scope).unwrap_or(project_scope),
            connections: BTreeMap::new(),
            max_result_bytes: 1024 * 1024,
        }
    }

    #[must_use]
    pub fn with_output_limit(project_scope: PathBuf, max_result_bytes: usize) -> Self {
        let mut manager = Self::new(project_scope);
        manager.max_result_bytes = max_result_bytes;
        manager
    }

    #[must_use]
    pub fn project_scope(&self) -> &Path {
        &self.project_scope
    }

    pub fn add(&mut self, name: String, transport: Box<dyn McpTransport>) -> Result<(), McpError> {
        validate_mcp_identifier(&name)?;
        if self.connections.contains_key(&name) {
            return Err(McpError::Duplicate(name));
        }
        if self.connections.len() >= MAX_MCP_CONNECTIONS {
            return Err(McpError::CollectionLimit {
                kind: "connections",
                limit: MAX_MCP_CONNECTIONS,
            });
        }
        self.connections.insert(
            name,
            Connection {
                state: ConnectionState::Connected,
                transport,
            },
        );
        Ok(())
    }

    pub fn state(&self, name: &str) -> Result<ConnectionState, McpError> {
        self.connections
            .get(name)
            .map(|connection| connection.state)
            .ok_or_else(|| McpError::NotFound(name.into()))
    }

    pub fn initialize(
        &mut self,
        name: &str,
        cancellation: &Cancellation,
    ) -> Result<McpServerCapabilities, McpError> {
        let request_id = Uuid::now_v7().to_string();
        let request = serde_json::to_vec(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "changeloop", "version": env!("CARGO_PKG_VERSION")}
            }
        }))?;
        let response = self.raw_request(name, &request, cancellation)?;
        let value = extract_rpc_result(&response, &Value::String(request_id))?;
        let protocol_version = value
            .get("protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or(MCP_PROTOCOL_VERSION)
            .to_owned();
        if protocol_version != MCP_PROTOCOL_VERSION {
            return Err(McpError::UnsupportedProtocol(protocol_version));
        }
        Ok(McpServerCapabilities {
            protocol_version,
            capabilities: value.get("capabilities").cloned().unwrap_or(Value::Null),
            server_info: value.get("serverInfo").cloned().unwrap_or(Value::Null),
            provenance: Provenance::McpContent,
            untrusted: true,
        })
    }

    pub fn discover(
        &mut self,
        name: &str,
        policy: &McpCallPolicy,
        cancellation: &Cancellation,
    ) -> Result<Vec<McpTool>, McpError> {
        authorize_mcp(name, policy, OperationKind::Network)?;
        let response = self.raw_request(
            name,
            br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            cancellation,
        )?;
        let value = extract_rpc_result_compat(&response, &Value::from(1))?;
        let tools_value = value.get("tools").cloned().unwrap_or(value);
        let mut tools: Vec<McpTool> = serde_json::from_value(tools_value)?;
        if tools.len() > MAX_MCP_TOOLS {
            return Err(McpError::CollectionLimit {
                kind: "tools",
                limit: MAX_MCP_TOOLS,
            });
        }
        let mut names = BTreeSet::new();
        for tool in &mut tools {
            validate_mcp_identifier(&tool.name)?;
            if !names.insert(tool.name.clone()) {
                return Err(McpError::InvalidInput("duplicate tool name"));
            }
            if tool.description.len() > 64 * 1024
                || serde_json::to_vec(&tool.input_schema)?.len() > 256 * 1024
            {
                return Err(McpError::InvalidInput("tool metadata exceeds safe bounds"));
            }
            tool.provenance = Provenance::McpContent;
            tool.untrusted = true;
        }
        if let Some(allowed) = &policy.allowed_tools {
            tools.retain(|tool| allowed.contains(&tool.name));
        }
        Ok(tools)
    }

    pub fn call(
        &mut self,
        name: &str,
        tool: &str,
        arguments: Value,
        policy: &McpCallPolicy,
        cancellation: &Cancellation,
    ) -> Result<McpToolResult, McpError> {
        self.call_scoped(name, tool, arguments, &[], policy, cancellation)
    }

    /// Call a tool with explicit filesystem resource declarations. Relative
    /// paths are scoped to the project; traversal and absolute paths outside
    /// that scope fail before policy evaluation or transport I/O.
    pub fn call_scoped(
        &mut self,
        name: &str,
        tool: &str,
        arguments: Value,
        resource_paths: &[PathBuf],
        policy: &McpCallPolicy,
        cancellation: &Cancellation,
    ) -> Result<McpToolResult, McpError> {
        validate_mcp_identifier(tool)?;
        if resource_paths.len() > MAX_MCP_RESOURCE_PATHS {
            return Err(McpError::CollectionLimit {
                kind: "resource paths",
                limit: MAX_MCP_RESOURCE_PATHS,
            });
        }
        if serde_json::to_vec(&arguments)?.len() > 1024 * 1024 {
            return Err(McpError::InvalidInput("tool arguments exceed 1 MiB"));
        }
        if policy
            .allowed_tools
            .as_ref()
            .is_some_and(|allowed| !allowed.contains(tool))
        {
            return Err(McpError::ToolDenied(tool.into()));
        }
        for resource in resource_paths {
            self.validate_resource_path(resource)?;
        }
        authorize_mcp(name, policy, OperationKind::ExternalSideEffect)?;
        let request_id = Uuid::now_v7().to_string();
        let request = serde_json::to_vec(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": { "name": tool, "arguments": arguments }
        }))?;
        let response = self.raw_request(name, &request, cancellation)?;
        let content = extract_rpc_result_compat(&response, &Value::String(request_id))?;
        Ok(McpToolResult {
            content,
            provenance: Provenance::McpContent,
            untrusted: true,
        })
    }

    fn validate_resource_path(&self, resource: &Path) -> Result<(), McpError> {
        if resource.as_os_str().len() > 16 * 1024 {
            return Err(McpError::OutsideProjectScope(resource.to_owned()));
        }
        let candidate = if resource.is_absolute() {
            resolve_path(resource)
        } else {
            resolve_path(&self.project_scope.join(resource))
        }
        .ok_or_else(|| McpError::OutsideProjectScope(resource.to_owned()))?;
        if !candidate.starts_with(&self.project_scope) {
            return Err(McpError::OutsideProjectScope(resource.to_owned()));
        }
        Ok(())
    }

    fn raw_request(
        &mut self,
        name: &str,
        request: &[u8],
        cancellation: &Cancellation,
    ) -> Result<Vec<u8>, McpError> {
        validate_mcp_identifier(name)?;
        if self.max_result_bytes == 0 || self.max_result_bytes > MAX_MCP_TRANSPORT_BYTES {
            return Err(McpError::InvalidInput("invalid MCP result limit"));
        }
        let connection = self
            .connections
            .get_mut(name)
            .ok_or_else(|| McpError::NotFound(name.into()))?;
        if connection.state != ConnectionState::Connected {
            return Err(McpError::Inactive(name.into()));
        }
        match connection.transport.request(request, cancellation) {
            Ok(response) if response.len() > self.max_result_bytes => {
                connection.state = ConnectionState::Failed;
                connection.transport.close();
                Err(McpError::OutputTooLarge {
                    limit: self.max_result_bytes,
                })
            }
            Ok(response) => Ok(response),
            Err(error) => {
                connection.state = ConnectionState::Failed;
                Err(error.into())
            }
        }
    }

    pub fn remove(&mut self, name: &str) -> Result<(), McpError> {
        let mut connection = self
            .connections
            .remove(name)
            .ok_or_else(|| McpError::NotFound(name.into()))?;
        connection.transport.close();
        connection.state = ConnectionState::Disposed;
        Ok(())
    }

    pub fn dispose(&mut self) {
        for connection in self.connections.values_mut() {
            if connection.state != ConnectionState::Disposed {
                connection.transport.close();
                connection.state = ConnectionState::Disposed;
            }
        }
    }
}

fn validate_mcp_identifier(value: &str) -> Result<(), McpError> {
    if !value.is_empty()
        && value.len() <= MAX_MCP_IDENTIFIER_BYTES
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.:/".contains(character))
    {
        Ok(())
    } else {
        Err(McpError::InvalidInput("identifier is invalid"))
    }
}

fn extract_rpc_result(bytes: &[u8], expected_id: &Value) -> Result<Value, McpError> {
    let response: JsonRpcResponse = serde_json::from_slice(bytes)?;
    if response.jsonrpc.as_deref() != Some("2.0") || response.id.as_ref() != Some(expected_id) {
        return Err(McpError::InvalidInput(
            "JSON-RPC version or response ID mismatch",
        ));
    }
    if let Some(error) = response.error {
        return Err(McpError::Rpc {
            code: error.code,
            message: error.message,
        });
    }
    response.result.ok_or_else(|| {
        McpError::Json(serde_json::Error::io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "MCP response has neither result nor error",
        )))
    })
}

fn extract_rpc_result_compat(bytes: &[u8], expected_id: &Value) -> Result<Value, McpError> {
    let value: Value = serde_json::from_slice(bytes)?;
    if value.get("jsonrpc").is_some() || value.get("error").is_some() {
        extract_rpc_result(bytes, expected_id)
    } else {
        Ok(value)
    }
}

fn normalize_path(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    Some(normalized)
}

/// Canonicalize the longest existing prefix and append any missing tail. This
/// detects escapes through existing symlinked directories while still
/// supporting tools that declare paths they intend to create.
fn resolve_path(path: &Path) -> Option<PathBuf> {
    let normalized = normalize_path(path)?;
    let mut cursor = normalized.as_path();
    let mut missing = Vec::new();
    loop {
        match std::fs::canonicalize(cursor) {
            Ok(mut resolved) => {
                for component in missing.iter().rev() {
                    resolved.push(component);
                }
                return Some(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(cursor.file_name()?.to_owned());
                cursor = cursor.parent()?;
            }
            Err(_) => return None,
        }
    }
}

fn authorize_mcp(
    name: &str,
    policy: &McpCallPolicy,
    operation: OperationKind,
) -> Result<(), McpError> {
    let decision = evaluate(&PolicyRequest {
        classifier_version: AUTO_CLASSIFIER_VERSION,
        mode: policy.mode,
        configured_action: policy.configured_action,
        permission: PermissionKind::ExternalSideEffect,
        operation,
        paths: Vec::new(),
        network_destination: Some(format!("mcp:{name}")),
        reversibility: Reversibility::Unknown,
        sandbox: SandboxCapability::Unavailable,
        lifecycle_authority: policy.lifecycle_authority,
        hard_boundaries: policy.hard_boundaries.clone(),
    });
    if decision.action == DecisionAction::Allow {
        Ok(())
    } else {
        Err(McpError::Policy(decision.reason))
    }
}

impl Drop for McpConnectionManager {
    fn drop(&mut self) {
        self.dispose();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionKind {
    Skill,
    Hook,
    Extension,
}

/// Executable extensions are opt-in. A manifest without `runtime` remains
/// discovery-only and is never interpreted based on its file extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionRuntime {
    StdioV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionInputProvenance {
    UserInput,
    ModelGenerated,
    ToolOutput,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HookEvent {
    BeforeTool,
    AfterTool,
    BeforeProve,
    AfterProve,
    BeforeReview,
    AfterReview,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ExtensionManifest {
    pub id: String,
    pub kind: ExtensionKind,
    pub entry: PathBuf,
    #[serde(default = "default_extension_contract_version")]
    pub contract_version: u16,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub runtime: Option<ExtensionRuntime>,
    #[serde(default = "default_extension_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub hook_events: Vec<HookEvent>,
}

const fn default_extension_contract_version() -> u16 {
    1
}

const fn default_extension_timeout_ms() -> u64 {
    5_000
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscoveredExtension {
    pub manifest_path: PathBuf,
    pub entry_path: PathBuf,
    pub manifest: ExtensionManifest,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExtensionDiscoveryFailure {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExtensionDiscoveryReport {
    pub discovered: Vec<DiscoveredExtension>,
    pub failures: Vec<ExtensionDiscoveryFailure>,
}

/// Discover project-local skills/hooks without executing them. Each malformed
/// or escaping manifest is isolated so one extension cannot disable another.
#[must_use]
pub fn discover_extensions(project_scope: &Path) -> ExtensionDiscoveryReport {
    let mut report = ExtensionDiscoveryReport::default();
    let root = resolve_path(project_scope).unwrap_or_else(|| project_scope.to_owned());
    for directory in [
        root.join(".changeloop/extensions"),
        root.join(".changeloop/skills"),
    ] {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                report.failures.push(ExtensionDiscoveryFailure {
                    path: directory,
                    message: error.to_string(),
                });
                continue;
            }
        };
        for entry in entries.take(MAX_EXTENSIONS.saturating_add(1)) {
            if report
                .discovered
                .len()
                .saturating_add(report.failures.len())
                >= MAX_EXTENSIONS
            {
                report.failures.push(ExtensionDiscoveryFailure {
                    path: directory.clone(),
                    message: format!("extension discovery exceeds {MAX_EXTENSIONS} entries"),
                });
                break;
            }
            let path = match entry {
                Ok(entry) => entry.path(),
                Err(error) => {
                    report.failures.push(ExtensionDiscoveryFailure {
                        path: directory.clone(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            let manifest_path = if path.is_dir() {
                path.join("manifest.json")
            } else {
                path
            };
            if manifest_path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            match load_extension_manifest(&root, &manifest_path) {
                Ok(discovered) => report.discovered.push(discovered),
                Err(message) => report.failures.push(ExtensionDiscoveryFailure {
                    path: manifest_path,
                    message,
                }),
            }
        }
    }
    report
        .discovered
        .sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
    let mut ids = BTreeSet::new();
    report.discovered.retain(|extension| {
        if ids.insert(extension.manifest.id.clone()) {
            true
        } else {
            report.failures.push(ExtensionDiscoveryFailure {
                path: extension.manifest_path.clone(),
                message: format!("duplicate extension id '{}'", extension.manifest.id),
            });
            false
        }
    });
    report
}

fn load_extension_manifest(root: &Path, path: &Path) -> Result<DiscoveredExtension, String> {
    let manifest_path = std::fs::canonicalize(path)
        .map_err(|error| format!("manifest cannot be opened: {error}"))?;
    if !manifest_path.starts_with(root) {
        return Err("extension manifest escapes project scope".into());
    }
    validate_regular_extension_file(path, 64 * 1024, "manifest")?;
    let mut bytes = Vec::new();
    open_extension_file(&manifest_path)
        .map_err(|error| error.to_string())?
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > 64 * 1024 {
        return Err("manifest exceeds 64 KiB".into());
    }
    let manifest: ExtensionManifest =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if manifest.contract_version != 1 {
        return Err(format!(
            "unsupported extension contract version {}",
            manifest.contract_version
        ));
    }
    match manifest.kind {
        ExtensionKind::Hook if manifest.hook_events.is_empty() => {
            return Err("hook manifest must declare at least one hook_events subscription".into());
        }
        ExtensionKind::Skill | ExtensionKind::Extension if !manifest.hook_events.is_empty() => {
            return Err("only hook manifests may declare hook_events".into());
        }
        _ => {}
    }
    if manifest.id.is_empty()
        || manifest.id.len() > MAX_MCP_IDENTIFIER_BYTES
        || !manifest
            .id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("manifest id must contain only ASCII letters, digits, '-' or '_'".into());
    }
    if manifest.timeout_ms == 0
        || manifest.timeout_ms > MAX_EXTENSION_TIMEOUT.as_millis() as u64
        || manifest.hook_events.len() > 64
        || manifest.hook_events.iter().collect::<BTreeSet<_>>().len() != manifest.hook_events.len()
    {
        return Err("manifest timeout or hook event declarations are invalid".into());
    }
    let parent = manifest_path
        .parent()
        .ok_or_else(|| "manifest has no parent".to_owned())?;
    let declared_entry = parent.join(&manifest.entry);
    validate_regular_extension_file(&declared_entry, u64::MAX as usize, "entry")?;
    let entry_path = resolve_path(&declared_entry)
        .ok_or_else(|| "extension entry cannot be resolved".to_owned())?;
    if !entry_path.starts_with(root) {
        return Err("extension entry escapes project scope".into());
    }
    Ok(DiscoveredExtension {
        manifest_path,
        entry_path,
        manifest,
    })
}

fn validate_regular_extension_file(
    path: &Path,
    max_bytes: usize,
    label: &str,
) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("extension {label} cannot be inspected: {error}"))?;
    if !metadata.file_type().is_file()
        || metadata.len() > u64::try_from(max_bytes).unwrap_or(u64::MAX)
    {
        return Err(format!(
            "extension {label} must be a bounded regular non-symlink file"
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(format!("extension {label} must have exactly one hard link"));
        }
    }
    Ok(())
}

fn open_extension_file(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    options.open(path)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionHealth {
    Healthy,
    TimedOut,
    Failed,
    Panicked,
    Disabled,
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum ExtensionOutput {
    Finding(String),
    Data(Value),
    Land,
    ExpandScope,
    GrantPermission,
    ChangePolicy,
}

pub trait ExtensionHandler: Send + Sync + 'static {
    fn execute(&self, input: Value, cancellation: Cancellation) -> Result<ExtensionOutput, String>;
    fn shutdown(&self) -> Result<(), String>;
}

/// Bounded one-request subprocess contract for explicitly declared project
/// extensions. The child receives one JSON envelope on stdin and must emit
/// one JSON response on stdout. Ambient credentials and user environment are
/// not inherited.
pub struct ExecutableExtensionHandler {
    project_scope: PathBuf,
    entry_path: PathBuf,
    max_output_bytes: usize,
    input_provenance: ExtensionInputProvenance,
}

/// Trees a project extension must never read: the user's home directories and
/// mounted volumes, plus the project tree itself. An extension receives its
/// input on stdin and is not a file reader.
const EXTENSION_DENIED_READ_ROOTS: &[&str] = &["/Users", "/home", "/root", "/Volumes"];

/// The one coarse profile a project extension runs under.
///
/// The entry file is re-allowed after the denials so the interpreter can read
/// the script it was told to run, and the scratch directory is the only place
/// the extension may write.
fn extension_policy(entry: &Path, project_scope: &Path, scratch: &Path) -> SandboxPolicy {
    let mut denied: Vec<PathBuf> = EXTENSION_DENIED_READ_ROOTS
        .iter()
        .filter(|path| Path::new(path).exists())
        .map(PathBuf::from)
        .collect();
    denied.push(project_scope.to_path_buf());
    SandboxPolicy::deny_by_default(scratch.to_path_buf())
        .writable([scratch.to_path_buf()])
        .read_scope(ReadScope::Explicit(vec![entry.to_path_buf()]))
        .deny_read(denied)
}

/// The scratch directory an extension runs in and may write to.
///
/// Resolved because the Seatbelt filter matches the real path, and `/tmp` is a
/// symlink to `/private/tmp` on macOS.
fn extension_scratch() -> PathBuf {
    let scratch = std::env::temp_dir();
    std::fs::canonicalize(&scratch).unwrap_or(scratch)
}

/// Whether this host can actually confine an executable extension.
///
/// Third-party code that cannot be confined is not run at all, so this is the
/// gate [`ExecutableExtensionHandler::new`] refuses on. Degraded counts:
/// partial enforcement is not no enforcement, and the unapplied axis is named
/// in the enforcement notice.
#[must_use]
pub fn executable_extension_sandbox_available() -> bool {
    let scratch = extension_scratch();
    let probe = extension_policy(&scratch, &scratch, &scratch);
    changeloop_sandbox::select(&probe).level != EnforcementLevel::Unenforced
}

impl ExecutableExtensionHandler {
    pub fn new(
        project_scope: impl AsRef<Path>,
        entry_path: impl AsRef<Path>,
        max_output_bytes: usize,
        input_provenance: ExtensionInputProvenance,
    ) -> Result<Self, String> {
        let project_scope = resolve_path(project_scope.as_ref())
            .ok_or_else(|| "project scope cannot be resolved".to_owned())?;
        validate_regular_extension_file(entry_path.as_ref(), usize::MAX, "entry")?;
        let entry_path = std::fs::canonicalize(entry_path.as_ref())
            .map_err(|error| format!("extension entry cannot be opened: {error}"))?;
        if !entry_path.starts_with(&project_scope) {
            return Err("extension entry escapes project scope".into());
        }
        if !entry_path.is_file() {
            return Err("extension entry is not a regular file".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if std::fs::metadata(&entry_path)
                .map_err(|error| error.to_string())?
                .permissions()
                .mode()
                & 0o111
                == 0
            {
                return Err("extension entry is not executable".into());
            }
        }
        if max_output_bytes == 0 || max_output_bytes > MAX_MCP_TRANSPORT_BYTES {
            return Err("extension output limit must be between 1 byte and 16 MiB".into());
        }
        if !executable_extension_sandbox_available() {
            return Err(
                "required extension sandbox is unavailable; executable loading is disabled"
                    .to_owned(),
            );
        }
        Ok(Self {
            project_scope,
            entry_path,
            max_output_bytes,
            input_provenance,
        })
    }

    fn response(&self, bytes: &[u8]) -> Result<ExtensionOutput, String> {
        if bytes.len() > self.max_output_bytes {
            return Err(format!(
                "extension output exceeds {} bytes",
                self.max_output_bytes
            ));
        }
        let value: Value = serde_json::from_slice(bytes)
            .map_err(|error| format!("extension emitted invalid JSON: {error}"))?;
        let kind = value["type"]
            .as_str()
            .ok_or_else(|| "extension response type is required".to_owned())?;
        match kind {
            "finding" => value["finding"]
                .as_str()
                .map(|finding| ExtensionOutput::Finding(finding.to_owned()))
                .ok_or_else(|| "finding response requires a string finding".to_owned()),
            "data" => Ok(ExtensionOutput::Data(
                value.get("data").cloned().unwrap_or(Value::Null),
            )),
            "land" => Ok(ExtensionOutput::Land),
            "expand-scope" => Ok(ExtensionOutput::ExpandScope),
            "grant-permission" => Ok(ExtensionOutput::GrantPermission),
            "change-policy" => Ok(ExtensionOutput::ChangePolicy),
            _ => Err(format!("unsupported extension response type '{kind}'")),
        }
    }
}

impl ExtensionHandler for ExecutableExtensionHandler {
    fn execute(&self, input: Value, cancellation: Cancellation) -> Result<ExtensionOutput, String> {
        if cancellation.is_cancelled() {
            return Err("extension cancelled".into());
        }
        let request = serde_json::to_vec(&serde_json::json!({
            "schema":"dev.changeloop.extension-input",
            "version":1,
            "provenance":self.input_provenance,
            "authority":{"land":false,"expandScope":false,"grantPermission":false,"changePolicy":false},
            "input":input
        }))
        .map_err(|error| error.to_string())?;
        if request.len() > MAX_EXTENSION_INPUT_BYTES {
            return Err(format!(
                "extension input exceeds {MAX_EXTENSION_INPUT_BYTES} bytes"
            ));
        }
        let scratch = extension_scratch();
        let mut environment = BTreeMap::new();
        environment.insert("PATH".to_string(), "/usr/bin:/bin".to_string());
        environment.insert(
            "CHANGELOOP_EXTENSION_PROTOCOL".to_string(),
            "stdio-v1".to_string(),
        );
        let mut child = Spawn::new(
            &self.entry_path,
            extension_policy(&self.entry_path, &self.project_scope, &scratch),
        )
        .working_directory(&scratch)
        .environment(environment)
        .stdin(StdioPlan::Piped)
        .stdout(StdioPlan::Piped)
        .stderr(StdioPlan::Piped)
        .spawn()
        .map_err(|error| format!("extension failed to start: {error}"))?;
        let mut stdin = match child.take_stdin() {
            Some(stdin) => stdin,
            None => {
                child.terminate();
                return Err("extension stdin unavailable".to_owned());
            }
        };
        if let Err(error) = stdin.write_all(&request) {
            child.terminate();
            return Err(error.to_string());
        }
        drop(stdin);

        let stdout = match child.take_stdout() {
            Some(stdout) => stdout,
            None => {
                child.terminate();
                return Err("extension stdout unavailable".to_owned());
            }
        };
        let stderr = match child.take_stderr() {
            Some(stderr) => stderr,
            None => {
                child.terminate();
                return Err("extension stderr unavailable".to_owned());
            }
        };
        let output_limit = self.max_output_bytes;
        let output = thread::spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .take(
                    u64::try_from(output_limit)
                        .unwrap_or(u64::MAX)
                        .saturating_add(1),
                )
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let errors = thread::spawn(move || {
            let mut bytes = Vec::new();
            stderr
                .take(16 * 1024)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let started = Instant::now();
        let status = loop {
            if cancellation.is_cancelled() {
                child.terminate();
                let _ = output.join();
                let _ = errors.join();
                return Err("extension cancelled".into());
            }
            // Observing through the owned group keeps the leader pinned as a
            // zombie until its descendants are killed, so a fast PID reuse
            // cannot redirect the group signal at an unrelated process. The
            // leader is reaped by the same call, so nothing accumulates.
            let polled = match child.try_wait_owned_group() {
                Ok(status) => status,
                Err(error) => {
                    child.terminate();
                    let _ = output.join();
                    let _ = errors.join();
                    return Err(error.to_string());
                }
            };
            if let Some(status) = polled {
                break status;
            }
            if started.elapsed() > Duration::from_secs(60) {
                child.terminate();
                let _ = output.join();
                let _ = errors.join();
                return Err("extension exceeded hard process lifetime".into());
            }
            thread::sleep(Duration::from_millis(5));
        };
        let output = output
            .join()
            .map_err(|_| "extension stdout reader panicked".to_owned())?
            .map_err(|error| error.to_string())?;
        let errors = errors
            .join()
            .map_err(|_| "extension stderr reader panicked".to_owned())?
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!(
                "extension exited with {status}: {}",
                sanitized_extension_stderr(&errors)
            ));
        }
        self.response(&output)
    }

    fn shutdown(&self) -> Result<(), String> {
        Ok(())
    }
}

fn sanitized_extension_stderr(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .map(|character| match character {
            '\n' | '\t' => character,
            character if character.is_control() => '�',
            character => character,
        })
        .collect()
}

struct ExtensionRecord {
    kind: ExtensionKind,
    hook_events: BTreeSet<HookEvent>,
    health: ExtensionHealth,
    handler: Arc<dyn ExtensionHandler>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInvocationResult {
    pub id: String,
    pub output: Option<ExtensionOutput>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookDispatchReport {
    pub contract_version: u16,
    pub event: Option<HookEvent>,
    pub invocations: Vec<HookInvocationResult>,
}

pub struct ExtensionHost {
    project_scope: PathBuf,
    extensions: BTreeMap<String, ExtensionRecord>,
    max_output_bytes: usize,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExtensionError {
    #[error("extension already registered: {0}")]
    Duplicate(String),
    #[error("extension not found: {0}")]
    NotFound(String),
    #[error("extension is unhealthy: {0:?}")]
    Unhealthy(ExtensionHealth),
    #[error("extension timed out")]
    Timeout,
    #[error("extension failed: {0}")]
    Failed(String),
    #[error("extension panicked")]
    Panicked,
    #[error("extension attempted a forbidden authority change")]
    ForbiddenAuthority,
    #[error("extension output exceeds {limit} bytes")]
    OutputTooLarge { limit: usize },
    #[error("extension input is invalid: {0}")]
    InvalidInput(&'static str),
    #[error("extension capacity of {0} was reached")]
    Capacity(usize),
}

impl ExtensionHost {
    #[must_use]
    pub fn new(project_scope: PathBuf) -> Self {
        Self {
            project_scope,
            extensions: BTreeMap::new(),
            max_output_bytes: 1024 * 1024,
        }
    }

    #[must_use]
    pub fn with_output_limit(project_scope: PathBuf, max_output_bytes: usize) -> Self {
        Self {
            project_scope,
            extensions: BTreeMap::new(),
            max_output_bytes,
        }
    }

    #[must_use]
    pub fn project_scope(&self) -> &Path {
        &self.project_scope
    }

    pub fn register(
        &mut self,
        id: String,
        kind: ExtensionKind,
        handler: Arc<dyn ExtensionHandler>,
    ) -> Result<(), ExtensionError> {
        validate_extension_id(&id)?;
        if self.extensions.contains_key(&id) {
            return Err(ExtensionError::Duplicate(id));
        }
        if self.extensions.len() >= MAX_EXTENSIONS {
            return Err(ExtensionError::Capacity(MAX_EXTENSIONS));
        }
        self.extensions.insert(
            id,
            ExtensionRecord {
                kind,
                hook_events: BTreeSet::new(),
                health: ExtensionHealth::Healthy,
                handler,
            },
        );
        Ok(())
    }

    pub fn register_hook(
        &mut self,
        id: String,
        events: impl IntoIterator<Item = HookEvent>,
        handler: Arc<dyn ExtensionHandler>,
    ) -> Result<(), ExtensionError> {
        let events = events.into_iter().collect::<BTreeSet<_>>();
        if events.is_empty() {
            return Err(ExtensionError::Failed(
                "hook registration requires at least one event".into(),
            ));
        }
        self.register(id.clone(), ExtensionKind::Hook, handler)?;
        self.extensions
            .get_mut(&id)
            .ok_or_else(|| ExtensionError::Failed("registered hook disappeared".into()))?
            .hook_events = events;
        Ok(())
    }

    /// Dispatches a lifecycle event to subscribed hooks. Each failure is
    /// isolated and recorded; one hook can never suppress later handlers or
    /// grant lifecycle authority.
    pub fn dispatch_hooks(
        &mut self,
        event: HookEvent,
        input: Value,
        timeout: Duration,
    ) -> HookDispatchReport {
        let ids = self
            .extensions
            .iter()
            .filter(|(_, record)| {
                record.kind == ExtensionKind::Hook && record.hook_events.contains(&event)
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let invocations = ids
            .into_iter()
            .map(|id| match self.invoke(&id, input.clone(), timeout) {
                Ok(output) => HookInvocationResult {
                    id,
                    output: Some(output),
                    error: None,
                },
                Err(error) => HookInvocationResult {
                    id,
                    output: None,
                    error: Some(error.to_string()),
                },
            })
            .collect();
        HookDispatchReport {
            contract_version: 1,
            event: Some(event),
            invocations,
        }
    }

    pub fn kind(&self, id: &str) -> Result<ExtensionKind, ExtensionError> {
        self.extensions
            .get(id)
            .map(|record| record.kind)
            .ok_or_else(|| ExtensionError::NotFound(id.into()))
    }

    pub fn health(&self, id: &str) -> Result<ExtensionHealth, ExtensionError> {
        self.extensions
            .get(id)
            .map(|record| record.health)
            .ok_or_else(|| ExtensionError::NotFound(id.into()))
    }

    pub fn invoke(
        &mut self,
        id: &str,
        input: Value,
        timeout: Duration,
    ) -> Result<ExtensionOutput, ExtensionError> {
        validate_extension_id(id)?;
        if timeout.is_zero() || timeout > MAX_EXTENSION_TIMEOUT {
            return Err(ExtensionError::InvalidInput("timeout is outside 1ms..60s"));
        }
        if serde_json::to_vec(&input)
            .map(|bytes| bytes.len() > MAX_EXTENSION_INPUT_BYTES)
            .unwrap_or(true)
        {
            return Err(ExtensionError::InvalidInput("input exceeds 1 MiB"));
        }
        if self.max_output_bytes == 0 || self.max_output_bytes > MAX_MCP_TRANSPORT_BYTES {
            return Err(ExtensionError::InvalidInput("output limit is invalid"));
        }
        let record = self
            .extensions
            .get_mut(id)
            .ok_or_else(|| ExtensionError::NotFound(id.into()))?;
        if record.health != ExtensionHealth::Healthy {
            return Err(ExtensionError::Unhealthy(record.health));
        }
        let handler = record.handler.clone();
        let cancellation = Cancellation::new();
        let worker_cancellation = cancellation.clone();
        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let result = catch_unwind(AssertUnwindSafe(|| {
                handler.execute(input, worker_cancellation)
            }));
            let _ = sender.send(result);
        });
        let output = match receiver.recv_timeout(timeout) {
            Ok(Ok(Ok(output))) => output,
            Ok(Ok(Err(message))) => {
                record.health = ExtensionHealth::Failed;
                return Err(ExtensionError::Failed(message));
            }
            Ok(Err(_)) => {
                record.health = ExtensionHealth::Panicked;
                return Err(ExtensionError::Panicked);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                cancellation.cancel();
                record.health = ExtensionHealth::TimedOut;
                return Err(ExtensionError::Timeout);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                record.health = ExtensionHealth::Failed;
                return Err(ExtensionError::Failed(
                    "extension worker disconnected".into(),
                ));
            }
        };
        if matches!(
            output,
            ExtensionOutput::Land
                | ExtensionOutput::ExpandScope
                | ExtensionOutput::GrantPermission
                | ExtensionOutput::ChangePolicy
        ) {
            record.health = ExtensionHealth::Disabled;
            return Err(ExtensionError::ForbiddenAuthority);
        }
        if serde_json::to_vec(&output)
            .map(|bytes| bytes.len() > self.max_output_bytes)
            .unwrap_or(true)
        {
            record.health = ExtensionHealth::Disabled;
            return Err(ExtensionError::OutputTooLarge {
                limit: self.max_output_bytes,
            });
        }
        Ok(output)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), ExtensionError> {
        validate_extension_id(id)?;
        let record = self
            .extensions
            .get_mut(id)
            .ok_or_else(|| ExtensionError::NotFound(id.into()))?;
        if let Err(error) = record.handler.shutdown() {
            record.health = ExtensionHealth::Failed;
            return Err(ExtensionError::Failed(error));
        }
        record.health = ExtensionHealth::Disposed;
        self.extensions.remove(id);
        Ok(())
    }

    pub fn dispose(&mut self) {
        for record in self.extensions.values_mut() {
            if record.health != ExtensionHealth::Disposed {
                record.health = if record.handler.shutdown().is_ok() {
                    ExtensionHealth::Disposed
                } else {
                    ExtensionHealth::Failed
                };
            }
        }
    }
}

fn validate_extension_id(id: &str) -> Result<(), ExtensionError> {
    if !id.is_empty()
        && id.len() <= MAX_MCP_IDENTIFIER_BYTES
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Ok(())
    } else {
        Err(ExtensionError::InvalidInput("identifier is invalid"))
    }
}

impl Drop for ExtensionHost {
    fn drop(&mut self) {
        self.dispose();
    }
}

#[cfg(test)]
mod tests;
