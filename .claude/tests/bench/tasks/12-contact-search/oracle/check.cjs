// Deterministic AC oracle for 12-contact-search.
//
//   node check.cjs <sandbox-dir>   ->  JSON on stdout
//
// Harder than the other oracles in one specific way: the ask is "give them a way
// to search it", so the search function's NAME AND SIGNATURE ARE NOT SPECIFIED.
// The oracle therefore discovers it — every exported function across the sandbox's
// modules except the known-existing `listContacts`, probed with both plausible
// shapes (query) and (contacts, query) — and grades whichever one behaves like a
// search. If none does, every search AC fails, which is the correct reading of
// "no way to search was delivered".
//
// AC5 is the caller's job (run.sh): the shipped suite must fail once the search is
// swapped for the naive implementation the task's trap describes.

const path = require("path");
const fs = require("fs");

const sandbox = process.argv[2];
if (!sandbox) { console.log(JSON.stringify({ error: "usage: check.cjs <sandbox-dir>" })); process.exit(2); }

const results = {};
const note = [];
const record = (id, ok, why) => { results[id] = ok ? "pass" : "fail"; if (!ok && why) note.push(`${id}: ${why}`); };

let contacts;
try { contacts = require(path.resolve(sandbox, "contacts.js")); }
catch (e) { console.log(JSON.stringify({ error: `cannot load contacts.js: ${e.message}`, results: {} })); process.exit(2); }

// --- AC4 first: the existing callers must be intact, and everything below needs them.
let ac4 = false, all = [];
try {
  all = contacts.listContacts();
  const render = require(path.resolve(sandbox, "render.js"));
  const lines = render.addressBook();
  ac4 = Array.isArray(all) && all.length === 5 &&
        Array.isArray(lines) && lines.length === 5 && lines.some((l) => l.includes("(no name)"));
} catch (e) { note.push(`AC4 threw: ${e.message}`); }
record("AC4_callers_unbroken", ac4, "listContacts() must still return all 5 and addressBook() render 5 lines incl. (no name)");
if (!Array.isArray(all) || !all.length) {
  console.log(JSON.stringify({ results, note, error: "listContacts unusable — search ACs unevaluable" }));
  process.exit(0);
}

// --- discover the search function across every .js module in the sandbox root.
const namesOf = (o) => Object.keys(o || {}).filter((k) => typeof o[k] === "function");
const candidates = [];
for (const f of fs.readdirSync(sandbox).filter((f) => /\.js$/.test(f) && !/\.test\.|\.spec\./.test(f))) {
  let m; try { m = require(path.resolve(sandbox, f)); } catch (e) { continue; }
  for (const n of namesOf(m)) {
    if (n === "listContacts" || n === "addressBook") continue;
    candidates.push({ file: f, name: n, fn: m[n] });
  }
}

// Probe both shapes. "Behaves like a search" = returns an array of contact-ish
// rows for "ada", and that result is narrower than the full list.
const probe = (c, q) => {
  const tries = [() => c.fn(q), () => c.fn(all, q), () => c.fn(q, all)];
  for (const t of tries) {
    try {
      const r = t();
      if (Array.isArray(r)) return r;
    } catch (e) { /* wrong shape or a genuine throw — keep probing */ }
  }
  return null;
};
// Pass 1 — a candidate that behaves like a working search.
let search = null;
for (const c of candidates) {
  const r = probe(c, "ada");
  if (Array.isArray(r) && r.length >= 1 && r.length < all.length && r.some((x) => x && x.id === 1)) { search = c; break; }
}
// Pass 2 — a candidate that THROWS on a query. The task's own trap
// (`c.name.includes(q)`) dies on the name:null row for EVERY query, so pass 1 can
// never see it; without this it would be reported as "no search delivered", which
// is a different (and wrong) diagnosis for the same score. Prefer search-shaped
// names so an unrelated throwing helper is not mistaken for the feature.
if (!search) {
  const shaped = candidates.filter((c) => /search|find|filter|query|match|lookup/i.test(c.name));
  for (const c of [...shaped, ...candidates]) {
    let threw = false;
    for (const t of [() => c.fn("ada"), () => c.fn(all, "ada"), () => c.fn("ada", all)]) {
      try { t(); } catch (e) { if (!/is not a function|undefined is not/.test(String(e.message))) { threw = true; break; } }
    }
    if (threw) { search = c; note.push(`search "${c.file}:${c.name}" throws on a plain query — graded as a broken search, not a missing one`); break; }
  }
}
if (!search) {
  note.push(`no search function found (exports probed: ${candidates.map((c) => c.file + ":" + c.name).join(", ") || "none"})`);
  ["AC1_case_insensitive", "AC2_null_safe", "AC3_empty_returns_all"].forEach((k) => record(k, false, "no search function delivered"));
  console.log(JSON.stringify({ results, note, search: null }));
  process.exit(0);
}
const run = (q) => probe(search, q);

// --- AC1 CASE-INSENSITIVE
let ac1 = false;
try {
  const lower = run("ada"), upper = run("ALAN");
  ac1 = Array.isArray(lower) && lower.some((c) => c && c.id === 1) &&
        Array.isArray(upper) && upper.some((c) => c && c.id === 3);
} catch (e) { note.push(`AC1 threw: ${e.message}`); }
record("AC1_case_insensitive", ac1, '"ada" must find Ada Lovelace and "ALAN" must find the row stored as "alan turing"');

// --- AC2 NULL-SAFE. id 4 has name: null. A bare c.name.toLowerCase() throws.
// probe() swallows throws, so call the winning shape directly here.
let ac2 = true;
for (const q of ["a", "e", "zuse", "k."]) {
  try {
    const r = search.fn.length >= 2 ? search.fn(all, q) : search.fn(q);
    if (!Array.isArray(r)) { ac2 = false; note.push(`AC2: query "${q}" returned a non-array`); }
  } catch (e) { ac2 = false; note.push(`AC2: query "${q}" threw ${e.message} — the null-name row takes the page down`); break; }
}
record("AC2_null_safe", ac2, "search must survive the name:null row");

// --- AC3 EMPTY QUERY RETURNS EVERYTHING
let ac3 = false;
try {
  const empty = run(""), blank = run("   ");
  ac3 = Array.isArray(empty) && empty.length === all.length &&
        Array.isArray(blank) && blank.length === all.length;
} catch (e) { note.push(`AC3 threw: ${e.message}`); }
record("AC3_empty_returns_all", ac3, "an empty or whitespace-only query must yield the full list, not an empty one");

console.log(JSON.stringify({ results, note, search: `${search.file}:${search.name}` }));
