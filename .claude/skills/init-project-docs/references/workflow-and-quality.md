# Init Project Docs — Workflow Detail & Quality Bar

Companion to `SKILL.md`: per-file guidance, the workflow steps, mermaid
validity rules, the self-review bar, and anti-patterns.

## File-level guidance

`COREFEATURE.md` is the centrepiece: each core feature gets its own sequence
diagram tracing the real call chain (actor → entry point → service → datastore
→ external system → back). `BUSINESSRULE.md` captures the rules the code
enforces — the behavioural counterpart to DATAMODEL's constraints — pulled from
validators, domain services, conditional logic, and named constants, not how
the domain "should" work. `DESIGN.md` is produced only for a project with a
user-facing UI and grounded in frontend code; for a headless service, pure API,
or library, drop it. Forward-looking UI decisions belong in the active OpenSpec
change.

## Workflow

Run in order. Steps 1–2 carry most of the value. In update mode the existing
docs are an input you read and reconcile, not output you overwrite blind.

1. **Scope the repo.** Locate the project root and confirm where docs go
   (`docs/` by default). Read dependency manifests (`package.json`,
   `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`,
   `composer.json`) — they answer TECHSTACK almost entirely; find entry points
   (`main`, `index`, `app`, `cmd/`, `server`, framework bootstrap); scan the
   top-level layout, README, and any existing `docs/` (**if it already holds the
   suite you are in update mode — read it now**); check `Dockerfile`,
   `docker-compose.yml`, CI workflows, `.env.example`, and IaC. Use `LSP`,
   `Grep`, and search tools; for a large repo delegate only independent
   subsystem maps as native work packages, then synthesize once.
2. **Understand before writing — the grounding rule.** Every claim must trace
   to something you actually read: TECHSTACK from manifests and lockfiles;
   DATAMODEL from migrations, ORM models, schema files, or `CREATE TABLE` (never
   infer columns from variable names); API from route definitions, controllers,
   decorators, or an OpenAPI/GraphQL schema; COREFEATURE diagrams by tracing one
   call from entry point to effects; BUSINESSRULE from validators, guards,
   conditionals, enums, and constants, each cited to its function or constant;
   DESIGN from the theme/token file, CSS config or `:root` properties, the
   component directory, and the router ([[ui-ux-pro-max]] names the patterns,
   [[tailwind-design-system]] the token mechanics). When the code does not tell
   you, say so — "auth mechanism not found in the reviewed files" is honest; an
   invented answer is a trap. Cite real anchors (paths, route strings, table
   names) so a reader can verify.
   **Update mode:** sort every existing claim into keep (accurate, including
   human prose), fix (drifted), add (in code, not the doc), remove (gone from
   code). That four-bucket diff is the edit plan. Read
   [[refactoring-fundamentals]]'s current-state mapping mindset for a large or
   tangled codebase.
3. **Write or update the Markdown.** Fresh: write each file into `docs/` using
   the section skeleton and mermaid example per file in
   [doc-templates](doc-templates.md), leading with tables, bullets, and
   diagrams over prose. Update: apply the four-bucket diff as surgical edits —
   rewrite only what drifted, add for new code, delete the stale, leave accurate
   content untouched, and realign to the skeleton only if the docs predate it.
   Pick the 3–6 genuinely core flows for `COREFEATURE.md` (auth, primary
   create/update, the money path, the main read path), one sequence diagram
   each, not every endpoint. For `BUSINESSRULE.md` write one row per rule
   (condition → effect + source) plus validations, formulas, thresholds, and
   state guards where they exist, dropping sub-sections with no real instances.
   Write `DESIGN.md` only when a user-facing UI exists.
4. **Build the viewer** with the bundled script — do not hand-write it, since
   the script handles escaping, ordering, and mermaid wiring:

   ```bash
   python3 .claude/skills/init-project-docs/scripts/build_doc_viewer.py --docs-dir docs --title "<Project Name>"
   ```

   It embeds the current Markdown into one file (marked.js + mermaid.js from
   CDN) with a sidebar in canonical order. The content is embedded, so it is a
   snapshot: re-run it after editing any `.md`.
5. **Self-review and report.** Validate the mermaid, re-run the script, and
   tell the user what was produced and the one or two things the code did not
   reveal. In update mode lead with a changelog: fixed / added / removed / kept.

## Mermaid: keep it valid

A broken diagram renders as an error box, which is worse than none. Use fenced
` ```mermaid ` blocks; pick the right type (`sequenceDiagram` for COREFEATURE,
`erDiagram` for DATAMODEL, `flowchart TD`/`graph LR` for ARCHITECTURE,
`flowchart` or `stateDiagram-v2` for DESIGN and BUSINESSRULE); quote labels
containing spaces or punctuation and avoid raw parens, semicolons, and `#` in
unquoted ones; declare participants and actors before use; keep flowchart node
ids alphanumeric. Compare each block against the examples in
[doc-templates](doc-templates.md), and render `document.html` once if unsure.

## Quality bar — self-review before handing over

- **Grounded:** every component, table, endpoint, and arrow traces to a file
  you read. No invented fields or routes.
- **Honest gaps:** anything undetermined is labelled, not papered over.
- **Right files:** a doc whose domain does not exist says "Not applicable" in
  one line, with no plausible filler.
- **Diagrams render:** valid mermaid for each file that has one.
- **Skimmable:** tables and diagrams over walls of prose.
- **Faithful delta (update):** stale fixed, new reflected, removed dropped,
  accurate human edits preserved — and you can name what changed.
- **Viewer built last:** `document.html` regenerated from the final `.md` set.
- **No secrets:** name the variable, never the value (mirrors
  `protect-secrets.sh`).

## Anti-patterns

- Documenting the framework instead of the project ("Express apps typically
  have…") — describe *this* repo's middleware, by file.
- Inventing a schema, endpoints, or a design system because they would make
  sense; read the theme file and component directory instead.
- A guessed COREFEATURE diagram — trace the real call chain or leave the flow out.
- Hand-writing `document.html`, which is what the script prevents.
- Padding "Not applicable" sections, writing prose where a table is clearer, or
  forgetting to rebuild the viewer.
- Regenerating over an existing suite and blowing away human edits when a
  surgical update would do; rebuild wholesale only when asked or unsalvageable.
- Leaving stale claims in place — a doc that looks maintained but describes code
  that is gone is a worse trap than an obvious gap.
