//! End-to-end proof that the ACP facade, driven by the real agent runtime,
//! does what an ACP client needs and refuses what `cloop` forbids.
//!
//! Every test goes through [`Connection::handle_line`] — the same entry point
//! the stdio loop uses — and through the real
//! [`changeloop_runtime::AgentRuntime`], the real
//! [`changeloop_tools::ToolRuntime`] and the real
//! [`changeloop_policy::evaluate`]. Only the model is scripted, so nothing here
//! proves a property of a stand-in.

use std::path::Path;

use changeloop_acp::connection::{AgentConfig, Connection, IdSource};
use changeloop_acp::jsonrpc::{Outgoing, RequestId, ResponseOutcome};
use changeloop_acp_runtime::driver::{ALLOW_ONCE, REJECT_ONCE};
use changeloop_acp_runtime::provider::ProviderSetupError;
use changeloop_acp_runtime::testing::{ScriptedProviderFactory, UnavailableProviderFactory};
use changeloop_acp_runtime::{AcpRuntimeDriver, DriverConfig};
use changeloop_policy::ExecutionMode;
use changeloop_provider::{FinishReason, StreamEvent};
use changeloop_storage::Storage;
use serde_json::{Value, json};

// ------------------------------------------------------------------ helpers

fn workspace() -> tempfile::TempDir {
    let root = tempfile::tempdir().expect("workspace");
    std::fs::write(root.path().join("README.md"), "hello from the workspace\n").expect("seed");
    root
}

fn driver(
    root: &Path,
    mode: ExecutionMode,
    responses: Vec<Vec<StreamEvent>>,
) -> AcpRuntimeDriver<ScriptedProviderFactory> {
    AcpRuntimeDriver::with_store(
        DriverConfig::new(root.to_path_buf(), mode),
        ScriptedProviderFactory::new(responses),
        Storage::open_in_memory().expect("store"),
    )
}

fn connection<F: changeloop_acp_runtime::ProviderFactory>(
    driver: AcpRuntimeDriver<F>,
) -> Connection<AcpRuntimeDriver<F>> {
    Connection::new(
        driver,
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

fn result(frames: &[Outgoing]) -> Value {
    let mut found = frames.iter().filter_map(|frame| match frame {
        Outgoing::Response(response) => Some(response),
        _ => None,
    });
    let response = found
        .next()
        .unwrap_or_else(|| panic!("no response in {frames:?}"));
    match &response.outcome {
        ResponseOutcome::Result(value) => value.clone(),
        ResponseOutcome::Error(error) => panic!("expected success, got {error:?}"),
    }
}

fn updates(frames: &[Outgoing]) -> Vec<Value> {
    frames
        .iter()
        .filter_map(|frame| match frame {
            Outgoing::Notification(notification) => notification.params.clone(),
            _ => None,
        })
        .collect()
}

fn outbound(frames: &[Outgoing]) -> Vec<(RequestId, String, Value)> {
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

fn open_session<F: changeloop_acp_runtime::ProviderFactory>(
    connection: &mut Connection<AcpRuntimeDriver<F>>,
    root: &Path,
) -> String {
    let frames = connection.handle_line(&request(1, "initialize", json!({ "protocolVersion": 1 })));
    assert_eq!(result(&frames)["protocolVersion"], json!(1));
    let frames = connection.handle_line(&request(
        2,
        "session/new",
        json!({ "cwd": root.display().to_string() }),
    ));
    result(&frames)["sessionId"]
        .as_str()
        .expect("session id")
        .to_owned()
}

fn prompt(session: &str, text: &str) -> String {
    request(
        10,
        "session/prompt",
        json!({
            "sessionId": session,
            "prompt": [{ "type": "text", "text": text }],
        }),
    )
}

fn text_turn(text: &str) -> Vec<StreamEvent> {
    vec![
        StreamEvent::OutputDelta { text: text.into() },
        StreamEvent::Completed {
            response_id: "response-1".into(),
            finish_reason: FinishReason::Stop,
        },
    ]
}

fn tool_turn(id: &str, name: &str, arguments: Value) -> Vec<StreamEvent> {
    vec![
        StreamEvent::ToolCallStarted {
            id: id.into(),
            name: name.into(),
        },
        StreamEvent::ToolCallCompleted {
            id: id.into(),
            arguments,
        },
        StreamEvent::Completed {
            response_id: "response-tools".into(),
            finish_reason: FinishReason::ToolCalls,
        },
    ]
}

fn chunks_of(updates: &[Value], tag: &str) -> Vec<Value> {
    updates
        .iter()
        .filter(|update| update["update"]["sessionUpdate"] == json!(tag))
        .cloned()
        .collect()
}

// ------------------------------------------------------------------- turns

#[test]
fn a_real_turn_streams_model_output_with_stable_identifiers() {
    let root = workspace();
    let mut connection = connection(driver(
        root.path(),
        ExecutionMode::Auto,
        vec![vec![
            StreamEvent::OutputDelta {
                text: "hello ".into(),
            },
            StreamEvent::OutputDelta {
                text: "world".into(),
            },
            StreamEvent::Completed {
                response_id: "response-1".into(),
                finish_reason: FinishReason::Stop,
            },
        ]],
    ));
    let session = open_session(&mut connection, root.path());

    let frames = connection.handle_line(&prompt(&session, "say hello"));
    let chunks = chunks_of(&updates(&frames), "agent_message_chunk");
    let rendered: Vec<&str> = chunks
        .iter()
        .filter_map(|chunk| chunk["update"]["content"]["text"].as_str())
        .collect();
    assert_eq!(rendered, vec!["hello ", "world"], "{chunks:?}");

    // Every chunk names the message it belongs to, and each part is distinct:
    // a client never has to infer a message boundary from a change of type.
    let message_ids: Vec<&str> = chunks
        .iter()
        .filter_map(|chunk| chunk["_meta"]["cloop"]["messageId"].as_str())
        .collect();
    assert_eq!(message_ids.len(), 2);
    assert_eq!(message_ids[0], message_ids[1]);
    let part_ids: Vec<&str> = chunks
        .iter()
        .filter_map(|chunk| chunk["_meta"]["cloop"]["partId"].as_str())
        .collect();
    assert_eq!(part_ids.len(), 2);
    assert_ne!(part_ids[0], part_ids[1]);

    let response = result(&frames);
    assert_eq!(response["stopReason"], json!("end_turn"));
    assert_eq!(
        response["_meta"]["cloop"]["messageId"],
        json!(message_ids[0])
    );
}

#[test]
fn a_tool_call_surfaces_as_tool_call_and_its_result_as_tool_call_update() {
    let root = workspace();
    let mut connection = connection(driver(
        root.path(),
        // Auto mode: a passive read is allowed without a prompt, so this test
        // observes dispatch rather than the permission channel.
        ExecutionMode::Auto,
        vec![
            tool_turn("call-1", "read_file", json!({ "path": "README.md" })),
            text_turn("the file says hello"),
        ],
    ));
    let session = open_session(&mut connection, root.path());

    let frames = connection.handle_line(&prompt(&session, "read the readme"));
    let updates = updates(&frames);

    let calls = chunks_of(&updates, "tool_call");
    assert!(!calls.is_empty(), "{updates:?}");
    assert!(
        calls
            .iter()
            .all(|call| call["update"]["toolCallId"] == json!("call-1"))
    );
    assert_eq!(calls[0]["update"]["title"], json!("read_file"));
    assert_eq!(calls[0]["update"]["kind"], json!("read"));

    let results = chunks_of(&updates, "tool_call_update");
    assert_eq!(results.len(), 1, "{updates:?}");
    assert_eq!(results[0]["update"]["toolCallId"], json!("call-1"));
    assert_eq!(results[0]["update"]["status"], json!("completed"));
    let rendered = serde_json::to_string(&results[0]["update"]["content"]).expect("content");
    assert!(
        rendered.contains("hello from the workspace"),
        "the tool result must carry what the workspace actually held: {rendered}"
    );

    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));
}

// ------------------------------------------------------------- permissions

#[test]
fn a_permission_request_suspends_the_turn_and_the_clients_answer_resumes_it() {
    let root = workspace();
    let mut connection = connection(driver(
        root.path(),
        ExecutionMode::Ask,
        vec![
            tool_turn("call-1", "read_file", json!({ "path": "README.md" })),
            text_turn("the file says hello"),
        ],
    ));
    let session = open_session(&mut connection, root.path());

    let frames = connection.handle_line(&prompt(&session, "read the readme"));
    let asked = outbound(&frames);
    assert_eq!(asked.len(), 1, "{frames:?}");
    let (permission_id, method, params) = asked.into_iter().next().expect("a request");
    assert_eq!(method, "session/request_permission");
    assert_eq!(params["toolCall"]["toolCallId"], json!("call-1"));
    assert_eq!(params["toolCall"]["title"], json!("read_file README.md"));
    let options: Vec<&str> = params["options"]
        .as_array()
        .expect("options")
        .iter()
        .filter_map(|option| option["optionId"].as_str())
        .collect();
    assert_eq!(options, vec![ALLOW_ONCE, REJECT_ONCE]);
    // A standing grant is authority. It is not offered.
    assert!(
        !serde_json::to_string(&params["options"])
            .expect("options")
            .contains("allow_always")
    );

    // The prompt has not been answered: the turn is genuinely suspended.
    assert!(
        !frames
            .iter()
            .any(|frame| matches!(frame, Outgoing::Response(_))),
        "{frames:?}"
    );

    let answer = json!({
        "jsonrpc": "2.0",
        "id": permission_id,
        "result": { "outcome": { "outcome": "selected", "optionId": ALLOW_ONCE } },
    })
    .to_string();
    let frames = connection.handle_line(&answer);
    let results = chunks_of(&updates(&frames), "tool_call_update");
    assert_eq!(results.len(), 1, "{frames:?}");
    assert_eq!(results[0]["update"]["status"], json!("completed"));
    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));
}

#[test]
fn a_rejected_permission_completes_the_turn_without_running_the_tool() {
    let root = workspace();
    let mut connection = connection(driver(
        root.path(),
        ExecutionMode::Ask,
        vec![
            tool_turn("call-1", "read_file", json!({ "path": "README.md" })),
            text_turn("I was not allowed to read it"),
        ],
    ));
    let session = open_session(&mut connection, root.path());
    let frames = connection.handle_line(&prompt(&session, "read the readme"));
    let (permission_id, _, _) = outbound(&frames).into_iter().next().expect("a request");

    let frames = connection.handle_line(
        &json!({
            "jsonrpc": "2.0",
            "id": permission_id,
            "result": { "outcome": { "outcome": "selected", "optionId": REJECT_ONCE } },
        })
        .to_string(),
    );
    let results = chunks_of(&updates(&frames), "tool_call_update");
    assert_eq!(results.len(), 1, "{frames:?}");
    assert_eq!(results[0]["update"]["status"], json!("failed"));
    let rendered = serde_json::to_string(&results[0]["update"]["content"]).expect("content");
    assert!(rendered.contains("permission_denied"), "{rendered}");
    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));
}

// ------------------------------------------------------------ cancellation

#[test]
fn cancelling_mid_turn_resolves_the_prompt_as_cancelled_and_leaves_nothing_running() {
    let root = workspace();
    let mut connection = connection(driver(
        root.path(),
        ExecutionMode::Ask,
        vec![
            tool_turn("call-1", "read_file", json!({ "path": "README.md" })),
            text_turn("resumed"),
            text_turn("a later turn still works"),
        ],
    ));
    let session = open_session(&mut connection, root.path());

    let frames = connection.handle_line(&prompt(&session, "read the readme"));
    assert_eq!(outbound(&frames).len(), 1, "the turn must be suspended");

    let frames = connection.handle_line(&notification(
        "session/cancel",
        json!({ "sessionId": session }),
    ));
    assert_eq!(result(&frames)["stopReason"], json!("cancelled"));
    // The tool call that the cancellation reached is given a terminal frame:
    // dropping it would leave the client permanently wrong about its state.
    let terminal = chunks_of(&updates(&frames), "tool_call_update");
    assert_eq!(terminal.len(), 1, "{frames:?}");
    assert_eq!(terminal[0]["update"]["toolCallId"], json!("call-1"));
    assert_eq!(terminal[0]["update"]["status"], json!("failed"));
    assert_eq!(terminal[0]["_meta"]["cloop"]["cancelled"], json!(true));

    // Nothing is left in flight: the session accepts a new prompt, and no
    // permission request from the cancelled turn is still outstanding.
    let frames = connection.handle_line(&request(
        11,
        "session/prompt",
        json!({
            "sessionId": session,
            "prompt": [{ "type": "text", "text": "are you still there" }],
        }),
    ));
    assert!(
        matches!(result(&frames)["stopReason"], Value::String(_)),
        "{frames:?}"
    );
}

// --------------------------------------------------------------- authority

#[test]
fn an_acp_client_cannot_obtain_workspace_mutation_authority() {
    let root = workspace();
    let target = root.path().join("owned-by-the-harness.txt");
    let mut connection = connection(driver(
        root.path(),
        // YOLO is the mode that suppresses ordinary tool prompts. Change
        // authority is not an ordinary tool prompt, so it must still refuse.
        ExecutionMode::Yolo,
        vec![
            tool_turn(
                "call-1",
                "write_file",
                json!({ "path": "owned-by-the-harness.txt", "contents": "mutated" }),
            ),
            text_turn("I could not write it"),
        ],
    ));
    let session = open_session(&mut connection, root.path());

    let frames = connection.handle_line(&prompt(&session, "write a file for me"));

    // No permission request: the write is not a question an editor may answer.
    assert!(outbound(&frames).is_empty(), "{frames:?}");
    let results = chunks_of(&updates(&frames), "tool_call_update");
    assert_eq!(results.len(), 1, "{frames:?}");
    assert_eq!(results[0]["update"]["status"], json!("failed"));
    assert!(
        serde_json::to_string(&results[0]["update"]["content"])
            .expect("content")
            .contains("permission_denied")
    );
    assert!(!target.exists(), "no ACP message may author a file write");

    // And `cloop` still reports the session as unable to mutate, which is the
    // answer the harness owns rather than one the transport supplied.
    assert!(matches!(
        connection.mutation_authority(&session),
        Some(Err(
            changeloop_session::SessionError::ConversationIsReadOnly
        ))
    ));
}

#[test]
fn answering_a_permission_prompt_does_not_confer_mutation_authority() {
    let root = workspace();
    let mut connection = connection(driver(
        root.path(),
        ExecutionMode::Ask,
        vec![
            tool_turn("call-1", "read_file", json!({ "path": "README.md" })),
            text_turn("done"),
        ],
    ));
    let session = open_session(&mut connection, root.path());
    let frames = connection.handle_line(&prompt(&session, "read the readme"));
    let (permission_id, _, _) = outbound(&frames).into_iter().next().expect("a request");
    let frames = connection.handle_line(
        &json!({
            "jsonrpc": "2.0",
            "id": permission_id,
            "result": { "outcome": { "outcome": "selected", "optionId": ALLOW_ONCE } },
        })
        .to_string(),
    );
    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));
    assert!(
        matches!(
            connection.mutation_authority(&session),
            Some(Err(
                changeloop_session::SessionError::ConversationIsReadOnly
            ))
        ),
        "an answered prompt is a decision about one call, not a grant of authority"
    );
}

// ------------------------------------------------------------- degradation

#[test]
fn an_unreachable_capability_degrades_visibly_rather_than_hanging() {
    let root = workspace();
    let driver = AcpRuntimeDriver::with_store(
        DriverConfig::new(root.path().to_path_buf(), ExecutionMode::Ask),
        UnavailableProviderFactory(ProviderSetupError::ProviderRequired),
        Storage::open_in_memory().expect("store"),
    );
    let mut connection = connection(driver);
    let session = open_session(&mut connection, root.path());

    let frames = connection.handle_line(&prompt(&session, "anything at all"));
    let response = result(&frames);
    assert_eq!(response["stopReason"], json!("refusal"));
    let rendered = chunks_of(&updates(&frames), "agent_message_chunk")
        .iter()
        .filter_map(|chunk| {
            chunk["update"]["content"]["text"]
                .as_str()
                .map(str::to_owned)
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(rendered.contains("provider_required"), "{rendered}");
    assert!(rendered.contains("cloop setup"), "{rendered}");
}

#[test]
fn an_exhausted_model_script_still_resolves_the_turn() {
    let root = workspace();
    let mut connection = connection(driver(root.path(), ExecutionMode::Ask, Vec::new()));
    let session = open_session(&mut connection, root.path());
    let frames = connection.handle_line(&prompt(&session, "anything at all"));
    let response = result(&frames);
    assert_eq!(response["stopReason"], json!("refusal"));
    let rendered = chunks_of(&updates(&frames), "agent_message_chunk")
        .iter()
        .filter_map(|chunk| {
            chunk["update"]["content"]["text"]
                .as_str()
                .map(str::to_owned)
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(rendered.contains("runtime_error"), "{rendered}");
}

#[test]
fn a_second_prompt_continues_the_same_conversation() {
    let root = workspace();
    let driver = driver(
        root.path(),
        ExecutionMode::Auto,
        vec![text_turn("first"), text_turn("second")],
    );
    let mut connection = connection(driver);
    let session = open_session(&mut connection, root.path());

    connection.handle_line(&prompt(&session, "one"));
    let frames = connection.handle_line(&request(
        11,
        "session/prompt",
        json!({
            "sessionId": session,
            "prompt": [{ "type": "text", "text": "two" }],
        }),
    ));
    assert_eq!(result(&frames)["stopReason"], json!("end_turn"));

    // The second request carries the first exchange, so the transcript the
    // model sees is one conversation rather than two disconnected turns.
    let transcript = connection.transcript(&session).expect("transcript");
    assert!(transcript.len() >= 4, "{}", transcript.len());
}
