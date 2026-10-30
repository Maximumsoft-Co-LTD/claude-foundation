# Keeping the page and the change aligned

The compiled agreement is the source of truth; the page only shows it. A page
that shows more, less, or something else than the agreement is wrong until one
of them is fixed.

## Declare what the page shows

The `prototype` example in the draft names the file (relative to
`.foundation/previews/<change>/`) and lists `covers`: the checklist keys the
page truly shows.

```json
{ "type": "prototype", "title": "Approval page", "path": "prototype.html",
  "covers": ["flow", "states", "ba", "fail"] }
```

A key outside the change's checklist is refused with an EDIT naming its path.
`covers` is a claim by the agent. It is not evidence, and Prove and Land never
read it. Run `claude-foundation package <change>` to see which items are
covered, missing, or unknown.

## When the page is edited

1. Compare the edit with the agreement: requirements, scenarios, and fields.
2. If the page now shows behavior the agreement lacks, change the agreement in
   the same turn: `change revise` before Build, `change amend` during Build.
   Report the requirement delta that awaits approval.
3. If the edit contradicts an approved requirement, do not leave them apart.
   Offer an amendment or drop the edit. Never remove a requirement unasked.
4. Export the file again if the work was on a canvas, update `covers`, and run
   `change revise` so the harness records the new digest.

## What the harness will say

- **Edited after revision N**: the file differs from the digest recorded at the
  last start, revise, or amend. Check it against the change, then revise.
- **Missing the current facts digest**: the risk, proof, or role strip is old.
  Copy the facts again from `package` and include the new `factsDigest`.

Both warnings are advisory. They never stop `change start`, Build, Prove, or Land,
and they are not evidence either way.
