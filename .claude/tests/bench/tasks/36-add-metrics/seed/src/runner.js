"use strict";

function createRunner({ handlers, metrics, logger }) {
  async function run(job, context = {}) {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`unknown job type: ${job.type}`);
    try {
      const output = await handler(job.payload);
      metrics.increment("jobs_succeeded_total", { type: job.type });
      logger.log({ level: "info", event: "job_succeeded", jobId: job.id, type: job.type });
      return { ok: true, output };
    } catch {
      return { ok: false };
    }
  }
  return { run };
}

module.exports = { createRunner };
