//! Versioned, transport-neutral contracts shared by Changeloop clients and servers.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

/// The protocol version implemented by this crate.
pub const CURRENT_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion { major: 1, minor: 0 };
pub const MAX_PROTOCOL_ID_BYTES: usize = 256;
pub const MAX_EVENT_CURSOR_BYTES: usize = 512;
pub const MAX_MESSAGE_PARTS: usize = 10_000;
pub const MAX_COMPACTION_MESSAGE_IDS: usize = 10_000;
pub const MAX_EVENT_JSON_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_MESSAGE_TEXT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_MESSAGE_METADATA_BYTES: usize = 1024 * 1024;
pub const MAX_MESSAGE_PATH_BYTES: usize = 16 * 1024;
pub const MUTATION_TOOL_SCHEMA_VERSION: u16 = 1;
pub const MAX_MUTATION_PATH_BYTES: usize = 4 * 1024;
pub const MAX_MUTATION_INVALIDATED_PATHS: usize = 1_024;
pub const MAX_MUTATION_FORMATTERS: usize = 64;
pub const MAX_MUTATION_WRITE_CHECKS: usize = 64;
pub const MAX_MUTATION_DIAGNOSTIC_BYTES: usize = 64 * 1024;
pub const MAX_MUTATION_CONTRACT_JSON_BYTES: usize = 256 * 1024;
pub const MAX_FILE_CONTENT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_READ_FILE_BYTES: usize = 1024 * 1024;
pub const MAX_FILE_TOOL_JSON_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_PROCESS_TOOL_JSON_BYTES: usize = 512 * 1024;
pub const MAX_PROCESS_ARGUMENTS: usize = 64;
pub const MAX_PROCESS_ARGUMENT_BYTES: usize = 16 * 1024;
pub const MAX_PROCESS_ARGUMENT_TOTAL_BYTES: usize = 64 * 1024;
pub const MAX_PROCESS_ENVIRONMENT: usize = 64;
pub const MAX_PROCESS_ENVIRONMENT_TOTAL_BYTES: usize = 64 * 1024;
pub const MAX_JOB_STDIN_BYTES: usize = 64 * 1024;
pub const MAX_PROCESS_INLINE_BYTES: u64 = 1024 * 1024;
pub const MAX_PROCESS_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_PROCESS_TIMEOUT_MS: u64 = 15 * 60 * 1000;

/// The oldest stored part schema this build can read.
pub const MIN_PART_SCHEMA_VERSION: u16 = 1;
/// The newest stored part schema this build can write.
pub const MAX_PART_SCHEMA_VERSION: u16 = 2;
/// The schema a part carrying only v1 bodies is written under. Writers keep
/// emitting v1 for v1-representable content so older readers stay unaffected.
pub const BASE_PART_SCHEMA_VERSION: u16 = 1;
/// The schema that introduced [`MessagePartBody::Artifact`].
pub const ARTIFACT_PART_SCHEMA_VERSION: u16 = 2;
/// Tool output at or below this size stays inline in the transcript; anything
/// larger, and any non-text payload, is written to content-addressed storage
/// and referenced by an artifact part.
pub const MAX_INLINE_TOOL_OUTPUT_BYTES: usize = 32 * 1024;
/// How much of a by-reference payload may be retained inline as a preview.
pub const MAX_ARTIFACT_PREVIEW_BYTES: usize = 4 * 1024;
/// Rendered in place of a part that a downgrade cannot represent. Failure is
/// visible by construction; nothing is silently coerced or dropped.
pub const NOT_REPRESENTABLE_PLACEHOLDER: &str = "not representable at this version";
/// Tag of the sequence form of [`EventCursor`].
pub const EVENT_CURSOR_SEQUENCE_TAG: &str = "e";
/// Width of the zero-padded sequence in the sequence cursor form.
const EVENT_CURSOR_SEQUENCE_WIDTH: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ProtocolVersion {
    pub major: u16,
    pub minor: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NegotiatedProtocol {
    pub version: ProtocolVersion,
    pub unknown_parts: UnknownPartPolicy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnknownPartPolicy {
    /// Both peers know the same schema surface, so unknown parts are malformed.
    Reject,
    /// A newer peer may send additions; retain them for replay without interpreting them.
    Preserve,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum NegotiationError {
    #[error("incompatible protocol major versions: local={local}, remote={remote}")]
    IncompatibleMajor { local: u16, remote: u16 },
}

#[derive(Debug, Error)]
pub enum ProtocolDecodeError {
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Negotiation(#[from] NegotiationError),
    #[error(
        "unknown message part type `{part_type}` is invalid for equal protocol version {version_major}.{version_minor}"
    )]
    UnknownPartAtEqualVersion {
        part_type: String,
        version_major: u16,
        version_minor: u16,
    },
    #[error("protocol field {field} exceeds the {limit}-byte limit")]
    FieldTooLong { field: &'static str, limit: usize },
    #[error("message contains more than {limit} parts")]
    TooManyParts { limit: usize },
    #[error("protocol field {field} contains more than {limit} items")]
    TooManyItems { field: &'static str, limit: usize },
    #[error("protocol JSON exceeds the {limit}-byte limit")]
    PayloadTooLarge { limit: usize },
    #[error("protocol field {field} is empty or contains invalid characters")]
    InvalidField { field: &'static str },
    #[error("duplicate protocol identifier in {field}")]
    DuplicateId { field: &'static str },
    #[error("unsupported {field} schema version {found}")]
    UnsupportedSchema { field: &'static str, found: u16 },
    #[error("message session does not match its event envelope")]
    SessionMismatch,
    #[error("message part state is invalid for body type {part_type}")]
    InvalidPartState { part_type: &'static str },
    #[error("message part transition from a terminal state is invalid")]
    TerminalPartTransition,
    #[error("tool result must contain exactly one output or artifact")]
    InvalidToolResult,
}

pub fn negotiate(
    local: ProtocolVersion,
    remote: ProtocolVersion,
) -> Result<NegotiatedProtocol, NegotiationError> {
    if local.major != remote.major {
        return Err(NegotiationError::IncompatibleMajor {
            local: local.major,
            remote: remote.major,
        });
    }
    Ok(NegotiatedProtocol {
        version: ProtocolVersion {
            major: local.major,
            minor: local.minor.min(remote.minor),
        },
        unknown_parts: if local.minor == remote.minor {
            UnknownPartPolicy::Reject
        } else {
            UnknownPartPolicy::Preserve
        },
    })
}

macro_rules! stable_id {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        #[ts(export, export_to = "../../../clients/typescript/generated/")]
        pub struct $name(pub String);

        impl $name {
            #[must_use]
            pub fn new() -> Self {
                Self(Uuid::now_v7().to_string())
            }

            #[must_use]
            pub fn from_stable(value: impl Into<String>) -> Self {
                Self(value.into())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

/// Declare a string-tagged enum that keeps unrecognized values with their
/// payload, so an addition made by a newer peer survives storage and replay
/// byte for byte.
///
/// `#[serde(other)]` is deliberately not used anywhere in the workspace: it
/// matches only a unit variant and therefore discards both the tag and the
/// body, destroying exactly the data an open enum undertakes to round-trip.
#[macro_export]
macro_rules! open_enum {
    (
        $(#[$meta:meta])*
        $name:ident { $($(#[$vmeta:meta])* $variant:ident => $tag:literal,)+ }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq)]
        #[non_exhaustive]
        pub enum $name {
            $($(#[$vmeta])* $variant,)+
            /// A value this build does not know, preserved verbatim.
            Unknown { tag: String, body: ::serde_json::Value },
        }

        impl $name {
            /// The wire tag, known or not.
            pub fn tag(&self) -> &str {
                match self {
                    $(Self::$variant => $tag,)+
                    Self::Unknown { tag, .. } => tag.as_str(),
                }
            }

            /// False when the value came from a newer schema than this build.
            pub fn is_known(&self) -> bool {
                !matches!(self, Self::Unknown { .. })
            }
        }

        impl ::serde::Serialize for $name {
            fn serialize<S: ::serde::Serializer>(
                &self,
                serializer: S,
            ) -> ::core::result::Result<S::Ok, S::Error> {
                match self {
                    Self::Unknown { tag, body } => {
                        if body.is_null() {
                            ::serde::Serialize::serialize(tag, serializer)
                        } else {
                            ::serde::Serialize::serialize(body, serializer)
                        }
                    }
                    known => ::serde::Serialize::serialize(known.tag(), serializer),
                }
            }
        }

        impl<'de> ::serde::Deserialize<'de> for $name {
            fn deserialize<D: ::serde::Deserializer<'de>>(
                deserializer: D,
            ) -> ::core::result::Result<Self, D::Error> {
                let value = <::serde_json::Value as ::serde::Deserialize>::deserialize(
                    deserializer,
                )?;
                let (tag, body) = $crate::open_enum_parts(value)
                    .map_err(::serde::de::Error::custom)?;
                Ok(match (tag.as_str(), body.is_null()) {
                    $(($tag, true) => Self::$variant,)+
                    _ => Self::Unknown { tag, body },
                })
            }
        }
    };
}

/// Split an open-enum wire value into `(tag, body)`. A bare string carries no
/// body; an object keeps its whole body so a future structured variant survives
/// a round trip. Public because [`open_enum!`] expands into other crates.
pub fn open_enum_parts(value: Value) -> Result<(String, Value), String> {
    match value {
        Value::String(tag) => Ok((tag, Value::Null)),
        Value::Object(body) => {
            let tag = body
                .get("type")
                .and_then(Value::as_str)
                .ok_or("object form requires a string 'type' field")?
                .to_owned();
            Ok((tag, Value::Object(body)))
        }
        other => Err(format!(
            "expected a string tag or an object with a 'type' field, found {}",
            json_kind(&other)
        )),
    }
}

fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

stable_id!(SessionId);
stable_id!(MessageId);
stable_id!(PartId);
stable_id!(EventId);
stable_id!(OperationId);
stable_id!(ToolCallId);
stable_id!(ArtifactId);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum PartState {
    Partial,
    Running,
    Completed,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum Provenance {
    TrustedPolicy,
    UserInput,
    RepositoryContent,
    ToolOutput,
    WebContent,
    McpContent,
    ModelGenerated,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ArtifactRef {
    pub id: ArtifactId,
    pub sha256: String,
    pub media_type: String,
    #[ts(type = "number")]
    pub byte_length: u64,
}

impl ArtifactRef {
    /// Describe `bytes` as a content-addressed artifact. The digest is the
    /// address, so the same payload always yields the same reference.
    #[must_use]
    pub fn for_bytes(media_type: impl Into<String>, bytes: &[u8]) -> Self {
        let sha256 = hex_digest(bytes);
        Self {
            id: ArtifactId::from_stable(format!("sha256:{sha256}")),
            sha256,
            media_type: media_type.into(),
            byte_length: bytes.len() as u64,
        }
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .fold(String::with_capacity(64), |mut out, byte| {
            use fmt::Write as _;
            let _ = write!(out, "{byte:02x}");
            out
        })
}

/// Whether a tool payload must be stored by reference rather than inlined into
/// the transcript. The rule is applied at insert time, not at render time: a
/// payload above [`MAX_INLINE_TOOL_OUTPUT_BYTES`], or any payload that is not
/// UTF-8 text, becomes a content-addressed artifact.
#[must_use]
pub fn should_store_by_reference(bytes: &[u8], media_type: &str) -> bool {
    bytes.len() > MAX_INLINE_TOOL_OUTPUT_BYTES
        || !media_type.starts_with("text/")
        || std::str::from_utf8(bytes).is_err()
}

open_enum! {
    /// What an artifact part is attributed to. Open because a newer peer may
    /// attribute an artifact to something this build has no variant for.
    ArtifactOriginKind {
        /// Output of a tool call, identified by `tool_call_id`.
        ToolOutput => "tool_output",
        /// A workspace file, identified by `path`.
        File => "file",
        /// A payload with no tool call and no workspace path.
        Attachment => "attachment",
    }
}

/// Attribution carried by [`MessagePartBody::Artifact`]. The attribution, not
/// the artifact, is what decides whether the part can be downgraded.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ArtifactOrigin {
    #[ts(type = "string")]
    pub kind: ArtifactOriginKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<ToolCallId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl ArtifactOrigin {
    #[must_use]
    pub fn tool_output(tool_call_id: ToolCallId) -> Self {
        Self {
            kind: ArtifactOriginKind::ToolOutput,
            tool_call_id: Some(tool_call_id),
            path: None,
        }
    }

    #[must_use]
    pub fn file(path: impl Into<String>) -> Self {
        Self {
            kind: ArtifactOriginKind::File,
            tool_call_id: None,
            path: Some(path.into()),
        }
    }

    #[must_use]
    pub fn attachment() -> Self {
        Self {
            kind: ArtifactOriginKind::Attachment,
            tool_call_id: None,
            path: None,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MutationContractError {
    #[error("unsupported mutation tool schema version {found}; expected {expected}")]
    UnsupportedVersion { expected: u16, found: u16 },
    #[error("mutation field {field} must not be empty")]
    EmptyField { field: &'static str },
    #[error("mutation field {field} exceeds the {limit}-byte limit")]
    FieldTooLong { field: &'static str, limit: usize },
    #[error("mutation field {field} is not a lowercase SHA-256 digest")]
    InvalidSha256 { field: &'static str },
    #[error("mutation field {field} is not a canonical repository-relative path")]
    UnsafePath { field: &'static str },
    #[error("mutation field {field} contains more than {limit} items")]
    TooManyItems { field: &'static str, limit: usize },
    #[error("delete result must report deleted=true")]
    DeleteNotConfirmed,
    #[error("tool result has an invalid content/artifact outcome")]
    InvalidContentOutcome,
    #[error("tool field {field} is outside the supported numeric range")]
    InvalidRange { field: &'static str },
    #[error("tool field {field} contains an invalid value")]
    InvalidValue { field: &'static str },
}

#[derive(Debug, Error)]
pub enum MutationContractDecodeError {
    #[error("mutation tool payload exceeds the {limit}-byte limit")]
    PayloadTooLarge { limit: usize },
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Contract(#[from] MutationContractError),
}

pub fn decode_delete_file_request_json(
    input: &str,
) -> Result<DeleteFileRequest, MutationContractDecodeError> {
    decode_mutation_contract(input, DeleteFileRequest::validate)
}

pub fn decode_read_file_request_json(
    input: &str,
) -> Result<ReadFileRequest, MutationContractDecodeError> {
    decode_tool_contract(
        input,
        MAX_MUTATION_CONTRACT_JSON_BYTES,
        ReadFileRequest::validate,
    )
}

pub fn decode_write_file_request_json(
    input: &str,
) -> Result<WriteFileRequest, MutationContractDecodeError> {
    decode_tool_contract(input, MAX_FILE_TOOL_JSON_BYTES, WriteFileRequest::validate)
}

pub fn decode_apply_patch_request_json(
    input: &str,
) -> Result<ApplyPatchRequest, MutationContractDecodeError> {
    decode_tool_contract(input, MAX_FILE_TOOL_JSON_BYTES, ApplyPatchRequest::validate)
}

pub fn decode_read_file_result_json(
    input: &str,
) -> Result<ReadFileResult, MutationContractDecodeError> {
    decode_tool_contract(input, MAX_FILE_TOOL_JSON_BYTES, ReadFileResult::validate)
}

pub fn decode_write_file_result_json(
    input: &str,
) -> Result<WriteFileResult, MutationContractDecodeError> {
    decode_tool_contract(
        input,
        MAX_MUTATION_CONTRACT_JSON_BYTES,
        WriteFileResult::validate,
    )
}

pub fn decode_apply_patch_result_json(
    input: &str,
) -> Result<ApplyPatchResult, MutationContractDecodeError> {
    decode_tool_contract(
        input,
        MAX_MUTATION_CONTRACT_JSON_BYTES,
        ApplyPatchResult::validate,
    )
}

macro_rules! process_decoder {
    ($name:ident, $ty:ty) => {
        pub fn $name(input: &str) -> Result<$ty, MutationContractDecodeError> {
            decode_tool_contract(input, MAX_PROCESS_TOOL_JSON_BYTES, <$ty>::validate)
        }
    };
}

process_decoder!(decode_process_tool_request_json, ProcessToolRequest);
process_decoder!(decode_process_tool_result_json, ProcessToolResult);
process_decoder!(decode_spawn_job_request_json, SpawnJobRequest);
process_decoder!(decode_spawn_job_result_json, SpawnJobResult);
process_decoder!(decode_job_status_request_json, JobStatusRequest);
process_decoder!(decode_job_status_result_json, JobStatusResult);
process_decoder!(decode_job_stdin_request_json, JobStdinRequest);
process_decoder!(decode_job_stdin_result_json, JobStdinResult);
process_decoder!(decode_job_cancel_request_json, JobCancelRequest);
process_decoder!(decode_job_cancel_result_json, JobCancelResult);

pub fn decode_rename_file_request_json(
    input: &str,
) -> Result<RenameFileRequest, MutationContractDecodeError> {
    decode_mutation_contract(input, RenameFileRequest::validate)
}

pub fn decode_delete_file_result_json(
    input: &str,
) -> Result<DeleteFileResult, MutationContractDecodeError> {
    decode_mutation_contract(input, DeleteFileResult::validate)
}

pub fn decode_rename_file_result_json(
    input: &str,
) -> Result<RenameFileResult, MutationContractDecodeError> {
    decode_mutation_contract(input, RenameFileResult::validate)
}

fn decode_mutation_contract<T>(
    input: &str,
    validate: impl FnOnce(&T) -> Result<(), MutationContractError>,
) -> Result<T, MutationContractDecodeError>
where
    T: DeserializeOwned,
{
    decode_tool_contract(input, MAX_MUTATION_CONTRACT_JSON_BYTES, validate)
}

fn decode_tool_contract<T>(
    input: &str,
    max_json_bytes: usize,
    validate: impl FnOnce(&T) -> Result<(), MutationContractError>,
) -> Result<T, MutationContractDecodeError>
where
    T: DeserializeOwned,
{
    if input.len() > max_json_bytes {
        return Err(MutationContractDecodeError::PayloadTooLarge {
            limit: max_json_bytes,
        });
    }
    let value = serde_json::from_str(input)?;
    validate(&value)?;
    Ok(value)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ReadFileRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub path: String,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub max_bytes: Option<u64>,
}

impl ReadFileRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_path("path", &self.path)?;
        if self.max_bytes.is_some_and(|value| {
            value == 0 || value > u64::try_from(MAX_READ_FILE_BYTES).unwrap_or(u64::MAX)
        }) {
            return Err(MutationContractError::InvalidRange { field: "max_bytes" });
        }
        Ok(())
    }

    #[must_use]
    pub fn effective_max_bytes(&self) -> usize {
        self.max_bytes
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(MAX_READ_FILE_BYTES)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct WriteFileRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub path: String,
    pub content: String,
}

impl WriteFileRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_path("path", &self.path)?;
        validate_bounded_text("content", &self.content, MAX_FILE_CONTENT_BYTES)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ApplyPatchRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub path: String,
    pub expected_sha256: String,
    pub replacement: String,
}

impl ApplyPatchRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_path("path", &self.path)?;
        validate_mutation_sha256("expected_sha256", &self.expected_sha256)?;
        validate_bounded_text("replacement", &self.replacement, MAX_FILE_CONTENT_BYTES)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum ProcessSandbox {
    Required,
    BestEffort,
    None,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ProcessToolRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub program: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[ts(type = "number")]
    pub timeout_ms: u64,
    pub sandbox: ProcessSandbox,
    #[ts(type = "number")]
    pub inline_bytes: u64,
    #[ts(type = "number")]
    pub artifact_bytes: u64,
}

impl ProcessToolRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_program(&self.program)?;
        validate_arguments(&self.arguments)?;
        validate_environment(&self.environment)?;
        if self.timeout_ms == 0 || self.timeout_ms > MAX_PROCESS_TIMEOUT_MS {
            return Err(MutationContractError::InvalidRange {
                field: "timeout_ms",
            });
        }
        if self.inline_bytes == 0
            || self.inline_bytes > MAX_PROCESS_INLINE_BYTES
            || self.artifact_bytes < self.inline_bytes
            || self.artifact_bytes > MAX_PROCESS_ARTIFACT_BYTES
        {
            return Err(MutationContractError::InvalidRange {
                field: "output limits",
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct SpawnJobRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub program: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default)]
    pub pty: bool,
}

impl SpawnJobRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_path("program", &self.program)?;
        validate_program(&self.program)?;
        validate_arguments(&self.arguments)?;
        validate_environment(&self.environment)
    }
}

macro_rules! job_id_request {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
        #[serde(deny_unknown_fields)]
        #[ts(export, export_to = "../../../clients/typescript/generated/")]
        pub struct $name {
            #[ts(type = "1")]
            pub schema_version: u16,
            pub id: String,
        }

        impl $name {
            pub fn validate(&self) -> Result<(), MutationContractError> {
                validate_mutation_version(self.schema_version)?;
                validate_job_id(&self.id)
            }
        }
    };
}

job_id_request!(JobStatusRequest);
job_id_request!(JobCancelRequest);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct JobStdinRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub id: String,
    pub input: String,
}

impl JobStdinRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_job_id(&self.id)?;
        validate_bounded_text("input", &self.input, MAX_JOB_STDIN_BYTES)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct DeleteFileRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub path: String,
    pub expected_sha256: String,
}

impl DeleteFileRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_path("path", &self.path)?;
        validate_mutation_sha256("expected_sha256", &self.expected_sha256)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct RenameFileRequest {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub path: String,
    pub destination: String,
    pub expected_sha256: String,
}

impl RenameFileRequest {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_path("path", &self.path)?;
        validate_mutation_path("destination", &self.destination)?;
        validate_mutation_sha256("expected_sha256", &self.expected_sha256)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum FormatterMutationStatus {
    Unchanged,
    Formatted,
    Failed,
    Cancelled,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct MutationDiagnostic {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct MutationProofImpact {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_hash: Option<String>,
    pub invalidated_paths: Vec<String>,
    pub requires_reprove: bool,
}

impl MutationProofImpact {
    fn validate(&self) -> Result<(), MutationContractError> {
        if let Some(edit_hash) = &self.edit_hash {
            validate_mutation_sha256("editHash", edit_hash)?;
        }
        if self.invalidated_paths.len() > MAX_MUTATION_INVALIDATED_PATHS {
            return Err(MutationContractError::TooManyItems {
                field: "invalidatedPaths",
                limit: MAX_MUTATION_INVALIDATED_PATHS,
            });
        }
        for path in &self.invalidated_paths {
            validate_mutation_path("invalidatedPaths", path)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct FormatterMutationResult {
    pub name: String,
    pub status: FormatterMutationStatus,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
    pub diagnostic: Option<MutationDiagnostic>,
    pub proof_impact: MutationProofImpact,
}

impl FormatterMutationResult {
    fn validate(&self) -> Result<(), MutationContractError> {
        validate_bounded_text("formatter.name", &self.name, MAX_PROTOCOL_ID_BYTES)?;
        if let Some(value) = &self.before_sha256 {
            validate_mutation_sha256("formatter.beforeSha256", value)?;
        }
        if let Some(value) = &self.after_sha256 {
            validate_mutation_sha256("formatter.afterSha256", value)?;
        }
        if let Some(diagnostic) = &self.diagnostic {
            validate_bounded_text(
                "formatter.diagnostic.code",
                &diagnostic.code,
                MAX_PROTOCOL_ID_BYTES,
            )?;
            validate_bounded_text(
                "formatter.diagnostic.message",
                &diagnostic.message,
                MAX_MUTATION_DIAGNOSTIC_BYTES,
            )?;
        }
        self.proof_impact.validate()
    }
}

/// Which half of the format-then-check gate a command served.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum WriteCheckStage {
    Format,
    Check,
}

/// How one gate command resolved. Only `Passed` clears the write; every other
/// outcome leaves the mutation on disk but unverified.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum WriteCheckOutcome {
    Passed,
    Failed,
    TimedOut,
    Cancelled,
    Unavailable,
}

/// What one configured formatter or lint/typecheck command did to the written
/// file: which stage it served, how it exited, and its bounded diagnostics.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct WriteCheckRun {
    pub name: String,
    pub stage: WriteCheckStage,
    pub outcome: WriteCheckOutcome,
    pub exit_code: Option<i32>,
    pub diagnostics: String,
}

impl WriteCheckRun {
    fn validate(&self) -> Result<(), MutationContractError> {
        validate_bounded_text("checker.name", &self.name, MAX_PROTOCOL_ID_BYTES)?;
        validate_max_text(
            "checker.diagnostics",
            &self.diagnostics,
            MAX_MUTATION_DIAGNOSTIC_BYTES,
        )
    }
}

/// Whether the written bytes were checked, and by what.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum WriteCheckStatus {
    /// No formatter and no checker is configured for this file's language, so
    /// the write carries no assurance beyond landing on disk.
    #[default]
    NotConfigured,
    /// At least one configured command ran; `runs` reports every one of them.
    Checked,
}

/// The checker verdict attached to a write. A result whose `status` is
/// `Checked` and whose `runs` all `Passed` is the only clean write; anything
/// else is a mutation a client must surface rather than silently accept.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct WriteCheckVerdict {
    pub status: WriteCheckStatus,
    pub runs: Vec<WriteCheckRun>,
}

impl WriteCheckVerdict {
    /// The verdict a server attaches when the file's language configures no
    /// formatter and no checker.
    #[must_use]
    pub fn not_configured() -> Self {
        Self::default()
    }

    /// True when nothing was configured to check the write, or when every
    /// command that ran passed.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.runs
            .iter()
            .all(|run| run.outcome == WriteCheckOutcome::Passed)
    }

    fn validate(&self) -> Result<(), MutationContractError> {
        if self.runs.len() > MAX_MUTATION_WRITE_CHECKS {
            return Err(MutationContractError::TooManyItems {
                field: "checker.runs",
                limit: MAX_MUTATION_WRITE_CHECKS,
            });
        }
        // A verdict must not claim more or less than it can show: `checked`
        // with no runs would report assurance nothing produced, and
        // `not_configured` with runs would hide commands that did execute.
        if self.runs.is_empty() != (self.status == WriteCheckStatus::NotConfigured) {
            return Err(MutationContractError::InvalidValue {
                field: "checker.status",
            });
        }
        for run in &self.runs {
            run.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ReadFileResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub sha256: String,
    #[ts(type = "number")]
    pub byte_length: u64,
    pub content: Option<String>,
    pub artifact: Option<ArtifactRef>,
}

impl ReadFileResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_sha256("sha256", &self.sha256)?;
        match (&self.content, &self.artifact) {
            (Some(content), None) => {
                validate_bounded_text("content", content, MAX_READ_FILE_BYTES)?;
                if self.byte_length != u64::try_from(content.len()).unwrap_or(u64::MAX)
                    || format!("{:x}", Sha256::digest(content.as_bytes())) != self.sha256
                {
                    return Err(MutationContractError::InvalidContentOutcome);
                }
            }
            (None, Some(artifact)) => {
                validate_bounded_text("artifact.id", &artifact.id.0, MAX_PROTOCOL_ID_BYTES)?;
                validate_mutation_sha256("artifact.sha256", &artifact.sha256)?;
                validate_bounded_text(
                    "artifact.media_type",
                    &artifact.media_type,
                    MAX_PROTOCOL_ID_BYTES,
                )?;
                if artifact.sha256 != self.sha256 || artifact.byte_length != self.byte_length {
                    return Err(MutationContractError::InvalidContentOutcome);
                }
                if artifact.byte_length > u64::try_from(MAX_FILE_CONTENT_BYTES).unwrap_or(u64::MAX)
                {
                    return Err(MutationContractError::InvalidRange {
                        field: "artifact.byte_length",
                    });
                }
            }
            _ => return Err(MutationContractError::InvalidContentOutcome),
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ProcessArtifactOutcome {
    pub artifact_id: String,
    pub sha256: String,
    pub media_type: String,
    #[ts(type = "number")]
    pub byte_length: u64,
}

impl ProcessArtifactOutcome {
    fn validate(&self) -> Result<(), MutationContractError> {
        validate_bounded_text("artifactId", &self.artifact_id, MAX_PROTOCOL_ID_BYTES)?;
        validate_mutation_sha256("artifact.sha256", &self.sha256)?;
        validate_bounded_text(
            "artifact.mediaType",
            &self.media_type,
            MAX_PROTOCOL_ID_BYTES,
        )?;
        if self.byte_length > MAX_PROCESS_ARTIFACT_BYTES {
            return Err(MutationContractError::InvalidRange {
                field: "artifact.byteLength",
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ProcessToolResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub stdout_artifact: Option<ProcessArtifactOutcome>,
    pub stderr_artifact: Option<ProcessArtifactOutcome>,
    #[ts(type = "number")]
    pub stdout_bytes: u64,
    #[ts(type = "number")]
    pub stderr_bytes: u64,
    pub truncated: bool,
    pub filtered_environment: Vec<String>,
    pub provenance: String,
}

impl ProcessToolResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_max_text("stdout", &self.stdout, MAX_PROCESS_INLINE_BYTES as usize)?;
        validate_max_text("stderr", &self.stderr, MAX_PROCESS_INLINE_BYTES as usize)?;
        if self.success && self.exit_code != Some(0) {
            return Err(MutationContractError::InvalidValue { field: "success" });
        }
        for artifact in [&self.stdout_artifact, &self.stderr_artifact]
            .into_iter()
            .flatten()
        {
            artifact.validate()?;
        }
        if self.filtered_environment.len() > MAX_PROCESS_ENVIRONMENT {
            return Err(MutationContractError::TooManyItems {
                field: "filteredEnvironment",
                limit: MAX_PROCESS_ENVIRONMENT,
            });
        }
        for name in &self.filtered_environment {
            validate_environment_name(name)?;
        }
        if self.provenance != "tool-output" {
            return Err(MutationContractError::InvalidValue {
                field: "provenance",
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct SpawnJobResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub job_id: String,
    pub owned: bool,
}

impl SpawnJobResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_job_id(&self.job_id)?;
        if !self.owned {
            return Err(MutationContractError::InvalidValue { field: "owned" });
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum JobStatusKind {
    Background,
    Pty,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum JobStatusState {
    Running,
    Exited,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct JobStatusResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub id: String,
    pub kind: JobStatusKind,
    pub state: JobStatusState,
    pub stdout: String,
    pub stderr: String,
    #[ts(type = "number")]
    pub stdout_bytes: u64,
    #[ts(type = "number")]
    pub stderr_bytes: u64,
    pub truncated: bool,
}

impl JobStatusResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_job_id(&self.id)?;
        validate_max_text("stdout", &self.stdout, MAX_PROCESS_INLINE_BYTES as usize)?;
        validate_max_text("stderr", &self.stderr, MAX_PROCESS_INLINE_BYTES as usize)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct JobStdinResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    #[ts(type = "number")]
    pub written: u64,
}

impl JobStdinResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        if self.written == 0 || self.written > MAX_JOB_STDIN_BYTES as u64 {
            return Err(MutationContractError::InvalidRange { field: "written" });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct JobCancelResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub cancelled: bool,
}

impl JobCancelResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        if !self.cancelled {
            return Err(MutationContractError::InvalidValue { field: "cancelled" });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct WriteFileResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub sha256: String,
    pub checkpoint_id: String,
    pub formatter: Vec<FormatterMutationResult>,
    /// Additive since the field was introduced: a payload without it decodes
    /// as `not_configured`, which is what a server that ran no checker means.
    #[serde(default)]
    pub checker: WriteCheckVerdict,
    pub proof_impact: MutationProofImpact,
}

impl WriteFileResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_file_mutation_result(
            self.schema_version,
            &self.sha256,
            &self.checkpoint_id,
            &self.formatter,
            &self.checker,
            &self.proof_impact,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct ApplyPatchResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub sha256: String,
    pub checkpoint_id: String,
    pub formatter: Vec<FormatterMutationResult>,
    /// Additive since the field was introduced: a payload without it decodes
    /// as `not_configured`, which is what a server that ran no checker means.
    #[serde(default)]
    pub checker: WriteCheckVerdict,
    pub proof_impact: MutationProofImpact,
}

impl ApplyPatchResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_file_mutation_result(
            self.schema_version,
            &self.sha256,
            &self.checkpoint_id,
            &self.formatter,
            &self.checker,
            &self.proof_impact,
        )
    }
}

fn validate_file_mutation_result(
    schema_version: u16,
    sha256: &str,
    checkpoint_id: &str,
    formatter: &[FormatterMutationResult],
    checker: &WriteCheckVerdict,
    proof_impact: &MutationProofImpact,
) -> Result<(), MutationContractError> {
    validate_mutation_version(schema_version)?;
    validate_mutation_sha256("sha256", sha256)?;
    validate_bounded_text("checkpointId", checkpoint_id, MAX_PROTOCOL_ID_BYTES)?;
    if formatter.len() > MAX_MUTATION_FORMATTERS {
        return Err(MutationContractError::TooManyItems {
            field: "formatter",
            limit: MAX_MUTATION_FORMATTERS,
        });
    }
    for result in formatter {
        result.validate()?;
    }
    checker.validate()?;
    proof_impact.validate()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct DeleteFileResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub sha256: String,
    pub deleted: bool,
    pub checkpoint_id: String,
    pub proof_impact: MutationProofImpact,
}

impl DeleteFileResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_sha256("sha256", &self.sha256)?;
        validate_bounded_text("checkpointId", &self.checkpoint_id, MAX_PROTOCOL_ID_BYTES)?;
        if !self.deleted {
            return Err(MutationContractError::DeleteNotConfirmed);
        }
        self.proof_impact.validate()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct RenameFileResult {
    #[ts(type = "1")]
    pub schema_version: u16,
    pub sha256: String,
    pub source: String,
    pub destination: String,
    pub checkpoint_id: String,
    pub formatter: Vec<FormatterMutationResult>,
    pub proof_impact: MutationProofImpact,
}

impl RenameFileResult {
    pub fn validate(&self) -> Result<(), MutationContractError> {
        validate_mutation_version(self.schema_version)?;
        validate_mutation_sha256("sha256", &self.sha256)?;
        validate_mutation_path("source", &self.source)?;
        validate_mutation_path("destination", &self.destination)?;
        validate_bounded_text("checkpointId", &self.checkpoint_id, MAX_PROTOCOL_ID_BYTES)?;
        if self.formatter.len() > MAX_MUTATION_FORMATTERS {
            return Err(MutationContractError::TooManyItems {
                field: "formatter",
                limit: MAX_MUTATION_FORMATTERS,
            });
        }
        for formatter in &self.formatter {
            formatter.validate()?;
        }
        self.proof_impact.validate()
    }
}

fn validate_mutation_version(version: u16) -> Result<(), MutationContractError> {
    if version == MUTATION_TOOL_SCHEMA_VERSION {
        Ok(())
    } else {
        Err(MutationContractError::UnsupportedVersion {
            expected: MUTATION_TOOL_SCHEMA_VERSION,
            found: version,
        })
    }
}

fn validate_mutation_path(field: &'static str, value: &str) -> Result<(), MutationContractError> {
    validate_bounded_text(field, value, MAX_MUTATION_PATH_BYTES)?;
    if value.starts_with('/')
        || value.starts_with('\\')
        || value.contains('\\')
        || value.bytes().any(|byte| byte.is_ascii_control())
        || value
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
        || value.as_bytes().get(1) == Some(&b':')
    {
        Err(MutationContractError::UnsafePath { field })
    } else {
        Ok(())
    }
}

fn validate_bounded_text(
    field: &'static str,
    value: &str,
    limit: usize,
) -> Result<(), MutationContractError> {
    if value.is_empty() {
        Err(MutationContractError::EmptyField { field })
    } else if value.len() > limit {
        Err(MutationContractError::FieldTooLong { field, limit })
    } else {
        Ok(())
    }
}

fn validate_max_text(
    field: &'static str,
    value: &str,
    limit: usize,
) -> Result<(), MutationContractError> {
    if value.len() > limit {
        Err(MutationContractError::FieldTooLong { field, limit })
    } else {
        Ok(())
    }
}

fn validate_mutation_sha256(field: &'static str, value: &str) -> Result<(), MutationContractError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(MutationContractError::InvalidSha256 { field })
    }
}

fn validate_program(value: &str) -> Result<(), MutationContractError> {
    validate_bounded_text("program", value, MAX_MUTATION_PATH_BYTES)?;
    if value
        .bytes()
        .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        || value.contains([';', '|', '&', '$', '`'])
    {
        Err(MutationContractError::InvalidValue { field: "program" })
    } else {
        Ok(())
    }
}

fn validate_arguments(arguments: &[String]) -> Result<(), MutationContractError> {
    if arguments.len() > MAX_PROCESS_ARGUMENTS {
        return Err(MutationContractError::TooManyItems {
            field: "arguments",
            limit: MAX_PROCESS_ARGUMENTS,
        });
    }
    let mut total = 0_usize;
    for argument in arguments {
        if argument.len() > MAX_PROCESS_ARGUMENT_BYTES || argument.bytes().any(|byte| byte == 0) {
            return Err(MutationContractError::InvalidValue { field: "arguments" });
        }
        total = total.saturating_add(argument.len());
    }
    if total > MAX_PROCESS_ARGUMENT_TOTAL_BYTES {
        return Err(MutationContractError::FieldTooLong {
            field: "arguments",
            limit: MAX_PROCESS_ARGUMENT_TOTAL_BYTES,
        });
    }
    Ok(())
}

fn validate_environment(
    environment: &BTreeMap<String, String>,
) -> Result<(), MutationContractError> {
    if environment.len() > MAX_PROCESS_ENVIRONMENT {
        return Err(MutationContractError::TooManyItems {
            field: "environment",
            limit: MAX_PROCESS_ENVIRONMENT,
        });
    }
    let mut total = 0_usize;
    for (name, value) in environment {
        validate_environment_name(name)?;
        if value.len() > MAX_PROCESS_ARGUMENT_BYTES || value.bytes().any(|byte| byte == 0) {
            return Err(MutationContractError::InvalidValue {
                field: "environment",
            });
        }
        total = total.saturating_add(name.len()).saturating_add(value.len());
    }
    if total > MAX_PROCESS_ENVIRONMENT_TOTAL_BYTES {
        return Err(MutationContractError::FieldTooLong {
            field: "environment",
            limit: MAX_PROCESS_ENVIRONMENT_TOTAL_BYTES,
        });
    }
    Ok(())
}

fn validate_environment_name(name: &str) -> Result<(), MutationContractError> {
    let mut bytes = name.bytes();
    if name.len() > MAX_PROTOCOL_ID_BYTES
        || !bytes
            .next()
            .is_some_and(|byte| byte == b'_' || byte.is_ascii_alphabetic())
        || !bytes.all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
    {
        Err(MutationContractError::InvalidValue {
            field: "environment",
        })
    } else {
        Ok(())
    }
}

fn validate_job_id(id: &str) -> Result<(), MutationContractError> {
    validate_bounded_text("id", id, MAX_PROTOCOL_ID_BYTES)?;
    if id
        .bytes()
        .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        Err(MutationContractError::InvalidValue { field: "id" })
    } else {
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct Message {
    pub schema_version: u16,
    pub id: MessageId,
    pub session_id: SessionId,
    #[ts(type = "number")]
    pub created_at_ms: u64,
    pub parts: Vec<MessagePart>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct MessagePart {
    pub schema_version: u16,
    pub id: PartId,
    pub state: PartState,
    pub provenance: Provenance,
    #[ts(type = "import(\"./MessagePartBody\").MessagePartBody | { type: string, data: unknown }")]
    pub body: MessagePartBody,
}

/// The persisted message-part union. Provider replay metadata is kept on the
/// variants that require it; raw provider payloads must never be stored here.
#[derive(Clone, Debug, PartialEq, TS)]
#[ts(tag = "type", content = "data", rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
#[non_exhaustive]
pub enum MessagePartBody {
    Text {
        text: String,
    },
    Reasoning {
        text: String,
        #[ts(type = "unknown")]
        provider_metadata: Value,
    },
    ToolCall {
        tool_call_id: ToolCallId,
        name: String,
        #[ts(type = "unknown")]
        arguments: Value,
    },
    ToolResult {
        tool_call_id: ToolCallId,
        output: Option<String>,
        artifact: Option<ArtifactRef>,
        is_error: bool,
    },
    File {
        path: String,
        artifact: ArtifactRef,
    },
    Image {
        artifact: ArtifactRef,
        alt: Option<String>,
    },
    Source {
        url: String,
        #[ts(type = "number")]
        retrieved_at_ms: u64,
        title: Option<String>,
    },
    Patch {
        operation_id: OperationId,
        patch: String,
    },
    Snapshot {
        operation_id: OperationId,
        sha256: String,
    },
    Retry {
        operation_id: OperationId,
        attempt: u32,
        cause: String,
    },
    Compaction {
        replaced_message_ids: Vec<MessageId>,
        summary: String,
        #[ts(type = "unknown")]
        provider_metadata: Value,
    },
    Question {
        prompt: String,
    },
    Permission {
        permission: String,
        decision: String,
    },
    StepStart {
        operation_id: OperationId,
        label: String,
    },
    StepFinish {
        operation_id: OperationId,
        outcome: String,
    },
    Subagent {
        child_session_id: SessionId,
        #[ts(type = "unknown")]
        result: Value,
    },
    ReviewFinding {
        classification: String,
        summary: String,
        blocking: bool,
    },
    Error {
        code: String,
        message: String,
        retryable: bool,
    },
    /// A payload held by reference. Introduced at part schema version
    /// [`ARTIFACT_PART_SCHEMA_VERSION`]: large or binary tool output is written
    /// to content-addressed storage and referenced here instead of being
    /// inlined into the transcript.
    Artifact {
        artifact: ArtifactRef,
        origin: ArtifactOrigin,
        /// A truncated rendering of the artifact bytes, kept only so a client
        /// can show something without fetching. Derived data: the artifact is
        /// the source of truth.
        preview: Option<String>,
    },
    /// A part introduced by another compatible minor protocol version. Its
    /// discriminator and JSON payload remain opaque and are emitted unchanged.
    #[ts(skip)]
    Unknown {
        type_name: String,
        #[ts(type = "unknown")]
        data: Value,
    },
}

impl Serialize for MessagePartBody {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let (part_type, data) = match self {
            Self::Text { text } => ("text", serde_json::json!({ "text": text })),
            Self::Reasoning {
                text,
                provider_metadata,
            } => (
                "reasoning",
                serde_json::json!({ "text": text, "provider_metadata": provider_metadata }),
            ),
            Self::ToolCall {
                tool_call_id,
                name,
                arguments,
            } => (
                "tool_call",
                serde_json::json!({ "tool_call_id": tool_call_id, "name": name, "arguments": arguments }),
            ),
            Self::ToolResult {
                tool_call_id,
                output,
                artifact,
                is_error,
            } => (
                "tool_result",
                serde_json::json!({ "tool_call_id": tool_call_id, "output": output, "artifact": artifact, "is_error": is_error }),
            ),
            Self::File { path, artifact } => (
                "file",
                serde_json::json!({ "path": path, "artifact": artifact }),
            ),
            Self::Image { artifact, alt } => (
                "image",
                serde_json::json!({ "artifact": artifact, "alt": alt }),
            ),
            Self::Source {
                url,
                retrieved_at_ms,
                title,
            } => (
                "source",
                serde_json::json!({ "url": url, "retrieved_at_ms": retrieved_at_ms, "title": title }),
            ),
            Self::Patch {
                operation_id,
                patch,
            } => (
                "patch",
                serde_json::json!({ "operation_id": operation_id, "patch": patch }),
            ),
            Self::Snapshot {
                operation_id,
                sha256,
            } => (
                "snapshot",
                serde_json::json!({ "operation_id": operation_id, "sha256": sha256 }),
            ),
            Self::Retry {
                operation_id,
                attempt,
                cause,
            } => (
                "retry",
                serde_json::json!({ "operation_id": operation_id, "attempt": attempt, "cause": cause }),
            ),
            Self::Compaction {
                replaced_message_ids,
                summary,
                provider_metadata,
            } => (
                "compaction",
                serde_json::json!({ "replaced_message_ids": replaced_message_ids, "summary": summary, "provider_metadata": provider_metadata }),
            ),
            Self::Question { prompt } => ("question", serde_json::json!({ "prompt": prompt })),
            Self::Permission {
                permission,
                decision,
            } => (
                "permission",
                serde_json::json!({ "permission": permission, "decision": decision }),
            ),
            Self::StepStart {
                operation_id,
                label,
            } => (
                "step_start",
                serde_json::json!({ "operation_id": operation_id, "label": label }),
            ),
            Self::StepFinish {
                operation_id,
                outcome,
            } => (
                "step_finish",
                serde_json::json!({ "operation_id": operation_id, "outcome": outcome }),
            ),
            Self::Subagent {
                child_session_id,
                result,
            } => (
                "subagent",
                serde_json::json!({ "child_session_id": child_session_id, "result": result }),
            ),
            Self::ReviewFinding {
                classification,
                summary,
                blocking,
            } => (
                "review_finding",
                serde_json::json!({ "classification": classification, "summary": summary, "blocking": blocking }),
            ),
            Self::Error {
                code,
                message,
                retryable,
            } => (
                "error",
                serde_json::json!({ "code": code, "message": message, "retryable": retryable }),
            ),
            Self::Artifact {
                artifact,
                origin,
                preview,
            } => (
                "artifact",
                serde_json::json!({ "artifact": artifact, "origin": origin, "preview": preview }),
            ),
            Self::Unknown { type_name, data } => {
                return serde_json::json!({ "type": type_name, "data": data })
                    .serialize(serializer);
            }
        };
        serde_json::json!({ "type": part_type, "data": data }).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MessagePartBody {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mut wire = Value::deserialize(deserializer)?;
        let object = wire
            .as_object_mut()
            .ok_or_else(|| serde::de::Error::custom("message part body must be an object"))?;
        let part_type = object
            .remove("type")
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(|| serde::de::Error::custom("message part body requires a string type"))?;
        let mut data = object.remove("data").unwrap_or(Value::Null);
        macro_rules! field {
            ($name:literal, $ty:ty) => {{
                let value = data
                    .as_object_mut()
                    .and_then(|object| object.remove($name))
                    .ok_or_else(|| {
                        serde::de::Error::custom(concat!("missing message part field: ", $name))
                    })?;
                serde_json::from_value::<$ty>(value).map_err(serde::de::Error::custom)?
            }};
        }
        macro_rules! optional_field {
            ($name:literal, $ty:ty) => {{
                match data.as_object_mut().and_then(|object| object.remove($name)) {
                    Some(value) => serde_json::from_value::<Option<$ty>>(value)
                        .map_err(serde::de::Error::custom)?,
                    None => None,
                }
            }};
        }
        Ok(match part_type.as_str() {
            "text" => Self::Text {
                text: field!("text", String),
            },
            "reasoning" => Self::Reasoning {
                text: field!("text", String),
                provider_metadata: field!("provider_metadata", Value),
            },
            "tool_call" => Self::ToolCall {
                tool_call_id: field!("tool_call_id", ToolCallId),
                name: field!("name", String),
                arguments: field!("arguments", Value),
            },
            "tool_result" => Self::ToolResult {
                tool_call_id: field!("tool_call_id", ToolCallId),
                output: optional_field!("output", String),
                artifact: optional_field!("artifact", ArtifactRef),
                is_error: field!("is_error", bool),
            },
            "file" => Self::File {
                path: field!("path", String),
                artifact: field!("artifact", ArtifactRef),
            },
            "image" => Self::Image {
                artifact: field!("artifact", ArtifactRef),
                alt: optional_field!("alt", String),
            },
            "source" => Self::Source {
                url: field!("url", String),
                retrieved_at_ms: field!("retrieved_at_ms", u64),
                title: optional_field!("title", String),
            },
            "patch" => Self::Patch {
                operation_id: field!("operation_id", OperationId),
                patch: field!("patch", String),
            },
            "snapshot" => Self::Snapshot {
                operation_id: field!("operation_id", OperationId),
                sha256: field!("sha256", String),
            },
            "retry" => Self::Retry {
                operation_id: field!("operation_id", OperationId),
                attempt: field!("attempt", u32),
                cause: field!("cause", String),
            },
            "compaction" => Self::Compaction {
                replaced_message_ids: field!("replaced_message_ids", Vec<MessageId>),
                summary: field!("summary", String),
                provider_metadata: field!("provider_metadata", Value),
            },
            "question" => Self::Question {
                prompt: field!("prompt", String),
            },
            "permission" => Self::Permission {
                permission: field!("permission", String),
                decision: field!("decision", String),
            },
            "step_start" => Self::StepStart {
                operation_id: field!("operation_id", OperationId),
                label: field!("label", String),
            },
            "step_finish" => Self::StepFinish {
                operation_id: field!("operation_id", OperationId),
                outcome: field!("outcome", String),
            },
            "subagent" => Self::Subagent {
                child_session_id: field!("child_session_id", SessionId),
                result: field!("result", Value),
            },
            "review_finding" => Self::ReviewFinding {
                classification: field!("classification", String),
                summary: field!("summary", String),
                blocking: field!("blocking", bool),
            },
            "error" => Self::Error {
                code: field!("code", String),
                message: field!("message", String),
                retryable: field!("retryable", bool),
            },
            "artifact" => Self::Artifact {
                artifact: field!("artifact", ArtifactRef),
                origin: field!("origin", ArtifactOrigin),
                preview: optional_field!("preview", String),
            },
            _ => Self::Unknown {
                type_name: part_type,
                data,
            },
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct EventCursor(pub String);

impl fmt::Display for EventCursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// A cursor is a tagged union, never a bare offset, so a later cursor form does
/// not force a second pagination method. An unrecognized tag keeps its payload
/// and re-encodes byte for byte.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum CursorForm {
    /// Keyset position in a monotonically increasing append sequence. It names
    /// an element rather than a distance from the start, so appends never shift
    /// what an outstanding cursor points at.
    Sequence { sequence: u64 },
    /// A form this build does not know, preserved verbatim.
    Unknown { tag: String, body: String },
}

impl CursorForm {
    #[must_use]
    pub fn tag(&self) -> &str {
        match self {
            Self::Sequence { .. } => EVENT_CURSOR_SEQUENCE_TAG,
            Self::Unknown { tag, .. } => tag.as_str(),
        }
    }

    #[must_use]
    pub fn is_known(&self) -> bool {
        !matches!(self, Self::Unknown { .. })
    }

    #[must_use]
    pub fn encode(&self) -> EventCursor {
        match self {
            Self::Sequence { sequence } => EventCursor(format!(
                "{EVENT_CURSOR_SEQUENCE_TAG}:{sequence:0width$}",
                width = EVENT_CURSOR_SEQUENCE_WIDTH
            )),
            Self::Unknown { tag, body } => EventCursor(format!("{tag}:{body}")),
        }
    }
}

impl EventCursor {
    /// The cursor naming position `sequence` in an append-ordered log.
    #[must_use]
    pub fn for_sequence(sequence: u64) -> Self {
        CursorForm::Sequence { sequence }.encode()
    }

    /// Decode the cursor into its tagged form. An unrecognized tag is retained
    /// rather than rejected, so a cursor minted by a newer peer survives.
    pub fn form(&self) -> Result<CursorForm, ProtocolDecodeError> {
        if self.0.len() > MAX_EVENT_CURSOR_BYTES {
            return Err(ProtocolDecodeError::FieldTooLong {
                field: "event.cursor",
                limit: MAX_EVENT_CURSOR_BYTES,
            });
        }
        let (tag, body) = self
            .0
            .split_once(':')
            .ok_or(ProtocolDecodeError::InvalidField {
                field: "event.cursor",
            })?;
        if tag.is_empty() {
            return Err(ProtocolDecodeError::InvalidField {
                field: "event.cursor",
            });
        }
        if tag == EVENT_CURSOR_SEQUENCE_TAG {
            let sequence = body
                .parse::<u64>()
                .map_err(|_| ProtocolDecodeError::InvalidField {
                    field: "event.cursor",
                })?;
            return Ok(CursorForm::Sequence { sequence });
        }
        Ok(CursorForm::Unknown {
            tag: tag.to_owned(),
            body: body.to_owned(),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct EventEnvelope {
    pub protocol_version: ProtocolVersion,
    pub id: EventId,
    pub cursor: EventCursor,
    pub session_id: SessionId,
    #[ts(type = "number")]
    pub emitted_at_ms: u64,
    pub event: Event,
}

/// Decode a persisted or transported event according to the protocol version
/// carried by the envelope. Unknown parts are accepted only when the peers'
/// minor versions differ, and remain opaque for lossless JSON round-tripping.
pub fn decode_event_envelope_json(json: &str) -> Result<EventEnvelope, ProtocolDecodeError> {
    if json.len() > MAX_EVENT_JSON_BYTES {
        return Err(ProtocolDecodeError::PayloadTooLarge {
            limit: MAX_EVENT_JSON_BYTES,
        });
    }
    let value: Value = serde_json::from_str(json)?;
    let remote: ProtocolVersion = serde_json::from_value(
        value
            .get("protocol_version")
            .cloned()
            .unwrap_or(Value::Null),
    )?;
    let negotiated = negotiate(CURRENT_PROTOCOL_VERSION, remote)?;
    let mut envelope: EventEnvelope = serde_json::from_value(value)?;
    redact_provider_metadata(&mut envelope.event);
    validate_envelope_bounds(&envelope)?;
    if negotiated.unknown_parts == UnknownPartPolicy::Reject
        && let Some(part_type) = first_unknown_part(&envelope.event)
    {
        return Err(ProtocolDecodeError::UnknownPartAtEqualVersion {
            part_type: part_type.to_owned(),
            version_major: remote.major,
            version_minor: remote.minor,
        });
    }
    Ok(envelope)
}

fn validate_envelope_bounds(envelope: &EventEnvelope) -> Result<(), ProtocolDecodeError> {
    validate_field("event.id", &envelope.id.0, MAX_PROTOCOL_ID_BYTES)?;
    validate_field(
        "event.session_id",
        &envelope.session_id.0,
        MAX_PROTOCOL_ID_BYTES,
    )?;
    validate_field("event.cursor", &envelope.cursor.0, MAX_EVENT_CURSOR_BYTES)?;
    match &envelope.event {
        Event::MessageAppended { message } => {
            if message.schema_version != 1 {
                return Err(ProtocolDecodeError::UnsupportedSchema {
                    field: "message",
                    found: message.schema_version,
                });
            }
            validate_field("message.id", &message.id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_field(
                "message.session_id",
                &message.session_id.0,
                MAX_PROTOCOL_ID_BYTES,
            )?;
            if message.session_id != envelope.session_id {
                return Err(ProtocolDecodeError::SessionMismatch);
            }
            if message.parts.len() > MAX_MESSAGE_PARTS {
                return Err(ProtocolDecodeError::TooManyParts {
                    limit: MAX_MESSAGE_PARTS,
                });
            }
            if message.parts.is_empty() {
                return Err(ProtocolDecodeError::InvalidField {
                    field: "message.parts",
                });
            }
            let mut part_ids = BTreeSet::new();
            for part in &message.parts {
                validate_field("message.part.id", &part.id.0, MAX_PROTOCOL_ID_BYTES)?;
                if !part_ids.insert(&part.id.0) {
                    return Err(ProtocolDecodeError::DuplicateId {
                        field: "message.parts",
                    });
                }
                validate_part_bounds(part)?;
                if let MessagePartBody::Compaction {
                    replaced_message_ids,
                    ..
                } = &part.body
                    && replaced_message_ids.contains(&message.id)
                {
                    return Err(ProtocolDecodeError::InvalidField {
                        field: "compaction.replaced_message_ids",
                    });
                }
            }
        }
        Event::MessagePartUpdated { message_id, part } => {
            validate_field("message.id", &message_id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_field("message.part.id", &part.id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_part_bounds(part)?;
        }
        Event::Cancelled {
            operation_id: Some(operation_id),
            reason,
        } => {
            validate_field("operation.id", &operation_id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("cancelled.reason", reason, MAX_MESSAGE_TEXT_BYTES)?;
        }
        Event::Cancelled {
            operation_id: None,
            reason,
        } => validate_text("cancelled.reason", reason, MAX_MESSAGE_TEXT_BYTES)?,
        Event::SessionStateChanged { state } => {
            validate_field("session.state", state, MAX_PROTOCOL_ID_BYTES)?;
        }
        Event::Error { code, message } => {
            validate_field("event.error.code", code, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("event.error.message", message, MAX_MESSAGE_TEXT_BYTES)?;
        }
        Event::Heartbeat => {}
    }
    Ok(())
}

fn validate_part_bounds(part: &MessagePart) -> Result<(), ProtocolDecodeError> {
    if part.schema_version == 0 {
        return Err(ProtocolDecodeError::UnsupportedSchema {
            field: "message.part",
            found: 0,
        });
    }
    if !matches!(part.body, MessagePartBody::Unknown { .. })
        && (part.schema_version > MAX_PART_SCHEMA_VERSION
            || part.schema_version < minimum_part_schema_version(&part.body))
    {
        return Err(ProtocolDecodeError::UnsupportedSchema {
            field: "message.part",
            found: part.schema_version,
        });
    }
    validate_part_state(part)?;
    match &part.body {
        MessagePartBody::Text { text } => {
            validate_text("message.text", text, MAX_MESSAGE_TEXT_BYTES)?
        }
        MessagePartBody::Reasoning {
            text,
            provider_metadata,
        } => {
            validate_text("message.reasoning", text, MAX_MESSAGE_TEXT_BYTES)?;
            validate_value_size(
                "provider_metadata",
                provider_metadata,
                MAX_MESSAGE_METADATA_BYTES,
            )?;
        }
        MessagePartBody::ToolCall {
            tool_call_id,
            name,
            arguments,
        } => {
            validate_field("tool_call.id", &tool_call_id.0, MAX_PROTOCOL_ID_BYTES)?;
            if !name.is_empty() {
                validate_text("tool_call.name", name, MAX_PROTOCOL_ID_BYTES)?;
            }
            validate_value_size("tool_call.arguments", arguments, MAX_MESSAGE_METADATA_BYTES)?;
        }
        MessagePartBody::ToolResult {
            tool_call_id,
            output,
            artifact,
            is_error,
        } => {
            validate_field("tool_call.id", &tool_call_id.0, MAX_PROTOCOL_ID_BYTES)?;
            if output.is_some() == artifact.is_some() {
                return Err(ProtocolDecodeError::InvalidToolResult);
            }
            if let Some(output) = output {
                validate_text("tool_result.output", output, MAX_MESSAGE_TEXT_BYTES)?;
            }
            if let Some(artifact) = artifact {
                validate_artifact(artifact)?;
            }
            if (*is_error && part.state != PartState::Error)
                || (!*is_error && part.state != PartState::Completed)
            {
                return Err(ProtocolDecodeError::InvalidPartState {
                    part_type: "tool_result",
                });
            }
        }
        MessagePartBody::Patch {
            operation_id,
            patch,
        } => {
            validate_field("operation.id", &operation_id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("patch", patch, MAX_MESSAGE_TEXT_BYTES)?;
        }
        MessagePartBody::Snapshot {
            operation_id,
            sha256,
        } => {
            validate_field("operation.id", &operation_id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_sha256("snapshot.sha256", sha256)?;
        }
        MessagePartBody::Retry {
            operation_id,
            cause,
            ..
        } => {
            validate_field("operation.id", &operation_id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("retry.cause", cause, MAX_MESSAGE_TEXT_BYTES)?;
        }
        MessagePartBody::StepStart {
            operation_id,
            label,
        } => {
            validate_field("operation.id", &operation_id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("step.label", label, MAX_MESSAGE_TEXT_BYTES)?;
        }
        MessagePartBody::StepFinish {
            operation_id,
            outcome,
        } => {
            validate_field("operation.id", &operation_id.0, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("step.outcome", outcome, MAX_MESSAGE_TEXT_BYTES)?;
        }
        MessagePartBody::Subagent {
            child_session_id,
            result,
        } => {
            validate_field(
                "child_session.id",
                &child_session_id.0,
                MAX_PROTOCOL_ID_BYTES,
            )?;
            validate_value_size("subagent.result", result, MAX_MESSAGE_METADATA_BYTES)?;
        }
        MessagePartBody::Compaction {
            replaced_message_ids,
            summary,
            provider_metadata,
        } => {
            if replaced_message_ids.len() > MAX_COMPACTION_MESSAGE_IDS {
                return Err(ProtocolDecodeError::TooManyItems {
                    field: "compaction.replaced_message_ids",
                    limit: MAX_COMPACTION_MESSAGE_IDS,
                });
            }
            if replaced_message_ids.is_empty() {
                return Err(ProtocolDecodeError::InvalidField {
                    field: "compaction.replaced_message_ids",
                });
            }
            let mut unique = BTreeSet::new();
            for message_id in replaced_message_ids {
                validate_field("message.id", &message_id.0, MAX_PROTOCOL_ID_BYTES)?;
                if !unique.insert(&message_id.0) {
                    return Err(ProtocolDecodeError::DuplicateId {
                        field: "compaction.replaced_message_ids",
                    });
                }
            }
            validate_text("compaction.summary", summary, MAX_MESSAGE_TEXT_BYTES)?;
            validate_value_size(
                "provider_metadata",
                provider_metadata,
                MAX_MESSAGE_METADATA_BYTES,
            )?;
        }
        MessagePartBody::File { path, artifact } => {
            validate_text("file.path", path, MAX_MESSAGE_PATH_BYTES)?;
            validate_artifact(artifact)?;
        }
        MessagePartBody::Image { artifact, alt } => {
            validate_artifact(artifact)?;
            if let Some(alt) = alt {
                validate_text("image.alt", alt, MAX_MESSAGE_TEXT_BYTES)?;
            }
        }
        MessagePartBody::Source { url, title, .. } => {
            validate_text("source.url", url, MAX_MESSAGE_PATH_BYTES)?;
            if let Some(title) = title {
                validate_text("source.title", title, MAX_MESSAGE_TEXT_BYTES)?;
            }
        }
        MessagePartBody::Question { prompt } => {
            validate_text("question.prompt", prompt, MAX_MESSAGE_TEXT_BYTES)?
        }
        MessagePartBody::Permission {
            permission,
            decision,
        } => {
            validate_text("permission", permission, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("permission.decision", decision, MAX_PROTOCOL_ID_BYTES)?;
        }
        MessagePartBody::ReviewFinding {
            classification,
            summary,
            ..
        } => {
            validate_text(
                "review.classification",
                classification,
                MAX_PROTOCOL_ID_BYTES,
            )?;
            validate_text("review.summary", summary, MAX_MESSAGE_TEXT_BYTES)?;
        }
        MessagePartBody::Error { code, message, .. } => {
            validate_text("error.code", code, MAX_PROTOCOL_ID_BYTES)?;
            validate_text("error.message", message, MAX_MESSAGE_TEXT_BYTES)?;
        }
        MessagePartBody::Artifact {
            artifact,
            origin,
            preview,
        } => {
            validate_artifact(artifact)?;
            validate_artifact_origin(origin)?;
            if let Some(preview) = preview {
                validate_text("artifact.preview", preview, MAX_ARTIFACT_PREVIEW_BYTES)?;
            }
        }
        MessagePartBody::Unknown { type_name, data } => {
            validate_field("message.part.type", type_name, MAX_PROTOCOL_ID_BYTES)?;
            validate_value_size("message.part.unknown", data, MAX_MESSAGE_METADATA_BYTES)?;
        }
    }
    Ok(())
}

fn validate_artifact_origin(origin: &ArtifactOrigin) -> Result<(), ProtocolDecodeError> {
    validate_field(
        "artifact.origin.kind",
        origin.kind.tag(),
        MAX_PROTOCOL_ID_BYTES,
    )?;
    if let Some(tool_call_id) = &origin.tool_call_id {
        validate_field("tool_call.id", &tool_call_id.0, MAX_PROTOCOL_ID_BYTES)?;
    }
    if let Some(path) = &origin.path {
        validate_text("artifact.origin.path", path, MAX_MESSAGE_PATH_BYTES)?;
    }
    match &origin.kind {
        ArtifactOriginKind::ToolOutput if origin.tool_call_id.is_none() => {
            Err(ProtocolDecodeError::InvalidField {
                field: "artifact.origin.tool_call_id",
            })
        }
        ArtifactOriginKind::File if origin.path.is_none() => {
            Err(ProtocolDecodeError::InvalidField {
                field: "artifact.origin.path",
            })
        }
        _ => Ok(()),
    }
}

fn validate_part_state(part: &MessagePart) -> Result<(), ProtocolDecodeError> {
    let expected = match &part.body {
        MessagePartBody::StepStart { .. } => Some(("step_start", PartState::Running)),
        MessagePartBody::File { .. }
        | MessagePartBody::Image { .. }
        | MessagePartBody::Source { .. }
        | MessagePartBody::Patch { .. }
        | MessagePartBody::Snapshot { .. }
        | MessagePartBody::Retry { .. }
        | MessagePartBody::Compaction { .. }
        | MessagePartBody::Question { .. }
        | MessagePartBody::Permission { .. }
        | MessagePartBody::StepFinish { .. }
        | MessagePartBody::Subagent { .. }
        | MessagePartBody::Artifact { .. }
        | MessagePartBody::ReviewFinding { .. } => Some(("completed_part", PartState::Completed)),
        MessagePartBody::Error { .. } => Some(("error", PartState::Error)),
        _ => None,
    };
    if let Some((part_type, expected)) = expected
        && part.state != expected
    {
        return Err(ProtocolDecodeError::InvalidPartState { part_type });
    }
    Ok(())
}

pub fn validate_part_transition(
    previous: &MessagePart,
    next: &MessagePart,
) -> Result<(), ProtocolDecodeError> {
    if previous.id != next.id {
        return Err(ProtocolDecodeError::InvalidField {
            field: "message.part.id",
        });
    }
    if matches!(previous.state, PartState::Completed | PartState::Error) && previous != next {
        return Err(ProtocolDecodeError::TerminalPartTransition);
    }
    if previous.provenance != next.provenance || part_kind(&previous.body) != part_kind(&next.body)
    {
        return Err(ProtocolDecodeError::InvalidField {
            field: "message.part.transition",
        });
    }
    validate_part_bounds(next)
}

fn part_kind(body: &MessagePartBody) -> &'static str {
    match body {
        MessagePartBody::Text { .. } => "text",
        MessagePartBody::Reasoning { .. } => "reasoning",
        MessagePartBody::ToolCall { .. } => "tool_call",
        MessagePartBody::ToolResult { .. } => "tool_result",
        MessagePartBody::File { .. } => "file",
        MessagePartBody::Image { .. } => "image",
        MessagePartBody::Source { .. } => "source",
        MessagePartBody::Patch { .. } => "patch",
        MessagePartBody::Snapshot { .. } => "snapshot",
        MessagePartBody::Retry { .. } => "retry",
        MessagePartBody::Compaction { .. } => "compaction",
        MessagePartBody::Question { .. } => "question",
        MessagePartBody::Permission { .. } => "permission",
        MessagePartBody::StepStart { .. } => "step_start",
        MessagePartBody::StepFinish { .. } => "step_finish",
        MessagePartBody::Subagent { .. } => "subagent",
        MessagePartBody::ReviewFinding { .. } => "review_finding",
        MessagePartBody::Error { .. } => "error",
        MessagePartBody::Artifact { .. } => "artifact",
        MessagePartBody::Unknown { .. } => "unknown",
    }
}

/// The part schema version a body requires. A body added after the base schema
/// cannot be written under an older tag.
#[must_use]
pub fn minimum_part_schema_version(body: &MessagePartBody) -> u16 {
    match body {
        MessagePartBody::Artifact { .. } => ARTIFACT_PART_SCHEMA_VERSION,
        _ => BASE_PART_SCHEMA_VERSION,
    }
}

/// Why a stored part cannot be rendered at a requested schema version.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum NotRepresentableReason {
    /// The requested version is outside the range this build understands.
    UnsupportedTarget,
    /// The body is opaque, so no downgrade path can be proven for it.
    OpaqueBody,
    /// No enumerated downgrade path covers this body at this target.
    NoDeclaredDowngrade,
    /// A declared downgrade path exists but its required attribution is absent.
    IncompleteAttribution,
}

impl fmt::Display for NotRepresentableReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::UnsupportedTarget => "the requested schema version is not supported",
            Self::OpaqueBody => "the part body is opaque and cannot be downgraded",
            Self::NoDeclaredDowngrade => "no downgrade path is declared for this part",
            Self::IncompleteAttribution => "the part lacks the attribution a downgrade requires",
        };
        f.write_str(text)
    }
}

/// The visible stand-in for a part a downgrade refuses to represent. It is
/// deliberately not a `MessagePart`: a caller cannot mistake it for content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub struct NotRepresentablePart {
    pub id: PartId,
    pub part_type: String,
    pub written_schema_version: u16,
    pub target_schema_version: u16,
    pub reason: NotRepresentableReason,
}

impl NotRepresentablePart {
    /// The text a client shows in place of the part.
    #[must_use]
    pub fn placeholder(&self) -> String {
        format!(
            "{NOT_REPRESENTABLE_PLACEHOLDER}: part {} of type {} was written at schema version {} and {}",
            self.id, self.part_type, self.written_schema_version, self.reason
        )
    }
}

/// The result of rendering a stored part at a chosen schema version.
#[derive(Clone, Debug, PartialEq)]
pub enum RenderedPart {
    Representable(MessagePart),
    NotRepresentable(NotRepresentablePart),
}

impl RenderedPart {
    #[must_use]
    pub fn part(&self) -> Option<&MessagePart> {
        match self {
            Self::Representable(part) => Some(part),
            Self::NotRepresentable(_) => None,
        }
    }
}

/// Render a stored part at `target`.
///
/// There is deliberately no general cross-version converter. Only the paths
/// enumerated here are guaranteed, and everything else fails visibly:
///
/// - `target >= written` is the identity. No field is invented for a newer
///   reader.
/// - v2 `artifact` attributed to a tool call downgrades to v1 `tool_result`
///   carrying the same reference.
/// - v2 `artifact` attributed to a workspace path downgrades to v1 `file`.
///   `preview` is dropped on both paths: it is a truncated rendering of bytes
///   the artifact reference still addresses, so nothing becomes unrecoverable.
/// - Every other v2 `artifact` — an attachment, or an attribution kind this
///   build does not know — has no v1 shape that would not assert something
///   false, and is refused.
/// - An opaque body is never downgraded. Representability cannot be proven for
///   a payload this build cannot read.
#[must_use]
pub fn render_part_at_schema_version(part: &MessagePart, target: u16) -> RenderedPart {
    let refuse = |reason| {
        RenderedPart::NotRepresentable(NotRepresentablePart {
            id: part.id.clone(),
            part_type: part_kind(&part.body).to_owned(),
            written_schema_version: part.schema_version,
            target_schema_version: target,
            reason,
        })
    };
    if !(MIN_PART_SCHEMA_VERSION..=MAX_PART_SCHEMA_VERSION).contains(&target) {
        return refuse(NotRepresentableReason::UnsupportedTarget);
    }
    if target >= part.schema_version {
        return RenderedPart::Representable(part.clone());
    }
    match &part.body {
        MessagePartBody::Unknown { .. } => refuse(NotRepresentableReason::OpaqueBody),
        MessagePartBody::Artifact {
            artifact, origin, ..
        } if target >= BASE_PART_SCHEMA_VERSION => {
            match (&origin.kind, &origin.tool_call_id, &origin.path) {
                (ArtifactOriginKind::ToolOutput, Some(tool_call_id), _) => {
                    RenderedPart::Representable(MessagePart {
                        schema_version: target,
                        id: part.id.clone(),
                        state: PartState::Completed,
                        provenance: part.provenance,
                        body: MessagePartBody::ToolResult {
                            tool_call_id: tool_call_id.clone(),
                            output: None,
                            artifact: Some(artifact.clone()),
                            is_error: false,
                        },
                    })
                }
                (ArtifactOriginKind::File, _, Some(path)) => {
                    RenderedPart::Representable(MessagePart {
                        schema_version: target,
                        id: part.id.clone(),
                        state: PartState::Completed,
                        provenance: part.provenance,
                        body: MessagePartBody::File {
                            path: path.clone(),
                            artifact: artifact.clone(),
                        },
                    })
                }
                (ArtifactOriginKind::ToolOutput | ArtifactOriginKind::File, _, _) => {
                    refuse(NotRepresentableReason::IncompleteAttribution)
                }
                _ => refuse(NotRepresentableReason::NoDeclaredDowngrade),
            }
        }
        _ => refuse(NotRepresentableReason::NoDeclaredDowngrade),
    }
}

/// How a tool call stopped without producing its own result.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum ToolInterruption {
    /// The user or a client asked for the operation to stop.
    Cancelled,
    /// The process or session went away mid-call.
    Interrupted,
    /// A deadline elapsed.
    TimedOut,
    /// The context window or another resource was exhausted.
    ResourceExhausted,
}

impl ToolInterruption {
    /// Externally-requested and internally-triggered stops produce the same
    /// part shape; only this text differs.
    #[must_use]
    pub fn reason(self) -> &'static str {
        match self {
            Self::Cancelled => "tool call cancelled before it produced a result",
            Self::Interrupted => "tool call interrupted before it produced a result",
            Self::TimedOut => "tool call timed out before it produced a result",
            Self::ResourceExhausted => "tool call abandoned after resource exhaustion",
        }
    }
}

/// Build the terminal result a tool call is owed when it stops without one.
///
/// A tool call has a terminal result by construction rather than by whichever
/// code path happens to notice the interruption. Returns `None` for a part that
/// is not a tool call; whether the call is still owed a result is a transcript
/// question, answered by [`crate::MessagePartBody::ToolResult`] pairing.
#[must_use]
pub fn interrupted_tool_result(
    call: &MessagePart,
    interruption: ToolInterruption,
    result_part_id: PartId,
) -> Option<MessagePart> {
    let MessagePartBody::ToolCall { tool_call_id, .. } = &call.body else {
        return None;
    };
    Some(MessagePart {
        schema_version: BASE_PART_SCHEMA_VERSION,
        id: result_part_id,
        state: PartState::Error,
        provenance: Provenance::ToolOutput,
        body: MessagePartBody::ToolResult {
            tool_call_id: tool_call_id.clone(),
            output: Some(interruption.reason().to_owned()),
            artifact: None,
            is_error: true,
        },
    })
}

fn validate_artifact(artifact: &ArtifactRef) -> Result<(), ProtocolDecodeError> {
    validate_field("artifact.id", &artifact.id.0, MAX_PROTOCOL_ID_BYTES)?;
    validate_sha256("artifact.sha256", &artifact.sha256)?;
    validate_text(
        "artifact.media_type",
        &artifact.media_type,
        MAX_PROTOCOL_ID_BYTES,
    )
}

fn validate_sha256(field: &'static str, value: &str) -> Result<(), ProtocolDecodeError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(ProtocolDecodeError::InvalidField { field })
    }
}

fn validate_text(
    field: &'static str,
    value: &str,
    limit: usize,
) -> Result<(), ProtocolDecodeError> {
    if value.len() > limit {
        Err(ProtocolDecodeError::FieldTooLong { field, limit })
    } else {
        Ok(())
    }
}

fn validate_value_size(
    field: &'static str,
    value: &Value,
    limit: usize,
) -> Result<(), ProtocolDecodeError> {
    if serde_json::to_vec(value)?.len() > limit {
        Err(ProtocolDecodeError::FieldTooLong { field, limit })
    } else {
        Ok(())
    }
}

fn validate_field(
    field: &'static str,
    value: &str,
    limit: usize,
) -> Result<(), ProtocolDecodeError> {
    if value.len() > limit {
        Err(ProtocolDecodeError::FieldTooLong { field, limit })
    } else if value.is_empty()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        Err(ProtocolDecodeError::InvalidField { field })
    } else {
        Ok(())
    }
}

fn redact_provider_metadata(event: &mut Event) {
    let redact_part = |part: &mut MessagePart| match &mut part.body {
        MessagePartBody::Reasoning {
            provider_metadata, ..
        }
        | MessagePartBody::Compaction {
            provider_metadata, ..
        } => *provider_metadata = redact_sensitive_value(provider_metadata),
        _ => {}
    };
    match event {
        Event::MessageAppended { message } => message.parts.iter_mut().for_each(redact_part),
        Event::MessagePartUpdated { part, .. } => redact_part(part),
        _ => {}
    }
}

fn first_unknown_part(event: &Event) -> Option<&str> {
    match event {
        Event::MessageAppended { message } => {
            message.parts.iter().find_map(|part| match &part.body {
                MessagePartBody::Unknown { type_name, .. } => Some(type_name.as_str()),
                _ => None,
            })
        }
        Event::MessagePartUpdated { part, .. } => match &part.body {
            MessagePartBody::Unknown { type_name, .. } => Some(type_name.as_str()),
            _ => None,
        },
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
#[ts(tag = "type", content = "data", rename_all = "snake_case")]
#[ts(export, export_to = "../../../clients/typescript/generated/")]
pub enum Event {
    MessageAppended {
        message: Message,
    },
    MessagePartUpdated {
        message_id: MessageId,
        part: MessagePart,
    },
    SessionStateChanged {
        state: String,
    },
    Heartbeat,
    Cancelled {
        operation_id: Option<OperationId>,
        reason: String,
    },
    Error {
        code: String,
        message: String,
    },
}

/// Content-aware local persistence redaction. It deliberately targets common
/// credential assignments and provider token forms while leaving ordinary
/// source text intact. Provider-bound in-memory requests use the original.
pub fn redact_sensitive_text(input: &str) -> String {
    // Structured tool/provider output is often embedded as text. Parse a
    // complete JSON object/array first so nested credential keys cannot evade
    // the plain-text assignment scanner.
    if let Ok(value @ (Value::Object(_) | Value::Array(_))) = serde_json::from_str::<Value>(input) {
        return serde_json::to_string(&redact_sensitive_value(&value))
            .unwrap_or_else(|_| "[REDACTED INVALID JSON]".into());
    }
    let mut private_key = false;
    let mut without_private_keys = String::with_capacity(input.len());
    for line in input.split_inclusive('\n') {
        let upper = line.to_ascii_uppercase();
        if !private_key && upper.contains("-----BEGIN") && upper.contains("PRIVATE KEY-----") {
            private_key = true;
            without_private_keys.push_str("[REDACTED PRIVATE KEY]");
            if line.ends_with('\n') {
                without_private_keys.push('\n');
            }
            continue;
        }
        if private_key {
            if upper.contains("-----END") && upper.contains("PRIVATE KEY-----") {
                private_key = false;
            }
            if line.ends_with('\n') {
                without_private_keys.push('\n');
            }
            continue;
        }
        without_private_keys.push_str(line);
    }
    let mut redact_next_bearer_token = false;
    without_private_keys
        .split_inclusive(char::is_whitespace)
        .map(|segment| {
            let trimmed = segment.trim_end_matches(char::is_whitespace);
            let suffix = &segment[trimmed.len()..];
            let lower = trimmed.to_ascii_lowercase();
            let assignment_key = lower.rsplit_once('=').map(|(key, _)| {
                key.trim_matches(|character: char| {
                    !(character.is_ascii_alphanumeric() || character == '_')
                })
            });
            let sensitive_assignment = assignment_key.is_some_and(|key| {
                matches!(
                    key,
                    "token"
                        | "secret"
                        | "api_key"
                        | "credential"
                        | "password"
                        | "cookie"
                        | "authorization"
                        | "aws_access_key_id"
                        | "aws_secret_access_key"
                        | "aws_session_token"
                ) || key.ends_with("_token")
                    || key.ends_with("_secret")
                    || key.ends_with("_password")
                    || key.ends_with("_cookie")
                    || key.ends_with("_api_key")
                    || key.ends_with("_credential")
            });
            let bearer_scheme = lower == "bearer";
            let sensitive_token = redact_next_bearer_token
                || lower.contains("sk-")
                || lower.contains("ghp_")
                || lower.contains("github_pat_")
                || lower.contains("glpat-")
                || lower.contains("xoxb-")
                || (lower.starts_with("akia") && trimmed.len() >= 16)
                || lower.starts_with("bearer ")
                || lower.starts_with("bearer:");
            redact_next_bearer_token = bearer_scheme;
            if sensitive_assignment || sensitive_token || bearer_scheme {
                format!("[REDACTED]{suffix}")
            } else {
                segment.to_owned()
            }
        })
        .collect()
}

pub fn redact_sensitive_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(redact_sensitive_text(text)),
        Value::Array(values) => Value::Array(values.iter().map(redact_sensitive_value).collect()),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| {
                    let normalized = key.to_ascii_lowercase();
                    let sensitive_key = [
                        "secret",
                        "token",
                        "api_key",
                        "authorization",
                        "password",
                        "cookie",
                        "credential",
                        "private_key",
                    ]
                    .iter()
                    .any(|needle| normalized.contains(needle));
                    (
                        key.clone(),
                        if sensitive_key {
                            Value::String("[REDACTED]".into())
                        } else {
                            redact_sensitive_value(value)
                        },
                    )
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_parts_are_versioned_and_discriminated() {
        let part = MessagePart {
            schema_version: 1,
            id: PartId::from_stable("part-1"),
            state: PartState::Completed,
            provenance: Provenance::UserInput,
            body: MessagePartBody::Text {
                text: "hello".into(),
            },
        };
        let json = serde_json::to_value(&part).unwrap();
        assert_eq!(json["schema_version"], 1);
        assert_eq!(json["id"], "part-1");
        assert_eq!(json["body"]["type"], "text");
        assert_eq!(json["body"]["data"]["text"], "hello");
        assert_eq!(serde_json::from_value::<MessagePart>(json).unwrap(), part);
    }

    open_enum! {
        /// Fixture proving the shared macro keeps an unknown tag and payload.
        TestOpenEnum {
            Known => "known",
        }
    }

    #[test]
    fn open_enums_preserve_unknown_tags_and_payloads() {
        let known: TestOpenEnum = serde_json::from_str("\"known\"").unwrap();
        assert_eq!(known, TestOpenEnum::Known);
        assert!(known.is_known());
        assert_eq!(serde_json::to_string(&known).unwrap(), "\"known\"");

        let bare = "\"future\"";
        let value: TestOpenEnum = serde_json::from_str(bare).unwrap();
        assert_eq!(value.tag(), "future");
        assert!(!value.is_known());
        assert_eq!(serde_json::to_string(&value).unwrap(), bare);

        let structured = r#"{"detail":{"depth":2},"type":"future"}"#;
        let carried: TestOpenEnum = serde_json::from_str(structured).unwrap();
        assert_eq!(carried.tag(), "future");
        assert_eq!(serde_json::to_string(&carried).unwrap(), structured);
    }

    #[test]
    fn artifact_parts_downgrade_only_along_declared_paths() {
        let artifact = ArtifactRef::for_bytes("text/plain", b"payload");
        let part = |origin: ArtifactOrigin| MessagePart {
            schema_version: ARTIFACT_PART_SCHEMA_VERSION,
            id: PartId::from_stable("part-artifact"),
            state: PartState::Completed,
            provenance: Provenance::ToolOutput,
            body: MessagePartBody::Artifact {
                artifact: artifact.clone(),
                origin,
                preview: Some("payload".into()),
            },
        };

        let tool = part(ArtifactOrigin::tool_output(ToolCallId::from_stable("call")));
        assert!(matches!(
            render_part_at_schema_version(&tool, 1),
            RenderedPart::Representable(MessagePart {
                body: MessagePartBody::ToolResult { .. },
                ..
            })
        ));
        let file = part(ArtifactOrigin::file("src/lib.rs"));
        assert!(matches!(
            render_part_at_schema_version(&file, 1),
            RenderedPart::Representable(MessagePart {
                body: MessagePartBody::File { .. },
                ..
            })
        ));
        // An attribution kind this build does not know has no declared path.
        let foreign = part(ArtifactOrigin {
            kind: serde_json::from_str("\"future_origin\"").unwrap(),
            tool_call_id: None,
            path: None,
        });
        assert!(matches!(
            render_part_at_schema_version(&foreign, 1),
            RenderedPart::NotRepresentable(_)
        ));
        // Rendering at or above the written version is the identity.
        assert_eq!(
            render_part_at_schema_version(&tool, ARTIFACT_PART_SCHEMA_VERSION),
            RenderedPart::Representable(tool.clone())
        );
        // A target outside the supported range fails visibly.
        match render_part_at_schema_version(&tool, 0) {
            RenderedPart::NotRepresentable(placeholder) => {
                assert_eq!(
                    placeholder.reason,
                    NotRepresentableReason::UnsupportedTarget
                );
                assert!(
                    placeholder
                        .placeholder()
                        .starts_with(NOT_REPRESENTABLE_PLACEHOLDER)
                );
            }
            other => panic!("unsupported target must be refused: {other:?}"),
        }
    }

    #[test]
    fn artifact_parts_require_the_schema_that_introduced_them() {
        let json = serde_json::json!({
            "schema_version": 1,
            "id": "part-artifact",
            "state": "completed",
            "provenance": "tool-output",
            "body": {
                "type": "artifact",
                "data": {
                    "artifact": ArtifactRef::for_bytes("text/plain", b"payload"),
                    "origin": { "kind": "tool_output", "tool_call_id": "call" },
                    "preview": null,
                }
            }
        });
        let part: MessagePart = serde_json::from_value(json).unwrap();
        assert!(matches!(
            validate_part_bounds(&part),
            Err(ProtocolDecodeError::UnsupportedSchema {
                field: "message.part",
                found: 1
            })
        ));
    }

    #[test]
    fn cursor_forms_round_trip_and_keep_unknown_tags() {
        let cursor = EventCursor::for_sequence(42);
        assert_eq!(cursor.0, "e:00000000000000000042");
        assert_eq!(
            cursor.form().unwrap(),
            CursorForm::Sequence { sequence: 42 }
        );
        assert_eq!(cursor.form().unwrap().encode(), cursor);

        let future = EventCursor("k:session/17".into());
        let form = future.form().unwrap();
        assert!(!form.is_known());
        assert_eq!(form.tag(), "k");
        assert_eq!(form.encode(), future, "unknown cursors re-encode verbatim");

        assert!(EventCursor("nope".into()).form().is_err());
        assert!(EventCursor("e:not-a-number".into()).form().is_err());
    }

    #[test]
    fn by_reference_threshold_covers_size_and_binary_payloads() {
        assert!(!should_store_by_reference(b"small", "text/plain"));
        assert!(should_store_by_reference(
            &vec![b'a'; MAX_INLINE_TOOL_OUTPUT_BYTES + 1],
            "text/plain"
        ));
        assert!(should_store_by_reference(b"small", "image/png"));
        assert!(should_store_by_reference(
            &[0u8, 159, 146, 150],
            "text/plain"
        ));
        let reference = ArtifactRef::for_bytes("text/plain", b"payload");
        assert_eq!(reference.byte_length, 7);
        assert_eq!(
            reference.sha256,
            ArtifactRef::for_bytes("text/plain", b"payload").sha256
        );
        assert!(reference.id.0.starts_with("sha256:"));
    }

    #[test]
    fn interrupted_tool_calls_get_a_terminal_result_part() {
        let call = MessagePart {
            schema_version: BASE_PART_SCHEMA_VERSION,
            id: PartId::from_stable("part-call"),
            state: PartState::Running,
            provenance: Provenance::ModelGenerated,
            body: MessagePartBody::ToolCall {
                tool_call_id: ToolCallId::from_stable("call-1"),
                name: "read_file".into(),
                arguments: Value::Null,
            },
        };
        for interruption in [
            ToolInterruption::Cancelled,
            ToolInterruption::Interrupted,
            ToolInterruption::TimedOut,
            ToolInterruption::ResourceExhausted,
        ] {
            let result =
                interrupted_tool_result(&call, interruption, PartId::from_stable("part-result"))
                    .unwrap();
            assert_eq!(result.state, PartState::Error);
            assert!(validate_part_bounds(&result).is_ok());
            match result.body {
                MessagePartBody::ToolResult {
                    tool_call_id,
                    is_error,
                    output,
                    artifact,
                } => {
                    assert_eq!(tool_call_id.0, "call-1");
                    assert!(is_error);
                    assert!(artifact.is_none());
                    assert_eq!(output.unwrap(), interruption.reason());
                }
                other => panic!("expected a terminal tool result: {other:?}"),
            }
        }
        let text = MessagePart {
            body: MessagePartBody::Text { text: "hi".into() },
            ..call
        };
        assert!(
            interrupted_tool_result(
                &text,
                ToolInterruption::Interrupted,
                PartId::from_stable("part-result")
            )
            .is_none()
        );
    }

    #[test]
    fn content_redaction_removes_provider_secrets_but_preserves_code() {
        let input = "OPENAI_API_KEY=sk-secret fn main() { println!(\"ok\"); } Bearer sk-ant-value";
        let redacted = redact_sensitive_text(input);
        assert!(!redacted.contains("sk-secret"));
        assert!(!redacted.contains("sk-ant-value"));
        assert!(redacted.contains("fn main()"));
        assert!(redacted.contains("println!"));
    }

    #[test]
    fn content_redaction_covers_common_credentials_and_private_keys() {
        let input = concat!(
            "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE ",
            "AWS_SECRET_ACCESS_KEY=aws-secret PASSWORD=hunter2 COOKIE=session-value ",
            "DEPLOY_TOKEN=deploy-secret ghp_1234567890abcdef\n",
            "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----\n"
        );
        let redacted = redact_sensitive_text(input);
        for secret in [
            "AKIAIOSFODNN7EXAMPLE",
            "aws-secret",
            "hunter2",
            "session-value",
            "deploy-secret",
            "ghp_1234567890abcdef",
            "private-material",
        ] {
            assert!(!redacted.contains(secret), "leaked {secret}");
        }
        assert!(redacted.contains("[REDACTED PRIVATE KEY]"));
    }

    #[test]
    fn recursive_redaction_covers_sensitive_keys_and_plain_assignments() {
        let canary = "canary-7e9b2d";
        let value = serde_json::json!({
            "safe": [
                {"password": canary},
                {"cookieJar": canary},
                {"credentialValue": canary},
                {"nested": format!("token={canary} secret={canary} api_key={canary}")}
            ]
        });
        let redacted = redact_sensitive_value(&value);
        let serialized = serde_json::to_string(&redacted).unwrap();
        assert!(!serialized.contains(canary));
        assert_eq!(redacted["safe"][0]["password"], "[REDACTED]");
        let embedded = format!(r#"{{"outer":{{"authorization":"{canary}"}}}}"#);
        let redacted_embedded = redact_sensitive_text(&embedded);
        assert!(!redacted_embedded.contains(canary));
        assert!(
            !redact_sensitive_text("provider rejected 'sk-canary-value'")
                .contains("sk-canary-value")
        );
    }

    #[test]
    fn content_redaction_preserves_ordinary_source_token_identifiers() {
        let source = "let token = Token::new();\nstruct CookieJar;\nlet password_hint = \"minimum 12 chars\";";
        assert_eq!(redact_sensitive_text(source), source);
    }

    #[test]
    fn negotiation_preserves_unknown_additions_across_minor_versions() {
        let result = negotiate(
            ProtocolVersion { major: 1, minor: 2 },
            ProtocolVersion { major: 1, minor: 4 },
        )
        .unwrap();
        assert_eq!(result.version, ProtocolVersion { major: 1, minor: 2 });
        assert_eq!(result.unknown_parts, UnknownPartPolicy::Preserve);
    }

    #[test]
    fn negotiation_rejects_incompatible_major_versions() {
        assert_eq!(
            negotiate(
                ProtocolVersion { major: 1, minor: 0 },
                ProtocolVersion { major: 2, minor: 0 },
            ),
            Err(NegotiationError::IncompatibleMajor {
                local: 1,
                remote: 2
            })
        );
    }

    #[test]
    fn stable_ids_survive_round_trip() {
        let id = MessageId::new();
        let encoded = serde_json::to_string(&id).unwrap();
        assert_eq!(serde_json::from_str::<MessageId>(&encoded).unwrap(), id);
    }

    fn envelope_with_part(protocol_minor: u16, body: Value) -> Value {
        serde_json::json!({
            "protocol_version": { "major": 1, "minor": protocol_minor },
            "id": "event-opaque",
            "cursor": "e:00000000000000000001",
            "session_id": "session-opaque",
            "emitted_at_ms": 42,
            "event": {
                "type": "message_appended",
                "data": {
                    "message": {
                        "schema_version": 1,
                        "id": "message-opaque",
                        "session_id": "session-opaque",
                        "created_at_ms": 41,
                        "parts": [{
                            "schema_version": 1,
                            "id": "part-opaque",
                            "state": "completed",
                            "provenance": "model-generated",
                            "body": body
                        }]
                    }
                }
            }
        })
    }

    #[test]
    fn differing_minor_preserves_unknown_part_type_and_payload() {
        let body = serde_json::json!({
            "type": "future_binary_delta",
            "data": {
                "bytes": [0, 1, 127, 255],
                "nested": { "precise": 9007199254740991_u64 },
                "nullable": null
            }
        });
        let wire = envelope_with_part(1, body.clone());
        let decoded = decode_event_envelope_json(&wire.to_string()).unwrap();
        let Event::MessageAppended { message } = &decoded.event else {
            panic!("wrong event type")
        };
        assert_eq!(
            message.parts[0].body,
            MessagePartBody::Unknown {
                type_name: "future_binary_delta".into(),
                data: body["data"].clone(),
            }
        );
        let encoded = serde_json::to_value(decoded).unwrap();
        assert_eq!(
            encoded["event"]["data"]["message"]["parts"][0]["body"],
            body
        );
    }

    #[test]
    fn equal_minor_rejects_unknown_part() {
        let wire = envelope_with_part(
            CURRENT_PROTOCOL_VERSION.minor,
            serde_json::json!({ "type": "not_in_schema", "data": { "x": 1 } }),
        );
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::UnknownPartAtEqualVersion { ref part_type, .. })
                if part_type == "not_in_schema"
        ));
    }

    #[test]
    fn event_decode_rejects_oversized_ids_cursors_and_part_counts() {
        let body = serde_json::json!({"type":"text","data":{"text":"ok"}});
        let mut wire = envelope_with_part(CURRENT_PROTOCOL_VERSION.minor, body);
        wire["cursor"] = Value::String("c".repeat(MAX_EVENT_CURSOR_BYTES + 1));
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::FieldTooLong {
                field: "event.cursor",
                limit: MAX_EVENT_CURSOR_BYTES
            })
        ));

        wire["cursor"] = Value::String("cursor".into());
        let part = wire["event"]["data"]["message"]["parts"][0].clone();
        wire["event"]["data"]["message"]["parts"] = Value::Array(vec![part; MAX_MESSAGE_PARTS + 1]);
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::TooManyParts {
                limit: MAX_MESSAGE_PARTS
            })
        ));

        let compacted = vec![MessageId::from_stable("message"); MAX_COMPACTION_MESSAGE_IDS + 1];
        let wire = envelope_with_part(
            CURRENT_PROTOCOL_VERSION.minor,
            serde_json::json!({
                "type":"compaction",
                "data":{
                    "replaced_message_ids":compacted,
                    "summary":"bounded",
                    "provider_metadata":null
                }
            }),
        );
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::TooManyItems {
                field: "compaction.replaced_message_ids",
                limit: MAX_COMPACTION_MESSAGE_IDS
            })
        ));
    }

    #[test]
    fn event_decode_rejects_payload_before_parsing_and_duplicate_or_mismatched_ids() {
        assert!(matches!(
            decode_event_envelope_json(&"x".repeat(MAX_EVENT_JSON_BYTES + 1)),
            Err(ProtocolDecodeError::PayloadTooLarge {
                limit: MAX_EVENT_JSON_BYTES
            })
        ));

        let body = serde_json::json!({"type":"text","data":{"text":"ok"}});
        let mut wire = envelope_with_part(CURRENT_PROTOCOL_VERSION.minor, body);
        let part = wire["event"]["data"]["message"]["parts"][0].clone();
        wire["event"]["data"]["message"]["parts"] = Value::Array(vec![part.clone(), part]);
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::DuplicateId {
                field: "message.parts"
            })
        ));

        wire["event"]["data"]["message"]["parts"] = Value::Array(vec![serde_json::json!({
            "schema_version":1,
            "id":"part-valid",
            "state":"completed",
            "provenance":"model-generated",
            "body":{"type":"text","data":{"text":"ok"}}
        })]);
        wire["event"]["data"]["message"]["session_id"] = Value::String("other".into());
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::SessionMismatch)
        ));
        wire["event"]["data"]["message"]["session_id"] = Value::String("session-opaque".into());
        wire["event"]["data"]["message"]["id"] = Value::String(String::new());
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::InvalidField {
                field: "message.id"
            })
        ));
    }

    #[test]
    fn known_parts_enforce_schema_state_and_terminal_transitions() {
        let mut wire = envelope_with_part(
            CURRENT_PROTOCOL_VERSION.minor,
            serde_json::json!({
                "type":"error",
                "data":{"code":"provider_error","message":"failed","retryable":false}
            }),
        );
        wire["event"]["data"]["message"]["parts"][0]["state"] = Value::String("completed".into());
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::InvalidPartState { part_type: "error" })
        ));
        wire["event"]["data"]["message"]["parts"][0]["state"] = Value::String("error".into());
        // A known body may be tagged with any schema this build reads, but not
        // one beyond it.
        wire["event"]["data"]["message"]["parts"][0]["schema_version"] =
            Value::from(MAX_PART_SCHEMA_VERSION);
        assert!(decode_event_envelope_json(&wire.to_string()).is_ok());
        wire["event"]["data"]["message"]["parts"][0]["schema_version"] =
            Value::from(MAX_PART_SCHEMA_VERSION + 1);
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::UnsupportedSchema {
                field: "message.part",
                found: 3
            })
        ));
        wire["event"]["data"]["message"]["parts"][0]["schema_version"] = Value::from(1);

        let previous = MessagePart {
            schema_version: 1,
            id: PartId::from_stable("part"),
            state: PartState::Completed,
            provenance: Provenance::ModelGenerated,
            body: MessagePartBody::Text {
                text: "done".into(),
            },
        };
        let mut next = previous.clone();
        next.body = MessagePartBody::Text {
            text: "changed".into(),
        };
        assert!(matches!(
            validate_part_transition(&previous, &next),
            Err(ProtocolDecodeError::TerminalPartTransition)
        ));
        assert!(validate_part_transition(&previous, &previous).is_ok());
    }

    #[test]
    fn tool_results_are_terminal_and_interrupted_results_are_errors() {
        let wire = envelope_with_part(
            CURRENT_PROTOCOL_VERSION.minor,
            serde_json::json!({
                "type":"tool_result",
                "data":{
                    "tool_call_id":"tool-1",
                    "output":"{\"interrupted\":true}",
                    "artifact":null,
                    "is_error":true
                }
            }),
        );
        let mut wire = wire;
        wire["event"]["data"]["message"]["parts"][0]["state"] = Value::String("error".into());
        assert!(decode_event_envelope_json(&wire.to_string()).is_ok());
        wire["event"]["data"]["message"]["parts"][0]["state"] = Value::String("running".into());
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::InvalidPartState {
                part_type: "tool_result"
            })
        ));
        wire["event"]["data"]["message"]["parts"][0]["state"] = Value::String("error".into());
        wire["event"]["data"]["message"]["parts"][0]["body"]["data"]["output"] = Value::Null;
        assert!(matches!(
            decode_event_envelope_json(&wire.to_string()),
            Err(ProtocolDecodeError::InvalidToolResult)
        ));
    }

    #[test]
    fn compaction_metadata_survives_round_trip_with_secret_fields_redacted() {
        let canary = "provider-secret-canary";
        let body = serde_json::json!({
            "type":"compaction",
            "data":{
                "replaced_message_ids":["message-old"],
                "summary":"summary",
                "provider_metadata":{
                    "reasoning_signature":"signature-preserved",
                    "access_token":canary
                }
            }
        });
        let decoded = decode_event_envelope_json(&envelope_with_part(1, body).to_string()).unwrap();
        let Event::MessageAppended { message } = &decoded.event else {
            panic!("wrong event")
        };
        let MessagePartBody::Compaction {
            provider_metadata, ..
        } = &message.parts[0].body
        else {
            panic!("wrong part")
        };
        assert_eq!(
            provider_metadata["reasoning_signature"],
            "signature-preserved"
        );
        assert_eq!(provider_metadata["access_token"], "[REDACTED]");
        let encoded = serde_json::to_string(&decoded).unwrap();
        assert!(!encoded.contains(canary));
        assert!(encoded.contains("signature-preserved"));

        let duplicate = serde_json::json!({
            "type":"compaction",
            "data":{
                "replaced_message_ids":["message-old","message-old"],
                "summary":"summary",
                "provider_metadata":null
            }
        });
        assert!(matches!(
            decode_event_envelope_json(&envelope_with_part(1, duplicate).to_string()),
            Err(ProtocolDecodeError::DuplicateId {
                field: "compaction.replaced_message_ids"
            })
        ));
    }

    #[test]
    fn mutation_tool_v1_round_trips_with_stable_field_names() {
        let request = RenameFileRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            path: "src/old.rs".into(),
            destination: "src/new.rs".into(),
            expected_sha256: "a".repeat(64),
        };
        request.validate().unwrap();
        let wire = serde_json::to_value(&request).unwrap();
        assert_eq!(wire["schema_version"], 1);
        assert_eq!(wire["expected_sha256"], "a".repeat(64));
        assert_eq!(
            serde_json::from_value::<RenameFileRequest>(wire).unwrap(),
            request
        );

        let result = RenameFileResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            sha256: "b".repeat(64),
            source: "src/old.rs".into(),
            destination: "src/new.rs".into(),
            checkpoint_id: "checkpoint-1".into(),
            formatter: Vec::new(),
            proof_impact: MutationProofImpact {
                edit_hash: None,
                invalidated_paths: vec!["src/new.rs".into(), "src/old.rs".into()],
                requires_reprove: true,
            },
        };
        result.validate().unwrap();
        let wire = serde_json::to_value(&result).unwrap();
        assert_eq!(wire["schemaVersion"], 1);
        assert_eq!(wire["checkpointId"], "checkpoint-1");
        assert_eq!(wire["proofImpact"]["requiresReprove"], true);
        assert_eq!(
            serde_json::from_value::<RenameFileResult>(wire).unwrap(),
            result
        );
    }

    #[test]
    fn mutation_tool_contract_rejects_unknown_fields_and_versions() {
        let unknown_request = serde_json::json!({
            "schema_version":1,
            "path":"file.txt",
            "expected_sha256":"a".repeat(64),
            "unexpected":true
        });
        assert!(matches!(
            decode_delete_file_request_json(&unknown_request.to_string()),
            Err(MutationContractDecodeError::Json(_))
        ));
        let unknown_result = serde_json::json!({
            "schemaVersion":1,
            "sha256":"a".repeat(64),
            "deleted":true,
            "checkpointId":"checkpoint",
            "proofImpact":{"invalidatedPaths":["file.txt"],"requiresReprove":true},
            "unexpected":true
        });
        assert!(matches!(
            decode_delete_file_result_json(&unknown_result.to_string()),
            Err(MutationContractDecodeError::Json(_))
        ));

        let future = DeleteFileRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION + 1,
            path: "file.txt".into(),
            expected_sha256: "a".repeat(64),
        };
        assert!(matches!(
            future.validate(),
            Err(MutationContractError::UnsupportedVersion {
                expected: MUTATION_TOOL_SCHEMA_VERSION,
                found
            }) if found == MUTATION_TOOL_SCHEMA_VERSION + 1
        ));

        let oversized = format!(
            "{{\"schema_version\":1,\"path\":\"{}\",\"expected_sha256\":\"{}\"}}",
            "x".repeat(MAX_MUTATION_CONTRACT_JSON_BYTES),
            "a".repeat(64)
        );
        assert!(matches!(
            decode_delete_file_request_json(&oversized),
            Err(MutationContractDecodeError::PayloadTooLarge {
                limit: MAX_MUTATION_CONTRACT_JSON_BYTES
            })
        ));
    }

    #[test]
    fn mutation_tool_contract_enforces_bounds_hashes_and_safe_paths() {
        let mut request = RenameFileRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            path: "file.txt".into(),
            destination: "nested/file.txt".into(),
            expected_sha256: "a".repeat(64),
        };
        request.path = "x".repeat(MAX_MUTATION_PATH_BYTES + 1);
        assert!(matches!(
            request.validate(),
            Err(MutationContractError::FieldTooLong { field: "path", .. })
        ));
        request.path = "../outside".into();
        assert!(matches!(
            request.validate(),
            Err(MutationContractError::UnsafePath { field: "path" })
        ));
        request.path = "file.txt".into();
        request.expected_sha256 = "A".repeat(64);
        assert!(matches!(
            request.validate(),
            Err(MutationContractError::InvalidSha256 {
                field: "expected_sha256"
            })
        ));

        let result = DeleteFileResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            sha256: "a".repeat(64),
            deleted: false,
            checkpoint_id: "checkpoint".into(),
            proof_impact: MutationProofImpact {
                edit_hash: None,
                invalidated_paths: vec!["file.txt".into(); MAX_MUTATION_INVALIDATED_PATHS + 1],
                requires_reprove: true,
            },
        };
        assert!(matches!(
            result.validate(),
            Err(MutationContractError::DeleteNotConfirmed)
        ));
        let result = DeleteFileResult {
            deleted: true,
            ..result
        };
        assert!(matches!(
            result.validate(),
            Err(MutationContractError::TooManyItems {
                field: "invalidatedPaths",
                ..
            })
        ));
    }

    #[test]
    fn file_tool_v1_contract_roundtrips_requests_and_results() {
        let read = ReadFileRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            path: "src/lib.rs".into(),
            max_bytes: Some(4096),
        };
        let read_json = serde_json::to_string(&read).unwrap();
        assert_eq!(decode_read_file_request_json(&read_json).unwrap(), read);

        let content = "hello".to_owned();
        let read_result = ReadFileResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            sha256: format!("{:x}", Sha256::digest(content.as_bytes())),
            byte_length: content.len() as u64,
            content: Some(content),
            artifact: None,
        };
        read_result.validate().unwrap();
        let wire = serde_json::to_string(&read_result).unwrap();
        assert_eq!(decode_read_file_result_json(&wire).unwrap(), read_result);

        let write = WriteFileRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            path: "src/lib.rs".into(),
            content: "replacement".into(),
        };
        assert_eq!(
            decode_write_file_request_json(&serde_json::to_string(&write).unwrap()).unwrap(),
            write
        );
        let patch = ApplyPatchRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            path: "src/lib.rs".into(),
            expected_sha256: "a".repeat(64),
            replacement: "replacement".into(),
        };
        assert_eq!(
            decode_apply_patch_request_json(&serde_json::to_string(&patch).unwrap()).unwrap(),
            patch
        );

        let result = WriteFileResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            sha256: "b".repeat(64),
            checkpoint_id: "checkpoint".into(),
            formatter: Vec::new(),
            checker: WriteCheckVerdict::not_configured(),
            proof_impact: MutationProofImpact {
                edit_hash: None,
                invalidated_paths: vec!["src/lib.rs".into()],
                requires_reprove: true,
            },
        };
        result.validate().unwrap();
        assert!(
            serde_json::to_value(result)
                .unwrap()
                .get("schemaVersion")
                .is_some()
        );
    }

    fn failed_check_verdict() -> WriteCheckVerdict {
        WriteCheckVerdict {
            status: WriteCheckStatus::Checked,
            runs: vec![
                WriteCheckRun {
                    name: "rustfmt".into(),
                    stage: WriteCheckStage::Format,
                    outcome: WriteCheckOutcome::Passed,
                    exit_code: Some(0),
                    diagnostics: String::new(),
                },
                WriteCheckRun {
                    name: "clippy".into(),
                    stage: WriteCheckStage::Check,
                    outcome: WriteCheckOutcome::Failed,
                    exit_code: Some(101),
                    diagnostics: "error: unused variable `x`".into(),
                },
            ],
        }
    }

    fn write_result_with(checker: WriteCheckVerdict) -> WriteFileResult {
        WriteFileResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            sha256: "b".repeat(64),
            checkpoint_id: "checkpoint".into(),
            formatter: Vec::new(),
            checker,
            proof_impact: MutationProofImpact {
                edit_hash: None,
                invalidated_paths: vec!["src/lib.rs".into()],
                requires_reprove: true,
            },
        }
    }

    #[test]
    fn write_checker_verdict_survives_the_write_and_patch_result_round_trip() {
        let write = write_result_with(failed_check_verdict());
        write.validate().unwrap();
        let decoded =
            decode_write_file_result_json(&serde_json::to_string(&write).unwrap()).unwrap();
        assert_eq!(decoded, write);

        let patch = ApplyPatchResult {
            schema_version: write.schema_version,
            sha256: write.sha256.clone(),
            checkpoint_id: write.checkpoint_id.clone(),
            formatter: Vec::new(),
            checker: failed_check_verdict(),
            proof_impact: write.proof_impact.clone(),
        };
        patch.validate().unwrap();
        let decoded_patch =
            decode_apply_patch_result_json(&serde_json::to_string(&patch).unwrap()).unwrap();
        assert_eq!(decoded_patch, patch);

        // A protocol client can tell a failed write from a clean one without
        // reading diagnostics prose.
        for wire in [
            serde_json::to_value(&write).unwrap(),
            serde_json::to_value(&patch).unwrap(),
        ] {
            assert_eq!(wire["checker"]["status"], "checked");
            assert_eq!(wire["checker"]["runs"][1]["stage"], "check");
            assert_eq!(wire["checker"]["runs"][1]["outcome"], "failed");
            assert_eq!(wire["checker"]["runs"][1]["exitCode"], 101);
        }
        assert!(!decoded.checker.is_clean());
        assert!(!decoded_patch.checker.is_clean());
    }

    #[test]
    fn not_configured_write_checker_verdict_serialises_and_defaults_for_older_payloads() {
        let write = write_result_with(WriteCheckVerdict::not_configured());
        write.validate().unwrap();
        assert!(write.checker.is_clean());
        let wire = serde_json::to_value(&write).unwrap();
        assert_eq!(wire["checker"]["status"], "not_configured");
        assert_eq!(wire["checker"]["runs"], serde_json::json!([]));

        // An older peer that predates the field must still decode, and must
        // decode as "nothing attested" rather than as a passing check.
        let mut legacy = wire.clone();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("checker")
            .expect("checker field is serialised");
        let decoded = decode_write_file_result_json(&legacy.to_string()).unwrap();
        assert_eq!(decoded.checker.status, WriteCheckStatus::NotConfigured);
        assert_eq!(decoded, write);
        let legacy_patch = serde_json::json!({
            "schemaVersion": 1,
            "sha256": "b".repeat(64),
            "checkpointId": "checkpoint",
            "formatter": [],
            "proofImpact": {"invalidatedPaths": [], "requiresReprove": false},
        });
        assert_eq!(
            decode_apply_patch_result_json(&legacy_patch.to_string())
                .unwrap()
                .checker,
            WriteCheckVerdict::not_configured()
        );
    }

    #[test]
    fn write_checker_verdict_validation_rejects_malformed_verdicts() {
        let empty_checked = write_result_with(WriteCheckVerdict {
            status: WriteCheckStatus::Checked,
            runs: Vec::new(),
        });
        assert!(matches!(
            empty_checked.validate(),
            Err(MutationContractError::InvalidValue {
                field: "checker.status"
            })
        ));

        let mut runs = failed_check_verdict().runs;
        let contradictory = write_result_with(WriteCheckVerdict {
            status: WriteCheckStatus::NotConfigured,
            runs: runs.clone(),
        });
        assert!(matches!(
            contradictory.validate(),
            Err(MutationContractError::InvalidValue {
                field: "checker.status"
            })
        ));

        let unbounded = write_result_with(WriteCheckVerdict {
            status: WriteCheckStatus::Checked,
            runs: std::iter::repeat_n(runs[0].clone(), MAX_MUTATION_WRITE_CHECKS + 1).collect(),
        });
        assert!(matches!(
            unbounded.validate(),
            Err(MutationContractError::TooManyItems {
                field: "checker.runs",
                limit: MAX_MUTATION_WRITE_CHECKS
            })
        ));

        runs[1].diagnostics = "x".repeat(MAX_MUTATION_DIAGNOSTIC_BYTES + 1);
        let oversized = write_result_with(WriteCheckVerdict {
            status: WriteCheckStatus::Checked,
            runs: runs.clone(),
        });
        assert!(matches!(
            oversized.validate(),
            Err(MutationContractError::FieldTooLong {
                field: "checker.diagnostics",
                ..
            })
        ));

        runs[1].diagnostics = String::new();
        runs[1].name = String::new();
        let unnamed = write_result_with(WriteCheckVerdict {
            status: WriteCheckStatus::Checked,
            runs,
        });
        assert!(matches!(
            unnamed.validate(),
            Err(MutationContractError::EmptyField {
                field: "checker.name"
            })
        ));

        // deny_unknown_fields still applies inside the additive field.
        let unknown = serde_json::json!({
            "schemaVersion": 1,
            "sha256": "b".repeat(64),
            "checkpointId": "checkpoint",
            "formatter": [],
            "checker": {"status": "not_configured", "runs": [], "unexpected": true},
            "proofImpact": {"invalidatedPaths": [], "requiresReprove": false},
        });
        assert!(matches!(
            decode_write_file_result_json(&unknown.to_string()),
            Err(MutationContractDecodeError::Json(_))
        ));
    }

    #[test]
    fn file_tool_v1_contract_rejects_unknown_oversized_and_inconsistent_content() {
        let unknown = serde_json::json!({
            "schema_version":1,
            "path":"file.txt",
            "content":"ok",
            "unexpected":true
        });
        assert!(matches!(
            decode_write_file_request_json(&unknown.to_string()),
            Err(MutationContractDecodeError::Json(_))
        ));
        let oversized = WriteFileRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            path: "file.txt".into(),
            content: "x".repeat(MAX_FILE_CONTENT_BYTES + 1),
        };
        assert!(matches!(
            oversized.validate(),
            Err(MutationContractError::FieldTooLong {
                field: "content",
                ..
            })
        ));
        let inconsistent = ReadFileResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            sha256: "a".repeat(64),
            byte_length: 5,
            content: Some("hello".into()),
            artifact: None,
        };
        assert!(matches!(
            inconsistent.validate(),
            Err(MutationContractError::InvalidContentOutcome)
        ));
        let invalid_range = ReadFileRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            path: "file.txt".into(),
            max_bytes: Some(0),
        };
        assert!(matches!(
            invalid_range.validate(),
            Err(MutationContractError::InvalidRange { field: "max_bytes" })
        ));
    }

    #[test]
    fn process_and_job_v1_contracts_roundtrip_typed_shapes() {
        let request = ProcessToolRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            program: "/usr/bin/printf".into(),
            arguments: vec!["ok".into()],
            environment: BTreeMap::from([("LANG".into(), "C".into())]),
            timeout_ms: 1_000,
            sandbox: ProcessSandbox::BestEffort,
            inline_bytes: 1024,
            artifact_bytes: 4096,
        };
        let wire = serde_json::to_string(&request).unwrap();
        assert_eq!(decode_process_tool_request_json(&wire).unwrap(), request);

        let result = ProcessToolResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            exit_code: Some(0),
            success: true,
            stdout: "ok".into(),
            stderr: String::new(),
            stdout_artifact: None,
            stderr_artifact: None,
            stdout_bytes: 2,
            stderr_bytes: 0,
            truncated: false,
            filtered_environment: Vec::new(),
            provenance: "tool-output".into(),
        };
        let wire = serde_json::to_string(&result).unwrap();
        assert_eq!(decode_process_tool_result_json(&wire).unwrap(), result);

        let spawn = SpawnJobRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            program: "tools/job".into(),
            arguments: vec!["--once".into()],
            environment: BTreeMap::new(),
            pty: true,
        };
        assert_eq!(
            decode_spawn_job_request_json(&serde_json::to_string(&spawn).unwrap()).unwrap(),
            spawn
        );
        let status = JobStatusResult {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            id: "job-1".into(),
            kind: JobStatusKind::Pty,
            state: JobStatusState::Running,
            stdout: String::new(),
            stderr: String::new(),
            stdout_bytes: 0,
            stderr_bytes: 0,
            truncated: false,
        };
        assert_eq!(
            decode_job_status_result_json(&serde_json::to_string(&status).unwrap()).unwrap(),
            status
        );
    }

    #[test]
    fn process_and_job_v1_contracts_reject_shell_strings_and_bounds() {
        let shell_string = ProcessToolRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            program: "sh -c".into(),
            arguments: vec!["echo unsafe".into()],
            environment: BTreeMap::new(),
            timeout_ms: 1_000,
            sandbox: ProcessSandbox::Required,
            inline_bytes: 1024,
            artifact_bytes: 4096,
        };
        assert!(matches!(
            shell_string.validate(),
            Err(MutationContractError::InvalidValue { field: "program" })
        ));
        let mut too_many = shell_string.clone();
        too_many.program = "/usr/bin/true".into();
        too_many.arguments = vec!["x".into(); MAX_PROCESS_ARGUMENTS + 1];
        assert!(matches!(
            too_many.validate(),
            Err(MutationContractError::TooManyItems {
                field: "arguments",
                ..
            })
        ));
        let stdin = JobStdinRequest {
            schema_version: MUTATION_TOOL_SCHEMA_VERSION,
            id: "job-1".into(),
            input: "x".repeat(MAX_JOB_STDIN_BYTES + 1),
        };
        assert!(matches!(
            stdin.validate(),
            Err(MutationContractError::FieldTooLong { field: "input", .. })
        ));
        let unknown = serde_json::json!({
            "schema_version":1,
            "program":"/usr/bin/true",
            "arguments":[],
            "timeout_ms":1000,
            "sandbox":"required",
            "inline_bytes":1024,
            "artifact_bytes":4096,
            "command":"rm -rf /"
        });
        assert!(matches!(
            decode_process_tool_request_json(&unknown.to_string()),
            Err(MutationContractDecodeError::Json(_))
        ));
    }
}
