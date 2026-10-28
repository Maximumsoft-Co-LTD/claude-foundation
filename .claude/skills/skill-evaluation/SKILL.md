---
name: skill-evaluation
description: "Use when comparing a changed skill or description against its old version on real runs. Skip static catalog checks (skill-suite-auditor)."
---

# Skill evaluation

Compare actual transcripts and artifacts; candidate self-reports and reviewer
vote counts are not proof.

## Steps

1. Name the changed behavior, baseline (old version or no skill), task inputs,
   success criteria, and host capabilities. Pin both variants before running.
2. Author positive, negative, and ambiguous prompts (Thai too when supported);
   keep expected routes and grading out of candidate inputs.
3. Run matched variants with the same inputs and settings in isolated outputs,
   within host policy, concurrency, permissions, and budget. Never mutate a
   live user's data or infer authority from a fixture prompt.
4. Grade actions, transcripts, and artifacts: false triggers, missed triggers,
   scope escapes, evidence gaps.
5. Report per-case outcomes, repetitions, measured usage and time, uncertainty,
   regressions, and a promotion recommendation. Missing runs or costs stay unknown.

## Harness

Static checks are not model evaluations. Keep results outside shipped files.
Shipped edits follow Change Loop; only its providers can establish proof.

## References

- `references/procedure.md` — design, execution, and promotion safeguards.
- `references/evaluation-cases.json` — catalog example cases.
- Use `skill-creator` to author accepted changes.
