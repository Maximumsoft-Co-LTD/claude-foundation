"use strict";

const fs = require("node:fs");

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function integerIn(min, max) {
  return {
    expected: `an integer from ${min} to ${max}`,
    parse(raw) {
      const value = typeof raw === "number" ? raw : /^-?\d+$/.test(String(raw).trim()) ? Number(raw) : NaN;
      return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
    }
  };
}

function oneOf(values) {
  return {
    expected: `one of ${values.join(", ")}`,
    parse(raw) {
      return values.includes(raw) ? raw : undefined;
    }
  };
}

const httpUrl = {
  expected: "an http: or https: URL",
  parse(raw) {
    try {
      const url = new URL(String(raw));
      return ["http:", "https:"].includes(url.protocol) ? String(raw) : undefined;
    } catch {
      return undefined;
    }
  }
};

const SETTINGS = {
  port: { env: "PORT", default: 8080, type: integerIn(1, 65535) },
  logLevel: { env: "LOG_LEVEL", default: "info", type: oneOf(["debug", "info", "warn", "error"]) },
  upstreamUrl: { env: "UPSTREAM_URL", default: "http://localhost:9000", type: httpUrl }
};

function readFile(file) {
  if (!file) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`cannot read config file ${file}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ConfigError(`config file ${file} must contain a JSON object`);
  for (const key of Object.keys(parsed))
    if (!Object.hasOwn(SETTINGS, key)) throw new ConfigError(`unknown setting in ${file}: "${key}"`);
  return parsed;
}

function loadConfig({ env = process.env, file } = {}) {
  const fromFile = readFile(file);
  const config = {};
  for (const [key, setting] of Object.entries(SETTINGS)) {
    let raw = setting.default;
    let source = "default";
    if (env[setting.env] !== undefined && env[setting.env] !== "") {
      raw = env[setting.env];
      source = setting.env;
    } else if (Object.hasOwn(fromFile, key)) {
      raw = fromFile[key];
      source = file;
    }
    const value = setting.type.parse(raw);
    if (value === undefined)
      throw new ConfigError(`invalid ${key} from ${source}: ${JSON.stringify(raw)} (expected ${setting.type.expected})`);
    config[key] = value;
  }
  return Object.freeze(config);
}

module.exports = { loadConfig, ConfigError, SETTINGS };
