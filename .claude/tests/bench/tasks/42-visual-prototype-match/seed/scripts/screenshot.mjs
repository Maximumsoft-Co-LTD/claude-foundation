#!/usr/bin/env node
// Writes test-results/settings.png: serves this project on an ephemeral
// localhost port and captures index.html with a headless Chromium.
// No npm dependency: the browser is CHROME_PATH, a Playwright-cached
// Chromium, an installed Chrome/Chromium app, or one on PATH.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, platform, tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd());
const OUTPUT = resolve(ROOT, process.argv[2] || "test-results/settings.png");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

function newest(directory, prefix) {
  try {
    return readdirSync(directory).filter((name) => name.startsWith(prefix))
      .sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))
      .map((name) => join(directory, name));
  } catch { return []; }
}

function candidates() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (platform() === "darwin" ? join(homedir(), "Library/Caches/ms-playwright")
      : join(homedir(), ".cache/ms-playwright"));
  for (const dir of newest(cache, "chromium_headless_shell-"))
    for (const sub of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64",
      "chrome-headless-shell-linux64", "chrome-linux"])
      list.push(join(dir, sub, "chrome-headless-shell"));
  for (const dir of newest(cache, "chromium-")) {
    for (const sub of ["chrome-mac-arm64", "chrome-mac", "chrome-mac-x64"]) {
      list.push(join(dir, sub, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
      list.push(join(dir, sub, "Chromium.app/Contents/MacOS/Chromium"));
    }
    list.push(join(dir, "chrome-linux64", "chrome"), join(dir, "chrome-linux", "chrome"));
  }
  list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium");
  for (const dir of String(process.env.PATH || "").split(":").filter(Boolean))
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"])
      list.push(join(dir, name));
  return list;
}

const browser = candidates().find((path) => {
  try { return statSync(path).isFile(); } catch { return false; }
});
if (!browser) {
  process.stderr.write("screenshot: no Chromium found; set CHROME_PATH to a Chrome/Chromium binary\n");
  process.exit(2);
}

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = resolve(ROOT, `.${path === "/" ? "/index.html" : path}`);
  if (!(file === ROOT || file.startsWith(ROOT + sep)) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

mkdirSync(resolve(OUTPUT, ".."), { recursive: true });
rmSync(OUTPUT, { force: true });
const profile = mkdtempSync(join(tmpdir(), "settings-screenshot-"));
const code = await new Promise((done) => {
  const child = spawn(browser, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--force-device-scale-factor=1",
    `--user-data-dir=${profile}`, "--window-size=900,700",
    "--virtual-time-budget=3000", `--screenshot=${OUTPUT}`, url
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
  child.on("error", (error) => { clearTimeout(timer); stderr += error.message; done(1); });
  child.on("exit", (status) => {
    clearTimeout(timer);
    if (status !== 0) process.stderr.write(stderr);
    done(status ?? 1);
  });
});
server.close();
rmSync(profile, { recursive: true, force: true });

if (code !== 0 || !existsSync(OUTPUT) || statSync(OUTPUT).size === 0) {
  process.stderr.write(`screenshot: ${browser} did not write ${OUTPUT}\n`);
  process.exit(1);
}
process.stdout.write(`screenshot: ${OUTPUT} (${statSync(OUTPUT).size} bytes, ${url})\n`);
