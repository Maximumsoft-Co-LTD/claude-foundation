// Hidden oracle for 27-speed-up-search. Usage: node check.mjs <work-copy> <seed>
// The seed implementation is the reference: results must be identical on hidden
// data, and the delivered catalog must be at least 3x faster than the seed on a
// hidden larger workload, measured interleaved in this process (median of 5).
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const load = (root) => {
  try { return createRequire(join(root, "package.json"))(join(root, "src/search.js")); }
  catch { return {}; }
};
const reference = load(seed).createCatalog;
const delivered = load(work).createCatalog;

// Deterministic hidden data, unrelated to the seed's sample generator.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const VOCAB = ["Lamp", "lampshade", "LAMPS", "Café", "cafe", "crème", "Creme", "naïve", "ﬁle",
  "Straße", "strasse", "İstanbul", "istanbul", "Ångström", "angstrom", "日本", "日本語", "Ünïcödé",
  "USB-C", "usb", "4K", "4k", "x100", "100", "o'neil", "tea", "teapot", "team", "a", "ab", "abc",
  "blue", "BLUE", "red", "redwood", "pro", "PRO-Max", "mini", "über", "uber", "e", "é", "ø", "Ø"];
const TAGS = ["home", "Office", "kitchen", "audio", "travel", "Ünïcödé", "sale", "gift", "pro"];
function hiddenRecords(count, seedValue, idSpace) {
  const next = prng(seedValue);
  const pick = (list) => list[Math.floor(next() * list.length)];
  return Array.from({ length: count }, (_, index) => {
    const size = 1 + Math.floor(next() * 4);
    const title = Array.from({ length: size }, () => pick(VOCAB)).join(next() < 0.3 ? "-" : " ") +
      (next() < 0.5 ? ` ${index}` : "");
    const roll = next();
    const tags = roll < 0.2 ? undefined : roll < 0.3 ? [] : [pick(TAGS), pick(TAGS)];
    return { id: `h${Math.floor(next() * idSpace)}`, title, ...(tags ? { tags } : {}) };
  });
}
function hiddenQueries(count, seedValue) {
  const next = prng(seedValue);
  const words = [...VOCAB, ...TAGS];
  return Array.from({ length: count }, () => {
    const size = 1 + Math.floor(next() * 3);
    return Array.from({ length: size }, () => {
      const word = words[Math.floor(next() * words.length)];
      return next() < 0.35 ? word.slice(0, 1 + Math.floor(next() * word.length)) : word;
    }).join(next() < 0.2 ? ", " : " ");
  });
}

function same(records, queries, optionsList = [undefined]) {
  const want = reference(records);
  const got = delivered(records);
  for (const query of queries)
    for (const options of optionsList) {
      const expected = options === undefined ? want.search(query) : want.search(query, options);
      const actual = options === undefined ? got.search(query) : got.search(query, options);
      if (!isDeepStrictEqual(actual, expected)) return false;
    }
  return true;
}

function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

const CASES = ["CASE_EXPORT_PRESERVED", "CASE_RESULTS_IDENTICAL", "CASE_EMPTY_QUERY",
  "CASE_CASE_AND_ACCENTS", "CASE_UNICODE_WORDS", "CASE_TIE_ORDER", "CASE_DUPLICATE_IDS",
  "CASE_LIMIT", "CASE_SPEEDUP_3X"];
if (typeof reference !== "function" || typeof delivered !== "function") {
  for (const id of CASES) results[id] = "fail";
} else {
  const records = hiddenRecords(1500, 41, 1300);
  runCase("CASE_EXPORT_PRESERVED", () => typeof delivered([]).search === "function" &&
    isDeepStrictEqual(delivered([]).search("lamp"), []));
  runCase("CASE_RESULTS_IDENTICAL", () =>
    same(records, hiddenQueries(400, 7), [undefined, { limit: 50 }]) &&
    same(hiddenRecords(300, 99, 120), hiddenQueries(150, 13), [{ limit: 500 }]));
  runCase("CASE_EMPTY_QUERY", () => same(records,
    ["", "   ", "!!!", "-", " , ", "\t\n", "́", "'"], [undefined, { limit: 5 }]));
  runCase("CASE_CASE_AND_ACCENTS", () => same(records,
    ["LAMP", "lamp", "LaMp", "cafe", "CAFÉ", "café", "creme cafe", "NAIVE", "angstrom",
      "ÅNGSTRÖM", "uber", "ÜBER", "e", "é", "É"], [{ limit: 100 }]));
  runCase("CASE_UNICODE_WORDS", () => same(records,
    ["file", "ﬁ", "straße", "strasse", "istanbul", "İSTANBUL", "日本", "日", "ø", "Ø",
      "unicode", "Ünïcödé", "o neil", "o'neil", "usb c", "usb-c", "4k", "x1"], [{ limit: 100 }]));
  runCase("CASE_TIE_ORDER", () => {
    const tied = [
      { id: "t3", title: "tea set" }, { id: "t1", title: "Tea cup" }, { id: "t2", title: "TEA" },
      { id: "t4", title: "teapot", tags: ["tea"] }, { id: "t5", title: "team mug" },
      { id: "t0", title: "green tea", tags: ["Tea"] }
    ];
    return same(tied, ["tea", "te", "tea tea", "t", "tea cup", "cup tea"], [undefined, { limit: 3 }]) &&
      same(records, ["blue", "pro", "a", "red"], [{ limit: 1000 }]);
  });
  runCase("CASE_DUPLICATE_IDS", () => {
    const dupes = [
      { id: "d1", title: "plain chair" }, { id: "d2", title: "lamp one" },
      { id: "d1", title: "lamp two" }, { id: "d2", title: "lamp three" },
      { id: "d3", title: "lampshade" }, { id: "d3", title: "lamp four" }
    ];
    return same(dupes, ["lamp", "chair", "lamp two", "lam", "four"]) &&
      same(hiddenRecords(800, 5, 40), hiddenQueries(80, 21), [{ limit: 1000 }]);
  });
  runCase("CASE_LIMIT", () => same(records, ["a", "lamp", "blue", "pro", "e"],
    [undefined, {}, { limit: 0 }, { limit: 1 }, { limit: 7 }, { limit: 20 }, { limit: 5000 }]));
  runCase("CASE_SPEEDUP_3X", () => {
    const big = hiddenRecords(9000, 1234, 8000);
    const queries = ["a", "e", "blue", "lamp", "pro", "caf", "tea", "ab", "u", "red",
      "s", "t", "home", "x", "i", "o", "100", "mini", "gift", "l"];
    const timeOne = (create) => {
      const started = process.hrtime.bigint();
      const catalog = create(big);
      for (const query of queries) catalog.search(query, { limit: 50 });
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    timeOne(reference); timeOne(delivered);
    const seedTimes = []; const deliveredTimes = [];
    for (let round = 0; round < 5; round++) {
      seedTimes.push(timeOne(reference));
      deliveredTimes.push(timeOne(delivered));
    }
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    results.SPEEDUP_RATIO = Number((median(seedTimes) / Math.max(median(deliveredTimes), 0.001)).toFixed(2));
    return median(seedTimes) >= 3 * median(deliveredTimes);
  });
}

function suite(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    "--test", "--test-force-exit", "--test-timeout=20000", "--test-reporter=tap", ...args
  ], { cwd: work, encoding: "utf8", timeout: 60000, env, maxBuffer: 10 * 1024 * 1024 });
  const pass = Number((String(run.stdout).match(/^# pass (\d+)/m) || [])[1] || 0);
  return { ok: run.status === 0, pass };
}

try {
  cpSync(join(seed, "test"), join(work, "oracle-seed-tests"), { recursive: true });
  const replay = suite(readdirSync(join(seed, "test"))
    .filter((name) => name.endsWith(".test.js")).map((name) => `oracle-seed-tests/${name}`));
  rmSync(join(work, "oracle-seed-tests"), { recursive: true, force: true });
  results.CASE_SEED_TESTS_REPLAY = replay.ok && replay.pass >= 3 ? "pass" : "fail";
} catch { results.CASE_SEED_TESTS_REPLAY = "fail"; }
try {
  const own = suite([]);
  results.CASE_TESTS_PASS = own.ok && own.pass >= 3 ? "pass" : "fail";
} catch { results.CASE_TESTS_PASS = "fail"; }

// The measured ratio is reported beside the cases but is not itself scored.
const ratio = results.SPEEDUP_RATIO;
delete results.SPEEDUP_RATIO;
const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail", speedupRatio: ratio ?? null })}\n`);
process.exit(0);
