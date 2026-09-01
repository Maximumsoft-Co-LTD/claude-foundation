#!/usr/bin/env python3
"""Dependency-free Python function coverage and CRAP collector for benchmarks."""

import ast
import io
import json
import os
from pathlib import Path
import sys
import trace
import unittest


EXCLUDED = {".claude", ".foundation", ".git", ".venv", "venv", "__pycache__", "tests", "test"}


class Complexity(ast.NodeVisitor):
    def __init__(self):
        self.value = 1

    def visit_FunctionDef(self, node):
        return None

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef

    def visit_If(self, node):
        self.value += 1
        self.generic_visit(node)

    visit_For = visit_If
    visit_AsyncFor = visit_If
    visit_While = visit_If
    visit_IfExp = visit_If
    visit_comprehension = visit_If

    def visit_ExceptHandler(self, node):
        self.value += 1
        self.generic_visit(node)

    def visit_BoolOp(self, node):
        self.value += max(0, len(node.values) - 1)
        self.generic_visit(node)

    def visit_Match(self, node):
        self.value += len(node.cases)
        self.generic_visit(node)


class ExecutableLines(ast.NodeVisitor):
    def __init__(self):
        self.lines = set()

    def visit_FunctionDef(self, node):
        return None

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef

    def generic_visit(self, node):
        if isinstance(node, ast.stmt) and hasattr(node, "lineno"):
            self.lines.add(node.lineno)
        super().generic_visit(node)


def production_files(root):
    result = []
    for path in root.rglob("*.py"):
        relative = path.relative_to(root)
        if any(part in EXCLUDED for part in relative.parts):
            continue
        if path.name.startswith("test_") or path.name.endswith("_test.py"):
            continue
        result.append(path)
    return sorted(result)


def functions_in(path, root, counts):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    rows = []

    def add_function(node, prefix=""):
        complexity = Complexity()
        for statement in node.body:
            complexity.visit(statement)
        executable = ExecutableLines()
        for statement in node.body:
            executable.visit(statement)
        measured = executable.lines
        executed = {line for line in measured if counts.get((str(path), line), 0) > 0}
        coverage = len(executed) / len(measured) * 100 if measured else 100.0
        uncovered = 1 - coverage / 100
        crap = complexity.value ** 2 * uncovered ** 3 + complexity.value
        status = "fail" if crap >= 30 or complexity.value > 30 else "warn" if crap >= 20 else "pass"
        rows.append({
            "id": f"{prefix}{node.name}",
            "path": path.relative_to(root).as_posix(),
            "surface": "tooling" if path.relative_to(root).parts[0] in {"tools", "scripts"}
            else "product",
            "line": node.lineno,
            "endLine": node.end_lineno or node.lineno,
            "cyclomatic": complexity.value,
            "coveragePercent": round(coverage, 2),
            "crap": round(crap, 2),
            "status": status,
        })

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            add_function(node)
        elif isinstance(node, ast.ClassDef):
            for member in node.body:
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    add_function(member, f"{node.name}.")
    return rows


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: python-quality.py <workspace>")
    root = Path(sys.argv[1]).resolve()
    tests = root / "tests"
    if not tests.is_dir():
        raise SystemExit("Python benchmark requires a tests directory")
    os.chdir(root)
    sys.path.insert(0, str(root))
    suite = unittest.defaultTestLoader.discover(str(tests))
    runner = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0)
    tracer = trace.Trace(count=True, trace=False, ignoredirs=[sys.prefix, sys.exec_prefix])
    result = tracer.runfunc(runner.run, suite)
    if not result.wasSuccessful():
        raise SystemExit("Python benchmark tests failed during quality collection")
    counts = tracer.results().counts
    functions = []
    for path in production_files(root):
        functions.extend(functions_in(path, root, counts))
    if not functions:
        raise SystemExit("Python benchmark has no production functions")
    summary = {
        "functions": len(functions),
        "pass": sum(row["status"] == "pass" for row in functions),
        "warn": sum(row["status"] == "warn" for row in functions),
        "fail": sum(row["status"] == "fail" for row in functions),
        "unmapped": 0,
    }
    print(json.dumps({
        "protocol": "foundation-quality-v1",
        "collector": "openspec-native-python-stdlib-quality-v1",
        "summary": summary,
        "functions": functions,
    }))


if __name__ == "__main__":
    main()
