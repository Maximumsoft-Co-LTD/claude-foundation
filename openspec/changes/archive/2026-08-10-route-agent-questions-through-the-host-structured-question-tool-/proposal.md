# Rapid change: Route agent questions through the host structured question tool when available

## Why

When a Foundation-driven agent reaches a decision only the user can make, the
shipped rules have it ask in plain prose, so the user must type an answer.
Claude Code provides a structured question tool (AskUserQuestion) that renders
pickable options with the agent's recommendation first. User feedback asks
that agent questions arrive through that tool. Other hosts (Cursor) have no
such tool, so the rule must carry a plain-text fallback rather than assume
the tool exists.

## What Changes

- The always-on conduct digest (`.claude/rules/fundamentals.md`) directs
  decision questions through the host's structured question tool when the
  session provides one — options with the recommendation first — falling
  back to plain text otherwise.
- The `brainstorming` skill presents each question round through the same
  tool, one question per decision, closes the rounds only when every material
  decision has been asked and answered, and records each asked question with
  its chosen answer in the closing agreement carried into the change proposal.
- The conduct digest likewise requires verifying every open decision was
  asked and recording the answers in the change packet, not chat.
- The context-budget suite pins all of these rules so they cannot silently
  drop out.

## Eligibility

- **Impact:** low
- **Coupling:** isolated
- **Public contract:** no
- **Persistent migration:** no
- **Security trigger:** no
- **Irreversible effect:** no
