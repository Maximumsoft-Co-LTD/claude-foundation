// The public CLI grammar, derived from `commands.json` alone.
//
// `cli.sh` used to restate every route as a shell `case`: the runtime name,
// its read/write access class, the argument check, and the lifecycle phase.
// Each was a second copy of a registry row. `cli.sh` now asks this module for
// the route and only resolves the project, checks the runtime API, and execs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryPhaseForCommand } from "./lifecycle-phase.mjs";

export class CliRouteError extends Error {
  constructor(message, code = 1, warning = null) {
    super(message); this.code = code; this.warning = warning;
  }
}

// A row's `args` names only what its usage line cannot: the default minimum
// is one argument when the usage starts with a positional or `--template`.
function argumentError(entry, values) {
  const spec = entry.args || {};
  if (spec.template && values[0] === "--template") return null;
  const tail = entry.usage.slice(entry.name.length).trimStart();
  const min = spec.min ?? (/^(<|--template)/.test(tail) ? 1 : 0);
  const max = spec.max ?? Infinity;
  if (values.length < min)
    return (spec.min !== undefined || spec.max === undefined) && spec.error || "requires an argument";
  if (values.length > max) return spec.error || "takes no arguments";
  return null;
}

// argv as typed after any global options. Returns the runtime argv, the access
// class `cli.sh` uses for the runtime-API check, the lifecycle phase, and any
// deprecation warning; throws CliRouteError for a refused route (code 3 when
// the first word is not a registered runtime route at all).
export function resolveCliRoute(registry, argv) {
  const routed = registry.commands.filter((entry) => entry.runtime);
  const words = argv[0] === "deliver" && argv[1] !== "advance"
    ? ["deliver", "advance", ...argv.slice(1)] : argv;
  const entry = routed.find((row) => row.name === `${words[0]} ${words[1]}`) ||
    routed.find((row) => row.name === words[0]);
  if (!entry) {
    const family = routed.filter((row) => row.name.startsWith(`${words[0]} `))
      .map((row) => `'${row.name.split(" ")[1]}'`);
    if (!family.length) throw new CliRouteError(`unknown command '${words[0]}'`, 3);
    throw new CliRouteError(`${words[0]} requires ${family.length > 1
      ? `${family.slice(0, -1).join(", ")}${family.length > 2 ? "," : ""} or ` : ""}${family.at(-1)}`);
  }
  const warning = entry.replacement
    ? `'${entry.name}' is deprecated; use '${entry.replacement}'` : null;
  let values = words.slice(entry.name.split(" ").length);
  const error = argumentError(entry, values);
  if (error)
    throw new CliRouteError(`${words === argv ? entry.name : argv[0]} ${error}`, 1, warning);
  if (entry.name === "agents task")
    values = [values[0], "--task", values[1], ...values.slice(2)];
  const [command, ...sub] = entry.runtime.split(" ");
  return {
    access: entry.access || (entry.kind === "read" ? "read" : "write"),
    phase: telemetryPhaseForCommand(command) || "",
    argv: [command, ...sub, ...values],
    warning
  };
}

const HELP_GROUPS = [["Workflow", "agent"], ["Conditional recovery", "conditional"],
  ["Administration", "admin"], ["Host integration", "host"],
  ["Internal compatibility", "internal"]];
// The agent's normal path: start a change, then advance it. Everything else
// is recovery or operator surface behind `help --all`. Hidden rows still route;
// they are superseded by `advance` and leave the registry in the next major.
const PRIMARY = ["change start", "advance", "changes"];

export function renderHelp(registry, showAll) {
  const lines = ["claude-foundation — OpenSpec-native software-change harness", ""];
  for (const [title, audience] of HELP_GROUPS) {
    const rows = registry.commands.filter((command) => command.audience === audience &&
      !command.hidden && (showAll || PRIMARY.includes(command.name)));
    if (!showAll) rows.sort((left, right) =>
      PRIMARY.indexOf(left.name) - PRIMARY.indexOf(right.name));
    if (!rows.length) continue;
    lines.push(`${title}:`);
    for (const command of rows) {
      lines.push(`  claude-foundation ${command.usage}${command.deprecated ? " [deprecated]" : ""}`);
      lines.push(`    ${command.description}`);
    }
    lines.push("");
  }
  lines.push("Global options: --project <path>, -C <path>",
    "Workflow: /investigate → /change → /build → /prove → /land; optional: /deliver",
    "Normal use: describe the outcome to your coding agent; it runs recovery and CLI details for you.");
  if (!showAll) lines.push("Run `claude-foundation help --all` for primitive, recovery, host, and compatibility commands.");
  return `${lines.join("\n")}\n`;
}

const shellWord = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const registry = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "commands.json"), "utf8"));
  const [mode, ...argv] = process.argv.slice(2);
  if (mode === "help") {
    process.stdout.write(renderHelp(registry, argv[0] === "--all"));
  } else {
    try {
      const route = resolveCliRoute(registry, argv);
      if (route.warning) process.stderr.write(`claude-foundation: warning: ${route.warning}\n`);
      process.stdout.write([route.access, route.phase, ...route.argv].map(shellWord).join(" "));
    } catch (error) {
      if (!(error instanceof CliRouteError)) throw error;
      if (error.warning) process.stderr.write(`claude-foundation: warning: ${error.warning}\n`);
      if (error.code !== 3) process.stderr.write(`claude-foundation: ${error.message}\n`);
      process.exitCode = error.code;
    }
  }
}
