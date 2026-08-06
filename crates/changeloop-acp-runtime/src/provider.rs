//! The model call.
//!
//! [`changeloop_runtime::AgentRuntime`] is a synchronous loop and
//! [`changeloop_provider_adapters`] is async, so the bridge lives here and
//! nowhere else. It is the shape the workspace already uses: hold a
//! [`tokio::runtime::Handle`], and when the turn is running on a runtime thread
//! use [`tokio::task::block_in_place`] so blocking the model call does not
//! stall the scheduler.

use std::collections::BTreeMap;

use changeloop_provider::{NormalizedRequest, ProviderKind, RetryPolicy, StreamEvent};
use changeloop_provider_adapters::{
    AnthropicAdapter, AuthProfile, CancellationToken, HttpTransport, OpenAiAdapter,
    ProviderAdapter, ReqwestTransport, execute_with_retry,
};
use changeloop_runtime::StreamingProvider;
use thiserror::Error;

/// Attempts, including the first. Matches the runtime's own retry budget so a
/// provider outage surfaces rather than being retried twice over.
const RETRY_POLICY: RetryPolicy = RetryPolicy {
    max_attempts: 3,
    base_delay_ms: 250,
    max_delay_ms: 4_000,
};

/// Why no model call can be made. Each variant names the command that fixes it,
/// because the client sees this text and its user cannot read our source.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum ProviderSetupError {
    #[error(
        "no model provider is configured; run `cloop setup --provider <anthropic|openai> \
         --model <model> --sandbox read-only --accept-privacy --accept-provider-data`"
    )]
    ProviderRequired,
    #[error("no model is configured; run `cloop setup --provider <provider> --model <model> ...`")]
    ModelRequired,
    #[error("no credential is available for `{provider}`; run `cloop auth login {provider}`")]
    AuthRequired { provider: String },
    #[error("the ACP turn is not running on a Tokio runtime, so no provider request can be issued")]
    NoRuntime,
}

impl ProviderSetupError {
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProviderRequired => "provider_required",
            Self::ModelRequired => "model_required",
            Self::AuthRequired { .. } => "auth_required",
            Self::NoRuntime => "runtime_required",
        }
    }
}

/// Produces one provider per turn.
///
/// A factory rather than a stored provider because
/// [`changeloop_runtime::AgentRuntime`] takes its provider by value and is
/// rebuilt for every step of a suspended turn.
pub trait ProviderFactory {
    type Provider: StreamingProvider;

    /// The model this factory names, for the transcript and for diagnostics.
    fn model(&self) -> &str;

    fn create(&mut self, cancel: CancellationToken) -> Result<Self::Provider, ProviderSetupError>;
}

/// A provider resolved from the process environment, exactly as `cloop`'s own
/// service resolves it.
pub struct EnvProviderFactory {
    resolved: Result<ResolvedProvider, ProviderSetupError>,
}

struct ResolvedProvider {
    kind: ProviderKind,
    model: String,
    auth: AuthProfile,
}

impl EnvProviderFactory {
    #[must_use]
    pub fn from_environment(environment: &BTreeMap<String, String>) -> Self {
        Self {
            resolved: resolve(environment),
        }
    }

    /// The setup failure this factory carries, if any. Read by the driver so a
    /// misconfiguration is reported once, on the wire, instead of per step.
    #[must_use]
    pub fn setup_error(&self) -> Option<&ProviderSetupError> {
        self.resolved.as_ref().err()
    }
}

fn resolve(environment: &BTreeMap<String, String>) -> Result<ResolvedProvider, ProviderSetupError> {
    let kind = match environment.get("CHANGELOOP_PROVIDER").map(String::as_str) {
        Some("anthropic") => ProviderKind::Anthropic,
        Some("openai") => ProviderKind::OpenAi,
        _ => return Err(ProviderSetupError::ProviderRequired),
    };
    let model = environment
        .get("CHANGELOOP_MODEL")
        .filter(|model| !model.trim().is_empty())
        .cloned()
        .ok_or(ProviderSetupError::ModelRequired)?;
    let auth = AuthProfile::from_environment(kind, environment).map_err(|_| {
        ProviderSetupError::AuthRequired {
            provider: match kind {
                ProviderKind::Anthropic => "anthropic".into(),
                ProviderKind::OpenAi => "openai".into(),
            },
        }
    })?;
    Ok(ResolvedProvider { kind, model, auth })
}

impl ProviderFactory for EnvProviderFactory {
    type Provider = AdapterProvider;

    fn model(&self) -> &str {
        self.resolved
            .as_ref()
            .map_or("<unconfigured>", |resolved| resolved.model.as_str())
    }

    fn create(&mut self, cancel: CancellationToken) -> Result<AdapterProvider, ProviderSetupError> {
        let resolved = self.resolved.as_ref().map_err(Clone::clone)?;
        let handle =
            tokio::runtime::Handle::try_current().map_err(|_| ProviderSetupError::NoRuntime)?;
        let adapter: Box<dyn ProviderAdapter> = match resolved.kind {
            ProviderKind::Anthropic => Box::new(AnthropicAdapter::default()),
            ProviderKind::OpenAi => Box::new(OpenAiAdapter::default()),
        };
        Ok(AdapterProvider {
            adapter,
            auth: resolved.auth.clone(),
            transport: ReqwestTransport::default(),
            model: resolved.model.clone(),
            handle,
            cancel,
        })
    }
}

/// A [`StreamingProvider`] over one provider adapter.
pub struct AdapterProvider {
    adapter: Box<dyn ProviderAdapter>,
    auth: AuthProfile,
    transport: ReqwestTransport,
    model: String,
    handle: tokio::runtime::Handle,
    cancel: CancellationToken,
}

impl StreamingProvider for AdapterProvider {
    fn stream(&mut self, request: &NormalizedRequest) -> Result<Vec<StreamEvent>, String> {
        // The runtime names the model `selected`; binding the concrete model
        // is the provider's job, so a checkpoint never pins one build's model
        // string into replayable state.
        let mut request = request.clone();
        request.model.clone_from(&self.model);
        let adapter = self.adapter.as_ref();
        let auth = &self.auth;
        let transport: &dyn HttpTransport = &self.transport;
        let cancel = &self.cancel;
        let request = &request;
        let execute = || {
            self.handle.block_on(execute_with_retry(
                adapter,
                request,
                auth,
                transport,
                cancel,
                RETRY_POLICY,
            ))
        };
        let events = if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::block_in_place(execute)
        } else {
            execute()
        };
        events.map_err(|error| error.to_string())
    }
}
