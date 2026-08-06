//! A scripted provider, so a test can drive the *real* runtime, the real tool
//! surface and the real policy gate without a network.
//!
//! Only the model is replaced. Everything a test proves about streaming,
//! permission suspension, authority and degradation is therefore a property of
//! the shipped path, not of a stand-in for it.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use changeloop_provider::{NormalizedRequest, StreamEvent};
use changeloop_provider_adapters::CancellationToken;
use changeloop_runtime::StreamingProvider;

use crate::provider::{ProviderFactory, ProviderSetupError};

type Script = Arc<Mutex<VecDeque<Vec<StreamEvent>>>>;

/// Replays one recorded provider response per model call.
pub struct ScriptedProvider {
    script: Script,
    /// Every request the runtime issued, so a test can assert on the tool
    /// catalogue the model was actually offered.
    seen: Arc<Mutex<Vec<NormalizedRequest>>>,
}

impl StreamingProvider for ScriptedProvider {
    fn stream(&mut self, request: &NormalizedRequest) -> Result<Vec<StreamEvent>, String> {
        if let Ok(mut seen) = self.seen.lock() {
            seen.push(request.clone());
        }
        self.script
            .lock()
            .map_err(|_| "scripted provider is poisoned".to_owned())?
            .pop_front()
            .ok_or_else(|| "scripted provider ran out of responses".to_owned())
    }
}

/// Hands out [`ScriptedProvider`]s sharing one script, because the driver
/// rebuilds its runtime — and so its provider — on every step of a turn.
pub struct ScriptedProviderFactory {
    script: Script,
    seen: Arc<Mutex<Vec<NormalizedRequest>>>,
    model: String,
}

impl ScriptedProviderFactory {
    #[must_use]
    pub fn new(responses: Vec<Vec<StreamEvent>>) -> Self {
        Self {
            script: Arc::new(Mutex::new(responses.into())),
            seen: Arc::new(Mutex::new(Vec::new())),
            model: "scripted-model".into(),
        }
    }

    /// The requests the runtime issued so far.
    #[must_use]
    pub fn requests(&self) -> Vec<NormalizedRequest> {
        self.seen
            .lock()
            .map(|seen| seen.clone())
            .unwrap_or_default()
    }
}

impl ProviderFactory for ScriptedProviderFactory {
    type Provider = ScriptedProvider;

    fn model(&self) -> &str {
        &self.model
    }

    fn create(
        &mut self,
        _cancel: CancellationToken,
    ) -> Result<ScriptedProvider, ProviderSetupError> {
        Ok(ScriptedProvider {
            script: Arc::clone(&self.script),
            seen: Arc::clone(&self.seen),
        })
    }
}

/// A factory that never produces a provider, for proving that an unreachable
/// capability degrades visibly instead of hanging.
pub struct UnavailableProviderFactory(pub ProviderSetupError);

impl ProviderFactory for UnavailableProviderFactory {
    type Provider = ScriptedProvider;

    fn model(&self) -> &str {
        "<unconfigured>"
    }

    fn create(
        &mut self,
        _cancel: CancellationToken,
    ) -> Result<ScriptedProvider, ProviderSetupError> {
        Err(self.0.clone())
    }
}
