//! A deterministic [`TurnDriver`] for tests and for smoke-testing a wiring.
//!
//! It replays a fixed script of steps, so a test can prove a protocol property
//! — streaming, correlation, suspension, cancellation — without a model, a
//! network, or a clock.

use changeloop_protocol::{MessagePart, SessionId};

use crate::connection::{TurnDriver, TurnStep};
use crate::schema::{PermissionOutcome, StopReason};

/// Replays `script` one step per call, then finishes.
pub struct ScriptedDriver {
    script: Vec<TurnStep>,
    cursor: usize,
    /// Every prompt this driver was handed, in order.
    pub prompts: Vec<Vec<MessagePart>>,
    /// Every permission outcome that resumed a suspended turn, in order.
    pub resumptions: Vec<PermissionOutcome>,
    /// What to return once the script is exhausted.
    pub exhausted: StopReason,
}

impl ScriptedDriver {
    #[must_use]
    pub fn new(script: Vec<TurnStep>) -> Self {
        Self {
            script,
            cursor: 0,
            prompts: Vec::new(),
            resumptions: Vec::new(),
            exhausted: StopReason::EndTurn,
        }
    }
}

impl TurnDriver for ScriptedDriver {
    fn begin(&mut self, _session_id: &SessionId, prompt: &[MessagePart]) {
        // A new turn continues the same script, so a multi-turn test scripts
        // both turns in sequence rather than re-arming the driver.
        self.prompts.push(prompt.to_vec());
    }

    fn next_step(&mut self, resumed: Option<PermissionOutcome>) -> TurnStep {
        if let Some(outcome) = resumed {
            self.resumptions.push(outcome);
        }
        match self.script.get(self.cursor) {
            Some(step) => {
                self.cursor += 1;
                step.clone()
            }
            None => TurnStep::Finish(self.exhausted),
        }
    }
}
