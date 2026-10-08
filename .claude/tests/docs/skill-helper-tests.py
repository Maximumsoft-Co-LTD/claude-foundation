"""Offline regressions for shipped evaluation helpers; no model invocation."""
import json
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / ".claude/skills/skill-creator"))
from scripts import aggregate_benchmark as benchmark
from scripts import run_loop as loop
from scripts import run_eval as evaluator


class BenchmarkTests(unittest.TestCase):
    def test_missing_measurements_are_unknown_and_zero_is_observed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "eval-1/with_skill"
            config.mkdir(parents=True)
            (config / "grading.json").write_text(json.dumps({
                "summary": {"pass_rate": 0},
                "timing": {"total_duration_seconds": 0},
                "execution_metrics": {"output_chars": 1000},
            }))
            (config / "timing.json").write_text(json.dumps({"total_duration_seconds": 99}))
            data = benchmark.generate_benchmark(root)
            result = data["runs"][0]["result"]
            self.assertEqual(result["time_seconds"], 0)
            self.assertIsNone(result["tokens"])
            self.assertIsNone(result["passed"])
            self.assertEqual(data["metadata"]["runs_per_configuration"], 1)
            self.assertIsNone(data["metadata"]["executor_model"])
            self.assertIsNone(data["run_summary"]["delta"]["pass_rate"])
            self.assertIn("unknown", benchmark.generate_markdown(data))
            self.assertEqual(data["run_summary"]["with_skill"]["pass_rate"]["mean"], 0)

    def test_sibling_usage_is_loaded_without_overwriting_observed_timing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = root / "runs/eval-2/new_skill/run-1"
            run.mkdir(parents=True)
            (run / "grading.json").write_text(json.dumps({"timing": {"total_duration_seconds": 5}}))
            (run / "timing.json").write_text(json.dumps({"total_tokens": 42}))
            result = benchmark.load_run_results(root)["new_skill"][0]
            self.assertEqual((result["time_seconds"], result["tokens"]), (5, 42))

    def test_stats_reject_unmeasured_and_nonfinite_values(self):
        self.assertIsNone(benchmark.calculate_stats([None, True, float("nan"), -1])["mean"])
        self.assertIsNone(benchmark.calculate_stats([0])["stddev"])
        self.assertEqual(benchmark.calculate_stats([0, 2])["mean"], 1)

    def test_delta_uses_candidate_minus_matched_baseline(self):
        def row(eval_id, rate):
            return {"eval_id": eval_id, "run_number": 1, "pass_rate": rate,
                    "time_seconds": None, "tokens": None}
        summary = benchmark.aggregate_results({
            "old_skill": [row(1, 0.2)],
            "new_skill": [row(1, 0.8), row(2, 0)],
        })
        self.assertEqual(list(summary)[:2], ["new_skill", "old_skill"])
        self.assertEqual(summary["delta"]["pass_rate"], "+0.60")
        self.assertIsNone(summary["delta"]["tokens"])


class DescriptionTests(unittest.TestCase):
    def cases(self):
        return [{"query": f"query-{i}", "should_trigger": i < 3} for i in range(6)]

    def test_small_strata_keep_training_and_do_not_change_global_rng(self):
        state = random.getstate()
        train, test = loop.split_eval_set(self.cases()[:1], 0.4)
        self.assertEqual(len(train), 1)
        self.assertEqual(test, [])
        self.assertEqual(random.getstate(), state)
        self.assertEqual(loop.split_eval_set(self.cases(), 0)[1], [])
        with self.assertRaises(ValueError):
            loop.split_eval_set(self.cases(), 1)

    def test_heldout_runs_once_after_training_selection_and_is_never_feedback(self):
        calls = []
        train, heldout = loop.split_eval_set(self.cases(), 0.4)
        def evaluate(**kwargs):
            queries = kwargs["eval_set"]
            calls.append((kwargs["description"], queries))
            return {"results": [{**q, "pass": index < (1 if kwargs["description"] == "first" else 2),
                                  "runs": 1, "triggers": 0} for index, q in enumerate(queries)]}
        def improve(**kwargs):
            self.assertEqual(kwargs["eval_results"]["summary"]["total"], len(train))
            self.assertFalse(any(k.startswith("test_") for h in kwargs["history"] for k in h))
            return "second"
        with patch.object(loop, "find_project_root", return_value=ROOT), \
             patch.object(loop, "parse_skill_md", return_value=("example", "first", "body")), \
             patch.object(loop, "run_eval", side_effect=evaluate), \
             patch.object(loop, "improve_description", side_effect=improve):
            result = loop.run_loop(self.cases(), ROOT, None, 1, 30, 2, 1, 0.5, 0.4, "unused", False)
        self.assertEqual(calls, [("first", train), ("second", train), ("second", heldout)])
        self.assertEqual(result["best_description"], "second")
        self.assertEqual(result["selection_metric"], "train")
        self.assertIsNone(result["history"][0]["test_results"])
        self.assertEqual(result["heldout_status"], "observed")

    def test_incomplete_or_unexecuted_results_cannot_pass(self):
        with self.assertRaises(RuntimeError):
            loop.validate_results({"results": []}, self.cases())
        with self.assertRaises(RuntimeError):
            loop.validate_results({"results": [{"query": "x", "pass": True, "runs": 0}]}, [{"query": "x"}])

    def test_failed_negative_query_is_unavailable_not_a_pass(self):
        with patch.object(evaluator, "ProcessPoolExecutor", ThreadPoolExecutor), \
             patch.object(evaluator, "run_single_query", side_effect=RuntimeError("offline")):
            result = evaluator.run_eval([{"query": "negative", "should_trigger": False}],
                "example", "description", 1, 1, ROOT)
        self.assertIsNone(result["results"][0]["pass"])
        self.assertEqual(result["summary"], {"total": 1, "passed": 0, "failed": 0, "unavailable": 1})

    def test_fast_runner_exit_parses_buffer_and_errors_are_not_negative_results(self):
        for event, expected in (({"type": "result", "is_error": False}, False),
                                ({"type": "result", "is_error": True}, None)):
            process = unittest.mock.Mock()
            process.poll.return_value = 0
            process.stdout = BytesIO(json.dumps(event).encode())
            with tempfile.TemporaryDirectory() as directory, \
                 patch.object(evaluator.subprocess, "Popen", return_value=process):
                if expected is None:
                    with self.assertRaises(RuntimeError):
                        evaluator.run_single_query("query", "example", "description", 1, directory)
                else:
                    self.assertIs(evaluator.run_single_query("query", "example", "description", 1, directory), False)
                self.assertEqual(list((Path(directory) / ".claude/commands").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
