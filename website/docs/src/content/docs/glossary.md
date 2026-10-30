---
title: Glossary
description: Plain-language meanings of the terms Change Loop uses, with the identifier you will see and the page where each one matters.
---

<!-- docs-audience: users -->
**Audience:** project users. Look a word up here when a page or the agent uses a term you do not recognize. Each entry says what it means in everyday terms, then the identifier you will see in output and files.

Terms are grouped by the order you meet them: the work, the checking, the
decisions, and the machinery.

## The work

| Term | In plain words | Identifier | Where you meet it |
|---|---|---|---|
| **Change** | One requested piece of work, followed from idea to delivered code under a single ID | `change`, `/change <intent>` | [One change, start to finish](/docs/journey/) |
| **Agreement** (spec) | The written, approved description of what the change must do, in readable scenarios. The code is judged against it | OpenSpec change; `proposal`, `specs`, `tasks.md` | [Change](/docs/loop/change/) |
| **Amendment** | A correction to an approved agreement when you or the agent learn something new mid-build. Same change ID, only the affected proof is redone | amendment, `/change` during Build | [Change](/docs/loop/change/) |
| **Rapid / standard** | How much ceremony a change gets: rapid for small isolated low-risk work, standard for everything else | `foundation-rapid`, `foundation-standard` | [Change](/docs/loop/change/) |
| **Sandbox** (worktree) | An isolated copy of your project where the work happens, so your main checkout stays untouched until Land | sandbox, `.foundation/` workspaces | [Build](/docs/loop/build/) |
| **Advance** (coordinator) | The one resumable command the agent uses to move a change forward. It runs, reuses valid work, stops only at real decisions, and gives the exact way to resume | `advance <change> --through build\|proven\|archived` | [CLI reference](/docs/cli/) |
| **Harness** | The deterministic program that owns the rules: isolation, running checks, recording results, budgets, and Land. It is not an AI and does not guess | `claude-foundation`, `.claude/harness/` | [Install](/docs/install/) |

## The checking

| Term | In plain words | Identifier | Where you meet it |
|---|---|---|---|
| **Claim** | A promise the change makes, such as "an owner can save a new display name". Each claim names how it will be checked | `claims` in `evidence.yaml` | [Claims](/docs/evidence/claims/) |
| **Capability** | The kind of check a claim needs: tests, browser behavior, accessibility, and so on | `test`, `browser`, `accessibility`, `review`... | [Claims](/docs/evidence/claims/) |
| **Provider** | The project tool that actually runs a check, such as your test runner or Playwright. Names describe what is proven, not which tool runs | provider, adapter, `execution.yaml` | [Adapters](/docs/evidence/adapters/) |
| **Evidence** | Everything that supports a claim: test output, browser runs, reviews, human acceptance | `evidence.yaml`, receipts | [Receipts](/docs/evidence/receipts/) |
| **Receipt** | The recorded result of one check, tied to the exact code and settings it ran on. A receipt is a pass, a fail, or "could not be checked" | receipt | [Receipts](/docs/evidence/receipts/) |
| **Stale** | A result that no longer matches the current code or agreement, so it is not trusted and is rerun. Only invalidated checks rerun | stale, `workspace hash` | [Receipts](/docs/evidence/receipts/) |
| **Proof** / **proven** | All required checks passed on the current code. It means the evidence is good, not that anything was delivered | `proven`, `/prove <change>` | [Prove](/docs/loop/prove/) |
| **Gate** | A required check that must pass before the flow moves on, for example one capability's evidence or review | gate, assurance | [Prove](/docs/loop/prove/) |
| **Waiver** | Your recorded decision to stop requiring one failed check. It stays visible as `user-waived`, is never a pass, and can be revoked | `change waive`, `user-waived` | [Human approval](/docs/approval/) |
| **Preview** | An early look at behavior from a throwaway copy before Build. Useful for the decision, never counted as proof | preview, `.foundation/previews/` | [Human approval](/docs/approval/#approval-package-previews-and-role-lanes) |

## The decisions

| Term | In plain words | Identifier | Where you meet it |
|---|---|---|---|
| **Approval page** | The page you read before approving: a clickable prototype of what you will get, a short strip of the harness's facts (risk, proof, roles), what it must show, before and after, failures with recovery. Written by the prototype skill, not the harness | `.foundation/previews/<change>/prototype.html` | [Human approval](/docs/approval/#approval-package-previews-and-role-lanes) |
| **Decision Sheet** | One batched set of the consequential questions that only you can answer, asked together instead of one by one | Decision Sheet, `ASK_USER` | [Change](/docs/loop/change/) |
| **Acceptance** | A named person saying the finished outcome is what they wanted. Required only when the change says so | acceptance, `change resolve --acceptance-required` | [Human approval](/docs/approval/#acceptance) |
| **Review** | An independent read of the implementation by a different AI or a person, to judge whether it is sound | `review`, `workflow.reviewPolicy` | [Human approval](/docs/approval/#independent-review) |
| **Risk** | How much could go wrong: low, medium, high (critical for the package). It decides how much review a change gets, not how large the diff is | risk tier, `riskSignals` | [Human approval](/docs/approval/#independent-review) |
| **Authority** | Permission to do something consequential, such as Land or an external side effect. It is only ever granted in your own words, never inferred | authority, `--decision-ref` | [Human approval](/docs/approval/) |

## The finish

| Term | In plain words | Identifier | Where you meet it |
|---|---|---|---|
| **Land** | The single hard gate. With your authority, the harness applies the proven work to your project once, syncs the specs, and archives. It never commits, pushes, or opens a PR | `/land <change>` | [Land](/docs/loop/land/) |
| **Archived** | The change is delivered: the diff is in your project, uncommitted, and the agreement is stored. The only state that means done | `archived`, `DELIVERED` | [Land](/docs/loop/land/) |
| **Handoff** | A follow-up that belongs to someone outside the flow, such as a deployment step or a ticket. It is recorded, not performed for you | `handoffs.yaml`, `WAITING_EXTERNAL` | [Land](/docs/loop/land/) |
| **Resume** | Picking an interrupted change up exactly where it stopped. State lives in files, not in the chat | resume route, `/changes` | [One change, start to finish](/docs/journey/) |
