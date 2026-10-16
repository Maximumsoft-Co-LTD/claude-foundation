"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;

function expireSessions(store, { at }) {
  const now = Date.parse(at);
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  return { expired: before - store.sessions.length };
}

function dailyDigest(store, { at }) {
  const recipients = store.users.filter((user) => user.digest === true).map((user) => user.email);
  for (const email of recipients) store.outbox.push({ to: email, kind: "digest", at });
  return { sent: recipients.length, recipients };
}

function purgeAudit(store, { at }) {
  const cutoff = Date.parse(at) - 30 * DAY_MS;
  const before = store.audit.length;
  store.audit = store.audit.filter((entry) => Date.parse(entry.at) >= cutoff);
  return { purged: before - store.audit.length };
}

const JOBS = {
  "expire-sessions": expireSessions,
  "daily-digest": dailyDigest,
  "purge-audit": purgeAudit
};

module.exports = { JOBS };
