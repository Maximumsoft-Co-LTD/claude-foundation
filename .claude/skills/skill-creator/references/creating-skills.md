# Creating a skill

Companion to the "Creating a skill" phase of [[skill-creator]]: interview →
draft → anatomy → writing style → test cases.

## Capture intent

The conversation often already contains the workflow to capture ("turn this
into a skill"). Extract what it shows first — tools used, step sequence, the
user's corrections, observed input/output formats — and reuse settled
authorization and examples. Ask only for missing consequential choices; never
re-confirm the same request. The open questions are usually: what should this
skill enable, which phrases or contexts should trigger it, what output format
is expected, and whether its outputs are objectively verifiable enough to
deserve test cases (file transforms, data extraction, code generation, fixed
workflows yes; writing style or art usually not). Suggest the default for the
skill type and let the user decide.

Probe edge cases, formats, example files, success criteria, and dependencies
before drafting test prompts. Research through available authorized tools when
it reduces the user's burden; host policy and harness dispatch own worker
execution.

## Write the SKILL.md

- **name** — the skill identifier.
- **description** — what the skill does, realistic positive triggers,
  exclusions, and the neighboring owner. Keep it selection metadata: broad
  keyword capture pulls the skill into unrelated work, and a description never
  grants authority.
- **compatibility** — required tools or dependencies; rarely needed.
- Then the body.

## Anatomy and progressive disclosure

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled resources (optional)
    ├── scripts/    - executable code for deterministic, repetitive tasks
    ├── references/ - docs loaded into context as needed
    └── assets/     - files used in output (templates, icons, fonts)
```

Three loading levels: metadata is always in context (~100 words), the body
loads when the skill triggers (well under 500 lines), bundled resources load
only when needed and scripts can execute without being read. Point at each
reference with the condition for reading it, give a reference over 300 lines a
table of contents, and when a skill spans variants organize by variant
(one file per cloud, framework, or language under `references/`) so only the
relevant file loads.

## Lack of surprise

A skill must not contain malware, exploit code, or anything that would surprise
the user reading a description of what it does. Do not create misleading skills
or skills built for unauthorized access or data exfiltration. Roleplay-style
skills are fine.

## Writing style

Use the imperative. Explain *why* something matters instead of stacking MUSTs,
prefer general guidance over narrow examples, and review a draft with fresh
eyes. State an output format as an exact template, and format examples as
input → output pairs when that is clearer than prose.

## Test cases

Draft realistic positive, negative, and ambiguous cases, reusing settled
examples and asking only about unresolved consequential behavior. Use
skill-evaluation before any model runs.

Save proposed cases in the approved scratch evaluation scope, outside the
managed catalog, and state observable expectations before running. Read
[evaluation procedure](../../skill-evaluation/references/procedure.md) for
baseline, runner, budget, and grading boundaries.

```json
{
  "skill_name": "example-skill",
  "evals": [
    { "id": 1, "prompt": "User's task prompt", "expected_output": "Description of expected result", "files": [] }
  ]
}
```

See [schemas](schemas.md) for the full schema, including the `assertions` field
added later.
