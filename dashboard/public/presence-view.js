'use strict';

const FoundationPresenceView = (function createPresenceView() {
  const DAY = 86400000;
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];

  function presenceBuckets(presence) {
    return Array.isArray(presence?.buckets) ? presence.buckets : [];
  }

  function selectedBuckets(buckets, range) {
    return buckets.filter((bucket) => {
      const time = bucket.hour * 3600000;
      return time >= range.fromMs && time < range.toMsEx;
    });
  }

  function localDayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function emptyPresenceTotals() {
    return {
      heat: Array.from({ length: 7 }, () => new Array(24).fill(0)),
      byUser: {},
      byDay: {},
      byHour: new Array(24).fill(0),
      todayMinutes: 0,
      totalMinutes: 0
    };
  }

  function addPresenceBucket(totals, bucket, today) {
    const date = new Date(bucket.hour * 3600000);
    const hour = date.getHours();
    const minutes = bucket.minutes;
    const user = bucket.user || 'unknown';
    const day = localDayKey(date);
    totals.heat[date.getDay()][hour] += minutes;
    totals.byHour[hour] += minutes;
    totals.byUser[user] = (totals.byUser[user] || 0) + minutes;
    totals.byDay[day] = (totals.byDay[day] || 0) + minutes;
    totals.totalMinutes += minutes;
    if (day === today) totals.todayMinutes += minutes;
  }

  function presenceTotals(buckets, now) {
    const totals = emptyPresenceTotals();
    const today = new Date(now).toISOString().slice(0, 10);
    for (const bucket of buckets) addPresenceBucket(totals, bucket, today);
    return totals;
  }

  function peakHour(byHour) {
    const peak = byHour.indexOf(Math.max(...byHour));
    return byHour[peak] ? `${String(peak).padStart(2, '0')}:00` : '—';
  }

  function heatmapHtml(heat) {
    const maximum = Math.max(1, ...heat.flat());
    let html = '<div class="hm-grid"><span class="hm-corner"></span>';
    for (let hour = 0; hour < 24; hour += 1)
      html += `<span class="hm-collab">${hour % 3 === 0 ? hour : ''}</span>`;
    for (const day of DISPLAY_DAYS) {
      html += `<span class="hm-rowlab">${DAY_NAMES[day]}</span>`;
      for (let hour = 0; hour < 24; hour += 1) {
        const minutes = heat[day][hour];
        const opacity = minutes
          ? (0.15 + 0.85 * (minutes / maximum)).toFixed(2) : 0.04;
        html += `<span class="hm-cell" style="opacity:${opacity}" title="${DAY_NAMES[day]} ${hour}:00 · ${Math.round(minutes)} min"></span>`;
      }
    }
    return `${html}</div>`;
  }

  function dailyPresenceColumns(range, byDay, formatHours) {
    const span = Math.min(31,
      Math.max(1, Math.round((range.toMsEx - range.fromMs) / DAY)));
    const columns = [];
    for (let offset = span - 1; offset >= 0; offset -= 1) {
      const date = new Date(range.toMsEx - DAY / 2 - offset * DAY);
      const minutes = byDay[localDayKey(date)] || 0;
      columns.push({
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        count: Math.round(minutes),
        text: minutes ? formatHours(minutes) : ''
      });
    }
    return columns;
  }

  function buildPresenceView(presence, range, now, formatHours) {
    const all = presenceBuckets(presence);
    const selected = selectedBuckets(all, range);
    const totals = presenceTotals(selected, now);
    const people = Object.entries(totals.byUser)
      .sort((left, right) => right[1] - left[1]).slice(0, 8);
    return {
      empty: all.length === 0,
      peopleCount: Object.keys(totals.byUser).length,
      hours: formatHours(totals.totalMinutes),
      peak: peakHour(totals.byHour),
      today: formatHours(totals.todayMinutes),
      heatmap: heatmapHtml(totals.heat),
      people,
      peopleMaximum: Math.max(1, ...people.map(([, minutes]) => minutes)),
      daily: dailyPresenceColumns(range, totals.byDay, formatHours)
    };
  }

  function renderPresence(dependencies, presence, now = Date.now()) {
    const {
      $, barRow, fmtHours, rangeInfo, renderBars, renderCols, userColor
    } = dependencies;
    const view = buildPresenceView(presence, rangeInfo(now), now, fmtHours);
    $('presence-empty').hidden = !view.empty;
    $('pr-people').textContent = view.peopleCount;
    $('pr-hours').textContent = view.hours;
    $('pr-peak').textContent = view.peak;
    $('pr-today').textContent = view.today;
    $('pr-heatmap').innerHTML = view.heatmap;
    renderBars($('pr-people-bars'), view.people.map(([user, minutes]) =>
      barRow(user, minutes, view.peopleMaximum, userColor(user), fmtHours(minutes))));
    renderCols($('pr-daily'), view.daily);
    return view;
  }

  return {
    addPresenceBucket,
    buildPresenceView,
    dailyPresenceColumns,
    heatmapHtml,
    localDayKey,
    peakHour,
    presenceBuckets,
    presenceTotals,
    renderPresence,
    selectedBuckets
  };
}());

if (typeof module === 'object' && module.exports)
  module.exports = FoundationPresenceView;
