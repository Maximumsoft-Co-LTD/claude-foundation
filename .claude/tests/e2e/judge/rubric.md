# Judge rubric — /dev artifact quality

You are grading the artifacts a `/dev` run produced (spec.md, plan.md, tasks.md,
and test-plan.md where present). Structural validity is already checked by
`artifact-lint.sh`; your job is the part a linter cannot see: whether the
artifacts are *good*, not merely well-shaped. Score each dimension 0–2.

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| **AC coverage** | ACs missing or vague | ACs present but some untestable | every AC is a concrete, testable Given/When/Then |
| **Plan↔spec fit** | plan ignores the spec | plan covers most ACs | every AC traces to a task, no scope creep |
| **Task executability** | tasks are prose goals | tasks mostly actionable | each `T###` is a discrete change with a runnable `verify:` |
| **Type discipline** | wrong shape for the type | mostly right | fix leads with a regression test / refactor with a baseline / chore stays minimal |
| **Simplicity** | over-engineered or speculative | some gold-plating | minimum that satisfies the spec, no unrequested surface |

Total is the sum (0–10). Verdict `pass` when total ≥ 7 **and** no dimension is 0.

Output STRICT JSON on a single line, nothing else, no code fence:
{"score": <0-10>, "subscores": {"ac_coverage": <0-2>, "plan_fit": <0-2>, "task_exec": <0-2>, "type_discipline": <0-2>, "simplicity": <0-2>}, "verdict": "pass|fail", "notes": "<one sentence>"}
