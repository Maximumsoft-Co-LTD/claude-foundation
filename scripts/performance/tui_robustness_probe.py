#!/usr/bin/env python3
"""PTY stress: resize storms, slow-reader pressure, bracketed Unicode paste, Ctrl-C escalation."""

import fcntl
import json
import os
import select
import struct
import sys
import tempfile
import termios
import time

from pty_process import terminate_and_reap


def write(fd: int, data: bytes) -> None:
    try:
        os.write(fd, data)
    except OSError:
        pass


def drain(fd: int, output: bytearray, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.01)
        if readable:
            try:
                output.extend(os.read(fd, 65536))
            except OSError:
                return


def main() -> int:
    executable = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "target/debug/cloop")
    with tempfile.TemporaryDirectory(prefix="cloop-tui-robust-") as root:
        pid, fd = os.forkpty()
        if pid == 0:
            os.environ["TERM"] = "xterm-256color"
            xdg_config_home = os.path.join(root, "config")
            os.environ["CHANGELOOP_CONFIG_HOME"] = os.path.join(
                xdg_config_home, "changeloop"
            )
            os.environ["XDG_CONFIG_HOME"] = xdg_config_home
            os.environ.pop("CHANGELOOP_PROVIDER", None)
            os.environ.pop("CHANGELOOP_MODEL", None)
            os.chdir(root)
            os.execv(executable, [executable])

        output = bytearray()
        exit_status = None
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
            boot_deadline = time.monotonic() + 5
            cursor_answered = False
            while b"Changeloop" not in output and time.monotonic() < boot_deadline:
                drain(fd, output, 0.03)
                if not cursor_answered and b"\x1b[6n" in output:
                    write(fd, b"\x1b[1;1R")
                    cursor_answered = True
            if b"Changeloop" not in output:
                raise RuntimeError("TUI did not render its boot frame")

            # Resize faster than redraw and intentionally do not read while doing so.
            for index in range(500):
                rows = 20 + index % 31
                cols = 70 + index % 71
                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            time.sleep(0.2)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
            drain(fd, output, 0.2)

            paste = "ไทย👨‍👩‍👧‍👦é\nsecond-line".encode()
            write(fd, b"\x1b[200~" + paste + b"\x1b[201~")
            drain(fd, output, 0.15)
            write(fd, b"\x03")  # clear composer
            write(fd, b"/status\r")
            drain(fd, output, 0.25)
            write(fd, b"\x03")  # cancel
            time.sleep(0.03)
            write(fd, b"\x03")  # exit escalation

            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                drain(fd, output, 0.03)
                waited, status = os.waitpid(pid, os.WNOHANG)
                if waited:
                    exit_status = os.waitstatus_to_exitcode(status)
                    break
            if exit_status is None:
                os.close(fd)
                fd = -1
                exit_status = terminate_and_reap(pid)
        finally:
            if fd >= 0:
                os.close(fd)

        result = {
            "passed": exit_status == 0 and b'"ready":true' in output,
            "exitStatus": exit_status,
            "resizeEvents": 500,
            "slowReaderPauseMs": 200,
            "unicodePasteObserved": "ไทย".encode() in output,
            "statusAfterPaste": b'"ready":true' in output,
            "ctrlCEscalationExited": exit_status == 0,
            "capturedBytes": len(output),
            "outputTail": bytes(output[-300:]).decode("utf-8", "replace") if exit_status != 0 else None,
        }
        print(json.dumps(result))
        return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
