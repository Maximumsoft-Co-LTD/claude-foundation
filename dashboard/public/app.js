'use strict';

/* claude-foundation dashboard — polls /api/online and renders four tabs:
   Team (presence + working-in), Conflicts, Insights (/dev stats), Activity. */

const POLL_MS = 5000;
const KEY_STORE = 'cf-dashboard-key';
const TAB_STORE = 'cf-dashboard-tab';
const TYPE_COLOR = {
  feat: '#2c46f0', fix: '#e8501e', refactor: '#8a4fd6',
  chore: '#5c6470', docs: '#1d8f7a', spike: '#c08a1e', other: '#9a9caa',
};
// Color by model family so e.g. every opus-* version shares a hue.
function modelColor(model) {
  const m = String(model);
  if (m.includes('opus')) return '#8a4fd6';
  if (m.includes('fable') || m.includes('mythos')) return '#e8501e';
  if (m.includes('sonnet')) return '#2c46f0';
  if (m.includes('haiku')) return '#1d8f7a';
  return '#9a9caa';
}
function shortModel(model) { return String(model).replace(/^claude-/, '').replace(/-\d{8}$/, ''); }

// ── Per-person colors ───────────────────────────────────────────────────────
// Stable hashed palette; a profile's chosen color (My profile) overrides.
const USER_PALETTE = [
  '#2c46f0', '#e8501e', '#8a4fd6', '#1d8f7a', '#c08a1e', '#d63384',
  '#0f766e', '#b45309', '#4f46e5', '#65a30d', '#0e7490', '#9f1239',
];
let profilesByUser = new Map(); // user -> { user, email, org, teams, color }
function userColor(name) {
  const p = profilesByUser.get(name);
  if (p && p.color) return p.color;
  const s = String(name || 'unknown');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return USER_PALETTE[h % USER_PALETTE.length];
}
function userDot(name) { return `<span class="ml-dot" style="background:${userColor(name)}"></span>`; }

const $ = (id) => document.getElementById(id);
let timer = null;
let lastData = null;
const modalManager = FoundationModalManager.createModalManager({
  document,
  shell: $('dashboard-shell'),
  skipLink: $('skip-link'),
});

// ── Key handling ────────────────────────────────────────────────────────────
function getKey() {
  const stored = localStorage.getItem(KEY_STORE);
  if (stored) return stored;
  // A key in the query string lands in browser history, proxy logs, and any
  // link the viewer shares. Accept it once as a bootstrap, then move it into
  // storage and scrub it from the address bar.
  const fromUrl = new URLSearchParams(location.search).get('key') || '';
  if (fromUrl) {
    setKey(fromUrl);
    const url = new URL(location.href);
    url.searchParams.delete('key');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return fromUrl;
}
function setKey(k) { localStorage.setItem(KEY_STORE, k); }
function clearKey() { localStorage.removeItem(KEY_STORE); }

function showGate(withError) {
  if (timer) { clearInterval(timer); timer = null; }
  if (typeof extrasTimer !== 'undefined' && extrasTimer) { clearInterval(extrasTimer); extrasTimer = null; }
  $('gate-error').hidden = !withError;
  modalManager.open($('gate'), $('gate-key'));
}
function hideGate() { modalManager.close($('gate'), { restoreFocus: false }); }

// ── Formatting ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function relTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function fmtDur(sec) {
  if (!sec || sec < 0) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
function ago(epochSec) {
  return relTime(Date.now() - epochSec * 1000);
}
function fmtTok(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n < 1e10 ? 1 : 0)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return String(n);
}
// List prices $/MTok by model family (cache write 1.25× input, cache read 0.1×).
// An estimate: subscription plans and intro pricing make real spend differ.
const PRICING = [
  [/fable|mythos/, 10, 50],
  [/opus/, 5, 25],
  [/sonnet/, 3, 15],
  [/haiku/, 1, 5],
];
function estCost(u) {
  const m = String(u.model);
  const p = PRICING.find(([re]) => re.test(m));
  if (!p) return 0;
  const [, inP, outP] = p;
  return ((u.input || 0) * inP + (u.output || 0) * outP
    + (u.cacheCreate || 0) * inP * 1.25 + (u.cacheRead || 0) * inP * 0.1) / 1e6;
}
function fmtUsd(n) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(n >= 1 ? 2 : 2)}`;
}
function fmtHours(min) {
  const h = min / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function setTab(name) {
  document.body.dataset.tab = name;
  localStorage.setItem(TAB_STORE, name);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('is-active', n.dataset.go === name));
}

// ── Charts (vanilla) ────────────────────────────────────────────────────────
function barRow(label, value, max, color, valText) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="bar">
    <span class="bar-label">${escapeHtml(label)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${color || 'var(--signal)'}"></span></span>
    <span class="bar-val">${valText != null ? escapeHtml(String(valText)) : value}</span>
  </div>`;
}
function renderBars(el, rows) {
  el.innerHTML = rows.length ? rows.join('') : '<p class="empty empty--sm">no data yet</p>';
}
function renderCols(el, items) {
  const max = Math.max(1, ...items.map((i) => i.count));
  el.innerHTML = `<div class="cols-plot">${items.map((i) => {
    const h = i.count ? Math.max(Math.round((i.count / max) * 100), 6) : 0;
    const text = i.text != null ? i.text : (i.count || '');
    return `<div class="col" title="${escapeHtml(i.label)}: ${i.text != null ? escapeHtml(String(i.text)) : i.count}">
      <span class="col-n">${escapeHtml(String(text))}</span>
      <span class="col-bar" style="height:${h}%"></span>
      <span class="col-lab">${escapeHtml(i.label)}</span>
    </div>`;
  }).join('')}</div>`;
}

// ── Team cards ──────────────────────────────────────────────────────────────
// One compact line per repo (most-recently-edited first, as ranked by the
// client). Display name = the folder's own name (unique); full repo + path in
// the tooltip so the row stays short.
function workingLine(r) {
  const name = escapeHtml((r.dir && r.dir.split('/').pop()) || r.repo || '·');
  const title = escapeHtml(`${r.repo || ''}${r.dir ? ' · ' + r.dir : ''}`);
  const label = r.label ? `<span class="wk-tag">${escapeHtml(r.label)}</span>` : '';
  const branch = r.branch ? `<span class="wk-branch">⎇ ${escapeHtml(r.branch)}</span>` : '';
  const n = Number(r.files) || 0;
  return `<div class="wk" title="${title}">${label}<span class="wk-repo">${name}</span>${branch}<span class="wk-files">${n}f</span></div>`;
}
function activityLine(it) {
  const repo = escapeHtml(it.repo || '·');
  const branch = it.branch ? `<span class="act-branch">⎇ ${escapeHtml(it.branch)}</span>` : '';
  const run = it.runId ? `<span class="act-run">/dev ${escapeHtml(it.runId)}${it.phase ? ` · ${escapeHtml(it.phase)}` : ''}</span>` : '';
  return `<div class="act"><span class="act-repo">${repo}</span>${branch}${run}</div>`;
}
const WK_VISIBLE = 6;
const expandedAgents = new Set();

function agentCard(a) {
  const cls = a.online ? 'agent agent--online' : 'agent agent--stale';
  const id = escapeHtml((a.agentId || '').slice(0, 8));
  const repos = Array.isArray(a.repos) ? a.repos : [];
  const acts = Array.isArray(a.activity) ? a.activity : [];
  const expanded = expandedAgents.has(a.agentId);
  const shown = expanded ? repos : repos.slice(0, WK_VISIBLE);
  const moreBtn = repos.length > WK_VISIBLE
    ? `<button class="wk-more" data-agent="${escapeHtml(a.agentId)}">${expanded ? 'show less' : `+ ${repos.length - WK_VISIBLE} more`}</button>`
    : '';
  const working = repos.length
    ? `<div class="agent-working"><div class="wk-label">working in · ${repos.length} repo${repos.length === 1 ? '' : 's'}</div>${shown.map(workingLine).join('')}${moreBtn}</div>`
    : '';
  const activity = acts.length ? `<div class="agent-activity">${acts.map(activityLine).join('')}</div>` : '';
  const idle = !repos.length && !acts.length ? '<div class="agent-activity agent-activity--idle">no tracked work</div>' : '';
  const meta = [a.host && escapeHtml(a.host), a.version && `v${escapeHtml(a.version)}`, id].filter(Boolean).join(' · ');
  return `
    <article class="${cls}">
      <div class="agent-head"><span class="agent-dot"></span><span class="agent-name">${userDot(a.gitUser)}${escapeHtml(a.gitUser || 'unknown')}</span></div>
      <div class="agent-meta">${meta}</div>
      ${working}${activity}${idle}
      <div class="agent-seen">${a.online ? 'online' : 'seen'} · ${relTime(a.ageMs)}</div>
    </article>`;
}

// ── Conflicts ───────────────────────────────────────────────────────────────
function shortRepo(repoId) { return escapeHtml(String(repoId).split('/').slice(-2).join('/')); }
function fmtRanges(ranges) {
  return (ranges || []).map((r) => (r[0] === r[1] ? `L${r[0]}` : `L${r[0]}–${r[1]}`)).join(', ');
}
function conflictCard(c) {
  const parties = (c.parties || []).map((p) =>
    `<span class="cf-party"><b style="color:${userColor(p.gitUser)}">${escapeHtml(p.gitUser)}</b><span class="cf-branch">⎇ ${escapeHtml(p.branch)}</span><span class="cf-lines">${fmtRanges(p.ranges)}</span></span>`
  ).join('<span class="cf-vs">⨯</span>');
  return `<article class="conflict">
    <div class="cf-file"><span class="cf-repo">${shortRepo(c.repoId)}</span> <span class="cf-path">${escapeHtml(c.path)}</span></div>
    <div class="cf-parties">${parties}</div>
  </article>`;
}

// ── Renderers ───────────────────────────────────────────────────────────────
function setStatus(state, text) { $('pulse').dataset.state = state; $('status-text').textContent = text; }

function renderTeam(data) {
  const online = data.agents.filter((a) => a.online);
  const recent = data.agents.filter((a) => !a.online);
  $('c-online').textContent = data.onlineCount;
  $('c-seen').textContent = data.totalCount;
  $('ttl').textContent = `${Math.round(data.ttlMs / 1000)}s`;
  if (data.version) $('app-version').textContent = `v${data.version}`;
  $('c-updated').textContent = new Date(data.now).toTimeString().slice(0, 8);
  $('online-grid').innerHTML = online.map(agentCard).join('');
  $('online-empty').hidden = online.length > 0;
  $('recent-wrap').hidden = recent.length === 0;
  $('recent-grid').innerHTML = recent.map(agentCard).join('');
  const badge = $('nav-online'); badge.textContent = data.onlineCount; badge.hidden = !data.onlineCount;
}

function renderConflicts(data) {
  const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
  $('conflicts-list').innerHTML = conflicts.map(conflictCard).join('');
  $('conflicts-empty').hidden = conflicts.length > 0;
  const badge = $('nav-conflicts'); badge.textContent = conflicts.length; badge.hidden = conflicts.length === 0;
}

function renderInsights(s) {
  s = s || {};
  $('st-total').textContent = s.totalCompleted ?? 0;
  $('st-week').textContent = s.completedThisWeek ?? 0;
  $('st-flight').textContent = s.inFlight ?? 0;
  $('st-median').textContent = fmtDur(s.medianDuration || 0);

  const byType = s.byType || {};
  const maxType = Math.max(1, ...Object.values(byType));
  renderBars($('bytype'), Object.entries(byType).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => barRow(t, n, maxType, TYPE_COLOR[t] || TYPE_COLOR.other, n)));

  const durType = s.durByType || {};
  const maxDur = Math.max(1, ...Object.values(durType));
  renderBars($('durtype'), Object.entries(durType).sort((a, b) => b[1] - a[1])
    .map(([t, d]) => barRow(t, d, maxDur, TYPE_COLOR[t] || TYPE_COLOR.other, fmtDur(d))));

  renderCols($('throughput'), s.throughput || []);

  const people = s.topPeople || [];
  const maxP = Math.max(1, ...people.map((p) => p.count));
  renderBars($('lead-people'), people.map((p) => barRow(p.name, p.count, maxP, userColor(p.name), p.count)));

  const repos = s.topRepos || [];
  const maxR = Math.max(1, ...repos.map((r) => r.count));
  renderBars($('lead-repos'), repos.map((r) => barRow(r.repo, r.count, maxR, 'var(--marker)', r.count)));
}

function renderActivity(feed) {
  feed = Array.isArray(feed) ? feed : [];
  $('feed-empty').hidden = feed.length > 0;
  $('feed').innerHTML = feed.map((f) => {
    const color = TYPE_COLOR[f.type] || TYPE_COLOR.other;
    const state = f.done
      ? `<span class="fe-done">✓ shipped</span><span class="fe-dur">${fmtDur(f.durationSec)}</span>`
      : `<span class="fe-active">● ${escapeHtml(f.phase || 'in flight')}</span>`;
    const size = f.size ? `<span class="fe-size" title="/dev size tier">${escapeHtml(f.size)}</span>` : '';
    return `<div class="feed-row">
      <span class="fe-type" style="background:${color}">${escapeHtml(f.type || '·')}</span>
      <div class="fe-main"><span class="fe-id">${escapeHtml(f.id)}${size}</span><span class="fe-meta">${escapeHtml(f.repo || '')} · ${userDot(f.gitUser)}${escapeHtml(f.gitUser || '')}</span></div>
      <div class="fe-state">${state}<span class="fe-when">${ago(f.finished)}</span></div>
    </div>`;
  }).join('');
}

// ── Phase funnel + repo stats (Insights) ────────────────────────────────────
// Runs report artifact mtimes (spec/plan/…) — median gap between consecutive
// artifacts shows where the /dev pipeline spends its time.
const FUNNEL_STAGES = [
  ['spec', 'plan'], ['plan', 'test-plan'], ['plan', 'tests'],
  ['tests', 'review'], ['review', 'retro'],
];
function renderFunnel(runs) {
  const gaps = {};
  for (const r of runs) {
    const art = r.art || {};
    for (const [a, b] of FUNNEL_STAGES) {
      if (art[a] && art[b] && art[b] >= art[a]) (gaps[`${a} → ${b}`] = gaps[`${a} → ${b}`] || []).push(art[b] - art[a]);
    }
  }
  const rows = Object.entries(gaps).map(([label, arr]) => {
    arr.sort((x, y) => x - y);
    return { label, med: arr[Math.floor(arr.length / 2)], n: arr.length };
  });
  const max = Math.max(1, ...rows.map((r) => r.med));
  renderBars($('ins-funnel'), rows.map((r) =>
    barRow(`${r.label} (${r.n})`, r.med, max, 'var(--signal)', fmtDur(r.med))));
}

// Per-person output: commits + lines (git log), pushes (reflog), PRs (gh CLI).
// Rows are per (person, date) — already range-filtered by the caller.
function renderWork(rows) {
  // Two machines of the same person scan the same repos and the same gh
  // account — merge per (person, date) with MAX so they don't double-count.
  const byUserDate = new Map();
  for (const w of rows) {
    const key = `${w.gitUser || 'unknown'}|${w.date}`;
    const m = byUserDate.get(key) || { user: w.gitUser || 'unknown', commits: 0, pushes: 0, prs: 0, added: 0, deleted: 0 };
    m.commits = Math.max(m.commits, w.commits || 0);
    m.pushes = Math.max(m.pushes, w.pushes || 0);
    m.prs = Math.max(m.prs, w.prs || 0);
    m.added = Math.max(m.added, w.added || 0);
    m.deleted = Math.max(m.deleted, w.deleted || 0);
    byUserDate.set(key, m);
  }
  const byUser = {};
  for (const m of byUserDate.values()) {
    const u = byUser[m.user] || (byUser[m.user] = { commits: 0, pushes: 0, prs: 0, added: 0, deleted: 0 });
    u.commits += m.commits; u.pushes += m.pushes; u.prs += m.prs;
    u.added += m.added; u.deleted += m.deleted;
  }
  const list = Object.entries(byUser).sort((a, b) => b[1].commits - a[1].commits);
  $('ins-work').innerHTML = list.length ? `
    <div class="ml-row ml-row--work ml-row--head">
      <span>person</span><span>commits</span><span>pushes</span><span>PRs</span><span>lines +</span><span>lines −</span>
    </div>` + list.map(([u, v]) => `
    <div class="ml-row ml-row--work">
      <span class="ml-model">${userDot(u)}${escapeHtml(u)}</span>
      <span>${fmtTok(v.commits)}</span><span>${fmtTok(v.pushes)}</span><span>${v.prs}</span>
      <span class="wk-add">+${fmtTok(v.added)}</span><span class="wk-del">−${fmtTok(v.deleted)}</span>
    </div>`).join('') : '<p class="empty empty--sm">no work reported yet (needs client v1.8+; PRs need the gh CLI)</p>';
}

function renderRepoStats(stats, now) {
  stats = Array.isArray(stats) ? stats : [];
  // Follow-ups backlog per repo
  const fu = stats.filter((s) => (s.fuOpen || 0) + (s.fuClosed || 0) > 0);
  $('ins-followups').innerHTML = fu.length ? fu.map((s) => `
    <div class="mini-row">
      <span class="mini-main">${escapeHtml(String(s.repoId).split('/').slice(-1)[0])}</span>
      <span class="mini-meta"><b>${s.fuOpen}</b> open · ${s.fuClosed} closed</span>
    </div>`).join('') : '<p class="empty empty--sm">no follow-ups reported</p>';

  // Commits per day across tracked repos (git reports local dates — key locally)
  const byDate = {};
  for (const s of stats) for (const c of s.commits || []) byDate[c.date] = (byDate[c.date] || 0) + (c.n || 0);
  const cols = [];
  for (let i = 13; i >= 0; i--) {
    const key = localDateStr(now - i * DAY);
    const d = new Date(now - i * DAY);
    cols.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count: byDate[key] || 0 });
  }
  renderCols($('ins-commits'), cols);
}

// ── Presence + history (from SQLite via /api/presence and /api/history) ─────
let lastPresence = null;
var lastHistory = null;

const renderPresence = FoundationPresenceView.renderPresence.bind(null, {
  $, barRow, fmtHours, rangeInfo, renderBars, renderCols, userColor
});

function renderHistoryExtras(hist) {
  const usage = hist && Array.isArray(hist.usage) ? hist.usage : [];
  // Monthly token totals (in+out) from the durable usage table
  const byMonth = {};
  for (const u of usage) {
    const m = String(u.date).slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + (u.input || 0) + (u.output || 0);
  }
  const months = Object.keys(byMonth).sort().slice(-8);
  renderCols($('us-monthly'), months.map((m) => ({ label: m.slice(2), count: byMonth[m], text: fmtTok(byMonth[m]) })));

  const hs = hist && Array.isArray(hist.hotspots) ? hist.hotspots : [];
  $('cf-hotspots').innerHTML = hs.length ? hs.slice(0, 15).map((h) => `
    <div class="mini-row" title="${escapeHtml(h.repoId + ' · ' + h.path)}">
      <span class="mini-main">${escapeHtml(String(h.path).split('/').slice(-2).join('/'))}</span>
      <span class="mini-meta">${h.users}p · ${h.days}d · ${escapeHtml(h.last || '')}</span>
    </div>`).join('') : '<p class="empty empty--sm">no history yet</p>';

  const cf = hist && Array.isArray(hist.conflicts) ? hist.conflicts : [];
  $('cf-history').innerHTML = cf.length ? cf.slice(0, 15).map((c) => `
    <div class="mini-row" title="${escapeHtml(c.repoId + ' · ' + c.path)}">
      <span class="mini-main">${escapeHtml(String(c.path).split('/').slice(-2).join('/'))}</span>
      <span class="mini-meta">${escapeHtml(c.users)} · ${escapeHtml(c.day)}</span>
    </div>`).join('') : '<p class="empty empty--sm">No conflicts recorded.</p>';
}

const EXTRAS_MS = 60000;
let extrasTimer = null;
async function pollExtras() {
  const key = getKey();
  if (!key || document.hidden) return;
  const headers = { 'x-cf-key': key };
  const R = rangeInfo(Date.now());
  const days = Math.min(30, Math.max(1, Math.ceil((Date.now() - R.fromMs) / DAY)));
  // History must cover 2× the selected range so the workload comparison has
  // its "previous window"; 120d keeps the fixed hotspot/monthly views stable.
  const rangeDays = Math.max(1, Math.ceil((Date.now() - R.fromMs) / DAY));
  const histDays = Math.min(365, Math.max(120, rangeDays * 2));
  try {
    const [pr, hi, us] = await Promise.all([
      fetch(`./api/presence?days=${days}`, { headers }),
      fetch(`./api/history?days=${histDays}`, { headers }),
      fetch('./api/usage', { headers }),
    ]);
    lastPresence = pr.ok ? await pr.json() : null;
    lastHistory = hi.ok ? await hi.json() : null;
    if (us.ok) {
      const usageData = await us.json();
      lastUsage = Array.isArray(usageData.usage) ? usageData.usage : [];
      lastSessions = Array.isArray(usageData.sessions) ? usageData.sessions : [];
      lastTools = Array.isArray(usageData.tools) ? usageData.tools : [];
      lastWork = Array.isArray(usageData.work) ? usageData.work : [];
      lastRepoStats = Array.isArray(usageData.repoStats) ? usageData.repoStats : [];
    }
  } catch (err) {
    return; // keep last known extras on transient failures
  }
  renderPresence(lastPresence);
  renderHistoryExtras(lastHistory);
  renderMemberFilter(membersFrom(lastRuns, lastUsage));
  applyFilter();
}

// ── Usage (token + model) ───────────────────────────────────────────────────
// Rows are per (machine, day, model) aggregates. "tokens" here = input + output
// (the work the model actually did); cache create/read shown in the model table.
const renderUsage = FoundationUsageView.renderUsage.bind(null, {
  $, barRow, escapeHtml, estCost, fmtTok, fmtUsd, modelColor, rangeInfo,
  renderBars, renderCols, shortModel, userColor
});

// ── /dev run stats (client-side, so we can filter by teammate) ──────────────
const DAY = 86400000;
// ── Date-range filter (shared by Usage / Insights / Activity / Presence) ────
// All range math runs on the viewer's LOCAL calendar: "Today" starts at the
// viewer's midnight, and usage dates (localized by the client) key against it.
const RANGE_PRESETS = [[1, 'Today'], [7, '7d'], [14, '14d'], [30, '30d']];
let rangePreset = 30;   // preset days; 0 = custom from/to
let rangeFrom = '';     // YYYY-MM-DD (custom)
let rangeTo = '';

function localDateStr(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localMidnight(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function rangeInfo(now) {
  let fromStr, toStr;
  if (rangePreset > 0) {
    fromStr = localDateStr(now - (rangePreset - 1) * DAY);
    toStr = localDateStr(now);
  } else {
    fromStr = rangeFrom || localDateStr(now - 29 * DAY);
    toStr = rangeTo || localDateStr(now);
    if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr];
  }
  const fromMs = localMidnight(fromStr);
  const toMsEx = localMidnight(toStr) + DAY; // exclusive end, local midnight
  return { fromStr, toStr, fromMs, toMsEx };
}

const RANGE_CONTAINERS = ['use-range', 'ins-range', 'act-range', 'pr-range'];
function renderRangeFilter() {
  const chip = (d, label) =>
    `<button class="mchip${rangePreset === d ? ' is-active' : ''}" data-range="${d}">${label}</button>`;
  const html = '<span class="rf-lab">Range</span>'
    + RANGE_PRESETS.map(([d, l]) => chip(d, l)).join('')
    + chip(0, 'Custom')
    + `<span class="rf-dates"${rangePreset === 0 ? '' : ' hidden'}>
        <input type="date" class="rf-from" value="${rangeFrom}"> <span class="rf-sep">–</span>
        <input type="date" class="rf-to" value="${rangeTo}">
      </span>`;
  for (const id of RANGE_CONTAINERS) { const el = $(id); if (el) el.innerHTML = html; }
}

function applyRange() {
  renderRangeFilter();
  applyFilter();
  if (!$('demo-banner').hidden) {
    const extras = demoExtras(Date.now());
    renderPresence(extras.presence);
    renderHistoryExtras(extras.history);
  } else if (getKey()) {
    pollExtras(); // presence window depends on the range — refetch
  }
}

var selectedUsers = new Set(); // empty = whole team; multi-select via person/team/org chips
let filterGroups = new Map();  // 'org:<name>' / 'team:<tag>' -> Set of users (rebuilt each render)
var lastRuns = [];
let lastUsage = [];
let lastSessions = [];
let lastTools = [];
var lastWork = [];
let lastRepoStats = [];
let lastNow = 0;

function median(a) { return a.length ? a[Math.floor(a.length / 2)] : 0; }

function statsFrom(runs, now) {
  const completed = runs.filter((r) => r.done);
  const inFlight = runs.filter((r) => !r.done && r.finished && now - r.finished * 1000 <= 7 * DAY);
  const durs = completed.map((r) => r.finished - r.started).filter((d) => d > 0).sort((a, b) => a - b);
  const byType = {}, durArr = {};
  for (const r of completed) {
    const t = r.type || 'other';
    byType[t] = (byType[t] || 0) + 1;
    const d = r.finished - r.started;
    if (d > 0) (durArr[t] = durArr[t] || []).push(d);
  }
  const durByType = {};
  for (const t in durArr) durByType[t] = median(durArr[t].sort((a, b) => a - b));
  const weekAgo = now - 7 * DAY;
  const throughput = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * DAY); d.setHours(0, 0, 0, 0);
    const st = d.getTime();
    throughput.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count: completed.filter((r) => r.finished * 1000 >= st && r.finished * 1000 < st + DAY).length });
  }
  const byPerson = {}, byRepo = {};
  for (const r of completed) {
    byPerson[r.gitUser || 'unknown'] = (byPerson[r.gitUser || 'unknown'] || 0) + 1;
    byRepo[r.repo || 'unknown'] = (byRepo[r.repo || 'unknown'] || 0) + 1;
  }
  const top = (o, k) => Object.entries(o).map(([n, c]) => ({ [k]: n, count: c })).sort((a, b) => b.count - a.count).slice(0, 8);
  return {
    totalCompleted: completed.length,
    completedThisWeek: completed.filter((r) => r.finished * 1000 >= weekAgo).length,
    inFlight: inFlight.length,
    medianDuration: median(durs),
    byType, durByType, throughput,
    topPeople: top(byPerson, 'name'), topRepos: top(byRepo, 'repo'),
  };
}
function feedFrom(runs) {
  return runs.filter((r) => r.finished).slice().sort((a, b) => b.finished - a.finished).slice(0, 30)
    .map((r) => ({ ...r, durationSec: r.done && r.finished > r.started ? r.finished - r.started : 0 }));
}
function membersFrom(runs, usage) {
  const c = {};
  for (const r of runs) { const u = r.gitUser || 'unknown'; c[u] = (c[u] || 0) + 1; }
  // someone with usage but no /dev runs still gets a chip (count stays run-based)
  for (const u of usage || []) { const n = u.gitUser || 'unknown'; if (!(n in c)) c[n] = 0; }
  return Object.entries(c).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
function renderMemberFilter(members) {
  // Group chips (org / team tags) come from profiles; person chips from the data.
  const known = new Set(members.map((m) => m.name));
  filterGroups = new Map();
  for (const [u, p] of profilesByUser) {
    if (!known.has(u)) continue;
    if (p.org) {
      const k = `org:${p.org}`;
      if (!filterGroups.has(k)) filterGroups.set(k, new Set());
      filterGroups.get(k).add(u);
    }
    for (const t of p.teams || []) {
      const k = `team:${t}`;
      if (!filterGroups.has(k)) filterGroups.set(k, new Set());
      filterGroups.get(k).add(u);
    }
  }
  const groupActive = (set) =>
    selectedUsers.size === set.size && [...set].every((u) => selectedUsers.has(u));
  const chips = [`<button class="mchip${selectedUsers.size ? '' : ' is-active'}" data-user="">Whole team</button>`];
  for (const [k, set] of [...filterGroups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [kind, name] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    const sym = kind === 'org' ? '⌂' : '#';
    chips.push(`<button class="mchip mchip--group${groupActive(set) ? ' is-active' : ''}" data-group="${escapeHtml(k)}" title="${kind}: select all ${set.size}">${sym} ${escapeHtml(name)}<span class="mchip-n">${set.size}</span></button>`);
  }
  for (const m of members) {
    chips.push(`<button class="mchip${selectedUsers.has(m.name) ? ' is-active' : ''}" data-user="${escapeHtml(m.name)}"><span class="mchip-dot" style="background:${userColor(m.name)}"></span>${escapeHtml(m.name)}${m.count ? `<span class="mchip-n">${m.count}</span>` : ''}</button>`);
  }
  const html = chips.join('');
  $('ins-filter').innerHTML = html;
  $('act-filter').innerHTML = html;
  $('use-filter').innerHTML = html;
}
function applyFilter() {
  const now = lastNow || Date.now();
  const R = rangeInfo(now);
  const by = (arr) => (selectedUsers.size ? arr.filter((x) => selectedUsers.has(x.gitUser || 'unknown')) : arr);
  const byDate = (arr) => arr.filter((x) => x.date >= R.fromStr && x.date <= R.toStr);
  const runs = by(lastRuns).filter((r) => !r.finished || (r.finished * 1000 >= R.fromMs && r.finished * 1000 < R.toMsEx));
  renderInsights(statsFrom(runs, now));
  renderWork(byDate(by(lastWork)));
  renderWorkload(now);
  renderFunnel(runs);
  renderRepoStats(lastRepoStats, now);
  renderActivity(feedFrom(runs));
  renderUsage(byDate(by(lastUsage)), byDate(by(lastSessions)), byDate(by(lastTools)), now, R);
}

// ── Workload: selected range vs the previous equal-length window ───────────
// Points = completed /dev runs weighted by size tier (unknown size counts as S).
// Commits/lines come from work rows (live 14d + /api/history beyond), MAX-merged
// per (person, date) so two machines of one person don't double-count.
const renderWorkload = FoundationWorkloadView.renderWorkload.bind(null, {
  $, day: DAY, escapeHtml, fmtTok, localDateStr, rangeInfo, userDot
});

function render(data) {
  lastData = data;
  lastRuns = Array.isArray(data.runs) ? data.runs : [];
  if (Array.isArray(data.usage)) lastUsage = data.usage;
  if (Array.isArray(data.sessions)) lastSessions = data.sessions;
  if (Array.isArray(data.tools)) lastTools = data.tools;
  if (Array.isArray(data.work)) lastWork = data.work;
  if (Array.isArray(data.repoStats)) lastRepoStats = data.repoStats;
  lastNow = data.now;
  profilesByUser = new Map((Array.isArray(data.profiles) ? data.profiles : []).map((p) => [p.user, p]));
  renderTeam(data);
  renderConflicts(data);
  // drop stale selections for people who no longer appear
  if (selectedUsers.size) {
    const present = new Set();
    for (const r of lastRuns) present.add(r.gitUser || 'unknown');
    for (const u of lastUsage) present.add(u.gitUser || 'unknown');
    for (const u of [...selectedUsers]) if (!present.has(u)) selectedUsers.delete(u);
  }
  renderMemberFilter(membersFrom(lastRuns, lastUsage));
  applyFilter();
  setStatus('ok', `${data.onlineCount} online`);
}

// ── Polling ─────────────────────────────────────────────────────────────────
async function poll() {
  const key = getKey();
  if (!key) return showGate(false);
  if (document.hidden) return; // hidden tab: skip; visibilitychange re-polls on return
  try {
    const res = await fetch('./api/online', { headers: { 'x-cf-key': key } });
    if (res.status === 401) { clearKey(); return showGate(true); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    hideGate();
    render(await res.json());
  } catch (err) {
    setStatus('error', 'offline — retrying');
  }
}
function start() {
  const key = getKey();
  if (!key) return showGate(false);
  hideGate();
  poll();
  pollExtras();
  if (timer) clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
  if (extrasTimer) clearInterval(extrasTimer);
  extrasTimer = setInterval(pollExtras, EXTRAS_MS);
}

// ── Demo mode ───────────────────────────────────────────────────────────────
function demoRuns(now) {
  const sec = Math.floor(now / 1000);
  const people = ['alice', 'bob', 'carol', 'erin'];
  const pw = [0, 0, 1, 1, 2, 3]; // weight toward alice/bob
  const repos = ['checkout-service', 'web', 'infra', 'design-system'];
  const types = ['feat', 'feat', 'feat', 'fix', 'fix', 'refactor', 'chore', 'docs'];
  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; // stable LCG
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const runs = [];
  for (let i = 0; i < 52; i++) {
    const type = pick(types);
    const finished = sec - Math.floor(rnd() * 14) * 86400 - Math.floor(rnd() * 50000);
    const dur = 600 + Math.floor(rnd() * 36000);
    const st = finished - dur;
    const art = {
      spec: Math.round(st + dur * 0.12), plan: Math.round(st + dur * 0.28),
      'test-plan': Math.round(st + dur * 0.33), tests: Math.round(st + dur * 0.72),
      review: Math.round(st + dur * 0.88), retro: finished,
    };
    runs.push({ id: `${100 + i}-${type}-run`, type, size: pick(['XS', 'S', 'S', 'M', 'M', 'L']), repo: pick(repos), gitUser: people[pw[Math.floor(rnd() * pw.length)]], phase: 'done', started: st, finished, done: true, art });
  }
  runs.push({ id: '0042-feat-stripe-retry', type: 'feat', repo: 'checkout-service', gitUser: 'alice', phase: 'phase-2-implementation', started: sec - 5000, finished: sec - 120, done: false });
  runs.push({ id: '0043-fix-charge-idempotency', type: 'fix', repo: 'checkout-service', gitUser: 'bob', phase: 'phase-2-implementation', started: sec - 8000, finished: sec - 300, done: false });
  runs.push({ id: '0044-refactor-checkout', type: 'refactor', repo: 'web', gitUser: 'carol', phase: 'phase-1-requirements', started: sec - 1000, finished: sec - 600, done: false });
  return runs;
}

function demoUsage(now) {
  const people = ['alice', 'bob', 'carol'];
  const models = ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'];
  const weight = [3.0, 1.4, 0.8, 0.2]; // fable-heavy team
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rows = [];
  for (let i = 0; i < 21; i++) {
    const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
    for (const p of people) {
      for (let m = 0; m < models.length; m++) {
        if (rnd() < 0.35) continue;
        const out = Math.floor(rnd() * 400000 * weight[m]);
        rows.push({
          gitUser: p, agentId: `demo-${p}`, date, model: models[m],
          project: ['checkout-service', 'web', 'infra', 'design-system'][Math.floor(rnd() * 4)],
          input: Math.floor(out * (0.2 + rnd() * 0.4)), output: out,
          cacheCreate: out * 8, cacheRead: out * 90, count: Math.floor(out / 900) + 1,
        });
      }
    }
  }
  return rows;
}

function demoExtras(now) {
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const people = ['alice', 'bob', 'carol'];
  const buckets = [];
  for (let i = 0; i < 14 * 24; i++) {
    const hourEpoch = Math.floor(now / 3600000) - i;
    const local = new Date(hourEpoch * 3600000);
    const h = local.getHours(), dow = local.getDay();
    if (dow === 0 || dow === 6) continue;
    for (const u of people) {
      if (h >= 9 && h <= 18 && rnd() > 0.25) buckets.push({ user: u, hour: hourEpoch, minutes: Math.round(20 + rnd() * 40) });
      else if ((h === 8 || h > 18) && rnd() > 0.85) buckets.push({ user: u, hour: hourEpoch, minutes: Math.round(rnd() * 20) });
    }
  }
  const usage = [];
  for (let i = 0; i < 120; i++) {
    const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
    usage.push({ date, model: 'claude-fable-5', input: 200000, output: Math.floor(rnd() * 900000), cacheCreate: 0, cacheRead: 0, count: 300 });
    usage.push({ date, model: 'claude-sonnet-5', input: 100000, output: Math.floor(rnd() * 400000), cacheCreate: 0, cacheRead: 0, count: 200 });
  }
  const hotspots = [
    { repoId: 'github.com/acme/checkout-service', path: 'src/payment/charge.ts', days: 9, users: 3, last: new Date(now).toISOString().slice(0, 10) },
    { repoId: 'github.com/acme/web', path: 'src/routes/checkout.tsx', days: 6, users: 2, last: new Date(now - 86400000).toISOString().slice(0, 10) },
    { repoId: 'github.com/acme/checkout-service', path: 'src/payment/refund.ts', days: 4, users: 2, last: new Date(now - 3 * 86400000).toISOString().slice(0, 10) },
  ];
  const conflicts = [
    { day: new Date(now).toISOString().slice(0, 10), repoId: 'github.com/acme/checkout-service', path: 'src/payment/charge.ts', users: 'alice+bob', lastTs: now },
    { day: new Date(now - 5 * 86400000).toISOString().slice(0, 10), repoId: 'github.com/acme/web', path: 'src/routes/checkout.tsx', users: 'bob+carol', lastTs: now - 5 * 86400000 },
  ];
  return { presence: { days: 14, buckets }, history: { usage, hotspots, conflicts } };
}

function demoData() {
  const now = Date.now();
  return {
    now, ttlMs: 30000, onlineCount: 3, totalCount: 4,
    profiles: [
      { user: 'alice', org: 'acme', teams: ['payments'], color: '' },
      { user: 'bob', org: 'acme', teams: ['payments'], color: '' },
      { user: 'carol', org: 'acme', teams: ['web'], color: '' },
      { user: 'erin', org: 'acme', teams: ['infra'], color: '' },
    ],
    conflicts: [{
      repoId: 'github.com/acme/checkout-service', path: 'src/payment/charge.ts',
      parties: [
        { gitUser: 'alice', branch: 'feat/stripe-retry', ranges: [[42, 58]] },
        { gitUser: 'bob', branch: 'fix/charge-idempotency', ranges: [[50, 63]] },
      ],
    }],
    agents: [
      { agentId: 'demo-alice01', gitUser: 'alice', host: 'alice-mbp', version: '1.5.0', online: true, ageMs: 3000,
        repos: [{ repo: 'acme/checkout-service', branch: 'feat/stripe-retry', dir: '~/work/checkout-service', label: 'payments', files: 7 }],
        activity: [{ repo: 'checkout-service', branch: 'feat/stripe-retry', runId: '0042-feat-stripe-retry', type: 'feat', phase: 'phase-2-implementation' }] },
      { agentId: 'demo-bob0001', gitUser: 'bob', host: 'bob-linux', version: '1.5.0', online: true, ageMs: 9000,
        repos: [{ repo: 'acme/checkout-service', branch: 'fix/charge-idempotency', dir: '~/dev/checkout-service', label: 'payments', files: 4 }],
        activity: [{ repo: 'checkout-service', branch: 'fix/charge-idempotency', runId: '0043-fix-charge-idempotency', type: 'fix', phase: 'phase-2-implementation' }] },
      { agentId: 'demo-carol01', gitUser: 'carol', host: 'carol-mbp', version: '1.5.0', online: true, ageMs: 14000,
        repos: [{ repo: 'acme/web', branch: 'feat/express-checkout', dir: '~/work/web', label: '', files: 11 }], activity: [] },
      { agentId: 'demo-erin001', gitUser: 'erin', host: 'erin-mbp', version: '1.5.0', online: false, ageMs: 95000,
        repos: [{ repo: 'acme/infra', branch: 'chore/bump-deps', dir: '~/work/infra', label: '', files: 3 }], activity: [] },
    ],
    runs: demoRuns(now),
    usage: demoUsage(now),
    sessions: (() => {
      const out = [];
      for (let i = 0; i < 14; i++) {
        const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
        for (const p of ['alice', 'bob', 'carol']) out.push({ gitUser: p, date, count: 2 + ((i * 7 + p.length) % 5), seconds: 3600 * (2 + ((i + p.length) % 6)) });
      }
      return out;
    })(),
    tools: Array.from({ length: 14 }, (_, day) => {
      const date = new Date(now - day * 86400000).toISOString().slice(0, 10);
      return ['Bash', 'Edit', 'Read', 'Write', 'Grep', 'Agent', 'WebSearch'].flatMap((tool, i) =>
        ['alice', 'bob', 'carol'].map((p) => ({ gitUser: p, date, tool, count: Math.floor(220 / (i + 1)) })));
    }).flat(),
    repoStats: [
      { repoId: 'github.com/acme/checkout-service', fuOpen: 4, fuClosed: 11, commits: Array.from({ length: 14 }, (_, i) => ({ date: new Date(now - i * 86400000).toISOString().slice(0, 10), n: (i * 5) % 7 })) },
      { repoId: 'github.com/acme/web', fuOpen: 1, fuClosed: 6, commits: Array.from({ length: 14 }, (_, i) => ({ date: new Date(now - i * 86400000).toISOString().slice(0, 10), n: (i * 3) % 5 })) },
    ],
    work: ['alice', 'bob', 'carol'].flatMap((p, pi) =>
      Array.from({ length: 14 }, (_, i) => ({
        gitUser: p,
        date: new Date(now - i * 86400000).toISOString().slice(0, 10),
        commits: ((i + pi) * 3) % 6, pushes: ((i + pi) * 2) % 4, prs: (i + pi) % 7 === 0 ? 1 : 0,
        added: (((i + pi) * 97) % 400) + 40, deleted: ((i + pi) * 53) % 160,
      }))),
  };
}
function isDemo() { return new URLSearchParams(location.search).has('demo'); }
function enterDemo() {
  if (timer) { clearInterval(timer); timer = null; }
  if (extrasTimer) { clearInterval(extrasTimer); extrasTimer = null; }
  hideGate();
  $('demo-banner').hidden = false;
  $('header-demo').hidden = true;
  $('signout').hidden = true;
  setStatus('ok', 'demo');
  render(demoData());
  const extras = demoExtras(Date.now());
  renderPresence(extras.presence);
  renderHistoryExtras(extras.history);
  if (!isDemo()) history.replaceState(null, '', `${location.pathname}?demo`);
}
function exitDemo() {
  $('demo-banner').hidden = true;
  $('header-demo').hidden = false;
  $('signout').hidden = false;
  history.replaceState(null, '', location.pathname);
  start();
}

// ── Wire up ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => setTab(n.dataset.go)));
setTab(localStorage.getItem(TAB_STORE) || 'team');

['ins-filter', 'act-filter', 'use-filter'].forEach((fid) => $(fid).addEventListener('click', (e) => {
  const btn = e.target.closest('.mchip');
  if (!btn) return;
  if (btn.dataset.group != null) {
    // team/org chip: select the whole group; clicking it again deselects.
    const set = filterGroups.get(btn.dataset.group) || new Set();
    const same = selectedUsers.size === set.size && [...set].every((u) => selectedUsers.has(u));
    selectedUsers = same ? new Set() : new Set(set);
  } else {
    const u = btn.dataset.user || '';
    if (!u) selectedUsers = new Set(); // Whole team
    else if (selectedUsers.has(u)) selectedUsers.delete(u);
    else selectedUsers.add(u);
  }
  renderMemberFilter(membersFrom(lastRuns, lastUsage));
  applyFilter();
}));

// Date-range chips + custom from/to, mirrored across the four tabs.
RANGE_CONTAINERS.forEach((rid) => {
  const el = $(rid);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.mchip');
    if (!btn) return;
    rangePreset = Number(btn.dataset.range);
    if (rangePreset === 0 && !rangeFrom && !rangeTo) {
      rangeFrom = new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10);
      rangeTo = new Date().toISOString().slice(0, 10);
    }
    applyRange();
  });
  el.addEventListener('change', (e) => {
    if (e.target.classList.contains('rf-from')) rangeFrom = e.target.value;
    else if (e.target.classList.contains('rf-to')) rangeTo = e.target.value;
    else return;
    rangePreset = 0;
    applyRange();
  });
});
renderRangeFilter();

['online-grid', 'recent-grid'].forEach((gid) => $(gid).addEventListener('click', (e) => {
  const btn = e.target.closest('.wk-more');
  if (!btn) return;
  const id = btn.dataset.agent;
  if (expandedAgents.has(id)) expandedAgents.delete(id); else expandedAgents.add(id);
  if (lastData) renderTeam(lastData);
}));

$('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const k = $('gate-key').value.trim();
  if (!k) return;
  setKey(k); $('gate-key').value = ''; start();
});
$('signout').addEventListener('click', () => { clearKey(); showGate(false); });
$('gate-demo').addEventListener('click', enterDemo);
$('header-demo').addEventListener('click', enterDemo);
$('demo-exit').addEventListener('click', exitDemo);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !isDemo() && getKey()) { poll(); pollExtras(); }
});

// ── My profile (team tags / org / color) ───────────────────────────────────
const ME_STORE = 'cf-dashboard-me';
let pfColorAuto = true;
function openProfile() {
  const me = localStorage.getItem(ME_STORE) || '';
  const p = profilesByUser.get(me);
  $('pf-user').value = me;
  $('pf-org').value = (p && p.org) || '';
  $('pf-teams').value = p ? (p.teams || []).join(', ') : '';
  pfColorAuto = !(p && p.color);
  $('pf-color').value = (p && p.color) || userColor(me || 'unknown');
  $('pf-users').innerHTML = membersFrom(lastRuns, lastUsage)
    .map((m) => `<option value="${escapeHtml(m.name)}">`).join('');
  $('pf-error').hidden = true;
  modalManager.open($('profile-modal'), $('pf-user'), { dismissible: true });
}
$('profile-btn').addEventListener('click', openProfile);
$('pf-cancel').addEventListener('click', () => { modalManager.close($('profile-modal')); });
$('pf-color').addEventListener('input', () => { pfColorAuto = false; });
$('pf-color-clear').addEventListener('click', () => {
  pfColorAuto = true;
  $('pf-color').value = userColor($('pf-user').value.trim() || 'unknown');
});
$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('pf-user').value.trim();
  if (!user) return;
  const body = {
    user,
    org: $('pf-org').value.trim(),
    teams: $('pf-teams').value.split(',').map((t) => t.trim()).filter(Boolean),
    color: pfColorAuto ? '' : $('pf-color').value,
  };
  try {
    const res = await fetch('./api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cf-key': getKey() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = await res.json();
    localStorage.setItem(ME_STORE, user);
    profilesByUser.set(user, out.profile || body);
    modalManager.close($('profile-modal'));
    renderMemberFilter(membersFrom(lastRuns, lastUsage));
    applyFilter();
  } catch (err) {
    $('pf-error').hidden = false;
  }
});

if (isDemo()) enterDemo();
else start();
