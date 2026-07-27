# Product brief — claude-foundation

Source material for the landing page. Both benchmark arms get this identical file
(seeded into the sandbox), so neither arm has an information advantage.

## What it is

An opinionated command workflow for Claude Code, aimed at AI engineers. It packages
reusable slash commands, sub-agents, hooks, and skills so any repo can adopt a
spec-driven development pipeline instead of ad-hoc prompting.

## Value proposition

Turn a rough intent into shipped, reviewed, tested code — with a human approval gate
in the middle and a resumable audit trail throughout.

## Key features

- **The `/dev` pipeline** — two phases: Requirements (interview → spec → plan → test
  plan → human gate) then Implementation (implement → test → review → security →
  docs → ship → retro). Every run lives in its own `.workflow/<id>/` folder.
- **Sub-agents** — `pm` writes the spec, `lead` plans and reviews, `engineer`
  implements and ships, `qa` designs and runs the tests, `retro` closes the run.
  Each is pinned to a model tier for cost/speed.
- **Hooks** — shell guards on tool calls: a spawn guard, a state-integrity check, a
  secrets-read blocker, and a linter that runs after every edit.
- **Skills** — on-demand engineering playbooks (programming, testing, debugging,
  security, database, API design, git workflow, and more) routed by an always-on
  rules layer.
- **Team mode** — run one role at a time (`/spec`, `/dev-plan`, `/test-plan`,
  `/uxui-plan`, `/implement`) into the same run folder, in parallel.
- **Type- and size-aware** — a `chore` does not get dragged through e2e; a `fix`
  reproduces with a failing test before it changes anything; an XS change takes a
  single-artifact micro-lane instead of the full ceremony.
- **Resumable** — every step writes `state.json`, so `/dev --resume <id>` continues
  a dead run from its cursor.

## Install

```sh
brew install hashtagf/tap/claude-foundation
```

Then run `/dev <intent>` inside any repo.

## Audience and tone

Engineers who use Claude Code as their primary development surface. Tone: technical,
concrete, no marketing fluff. Show the pipeline, not adjectives.
