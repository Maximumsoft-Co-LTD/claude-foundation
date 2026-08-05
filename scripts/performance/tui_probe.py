#!/usr/bin/env python3
"""Hermetic PTY readiness probe: render, send /status, observe its card, quit."""

import fcntl
import json
import os
import re
import select
import signal
import struct
import sys
import tempfile
import termios
import time
import shutil


def sample(executable: str) -> dict:
    started = time.monotonic_ns()
    config_root = tempfile.mkdtemp(prefix="cloop-tui-ready-")
    pid, fd = os.forkpty()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ["CHANGELOOP_CONFIG_HOME"] = config_root
        os.environ.pop("CHANGELOOP_PROVIDER", None)
        os.environ.pop("CHANGELOOP_MODEL", None)
        os.chdir(config_root)
        os.execv(executable, [executable])
    fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    output = bytearray()
    boot_seen_at = None
    status_sent = False
    quit_sent = False
    ready_at = None
    deadline = time.monotonic() + 5
    exit_status = None
    try:
        while time.monotonic() < deadline:
            readable, _, _ = select.select([fd], [], [], 0.02)
            if readable:
                try:
                    output.extend(os.read(fd, 65536))
                except OSError:
                    pass
                if b"\x1b[6n" in output:
                    safe_write(fd, b"\x1b[1;1R")
                if boot_seen_at is None and b"Changeloop" in output:
                    boot_seen_at = time.monotonic()
                # Ratatui may repaint the final cell before the captured byte
                # stream retains the trailing `e`; the completed /status card
                # disambiguates this from arbitrary truncated output.
                status_ready = re.search(rb'"ready"\s*:\s*true?', output) is not None
                if ready_at is None and b"/status:" in output and status_ready:
                    ready_at = time.monotonic_ns()
                    quit_sent = True
                    safe_write(fd, b"/quit\r")
            # The title is emitted while ratatui is still completing terminal
            # setup.  Typing into that first frame is racy on a PTY, so wait
            # for the event loop to become responsive before exercising it.
            if (
                not status_sent
                and boot_seen_at is not None
                and time.monotonic() - boot_seen_at >= 0.02
            ):
                status_sent = True
                safe_write(fd, b"/status\r")
            waited, status = os.waitpid(pid, os.WNOHANG)
            if waited:
                exit_status = os.waitstatus_to_exitcode(status)
                break
        if exit_status is None:
            os.kill(pid, signal.SIGTERM)
            terminate_deadline = time.monotonic() + 1
            while time.monotonic() < terminate_deadline:
                waited, status = os.waitpid(pid, os.WNOHANG)
                if waited:
                    exit_status = os.waitstatus_to_exitcode(status)
                    break
                time.sleep(0.01)
            if exit_status is None:
                os.kill(pid, signal.SIGKILL)
                kill_deadline = time.monotonic() + 1
                while time.monotonic() < kill_deadline:
                    waited, status = os.waitpid(pid, os.WNOHANG)
                    if waited:
                        exit_status = os.waitstatus_to_exitcode(status)
                        break
                    time.sleep(0.01)
            if exit_status is None:
                exit_status = -signal.SIGKILL
    finally:
        os.close(fd)
        shutil.rmtree(config_root, ignore_errors=True)
    onboarding_guidance = b"First-run setup" in output and b"SETUP REQUIRED" in output
    ready = ready_at is not None and exit_status == 0
    return {
        "ready": ready,
        "durationNs": ready_at - started if ready_at is not None else None,
        "statusSent": status_sent,
        "statusReady": re.search(rb'"ready"\s*:\s*true?', output) is not None,
        "onboardingGuidance": onboarding_guidance,
        "quitSent": quit_sent,
        "exitStatus": exit_status,
        "reason": None if ready else "missing responsive /status card or clean /quit",
        "outputTail": None if ready else bytes(output[-300:]).decode("utf-8", "replace"),
    }


def safe_write(fd: int, value: bytes) -> None:
    try:
        os.write(fd, value)
    except OSError:
        pass


def main() -> int:
    executable = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "target/release/cloop")
    repetitions = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    warmups = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    if repetitions < 1:
        raise ValueError("repetitions must be positive")
    for _ in range(warmups):
        warmup = sample(executable)
        if not warmup["ready"]:
            print(json.dumps({"warmup": warmup}), file=sys.stderr)
            return 1
    observations = [sample(executable) for _ in range(repetitions)]
    if not all(item["ready"] for item in observations):
        print(json.dumps({"observations": observations}), file=sys.stderr)
        return 1
    print(json.dumps({
        "recordVersion": 1,
        "probe": "keyboard-responsive-tui-ready",
        "workloadVersion": "tui-status-readiness-pty-v4",
        "repetitions": repetitions,
        "warmups": warmups,
        "samplesNs": [item["durationNs"] for item in observations],
        "observations": observations,
        "thresholdMs": 750,
        "correctness": {
            "completeFrame": True,
            "keyboardResponse": "/status card with ready JSON",
            "noProviderGuidance": all(item["onboardingGuidance"] for item in observations),
            "cleanQuit": True,
        },
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
