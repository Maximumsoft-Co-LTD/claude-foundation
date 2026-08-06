//! Per-model context, exploration, delegation and edit-format strategy.
//!
//! The measured effect of these interventions inverts by model: subagent
//! context isolation was the best context method for a strong agentic model
//! and among the worst for a weaker one, and edit-format policy matters below
//! the frontier while being near-irrelevant at it. Strategy is therefore
//! configuration, never a compile-time constant.
//!
//! Resolution order, lowest precedence first:
//!
//! 1. global default (`AgentProfile::default()`, deliberately conservative),
//! 2. built-in per-model default for the detected [`ModelTier`],
//! 3. explicit user config applying to every model (`agent.default`),
//! 4. explicit user config for one model id (`agent.models[<id>]`).
//!
//! Layers 3 and 4 are "explicit user config" and therefore outrank both
//! built-in layers; layer 2 outranks layer 1.

use std::collections::BTreeMap;

use changeloop_protocol::open_enum;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Extra keys carried through a round trip untouched. Unknown configuration is
/// preserved, never silently coerced or dropped.
pub type Extra = BTreeMap<String, Value>;

fn is_empty_extra(extra: &Extra) -> bool {
    extra.is_empty()
}

open_enum! {
    /// Capability class of a model. Selects the built-in per-model default.
    ModelTier {
        Unspecified => "unspecified",
        Frontier => "frontier",
        Mid => "mid",
        OpenWeight => "open-weight",
    }
}

open_enum! {
    /// How long-running context is managed.
    ContextStrategy {
        /// Keep the latest turns and summarise the rest. The safe answer for a
        /// weaker model.
        KeepLatestAndSummarise => "keep-latest-and-summarise",
        /// Push exploration into child sessions so intermediate output never
        /// lands in the parent transcript. Viable only for a strong model.
        SubagentIsolation => "subagent-isolation",
    }
}

open_enum! {
    /// When compaction runs.
    CompactionTrigger {
        Never => "never",
        /// Fire at `trigger_percent` of the usable window, measured over
        /// conversational context only.
        ConversationalTokenPercent => "conversational-token-percent",
    }
}

open_enum! {
    /// Where a compaction cut may fall. Reasoning signatures cover a whole
    /// ordered content array, so sub-message cuts invalidate them.
    CompactionBoundary {
        Message => "message",
    }
}

open_enum! {
    /// The exploration tool set.
    ExplorationTools {
        /// ripgrep, read and glob. Correct for local, identifier-discoverable
        /// changes and competitive with structural indexes there.
        GrepReadGlob => "grep-read-glob",
        /// Adds a tree-sitter symbol/call graph. Earns its keep past a
        /// multi-file change span or on cross-repository discovery.
        SymbolGraph => "symbol-graph",
    }
}

open_enum! {
    /// Whether subagents may be used, and for what.
    DelegationMode {
        /// No subagents at all.
        Disabled => "disabled",
        /// Subagents may read and report; they may not mutate the workspace.
        ReadOnly => "read-only",
        /// Subagents may also write. Requires a strong per-unit oracle and
        /// single-threaded writes per worktree.
        ReadAndWrite => "read-and-write",
    }
}

open_enum! {
    /// Who writes the delegation contract handed to a subagent.
    ContractAuthor {
        /// The harness declares objective, output schema, tools and bounds at
        /// spawn time.
        Harness => "harness",
        /// The model improvises the contract at runtime.
        Model => "model",
    }
}

/// How far a change reaches. Exploration escalation keys on this, not on the
/// repository's line count.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeLocality {
    /// Number of files the change is expected to span.
    pub files_in_span: u16,
    /// Whether discovery crosses a repository boundary.
    pub cross_repository: bool,
}

impl ChangeLocality {
    pub const fn local(files_in_span: u16) -> Self {
        Self {
            files_in_span,
            cross_repository: false,
        }
    }

    pub const fn cross_repository(files_in_span: u16) -> Self {
        Self {
            files_in_span,
            cross_repository: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionPolicy {
    pub trigger: CompactionTrigger,
    /// Percentage of the usable window at which compaction fires.
    pub trigger_percent: u8,
    pub boundary: CompactionBoundary,
    /// Server-side tool-call cache reads inflate a naive usage sum and fire
    /// compaction early; they stay out of the trigger by default.
    pub count_server_tool_cache_reads: bool,
    #[serde(flatten, default, skip_serializing_if = "is_empty_extra")]
    pub extra: Extra,
}

impl Default for CompactionPolicy {
    fn default() -> Self {
        Self {
            trigger: CompactionTrigger::ConversationalTokenPercent,
            trigger_percent: 80,
            boundary: CompactionBoundary::Message,
            count_server_tool_cache_reads: false,
            extra: Extra::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextProfile {
    pub strategy: ContextStrategy,
    /// Hard switch. `false` forbids subagent context isolation even when a
    /// caller asks for it.
    pub subagent_isolation: bool,
    pub compaction: CompactionPolicy,
    #[serde(flatten, default, skip_serializing_if = "is_empty_extra")]
    pub extra: Extra,
}

impl Default for ContextProfile {
    fn default() -> Self {
        Self {
            strategy: ContextStrategy::KeepLatestAndSummarise,
            subagent_isolation: false,
            compaction: CompactionPolicy::default(),
            extra: Extra::new(),
        }
    }
}

impl ContextProfile {
    /// Isolation requires both the switch and the strategy to ask for it.
    pub fn isolation_enabled(&self) -> bool {
        self.subagent_isolation && self.strategy == ContextStrategy::SubagentIsolation
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorationProfile {
    /// The tool set used before any escalation.
    pub baseline: ExplorationTools,
    /// Escalate to the symbol/call graph once a change spans at least this
    /// many files. `0` never escalates on span.
    pub symbol_graph_file_span: u16,
    /// Escalate for cross-repository discovery, where a grep baseline is
    /// near-zero.
    pub symbol_graph_cross_repository: bool,
    /// An embeddings or BM25 index. Off: it displaces the agent's own, better
    /// search and does not beat a competent grep baseline.
    pub embeddings_index: bool,
    #[serde(flatten, default, skip_serializing_if = "is_empty_extra")]
    pub extra: Extra,
}

impl Default for ExplorationProfile {
    fn default() -> Self {
        Self {
            baseline: ExplorationTools::GrepReadGlob,
            symbol_graph_file_span: 3,
            symbol_graph_cross_repository: true,
            embeddings_index: false,
            extra: Extra::new(),
        }
    }
}

impl ExplorationProfile {
    /// The tool set for one change, keyed on locality rather than repository
    /// size.
    pub fn tools_for(&self, locality: ChangeLocality) -> ExplorationTools {
        if self.baseline != ExplorationTools::GrepReadGlob {
            return self.baseline.clone();
        }
        let span_escalates = self.symbol_graph_file_span != 0
            && locality.files_in_span >= self.symbol_graph_file_span;
        if span_escalates || (self.symbol_graph_cross_repository && locality.cross_repository) {
            ExplorationTools::SymbolGraph
        } else {
            ExplorationTools::GrepReadGlob
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationProfile {
    pub mode: DelegationMode,
    pub contract_author: ContractAuthor,
    /// Spawn depth cap; the spawn tool is withheld at the limit.
    pub max_depth: u8,
    /// Concurrent children; exceeding it fails loudly rather than queueing.
    pub max_concurrency: u8,
    /// Clean-context review is the one evidenced delegation pattern; it is the
    /// first subagent to ship, not decomposition.
    pub clean_context_review: bool,
    #[serde(flatten, default, skip_serializing_if = "is_empty_extra")]
    pub extra: Extra,
}

impl Default for DelegationProfile {
    fn default() -> Self {
        Self {
            mode: DelegationMode::ReadOnly,
            contract_author: ContractAuthor::Harness,
            max_depth: 3,
            max_concurrency: 8,
            clean_context_review: true,
            extra: Extra::new(),
        }
    }
}

impl DelegationProfile {
    pub fn is_enabled(&self) -> bool {
        !matches!(self.mode, DelegationMode::Disabled)
    }

    pub fn permits_writes(&self) -> bool {
        self.mode == DelegationMode::ReadAndWrite
    }

    /// A delegation contract is only trustworthy when the harness authored it.
    pub fn contracts_are_harness_authored(&self) -> bool {
        self.contract_author == ContractAuthor::Harness
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditFormatProfile {
    /// Whether edit-format policy work applies at all. Below the frontier it
    /// moves the number; at the frontier it is close to noise.
    pub policy_applies: bool,
    /// Format, then lint/typecheck, inside the write transaction.
    pub format_then_check: bool,
    /// Split planning from applying the edit. Worth it at the frontier.
    pub editor_subagent_split: bool,
    #[serde(flatten, default, skip_serializing_if = "is_empty_extra")]
    pub extra: Extra,
}

impl Default for EditFormatProfile {
    fn default() -> Self {
        Self {
            policy_applies: true,
            format_then_check: true,
            editor_subagent_split: false,
            extra: Extra::new(),
        }
    }
}

/// A fully resolved strategy for one model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub tier: ModelTier,
    pub context: ContextProfile,
    pub exploration: ExplorationProfile,
    pub delegation: DelegationProfile,
    pub edit_format: EditFormatProfile,
    #[serde(flatten, default, skip_serializing_if = "is_empty_extra")]
    pub extra: Extra,
}

// Written out rather than derived: `open_enum!` generates the enum, and only
// this one has a meaningful default.
#[allow(clippy::derivable_impls)]
impl Default for ModelTier {
    fn default() -> Self {
        Self::Unspecified
    }
}

/// Declare a sparse override layer: every field optional, absent fields never
/// serialized back out, unknown keys preserved in `extra`.
macro_rules! override_struct {
    (
        $(#[$meta:meta])*
        $name:ident { $($(#[$fmeta:meta])* $field:ident: $ty:ty,)+ }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase", default)]
        pub struct $name {
            $(
                $(#[$fmeta])*
                #[serde(skip_serializing_if = "Option::is_none")]
                pub $field: Option<$ty>,
            )+
            #[serde(flatten, skip_serializing_if = "is_empty_extra")]
            pub extra: Extra,
        }
    };
}

override_struct! {
    /// A sparse layer. Absent fields never erase a lower-precedence value.
    AgentProfileOverride {
        context: ContextOverride,
        exploration: ExplorationOverride,
        delegation: DelegationOverride,
        edit_format: EditFormatOverride,
    }
}

override_struct! {
    ContextOverride {
        strategy: ContextStrategy,
        subagent_isolation: bool,
        compaction: CompactionOverride,
    }
}

override_struct! {
    CompactionOverride {
        trigger: CompactionTrigger,
        trigger_percent: u8,
        boundary: CompactionBoundary,
        count_server_tool_cache_reads: bool,
    }
}

override_struct! {
    ExplorationOverride {
        baseline: ExplorationTools,
        /// `Some(0)` disables span escalation; absent leaves it unchanged.
        symbol_graph_file_span: u16,
        symbol_graph_cross_repository: bool,
        embeddings_index: bool,
    }
}

override_struct! {
    DelegationOverride {
        mode: DelegationMode,
        contract_author: ContractAuthor,
        max_depth: u8,
        max_concurrency: u8,
        clean_context_review: bool,
    }
}

override_struct! {
    EditFormatOverride {
        policy_applies: bool,
        format_then_check: bool,
        editor_subagent_split: bool,
    }
}

macro_rules! overlay {
    ($target:expr, $source:expr, $($field:ident),+ $(,)?) => {
        $(if let Some(value) = $source.$field.clone() {
            $target.$field = value;
        })+
        $target.extra.extend($source.extra.iter().map(|(k, v)| (k.clone(), v.clone())));
    };
}

impl AgentProfileOverride {
    /// True when the layer contributes nothing.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    fn apply(&self, target: &mut AgentProfile) {
        if let Some(context) = &self.context {
            context.apply(&mut target.context);
        }
        if let Some(exploration) = &self.exploration {
            overlay!(
                target.exploration,
                exploration,
                baseline,
                symbol_graph_file_span,
                symbol_graph_cross_repository,
                embeddings_index,
            );
        }
        if let Some(delegation) = &self.delegation {
            overlay!(
                target.delegation,
                delegation,
                mode,
                contract_author,
                max_depth,
                max_concurrency,
                clean_context_review,
            );
        }
        if let Some(edit_format) = &self.edit_format {
            overlay!(
                target.edit_format,
                edit_format,
                policy_applies,
                format_then_check,
                editor_subagent_split,
            );
        }
        target
            .extra
            .extend(self.extra.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
}

impl ContextOverride {
    fn apply(&self, target: &mut ContextProfile) {
        if let Some(compaction) = &self.compaction {
            overlay!(
                target.compaction,
                compaction,
                trigger,
                trigger_percent,
                boundary,
                count_server_tool_cache_reads,
            );
        }
        overlay!(target, self, strategy, subagent_isolation);
    }
}

/// Explicit user configuration for agent strategy.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentConfig {
    /// Applies to every model, above the built-in defaults.
    #[serde(skip_serializing_if = "AgentProfileOverride::is_empty")]
    pub default: AgentProfileOverride,
    /// Applies to one model id, above `default`.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub models: BTreeMap<String, AgentProfileOverride>,
    #[serde(flatten, skip_serializing_if = "is_empty_extra")]
    pub extra: Extra,
}

/// One step of the resolution order, recorded in application order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "layer", content = "detail")]
pub enum ProfileLayer {
    /// Built-in conservative baseline.
    GlobalDefault,
    /// Built-in default for the detected tier.
    ModelDefault(ModelTier),
    /// `agent.default` from configuration.
    UserGlobal,
    /// `agent.models[<id>]` from configuration.
    UserModel(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAgentProfile {
    pub model: String,
    pub profile: AgentProfile,
    /// Applied lowest precedence first.
    pub layers: Vec<ProfileLayer>,
}

impl AgentConfig {
    /// Resolve the strategy for one model id.
    ///
    /// Precedence, highest first: `agent.models[model]`, `agent.default`,
    /// built-in per-model default, built-in global default.
    pub fn profile_for(&self, model: &str) -> ResolvedAgentProfile {
        let mut profile = AgentProfile::default();
        let mut layers = vec![ProfileLayer::GlobalDefault];

        let tier = model_tier(model);
        profile.tier = tier.clone();
        let builtin = builtin_tier_override(&tier);
        if !builtin.is_empty() {
            builtin.apply(&mut profile);
            layers.push(ProfileLayer::ModelDefault(tier));
        }

        if !self.default.is_empty() {
            self.default.apply(&mut profile);
            layers.push(ProfileLayer::UserGlobal);
        }

        if let Some(explicit) = self.models.get(model)
            && !explicit.is_empty()
        {
            explicit.apply(&mut profile);
            layers.push(ProfileLayer::UserModel(model.to_owned()));
        }

        ResolvedAgentProfile {
            model: model.to_owned(),
            profile,
            layers,
        }
    }
}

/// Longest-match-first tier detection. Unrecognized ids stay
/// [`ModelTier::Unspecified`] and therefore keep the conservative defaults.
pub fn model_tier(model: &str) -> ModelTier {
    const MID: [&str; 6] = [
        "claude-haiku",
        "claude-3-haiku",
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-4o-mini",
        "gemini-2.5-flash",
    ];
    const OPEN_WEIGHT: [&str; 8] = [
        "deepseek", "qwen", "llama", "mistral", "devstral", "kimi", "glm-", "gpt-oss",
    ];
    const FRONTIER: [&str; 6] = [
        "claude-opus",
        "claude-sonnet",
        "gpt-5",
        "o3",
        "gemini-2.5-pro",
        "gemini-3-pro",
    ];

    let id = model.trim().to_ascii_lowercase();
    let matches = |prefixes: &[&str]| prefixes.iter().any(|prefix| id.starts_with(prefix));
    if matches(&MID) {
        ModelTier::Mid
    } else if matches(&OPEN_WEIGHT) {
        ModelTier::OpenWeight
    } else if matches(&FRONTIER) {
        ModelTier::Frontier
    } else {
        ModelTier::Unspecified
    }
}

/// The built-in per-model default layer. Stated in full rather than by
/// omission so `explain`-style output shows which tier decided what.
pub fn builtin_tier_override(tier: &ModelTier) -> AgentProfileOverride {
    let mut layer = AgentProfileOverride::default();
    match tier {
        ModelTier::Frontier => {
            layer.context = Some(ContextOverride {
                strategy: Some(ContextStrategy::SubagentIsolation),
                subagent_isolation: Some(true),
                ..ContextOverride::default()
            });
            layer.edit_format = Some(EditFormatOverride {
                policy_applies: Some(false),
                editor_subagent_split: Some(true),
                ..EditFormatOverride::default()
            });
        }
        ModelTier::Mid | ModelTier::OpenWeight => {
            layer.context = Some(ContextOverride {
                strategy: Some(ContextStrategy::KeepLatestAndSummarise),
                subagent_isolation: Some(false),
                ..ContextOverride::default()
            });
            layer.edit_format = Some(EditFormatOverride {
                policy_applies: Some(true),
                editor_subagent_split: Some(false),
                ..EditFormatOverride::default()
            });
        }
        _ => {}
    }
    layer
}
