# CLAUDE.md

## Purpose

This repository packages an installable OpenSpec-native change harness.
The workflow files and deterministic runtime are the product.

## Map

- `.claude/orchestrator.md` - concise change-loop contract.
- `.claude/harness/foundation.mjs` - deterministic resolver, proof, receipts,
  sandbox, watchdog, migration, and land guards.
- `.claude/commands/` - `/investigate`, `/change`, `/build`, `/prove`, `/land`,
  `/changes`, migration, and the `/dev` compatibility composition.
- `.claude/rules/fundamentals.md` - always-on skill router and canonical
  construction order.
- `.claude/skills/` - procedures loaded only when their trigger fires.
- `.claude/hooks/` and `.claude/settings.json` - generic safety and lint guards.
- `openspec/` - custom schemas, current specs, and durable changes.
- `.foundation/` - ignored machine state and evidence.
- `.workflow/` - read-only legacy migration source.
- `WORKFLOW.md` - public change-loop contract.
- `.claude/tests/run-all.sh` - deterministic workflow test entrypoint.

Risk and evidence—not size—select assurance. Size controls budget and slicing.

## Shipping Boundary

`install.sh > PLAN` is authoritative.

Ships:

```text
.claude/orchestrator.md
.claude/commands/**
.claude/harness/**
.claude/skills/**
.claude/rules/**
.claude/hooks/**
.claude/settings.json
openspec/config.yaml
openspec/schemas/**
.foundation/.gitignore
.foundation/README.md
WORKFLOW.md
```

Does not ship:

```text
.claude/tests/**
docs/**
CLAUDE.md
README.md
dashboard/**
examples/**
install*.sh
```

Runtime files contain rules, not benchmark history, cost figures, incidents, or
maintainer narrative. Never point a shipped file at a non-shipped path.
Evidence belongs in `.claude/tests/bench/rationale.md`; research notes belong
in `docs/research/`.

## Working Rules

- Apply `.claude/rules/fundamentals.md`; do not preload full skill bodies.
- Keep the change packet compact and use `tasks.md` as the sole ledger.
- Use LSP for definitions/references/diagnostics before grep or broad reads.
- Read only the needed section of large files such as `WORKFLOW.md`,
  `CHANGELOG.md`, and agent references.
- Keep changes surgical. A shipped-rule change also updates its deterministic
  tests and, when evidence-driven, the benchmark rationale.
- Run `sh .claude/tests/run-all.sh` after changing shipped files.
- New commands and schemas are included automatically by the installer.
- `no-direct-main-commit.sh` ships but remains opt-in.

Non-lifecycle skills (`brainstorming`, `plan-writing`,
`fanout-team-agents`, frontend/UX skills, `skill-creator`) trigger through
explicit workflow wiring or their own descriptions; do not add them to the
always-on router merely to make them discoverable.

<!-- hyperresearch:start -->
## Research Base (hyperresearch) — Today is 2026-08-05

**CLI path: `/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch`** — use this exact path for every hyperresearch command. It may not be on your system PATH.

**Paths in this document are relative to your current working directory**, not to the CLI binary's location. Use `research/notes/final_report_<vault_tag>.md` (not a prefix with the binary path) when you save files.

This project uses hyperresearch as an agent-driven research knowledge base. The `research/` directory contains markdown notes collected from web sources and original research. Append `--json` to any command for structured output.

### How to do research

**Run a research session with `/hyperresearch <query>`.** This invokes the V8 16-step pipeline. The entry skill at `.claude/skills/hyperresearch/SKILL.md` is a thin ROUTER. The 16 step procedures live in their own skills (`hyperresearch-1-decompose` through `hyperresearch-16-readability-audit`) and are loaded fresh into context via the `Skill` tool when each step runs. This solves V7's context-compaction problem: each step's procedure lands in context only when needed. Read the entry skill before you start a research session; it explains the chain mechanics.

Step 1 classifies the query into one of two tiers (`light` or `full`) and the rest of the pipeline scales accordingly — short bounded queries skip the depth investigations, critics, and patcher (~30-40 min); argumentative deep-research queries run all 16 steps with adversarial review (~1.5-2.5 hours).

**Do NOT use WebFetch for source pages** — use `/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch fetch` instead. The skill files explain when to fetch vs. search.

### What the skill files own

The skill files own everything about how to research. That includes:
- The pipeline phases and what each phase does
- Which subagents exist and what each one is for (fetcher, loci-analyst, depth-investigator, 4 critics, patcher, polish-auditor)
- The tool-lock invariant (patcher and polish-auditor can only Read + Edit, never Write)
- The subagent spawn contract (every Task call passes the verbatim research_query + pipeline position + inputs)
- Artifact locations (`research/scaffold.md`, `research/prompt-decomposition.json`, `research/loci.json`, `research/comparisons.md`, interim notes, patch / polish logs)
- The curation pass after every research session

If you need to know how hyperresearch works, read the skill file. This document does NOT duplicate that content — when the skill file and this file disagree, the skill file wins.

### Canonical research query

In a normal run, the canonical research query is the user's verbatim prompt. In wrapped runs, if `research/prompt.txt` exists, that file is gospel and overrides any wrapping instructions. The pipeline persists the query as `research/query-<vault_tag>.md` with YAML frontmatter — this is the canonical query reference for all downstream layers. Wrapper requirements (save path, citation format, terminal sections) are a separate contract, captured in the scaffold — not pasted into the `## User Prompt (VERBATIM — gospel)` section.

### Academic APIs before web search

For any topic with a research literature, hit academic APIs BEFORE running web searches. They return citation-ranked canonical papers; web search returns derivative commentary.

- **Semantic Scholar:** `https://api.semanticscholar.org/graph/v1/paper/search?query=<q>&fields=title,year,citationCount,externalIds&limit=10` — then citation-chain the top papers forward + backward.
- **arXiv:** `https://export.arxiv.org/api/query?search_query=cat:cs.LG+AND+all:<q>&sortBy=relevance&max_results=25`
- **OpenAlex:** `https://api.openalex.org/works?search=<q>&sort=cited_by_count:desc&per-page=15&mailto=research@example.com`
- **PubMed:** `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<q>&retmode=json&retmax=20`

After the academic sweep, run web searches for context, news, non-academic angles, and at least one adversarial search ("criticism of X", "limitations of X").

### PDFs fetch directly

`/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch fetch` auto-detects PDF URLs (arXiv, NBER, SSRN, direct `.pdf` links) and extracts full text via pymupdf. Fetch them aggressively. Raw PDFs land in `research/raw/<note-id>.pdf` and the note's frontmatter links back via `raw_file:`.

### Searching the vault

```bash
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch search "query" --json                # Full-text search
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch search "query" --tag ml --json       # Filter by tag / status / date / parent
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch search "query" --include-body --json # Full-body search, not just titles
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch note show <id> --json                # Read one note
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch note show <id1> <id2> <id3> --json   # Batch-read notes in one call
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch note list --json                     # List all notes with summaries
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch tags --json                          # Existing tag vocabulary
```

### Images, screenshots, and assets

```bash
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch fetch "<url>" --tag <topic> --save-assets -j   # Saves screenshot + top images
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch assets list --note <note-id> --json            # Assets for a specific note
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch assets path <note-id> --type screenshot -j     # Get screenshot path (viewable with Read)
```

### Authenticated crawling

Login-gated content (LinkedIn, Twitter, paywalled news) needs a browser profile. Set up once via `/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch setup` or `crwl profiles`. Config in `.hyperresearch/config.toml` under `[web]`: `profile = "research"`, `magic = true`. LinkedIn / Twitter / Facebook / Instagram / TikTok auto-use a visible browser to avoid session kills.

If a fetch returns a login wall, tell the user to run `/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch setup` and create a login profile.

### Curate after every session

Every research session must end with a curation pass:

```bash
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch note list --status draft -j                                        # Find unprocessed notes
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch note show <id> -j                                                  # Read the content
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch note update <id> --summary "<specific summary>" --add-tag <t> -j   # Add summary + tags
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch lint -j                                                            # Find missing tags / summaries / broken links
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch repair -j                                                          # Auto-fix broken links, rebuild indexes
/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch status -j                                                          # Overall vault health
```

Lifecycle: `draft` → `review` → `evergreen` (or `stale` → `deprecated` → `archive` for outdated material).

Summaries must be specific — "Mamba achieves linear-time sequence modeling via selective state spaces" beats "Paper about Mamba". Reuse the existing tag vocabulary (`/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch tags -j`) rather than inventing new tags.

### Key conventions

- Notes live in `research/notes/` as markdown with YAML frontmatter
- Link notes with `[[note-id]]` syntax
- After editing `.md` files directly, run `/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch sync` to update the index
- Run `/Library/Frameworks/Python.framework/Versions/3.12/bin/hyperresearch --help` for the full command list
<!-- hyperresearch:end -->
