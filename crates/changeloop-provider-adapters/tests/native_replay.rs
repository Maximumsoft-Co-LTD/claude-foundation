use async_trait::async_trait;
use changeloop_provider::{
    InputMessage, InputPart, InputRole, Measurement, NormalizedRequest, OpaqueReasoning,
    ProviderKind, ReasoningIdentity, ReasoningPart, StreamEvent, ToolDefinition,
};
use changeloop_provider_adapters::{
    AdapterError, AnthropicAdapter, AuthProfile, CancellationToken, HttpRequest, HttpResponse,
    HttpTransport, OpenAiAdapter, ProviderAdapter, TransportError,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u16,
    fixture_kind: String,
    network_allowed: bool,
    cases: Vec<FixtureCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    id: String,
    provider: String,
    request_path: String,
    request_sha256: String,
    response_path: String,
    response_sha256: String,
    status: u16,
    headers: BTreeMap<String, String>,
    expected: Value,
}

struct RecordedTransport {
    response: HttpResponse,
    request: Mutex<Option<HttpRequest>>,
}

#[async_trait]
impl HttpTransport for RecordedTransport {
    async fn send(
        &self,
        request: HttpRequest,
        cancel: &CancellationToken,
    ) -> Result<HttpResponse, TransportError> {
        if cancel.is_cancelled() {
            return Err(TransportError::Cancelled);
        }
        *self.request.lock().unwrap() = Some(request);
        Ok(self.response.clone())
    }
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native")
}

fn fixture_path(root: &Path, relative: &str) -> PathBuf {
    let relative = Path::new(relative);
    assert!(
        relative
            .components()
            .all(|component| matches!(component, Component::Normal(_))),
        "fixture path must remain relative and traversal-free"
    );
    root.join(relative)
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn provider(name: &str) -> ProviderKind {
    match name {
        "anthropic" => ProviderKind::Anthropic,
        "openai" => ProviderKind::OpenAi,
        other => panic!("unsupported fixture provider {other}"),
    }
}

/// The identity the fixture credential and model would issue reasoning under.
/// Reasoning state only survives a request build when it matches, so the
/// fixture must construct it the same way the adapter does.
fn fixture_identity(provider: ProviderKind) -> ReasoningIdentity {
    AuthProfile::explicit(provider, "fixture-key")
        .unwrap()
        .reasoning_identity("fixture-model")
}

fn request(provider: ProviderKind) -> NormalizedRequest {
    let identity = fixture_identity(provider);
    let (tool_id, reasoning_replay, request_replay) = match provider {
        ProviderKind::Anthropic => (
            "toolu_previous",
            OpaqueReasoning::anthropic(identity.clone(), "signature_previous"),
            OpaqueReasoning::anthropic(identity, "signature_previous"),
        ),
        ProviderKind::OpenAi => (
            "call_previous",
            OpaqueReasoning::openai(
                identity.clone(),
                "resp_previous",
                vec!["rs_previous".into()],
            ),
            OpaqueReasoning::openai(identity, "resp_previous", vec!["rs_previous".into()]),
        ),
    };
    NormalizedRequest {
        operation_id: "native-replay-fixture".into(),
        model: "fixture-model".into(),
        messages: vec![
            InputMessage::new(
                InputRole::System,
                vec![InputPart::Text {
                    text: "system policy".into(),
                }],
            ),
            InputMessage::new(
                InputRole::Developer,
                vec![InputPart::Text {
                    text: "developer policy".into(),
                }],
            ),
            InputMessage::new(
                InputRole::User,
                vec![InputPart::Text {
                    text: "question".into(),
                }],
            ),
            InputMessage::new(
                InputRole::Assistant,
                vec![
                    InputPart::Text {
                        text: "prior answer".into(),
                    },
                    InputPart::Reasoning(ReasoningPart::new(
                        "private thought",
                        Some(reasoning_replay),
                    )),
                    InputPart::ToolCall {
                        id: tool_id.into(),
                        name: "lookup".into(),
                        arguments: json!({"q":"old"}),
                    },
                ],
            ),
            InputMessage::new(
                InputRole::Tool,
                vec![InputPart::ToolResult {
                    id: tool_id.into(),
                    output: json!({"result":"old"}),
                    is_error: false,
                }],
            ),
        ],
        tools: vec![ToolDefinition {
            name: "lookup".into(),
            description: "look up a value".into(),
            input_schema: json!({"type":"object"}),
            mutating: false,
        }],
        max_output_tokens: Some(321),
        replay: vec![request_replay],
    }
}

fn known(measurement: &Measurement<u64>) -> Option<u64> {
    match measurement {
        Measurement::Known(value) => Some(*value),
        Measurement::Unknown { .. } => None,
    }
}

fn assert_success(case: &FixtureCase, events: &[StreamEvent]) {
    let expected = &case.expected;
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::OutputDelta { text } if Some(text.as_str()) == expected["text"].as_str()
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::ReasoningDelta { text, .. }
            if Some(text.as_str()) == expected["reasoning"].as_str()
    )));
    let kind = provider(&case.provider);
    let identity = fixture_identity(kind);
    let expected_replay = match kind {
        ProviderKind::Anthropic => OpaqueReasoning::anthropic(
            identity,
            expected["reasoningReplay"].as_str().unwrap_or_default(),
        ),
        ProviderKind::OpenAi => OpaqueReasoning::openai(
            identity,
            expected["responseId"].as_str().unwrap_or_default(),
            vec![
                expected["reasoningReplay"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
            ],
        ),
    };
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::ReasoningDelta { replay: Some(replay), .. } if replay == &expected_replay
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::ToolCallStarted { id, name }
            if Some(id.as_str()) == expected["toolCallId"].as_str()
                && Some(name.as_str()) == expected["toolName"].as_str()
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        StreamEvent::ToolCallCompleted { id, arguments }
            if Some(id.as_str()) == expected["toolCallId"].as_str()
                && arguments["q"] == "new"
    )));
    let accounting = events
        .iter()
        .find_map(|event| match event {
            StreamEvent::Usage { accounting } => Some(accounting),
            _ => None,
        })
        .expect("usage event");
    assert_eq!(
        known(&accounting.tokens.input),
        expected["inputTokens"].as_u64()
    );
    assert_eq!(
        known(&accounting.tokens.output),
        expected["outputTokens"].as_u64()
    );
    assert_eq!(
        known(&accounting.tokens.cache_read),
        expected["cacheReadTokens"].as_u64()
    );
    if let Some(reasoning) = expected["reasoningTokens"].as_u64() {
        assert_eq!(known(&accounting.tokens.reasoning), Some(reasoning));
    }
    assert!(matches!(
        &accounting.provider_request_id,
        Measurement::Known(value)
            if Some(value.as_str()) == expected["requestId"].as_str()
    ));
    assert_eq!(
        known(&accounting.quota_remaining),
        expected["quotaRemaining"].as_u64()
    );
    assert_eq!(
        known(&accounting.quota_reset_at_ms),
        expected["quotaResetAtMs"].as_u64()
    );
    let completed = events
        .iter()
        .find(|event| matches!(event, StreamEvent::Completed { .. }))
        .expect("completion event");
    let completed = serde_json::to_value(completed).unwrap();
    assert_eq!(completed["data"]["response_id"], expected["responseId"]);
    assert_eq!(completed["data"]["finish_reason"], expected["finishReason"]);
}

fn assert_error(case: &FixtureCase, error: AdapterError) {
    let AdapterError::Provider(error) = error else {
        panic!("{} returned non-provider error: {error}", case.id);
    };
    let encoded = serde_json::to_value(&error).unwrap();
    assert_eq!(encoded["category"], case.expected["errorCategory"]);
    assert_eq!(encoded["code"], case.expected["errorCode"]);
    assert_eq!(encoded["provider_request_id"], case.expected["requestId"]);
    assert_eq!(encoded["retryable"], case.expected["retryable"]);
    if case.expected.get("retryAfterMs").is_some() {
        assert_eq!(encoded["retry_after_ms"], case.expected["retryAfterMs"]);
    }
}

#[tokio::test]
async fn native_recorded_fixture_manifest_replays_without_network() {
    let root = fixture_root();
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.fixture_kind, "synthetic");
    assert!(!manifest.network_allowed);
    let mut ids = BTreeSet::new();
    let mut coverage = BTreeSet::new();

    for case in manifest.cases {
        assert!(ids.insert(case.id.clone()), "duplicate fixture {}", case.id);
        coverage.insert((
            case.provider.clone(),
            case.expected["terminal"].as_str().unwrap().to_owned(),
        ));
        let kind = provider(&case.provider);
        let request_bytes = fs::read(fixture_path(&root, &case.request_path)).unwrap();
        assert_eq!(sha256(&request_bytes), case.request_sha256);
        let expected_request: Value = serde_json::from_slice(&request_bytes).unwrap();
        let response = fs::read(fixture_path(&root, &case.response_path)).unwrap();
        assert_eq!(sha256(&response), case.response_sha256);
        let transport = RecordedTransport {
            response: HttpResponse {
                status: case.status,
                headers: case.headers.clone(),
                body: response,
            },
            request: Mutex::new(None),
        };
        let adapter: Box<dyn ProviderAdapter> = match kind {
            ProviderKind::Anthropic => Box::new(AnthropicAdapter::default()),
            ProviderKind::OpenAi => Box::new(OpenAiAdapter::default()),
        };
        let result = adapter
            .execute_once(
                &request(kind),
                &AuthProfile::explicit(kind, "fixture-key").unwrap(),
                &transport,
                &CancellationToken::default(),
            )
            .await;
        let captured = transport.request.lock().unwrap().take().unwrap();
        assert_eq!(captured.headers["accept"], "application/json");
        assert_eq!(
            serde_json::from_slice::<Value>(&captured.body).unwrap(),
            expected_request
        );
        if case.expected["terminal"] == "success" {
            assert_success(&case, &result.unwrap());
        } else {
            assert_error(&case, result.unwrap_err());
        }
    }
    for provider in ["anthropic", "openai"] {
        for terminal in ["success", "error"] {
            assert!(coverage.contains(&(provider.into(), terminal.into())));
        }
    }
}
