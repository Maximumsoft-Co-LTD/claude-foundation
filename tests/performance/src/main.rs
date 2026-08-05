use changeloop_app_server::{ClientQueue, QueueError, ServerPayload};
use changeloop_protocol::{
    CURRENT_PROTOCOL_VERSION, Event, EventCursor, EventEnvelope, EventId, SessionId,
};
use serde_json::json;
use std::time::Instant;

mod mixed;
mod router;
mod shutdown;
mod transport;

const EVENTS: usize = 10_000;
const CAPACITY: usize = 1_024;

#[tokio::main]
async fn main() {
    if let Err(error) = dispatch().await {
        eprintln!("queue probe failed: {error}");
        std::process::exit(1);
    }
}

async fn dispatch() -> Result<(), Box<dyn std::error::Error>> {
    match std::env::args().nth(1).as_deref() {
        None | Some("queue") => run(),
        Some("relay") => transport::run().await,
        Some("router") => router::run().await,
        Some("mixed") => mixed::run().await,
        Some("shutdown") => shutdown::run().await,
        Some("fake-lsp") => shutdown::fake_lsp(),
        Some(command) => Err(format!("unknown performance probe: {command}").into()),
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let session = SessionId::from_stable("queue-probe-v1");
    let mut queue = ClientQueue::new(CAPACITY)?;
    let mut samples_ns = Vec::with_capacity(EVENTS);
    let mut last_frame_sequence = 0_u64;
    for index in 1..=EVENTS {
        let event = envelope(&session, index);
        let started = Instant::now();
        queue.enqueue_event(event)?;
        let frame = queue.pop().ok_or("enqueued frame was silently dropped")?;
        samples_ns.push(started.elapsed().as_nanos() as u64);
        if frame.sequence != last_frame_sequence + 1 {
            return Err(format!("frame sequence jumped at event {index}").into());
        }
        match frame.payload {
            ServerPayload::Event(event) if event.id.0 == format!("queue-event-{index:08}") => {}
            _ => return Err(format!("event {index} was reordered or replaced").into()),
        }
        last_frame_sequence = frame.sequence;
    }

    let mut full = ClientQueue::new(CAPACITY)?;
    for index in 1..=CAPACITY {
        full.enqueue_event(envelope(&session, index))?;
    }
    let backpressure = full.enqueue_event(envelope(&session, CAPACITY + 1));
    if backpressure
        != Err(QueueError::Backpressure {
            capacity: CAPACITY,
            disconnect_required: true,
        })
    {
        return Err("full queue did not require disconnect and cursor replay".into());
    }
    if full.len() != CAPACITY {
        return Err("backpressure mutated the full queue".into());
    }

    println!(
        "{}",
        serde_json::to_string(&json!({
            "recordVersion": 1,
            "probe": "client-queue-relay",
            "workloadVersion": "client-queue-v1",
            "events": EVENTS,
            "capacity": CAPACITY,
            "samplesNs": samples_ns,
            "correctness": {
                "delivered": EVENTS,
                "silentDrops": 0,
                "ordered": true,
                "backpressureSignalsDisconnect": true
            },
            "scope": "in-process client queue; transport callback latency requires transport fixtures"
        }))?
    );
    Ok(())
}

fn envelope(session: &SessionId, sequence: usize) -> EventEnvelope {
    EventEnvelope {
        protocol_version: CURRENT_PROTOCOL_VERSION,
        id: EventId::from_stable(format!("queue-event-{sequence:08}")),
        cursor: EventCursor(format!("e:{sequence:020}")),
        session_id: session.clone(),
        emitted_at_ms: sequence as u64,
        event: Event::Heartbeat,
    }
}
