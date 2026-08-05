//! Executable official-provider adapters with injectable asynchronous HTTP.
//! Browser cookies and third-party credential reuse are intentionally unsupported.

use async_trait::async_trait;
use changeloop_provider::{
    Capability, CapabilityProfile, CircuitBreaker, CircuitBreakerPolicy, CircuitDecision,
    ErrorCategory, ExecutionProgress, FinishReason, Measurement, MoneyMicros, NormalizedRequest,
    ProviderError, ProviderKind, ReplayMetadata, RetryDecision, RetryPolicy, RiskTier,
    RouteCandidate, RouteRequirements, StreamEvent, TokenUsage, UsageAccounting, UsageLedger,
    authorize_fallback, select_route,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::fmt;
use std::io::{Read, Write};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use zeroize::Zeroize;

pub const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
pub const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
pub const DEFAULT_MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_USAGE_LEDGER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_API_KEY_BYTES: usize = 16 * 1024;
const MAX_DISCOVERED_MODELS: usize = 10_000;
const MAX_MODEL_ID_BYTES: usize = 256;
const MAX_ACTIVE_TOOL_CALLS: usize = 1_024;
const MAX_TOOL_ARGUMENT_BYTES: usize = DEFAULT_MAX_RESPONSE_BYTES;
const MAX_REASONING_ITEM_IDS: usize = 4_096;
const MAX_NATIVE_OUTPUT_ITEMS: usize = 65_536;
const MAX_REPLAY_METADATA_BYTES: usize = 64 * 1024;

fn valid_provider_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_MODEL_ID_BYTES
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

fn validate_provider_url(raw: &str) -> Result<(), AdapterError> {
    let url = reqwest::Url::parse(raw)
        .map_err(|_| AdapterError::Translation("provider endpoint URL is invalid".into()))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AdapterError::Translation(
            "provider endpoint must not contain credentials, query, or fragment".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AdapterError::Translation("provider endpoint host is missing".into()))?;
    let secure = url.scheme() == "https";
    let hermetic_loopback = url.scheme() == "http"
        && host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if !secure && !hermetic_loopback {
        return Err(AdapterError::Translation(
            "provider endpoint must use HTTPS (HTTP is limited to literal loopback fixtures)"
                .into(),
        ));
    }
    Ok(())
}

#[derive(Clone, PartialEq, Eq)]
pub struct ApiKey(String);

impl ApiKey {
    pub fn new(value: impl Into<String>) -> Result<Self, AuthError> {
        let value = value.into();
        if value.trim().is_empty() {
            Err(AuthError::MissingKey)
        } else if value.len() > MAX_API_KEY_BYTES
            || !value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
        {
            Err(AuthError::InvalidKey)
        } else {
            Ok(Self(value))
        }
    }
    fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for ApiKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ApiKey([REDACTED])")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthSource {
    ExplicitConfig,
    Environment { variable: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthProfile {
    pub provider: ProviderKind,
    key: ApiKey,
    pub source: AuthSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedAuthProfile {
    pub provider: ProviderKind,
    pub source: AuthSource,
    pub key_present: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AuthError {
    #[error("API key is missing")]
    MissingKey,
    #[error("credential variable is not present in the explicitly supplied environment")]
    MissingVariable,
    #[error("API key must be visible ASCII without whitespace and no more than 16384 bytes")]
    InvalidKey,
}

impl AuthProfile {
    pub fn explicit(provider: ProviderKind, key: impl Into<String>) -> Result<Self, AuthError> {
        Ok(Self {
            provider,
            key: ApiKey::new(key)?,
            source: AuthSource::ExplicitConfig,
        })
    }

    /// Reads only the caller-provided environment snapshot, never browser or ambient cookie state.
    pub fn from_environment(
        provider: ProviderKind,
        environment: &BTreeMap<String, String>,
    ) -> Result<Self, AuthError> {
        let variable = match provider {
            ProviderKind::Anthropic => "ANTHROPIC_API_KEY",
            ProviderKind::OpenAi => "OPENAI_API_KEY",
        };
        let key = environment
            .get(variable)
            .ok_or(AuthError::MissingVariable)?;
        Ok(Self {
            provider,
            key: ApiKey::new(key)?,
            source: AuthSource::Environment {
                variable: variable.into(),
            },
        })
    }

    #[must_use]
    pub fn redacted(&self) -> PersistedAuthProfile {
        PersistedAuthProfile {
            provider: self.provider,
            source: self.source.clone(),
            key_present: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelStatus {
    Active,
    Deprecated,
    Unavailable,
    /// Locally configured but not verified against authenticated discovery.
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelDescriptor {
    pub id: String,
    pub provider: ProviderKind,
    pub status: ModelStatus,
    pub capabilities: BTreeSet<Capability>,
    pub max_input_tokens: Option<u64>,
    pub max_output_tokens: Option<u64>,
    pub risk_tier: RiskTier,
}

#[derive(Clone, Debug, Default)]
pub struct ModelCatalog {
    models: BTreeMap<(ProviderKind, String), ModelDescriptor>,
}

impl ModelCatalog {
    pub fn insert(&mut self, model: ModelDescriptor) {
        self.models
            .insert((model.provider, model.id.clone()), model);
    }
    pub fn get(&self, provider: ProviderKind, id: &str) -> Option<&ModelDescriptor> {
        self.models.get(&(provider, id.to_owned()))
    }
    pub fn compatible(
        &self,
        provider: ProviderKind,
        required: &BTreeSet<Capability>,
    ) -> Vec<&ModelDescriptor> {
        self.models
            .values()
            .filter(|model| {
                model.provider == provider
                    && model.status == ModelStatus::Active
                    && required.is_subset(&model.capabilities)
            })
            .collect()
    }

    #[must_use]
    pub fn all(&self) -> Vec<&ModelDescriptor> {
        self.models.values().collect()
    }

    #[must_use]
    pub fn routes(&self) -> Vec<RouteCandidate> {
        self.models
            .values()
            .filter(|model| model.status == ModelStatus::Active)
            .map(|model| RouteCandidate {
                provider: model.provider,
                model: model.id.clone(),
                risk_tier: model.risk_tier,
                capabilities: model.capabilities.clone(),
            })
            .collect()
    }
}

/// Builds the same catalog used by the router without guessing model names or
/// limits. Only explicitly configured models enter the catalog.
#[must_use]
pub fn configured_catalog(environment: &BTreeMap<String, String>) -> ModelCatalog {
    let mut catalog = ModelCatalog::default();
    let configured = [
        (ProviderKind::Anthropic, "ANTHROPIC_MODEL"),
        (ProviderKind::OpenAi, "OPENAI_MODEL"),
    ];
    for (provider, variable) in configured {
        if let Some(model) = environment
            .get(variable)
            .filter(|value| valid_provider_identifier(value))
        {
            let profile = match provider {
                ProviderKind::Anthropic => CapabilityProfile::anthropic_messages(),
                ProviderKind::OpenAi => CapabilityProfile::openai_responses(),
            };
            catalog.insert(ModelDescriptor {
                id: model.clone(),
                provider,
                status: ModelStatus::Unknown,
                capabilities: profile.capabilities,
                max_input_tokens: profile.max_input_tokens,
                max_output_tokens: profile.max_output_tokens,
                risk_tier: RiskTier::High,
            });
        }
    }
    if let (Some(provider), Some(model)) = (
        environment.get("CHANGELOOP_PROVIDER"),
        environment
            .get("CHANGELOOP_MODEL")
            .filter(|value| valid_provider_identifier(value)),
    ) {
        let provider = match provider.as_str() {
            "anthropic" => Some(ProviderKind::Anthropic),
            "openai" => Some(ProviderKind::OpenAi),
            _ => None,
        };
        if let Some(provider) = provider {
            let profile = match provider {
                ProviderKind::Anthropic => CapabilityProfile::anthropic_messages(),
                ProviderKind::OpenAi => CapabilityProfile::openai_responses(),
            };
            catalog.insert(ModelDescriptor {
                id: model.clone(),
                provider,
                status: ModelStatus::Unknown,
                capabilities: profile.capabilities,
                max_input_tokens: profile.max_input_tokens,
                max_output_tokens: profile.max_output_tokens,
                risk_tier: RiskTier::High,
            });
        }
    }
    catalog
}

#[derive(Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl HttpRequest {
    #[must_use]
    pub fn redacted(&self) -> Self {
        let mut request = self.clone();
        request.url = reqwest::Url::parse(&request.url).map_or_else(
            |_| "[INVALID URL]".into(),
            |url| {
                let host = url.host_str().unwrap_or("[NO HOST]");
                let host = if host.contains(':') {
                    format!("[{host}]")
                } else {
                    host.to_owned()
                };
                url.port().map_or_else(
                    || format!("{}://{host}", url.scheme()),
                    |port| format!("{}://{host}:{port}", url.scheme()),
                )
            },
        );
        for (name, value) in &mut request.headers {
            if matches!(
                name.to_ascii_lowercase().as_str(),
                "authorization" | "x-api-key" | "cookie"
            ) {
                *value = "[REDACTED]".into();
            }
        }
        request.body = format!("[REDACTED {} bytes]", request.body.len()).into_bytes();
        request
    }
}

impl fmt::Debug for HttpRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let redacted = self.redacted();
        formatter
            .debug_struct("HttpRequest")
            .field("method", &redacted.method)
            .field("url", &redacted.url)
            .field("headers", &redacted.headers)
            .field("body_bytes", &self.body.len())
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl fmt::Debug for HttpResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut headers = self.headers.clone();
        for (name, value) in &mut headers {
            if matches!(
                name.to_ascii_lowercase().as_str(),
                "set-cookie" | "authorization" | "x-api-key"
            ) {
                *value = "[REDACTED]".into();
            }
        }
        formatter
            .debug_struct("HttpResponse")
            .field("status", &self.status)
            .field("headers", &headers)
            .field("body_bytes", &self.body.len())
            .finish()
    }
}

pub struct HttpStreamResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub chunks: tokio::sync::mpsc::Receiver<Result<Vec<u8>, TransportError>>,
}

struct CancellationInner {
    cancelled: AtomicBool,
    notify: tokio::sync::Notify,
    steering: Mutex<VecDeque<String>>,
}

const MAX_PENDING_STEERING_MESSAGES: usize = 64;
const MAX_STEERING_MESSAGE_BYTES: usize = 64 * 1024;

fn truncate_utf8(mut value: String, max_bytes: usize) -> String {
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

#[derive(Clone)]
pub struct CancellationToken(Arc<CancellationInner>);
impl Default for CancellationToken {
    fn default() -> Self {
        Self(Arc::new(CancellationInner {
            cancelled: AtomicBool::new(false),
            notify: tokio::sync::Notify::new(),
            steering: Mutex::new(VecDeque::new()),
        }))
    }
}
impl CancellationToken {
    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::SeqCst);
        self.0.notify.notify_waiters();
    }
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(Ordering::SeqCst)
    }
    pub fn steer(&self, message: impl Into<String>) {
        let message = truncate_utf8(message.into(), MAX_STEERING_MESSAGE_BYTES);
        let mut steering = self
            .0
            .steering
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if steering.len() == MAX_PENDING_STEERING_MESSAGES {
            steering.pop_front();
        }
        steering.push_back(message);
        drop(steering);
        self.0.notify.notify_waiters();
    }
    pub fn take_steering(&self) -> Option<String> {
        self.0
            .steering
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pop_front()
    }
    async fn cancelled(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            let notified = self.0.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("request cancelled")]
    Cancelled,
    #[error("HTTP transport failed: {0}")]
    Http(String),
    #[error("provider response exceeds the configured {limit}-byte limit")]
    ResponseTooLarge { limit: usize },
}

#[async_trait]
pub trait HttpTransport: Send + Sync {
    async fn send(
        &self,
        request: HttpRequest,
        cancel: &CancellationToken,
    ) -> Result<HttpResponse, TransportError>;

    /// Starts a response and returns as soon as headers are available. The
    /// default preserves compatibility for fixture transports; production
    /// transports override this to deliver network chunks incrementally.
    async fn send_stream(
        &self,
        request: HttpRequest,
        cancel: &CancellationToken,
    ) -> Result<HttpStreamResponse, TransportError> {
        let response = self.send(request, cancel).await?;
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        let _ = sender.send(Ok(response.body)).await;
        Ok(HttpStreamResponse {
            status: response.status,
            headers: response.headers,
            chunks: receiver,
        })
    }
}

#[derive(Clone)]
pub struct ReqwestTransport {
    client: Result<reqwest::Client, String>,
    max_response_bytes: usize,
}

fn hardened_provider_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self {
            client: hardened_provider_client(),
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
        }
    }
}

impl ReqwestTransport {
    #[must_use]
    pub fn with_max_response_bytes(max_response_bytes: usize) -> Self {
        Self {
            client: hardened_provider_client(),
            max_response_bytes,
        }
    }
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn send(
        &self,
        request: HttpRequest,
        cancel: &CancellationToken,
    ) -> Result<HttpResponse, TransportError> {
        if cancel.is_cancelled() {
            return Err(TransportError::Cancelled);
        }
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|error| TransportError::Http(error.to_string()))?;
        let client = self
            .client
            .as_ref()
            .map_err(|error| TransportError::Http(error.clone()))?;
        let mut builder = client.request(method, request.url).body(request.body);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        let response = tokio::select! {
            response = builder.send() => response.map_err(|error| TransportError::Http(error.to_string()))?,
            () = cancel.cancelled() => return Err(TransportError::Cancelled),
        };
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_ascii_lowercase(), value.to_owned()))
            })
            .collect();
        if response
            .content_length()
            .is_some_and(|length| length > self.max_response_bytes as u64)
        {
            return Err(TransportError::ResponseTooLarge {
                limit: self.max_response_bytes,
            });
        }
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        loop {
            let next = tokio::select! {
                next = stream.next() => next,
                () = cancel.cancelled() => return Err(TransportError::Cancelled),
            };
            let Some(chunk) = next else {
                break;
            };
            let chunk = chunk.map_err(|error| TransportError::Http(error.to_string()))?;
            if body.len().saturating_add(chunk.len()) > self.max_response_bytes {
                return Err(TransportError::ResponseTooLarge {
                    limit: self.max_response_bytes,
                });
            }
            body.extend_from_slice(&chunk);
        }
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }

    async fn send_stream(
        &self,
        request: HttpRequest,
        cancel: &CancellationToken,
    ) -> Result<HttpStreamResponse, TransportError> {
        if cancel.is_cancelled() {
            return Err(TransportError::Cancelled);
        }
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|error| TransportError::Http(error.to_string()))?;
        let client = self
            .client
            .as_ref()
            .map_err(|error| TransportError::Http(error.clone()))?;
        let mut builder = client.request(method, request.url).body(request.body);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        let response = tokio::select! {
            response = builder.send() => response.map_err(|error| TransportError::Http(error.to_string()))?,
            () = cancel.cancelled() => return Err(TransportError::Cancelled),
        };
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_ascii_lowercase(), value.to_owned()))
            })
            .collect();
        if response
            .content_length()
            .is_some_and(|length| length > self.max_response_bytes as u64)
        {
            return Err(TransportError::ResponseTooLarge {
                limit: self.max_response_bytes,
            });
        }
        let mut upstream = response.bytes_stream();
        let (sender, receiver) = tokio::sync::mpsc::channel(32);
        let cancel = cancel.clone();
        let limit = self.max_response_bytes;
        tokio::spawn(async move {
            let mut received = 0_usize;
            loop {
                let next = tokio::select! {
                    next = upstream.next() => next,
                    () = cancel.cancelled() => {
                        let _ = sender.send(Err(TransportError::Cancelled)).await;
                        return;
                    }
                };
                let Some(chunk) = next else {
                    return;
                };
                let chunk = match chunk {
                    Ok(chunk) => chunk,
                    Err(error) => {
                        let _ = sender
                            .send(Err(TransportError::Http(error.to_string())))
                            .await;
                        return;
                    }
                };
                received = received.saturating_add(chunk.len());
                if received > limit {
                    let _ = sender
                        .send(Err(TransportError::ResponseTooLarge { limit }))
                        .await;
                    return;
                }
                if sender.send(Ok(chunk.to_vec())).await.is_err() {
                    return;
                }
            }
        });
        Ok(HttpStreamResponse {
            status,
            headers,
            chunks: receiver,
        })
    }
}

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("request cannot be represented by this provider: {0}")]
    Translation(String),
    #[error("provider stream is malformed: {0}")]
    MalformedStream(String),
    #[error("provider response is malformed: {0}")]
    MalformedResponse(String),
    #[error(transparent)]
    Provider(#[from] ProviderError),
}

impl AdapterError {
    fn provider_error(&self, provider: ProviderKind) -> ProviderError {
        match self {
            Self::Provider(error) => error.clone(),
            Self::Transport(TransportError::Cancelled) => ProviderError {
                provider,
                category: ErrorCategory::Cancelled,
                code: None,
                message: self.to_string(),
                retryable: false,
                provider_request_id: None,
                http_status: None,
                retry_after_ms: None,
            },
            Self::Transport(TransportError::ResponseTooLarge { .. }) => ProviderError {
                provider,
                category: ErrorCategory::InvalidRequest,
                code: Some("response_too_large".into()),
                message: self.to_string(),
                retryable: false,
                provider_request_id: None,
                http_status: None,
                retry_after_ms: None,
            },
            Self::Transport(_) => ProviderError {
                provider,
                category: ErrorCategory::Transport,
                code: None,
                message: self.to_string(),
                retryable: true,
                provider_request_id: None,
                http_status: None,
                retry_after_ms: None,
            },
            _ => ProviderError {
                provider,
                category: ErrorCategory::InvalidRequest,
                code: None,
                message: self.to_string(),
                retryable: false,
                provider_request_id: None,
                http_status: None,
                retry_after_ms: None,
            },
        }
    }
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn kind(&self) -> ProviderKind;
    fn capability_profile(&self) -> CapabilityProfile;
    async fn execute_once(
        &self,
        request: &NormalizedRequest,
        auth: &AuthProfile,
        transport: &dyn HttpTransport,
        cancel: &CancellationToken,
    ) -> Result<Vec<StreamEvent>, AdapterError>;

    async fn execute_stream(
        &self,
        request: &NormalizedRequest,
        auth: &AuthProfile,
        transport: &dyn HttpTransport,
        cancel: &CancellationToken,
    ) -> Result<ProviderEventStream, AdapterError> {
        ProviderEventStream::from_events(self.execute_once(request, auth, transport, cancel).await?)
    }
}

pub struct ProviderEventStream {
    receiver: tokio::sync::mpsc::Receiver<Result<StreamEvent, AdapterError>>,
}

impl ProviderEventStream {
    fn from_events(events: Vec<StreamEvent>) -> Result<Self, AdapterError> {
        let capacity = events.len().max(1);
        let (sender, receiver) = tokio::sync::mpsc::channel(capacity);
        for event in events {
            sender.try_send(Ok(event)).map_err(|error| {
                AdapterError::Translation(format!("compatibility stream failed: {error}"))
            })?;
        }
        Ok(Self { receiver })
    }

    pub async fn next(&mut self) -> Option<Result<StreamEvent, AdapterError>> {
        self.receiver.recv().await
    }

    pub async fn collect(mut self) -> Result<Vec<StreamEvent>, AdapterError> {
        let mut events = Vec::new();
        let mut bytes = 0usize;
        while let Some(event) = self.next().await {
            let event = event?;
            let event_bytes = serde_json::to_vec(&event)
                .map(|encoded| encoded.len())
                .unwrap_or(DEFAULT_MAX_RESPONSE_BYTES.saturating_add(1));
            if events.len() >= 65_536
                || bytes
                    .checked_add(event_bytes)
                    .is_none_or(|size| size > DEFAULT_MAX_RESPONSE_BYTES)
            {
                return Err(AdapterError::MalformedStream(format!(
                    "provider event stream exceeds 65536 events/{DEFAULT_MAX_RESPONSE_BYTES} bytes"
                )));
            }
            bytes = bytes.saturating_add(event_bytes);
            events.push(event);
        }
        Ok(events)
    }
}

pub struct AnthropicAdapter {
    pub endpoint: String,
}
impl Default for AnthropicAdapter {
    fn default() -> Self {
        Self {
            endpoint: ANTHROPIC_MESSAGES_URL.into(),
        }
    }
}

pub struct OpenAiAdapter {
    pub endpoint: String,
}
impl Default for OpenAiAdapter {
    fn default() -> Self {
        Self {
            endpoint: OPENAI_RESPONSES_URL.into(),
        }
    }
}

#[async_trait]
impl ProviderAdapter for AnthropicAdapter {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Anthropic
    }
    fn capability_profile(&self) -> CapabilityProfile {
        CapabilityProfile::anthropic_messages()
    }

    async fn execute_once(
        &self,
        request: &NormalizedRequest,
        auth: &AuthProfile,
        transport: &dyn HttpTransport,
        cancel: &CancellationToken,
    ) -> Result<Vec<StreamEvent>, AdapterError> {
        validate_provider_url(&self.endpoint)?;
        require_auth(auth, self.kind())?;
        let body = anthropic_body_with_stream(request, false)?;
        let response = transport
            .send(
                HttpRequest {
                    method: "POST".into(),
                    url: self.endpoint.clone(),
                    headers: BTreeMap::from([
                        ("content-type".into(), "application/json".into()),
                        ("accept".into(), "application/json".into()),
                        ("x-api-key".into(), auth.key.expose().into()),
                        ("anthropic-version".into(), "2023-06-01".into()),
                    ]),
                    body: serde_json::to_vec(&body)
                        .map_err(|error| AdapterError::Translation(error.to_string()))?,
                },
                cancel,
            )
            .await?;
        parse_non_streaming_response(response, self.kind())
    }

    async fn execute_stream(
        &self,
        request: &NormalizedRequest,
        auth: &AuthProfile,
        transport: &dyn HttpTransport,
        cancel: &CancellationToken,
    ) -> Result<ProviderEventStream, AdapterError> {
        validate_provider_url(&self.endpoint)?;
        require_auth(auth, self.kind())?;
        let body = anthropic_body(request)?;
        let response = transport
            .send_stream(
                HttpRequest {
                    method: "POST".into(),
                    url: self.endpoint.clone(),
                    headers: BTreeMap::from([
                        ("content-type".into(), "application/json".into()),
                        ("accept".into(), "text/event-stream".into()),
                        ("x-api-key".into(), auth.key.expose().into()),
                        ("anthropic-version".into(), "2023-06-01".into()),
                    ]),
                    body: serde_json::to_vec(&body)
                        .map_err(|error| AdapterError::Translation(error.to_string()))?,
                },
                cancel,
            )
            .await?;
        stream_http_response(response, self.kind()).await
    }
}

#[async_trait]
impl ProviderAdapter for OpenAiAdapter {
    fn kind(&self) -> ProviderKind {
        ProviderKind::OpenAi
    }
    fn capability_profile(&self) -> CapabilityProfile {
        CapabilityProfile::openai_responses()
    }

    async fn execute_once(
        &self,
        request: &NormalizedRequest,
        auth: &AuthProfile,
        transport: &dyn HttpTransport,
        cancel: &CancellationToken,
    ) -> Result<Vec<StreamEvent>, AdapterError> {
        validate_provider_url(&self.endpoint)?;
        require_auth(auth, self.kind())?;
        let body = openai_body_with_stream(request, false)?;
        let response = transport
            .send(
                HttpRequest {
                    method: "POST".into(),
                    url: self.endpoint.clone(),
                    headers: BTreeMap::from([
                        ("content-type".into(), "application/json".into()),
                        ("accept".into(), "application/json".into()),
                        (
                            "authorization".into(),
                            format!("Bearer {}", auth.key.expose()),
                        ),
                    ]),
                    body: serde_json::to_vec(&body)
                        .map_err(|error| AdapterError::Translation(error.to_string()))?,
                },
                cancel,
            )
            .await?;
        parse_non_streaming_response(response, self.kind())
    }

    async fn execute_stream(
        &self,
        request: &NormalizedRequest,
        auth: &AuthProfile,
        transport: &dyn HttpTransport,
        cancel: &CancellationToken,
    ) -> Result<ProviderEventStream, AdapterError> {
        validate_provider_url(&self.endpoint)?;
        require_auth(auth, self.kind())?;
        let body = openai_body(request)?;
        let response = transport
            .send_stream(
                HttpRequest {
                    method: "POST".into(),
                    url: self.endpoint.clone(),
                    headers: BTreeMap::from([
                        ("content-type".into(), "application/json".into()),
                        ("accept".into(), "text/event-stream".into()),
                        (
                            "authorization".into(),
                            format!("Bearer {}", auth.key.expose()),
                        ),
                    ]),
                    body: serde_json::to_vec(&body)
                        .map_err(|error| AdapterError::Translation(error.to_string()))?,
                },
                cancel,
            )
            .await?;
        stream_http_response(response, self.kind()).await
    }
}

enum IncrementalSseDecoder {
    Anthropic(AnthropicSseState),
    OpenAi(OpenAiSseState),
}

impl IncrementalSseDecoder {
    fn new(provider: ProviderKind) -> Self {
        match provider {
            ProviderKind::Anthropic => Self::Anthropic(AnthropicSseState::default()),
            ProviderKind::OpenAi => Self::OpenAi(OpenAiSseState::default()),
        }
    }

    fn parse(&mut self, frame: &[u8]) -> Result<Vec<StreamEvent>, AdapterError> {
        match self {
            Self::Anthropic(state) => parse_anthropic_sse_incremental(frame, state),
            Self::OpenAi(state) => parse_openai_sse_incremental(frame, state),
        }
    }

    fn finish(&self) -> Result<(), AdapterError> {
        match self {
            Self::Anthropic(state) => state.finish(),
            Self::OpenAi(state) => state.finish(),
        }
    }
}

async fn stream_http_response(
    mut response: HttpStreamResponse,
    provider: ProviderKind,
) -> Result<ProviderEventStream, AdapterError> {
    if response.status >= 400 {
        let mut body = Vec::new();
        while let Some(chunk) = response.chunks.recv().await {
            let chunk = chunk?;
            if body
                .len()
                .checked_add(chunk.len())
                .is_none_or(|size| size > DEFAULT_MAX_RESPONSE_BYTES)
            {
                return Err(AdapterError::MalformedStream(format!(
                    "provider error response exceeds {DEFAULT_MAX_RESPONSE_BYTES} bytes"
                )));
            }
            body.extend_from_slice(&chunk);
        }
        return Err(map_http_error(
            provider,
            HttpResponse {
                status: response.status,
                headers: response.headers,
                body,
            },
        ));
    }
    let headers = response.headers;
    let (sender, receiver) = tokio::sync::mpsc::channel(64);
    tokio::spawn(async move {
        let mut decoder = IncrementalSseDecoder::new(provider);
        let mut buffered = Vec::new();
        while let Some(chunk) = response.chunks.recv().await {
            match chunk {
                Ok(chunk) => {
                    if buffered
                        .len()
                        .checked_add(chunk.len())
                        .is_none_or(|size| size > DEFAULT_MAX_RESPONSE_BYTES)
                    {
                        let _ = sender
                            .send(Err(AdapterError::MalformedStream(format!(
                                "provider stream frame exceeds {DEFAULT_MAX_RESPONSE_BYTES} bytes"
                            ))))
                            .await;
                        return;
                    }
                    buffered.extend_from_slice(&chunk);
                }
                Err(error) => {
                    let _ = sender.send(Err(AdapterError::Transport(error))).await;
                    return;
                }
            }
            while let Some((end, delimiter)) = find_sse_frame(&buffered) {
                let frame = buffered.drain(..end).collect::<Vec<_>>();
                buffered.drain(..delimiter);
                if !emit_parsed_frame(&sender, &headers, &frame, &mut decoder).await {
                    return;
                }
            }
        }
        if !buffered.is_empty()
            && !emit_parsed_frame(&sender, &headers, &buffered, &mut decoder).await
        {
            return;
        }
        if let Err(error) = decoder.finish() {
            let _ = sender.send(Err(error)).await;
        }
    });
    Ok(ProviderEventStream { receiver })
}

fn find_sse_frame(bytes: &[u8]) -> Option<(usize, usize)> {
    for index in 0..bytes.len().saturating_sub(1) {
        if bytes[index..].starts_with(b"\n\n") {
            return Some((index, 2));
        }
        if bytes[index..].starts_with(b"\r\n\r\n") {
            return Some((index, 4));
        }
    }
    None
}

async fn emit_parsed_frame(
    sender: &tokio::sync::mpsc::Sender<Result<StreamEvent, AdapterError>>,
    headers: &BTreeMap<String, String>,
    frame: &[u8],
    decoder: &mut IncrementalSseDecoder,
) -> bool {
    if frame.iter().all(u8::is_ascii_whitespace) {
        return true;
    }
    match decoder.parse(frame) {
        Ok(mut events) => {
            enrich_response_metadata(&mut events, headers);
            for event in events {
                if sender.send(Ok(event)).await.is_err() {
                    return false;
                }
            }
            true
        }
        Err(error) => {
            let _ = sender.send(Err(error)).await;
            false
        }
    }
}

fn require_auth(auth: &AuthProfile, provider: ProviderKind) -> Result<(), AdapterError> {
    if auth.provider == provider {
        Ok(())
    } else {
        Err(AdapterError::Translation(
            "auth profile provider mismatch".into(),
        ))
    }
}

fn anthropic_body(request: &NormalizedRequest) -> Result<Value, AdapterError> {
    anthropic_body_with_stream(request, true)
}

fn anthropic_body_with_stream(
    request: &NormalizedRequest,
    stream: bool,
) -> Result<Value, AdapterError> {
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for message in &request.messages {
        let mut content = Vec::new();
        for part in &message.parts {
            match part {
                changeloop_provider::InputPart::Text { text } => content.push(json!({"type":"text","text":text})),
                changeloop_provider::InputPart::Reasoning { text, replay } => {
                    if message.role != changeloop_provider::InputRole::Assistant {
                        return Err(AdapterError::Translation("reasoning replay must belong to assistant history".into()));
                    }
                    match replay {
                        Some(ReplayMetadata::Anthropic { reasoning_signature }) => content.push(json!({
                            "type":"thinking","thinking":text,"signature":reasoning_signature
                        })),
                        Some(ReplayMetadata::OpenAi { .. }) | None => {}
                    }
                }
                changeloop_provider::InputPart::ToolCall { id, name, arguments } =>
                    content.push(json!({"type":"tool_use","id":id,"name":name,"input":arguments})),
                changeloop_provider::InputPart::ToolResult { id, output, is_error } =>
                    content.push(json!({"type":"tool_result","tool_use_id":id,"content":output.to_string(),"is_error":is_error})),
                changeloop_provider::InputPart::Image { media_type, artifact_id, data_base64 } => {
                    let data = data_base64.as_ref().ok_or_else(|| AdapterError::Translation(
                        format!("image artifact {artifact_id} requires an explicit artifact resolver")))?;
                    content.push(json!({"type":"image","source":{
                        "type":"base64","media_type":media_type,"data":data
                    }}));
                }
            }
        }
        match message.role {
            changeloop_provider::InputRole::System | changeloop_provider::InputRole::Developer => {
                system.extend(content)
            }
            changeloop_provider::InputRole::User | changeloop_provider::InputRole::Tool => {
                messages.push(json!({"role":"user","content":content}))
            }
            changeloop_provider::InputRole::Assistant => {
                messages.push(json!({"role":"assistant","content":content}))
            }
        }
    }
    let tools: Vec<_> = request
        .tools
        .iter()
        .map(|tool| {
            json!({"name":tool.name,
        "description":tool.description,"input_schema":tool.input_schema})
        })
        .collect();
    Ok(
        json!({"model":request.model,"max_tokens":request.max_output_tokens.unwrap_or(4096),
        "system":system,"messages":messages,"tools":tools,"stream":stream}),
    )
}

fn openai_body(request: &NormalizedRequest) -> Result<Value, AdapterError> {
    openai_body_with_stream(request, true)
}

fn openai_body_with_stream(
    request: &NormalizedRequest,
    stream: bool,
) -> Result<Value, AdapterError> {
    let mut input = Vec::new();
    for message in &request.messages {
        let role = match message.role {
            changeloop_provider::InputRole::System => "system",
            changeloop_provider::InputRole::Developer => "developer",
            changeloop_provider::InputRole::User | changeloop_provider::InputRole::Tool => "user",
            changeloop_provider::InputRole::Assistant => "assistant",
        };
        for part in &message.parts {
            match part {
                changeloop_provider::InputPart::Text { text } => input.push(json!({"role":role,"content":[{
                    "type": if role == "assistant" { "output_text" } else { "input_text" },"text":text}]})),
                // OpenAI reasoning items are resumed using the response/item
                // identifiers below; never turn hidden reasoning into text.
                changeloop_provider::InputPart::Reasoning { .. } => {},
                changeloop_provider::InputPart::ToolCall { id, name, arguments } => input.push(json!({
                    "type":"function_call","call_id":id,"name":name,"arguments":arguments.to_string()})),
                changeloop_provider::InputPart::ToolResult { id, output, .. } => input.push(json!({
                    "type":"function_call_output","call_id":id,"output":output.to_string()})),
                changeloop_provider::InputPart::Image { media_type, artifact_id, data_base64 } => {
                    let data = data_base64.as_ref().ok_or_else(|| AdapterError::Translation(
                        format!("image artifact {artifact_id} requires an explicit artifact resolver")))?;
                    input.push(json!({"role":role,"content":[{
                        "type":"input_image",
                        "image_url":format!("data:{media_type};base64,{data}")
                    }]}));
                }
            }
        }
    }
    let tools: Vec<_> = request
        .tools
        .iter()
        .map(|tool| {
            json!({"type":"function","name":tool.name,
        "description":tool.description,"parameters":tool.input_schema,"strict":true})
        })
        .collect();
    let mut body =
        json!({"model":request.model,"input":input,"tools":tools,"stream":stream,"store":false});
    if let Some(limit) = request.max_output_tokens {
        body["max_output_tokens"] = json!(limit);
    }
    if let Some(ReplayMetadata::OpenAi { response_id, .. }) = request.replay.last() {
        body["previous_response_id"] = json!(response_id);
    }
    Ok(body)
}

fn parse_non_streaming_response(
    response: HttpResponse,
    provider: ProviderKind,
) -> Result<Vec<StreamEvent>, AdapterError> {
    if response.status >= 400 {
        return Err(map_http_error(provider, response));
    }
    let legacy_sse = response
        .headers
        .get("content-type")
        .is_some_and(|value| value.starts_with("text/event-stream"))
        || response.body.starts_with(b"data:")
        || response.body.starts_with(b"event:");
    let mut events = if legacy_sse {
        match provider {
            ProviderKind::Anthropic => parse_anthropic_sse(&response.body)?,
            ProviderKind::OpenAi => parse_openai_sse(&response.body)?,
        }
    } else {
        match provider {
            ProviderKind::Anthropic => parse_anthropic_response(&response.body)?,
            ProviderKind::OpenAi => parse_openai_response(&response.body)?,
        }
    };
    enrich_response_metadata(&mut events, &response.headers);
    Ok(events)
}

fn parse_native_json(body: &[u8]) -> Result<Value, AdapterError> {
    if body.len() > DEFAULT_MAX_RESPONSE_BYTES {
        return Err(AdapterError::MalformedResponse(format!(
            "provider response exceeds {DEFAULT_MAX_RESPONSE_BYTES} bytes"
        )));
    }
    serde_json::from_slice(body).map_err(|error| AdapterError::MalformedResponse(error.to_string()))
}

fn native_items<'a>(value: &'a Value, field: &str) -> Result<&'a [Value], AdapterError> {
    let items = value[field]
        .as_array()
        .ok_or_else(|| AdapterError::MalformedResponse(format!("provider {field} is missing")))?;
    if items.len() > MAX_NATIVE_OUTPUT_ITEMS {
        return Err(AdapterError::MalformedResponse(format!(
            "provider {field} exceeds {MAX_NATIVE_OUTPUT_ITEMS} items"
        )));
    }
    Ok(items)
}

fn replay_signature(value: Option<&str>) -> Result<Option<String>, AdapterError> {
    value
        .map(|signature| {
            if signature.is_empty()
                || signature.len() > MAX_REPLAY_METADATA_BYTES
                || signature.chars().any(char::is_control)
            {
                Err(AdapterError::MalformedResponse(
                    "provider reasoning signature is invalid".into(),
                ))
            } else {
                Ok(signature.to_owned())
            }
        })
        .transpose()
}

fn parse_anthropic_response(body: &[u8]) -> Result<Vec<StreamEvent>, AdapterError> {
    let value = parse_native_json(body)?;
    if value["type"] == "error" {
        return Err(AdapterError::Provider(stream_error(
            ProviderKind::Anthropic,
            &value,
        )));
    }
    if value["type"] != "message" || value["role"] != "assistant" {
        return Err(AdapterError::MalformedResponse(
            "anthropic response must be an assistant message".into(),
        ));
    }
    let response_id = provider_identifier(value["id"].as_str(), "response id")?;
    let mut events = Vec::new();
    let mut tool_ids = BTreeSet::new();
    for item in native_items(&value, "content")? {
        match item["type"].as_str().unwrap_or("") {
            "text" => events.push(StreamEvent::OutputDelta {
                text: item["text"]
                    .as_str()
                    .ok_or_else(|| {
                        AdapterError::MalformedResponse(
                            "anthropic text content is missing text".into(),
                        )
                    })?
                    .into(),
            }),
            "thinking" => {
                let signature = replay_signature(item["signature"].as_str())?;
                events.push(StreamEvent::ReasoningDelta {
                    text: item["thinking"]
                        .as_str()
                        .ok_or_else(|| {
                            AdapterError::MalformedResponse(
                                "anthropic thinking content is missing text".into(),
                            )
                        })?
                        .into(),
                    replay: signature.map(|reasoning_signature| ReplayMetadata::Anthropic {
                        reasoning_signature,
                    }),
                });
            }
            "redacted_thinking" => events.push(StreamEvent::ReasoningDelta {
                text: String::new(),
                replay: None,
            }),
            "tool_use" => {
                let id = provider_identifier(item["id"].as_str(), "tool call id")?;
                let name = provider_identifier(item["name"].as_str(), "tool name")?;
                if !tool_ids.insert(id.clone()) {
                    return Err(AdapterError::MalformedResponse(
                        "provider duplicated a tool call id".into(),
                    ));
                }
                let arguments = item.get("input").cloned().ok_or_else(|| {
                    AdapterError::MalformedResponse("tool input is missing".into())
                })?;
                let json_fragment = serde_json::to_string(&arguments)
                    .map_err(|error| AdapterError::MalformedResponse(error.to_string()))?;
                if json_fragment.len() > MAX_TOOL_ARGUMENT_BYTES {
                    return Err(AdapterError::MalformedResponse(format!(
                        "provider tool arguments exceed {MAX_TOOL_ARGUMENT_BYTES} bytes"
                    )));
                }
                events.push(StreamEvent::ToolCallStarted {
                    id: id.clone(),
                    name,
                });
                events.push(StreamEvent::ToolArgumentsDelta {
                    id: id.clone(),
                    json_fragment,
                });
                events.push(StreamEvent::ToolCallCompleted { id, arguments });
            }
            other => {
                return Err(AdapterError::MalformedResponse(format!(
                    "unsupported anthropic content item type {other:?}"
                )));
            }
        }
    }
    if let Some(usage) = value.get("usage") {
        events.push(StreamEvent::Usage {
            accounting: Box::new(usage_accounting(response_id.clone(), usage)),
        });
    }
    events.push(StreamEvent::Completed {
        response_id,
        finish_reason: finish_reason(value["stop_reason"].as_str()),
    });
    Ok(events)
}

fn parse_openai_response(body: &[u8]) -> Result<Vec<StreamEvent>, AdapterError> {
    let value = parse_native_json(body)?;
    if value["status"] == "failed" || value["type"] == "error" {
        return Err(AdapterError::Provider(stream_error(
            ProviderKind::OpenAi,
            value.get("error").unwrap_or(&value),
        )));
    }
    let response_id = provider_identifier(value["id"].as_str(), "response id")?;
    let status = value["status"].as_str().unwrap_or("");
    if !matches!(status, "completed" | "incomplete") {
        return Err(AdapterError::MalformedResponse(format!(
            "unsupported openai response status {status:?}"
        )));
    }
    let mut events = Vec::new();
    let mut reasoning_item_ids = Vec::new();
    let mut tool_call_ids = BTreeSet::new();
    let mut saw_tool = false;
    for item in native_items(&value, "output")? {
        match item["type"].as_str().unwrap_or("") {
            "message" => {
                if item["role"] != "assistant" {
                    return Err(AdapterError::MalformedResponse(
                        "openai output message must use the assistant role".into(),
                    ));
                }
                for content in native_items(item, "content")? {
                    match content["type"].as_str().unwrap_or("") {
                        "output_text" => events.push(StreamEvent::OutputDelta {
                            text: content["text"]
                                .as_str()
                                .ok_or_else(|| {
                                    AdapterError::MalformedResponse(
                                        "openai output_text content is missing text".into(),
                                    )
                                })?
                                .into(),
                        }),
                        "refusal" => events.push(StreamEvent::OutputDelta {
                            text: content["refusal"]
                                .as_str()
                                .ok_or_else(|| {
                                    AdapterError::MalformedResponse(
                                        "openai refusal content is missing text".into(),
                                    )
                                })?
                                .into(),
                        }),
                        other => {
                            return Err(AdapterError::MalformedResponse(format!(
                                "unsupported openai message content type {other:?}"
                            )));
                        }
                    }
                }
            }
            "reasoning" => {
                let id = provider_identifier(item["id"].as_str(), "reasoning item id")?;
                if reasoning_item_ids.len() >= MAX_REASONING_ITEM_IDS
                    || reasoning_item_ids.contains(&id)
                {
                    return Err(AdapterError::MalformedResponse(
                        "provider duplicated or exceeded reasoning item IDs".into(),
                    ));
                }
                reasoning_item_ids.push(id);
                if let Some(summary) = item["summary"].as_array() {
                    for part in summary {
                        if part["type"] != "summary_text" {
                            return Err(AdapterError::MalformedResponse(
                                "unsupported openai reasoning summary type".into(),
                            ));
                        }
                        events.push(StreamEvent::ReasoningDelta {
                            text: part["text"]
                                .as_str()
                                .ok_or_else(|| {
                                    AdapterError::MalformedResponse(
                                        "openai reasoning summary is missing text".into(),
                                    )
                                })?
                                .into(),
                            replay: None,
                        });
                    }
                }
            }
            "function_call" => {
                saw_tool = true;
                let id = provider_identifier(
                    item["call_id"].as_str().or_else(|| item["id"].as_str()),
                    "tool call id",
                )?;
                let name = provider_identifier(item["name"].as_str(), "tool name")?;
                if !tool_call_ids.insert(id.clone()) {
                    return Err(AdapterError::MalformedResponse(
                        "provider duplicated a tool call id".into(),
                    ));
                }
                let raw_arguments = item["arguments"].as_str().ok_or_else(|| {
                    AdapterError::MalformedResponse("openai tool call is missing arguments".into())
                })?;
                if raw_arguments.len() > MAX_TOOL_ARGUMENT_BYTES {
                    return Err(AdapterError::MalformedResponse(format!(
                        "provider tool arguments exceed {MAX_TOOL_ARGUMENT_BYTES} bytes"
                    )));
                }
                let arguments = serde_json::from_str(raw_arguments)
                    .map_err(|error| AdapterError::MalformedResponse(error.to_string()))?;
                events.push(StreamEvent::ToolCallStarted {
                    id: id.clone(),
                    name,
                });
                events.push(StreamEvent::ToolArgumentsDelta {
                    id: id.clone(),
                    json_fragment: raw_arguments.into(),
                });
                events.push(StreamEvent::ToolCallCompleted { id, arguments });
            }
            other => {
                return Err(AdapterError::MalformedResponse(format!(
                    "unsupported openai output item type {other:?}"
                )));
            }
        }
    }
    if !reasoning_item_ids.is_empty() {
        events.push(StreamEvent::ReasoningDelta {
            text: String::new(),
            replay: Some(ReplayMetadata::OpenAi {
                response_id: response_id.clone(),
                reasoning_item_ids,
            }),
        });
    }
    if let Some(usage) = value.get("usage") {
        events.push(StreamEvent::Usage {
            accounting: Box::new(usage_accounting(response_id.clone(), usage)),
        });
    }
    let finish_reason = match status {
        "completed" if saw_tool => FinishReason::ToolCalls,
        "completed" => FinishReason::Stop,
        "incomplete" => match value["incomplete_details"]["reason"].as_str().unwrap_or("") {
            "max_output_tokens" => FinishReason::Length,
            "content_filter" => FinishReason::ContentFilter,
            _ => FinishReason::Unknown,
        },
        _ => FinishReason::Unknown,
    };
    events.push(StreamEvent::Completed {
        response_id,
        finish_reason,
    });
    Ok(events)
}

#[derive(Debug)]
struct SseFrame {
    event: Option<String>,
    data: String,
}

fn parse_sse(body: &[u8]) -> Result<Vec<SseFrame>, AdapterError> {
    let text = std::str::from_utf8(body)
        .map_err(|error| AdapterError::MalformedStream(error.to_string()))?;
    let mut frames = Vec::new();
    let mut event = None;
    let mut data: Vec<String> = Vec::new();
    for line in text
        .replace("\r\n", "\n")
        .lines()
        .chain(std::iter::once(""))
    {
        if line.is_empty() {
            if !data.is_empty() {
                frames.push(SseFrame {
                    event: event.take(),
                    data: data.join("\n"),
                });
                data.clear();
            }
        } else if let Some(value) = line.strip_prefix("event:") {
            event = Some(value.trim().into());
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push(value.trim_start().into());
        }
    }
    Ok(frames)
}

fn provider_identifier(value: Option<&str>, field: &str) -> Result<String, AdapterError> {
    value
        .filter(|value| valid_provider_identifier(value))
        .map(str::to_owned)
        .ok_or_else(|| AdapterError::MalformedStream(format!("provider {field} is invalid")))
}

struct AnthropicSseState {
    response_id: String,
    tools: HashMap<u64, (String, String, String)>,
    tool_ids: BTreeSet<String>,
    tool_argument_bytes: usize,
    stop: FinishReason,
}

impl Default for AnthropicSseState {
    fn default() -> Self {
        Self {
            response_id: String::new(),
            tools: HashMap::new(),
            tool_ids: BTreeSet::new(),
            tool_argument_bytes: 0,
            stop: FinishReason::Unknown,
        }
    }
}

impl AnthropicSseState {
    fn finish(&self) -> Result<(), AdapterError> {
        if self.tools.is_empty() {
            Ok(())
        } else {
            Err(AdapterError::MalformedStream(
                "anthropic stream ended with an interrupted tool call".into(),
            ))
        }
    }
}

fn parse_anthropic_sse(body: &[u8]) -> Result<Vec<StreamEvent>, AdapterError> {
    let mut state = AnthropicSseState::default();
    let output = parse_anthropic_sse_incremental(body, &mut state)?;
    state.finish()?;
    Ok(output)
}

fn parse_anthropic_sse_incremental(
    body: &[u8],
    state: &mut AnthropicSseState,
) -> Result<Vec<StreamEvent>, AdapterError> {
    let mut output = Vec::new();
    for frame in parse_sse(body)? {
        let value: Value = serde_json::from_str(&frame.data)
            .map_err(|error| AdapterError::MalformedStream(error.to_string()))?;
        let kind = value["type"]
            .as_str()
            .or(frame.event.as_deref())
            .unwrap_or("");
        match kind {
            "message_start" => {
                state.response_id = value["message"]["id"].as_str().unwrap_or_default().into();
                if let Some(usage) = value["message"].get("usage") {
                    output.push(StreamEvent::Usage {
                        accounting: Box::new(usage_accounting(state.response_id.clone(), usage)),
                    });
                }
            }
            "content_block_start" if value["content_block"]["type"] == "tool_use" => {
                let index = value["index"].as_u64().unwrap_or(0);
                let id =
                    provider_identifier(value["content_block"]["id"].as_str(), "tool call id")?;
                let name =
                    provider_identifier(value["content_block"]["name"].as_str(), "tool name")?;
                if state.tools.contains_key(&index) || !state.tool_ids.insert(id.clone()) {
                    return Err(AdapterError::MalformedStream(
                        "provider duplicated a tool call id or index".into(),
                    ));
                }
                if state.tools.len() >= MAX_ACTIVE_TOOL_CALLS {
                    return Err(AdapterError::MalformedStream(format!(
                        "provider exceeded {MAX_ACTIVE_TOOL_CALLS} active tool calls"
                    )));
                }
                state
                    .tools
                    .insert(index, (id.clone(), name.clone(), String::new()));
                output.push(StreamEvent::ToolCallStarted { id, name });
            }
            "content_block_delta" => match value["delta"]["type"].as_str().unwrap_or("") {
                "text_delta" => output.push(StreamEvent::OutputDelta {
                    text: value["delta"]["text"].as_str().unwrap_or_default().into(),
                }),
                "thinking_delta" => output.push(StreamEvent::ReasoningDelta {
                    text: value["delta"]["thinking"]
                        .as_str()
                        .unwrap_or_default()
                        .into(),
                    replay: None,
                }),
                "signature_delta" => output.push(StreamEvent::ReasoningDelta {
                    text: String::new(),
                    replay: Some(ReplayMetadata::Anthropic {
                        reasoning_signature: value["delta"]["signature"]
                            .as_str()
                            .unwrap_or_default()
                            .into(),
                    }),
                }),
                "input_json_delta" => {
                    let index = value["index"].as_u64().unwrap_or(0);
                    let (id, _, arguments) = state.tools.get_mut(&index).ok_or_else(|| {
                        AdapterError::MalformedStream(
                            "tool arguments arrived before tool start".into(),
                        )
                    })?;
                    let fragment = value["delta"]["partial_json"].as_str().unwrap_or_default();
                    state.tool_argument_bytes = state
                        .tool_argument_bytes
                        .checked_add(fragment.len())
                        .filter(|bytes| *bytes <= MAX_TOOL_ARGUMENT_BYTES)
                        .ok_or_else(|| {
                            AdapterError::MalformedStream(format!(
                                "provider tool arguments exceed {MAX_TOOL_ARGUMENT_BYTES} bytes"
                            ))
                        })?;
                    arguments.push_str(fragment);
                    output.push(StreamEvent::ToolArgumentsDelta {
                        id: id.clone(),
                        json_fragment: fragment.into(),
                    });
                }
                _ => {}
            },
            "content_block_stop" => {
                let index = value["index"].as_u64().unwrap_or(0);
                let (id, _, arguments) = state.tools.remove(&index).ok_or_else(|| {
                    AdapterError::MalformedStream("tool stop arrived before tool start".into())
                })?;
                state.tool_argument_bytes =
                    state.tool_argument_bytes.saturating_sub(arguments.len());
                let arguments = serde_json::from_str(&arguments)
                    .map_err(|error| AdapterError::MalformedStream(error.to_string()))?;
                output.push(StreamEvent::ToolCallCompleted { id, arguments });
            }
            "message_delta" => {
                state.stop = finish_reason(value["delta"]["stop_reason"].as_str());
                if let Some(usage) = value.get("usage") {
                    output.push(StreamEvent::Usage {
                        accounting: Box::new(usage_accounting(state.response_id.clone(), usage)),
                    });
                }
            }
            "message_stop" => output.push(StreamEvent::Completed {
                response_id: state.response_id.clone(),
                finish_reason: state.stop,
            }),
            "error" => {
                let error = stream_error(ProviderKind::Anthropic, &value);
                if output.is_empty() {
                    return Err(AdapterError::Provider(error));
                }
                output.push(StreamEvent::Error { error });
                break;
            }
            _ => {}
        }
    }
    Ok(output)
}

#[derive(Default)]
struct OpenAiSseState {
    reasoning_item_ids: Vec<String>,
    tools: HashMap<String, String>,
    tool_call_ids: BTreeSet<String>,
}

impl OpenAiSseState {
    fn finish(&self) -> Result<(), AdapterError> {
        if self.tools.is_empty() {
            Ok(())
        } else {
            Err(AdapterError::MalformedStream(
                "openai stream ended with an interrupted tool call".into(),
            ))
        }
    }
}

fn parse_openai_sse(body: &[u8]) -> Result<Vec<StreamEvent>, AdapterError> {
    let mut state = OpenAiSseState::default();
    let output = parse_openai_sse_incremental(body, &mut state)?;
    state.finish()?;
    Ok(output)
}

fn parse_openai_sse_incremental(
    body: &[u8],
    state: &mut OpenAiSseState,
) -> Result<Vec<StreamEvent>, AdapterError> {
    let mut output = Vec::new();
    for frame in parse_sse(body)? {
        if frame.data == "[DONE]" {
            continue;
        }
        let value: Value = serde_json::from_str(&frame.data)
            .map_err(|error| AdapterError::MalformedStream(error.to_string()))?;
        match value["type"]
            .as_str()
            .or(frame.event.as_deref())
            .unwrap_or("")
        {
            "response.output_text.delta" => output.push(StreamEvent::OutputDelta {
                text: value["delta"].as_str().unwrap_or_default().into(),
            }),
            "response.reasoning_text.delta" => output.push(StreamEvent::ReasoningDelta {
                text: value["delta"].as_str().unwrap_or_default().into(),
                replay: None,
            }),
            "response.output_item.added" if value["item"]["type"] == "reasoning" => {
                if let Some(id) = value["item"]["id"].as_str() {
                    let id = provider_identifier(Some(id), "reasoning item id")?;
                    if state.reasoning_item_ids.len() >= MAX_REASONING_ITEM_IDS {
                        return Err(AdapterError::MalformedStream(format!(
                            "provider exceeded {MAX_REASONING_ITEM_IDS} reasoning item IDs"
                        )));
                    }
                    if state.reasoning_item_ids.contains(&id) {
                        return Err(AdapterError::MalformedStream(
                            "provider duplicated a reasoning item id".into(),
                        ));
                    }
                    state.reasoning_item_ids.push(id);
                }
            }
            "response.output_item.added" if value["item"]["type"] == "function_call" => {
                let item_id = provider_identifier(value["item"]["id"].as_str(), "tool item id")?;
                let id = provider_identifier(
                    value["item"]["call_id"]
                        .as_str()
                        .or_else(|| value["item"]["id"].as_str()),
                    "tool call id",
                )?;
                let name = provider_identifier(value["item"]["name"].as_str(), "tool name")?;
                if state.tools.len() >= MAX_ACTIVE_TOOL_CALLS {
                    return Err(AdapterError::MalformedStream(format!(
                        "provider exceeded {MAX_ACTIVE_TOOL_CALLS} active tool calls"
                    )));
                }
                if state.tools.contains_key(&item_id) || !state.tool_call_ids.insert(id.clone()) {
                    return Err(AdapterError::MalformedStream(
                        "provider duplicated a tool item or call id".into(),
                    ));
                }
                state.tools.insert(item_id, id.clone());
                output.push(StreamEvent::ToolCallStarted { id, name });
            }
            "response.function_call_arguments.delta" => {
                let item_id = provider_identifier(value["item_id"].as_str(), "tool item id")?;
                let id = state.tools.get(&item_id).cloned().ok_or_else(|| {
                    AdapterError::MalformedStream("tool arguments arrived before tool start".into())
                })?;
                output.push(StreamEvent::ToolArgumentsDelta {
                    id,
                    json_fragment: value["delta"].as_str().unwrap_or_default().into(),
                })
            }
            "response.function_call_arguments.done" => {
                let item_id = provider_identifier(value["item_id"].as_str(), "tool item id")?;
                let id = state.tools.remove(&item_id).ok_or_else(|| {
                    AdapterError::MalformedStream(
                        "tool completion arrived before tool start".into(),
                    )
                })?;
                state.tool_call_ids.remove(&id);
                let arguments =
                    serde_json::from_str(value["arguments"].as_str().unwrap_or("{}"))
                        .map_err(|error| AdapterError::MalformedStream(error.to_string()))?;
                output.push(StreamEvent::ToolCallCompleted { id, arguments });
            }
            "response.completed" => {
                let response = &value["response"];
                let response_id = response["id"].as_str().unwrap_or_default().to_owned();
                if !state.reasoning_item_ids.is_empty() {
                    output.push(StreamEvent::ReasoningDelta {
                        text: String::new(),
                        replay: Some(ReplayMetadata::OpenAi {
                            response_id: response_id.clone(),
                            reasoning_item_ids: state.reasoning_item_ids.clone(),
                        }),
                    });
                }
                if let Some(usage) = response.get("usage") {
                    output.push(StreamEvent::Usage {
                        accounting: Box::new(usage_accounting(response_id.clone(), usage)),
                    });
                }
                output.push(StreamEvent::Completed {
                    response_id,
                    finish_reason: FinishReason::Stop,
                });
            }
            "response.incomplete" => output.push(StreamEvent::Completed {
                response_id: value["response"]["id"].as_str().unwrap_or_default().into(),
                finish_reason: FinishReason::Length,
            }),
            "error" | "response.failed" => {
                let error = stream_error(ProviderKind::OpenAi, &value);
                if output.is_empty() {
                    return Err(AdapterError::Provider(error));
                }
                output.push(StreamEvent::Error { error });
                break;
            }
            _ => {}
        }
    }
    Ok(output)
}

fn usage_accounting(request_id: String, usage: &Value) -> UsageAccounting {
    let known = |name: &str| {
        usage[name]
            .as_u64()
            .map(Measurement::Known)
            .unwrap_or_else(|| Measurement::Unknown {
                reason: format!("{name} omitted"),
            })
    };
    let cache_read = usage["cache_read_input_tokens"]
        .as_u64()
        .or_else(|| usage["input_tokens_details"]["cached_tokens"].as_u64())
        .map(Measurement::Known)
        .unwrap_or_else(|| Measurement::Unknown {
            reason: "cache usage omitted".into(),
        });
    let reasoning = usage["output_tokens_details"]["reasoning_tokens"]
        .as_u64()
        .map(Measurement::Known)
        .unwrap_or_else(|| Measurement::Unknown {
            reason: "reasoning usage omitted".into(),
        });
    UsageAccounting {
        pricing_catalog_version: "unpriced".into(),
        pricing_source: "provider_usage_only".into(),
        provider_request_id: if request_id.is_empty() {
            Measurement::Unknown {
                reason: "request ID omitted".into(),
            }
        } else {
            Measurement::Known(request_id)
        },
        tokens: TokenUsage {
            input: known("input_tokens"),
            output: known("output_tokens"),
            cache_read,
            cache_write: usage["cache_creation_input_tokens"]
                .as_u64()
                .map(Measurement::Known)
                .unwrap_or_else(|| Measurement::Unknown {
                    reason: "cache write usage omitted".into(),
                }),
            reasoning,
        },
        estimated_cost: Measurement::<MoneyMicros>::Unknown {
            reason: "pricing catalog not injected".into(),
        },
        provider_reported_cost: Measurement::<MoneyMicros>::Unknown {
            reason: "provider did not report cost".into(),
        },
        quota_remaining: Measurement::Unknown {
            reason: "quota header not persisted in stream".into(),
        },
        quota_reset_at_ms: Measurement::Unknown {
            reason: "quota reset header not persisted in stream".into(),
        },
    }
}

fn enrich_response_metadata(events: &mut [StreamEvent], headers: &BTreeMap<String, String>) {
    let header = |names: &[&str]| names.iter().find_map(|name| headers.get(*name));
    let request_id = header(&["x-request-id", "request-id", "anthropic-request-id"]).cloned();
    let quota = header(&[
        "x-ratelimit-remaining-tokens",
        "x-ratelimit-remaining-requests",
    ])
    .and_then(|value| value.parse::<u64>().ok());
    let reset = header(&[
        "x-ratelimit-reset-tokens-ms",
        "x-ratelimit-reset-requests-ms",
    ])
    .and_then(|value| value.parse::<u64>().ok());
    for event in events {
        if let StreamEvent::Usage { accounting } = event {
            if let Some(request_id) = &request_id {
                accounting.provider_request_id = Measurement::Known(request_id.clone());
            }
            if let Some(quota) = quota {
                accounting.quota_remaining = Measurement::Known(quota);
            }
            if let Some(reset) = reset {
                accounting.quota_reset_at_ms = Measurement::Known(reset);
            }
        }
    }
}

fn finish_reason(value: Option<&str>) -> FinishReason {
    match value.unwrap_or("") {
        "end_turn" | "stop_sequence" | "stop" => FinishReason::Stop,
        "max_tokens" | "length" => FinishReason::Length,
        "tool_use" | "tool_calls" => FinishReason::ToolCalls,
        _ => FinishReason::Unknown,
    }
}

fn map_http_error(provider: ProviderKind, response: HttpResponse) -> AdapterError {
    let body: Value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
    let error = body.get("error").unwrap_or(&body);
    let code = error["type"]
        .as_str()
        .or_else(|| error["code"].as_str())
        .map(str::to_owned);
    let category = match response.status {
        401 => ErrorCategory::Authentication,
        403 => ErrorCategory::Permission,
        408 => ErrorCategory::Transport,
        429 => ErrorCategory::RateLimit,
        400 if code.as_deref().is_some_and(|code| code.contains("context")) => {
            ErrorCategory::ContextLimit
        }
        400..=499 => ErrorCategory::InvalidRequest,
        529 => ErrorCategory::ModelUnavailable,
        500..=599 => ErrorCategory::Server,
        _ => ErrorCategory::Unknown,
    };
    let retryable = matches!(
        category,
        ErrorCategory::RateLimit
            | ErrorCategory::Server
            | ErrorCategory::Transport
            | ErrorCategory::ModelUnavailable
    );
    let retry_after_ms = response
        .headers
        .get("retry-after-ms")
        .and_then(|v| v.parse().ok())
        .or_else(|| {
            response
                .headers
                .get("retry-after")
                .and_then(|v| v.parse::<u64>().ok())
                .map(|v| v.saturating_mul(1000))
        });
    AdapterError::Provider(ProviderError {
        provider,
        category,
        code,
        message: error["message"]
            .as_str()
            .unwrap_or("provider request failed")
            .into(),
        retryable,
        provider_request_id: response
            .headers
            .get("request-id")
            .or_else(|| response.headers.get("x-request-id"))
            .cloned(),
        http_status: Some(response.status),
        retry_after_ms,
    })
}

fn stream_error(provider: ProviderKind, value: &Value) -> ProviderError {
    let error = value.get("error").unwrap_or(value);
    let code = error["type"]
        .as_str()
        .or_else(|| error["code"].as_str())
        .map(str::to_owned);
    let overloaded = code
        .as_deref()
        .is_some_and(|value| value.contains("overload"));
    ProviderError {
        provider,
        category: if overloaded {
            ErrorCategory::Server
        } else {
            ErrorCategory::Unknown
        },
        code,
        message: error["message"]
            .as_str()
            .unwrap_or("provider stream error")
            .into(),
        retryable: overloaded,
        provider_request_id: None,
        http_status: None,
        retry_after_ms: None,
    }
}

pub async fn execute_with_retry(
    adapter: &dyn ProviderAdapter,
    request: &NormalizedRequest,
    auth: &AuthProfile,
    transport: &dyn HttpTransport,
    cancel: &CancellationToken,
    policy: RetryPolicy,
) -> Result<Vec<StreamEvent>, AdapterError> {
    let mut attempt = 1;
    loop {
        if cancel.is_cancelled() {
            return Err(AdapterError::Transport(TransportError::Cancelled));
        }
        match adapter.execute_once(request, auth, transport, cancel).await {
            Ok(events) => return Ok(events),
            Err(error) => match policy.decide(attempt, &error.provider_error(adapter.kind())) {
                RetryDecision::Stop => return Err(error),
                RetryDecision::RetryAfter { delay_ms } => {
                    tokio::select! {
                        () = tokio::time::sleep(Duration::from_millis(delay_ms)) => {},
                        () = cancel.cancelled() => {
                            return Err(AdapterError::Transport(TransportError::Cancelled));
                        }
                    }
                    attempt += 1;
                }
            },
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn execute_with_safe_fallback(
    primary: &dyn ProviderAdapter,
    primary_auth: &AuthProfile,
    fallback: &dyn ProviderAdapter,
    fallback_auth: &AuthProfile,
    fallback_route: &RouteCandidate,
    request: &NormalizedRequest,
    transport: &dyn HttpTransport,
    cancel: &CancellationToken,
    progress: ExecutionProgress,
    required_risk: RiskTier,
    required_capabilities: &BTreeSet<Capability>,
) -> Result<Vec<StreamEvent>, AdapterError> {
    match primary
        .execute_once(request, primary_auth, transport, cancel)
        .await
    {
        Ok(events) => Ok(events),
        Err(primary_error) => {
            authorize_fallback(
                progress,
                fallback_route,
                required_risk,
                required_capabilities,
            )
            .map_err(|error| AdapterError::Translation(error.to_string()))?;
            match fallback
                .execute_once(request, fallback_auth, transport, cancel)
                .await
            {
                Ok(events) => Ok(events),
                Err(_) => Err(primary_error),
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelPrice {
    pub input_micros_per_million: u64,
    pub output_micros_per_million: u64,
    pub currency: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PricingCatalog {
    pub version: String,
    pub source: String,
    pub prices: BTreeMap<(ProviderKind, String), ModelPrice>,
}

impl Default for PricingCatalog {
    fn default() -> Self {
        Self {
            version: "unpriced".into(),
            source: "no pricing catalog configured".into(),
            prices: BTreeMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct RouterRoute {
    pub candidate: RouteCandidate,
    pub adapter: Arc<dyn ProviderAdapter>,
    pub auth: AuthProfile,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RouterOutcome {
    pub provider: ProviderKind,
    pub model: String,
    pub attempts: u32,
    pub events: Vec<StreamEvent>,
}

#[derive(Debug, Error)]
pub enum RouterError {
    #[error("no provider route meets the required risk tier and capabilities")]
    NoEligibleRoute,
    #[error("all eligible provider circuits are open")]
    CircuitsOpen,
    #[error("provider route failed: {0}")]
    Provider(#[from] AdapterError),
    #[error("usage ledger failed: {0}")]
    Ledger(String),
    #[error("stream consumer failed: {0}")]
    Consumer(String),
}

/// Policy-enforcing provider router. Route order may encode an operator's
/// quality/cost preference, but the deterministic eligibility gate always runs
/// first and therefore cost can never lower the required assurance tier.
pub struct ProviderRouter {
    routes: Vec<RouterRoute>,
    transport: Arc<dyn HttpTransport>,
    retry: RetryPolicy,
    breaker_policy: CircuitBreakerPolicy,
    breakers: Mutex<BTreeMap<(ProviderKind, String), CircuitBreaker>>,
    pricing: PricingCatalog,
    ledger: Mutex<UsageLedger>,
    ledger_path: Option<std::path::PathBuf>,
}

impl ProviderRouter {
    #[must_use]
    pub fn new(
        routes: Vec<RouterRoute>,
        transport: Arc<dyn HttpTransport>,
        pricing: PricingCatalog,
    ) -> Self {
        Self {
            routes,
            transport,
            retry: RetryPolicy {
                max_attempts: 3,
                base_delay_ms: 100,
                max_delay_ms: 5_000,
            },
            breaker_policy: CircuitBreakerPolicy {
                failure_threshold: 3,
                cooldown_ms: 30_000,
            },
            breakers: Mutex::new(BTreeMap::new()),
            pricing,
            ledger: Mutex::new(UsageLedger::default()),
            ledger_path: None,
        }
    }

    #[must_use]
    pub fn with_policies(
        mut self,
        retry: RetryPolicy,
        breaker_policy: CircuitBreakerPolicy,
    ) -> Self {
        self.retry = retry;
        self.breaker_policy = breaker_policy;
        self
    }

    /// Loads an existing ledger when present and atomically replaces it after
    /// each completed provider request.
    pub fn with_durable_ledger(
        mut self,
        path: impl Into<std::path::PathBuf>,
    ) -> Result<Self, RouterError> {
        let path = path.into();
        if path.exists() {
            let file = open_ledger_read(&path)?;
            validate_ledger_metadata(
                &file
                    .metadata()
                    .map_err(|error| RouterError::Ledger(error.to_string()))?,
            )?;
            let mut bytes = Vec::new();
            file.take(MAX_USAGE_LEDGER_BYTES.saturating_add(1))
                .read_to_end(&mut bytes)
                .map_err(|error| RouterError::Ledger(error.to_string()))?;
            if bytes.len() as u64 > MAX_USAGE_LEDGER_BYTES {
                return Err(RouterError::Ledger(format!(
                    "usage ledger exceeds {MAX_USAGE_LEDGER_BYTES} bytes"
                )));
            }
            let ledger: UsageLedger = serde_json::from_slice(&bytes)
                .map_err(|error| RouterError::Ledger(error.to_string()))?;
            ledger
                .validate()
                .map_err(|error| RouterError::Ledger(error.to_string()))?;
            *self
                .ledger
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = ledger;
        }
        self.ledger_path = Some(path);
        Ok(self)
    }

    #[must_use]
    pub fn catalog(&self) -> ModelCatalog {
        let mut catalog = ModelCatalog::default();
        for route in &self.routes {
            let profile = route.adapter.capability_profile();
            catalog.insert(ModelDescriptor {
                id: route.candidate.model.clone(),
                provider: route.candidate.provider,
                status: ModelStatus::Active,
                capabilities: route.candidate.capabilities.clone(),
                max_input_tokens: profile.max_input_tokens,
                max_output_tokens: profile.max_output_tokens,
                risk_tier: route.candidate.risk_tier,
            });
        }
        catalog
    }

    #[must_use]
    pub fn ledger(&self) -> UsageLedger {
        self.ledger
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub async fn execute(
        &self,
        request: &NormalizedRequest,
        requirements: &RouteRequirements,
        progress: ExecutionProgress,
        cancel: &CancellationToken,
    ) -> Result<RouterOutcome, RouterError> {
        self.execute_incremental(request, requirements, progress, cancel, |_| Ok(()))
            .await
    }

    /// Route and deliver each normalized event as it arrives. Events are also
    /// retained in the returned outcome for replay compatibility.
    pub async fn execute_incremental<F>(
        &self,
        request: &NormalizedRequest,
        requirements: &RouteRequirements,
        progress: ExecutionProgress,
        cancel: &CancellationToken,
        mut on_event: F,
    ) -> Result<RouterOutcome, RouterError>
    where
        F: FnMut(StreamEvent) -> Result<(), String>,
    {
        let output_tokens = request.max_output_tokens.unwrap_or(16_384);
        let max_stream_events = usize::try_from(output_tokens.saturating_mul(4))
            .unwrap_or(65_536)
            .clamp(1_024, 65_536);
        let max_stream_bytes = usize::try_from(output_tokens.saturating_mul(8))
            .unwrap_or(DEFAULT_MAX_RESPONSE_BYTES)
            .clamp(64 * 1024, DEFAULT_MAX_RESPONSE_BYTES);
        let candidates = self
            .routes
            .iter()
            .map(|route| route.candidate.clone())
            .collect::<Vec<_>>();
        select_route(&candidates, requirements).map_err(|_| RouterError::NoEligibleRoute)?;

        let eligible = self.routes.iter().filter(|route| {
            route.candidate.risk_tier >= requirements.risk_tier
                && requirements
                    .capabilities
                    .is_subset(&route.candidate.capabilities)
        });
        let mut last_error = None;
        let mut saw_closed_route = false;
        for (route_index, route) in eligible.enumerate() {
            if route_index > 0 {
                authorize_fallback(
                    progress,
                    &route.candidate,
                    requirements.risk_tier,
                    &requirements.capabilities,
                )
                .map_err(|error| {
                    RouterError::Provider(AdapterError::Translation(error.to_string()))
                })?;
            }
            let key = (route.candidate.provider, route.candidate.model.clone());
            let now = unix_ms();
            if self
                .breakers
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .entry(key.clone())
                .or_default()
                .before_request(now, self.breaker_policy)
                == CircuitDecision::RejectOpen
            {
                continue;
            }
            saw_closed_route = true;
            let mut routed_request = request.clone();
            routed_request.model.clone_from(&route.candidate.model);
            let mut attempt = 1;
            loop {
                if cancel.is_cancelled() {
                    return Err(RouterError::Provider(AdapterError::Transport(
                        TransportError::Cancelled,
                    )));
                }
                let streamed = match route
                    .adapter
                    .execute_stream(
                        &routed_request,
                        &route.auth,
                        self.transport.as_ref(),
                        cancel,
                    )
                    .await
                {
                    Ok(mut stream) => {
                        let mut events = Vec::new();
                        let mut received_events = 0usize;
                        let mut received_bytes = 0usize;
                        let mut committed = false;
                        let mut terminal = None;
                        let mut stream_error = None;
                        while let Some(item) = stream.next().await {
                            match item {
                                Ok(mut event) => {
                                    let event_bytes = serde_json::to_vec(&event)
                                        .map(|encoded| encoded.len())
                                        .unwrap_or(max_stream_bytes.saturating_add(1));
                                    if received_events >= max_stream_events
                                        || received_bytes
                                            .checked_add(event_bytes)
                                            .is_none_or(|size| size > max_stream_bytes)
                                    {
                                        let error = AdapterError::MalformedStream(format!(
                                            "provider stream exceeded bounded router assembly ({max_stream_events} events/{max_stream_bytes} bytes)"
                                        ));
                                        if committed {
                                            let event = StreamEvent::Error {
                                                error: error
                                                    .provider_error(route.candidate.provider),
                                            };
                                            terminal = Some(event.clone());
                                            events.push(event);
                                        } else {
                                            stream_error = Some(error);
                                        }
                                        break;
                                    }
                                    received_events = received_events.saturating_add(1);
                                    received_bytes = received_bytes.saturating_add(event_bytes);
                                    if let StreamEvent::Usage { accounting } = &mut event {
                                        price_accounting(
                                            accounting,
                                            route.candidate.provider,
                                            &route.candidate.model,
                                            &self.pricing,
                                        );
                                    }
                                    committed = true;
                                    if matches!(event, StreamEvent::Completed { .. }) {
                                        terminal = Some(event.clone());
                                    } else {
                                        on_event(event.clone()).map_err(RouterError::Consumer)?;
                                    }
                                    events.push(event);
                                }
                                Err(error) if !committed => {
                                    stream_error = Some(error);
                                    break;
                                }
                                Err(error) => {
                                    let event = StreamEvent::Error {
                                        error: error.provider_error(route.candidate.provider),
                                    };
                                    // Hold the terminal error until synthetic
                                    // unknown-usage accounting is normalized,
                                    // so consumers never observe Usage after a
                                    // terminal event.
                                    terminal = Some(event.clone());
                                    events.push(event);
                                    break;
                                }
                            }
                        }
                        match stream_error {
                            Some(error) => Err(error),
                            None => Ok((events, terminal)),
                        }
                    }
                    Err(error) => Err(error),
                };
                match streamed {
                    Ok((mut events, terminal)) => {
                        let terminal_error = events.iter().find_map(|event| match event {
                            StreamEvent::Error { error } => Some(error),
                            _ => None,
                        });
                        let mut breakers = self
                            .breakers
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        let breaker = breakers.entry(key).or_default();
                        if terminal_error.is_some_and(|error| error.retryable) {
                            breaker.record_failure(unix_ms(), self.breaker_policy);
                        } else if terminal_error.is_none() {
                            breaker.record_success();
                        }
                        drop(breakers);
                        let had_usage = events
                            .iter()
                            .any(|event| matches!(event, StreamEvent::Usage { .. }));
                        self.record_usage(route, &mut events)?;
                        if !had_usage
                            && let Some(usage) = events
                                .iter()
                                .find(|event| matches!(event, StreamEvent::Usage { .. }))
                        {
                            on_event(usage.clone()).map_err(RouterError::Consumer)?;
                        }
                        if let Some(terminal) = terminal {
                            on_event(terminal).map_err(RouterError::Consumer)?;
                        }
                        // An in-stream error follows committed output/tool state. Return it
                        // verbatim; never retry or silently replay a tool call.
                        return Ok(RouterOutcome {
                            provider: route.candidate.provider,
                            model: route.candidate.model.clone(),
                            attempts: attempt,
                            events,
                        });
                    }
                    Err(error) => {
                        let provider_error = error.provider_error(route.candidate.provider);
                        if provider_error.retryable {
                            self.breakers
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner)
                                .entry(key.clone())
                                .or_default()
                                .record_failure(unix_ms(), self.breaker_policy);
                        }
                        match self.retry.decide(attempt, &provider_error) {
                            RetryDecision::RetryAfter { delay_ms } => {
                                tokio::select! {
                                    () = tokio::time::sleep(Duration::from_millis(delay_ms)) => {},
                                    () = cancel.cancelled() => return Err(RouterError::Provider(
                                        AdapterError::Transport(TransportError::Cancelled))),
                                }
                                attempt += 1;
                            }
                            RetryDecision::Stop => {
                                last_error = Some(error);
                                break;
                            }
                        }
                    }
                }
            }
        }
        if !saw_closed_route {
            return Err(RouterError::CircuitsOpen);
        }
        last_error.map_or(Err(RouterError::NoEligibleRoute), |error| {
            Err(RouterError::Provider(error))
        })
    }

    fn record_usage(
        &self,
        route: &RouterRoute,
        events: &mut Vec<StreamEvent>,
    ) -> Result<(), RouterError> {
        if !events
            .iter()
            .any(|event| matches!(event, StreamEvent::Usage { .. }))
        {
            let response_id = events.iter().find_map(|event| match event {
                StreamEvent::Completed { response_id, .. } if !response_id.is_empty() => {
                    Some(response_id.clone())
                }
                _ => None,
            });
            let mut accounting = UsageAccounting {
                pricing_catalog_version: self.pricing.version.clone(),
                pricing_source: self.pricing.source.clone(),
                provider_request_id: response_id
                    .map(Measurement::Known)
                    .unwrap_or_else(|| omitted("request ID")),
                tokens: TokenUsage {
                    input: omitted("input tokens"),
                    output: omitted("output tokens"),
                    cache_read: omitted("cache read tokens"),
                    cache_write: omitted("cache write tokens"),
                    reasoning: omitted("reasoning tokens"),
                },
                estimated_cost: omitted("cost"),
                provider_reported_cost: omitted("provider-reported cost"),
                quota_remaining: omitted("quota remaining"),
                quota_reset_at_ms: omitted("quota reset"),
            };
            price_accounting(
                &mut accounting,
                route.candidate.provider,
                &route.candidate.model,
                &self.pricing,
            );
            let position = events
                .iter()
                .position(|event| {
                    matches!(
                        event,
                        StreamEvent::Completed { .. } | StreamEvent::Error { .. }
                    )
                })
                .unwrap_or(events.len());
            events.insert(
                position,
                StreamEvent::Usage {
                    accounting: Box::new(accounting),
                },
            );
        }
        let mut latest = None;
        for event in events.iter_mut() {
            if let StreamEvent::Usage { accounting } = event {
                price_accounting(
                    accounting,
                    route.candidate.provider,
                    &route.candidate.model,
                    &self.pricing,
                );
                latest = Some((**accounting).clone());
            }
        }
        if let Some(accounting) = latest {
            let mut ledger = self
                .ledger
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // Providers may emit cumulative usage multiple times in one stream;
            // persisting only the final sample prevents double counting.
            ledger
                .record(accounting)
                .map_err(|error| RouterError::Ledger(error.to_string()))?;
            if let Some(path) = &self.ledger_path {
                persist_ledger(path, &ledger)?;
            }
        }
        Ok(())
    }
}

fn price_accounting(
    accounting: &mut UsageAccounting,
    provider: ProviderKind,
    model: &str,
    catalog: &PricingCatalog,
) {
    accounting
        .pricing_catalog_version
        .clone_from(&catalog.version);
    accounting.pricing_source.clone_from(&catalog.source);
    accounting.estimated_cost = match (
        catalog.prices.get(&(provider, model.to_owned())),
        &accounting.tokens.input,
        &accounting.tokens.output,
    ) {
        (Some(price), Measurement::Known(input), Measurement::Known(output)) => input
            .checked_mul(price.input_micros_per_million)
            .and_then(|input_cost| {
                output
                    .checked_mul(price.output_micros_per_million)
                    .and_then(|output_cost| input_cost.checked_add(output_cost))
            })
            .map(|cost| MoneyMicros {
                amount_micros: cost / 1_000_000,
                currency: price.currency.clone(),
            })
            .map_or_else(
                || Measurement::Unknown {
                    reason: "pricing arithmetic overflowed u64".into(),
                },
                Measurement::Known,
            ),
        (None, _, _) => Measurement::Unknown {
            reason: format!(
                "model {model} is absent from pricing catalog {}",
                catalog.version
            ),
        },
        (_, Measurement::Unknown { reason }, _) | (_, _, Measurement::Unknown { reason }) => {
            Measurement::Unknown {
                reason: format!("cannot price incomplete usage: {reason}"),
            }
        }
    };
}

fn persist_ledger(path: &std::path::Path, ledger: &UsageLedger) -> Result<(), RouterError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| RouterError::Ledger(error.to_string()))?;
    }
    let data = serde_json::to_vec_pretty(ledger)
        .map_err(|error| RouterError::Ledger(error.to_string()))?;
    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);
    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let name = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or("usage-ledger");
    let mut temporary = None;
    for _ in 0..16 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), sequence));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(file) => {
                temporary = Some((candidate, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(RouterError::Ledger(error.to_string())),
        }
    }
    let (temporary, mut file) = temporary.ok_or_else(|| {
        RouterError::Ledger("could not allocate a unique usage-ledger staging file".into())
    })?;
    let staged = (|| -> Result<(), RouterError> {
        file.write_all(&data)
            .map_err(|error| RouterError::Ledger(error.to_string()))?;
        file.sync_all()
            .map_err(|error| RouterError::Ledger(error.to_string()))?;
        drop(file);
        std::fs::rename(&temporary, path)
            .map_err(|error| RouterError::Ledger(error.to_string()))?;
        #[cfg(unix)]
        std::fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| RouterError::Ledger(error.to_string()))?;
        Ok(())
    })();
    if staged.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    staged
}

fn open_ledger_read(path: &std::path::Path) -> Result<std::fs::File, RouterError> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options
        .open(path)
        .map_err(|error| RouterError::Ledger(error.to_string()))
}

fn validate_ledger_metadata(metadata: &std::fs::Metadata) -> Result<(), RouterError> {
    if !metadata.is_file() {
        return Err(RouterError::Ledger(
            "usage ledger must be a regular non-symlink file".into(),
        ));
    }
    if metadata.len() > MAX_USAGE_LEDGER_BYTES {
        return Err(RouterError::Ledger(format!(
            "usage ledger exceeds {MAX_USAGE_LEDGER_BYTES} bytes"
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(RouterError::Ledger(
                "usage ledger must not have multiple hard links".into(),
            ));
        }
    }
    Ok(())
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn omitted<T>(field: &str) -> Measurement<T> {
    Measurement::Unknown {
        reason: format!("provider omitted {field}"),
    }
}

/// Authenticated model discovery. Endpoints are caller supplied so tests and
/// enterprise gateways can use the same parser without contacting the network.
pub async fn discover_models(
    provider: ProviderKind,
    endpoint: &str,
    auth: &AuthProfile,
    transport: &dyn HttpTransport,
    cancel: &CancellationToken,
) -> Result<ModelCatalog, AdapterError> {
    validate_provider_url(endpoint)?;
    require_auth(auth, provider)?;
    let auth_header = match provider {
        ProviderKind::Anthropic => ("x-api-key", auth.key.expose().to_owned()),
        ProviderKind::OpenAi => ("authorization", format!("Bearer {}", auth.key.expose())),
    };
    let response = transport
        .send(
            HttpRequest {
                method: "GET".into(),
                url: endpoint.into(),
                headers: BTreeMap::from([(auth_header.0.into(), auth_header.1)]),
                body: Vec::new(),
            },
            cancel,
        )
        .await?;
    if response.body.len() > DEFAULT_MAX_RESPONSE_BYTES {
        return Err(AdapterError::MalformedStream(format!(
            "model response exceeds {DEFAULT_MAX_RESPONSE_BYTES} bytes"
        )));
    }
    if response.status >= 400 {
        return Err(map_http_error(provider, response));
    }
    let value: Value = serde_json::from_slice(&response.body)
        .map_err(|error| AdapterError::MalformedStream(error.to_string()))?;
    let models = value["data"]
        .as_array()
        .ok_or_else(|| AdapterError::MalformedStream("model data must be an array".into()))?;
    if models.len() > MAX_DISCOVERED_MODELS {
        return Err(AdapterError::MalformedStream(format!(
            "model catalog exceeds {MAX_DISCOVERED_MODELS} entries"
        )));
    }
    let mut catalog = ModelCatalog::default();
    for model in models {
        let id = model["id"]
            .as_str()
            .filter(|id| valid_provider_identifier(id))
            .ok_or_else(|| AdapterError::MalformedStream("model id is invalid".into()))?;
        let status = match model["status"].as_str() {
            Some("deprecated") => ModelStatus::Deprecated,
            Some("unavailable") => ModelStatus::Unavailable,
            _ if model["deprecated"].as_bool() == Some(true) => ModelStatus::Deprecated,
            _ => ModelStatus::Active,
        };
        let profile = match provider {
            ProviderKind::Anthropic => CapabilityProfile::anthropic_messages(),
            ProviderKind::OpenAi => CapabilityProfile::openai_responses(),
        };
        catalog.insert(ModelDescriptor {
            id: id.into(),
            provider,
            status,
            capabilities: profile.capabilities,
            max_input_tokens: model["context_window"].as_u64(),
            max_output_tokens: model["max_output_tokens"].as_u64(),
            risk_tier: RiskTier::High,
        });
    }
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_provider::{InputMessage, InputPart, InputRole, ToolDefinition};
    use std::collections::VecDeque;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn request() -> NormalizedRequest {
        NormalizedRequest {
            operation_id: "op-1".into(),
            model: "test-model".into(),
            messages: vec![
                InputMessage {
                    role: InputRole::Developer,
                    parts: vec![InputPart::Text {
                        text: "be precise".into(),
                    }],
                },
                InputMessage {
                    role: InputRole::User,
                    parts: vec![InputPart::Text {
                        text: "hello".into(),
                    }],
                },
            ],
            tools: vec![ToolDefinition {
                name: "lookup".into(),
                description: "Lookup".into(),
                input_schema: json!({"type":"object"}),
                mutating: false,
            }],
            max_output_tokens: Some(128),
            replay: vec![],
        }
    }

    #[test]
    fn native_provider_responses_fail_closed_on_unknown_required_content() {
        let anthropic = serde_json::to_vec(&json!({
            "type":"message","role":"assistant","id":"msg_native",
            "content":[{"type":"future_required_part"}],"stop_reason":"end_turn"
        }))
        .unwrap();
        assert!(matches!(
            parse_anthropic_response(&anthropic),
            Err(AdapterError::MalformedResponse(message))
                if message.contains("future_required_part")
        ));

        let openai = serde_json::to_vec(&json!({
            "id":"resp_native","status":"completed",
            "output":[{"type":"future_required_item"}]
        }))
        .unwrap();
        assert!(matches!(
            parse_openai_response(&openai),
            Err(AdapterError::MalformedResponse(message))
                if message.contains("future_required_item")
        ));
    }

    #[test]
    fn native_provider_payloads_encode_resolved_image_artifacts() {
        let mut request = request();
        request.messages[1].parts.push(InputPart::Image {
            media_type: "image/png".into(),
            artifact_id: "sha256:image".into(),
            data_base64: Some("aW1hZ2U=".into()),
        });
        let anthropic = anthropic_body(&request).unwrap();
        assert_eq!(
            anthropic["messages"][0]["content"][1]["source"]["data"],
            "aW1hZ2U="
        );
        let openai = openai_body(&request).unwrap();
        assert_eq!(
            openai["input"][2]["content"][0]["image_url"],
            "data:image/png;base64,aW1hZ2U="
        );
    }

    #[test]
    fn unresolved_image_artifact_is_never_sent_as_a_fake_provider_url() {
        let mut request = request();
        request.messages[1].parts.push(InputPart::Image {
            media_type: "image/png".into(),
            artifact_id: "sha256:image".into(),
            data_base64: None,
        });
        assert!(
            anthropic_body(&request)
                .unwrap_err()
                .to_string()
                .contains("artifact resolver")
        );
        assert!(
            openai_body(&request)
                .unwrap_err()
                .to_string()
                .contains("artifact resolver")
        );
    }

    #[test]
    fn provider_specific_reasoning_replay_never_degrades_into_visible_text() {
        let mut request = request();
        request.messages.push(InputMessage {
            role: InputRole::Assistant,
            parts: vec![InputPart::Reasoning {
                text: "private chain state".into(),
                replay: Some(ReplayMetadata::Anthropic {
                    reasoning_signature: "signed-fixture".into(),
                }),
            }],
        });
        let anthropic = anthropic_body(&request).unwrap();
        let replay = anthropic["messages"].as_array().unwrap().last().unwrap();
        assert_eq!(replay["content"][0]["type"], "thinking");
        assert_eq!(replay["content"][0]["signature"], "signed-fixture");
        let openai = openai_body(&request).unwrap();
        assert!(!openai.to_string().contains("private chain state"));
    }

    #[derive(Default)]
    struct MockTransport {
        responses: Mutex<VecDeque<Result<HttpResponse, TransportError>>>,
    }

    struct ScriptAdapter {
        provider: ProviderKind,
        replies: Mutex<VecDeque<Result<Vec<StreamEvent>, AdapterError>>>,
        calls: AtomicUsize,
    }

    struct StreamFaultAdapter {
        calls: AtomicUsize,
    }

    struct FloodAdapter;

    #[async_trait]
    impl ProviderAdapter for FloodAdapter {
        fn kind(&self) -> ProviderKind {
            ProviderKind::OpenAi
        }

        fn capability_profile(&self) -> CapabilityProfile {
            CapabilityProfile::openai_responses()
        }

        async fn execute_once(
            &self,
            _: &NormalizedRequest,
            _: &AuthProfile,
            _: &dyn HttpTransport,
            _: &CancellationToken,
        ) -> Result<Vec<StreamEvent>, AdapterError> {
            unreachable!("router must use the native stream")
        }

        async fn execute_stream(
            &self,
            _: &NormalizedRequest,
            _: &AuthProfile,
            _: &dyn HttpTransport,
            _: &CancellationToken,
        ) -> Result<ProviderEventStream, AdapterError> {
            let (sender, receiver) = tokio::sync::mpsc::channel(8);
            tokio::spawn(async move {
                for _ in 0..1_100 {
                    if sender
                        .send(Ok(StreamEvent::OutputDelta { text: "x".into() }))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                let _ = sender
                    .send(Ok(StreamEvent::Completed {
                        response_id: "flood".into(),
                        finish_reason: FinishReason::Stop,
                    }))
                    .await;
            });
            Ok(ProviderEventStream { receiver })
        }
    }

    #[async_trait]
    impl ProviderAdapter for StreamFaultAdapter {
        fn kind(&self) -> ProviderKind {
            ProviderKind::OpenAi
        }

        fn capability_profile(&self) -> CapabilityProfile {
            CapabilityProfile::openai_responses()
        }

        async fn execute_once(
            &self,
            _: &NormalizedRequest,
            _: &AuthProfile,
            _: &dyn HttpTransport,
            _: &CancellationToken,
        ) -> Result<Vec<StreamEvent>, AdapterError> {
            unreachable!("router must use the native stream")
        }

        async fn execute_stream(
            &self,
            _: &NormalizedRequest,
            _: &AuthProfile,
            _: &dyn HttpTransport,
            _: &CancellationToken,
        ) -> Result<ProviderEventStream, AdapterError> {
            self.calls.fetch_add(1, AtomicOrdering::SeqCst);
            let (sender, receiver) = tokio::sync::mpsc::channel(4);
            sender
                .try_send(Ok(StreamEvent::ToolCallStarted {
                    id: "committed-call".into(),
                    name: "lookup".into(),
                }))
                .unwrap();
            sender
                .try_send(Ok(StreamEvent::ToolCallCompleted {
                    id: "committed-call".into(),
                    arguments: json!({"q":"x"}),
                }))
                .unwrap();
            sender
                .try_send(Err(AdapterError::Transport(TransportError::Http(
                    "connection reset after tool commit".into(),
                ))))
                .unwrap();
            Ok(ProviderEventStream { receiver })
        }
    }

    impl ScriptAdapter {
        fn new(
            provider: ProviderKind,
            replies: Vec<Result<Vec<StreamEvent>, AdapterError>>,
        ) -> Self {
            Self {
                provider,
                replies: Mutex::new(replies.into()),
                calls: AtomicUsize::new(0),
            }
        }
    }

    #[async_trait]
    impl ProviderAdapter for ScriptAdapter {
        fn kind(&self) -> ProviderKind {
            self.provider
        }

        fn capability_profile(&self) -> CapabilityProfile {
            match self.provider {
                ProviderKind::Anthropic => CapabilityProfile::anthropic_messages(),
                ProviderKind::OpenAi => CapabilityProfile::openai_responses(),
            }
        }

        async fn execute_once(
            &self,
            _request: &NormalizedRequest,
            _auth: &AuthProfile,
            _transport: &dyn HttpTransport,
            _cancel: &CancellationToken,
        ) -> Result<Vec<StreamEvent>, AdapterError> {
            self.calls.fetch_add(1, AtomicOrdering::SeqCst);
            self.replies.lock().unwrap().pop_front().unwrap()
        }
    }

    fn scripted_route(
        adapter: Arc<ScriptAdapter>,
        model: &str,
        risk_tier: RiskTier,
    ) -> RouterRoute {
        RouterRoute {
            candidate: RouteCandidate {
                provider: adapter.provider,
                model: model.into(),
                risk_tier,
                capabilities: BTreeSet::from([Capability::Text, Capability::Tools]),
            },
            auth: AuthProfile::explicit(adapter.provider, "fixture-key").unwrap(),
            adapter,
        }
    }
    #[async_trait]
    impl HttpTransport for MockTransport {
        async fn send(
            &self,
            _request: HttpRequest,
            cancel: &CancellationToken,
        ) -> Result<HttpResponse, TransportError> {
            if cancel.is_cancelled() {
                return Err(TransportError::Cancelled);
            }
            self.responses.lock().unwrap().pop_front().unwrap()
        }
    }

    #[test]
    fn auth_is_explicit_and_persistence_is_redacted() {
        let environment = BTreeMap::from([("OPENAI_API_KEY".into(), "sk-secret".into())]);
        let profile = AuthProfile::from_environment(ProviderKind::OpenAi, &environment).unwrap();
        assert_eq!(
            profile.redacted(),
            PersistedAuthProfile {
                provider: ProviderKind::OpenAi,
                source: AuthSource::Environment {
                    variable: "OPENAI_API_KEY".into()
                },
                key_present: true
            }
        );
        assert!(!format!("{profile:?}").contains("sk-secret"));
        let wire = HttpRequest {
            method: "POST".into(),
            url: "x".into(),
            headers: BTreeMap::from([
                ("Authorization".into(), "Bearer sk-secret".into()),
                ("Cookie".into(), "session=browser-secret".into()),
            ]),
            body: b"private prompt".to_vec(),
        };
        let redacted = wire.redacted();
        assert_eq!(redacted.headers["Authorization"], "[REDACTED]");
        assert!(!redacted.body.windows(7).any(|window| window == b"private"));
        let debug = format!("{wire:?}");
        assert!(!debug.contains("sk-secret"));
        assert!(!debug.contains("browser-secret"));
        assert!(!debug.contains("private prompt"));
        for invalid in [" leading", "trailing ", "line\nbreak", "\u{7f}", "คีย์"] {
            assert_eq!(
                AuthProfile::explicit(ProviderKind::OpenAi, invalid).unwrap_err(),
                AuthError::InvalidKey
            );
        }
        assert_eq!(
            AuthProfile::explicit(ProviderKind::OpenAi, "x".repeat(MAX_API_KEY_BYTES + 1))
                .unwrap_err(),
            AuthError::InvalidKey
        );
    }

    #[test]
    fn provider_endpoints_cannot_leak_credentials_over_insecure_or_ambiguous_urls() {
        assert!(validate_provider_url("https://api.openai.com/v1/responses").is_ok());
        assert!(validate_provider_url("http://127.0.0.1:1234/v1/responses").is_ok());
        for invalid in [
            "http://api.openai.com/v1/responses",
            "http://localhost:1234/v1/responses",
            "https://user:secret@api.openai.com/v1/responses",
            "https://api.openai.com/v1/responses?token=secret",
            "https://api.openai.com/v1/responses#fragment",
        ] {
            assert!(
                validate_provider_url(invalid).is_err(),
                "endpoint must fail closed: {invalid}"
            );
        }
    }

    #[test]
    fn catalog_filters_status_and_capabilities_without_guessing_limits() {
        let configured = configured_catalog(&BTreeMap::from([(
            "OPENAI_MODEL".into(),
            "invalid\nmodel".into(),
        )]));
        assert!(configured.all().is_empty());

        let mut catalog = ModelCatalog::default();
        catalog.insert(ModelDescriptor {
            id: "reasoning-model".into(),
            provider: ProviderKind::OpenAi,
            status: ModelStatus::Active,
            capabilities: BTreeSet::from([Capability::Text, Capability::Reasoning]),
            max_input_tokens: None,
            max_output_tokens: None,
            risk_tier: RiskTier::High,
        });
        catalog.insert(ModelDescriptor {
            id: "retired-model".into(),
            provider: ProviderKind::OpenAi,
            status: ModelStatus::Deprecated,
            capabilities: BTreeSet::from([Capability::Reasoning]),
            max_input_tokens: Some(1),
            max_output_tokens: Some(1),
            risk_tier: RiskTier::High,
        });
        catalog.insert(ModelDescriptor {
            id: "unverified-model".into(),
            provider: ProviderKind::OpenAi,
            status: ModelStatus::Unknown,
            capabilities: BTreeSet::from([Capability::Reasoning]),
            max_input_tokens: None,
            max_output_tokens: None,
            risk_tier: RiskTier::High,
        });
        let compatible = catalog.compatible(
            ProviderKind::OpenAi,
            &BTreeSet::from([Capability::Reasoning]),
        );
        assert_eq!(compatible.len(), 1);
        assert_eq!(compatible[0].id, "reasoning-model");
        assert_eq!(catalog.routes().len(), 1);
    }

    #[test]
    fn anthropic_parser_handles_reasoning_partial_tools_usage_and_completion() {
        let body = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"usage\":{\"input_tokens\":5,\"output_tokens\":1}}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"lookup\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\":\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"1}\"}}\n\n",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hmm\"}}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":3}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
        let events = parse_anthropic_sse(body.as_bytes()).unwrap();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, StreamEvent::ToolArgumentsDelta { .. }))
        );
        assert!(events.iter().any(|event| matches!(event, StreamEvent::ToolCallCompleted { arguments, .. } if arguments["q"] == 1)));
        assert!(events.iter().any(
            |event| matches!(event, StreamEvent::ReasoningDelta { text, .. } if text == "hmm")
        ));
        assert!(events.iter().any(|event| matches!(
            event,
            StreamEvent::Completed {
                finish_reason: FinishReason::ToolCalls,
                ..
            }
        )));
    }

    #[test]
    fn openai_parser_handles_text_tool_reasoning_usage() {
        let body = concat!(
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"lookup\"}}\n\n",
            "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"delta\":\"{\"}\n\n",
            "data: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"fc_1\",\"arguments\":\"{}\"}\n\n",
            "data: {\"type\":\"response.reasoning_text.delta\",\"delta\":\"think\"}\n\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n"
        );
        let events = parse_openai_sse(body.as_bytes()).unwrap();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, StreamEvent::OutputDelta { text } if text == "hello"))
        );
        assert!(
            events
                .iter()
                .any(|event| matches!(event, StreamEvent::Usage { .. }))
        );
        assert!(events.iter().any(|event| matches!(
            event,
            StreamEvent::ToolCallCompleted { id, .. } if id == "call_1"
        )));
        assert!(events.iter().any(|event| matches!(event, StreamEvent::Completed { response_id, .. } if response_id == "resp_1")));
    }

    #[test]
    fn partial_stream_error_is_terminal_output_not_a_retryable_request_error() {
        let body = concat!(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"committed\"}\n\n",
            "data: {\"type\":\"error\",\"code\":\"server_error\",\"message\":\"failed\"}\n\n"
        );
        let events = parse_openai_sse(body.as_bytes()).unwrap();
        assert!(matches!(
            events.first(),
            Some(StreamEvent::OutputDelta { .. })
        ));
        assert!(matches!(events.last(), Some(StreamEvent::Error { .. })));
    }

    #[test]
    fn openai_reasoning_item_ids_are_bound_to_completed_response_for_replay() {
        let events = parse_openai_sse(
            concat!(
                "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"reasoning\",\"id\":\"rs_1\"}}\n\n",
                "data: {\"type\":\"response.reasoning_text.delta\",\"delta\":\"thought\"}\n\n",
                "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\"}}\n\n"
            )
            .as_bytes(),
        )
        .unwrap();
        assert!(events.iter().any(|event| matches!(
            event,
            StreamEvent::ReasoningDelta {
                replay: Some(ReplayMetadata::OpenAi { response_id, reasoning_item_ids }),
                ..
            } if response_id == "resp_1" && reasoning_item_ids == &["rs_1"]
        )));
    }

    #[tokio::test]
    async fn reqwest_adapter_executes_against_local_mock_http() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let count = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..count]);
            assert!(
                request
                    .to_ascii_lowercase()
                    .contains("authorization: bearer test-key")
            );
            let body = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n\
data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_local\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n";
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        let adapter = OpenAiAdapter {
            endpoint: format!("http://{address}/v1/responses"),
        };
        let events = adapter
            .execute_once(
                &request(),
                &AuthProfile::explicit(ProviderKind::OpenAi, "test-key").unwrap(),
                &ReqwestTransport::default(),
                &CancellationToken::default(),
            )
            .await
            .unwrap();
        server.await.unwrap();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, StreamEvent::OutputDelta { text } if text == "ok"))
        );
    }

    #[tokio::test]
    async fn reqwest_transport_cancels_an_in_flight_response() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            let _ = socket.read(&mut request).await;
            tokio::time::sleep(Duration::from_millis(200)).await;
            let _ = socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
                .await;
        });
        let cancel = CancellationToken::default();
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            trigger.cancel();
        });
        let result = ReqwestTransport::default()
            .send(
                HttpRequest {
                    method: "POST".into(),
                    url: format!("http://{address}/slow"),
                    headers: BTreeMap::new(),
                    body: vec![],
                },
                &cancel,
            )
            .await;
        assert!(matches!(result, Err(TransportError::Cancelled)));
        server.abort();
    }

    #[tokio::test]
    async fn reqwest_transport_rejects_oversized_responses_before_buffering() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            let _ = socket.read(&mut request).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 6\r\n\r\n123456")
                .await
                .unwrap();
        });
        let result = ReqwestTransport::with_max_response_bytes(4)
            .send(
                HttpRequest {
                    method: "POST".into(),
                    url: format!("http://{address}/large"),
                    headers: BTreeMap::new(),
                    body: vec![],
                },
                &CancellationToken::default(),
            )
            .await;
        assert!(matches!(
            result,
            Err(TransportError::ResponseTooLarge { limit: 4 })
        ));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn provider_transport_never_follows_redirects_with_authorization_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let accepts = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&accepts);
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            observed.fetch_add(1, AtomicOrdering::SeqCst);
            let mut request = vec![0_u8; 4096];
            let _ = socket.read(&mut request).await.unwrap();
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 302 Found\r\nlocation: http://{address}/next\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            if let Ok(Ok((mut redirected, _))) =
                tokio::time::timeout(Duration::from_millis(200), listener.accept()).await
            {
                observed.fetch_add(1, AtomicOrdering::SeqCst);
                let _ = redirected
                    .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n")
                    .await;
            }
        });
        let response = ReqwestTransport::default()
            .send(
                HttpRequest {
                    method: "POST".into(),
                    url: format!("http://{address}/start"),
                    headers: BTreeMap::from([(
                        "authorization".into(),
                        "Bearer fixture-secret".into(),
                    )]),
                    body: Vec::new(),
                },
                &CancellationToken::default(),
            )
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(response.status, 302);
        assert_eq!(accepts.load(AtomicOrdering::SeqCst), 1);
    }

    #[tokio::test]
    async fn retry_maps_rate_limits_and_cancellation_stops_requests() {
        let transport = MockTransport {
            responses: Mutex::new(VecDeque::from([
                Ok(HttpResponse {
                    status: 429,
                    headers: BTreeMap::from([("retry-after-ms".into(), "0".into())]),
                    body: br#"{"error":{"type":"rate_limit_error","message":"slow"}}"#.to_vec(),
                }),
                Ok(HttpResponse {
                    status: 200,
                    headers: BTreeMap::new(),
                    body:
                        b"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"ok\"}}\n\n"
                            .to_vec(),
                }),
            ])),
        };
        let adapter = OpenAiAdapter::default();
        let events = execute_with_retry(
            &adapter,
            &request(),
            &AuthProfile::explicit(ProviderKind::OpenAi, "key").unwrap(),
            &transport,
            &CancellationToken::default(),
            RetryPolicy {
                max_attempts: 2,
                base_delay_ms: 0,
                max_delay_ms: 0,
            },
        )
        .await
        .unwrap();
        assert!(
            matches!(events.last(), Some(StreamEvent::Completed { response_id, .. }) if response_id == "ok")
        );
        let cancel = CancellationToken::default();
        cancel.cancel();
        assert!(matches!(
            execute_with_retry(
                &adapter,
                &request(),
                &AuthProfile::explicit(ProviderKind::OpenAi, "key").unwrap(),
                &MockTransport::default(),
                &cancel,
                RetryPolicy {
                    max_attempts: 1,
                    base_delay_ms: 0,
                    max_delay_ms: 0
                }
            )
            .await,
            Err(AdapterError::Transport(TransportError::Cancelled))
        ));

        let delayed = ScriptAdapter::new(
            ProviderKind::OpenAi,
            vec![Err(AdapterError::Transport(TransportError::Http(
                "retry later".into(),
            )))],
        );
        let cancel = CancellationToken::default();
        let canceller = cancel.clone();
        let auth = AuthProfile::explicit(ProviderKind::OpenAi, "key").unwrap();
        let delayed_transport = MockTransport::default();
        let delayed_request = request();
        let (result, ()) = tokio::join!(
            execute_with_retry(
                &delayed,
                &delayed_request,
                &auth,
                &delayed_transport,
                &cancel,
                RetryPolicy {
                    max_attempts: 2,
                    base_delay_ms: 30_000,
                    max_delay_ms: 30_000,
                }
            ),
            async move {
                tokio::time::sleep(Duration::from_millis(10)).await;
                canceller.cancel();
            }
        );
        assert!(matches!(
            result,
            Err(AdapterError::Transport(TransportError::Cancelled))
        ));
    }

    #[tokio::test]
    async fn fallback_is_forbidden_after_committed_output() {
        let transport = MockTransport {
            responses: Mutex::new(VecDeque::from([Err(TransportError::Http(
                "primary unavailable".into(),
            ))])),
        };
        let route = RouteCandidate {
            provider: ProviderKind::Anthropic,
            model: "fallback".into(),
            risk_tier: RiskTier::High,
            capabilities: BTreeSet::from([Capability::Text]),
        };
        let result = execute_with_safe_fallback(
            &OpenAiAdapter::default(),
            &AuthProfile::explicit(ProviderKind::OpenAi, "openai-key").unwrap(),
            &AnthropicAdapter::default(),
            &AuthProfile::explicit(ProviderKind::Anthropic, "anthropic-key").unwrap(),
            &route,
            &request(),
            &transport,
            &CancellationToken::default(),
            ExecutionProgress {
                committed_output: true,
                mutating_side_effect: false,
            },
            RiskTier::High,
            &BTreeSet::from([Capability::Text]),
        )
        .await;
        assert!(
            matches!(result, Err(AdapterError::Translation(message)) if message.contains("committed partial output"))
        );
    }

    #[tokio::test]
    async fn router_enforces_risk_floor_and_falls_back_only_before_output() {
        let weak = Arc::new(ScriptAdapter::new(
            ProviderKind::OpenAi,
            vec![Ok(vec![StreamEvent::Completed {
                response_id: "weak".into(),
                finish_reason: FinishReason::Stop,
            }])],
        ));
        let router = ProviderRouter::new(
            vec![scripted_route(weak.clone(), "weak", RiskTier::Low)],
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        );
        assert!(matches!(
            router
                .execute(
                    &request(),
                    &RouteRequirements {
                        risk_tier: RiskTier::High,
                        capabilities: BTreeSet::from([Capability::Text]),
                    },
                    ExecutionProgress::default(),
                    &CancellationToken::default(),
                )
                .await,
            Err(RouterError::NoEligibleRoute)
        ));
        assert_eq!(weak.calls.load(AtomicOrdering::SeqCst), 0);

        let primary = Arc::new(ScriptAdapter::new(
            ProviderKind::OpenAi,
            vec![Err(AdapterError::Provider(ProviderError {
                provider: ProviderKind::OpenAi,
                category: ErrorCategory::ModelUnavailable,
                code: None,
                message: "unavailable".into(),
                retryable: false,
                provider_request_id: None,
                http_status: Some(503),
                retry_after_ms: None,
            }))],
        ));
        let fallback = Arc::new(ScriptAdapter::new(
            ProviderKind::Anthropic,
            vec![Ok(vec![StreamEvent::Completed {
                response_id: "fallback".into(),
                finish_reason: FinishReason::Stop,
            }])],
        ));
        let router = ProviderRouter::new(
            vec![
                scripted_route(primary, "primary", RiskTier::High),
                scripted_route(fallback.clone(), "fallback", RiskTier::High),
            ],
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        );
        let outcome = router
            .execute(
                &request(),
                &RouteRequirements {
                    risk_tier: RiskTier::High,
                    capabilities: BTreeSet::from([Capability::Text]),
                },
                ExecutionProgress::default(),
                &CancellationToken::default(),
            )
            .await
            .unwrap();
        assert_eq!(outcome.provider, ProviderKind::Anthropic);
        assert_eq!(fallback.calls.load(AtomicOrdering::SeqCst), 1);
    }

    #[tokio::test]
    async fn router_never_retries_or_falls_back_after_partial_output_or_tool_call() {
        let stream_error = ProviderError {
            provider: ProviderKind::OpenAi,
            category: ErrorCategory::Server,
            code: Some("server_error".into()),
            message: "failed after commit".into(),
            retryable: true,
            provider_request_id: Some("req-partial".into()),
            http_status: None,
            retry_after_ms: None,
        };
        let primary = Arc::new(ScriptAdapter::new(
            ProviderKind::OpenAi,
            vec![Ok(vec![
                StreamEvent::ToolCallStarted {
                    id: "call-1".into(),
                    name: "lookup".into(),
                },
                StreamEvent::Error {
                    error: stream_error,
                },
            ])],
        ));
        let fallback = Arc::new(ScriptAdapter::new(
            ProviderKind::Anthropic,
            vec![Ok(Vec::new())],
        ));
        let router = ProviderRouter::new(
            vec![
                scripted_route(primary.clone(), "primary", RiskTier::High),
                scripted_route(fallback.clone(), "fallback", RiskTier::High),
            ],
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        );
        let outcome = router
            .execute(
                &request(),
                &RouteRequirements {
                    risk_tier: RiskTier::High,
                    capabilities: BTreeSet::from([Capability::Tools]),
                },
                ExecutionProgress::default(),
                &CancellationToken::default(),
            )
            .await
            .unwrap();
        assert!(matches!(
            outcome.events.last(),
            Some(StreamEvent::Error { .. })
        ));
        assert_eq!(primary.calls.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(fallback.calls.load(AtomicOrdering::SeqCst), 0);
    }

    #[tokio::test]
    async fn transport_reset_after_completed_tool_arguments_is_terminal_and_never_falls_back() {
        let primary = Arc::new(StreamFaultAdapter {
            calls: AtomicUsize::new(0),
        });
        let fallback = Arc::new(ScriptAdapter::new(
            ProviderKind::Anthropic,
            vec![Ok(vec![StreamEvent::Completed {
                response_id: "must-not-run".into(),
                finish_reason: FinishReason::Stop,
            }])],
        ));
        let router = ProviderRouter::new(
            vec![
                RouterRoute {
                    candidate: RouteCandidate {
                        provider: ProviderKind::OpenAi,
                        model: "primary".into(),
                        risk_tier: RiskTier::High,
                        capabilities: BTreeSet::from([Capability::Text, Capability::Tools]),
                    },
                    adapter: primary.clone(),
                    auth: AuthProfile::explicit(ProviderKind::OpenAi, "fixture-key").unwrap(),
                },
                scripted_route(fallback.clone(), "fallback", RiskTier::High),
            ],
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        );
        let mut delivered = Vec::new();
        let outcome = router
            .execute_incremental(
                &request(),
                &RouteRequirements {
                    risk_tier: RiskTier::High,
                    capabilities: BTreeSet::from([Capability::Tools]),
                },
                ExecutionProgress::default(),
                &CancellationToken::default(),
                |event| {
                    delivered.push(event);
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(primary.calls.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(fallback.calls.load(AtomicOrdering::SeqCst), 0);
        assert!(matches!(
            outcome.events.last(),
            Some(StreamEvent::Error { .. })
        ));
        assert!(matches!(delivered.last(), Some(StreamEvent::Error { .. })));
        let usage_position = delivered
            .iter()
            .position(|event| matches!(event, StreamEvent::Usage { .. }))
            .expect("synthetic unknown usage must be explicit");
        assert_eq!(usage_position + 1, delivered.len() - 1);
        let StreamEvent::Usage { accounting } = &delivered[usage_position] else {
            unreachable!()
        };
        assert!(matches!(
            accounting.tokens.input,
            Measurement::Unknown { .. }
        ));
        assert!(matches!(
            accounting.estimated_cost,
            Measurement::Unknown { .. }
        ));
    }

    #[tokio::test]
    async fn router_retries_rate_limits_and_persists_priced_accounting() {
        let adapter = Arc::new(ScriptAdapter::new(
            ProviderKind::OpenAi,
            vec![
                Err(AdapterError::Provider(ProviderError {
                    provider: ProviderKind::OpenAi,
                    category: ErrorCategory::RateLimit,
                    code: Some("rate_limit".into()),
                    message: "slow down".into(),
                    retryable: true,
                    provider_request_id: Some("rate-limited-attempt".into()),
                    http_status: Some(429),
                    retry_after_ms: Some(0),
                })),
                Ok(vec![
                    StreamEvent::Usage {
                        accounting: Box::new(UsageAccounting {
                            pricing_catalog_version: "old".into(),
                            pricing_source: "old".into(),
                            provider_request_id: Measurement::Known("req-priced".into()),
                            tokens: TokenUsage {
                                input: Measurement::Known(2),
                                output: Measurement::Known(3),
                                cache_read: Measurement::Unknown {
                                    reason: "omitted".into(),
                                },
                                cache_write: Measurement::Unknown {
                                    reason: "omitted".into(),
                                },
                                reasoning: Measurement::Unknown {
                                    reason: "omitted".into(),
                                },
                            },
                            estimated_cost: Measurement::Unknown {
                                reason: "old".into(),
                            },
                            provider_reported_cost: Measurement::Unknown {
                                reason: "omitted".into(),
                            },
                            quota_remaining: Measurement::Known(7),
                            quota_reset_at_ms: Measurement::Known(99),
                        }),
                    },
                    StreamEvent::Completed {
                        response_id: "req-priced".into(),
                        finish_reason: FinishReason::Stop,
                    },
                ]),
            ],
        ));
        let directory = tempfile::tempdir().unwrap();
        let ledger_path = directory.path().join("usage.json");
        let pricing = PricingCatalog {
            version: "fixture-2026-08-05".into(),
            source: "fixture".into(),
            prices: BTreeMap::from([(
                (ProviderKind::OpenAi, "priced".into()),
                ModelPrice {
                    input_micros_per_million: 1_000_000,
                    output_micros_per_million: 2_000_000,
                    currency: "USD".into(),
                },
            )]),
        };
        let router = ProviderRouter::new(
            vec![scripted_route(adapter.clone(), "priced", RiskTier::High)],
            Arc::new(MockTransport::default()),
            pricing,
        )
        .with_policies(
            RetryPolicy {
                max_attempts: 2,
                base_delay_ms: 0,
                max_delay_ms: 0,
            },
            CircuitBreakerPolicy {
                failure_threshold: 3,
                cooldown_ms: 1,
            },
        )
        .with_durable_ledger(&ledger_path)
        .unwrap();
        let outcome = router
            .execute(
                &request(),
                &RouteRequirements {
                    risk_tier: RiskTier::High,
                    capabilities: BTreeSet::from([Capability::Text]),
                },
                ExecutionProgress::default(),
                &CancellationToken::default(),
            )
            .await
            .unwrap();
        assert_eq!(outcome.attempts, 2);
        assert_eq!(adapter.calls.load(AtomicOrdering::SeqCst), 2);
        assert_eq!(router.ledger().entries().len(), 1);
        let ledger = router.ledger();
        let entry = &ledger.entries()[0];
        assert_eq!(entry.pricing_catalog_version, "fixture-2026-08-05");
        assert_eq!(entry.pricing_source, "fixture");
        assert_eq!(entry.quota_remaining, Measurement::Known(7));
        assert_eq!(entry.quota_reset_at_ms, Measurement::Known(99));
        assert!(matches!(
            entry.provider_reported_cost,
            Measurement::Unknown { .. }
        ));
        assert_eq!(
            entry.estimated_cost,
            Measurement::Known(MoneyMicros {
                amount_micros: 8,
                currency: "USD".into()
            })
        );
        let restored = ProviderRouter::new(
            Vec::new(),
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        )
        .with_durable_ledger(ledger_path)
        .unwrap();
        assert_eq!(restored.ledger().entries().len(), 1);
    }

    #[tokio::test]
    async fn authenticated_model_discovery_preserves_status_and_limits() {
        let transport = MockTransport {
            responses: Mutex::new(VecDeque::from([Ok(HttpResponse {
                status: 200,
                headers: BTreeMap::new(),
                body: br#"{"data":[{"id":"active","context_window":100,"max_output_tokens":10},{"id":"old","status":"deprecated"}]}"#.to_vec(),
            })])),
        };
        let catalog = discover_models(
            ProviderKind::OpenAi,
            "https://fixture.invalid/models",
            &AuthProfile::explicit(ProviderKind::OpenAi, "fixture-key").unwrap(),
            &transport,
            &CancellationToken::default(),
        )
        .await
        .unwrap();
        assert_eq!(
            catalog
                .get(ProviderKind::OpenAi, "active")
                .unwrap()
                .max_input_tokens,
            Some(100)
        );
        assert_eq!(
            catalog.get(ProviderKind::OpenAi, "old").unwrap().status,
            ModelStatus::Deprecated
        );
        assert_eq!(
            catalog
                .compatible(ProviderKind::OpenAi, &BTreeSet::from([Capability::Text]))
                .len(),
            1
        );

        let invalid = MockTransport {
            responses: Mutex::new(VecDeque::from([Ok(HttpResponse {
                status: 200,
                headers: BTreeMap::new(),
                body: br#"{"data":[{"id":"bad\nmodel"}]}"#.to_vec(),
            })])),
        };
        assert!(matches!(
            discover_models(
                ProviderKind::OpenAi,
                "https://fixture.invalid/models",
                &AuthProfile::explicit(ProviderKind::OpenAi, "fixture-key").unwrap(),
                &invalid,
                &CancellationToken::default(),
            )
            .await,
            Err(AdapterError::MalformedStream(message)) if message.contains("model id")
        ));
    }

    #[test]
    fn response_headers_override_request_and_quota_metadata() {
        let mut events = vec![StreamEvent::Usage {
            accounting: Box::new(usage_accounting(
                String::new(),
                &json!({"input_tokens":1,"output_tokens":2}),
            )),
        }];
        enrich_response_metadata(
            &mut events,
            &BTreeMap::from([
                ("x-request-id".into(), "req-header".into()),
                ("x-ratelimit-remaining-tokens".into(), "42".into()),
                ("x-ratelimit-reset-tokens-ms".into(), "1234".into()),
            ]),
        );
        let StreamEvent::Usage { accounting } = &events[0] else {
            panic!("usage expected");
        };
        assert_eq!(
            accounting.provider_request_id,
            Measurement::Known("req-header".into())
        );
        assert_eq!(accounting.quota_remaining, Measurement::Known(42));
        assert_eq!(accounting.quota_reset_at_ms, Measurement::Known(1234));
    }

    #[tokio::test]
    async fn router_bounds_total_events_from_a_hostile_provider_stream() {
        let route = RouterRoute {
            candidate: RouteCandidate {
                provider: ProviderKind::OpenAi,
                model: "flood".into(),
                risk_tier: RiskTier::High,
                capabilities: BTreeSet::from([Capability::Text, Capability::Tools]),
            },
            adapter: Arc::new(FloodAdapter),
            auth: AuthProfile::explicit(ProviderKind::OpenAi, "fixture-key").unwrap(),
        };
        let router = ProviderRouter::new(
            vec![route],
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        );
        let mut bounded_request = request();
        bounded_request.max_output_tokens = Some(1);
        let outcome = router
            .execute(
                &bounded_request,
                &RouteRequirements {
                    risk_tier: RiskTier::High,
                    capabilities: BTreeSet::from([Capability::Text]),
                },
                ExecutionProgress::default(),
                &CancellationToken::default(),
            )
            .await
            .unwrap();

        assert!(outcome.events.len() <= 1_026);
        assert!(
            outcome
                .events
                .iter()
                .any(|event| matches!(event, StreamEvent::Error { error } if error.message.contains("bounded router assembly")))
        );
    }

    #[tokio::test]
    async fn circuit_breaker_rejects_followup_without_calling_provider() {
        let adapter = Arc::new(ScriptAdapter::new(
            ProviderKind::OpenAi,
            vec![Err(AdapterError::Provider(ProviderError {
                provider: ProviderKind::OpenAi,
                category: ErrorCategory::Server,
                code: Some("server_error".into()),
                message: "down".into(),
                retryable: true,
                provider_request_id: None,
                http_status: Some(503),
                retry_after_ms: None,
            }))],
        ));
        let router = ProviderRouter::new(
            vec![scripted_route(adapter.clone(), "guarded", RiskTier::High)],
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        )
        .with_policies(
            RetryPolicy {
                max_attempts: 1,
                base_delay_ms: 0,
                max_delay_ms: 0,
            },
            CircuitBreakerPolicy {
                failure_threshold: 1,
                cooldown_ms: 60_000,
            },
        );
        let requirements = RouteRequirements {
            risk_tier: RiskTier::High,
            capabilities: BTreeSet::from([Capability::Text]),
        };
        assert!(matches!(
            router
                .execute(
                    &request(),
                    &requirements,
                    ExecutionProgress::default(),
                    &CancellationToken::default()
                )
                .await,
            Err(RouterError::Provider(_))
        ));
        assert!(matches!(
            router
                .execute(
                    &request(),
                    &requirements,
                    ExecutionProgress::default(),
                    &CancellationToken::default()
                )
                .await,
            Err(RouterError::CircuitsOpen)
        ));
        assert_eq!(adapter.calls.load(AtomicOrdering::SeqCst), 1);
    }

    struct BlockingChunkTransport {
        release: Arc<tokio::sync::Notify>,
    }

    #[async_trait]
    impl HttpTransport for BlockingChunkTransport {
        async fn send(
            &self,
            _: HttpRequest,
            _: &CancellationToken,
        ) -> Result<HttpResponse, TransportError> {
            Err(TransportError::Http("stream method required".into()))
        }

        async fn send_stream(
            &self,
            _: HttpRequest,
            _: &CancellationToken,
        ) -> Result<HttpStreamResponse, TransportError> {
            let (sender, receiver) = tokio::sync::mpsc::channel(2);
            sender
                .send(Ok(
                    b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"first\"}\n\n"
                        .to_vec(),
                ))
                .await
                .unwrap();
            let release = Arc::clone(&self.release);
            tokio::spawn(async move {
                release.notified().await;
                let _ = sender.send(Ok(b"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"done\"}}\n\n".to_vec())).await;
            });
            Ok(HttpStreamResponse {
                status: 200,
                headers: BTreeMap::new(),
                chunks: receiver,
            })
        }
    }

    #[tokio::test]
    async fn first_normalized_delta_arrives_before_upstream_completion() {
        let release = Arc::new(tokio::sync::Notify::new());
        let transport = BlockingChunkTransport {
            release: Arc::clone(&release),
        };
        let adapter = OpenAiAdapter::default();
        let auth = AuthProfile::explicit(ProviderKind::OpenAi, "test-key").unwrap();
        let mut stream = adapter
            .execute_stream(&request(), &auth, &transport, &CancellationToken::default())
            .await
            .unwrap();
        let first = tokio::time::timeout(Duration::from_millis(100), stream.next())
            .await
            .expect("first delta did not wait for completion")
            .unwrap()
            .unwrap();
        assert_eq!(
            first,
            StreamEvent::OutputDelta {
                text: "first".into()
            }
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(20), stream.next())
                .await
                .is_err()
        );
        release.notify_one();
        assert!(matches!(
            stream.next().await.unwrap().unwrap(),
            StreamEvent::Completed { .. }
        ));
    }

    #[tokio::test]
    async fn openai_incremental_decoder_preserves_fragmented_tool_state() {
        let body = concat!(
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"id\":\"call_1\",\"name\":\"lookup\"}}\n\n",
            "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"call_1\",\"delta\":\"{\"}\n\n",
            "data: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"call_1\",\"arguments\":\"{}\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\"}}\n\n"
        );
        let events = fragmented_provider_events(ProviderKind::OpenAi, body, 13)
            .await
            .unwrap();
        assert!(events.iter().any(|event| matches!(
            event,
            StreamEvent::ToolCallCompleted { id, .. } if id == "call_1"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            StreamEvent::Completed { response_id, .. } if response_id == "resp_1"
        )));
    }

    #[tokio::test]
    async fn anthropic_incremental_decoder_preserves_fragmented_tool_and_response_state() {
        let body = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\"}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"lookup\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"}\"}}\n\n",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
        let events = fragmented_provider_events(ProviderKind::Anthropic, body, 11)
            .await
            .unwrap();
        assert!(events.iter().any(|event| matches!(
            event,
            StreamEvent::ToolCallCompleted { id, .. } if id == "tool_1"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            StreamEvent::Completed { response_id, finish_reason: FinishReason::ToolCalls }
                if response_id == "msg_1"
        )));
    }

    #[tokio::test]
    async fn incremental_decoder_terminalizes_interrupted_tool_and_transport_cancellation() {
        for (provider, start) in [
            (
                ProviderKind::OpenAi,
                "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"id\":\"call_1\",\"name\":\"lookup\"}}\n\n",
            ),
            (
                ProviderKind::Anthropic,
                "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"lookup\"}}\n\n",
            ),
        ] {
            let (sender, receiver) = tokio::sync::mpsc::channel(2);
            sender.send(Ok(start.as_bytes().to_vec())).await.unwrap();
            drop(sender);
            let mut stream = stream_http_response(
                HttpStreamResponse {
                    status: 200,
                    headers: BTreeMap::new(),
                    chunks: receiver,
                },
                provider,
            )
            .await
            .unwrap();
            assert!(matches!(
                stream.next().await,
                Some(Ok(StreamEvent::ToolCallStarted { .. }))
            ));
            assert!(matches!(
                stream.next().await,
                Some(Err(AdapterError::MalformedStream(message))) if message.contains("interrupted tool call")
            ));
        }

        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        sender
            .send(Ok(b"data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"id\":\"call_cancel\",\"name\":\"lookup\"}}\n\n".to_vec()))
            .await
            .unwrap();
        sender.send(Err(TransportError::Cancelled)).await.unwrap();
        drop(sender);
        let mut stream = stream_http_response(
            HttpStreamResponse {
                status: 200,
                headers: BTreeMap::new(),
                chunks: receiver,
            },
            ProviderKind::OpenAi,
        )
        .await
        .unwrap();
        assert!(matches!(
            stream.next().await,
            Some(Ok(StreamEvent::ToolCallStarted { id, .. })) if id == "call_cancel"
        ));
        assert!(matches!(
            stream.next().await,
            Some(Err(AdapterError::Transport(TransportError::Cancelled)))
        ));
        assert!(stream.next().await.is_none());
    }

    async fn fragmented_provider_events(
        provider: ProviderKind,
        body: &str,
        chunk_size: usize,
    ) -> Result<Vec<StreamEvent>, AdapterError> {
        let chunks = body
            .as_bytes()
            .chunks(chunk_size)
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>();
        let (sender, receiver) = tokio::sync::mpsc::channel(chunks.len());
        for chunk in chunks {
            sender.send(Ok(chunk)).await.unwrap();
        }
        drop(sender);
        stream_http_response(
            HttpStreamResponse {
                status: 200,
                headers: BTreeMap::new(),
                chunks: receiver,
            },
            provider,
        )
        .await?
        .collect()
        .await
    }

    #[tokio::test]
    async fn provider_stream_rejects_an_unbounded_frame() {
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        sender
            .send(Ok(vec![b'x'; DEFAULT_MAX_RESPONSE_BYTES + 1]))
            .await
            .unwrap();
        drop(sender);
        let response = HttpStreamResponse {
            status: 200,
            headers: BTreeMap::new(),
            chunks: receiver,
        };
        let mut stream = stream_http_response(response, ProviderKind::OpenAi)
            .await
            .unwrap();

        assert!(matches!(
            stream.next().await,
            Some(Err(AdapterError::MalformedStream(message)))
                if message.contains("exceeds")
        ));
    }

    #[tokio::test]
    async fn direct_provider_event_collection_is_bounded_without_a_router() {
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        sender
            .try_send(Ok(StreamEvent::OutputDelta {
                text: "x".repeat(DEFAULT_MAX_RESPONSE_BYTES),
            }))
            .unwrap();
        drop(sender);
        assert!(matches!(
            (ProviderEventStream { receiver }).collect().await,
            Err(AdapterError::MalformedStream(message)) if message.contains("event stream exceeds")
        ));
    }

    #[test]
    fn cancellation_steering_recovers_from_a_poisoned_queue() {
        let token = CancellationToken::default();
        let poison = token.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poison.0.steering.lock().unwrap();
            panic!("poison steering queue");
        })
        .join();

        token.steer("continue safely");
        assert_eq!(token.take_steering().as_deref(), Some("continue safely"));
        assert_eq!(token.take_steering(), None);
    }

    #[test]
    fn cancellation_steering_queue_and_unicode_messages_are_bounded() {
        let token = CancellationToken::default();
        for index in 0..(MAX_PENDING_STEERING_MESSAGES + 10) {
            token.steer(format!("message-{index}"));
        }
        let retained = (0..MAX_PENDING_STEERING_MESSAGES)
            .map(|_| token.take_steering().expect("bounded retained message"))
            .collect::<Vec<_>>();
        assert_eq!(retained.first().map(String::as_str), Some("message-10"));
        assert_eq!(retained.last().map(String::as_str), Some("message-73"));
        assert_eq!(token.take_steering(), None);

        token.steer("ก".repeat(MAX_STEERING_MESSAGE_BYTES));
        let bounded = token.take_steering().expect("bounded unicode message");
        assert!(bounded.len() <= MAX_STEERING_MESSAGE_BYTES);
        assert!(bounded.is_char_boundary(bounded.len()));
    }

    #[test]
    fn provider_router_recovers_from_poisoned_shared_accounting_state() {
        let router = ProviderRouter::new(
            Vec::new(),
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        );
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| {
                let _guard = router.ledger.lock().unwrap();
                panic!("poison usage ledger");
            });
            let _ = handle.join();
        });

        assert_eq!(router.ledger(), UsageLedger::default());
    }

    #[cfg(unix)]
    #[test]
    fn durable_usage_ledger_rejects_symlinks_and_never_follows_staging_links() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let external = directory.path().join("external.json");
        let ledger_path = directory.path().join("usage.json");
        std::fs::write(&external, b"outside-sentinel").unwrap();
        symlink(&external, &ledger_path).unwrap();

        let error = ProviderRouter::new(
            Vec::new(),
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        )
        .with_durable_ledger(&ledger_path)
        .err()
        .expect("symlink ledger must fail");
        assert!(matches!(error, RouterError::Ledger(_)));
        assert_eq!(std::fs::read(&external).unwrap(), b"outside-sentinel");

        std::fs::remove_file(&ledger_path).unwrap();
        symlink(&external, directory.path().join("usage.json.tmp")).unwrap();
        persist_ledger(&ledger_path, &UsageLedger::default()).unwrap();
        assert_eq!(std::fs::read(&external).unwrap(), b"outside-sentinel");
        assert_eq!(
            serde_json::from_slice::<UsageLedger>(&std::fs::read(&ledger_path).unwrap()).unwrap(),
            UsageLedger::default()
        );
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&ledger_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        let oversized = directory.path().join("oversized.json");
        std::fs::File::create(&oversized)
            .unwrap()
            .set_len(MAX_USAGE_LEDGER_BYTES + 1)
            .unwrap();
        let error = ProviderRouter::new(
            Vec::new(),
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        )
        .with_durable_ledger(&oversized)
        .err()
        .expect("oversized ledger must fail");
        assert!(matches!(error, RouterError::Ledger(message) if message.contains("exceeds")));
    }

    #[test]
    fn durable_usage_ledger_validates_deserialized_entries() {
        let directory = tempfile::tempdir().unwrap();
        let ledger_path = directory.path().join("hostile-usage.json");
        let mut ledger = UsageLedger::default();
        ledger
            .record(usage_accounting(
                "duplicate-request".into(),
                &json!({"input_tokens":1,"output_tokens":1}),
            ))
            .unwrap();
        let mut encoded = serde_json::to_value(&ledger).unwrap();
        let duplicate = encoded["entries"][0].clone();
        encoded["entries"].as_array_mut().unwrap().push(duplicate);
        std::fs::write(&ledger_path, serde_json::to_vec(&encoded).unwrap()).unwrap();

        let error = ProviderRouter::new(
            Vec::new(),
            Arc::new(MockTransport::default()),
            PricingCatalog::default(),
        )
        .with_durable_ledger(&ledger_path)
        .err()
        .expect("duplicate persisted request IDs must fail validation");
        assert!(matches!(error, RouterError::Ledger(message) if message.contains("duplicate")));
    }

    #[test]
    fn pricing_overflow_is_explicitly_unknown() {
        let mut accounting = usage_accounting(
            "request-overflow".into(),
            &json!({"input_tokens": u64::MAX, "output_tokens": u64::MAX}),
        );
        let catalog = PricingCatalog {
            version: "overflow-fixture".into(),
            source: "test".into(),
            prices: BTreeMap::from([(
                (ProviderKind::OpenAi, "model".into()),
                ModelPrice {
                    input_micros_per_million: u64::MAX,
                    output_micros_per_million: u64::MAX,
                    currency: "USD".into(),
                },
            )]),
        };

        price_accounting(&mut accounting, ProviderKind::OpenAi, "model", &catalog);

        assert!(matches!(
            accounting.estimated_cost,
            Measurement::Unknown { ref reason } if reason.contains("overflow")
        ));
        assert_eq!(accounting.pricing_catalog_version, "overflow-fixture");
        assert_eq!(accounting.pricing_source, "test");
    }

    #[test]
    fn oversized_retry_after_header_saturates_without_panicking() {
        let error = map_http_error(
            ProviderKind::OpenAi,
            HttpResponse {
                status: 429,
                headers: BTreeMap::from([("retry-after".into(), u64::MAX.to_string())]),
                body: br#"{"error":{"message":"slow down"}}"#.to_vec(),
            },
        );

        assert!(matches!(
            error,
            AdapterError::Provider(ProviderError {
                retry_after_ms: Some(u64::MAX),
                ..
            })
        ));
    }

    #[test]
    fn anthropic_incremental_tool_arguments_have_an_aggregate_bound() {
        let mut state = AnthropicSseState::default();
        parse_anthropic_sse_incremental(
            br#"event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"read"}}

"#,
            &mut state,
        )
        .unwrap();
        let fragment = "x".repeat(MAX_TOOL_ARGUMENT_BYTES / 2 + 1);
        let frame = |fragment: &str| {
            format!(
                "event: content_block_delta\ndata: {}\n\n",
                json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "input_json_delta", "partial_json": fragment}
                })
            )
        };
        parse_anthropic_sse_incremental(frame(&fragment).as_bytes(), &mut state).unwrap();

        let error = parse_anthropic_sse_incremental(frame(&fragment).as_bytes(), &mut state)
            .expect_err("tool arguments spanning frames must remain bounded");
        assert!(matches!(
            error,
            AdapterError::MalformedStream(message) if message.contains("tool arguments exceed")
        ));
    }

    #[test]
    fn openai_rejects_duplicate_reasoning_item_ids() {
        let frame = br#"event: response.output_item.added
data: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_duplicate"}}

"#;
        let mut state = OpenAiSseState::default();
        parse_openai_sse_incremental(frame, &mut state).unwrap();

        let error = parse_openai_sse_incremental(frame, &mut state)
            .expect_err("duplicate replay metadata must not grow provider state");
        assert!(matches!(
            error,
            AdapterError::MalformedStream(message) if message.contains("duplicated a reasoning item id")
        ));
    }

    #[test]
    fn provider_replay_corpus_matches_exact_normalized_events() {
        use std::fs;
        use std::path::PathBuf;

        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/provider-replay");
        let manifest: Value =
            serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
        let cases = manifest["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 28);
        for case in cases {
            let stream =
                fs::read_to_string(root.join(case["streamPath"].as_str().unwrap())).unwrap();
            let body = stream
                .lines()
                .map(|line| {
                    serde_json::from_str::<Value>(line).unwrap()["wire"]
                        .as_str()
                        .unwrap()
                        .to_owned()
                })
                .collect::<String>();
            let expected: Value = serde_json::from_slice(
                &fs::read(root.join(case["expectedPath"].as_str().unwrap())).unwrap(),
            )
            .unwrap();
            let parsed = match case["provider"].as_str().unwrap() {
                "anthropic" => parse_anthropic_sse(body.as_bytes()),
                "openai" => parse_openai_sse(body.as_bytes()),
                provider => panic!("unexpected provider {provider}"),
            };
            if expected["exactError"].is_null() {
                let actual = serde_json::to_value(parsed.unwrap()).unwrap();
                assert_eq!(actual, expected["exactEvents"], "case {}", case["id"]);
            } else {
                assert!(
                    matches!(parsed, Err(AdapterError::Provider(_))),
                    "case {} must end in a provider error",
                    case["id"]
                );
            }
        }
    }
}
