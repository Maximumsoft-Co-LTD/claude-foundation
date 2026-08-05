use async_trait::async_trait;
use changeloop_provider::{
    Capability, ExecutionProgress, InputMessage, InputPart, InputRole, NormalizedRequest,
    ProviderKind, RiskTier, RouteCandidate, RouteRequirements, StreamEvent, ToolDefinition,
};
use changeloop_provider_adapters::{
    AnthropicAdapter, AuthProfile, CancellationToken, HttpRequest, HttpResponse,
    HttpStreamResponse, HttpTransport, OpenAiAdapter, PricingCatalog, ProviderAdapter,
    ProviderRouter, RouterRoute, TransportError,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const REPETITIONS: usize = 30;
const UPSTREAM_DELAY_MS: u64 = 20;
const LARGE_PAYLOAD_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy)]
enum Payload {
    Short,
    Long,
    Tool,
    Large,
}

#[derive(Clone, Copy)]
struct CaseSpec {
    id: &'static str,
    provider: ProviderKind,
    payload: Payload,
}

const SUPPORTED_CASES: [CaseSpec; 8] = [
    CaseSpec {
        id: "openai-short-streaming",
        provider: ProviderKind::OpenAi,
        payload: Payload::Short,
    },
    CaseSpec {
        id: "openai-long-streaming",
        provider: ProviderKind::OpenAi,
        payload: Payload::Long,
    },
    CaseSpec {
        id: "openai-tool-streaming",
        provider: ProviderKind::OpenAi,
        payload: Payload::Tool,
    },
    CaseSpec {
        id: "openai-large-streaming",
        provider: ProviderKind::OpenAi,
        payload: Payload::Large,
    },
    CaseSpec {
        id: "anthropic-short-streaming",
        provider: ProviderKind::Anthropic,
        payload: Payload::Short,
    },
    CaseSpec {
        id: "anthropic-long-streaming",
        provider: ProviderKind::Anthropic,
        payload: Payload::Long,
    },
    CaseSpec {
        id: "anthropic-tool-streaming",
        provider: ProviderKind::Anthropic,
        payload: Payload::Tool,
    },
    CaseSpec {
        id: "anthropic-large-streaming",
        provider: ProviderKind::Anthropic,
        payload: Payload::Large,
    },
];

#[derive(Default)]
struct DelayedTransport {
    requests: AtomicU64,
    case: Mutex<Option<CaseSpec>>,
}

impl DelayedTransport {
    fn select(&self, case: CaseSpec) {
        *self
            .case
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(case);
    }

    fn selected(&self) -> Result<CaseSpec, TransportError> {
        self.case
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .ok_or_else(|| TransportError::Http("router fixture case was not selected".into()))
    }
}

#[async_trait]
impl HttpTransport for DelayedTransport {
    async fn send(
        &self,
        _request: HttpRequest,
        cancel: &CancellationToken,
    ) -> Result<HttpResponse, TransportError> {
        let case = self.selected()?;
        tokio::select! {
            () = tokio::time::sleep(Duration::from_millis(UPSTREAM_DELAY_MS)) => {},
            _ = wait_cancel(cancel) => return Err(TransportError::Cancelled),
        }
        // A direct/routed pair receives the same stable fixture response ID,
        // while successive routed requests remain unique for ledger replay checks.
        let request_id = self.requests.fetch_add(1, Ordering::Relaxed) / 2;
        let body = fixture_body(case, request_id);
        Ok(HttpResponse {
            status: 200,
            headers: BTreeMap::new(),
            body: body.into_bytes(),
        })
    }

    async fn send_stream(
        &self,
        request: HttpRequest,
        cancel: &CancellationToken,
    ) -> Result<HttpStreamResponse, TransportError> {
        let response = self.send(request, cancel).await?;
        let chunk_size = (response.body.len() / 4).max(1);
        let chunks = response
            .body
            .chunks(chunk_size)
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>();
        let (sender, receiver) = tokio::sync::mpsc::channel(chunks.len().max(1));
        for chunk in chunks {
            sender
                .send(Ok(chunk))
                .await
                .map_err(|_| TransportError::Http("fixture stream receiver closed".into()))?;
        }
        Ok(HttpStreamResponse {
            status: response.status,
            headers: response.headers,
            chunks: receiver,
        })
    }
}

async fn wait_cancel(cancel: &CancellationToken) {
    while !cancel.is_cancelled() {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let transport = Arc::new(DelayedTransport::default());
    let mut cases = Vec::new();
    let mut direct_ns = Vec::new();
    let mut routed_ns = Vec::new();
    for case in SUPPORTED_CASES {
        let measured = measure_case(case, transport.clone()).await?;
        direct_ns.extend(
            measured["directSamplesNs"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|v| v.as_u64()),
        );
        routed_ns.extend(
            measured["routedSamplesNs"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|v| v.as_u64()),
        );
        cases.push(measured);
    }
    for provider in [ProviderKind::OpenAi, ProviderKind::Anthropic] {
        cases.push(json!({
            "caseId": format!("{}-non-streaming", provider_name(provider)),
            "provider": provider_name(provider),
            "scenario": "non_streaming",
            "delivery": "non_streaming",
            "supported": false,
            "reason": "native MVP adapters currently request provider SSE only",
            "repetitions": 0,
            "directSamplesNs": [],
            "routedSamplesNs": [],
            "correctness": {"identicalProviderEvents": false, "attempts": 0},
        }));
    }
    let direct_total: u128 = direct_ns.iter().map(|value| u128::from(*value)).sum();
    let routed_total: u128 = routed_ns.iter().map(|value| u128::from(*value)).sum();
    let overhead_ratio = (routed_total as f64 - direct_total as f64) / direct_total as f64;
    let supported_passed = cases
        .iter()
        .filter(|case| case["supported"] == true)
        .all(|case| {
            case["correctness"]["identicalProviderEvents"] == true
                && case["aggregateOverheadRatio"]
                    .as_f64()
                    .is_some_and(|ratio| ratio < 0.05)
        });
    println!(
        "{}",
        serde_json::to_string(&json!({
            "recordVersion": 2,
            "probe": "provider-router-overhead",
            "workloadVersion": "dual-provider-router-matrix-v2",
            "repetitions": REPETITIONS,
            "upstreamDelayMs": UPSTREAM_DELAY_MS,
            "order": "deterministic alternating paired direct/routed",
            "fixtureScope": "bounded hermetic adapter/router comparison; not upstream provider performance",
            "cases": cases,
            "coverageComplete": false,
            "coverageGaps": ["openai-non-streaming", "anthropic-non-streaming"],
            "directSamplesNs": direct_ns,
            "routedSamplesNs": routed_ns,
            "aggregateOverheadRatio": overhead_ratio,
            "thresholdRatio": 0.05,
            "passed": supported_passed && overhead_ratio < 0.05,
            "releaseEligible": false,
            "correctness": {"identicalProviderEvents": true, "attempts": 1},
            "retryBackoffNs": 0,
        }))?
    );
    Ok(())
}

async fn measure_case(
    case: CaseSpec,
    transport: Arc<DelayedTransport>,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    transport.select(case);
    let adapter: Arc<dyn ProviderAdapter> = match case.provider {
        ProviderKind::OpenAi => Arc::new(OpenAiAdapter::default()),
        ProviderKind::Anthropic => Arc::new(AnthropicAdapter::default()),
    };
    let auth = AuthProfile::explicit(case.provider, "fixture-key")?;
    let route_capabilities = BTreeSet::from([Capability::Text, Capability::Tools]);
    let router = ProviderRouter::new(
        vec![RouterRoute {
            candidate: RouteCandidate {
                provider: case.provider,
                model: "fixture-model".into(),
                risk_tier: RiskTier::High,
                capabilities: route_capabilities.clone(),
            },
            adapter: adapter.clone(),
            auth: auth.clone(),
        }],
        transport.clone(),
        PricingCatalog::default(),
    );
    let is_tool = matches!(case.payload, Payload::Tool);
    let request = NormalizedRequest {
        operation_id: case.id.into(),
        model: "fixture-model".into(),
        messages: vec![InputMessage {
            role: InputRole::User,
            parts: vec![InputPart::Text {
                text: "hello".into(),
            }],
        }],
        tools: if is_tool {
            vec![ToolDefinition {
                name: "lookup".into(),
                description: "fixture lookup".into(),
                input_schema: json!({"type":"object"}),
                mutating: false,
            }]
        } else {
            vec![]
        },
        max_output_tokens: Some(if matches!(case.payload, Payload::Large) {
            65_536
        } else {
            4_096
        }),
        replay: vec![],
    };
    let requirements = RouteRequirements {
        risk_tier: RiskTier::High,
        capabilities: if is_tool {
            BTreeSet::from([Capability::Text, Capability::Tools])
        } else {
            BTreeSet::from([Capability::Text])
        },
    };
    let mut direct_ns = Vec::with_capacity(REPETITIONS);
    let mut routed_ns = Vec::with_capacity(REPETITIONS);
    for index in 0..REPETITIONS {
        let (direct_result, routed_result) = if index % 2 == 0 {
            let direct = direct(adapter.as_ref(), &request, &auth, transport.as_ref()).await?;
            let routed = routed(&router, &request, &requirements).await?;
            (direct, routed)
        } else {
            let routed = routed(&router, &request, &requirements).await?;
            let direct = direct(adapter.as_ref(), &request, &auth, transport.as_ref()).await?;
            (direct, routed)
        };
        ensure_equivalent(&direct_result.1, &routed_result.1)?;
        direct_ns.push(direct_result.0);
        routed_ns.push(routed_result.0);
    }
    let direct_total: u128 = direct_ns.iter().map(|value| u128::from(*value)).sum();
    let routed_total: u128 = routed_ns.iter().map(|value| u128::from(*value)).sum();
    let ratio = (routed_total as f64 - direct_total as f64) / direct_total as f64;
    Ok(json!({
        "caseId": case.id,
        "provider": provider_name(case.provider),
        "scenario": payload_name(case.payload),
        "delivery": "streaming",
        "supported": true,
        "repetitions": REPETITIONS,
        "payloadBytes": payload_bytes(case.payload),
        "directSamplesNs": direct_ns,
        "routedSamplesNs": routed_ns,
        "aggregateOverheadRatio": ratio,
        "correctness": {"identicalProviderEvents": true, "attempts": 1},
    }))
}

async fn direct(
    adapter: &dyn ProviderAdapter,
    request: &NormalizedRequest,
    auth: &AuthProfile,
    transport: &DelayedTransport,
) -> Result<(u64, Vec<StreamEvent>), Box<dyn std::error::Error>> {
    let started = Instant::now();
    let events = adapter
        .execute_once(request, auth, transport, &CancellationToken::default())
        .await?;
    if events.is_empty() {
        return Err("direct adapter returned no events".into());
    }
    Ok((started.elapsed().as_nanos() as u64, events))
}

async fn routed(
    router: &ProviderRouter,
    request: &NormalizedRequest,
    requirements: &RouteRequirements,
) -> Result<(u64, Vec<StreamEvent>), Box<dyn std::error::Error>> {
    let started = Instant::now();
    let outcome = router
        .execute(
            request,
            requirements,
            ExecutionProgress::default(),
            &CancellationToken::default(),
        )
        .await?;
    if outcome.events.is_empty() || outcome.attempts != 1 {
        return Err("routed result was incorrect".into());
    }
    Ok((started.elapsed().as_nanos() as u64, outcome.events))
}

fn provider_name(provider: ProviderKind) -> &'static str {
    match provider {
        ProviderKind::OpenAi => "openai",
        ProviderKind::Anthropic => "anthropic",
    }
}

fn payload_name(payload: Payload) -> &'static str {
    match payload {
        Payload::Short => "short_response",
        Payload::Long => "long_response",
        Payload::Tool => "tool_call",
        Payload::Large => "large_payload",
    }
}

fn payload_bytes(payload: Payload) -> usize {
    match payload {
        Payload::Short => 2,
        Payload::Long => 16 * 1024,
        Payload::Tool => 2,
        Payload::Large => LARGE_PAYLOAD_BYTES,
    }
}

fn fixture_body(case: CaseSpec, request_id: u64) -> String {
    let response_id = format!("fixture-response-{request_id}");
    if matches!(case.payload, Payload::Tool) {
        return match case.provider {
            ProviderKind::OpenAi => format!(
                "data: {{\"type\":\"response.output_item.added\",\"item\":{{\"type\":\"function_call\",\"id\":\"call_1\",\"name\":\"lookup\"}}}}\n\ndata: {{\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"call_1\",\"delta\":\"{{\"}}\n\ndata: {{\"type\":\"response.function_call_arguments.done\",\"item_id\":\"call_1\",\"arguments\":\"{{}}\"}}\n\ndata: {{\"type\":\"response.completed\",\"response\":{{\"id\":\"{response_id}\",\"usage\":{{\"input_tokens\":1,\"output_tokens\":1}}}}}}\n\n"
            ),
            ProviderKind::Anthropic => format!(
                "event: message_start\ndata: {{\"type\":\"message_start\",\"message\":{{\"id\":\"{response_id}\",\"usage\":{{\"input_tokens\":1,\"output_tokens\":1}}}}}}\n\nevent: content_block_start\ndata: {{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"lookup\"}}}}\n\nevent: content_block_delta\ndata: {{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{{\"type\":\"input_json_delta\",\"partial_json\":\"{{}}\"}}}}\n\nevent: content_block_stop\ndata: {{\"type\":\"content_block_stop\",\"index\":0}}\n\nevent: message_delta\ndata: {{\"type\":\"message_delta\",\"delta\":{{\"stop_reason\":\"tool_use\"}},\"usage\":{{\"output_tokens\":1}}}}\n\nevent: message_stop\ndata: {{\"type\":\"message_stop\"}}\n\n"
            ),
        };
    }
    let text = match case.payload {
        Payload::Short => "ok".into(),
        Payload::Long => "l".repeat(16 * 1024),
        Payload::Large => "x".repeat(LARGE_PAYLOAD_BYTES),
        Payload::Tool => unreachable!(),
    };
    let text = serde_json::to_string(&text).expect("fixture text is serializable");
    match case.provider {
        ProviderKind::OpenAi => format!(
            "data: {{\"type\":\"response.output_text.delta\",\"delta\":{text}}}\n\ndata: {{\"type\":\"response.completed\",\"response\":{{\"id\":\"{response_id}\",\"usage\":{{\"input_tokens\":1,\"output_tokens\":1}}}}}}\n\n"
        ),
        ProviderKind::Anthropic => format!(
            "event: message_start\ndata: {{\"type\":\"message_start\",\"message\":{{\"id\":\"{response_id}\",\"usage\":{{\"input_tokens\":1,\"output_tokens\":1}}}}}}\n\nevent: content_block_delta\ndata: {{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{{\"type\":\"text_delta\",\"text\":{text}}}}}\n\nevent: message_delta\ndata: {{\"type\":\"message_delta\",\"delta\":{{\"stop_reason\":\"end_turn\"}},\"usage\":{{\"output_tokens\":1}}}}\n\nevent: message_stop\ndata: {{\"type\":\"message_stop\"}}\n\n"
        ),
    }
}

fn ensure_equivalent(
    direct: &[StreamEvent],
    routed: &[StreamEvent],
) -> Result<(), Box<dyn std::error::Error>> {
    let stable = |events: &[StreamEvent]| {
        events
            .iter()
            .filter(|event| !matches!(event, StreamEvent::Usage { .. }))
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
    };
    if stable(direct)? != stable(routed)? {
        return Err("direct and routed provider events differ".into());
    }
    Ok(())
}

pub(crate) async fn cancellation_sample() -> Result<u64, Box<dyn std::error::Error>> {
    let token = CancellationToken::default();
    let task_token = token.clone();
    let task = tokio::spawn(async move {
        let adapter = Arc::new(OpenAiAdapter::default());
        let auth = AuthProfile::explicit(ProviderKind::OpenAi, "fixture-key").unwrap();
        let capabilities = BTreeSet::from([Capability::Text]);
        let router = ProviderRouter::new(
            vec![RouterRoute {
                candidate: RouteCandidate {
                    provider: ProviderKind::OpenAi,
                    model: "fixture-model".into(),
                    risk_tier: RiskTier::High,
                    capabilities: capabilities.clone(),
                },
                adapter,
                auth,
            }],
            Arc::new(DelayedTransport::default()),
            PricingCatalog::default(),
        );
        let request = NormalizedRequest {
            operation_id: "cancel".into(),
            model: "fixture-model".into(),
            messages: vec![],
            tools: vec![],
            max_output_tokens: None,
            replay: vec![],
        };
        router
            .execute(
                &request,
                &RouteRequirements {
                    risk_tier: RiskTier::High,
                    capabilities,
                },
                ExecutionProgress::default(),
                &task_token,
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(2)).await;
    let started = Instant::now();
    token.cancel();
    let result = tokio::time::timeout(Duration::from_secs(2), task).await??;
    if result.is_ok() {
        return Err("cancelled provider unexpectedly completed".into());
    }
    Ok(started.elapsed().as_nanos() as u64)
}
