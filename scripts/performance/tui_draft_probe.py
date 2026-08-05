#!/usr/bin/env python3
"""PTY regression for draft/contract confirmation and read-only rejection."""

import fcntl
import json
import os
import select
import shutil
import struct
import sys
import tempfile
import termios
import time

from pty_process import terminate_and_reap, visible_terminal_output


def run(executable: str) -> dict:
    fixture = tempfile.mkdtemp(prefix="cloop-tui-draft-")
    pid, fd = os.forkpty()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ["CHANGELOOP_CONFIG_HOME"] = os.path.join(fixture, "config")
        os.environ.pop("CHANGELOOP_PROVIDER", None)
        os.environ.pop("CHANGELOOP_MODEL", None)
        os.chdir(fixture)
        os.execv(executable, [executable])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    output = bytearray()
    sent = False
    rejected = False
    cursor_replied = False
    reject_seen_at = None
    quit_sent = False
    exit_status = None
    deadline = time.monotonic() + 5
    try:
        while time.monotonic() < deadline:
            readable, _, _ = select.select([fd], [], [], 0.02)
            if readable:
                try:
                    output.extend(os.read(fd, 65536))
                except OSError:
                    pass
                if not cursor_replied and b"\x1b[6n" in output:
                    cursor_replied = True
                    write(fd, b"\x1b[1;1R")
                visible = visible_terminal_output(output)
                if not sent and b"First-run setup" in visible:
                    sent = True
                    write(fd, b"fix authentication permissions\r")
                if (
                    not rejected
                    and b"Press Enter" in visible
                    and b"medium/high-risk" in visible
                ):
                    rejected = True
                    reject_seen_at = time.monotonic()
                    write(fd, b"\x1b")
            if (
                rejected
                and not quit_sent
                and b"discarded" in visible_terminal_output(output)
                and time.monotonic() - reject_seen_at >= 0.25
            ):
                quit_sent = True
                write(fd, b"/quit\r")
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
        shutil.rmtree(fixture, ignore_errors=True)
    visible = visible_terminal_output(output)
    result = {
        "draftDialog": b"Draft" in visible and b"explicit" in visible,
        "contractGate": b"Press Enter" in visible and b"medium/high-risk" in visible,
        "explicitReject": rejected,
        "readOnlyAfterReject": b"discarded" in visible,
        "cleanQuit": exit_status == 0,
        "exitStatus": exit_status,
        "outputTail": None if exit_status == 0 else bytes(output[-500:]).decode("utf-8", "replace"),
    }
    result["passed"] = all(
        result[key]
        for key in [
            "draftDialog",
            "contractGate",
            "explicitReject",
            "readOnlyAfterReject",
            "cleanQuit",
        ]
    )
    return result


def write(fd: int, value: bytes) -> None:
    try:
        os.write(fd, value)
    except OSError:
        pass


def main() -> int:
    executable = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "target/release/cloop")
    result = run(executable)
    print(json.dumps({"probe": "tui-draft-confirmation-v1", **result}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
