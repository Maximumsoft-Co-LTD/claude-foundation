---
title: Quickstart
description: Agree on one change, build and check it, then deliver it back to your project.
---

<!-- docs-audience: users -->
**Audience:** project users. This guide explains what to review and decide; the agent handles routine system operations.

This example lets an account owner edit their display name. Start with an
[installed project](/docs/install/) and open your coding agent there.
Enter the slash commands in the agent session, not in a terminal.

You decide the intended behavior, approve the agreement, review the result,
and authorize Land. The agent runs routine setup, checks, and recovery. For the
picture first, see [One change, start to finish](/docs/journey/).

## 0. Check the project is ready

Ask the agent to check that Change Loop is ready. It can run
`claude-foundation doctor --stage change` and resolve setup problems.
You do not need to configure optional quality gates for this first example.

If the cause or desired behavior is unclear, start with
`/investigate <question>` before creating a change.

## 1. Agree on the change

```text
/change allow an account owner to edit their display name
```

The agent investigates the existing behavior and writes an agreement under
`openspec/changes/<change-id>/`. Use the ID it returns in the remaining steps.

Read the proposal and relevant scenarios. Check:

- Who may change the name, and what inputs are allowed?
- What happens on invalid input or a failed save?
- What is in scope, and how will the result be checked?

Approve the compiled agreement before Build. Tell the agent about corrections
here; you do not have to write the internal draft or evidence configuration.

**You should see:** a change ID, an approval question, and a link to a readable
approval package with scope, scenarios, and risk.

## 2. Build it in isolation

```text
/build <change-id>
```

The agent implements code and tests in an isolated workspace. It handles
routine commands and repair, and asks when a consequential decision is needed.
Implementation stays in isolation until Land.

Build can continue into proof automatically. If it already reached `proven`,
read the result rather than requesting a fresh run of the same checks.

**You should see:** progress, then either state `proven` or a question that
needs your decision.

## 3. Prove it

```text
/prove <change-id>
```

Use this to resume proof if work remains. The harness runs your project's tools,
reuses valid evidence, and reports what passed, failed, or could not be checked.
The agent fixes repairable findings and reruns checks affected by its edits.

Review the summary and diff. An inconclusive or unavailable check is not a pass.
If subjective acceptance was requested, inspect the result and give that
decision separately from approval of the original spec.

**You should see:** a summary of what passed, failed, or could not be checked,
and the state `proven` once everything required passes.

## 4. Land it

When you want the current change applied to your project, explicitly say so:

```text
/land <change-id>
```

The harness applies the current isolated work, synchronizes specs, and archives
the change. It preserves unrelated edits and leaves the delivered diff
**uncommitted**, with Git HEAD and index unchanged.

**You should see:** state `archived`, and the change as an uncommitted diff in
`git status`.

Only `archived` means code delivery is complete. It does not mean deployment
or production verification. Land alone never commits, pushes, or opens a PR.

Land is the single hard gate: it lands only a passing proof of the current
workspace and proves again first when that proof is stale. Before Land, the
agent stops only for your decisions. Conflicting target edits must be
resolved before apply. See [Land](/docs/loop/land/) for the detailed rules.

## Moving backward

If the requirement changes, tell the agent while keeping the same change ID.
It amends the agreement and rechecks affected work. If a session or Land is
interrupted, ask the agent to resume the existing change; do not recreate it
or edit runtime records by hand.

## Checking on things

```text
/changes
```

This lists active changes, blockers, and the next action without changing state.

## When a change cannot be proven

The agent reports what is missing and the available choices. You may request
further work, pause, or waive a check you decide is not required (a recorded
decision; it never turns a failure into a pass).
Retiring a change is also an explicit decision; let the agent perform the
supported recovery rather than deleting files.

See [human approval](/docs/approval/) and the
[lifecycle reference](https://github.com/Maximumsoft-Co-LTD/claude-foundation/blob/main/WORKFLOW.md)
for the exact authority and recovery contract.

## Next steps

- [Deliver a PR](/docs/cli/) — `/deliver <change-id>` separately authorizes
  isolated commit, branch push, and PR delivery; it does not merge or deploy.
- [Files created by Change Loop](/docs/artifacts/) — what belongs to you and
  what the harness manages.
- [Multiple repositories](/docs/multi-repository/) — declare scope before
  starting work across repositories.
- [Consumer quality gates](/docs/consumer-quality/) — optional checks to
  configure after the basic workflow is working.
