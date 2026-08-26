'use strict';

const FoundationUsageView = (function createUsageView() {
  const DAY = 86400000;

  function usageTokens(row) {
    return (row.input || 0) + (row.output || 0);
  }

  function totalsBy(rows, key, value) {
    const totals = {};
    for (const row of rows) {
      const name = key(row);
      totals[name] = (totals[name] || 0) + value(row);
    }
    return totals;
  }

  function rankedEntries(totals, limit = Infinity) {
    return Object.entries(totals)
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit);
  }

  function dailySeries(range, valueByDate) {
    const from = Date.parse(range.fromStr);
    const to = Date.parse(range.toStr);
    const span = Math.round((to - from) / DAY) + 1;
    const step = span > 35 ? 7 : 1;
    const columns = [];
    for (let time = from; time <= to; time += step * DAY) {
      let count = 0;
      for (let offset = 0; offset < step; offset += 1)
        count += valueByDate[new Date(time + offset * DAY).toISOString().slice(0, 10)] || 0;
      const date = new Date(time);
      columns.push({
        label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
        count
      });
    }
    return columns;
  }

  function aggregateModels(rows) {
    const models = {};
    for (const row of rows) {
      const model = models[row.model] || (models[row.model] = {
        input: 0, output: 0, cacheCreate: 0, cacheRead: 0, count: 0, last: ''
      });
      model.input += row.input || 0;
      model.output += row.output || 0;
      model.cacheCreate += row.cacheCreate || 0;
      model.cacheRead += row.cacheRead || 0;
      model.count += row.count || 0;
      if (row.date > model.last) model.last = row.date;
    }
    return Object.entries(models).sort((left, right) =>
      (right[1].input + right[1].output) - (left[1].input + left[1].output));
  }

  function buildUsageView(rows, sessions, tools, range, estimateCost) {
    const usage = Array.isArray(rows) ? rows : [];
    const sessionRows = Array.isArray(sessions) ? sessions : [];
    const toolRows = Array.isArray(tools) ? tools : [];
    const projects = rankedEntries(totalsBy(
      usage, (row) => row.project || 'unknown', usageTokens), 8);
    const toolTotals = rankedEntries(totalsBy(
      toolRows, (row) => row.tool, (row) => row.count || 0), 10);
    const modelTotals = rankedEntries(totalsBy(
      usage, (row) => row.model, usageTokens));
    const people = rankedEntries(totalsBy(
      usage, (row) => row.gitUser || 'unknown', usageTokens), 8);
    return {
      empty: usage.length === 0,
      totalTokens: usage.reduce((sum, row) => sum + usageTokens(row), 0),
      outputTokens: usage.reduce((sum, row) => sum + (row.output || 0), 0),
      cost: usage.reduce((sum, row) => sum + estimateCost(row), 0),
      modelCount: new Set(usage.map((row) => row.model)).size,
      projects,
      tools: toolTotals,
      sessions: dailySeries(range, totalsBy(
        sessionRows, (row) => row.date, (row) => row.count || 0)),
      models: modelTotals,
      people,
      daily: dailySeries(range, totalsBy(usage, (row) => row.date, usageTokens)),
      modelList: aggregateModels(usage)
    };
  }

  function chartRows(entries, color, format, barRow) {
    const maximum = Math.max(1, ...entries.map(([, count]) => count));
    return entries.map(([label, count]) =>
      barRow(label, count, maximum, color(label), format(count)));
  }

  function modelListHtml(list, dependencies) {
    const { escapeHtml, estCost, fmtTok, fmtUsd, modelColor, shortModel } = dependencies;
    if (!list.length) return '<p class="empty empty--sm">no data yet</p>';
    return `
    <div class="ml-row ml-row--head">
      <span>model</span><span>msgs</span><span>input</span><span>output</span><span>cache write</span><span>cache read</span><span>est. cost</span><span>last used</span>
    </div>` + list.map(([model, value]) => `
    <div class="ml-row">
      <span class="ml-model"><span class="ml-dot" style="background:${modelColor(model)}"></span>${escapeHtml(shortModel(model))}</span>
      <span>${fmtTok(value.count)}</span><span>${fmtTok(value.input)}</span><span>${fmtTok(value.output)}</span>
      <span>${fmtTok(value.cacheCreate)}</span><span>${fmtTok(value.cacheRead)}</span>
      <span>${fmtUsd(estCost({ model, ...value }))}</span><span>${escapeHtml(value.last)}</span>
    </div>`).join('');
  }

  function renderUsage(dependencies, rows, sessions, tools, now, range) {
    const {
      $, barRow, estCost, fmtTok, fmtUsd, modelColor, rangeInfo,
      renderBars, renderCols, shortModel, userColor
    } = dependencies;
    const selectedRange = range || rangeInfo(now);
    const view = buildUsageView(rows, sessions, tools, selectedRange, estCost);
    $('usage-empty').hidden = !view.empty;
    $('us-total').textContent = fmtTok(view.totalTokens);
    $('us-week').textContent = fmtTok(view.outputTokens);
    $('us-cost').textContent = fmtUsd(view.cost);
    $('us-models').textContent = view.modelCount;
    renderBars($('us-byproject'), chartRows(
      view.projects, () => 'var(--marker)', fmtTok, barRow));
    renderBars($('us-tools'), chartRows(
      view.tools, () => '#5c6470', fmtTok, barRow));
    renderCols($('us-sessions'), view.sessions.map((column) => ({
      ...column, text: column.count ? String(column.count) : ''
    })));
    renderBars($('us-bymodel'), chartRows(
      view.models.map(([model, count]) => [shortModel(model), count]),
      (model) => modelColor(model), fmtTok, barRow));
    renderBars($('us-bypeople'), chartRows(
      view.people, (person) => userColor(person), fmtTok, barRow));
    renderCols($('us-daily'), view.daily.map((column) => ({
      ...column, text: column.count ? fmtTok(column.count) : ''
    })));
    $('us-modellist').innerHTML = modelListHtml(view.modelList, dependencies);
    return view;
  }

  return {
    aggregateModels,
    buildUsageView,
    dailySeries,
    modelListHtml,
    rankedEntries,
    renderUsage,
    totalsBy,
    usageTokens
  };
}());

if (typeof module === 'object' && module.exports)
  module.exports = FoundationUsageView;
