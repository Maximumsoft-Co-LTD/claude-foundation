---
title: Human approval
description: User decisions, review policy, and the agent/host mechanisms that record and enforce them.
---

<!-- docs-audience: users -->
**Audience:** project users. This guide explains what to review and decide; the agent handles routine system operations.

User decisions and system mechanisms have different owners. You approve intent,
make consequential choices, accept outcomes when required, and grant Land or
external-action authority. The agent and harness record those decisions;
configured reviewers and trusted hosts produce their own evidence.

| Boundary | Owner | Question it answers |
|---|---|---|
| **Acceptance** | User; agent records the decision | Is this the outcome we wanted, and is acceptance required? |
| **Review** | Configured reviewer; project sets assurance policy | Does implementation meet the review criteria? Independence is separately configured |
| **Authority bridge** | Agent/harness integration | How does a decision or verdict become a validated receipt? |
| **Host attestation** | Trusted host operator/integration | Does the execution environment meet the unattended sandbox requirements? |

:::caution[What Land actually enforces]
An exact `/land <change>` supplies one internal, session-bound grant for that
recoverable transaction. Land is the single hard gate: it refuses unless your
spec approval is still valid, the change is proven, assurance passed, and the
proof matches the current workspace. Missing, stale, failed, inconclusive, or
invalid evidence is never landed; a stale proof is proved again first.
Land still fails closed on target conflicts, unsafe paths, ambiguous repository
identity, and transaction corruption, and lists any control-plane, CI, or
secret paths and deletions the change makes before it applies.

Before Land, nothing waits on you except your own decisions: approving the
spec, product meaning or a trade-off, an acceptance verdict, a waiver,
exhausted review, Land, a commit, push, or other side effect, budget, or a
cause only you can clear (a login, the network, a full disk). Setup, sync
conflicts, shared-resource waits, and repeated repair stay with the agent or
the harness.

Users never construct the grant or a decision-reference command. `land record`
requires `--decision-ref` only as compatibility for an already-active legacy
commit-oriented transaction. Other advanced continuations—`budget continue`,
`change abandon`, `change waive`, and `agents release --force`—still record the
decision that authorized them.

`change waive` is the recorded exit for a gate that ran and failed: it
withdraws one capability's enforcement on your explicit decision, travels as a
`user-waived` advisory through proof and into the archive, and `--revoke`
restores the requirement. Review and acceptance are refused there — their
waivers are declared in `foundation.json`, as described below.
:::

## Acceptance

Acceptance is a named person saying the outcome is the one they wanted. It is
the only boundary about the *product* rather than the *work*.

**A standard change starts undecided, and undecided blocks.** `change validate`
fails until somebody decides, which is deliberate: silence is not consent, and
a change cannot drift into being accepted because nobody objected.

You decide it explicitly, one way or the other:

```bash
# Nothing subjective to sign off — the deterministic checks are the whole story
claude-foundation change resolve <change> --acceptance-not-required

# Somebody has to look at it and say yes
claude-foundation change resolve <change> \
  --acceptance-required --acceptance-reason "<why a person must judge this>"
```

A rapid change starts at `not-required` instead, because rapid is reserved for
low-impact isolated work. Declaring a claim with the `acceptance` capability
also makes acceptance required, and that declaration outranks
`--acceptance-not-required`.

A passing acceptance receipt needs a named human, an explicit `accept`
decision, at least one distinct acceptance criterion, and a recorded
observation. It is re-validated on every read against the workspace hash, the
claims currently in scope, and the stated reason — so if any of those move
afterward, the acceptance goes invalid rather than silently carrying over.

## Independent review

Review asks whether the implementation is sound. The reviewer may be a human
**or** a different AI — what matters is independence, not species.

With `workflow.reviewPolicy: "risk-tiered"`, every change is reviewed and risk
controls the bounded route. The exception is a low-tier rapid change that no
security keyword, risk signal, or `--review` flags: the project's own tests
prove it and no AI review runs.

- **low:** one full AI review; a material correction promotes to medium
- **medium:** one full AI review, one correction batch, then at most one
  fresh-session delta that closes the original finding IDs
- **high:** material risks are decided in the initial Decision Sheet; one full
  AI review and at most one post-correction delta; no mandatory human final

Authorization/secrets, public or cross-repository contracts, migrations or
destructive state, money, concurrency, replay/idempotency, brokers/real wire,
and activation of legacy behavior are high-risk signals.

Two properties govern who may review. Both are waivable, and each waiver is
declared the same way: a key in the committed `foundation.json`, never a
command flag — an exemption the reviewed party can write at the moment it is
caught is not an exemption.

**Independence.** The shipped policy uses
`"review": { "independence": "self" }`, allowing the reviewer to share an
implementer's identity and session. It applies at every impact and stamps an
`independence-waived-self-review` trigger on the policy. The receipt records
what happened: `review.policy.independent` stays `false`, with
`independenceWaived: true` beside it explaining why it passed. Projects that
require separation of duties can strengthen the value to `required`; reviewer
identity must then differ from every implementation subject and an AI reviewer
must use a different session.

**Diversity.** The shipped policy uses
`"review": { "diversity": "single-model" }`, so diversity is preferred and a
Claude-Code-only installation can review in a fresh Claude session without
requiring Codex. This stamps a `diversity-waived-single-model` trigger on the
policy. Teams with both providers can strengthen the value to `required`; the
AI reviewer must then come from a different provider and model family than the
implementer.

The shipped default selects `claude-opus`; select `codex-sol` instead for a
Codex-only team. Configured AI review still runs read-only and ephemeral even
though the default policy does not require a distinct identity or session.

Each waiver relaxes only its own axis. A same-model self-review of critical work
needs both declared; declaring one leaves the other enforced. Withdrawing either
key invalidates the receipts it allowed, because the review policy is part of
the contract fingerprint.

:::note[The risk circuit]
The tier limit is enforced before dispatch: low receives one full review; a
correction promotes it to the bounded full/delta route used by medium and high.
Reviewer infrastructure gets one separate full retry. After two delivered AI
waves, Change Loop refuses another open review. A final in-contract blocker
closes through the claims and current critical-case receipts named by that
finding, or else through one closure review of the repaired delta; a real contract contradiction reopens one batched Decision Sheet, and
missing authority becomes an external handoff. The attempt history is a
SHA-256 hash chain; a broken chain is quarantined and rebuilt by the harness,
never lowering the attempt count or reusing a verdict that no longer verifies.

The review-dispatch limit keeps the workflow fast; it does not cap repair
attempts. The agent may keep fixing grouped findings and rechecking invalidated
evidence while the work is making progress.
:::

## The authority bridge

**For agent and host integrators.** Users supply decisions; the integration
records and validates them through this mechanism.

The normal entry point is one resumable command:

```bash
claude-foundation advance <change> --through proven
```

The coordinator invokes the compatible proof primitive, creates or reuses the
request, and never polls an unchanged external wait.
When the packet is actually handed off, configured Codex or Claude Code review
uses `authority run`. A named-human review must use `authority dispatch` before `authority
record`. Human acceptance uses request/status/record without a review dispatch.

`authority request` refuses to open unless the implementation tasks are
complete and that authority is genuinely required. The request is bound to the
workspace hash, expires after 24 hours, and is single-use. Dispatch records the
exact full or delta packet and consumes an attempt even if the reviewer crashes;
only a completed response can unlock the next route.

`authority record` validates the response against the request — version,
request ID, change ID, type, and workspace hash must all match — and then runs
the ordinary receipt validator. If the response claims a pass but the resulting
receipt would not be valid, the previous receipt is restored and the operation
fails. A completed request cannot be replayed.

:::tip
`authority status --template` gives the agent or integration operator the
response shape. Users answer the decision question in ordinary language;
they do not construct receipt JSON or invent a reviewer verdict.
:::

If the workspace changes after a request is opened, the request goes stale and
must be reopened. A verdict is bound to the code it was given, not to the
change in general.

## Host attestation

**For trusted host operators.** This is environment evidence from the host,
not a document the project user signs to approve a feature.

This one is **not** human approval, despite living near it.

`sandbox challenge` plus `doctor --unattended --attestation <file>` is a signed
statement from a trusted host that the sandbox boundary is safe enough to run
without a person watching. It is Ed25519-signed, the nonce expires in ten
minutes, and a consumed nonce is recorded so it cannot be replayed.

Trust roots are root-owned system files only, and Change Loop independently
refuses unattended execution when it finds a writable container socket, a
mounted Kubernetes service-account token, or a mounted SSH agent socket — the
things that would let "sandboxed" work reach outside the sandbox.

Detection is not authorization. Finding that unattended execution is possible
never implies permission to use it.

## Approval package, previews, and role lanes

When a change starts, and again when `advance` asks for spec approval, the
agent writes a read-only approval package at
`.foundation/packages/<change>.html` and shows you its path. It summarizes the
risk level (Low, Medium, High, or Critical, derived from impact and risk
signals), the technical domains touched, and the approval artifacts grouped by
approver role (product-owner, tech-lead, qa, devops, security). Each artifact
is labeled: **proof** only when a valid passing receipt backs it, **preview**,
or **no evidence yet**. The package never changes the change's state, and if
it cannot be written, approval continues from the packet.

**What to read first.** When the agent wrote them, the top of the page answers
three plain questions: what you get, what changes (before and after, with a
count when known), and what happens if it fails. Below that come concrete
examples with real values, chosen for the kind of work: a clickable prototype,
API requests and responses for each status, rules with numbers, rows before and
after a migration, a permission table, and so on. Each example has an
**After Build** tab: once Build and Prove have run it shows the real result
(**proof** only from a valid passing receipt, **failed**, or a **preview**),
and before that it says what will be compared. The page uses Thai or English to
match the agreement. Diagrams are drawn by a copy of Mermaid shipped with the
harness on your machine; nothing is fetched over the network, and the page
shows the diagram text if that file is missing. Summaries and examples are
optional: without them you get the per-role view above.

**Previews are optional.** Before Build, the agent may run one declared
provider against a throwaway copy of the target to show early behavior. A
High or Critical package lists suggested previews. A preview result is never
proof: it cannot satisfy Prove or Land, never blocks approval or Build, and
shows as stale once the spec changes. A provider marked `external: true`
(for example a payment sandbox or staging) reaches outside your machine, so it
runs only after you authorize that specific run; without your decision it is
refused and nothing runs.

**Role lanes are opt-in.** By default one spec approval covers the change. If
the project sets `approval.roles` in `foundation.json` (see
[`approval`](/docs/foundation-config/#approval-role-approval-lanes)), each
selected role approves the current revision separately, and Build does not
start until every required lane has approved. You decide which role you are
approving as; an approval given without a role covers every lane. The harness
records the role as stated and does not verify identity. Adding requirements
keeps lane approvals; removing a requirement resets every lane.

## Approval in your own words

Your chat reply is the decision. Answering the spec-approval or amendment
question with "ลุยเลย", "ทำเลย", "ทำไปเลย", "go ahead", or "approve" approves it;
the agent records it and does not ask again. Saying "ทำจนจบ" or "finish it" up
front also authorizes Land for that change. Urgency alone ("ด่วน", "รีบ demo")
and silence never approve, and a negated request ("don't push yet") is never
authority.

Commit and push happen only through `/deliver` or your direct instruction
("commit this", "push it"). During Build or Prove an uninstructed `git commit`
or `git push` from the main checkout does not run; it becomes a question, and
your yes lets it run. "เปิด PR ให้เลย" or "open a PR" counts as `/deliver`. The
full rule lives in `WORKFLOW.md` under "Authority from the user's words".

## Where decisions get recorded

Decisions belong in the change packet, not in a chat transcript. An acceptance
reason lives in the contract, a review verdict lives in a receipt, and a
continuation decision is named by its `--decision-ref`. The rule underneath all
four boundaries is the same one: **approval is never inferred from silence, and
a command being available is never approval to run it.**
