//! JSON-RPC 2.0 framing for the ACP stdio transport.
//!
//! ACP frames JSON-RPC 2.0 as newline-delimited JSON over a subprocess's stdin
//! and stdout, exactly as LSP-style tooling does. This module owns *only* the
//! envelope: parsing, classification, and error objects. Nothing here knows an
//! ACP method name, and nothing here performs I/O, so a malformed byte sequence
//! resolves to an error object rather than a panic or a partially applied
//! side effect.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The only `jsonrpc` value this transport accepts.
pub const JSONRPC_VERSION: &str = "2.0";

/// Standard JSON-RPC 2.0 error codes.
pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;

/// Implementation-defined codes, inside the reserved `-32000..=-32099` block.
///
/// `REQUEST_CANCELLED` reuses the value LSP assigned to the same meaning so a
/// client that already speaks one JSON-RPC agent protocol reads it correctly.
pub const AUTH_REQUIRED: i64 = -32000;
pub const PROTOCOL_VERSION_MISMATCH: i64 = -32001;
pub const NOT_INITIALIZED: i64 = -32002;
pub const SESSION_NOT_FOUND: i64 = -32003;
pub const REQUEST_CANCELLED: i64 = -32800;

/// A JSON-RPC request identifier.
///
/// `Null` is kept as a distinct variant rather than folded into "absent" so an
/// error response can echo the identifier the peer actually sent.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestId {
    Number(i64),
    Text(String),
    Null,
}

impl RequestId {
    #[must_use]
    pub fn number(value: i64) -> Self {
        Self::Number(value)
    }

    #[must_use]
    pub fn text(value: impl Into<String>) -> Self {
        Self::Text(value.into())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: RequestId,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Request {
    #[must_use]
    pub fn new(id: RequestId, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            method: method.into(),
            params,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Notification {
    #[must_use]
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            method: method.into(),
            params,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl ErrorObject {
    #[must_use]
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    #[must_use]
    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }

    #[must_use]
    pub fn method_not_found(method: &str) -> Self {
        Self::new(METHOD_NOT_FOUND, format!("unknown method `{method}`"))
            .with_data(serde_json::json!({ "method": method }))
    }

    #[must_use]
    pub fn invalid_params(detail: impl Into<String>) -> Self {
        Self::new(INVALID_PARAMS, detail)
    }
}

/// A JSON-RPC response. Exactly one of `result` or `error` is present; the type
/// enforces that with an enum rather than two `Option` fields that could both
/// be set or both be missing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: RequestId,
    #[serde(flatten)]
    pub outcome: ResponseOutcome,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ResponseOutcome {
    #[serde(rename = "result")]
    Result(Value),
    #[serde(rename = "error")]
    Error(ErrorObject),
}

impl Response {
    #[must_use]
    pub fn success(id: RequestId, result: Value) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            outcome: ResponseOutcome::Result(result),
        }
    }

    #[must_use]
    pub fn failure(id: RequestId, error: ErrorObject) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_owned(),
            id,
            outcome: ResponseOutcome::Error(error),
        }
    }
}

/// A decoded peer message.
#[derive(Clone, Debug, PartialEq)]
pub enum Incoming {
    Request(Request),
    Notification(Notification),
    Response(Response),
}

/// A frame this side writes back to the peer.
#[derive(Clone, Debug, PartialEq)]
pub enum Outgoing {
    Request(Request),
    Notification(Notification),
    Response(Response),
}

impl Outgoing {
    /// Serialize to a single transport line. Serialization of these types is
    /// total, so the fallback never fires in practice; it exists so a framing
    /// bug degrades into a visible error frame instead of a panic.
    #[must_use]
    pub fn to_line(&self) -> String {
        let value = match self {
            Self::Request(request) => serde_json::to_value(request),
            Self::Notification(notification) => serde_json::to_value(notification),
            Self::Response(response) => serde_json::to_value(response),
        };
        match value {
            Ok(value) => value.to_string(),
            Err(error) => serde_json::json!({
                "jsonrpc": JSONRPC_VERSION,
                "id": Value::Null,
                "error": { "code": INTERNAL_ERROR, "message": error.to_string() },
            })
            .to_string(),
        }
    }
}

/// Why a transport line could not be classified as a JSON-RPC message.
///
/// The `id` is carried alongside the error because JSON-RPC requires an error
/// response to echo the offending request's identifier when one is recoverable.
#[derive(Clone, Debug, PartialEq)]
pub struct DecodeFailure {
    pub id: RequestId,
    pub error: ErrorObject,
    /// False for a malformed *notification*, which JSON-RPC forbids answering.
    pub answerable: bool,
}

/// Classify one transport line.
///
/// Every failure path returns a `DecodeFailure` carrying a well-formed error
/// object. No input, however malformed, reaches an `unwrap`, an index, or a
/// slice here.
pub fn decode_line(line: &str) -> Result<Incoming, DecodeFailure> {
    let value: Value = serde_json::from_str(line).map_err(|error| DecodeFailure {
        id: RequestId::Null,
        error: ErrorObject::new(PARSE_ERROR, error.to_string()),
        answerable: true,
    })?;
    decode_value(value)
}

fn decode_value(value: Value) -> Result<Incoming, DecodeFailure> {
    // Batches are legal JSON-RPC but unused by ACP. Rejecting them explicitly
    // is a protocol answer; silently unwrapping the first element would not be.
    if value.is_array() {
        return Err(DecodeFailure {
            id: RequestId::Null,
            error: ErrorObject::new(
                INVALID_REQUEST,
                "batched JSON-RPC messages are not supported by this transport",
            ),
            answerable: true,
        });
    }
    let Some(object) = value.as_object() else {
        return Err(DecodeFailure {
            id: RequestId::Null,
            error: ErrorObject::new(INVALID_REQUEST, "a JSON-RPC message must be an object"),
            answerable: true,
        });
    };

    let id = object.get("id").map(|raw| match raw {
        Value::Number(number) => number
            .as_i64()
            .map_or_else(|| RequestId::Text(number.to_string()), RequestId::Number),
        Value::String(text) => RequestId::Text(text.clone()),
        _ => RequestId::Null,
    });
    let echo_id = id.clone().unwrap_or(RequestId::Null);
    let has_method = object.contains_key("method");
    let answerable = id.is_some() || !has_method;

    let invalid = |detail: &str| DecodeFailure {
        id: echo_id.clone(),
        error: ErrorObject::new(INVALID_REQUEST, detail.to_owned()),
        answerable,
    };

    if object.get("jsonrpc").and_then(Value::as_str) != Some(JSONRPC_VERSION) {
        return Err(invalid("`jsonrpc` must be exactly \"2.0\""));
    }

    if has_method {
        let Some(method) = object.get("method").and_then(Value::as_str) else {
            return Err(invalid("`method` must be a string"));
        };
        let params = object.get("params").cloned();
        if params.as_ref().is_some_and(|params| {
            !matches!(params, Value::Object(_) | Value::Array(_) | Value::Null)
        }) {
            return Err(DecodeFailure {
                id: echo_id,
                error: ErrorObject::invalid_params("`params` must be an object or an array"),
                answerable,
            });
        }
        return Ok(match id {
            Some(id) => Incoming::Request(Request {
                jsonrpc: JSONRPC_VERSION.to_owned(),
                id,
                method: method.to_owned(),
                params,
            }),
            None => Incoming::Notification(Notification {
                jsonrpc: JSONRPC_VERSION.to_owned(),
                method: method.to_owned(),
                params,
            }),
        });
    }

    let Some(id) = id else {
        return Err(invalid("a response requires an `id`"));
    };
    match (object.get("result"), object.get("error")) {
        (Some(result), None) => Ok(Incoming::Response(Response::success(id, result.clone()))),
        (None, Some(error)) => match serde_json::from_value::<ErrorObject>(error.clone()) {
            Ok(error) => Ok(Incoming::Response(Response::failure(id, error))),
            Err(failure) => Err(DecodeFailure {
                id: echo_id,
                error: ErrorObject::new(INVALID_REQUEST, failure.to_string()),
                answerable: false,
            }),
        },
        _ => Err(DecodeFailure {
            id: echo_id,
            error: ErrorObject::new(
                INVALID_REQUEST,
                "a response carries exactly one of `result` or `error`",
            ),
            answerable: false,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_json_yields_a_parse_error_rather_than_a_panic() {
        for line in [
            "",
            "{",
            "null",
            "\"bare string\"",
            "[1,2,3]",
            "{\"jsonrpc\":\"1.0\",\"id\":1,\"method\":\"x\"}",
            "{\"id\":1,\"method\":\"x\"}",
            "{\"jsonrpc\":\"2.0\",\"id\":1}",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":1,\"error\":{\"code\":1,\"message\":\"m\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"x\",\"params\":7}",
        ] {
            let failure = decode_line(line).expect_err(line);
            assert!(
                failure.error.code < 0,
                "{line} produced a non-error code {}",
                failure.error.code
            );
        }
    }

    #[test]
    fn requests_notifications_and_responses_are_distinguished_by_shape() {
        assert!(matches!(
            decode_line("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"a\"}"),
            Ok(Incoming::Request(_))
        ));
        assert!(matches!(
            decode_line("{\"jsonrpc\":\"2.0\",\"method\":\"a\"}"),
            Ok(Incoming::Notification(_))
        ));
        assert!(matches!(
            decode_line("{\"jsonrpc\":\"2.0\",\"id\":\"a\",\"result\":{}}"),
            Ok(Incoming::Response(_))
        ));
    }

    #[test]
    fn a_malformed_notification_is_not_answerable() {
        let failure = decode_line("{\"jsonrpc\":\"1.0\",\"method\":\"a\"}").expect_err("malformed");
        assert!(!failure.answerable);
    }

    #[test]
    fn response_serialization_never_carries_both_result_and_error() {
        let ok = Outgoing::Response(Response::success(RequestId::number(1), Value::Bool(true)));
        assert_eq!(
            serde_json::from_str::<Value>(&ok.to_line()).expect("valid json"),
            serde_json::json!({ "jsonrpc": "2.0", "id": 1, "result": true })
        );
        let failed = Outgoing::Response(Response::failure(
            RequestId::text("x"),
            ErrorObject::method_not_found("nope"),
        ));
        let line = failed.to_line();
        assert!(line.contains("\"error\""), "{line}");
        assert!(!line.contains("\"result\""), "{line}");
    }
}
