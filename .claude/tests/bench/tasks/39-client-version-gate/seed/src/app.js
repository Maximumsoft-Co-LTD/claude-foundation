"use strict";

const FEED = [
  { id: "p1", title: "Morning market", likes: 12 },
  { id: "p2", title: "River at dusk", likes: 30 }
];

function json(status, body) {
  return { status, headers: {}, body };
}

function createApp({ minClientVersion = "2.4.0" } = {}) {
  const routes = {
    "GET /health": () => json(200, { ok: true }),
    "GET /api/feed": () => json(200, { items: FEED }),
    "GET /api/profile": () => json(200, { id: "me", name: "Guest" })
  };
  function handle({ method, path }) {
    const route = routes[`${method} ${path.split("?")[0]}`];
    return route ? route() : json(404, { error: "not_found" });
  }
  return { handle, minClientVersion };
}

module.exports = { createApp };
