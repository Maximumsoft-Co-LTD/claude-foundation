#!/usr/bin/env python3
"""Fail-closed mutation checks for the TUI evidence assessor."""

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ASSESSOR = ROOT / "scripts/performance/assess_tui_evidence.py"
RECORD = ROOT / "docs/reports/tui-evidence-diagnostic-2026-08-05.json"


class TuiEvidenceAssessorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.baseline = json.loads(RECORD.read_text(encoding="utf-8"))
        current = {}
        for relative in cls.baseline["integrity"]["end"]:
            current[relative] = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
        cls.baseline["integrity"] = {
            "start": current,
            "end": copy.deepcopy(current),
            "unchanged": True,
        }
        cls.baseline["binary"]["sha256"] = current[cls.baseline["binary"]["path"]]
        cls.baseline["cases"]["providerStream10k"] = {
            "passed": True,
            "complete": True,
            "supported": True,
            "timedOut": False,
            "exitCode": 0,
            "durationMs": 1,
            "output": {
                "fixture": {"deltaCount": 10000},
                "network": {"externalNetworkAttempted": False},
                "credentials": {"realCredentialLoaded": False, "credentialSent": False},
            },
        }
        cls.baseline["overall"]["diagnosticPassed"] = True

    def assess(self, value) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="cloop-tui-assessor-") as root:
            path = Path(root) / "record.json"
            if isinstance(value, str):
                path.write_text(value, encoding="utf-8")
            else:
                path.write_text(json.dumps(value), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(ASSESSOR), str(path)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )

    def test_current_record_passes(self) -> None:
        self.assertEqual(self.assess(self.baseline).returncode, 0)

    def test_missing_case_fails(self) -> None:
        value = copy.deepcopy(self.baseline)
        del value["cases"]["terminalPortability"]
        self.assertNotEqual(self.assess(value).returncode, 0)

    def test_timeout_or_integrity_change_fails(self) -> None:
        value = copy.deepcopy(self.baseline)
        value["cases"]["startupReady"]["timedOut"] = True
        self.assertNotEqual(self.assess(value).returncode, 0)
        value = copy.deepcopy(self.baseline)
        value["integrity"]["unchanged"] = False
        self.assertNotEqual(self.assess(value).returncode, 0)

    def test_binary_mismatch_and_partial_json_fail(self) -> None:
        value = copy.deepcopy(self.baseline)
        value["binary"]["sha256"] = "0" * 64
        self.assertNotEqual(self.assess(value).returncode, 0)
        self.assertNotEqual(self.assess('{"schema":').returncode, 0)


if __name__ == "__main__":
    unittest.main()
