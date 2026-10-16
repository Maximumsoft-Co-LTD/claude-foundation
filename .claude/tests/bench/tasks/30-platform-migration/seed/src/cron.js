"use strict";

const { JOBS } = require("./jobs");

const SCHEDULE = [
  { job: "expire-sessions", due: (d) => d.getUTCMinutes() % 15 === 0 },
  { job: "daily-digest", due: (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 },
  { job: "purge-audit", due: (d) => d.getUTCHours() === 3 && d.getUTCMinutes() === 30 }
];

function runCron(store, at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) throw new RangeError(`invalid time: ${at}`);
  const entries = [];
  for (const { job, due } of SCHEDULE) {
    if (!due(date)) continue;
    try {
      entries.push({ job, at, result: JOBS[job](store, { at }) });
    } catch (error) {
      entries.push({ job, at, error: error.message });
    }
  }
  return entries;
}

module.exports = { runCron, SCHEDULE };
