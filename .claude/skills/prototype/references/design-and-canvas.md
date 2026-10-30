# Design of the page and the canvas

## Use the project's own design

Look for the design the project already ships before choosing colours or fonts:
theme or token files (CSS variables, a Tailwind config, a design-token JSON),
the installed font files, and real logos or sample assets. Take the values from
the source, not from the running site's guess. The page then looks like the
product it describes.

- Record where each token came from in the page's reviewer details.
- Copy fonts and images into the file or reference system fonts; the page makes
  no network request.
- With no tokens found, use a neutral palette and say so on the page: it is not
  the project's design.
- A layout proposal is not an instruction to redesign the product. Keep the
  existing components and layout the agreement names.

## A design surface, when the host has one

Check what the host offers before writing the page: a skill named `design`, or
an Artifact type for designs. When one exists, use it; do not ask the user
whether to. When none exists, write the file only.

On a canvas:

- One frame per screen or state, numbered, with a short title (`6 · Knowledge`).
- Frames grouped under headings that match the checklist: the main view, before
  and after, failure states, and the work-type surfaces.
- Reviewer details as a frame of their own, last.
- Keep the canvas private. Share or publish only when the user says to.

If the canvas cannot be created, write the file, tell the user why the canvas
was skipped, and keep going.

## The exported file is the source for the harness

The harness reads `.foundation/previews/<change>/prototype.html` to record its
digest and to check the `factsDigest`. After any create or edit on the canvas,
export the file again in the same turn. A canvas edit that is not exported is
invisible to the harness and leaves a stale page.
