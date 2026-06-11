# claude-foundation dashboard

A small **team awareness dashboard** for everyone using the claude-foundation
`/dev` flow. Each machine runs a background client that heartbeats to one central
server; open the web page and you see, in real time:

1. **Presence** — who's online right now.
2. **Working in** — which repos each person has changes in (repo + folder + branch + file count).
3. **Activity** — which `/dev` runs are in flight (run id + phase).
4. **Potential conflicts** — when two people's changed *line ranges* in the same file overlap, before anyone merges.

No database, no agent on the server, no port on the client. ~Zero-dependency Node
on one side, `bash + curl` on the other.

---

## Tech stack & tools

Deliberately minimal — nothing to install on either side beyond what a dev machine
already has.

| Layer | Tech / tools | Notes |
|---|---|---|
| **Server** | Node.js ≥ 18, **zero npm dependencies** | Built-ins only: `http`, `crypto`, `fs`, `path`, `url`. No framework, no ORM. |
| **Storage** | in-memory `Map` | Presence + changes live in RAM; cleared on restart, refills in one heartbeat. |
| **Web UI** | vanilla HTML / CSS / JS, **no build step** | `fetch` + `localStorage` + 5s polling. Google Fonts (Fraunces / Hanken Grotesk / JetBrains Mono). |
| **Client** | `bash` (3.2-compatible) + `curl` | The background daemon. Outbound HTTP only, PID-file controlled, binds no port. |
| **Client scanning** | `git`, `awk`, `find`, `sed` | `git diff` / `merge-base` / `config`; `awk` parses `@@` hunk headers; `find` locates `.workflow` repos. |
| **Transport / auth** | HTTP(S), JSON | `x-cf-key` bearer header (constant-time compare). |
| **Hosting** | Railway (NIXPACKS builder) | `railway.json` = start command + `/api/health` check; `PORT` injected. |
| **Distribution** | Homebrew formula (Ruby) + `cli.sh` router | `cli.sh` dispatches installer ↔ dashboard; the brew bin execs it. |

**Runtime requirements**

- *Server host:* Node 18+ only (Railway provides it). No services, no database.
- *Each client:* `bash`, `curl`, `git` — already on any dev machine; `awk` / `find`
  / `sed` are POSIX standard. **No Node and no install on the client side.**

**Deliberately *not* used:** no Express/Fastify, no database, no WebSocket library,
no frontend framework or bundler, no npm install. Every dependency is a tool the
machine already ships with — which is what keeps the client a single ~250-line
shell script and the server a single file.

---

## How it works

```
 each teammate's machine                         central server (Railway)
┌──────────────────────────────────┐   HTTPS    ┌──────────────────────────────────────┐
│ claude-foundation dashboard-up   │ ─────────► │ POST /api/heartbeat   (x-cf-key)     │
│   --key <shared-key>             │  every 15s │   → upsert agent, set last-seen       │
│                                  │            │   → store activity + changes          │
│ background loop (PID file,       │            │                                       │
│ no port). Every 45s it scans:    │            │ GET /api/online       (x-cf-key)      │
│  • .workflow/*/state.json        │            │   → agents (online if seen < 30s),    │
│    → active /dev runs            │            │     each with a "working in" summary, │
│  • repos that use /dev:          │            │   → computed `conflicts` (overlaps)   │
│    git diff merge-base..worktree │            │                                       │
│    → changed files + line ranges │            │ GET /api/health  → { ok, online }     │
└──────────────────────────────────┘            │ GET /            → web dashboard      │
                                                 └──────────────────────────────────────┘
 you, in a browser ─────────────────────────────► polls /api/online every 5s, renders
```

The client only ever **sends outbound HTTP**. It binds no port and writes nothing
on the server beyond in-memory presence. The server is the only thing with a port,
and on Railway that's assigned for you.

### Heartbeat (presence)

Every `INTERVAL` seconds (default 15) the client POSTs a heartbeat. The server
keeps an in-memory `Map` of agents keyed by a stable `agentId`. An agent is
**online** if its last heartbeat was within `ONLINE_TTL_MS` (default 30s), and is
**pruned** entirely after 20× that window. Restarting the server clears the board;
it refills within one heartbeat. `dashboard-down` (or Ctrl-C) sends a final
`status: offline` beat so you drop off immediately instead of waiting out the TTL.

**Identity** = a shared key (auth) + a stable per-machine `agentId`
(generated once, cached at `~/.claude-foundation/agent-id`) + your git user name
(`git config user.name`, else email, else `$USER`). The key authenticates;
`agentId` + name tell people apart.

### Working in (which repos)

Each scan, the client looks at the repos that use `/dev` (have a `.workflow/`)
under the scan roots and, for each, reports a per-repo summary derived from
`git diff` (see below). The board shows, per agent:

```
WORKING IN
  Maximumsoft-Co-LTD/payment-hx               ← remote org/repo
  ~/Desktop/Work/payment-hx                   ← local folder (disambiguates clones/sub-repos)
  ⎇ feat/provider/payplus   41 files          ← branch + changed-file count
```

- **repo** = the normalized git remote (`host/org/repo`), so two clones with
  different folder names still match as the same repo across machines.
- **folder** = the home-relative path of the checkout. This is what distinguishes
  same-named or nested repos (e.g. a sub-repo whose remote points at the parent).
- **label** *(optional)* = a friendly chip you set per repo:
  `git config dashboard.label "garena provider"` (unset with `--unset`).

### Activity (which `/dev` run)

The client also scans `.workflow/*/state.json` for runs that are **in flight**
(`done_at: null` and touched within `ACTIVE_WINDOW`, default 900s) and reports the
run `id`, `type`, `branch`, and `phase` straight from `state.json` — shown as
`/dev 0007-feat-login · phase-4-implement` on the card.

### Potential conflicts (the early warning)

This is the reason the client reports *line ranges*, not just file names.

**Client side** — for each `/dev` repo, run:

```
git diff --unified=0 <merge-base(HEAD, default-branch)>..<working tree>
```

This captures everything that differs from the shared base **including
uncommitted work** — exactly what a teammate's git server can't see yet. An `awk`
pass turns the `@@` hunk headers into new-side line ranges per file, so each repo
reports `{ repoId, branch, path, label, files: [{ path, ranges: [[start,end], …] }] }`.

**Server side** — `computeConflicts()` groups all online agents' changes by
`repoId → file → party` (a party is one `gitUser@branch`). For any file touched by
two or more parties whose ranges overlap, it emits a conflict listing only the
**clashing** parties (someone editing a different region of the same file is not
flagged). Ranges are padded by `RANGE_PAD = 3` lines because git itself merges
with 3 lines of context, so near-adjacent edits can still collide.

The web shows a **⚠ Potential conflicts** panel:

```
acme/widget  src/app.txt
  alice ⎇ feature/login  L3–4, L6–7   ⨯   bob ⎇ feature/logout  L5–8
```

It is a heuristic ("you two should coordinate"), not a guarantee that git will
conflict.

### Scanning, decoupled from the heartbeat

The two scans are **cached and run at most every `SCAN_INTERVAL` (45s)**, separate
from the 15s heartbeat. The **first heartbeat fires before any scan** so presence
appears instantly; the heavier repo scan then runs between beats. Scans are scoped
to `.workflow` repos and bounded (`SCAN_DEPTH`, repo/file caps) so a machine with
hundreds of git repos doesn't stall — and `find` prunes `node_modules`, `.git`,
`Library`, `.Trash`, `.cache`.

---

## The client (`client.sh` via `cli.sh`)

The top-level `cli.sh` router maps subcommands to client modes:

| Command | Mode | What it does |
|---|---|---|
| `claude-foundation dashboard-up --key <k>` | `up` | Start the heartbeat in the background (nohup + PID file). |
| `claude-foundation dashboard-down` | `down` | Stop it; sends an offline beat first. |
| `claude-foundation dashboard-status` | `status` | Is it running? (reads the PID file). |
| `claude-foundation dashboard --key <k>` | `run` | Foreground loop (use `--once` for a single beat / debugging). |

From a source checkout the same modes are `./cli.sh dashboard-up …` (or
`./dashboard/client.sh up …`).

### Client options

| Flag | Default | Meaning |
|---|---|---|
| `--key <key>` | env `CLAUDE_FOUNDATION_DASHBOARD_KEY` | Shared key (required). |
| `--server <url>` | env `CLAUDE_FOUNDATION_DASHBOARD_URL`, else `DEFAULT_SERVER` | Dashboard server. |
| `--name <name>` | git `user.name` | Display name. |
| `--interval <secs>` | `15` | Heartbeat interval. |
| `--scan <dir>` | `$HOME` (repeatable) | Where to look for `/dev` repos. |
| `--no-activity` | off | Don't report active `/dev` runs. |
| `--no-conflicts` | off | Don't report changed files/lines (no "working in" or conflicts). |
| `--once` | — | Send one beat and exit (`run` mode). |

### Client env vars

`CLAUDE_FOUNDATION_DASHBOARD_URL`, `CLAUDE_FOUNDATION_DASHBOARD_KEY`,
`CLAUDE_FOUNDATION_STATE` (default `~/.claude-foundation`),
`CLAUDE_FOUNDATION_SCAN_ROOTS` (colon-separated),
`CLAUDE_FOUNDATION_SCAN_DEPTH` (default `6`),
`CLAUDE_FOUNDATION_ACTIVE_WINDOW` (default `900`),
`CLAUDE_FOUNDATION_SCAN_INTERVAL` (default `45`).

---

## The server (`server.js`)

Zero runtime dependencies, Node ≥ 18. Serves the API and the static dashboard.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/heartbeat` | `x-cf-key: <SHARED_KEY>` | Upsert this agent. Body: `{ agentId, gitUser, host, version, status, activity[], changes[] }`. |
| `GET` | `/api/online` | `x-cf-key: <VIEW_KEY>` | `{ now, ttlMs, onlineCount, totalCount, agents[], conflicts[] }`. |
| `GET` | `/api/health` | none | `{ ok, online }`. |
| `GET` | `/` (+ `public/*`) | page is public; data needs the key | The dashboard UI. |

Each agent in `/api/online` is a summary: `{ agentId, gitUser, host, version,
status, activity, repos, firstSeen, lastSeen, ageMs, online }`. Note that the raw
`changes` (full file paths + line ranges) are **never returned in the agent list** —
they live server-side only, used to compute `conflicts` and the compact `repos`
("working in") summary `{ repo, branch, dir, label, files }`.

Inputs are defensively handled: JSON bodies are size-capped, strings are truncated
and stripped of control characters, arrays are length-capped, and keys are compared
in constant time.

Config (env): `SHARED_KEY` (required), `VIEW_KEY` (defaults to `SHARED_KEY`),
`ONLINE_TTL_MS` (default `30000`), `PORT` (default `8473`; Railway sets it).

## The web UI (`public/`)

Vanilla HTML/CSS/JS, no build. It asks once for the view key (stored in
`localStorage`, or passed as `?key=`), then polls `/api/online` every 5s and
renders the conflicts panel, online agents (with "working in" + activity), and
recently-seen agents.

---

## Run locally

```bash
cd dashboard
SHARED_KEY=devkey node server.js                       # listens on :8473

# in another terminal, one beat against localhost:
./client.sh run --once --server http://localhost:8473 --key devkey
```

Open <http://localhost:8473/?key=devkey>. For a live daemon:

```bash
./client.sh up   --server http://localhost:8473 --key devkey   # start
./client.sh status                                             # check
./client.sh down                                               # stop (offline beat)
```

## Deploy the server (Railway)

1. New Railway project → **Deploy from repo**, set the **root directory** to
   `dashboard/` (so it builds this folder, not the whole repo).
2. Add a service variable **`SHARED_KEY`** = a long random string
   (`openssl rand -hex 24`). Optionally set `VIEW_KEY` / `ONLINE_TTL_MS`.
3. Deploy. Railway gives you `https://your-app.up.railway.app`, sets `PORT`, and
   health-checks `/api/health`.

## Point clients at it

```bash
export CLAUDE_FOUNDATION_DASHBOARD_URL=https://your-app.up.railway.app
claude-foundation dashboard-up --key=<SHARED_KEY>
```

`DEFAULT_SERVER` in `client.sh` is also baked to the deployed URL, so once that's
set teammates can just run `claude-foundation dashboard-up --key=<SHARED_KEY>`.

---

## Security & privacy

- The key is a bearer secret over HTTPS; there's no per-user revocation. Rotate by
  changing `SHARED_KEY` and re-sharing.
- `/api/online` exposes git user names, hostnames, repo names, **local folder
  paths, branches, and (for conflicts) changed line ranges** — it's gated by
  `VIEW_KEY`. Raw changed-file *paths* never leave the server in the agent list.
- This is opt-in awareness tooling. Use `--no-conflicts` to report presence +
  `/dev` activity only (no file/line data), and `--scan <dir>` to narrow which
  repos are looked at.

## Limitations (current MVP)

- **Scoped to `/dev` repos** — only repos containing a `.workflow/` are scanned
  for changes/conflicts. Editing a repo you've never run `/dev` in won't show.
- **Tracked changes only** — `git diff` ignores untracked (new, un-`add`ed) files,
  so brand-new files don't count toward "working in" or conflicts yet.
- **Heuristic conflicts** — overlapping ranges mean "likely," not "certain."
- **In-memory only** — no history of who was online / who clashed when.

Possible next steps: persistence/history (SQLite or Railway Postgres), live push
(SSE/WebSocket) instead of 5s polling, per-user keys with revocation, untracked-file
support, and hunk-level conflict context in the panel.

## Shipping via Homebrew

Routing lives in `/cli.sh` (top-level): `dashboard*` → `dashboard/client.sh`,
everything else → `install.sh`; the Homebrew bin execs `cli.sh`.
`Formula/claude-foundation.rb` installs `cli.sh` + `dashboard` and execs `cli.sh`
**for `--HEAD` builds only** (`if build.head?`), so the current stable tarball —
which doesn't bundle these files yet — keeps installing cleanly. At the next tagged
release that includes them: bump `url`/`sha256`, drop the `build.head?` guard, and
keep `DEFAULT_SERVER` pointed at your deployed URL.
