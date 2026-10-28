# Patterns: turn intent into behavior

Read for an active flow decision. These are synthesized project recommendations
unless a source or criterion is named; apply the relevant states, not a fixed
matrix to every element. Source IDs resolve in [sources.md](sources.md).

## Navigation and task continuity

Keep location and scope visible: current section, selected account/project,
filters, detail context. Use recognizable destination labels, predictable Back
behavior, and preserve URLs, list state, scroll, and inputs when returning from
a detail view. A visual tab is not always a navigation tab — choose semantics
from whether it changes a document or a panel. [S21] Keep common actions close
to the object they affect; progressive disclosure hides secondary options, not
the operator's main work. Use a dialog for a focused interruption with the APG
keyboard/focus contract; keep workflows that need history, deep links, or long
reading on pages. [S15]

## Forms and validation

- Ask only for needed information; explain unfamiliar requirements, mark
  optional fields, allow uncertainty when it is a meaningful answer, reuse
  answers within the journey. [S17]
- Group fields by the user's decision, not backend payload shape.
- Persistent labels and explicit formats; a placeholder is not the label.
  Permit valid international names/addresses.
- Keep input on failure. Do not validate an untouched field while typing. [S18]
- Explain the specific problem and correction in the field's terminology;
  separate user-correctable validation from outages or ineligibility. [S19] For
  long forms, pair inline errors with a linked error summary focused after a
  failed submission. [S20]
- Preserve valid input after server rejection or connection failure; explain
  conflicts without overwriting edits. For a blocked action, expose the unmet
  prerequisite without disclosing protected information.
- Before irreversible submission, expose consequences and offer a review step
  proportional to risk. Success says what completed and what happens next.

Example: a profile save fails because the network disappears. Keep the edits,
say saving failed, offer retry; never show "Saved" because the click landed.

## State specification

For each critical screen or control, assess these states and mark irrelevant
rows N/A with a reason.

| State | User question | Specification |
|---|---|---|
| Initial/default | What can I do? | Purpose, controls, required information |
| Hover/focus/pressed | Is this actionable? | Mouse, keyboard, and touch feedback |
| Selected/expanded | What is active? | Visible and programmatic state |
| Disabled | Why unavailable? | Reason or prerequisite; distinguish from loading |
| Loading/submitting | Did it start? | What is fetched; stable layout; duplicate-action handling; timeout/retry |
| Empty | Why no content? | First use vs no matches vs cleared; active constraints and a reset |
| Partial success | What worked? | Which items succeeded, failed-only recovery |
| Unknown result | Is it done? | Outcome unconfirmed; reconcile before resubmitting |
| Stale/offline | Can I trust this? | Timestamp, retained work, safe resolution of competing changes |
| Validation/service error | How do I recover? | Cause when known, retained work, safe retry |
| Success | Is it finished? | Result, persistence, next step |
| Permission denied | What access do I need? | Scope of the restriction and an authorized path |

Never display success before the operation is confirmed; use optimistic
feedback only when rollback is reliable. A timeout leaves the outcome unknown
and a blind retry can duplicate it. Reserve space for late content so controls
do not move while a user acts; show measured progress only when the application
measures it. [S13]

## Destructive and consequential actions

Name the affected object and scope; in bulk work, distinguish selected visible
rows from every item matching a filter, preview consequences, and design
partial-failure recovery. Prefer undo for cheaply reversible actions; for
irreversible deletion show the meaningful effect before confirmation. Typed
confirmations are for consequences that warrant their cost. Closing a dialog
does not cancel a server operation — say so where it affects safety.

## Dashboards, tables, and expert work

Start from decisions: monitor, compare, triage, investigate, act. Specify
units, time window, timezone, freshness, and uncertainty; distinguish zero,
missing, unavailable, and stale; provide baselines. Tables for exact lookup and
comparison, charts for patterns, plus an accessible alternative for essential
chart information. Preserve sorting, filtering, pagination, and selection after
a detail edit; state whether counts refer to the page, the selection, or the
whole dataset. Do not convert a table to cards solely because the viewport is
narrow when row comparison is the task. Keep row actions keyboard reachable.

## Speed and stability

Google's dated thresholds: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at the 75th
percentile per device segment; recheck the original before claiming. A
Lighthouse load run does not measure real-user INP. [S22] Acknowledge input
promptly, avoid duplicate submissions, reserve media space, test slow networks
and failures. Good vitals do not prove users understand the flow.

## Trust and ethical choices

State price, recurrence, data use, and consequences where users decide. Keep
decline and cancel usable; never fabricate reviews, urgency, or scarcity. Pair
conversion metrics with errors, refunds, cancellations, and support burden.

## Checks for a proposed flow

- Can the actor identify the current scope and predict the next action's result?
- Does the critical path survive a failed request or an interruption?
- Are input and context retained through recovery?
- Are denied, empty, no-results, and unknown outcomes distinguishable?
- Is the most consequential action understandable before it takes effect?

Basis: [Nielsen's heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) [S01];
the tradeoffs here are working guidance, not measured research findings.
