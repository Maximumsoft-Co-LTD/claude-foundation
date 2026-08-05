#!/usr/bin/env python3
"""Regression tests for bounded PTY child cleanup."""

import os
import signal
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "performance"))

from pty_process import terminate_and_reap, visible_terminal_output  # noqa: E402


def child_with_ready_pipe(*, ignore_sigterm: bool) -> int:
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        if ignore_sigterm:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
        os.write(write_fd, b"1")
        os.close(write_fd)
        while True:
            signal.pause()
    os.close(write_fd)
    assert os.read(read_fd, 1) == b"1"
    os.close(read_fd)
    return pid


class TerminateAndReapTests(unittest.TestCase):
    def assert_no_survivor(self, pid: int) -> None:
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_reaps_child_that_accepts_sigterm(self) -> None:
        pid = child_with_ready_pipe(ignore_sigterm=False)
        status = terminate_and_reap(
            pid, terminate_grace_seconds=0.2, kill_grace_seconds=0.2
        )
        self.assertEqual(status, -signal.SIGTERM)
        self.assert_no_survivor(pid)

    def test_escalates_and_reaps_child_that_ignores_sigterm(self) -> None:
        pid = child_with_ready_pipe(ignore_sigterm=True)
        started = time.monotonic()
        status = terminate_and_reap(
            pid, terminate_grace_seconds=0.05, kill_grace_seconds=0.2
        )
        self.assertEqual(status, -signal.SIGKILL)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assert_no_survivor(pid)

    def test_visible_output_strips_cursor_positioning_inside_words(self) -> None:
        output = b"background\x1b[37;13Hop\x1b[37;16Hration running"
        self.assertEqual(visible_terminal_output(output), b"backgroundopration running")


if __name__ == "__main__":
    unittest.main()
