#!/usr/bin/env python3
"""Produce fail-closed, local TUI performance/accessibility evidence."""

import datetime
import hashlib
import json
import os
import platform
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CASES = {
    "startupReady": ("scripts/performance/tui_probe.py", 30),
    "resizeUnicodeCtrlC": ("scripts/performance/tui_robustness_probe.py", 15),
    "signalIdleCleanup": ("scripts/performance/tui_terminal_cleanup_probe.py", 15),
    "terminalPortability": ("scripts/performance/tui_portability_probe.py", 15),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], timeout: int) -> dict:
    started = time.monotonic()
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate(timeout=5)
    duration_ms = round((time.monotonic() - started) * 1000, 3)
    return {
        "command": command,
        "timeoutSeconds": timeout,
        "timedOut": timed_out,
        "exitCode": process.returncode,
        "durationMs": duration_ms,
        "stdout": stdout[-65536:].decode("utf-8", "replace"),
        "stderr": stderr[-4096:].decode("utf-8", "replace"),
    }


def parse_single_json(result: dict) -> tuple[dict | None, str | None]:
    lines = [line for line in result["stdout"].splitlines() if line.strip()]
    if len(lines) != 1:
        return None, f"expected exactly one JSON line, received {len(lines)}"
    try:
        value = json.loads(lines[0])
    except json.JSONDecodeError as error:
        return None, f"invalid JSON output: {error}"
    if not isinstance(value, dict):
        return None, "probe output is not a JSON object"
    return value, None


def git_value(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True, timeout=10
    )
    return result.stdout.strip()


def main() -> int:
    binary = (ROOT / (sys.argv[1] if len(sys.argv) > 1 else "target/debug/cloop")).resolve()
    if not binary.is_file():
        print(json.dumps({"error": f"binary does not exist: {binary}"}))
        return 2

    monitored = [
        binary,
        ROOT / "Cargo.lock",
        ROOT / "crates/changeloop-app-server/src/executable.rs",
        ROOT / "crates/changeloop-cli/src/main.rs",
        Path(__file__).resolve(),
        ROOT / "scripts/performance/assess_tui_evidence.py",
        ROOT / "scripts/performance/tui_provider_burst_probe.py",
        ROOT / "tests/performance/tui-evidence.schema.json",
        *(ROOT / script for script, _ in CASES.values()),
    ]
    integrity_start = {str(path.relative_to(ROOT)): sha256(path) for path in monitored}
    cases = {}
    commands = []
    for case_id, (script, timeout) in CASES.items():
        result = run([sys.executable, str(ROOT / script), str(binary)], timeout)
        commands.append({key: value for key, value in result.items() if key not in {"stdout", "stderr"}})
        output, parse_error = parse_single_json(result)
        passed = (
            not result["timedOut"]
            and result["exitCode"] == 0
            and parse_error is None
            and output.get("passed", True) is True
        )
        cases[case_id] = {
            "passed": passed,
            "complete": parse_error is None,
            "timedOut": result["timedOut"],
            "exitCode": result["exitCode"],
            "durationMs": result["durationMs"],
            "parseError": parse_error,
            "output": output,
            "stderrTail": result["stderr"],
        }

    burst_result = run(
        [
            "cargo",
            "test",
            "-p",
            "changeloop-app-server",
            "tui_scrollback_compacts_a_hundred_thousand_events_and_renders_stably",
        ],
        120,
    )
    commands.append({key: value for key, value in burst_result.items() if key not in {"stdout", "stderr"}})
    burst_passed = not burst_result["timedOut"] and burst_result["exitCode"] == 0
    cases["eventBurstCompaction"] = {
        "passed": burst_passed,
        "complete": True,
        "timedOut": burst_result["timedOut"],
        "exitCode": burst_result["exitCode"],
        "durationMs": burst_result["durationMs"],
        "externalPtyInjectionSupported": False,
        "unsupportedReason": "the public TUI has no test-only event injection endpoint",
        "deterministicRegression": {
            "eventsInserted": 100000,
            "retainedCards": 256,
            "passed": burst_passed,
        },
        "stderrTail": burst_result["stderr"],
    }

    provider_result = run(
        [sys.executable, str(ROOT / "scripts/performance/tui_provider_burst_probe.py"), str(binary)],
        15,
    )
    commands.append({key: value for key, value in provider_result.items() if key not in {"stdout", "stderr"}})
    provider_output, provider_parse_error = parse_single_json(provider_result)
    provider_supported = bool(provider_output and provider_output.get("supported") is True)
    provider_passed = (
        provider_supported
        and not provider_result["timedOut"]
        and provider_result["exitCode"] == 0
        and provider_parse_error is None
        and provider_output.get("passed") is True
    )
    cases["providerStream10k"] = {
        "passed": provider_passed,
        "complete": provider_parse_error is None,
        "supported": provider_supported,
        "timedOut": provider_result["timedOut"],
        "exitCode": provider_result["exitCode"],
        "durationMs": provider_result["durationMs"],
        "parseError": provider_parse_error,
        "output": provider_output,
        "stderrTail": provider_result["stderr"],
    }

    integrity_end = {str(path.relative_to(ROOT)): sha256(path) for path in monitored}
    diagnostic_passed = all(case["passed"] and case["complete"] for case in cases.values())
    unchanged = integrity_start == integrity_end
    diagnostic_passed = diagnostic_passed and unchanged
    record = {
        "schema": "dev.changeloop.tui-evidence",
        "recordVersion": 1,
        "evidenceClass": "diagnostic-smoke",
        "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "binary": {
            "path": str(binary.relative_to(ROOT)),
            "sha256": integrity_start[str(binary.relative_to(ROOT))],
            "profile": "release" if "/release/" in str(binary) else "debug",
        },
        "revision": {
            "gitRevision": git_value("rev-parse", "HEAD"),
            "dirty": bool(git_value("status", "--porcelain=v1", "--untracked-files=all")),
        },
        "environment": {
            "os": platform.system(),
            "release": platform.release(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
        },
        "integrity": {"start": integrity_start, "end": integrity_end, "unchanged": unchanged},
        "cases": cases,
        "commands": commands,
        "overall": {
            "diagnosticPassed": diagnostic_passed,
            "releaseEligible": False,
            "releaseGap": "release ProviderBackend exposes no trusted literal-loopback endpoint contract, so real PTY 10k provider streaming is fail-closed; full release-machine repetitions also remain required",
        },
    }
    encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    if len(sys.argv) > 2:
        output_path = Path(sys.argv[2]).resolve()
        temporary = output_path.with_suffix(output_path.suffix + ".tmp")
        temporary.write_text(encoded + "\n", encoding="utf-8")
        temporary.replace(output_path)
    print(encoded)
    return 0 if diagnostic_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
