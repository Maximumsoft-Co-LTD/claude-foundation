# Skill catalog trigger evaluation — 2026-10-27

**Status:** dated evidence for change `skill-catalog-agent-skill`. It records
what was observed on the two sources named below; it is not a current-status
document and must not be refreshed in place.

## Question

Does the simplified skill catalog (short trigger descriptions, minimal
`SKILL.md` bodies, pruned references) make a Claude Code agent load the right
skill more often than the catalog at `281caac1b`, without loading skills it
should not?

## Method

- **Cases:** the positive and negative prompt of every non-lifecycle skill in
  `.claude/skills/skill-evaluation/references/evaluation-cases.json` (32 skills,
  64 prompts). Lifecycle skills (`change`, `build`, `prove`, `land`,
  `investigate`, `dev`, `feature`, `changes`) are out of scope and were not run.
  The cases file itself stays `execution: not-run`; this report is the record.
- **Arms:** `baseline` = a clean `git worktree` of `281caac1b`; `candidate` =
  the Build sandbox of this change after T002–T006.
- **Runner:** `claude -p "<prompt>" --output-format stream-json --verbose
  --model claude-sonnet-5-5 --allowedTools Skill Read`, cwd = the arm's checkout,
  `CLAUDECODE` unset, 150 s timeout, 5 concurrent, 2 repetitions per prompt.
  A run counts a skill as loaded when the agent calls the `Skill` tool with its
  name or `Read`s a file under `.claude/skills/<name>/`. Other tools are not
  allowed, so a run ends at the first non-Skill/Read decision.
- **Pass rule:** positive prompt passes when the expected skill is loaded;
  negative prompt passes when the skill under test is **not** loaded. A run
  that times out or errors is `not-run`, never a pass.
- **Cost:** `total_cost_usd` as reported by `claude -p`; unknown stays unknown.
- **Raw evidence:** the per-run JSON and logs (`baseline.json`,
  `baseline-b.json`, `candidate.json`, reruns, `run-all-*.log`) and the runner
  (`run.mjs`, `merge.mjs`, `report.mjs`) lived in the Build sandbox's gitignored
  `.foundation/skill-eval/`. Land archived the change and removed that sandbox
  before the files were copied out, so they are **not retained**; the per-case
  tables in this report are the surviving record. The runner was ~90 lines:
  spawn `claude -p <prompt> --output-format stream-json --verbose --model
  claude-sonnet-5-5 --allowedTools Skill Read` per prompt with `CLAUDECODE`
  unset, parse `assistant` events for `Skill` calls and `Read`s under
  `.claude/skills/<name>/`, 150 s kill timeout, N workers, 2 reps.
- **Limits:** one model, one host (Claude Code 2.1.311), prompts are one line
  with no repository context; the judge is a deterministic tool-call check, not
  a human reading. Two repetitions separate 0/2 from 2/2 but not 1/2 noise.

## Baseline

Source `281caac1b` (clean worktree), model `claude-sonnet-5-5`, 2 reps × 64
prompts = 128 runs, 2026-10-27 13:31–13:46 UTC plus a 16-run rerun of the four
cases that timed out (claude-md, delivery-engineering, init-project-docs,
skill-suite-auditor; 13:50–13:53 UTC). After the rerun 3 runs remain
`not-run` (delivery-engineering positive ×2 timed out twice; skill-suite-auditor
negative ×1).

- Positive prompts: **27/62 pass** (missed trigger 35). 12 of 32 skills
  were loaded on both repetitions, 3 on one, 16 never, and 1 (delivery-engineering)
  is unknown.
- Negative prompts: **63/63 pass** (false trigger 0) — when the agent loaded a
  skill it was the neighbouring one the case expects, never the skill under
  test.
- Runs that loaded any skill at all: 58/128.
- Cost: unknown (`total_cost_usd` was absent on the timed-out runs; the
  completed runs averaged ≈ US$0.21 in the probe).

| case | kind | expected | baseline 281caac1b loaded (pass) |
|---|---|---|---|
| api-design-fundamentals | negative | not api-design-fundamentals | —, — (2/2) |
| api-design-fundamentals | positive | api-design-fundamentals | api-design-fundamentals, — (1/2) |
| architecture-fundamentals | negative | not architecture-fundamentals | —, — (2/2) |
| architecture-fundamentals | positive | architecture-fundamentals | —, — (0/2) |
| brainstorming | negative | not brainstorming | —, — (2/2) |
| brainstorming | positive | brainstorming | —, — (0/2) |
| change-impact-analysis | negative | not change-impact-analysis | —, — (2/2) |
| change-impact-analysis | positive | change-impact-analysis | —, — (0/2) |
| claude-md | negative | not claude-md | init-project-docs, init-project-docs (2/2) |
| claude-md | positive | claude-md | claude-md, claude-md (2/2) |
| coding-discipline | negative | not coding-discipline | —, — (2/2) |
| coding-discipline | positive | coding-discipline | —, — (0/2) |
| concurrency-fundamentals | negative | not concurrency-fundamentals | queue-fundamentals, queue-fundamentals (2/2) |
| concurrency-fundamentals | positive | concurrency-fundamentals | concurrency-fundamentals, — (1/2) |
| database-fundamentals | negative | not database-fundamentals | performance-investigation, performance-investigation (2/2) |
| database-fundamentals | positive | database-fundamentals | —, — (0/2) |
| ddd-strategic | negative | not ddd-strategic | architecture-fundamentals, architecture-fundamentals (2/2) |
| ddd-strategic | positive | ddd-strategic | ddd-strategic, ddd-strategic (2/2) |
| debug-fundamentals | negative | not debug-fundamentals | performance-investigation, — (2/2) |
| debug-fundamentals | positive | debug-fundamentals | —, — (0/2) |
| delivery-engineering | negative | not delivery-engineering | —, — (2/2) |
| delivery-engineering | positive | delivery-engineering |  (0/0, not-run 2) |
| frontend-design | negative | not frontend-design | —, — (2/2) |
| frontend-design | positive | frontend-design | —, — (0/2) |
| git-workflow | negative | not git-workflow | land, — (2/2) |
| git-workflow | positive | git-workflow | —, — (0/2) |
| grill-task-gu-please | negative | not grill-task-gu-please | grill-task-gu, grill-task-gu (2/2) |
| grill-task-gu-please | positive | grill-task-gu-please | grill-task-gu+grill-task-gu-please, grill-task-gu+grill-task-gu-please (2/2) |
| grill-task-gu | negative | not grill-task-gu | —, — (2/2) |
| grill-task-gu | positive | grill-task-gu | grill-task-gu, grill-task-gu (2/2) |
| harness-html-report | negative | not harness-html-report | —, — (2/2) |
| harness-html-report | positive | harness-html-report | harness-html-report, harness-html-report (2/2) |
| hexagonal-backend | negative | not hexagonal-backend | architecture-fundamentals, architecture-fundamentals (2/2) |
| hexagonal-backend | positive | hexagonal-backend | hexagonal-backend, hexagonal-backend (2/2) |
| init-project-docs | negative | not init-project-docs | claude-md, claude-md (2/2) |
| init-project-docs | positive | init-project-docs | init-project-docs, init-project-docs (2/2) |
| observability-fundamentals | negative | not observability-fundamentals | performance-investigation, performance-investigation (2/2) |
| observability-fundamentals | positive | observability-fundamentals | observability-fundamentals, observability-fundamentals (2/2) |
| performance-investigation | negative | not performance-investigation | —, — (2/2) |
| performance-investigation | positive | performance-investigation | performance-investigation, performance-investigation (2/2) |
| plan-writing | negative | not plan-writing | change-impact-analysis, change-impact-analysis (2/2) |
| plan-writing | positive | plan-writing | —, — (0/2) |
| programming-fundamentals | negative | not programming-fundamentals | architecture-fundamentals, — (2/2) |
| programming-fundamentals | positive | programming-fundamentals | —, — (0/2) |
| queue-fundamentals | negative | not queue-fundamentals | —, — (2/2) |
| queue-fundamentals | positive | queue-fundamentals | queue-fundamentals, queue-fundamentals (2/2) |
| refactoring-fundamentals | negative | not refactoring-fundamentals | —, — (2/2) |
| refactoring-fundamentals | positive | refactoring-fundamentals | —, — (0/2) |
| security-fundamentals | negative | not security-fundamentals | —, — (2/2) |
| security-fundamentals | positive | security-fundamentals | —, — (0/2) |
| skill-creator | negative | not skill-creator | skill-suite-auditor, skill-suite-auditor (2/2) |
| skill-creator | positive | skill-creator | —, — (0/2) |
| skill-evaluation | negative | not skill-evaluation | skill-suite-auditor, — (2/2) |
| skill-evaluation | positive | skill-evaluation | —, skill-evaluation (1/2) |
| skill-suite-auditor | negative | not skill-suite-auditor | skill-evaluation (1/1, not-run 1) |
| skill-suite-auditor | positive | skill-suite-auditor | skill-suite-auditor, skill-suite-auditor (2/2) |
| tailwind-design-system | negative | not tailwind-design-system | —, — (2/2) |
| tailwind-design-system | positive | tailwind-design-system | —, — (0/2) |
| testing-fundamentals | negative | not testing-fundamentals | prove, prove (2/2) |
| testing-fundamentals | positive | testing-fundamentals | —, — (0/2) |
| ui-ux-pro-max | negative | not ui-ux-pro-max | ux-ui-principles, ux-ui-principles (2/2) |
| ui-ux-pro-max | positive | ui-ux-pro-max | ui-ux-pro-max, ui-ux-pro-max (2/2) |
| ux-ui-principles | negative | not ux-ui-principles | —, — (2/2) |
| ux-ui-principles | positive | ux-ui-principles | —, — (0/2) |

Observation recorded during the run: the `claude-md` positive prompt made the
agent write a `CLAUDE.md` into the evaluation checkout even though only `Skill`
and `Read` were allow-listed; the file was reverted. Every arm therefore runs
in a disposable checkout, never in the Build sandbox itself.

## Candidate

Source: the Build sandbox of `skill-catalog-agent-skill` after T002–T006
(32 rewritten `SKILL.md`, `.claude/rules/fundamentals.md`, references pruned
14,048 → 8,396 lines), copied into a disposable worktree of `281caac1b` so the
run could not write into the sandbox. Same model, prompts, runner, and
repetitions as the baseline; 14:52–15:36 UTC plus a 28-run rerun of the seven
cases that timed out (15:38–15:43 UTC). After the rerun 3 runs remain
`not-run` (delivery-engineering positive ×2 — timed out in all four attempts
across both arms; grill-task-gu negative ×1).

- Positive prompts: **34/62 pass** (missed trigger 28) versus 27/62 (missed 35)
  at baseline.
- Negative prompts: **63/63 pass** (false trigger 0) — unchanged.
- Runs that loaded any skill: 62/128 versus 58/128.
- Cost: unknown (timed-out runs report no cost; completed runs averaged
  ≈ US$0.16–0.21).

Per-skill movement on the positive prompt (runs loading the expected skill, of 2):

| Change | Skills |
|---|---|
| 0 → 2 | architecture-fundamentals |
| 1 → 2 | api-design-fundamentals, concurrency-fundamentals, skill-evaluation |
| 0 → 1 | database-fundamentals, debug-fundamentals, tailwind-design-system |
| 2 → 2 (unchanged) | claude-md, ddd-strategic, grill-task-gu, grill-task-gu-please, harness-html-report, hexagonal-backend, init-project-docs, observability-fundamentals, performance-investigation, queue-fundamentals, ui-ux-pro-max |
| 2 → 1 | skill-suite-auditor (one candidate run loaded 14 skills including the expected one; the other loaded none) |
| 0 → 0 (still never loaded) | brainstorming, change-impact-analysis, coding-discipline, frontend-design, git-workflow, plan-writing, programming-fundamentals, refactoring-fundamentals, security-fundamentals, skill-creator, testing-fundamentals, ux-ui-principles |

For the twelve skills that stay at 0, the transcripts show the agent answering
or asking a clarifying question without loading any skill; the one-line
catalog prompts (for example "Rename a private helper without changing
behavior.") carry no repository context, so the shorter descriptions alone did
not change that decision. This is a limit of the case set, not evidence that
those descriptions are wrong, and it is the same in both arms.

Negative prompts that changed which neighbouring skill was loaded (all still
pass): performance-investigation now loads observability-fundamentals (was
none); queue-fundamentals now loads concurrency-fundamentals (was none);
observability-fundamentals, plan-writing, and init-project-docs now load none
(were performance-investigation, change-impact-analysis, claude-md).

| case | kind | expected | baseline 281caac1b loaded (pass) | candidate loaded (pass) |
|---|---|---|---|---|
| api-design-fundamentals | negative | not api-design-fundamentals | —, — (2/2) | —, — (2/2) |
| api-design-fundamentals | positive | api-design-fundamentals | api-design-fundamentals, — (1/2) | api-design-fundamentals, api-design-fundamentals (2/2) |
| architecture-fundamentals | negative | not architecture-fundamentals | —, — (2/2) | —, — (2/2) |
| architecture-fundamentals | positive | architecture-fundamentals | —, — (0/2) | architecture-fundamentals, architecture-fundamentals (2/2) |
| brainstorming | negative | not brainstorming | —, — (2/2) | —, — (2/2) |
| brainstorming | positive | brainstorming | —, — (0/2) | —, — (0/2) |
| change-impact-analysis | negative | not change-impact-analysis | —, — (2/2) | —, — (2/2) |
| change-impact-analysis | positive | change-impact-analysis | —, — (0/2) | —, — (0/2) |
| claude-md | negative | not claude-md | init-project-docs, init-project-docs (2/2) | init-project-docs, init-project-docs (2/2) |
| claude-md | positive | claude-md | claude-md, claude-md (2/2) | claude-md, claude-md (2/2) |
| coding-discipline | negative | not coding-discipline | —, — (2/2) | —, — (2/2) |
| coding-discipline | positive | coding-discipline | —, — (0/2) | —, — (0/2) |
| concurrency-fundamentals | negative | not concurrency-fundamentals | queue-fundamentals, queue-fundamentals (2/2) | queue-fundamentals, queue-fundamentals (2/2) |
| concurrency-fundamentals | positive | concurrency-fundamentals | concurrency-fundamentals, — (1/2) | concurrency-fundamentals, concurrency-fundamentals (2/2) |
| database-fundamentals | negative | not database-fundamentals | performance-investigation, performance-investigation (2/2) | performance-investigation, — (2/2) |
| database-fundamentals | positive | database-fundamentals | —, — (0/2) | database-fundamentals, — (1/2) |
| ddd-strategic | negative | not ddd-strategic | architecture-fundamentals, architecture-fundamentals (2/2) | architecture-fundamentals, architecture-fundamentals (2/2) |
| ddd-strategic | positive | ddd-strategic | ddd-strategic, ddd-strategic (2/2) | ddd-strategic, ddd-strategic (2/2) |
| debug-fundamentals | negative | not debug-fundamentals | performance-investigation, — (2/2) | —, — (2/2) |
| debug-fundamentals | positive | debug-fundamentals | —, — (0/2) | debug-fundamentals, — (1/2) |
| delivery-engineering | negative | not delivery-engineering | —, — (2/2) | —, — (2/2) |
| delivery-engineering | positive | delivery-engineering |  (0/0, not-run 2) |  (0/0, not-run 2) |
| frontend-design | negative | not frontend-design | —, — (2/2) | —, — (2/2) |
| frontend-design | positive | frontend-design | —, — (0/2) | —, — (0/2) |
| git-workflow | negative | not git-workflow | land, — (2/2) | land, land (2/2) |
| git-workflow | positive | git-workflow | —, — (0/2) | —, — (0/2) |
| grill-task-gu-please | negative | not grill-task-gu-please | grill-task-gu, grill-task-gu (2/2) | grill-task-gu, grill-task-gu (2/2) |
| grill-task-gu-please | positive | grill-task-gu-please | grill-task-gu+grill-task-gu-please, grill-task-gu+grill-task-gu-please (2/2) | grill-task-gu+grill-task-gu-please, grill-task-gu+grill-task-gu-please (2/2) |
| grill-task-gu | negative | not grill-task-gu | —, — (2/2) | — (1/1, not-run 1) |
| grill-task-gu | positive | grill-task-gu | grill-task-gu, grill-task-gu (2/2) | grill-task-gu, grill-task-gu (2/2) |
| harness-html-report | negative | not harness-html-report | —, — (2/2) | prove, — (2/2) |
| harness-html-report | positive | harness-html-report | harness-html-report, harness-html-report (2/2) | harness-html-report, harness-html-report (2/2) |
| hexagonal-backend | negative | not hexagonal-backend | architecture-fundamentals, architecture-fundamentals (2/2) | architecture-fundamentals, architecture-fundamentals (2/2) |
| hexagonal-backend | positive | hexagonal-backend | hexagonal-backend, hexagonal-backend (2/2) | hexagonal-backend, hexagonal-backend (2/2) |
| init-project-docs | negative | not init-project-docs | claude-md, claude-md (2/2) | —, — (2/2) |
| init-project-docs | positive | init-project-docs | init-project-docs, init-project-docs (2/2) | init-project-docs, init-project-docs (2/2) |
| observability-fundamentals | negative | not observability-fundamentals | performance-investigation, performance-investigation (2/2) | —, — (2/2) |
| observability-fundamentals | positive | observability-fundamentals | observability-fundamentals, observability-fundamentals (2/2) | observability-fundamentals, observability-fundamentals (2/2) |
| performance-investigation | negative | not performance-investigation | —, — (2/2) | observability-fundamentals, observability-fundamentals (2/2) |
| performance-investigation | positive | performance-investigation | performance-investigation, performance-investigation (2/2) | performance-investigation, performance-investigation (2/2) |
| plan-writing | negative | not plan-writing | change-impact-analysis, change-impact-analysis (2/2) | —, — (2/2) |
| plan-writing | positive | plan-writing | —, — (0/2) | —, — (0/2) |
| programming-fundamentals | negative | not programming-fundamentals | architecture-fundamentals, — (2/2) | architecture-fundamentals, architecture-fundamentals (2/2) |
| programming-fundamentals | positive | programming-fundamentals | —, — (0/2) | —, — (0/2) |
| queue-fundamentals | negative | not queue-fundamentals | —, — (2/2) | concurrency-fundamentals, concurrency-fundamentals (2/2) |
| queue-fundamentals | positive | queue-fundamentals | queue-fundamentals, queue-fundamentals (2/2) | queue-fundamentals, queue-fundamentals (2/2) |
| refactoring-fundamentals | negative | not refactoring-fundamentals | —, — (2/2) | —, — (2/2) |
| refactoring-fundamentals | positive | refactoring-fundamentals | —, — (0/2) | —, — (0/2) |
| security-fundamentals | negative | not security-fundamentals | —, — (2/2) | —, — (2/2) |
| security-fundamentals | positive | security-fundamentals | —, — (0/2) | —, — (0/2) |
| skill-creator | negative | not skill-creator | skill-suite-auditor, skill-suite-auditor (2/2) | build+grill-task-gu-please+skill-suite-auditor, skill-suite-auditor (2/2) |
| skill-creator | positive | skill-creator | —, — (0/2) | —, — (0/2) |
| skill-evaluation | negative | not skill-evaluation | skill-suite-auditor, — (2/2) | skill-suite-auditor, skill-suite-auditor (2/2) |
| skill-evaluation | positive | skill-evaluation | —, skill-evaluation (1/2) | skill-evaluation, skill-evaluation (2/2) |
| skill-suite-auditor | negative | not skill-suite-auditor | skill-evaluation (1/1, not-run 1) | skill-evaluation, skill-evaluation (2/2) |
| skill-suite-auditor | positive | skill-suite-auditor | skill-suite-auditor, skill-suite-auditor (2/2) | brainstorming+build+change+coding-discipline+dev+feature+git-workflow+grill-task-gu+grill-task-gu-please+investigate+land+plan-writing+skill-suite-auditor+testing-fundamentals, — (1/2) |
| tailwind-design-system | negative | not tailwind-design-system | —, — (2/2) | —, — (2/2) |
| tailwind-design-system | positive | tailwind-design-system | —, — (0/2) | —, tailwind-design-system (1/2) |
| testing-fundamentals | negative | not testing-fundamentals | prove, prove (2/2) | —, prove (2/2) |
| testing-fundamentals | positive | testing-fundamentals | —, — (0/2) | —, — (0/2) |
| ui-ux-pro-max | negative | not ui-ux-pro-max | ux-ui-principles, ux-ui-principles (2/2) | —, ux-ui-principles (2/2) |
| ui-ux-pro-max | positive | ui-ux-pro-max | ui-ux-pro-max, ui-ux-pro-max (2/2) | ui-ux-pro-max, ui-ux-pro-max (2/2) |
| ux-ui-principles | negative | not ux-ui-principles | —, — (2/2) | —, — (2/2) |
| ux-ui-principles | positive | ux-ui-principles | —, — (0/2) | —, — (0/2) |

## Replication of the baseline

A second, unintended baseline pass ran on the same worktree (13:45–14:33 UTC;
the runner was invoked twice). It is kept as `baseline-b.json` and reported
here as a noise estimate, not merged: 107 ok, 21 not-run (it overlapped with
the deterministic suite and the first candidate attempt, which raised timeouts);
positive 26/53 (missed 27, 51 %), negative 54/54, any-skill 56/128. The two
baseline passes therefore sit at 44 % and 49 % positive pass; the candidate's
55 % is above both, but the gap to the second pass is within what two
repetitions can resolve.

## Deterministic suite

`bash .claude/tests/run-all.sh` on the candidate sandbox at its final tree
(after every reviewer-driven edit below), run alone with the host load average
under 10: `foundation tests: ALL SUITES PASS (254 suites, 24-way, full)`, exit 0
(run 8, 2026-10-28). Runs 5–7 on the same or near-final tree each lost one or
more suites to 300 s timeouts or killed subprocesses while the host load
average was 30–480 from unrelated processes (`openspec native benchmark`,
`installer smoke`, and others); each of those suites passed when rerun alone
(sentinel 320 s, installer 321/321). Two earlier runs failed only
because they overlapped with the evaluation arms (300 s suite timeouts) or
because two test pins the rewrite had dropped (`Assignee and date are
non-blocking unless --schedule` in grill-task-gu; `performance, capacity,
availability` in brainstorming) were restored before this run. The first AI review (claude-opus, 2026-10-28) returned six findings; all were
applied before the final suite run: description-length assertions now name the
skill; a catalog-wide forbidden-instruction scan, a body-shape check (Steps /
Harness ≤ 3 lines / References, ≤ 250 words, description ≤ 40 words with a
skip clause), and a sibling/cross-bundle link check were added to
`skill-catalog.test.mjs` (the link check found two dangling cross-bundle
mentions, now real links); hexagonal-backend lost its extra section and five
Harness sections were trimmed to three lines; the canonical `skill-guidance`
scenario that named the deleted `programming-fundamentals/references/testing.md`
was amended; and two counts in this report were corrected. Focused checks on
the final tree: context budgets 227/227, doc consistency 144/144,
skill-catalog 27/27 + skill-routing 1/1, reference governance clean,
`git diff --check` clean, references 8,397 lines.

## Regression

**REGRESSION: no.**

- Missed triggers: candidate 28 < baseline 35 (and < 27-of-53 in the
  replication, by rate: 45 % versus 51 %). Seven skills improved, one
  (skill-suite-auditor) lost one of two runs, none fell to zero.
- False triggers: 0 in every arm.
- Not-run: 3 in each arm after the reruns; delivery-engineering's positive
  prompt never completed within 150 s in any of four attempts per arm and stays
  unknown for both.
- An earlier candidate attempt (14:32–14:40 UTC) produced 118 `is_error`
  results in seven minutes while the full deterministic suite and the second
  baseline pass were running; a single probe afterwards succeeded, and the full
  rerun above completed normally. That attempt is retained as evidence of the
  host failure mode and is not counted.

What this does not show: that the agent loads the right skill in a real
repository session, or that the pruned references lose nothing an agent needed.
The deterministic suite (pin tests, reference governance, context budgets) is
the evidence for the latter; this report only covers the trigger decision on
the catalog's own one-line prompts.
