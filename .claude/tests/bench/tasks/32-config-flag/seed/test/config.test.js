const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadConfig, ConfigError } = require("../src/config");

function configFile(value) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gw-")), "config.json");
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test("defaults, file values and env overrides", () => {
  assert.equal(loadConfig({ env: {} }).port, 8080);
  const file = configFile({ port: 9090, logLevel: "warn" });
  assert.equal(loadConfig({ env: {}, file }).port, 9090);
  assert.equal(loadConfig({ env: { PORT: "7070", LOG_LEVEL: "" }, file }).port, 7070);
  assert.equal(loadConfig({ env: { LOG_LEVEL: "" }, file }).logLevel, "warn");
});

test("invalid values name the setting and source", () => {
  assert.throws(() => loadConfig({ env: { PORT: "80a" } }), (error) =>
    error instanceof ConfigError && error.message === 'invalid port from PORT: "80a" (expected an integer from 1 to 65535)');
  assert.throws(() => loadConfig({ env: {}, file: configFile({ prot: 1 }) }), /unknown setting/);
});
