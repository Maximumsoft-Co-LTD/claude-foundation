---
title: Human approval
description: The four separate boundaries where a person enters the loop — acceptance, independent review, the authority bridge, and host attestation — and which of them actually blocks.
---

Foundation has four distinct places where a human can enter the loop. They are
routinely confused with one another, and they do different jobs.

| Boundary | Question it answers | Blocks? |
|---|---|---|
| **Acceptance** | Is this the outcome we wanted? | Yes — an undecided standard change fails validation |
| **Review** | Is this implementation sound, judged independently? | Yes, when policy triggers fire |
| **Authority bridge** | How does a verdict become a receipt? | It is the mechanism, not a gate |
| **Host attestation** | Is it safe to run unattended? | Only for unattended execution |

:::caution[What Land actually enforces]
Land gates on **evidence**, not on consent. It refuses to proceed on missing,
stale, failed, or inconclusive evidence, and it re-checks every receipt digest
against the proof manifest before applying anything.

The agent is separately instructed to explain the effects and offer you
inspect, proceed, or pause before it lands — but that is an instruction the
agent follows, not a lock the harness enforces. The commands that *do* demand a
recorded human decision are the continuations: `land record`, `budget continue`,
`change abandon`, `change waive`, and `agents release --force`, each of which
requires a `--decision-ref` naming the decision you actually made.

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
controls the bounded route:

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
waves, Foundation refuses another open review. A final in-contract blocker can
close only through the claims and current critical-case receipts named by that
finding; a real contract contradiction reopens one batched Decision Sheet, and
missing authority becomes an external handoff. The attempt history is a
SHA-256 hash chain; a broken chain fails closed.
:::

## The authority bridge

The normal entry point is one resumable command:

```bash
claude-foundation proof advance <change>
```

It creates or reuses the request and never polls an unchanged external wait.
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
`authority status --template` is the flag that makes this usable by hand. It
prints exactly the response shape expected, so you fill in a verdict rather
than reconstructing a JSON schema from documentation.
:::

If the workspace changes after a request is opened, the request goes stale and
must be reopened. A verdict is bound to the code it was given, not to the
change in general.

## Host attestation

This one is **not** human approval, despite living near it.

`sandbox challenge` plus `doctor --unattended --attestation <file>` is a signed
statement from a trusted host that the sandbox boundary is safe enough to run
without a person watching. It is Ed25519-signed, the nonce expires in ten
minutes, and a consumed nonce is recorded so it cannot be replayed.

Trust roots are root-owned system files only, and Foundation independently
refuses unattended execution when it finds a writable container socket, a
mounted Kubernetes service-account token, or a mounted SSH agent socket — the
things that would let "sandboxed" work reach outside the sandbox.

Detection is not authorization. Finding that unattended execution is possible
never implies permission to use it.

## Where decisions get recorded

Decisions belong in the change packet, not in a chat transcript. An acceptance
reason lives in the contract, a review verdict lives in a receipt, and a
continuation decision is named by its `--decision-ref`. The rule underneath all
four boundaries is the same one: **approval is never inferred from silence, and
a command being available is never approval to run it.**
