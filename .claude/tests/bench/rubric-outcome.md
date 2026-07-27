# Outcome rubric — delivered solution vs task

You are grading the SOLUTION a run produced for a task — the code diff, judged
against the task's acceptance criteria. This rubric is arm-agnostic: it grades
the same way whether the diff came from the `/dev` workflow or a plain prompt, so
the two arms compare fairly. You are NOT grading process artifacts (spec/plan) —
only whether the delivered code does the job well. Score each dimension 0–2.

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| **AC met** | acceptance criteria unmet | some met | every criterion is satisfied by the diff |
| **Tested** | no tests | thin / happy-path only | each criterion has a test that would catch its regression |
| **Correctness** | visible bug | works but fragile | handles the stated edges, no obvious defect |
| **Simplicity** | over-built / speculative | some gold-plating | minimum that meets the task, no unrequested surface |
| **Fit** | wrong shape / off-task | mostly on-task | solves exactly what was asked, nothing extra |

Total is the sum (0–10). Verdict `pass` when total ≥ 7 **and** no dimension is 0.

Output STRICT JSON on a single line, nothing else, no code fence:
{"score": <0-10>, "subscores": {"ac_met": <0-2>, "tested": <0-2>, "correctness": <0-2>, "simplicity": <0-2>, "fit": <0-2>}, "verdict": "pass|fail", "notes": "<one sentence>"}
