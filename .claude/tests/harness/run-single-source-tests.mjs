// Tables that must agree, checked as tables rather than by hand.
//
// The harness encodes the same fact in more than one file in several places.
// That is sometimes unavoidable — `cli.sh` is shell and cannot import an ESM
// module, and the runtime-API pins exist precisely so a mixed install is caught
// early. What is avoidable is finding out they drifted from a wrong number in a
// report six weeks later.
//
// The lifecycle-phase pair is the one that already drifted: `cli.sh` mapped
// seven commands (`new`, `start`, `validate`, `abandon`, `agent-plan`,
// `agent-acquire`, `agent-release`) that the runtime's own map did not, so an
// operation logged a phase only when it arrived through the CLI, and `metrics`
// split one change's rollup into two disjoint halves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_BY_COMMAND, LIFECYCLE_PHASES } from "../../harness/runtime/core/lifecycle-phase.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");
let assertions = 0;
const check = (fn) => { fn(); assertions += 1; };

// --- lifecycle phase: cli.sh grammar vs the runtime table --------------------

// The `phase=` case block in cli.sh, parsed back into a map. Shape:
//   new|start|resolve) phase="change" ;;
const cli = read("cli.sh");
const phaseBlock = cli.slice(cli.indexOf('local phase=""'), cli.indexOf("telemetry=1"));
const cliPhases = {};
for (const line of phaseBlock.split("\n")) {
  const match = line.match(/^\s*([a-z0-9|-]+)\)\s*phase="([a-z]+)"\s*;;/);
  if (!match) continue;
  for (const command of match[1].split("|")) cliPhases[command] = match[2];
}

check(() => assert.ok(Object.keys(cliPhases).length > 20,
  "the cli.sh phase grammar failed to parse — this test is reading the wrong block"));

for (const [command, phase] of Object.entries(cliPhases))
  check(() => assert.equal(PHASE_BY_COMMAND[command], phase,
    `cli.sh maps '${command}' to '${phase}'; the runtime table must say the same`));

// The runtime table may cover more than the CLI exposes (`meta` commands are
// reachable only through the runtime), but every lifecycle answer it gives for
// a command the CLI also routes has to match, and the phase vocabulary is
// closed.
for (const [command, phase] of Object.entries(PHASE_BY_COMMAND)) {
  check(() => assert.ok([...LIFECYCLE_PHASES, "meta"].includes(phase),
    `'${command}' is mapped to unknown phase '${phase}'`));
  if (cliPhases[command])
    check(() => assert.equal(cliPhases[command], phase,
      `the runtime maps '${command}' to '${phase}'; cli.sh must say the same`));
}

// --- public command registry vs cli.sh grammar -------------------------------

// `commands.json` generates `help`, but cli.sh owns the actual routes. An entry
// the runtime implements but cli.sh never routes is a documented dead end —
// `exec` and `hash` both shipped exactly that way. Every token of a public
// command's name must appear in cli.sh, either as a case label or as a quoted
// literal (the `dashboard snapshot` form).
const registry = JSON.parse(read(".claude", "harness", "commands.json"));
const publicCommands = registry.commands.filter(
  (command) => !["internal", "host"].includes(command.audience));
check(() => assert.ok(publicCommands.length > 20,
  "the command registry failed to parse — this test is reading the wrong file"));
for (const command of publicCommands)
  for (const token of command.name.split(" "))
    check(() => assert.ok(
      new RegExp(`(?:^|\\s)(?:[\\w.-]+\\|)*${token}(?:\\|[\\w.-]+)*\\)`, "m").test(cli) ||
        cli.includes(`"${token}"`),
      `commands.json advertises '${command.name}' but cli.sh has no route for '${token}'`));

// --- the four runtime-API pins ----------------------------------------------

// CLAUDE.md states all four must match. Only four of the six pairs were checked
// anywhere, and no check compared cli.sh against the module pin directly, so a
// cli.sh-only edit was caught by nothing.
const pins = {
  "cli.sh EXPECTED_RUNTIME_API":
    read("cli.sh").match(/EXPECTED_RUNTIME_API=["']?(\d+)/)?.[1],
  "foundation.mjs RUNTIME_API_VERSION":
    read(".claude/harness/foundation.mjs").match(/RUNTIME_API_VERSION\s*=\s*"(\d+)"/)?.[1],
  "runtime/version.mjs RUNTIME_MODULE_API":
    read(".claude/harness/runtime/version.mjs").match(/RUNTIME_MODULE_API\s*=\s*"(\d+)"/)?.[1],
  "protocol.json runtimeApi":
    JSON.parse(read(".claude/harness/protocol.json")).runtimeApi,
  "AGENT.md runtime API guidance":
    read(".claude/harness/AGENT.md").match(/runtime API `(\d+)`/)?.[1],
  "DEVELOPER-SETUP.md runtime API guidance":
    read(".claude/harness/DEVELOPER-SETUP.md").match(/runtime API\s+is `(\d+)`/)?.[1]
};

for (const [name, value] of Object.entries(pins))
  check(() => assert.match(String(value ?? ""), /^\d+$/,
    `${name} did not parse — the pin moved or changed shape`));

const pinNames = Object.keys(pins);
for (let left = 0; left < pinNames.length; left += 1)
  for (let right = left + 1; right < pinNames.length; right += 1)
    check(() => assert.equal(
      String(pins[pinNames[left]]), String(pins[pinNames[right]]),
      `${pinNames[left]} and ${pinNames[right]} disagree`));

// --- release version surfaces ------------------------------------------------

// `doctor` compares thirteen protocol keys and deliberately not this one, so
// `runtime version` and the `protocols.runtime` stamped into every proof could
// name different runtimes for the same install with nothing to notice.
const runtimeVersion =
  read(".claude/harness/foundation.mjs").match(/const VERSION\s*=\s*"([^"]+)"/)?.[1];
const protocolRuntime = JSON.parse(read(".claude/harness/protocol.json")).runtime;
check(() => assert.equal(runtimeVersion, protocolRuntime,
  "foundation.mjs VERSION and protocol.json runtime name the same runtime"));

const releaseVersion = read("VERSION").trim();
const releaseSurfaces = {
  "foundation.mjs VERSION": runtimeVersion,
  "protocol.json runtime": protocolRuntime,
  "AGENT.md Foundation version":
    read(".claude/harness/AGENT.md").match(/verify Foundation ([0-9]+\.[0-9]+\.[0-9]+)/)?.[1],
  "DEVELOPER-SETUP.md heading version":
    read(".claude/harness/DEVELOPER-SETUP.md").match(/Foundation v([0-9]+\.[0-9]+\.[0-9]+)/)?.[1],
  "DEVELOPER-SETUP.md CLI version":
    read(".claude/harness/DEVELOPER-SETUP.md").match(/version` is `([0-9]+\.[0-9]+\.[0-9]+)`/)?.[1],
  "DEVELOPER-SETUP.md clone tag":
    read(".claude/harness/DEVELOPER-SETUP.md").match(/clone tag `v([0-9]+\.[0-9]+\.[0-9]+)`/)?.[1],
  "DEVELOPER-SETUP.md install path":
    read(".claude/harness/DEVELOPER-SETUP.md").match(/claude-foundation\/([0-9]+\.[0-9]+\.[0-9]+)`/)?.[1],
  "English CLI runtime":
    read("website/docs/src/content/docs/cli.md").match(/\| runtime \| ([0-9]+\.[0-9]+\.[0-9]+) \|/)?.[1],
  "Thai CLI runtime":
    read("website/docs/src/content/docs/th/cli.md").match(/\| runtime \| ([0-9]+\.[0-9]+\.[0-9]+) \|/)?.[1]
};

for (const [name, value] of Object.entries(releaseSurfaces))
  check(() => assert.equal(value, releaseVersion,
    `${name} must agree with VERSION`));

// --- shipping boundary -------------------------------------------------------

// `install.sh` MANAGED is authoritative and CLAUDE.md documents it. A path in
// one and not the other means either an install that silently stops shipping a
// file, or a document that lies about what a consumer receives.
const managedBlock = read("install.sh");
const managed = managedBlock
  .slice(managedBlock.indexOf("MANAGED=("), managedBlock.indexOf(")", managedBlock.indexOf("MANAGED=(")))
  .split("\n").slice(1)
  .map((line) => line.trim().replace(/^["']|["']$/g, ""))
  .filter((line) => line && !line.startsWith("#"));

check(() => assert.ok(managed.length >= 8,
  "the install.sh MANAGED array failed to parse — this test is reading the wrong block"));

const claudeMd = read("CLAUDE.md");
for (const path of managed)
  check(() => assert.ok(claudeMd.includes(path),
    `install.sh ships '${path}' but CLAUDE.md does not list it as managed`));

console.log(`single-source tables: ALL PASS (${assertions}/${assertions} assertions)`);
