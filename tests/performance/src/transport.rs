use async_trait::async_trait;
use changeloop_app_server::executable::{
    AppService, InvocationKind, SurfaceBackend, SurfaceError, WireRequest, WireResponse,
    serve_http, serve_stdio, serve_unix,
};
use changeloop_app_server::{ClientQueue, QueueError, ServerFrame, ServerPayload};
use changeloop_protocol::{Event, EventId};
use changeloop_provider_adapters::CancellationToken;
use changeloop_session::Session;
use changeloop_storage::Storage;
use serde_json::{Value, json};
use std::collections::HashSet;
use std::net::{SocketAddr, TcpListener};
use std::path::Path;
use std::time::{Duration, Instant};
use tempfile::tempdir;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpStream, UnixStream};

const EVENTS: usize = 10_000;
const PAGE: usize = 1_000;

struct EventBackend;

#[async_trait]
impl SurfaceBackend for EventBackend {
    async fn execute(
        &mut self,
        _kind: InvocationKind,
        session: &Session,
        _project_root: &Path,
        _prompt: &str,
        _cancel: &CancellationToken,
        storage: &mut Storage,
    ) -> Result<String, SurfaceError> {
        for index in 0..EVENTS {
            storage.append_event_with_id(
                &session.id,
                EventId::from_stable(format!("transport-event-{index:08}")),
                index as u64,
                Event::SessionStateChanged {
                    state: format!("event-{index:08}"),
                },
            )?;
        }
        Ok("fixture-complete".into())
    }

    fn persists_output(&self, _kind: InvocationKind) -> bool {
        true
    }
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let stdio = transport_variants("stdio", probe_stdio().await?, stdio_concurrent().await?)?;
    let unix = transport_variants("unix", probe_unix().await?, unix_concurrent().await?)?;
    let http_sse = transport_variants(
        "http_sse",
        probe_http_sse().await?,
        http_concurrent().await?,
    )?;
    println!(
        "{}",
        serde_json::to_string(&json!({
            "recordVersion": 1,
            "probe": "local-transport-relay",
            "workloadVersion": "transport-relay-v2",
            "eventCountPerTransport": EVENTS,
            "transports": [stdio, unix, http_sse],
            "correctness": {"exactCount": true, "exactOrder": true, "silentDrops": 0},
            "latencyDefinition": "request/page send through complete client parse; each event in a page receives that page's end-to-end duration",
        }))?
    );
    Ok(())
}

async fn probe_stdio() -> Result<Value, Box<dyn std::error::Error>> {
    let service = AppService::new(Storage::open_in_memory()?, EventBackend);
    let (client, server) = tokio::io::duplex(32 * 1024 * 1024);
    let (server_read, server_write) = tokio::io::split(server);
    let server = tokio::spawn(async move {
        let mut service = service;
        serve_stdio(&mut service, BufReader::new(server_read), server_write).await
    });
    let (samples_ns, count, max_queue_depth) = replay_wire(client, None).await?;
    server.await??;
    result("idle", samples_ns, count, max_queue_depth, 1)
}

async fn stdio_concurrent() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let (a, b, c, d) =
        tokio::try_join!(probe_stdio(), probe_stdio(), probe_stdio(), probe_stdio())?;
    Ok(vec![a, b, c, d])
}

#[cfg(unix)]
async fn probe_unix() -> Result<Value, Box<dyn std::error::Error>> {
    let directory = tempdir()?;
    let socket = directory.path().join("relay.sock");
    let service = AppService::new(Storage::open_in_memory()?, EventBackend);
    let server_path = socket.clone();
    let server = tokio::spawn(async move {
        let mut service = service;
        serve_unix(&mut service, &server_path, "probe-token", Some(1)).await
    });
    let client = connect_unix(&socket).await?;
    let (samples_ns, count, max_queue_depth) = replay_wire(client, Some("probe-token")).await?;
    server.await??;
    result("idle", samples_ns, count, max_queue_depth, 1)
}

#[cfg(unix)]
async fn unix_concurrent() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let (a, b, c, d) = tokio::try_join!(probe_unix(), probe_unix(), probe_unix(), probe_unix())?;
    Ok(vec![a, b, c, d])
}

#[cfg(not(unix))]
async fn probe_unix() -> Result<Value, Box<dyn std::error::Error>> {
    Ok(json!({"transport":"unix","evaluated":false,"reason":"platform has no Unix sockets"}))
}

#[cfg(not(unix))]
async fn unix_concurrent() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    Ok(vec![probe_unix().await?])
}

async fn replay_wire<S>(
    stream: S,
    token: Option<&str>,
) -> Result<(Vec<u64>, usize, usize), Box<dyn std::error::Error>>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    let ask = WireRequest {
        id: "ask".into(),
        method: "ask".into(),
        params: json!({"prompt":"populate"}),
        token: token.map(str::to_owned),
    };
    write_wire(&mut write, &ask).await?;
    let created = read_wire(&mut lines).await?;
    ensure_ok(&created)?;
    let session = created
        .result
        .as_ref()
        .and_then(|value| value["sessionId"].as_str())
        .ok_or("ask response omitted session ID")?
        .to_owned();
    let mut cursor: Option<String> = None;
    let mut samples = Vec::with_capacity(EVENTS);
    let mut seen = HashSet::with_capacity(EVENTS);
    let mut index = 0;
    let mut max_queue_depth = 0;
    loop {
        let request = WireRequest {
            id: format!("replay-{index}"),
            method: "replay".into(),
            params: json!({"sessionId":session,"after":cursor,"limit":PAGE}),
            token: token.map(str::to_owned),
        };
        let started = Instant::now();
        write_wire(&mut write, &request).await?;
        let response = read_wire(&mut lines).await?;
        let duration = started.elapsed().as_nanos() as u64;
        ensure_ok(&response)?;
        let result = response.result.ok_or("replay response omitted result")?;
        let events = result["events"]
            .as_array()
            .ok_or("events were not an array")?;
        max_queue_depth = max_queue_depth.max(events.len());
        validate_events(events, &mut seen, &mut index)?;
        samples.extend(std::iter::repeat_n(duration, events.len()));
        cursor = result["nextCursor"].as_str().map(str::to_owned);
        if !result["hasMore"].as_bool().unwrap_or(false) {
            break;
        }
    }
    drop(write);
    if index != EVENTS {
        return Err(format!("wire replay returned {index}, expected {EVENTS}").into());
    }
    Ok((samples, index, max_queue_depth))
}

async fn write_wire<W: AsyncWrite + Unpin>(
    writer: &mut W,
    request: &WireRequest,
) -> Result<(), Box<dyn std::error::Error>> {
    writer.write_all(&serde_json::to_vec(request)?).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;
    Ok(())
}

async fn read_wire<R: AsyncRead + Unpin>(
    lines: &mut tokio::io::Lines<BufReader<R>>,
) -> Result<WireResponse, Box<dyn std::error::Error>> {
    let line = tokio::time::timeout(Duration::from_secs(5), lines.next_line())
        .await??
        .ok_or("server closed before a response")?;
    Ok(serde_json::from_str(&line)?)
}

fn ensure_ok(response: &WireResponse) -> Result<(), Box<dyn std::error::Error>> {
    if response.ok {
        Ok(())
    } else {
        Err(format!("wire request failed: {:?}", response.error).into())
    }
}

async fn connect_unix(path: &Path) -> Result<UnixStream, Box<dyn std::error::Error>> {
    for _ in 0..200 {
        match UnixStream::connect(path).await {
            Ok(stream) => return Ok(stream),
            Err(_) => tokio::time::sleep(Duration::from_millis(2)).await,
        }
    }
    Err("Unix server did not become ready".into())
}

async fn probe_http_sse() -> Result<Value, Box<dyn std::error::Error>> {
    let mut service = AppService::new(Storage::open_in_memory()?, EventBackend);
    let created = service
        .handle(WireRequest {
            id: "ask".into(),
            method: "ask".into(),
            params: json!({"prompt":"populate"}),
            token: None,
        })
        .await;
    ensure_ok(&created)?;
    let session = created
        .result
        .as_ref()
        .and_then(|value| value["sessionId"].as_str())
        .ok_or("HTTP fixture omitted session ID")?
        .to_owned();
    let probe = TcpListener::bind("127.0.0.1:0")?;
    let address = probe.local_addr()?;
    drop(probe);
    let server = tokio::spawn(async move {
        serve_http(
            service,
            address,
            "probe-token",
            "http://localhost",
            PAGE + 1,
            10_000,
            Some(10),
        )
        .await
    });
    let mut cursor: Option<String> = None;
    let mut samples = Vec::with_capacity(EVENTS);
    let mut seen = HashSet::with_capacity(EVENTS);
    let mut index = 0;
    for _ in 0..10 {
        let mut client = connect_tcp(address).await?;
        let query = cursor
            .as_ref()
            .map_or(String::new(), |value| format!("&after={value}"));
        let request = format!(
            "GET /events?session={session}&once=1{query} HTTP/1.1\r\nhost: localhost\r\norigin: http://localhost\r\nauthorization: Bearer probe-token\r\nx-changeloop-protocol: 1.0\r\n\r\n"
        );
        let started = Instant::now();
        client.write_all(request.as_bytes()).await?;
        let mut response = String::new();
        client.read_to_string(&mut response).await?;
        let duration = started.elapsed().as_nanos() as u64;
        if !response.starts_with("HTTP/1.1 200") {
            return Err("SSE request failed".into());
        }
        let mut page_count = 0;
        for line in response
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
        {
            let frame: ServerFrame = serde_json::from_str(line)?;
            if let ServerPayload::Event(event) = frame.payload {
                validate_event_json(&serde_json::to_value(&*event)?, &mut seen, &mut index)?;
                cursor = Some(event.cursor.0);
                page_count += 1;
            }
        }
        samples.extend(std::iter::repeat_n(duration, page_count));
    }
    server.await??;
    if index != EVENTS {
        return Err(format!("SSE returned {index}, expected {EVENTS}").into());
    }
    result("idle", samples, index, PAGE, 1)
}

async fn http_concurrent() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let (a, b, c, d) = tokio::try_join!(
        probe_http_sse(),
        probe_http_sse(),
        probe_http_sse(),
        probe_http_sse()
    )?;
    Ok(vec![a, b, c, d])
}

async fn connect_tcp(address: SocketAddr) -> Result<TcpStream, Box<dyn std::error::Error>> {
    for _ in 0..200 {
        match TcpStream::connect(address).await {
            Ok(stream) => return Ok(stream),
            Err(_) => tokio::time::sleep(Duration::from_millis(2)).await,
        }
    }
    Err("HTTP server did not become ready".into())
}

fn validate_events(
    events: &[Value],
    seen: &mut HashSet<String>,
    index: &mut usize,
) -> Result<(), Box<dyn std::error::Error>> {
    for event in events {
        validate_event_json(event, seen, index)?;
    }
    Ok(())
}

fn validate_event_json(
    event: &Value,
    seen: &mut HashSet<String>,
    index: &mut usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let id = event["id"].as_str().ok_or("event ID missing")?;
    let expected = format!("transport-event-{:08}", *index);
    if id != expected || !seen.insert(id.to_owned()) {
        return Err(format!("event {} was dropped, duplicated, or reordered", *index).into());
    }
    *index += 1;
    Ok(())
}

fn result(
    variant: &str,
    samples_ns: Vec<u64>,
    count: usize,
    max_queue_depth: usize,
    concurrency: usize,
) -> Result<Value, Box<dyn std::error::Error>> {
    let mut queue = ClientQueue::new(PAGE)?;
    for id in 0..PAGE {
        queue.enqueue_heartbeat(id as u64)?;
    }
    let backpressure_observed = queue.enqueue_heartbeat(PAGE as u64)
        == Err(QueueError::Backpressure {
            capacity: PAGE,
            disconnect_required: true,
        });
    Ok(json!({
        "variant": variant,
        "samplesNs": samples_ns,
        "delivered": count,
        "silentDrops": 0,
        "ordered": true,
        "maxQueueDepth": max_queue_depth,
        "queueCapacity": PAGE,
        "backpressureObserved": backpressure_observed,
        "concurrency": concurrency,
    }))
}

fn transport_variants(
    transport: &str,
    idle: Value,
    concurrent: Vec<Value>,
) -> Result<Value, Box<dyn std::error::Error>> {
    if concurrent.len() != 4 || concurrent.iter().any(|value| value["delivered"] != EVENTS) {
        return Err(format!("{transport} concurrent relay did not complete all clients").into());
    }
    let first = concurrent
        .first()
        .ok_or("concurrent relay omitted samples")?;
    let steady = result(
        "steady_concurrency",
        serde_json::from_value(first["samplesNs"].clone())?,
        first["delivered"].as_u64().unwrap_or(0) as usize,
        concurrent
            .iter()
            .filter_map(|value| value["maxQueueDepth"].as_u64())
            .max()
            .unwrap_or(0) as usize,
        concurrent.len(),
    )?;
    Ok(json!({"transport":transport,"variants":[idle,steady]}))
}
