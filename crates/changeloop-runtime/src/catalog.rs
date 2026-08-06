//! Deterministic tool-catalogue exposure.
//!
//! Tool definitions are billed on every request before any work happens, and a
//! large catalogue costs accuracy as well as tokens. This module measures the
//! catalogue, defers full JSON schemas to compact stubs once the measured
//! budget is exceeded, and caps the number of concurrently exposed tools.
//!
//! Two invariants hold:
//!
//! - Exposure is a *presentation* decision. Invocation always resolves the full
//!   definition through [`resolve_definition`], so a deferred schema never
//!   changes what a tool accepts or how it is dispatched.
//! - Every reduction is reported. Deferral and truncation both produce
//!   warnings, so a catalogue is never silently trimmed.

use std::collections::BTreeSet;

use changeloop_provider::ToolDefinition;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Serialized definition bytes treated as one model token. The workspace ships
/// no tokenizer, so the budget is a byte-derived estimate; `bytes` is always
/// reported alongside it so the measurement stays checkable.
pub const ESTIMATED_BYTES_PER_TOKEN: usize = 4;

/// Measured definition budget past which full schemas are deferred to stubs.
pub const DEFAULT_DEFINITION_BUDGET_TOKENS: usize = 10_000;

/// Hard cap on concurrently exposed tools. Selection accuracy degrades from
/// roughly 30-50 active tools, so the default sits at the top of that band and
/// remains configurable.
pub const DEFAULT_MAX_EXPOSED_TOOLS: usize = 40;

/// Characters of description retained by a stub.
pub const DEFAULT_STUB_DESCRIPTION_CHARS: usize = 160;

/// The catalogue costs more than the configured budget at full fidelity.
pub const WARNING_BUDGET_EXCEEDED: &str = "tool_catalog_budget_exceeded";

/// The tool cap bound and some tools were withheld from this request.
pub const WARNING_TRUNCATED: &str = "tool_catalog_truncated";

/// Stubs were substituted and the request still exceeds the budget.
pub const WARNING_BUDGET_EXCEEDED_AFTER_DEFERRAL: &str =
    "tool_catalog_budget_exceeded_after_deferral";

const MAX_REPORTED_DROPPED_NAMES: usize = 8;

/// Host-configurable exposure policy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ToolCatalogPolicy {
    /// Estimated definition tokens past which full schemas are deferred.
    pub definition_budget_tokens: usize,
    /// Maximum concurrently exposed tools. `0` disables the cap.
    pub max_exposed_tools: usize,
    /// Characters of description a stub retains.
    pub stub_description_chars: usize,
    /// Tools the cap must never drop, whatever their declaration position.
    pub pinned_tools: BTreeSet<String>,
}

impl Default for ToolCatalogPolicy {
    fn default() -> Self {
        Self {
            definition_budget_tokens: DEFAULT_DEFINITION_BUDGET_TOKENS,
            max_exposed_tools: DEFAULT_MAX_EXPOSED_TOOLS,
            stub_description_chars: DEFAULT_STUB_DESCRIPTION_CHARS,
            pinned_tools: BTreeSet::new(),
        }
    }
}

/// Measured cost of a set of tool definitions.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCatalogBudget {
    pub tools: usize,
    pub bytes: usize,
    pub estimated_tokens: usize,
}

/// Whether the request carries full schemas or deferred stubs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchemaExposure {
    Full,
    Deferred,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCatalogWarning {
    pub code: String,
    pub message: String,
}

/// Explainable account of what the catalogue cost and what was withheld.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCatalogReport {
    pub policy: ToolCatalogPolicy,
    /// Cost of the whole catalogue with every schema in full.
    pub full: ToolCatalogBudget,
    /// Cost of what the request actually carries.
    pub exposed: ToolCatalogBudget,
    pub schema_exposure: SchemaExposure,
    /// Tools the cap withheld, in the order the selection rule dropped them.
    pub dropped_tools: Vec<String>,
    pub warnings: Vec<ToolCatalogWarning>,
}

impl ToolCatalogReport {
    #[must_use]
    pub fn truncated(&self) -> bool {
        !self.dropped_tools.is_empty()
    }

    #[must_use]
    pub fn deferred(&self) -> bool {
        self.schema_exposure == SchemaExposure::Deferred
    }

    #[must_use]
    pub fn within_budget(&self) -> bool {
        self.exposed.estimated_tokens <= self.policy.definition_budget_tokens
    }
}

/// The definitions to expose plus the account of how they were chosen.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolCatalogPlan {
    pub exposed: Vec<ToolDefinition>,
    pub report: ToolCatalogReport,
}

/// Serialized wire cost of one definition. Only the fields a provider receives
/// are counted; `mutating` is runtime-local and never leaves the process.
#[must_use]
pub fn definition_bytes(definition: &ToolDefinition) -> usize {
    serde_json::to_vec(&json!({
        "name": definition.name,
        "description": definition.description,
        "input_schema": definition.input_schema,
    }))
    .map_or(0, |bytes| bytes.len())
}

/// Measures a definition set. This is the number every other decision keys off.
#[must_use]
pub fn measure(definitions: &[ToolDefinition]) -> ToolCatalogBudget {
    let bytes = definitions.iter().map(definition_bytes).sum::<usize>();
    ToolCatalogBudget {
        tools: definitions.len(),
        bytes,
        estimated_tokens: bytes.div_ceil(ESTIMATED_BYTES_PER_TOKEN),
    }
}

/// Resolves the full definition for an invoked or explicitly looked-up tool.
/// Deferred exposure never reaches this path.
#[must_use]
pub fn resolve_definition<'a>(
    definitions: &'a [ToolDefinition],
    name: &str,
) -> Option<&'a ToolDefinition> {
    definitions
        .iter()
        .find(|definition| definition.name == name)
}

/// Borrowed view over a dispatcher's full catalogue.
pub struct ToolCatalog<'a> {
    policy: &'a ToolCatalogPolicy,
    definitions: &'a [ToolDefinition],
}

impl<'a> ToolCatalog<'a> {
    #[must_use]
    pub fn new(policy: &'a ToolCatalogPolicy, definitions: &'a [ToolDefinition]) -> Self {
        Self {
            policy,
            definitions,
        }
    }

    /// Cost of the whole catalogue at full fidelity.
    #[must_use]
    pub fn budget(&self) -> ToolCatalogBudget {
        measure(self.definitions)
    }

    /// Full schema for one tool, regardless of how it is exposed.
    #[must_use]
    pub fn resolve(&self, name: &str) -> Option<&'a ToolDefinition> {
        resolve_definition(self.definitions, name)
    }

    /// Applies the cap, then the deferral threshold.
    ///
    /// The cap is deterministic: pinned tools first, then every other tool in
    /// dispatcher declaration order, truncated at the cap. Declaration index is
    /// unique, so the ordering admits no ties and the same catalogue always
    /// yields the same exposure.
    #[must_use]
    pub fn plan(&self) -> ToolCatalogPlan {
        let full = measure(self.definitions);
        let mut warnings = Vec::new();

        let mut order: Vec<usize> = (0..self.definitions.len()).collect();
        order.sort_by_key(|&index| {
            (
                !self
                    .policy
                    .pinned_tools
                    .contains(&self.definitions[index].name),
                index,
            )
        });

        let cap = if self.policy.max_exposed_tools == 0 {
            order.len()
        } else {
            self.policy.max_exposed_tools
        };
        let dropped_tools: Vec<String> = order
            .iter()
            .skip(cap)
            .map(|&index| self.definitions[index].name.clone())
            .collect();
        let mut kept: Vec<usize> = order.into_iter().take(cap).collect();
        kept.sort_unstable();
        let selected: Vec<ToolDefinition> = kept
            .into_iter()
            .map(|index| self.definitions[index].clone())
            .collect();

        if !dropped_tools.is_empty() {
            warnings.push(ToolCatalogWarning {
                code: WARNING_TRUNCATED.into(),
                message: format!(
                    "tool cap of {cap} bound: {} of {} tools withheld ({}); selection kept pinned tools then declaration order",
                    dropped_tools.len(),
                    full.tools,
                    summarize_names(&dropped_tools),
                ),
            });
        }

        let selected_budget = measure(&selected);
        if full.estimated_tokens > self.policy.definition_budget_tokens {
            warnings.push(ToolCatalogWarning {
                code: WARNING_BUDGET_EXCEEDED.into(),
                message: format!(
                    "tool definitions cost ~{} tokens ({} bytes across {} tools), over the {} token budget",
                    full.estimated_tokens,
                    full.bytes,
                    full.tools,
                    self.policy.definition_budget_tokens,
                ),
            });
        }

        let (schema_exposure, exposed) =
            if selected_budget.estimated_tokens > self.policy.definition_budget_tokens {
                let stubs = selected
                    .iter()
                    .map(|definition| stub(definition, self.policy.stub_description_chars))
                    .collect();
                (SchemaExposure::Deferred, stubs)
            } else {
                (SchemaExposure::Full, selected)
            };

        let exposed_budget = measure(&exposed);
        if exposed_budget.estimated_tokens > self.policy.definition_budget_tokens {
            warnings.push(ToolCatalogWarning {
                code: WARNING_BUDGET_EXCEEDED_AFTER_DEFERRAL.into(),
                message: format!(
                    "deferred tool definitions still cost ~{} tokens, over the {} token budget; lower max_exposed_tools or remove tool sources",
                    exposed_budget.estimated_tokens, self.policy.definition_budget_tokens,
                ),
            });
        }

        ToolCatalogPlan {
            exposed,
            report: ToolCatalogReport {
                policy: self.policy.clone(),
                full,
                exposed: exposed_budget,
                schema_exposure,
                dropped_tools,
                warnings,
            },
        }
    }
}

/// A compact stand-in: name, shortened description, and a permissive schema.
/// The real schema is resolved when the tool is invoked or looked up.
fn stub(definition: &ToolDefinition, description_chars: usize) -> ToolDefinition {
    ToolDefinition {
        name: definition.name.clone(),
        description: truncate_chars(&definition.description, description_chars),
        input_schema: deferred_schema(),
        mutating: definition.mutating,
    }
}

fn deferred_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": true,
        "description": "Deferred schema. The full input schema is resolved when this tool is invoked."
    })
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if limit == 0 {
        return String::new();
    }
    let mut truncated: String = text.chars().take(limit).collect();
    if truncated.chars().count() < text.chars().count() {
        truncated.push('…');
    }
    truncated
}

fn summarize_names(names: &[String]) -> String {
    if names.len() <= MAX_REPORTED_DROPPED_NAMES {
        return names.join(", ");
    }
    format!(
        "{}, and {} more",
        names[..MAX_REPORTED_DROPPED_NAMES].join(", "),
        names.len() - MAX_REPORTED_DROPPED_NAMES
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition(name: &str, schema_padding: usize) -> ToolDefinition {
        ToolDefinition {
            name: name.into(),
            description: format!("description for {name}"),
            input_schema: json!({
                "type": "object",
                "properties": {"value": {"type": "string", "description": "x".repeat(schema_padding)}},
                "required": ["value"],
            }),
            mutating: false,
        }
    }

    fn catalogue(count: usize, schema_padding: usize) -> Vec<ToolDefinition> {
        (0..count)
            .map(|index| definition(&format!("tool_{index:03}"), schema_padding))
            .collect()
    }

    #[test]
    fn budget_counts_wire_bytes_and_derives_tokens() {
        let definitions = catalogue(3, 0);
        let budget = measure(&definitions);
        let expected_bytes: usize = definitions.iter().map(definition_bytes).sum();

        assert_eq!(budget.tools, 3);
        assert_eq!(budget.bytes, expected_bytes);
        assert_eq!(
            budget.estimated_tokens,
            expected_bytes.div_ceil(ESTIMATED_BYTES_PER_TOKEN)
        );
        assert_eq!(measure(&[]), ToolCatalogBudget::default());
    }

    #[test]
    fn budget_ignores_runtime_local_mutating_flag() {
        let mut mutating = definition("tool", 0);
        mutating.mutating = true;
        assert_eq!(
            definition_bytes(&definition("tool", 0)),
            definition_bytes(&mutating)
        );
    }

    #[test]
    fn small_catalogue_is_exposed_in_full() {
        let definitions = catalogue(4, 0);
        let policy = ToolCatalogPolicy::default();
        let plan = ToolCatalog::new(&policy, &definitions).plan();

        assert_eq!(plan.report.schema_exposure, SchemaExposure::Full);
        assert_eq!(plan.exposed, definitions);
        assert!(plan.report.warnings.is_empty());
        assert!(plan.report.within_budget());
        assert!(!plan.report.truncated());
    }

    #[test]
    fn stub_mode_engages_past_the_definition_budget() {
        let definitions = catalogue(20, 4_096);
        let policy = ToolCatalogPolicy::default();
        let plan = ToolCatalog::new(&policy, &definitions).plan();

        assert!(plan.report.full.estimated_tokens > policy.definition_budget_tokens);
        assert_eq!(plan.report.schema_exposure, SchemaExposure::Deferred);
        assert_eq!(plan.exposed.len(), definitions.len());
        assert!(
            plan.exposed
                .iter()
                .all(|tool| tool.input_schema == deferred_schema())
        );
        assert!(plan.report.exposed.estimated_tokens < plan.report.full.estimated_tokens / 4);
        assert!(
            plan.report
                .warnings
                .iter()
                .any(|warning| warning.code == WARNING_BUDGET_EXCEEDED)
        );
    }

    #[test]
    fn stub_preserves_identity_and_shortens_description() {
        let mut definitions = catalogue(20, 4_096);
        definitions[0].description = "d".repeat(1_000);
        let policy = ToolCatalogPolicy::default();
        let plan = ToolCatalog::new(&policy, &definitions).plan();

        assert_eq!(plan.exposed[0].name, definitions[0].name);
        assert_eq!(
            plan.exposed[0].description.chars().count(),
            policy.stub_description_chars + 1
        );
        assert_eq!(plan.exposed[0].mutating, definitions[0].mutating);
    }

    #[test]
    fn full_schema_resolves_for_a_deferred_tool() {
        let definitions = catalogue(20, 4_096);
        let policy = ToolCatalogPolicy::default();
        let catalog = ToolCatalog::new(&policy, &definitions);
        let plan = catalog.plan();

        assert_eq!(plan.report.schema_exposure, SchemaExposure::Deferred);
        assert_ne!(plan.exposed[7].input_schema, definitions[7].input_schema);
        assert_eq!(
            catalog.resolve("tool_007").map(|tool| &tool.input_schema),
            Some(&definitions[7].input_schema)
        );
        assert_eq!(
            resolve_definition(&definitions, "tool_007"),
            Some(&definitions[7])
        );
        assert!(catalog.resolve("absent").is_none());
    }

    #[test]
    fn cap_binds_deterministically_in_declaration_order() {
        let definitions = catalogue(60, 0);
        let policy = ToolCatalogPolicy::default();
        let plan = ToolCatalog::new(&policy, &definitions).plan();
        let again = ToolCatalog::new(&policy, &definitions).plan();

        assert_eq!(plan.exposed.len(), DEFAULT_MAX_EXPOSED_TOOLS);
        assert_eq!(
            plan.exposed
                .iter()
                .map(|tool| &tool.name)
                .collect::<Vec<_>>(),
            definitions[..DEFAULT_MAX_EXPOSED_TOOLS]
                .iter()
                .map(|tool| &tool.name)
                .collect::<Vec<_>>()
        );
        assert_eq!(plan, again);
    }

    #[test]
    fn cap_keeps_pinned_tools_and_preserves_declaration_order() {
        let definitions = catalogue(60, 0);
        let policy = ToolCatalogPolicy {
            max_exposed_tools: 3,
            pinned_tools: BTreeSet::from(["tool_059".to_owned(), "tool_042".to_owned()]),
            ..ToolCatalogPolicy::default()
        };
        let plan = ToolCatalog::new(&policy, &definitions).plan();

        let names: Vec<&str> = plan.exposed.iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(names, vec!["tool_000", "tool_042", "tool_059"]);
        assert_eq!(plan.report.dropped_tools.len(), 57);
        assert_eq!(plan.report.dropped_tools[0], "tool_001");
    }

    #[test]
    fn truncation_is_reported_never_silent() {
        let definitions = catalogue(60, 0);
        let policy = ToolCatalogPolicy::default();
        let plan = ToolCatalog::new(&policy, &definitions).plan();

        assert!(plan.report.truncated());
        assert_eq!(
            plan.report.dropped_tools.len(),
            definitions.len() - DEFAULT_MAX_EXPOSED_TOOLS
        );
        let warning = plan
            .report
            .warnings
            .iter()
            .find(|warning| warning.code == WARNING_TRUNCATED)
            .expect("truncation warning");
        assert!(warning.message.contains("20 of 60 tools withheld"));
        assert!(warning.message.contains("and 12 more"));
    }

    #[test]
    fn zero_cap_disables_truncation() {
        let definitions = catalogue(60, 0);
        let policy = ToolCatalogPolicy {
            max_exposed_tools: 0,
            ..ToolCatalogPolicy::default()
        };
        let plan = ToolCatalog::new(&policy, &definitions).plan();

        assert_eq!(plan.exposed.len(), 60);
        assert!(!plan.report.truncated());
    }

    #[test]
    fn deferral_that_cannot_reach_budget_warns_again() {
        let definitions = catalogue(4_000, 0);
        let policy = ToolCatalogPolicy {
            max_exposed_tools: 0,
            ..ToolCatalogPolicy::default()
        };
        let plan = ToolCatalog::new(&policy, &definitions).plan();

        assert_eq!(plan.report.schema_exposure, SchemaExposure::Deferred);
        assert!(!plan.report.within_budget());
        assert!(
            plan.report
                .warnings
                .iter()
                .any(|warning| warning.code == WARNING_BUDGET_EXCEEDED_AFTER_DEFERRAL)
        );
    }
}
