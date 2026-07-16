# claude-foundation dashboard

A **team awareness + usage dashboard** for everyone using the claude-foundation
`/dev` flow. Each machine runs a small background client that heartbeats to one
central server; open the web page and you get six tabs:

| Tab | What it shows |
|---|---|
| **Team** | Who's online right now, which repos each person is working in (repo + folder + branch + changed-file count), and which `/dev` runs are in flight. |
| **Presence** | When people are online: a weekday × hour heatmap (viewer's local time), online hours per person and per day — built from the persisted heartbeat log. |
| **Conflicts** | Early warning when two people's changed *line ranges* overlap in the same file, plus file **hotspots** (most-edited files, 120 d) and the full **conflict history**. |
| **Insights** | `/dev` throughput: runs completed by type, median durations, a **phase funnel** (median time between spec → plan → tests → review → retro artifacts), commits/day, and the FOLLOWUPS backlog per repo. |
| **Usage** | Claude token usage per day × model × **project**, estimated cost ($), tool-call counts, sessions per day, monthly trend, and a per-model breakdown table. |
| **Activity** | Recent `/dev` runs across the team, newest first. |

Every data-heavy tab has two shared filters: **per teammate** and a **date range**
(Today / 7d / 14d / 30d / custom from–to), both computed on the viewer's local
calendar.

---

## Architecture

```
 each teammate's machine                          central server (Railway / any Node host)
┌─────────────────────────────────────┐   HTTPS   ┌─────────────────────────────────────────┐
│ client.sh  (bash + curl daemon)     │ ────────► │ server.js  (single file, zero npm deps) │
│                                     │  POST     │                                         │
│ every 15s   → heartbeat             │ /api/     │  in-memory Map  ── presence (30s TTL)   │
│ every 60s   → repo scan             │ heartbeat │        │                                 │
│   • .workflow/*/state.json → runs   │           │        ▼ every heartbeat                │
│     + artifact mtimes (funnel)      │           │  SQLite (node:sqlite, Node ≥ 24)        │
│   • git diff merge-base..worktree   │           │   agents / heartbeats / runs /          │
│     → changed files + line ranges   │           │   usage_daily / sessions_daily / tools /│
│   • git log 14d + FOLLOWUPS.md      │           │   commits_daily / followups /           │
│ every 300s  → usage scan            │           │   file_edits / conflict_log             │
│   • ~/.claude/projects/**/*.jsonl   │           │                                         │
│     → tokens per day×model×project, │           │  GET /api/online    (5s poll)  ← UI     │
│       sessions, tool calls          │           │  GET /api/presence  (60s poll) ← UI     │
└─────────────────────────────────────┘           │  GET /api/history   (60s poll) ← UI     │
                                                  │  GET /               → web dashboard    │
 you, in a browser  ────────────────────────────► └─────────────────────────────────────────┘
```

The client only ever **sends outbound HTTP** — it binds no port. The server is
the only process with a port. Live state (who's online, current conflicts) lives
in an in-memory `Map`; everything with history value is written through to
SQLite on every heartbeat, so a redeploy restores the board from disk instantly.

---

## Tech stack

Deliberately minimal — nothing to install on either side beyond what a dev
machine already has.

| Layer | Tech | Notes |
|---|---|---|
| **Server** | Node.js ≥ 24, **zero npm dependencies** | Built-ins only: `http`, `crypto`, `fs`, `path`, `node:sqlite`. |
| **Storage** | SQLite via `node:sqlite` | WAL mode; graceful fallback to in-memory-only on Node < 24 or an unwritable path. |
| **Web UI** | vanilla HTML / CSS / JS, no build step | `fetch` + `localStorage`; 5 s poll for live data, 60 s for presence/history. |
| **Client** | `bash` (3.2-compatible) + `curl` | Background daemon, PID-file controlled, outbound only. |
| **Client scanning** | `git`, `awk`, `find`, `sed` | `git diff`/`log`; `awk` parses hunk headers **and** streams the Claude transcripts. |
| **Auth** | `x-cf-key` bearer header | Constant-time compare; `SHARED_KEY` to write, `VIEW_KEY` to read. |
| **Hosting** | Railway (NIXPACKS) | `railway.json` + `/api/health`; Node 24 pinned via `.nvmrc` + `engines`. |
| **Distribution** | Homebrew formula + `cli.sh` router | `claude-foundation dashboard-up …` on each machine. |

---

## How each pipeline works

### 1. Heartbeat & presence

Every `INTERVAL` (15 s) the client POSTs a heartbeat. The server upserts the
agent in memory (online = seen within `ONLINE_TTL_MS`, 30 s) **and** appends a
row to the `heartbeats` log + snapshots the agent's full state into `agents`.
On boot the server restores the presence map from `agents`, so restarts don't
blank the board. `dashboard-down` sends a final `status: offline` beat.

Identity = shared key (auth) + a stable per-machine `agentId`
(`~/.claude-foundation/agent-id`) + git `user.name`.

The **Presence tab** is served by `GET /api/presence`: SQL groups the heartbeat
log into per-hour online minutes per person; the browser converts each hour
bucket to the **viewer's local time** before rendering the weekday × hour
heatmap and daily totals.

### 2. Repo scan — working-in, conflicts, runs, commits, follow-ups

Every `SCAN_INTERVAL` (60 s), scoped to repos that contain `.workflow/` under
the scan roots (bounded by `SCAN_DEPTH` and repo/file caps; `find` prunes
`node_modules`, `.git`, `Library`, …):

- **Changed files + line ranges** — `git diff --unified=0 <merge-base(HEAD,
  default-branch)>..<working tree>` captures everything that differs from the
  shared base **including uncommitted work**; `awk` turns `@@` hunk headers into
  per-file line ranges.
- **Conflicts (server side)** — `computeConflicts()` groups all online agents'
  changes by `repo → file → party (gitUser@branch)`; overlapping ranges
  (padded by 3 lines, like git's merge context) become a ⚠ conflict. Each
  detection is also upserted into `conflict_log` (history) and every reported
  file into `file_edits` (hotspots).
- **`/dev` runs** — `.workflow/*/state.json` gives run id/type/phase/timestamps,
  plus the **mtime of each artifact file** (`spec.md`, `plan.md`, `test-plan.md`,
  `tests.md`, `review.md`, `security.md`, `retro.md`). The Insights **phase
  funnel** is just the median gap between consecutive artifact mtimes — no
  orchestrator changes needed.
- **Commits & follow-ups** — per repo: `git log --since=14.days` bucketed per
  day (all authors), and the `## Open` / `## Closed` table-row counts from
  `.workflow/FOLLOWUPS.md`.
- **My output** (Insights → *Output by person*) — per day, for this machine's
  git identity: **commits + lines added/deleted** (`git log --author
  --numstat`), **pushes** ("update by push" entries in the remote-ref reflogs —
  those only exist on the machine that pushed), and **PRs created** (one
  `gh search prs --author @me` call for all repos, throttled to `PR_INTERVAL`
  900 s; silently 0 when the gh CLI is missing or unauthenticated). The UI
  merges rows per (person, date) with MAX so two machines of the same person
  don't double-count.

### 3. Usage scan — tokens, models, projects, sessions, tools

Every `USAGE_INTERVAL` (300 s — transcripts run to gigabytes) the client streams
the local Claude Code transcripts (`~/.claude/projects/**/*.jsonl`, honoring
`CLAUDE_CONFIG_DIR`) through **one `awk` pass** that emits three aggregates:

1. **Usage rows** per `date × model × project` — `{ input, output, cacheCreate,
   cacheRead, count }`. `project` = basename of the message's `cwd`. Rows are
   **deduped by message id** (session resume/compaction copies history lines
   into new files) and **dated on the machine's local calendar**: timestamps
   are UTC, so the client shifts them by `date +%z` (with proper day-rolling)
   before bucketing — work done at 01:00 local counts as *today*, not
   UTC-yesterday.
2. **Sessions per day** — distinct transcript files per date, with active
   seconds (last − first message time).
3. **Tool calls** — every `tool_use` block, counted per tool name.

Results cache at `~/.claude-foundation/usage.json` and ride every heartbeat.
Only aggregate counts leave the machine — never prompt or transcript content.

**Cost** is estimated in the browser from list prices per model family
($/MTok: fable 10/50, opus 5/25, sonnet 3/15, haiku 1/5; cache write 1.25×
input, cache read 0.1×). It's an estimate — subscriptions and intro pricing
make real spend differ.

### 4. Persistence (SQLite)

`node:sqlite` (built-in, Node ≥ 24) — still zero npm dependencies. Schema
version lives in `PRAGMA user_version`; v2 migrates in place.

| Table | What | Lifetime |
|---|---|---|
| `agents` | Latest full state per agent (JSON) | Restored on boot; deleted on prune/offline |
| `heartbeats` | Append-only log of every beat | Pruned after `HEARTBEAT_LOG_DAYS` (30) |
| `runs` | Every `/dev` run + artifact mtimes | Forever |
| `usage_daily` | Tokens per `(agent, date, model, project)` | Forever — history beyond the client's 30-day window |
| `sessions_daily` | Sessions + active seconds per `(agent, date)` | Forever |
| `tools` | Rolling tool-call counts per `(agent, tool)` | Overwritten each beat |
| `commits_daily` | Commits per `(repo, date)` | Forever |
| `followups` | Open/closed backlog per repo | Overwritten each beat |
| `file_edits` | Which files were edited, per `(day, repo, path, user)` | Forever — powers hotspots |
| `conflict_log` | Every detected line-overlap conflict | Forever |
| `work_daily` | Commits/lines/pushes/PRs per `(agent, date)` | Forever |

**On Railway**: attach a **Volume** (Settings → Volumes, e.g. `/data`) — the
server finds it via `RAILWAY_VOLUME_MOUNT_PATH`; `DB_PATH` overrides. Without a
volume the DB lands in `./data/` and dies with each deploy; without
`node:sqlite` the server logs a warning and runs in-memory only.

### 5. Web UI

No build step. The page asks once for the view key (stored in `localStorage`,
or `?key=`), then polls `/api/online` every 5 s and `/api/presence` +
`/api/history` every 60 s. `?demo` renders every tab with sample data.

**Time handling:** all dates/hours shown are the **viewer's local calendar** —
usage dates are localized by the client at aggregation time, presence buckets
are localized in the browser, and the range filter's "Today" starts at the
viewer's midnight. (One deliberate exception: `file_edits`/`conflict_log` day
labels are bucketed on the server's clock, UTC on Railway.)

---

## Server API (`server.js`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/heartbeat` | `SHARED_KEY` | Upsert agent. Body: `{ agentId, gitUser, host, version, status, runs[], changes[], usage[], sessions[], tools[], prs[] }`. |
| `GET` | `/api/online` | `VIEW_KEY` | Live board: `{ now, ttlMs, onlineCount, totalCount, agents[], conflicts[], runs[], usage[], sessions[], tools[], work[], repoStats[] }`. |
| `GET` | `/api/presence` | `VIEW_KEY` | Hour-bucketed online minutes per person. `?days=` (≤30, default 7). `503` without a DB. |
| `GET` | `/api/history` | `VIEW_KEY` | Durable aggregates: long-range usage, top projects, hotspots, conflict history. `?days=` (≤365, default 120). |
| `GET` | `/api/log/heartbeats` | `VIEW_KEY` | Raw heartbeat log. `?limit=` (≤2000), `?agent=`, `?user=`, `?since=` (epoch ms). |
| `GET` | `/api/health` | none | `{ ok, online, db: "sqlite"\|"off" }`. |
| `GET` | `/` (+ `public/*`) | page public; data needs key | The dashboard UI. |

Raw `changes` (full file paths + line ranges) are **never returned** in the
agent list — they stay server-side, used only for conflicts, hotspots, and the
compact "working in" summary. All inputs are size-capped, control-char
stripped, and length-capped; keys compare in constant time.

Server env: `SHARED_KEY` (required), `VIEW_KEY` (defaults to `SHARED_KEY`),
`PORT` (8473; Railway sets it), `ONLINE_TTL_MS` (30000), `DB_PATH`,
`HEARTBEAT_LOG_DAYS` (30).

---

## The client (`client.sh` via `cli.sh`)

| Command | What it does |
|---|---|
| `claude-foundation dashboard-up --key <k>` | Start the daemon (nohup + PID file). |
| `claude-foundation dashboard-down` | Stop it (sends an offline beat first). |
| `claude-foundation dashboard-status` | Is it running? |
| `claude-foundation dashboard --key <k>` | Foreground loop; `--once` = single beat (debugging). |

### Options

| Flag | Default | Meaning |
|---|---|---|
| `--key <key>` | env `CLAUDE_FOUNDATION_DASHBOARD_KEY` | Shared key (required). |
| `--server <url>` | env `CLAUDE_FOUNDATION_DASHBOARD_URL`, else `DEFAULT_SERVER` | Dashboard server. |
| `--name <name>` | git `user.name` | Display name. |
| `--interval <secs>` | `15` | Heartbeat interval. |
| `--scan <dir>` | `$HOME` (repeatable) | Where to look for `/dev` repos. |
| `--no-activity` | off | Don't report active `/dev` runs. |
| `--no-conflicts` | off | Don't report changed files/lines. |
| `--no-usage` | off | Don't report token/model usage, sessions, or tool calls. |
| `--once` | — | One beat and exit. |

### Env vars

`CLAUDE_FOUNDATION_DASHBOARD_URL`, `CLAUDE_FOUNDATION_DASHBOARD_KEY`,
`CLAUDE_FOUNDATION_STATE` (`~/.claude-foundation`),
`CLAUDE_FOUNDATION_SCAN_ROOTS` (colon-separated),
`CLAUDE_FOUNDATION_SCAN_DEPTH` (6), `CLAUDE_FOUNDATION_ACTIVE_WINDOW` (900),
`CLAUDE_FOUNDATION_SCAN_INTERVAL` (60), `CLAUDE_FOUNDATION_USAGE_DAYS` (30), `CLAUDE_FOUNDATION_PR_INTERVAL` (900),
`CLAUDE_FOUNDATION_USAGE_INTERVAL` (300).

Per-repo label chip: `git config dashboard.label "payments"`.

---

## Run locally

```bash
cd dashboard
SHARED_KEY=devkey node server.js                       # :8473, SQLite in ./data/

# another terminal — live daemon (or `run --once` for a single beat):
./client.sh up --server http://localhost:8473 --key devkey --scan ~/Work
```

Open <http://localhost:8473/?key=devkey>. Stop with `./client.sh down`.

## Deploy (Railway)

1. New project → **Deploy from repo**, root directory = `dashboard/`.
2. Variables: `SHARED_KEY` = long random string (`openssl rand -hex 24`).
3. **Attach a Volume** (any mount path) so SQLite survives deploys.
4. Deploy — Railway sets `PORT`, health-checks `/api/health`, and Node 24 comes
   from `.nvmrc`/`engines`. Verify `/api/health` shows `"db":"sqlite"`.

Point clients at it:

```bash
export CLAUDE_FOUNDATION_DASHBOARD_URL=https://your-app.up.railway.app
claude-foundation dashboard-up --key=<SHARED_KEY>
```

---

## Security & privacy

- One bearer key over HTTPS; rotate by changing `SHARED_KEY`. `VIEW_KEY` can be
  a separate, weaker read-only key.
- `/api/online` exposes git user names, hostnames, repo names, folder paths,
  branches, and aggregate usage numbers — gated by the key. Full changed-file
  paths never leave the server in the agent list.
- Usage reporting reads only the `model`/`usage`/`timestamp`/`cwd`/tool-name
  fields of each transcript line — **never prompts or content**. Opt out per
  concern: `--no-usage`, `--no-conflicts`, `--scan <dir>`.

## Limitations

- **Scoped to `/dev` repos** — only repos containing `.workflow/` are scanned.
- **Tracked changes only** — untracked (never-`git add`ed) files don't count.
- **Heuristic conflicts** — overlapping ranges mean "likely", not "certain".
- **Cost is an estimate** — list prices per family; subscriptions differ.
- **Usage window** — clients report 30 days back; older history accumulates in
  `usage_daily` from the day the server first ran.

## Shipping via Homebrew

Routing lives in `/cli.sh` (top-level): `dashboard*` subcommands →
`dashboard/client.sh`, everything else → `install.sh`. The Homebrew formula
(`Formula/claude-foundation.rb`) installs `cli.sh` + the `dashboard/` dir into
libexec and the `claude-foundation` bin execs `cli.sh`. `DEFAULT_SERVER` in
`client.sh` points at the deployed Railway URL, so teammates only need
`brew install … && claude-foundation dashboard-up --key=<key>`.
