# Interview replay

Drives a headless `/dev` run through its **real interview** and its **real gate**,
answering both from a bank recorded off an actual interactive session.

```sh
sh run-interview-tests.sh                      # deterministic, free (in run-all.sh)
sh run-replay.sh                               # dry-run: print the plan
sh run-replay.sh --run                         # live
sh run-replay.sh --run --gate reject           # the path --yes cannot reach
sh capture-interview.sh --list                 # find a session to capture
```

## The gap this closes

`/dev` Phase 1 asks the user questions with `AskUserQuestion`, and a headless
`claude -p` has no UI to answer it. So every other live prompt in this repo is
written *"do not ask clarifying questions — assume …"* with the acceptance
criteria handed over inline. That makes the **interview a no-op by construction**.
The gate has the mirror problem: the benchmark passes `--yes`, so it
auto-approves and the **rejection branch has never executed**.

Those two mechanisms — ask before building, stop for a human before building —
are what distinguish a spec-driven workflow from vibe-coding. Until now the
harness measured everything *except* them.

## How it works

| Piece | Does |
|---|---|
| `capture-interview.sh` | Reads a session transcript and extracts every `AskUserQuestion` call with the option the human picked (`toolUseResult.answers`). No tokens — the interviews already happened and are on disk. |
| `replay-hook.sh` | `PreToolUse` hook on `AskUserQuestion`. Matches each asked question against the bank and hands back the recorded answer. |
| `run-replay.sh` | Builds a sandbox, registers the hook, runs `/dev` on a deliberately vague prompt **without `--yes`**, then asserts. |
| `run-interview-tests.sh` | Pins the matcher against canned payloads. Free, and in `run-all.sh`. |

The injection channel is the hook contract `dev-agent-guard.sh` already uses:
`{"decision":"block","reason":"…"}`. The reason is phrased exactly like the live
tool result — `Your questions have been answered: "<q>"="<a>". You can now
continue with these answers in mind.`

### The match ladder

Interview wording is regenerated every run, so exact-text matching alone would
miss almost everything. Each asked question resolves at the first rung that hits,
and the rung is written into the log:

| Rung | Matches on | Note |
|---|---|---|
| `exact` | identical question text | the only certain match |
| `header` | same header (`Scope`, `Storage`, …) | the workhorse — headers are short and stable |
| `option` | a recorded answer that appears verbatim among this question's options | catches a reworded question with a stable choice set |
| `fallback-first` | nothing — takes the first offered option | deterministic, so a replay never wedges |
| `miss` | nothing, and `CLAUDE_INTERVIEW_MISS=fail` | the run is told the bank has a hole |

**A bank entry is spent once.** Without that, one recorded answer would answer
every later question sharing its header — an interview asking "Scope" three times
would get the same reply three times and the run would read as fully covered when
the bank covered a third of it. Consumption is tracked through the log.

**A run answered mostly by `fallback-first` is not a replay.** It is a run handed
the first option every time, which is a much weaker test. `run-replay.sh` fails on
any fallback, and `--miss fail` makes the gap visible inside the run itself.

### Testing the gate

`CLAUDE_INTERVIEW_GATE=approve|reject` overrides the answer to a gate question
regardless of the bank. Gate detection is deliberately narrow (`gate`, `approve`,
`proceed with the plan`, `ready to implement`) — matching eagerly would let
`--gate approve` silently answer an ordinary design question with "approve", which
is worse than not forcing at all. A test pins that it does not hijack.

## What the log gives you

`replay-hook.sh` appends one JSONL line per question, and it is the first artifact
that can answer **"what did the interview actually ask?"** for a headless run:

```json
{"header":"Storage","question":"Where should the history live?",
 "answer":"localStorage alongside the task list","matched":"header",
 "bank_seq":3,"offlist":false}
```

`run-replay.sh` asserts on it: the interview fired · every question came from the
bank · `artifact-lint` clean · **`spec.md` mentions each chosen option** · the
gate decision was honoured.

That spec check is the other prize. "Does the spec reflect what the user said" was
previously unmeasurable; substring presence is a floor rather than proof of
comprehension, but a spec that never mentions the chosen option has plainly not
used it.

## The seam — read this before quoting a result

The hook **denies** `AskUserQuestion` and hands the answers back as the denial
reason. It does not *answer* the tool. The model therefore reads the recorded
answers as a blocked-tool explanation rather than as a genuine tool result.

Exercised for real:

- ✓ whether the orchestrator asks at all, and **what** it chooses to ask
- ✓ how many rounds the interview takes
- ✓ whether the spec it writes reflects the answers it was given
- ✓ the gate, **including reject**

Not exercised:

- ✗ the exact tool-result plumbing of one `AskUserQuestion` turn

The deterministic suite proves the hook's side of the contract byte-for-byte. The
one link no free test can prove is that Claude Code feeds a `PreToolUse` denial
reason back to the model *for this tool* — that costs one live run to confirm:

```sh
sh run-replay.sh --run --keep     # then read the printed interview log
```

If the log has lines but the spec ignores them, the channel is not reaching the
model and nothing downstream of that is trustworthy.

## Safety

`replay-hook.sh` is **inert unless `CLAUDE_INTERVIEW_BANK` is set** and points at
a parseable bank. This file can end up registered in a `settings.json` someone
later uses interactively, and a replay hook that answered a real human's questions
on their behalf would be a genuinely bad failure. Four tests pin the inert paths.

The sandbox also gets `rm -rf .claude/tests`, so the banks never travel with the
run — handing it the answers would let it skip the asking, the same answer-key
leak the benchmark hit for real (`bench/README.md`).

## Recording a real bank

The shipped bank is **hand-authored** — it encodes the decisions a real interview
on that prompt must reach, in the schema `capture-interview.sh` emits. A captured
bank is better, because it carries the wording a human actually chose:

```sh
sh capture-interview.sh --list
sh capture-interview.sh --transcript <session.jsonl> --out banks/<name>.json
```

Pair it with a prompt that stays **vague**. `run-interview-tests.sh` fails any
prompt containing `do not ask`, `assume:`, `acceptance:` or `(AC1` — the tempting
failure mode is to "fix" a flaky replay by adding the answers to the prompt, which
silently turns the interview back into a no-op and puts the harness right back
where it started.
