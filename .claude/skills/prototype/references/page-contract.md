# Approval page contract

One self-contained HTML file an approver opens and understands without reading
the packet. It is a reading aid; the decision is the user's reply in chat.

## Order

1. **Header**: change id, revision, the intent in the draft's language.
2. **Facts strip**: risk level (word, symbol, scale), proof count, role lanes,
   approval status, and the `factsDigest`. Copy every value from
   `claude-foundation package <change>`; never set or soften one. Give each term
   (proof, preview, role lane) a one-line plain explanation.
3. **Main view**: the prototype. It is the largest block and is open.
4. **What the prototype must show**: the `prototype.checklist` items, each with
   its source field and status (covered, missing, unknown, none).
5. **Before and after**: `scratch.asIs` against `scratch.toBe`, with `scratch.get`.
6. **Path**: the user flow, walkable, including the failing path.
7. **Failures**: each failure scenario with what the user sees and the recovery
   the draft states. Say nothing about recovery the draft does not state.
8. **Undo and who**: `scratch.undo` and `scratch.who`, or what the package derived.
9. **Reviewer details**: role tables, domains, test map, diagrams, previews, in
   one section closed by default.

## Rules

- **Only the agreement.** Every screen, field, rule, number, and endpoint comes
  from a requirement, scenario, draft field, or the package data. A value the
  draft lacks reads `unknown` (`ไม่ทราบ`); never guess it and never write 0.
- **Not proof.** A visible badge says the page is a preview, not proof. Never
  write that tests pass or that anything is proven.
- **No decision controls.** No form, approve button, or reply box. The page has
  scripts only for switching views and states.
- **Offline.** No network request: fonts, images, and scripts are in the file or
  the system's. Escape every value taken from the draft.
- **Language.** Use the draft's `language`; keep identifiers, paths, and commands
  as written.
- **Accessible.** Every control works with the keyboard and shows focus; state is
  carried by words or symbols, never colour alone; it reflows at 412px.
- **Declare coverage.** The `prototype` example lists `covers` keys for the
  surfaces the page truly shows. A claim is advisory, so list only what is there.

## Checks before handing over

- Every checklist item is shown, or named as missing with the reason.
- The page contains the current `factsDigest`.
- The numbers in the strip equal the package output.
- Nothing on the page contradicts an approved requirement.
