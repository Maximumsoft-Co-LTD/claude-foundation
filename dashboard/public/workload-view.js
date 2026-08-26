'use strict';

const FoundationWorkloadView = (function createWorkloadView() {
  const SIZE_POINTS = { XS: 1, S: 2, M: 5, L: 8 };
  function runPoints(run) {
    return SIZE_POINTS[String(run.size || '').toUpperCase()] || SIZE_POINTS.S;
  }
  function deltaCell(current, previous) {
    if (!previous && !current) return '<span class="wl-flat">—</span>';
    if (!previous) return '<span class="wl-up">new</span>';
    const percent = Math.round(((current - previous) / previous) * 100);
    if (percent > 0) return `<span class="wl-up">▲ ${percent}%</span>`;
    if (percent < 0) return `<span class="wl-down">▼ ${Math.abs(percent)}%</span>`;
    return '<span class="wl-flat">=</span>';
  }
  function workloadWindow(now, dependencies) {
    const range = dependencies.rangeInfo(now);
    const span = range.toMsEx - range.fromMs;
    return {
      range, span, previousFromMs: range.fromMs - span,
      previousFromStr: dependencies.localDateStr(range.fromMs - span),
      previousToStr: dependencies.localDateStr(range.fromMs - 1)
    };
  }
  function workloadRow(aggregate, user) {
    if (!aggregate.has(user)) aggregate.set(user, {
      points: 0, prevPoints: 0, runs: 0, prevRuns: 0,
      commits: 0, prevCommits: 0, lines: 0, prevLines: 0
    });
    return aggregate.get(user);
  }
  function aggregateRuns(aggregate, runs, selectedUsers, window) {
    const selected = (user) => !selectedUsers.size || selectedUsers.has(user);
    for (const run of runs) {
      if (!run.done || !run.finished) continue;
      const user = run.gitUser || 'unknown';
      if (!selected(user)) continue;
      const finished = run.finished * 1000;
      if (finished >= window.range.fromMs && finished < window.range.toMsEx) {
        workloadRow(aggregate, user).points += runPoints(run);
        workloadRow(aggregate, user).runs += 1;
      } else if (finished >= window.previousFromMs && finished < window.range.fromMs) {
        workloadRow(aggregate, user).prevPoints += runPoints(run);
        workloadRow(aggregate, user).prevRuns += 1;
      }
    }
  }
  function deduplicateWork(work, history, selectedUsers) {
    const selected = (user) => !selectedUsers.size || selectedUsers.has(user);
    const byKey = new Map();
    const historical = history && Array.isArray(history.work) ? history.work : [];
    for (const item of [...work, ...historical]) {
      const user = item.gitUser || 'unknown';
      if (!selected(user) || !item.date) continue;
      const key = `${user}|${item.date}`;
      const merged = byKey.get(key) || {
        user, date: item.date, commits: 0, added: 0, deleted: 0
      };
      merged.commits = Math.max(merged.commits, item.commits || 0);
      merged.added = Math.max(merged.added, item.added || 0);
      merged.deleted = Math.max(merged.deleted, item.deleted || 0);
      byKey.set(key, merged);
    }
    return byKey.values();
  }
  function aggregateWork(aggregate, rows, window) {
    for (const item of rows) {
      if (item.date >= window.range.fromStr && item.date <= window.range.toStr) {
        workloadRow(aggregate, item.user).commits += item.commits;
        workloadRow(aggregate, item.user).lines += item.added + item.deleted;
      } else if (item.date >= window.previousFromStr && item.date <= window.previousToStr) {
        workloadRow(aggregate, item.user).prevCommits += item.commits;
        workloadRow(aggregate, item.user).prevLines += item.added + item.deleted;
      }
    }
  }
  function buildWorkloadView(dependencies, now, selectedUsers, runs, work, history) {
    const window = workloadWindow(now, dependencies);
    const aggregate = new Map();
    aggregateRuns(aggregate, runs, selectedUsers, window);
    aggregateWork(aggregate, deduplicateWork(work, history, selectedUsers), window);
    const list = [...aggregate.entries()]
      .filter(([, value]) => value.points || value.prevPoints || value.commits || value.prevCommits)
      .sort((left, right) => right[1].points - left[1].points || right[1].commits - left[1].commits);
    return { range: window.range, days: Math.round(window.span / dependencies.day), list };
  }
  function workloadHtml(list, dependencies) {
    const { escapeHtml, fmtTok, userDot } = dependencies;
    if (!list.length) return '<p class="empty empty--sm">no completed runs or commits in this window yet</p>';
    return `
    <div class="ml-row ml-row--wl ml-row--head">
      <span>person</span><span title="completed /dev runs weighted XS=1 S=2 M=5 L=8 (unknown → S)">points</span><span>Δ</span><span>runs</span><span>commits</span><span>Δ</span><span>lines ±</span><span>Δ</span>
    </div>` + list.map(([user, value]) => `
    <div class="ml-row ml-row--wl">
      <span class="ml-model">${userDot(user)}${escapeHtml(user)}</span>
      <span><b>${value.points}</b></span><span>${deltaCell(value.points, value.prevPoints)}</span>
      <span>${value.runs}</span>
      <span>${fmtTok(value.commits)}</span><span>${deltaCell(value.commits, value.prevCommits)}</span>
      <span>${fmtTok(value.lines)}</span><span>${deltaCell(value.lines, value.prevLines)}</span>
    </div>`).join('');
  }
  function renderWorkload(dependencies, now,
    selectedUsers = globalThis.selectedUsers,
    runs = globalThis.lastRuns,
    work = globalThis.lastWork,
    history = globalThis.lastHistory) {
    const element = dependencies.$('ins-workload');
    if (!element) return;
    const view = buildWorkloadView(dependencies, now, selectedUsers, runs, work, history);
    const subtitle = dependencies.$('wl-sub');
    if (subtitle) subtitle.textContent = `${view.range.fromStr} → ${view.range.toStr} vs previous ${view.days}d`;
    element.innerHTML = workloadHtml(view.list, dependencies);
    return view;
  }
  return { aggregateRuns, aggregateWork, buildWorkloadView, deduplicateWork,
    deltaCell, renderWorkload, runPoints, workloadHtml, workloadRow, workloadWindow };
}());

if (typeof module === 'object' && module.exports)
  module.exports = FoundationWorkloadView;
