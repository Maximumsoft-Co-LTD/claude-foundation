#!/usr/bin/env python3
"""Exercise non-TTY, TERM=dumb, and NO_COLOR TUI boundaries."""

import json
import fcntl
import os
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time


def pty_run(executable: str, environment: dict[str, str], expect_boot: bool) -> tuple[int, bytes]:
    pid, fd = os.forkpty()
    if pid == 0:
        os.environ.update(environment)
        os.environ.pop("CHANGELOOP_PROVIDER", None)
        os.environ.pop("CHANGELOOP_MODEL", None)
        config_home = environment.get("CHANGELOOP_CONFIG_HOME")
        if config_home:
            os.chdir(os.path.dirname(config_home))
        os.execv(executable, [executable])
    fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    output = bytearray()
    status = None
    cursor_answered = False
    quit_sent = False
    deadline = time.monotonic() + 5
    try:
        while time.monotonic() < deadline:
            readable, _, _ = select.select([fd], [], [], 0.03)
            if readable:
                try:
                    output.extend(os.read(fd, 65536))
                except OSError:
                    pass
            if not cursor_answered and b"\x1b[6n" in output:
                try:
                    os.write(fd, b"\x1b[1;1R")
                    cursor_answered = True
                except BlockingIOError:
                    pass
            waited, wait_status = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = os.waitstatus_to_exitcode(wait_status)
                break
            if expect_boot and not quit_sent and b"Changeloop" in output:
                try:
                    os.write(fd, b"/quit\r")
                    quit_sent = True
                except BlockingIOError:
                    pass
        if status is None:
            os.kill(pid, signal.SIGTERM)
            terminate_deadline = time.monotonic() + 1
            while time.monotonic() < terminate_deadline:
                waited, wait_status = os.waitpid(pid, os.WNOHANG)
                if waited:
                    status = os.waitstatus_to_exitcode(wait_status)
                    break
                time.sleep(0.01)
            if status is None:
                os.kill(pid, signal.SIGKILL)
                kill_deadline = time.monotonic() + 1
                while time.monotonic() < kill_deadline:
                    waited, wait_status = os.waitpid(pid, os.WNOHANG)
                    if waited:
                        status = os.waitstatus_to_exitcode(wait_status)
                        break
                    time.sleep(0.01)
                if status is None:
                    status = -signal.SIGKILL
    finally:
        os.close(fd)
    return status, bytes(output)


def main() -> int:
    executable = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "target/debug/cloop")
    with tempfile.TemporaryDirectory(prefix="cloop-tui-portability-") as root:
        base = {"CHANGELOOP_CONFIG_HOME": os.path.join(root, "config")}
        headless = subprocess.Popen(
            [executable],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, **base, "TERM": "xterm-256color"},
            start_new_session=True,
        )
        try:
            headless_stdout, headless_stderr = headless.communicate(b"", timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(headless.pid, signal.SIGKILL)
            headless_stdout, headless_stderr = headless.communicate(timeout=3)
        dumb_status, dumb_output = pty_run(executable, {**base, "TERM": "dumb"}, False)
        plain_status, plain_output = pty_run(
            executable, {**base, "TERM": "xterm-256color", "NO_COLOR": "1"}, True
        )

    colored_sgr = any(
        sequence in plain_output
        for number in list(range(30, 39)) + list(range(40, 49)) + list(range(90, 98)) + list(range(100, 108))
        for sequence in (f"\x1b[{number}m".encode(), f"\x1b[{number};".encode())
    )
    checks = {
        "nonTtyRejected": headless.returncode != 0 and b"cloop ask" in headless_stderr,
        "dumbRejected": dumb_status != 0 and b"TERM=dumb" in dumb_output and b"cloop ask" in dumb_output,
        "noColorBooted": plain_status == 0 and b"Changeloop" in plain_output,
        "noColorHasNoColorSgr": not colored_sgr,
    }
    print(
        json.dumps(
            {
                "passed": all(checks.values()),
                **checks,
                "headlessStatus": headless.returncode,
                "dumbStatus": dumb_status,
                "noColorStatus": plain_status,
                "noColorBytes": len(plain_output),
            }
        )
    )
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
