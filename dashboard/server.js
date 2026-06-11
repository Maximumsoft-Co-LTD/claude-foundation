'use strict';

/**
 * claude-foundation dashboard — central presence server.
 *
 * Every installed agent runs `claude-foundation dashboard --key=…` which POSTs
 * a heartbeat here every few seconds. This server keeps an in-memory map of
 * agents and reports who has been seen within ONLINE_TTL_MS as "online". It
 * also serves the static web dashboard from ./public.
 *
 * Zero runtime dependencies — Node >= 18 only. Designed to run on Railway,
 * which sets PORT for us.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config (env) ────────────────────────────────────────────────────────────
const PORT = toInt(process.env.PORT, 8473); // off the common dev ports; Railway overrides via PORT
const SHARED_KEY = process.env.SHARED_KEY || '';
const VIEW_KEY = process.env.VIEW_KEY || SHARED_KEY; // who may read /api/online
const ONLINE_TTL_MS = toInt(process.env.ONLINE_TTL_MS, 30_000); // online window
const PRUNE_AFTER_MS = ONLINE_TTL_MS * 20; // forget agents gone this long
const MAX_BODY_BYTES = 512 * 1024; // rich change payloads (many repos × files × ranges)
const MAX_FIELD_LEN = 200;
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!SHARED_KEY) {
  console.error('FATAL: SHARED_KEY env var is required — the shared key every agent presents on heartbeat.');
  process.exit(1);
}

// ── Presence store ──────────────────────────────────────────────────────────
// agentId -> { agentId, gitUser, host, version, status, firstSeen, lastSeen }
const agents = new Map();

/** Drop agents we have not heard from in a long time. */
function prune(now) {
  for (const [id, a] of agents) {
    if (now - a.lastSeen > PRUNE_AFTER_MS) agents.delete(id);
  }
}

/** Shape the public view of one agent. */
function snapshot(a, now) {
  const ageMs = now - a.lastSeen;
  return {
    agentId: a.agentId,
    gitUser: a.gitUser,
    host: a.host,
    version: a.version,
    status: a.status,
    activity: a.activity || [],
    // Compact "working in" summary — repo + branch + file count, derived from the
    // reported changes. Full paths/line-ranges stay server-side for conflict math.
    repos: (a.changes || []).map((c) => ({
      repo: String(c.repoId).split('/').slice(-2).join('/'),
      branch: c.branch,
      dir: c.path || '',
      label: c.label || '',
      files: Array.isArray(c.files) ? c.files.length : 0,
    })),
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    ageMs,
    online: ageMs <= ONLINE_TTL_MS && a.status !== 'offline',
  };
}

// ── Pure helpers ────────────────────────────────────────────────────────────
function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce to a clean, bounded, control-char-free string. */
function clean(v, max = MAX_FIELD_LEN) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max).trim();
}

/** Sanitize the optional activity array (the in-flight /dev runs an agent reports). */
function cleanActivity(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 20)
    .map((it) => ({
      repo: clean(it && it.repo, 80),
      branch: clean(it && it.branch, 120),
      runId: clean(it && it.runId, 80),
      type: clean(it && it.type, 20),
      phase: clean(it && it.phase, 40),
    }))
    .filter((it) => it.repo || it.branch || it.runId);
}

/** Sanitize a list of [start,end] line ranges. */
function cleanRanges(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, 200)) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const s = Math.max(0, Math.floor(Number(r[0])) || 0);
    const e = Math.max(s, Math.floor(Number(r[1])) || s);
    out.push([s, e]);
  }
  return out;
}

/** Sanitize the optional changes array (per-repo changed files+line-ranges for conflict detection). */
function cleanChanges(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 60)
    .map((r) => ({
      repoId: clean(r && r.repoId, 200),
      branch: clean(r && r.branch, 120),
      path: clean(r && r.path, 300),
      label: clean(r && r.label, 80),
      files: Array.isArray(r && r.files)
        ? r.files
            .slice(0, 100)
            .map((f) => ({ path: clean(f && f.path, 300), ranges: cleanRanges(f && f.ranges) }))
            .filter((f) => f.path && f.ranges.length)
        : [],
    }))
    .filter((r) => r.repoId && r.files.length);
}

/** Constant-time string compare that tolerates length differences. */
function keyMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Pull the presented key from header or ?key= query. */
function presentedKey(req, url) {
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return req.headers['x-cf-key'] || bearer || url.searchParams.get('key') || '';
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-cf-key, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Read a size-capped JSON body. Resolves { ok, value | error }. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering but keep draining so the connection ends cleanly — a
        // req.destroy() here makes the upstream proxy surface a 502.
        over = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return resolve({ ok: false, error: 'body too large' });
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({ ok: true, value: {} });
      try {
        resolve({ ok: true, value: JSON.parse(raw) });
      } catch {
        resolve({ ok: false, error: 'invalid JSON' });
      }
    });
    req.on('error', () => resolve({ ok: false, error: 'read error' }));
  });
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Serve a static file from PUBLIC_DIR, guarding against path traversal. */
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Route handlers ──────────────────────────────────────────────────────────
async function handleHeartbeat(req, res, url) {
  if (!keyMatches(presentedKey(req, url), SHARED_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return sendJson(res, 400, { ok: false, error: body.error });

  const agentId = clean(body.value.agentId);
  if (!agentId) return sendJson(res, 400, { ok: false, error: 'agentId required' });

  const now = Date.now();
  const status = clean(body.value.status) || 'online';
  const existing = agents.get(agentId);
  agents.set(agentId, {
    agentId,
    gitUser: clean(body.value.gitUser) || 'unknown',
    host: clean(body.value.host),
    version: clean(body.value.version),
    status,
    activity: cleanActivity(body.value.activity),
    changes: cleanChanges(body.value.changes),
    firstSeen: existing ? existing.firstSeen : now,
    lastSeen: now,
  });

  if (status === 'offline') agents.delete(agentId);

  prune(now);
  const onlineCount = [...agents.values()].filter((a) => now - a.lastSeen <= ONLINE_TTL_MS).length;
  return sendJson(res, 200, { ok: true, onlineCount, ttlMs: ONLINE_TTL_MS });
}

// git performs 3-way merges with 3 lines of context, so edits within a few
// lines of each other can still collide — pad ranges before testing overlap.
const RANGE_PAD = 3;

function rangesOverlap(a, b) {
  for (const [s1, e1] of a) {
    for (const [s2, e2] of b) {
      if (s1 - RANGE_PAD <= e2 && s2 - RANGE_PAD <= e1) return true;
    }
  }
  return false;
}

/**
 * Cross-reference online agents' changes: for each repo+file touched by two or
 * more distinct (user, branch) parties with overlapping line ranges, emit a
 * potential-conflict entry. This is a heuristic early warning, not a guarantee.
 */
function computeConflicts(now) {
  const live = [...agents.values()].filter(
    (a) => now - a.lastSeen <= ONLINE_TTL_MS && Array.isArray(a.changes) && a.changes.length,
  );

  // repoId -> path -> partyKey -> { gitUser, branch, ranges }
  const idx = new Map();
  for (const a of live) {
    for (const repo of a.changes) {
      for (const f of repo.files) {
        if (!idx.has(repo.repoId)) idx.set(repo.repoId, new Map());
        const files = idx.get(repo.repoId);
        if (!files.has(f.path)) files.set(f.path, new Map());
        const partyKey = `${a.gitUser}@@${repo.branch}`;
        const existing = files.get(f.path).get(partyKey);
        if (existing) existing.ranges = existing.ranges.concat(f.ranges);
        else files.get(f.path).set(partyKey, { gitUser: a.gitUser, branch: repo.branch, ranges: f.ranges.slice() });
      }
    }
  }

  const conflicts = [];
  for (const [repoId, files] of idx) {
    for (const [path, partyMap] of files) {
      const parties = [...partyMap.values()];
      if (parties.length < 2) continue;
      // Keep only parties that actually overlap with at least one other party,
      // so someone editing a different region of the same file isn't flagged.
      const involved = new Array(parties.length).fill(false);
      for (let i = 0; i < parties.length; i++) {
        for (let j = i + 1; j < parties.length; j++) {
          if (rangesOverlap(parties[i].ranges, parties[j].ranges)) involved[i] = involved[j] = true;
        }
      }
      const clashing = parties.filter((_, i) => involved[i]);
      if (clashing.length >= 2) conflicts.push({ repoId, path, parties: clashing });
    }
  }
  conflicts.sort((x, y) => y.parties.length - x.parties.length || x.path.localeCompare(y.path));
  return conflicts.slice(0, 100);
}

function handleOnline(req, res, url) {
  if (!keyMatches(presentedKey(req, url), VIEW_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  const now = Date.now();
  prune(now);
  const all = [...agents.values()].map((a) => snapshot(a, now));
  all.sort((x, y) => (x.online === y.online ? x.gitUser.localeCompare(y.gitUser) : x.online ? -1 : 1));
  return sendJson(res, 200, {
    now,
    ttlMs: ONLINE_TTL_MS,
    onlineCount: all.filter((a) => a.online).length,
    totalCount: all.length,
    agents: all,
    conflicts: computeConflicts(now),
  });
}

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-cf-key, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
    return res.end();
  }

  if (pathname === '/api/health') {
    const online = [...agents.values()].filter((a) => Date.now() - a.lastSeen <= ONLINE_TTL_MS).length;
    return sendJson(res, 200, { ok: true, online });
  }
  if (pathname === '/api/heartbeat' && req.method === 'POST') return handleHeartbeat(req, res, url);
  if (pathname === '/api/online' && req.method === 'GET') return handleOnline(req, res, url);
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'unknown endpoint' });

  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`claude-foundation dashboard listening on :${PORT}  (online window ${ONLINE_TTL_MS}ms)`);
});

// Railway sends SIGTERM on redeploy — shut the socket cleanly.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} received — closing.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
