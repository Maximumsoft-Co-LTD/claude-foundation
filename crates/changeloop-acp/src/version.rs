//! ACP protocol version negotiation.
//!
//! One version is chosen at `initialize` and that version is the only one the
//! connection speaks for its whole life. Everything in this module exists to
//! make "no silent mixing" a property the type system carries rather than a
//! convention the dispatcher is trusted to follow:
//!
//! - a connection is [`ProtocolState::Uninitialized`] until `initialize` lands,
//!   and every other method is refused until then;
//! - a second `initialize` is refused rather than silently re-negotiating;
//! - a later message that names a version other than the negotiated one is
//!   refused rather than being handled at whichever version it claims.
//!
//! There is deliberately no conversion between versions. ACP's maintainers
//! built a general v1/v2 conversion layer, shipped it, and deleted it: the
//! translation needs session-scoped state a schema-level converter cannot hold,
//! and a general converter therefore has to invent unrepresentable states.

use thiserror::Error;

/// Versions of ACP this facade can speak, ascending.
pub const SUPPORTED_PROTOCOL_VERSIONS: &[u16] = &[0, 1];

/// The version offered when a client asks for something newer.
#[must_use]
pub fn latest_supported_version() -> u16 {
    SUPPORTED_PROTOCOL_VERSIONS
        .iter()
        .copied()
        .max()
        .unwrap_or(0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Negotiated {
    pub version: u16,
    /// True when the client asked for a newer version than this build speaks
    /// and was answered with the newest one available. The client decides
    /// whether to proceed; the agent does not guess on its behalf.
    pub downgraded: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
pub enum VersionError {
    #[error(
        "requested ACP protocol version {requested} predates every supported version; \
         the oldest supported version is {oldest}"
    )]
    TooOld { requested: u16, oldest: u16 },
}

/// Choose exactly one protocol version for a connection.
///
/// An exactly-supported request is honoured. A newer request is answered with
/// the newest supported version, flagged as a downgrade. A request older than
/// anything supported fails, because answering it with a newer version would be
/// precisely the silent mixing this facade refuses.
pub fn negotiate_version(requested: u16, supported: &[u16]) -> Result<Negotiated, VersionError> {
    let oldest = supported.iter().copied().min().unwrap_or(0);
    let newest = supported.iter().copied().max().unwrap_or(0);
    if supported.contains(&requested) {
        return Ok(Negotiated {
            version: requested,
            downgraded: false,
        });
    }
    if requested < oldest {
        return Err(VersionError::TooOld { requested, oldest });
    }
    // Newer than anything known, or a gap inside the supported range: answer
    // with the newest version at or below the request.
    let version = supported
        .iter()
        .copied()
        .filter(|candidate| *candidate <= requested)
        .max()
        .unwrap_or(newest);
    Ok(Negotiated {
        version,
        downgraded: true,
    })
}

/// Whether a connection has negotiated, and at which version.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ProtocolState {
    #[default]
    Uninitialized,
    Initialized {
        version: u16,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
pub enum ProtocolStateError {
    #[error("`initialize` must be the first request on a connection")]
    NotInitialized,
    #[error(
        "this connection already negotiated ACP version {negotiated}; re-initializing would mix versions"
    )]
    AlreadyInitialized { negotiated: u16 },
    #[error("message names ACP version {named} on a connection negotiated at {negotiated}")]
    VersionMismatch { negotiated: u16, named: u16 },
}

impl ProtocolState {
    /// Record the negotiated version, refusing a second negotiation.
    pub fn initialize(&mut self, version: u16) -> Result<(), ProtocolStateError> {
        match *self {
            Self::Uninitialized => {
                *self = Self::Initialized { version };
                Ok(())
            }
            Self::Initialized {
                version: negotiated,
            } => Err(ProtocolStateError::AlreadyInitialized { negotiated }),
        }
    }

    /// The negotiated version, or a refusal if nothing was negotiated yet.
    pub fn require(&self) -> Result<u16, ProtocolStateError> {
        match *self {
            Self::Uninitialized => Err(ProtocolStateError::NotInitialized),
            Self::Initialized { version } => Ok(version),
        }
    }

    /// Refuse a message that names a version other than the negotiated one.
    /// A message that names no version is fine: it inherits the negotiation.
    pub fn require_matching(&self, named: Option<u16>) -> Result<u16, ProtocolStateError> {
        let negotiated = self.require()?;
        match named {
            Some(named) if named != negotiated => {
                Err(ProtocolStateError::VersionMismatch { negotiated, named })
            }
            _ => Ok(negotiated),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_exactly_supported_version_is_honoured_unchanged() {
        for requested in SUPPORTED_PROTOCOL_VERSIONS.iter().copied() {
            assert_eq!(
                negotiate_version(requested, SUPPORTED_PROTOCOL_VERSIONS),
                Ok(Negotiated {
                    version: requested,
                    downgraded: false
                })
            );
        }
    }

    #[test]
    fn a_newer_request_is_answered_with_the_newest_supported_version() {
        assert_eq!(
            negotiate_version(99, SUPPORTED_PROTOCOL_VERSIONS),
            Ok(Negotiated {
                version: latest_supported_version(),
                downgraded: true
            })
        );
    }

    #[test]
    fn a_version_older_than_anything_supported_is_refused_not_upgraded() {
        assert_eq!(
            negotiate_version(2, &[3, 4]),
            Err(VersionError::TooOld {
                requested: 2,
                oldest: 3
            })
        );
    }

    #[test]
    fn a_gap_inside_the_supported_range_resolves_downward_never_upward() {
        assert_eq!(
            negotiate_version(3, &[1, 2, 5]),
            Ok(Negotiated {
                version: 2,
                downgraded: true
            })
        );
    }

    #[test]
    fn a_connection_negotiates_once_and_refuses_to_mix() {
        let mut state = ProtocolState::default();
        assert_eq!(state.require(), Err(ProtocolStateError::NotInitialized));
        state.initialize(1).expect("first negotiation");
        assert_eq!(state.require(), Ok(1));
        assert_eq!(
            state.initialize(0),
            Err(ProtocolStateError::AlreadyInitialized { negotiated: 1 })
        );
        assert_eq!(state.require(), Ok(1), "a refused re-init must not mutate");
        assert_eq!(state.require_matching(Some(1)), Ok(1));
        assert_eq!(state.require_matching(None), Ok(1));
        assert_eq!(
            state.require_matching(Some(0)),
            Err(ProtocolStateError::VersionMismatch {
                negotiated: 1,
                named: 0
            })
        );
    }
}
