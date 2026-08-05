#!/usr/bin/env python3
"""Fail-closed assessor for Changeloop TUI evidence records."""

import hashlib
import json
import sys
from pathlib import Path


REQUIRED_CASES = {
    "startupReady",
    "resizeUnicodeCtrlC",
    "signalIdleCleanup",
    "terminalPortability",
    "eventBurstCompaction",
    "providerStream10k",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"passed": False, "errors": ["usage: assess_tui_evidence.py RECORD.json"]}))
        return 2
    root = Path(__file__).resolve().parents[2]
    errors = []
    try:
        record = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(json.dumps({"passed": False, "errors": [f"invalid record: {error}"]}))
        return 1
    if record.get("schema") != "dev.changeloop.tui-evidence" or record.get("recordVersion") != 1:
        errors.append("unsupported schema/version")
    cases = record.get("cases")
    if not isinstance(cases, dict) or set(cases) != REQUIRED_CASES:
        errors.append("required case set is incomplete or contains unknown cases")
        cases = cases if isinstance(cases, dict) else {}
    for case_id in REQUIRED_CASES:
        case = cases.get(case_id, {})
        if case.get("passed") is not True or case.get("complete") is not True:
            errors.append(f"{case_id} did not pass completely")
        if case.get("timedOut") is not False or case.get("exitCode") != 0:
            errors.append(f"{case_id} timed out or exited nonzero")
    burst = cases.get("eventBurstCompaction", {}).get("deterministicRegression", {})
    if burst.get("passed") is not True or burst.get("eventsInserted", 0) < 10000 or burst.get("retainedCards") != 256:
        errors.append("event burst compaction evidence is incomplete")
    provider_case = cases.get("providerStream10k", {})
    provider = provider_case.get("output", {})
    if provider_case.get("supported") is not True or provider_case.get("passed") is not True:
        errors.append("release binary does not support the hermetic 10k provider PTY fixture")
    fixture = provider.get("fixture", {})
    network = provider.get("network", {})
    credentials = provider.get("credentials", {})
    if fixture.get("deltaCount") != 10000 or network.get("externalNetworkAttempted") is not False:
        errors.append("provider fixture/network evidence is incomplete")
    if credentials.get("realCredentialLoaded") is not False or credentials.get("credentialSent") is not False:
        errors.append("provider fixture used non-hermetic credentials")
    startup = cases.get("startupReady", {}).get("output", {})
    observations = startup.get("observations", [])
    correctness = startup.get("correctness", {})
    if len(observations) < 3 or not all(item.get("ready") and item.get("exitStatus") == 0 for item in observations):
        errors.append("startup readiness repetitions are incomplete")
    if correctness.get("completeFrame") is not True or correctness.get("cleanQuit") is not True:
        errors.append("startup correctness evidence is incomplete")
    resize = cases.get("resizeUnicodeCtrlC", {}).get("output", {})
    if resize.get("resizeEvents", 0) < 500 or resize.get("unicodePasteObserved") is not True or resize.get("ctrlCEscalationExited") is not True:
        errors.append("resize/Unicode/Ctrl-C evidence is incomplete")
    cleanup = cases.get("signalIdleCleanup", {}).get("output", {})
    if cleanup.get("termiosRestored") is not True or cleanup.get("bracketedPasteDisabled") is not True or cleanup.get("processCpuMs", 10**9) >= cleanup.get("cpuThresholdMs", 0):
        errors.append("signal/idle/terminal cleanup evidence is incomplete")
    portability = cases.get("terminalPortability", {}).get("output", {})
    for field in ["nonTtyRejected", "dumbRejected", "noColorBooted", "noColorHasNoColorSgr"]:
        if portability.get(field) is not True:
            errors.append(f"terminal portability evidence missing: {field}")
    integrity = record.get("integrity", {})
    if integrity.get("unchanged") is not True or integrity.get("start") != integrity.get("end"):
        errors.append("source/binary integrity changed during capture")
    for relative, expected in integrity.get("end", {}).items():
        path = root / relative
        if not path.is_file() or sha256(path) != expected:
            errors.append(f"current integrity mismatch: {relative}")
    binary = record.get("binary", {})
    binary_path = root / binary.get("path", "")
    if not binary_path.is_file() or sha256(binary_path) != binary.get("sha256"):
        errors.append("binary hash mismatch")
    if record.get("overall", {}).get("diagnosticPassed") is not True:
        errors.append("producer did not mark diagnostic as passed")
    passed = not errors
    print(json.dumps({"passed": passed, "errors": errors}, separators=(",", ":")))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
