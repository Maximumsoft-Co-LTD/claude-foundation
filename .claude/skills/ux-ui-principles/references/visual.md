# Visual design, composition, and localization

Read for screen-level decisions where composition affects comprehension or task
execution. Preserve an established visual system unless the requested change
includes it. Source IDs resolve in [sources.md](sources.md).

## Hierarchy and grouping

Start from content order: the current task, the information needed to decide,
its action, then supporting detail. Express priority with size, weight,
contrast, spacing, and position; keep visual grouping consistent with semantic
grouping — a decorative card around every element obscures real relationships,
and making everything larger expresses nothing. [S23] Reuse the project's
spacing scale; judge empty space by whether it clarifies relationships, not by
"more whitespace" or "less scrolling" as goals.

Inspection prompts (not proof of comprehension): can a new user identify the
page purpose and next action without reading all copy? Does prominence match
task importance? Does visual reading order agree with DOM and keyboard order?
Are destructive and primary actions distinguishable without color alone?

## Typography and content

Use a small set of text roles — title, section heading, body, label, hint,
data. Size type from realistic content and viewport; body around 16 CSS px with
generous line-height is a starting recommendation, not a WCAG floor. Use tabular
numerals for repeated numerical comparison. Test long names, wrapped labels,
unbroken identifiers, missing values, translated and user-entered strings.
Truncation needs a usable path to the complete value beyond a hover tooltip.
Action labels predict an effect — distinguish "Save draft", "Submit", and
"Publish" — and an internal error code is never the sole explanation.

## Color and surface roles

Use semantic roles for action, selection, status, emphasis, surface, border,
success, warning, and error, and test each theme/state combination. Keep text
or shape cues alongside status color. Borders, elevation, and containers
communicate grouping or layering; do not flatten controls until their
affordance disappears. Contrast thresholds live in [accessibility.md](accessibility.md).

## Layout and responsive transformation

Choose transformations from the task: stack related content, reprioritize
secondary metadata, move actions into reach, or contain an essential
two-dimensional view in a bounded scroll region. Shrinking everything is not a
mobile design; converting every table to cards is wrong when row comparison is
the task. Let breakpoints respond to content failure, not device names. Keep
reading and keyboard order coherent after reflow; test zoom, orientation, and
sticky headers, footers, dialogs, and mobile keyboards for overlap. Never remove
required information or recovery actions to make a layout fit.

## Thai and mixed-language interfaces

Thai text has combining marks above and below base characters and needs
language-aware line breaking. Inspect actual Thai strings, stacked marks,
wrapping, and fallback fonts for clipping. [S24] Use Thai-capable fonts, avoid
tracking that separates characters, start with roomy line-height, then inspect
tone marks at small sizes and inside controls. Test Thai/Latin names, long
addresses, dates, currency, phone formats, and search. Decide Buddhist/Gregorian
calendar display and storage explicitly, and preserve original user input where
normalization changes meaning.

## Charts, motion, and stability

Choose the chart from the question: trend, comparison, distribution, or
relationship. Show units and range; label missing, estimated, or stale values
instead of treating them as zero; make truncated scales visible; provide an
accessible equivalent. Use motion to connect cause and effect or preserve
location; never block completion under reduced-motion settings, and never move
a target as the user activates it.

## Aesthetic quality and review

Coherent rhythm, alignment, density, and restrained decoration support reading;
present an aesthetic choice as a proposal and evaluate it with users when
consequential. Review: can the actor find the task and next action? Do
typography and spacing express consistent roles? Does realistic content survive
narrow widths, zoom, and localization? Do charts and statuses show actual data
without hiding uncertainty? Record a concrete location and consequence for each
finding; "looks bland" is insufficient without the task it harms.
