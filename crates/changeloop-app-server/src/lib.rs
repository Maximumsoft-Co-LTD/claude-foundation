//! Pure app-server protocol policy. No listener, socket, or HTTP implementation lives here.

pub mod executable;
pub mod pause_control;

use changeloop_protocol::{
    EventCursor, EventEnvelope, EventId, NegotiationError, ProtocolVersion, SessionId, negotiate,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet, VecDeque};
use thiserror::Error;

pub const MAX_REPLAY_PAGE_SIZE: usize = 1_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportKind {
    Stdio,
    UnixSocket,
    HttpSse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Maturity {
    Experimental,
    Beta,
    Stable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportOffer {
    pub kind: TransportKind,
    pub maturity: Maturity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServerPolicy {
    pub protocol: ProtocolVersion,
    pub transports: Vec<TransportOffer>,
    pub local_auth_token: String,
    /// Exact serialized origins; wildcard and prefix matching are intentionally absent.
    pub allowed_origins: BTreeSet<String>,
    pub queue_capacity: usize,
    pub replay_page_size: usize,
    pub heartbeat_interval_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientHello {
    pub protocol: ProtocolVersion,
    pub transport: TransportKind,
    pub minimum_maturity: Maturity,
    pub local_auth_token: Option<String>,
    pub origin: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NegotiatedConnection {
    pub protocol: ProtocolVersion,
    pub transport: TransportKind,
    pub maturity: Maturity,
    pub authenticated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum CompatibilityError {
    #[error("client and server protocol major versions are incompatible")]
    ProtocolMajor,
    #[error("requested transport is not enabled")]
    TransportUnavailable,
    #[error("transport maturity is below the client's required maturity")]
    MaturityUnavailable,
    #[error("local authentication is required outside stdio")]
    AuthenticationRequired,
    #[error("local authentication failed")]
    AuthenticationFailed,
    #[error("HTTP origin is missing or not exactly allowed")]
    OriginDenied,
    #[error("connection metadata is invalid for this transport")]
    InvalidTransportMetadata,
    #[error("server is shutting down")]
    ServerDraining,
}

pub fn negotiate_connection(
    policy: &ServerPolicy,
    hello: &ClientHello,
    accepting_connections: bool,
) -> Result<NegotiatedConnection, CompatibilityError> {
    if !accepting_connections {
        return Err(CompatibilityError::ServerDraining);
    }
    let protocol = negotiate(policy.protocol, hello.protocol).map_err(|error| match error {
        NegotiationError::IncompatibleMajor { .. } => CompatibilityError::ProtocolMajor,
    })?;
    let offer = policy
        .transports
        .iter()
        .find(|offer| offer.kind == hello.transport)
        .ok_or(CompatibilityError::TransportUnavailable)?;
    if offer.maturity < hello.minimum_maturity {
        return Err(CompatibilityError::MaturityUnavailable);
    }
    match hello.transport {
        TransportKind::Stdio => {
            if hello.local_auth_token.is_some() || hello.origin.is_some() {
                return Err(CompatibilityError::InvalidTransportMetadata);
            }
        }
        TransportKind::UnixSocket => {
            authenticate(policy, hello)?;
            if hello.origin.is_some() {
                return Err(CompatibilityError::InvalidTransportMetadata);
            }
        }
        TransportKind::HttpSse => {
            authenticate(policy, hello)?;
            let origin = hello
                .origin
                .as_ref()
                .ok_or(CompatibilityError::OriginDenied)?;
            if !policy.allowed_origins.contains(origin) {
                return Err(CompatibilityError::OriginDenied);
            }
        }
    }
    Ok(NegotiatedConnection {
        protocol: protocol.version,
        transport: hello.transport,
        maturity: offer.maturity,
        authenticated: hello.transport == TransportKind::Stdio
            || hello.local_auth_token.as_ref() == Some(&policy.local_auth_token),
    })
}

fn authenticate(policy: &ServerPolicy, hello: &ClientHello) -> Result<(), CompatibilityError> {
    match hello.local_auth_token.as_ref() {
        None => Err(CompatibilityError::AuthenticationRequired),
        Some(token) if token != &policy.local_auth_token => {
            Err(CompatibilityError::AuthenticationFailed)
        }
        Some(_) => Ok(()),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerPayload {
    Event(Box<EventEnvelope>),
    Heartbeat {
        emitted_at_ms: u64,
        last_cursor: Option<EventCursor>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServerFrame {
    /// Monotonic per-connection frame sequence; persisted events retain their global cursor.
    pub sequence: u64,
    pub payload: ServerPayload,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum QueueError {
    #[error("client queue capacity must be greater than zero")]
    InvalidCapacity,
    #[error("client queue is full; disconnect and replay are required")]
    Backpressure {
        capacity: usize,
        disconnect_required: bool,
    },
    #[error("event cursor is invalid or not newer than the previous event")]
    NonMonotonicCursor,
    #[error("event ID was already queued for this client")]
    DuplicateEvent,
}

pub struct ClientQueue {
    capacity: usize,
    next_sequence: u64,
    frames: VecDeque<ServerFrame>,
    event_ids: HashSet<EventId>,
    last_cursor: Option<EventCursor>,
}

impl ClientQueue {
    pub fn new(capacity: usize) -> Result<Self, QueueError> {
        if capacity == 0 {
            return Err(QueueError::InvalidCapacity);
        }
        Ok(Self {
            capacity,
            next_sequence: 1,
            frames: VecDeque::with_capacity(capacity),
            event_ids: HashSet::new(),
            last_cursor: None,
        })
    }

    pub fn enqueue_event(&mut self, event: EventEnvelope) -> Result<(), QueueError> {
        if self.event_ids.contains(&event.id) {
            return Err(QueueError::DuplicateEvent);
        }
        let sequence = cursor_sequence(&event.cursor).ok_or(QueueError::NonMonotonicCursor)?;
        if self
            .last_cursor
            .as_ref()
            .and_then(cursor_sequence)
            .is_some_and(|previous| sequence <= previous)
        {
            return Err(QueueError::NonMonotonicCursor);
        }
        self.ensure_capacity()?;
        self.last_cursor = Some(event.cursor.clone());
        self.event_ids.insert(event.id.clone());
        self.push(ServerPayload::Event(Box::new(event)));
        Ok(())
    }

    pub fn enqueue_heartbeat(&mut self, emitted_at_ms: u64) -> Result<(), QueueError> {
        self.ensure_capacity()?;
        self.push(ServerPayload::Heartbeat {
            emitted_at_ms,
            last_cursor: self.last_cursor.clone(),
        });
        Ok(())
    }

    /// Seeds a reconnect cursor without enqueueing a synthetic event. This
    /// keeps heartbeat cursors and subsequent monotonicity checks continuous
    /// across replay pages.
    pub fn resume_after(&mut self, cursor: Option<EventCursor>) -> Result<(), QueueError> {
        if cursor
            .as_ref()
            .is_some_and(|cursor| cursor_sequence(cursor).is_none())
        {
            return Err(QueueError::NonMonotonicCursor);
        }
        self.last_cursor = cursor;
        Ok(())
    }

    pub fn pop(&mut self) -> Option<ServerFrame> {
        let frame = self.frames.pop_front()?;
        if let ServerPayload::Event(event) = &frame.payload {
            self.event_ids.remove(&event.id);
        }
        Some(frame)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.frames.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    fn ensure_capacity(&self) -> Result<(), QueueError> {
        if self.frames.len() >= self.capacity {
            Err(QueueError::Backpressure {
                capacity: self.capacity,
                disconnect_required: true,
            })
        } else {
            Ok(())
        }
    }

    fn push(&mut self, payload: ServerPayload) {
        self.frames.push_back(ServerFrame {
            sequence: self.next_sequence,
            payload,
        });
        self.next_sequence = self.next_sequence.saturating_add(1);
    }
}

fn cursor_sequence(cursor: &EventCursor) -> Option<u64> {
    cursor.0.strip_prefix("e:")?.parse().ok()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReconnectRequest {
    pub session_id: SessionId,
    pub after_cursor: Option<EventCursor>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplayPlan {
    pub session_id: SessionId,
    /// Passed directly to storage's exclusive `after` cursor.
    pub after_cursor: Option<EventCursor>,
    pub page_size: usize,
    pub attach_live_after_replay: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ReplayPlanError {
    #[error("replay page size must be between 1 and 1000")]
    InvalidPageSize,
    #[error("reconnect cursor is malformed")]
    InvalidCursor,
}

pub fn plan_reconnect(
    request: ReconnectRequest,
    page_size: usize,
) -> Result<ReplayPlan, ReplayPlanError> {
    if !(1..=MAX_REPLAY_PAGE_SIZE).contains(&page_size) {
        return Err(ReplayPlanError::InvalidPageSize);
    }
    if request
        .after_cursor
        .as_ref()
        .is_some_and(|cursor| cursor_sequence(cursor).is_none())
    {
        return Err(ReplayPlanError::InvalidCursor);
    }
    Ok(ReplayPlan {
        session_id: request.session_id,
        after_cursor: request.after_cursor,
        page_size,
        attach_live_after_replay: true,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeaderState {
    Vacant,
    Leader { server_id: String, endpoint: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeaderDisposition {
    Acquired,
    ConnectToLeader { endpoint: String },
    FailWithRecovery { leader_id: String },
}

pub struct LeaderContract {
    state: LeaderState,
}

impl Default for LeaderContract {
    fn default() -> Self {
        Self {
            state: LeaderState::Vacant,
        }
    }
}

impl LeaderContract {
    pub fn claim(
        &mut self,
        server_id: &str,
        endpoint: &str,
        can_connect: bool,
    ) -> LeaderDisposition {
        match &self.state {
            LeaderState::Vacant => {
                self.state = LeaderState::Leader {
                    server_id: server_id.into(),
                    endpoint: endpoint.into(),
                };
                LeaderDisposition::Acquired
            }
            LeaderState::Leader {
                server_id: leader_id,
                endpoint,
            } if leader_id == server_id => LeaderDisposition::Acquired,
            LeaderState::Leader {
                server_id: leader_id,
                endpoint,
            } if can_connect => LeaderDisposition::ConnectToLeader {
                endpoint: endpoint.clone(),
            },
            LeaderState::Leader {
                server_id: leader_id,
                ..
            } => LeaderDisposition::FailWithRecovery {
                leader_id: leader_id.clone(),
            },
        }
    }

    pub fn release(&mut self, server_id: &str) -> bool {
        if matches!(&self.state, LeaderState::Leader { server_id: owner, .. } if owner == server_id)
        {
            self.state = LeaderState::Vacant;
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShutdownState {
    Running,
    Draining {
        deadline_ms: u64,
        pending_resources: usize,
    },
    ForcedCleanup {
        forced_at_ms: u64,
        pending_resources: usize,
    },
    Stopped {
        stopped_at_ms: u64,
        forced: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShutdownAction {
    Wait,
    ForceCleanup,
    Complete,
}

pub struct ShutdownMachine {
    pub state: ShutdownState,
}

impl Default for ShutdownMachine {
    fn default() -> Self {
        Self {
            state: ShutdownState::Running,
        }
    }
}

impl ShutdownMachine {
    pub fn begin(&mut self, now_ms: u64, timeout_ms: u64, pending_resources: usize) {
        if self.state != ShutdownState::Running {
            return;
        }
        self.state = ShutdownState::Draining {
            deadline_ms: now_ms.saturating_add(timeout_ms),
            pending_resources,
        };
    }

    #[must_use]
    pub fn accepting_connections(&self) -> bool {
        self.state == ShutdownState::Running
    }

    pub fn resource_released(&mut self) {
        match &mut self.state {
            ShutdownState::Draining {
                pending_resources, ..
            }
            | ShutdownState::ForcedCleanup {
                pending_resources, ..
            } => {
                *pending_resources = pending_resources.saturating_sub(1);
            }
            _ => {}
        }
    }

    pub fn poll(&mut self, now_ms: u64) -> ShutdownAction {
        match self.state {
            ShutdownState::Draining {
                pending_resources: 0,
                ..
            } => {
                self.state = ShutdownState::Stopped {
                    stopped_at_ms: now_ms,
                    forced: false,
                };
                ShutdownAction::Complete
            }
            ShutdownState::Draining {
                deadline_ms,
                pending_resources,
            } if now_ms >= deadline_ms => {
                self.state = ShutdownState::ForcedCleanup {
                    forced_at_ms: now_ms,
                    pending_resources,
                };
                ShutdownAction::ForceCleanup
            }
            ShutdownState::ForcedCleanup {
                pending_resources: 0,
                ..
            } => {
                self.state = ShutdownState::Stopped {
                    stopped_at_ms: now_ms,
                    forced: true,
                };
                ShutdownAction::Complete
            }
            ShutdownState::Stopped { .. } => ShutdownAction::Complete,
            _ => ShutdownAction::Wait,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_protocol::{CURRENT_PROTOCOL_VERSION, Event};

    fn policy() -> ServerPolicy {
        ServerPolicy {
            protocol: CURRENT_PROTOCOL_VERSION,
            transports: vec![
                TransportOffer {
                    kind: TransportKind::Stdio,
                    maturity: Maturity::Stable,
                },
                TransportOffer {
                    kind: TransportKind::UnixSocket,
                    maturity: Maturity::Stable,
                },
                TransportOffer {
                    kind: TransportKind::HttpSse,
                    maturity: Maturity::Beta,
                },
            ],
            local_auth_token: "secret".into(),
            allowed_origins: BTreeSet::from(["http://127.0.0.1:3210".into()]),
            queue_capacity: 2,
            replay_page_size: 100,
            heartbeat_interval_ms: 10_000,
        }
    }

    fn hello(transport: TransportKind) -> ClientHello {
        ClientHello {
            protocol: CURRENT_PROTOCOL_VERSION,
            transport,
            minimum_maturity: Maturity::Beta,
            local_auth_token: None,
            origin: None,
        }
    }

    fn event(sequence: u64, id: &str) -> EventEnvelope {
        EventEnvelope {
            protocol_version: CURRENT_PROTOCOL_VERSION,
            id: EventId::from_stable(id),
            cursor: EventCursor(format!("e:{sequence:020}")),
            session_id: SessionId::from_stable("s"),
            emitted_at_ms: sequence,
            event: Event::Heartbeat,
        }
    }

    #[test]
    fn stdio_needs_no_auth_but_local_transports_do() {
        assert!(negotiate_connection(&policy(), &hello(TransportKind::Stdio), true).is_ok());
        assert_eq!(
            negotiate_connection(&policy(), &hello(TransportKind::UnixSocket), true),
            Err(CompatibilityError::AuthenticationRequired)
        );
        let mut unix = hello(TransportKind::UnixSocket);
        unix.local_auth_token = Some("secret".into());
        assert!(negotiate_connection(&policy(), &unix, true).is_ok());
    }

    #[test]
    fn http_origin_is_exact_and_maturity_is_negotiated() {
        let mut http = hello(TransportKind::HttpSse);
        http.local_auth_token = Some("secret".into());
        http.origin = Some("http://127.0.0.1:3210.evil".into());
        assert_eq!(
            negotiate_connection(&policy(), &http, true),
            Err(CompatibilityError::OriginDenied)
        );
        http.origin = Some("http://127.0.0.1:3210".into());
        assert_eq!(
            negotiate_connection(&policy(), &http, true)
                .unwrap()
                .maturity,
            Maturity::Beta
        );
        http.minimum_maturity = Maturity::Stable;
        assert_eq!(
            negotiate_connection(&policy(), &http, true),
            Err(CompatibilityError::MaturityUnavailable)
        );
    }

    #[test]
    fn protocol_compatibility_and_draining_fail_explicitly() {
        let mut request = hello(TransportKind::Stdio);
        request.protocol.major += 1;
        assert_eq!(
            negotiate_connection(&policy(), &request, true),
            Err(CompatibilityError::ProtocolMajor)
        );
        assert_eq!(
            negotiate_connection(&policy(), &hello(TransportKind::Stdio), false),
            Err(CompatibilityError::ServerDraining)
        );
    }

    #[test]
    fn queue_orders_events_and_heartbeats_and_reports_backpressure() {
        let mut queue = ClientQueue::new(2).unwrap();
        queue.enqueue_event(event(1, "one")).unwrap();
        queue.enqueue_heartbeat(2).unwrap();
        assert_eq!(
            queue.enqueue_event(event(2, "two")),
            Err(QueueError::Backpressure {
                capacity: 2,
                disconnect_required: true
            })
        );
        assert_eq!(queue.pop().unwrap().sequence, 1);
        assert_eq!(queue.pop().unwrap().sequence, 2);
        queue.enqueue_event(event(2, "two")).unwrap();
        assert_eq!(
            queue.enqueue_event(event(2, "three")),
            Err(QueueError::NonMonotonicCursor)
        );
    }

    #[test]
    fn reconnect_uses_exclusive_storage_cursor_then_live() {
        let cursor = EventCursor("e:00000000000000000042".into());
        let plan = plan_reconnect(
            ReconnectRequest {
                session_id: SessionId::from_stable("s"),
                after_cursor: Some(cursor.clone()),
            },
            100,
        )
        .unwrap();
        assert_eq!(plan.after_cursor, Some(cursor));
        assert!(plan.attach_live_after_replay);
        assert_eq!(
            plan_reconnect(
                ReconnectRequest {
                    session_id: SessionId::from_stable("s"),
                    after_cursor: Some(EventCursor("bad".into()))
                },
                100
            ),
            Err(ReplayPlanError::InvalidCursor)
        );
    }

    #[test]
    fn slow_client_queue_stays_bounded_and_sequences_remain_monotonic_across_pages() {
        let mut queue = ClientQueue::new(4).unwrap();
        queue
            .resume_after(Some(EventCursor("e:00000000000000000000".into())))
            .unwrap();
        let mut previous_frame = 0;
        for sequence in 1..=10_000 {
            queue
                .enqueue_event(event(sequence, &format!("event-{sequence}")))
                .unwrap();
            if sequence % 3 == 0 {
                queue.enqueue_heartbeat(sequence).unwrap();
            }
            while let Some(frame) = queue.pop() {
                assert!(frame.sequence > previous_frame);
                previous_frame = frame.sequence;
            }
            assert!(queue.len() <= 4);
        }
        assert_eq!(previous_frame, 13_333);
    }

    #[test]
    fn heartbeat_without_event_cursor_has_no_reconnect_cursor() {
        let mut queue = ClientQueue::new(2).unwrap();
        queue.enqueue_heartbeat(1).unwrap();
        let frame = queue.pop().unwrap();
        assert!(matches!(
            frame.payload,
            ServerPayload::Heartbeat {
                last_cursor: None,
                ..
            }
        ));
    }

    #[test]
    fn one_leader_is_acquired_or_reused_without_expiry_authority() {
        let mut leader = LeaderContract::default();
        assert_eq!(
            leader.claim("one", "/tmp/cloop.sock", true),
            LeaderDisposition::Acquired
        );
        assert_eq!(
            leader.claim("two", "/tmp/other.sock", true),
            LeaderDisposition::ConnectToLeader {
                endpoint: "/tmp/cloop.sock".into()
            }
        );
        assert_eq!(
            leader.claim("two", "/tmp/other.sock", false),
            LeaderDisposition::FailWithRecovery {
                leader_id: "one".into()
            }
        );
        assert!(!leader.release("two"));
        assert!(leader.release("one"));
    }

    #[test]
    fn shutdown_drains_then_forces_at_deadline() {
        let mut graceful = ShutdownMachine::default();
        graceful.begin(100, 50, 1);
        assert!(!graceful.accepting_connections());
        assert_eq!(graceful.poll(120), ShutdownAction::Wait);
        graceful.resource_released();
        assert_eq!(graceful.poll(121), ShutdownAction::Complete);
        assert_eq!(
            graceful.state,
            ShutdownState::Stopped {
                stopped_at_ms: 121,
                forced: false
            }
        );

        let mut forced = ShutdownMachine::default();
        forced.begin(100, 50, 1);
        assert_eq!(forced.poll(150), ShutdownAction::ForceCleanup);
        forced.resource_released();
        assert_eq!(forced.poll(151), ShutdownAction::Complete);
        assert_eq!(
            forced.state,
            ShutdownState::Stopped {
                stopped_at_ms: 151,
                forced: true
            }
        );
    }
}
