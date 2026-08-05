#!/usr/bin/env python3
"""Verify SIGTERM leaves a PTY out of raw/bracketed-paste mode."""

import fcntl
import json
import os
import select
import signal
import struct
import sys
import tempfile
import termios
import time


def drain(fd: int, output: bytearray, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.01)
        if not readable:
            continue
        try:
            output.extend(os.read(fd, 65536))
        except OSError:
            return


def main() -> int:
    executable = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "target/debug/cloop")
    with tempfile.TemporaryDirectory(prefix="cloop-tui-cleanup-") as root:
        pid, fd = os.forkpty()
        if pid == 0:
            os.environ["TERM"] = "xterm-256color"
            os.environ["CHANGELOOP_CONFIG_HOME"] = os.path.join(root, "config")
            os.chdir(root)
            os.execv(executable, [executable])

        original = termios.tcgetattr(fd)
        output = bytearray()
        exit_status = None
        usage = None
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
            deadline = time.monotonic() + 5
            while b"Changeloop" not in output and time.monotonic() < deadline:
                drain(fd, output, 0.03)
                if b"\x1b[6n" in output:
                    os.write(fd, b"\x1b[1;1R")
            if b"Changeloop" not in output:
                raise RuntimeError(
                    "TUI did not render its boot frame: "
                    + bytes(output[-500:]).decode("utf-8", "replace")
                )

            idle_started = time.monotonic()
            time.sleep(1.0)
            idle_wall_ms = (time.monotonic() - idle_started) * 1000
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                drain(fd, output, 0.03)
                waited, status, usage = os.wait4(pid, os.WNOHANG)
                if waited:
                    exit_status = os.waitstatus_to_exitcode(status)
                    break
            if exit_status is None:
                os.kill(pid, signal.SIGKILL)
                _, status, usage = os.wait4(pid, 0)
                exit_status = os.waitstatus_to_exitcode(status)

            restored = termios.tcgetattr(fd)
        finally:
            os.close(fd)

        cpu_ms = (usage.ru_utime + usage.ru_stime) * 1000 if usage else float("inf")
        passed = (
            exit_status == 0
            and restored == original
            and b"\x1b[?2004h" in output
            and b"\x1b[?2004l" in output
            and cpu_ms < 100
        )
        print(
            json.dumps(
                {
                    "passed": passed,
                    "exitStatus": exit_status,
                    "termiosRestored": restored == original,
                    "bracketedPasteEnabled": b"\x1b[?2004h" in output,
                    "bracketedPasteDisabled": b"\x1b[?2004l" in output,
                    "idleWallMs": round(idle_wall_ms, 3),
                    "processCpuMs": round(cpu_ms, 3),
                    "cpuThresholdMs": 100,
                }
            )
        )
        return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
