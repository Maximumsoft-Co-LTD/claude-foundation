//! Provider-neutral model contracts and deterministic routing policy.
//!
//! This crate deliberately contains no network or credential implementation.
//! Adapters translate Anthropic Messages and OpenAI Responses into these types.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use thiserror::Error;

const MAX_USAGE_ENTRIES: usize = 10_000;
const MAX_ACCOUNTING_TEXT_BYTES: usize = 4_096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Anthropic,
    #[serde(rename = "openai")]
    OpenAi,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskTier {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    Text,
    Images,
    Tools,
    ParallelTools,
    Reasoning,
    ReasoningReplay,
    PromptCaching,
    ToolResultMedia,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityProfile {
    pub provider: ProviderKind,
    pub capabilities: BTreeSet<Capability>,
    pub max_input_tokens: Option<u64>,
    pub max_output_tokens: Option<u64>,
}

impl CapabilityProfile {
    #[must_use]
    pub fn supports(&self, required: &BTreeSet<Capability>) -> bool {
        required.is_subset(&self.capabilities)
    }

    /// Conservative native Anthropic Messages profile. Token limits remain
    /// model-catalog data and are therefore explicitly unknown here.
    #[must_use]
    pub fn anthropic_messages() -> Self {
        Self {
            provider: ProviderKind::Anthropic,
            capabilities: BTreeSet::from([
                Capability::Text,
                Capability::Images,
                Capability::Tools,
                Capability::ParallelTools,
                Capability::Reasoning,
                Capability::ReasoningReplay,
                Capability::PromptCaching,
                Capability::ToolResultMedia,
            ]),
            max_input_tokens: None,
            max_output_tokens: None,
        }
    }

    /// Conservative native OpenAI Responses profile. Limits are negotiated
    /// from the selected model rather than guessed by the provider core.
    #[must_use]
    pub fn openai_responses() -> Self {
        Self {
            provider: ProviderKind::OpenAi,
            capabilities: BTreeSet::from([
                Capability::Text,
                Capability::Images,
                Capability::Tools,
                Capability::ParallelTools,
                Capability::Reasoning,
                Capability::ReasoningReplay,
                Capability::PromptCaching,
                Capability::ToolResultMedia,
            ]),
            max_input_tokens: None,
            max_output_tokens: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputRole {
    System,
    Developer,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum InputPart {
    Text {
        text: String,
    },
    Reasoning {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        replay: Option<ReplayMetadata>,
    },
    Image {
        media_type: String,
        artifact_id: String,
        /// Base64 bytes resolved just-in-time for a provider request. Durable
        /// session history should retain only `artifact_id` and reconstruct
        /// this field from the content-addressed artifact store.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data_base64: Option<String>,
    },
    ToolCall {
        id: String,
        name: String,
        arguments: Value,
    },
    ToolResult {
        id: String,
        output: Value,
        is_error: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InputMessage {
    pub role: InputRole,
    pub parts: Vec<InputPart>,
}

/// Provider data required for official history replay. It must be redacted
/// independently before logging and must never contain a raw provider response.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "snake_case")]
pub enum ReplayMetadata {
    Anthropic {
        reasoning_signature: String,
    },
    #[serde(rename = "openai")]
    OpenAi {
        response_id: String,
        reasoning_item_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NormalizedRequest {
    pub operation_id: String,
    pub model: String,
    pub messages: Vec<InputMessage>,
    pub tools: Vec<ToolDefinition>,
    pub max_output_tokens: Option<u64>,
    pub replay: Vec<ReplayMetadata>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub mutating: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum StreamEvent {
    OutputDelta {
        text: String,
    },
    ReasoningDelta {
        text: String,
        replay: Option<ReplayMetadata>,
    },
    ToolCallStarted {
        id: String,
        name: String,
    },
    ToolArgumentsDelta {
        id: String,
        json_fragment: String,
    },
    ToolCallCompleted {
        id: String,
        arguments: Value,
    },
    Usage {
        accounting: Box<UsageAccounting>,
    },
    Completed {
        response_id: String,
        finish_reason: FinishReason,
    },
    Error {
        error: ProviderError,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    Stop,
    Length,
    ToolCalls,
    ContentFilter,
    Cancelled,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Authentication,
    Permission,
    InvalidRequest,
    RateLimit,
    Quota,
    ContextLimit,
    ModelUnavailable,
    Server,
    Transport,
    Cancelled,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Error)]
#[error("provider {category:?}: {message}")]
pub struct ProviderError {
    pub provider: ProviderKind,
    pub category: ErrorCategory,
    pub code: Option<String>,
    pub message: String,
    pub retryable: bool,
    pub provider_request_id: Option<String>,
    pub http_status: Option<u16>,
    pub retry_after_ms: Option<u64>,
}

/// Absence is represented explicitly so missing usage can never be mistaken for zero.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "value", rename_all = "snake_case")]
pub enum Measurement<T> {
    Known(T),
    Unknown { reason: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input: Measurement<u64>,
    pub output: Measurement<u64>,
    pub cache_read: Measurement<u64>,
    pub cache_write: Measurement<u64>,
    pub reasoning: Measurement<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoneyMicros {
    pub amount_micros: u64,
    pub currency: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageAccounting {
    pub pricing_catalog_version: String,
    pub pricing_source: String,
    pub provider_request_id: Measurement<String>,
    pub tokens: TokenUsage,
    pub estimated_cost: Measurement<MoneyMicros>,
    pub provider_reported_cost: Measurement<MoneyMicros>,
    pub quota_remaining: Measurement<u64>,
    pub quota_reset_at_ms: Measurement<u64>,
}

/// Auditable usage aggregation. Unknown measurements remain unknown instead of
/// being silently coerced to zero, and mixed currencies are never combined.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageTotals {
    pub request_count: u64,
    pub input_tokens: Measurement<u64>,
    pub output_tokens: Measurement<u64>,
    pub cache_read_tokens: Measurement<u64>,
    pub cache_write_tokens: Measurement<u64>,
    pub reasoning_tokens: Measurement<u64>,
    pub estimated_cost: Measurement<MoneyMicros>,
    pub provider_reported_cost: Measurement<MoneyMicros>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageLedger {
    entries: Vec<UsageAccounting>,
}

impl UsageLedger {
    pub fn validate(&self) -> Result<(), UsageLedgerError> {
        if self.entries.len() > MAX_USAGE_ENTRIES {
            return Err(UsageLedgerError::CapacityExceeded(MAX_USAGE_ENTRIES));
        }
        let mut request_ids = BTreeSet::new();
        for accounting in &self.entries {
            if !valid_accounting(accounting) {
                return Err(UsageLedgerError::InvalidAccounting);
            }
            if let Measurement::Known(request_id) = &accounting.provider_request_id
                && !request_ids.insert(request_id.as_str())
            {
                return Err(UsageLedgerError::DuplicateRequestId(request_id.clone()));
            }
        }
        Ok(())
    }

    pub fn record(&mut self, accounting: UsageAccounting) -> Result<(), UsageLedgerError> {
        if self.entries.len() == MAX_USAGE_ENTRIES {
            return Err(UsageLedgerError::CapacityExceeded(MAX_USAGE_ENTRIES));
        }
        if !valid_accounting(&accounting) {
            return Err(UsageLedgerError::InvalidAccounting);
        }
        if let Measurement::Known(request_id) = &accounting.provider_request_id
            && self.entries.iter().any(|entry| {
                matches!(&entry.provider_request_id, Measurement::Known(existing) if existing == request_id)
            })
        {
            return Err(UsageLedgerError::DuplicateRequestId(request_id.clone()));
        }
        self.entries.push(accounting);
        Ok(())
    }

    #[must_use]
    pub fn entries(&self) -> &[UsageAccounting] {
        &self.entries
    }

    #[must_use]
    pub fn totals(&self) -> UsageTotals {
        UsageTotals {
            request_count: self.entries.len() as u64,
            input_tokens: sum_measurements(self.entries.iter().map(|entry| &entry.tokens.input)),
            output_tokens: sum_measurements(self.entries.iter().map(|entry| &entry.tokens.output)),
            cache_read_tokens: sum_measurements(
                self.entries.iter().map(|entry| &entry.tokens.cache_read),
            ),
            cache_write_tokens: sum_measurements(
                self.entries.iter().map(|entry| &entry.tokens.cache_write),
            ),
            reasoning_tokens: sum_measurements(
                self.entries.iter().map(|entry| &entry.tokens.reasoning),
            ),
            estimated_cost: sum_money(self.entries.iter().map(|entry| &entry.estimated_cost)),
            provider_reported_cost: sum_money(
                self.entries
                    .iter()
                    .map(|entry| &entry.provider_reported_cost),
            ),
        }
    }
}

fn valid_accounting(accounting: &UsageAccounting) -> bool {
    valid_accounting_text(&accounting.pricing_catalog_version)
        && valid_accounting_text(&accounting.pricing_source)
        && valid_measurement_text(&accounting.provider_request_id)
        && valid_measurement_u64(&accounting.tokens.input)
        && valid_measurement_u64(&accounting.tokens.output)
        && valid_measurement_u64(&accounting.tokens.cache_read)
        && valid_measurement_u64(&accounting.tokens.cache_write)
        && valid_measurement_u64(&accounting.tokens.reasoning)
        && valid_money(&accounting.estimated_cost)
        && valid_money(&accounting.provider_reported_cost)
        && valid_measurement_u64(&accounting.quota_remaining)
        && valid_measurement_u64(&accounting.quota_reset_at_ms)
}

fn valid_accounting_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ACCOUNTING_TEXT_BYTES
        && !value.chars().any(char::is_control)
}

fn valid_measurement_text(value: &Measurement<String>) -> bool {
    match value {
        Measurement::Known(value) => valid_accounting_text(value),
        Measurement::Unknown { reason } => valid_accounting_text(reason),
    }
}

fn valid_measurement_u64(value: &Measurement<u64>) -> bool {
    match value {
        Measurement::Known(_) => true,
        Measurement::Unknown { reason } => valid_accounting_text(reason),
    }
}

fn valid_money(value: &Measurement<MoneyMicros>) -> bool {
    match value {
        Measurement::Known(value) => {
            !value.currency.is_empty()
                && value.currency.len() <= 16
                && value
                    .currency
                    .chars()
                    .all(|character| character.is_ascii_uppercase())
        }
        Measurement::Unknown { reason } => valid_accounting_text(reason),
    }
}

fn sum_measurements<'a>(values: impl Iterator<Item = &'a Measurement<u64>>) -> Measurement<u64> {
    let mut total = 0_u64;
    for value in values {
        match value {
            Measurement::Known(value) => {
                let Some(next) = total.checked_add(*value) else {
                    return Measurement::Unknown {
                        reason: "usage total overflowed u64".into(),
                    };
                };
                total = next;
            }
            Measurement::Unknown { reason } => {
                return Measurement::Unknown {
                    reason: reason.clone(),
                };
            }
        }
    }
    Measurement::Known(total)
}

fn sum_money<'a>(
    values: impl Iterator<Item = &'a Measurement<MoneyMicros>>,
) -> Measurement<MoneyMicros> {
    let mut total = 0_u64;
    let mut currency = None::<String>;
    for value in values {
        match value {
            Measurement::Unknown { reason } => {
                return Measurement::Unknown {
                    reason: reason.clone(),
                };
            }
            Measurement::Known(value) => {
                if currency
                    .as_ref()
                    .is_some_and(|currency| currency != &value.currency)
                {
                    return Measurement::Unknown {
                        reason: "mixed currencies cannot be aggregated".into(),
                    };
                }
                currency.get_or_insert_with(|| value.currency.clone());
                let Some(next) = total.checked_add(value.amount_micros) else {
                    return Measurement::Unknown {
                        reason: "cost total overflowed u64".into(),
                    };
                };
                total = next;
            }
        }
    }
    currency.map_or_else(
        || Measurement::Unknown {
            reason: "no cost measurements".into(),
        },
        |currency| {
            Measurement::Known(MoneyMicros {
                amount_micros: total,
                currency,
            })
        },
    )
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum UsageLedgerError {
    #[error("duplicate provider request ID: {0}")]
    DuplicateRequestId(String),
    #[error("usage ledger reached its {0}-entry capacity")]
    CapacityExceeded(usize),
    #[error("usage accounting contains an empty, oversized, or unsafe text field")]
    InvalidAccounting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetryPolicy {
    /// Total attempts, including the initial request.
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum RetryDecision {
    RetryAfter { delay_ms: u64 },
    Stop,
}

impl RetryPolicy {
    #[must_use]
    pub fn decide(&self, attempt: u32, error: &ProviderError) -> RetryDecision {
        let retryable_category = matches!(
            error.category,
            ErrorCategory::RateLimit
                | ErrorCategory::ModelUnavailable
                | ErrorCategory::Server
                | ErrorCategory::Transport
        );
        if !error.retryable || !retryable_category || attempt >= self.max_attempts {
            return RetryDecision::Stop;
        }
        let exponent = attempt.saturating_sub(1).min(63);
        let backoff = self
            .base_delay_ms
            .saturating_mul(1_u64 << exponent)
            .min(self.max_delay_ms);
        RetryDecision::RetryAfter {
            delay_ms: error
                .retry_after_ms
                .unwrap_or(backoff)
                .min(self.max_delay_ms),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CircuitBreakerPolicy {
    pub failure_threshold: u32,
    pub cooldown_ms: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CircuitBreaker {
    consecutive_failures: u32,
    opened_at_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CircuitDecision {
    Allow,
    RejectOpen,
}

impl CircuitBreaker {
    #[must_use]
    pub fn before_request(&self, now_ms: u64, policy: CircuitBreakerPolicy) -> CircuitDecision {
        match self.opened_at_ms {
            Some(opened) if now_ms.saturating_sub(opened) < policy.cooldown_ms => {
                CircuitDecision::RejectOpen
            }
            _ => CircuitDecision::Allow,
        }
    }
    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.opened_at_ms = None;
    }
    pub fn record_failure(&mut self, now_ms: u64, policy: CircuitBreakerPolicy) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        if self.consecutive_failures >= policy.failure_threshold {
            // A failed probe after cooldown must start a fresh cooldown. Keeping
            // the original timestamp would leave the breaker permanently
            // permissive once the first cooldown elapsed.
            self.opened_at_ms = Some(now_ms);
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionProgress {
    pub committed_output: bool,
    pub mutating_side_effect: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteCandidate {
    pub provider: ProviderKind,
    pub model: String,
    pub risk_tier: RiskTier,
    pub capabilities: BTreeSet<Capability>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteRequirements {
    pub risk_tier: RiskTier,
    pub capabilities: BTreeSet<Capability>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Error)]
#[error("no provider route meets the required risk tier and capabilities")]
pub struct NoEligibleRoute;

/// Picks the first policy-ordered eligible route. Callers determine ordering
/// (quality, explicit user selection, or cost), while this gate guarantees an
/// ordering strategy cannot lower assurance.
pub fn select_route<'a>(
    candidates: &'a [RouteCandidate],
    requirements: &RouteRequirements,
) -> Result<&'a RouteCandidate, NoEligibleRoute> {
    candidates
        .iter()
        .find(|candidate| {
            candidate.risk_tier >= requirements.risk_tier
                && requirements.capabilities.is_subset(&candidate.capabilities)
        })
        .ok_or(NoEligibleRoute)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Error)]
#[serde(rename_all = "snake_case")]
pub enum FallbackDenied {
    #[error("fallback forbidden after committed partial output")]
    OutputCommitted,
    #[error("fallback forbidden after a mutating side effect")]
    MutationCommitted,
    #[error("fallback candidate lowers required risk tier")]
    RiskTierTooLow,
    #[error("fallback candidate lacks required capabilities")]
    MissingCapabilities,
}

pub fn authorize_fallback(
    progress: ExecutionProgress,
    candidate: &RouteCandidate,
    required_risk: RiskTier,
    required_capabilities: &BTreeSet<Capability>,
) -> Result<(), FallbackDenied> {
    if progress.mutating_side_effect {
        return Err(FallbackDenied::MutationCommitted);
    }
    if progress.committed_output {
        return Err(FallbackDenied::OutputCommitted);
    }
    if candidate.risk_tier < required_risk {
        return Err(FallbackDenied::RiskTierTooLow);
    }
    if !required_capabilities.is_subset(&candidate.capabilities) {
        return Err(FallbackDenied::MissingCapabilities);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transient_error(retry_after_ms: Option<u64>) -> ProviderError {
        ProviderError {
            provider: ProviderKind::OpenAi,
            category: ErrorCategory::RateLimit,
            code: Some("rate_limit".into()),
            message: "slow down".into(),
            retryable: true,
            provider_request_id: Some("request-1".into()),
            http_status: Some(429),
            retry_after_ms,
        }
    }

    #[test]
    fn request_and_stream_contracts_round_trip() {
        let request = NormalizedRequest {
            operation_id: "operation-1".into(),
            model: "model-1".into(),
            messages: vec![InputMessage {
                role: InputRole::Developer,
                parts: vec![InputPart::Text {
                    text: "policy".into(),
                }],
            }],
            tools: vec![],
            max_output_tokens: Some(512),
            replay: vec![ReplayMetadata::OpenAi {
                response_id: "response-1".into(),
                reasoning_item_ids: vec!["reasoning-1".into()],
            }],
        };
        let encoded = serde_json::to_string(&request).unwrap();
        assert_eq!(
            serde_json::from_str::<NormalizedRequest>(&encoded).unwrap(),
            request
        );
        let event = StreamEvent::ToolArgumentsDelta {
            id: "call-1".into(),
            json_fragment: "{\"path\":".into(),
        };
        let encoded = serde_json::to_string(&event).unwrap();
        assert_eq!(
            serde_json::from_str::<StreamEvent>(&encoded).unwrap(),
            event
        );
    }

    #[test]
    fn native_provider_profiles_are_explicit_and_model_limits_are_unknown() {
        assert_eq!(
            serde_json::to_string(&ProviderKind::OpenAi).unwrap(),
            "\"openai\""
        );
        for profile in [
            CapabilityProfile::anthropic_messages(),
            CapabilityProfile::openai_responses(),
        ] {
            assert!(profile.supports(&BTreeSet::from([
                Capability::Tools,
                Capability::ReasoningReplay,
            ])));
            assert_eq!(profile.max_input_tokens, None);
            assert_eq!(profile.max_output_tokens, None);
        }
    }

    #[test]
    fn unknown_usage_is_distinct_from_zero() {
        let unknown = Measurement::<u64>::Unknown {
            reason: "provider omitted usage".into(),
        };
        assert_ne!(unknown, Measurement::Known(0));
        assert!(serde_json::to_string(&unknown).unwrap().contains("unknown"));
    }

    #[test]
    fn retry_is_deterministic_bounded_and_honors_server_delay() {
        let policy = RetryPolicy {
            max_attempts: 4,
            base_delay_ms: 100,
            max_delay_ms: 1_000,
        };
        assert_eq!(
            policy.decide(1, &transient_error(None)),
            RetryDecision::RetryAfter { delay_ms: 100 }
        );
        assert_eq!(
            policy.decide(3, &transient_error(None)),
            RetryDecision::RetryAfter { delay_ms: 400 }
        );
        assert_eq!(
            policy.decide(1, &transient_error(Some(750))),
            RetryDecision::RetryAfter { delay_ms: 750 }
        );
        assert_eq!(
            policy.decide(4, &transient_error(None)),
            RetryDecision::Stop
        );
        let mut permanent = transient_error(None);
        permanent.retryable = false;
        assert_eq!(policy.decide(1, &permanent), RetryDecision::Stop);
        let mut cancelled = transient_error(None);
        cancelled.category = ErrorCategory::Cancelled;
        assert_eq!(policy.decide(1, &cancelled), RetryDecision::Stop);
    }

    #[test]
    fn circuit_opens_at_threshold_and_recovers_after_cooldown() {
        let policy = CircuitBreakerPolicy {
            failure_threshold: 2,
            cooldown_ms: 500,
        };
        let mut circuit = CircuitBreaker::default();
        circuit.record_failure(100, policy);
        assert_eq!(circuit.before_request(101, policy), CircuitDecision::Allow);
        circuit.record_failure(200, policy);
        assert_eq!(
            circuit.before_request(699, policy),
            CircuitDecision::RejectOpen
        );
        assert_eq!(circuit.before_request(700, policy), CircuitDecision::Allow);
        circuit.record_failure(700, policy);
        assert_eq!(
            circuit.before_request(1_199, policy),
            CircuitDecision::RejectOpen
        );
        assert_eq!(
            circuit.before_request(1_200, policy),
            CircuitDecision::Allow
        );
        circuit.record_success();
        assert_eq!(circuit.before_request(201, policy), CircuitDecision::Allow);
    }

    #[test]
    fn fallback_stops_after_output_or_mutation() {
        let candidate = RouteCandidate {
            provider: ProviderKind::Anthropic,
            model: "model-2".into(),
            risk_tier: RiskTier::High,
            capabilities: BTreeSet::from([Capability::Text, Capability::Tools]),
        };
        let required = BTreeSet::from([Capability::Text]);
        assert_eq!(
            authorize_fallback(
                ExecutionProgress {
                    committed_output: true,
                    mutating_side_effect: false
                },
                &candidate,
                RiskTier::Medium,
                &required
            ),
            Err(FallbackDenied::OutputCommitted)
        );
        assert_eq!(
            authorize_fallback(
                ExecutionProgress {
                    committed_output: false,
                    mutating_side_effect: true
                },
                &candidate,
                RiskTier::Medium,
                &required
            ),
            Err(FallbackDenied::MutationCommitted)
        );
    }

    #[test]
    fn fallback_cannot_reduce_assurance_or_capabilities() {
        let mut candidate = RouteCandidate {
            provider: ProviderKind::OpenAi,
            model: "model-3".into(),
            risk_tier: RiskTier::Low,
            capabilities: BTreeSet::from([Capability::Text]),
        };
        let required = BTreeSet::from([Capability::Text, Capability::Reasoning]);
        assert_eq!(
            authorize_fallback(
                ExecutionProgress::default(),
                &candidate,
                RiskTier::High,
                &required
            ),
            Err(FallbackDenied::RiskTierTooLow)
        );
        candidate.risk_tier = RiskTier::High;
        assert_eq!(
            authorize_fallback(
                ExecutionProgress::default(),
                &candidate,
                RiskTier::High,
                &required
            ),
            Err(FallbackDenied::MissingCapabilities)
        );
        candidate.capabilities.insert(Capability::Reasoning);
        assert_eq!(
            authorize_fallback(
                ExecutionProgress::default(),
                &candidate,
                RiskTier::High,
                &required
            ),
            Ok(())
        );
    }

    #[test]
    fn route_ordering_never_overrides_assurance_floor() {
        let cheap_but_weak = RouteCandidate {
            provider: ProviderKind::OpenAi,
            model: "cheap".into(),
            risk_tier: RiskTier::Low,
            capabilities: BTreeSet::from([Capability::Text]),
        };
        let eligible = RouteCandidate {
            provider: ProviderKind::Anthropic,
            model: "eligible".into(),
            risk_tier: RiskTier::High,
            capabilities: BTreeSet::from([Capability::Text, Capability::Reasoning]),
        };
        let candidates = [cheap_but_weak, eligible];
        let selected = select_route(
            &candidates,
            &RouteRequirements {
                risk_tier: RiskTier::High,
                capabilities: BTreeSet::from([Capability::Reasoning]),
            },
        )
        .unwrap();
        assert_eq!(selected.model, "eligible");
    }

    #[test]
    fn usage_ledger_preserves_unknowns_and_rejects_duplicate_requests() {
        fn accounting(request: &str, input: Measurement<u64>) -> UsageAccounting {
            UsageAccounting {
                pricing_catalog_version: "catalog-1".into(),
                pricing_source: "fixture".into(),
                provider_request_id: Measurement::Known(request.into()),
                tokens: TokenUsage {
                    input,
                    output: Measurement::Known(2),
                    cache_read: Measurement::Known(0),
                    cache_write: Measurement::Known(0),
                    reasoning: Measurement::Unknown {
                        reason: "provider omitted reasoning".into(),
                    },
                },
                estimated_cost: Measurement::Unknown {
                    reason: "pricing unavailable".into(),
                },
                provider_reported_cost: Measurement::Known(MoneyMicros {
                    amount_micros: 20,
                    currency: "USD".into(),
                }),
                quota_remaining: Measurement::Unknown {
                    reason: "header omitted".into(),
                },
                quota_reset_at_ms: Measurement::Unknown {
                    reason: "header omitted".into(),
                },
            }
        }
        let mut ledger = UsageLedger::default();
        ledger
            .record(accounting("req-1", Measurement::Known(3)))
            .unwrap();
        ledger
            .record(accounting(
                "req-2",
                Measurement::Unknown {
                    reason: "input omitted".into(),
                },
            ))
            .unwrap();
        let totals = ledger.totals();
        assert_eq!(totals.request_count, 2);
        assert_eq!(
            totals.input_tokens,
            Measurement::Unknown {
                reason: "input omitted".into()
            }
        );
        assert_eq!(totals.output_tokens, Measurement::Known(4));
        assert_eq!(
            totals.provider_reported_cost,
            Measurement::Known(MoneyMicros {
                amount_micros: 40,
                currency: "USD".into()
            })
        );
        assert_eq!(
            ledger.record(accounting("req-1", Measurement::Known(1))),
            Err(UsageLedgerError::DuplicateRequestId("req-1".into()))
        );
    }

    #[test]
    fn usage_ledger_rejects_unsafe_fields_and_has_a_hard_capacity() {
        let accounting = |request: &str| UsageAccounting {
            pricing_catalog_version: "catalog-1".into(),
            pricing_source: "fixture".into(),
            provider_request_id: Measurement::Known(request.into()),
            tokens: TokenUsage {
                input: Measurement::Known(1),
                output: Measurement::Known(1),
                cache_read: Measurement::Known(0),
                cache_write: Measurement::Known(0),
                reasoning: Measurement::Unknown {
                    reason: "not reported".into(),
                },
            },
            estimated_cost: Measurement::Unknown {
                reason: "not priced".into(),
            },
            provider_reported_cost: Measurement::Known(MoneyMicros {
                amount_micros: 1,
                currency: "USD".into(),
            }),
            quota_remaining: Measurement::Unknown {
                reason: "not reported".into(),
            },
            quota_reset_at_ms: Measurement::Unknown {
                reason: "not reported".into(),
            },
        };

        let mut unsafe_entry = accounting("req\nforged");
        assert_eq!(
            UsageLedger::default().record(unsafe_entry.clone()),
            Err(UsageLedgerError::InvalidAccounting)
        );
        unsafe_entry.provider_request_id = Measurement::Known("request".into());
        unsafe_entry.provider_reported_cost = Measurement::Known(MoneyMicros {
            amount_micros: 1,
            currency: "usd".into(),
        });
        assert_eq!(
            UsageLedger::default().record(unsafe_entry),
            Err(UsageLedgerError::InvalidAccounting)
        );

        let mut ledger = UsageLedger {
            entries: vec![accounting("existing"); MAX_USAGE_ENTRIES],
        };
        assert_eq!(
            UsageLedger {
                entries: vec![accounting("duplicate"), accounting("duplicate")]
            }
            .validate(),
            Err(UsageLedgerError::DuplicateRequestId("duplicate".into()))
        );
        assert_eq!(
            ledger.record(accounting("next")),
            Err(UsageLedgerError::CapacityExceeded(MAX_USAGE_ENTRIES))
        );
    }

    #[test]
    fn usage_and_cost_overflow_become_explicitly_unknown() {
        let usage = [Measurement::Known(u64::MAX), Measurement::Known(1)];
        assert_eq!(
            sum_measurements(usage.iter()),
            Measurement::Unknown {
                reason: "usage total overflowed u64".into()
            }
        );
        let cost = [
            Measurement::Known(MoneyMicros {
                amount_micros: u64::MAX,
                currency: "USD".into(),
            }),
            Measurement::Known(MoneyMicros {
                amount_micros: 1,
                currency: "USD".into(),
            }),
        ];
        assert_eq!(
            sum_money(cost.iter()),
            Measurement::Unknown {
                reason: "cost total overflowed u64".into()
            }
        );
    }
}
