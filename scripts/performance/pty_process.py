"""Bounded child cleanup shared by the PTY performance probes."""

from __future__ import annotations

import os
import re
import signal
import time


ANSI_CONTROL = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")


def visible_terminal_output(output: bytes | bytearray) -> bytes:
    """Remove CSI control sequences while preserving emitted visible text."""
    return ANSI_CONTROL.sub(b"", output)


def _poll_until(pid: int, deadline: float) -> int | None:
    """Return an exit status when reaped, or None when the deadline expires."""
    while True:
        try:
            waited, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            # Another wait site already reaped the child. Treat this as a
            # terminal failure status rather than ever falling back to a
            # blocking wait.
            return 255
        if waited:
            return os.waitstatus_to_exitcode(status)
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.01)


def terminate_and_reap(
    pid: int,
    *,
    terminate_grace_seconds: float = 1.0,
    kill_grace_seconds: float = 1.0,
) -> int:
    """Terminate and reap a child without an unbounded waitpid call."""
    status = _poll_until(pid, time.monotonic())
    if status is not None:
        return status

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    status = _poll_until(pid, time.monotonic() + terminate_grace_seconds)
    if status is not None:
        return status

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    status = _poll_until(pid, time.monotonic() + kill_grace_seconds)
    if status is not None:
        return status

    raise TimeoutError(f"child {pid} did not exit after SIGTERM and SIGKILL")
