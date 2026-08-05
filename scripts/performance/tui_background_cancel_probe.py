#!/usr/bin/env python3
"""Prove/review PTY cancellation must finish in under one second without detached work."""

import fcntl
import json
import os
import select
import struct
import subprocess
import sys
import tempfile
import termios
import time

from pty_process import terminate_and_reap, visible_terminal_output


def send(fd: int, value: bytes) -> None:
    try:
        os.write(fd, value)
    except OSError:
        pass


def run(executable: str, kind: str) -> dict:
    with tempfile.TemporaryDirectory(prefix=f"cloop-tui-cancel-{kind}-") as root:
        os.mkdir(os.path.join(root, ".changeloop"))
        open(os.path.join(root, ".changeloop", "test-fixture-provider.enabled"), "w").close()
        proof = [{"id": "blocked", "command": "sh", "args": ["-c", "sleep 30" if kind == "prove" else "exit 0"], "claims": ["fixture"]}]
        with open(os.path.join(root, ".changeloop", "proof-providers.json"), "w") as handle:
            json.dump(proof, handle)
        with open(os.path.join(root, ".changeloop", "reviewer.json"), "w") as handle:
            json.dump({"command": "sh", "args": ["-c", "sleep 30"]}, handle)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        with open(os.path.join(root, "tracked.txt"), "w") as handle:
            handle.write("initial\n")
        subprocess.run(["git", "add", "tracked.txt"], cwd=root, check=True)
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=x@example.test", "commit", "-qm", "initial"], cwd=root, check=True)

        pid, fd = os.forkpty()
        if pid == 0:
            os.chdir(root)
            os.environ.update({
                "TERM": "xterm-256color",
                "CHANGELOOP_CONFIG_HOME": os.path.join(root, "config"),
                "CHANGELOOP_TEST_FIXTURE_PROVIDER": "1",
                "CHANGELOOP_PROVIDER": "openai",
                "CHANGELOOP_MODEL": "fixture",
                "OPENAI_API_KEY": "fixture-not-a-secret",
            })
            os.execv(executable, [executable])

        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        output = bytearray()
        cursor_answered = False
        cancel_started = None
        cancelled_at = None
        exit_status = None
        stage = 0
        deadline = time.monotonic() + 8
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([fd], [], [], 0.01)
                if readable:
                    try:
                        output.extend(os.read(fd, 65536))
                    except OSError:
                        pass
                if not cursor_answered and b"\x1b[6n" in output:
                    send(fd, b"\x1b[1;1R")
                    cursor_answered = True
                visible = visible_terminal_output(output)
                if stage == 0 and b"Changeloop" in visible:
                    send(fd, b"/run update docs\r")
                    stage = 1
                elif stage == 1 and b"/run:" in visible:
                    send(fd, b"/prove\r")
                    stage = 2
                elif stage == 2 and b"ready_to_land" in visible and kind == "review":
                    send(fd, b"/review\r")
                    stage = 3
                elif (
                    (stage == 2 and kind == "prove") or (stage == 3 and kind == "review")
                ) and b"background" in visible and b"running" in visible:
                    # Clear prior output so the cancellation assertion cannot match stale text.
                    output.clear()
                    cancel_started = time.monotonic()
                    send(fd, b"\x03")
                    stage = 4
                elif stage == 4 and b"cancelled" in visible:
                    cancelled_at = time.monotonic()
                    send(fd, b"/quit\r")
                    stage = 5
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

        latency = None if cancelled_at is None else cancelled_at - cancel_started
        return {
            "kind": kind,
            "passed": stage == 5 and exit_status == 0 and latency is not None and latency < 1,
            "stage": stage,
            "exitStatus": exit_status,
            "cancelLatencyMs": None if latency is None else round(latency * 1000, 3),
            "cleanExit": exit_status == 0,
            "outputTail": None if stage == 5 and exit_status == 0 else bytes(output[-800:]).decode("utf-8", "replace"),
        }


def main() -> int:
    executable = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "target/debug/cloop")
    results = [run(executable, "prove"), run(executable, "review")]
    passed = all(result["passed"] for result in results)
    print(json.dumps({"passed": passed, "results": results}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
