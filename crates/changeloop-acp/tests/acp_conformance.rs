//! End-to-end ACP conformance for the facade.
//!
//! Every test drives [`Connection::handle_line`], the same entry point the
//! stdio loop uses, so nothing here proves a property that a real client would
//! not also exercise.

use changeloop_acp::connection::{AgentConfig, Connection, IdSource, TurnStep};
use changeloop_acp::jsonrpc::{
    Outgoing, PROTOCOL_VERSION_MISMATCH, RequestId, ResponseOutcome, SESSION_NOT_FOUND,
};
use changeloop_acp::schema::{PermissionOption, PermissionOptionKind, StopReason};
use changeloop_acp::testing::ScriptedDriver;
use changeloop_protocol::{
    BASE_PART_SCHEMA_VERSION, MessagePart, MessagePartBody, OperationId, PartId, PartState,
    Provenance, ToolCallId,
};
use serde_json::{Value, json};

// ------------------------------------------------------------------ helpers

fn connection(script: Vec<TurnStep>) -> Connection<ScriptedDriver> {
    Connection::new(
        ScriptedDriver::new(script),
        AgentConfig {
            id_source: IdSource::Sequential {
                prefix: "test".into(),
            },
            ..AgentConfig::default()
        },
    )
}

fn request(id: i64, method: &str, params: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string()
}

fn notification(method: &str, params: Value) -> String {
    json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

/// The single response in `frames`, or a panic naming what was found instead.
fn response(frames: &[Outgoing]) -> (RequestId, ResponseOutcome) {
    let found: Vec<&Outgoing> = frames
        .iter()
        .filter(|frame| matches!(frame, Outgoing::Response(_)))
        .collect();
    assert_eq!(found.len(), 1, "expected one response, got {frames:?}");
    match found[0] {
        Outgoing::Response(response) => (response.id.clone(), response.outcome.clone()),
        other => panic!("expected a response, got {other:?}"),
    }
}

fn result(frames: &[Outgoing]) -> Value {
    match response(frames).1 {
        ResponseOutcome::Result(value) => value,
        ResponseOutcome::Error(error) => panic!("expected success, got {error:?}"),
    }
}

fn error_code(frames: &[Outgoing]) -> i64 {
    match response(frames).1 {
        ResponseOutcome::Error(error) => error.code,
        ResponseOutcome::Result(value) => panic!("expected an error, got {value}"),
    }
}

fn notifications(frames: &[Outgoing]) -> Vec<Value> {
    frames
        .iter()
        .filter_map(|frame| match frame {
            Outgoing::Notification(notification) => notification.params.clone(),
            _ => None,
        })
        .collect()
}

fn outbound_requests(frames: &[Outgoing]) -> Vec<(RequestId, String, Value)> {
    frames
        .iter()
        .filter_map(|frame| match frame {
            Outgoing::Request(request) => Some((
                request.id.clone(),
                request.method.clone(),
                request.params.clone().unwrap_or(Value::Null),
            )),
            _ => None,
        })
        .collect()
}

fn text_part(id: &str, text: &str) -> TurnStep {
    TurnStep::Emit(Box::new(MessagePart {
        schema_version: BASE_PART_SCHEMA_VERSION,
        id: PartId::from_stable(id),
        state: PartState::Completed,
        provenance: Provenance::ModelGenerated,
        body: MessagePartBody::Text { text: text.into() },
    }))
}

fn tool_call_part(id: &str, tool_call_id: &str, name: &str) -> TurnStep {
    TurnStep::Emit(Box::new(MessagePart {
        schema_version: BASE_PART_SCHEMA_VERSION,
        id: PartId::from_stable(id),
        state: PartState::Running,
        provenance: Provenance::ModelGenerated,
        body: MessagePartBody::ToolCall {
            tool_call_id: ToolCallId::from_stable(tool_call_id),
            name: name.into(),
            arguments: json!({ "path": "src/lib.rs" }),
        },
    }))
}

fn permission_step(tool_call_id: &str) -> TurnStep {
    TurnStep::RequestPermission {
        tool_call_id: ToolCallId::from_stable(tool_call_id),
        title: "write src/lib.rs".into(),
        options: vec![
            PermissionOption {
                option_id: "allow".into(),
                name: "Allow".into(),
                kind: PermissionOptionKind::AllowOnce,
            },
            PermissionOption {
                option_id: "reject".into(),
                name: "Reject".into(),
                kind: PermissionOptionKind::RejectOnce,
            },
        ],
    }
}

/// Initialize and open a session, returning its ACP session id.
fn open_session(connection: &mut Connection<ScriptedDriver>) -> String {
    let frames = connection.handle_line(&request(1, "initialize", json!({ "protocolVersion": 1 })));
    assert_eq!(result(&frames)["protocolVersion"], json!(1));
    let frames = connection.handle_line(&request(2, "session/new", json!({ "cwd": "/repo" })));
    result(&frames)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned()
}

// --------------------------------------------------------------- negotiation

#[test]
fn version_negotiation_picks_exactly_one_version_and_refuses_to_mix() {
    let mut connection = connection(Vec::new());

    // Nothing is answered before a version exists.
    let frames = connection.handle_line(&request(1, "session/new", json!({ "cwd": "/repo" })));
    assert_eq!(
        error_code(&frames),
        changeloop_acp::jsonrpc::NOT_INITIALIZED
    );
    assert_eq!(connection.negotiated_version(), None);

    let frames = connection.handle_line(&request(2, "initialize", json!({ "protocolVersion": 1 })));
    assert_eq!(result(&frames)["protocolVersion"], json!(1));
    assert_eq!(connection.negotiated_version(), Some(1));

    // A second initialize would silently replace the negotiated version.
    let frames = connection.handle_line(&request(3, "initialize", json!({ "protocolVersion": 0 })));
    assert_eq!(error_code(&frames), PROTOCOL_VERSION_MISMATCH);
    assert_eq!(connection.negotiated_version(), Some(1));

    // A later message naming a different version is refused, not served at
    // whichever version it claims.
    let frames = connection.handle_line(&request(
        4,
        "session/new",
        json!({ "cwd": "/repo", "protocolVersion": 0 }),
    ));
    assert_eq!(error_code(&frames), PROTOCOL_VERSION_MISMATCH);

    // Naming the negotiated version, or naming none, is fine.
    let frames = connection.handle_line(&request(
        5,
        "session/new",
        json!({ "cwd": "/repo", "protocolVersion": 1 }),
    ));
    assert!(result(&frames)["sessionId"].is_string());
}

#[test]
fn a_newer_client_is_answered_with_one_supported_version_never_a_blend() {
    let mut connection = connection(Vec::new());
    let frames =
        connection.handle_line(&request(1, "initialize", json!({ "protocolVersion": 99 })));
    let value = result(&frames);
    assert_eq!(
        value["protocolVersion"],
        json!(changeloop_acp::latest_supported_version())
    );
    assert_eq!(value["_meta"]["cloop"]["downgraded"], json!(true));
    assert_eq!(
        connection.negotiated_version(),
        Some(changeloop_acp::latest_supported_version())
    );
}

// ------------------------------------------------------------------ framing

#[test]
fn a_malformed_request_yields_a_json_rpc_error_rather_than_a_panic() {
    let mut connection = connection(Vec::new());
    for line in [
        "",
        "{",
        "[]",
        "null",
        "{\"jsonrpc\":\"2.0\"}",
        "{\"jsonrpc\":\"3.0\",\"id\":1,\"method\":\"initialize\"}",
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":\"nope\"}",
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
        "{\"jsonrpc\":\"2.0\",\"id\":{\"weird\":true},\"method\":\"initialize\"}",
    ] {
        let frames = connection.handle_line(line);
        assert!(
            frames
                .iter()
                .all(|frame| matches!(frame, Outgoing::Response(_))),
            "{line} produced non-response frames: {frames:?}"
        );
        if !frames.is_empty() {
            assert!(error_code(&frames) < 0, "{line}");
        }
    }
    // The connection is still usable after every one of those.
    let frames = connection.handle_line(&request(9, "initialize", json!({ "protocolVersion": 1 })));
    assert_eq!(result(&frames)["protocolVersion"], json!(1));
}

#[test]
fn an_unknown_method_returns_method_not_found_and_an_unknown_notification_is_silent() {
    let mut connection = connection(Vec::new());
    connection.handle_line(&request(1, "initialize", json!({ "protocolVersion": 1 })));

    let frames = connection.handle_line(&request(2, "session/teleport", json!({})));
    assert_eq!(
        error_code(&frames),
        changeloop_acp::jsonrpc::METHOD_NOT_FOUND
    );

    // JSON-RPC forbids answering a notification, known or not.
    assert!(
        connection
            .handle_line(&notification("session/teleport", json!({})))
            .is_empty()
    );
}

#[test]
fn unknown_params_do_not_destroy_the_request() {
    let mut connection = connection(Vec::new());
    let frames = connection.handle_line(&request(
        1,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": { "fs": { "readTextFile": true }, "hologram": 7 },
            "futureField": { "nested": [1, 2, 3] },
        }),
    ));
    assert_eq!(result(&frames)["protocolVersion"], json!(1));

    let frames = connection.handle_line(&request(
        2,
        "session/new",
        json!({ "cwd": "/repo", "mcpServers": [], "tomorrow": "value" }),
    ));
    let session_id = result(&frames)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let frames = connection.handle_line(&request(
        3,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "hello" }],
            "unheardOfKnob": true,
        }),
    ));
    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));
}

#[test]
fn an_unknown_content_block_is_refused_rather_than_silently_dropped() {
    let mut connection = connection(Vec::new());
    let session_id = open_session(&mut connection);
    let frames = connection.handle_line(&request(
        3,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [
                { "type": "text", "text": "keep" },
                { "type": "hologram", "frames": 3 },
            ],
        }),
    ));
    assert_eq!(
        error_code(&frames),
        changeloop_acp::jsonrpc::INVALID_PARAMS,
        "a prompt the agent cannot fully represent must not be answered anyway"
    );
}

#[test]
fn an_unknown_session_is_named_not_invented() {
    let mut connection = connection(Vec::new());
    connection.handle_line(&request(1, "initialize", json!({ "protocolVersion": 1 })));
    let frames = connection.handle_line(&request(
        2,
        "session/prompt",
        json!({ "sessionId": "ghost", "prompt": [{ "type": "text", "text": "hi" }] }),
    ));
    assert_eq!(error_code(&frames), SESSION_NOT_FOUND);
}

// -------------------------------------------------------------- prompt turns

#[test]
fn a_prompt_turn_streams_updates_with_stable_message_and_part_ids() {
    let mut connection = connection(vec![
        text_part("part-a", "thinking about it"),
        tool_call_part("part-b", "call-1", "read_file"),
        text_part("part-c", "done"),
        TurnStep::Finish(StopReason::EndTurn),
    ]);
    let session_id = open_session(&mut connection);
    let frames = connection.handle_line(&request(
        3,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "go" }] }),
    ));

    let updates = notifications(&frames);
    assert_eq!(updates.len(), 3, "{updates:?}");
    let tags: Vec<&str> = updates
        .iter()
        .map(|update| {
            update["update"]["sessionUpdate"]
                .as_str()
                .unwrap_or_default()
        })
        .collect();
    assert_eq!(
        tags,
        vec!["agent_message_chunk", "tool_call", "agent_message_chunk"]
    );

    // Every chunk names the message it belongs to, so a client never has to
    // infer a boundary from two consecutive same-type updates.
    let message_ids: Vec<&str> = updates
        .iter()
        .map(|update| {
            update["_meta"]["cloop"]["messageId"]
                .as_str()
                .unwrap_or_default()
        })
        .collect();
    assert_eq!(
        message_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        1
    );
    let part_ids: Vec<&str> = updates
        .iter()
        .map(|update| {
            update["_meta"]["cloop"]["partId"]
                .as_str()
                .unwrap_or_default()
        })
        .collect();
    assert_eq!(part_ids, vec!["part-a", "part-b", "part-c"]);
    assert_eq!(
        updates[1]["update"]["toolCallId"],
        json!("call-1"),
        "the tool call id crosses the boundary unchanged"
    );

    let value = result(&frames);
    assert_eq!(value["stopReason"], json!("end_turn"));
    assert_eq!(value["_meta"]["cloop"]["messageId"], json!(message_ids[0]));

    // The ids streamed are the ids stored: correlation survives the boundary.
    let transcript = connection.transcript(&session_id).expect("a transcript");
    let stored = transcript
        .entries()
        .last()
        .expect("an agent message")
        .message
        .clone();
    assert_eq!(stored.id.0, message_ids[0]);
    assert_eq!(
        stored
            .parts
            .iter()
            .map(|part| part.id.0.clone())
            .collect::<Vec<_>>(),
        part_ids
    );
}

#[test]
fn a_part_with_no_acp_shape_is_stored_and_reported_never_flattened() {
    let mut connection = connection(vec![
        TurnStep::Emit(Box::new(MessagePart {
            schema_version: BASE_PART_SCHEMA_VERSION,
            id: PartId::from_stable("part-patch"),
            state: PartState::Completed,
            provenance: Provenance::ModelGenerated,
            body: MessagePartBody::Patch {
                operation_id: OperationId::from_stable("op-1"),
                patch: "@@ -1 +1 @@".into(),
            },
        })),
        text_part("part-text", "and here is why"),
        TurnStep::Finish(StopReason::EndTurn),
    ]);
    let session_id = open_session(&mut connection);
    let frames = connection.handle_line(&request(
        3,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "patch it" }] }),
    ));

    // One part streamed, two parts stored.
    assert_eq!(notifications(&frames).len(), 1);
    let transcript = connection.transcript(&session_id).expect("a transcript");
    let stored = &transcript.entries().last().expect("agent message").message;
    assert_eq!(stored.parts.len(), 2);

    // And the omission is reported by name on replay rather than hidden.
    let frames = connection.handle_line(&request(
        4,
        "session/load",
        json!({ "sessionId": session_id, "cwd": "/repo" }),
    ));
    assert_eq!(
        result(&frames)["_meta"]["cloop"]["unrepresentableParts"],
        json!(["patch"])
    );
}

#[test]
fn a_second_prompt_while_a_turn_is_in_flight_is_refused() {
    let mut connection = connection(vec![permission_step("call-1")]);
    let session_id = open_session(&mut connection);
    connection.handle_line(&request(
        3,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "one" }] }),
    ));
    let frames = connection.handle_line(&request(
        4,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "two" }] }),
    ));
    assert_eq!(
        error_code(&frames),
        changeloop_acp::jsonrpc::INVALID_REQUEST
    );
}

// --------------------------------------------------------------- permissions

#[test]
fn a_permission_request_suspends_the_turn_and_its_answer_resumes_it() {
    let mut connection = connection(vec![
        tool_call_part("part-a", "call-1", "write_file"),
        permission_step("call-1"),
        text_part("part-b", "written"),
        TurnStep::Finish(StopReason::EndTurn),
    ]);
    let session_id = open_session(&mut connection);
    let frames = connection.handle_line(&request(
        3,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "write" }] }),
    ));

    // The turn has not answered yet: it is waiting on the client.
    assert!(
        !frames
            .iter()
            .any(|frame| matches!(frame, Outgoing::Response(_))),
        "the prompt must not resolve while permission is outstanding: {frames:?}"
    );
    let outbound = outbound_requests(&frames);
    assert_eq!(outbound.len(), 1);
    let (permission_id, method, params) = outbound[0].clone();
    assert_eq!(method, "session/request_permission");
    assert_eq!(params["toolCall"]["toolCallId"], json!("call-1"));
    assert_eq!(params["options"][0]["optionId"], json!("allow"));

    let answer = json!({
        "jsonrpc": "2.0",
        "id": permission_id,
        "result": { "outcome": { "outcome": "selected", "optionId": "allow" } },
    })
    .to_string();
    let frames = connection.handle_line(&answer);
    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));

    // The decision is recorded in the transcript, so a replay shows it.
    let transcript = connection.transcript(&session_id).expect("a transcript");
    let stored = &transcript.entries().last().expect("agent message").message;
    assert!(
        stored.parts.iter().any(|part| matches!(
            &part.body,
            MessagePartBody::Permission { decision, .. } if decision == "allow"
        )),
        "{:?}",
        stored.parts
    );
}

#[test]
fn a_response_to_a_request_this_side_never_sent_is_ignored() {
    let mut connection = connection(Vec::new());
    open_session(&mut connection);
    let frames = connection
        .handle_line(&json!({ "jsonrpc": "2.0", "id": "never-sent", "result": {} }).to_string());
    assert!(frames.is_empty(), "{frames:?}");
}

// -------------------------------------------------------------- cancellation

#[test]
fn cancellation_cascades_from_the_turn_through_tool_calls_to_permissions() {
    let mut connection = connection(vec![
        tool_call_part("part-a", "call-1", "write_file"),
        permission_step("call-1"),
        text_part("part-b", "never reached"),
        TurnStep::Finish(StopReason::EndTurn),
    ]);
    let session_id = open_session(&mut connection);
    let frames = connection.handle_line(&request(
        3,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "write" }] }),
    ));
    let (permission_id, _, _) = outbound_requests(&frames)[0].clone();

    let frames = connection.handle_line(&notification(
        "session/cancel",
        json!({ "sessionId": session_id }),
    ));

    // The tool call gets a terminal frame: dropping it would leave the client
    // permanently wrong about that call's state.
    let updates = notifications(&frames);
    assert_eq!(updates.len(), 1, "{updates:?}");
    assert_eq!(
        updates[0]["update"]["sessionUpdate"],
        json!("tool_call_update")
    );
    assert_eq!(updates[0]["update"]["toolCallId"], json!("call-1"));
    assert_eq!(updates[0]["update"]["status"], json!("failed"));
    assert_eq!(updates[0]["_meta"]["cloop"]["cancelled"], json!(true));

    // And the prompt itself resolves, rather than hanging.
    assert_eq!(result(&frames)["stopReason"], json!("cancelled"));

    // The permission request was reached by the cascade: a late answer to it
    // does nothing, and in particular does not resume the cancelled turn.
    let late = json!({
        "jsonrpc": "2.0",
        "id": permission_id,
        "result": { "outcome": { "outcome": "selected", "optionId": "allow" } },
    })
    .to_string();
    assert!(connection.handle_line(&late).is_empty());

    // The partial turn is still stored, so a resume shows what happened.
    let transcript = connection.transcript(&session_id).expect("a transcript");
    assert_eq!(transcript.len(), 2, "user prompt plus the partial answer");
}

#[test]
fn cancelling_one_request_resolves_it_without_cancelling_the_whole_turn() {
    let mut connection = connection(vec![
        tool_call_part("part-a", "call-1", "write_file"),
        permission_step("call-1"),
        text_part("part-b", "carried on without the tool"),
        TurnStep::Finish(StopReason::EndTurn),
    ]);
    let session_id = open_session(&mut connection);
    let frames = connection.handle_line(&request(
        3,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "write" }] }),
    ));
    let (permission_id, _, _) = outbound_requests(&frames)[0].clone();

    let frames = connection.handle_line(&notification(
        "$/cancel_request",
        json!({ "id": permission_id }),
    ));

    // The subtree beneath the permission request is cancelled and its tool call
    // is terminated, but the turn resumes and still resolves.
    let updates = notifications(&frames);
    assert!(
        updates
            .iter()
            .any(|update| update["update"]["status"] == json!("failed")),
        "{updates:?}"
    );
    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));
}

#[test]
fn cancelling_the_prompt_request_by_id_cancels_the_turn() {
    let mut connection = connection(vec![permission_step("call-1")]);
    let session_id = open_session(&mut connection);
    connection.handle_line(&request(
        3,
        "session/prompt",
        json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": "write" }] }),
    ));
    let frames = connection.handle_line(&notification("$/cancel_request", json!({ "id": 3 })));
    assert_eq!(result(&frames)["stopReason"], json!("cancelled"));
}

#[test]
fn cancelling_an_unknown_session_or_request_is_a_no_op() {
    let mut connection = connection(Vec::new());
    open_session(&mut connection);
    assert!(
        connection
            .handle_line(&notification(
                "session/cancel",
                json!({ "sessionId": "ghost" })
            ))
            .is_empty()
    );
    assert!(
        connection
            .handle_line(&notification("$/cancel_request", json!({ "id": 4242 })))
            .is_empty()
    );
    // Malformed cancellation params are ignored, never answered.
    assert!(
        connection
            .handle_line(&notification("session/cancel", json!({})))
            .is_empty()
    );
}

// --------------------------------------------------------------- replay

#[test]
fn session_resume_replays_from_a_cursor_with_no_duplicate_and_no_skip() {
    let mut connection = connection(vec![
        text_part("turn-1", "first answer"),
        TurnStep::Finish(StopReason::EndTurn),
        text_part("turn-2", "second answer"),
        TurnStep::Finish(StopReason::EndTurn),
    ]);
    let session_id = open_session(&mut connection);
    for (id, text) in [(3_i64, "one"), (4, "two")] {
        let frames = connection.handle_line(&request(
            id,
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": text }] }),
        ));
        assert_eq!(result(&frames)["stopReason"], json!("end_turn"));
    }

    // A full replay: two prompts and two answers, one part each.
    let frames = connection.handle_line(&request(
        5,
        "session/load",
        json!({ "sessionId": session_id, "cwd": "/repo" }),
    ));
    let full = notifications(&frames);
    assert_eq!(full.len(), 4, "{full:?}");
    let value = result(&frames);
    assert_eq!(value["_meta"]["cloop"]["replayedMessages"], json!(4));
    assert_eq!(value["_meta"]["cloop"]["hasMore"], json!(false));
    let cursor = value["_meta"]["cloop"]["cursor"]
        .as_str()
        .expect("a cursor")
        .to_owned();

    // A bounded page hands back the cursor that resumes exactly after it.
    let frames = connection.handle_line(&request(
        6,
        "session/load",
        json!({
            "sessionId": session_id,
            "cwd": "/repo",
            "_meta": { "cloop": { "limit": 2 } },
        }),
    ));
    let first_page = notifications(&frames);
    let value = result(&frames);
    assert_eq!(value["_meta"]["cloop"]["hasMore"], json!(true));
    let page_cursor = value["_meta"]["cloop"]["cursor"]
        .as_str()
        .expect("a cursor")
        .to_owned();

    let frames = connection.handle_line(&request(
        7,
        "session/load",
        json!({
            "sessionId": session_id,
            "cwd": "/repo",
            "_meta": { "cloop": { "afterCursor": page_cursor } },
        }),
    ));
    let second_page = notifications(&frames);
    assert_eq!(result(&frames)["_meta"]["cloop"]["hasMore"], json!(false));

    // The two pages reconstruct the full replay: nothing repeated, nothing lost.
    let mut rejoined = first_page;
    rejoined.extend(second_page);
    assert_eq!(rejoined, full);

    // Resuming after everything replays nothing at all.
    let frames = connection.handle_line(&request(
        8,
        "session/load",
        json!({
            "sessionId": session_id,
            "cwd": "/repo",
            "_meta": { "cloop": { "afterCursor": cursor } },
        }),
    ));
    assert!(notifications(&frames).is_empty());
    assert_eq!(
        result(&frames)["_meta"]["cloop"]["replayedMessages"],
        json!(0)
    );
}

#[test]
fn a_malformed_resume_cursor_is_refused_rather_than_replaying_from_the_start() {
    let mut connection = connection(Vec::new());
    let session_id = open_session(&mut connection);
    let frames = connection.handle_line(&request(
        3,
        "session/load",
        json!({
            "sessionId": session_id,
            "cwd": "/repo",
            "_meta": { "cloop": { "afterCursor": "not-a-cursor" } },
        }),
    ));
    assert_eq!(error_code(&frames), changeloop_acp::jsonrpc::INVALID_PARAMS);
}

// ------------------------------------------------------------------ authority

#[test]
fn an_attached_acp_client_does_not_gain_workspace_mutation_authority() {
    let mut connection = connection(Vec::new());
    let session_id = open_session(&mut connection);
    let authority = connection
        .mutation_authority(&session_id)
        .expect("a known session");
    assert_eq!(
        authority,
        Err(changeloop_session::SessionError::ConversationIsReadOnly)
    );
    assert!(connection.mutation_authority("ghost").is_none());
}

#[test]
fn authenticate_is_refused_rather_than_pretending_to_succeed() {
    let mut connection = connection(Vec::new());
    let frames = connection.handle_line(&request(1, "initialize", json!({ "protocolVersion": 1 })));
    assert_eq!(result(&frames)["authMethods"], json!([]));
    let frames = connection.handle_line(&request(2, "authenticate", json!({ "methodId": "x" })));
    assert_eq!(error_code(&frames), changeloop_acp::jsonrpc::INVALID_PARAMS);
}
