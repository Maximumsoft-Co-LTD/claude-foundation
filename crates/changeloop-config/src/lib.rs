//! Deterministic, source-aware configuration for Changeloop project instances.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

mod profile;

pub use profile::*;

const PATHS: [&str; 15] = [
    "version",
    "mode",
    "repositories",
    "agent",
    "execution.maxParallelAgents",
    "execution.leaseMinutes",
    "execution.maxRepairCycles",
    "telemetry.analytics",
    "telemetry.crashUpload",
    "web.httpsOnly",
    "web.maxRedirects",
    "web.maxBytes",
    "web.timeoutSeconds",
    "server.eventQueueCapacity",
    "server.shutdownTimeoutMs",
];
const MAX_REPOSITORIES: usize = 32;
const MAX_RESOURCES_PER_REPOSITORY: usize = 1_024;
const MAX_REPOSITORY_NAME_BYTES: usize = 256;
const MAX_REPOSITORY_PATH_BYTES: usize = 4_096;
const MAX_MODEL_PROFILES: usize = 128;
const MAX_MODEL_ID_BYTES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Auto,
    Ask,
    Plan,
    Yolo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub version: u32,
    pub mode: Mode,
    /// Empty preserves the single-repository current-directory behavior.
    pub repositories: Vec<RepositoryConfig>,
    /// Per-model strategy overrides. Empty resolves to built-in defaults.
    #[serde(default)]
    pub agent: AgentConfig,
    pub execution: ExecutionConfig,
    pub telemetry: TelemetryConfig,
    pub web: WebConfig,
    pub server: ServerConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            mode: Mode::Auto,
            repositories: Vec::new(),
            agent: AgentConfig::default(),
            execution: ExecutionConfig::default(),
            telemetry: TelemetryConfig::default(),
            web: WebConfig::default(),
            server: ServerConfig::default(),
        }
    }
}

impl Config {
    /// Resolve the agent strategy for one model id.
    ///
    /// Precedence, highest first: explicit per-model user config, explicit
    /// global user config, built-in per-model default, built-in global
    /// default.
    pub fn agent_profile(&self, model: &str) -> ResolvedAgentProfile {
        self.agent.profile_for(model)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryConfig {
    pub name: String,
    /// Path relative to the project root. Absolute and parent paths are denied.
    pub path: String,
    #[serde(default)]
    pub writable_resources: Vec<String>,
    #[serde(default)]
    pub read_only_resources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionConfig {
    pub max_parallel_agents: u16,
    pub lease_minutes: u32,
    pub max_repair_cycles: u16,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            max_parallel_agents: 3,
            lease_minutes: 45,
            max_repair_cycles: 6,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryConfig {
    pub analytics: bool,
    pub crash_upload: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebConfig {
    pub https_only: bool,
    pub max_redirects: u8,
    pub max_bytes: u64,
    pub timeout_seconds: u32,
}

impl Default for WebConfig {
    fn default() -> Self {
        Self {
            https_only: true,
            max_redirects: 5,
            max_bytes: 5 * 1024 * 1024,
            timeout_seconds: 30,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerConfig {
    pub event_queue_capacity: u32,
    pub shutdown_timeout_ms: u32,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            event_queue_capacity: 1_024,
            shutdown_timeout_ms: 2_000,
        }
    }
}

/// A partial layer; absent fields never erase lower-precedence values.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigPatch {
    pub version: Option<u32>,
    pub mode: Option<Mode>,
    pub repositories: Option<Vec<RepositoryConfig>>,
    /// Replaced wholesale, like `repositories`: a per-model strategy table is
    /// only meaningful as a set.
    pub agent: Option<AgentConfig>,
    pub execution: Option<ExecutionPatch>,
    pub telemetry: Option<TelemetryPatch>,
    pub web: Option<WebPatch>,
    pub server: Option<ServerPatch>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionPatch {
    pub max_parallel_agents: Option<u16>,
    pub lease_minutes: Option<u32>,
    pub max_repair_cycles: Option<u16>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryPatch {
    pub analytics: Option<bool>,
    pub crash_upload: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebPatch {
    pub https_only: Option<bool>,
    pub max_redirects: Option<u8>,
    pub max_bytes: Option<u64>,
    pub timeout_seconds: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerPatch {
    pub event_queue_capacity: Option<u32>,
    pub shutdown_timeout_ms: Option<u32>,
}

impl ConfigPatch {
    pub fn from_json(value: Value) -> Result<Self, ConfigError> {
        serde_json::from_value(value).map_err(ConfigError::InvalidLayer)
    }

    fn entries(&self) -> Vec<(&'static str, Value)> {
        let mut e = Vec::new();
        add(&mut e, "version", self.version);
        add(&mut e, "mode", self.mode);
        if let Some(repositories) = &self.repositories {
            e.push((
                "repositories",
                serde_json::to_value(repositories).expect("repositories serialize"),
            ));
        }
        if let Some(agent) = &self.agent {
            e.push((
                "agent",
                serde_json::to_value(agent).expect("agent serialize"),
            ));
        }
        if let Some(v) = &self.execution {
            add(&mut e, "execution.maxParallelAgents", v.max_parallel_agents);
            add(&mut e, "execution.leaseMinutes", v.lease_minutes);
            add(&mut e, "execution.maxRepairCycles", v.max_repair_cycles);
        }
        if let Some(v) = &self.telemetry {
            add(&mut e, "telemetry.analytics", v.analytics);
            add(&mut e, "telemetry.crashUpload", v.crash_upload);
        }
        if let Some(v) = &self.web {
            add(&mut e, "web.httpsOnly", v.https_only);
            add(&mut e, "web.maxRedirects", v.max_redirects);
            add(&mut e, "web.maxBytes", v.max_bytes);
            add(&mut e, "web.timeoutSeconds", v.timeout_seconds);
        }
        if let Some(v) = &self.server {
            add(&mut e, "server.eventQueueCapacity", v.event_queue_capacity);
            add(&mut e, "server.shutdownTimeoutMs", v.shutdown_timeout_ms);
        }
        e
    }
}

fn add<T: Serialize + Copy>(
    out: &mut Vec<(&'static str, Value)>,
    path: &'static str,
    value: Option<T>,
) {
    if let Some(value) = value {
        out.push((
            path,
            serde_json::to_value(value).expect("scalar serializes"),
        ));
    }
}

/// Precedence is defaults, legacy config, legacy env, user config, project,
/// native env, CLI, then managed policy. Managed policy therefore cannot be
/// weakened by a process flag or model-controlled content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigSource {
    LegacyConfig,
    LegacyEnvironment,
    User,
    Project,
    NativeEnvironment,
    Cli,
    ManagedPolicy,
}

impl ConfigSource {
    pub const fn precedence(self) -> u8 {
        match self {
            Self::LegacyConfig => 10,
            Self::LegacyEnvironment => 20,
            Self::User => 25,
            Self::Project => 30,
            Self::NativeEnvironment => 40,
            Self::Cli => 50,
            Self::ManagedPolicy => 60,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCode {
    DeprecatedSource,
    UnsupportedLegacyField,
    UnknownEnvironmentVariable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerDiagnostic {
    pub code: DiagnosticCode,
    pub key: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigLayer {
    pub source: ConfigSource,
    pub origin: String,
    pub order: u32,
    pub patch: ConfigPatch,
    pub diagnostics: Vec<LayerDiagnostic>,
}

impl ConfigLayer {
    pub fn new(
        source: ConfigSource,
        origin: impl Into<String>,
        order: u32,
        patch: ConfigPatch,
    ) -> Self {
        Self {
            source,
            origin: origin.into(),
            order,
            patch,
            diagnostics: Vec::new(),
        }
    }

    pub fn from_native_json(
        source: ConfigSource,
        origin: impl Into<String>,
        order: u32,
        value: Value,
    ) -> Result<Self, ConfigError> {
        Ok(Self::new(
            source,
            origin,
            order,
            ConfigPatch::from_json(value)?,
        ))
    }

    /// Map only legacy fields with defined native semantics. Unknown values are
    /// never guessed and diagnostics contain paths, not values.
    pub fn from_foundation_json(
        origin: impl Into<String>,
        value: &Value,
    ) -> Result<Self, ConfigError> {
        let mut patch = ConfigPatch::default();
        let mut supported = BTreeSet::new();
        if let Some(v) = value.pointer("/execution/maxParallelAgents") {
            patch.execution.get_or_insert_default().max_parallel_agents =
                Some(number(v, "execution.maxParallelAgents")?);
            supported.insert("execution.maxParallelAgents".to_owned());
        }
        if let Some(v) = value.pointer("/execution/leaseMinutes") {
            patch.execution.get_or_insert_default().lease_minutes =
                Some(number(v, "execution.leaseMinutes")?);
            supported.insert("execution.leaseMinutes".to_owned());
        }
        let mut diagnostics = vec![LayerDiagnostic {
            code: DiagnosticCode::DeprecatedSource,
            key: "foundation.json".to_owned(),
            message: "legacy configuration is accepted for one compatibility period".to_owned(),
        }];
        let mut leaves = Vec::new();
        leaf_paths(value, "", &mut leaves);
        diagnostics.extend(
            leaves
                .into_iter()
                .filter(|p| !supported.contains(p))
                .map(|path| LayerDiagnostic {
                    code: DiagnosticCode::UnsupportedLegacyField,
                    key: path.clone(),
                    message: format!(
                        "legacy field '{path}' is preserved but has no native mapping"
                    ),
                }),
        );
        let mut layer = Self::new(ConfigSource::LegacyConfig, origin, 0, patch);
        layer.diagnostics = diagnostics;
        Ok(layer)
    }

    /// Parse a captured environment map. Values never appear in diagnostics.
    pub fn from_environment(
        source: ConfigSource,
        origin: impl Into<String>,
        vars: &BTreeMap<String, String>,
    ) -> Result<Self, ConfigError> {
        if !matches!(
            source,
            ConfigSource::LegacyEnvironment | ConfigSource::NativeEnvironment
        ) {
            return Err(ConfigError::InvalidEnvironmentSource(source));
        }
        let legacy = source == ConfigSource::LegacyEnvironment;
        let prefix = if legacy { "FOUNDATION_" } else { "CHANGELOOP_" };
        let mut patch = ConfigPatch::default();
        let mut diagnostics = Vec::new();
        for (key, value) in vars.iter().filter(|(key, _)| key.starts_with(prefix)) {
            match &key[prefix.len()..] {
                "MODE" if !legacy => patch.mode = Some(parse_mode(key, value)?),
                "MAX_PARALLEL_AGENTS" => {
                    patch.execution.get_or_insert_default().max_parallel_agents =
                        Some(parse(key, value)?)
                }
                "LEASE_MINUTES" => {
                    patch.execution.get_or_insert_default().lease_minutes = Some(parse(key, value)?)
                }
                "MAX_REPAIR_CYCLES" if !legacy => {
                    patch.execution.get_or_insert_default().max_repair_cycles =
                        Some(parse(key, value)?)
                }
                "ANALYTICS" if !legacy => {
                    patch.telemetry.get_or_insert_default().analytics =
                        Some(parse_bool(key, value)?)
                }
                "CRASH_UPLOAD" if !legacy => {
                    patch.telemetry.get_or_insert_default().crash_upload =
                        Some(parse_bool(key, value)?)
                }
                "WEB_HTTPS_ONLY" if !legacy => {
                    patch.web.get_or_insert_default().https_only = Some(parse_bool(key, value)?)
                }
                "WEB_MAX_REDIRECTS" if !legacy => {
                    patch.web.get_or_insert_default().max_redirects = Some(parse(key, value)?)
                }
                "WEB_MAX_BYTES" if !legacy => {
                    patch.web.get_or_insert_default().max_bytes = Some(parse(key, value)?)
                }
                "WEB_TIMEOUT_SECONDS" if !legacy => {
                    patch.web.get_or_insert_default().timeout_seconds = Some(parse(key, value)?)
                }
                "EVENT_QUEUE_CAPACITY" if !legacy => {
                    patch.server.get_or_insert_default().event_queue_capacity =
                        Some(parse(key, value)?)
                }
                "SHUTDOWN_TIMEOUT_MS" if !legacy => {
                    patch.server.get_or_insert_default().shutdown_timeout_ms =
                        Some(parse(key, value)?)
                }
                _ => diagnostics.push(LayerDiagnostic {
                    code: DiagnosticCode::UnknownEnvironmentVariable,
                    key: key.clone(),
                    message: format!(
                        "environment variable '{key}' is not a supported config input"
                    ),
                }),
            }
        }
        if legacy && vars.keys().any(|key| key.starts_with(prefix)) {
            diagnostics.push(LayerDiagnostic {
                code: DiagnosticCode::DeprecatedSource,
                key: "FOUNDATION_*".to_owned(),
                message: "legacy environment variables are accepted for one compatibility period"
                    .to_owned(),
            });
        }
        let mut layer = Self::new(source, origin, 0, patch);
        layer.diagnostics = diagnostics;
        Ok(layer)
    }
}

fn number<T: TryFrom<u64>>(value: &Value, path: &str) -> Result<T, ConfigError> {
    value
        .as_u64()
        .and_then(|v| T::try_from(v).ok())
        .ok_or_else(|| ConfigError::InvalidLegacyField(path.to_owned()))
}

fn parse<T: std::str::FromStr>(key: &str, value: &str) -> Result<T, ConfigError> {
    value
        .parse()
        .map_err(|_| ConfigError::InvalidEnvironmentVariable(key.to_owned()))
}

fn parse_bool(key: &str, value: &str) -> Result<bool, ConfigError> {
    match value {
        "1" | "true" => Ok(true),
        "0" | "false" => Ok(false),
        _ => Err(ConfigError::InvalidEnvironmentVariable(key.to_owned())),
    }
}

fn parse_mode(key: &str, value: &str) -> Result<Mode, ConfigError> {
    match value {
        "auto" => Ok(Mode::Auto),
        "ask" => Ok(Mode::Ask),
        "plan" => Ok(Mode::Plan),
        "yolo" => Ok(Mode::Yolo),
        _ => Err(ConfigError::InvalidEnvironmentVariable(key.to_owned())),
    }
}

fn leaf_paths(value: &Value, parent: &str, out: &mut Vec<String>) {
    if let Value::Object(object) = value {
        for (key, child) in object {
            let path = if parent.is_empty() {
                key.clone()
            } else {
                format!("{parent}.{key}")
            };
            if child.is_object() {
                leaf_paths(child, &path, out)
            } else {
                out.push(path)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProvenanceSource {
    Defaults,
    LegacyConfig,
    LegacyEnvironment,
    User,
    Project,
    NativeEnvironment,
    Cli,
    ManagedPolicy,
}

impl From<ConfigSource> for ProvenanceSource {
    fn from(value: ConfigSource) -> Self {
        match value {
            ConfigSource::LegacyConfig => Self::LegacyConfig,
            ConfigSource::LegacyEnvironment => Self::LegacyEnvironment,
            ConfigSource::User => Self::User,
            ConfigSource::Project => Self::Project,
            ConfigSource::NativeEnvironment => Self::NativeEnvironment,
            ConfigSource::Cli => Self::Cli,
            ConfigSource::ManagedPolicy => Self::ManagedPolicy,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contribution {
    pub source: ProvenanceSource,
    pub origin: String,
    pub order: u32,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldProvenance {
    pub path: String,
    pub candidates: Vec<Contribution>,
    pub effective_index: usize,
}

impl FieldProvenance {
    pub fn effective(&self) -> &Contribution {
        &self.candidates[self.effective_index]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConfig {
    pub config: Config,
    pub provenance: BTreeMap<String, FieldProvenance>,
    pub diagnostics: Vec<LayerDiagnostic>,
}

impl ResolvedConfig {
    pub fn explain(&self, path: &str) -> Result<ConfigExplanation, ConfigError> {
        let field = self
            .provenance
            .get(path)
            .ok_or_else(|| ConfigError::UnknownField(path.to_owned()))?;
        Ok(ConfigExplanation {
            path: path.to_owned(),
            value: field.effective().value.clone(),
            selected_source: field.effective().source,
            selected_origin: field.effective().origin.clone(),
            effective_index: field.effective_index,
            candidates: field.candidates.clone(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigExplanation {
    pub path: String,
    pub value: Value,
    pub selected_source: ProvenanceSource,
    pub selected_origin: String,
    pub effective_index: usize,
    pub candidates: Vec<Contribution>,
}

pub struct ConfigResolver;

impl ConfigResolver {
    pub fn resolve(mut layers: Vec<ConfigLayer>) -> Result<ResolvedConfig, ConfigError> {
        layers.sort_by(|a, b| {
            (a.source.precedence(), a.order, &a.origin).cmp(&(
                b.source.precedence(),
                b.order,
                &b.origin,
            ))
        });
        for pair in layers.windows(2) {
            // `order` is the explicit within-source precedence contract. Do
            // not let an origin path accidentally become policy precedence:
            // aliases, case folding, or renamed managed-policy files must not
            // silently change the effective value.
            if pair[0].source == pair[1].source && pair[0].order == pair[1].order {
                return Err(ConfigError::DuplicateLayer {
                    layer_source: pair[0].source,
                    order: pair[0].order,
                    origin: format!("{} and {}", pair[0].origin, pair[1].origin),
                });
            }
        }
        let mut document = serde_json::to_value(Config::default()).expect("defaults serialize");
        let mut provenance = BTreeMap::new();
        for path in PATHS {
            provenance.insert(
                path.to_owned(),
                FieldProvenance {
                    path: path.to_owned(),
                    candidates: vec![Contribution {
                        source: ProvenanceSource::Defaults,
                        origin: "built-in".to_owned(),
                        order: 0,
                        value: at(&document, path).unwrap().clone(),
                    }],
                    effective_index: 0,
                },
            );
        }
        let mut diagnostics = Vec::new();
        for layer in layers {
            if layer.patch.mode == Some(Mode::Yolo)
                && matches!(
                    layer.source,
                    ConfigSource::LegacyConfig
                        | ConfigSource::LegacyEnvironment
                        | ConfigSource::Project
                )
            {
                return Err(ConfigError::UntrustedAuthoritySource {
                    path: "mode".to_owned(),
                    layer_source: layer.source,
                    origin: layer.origin,
                });
            }
            diagnostics.extend(layer.diagnostics);
            for (path, value) in layer.patch.entries() {
                set(&mut document, path, value.clone())?;
                let field = provenance.get_mut(path).expect("patch path declared");
                field.candidates.push(Contribution {
                    source: layer.source.into(),
                    origin: layer.origin.clone(),
                    order: layer.order,
                    value,
                });
                field.effective_index = field.candidates.len() - 1;
            }
        }
        let config = serde_json::from_value(document).map_err(ConfigError::InvalidLayer)?;
        validate(&config)?;
        Ok(ResolvedConfig {
            config,
            provenance,
            diagnostics,
        })
    }
}

fn at<'a>(document: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(document, |value, key| value.get(key))
}

fn set(document: &mut Value, path: &str, value: Value) -> Result<(), ConfigError> {
    let mut keys = path.split('.').peekable();
    let mut current = document;
    while let Some(key) = keys.next() {
        if keys.peek().is_none() {
            current
                .as_object_mut()
                .ok_or_else(|| ConfigError::UnknownField(path.to_owned()))?
                .insert(key.to_owned(), value);
            return Ok(());
        }
        current = current
            .as_object_mut()
            .and_then(|o| o.get_mut(key))
            .ok_or_else(|| ConfigError::UnknownField(path.to_owned()))?;
    }
    Err(ConfigError::UnknownField(path.to_owned()))
}

fn validate(config: &Config) -> Result<(), ConfigError> {
    let mut issues = Vec::new();
    if config.version != 1 {
        issues.push(ValidationIssue::new("version", "must equal 1"));
    }
    let mut repository_names = BTreeSet::new();
    let mut repository_paths = BTreeSet::new();
    if config.repositories.len() > MAX_REPOSITORIES {
        issues.push(ValidationIssue::new(
            "repositories",
            format!("must contain at most {MAX_REPOSITORIES} entries"),
        ));
    }
    for (index, repository) in config.repositories.iter().enumerate() {
        let prefix = format!("repositories.{index}");
        if repository.name.trim().is_empty()
            || repository.name.len() > MAX_REPOSITORY_NAME_BYTES
            || repository.name.chars().any(char::is_control)
            || !repository_names.insert(repository.name.clone())
        {
            issues.push(ValidationIssue::new(
                format!("{prefix}.name"),
                format!("must be non-empty, unique, and at most {MAX_REPOSITORY_NAME_BYTES} bytes"),
            ));
        }
        if repository.path.len() > MAX_REPOSITORY_PATH_BYTES
            || repository.path.chars().any(char::is_control)
            || !hermetic_relative(&repository.path)
            || !repository_paths.insert(repository.path.clone())
        {
            issues.push(ValidationIssue::new(
                format!("{prefix}.path"),
                format!(
                    "must be a unique hermetic relative path of at most {MAX_REPOSITORY_PATH_BYTES} bytes"
                ),
            ));
        }
        for (kind, resources) in [
            ("writableResources", &repository.writable_resources),
            ("readOnlyResources", &repository.read_only_resources),
        ] {
            let mut seen = BTreeSet::new();
            if resources.len() > MAX_RESOURCES_PER_REPOSITORY {
                issues.push(ValidationIssue::new(
                    format!("{prefix}.{kind}"),
                    format!("must contain at most {MAX_RESOURCES_PER_REPOSITORY} entries"),
                ));
            }
            for (resource_index, resource) in resources.iter().enumerate() {
                if resource.len() > MAX_REPOSITORY_PATH_BYTES
                    || resource.chars().any(char::is_control)
                    || !hermetic_relative(resource)
                    || !seen.insert(resource)
                {
                    issues.push(ValidationIssue::new(
                        format!("{prefix}.{kind}.{resource_index}"),
                        format!(
                            "must be a unique hermetic path inside the repository of at most {MAX_REPOSITORY_PATH_BYTES} bytes"
                        ),
                    ));
                }
            }
        }
        if repository
            .writable_resources
            .iter()
            .any(|resource| repository.read_only_resources.contains(resource))
        {
            issues.push(ValidationIssue::new(
                format!("{prefix}.writableResources"),
                "a resource cannot be both writable and read-only",
            ));
        }
    }
    range(
        &mut issues,
        "execution.maxParallelAgents",
        config.execution.max_parallel_agents,
        1,
        32,
    );
    range(
        &mut issues,
        "execution.leaseMinutes",
        config.execution.lease_minutes,
        1,
        1_440,
    );
    range(
        &mut issues,
        "execution.maxRepairCycles",
        config.execution.max_repair_cycles,
        1,
        100,
    );
    range(
        &mut issues,
        "web.maxRedirects",
        config.web.max_redirects,
        0,
        10,
    );
    range(
        &mut issues,
        "web.maxBytes",
        config.web.max_bytes,
        1_024,
        100 * 1024 * 1024,
    );
    range(
        &mut issues,
        "web.timeoutSeconds",
        config.web.timeout_seconds,
        1,
        300,
    );
    range(
        &mut issues,
        "server.eventQueueCapacity",
        config.server.event_queue_capacity,
        16,
        65_536,
    );
    range(
        &mut issues,
        "server.shutdownTimeoutMs",
        config.server.shutdown_timeout_ms,
        100,
        30_000,
    );
    validate_agent(&config.agent, &mut issues);
    if issues.is_empty() {
        Ok(())
    } else {
        Err(ConfigError::Validation(issues))
    }
}

/// Validate the strategy each configured model actually resolves to, not the
/// sparse override text, so a bad value cannot hide behind a lower layer.
fn validate_agent(agent: &AgentConfig, issues: &mut Vec<ValidationIssue>) {
    if agent.models.len() > MAX_MODEL_PROFILES {
        issues.push(ValidationIssue::new(
            "agent.models",
            format!("must contain at most {MAX_MODEL_PROFILES} entries"),
        ));
    }
    let mut targets = vec![("agent.default".to_owned(), String::new())];
    for model in agent.models.keys() {
        if model.trim().is_empty()
            || model.len() > MAX_MODEL_ID_BYTES
            || model.chars().any(char::is_control)
        {
            issues.push(ValidationIssue::new(
                "agent.models",
                format!("model id must be non-empty and at most {MAX_MODEL_ID_BYTES} bytes"),
            ));
            continue;
        }
        targets.push((format!("agent.models.{model}"), model.clone()));
    }
    for (prefix, model) in targets {
        let profile = agent.profile_for(&model).profile;
        range(
            issues,
            &format!("{prefix}.context.compaction.triggerPercent"),
            profile.context.compaction.trigger_percent,
            1,
            100,
        );
        range(
            issues,
            &format!("{prefix}.delegation.maxDepth"),
            profile.delegation.max_depth,
            1,
            8,
        );
        range(
            issues,
            &format!("{prefix}.delegation.maxConcurrency"),
            profile.delegation.max_concurrency,
            1,
            64,
        );
    }
}

fn hermetic_relative(path: &str) -> bool {
    let path = std::path::Path::new(path);
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn range<T: PartialOrd + std::fmt::Display>(
    issues: &mut Vec<ValidationIssue>,
    path: &str,
    value: T,
    min: T,
    max: T,
) {
    if value < min || value > max {
        issues.push(ValidationIssue::new(
            path,
            format!("must be between {min} and {max}"),
        ));
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
}

impl ValidationIssue {
    fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReloadImpact {
    LiveApply,
    NewOperationsOnly,
    RestartProject,
    RestartServer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadChange {
    pub path: String,
    pub before: Value,
    pub after: Value,
    pub impact: ReloadImpact,
    pub selected_source: ProvenanceSource,
    pub selected_origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotReloadPlan {
    pub changes: Vec<ReloadChange>,
    pub highest_impact: Option<ReloadImpact>,
}

impl HotReloadPlan {
    /// Pure planning only; the owning project instance applies these actions.
    pub fn between(before: &ResolvedConfig, after: &ResolvedConfig) -> Self {
        let old = serde_json::to_value(&before.config).expect("config serializes");
        let new = serde_json::to_value(&after.config).expect("config serializes");
        let mut changes = Vec::new();
        for path in PATHS {
            if at(&old, path) == at(&new, path) {
                continue;
            }
            let selected = after.provenance[path].effective();
            changes.push(ReloadChange {
                path: path.to_owned(),
                before: at(&old, path).unwrap().clone(),
                after: at(&new, path).unwrap().clone(),
                impact: impact(path),
                selected_source: selected.source,
                selected_origin: selected.origin.clone(),
            });
        }
        let highest_impact = changes.iter().map(|v| v.impact).max();
        Self {
            changes,
            highest_impact,
        }
    }
}

fn impact(path: &str) -> ReloadImpact {
    match path {
        "version" | "server.eventQueueCapacity" | "server.shutdownTimeoutMs" => {
            ReloadImpact::RestartServer
        }
        "execution.maxParallelAgents" | "repositories" => ReloadImpact::RestartProject,
        "agent" => ReloadImpact::NewOperationsOnly,
        "mode" | "execution.leaseMinutes" | "execution.maxRepairCycles" => {
            ReloadImpact::NewOperationsOnly
        }
        _ => ReloadImpact::LiveApply,
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("invalid configuration layer: {0}")]
    InvalidLayer(serde_json::Error),
    #[error("invalid legacy field '{0}'")]
    InvalidLegacyField(String),
    #[error("invalid environment variable '{0}'")]
    InvalidEnvironmentVariable(String),
    #[error("source {0:?} is not an environment source")]
    InvalidEnvironmentSource(ConfigSource),
    #[error("unknown configuration field '{0}'")]
    UnknownField(String),
    #[error("duplicate config layer {layer_source:?}:{order}:{origin}")]
    DuplicateLayer {
        layer_source: ConfigSource,
        order: u32,
        origin: String,
    },
    #[error(
        "configuration source {layer_source:?} at {origin} cannot grant authority through '{path}'"
    )]
    UntrustedAuthoritySource {
        path: String,
        layer_source: ConfigSource,
        origin: String,
    },
    #[error("configuration validation failed: {0:?}")]
    Validation(Vec<ValidationIssue>),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn layer(source: ConfigSource, origin: &str, patch: Value) -> ConfigLayer {
        ConfigLayer::from_native_json(source, origin, 0, patch).unwrap()
    }

    #[test]
    fn precedence_is_input_order_independent_and_policy_wins() {
        let layers = vec![
            layer(ConfigSource::Cli, "--mode yolo", json!({"mode":"yolo"})),
            layer(
                ConfigSource::Project,
                "changeloop.json",
                json!({"mode":"plan"}),
            ),
            layer(
                ConfigSource::ManagedPolicy,
                "org/policy.json",
                json!({"mode":"ask"}),
            ),
            layer(
                ConfigSource::NativeEnvironment,
                "process",
                json!({"mode":"auto"}),
            ),
        ];
        let mut reversed = layers.clone();
        reversed.reverse();
        let forward = ConfigResolver::resolve(layers).unwrap();
        let backward = ConfigResolver::resolve(reversed).unwrap();
        assert_eq!(forward.config, backward.config);
        assert_eq!(forward.config.mode, Mode::Ask);
        assert_eq!(
            forward.explain("mode").unwrap().selected_source,
            ProvenanceSource::ManagedPolicy
        );
        assert_eq!(forward.explain("mode").unwrap().candidates.len(), 5);
    }

    #[test]
    fn repository_and_legacy_sources_cannot_activate_yolo() {
        for source in [
            ConfigSource::LegacyConfig,
            ConfigSource::LegacyEnvironment,
            ConfigSource::Project,
        ] {
            let error = ConfigResolver::resolve(vec![layer(
                source,
                "untrusted-config",
                json!({"mode":"yolo"}),
            )])
            .unwrap_err();
            assert!(matches!(
                error,
                ConfigError::UntrustedAuthoritySource {
                    path,
                    layer_source,
                    ..
                } if path == "mode" && layer_source == source
            ));
        }

        let error = ConfigResolver::resolve(vec![
            layer(
                ConfigSource::Project,
                "changeloop.json",
                json!({"mode":"yolo"}),
            ),
            layer(
                ConfigSource::ManagedPolicy,
                "managed-policy.json",
                json!({"mode":"ask"}),
            ),
        ])
        .unwrap_err();
        assert!(matches!(
            error,
            ConfigError::UntrustedAuthoritySource {
                layer_source: ConfigSource::Project,
                ..
            }
        ));
    }

    #[test]
    fn trusted_authority_sources_can_activate_yolo_by_precedence() {
        for source in [
            ConfigSource::User,
            ConfigSource::NativeEnvironment,
            ConfigSource::Cli,
            ConfigSource::ManagedPolicy,
        ] {
            let resolved = ConfigResolver::resolve(vec![layer(
                source,
                "explicit-authority",
                json!({"mode":"yolo"}),
            )])
            .unwrap();
            assert_eq!(resolved.config.mode, Mode::Yolo);
            assert_eq!(
                resolved.explain("mode").unwrap().selected_source,
                ProvenanceSource::from(source)
            );
        }

        let resolved = ConfigResolver::resolve(vec![
            layer(
                ConfigSource::User,
                "user-config.json",
                json!({"mode":"yolo"}),
            ),
            layer(
                ConfigSource::ManagedPolicy,
                "managed-policy.json",
                json!({"mode":"ask"}),
            ),
        ])
        .unwrap();
        assert_eq!(resolved.config.mode, Mode::Ask);
        assert_eq!(
            resolved.explain("mode").unwrap().selected_source,
            ProvenanceSource::ManagedPolicy
        );
    }

    #[test]
    fn equal_order_layers_from_different_origins_are_rejected() {
        let error = ConfigResolver::resolve(vec![
            layer(
                ConfigSource::ManagedPolicy,
                "org/a.json",
                json!({"mode":"ask"}),
            ),
            layer(
                ConfigSource::ManagedPolicy,
                "org/b.json",
                json!({"mode":"auto"}),
            ),
        ])
        .unwrap_err();
        assert!(matches!(
            error,
            ConfigError::DuplicateLayer {
                layer_source: ConfigSource::ManagedPolicy,
                order: 0,
                ..
            }
        ));
    }

    #[test]
    fn project_configuration_overrides_user_configuration_with_provenance() {
        let resolved = ConfigResolver::resolve(vec![
            layer(
                ConfigSource::Project,
                "project/changeloop.json",
                json!({"mode":"plan"}),
            ),
            layer(
                ConfigSource::User,
                "user/changeloop/config.json",
                json!({"mode":"ask"}),
            ),
        ])
        .unwrap();
        assert_eq!(resolved.config.mode, Mode::Plan);
        let explanation = resolved.explain("mode").unwrap();
        assert_eq!(explanation.selected_source, ProvenanceSource::Project);
        assert!(
            explanation
                .candidates
                .iter()
                .any(|candidate| candidate.source == ProvenanceSource::User)
        );
    }

    #[test]
    fn explain_retains_overridden_values_and_origins() {
        let resolved = ConfigResolver::resolve(vec![
            layer(
                ConfigSource::LegacyConfig,
                "foundation.json",
                json!({"execution":{"leaseMinutes":20}}),
            ),
            layer(
                ConfigSource::Project,
                "changeloop.json",
                json!({"execution":{"leaseMinutes":60}}),
            ),
        ])
        .unwrap();
        let explanation = resolved.explain("execution.leaseMinutes").unwrap();
        assert_eq!(explanation.value, json!(60));
        assert_eq!(explanation.selected_origin, "changeloop.json");
        assert_eq!(explanation.candidates.len(), 3);
        assert!(resolved.explain("execution.missing").is_err());
    }

    #[test]
    fn validation_reports_all_bad_fields() {
        let error = ConfigResolver::resolve(vec![layer(ConfigSource::Project, "changeloop.json", json!({
            "execution":{"maxParallelAgents":0}, "web":{"maxRedirects":50}, "server":{"eventQueueCapacity":1}
        }))]).unwrap_err();
        let ConfigError::Validation(issues) = error else {
            panic!("unexpected error")
        };
        assert_eq!(issues.len(), 3);
    }

    #[test]
    fn native_env_overrides_legacy_and_diagnostics_do_not_leak_values() {
        let legacy_vars = BTreeMap::from([
            ("FOUNDATION_LEASE_MINUTES".to_owned(), "15".to_owned()),
            (
                "FOUNDATION_SECRET_TOKEN".to_owned(),
                "do-not-report".to_owned(),
            ),
        ]);
        let native_vars =
            BTreeMap::from([("CHANGELOOP_LEASE_MINUTES".to_owned(), "90".to_owned())]);
        let legacy =
            ConfigLayer::from_environment(ConfigSource::LegacyEnvironment, "process", &legacy_vars)
                .unwrap();
        assert!(
            legacy
                .diagnostics
                .iter()
                .all(|d| !d.message.contains("do-not-report"))
        );
        let native =
            ConfigLayer::from_environment(ConfigSource::NativeEnvironment, "process", &native_vars)
                .unwrap();
        let resolved = ConfigResolver::resolve(vec![native, legacy]).unwrap();
        assert_eq!(resolved.config.execution.lease_minutes, 90);
        assert_eq!(
            resolved
                .explain("execution.leaseMinutes")
                .unwrap()
                .selected_source,
            ProvenanceSource::NativeEnvironment
        );
    }

    #[test]
    fn absent_legacy_environment_does_not_emit_deprecation_warning() {
        let variables = BTreeMap::from([("CHANGELOOP_LEASE_MINUTES".to_owned(), "90".to_owned())]);
        let legacy =
            ConfigLayer::from_environment(ConfigSource::LegacyEnvironment, "process", &variables)
                .unwrap();
        assert!(legacy.diagnostics.is_empty());
        assert!(legacy.patch.entries().is_empty());
    }

    #[test]
    fn legacy_mapping_is_explicit_and_reports_unsupported_paths() {
        let source = json!({"version":1,"execution":{"maxParallelAgents":7,"leaseMinutes":20,"packetBytes":100},"models":{"fast":{"family":"haiku"}}});
        let layer = ConfigLayer::from_foundation_json("foundation.json", &source).unwrap();
        assert_eq!(
            layer.patch.execution.as_ref().unwrap().max_parallel_agents,
            Some(7)
        );
        assert!(
            layer
                .diagnostics
                .iter()
                .any(|d| d.key == "models.fast.family")
        );
        assert_eq!(
            ConfigResolver::resolve(vec![layer])
                .unwrap()
                .config
                .execution
                .lease_minutes,
            20
        );
    }

    #[test]
    fn reload_plan_has_targeted_and_sorted_changes() {
        let before = ConfigResolver::resolve(Vec::new()).unwrap();
        let after = ConfigResolver::resolve(vec![layer(ConfigSource::Project, "changeloop.json", json!({
            "execution":{"maxParallelAgents":5,"leaseMinutes":30}, "telemetry":{"analytics":true}, "server":{"eventQueueCapacity":2048}
        }))]).unwrap();
        let plan = HotReloadPlan::between(&before, &after);
        assert_eq!(
            plan.changes
                .iter()
                .map(|c| c.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "execution.maxParallelAgents",
                "execution.leaseMinutes",
                "telemetry.analytics",
                "server.eventQueueCapacity"
            ]
        );
        assert_eq!(plan.highest_impact, Some(ReloadImpact::RestartServer));
    }

    #[test]
    fn rejects_duplicate_identity_and_unknown_fields() {
        let first = layer(
            ConfigSource::Project,
            "changeloop.json",
            json!({"mode":"ask"}),
        );
        let second = layer(
            ConfigSource::Project,
            "changeloop.json",
            json!({"mode":"plan"}),
        );
        assert!(matches!(
            ConfigResolver::resolve(vec![first, second]),
            Err(ConfigError::DuplicateLayer { .. })
        ));
        assert!(ConfigPatch::from_json(json!({"permission":"allow"})).is_err());
        assert!(ConfigPatch::from_json(json!({"web":{"unknown":true}})).is_err());
    }

    #[test]
    fn multi_repository_resources_are_source_aware_and_hermetic() {
        let resolved = ConfigResolver::resolve(vec![layer(
            ConfigSource::Project,
            "changeloop.json",
            json!({"repositories":[
                {"name":"api","path":"services/api","writableResources":["src","Cargo.toml"]},
                {"name":"web","path":"services/web","readOnlyResources":["package.json"]}
            ]}),
        )])
        .unwrap();
        assert_eq!(resolved.config.repositories.len(), 2);
        assert_eq!(
            resolved.explain("repositories").unwrap().selected_source,
            ProvenanceSource::Project
        );

        for invalid in [
            json!({"repositories":[{"name":"escape","path":"../outside"}]}),
            json!({"repositories":[{"name":"absolute","path":"/tmp/outside"}]}),
            json!({"repositories":[
                {"name":"same","path":"a"},{"name":"same","path":"b"}
            ]}),
            json!({"repositories":[{
                "name":"conflict","path":"repo",
                "writableResources":["shared"],"readOnlyResources":["shared"]
            }]}),
        ] {
            assert!(
                ConfigResolver::resolve(vec![layer(
                    ConfigSource::Project,
                    "changeloop.json",
                    invalid
                )])
                .is_err()
            );
        }
    }

    #[test]
    fn agent_profile_defaults_resolve_without_any_configuration() {
        let resolved = ConfigResolver::resolve(Vec::new()).unwrap();
        let profile = resolved.config.agent_profile("some-unlisted-model");
        assert_eq!(profile.layers, vec![ProfileLayer::GlobalDefault]);
        assert_eq!(profile.profile.tier, ModelTier::Unspecified);
        assert_eq!(
            profile.profile.context.strategy,
            ContextStrategy::KeepLatestAndSummarise
        );
        assert!(!profile.profile.context.isolation_enabled());
        assert_eq!(
            profile.profile.exploration.baseline,
            ExplorationTools::GrepReadGlob
        );
        assert!(!profile.profile.exploration.embeddings_index);
        assert_eq!(profile.profile.delegation.mode, DelegationMode::ReadOnly);
        assert!(profile.profile.delegation.contracts_are_harness_authored());
        assert!(profile.profile.edit_format.policy_applies);
        assert!(profile.profile.edit_format.format_then_check);
    }

    #[test]
    fn builtin_model_default_overrides_global_default() {
        let config = Config::default();
        let frontier = config.agent_profile("claude-opus-4-6");
        assert_eq!(
            frontier.layers,
            vec![
                ProfileLayer::GlobalDefault,
                ProfileLayer::ModelDefault(ModelTier::Frontier)
            ]
        );
        assert!(frontier.profile.context.isolation_enabled());
        assert!(!frontier.profile.edit_format.policy_applies);
        assert!(frontier.profile.edit_format.editor_subagent_split);

        let weaker = config.agent_profile("deepseek-v3.2-thinking");
        assert_eq!(weaker.profile.tier, ModelTier::OpenWeight);
        assert!(!weaker.profile.context.isolation_enabled());
        assert!(weaker.profile.edit_format.policy_applies);
    }

    #[test]
    fn explicit_user_config_outranks_model_and_global_defaults() {
        let resolved = ConfigResolver::resolve(vec![layer(
            ConfigSource::Project,
            "changeloop.json",
            json!({"agent":{
                "default":{"context":{"subagentIsolation":true},"delegation":{"maxConcurrency":4}},
                "models":{"claude-opus-4-6":{"context":{"subagentIsolation":false}}}
            }}),
        )])
        .unwrap();

        // User global beats the built-in model default.
        let unlisted = resolved.config.agent_profile("gpt-5-codex");
        assert_eq!(
            unlisted.layers,
            vec![
                ProfileLayer::GlobalDefault,
                ProfileLayer::ModelDefault(ModelTier::Frontier),
                ProfileLayer::UserGlobal
            ]
        );
        assert!(unlisted.profile.context.subagent_isolation);
        assert_eq!(unlisted.profile.delegation.max_concurrency, 4);

        // User per-model beats user global, which beats both built-ins.
        let listed = resolved.config.agent_profile("claude-opus-4-6");
        assert_eq!(
            listed.layers,
            vec![
                ProfileLayer::GlobalDefault,
                ProfileLayer::ModelDefault(ModelTier::Frontier),
                ProfileLayer::UserGlobal,
                ProfileLayer::UserModel("claude-opus-4-6".to_owned())
            ]
        );
        assert!(!listed.profile.context.subagent_isolation);
        assert!(!listed.profile.context.isolation_enabled());
        assert_eq!(listed.profile.delegation.max_concurrency, 4);
        assert_eq!(
            resolved.explain("agent").unwrap().selected_source,
            ProvenanceSource::Project
        );
    }

    #[test]
    fn no_delegation_and_disabled_isolation_are_expressible() {
        let resolved = ConfigResolver::resolve(vec![layer(
            ConfigSource::Project,
            "changeloop.json",
            json!({"agent":{"models":{"claude-opus-4-6":{
                "context":{"strategy":"keep-latest-and-summarise","subagentIsolation":false},
                "delegation":{"mode":"disabled","cleanContextReview":false}
            }}}}),
        )])
        .unwrap();
        let profile = resolved.config.agent_profile("claude-opus-4-6").profile;
        assert!(!profile.delegation.is_enabled());
        assert!(!profile.delegation.permits_writes());
        assert!(!profile.context.subagent_isolation);
        assert!(!profile.context.isolation_enabled());
        assert_eq!(
            profile.context.strategy,
            ContextStrategy::KeepLatestAndSummarise
        );
    }

    #[test]
    fn exploration_escalates_on_change_locality_not_repository_size() {
        let exploration = Config::default()
            .agent_profile("claude-opus-4-6")
            .profile
            .exploration;
        assert_eq!(
            exploration.tools_for(ChangeLocality::local(2)),
            ExplorationTools::GrepReadGlob
        );
        assert_eq!(
            exploration.tools_for(ChangeLocality::local(3)),
            ExplorationTools::SymbolGraph
        );
        assert_eq!(
            exploration.tools_for(ChangeLocality::cross_repository(1)),
            ExplorationTools::SymbolGraph
        );

        let never = ExplorationProfile {
            symbol_graph_file_span: 0,
            symbol_graph_cross_repository: false,
            ..ExplorationProfile::default()
        };
        assert_eq!(
            never.tools_for(ChangeLocality::local(50)),
            ExplorationTools::GrepReadGlob
        );
    }

    #[test]
    fn agent_serde_round_trip_preserves_unknown_fields_and_tags() {
        let source = json!({"agent":{
            "default":{
                "context":{
                    "strategy":"programmatic-tool-calling",
                    "compaction":{"trigger":{"type":"token-budget","tokens":50000}},
                    "futureContextKnob":{"nested":[1,2]}
                },
                "futureSectionKnob":true
            },
            "models":{"future-model":{"delegation":{"mode":"advisor-inversion"}}},
            "futureTopLevelKnob":"kept"
        }});
        let patch = ConfigPatch::from_json(source.clone()).unwrap();
        let agent = patch.agent.clone().unwrap();

        assert_eq!(
            serde_json::to_value(&agent).unwrap(),
            source.get("agent").unwrap().clone()
        );

        let context = agent.default.context.as_ref().unwrap();
        assert_eq!(
            context.strategy,
            Some(ContextStrategy::Unknown {
                tag: "programmatic-tool-calling".to_owned(),
                body: Value::Null
            })
        );
        assert_eq!(
            context
                .compaction
                .as_ref()
                .unwrap()
                .trigger
                .as_ref()
                .unwrap()
                .tag(),
            "token-budget"
        );
        assert!(context.extra.contains_key("futureContextKnob"));

        // The unknown values survive full resolution, too.
        let resolved = ConfigResolver::resolve(vec![layer(
            ConfigSource::Project,
            "changeloop.json",
            source,
        )])
        .unwrap();
        assert_eq!(
            serde_json::to_value(&resolved.config).unwrap()["agent"]["futureTopLevelKnob"],
            json!("kept")
        );
        let profile = resolved.config.agent_profile("future-model").profile;
        assert!(!profile.context.strategy.is_known());
        assert_eq!(profile.context.strategy.tag(), "programmatic-tool-calling");
        assert_eq!(profile.delegation.mode.tag(), "advisor-inversion");
        assert!(profile.context.extra.contains_key("futureContextKnob"));
        assert!(profile.extra.contains_key("futureSectionKnob"));
        assert_eq!(
            serde_json::to_value(&profile.context.compaction.trigger).unwrap(),
            json!({"type":"token-budget","tokens":50000})
        );
    }

    #[test]
    fn agent_validation_checks_the_resolved_profile() {
        let error = ConfigResolver::resolve(vec![layer(
            ConfigSource::Project,
            "changeloop.json",
            json!({"agent":{
                "default":{"delegation":{"maxDepth":0}},
                "models":{"claude-opus-4-6":{"context":{"compaction":{"triggerPercent":200}}}}
            }}),
        )])
        .unwrap_err();
        let ConfigError::Validation(issues) = error else {
            panic!("unexpected error")
        };
        let paths = issues.iter().map(|i| i.path.as_str()).collect::<Vec<_>>();
        assert!(paths.contains(&"agent.default.delegation.maxDepth"));
        assert!(paths.contains(&"agent.models.claude-opus-4-6.context.compaction.triggerPercent"));
    }

    #[test]
    fn rejects_oversized_repository_collections_and_fields() {
        let repositories = (0..=MAX_REPOSITORIES)
            .map(|index| {
                json!({
                    "name": format!("repo-{index}"),
                    "path": format!("repo-{index}")
                })
            })
            .collect::<Vec<_>>();
        assert!(
            ConfigResolver::resolve(vec![layer(
                ConfigSource::Project,
                "changeloop.json",
                json!({"repositories": repositories}),
            )])
            .is_err()
        );

        for repository in [
            json!({"name":"n".repeat(MAX_REPOSITORY_NAME_BYTES + 1),"path":"repo"}),
            json!({"name":"repo\u{1b}[31m","path":"repo"}),
            json!({"name":"repo","path":"p".repeat(MAX_REPOSITORY_PATH_BYTES + 1)}),
            json!({"name":"repo","path":"repo\nother"}),
            json!({
                "name":"repo",
                "path":"repo",
                "writableResources": (0..=MAX_RESOURCES_PER_REPOSITORY)
                    .map(|index| format!("resource-{index}"))
                    .collect::<Vec<_>>()
            }),
            json!({
                "name":"repo",
                "path":"repo",
                "readOnlyResources":["r".repeat(MAX_REPOSITORY_PATH_BYTES + 1)]
            }),
            json!({"name":"repo","path":"repo","writableResources":["src\rhidden"]}),
        ] {
            assert!(
                ConfigResolver::resolve(vec![layer(
                    ConfigSource::Project,
                    "changeloop.json",
                    json!({"repositories":[repository]}),
                )])
                .is_err()
            );
        }
    }
}
