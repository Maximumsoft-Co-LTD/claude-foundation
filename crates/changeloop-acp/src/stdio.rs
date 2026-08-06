//! Newline-delimited JSON framing over a pair of streams.
//!
//! ACP agents are spawned as subprocesses and driven over stdin/stdout, which
//! makes one constraint absolute: **nothing but protocol messages may reach the
//! output stream.** Every diagnostic belongs on stderr. This module therefore
//! writes only frames produced by [`Connection`], and returns I/O errors to the
//! caller instead of printing anything itself.
//!
//! A line that cannot be parsed produces a JSON-RPC error frame and the loop
//! continues; only an I/O failure or end of input stops it. A single malformed
//! line from a buggy client must not take the agent down.

use std::io::{BufRead, Write};

use crate::connection::{AgentConfig, Connection, TurnDriver};

/// How the loop ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServeOutcome {
    /// The peer closed its side of the stream.
    ///
    /// Disconnection is deliberately *not* treated as cancellation: ACP requires
    /// an explicit signal for that, and the caller decides what a lost client
    /// means for in-flight work.
    PeerClosed,
}

/// Run one ACP connection to completion over `input` and `output`.
pub fn serve<D: TurnDriver, R: BufRead, W: Write>(
    connection: &mut Connection<D>,
    input: R,
    output: &mut W,
) -> std::io::Result<ServeOutcome> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        for frame in connection.handle_line(&line) {
            output.write_all(frame.to_line().as_bytes())?;
            output.write_all(b"\n")?;
        }
        output.flush()?;
    }
    Ok(ServeOutcome::PeerClosed)
}

/// Serve one ACP connection on this process's stdin and stdout.
///
/// The single entry point a CLI subcommand needs. Callers must not write
/// anything else to stdout for the life of this call: on an ACP stdio
/// transport, stdout carries protocol messages and nothing else, which leaves
/// stderr as the only safe logging channel.
pub fn serve_stdio<D: TurnDriver>(driver: D, config: AgentConfig) -> std::io::Result<ServeOutcome> {
    let mut connection = Connection::new(driver, config);
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    serve(&mut connection, stdin.lock(), &mut output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::IdSource;
    use crate::testing::ScriptedDriver;

    #[test]
    fn a_malformed_line_does_not_stop_the_loop() {
        let mut connection = Connection::new(
            ScriptedDriver::new(Vec::new()),
            AgentConfig {
                id_source: IdSource::Sequential { prefix: "t".into() },
                ..AgentConfig::default()
            },
        );
        let input = concat!(
            "not json\n",
            "\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":1}}\n"
        );
        let mut output = Vec::new();
        let outcome = serve(&mut connection, input.as_bytes(), &mut output).expect("serve");
        assert_eq!(outcome, ServeOutcome::PeerClosed);
        let lines: Vec<&str> = std::str::from_utf8(&output)
            .expect("utf8")
            .lines()
            .filter(|line| !line.is_empty())
            .collect();
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(lines[0].contains("-32700"), "{}", lines[0]);
        assert!(lines[1].contains("\"protocolVersion\":1"), "{}", lines[1]);
        assert_eq!(connection.negotiated_version(), Some(1));
    }
}
