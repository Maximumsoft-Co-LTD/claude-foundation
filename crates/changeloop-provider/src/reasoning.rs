//! Opaque, provider- and account-tagged reasoning state.
//!
//! Reasoning state (Anthropic thinking blocks with signatures, OpenAI reasoning
//! items) is provider-specific, cryptographically bound, and fragile. The same
//! signature-loss bug class has recurred across independent codebases, most
//! often because some *generic* pass — normalisation, cache-control attachment,
//! an SDK-internal prompt filter — dropped or reordered a part it did not
//! understand.
//!
//! The defences here are structural, not conventional:
//!
//! * The raw provider payload ([`RawReasoning`]) is private to this module. No
//!   accessor anywhere yields it by value or by mutable reference.
//! * Exactly two operations are legal on reasoning state:
//!   [`ReasoningDisposition::KeepWhole`] and
//!   [`ReasoningDisposition::StripWholesale`]. There is no partial
//!   transformation, no summarisation, and no reconstruction.
//! * Reasoning state is tagged with the identity that issued it. Encrypted
//!   reasoning is bound at account/deployment level, not merely provider or
//!   model, so all three participate in identity.

use serde::{Deserialize, Serialize};

use crate::ProviderKind;

/// Upper bound on an account fingerprint. Fingerprints are short, non-secret
/// digests; anything larger is a caller error rather than an account.
pub const MAX_REASONING_ACCOUNT_BYTES: usize = 256;

/// The identity a provider binds signed or encrypted reasoning state to.
///
/// `account` is a stable, non-secret fingerprint of the account or deployment
/// that issued the state — never a credential. Two identities are compatible
/// only when equal: a new model, a new provider, or a new account of the same
/// provider all make previously accumulated reasoning state unusable.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ReasoningIdentity {
    pub provider: ProviderKind,
    pub account: String,
    pub model: String,
}

impl ReasoningIdentity {
    pub fn new(
        provider: ProviderKind,
        account: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            provider,
            account: account.into(),
            model: model.into(),
        }
    }

    /// Identity equality is the whole compatibility rule. It is deliberately
    /// not a subtyping or "same family" test: providers do not accept reasoning
    /// state across accounts even when the model name matches.
    #[must_use]
    pub fn is_compatible_with(&self, target: &Self) -> bool {
        self == target
    }

    #[must_use]
    pub fn is_well_formed(&self) -> bool {
        !self.account.is_empty()
            && self.account.len() <= MAX_REASONING_ACCOUNT_BYTES
            && !self.account.chars().any(char::is_control)
            && !self.model.is_empty()
            && !self.model.chars().any(char::is_control)
    }
}

/// Raw provider reasoning bytes.
///
/// Private to this module by construction. The canonical per-provider request
/// builders in [`crate::request`] reach it through crate-private, immutable
/// accessors on [`OpaqueReasoning`]; nothing else in this crate or any other
/// can observe, reorder, or edit it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "snake_case")]
enum RawReasoning {
    Anthropic {
        reasoning_signature: String,
    },
    #[serde(rename = "openai")]
    OpenAi {
        response_id: String,
        reasoning_item_ids: Vec<String>,
    },
}

/// The complete set of legal operations on reasoning state.
///
/// This enum is exhaustive on purpose: adding a third disposition would fail to
/// compile against [`OpaqueReasoning::apply`], which matches without a
/// wildcard arm.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningDisposition {
    /// Forward the state byte-for-byte, in its original position.
    KeepWhole,
    /// Remove the state entirely. Never a partial edit.
    StripWholesale,
}

/// Every legal operation, enumerated. A test pins the count so that widening
/// the operation set is a deliberate, reviewed act.
pub const LEGAL_REASONING_OPERATIONS: [ReasoningDisposition; 2] = [
    ReasoningDisposition::KeepWhole,
    ReasoningDisposition::StripWholesale,
];

/// Opaque reasoning state tagged with its issuing identity.
///
/// Constructible only from a complete provider payload, readable only as a
/// whole, and disposable only as a whole. There is no method on this type that
/// returns `&mut` anything.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpaqueReasoning {
    identity: ReasoningIdentity,
    raw: RawReasoning,
}

impl OpaqueReasoning {
    /// Records Anthropic reasoning state as issued by `identity`.
    #[must_use]
    pub fn anthropic(identity: ReasoningIdentity, reasoning_signature: impl Into<String>) -> Self {
        Self {
            identity,
            raw: RawReasoning::Anthropic {
                reasoning_signature: reasoning_signature.into(),
            },
        }
    }

    /// Records OpenAI reasoning state as issued by `identity`.
    #[must_use]
    pub fn openai(
        identity: ReasoningIdentity,
        response_id: impl Into<String>,
        reasoning_item_ids: Vec<String>,
    ) -> Self {
        Self {
            identity,
            raw: RawReasoning::OpenAi {
                response_id: response_id.into(),
                reasoning_item_ids,
            },
        }
    }

    #[must_use]
    pub fn identity(&self) -> &ReasoningIdentity {
        &self.identity
    }

    /// The reasoning-identity gate for a single piece of state.
    #[must_use]
    pub fn disposition_for(&self, target: &ReasoningIdentity) -> ReasoningDisposition {
        if self.identity.is_compatible_with(target) {
            ReasoningDisposition::KeepWhole
        } else {
            ReasoningDisposition::StripWholesale
        }
    }

    /// Applies one of the two legal operations. `KeepWhole` returns the state
    /// unchanged; `StripWholesale` destroys it. There is no third outcome and
    /// no way to return a modified copy.
    #[must_use]
    pub fn apply(self, disposition: ReasoningDisposition) -> Option<Self> {
        match disposition {
            ReasoningDisposition::KeepWhole => Some(self),
            ReasoningDisposition::StripWholesale => None,
        }
    }

    /// Crate-private, immutable, and provider-shaped. Only the canonical
    /// request builders in [`crate::request`] call this.
    pub(crate) fn anthropic_signature(&self) -> Option<&str> {
        match &self.raw {
            RawReasoning::Anthropic {
                reasoning_signature,
            } => Some(reasoning_signature),
            RawReasoning::OpenAi { .. } => None,
        }
    }

    /// Crate-private, immutable. Only the canonical request builders call this.
    pub(crate) fn openai_response_id(&self) -> Option<&str> {
        match &self.raw {
            RawReasoning::OpenAi { response_id, .. } => Some(response_id),
            RawReasoning::Anthropic { .. } => None,
        }
    }
}

/// A reasoning part: signed or encrypted state plus the text the provider
/// signed alongside it.
///
/// The text is inside the signature envelope for Anthropic, so it is as
/// immutable as the state itself. Both fields are private and exposed only by
/// shared reference.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReasoningPart {
    text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay: Option<OpaqueReasoning>,
}

impl ReasoningPart {
    #[must_use]
    pub fn new(text: impl Into<String>, replay: Option<OpaqueReasoning>) -> Self {
        Self {
            text: text.into(),
            replay,
        }
    }

    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    #[must_use]
    pub fn replay(&self) -> Option<&OpaqueReasoning> {
        self.replay.as_ref()
    }

    #[must_use]
    pub fn identity(&self) -> Option<&ReasoningIdentity> {
        self.replay.as_ref().map(OpaqueReasoning::identity)
    }

    /// The part-level gate. A part carrying no provider state is inert and is
    /// always kept: there is nothing bound to an identity to invalidate.
    #[must_use]
    pub fn disposition_for(&self, target: &ReasoningIdentity) -> ReasoningDisposition {
        self.replay
            .as_ref()
            .map_or(ReasoningDisposition::KeepWhole, |reasoning| {
                reasoning.disposition_for(target)
            })
    }
}

/// Result of running the reasoning-identity gate over a message list.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReasoningIdentityOutcome {
    /// Reasoning parts removed because their identity did not match the target.
    pub stripped_parts: usize,
    /// Assistant messages that lost at least one reasoning part.
    pub stripped_messages: usize,
}

impl ReasoningIdentityOutcome {
    /// True when the accumulated session was already compatible with the
    /// target and nothing had to be discarded.
    #[must_use]
    pub fn is_compatible(&self) -> bool {
        self.stripped_parts == 0
    }
}
