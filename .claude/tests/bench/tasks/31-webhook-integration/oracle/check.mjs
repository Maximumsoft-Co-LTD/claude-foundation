// Hidden behavioral oracle for 31-webhook-integration. Usage: node check.mjs <work-copy> <seed>
// Every case reads /events back: a delivery counts as processed only when it is
// recorded, so a receiver that answers 401 but still records the event fails.
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
let createServer = null;
try { ({ createServer } = createRequire(join(work, "package.json"))(join(work, "src/server.js"))); }
catch { createServer = null; }

const SECRET = "whsec_live_oracle_A";
const OLD_SECRET = "whsec_live_oracle_B";
const NOW_S = 1798761600; // 2027-01-01T00:00:00Z
const sign = (t, raw, secret = SECRET) =>
  createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
const header = (t, raw, secret) => `t=${t},v1=${sign(t, raw, secret)}`;
const event = (id, extra = {}) => JSON.stringify({ id, type: "payment.succeeded", data: { amount: 1250, ...extra } });

async function withServer(options, fn) {
  let now = NOW_S * 1000;
  const server = createServer({ secrets: [SECRET], clock: () => now, ...options });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const deliver = async (raw, signature) => {
    const headers = { "content-type": "application/json" };
    if (signature !== undefined) headers["payrail-signature"] = signature;
    const res = await fetch(`${base}/webhooks/payrail`, { method: "POST", headers, body: raw });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
  const ids = async () => ((await (await fetch(`${base}/events`)).json()).events || []).map((e) => e.id);
  const advance = (seconds) => { now += seconds * 1000; };
  try { return await fn({ deliver, ids, advance, base }); }
  finally { server.closeAllConnections?.(); await new Promise((done) => server.close(done)); }
}

const processed = (res) => res.status === 200 && res.body?.status === "processed";
const invalid = (res) => res.status === 401 && res.body?.error === "invalid_signature";
const stale = (res) => res.status === 401 && res.body?.error === "timestamp_out_of_tolerance";
async function runCase(id, fn) {
  try { results[id] = (await fn()) === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

const CASES = ["CASE_VALID_PROCESSED", "CASE_BAD_SIGNATURE", "CASE_MISSING_SIGNATURE",
  "CASE_TAMPERED_BODY", "CASE_RAW_BODY_SIGNED", "CASE_STALE_TIMESTAMP", "CASE_FUTURE_TIMESTAMP",
  "CASE_REPLAY_WINDOW_EDGE", "CASE_DUPLICATE_EVENT", "CASE_ROTATED_SECRETS", "CASE_EXISTING_ROUTES"];
if (typeof createServer !== "function") {
  for (const id of CASES) results[id] = "fail";
} else {
  await runCase("CASE_VALID_PROCESSED", () => withServer({}, async ({ deliver, ids }) => {
    const a = event("evt_1"); const b = event("evt_2");
    return processed(await deliver(a, header(NOW_S, a))) && processed(await deliver(b, header(NOW_S - 10, b))) &&
      isDeepStrictEqual(await ids(), ["evt_1", "evt_2"]);
  }));
  await runCase("CASE_BAD_SIGNATURE", () => withServer({}, async ({ deliver, ids }) => {
    const raw = event("evt_bad");
    const wrongSecret = await deliver(raw, header(NOW_S, raw, "whsec_attacker"));
    const garbage = await deliver(raw, `t=${NOW_S},v1=${"0".repeat(64)}`);
    const short = await deliver(raw, `t=${NOW_S},v1=abc`);
    const malformed = await deliver(raw, "nonsense");
    const v0Only = await deliver(raw, `t=${NOW_S},v0=${sign(NOW_S, raw)}`);
    return [wrongSecret, garbage, short, malformed, v0Only].every(invalid) &&
      isDeepStrictEqual(await ids(), []);
  }));
  await runCase("CASE_MISSING_SIGNATURE", () => withServer({}, async ({ deliver, ids }) => {
    const raw = event("evt_none");
    return invalid(await deliver(raw)) && invalid(await deliver(raw, "")) &&
      isDeepStrictEqual(await ids(), []);
  }));
  await runCase("CASE_TAMPERED_BODY", () => withServer({}, async ({ deliver, ids }) => {
    const raw = event("evt_t");
    const tampered = event("evt_t", { amount: 999999 });
    const shifted = await deliver(raw, `t=${NOW_S + 1},v1=${sign(NOW_S, raw)}`);
    return invalid(await deliver(tampered, header(NOW_S, raw))) && invalid(shifted) &&
      isDeepStrictEqual(await ids(), []);
  }));
  await runCase("CASE_RAW_BODY_SIGNED", () => withServer({}, async ({ deliver, ids }) => {
    const raw = '{ "id":"evt_raw",  "type":"payment.succeeded",\n "data":{"amount":5,"note":"café ☃"} }';
    const reserialized = JSON.stringify(JSON.parse(raw));
    return invalid(await deliver(raw, header(NOW_S, reserialized))) &&
      processed(await deliver(raw, header(NOW_S, raw))) && isDeepStrictEqual(await ids(), ["evt_raw"]);
  }));
  await runCase("CASE_STALE_TIMESTAMP", () => withServer({}, async ({ deliver, ids }) => {
    const raw = event("evt_old");
    return stale(await deliver(raw, header(NOW_S - 301, raw))) &&
      stale(await deliver(raw, header(NOW_S - 86400, raw))) && isDeepStrictEqual(await ids(), []);
  }));
  await runCase("CASE_FUTURE_TIMESTAMP", () => withServer({}, async ({ deliver, ids }) => {
    const raw = event("evt_future");
    return stale(await deliver(raw, header(NOW_S + 301, raw))) && isDeepStrictEqual(await ids(), []);
  }));
  await runCase("CASE_REPLAY_WINDOW_EDGE", () => withServer({}, async ({ deliver, ids, advance }) => {
    const a = event("evt_edge_a"); const b = event("evt_edge_b"); const c = event("evt_edge_c");
    const early = await deliver(a, header(NOW_S - 300, a));
    const late = await deliver(b, header(NOW_S + 300, b));
    const signedNow = header(NOW_S, c);
    advance(301); // the clock moves on: the same signed delivery is now a replay
    return processed(early) && processed(late) && stale(await deliver(c, signedNow)) &&
      isDeepStrictEqual(await ids(), ["evt_edge_a", "evt_edge_b"]);
  }));
  await runCase("CASE_DUPLICATE_EVENT", () => withServer({}, async ({ deliver, ids, advance }) => {
    const raw = event("evt_dup");
    const first = await deliver(raw, header(NOW_S, raw));
    advance(60);
    const retry = await deliver(raw, header(NOW_S + 60, raw));
    const sameRequest = await deliver(raw, header(NOW_S + 60, raw));
    const forged = await deliver(raw, header(NOW_S + 60, raw, "whsec_attacker"));
    const burst = await Promise.all(Array.from({ length: 5 }, () => deliver(event("evt_burst"),
      header(NOW_S + 60, event("evt_burst")))));
    const dup = (res) => res.status === 200 && res.body?.status === "duplicate";
    return processed(first) && dup(retry) && dup(sameRequest) && invalid(forged) &&
      burst.filter(processed).length === 1 && burst.filter(dup).length === 4 &&
      isDeepStrictEqual(await ids(), ["evt_dup", "evt_burst"]);
  }));
  await runCase("CASE_ROTATED_SECRETS", () => withServer({ secrets: [SECRET, OLD_SECRET] },
    async ({ deliver, ids }) => {
      const a = event("evt_old_secret"); const b = event("evt_both"); const c = event("evt_unknown");
      const both = `t=${NOW_S},v1=${sign(NOW_S, b, "whsec_retired")},v1=${sign(NOW_S, b, OLD_SECRET)}`;
      return processed(await deliver(a, header(NOW_S, a, OLD_SECRET))) && processed(await deliver(b, both)) &&
        invalid(await deliver(c, header(NOW_S, c, "whsec_retired"))) &&
        isDeepStrictEqual(await ids(), ["evt_old_secret", "evt_both"]);
    }));
  await runCase("CASE_EXISTING_ROUTES", () => withServer({}, async ({ deliver, ids, base }) => {
    const bad = "{nope";
    const malformed = await deliver(bad, header(NOW_S, bad));
    return malformed.status === 400 && malformed.body?.error === "invalid_json" &&
      isDeepStrictEqual(await (await fetch(`${base}/health`)).json(), { ok: true }) &&
      (await fetch(`${base}/elsewhere`)).status === 404 && isDeepStrictEqual(await ids(), []);
  }));
}

function suite(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    "--test", "--test-force-exit", "--test-timeout=20000", "--test-reporter=tap", ...args
  ], { cwd: work, encoding: "utf8", timeout: 40000, env, maxBuffer: 10 * 1024 * 1024 });
  const pass = Number((String(run.stdout).match(/^# pass (\d+)/m) || [])[1] || 0);
  return { ok: run.status === 0, pass };
}
const seedTests = readdirSync(join(seed, "test")).filter((name) => name.endsWith(".test.js"));
try {
  cpSync(join(seed, "test"), join(work, "oracle-seed-tests"), { recursive: true });
  const replay = suite(seedTests.map((name) => `oracle-seed-tests/${name}`));
  rmSync(join(work, "oracle-seed-tests"), { recursive: true, force: true });
  results.CASE_SEED_TESTS_REPLAY = replay.ok && replay.pass >= 2 ? "pass" : "fail";
} catch { results.CASE_SEED_TESTS_REPLAY = "fail"; }
try {
  const delivered = suite([]);
  results.CASE_TESTS_PASS = delivered.ok && delivered.pass > 2 ? "pass" : "fail";
} catch { results.CASE_TESTS_PASS = "fail"; }

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
process.exit(0);
