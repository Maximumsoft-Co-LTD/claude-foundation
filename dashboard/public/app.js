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

const $ = (id) => document.getElementById(id);
let timer = null;
let lastData = null;

// ── Key handling ────────────────────────────────────────────────────────────
function getKey() {
  return localStorage.getItem(KEY_STORE) || new URLSearchParams(location.search).get('key') || '';
}
function setKey(k) { localStorage.setItem(KEY_STORE, k); }
function clearKey() { localStorage.removeItem(KEY_STORE); }

function showGate(withError) {
  if (timer) { clearInterval(timer); timer = null; }
  $('gate').hidden = false;
  $('gate-error').hidden = !withError;
  $('gate-key').focus();
}
function hideGate() { $('gate').hidden = true; }

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
    return `<div class="col" title="${escapeHtml(i.label)}: ${i.count}">
      <span class="col-n">${i.count || ''}</span>
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
      <div class="agent-head"><span class="agent-dot"></span><span class="agent-name">${escapeHtml(a.gitUser || 'unknown')}</span></div>
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
    `<span class="cf-party"><b>${escapeHtml(p.gitUser)}</b><span class="cf-branch">⎇ ${escapeHtml(p.branch)}</span><span class="cf-lines">${fmtRanges(p.ranges)}</span></span>`
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
  renderBars($('lead-people'), people.map((p) => barRow(p.name, p.count, maxP, 'var(--signal)', p.count)));

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
    return `<div class="feed-row">
      <span class="fe-type" style="background:${color}">${escapeHtml(f.type || '·')}</span>
      <div class="fe-main"><span class="fe-id">${escapeHtml(f.id)}</span><span class="fe-meta">${escapeHtml(f.repo || '')} · ${escapeHtml(f.gitUser || '')}</span></div>
      <div class="fe-state">${state}<span class="fe-when">${ago(f.finished)}</span></div>
    </div>`;
  }).join('');
}

// ── /dev run stats (client-side, so we can filter by teammate) ──────────────
const DAY = 86400000;
let currentUser = ''; // '' = whole team
let lastRuns = [];
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
function membersFrom(runs) {
  const c = {};
  for (const r of runs) { const u = r.gitUser || 'unknown'; c[u] = (c[u] || 0) + 1; }
  return Object.entries(c).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
function renderMemberFilter(members) {
  const chip = (name, label, count) =>
    `<button class="mchip${currentUser === name ? ' is-active' : ''}" data-user="${escapeHtml(name)}">${escapeHtml(label)}${count != null ? `<span class="mchip-n">${count}</span>` : ''}</button>`;
  const html = chip('', 'Whole team') + members.map((m) => chip(m.name, m.name, m.count)).join('');
  $('ins-filter').innerHTML = html;
  $('act-filter').innerHTML = html;
}
function applyFilter() {
  const runs = currentUser ? lastRuns.filter((r) => (r.gitUser || 'unknown') === currentUser) : lastRuns;
  renderInsights(statsFrom(runs, lastNow));
  renderActivity(feedFrom(runs));
}

function render(data) {
  lastData = data;
  lastRuns = Array.isArray(data.runs) ? data.runs : [];
  lastNow = data.now;
  renderTeam(data);
  renderConflicts(data);
  // drop a stale filter if that person no longer appears
  if (currentUser && !lastRuns.some((r) => (r.gitUser || 'unknown') === currentUser)) currentUser = '';
  renderMemberFilter(membersFrom(lastRuns));
  applyFilter();
  setStatus('ok', `${data.onlineCount} online`);
}

// ── Polling ─────────────────────────────────────────────────────────────────
async function poll() {
  const key = getKey();
  if (!key) return showGate(false);
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
  if (timer) clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
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
    runs.push({ id: `${100 + i}-${type}-run`, type, repo: pick(repos), gitUser: people[pw[Math.floor(rnd() * pw.length)]], phase: 'done', started: finished - dur, finished, done: true });
  }
  runs.push({ id: '0042-feat-stripe-retry', type: 'feat', repo: 'checkout-service', gitUser: 'alice', phase: 'phase-2-implementation', started: sec - 5000, finished: sec - 120, done: false });
  runs.push({ id: '0043-fix-charge-idempotency', type: 'fix', repo: 'checkout-service', gitUser: 'bob', phase: 'phase-2-implementation', started: sec - 8000, finished: sec - 300, done: false });
  runs.push({ id: '0044-refactor-checkout', type: 'refactor', repo: 'web', gitUser: 'carol', phase: 'phase-1-requirements', started: sec - 1000, finished: sec - 600, done: false });
  return runs;
}

function demoData() {
  const now = Date.now();
  return {
    now, ttlMs: 30000, onlineCount: 3, totalCount: 4,
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
  };
}
function isDemo() { return new URLSearchParams(location.search).has('demo'); }
function enterDemo() {
  if (timer) { clearInterval(timer); timer = null; }
  hideGate();
  $('demo-banner').hidden = false;
  $('header-demo').hidden = true;
  $('signout').hidden = true;
  setStatus('ok', 'demo');
  render(demoData());
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

['ins-filter', 'act-filter'].forEach((fid) => $(fid).addEventListener('click', (e) => {
  const btn = e.target.closest('.mchip');
  if (!btn) return;
  currentUser = btn.dataset.user || '';
  renderMemberFilter(membersFrom(lastRuns));
  applyFilter();
}));

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
  if (document.visibilityState === 'visible' && !isDemo() && getKey()) poll();
});

if (isDemo()) enterDemo();
else start();
