'use strict';

const FoundationAgentView = (function createAgentView() {
  const VISIBLE_REPOSITORIES = 6;

  function workingLine(dependencies, row) {
    const { escapeHtml } = dependencies;
    const name = escapeHtml((row.dir && row.dir.split('/').pop()) || row.repo || '·');
    const title = escapeHtml(`${row.repo || ''}${row.dir ? ` · ${row.dir}` : ''}`);
    const label = row.label
      ? `<span class="wk-tag">${escapeHtml(row.label)}</span>` : '';
    const branch = row.branch
      ? `<span class="wk-branch">⎇ ${escapeHtml(row.branch)}</span>` : '';
    const files = Number(row.files) || 0;
    return `<div class="wk" title="${title}">${label}<span class="wk-repo">${name}</span>${branch}<span class="wk-files">${files}f</span></div>`;
  }

  function activityLine(dependencies, item) {
    const { escapeHtml } = dependencies;
    const repo = escapeHtml(item.repo || '·');
    const branch = item.branch
      ? `<span class="act-branch">⎇ ${escapeHtml(item.branch)}</span>` : '';
    const phase = item.phase ? ` · ${escapeHtml(item.phase)}` : '';
    const run = item.runId
      ? `<span class="act-run">/dev ${escapeHtml(item.runId)}${phase}</span>` : '';
    return `<div class="act"><span class="act-repo">${repo}</span>${branch}${run}</div>`;
  }

  function agentWorkingHtml(dependencies, agent, repositories) {
    if (!repositories.length) return '';
    const expanded = dependencies.expandedAgents.has(agent.agentId);
    const shown = expanded
      ? repositories : repositories.slice(0, VISIBLE_REPOSITORIES);
    const more = repositories.length > VISIBLE_REPOSITORIES
      ? `<button class="wk-more" data-agent="${dependencies.escapeHtml(agent.agentId)}">${expanded ? 'show less' : `+ ${repositories.length - VISIBLE_REPOSITORIES} more`}</button>`
      : '';
    const suffix = repositories.length === 1 ? '' : 's';
    return `<div class="agent-working"><div class="wk-label">working in · ${repositories.length} repo${suffix}</div>${shown.map((row) => workingLine(dependencies, row)).join('')}${more}</div>`;
  }

  function agentActivityHtml(dependencies, repositories, activities) {
    if (activities.length)
      return `<div class="agent-activity">${activities.map((item) =>
        activityLine(dependencies, item)).join('')}</div>`;
    return repositories.length
      ? '' : '<div class="agent-activity agent-activity--idle">no tracked work</div>';
  }

  function agentMeta(dependencies, agent) {
    const { escapeHtml } = dependencies;
    const id = escapeHtml((agent.agentId || '').slice(0, 8));
    return [
      agent.host && escapeHtml(agent.host),
      agent.version && `v${escapeHtml(agent.version)}`,
      id
    ].filter(Boolean).join(' · ');
  }

  function agentCard(dependencies, agent) {
    const { escapeHtml, relTime, userDot } = dependencies;
    const repositories = Array.isArray(agent.repos) ? agent.repos : [];
    const activities = Array.isArray(agent.activity) ? agent.activity : [];
    const stateClass = agent.online ? 'agent agent--online' : 'agent agent--stale';
    const working = agentWorkingHtml(dependencies, agent, repositories);
    const activity = agentActivityHtml(dependencies, repositories, activities);
    return `
    <article class="${stateClass}">
      <div class="agent-head"><span class="agent-dot"></span><span class="agent-name">${userDot(agent.gitUser)}${escapeHtml(agent.gitUser || 'unknown')}</span></div>
      <div class="agent-meta">${agentMeta(dependencies, agent)}</div>
      ${working}${activity}
      <div class="agent-seen">${agent.online ? 'online' : 'seen'} · ${relTime(agent.ageMs)}</div>
    </article>`;
  }

  return {
    activityLine,
    agentActivityHtml,
    agentCard,
    agentMeta,
    agentWorkingHtml,
    workingLine
  };
}());

if (typeof module === 'object' && module.exports)
  module.exports = FoundationAgentView;
