#!/usr/bin/env python3
"""Hermetic PTY probe for the keyboard-only first-run selector flow."""

import fcntl
import json
import os
import select
import struct
import sys
import tempfile
import termios
import time

from pty_process import terminate_and_reap, visible_terminal_output


def safe_write(fd: int, value: bytes) -> None:
    try:
        os.write(fd, value)
    except OSError:
        pass


def main() -> int:
    executable = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "target/debug/cloop")
    accept = len(sys.argv) > 2 and sys.argv[2] == "--accept"
    with tempfile.TemporaryDirectory(prefix="cloop-tui-selectors-") as root:
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

        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        output = bytearray()
        stage = 0
        cursor_answered = False
        sandbox_seen_at = None
        confirmation_seen_at = None
        exit_status = None
        deadline = time.monotonic() + 8
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([fd], [], [], 0.02)
                if readable:
                    try:
                        output.extend(os.read(fd, 65536))
                    except OSError:
                        pass
                if not cursor_answered and b"\x1b[6n" in output:
                    safe_write(fd, b"\x1b[1;1R")
                    cursor_answered = True
                visible = visible_terminal_output(output)
                if stage == 0 and b"First-run setup" in visible:
                    safe_write(fd, b"/setup\r")
                    stage = 1
                elif stage == 1 and b"First-run provider" in visible:
                    safe_write(fd, b"\r")
                    stage = 2
                elif stage == 2 and b"provider model ID" in visible:
                    safe_write(fd, b"test-model-id\r")
                    stage = 3
                elif stage == 3 and b"Sandbox policy" in visible:
                    if sandbox_seen_at is None:
                        sandbox_seen_at = time.monotonic()
                    elif time.monotonic() - sandbox_seen_at >= 0.25:
                        safe_write(fd, b"\r")
                        stage = 4
                elif stage == 4 and b"first-run setup" in visible:
                    if confirmation_seen_at is None:
                        confirmation_seen_at = time.monotonic()
                    elif time.monotonic() - confirmation_seen_at >= 0.1:
                        safe_write(fd, b"\r" if accept else b"\x1b")
                        stage = 5
                elif stage == 5 and (
                    (accept and b"setup saved" in visible)
                    or (not accept and b"no settings saved" in visible)
                ):
                    safe_write(fd, b"/quit\r")
                    stage = 6
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

        setup_path = os.path.join(root, "config", "changeloop", "first-run.json")
        persisted = os.path.exists(setup_path)
        setup = None
        if persisted:
            with open(setup_path, encoding="utf-8") as handle:
                setup = json.load(handle)
        disk_correct = (
            persisted
            and setup["provider"] == "openai"
            and setup["model"] == "test-model-id"
            and setup["sandbox"] == "read_only"
            and setup["localOnlyTelemetry"] is True
            and setup["analyticsEnabled"] is False
            and setup["crashUploadEnabled"] is False
        ) if accept else not persisted
        passed = stage == 6 and exit_status == 0 and disk_correct
        visible = visible_terminal_output(output)
        result = {
            "passed": passed,
            "accepted": accept,
            "stage": stage,
            "exitStatus": exit_status,
            "diskCorrect": disk_correct,
            "setup": setup,
            "providerSelector": b"First-run provider" in visible,
            "sandboxSelector": b"Sandbox policy" in visible,
            "disclosureDialog": b"first-run setup" in visible,
        }
        print(json.dumps(result))
        if not passed:
            print(bytes(output[-1000:]).decode("utf-8", "replace"), file=sys.stderr)
        return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
