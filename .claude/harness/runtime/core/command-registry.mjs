const RUNTIME_COMMAND_ALIASES = {
  "audit-change": "change audit",
  "agent-plan": "agents plan",
  "agent-task": "agents task",
  "agent-acquire": "agents acquire",
  "agent-release": "agents release",
  receipt: "evidence record",
  "run-provider": "evidence run",
  prove: "proof finalize",
  "host-execution-import": "telemetry host-import",
  validate: "change validate"
};

export function createCommandRegistry({ path, readJson, fail }) {
  let cache = null;

  function commandRegistry() {
    if (cache) return cache;
    const registry = readJson(path);
    if (!registry || registry.version !== 1 || !Array.isArray(registry.commands) ||
        !Array.isArray(registry.runtimeCommands))
      fail("invalid command registry: expected version 1 commands and runtimeCommands arrays");
    const audiences = new Set(["agent", "conditional", "admin", "host", "internal"]);
    const kinds = new Set(["read", "write", "authority"]);
    const names = new Set();
    for (const entry of registry.commands) {
      if (!entry || typeof entry.name !== "string" || !entry.name.trim() ||
          typeof entry.usage !== "string" || typeof entry.description !== "string" ||
          !audiences.has(entry.audience) || !kinds.has(entry.kind) ||
          typeof entry.idempotent !== "boolean")
        fail("invalid command registry entry");
      if (names.has(entry.name)) fail(`duplicate command registry entry '${entry.name}'`);
      names.add(entry.name);
    }
    const runtimeCommands = new Set();
    for (const runtimeCommand of registry.runtimeCommands) {
      if (typeof runtimeCommand !== "string" || !runtimeCommand.trim())
        fail("invalid runtime command registry entry");
      if (runtimeCommands.has(runtimeCommand))
        fail(`duplicate runtime command registry entry '${runtimeCommand}'`);
      runtimeCommands.add(runtimeCommand);
    }
    cache = registry;
    return cache;
  }

  function describeCommand(name, options = {}) {
    const entries = [...commandRegistry().commands].sort((left, right) =>
      left.name.localeCompare(right.name));
    if (!name) {
      if (options.json) { console.log(JSON.stringify(entries, null, 2)); return; }
      console.log("Commands (describe <command> for one):\n");
      for (const entry of entries)
        console.log(`  ${entry.name.padEnd(22)} ${entry.description}`);
      console.log("\nFile shapes:\n");
      console.log("  evidence.yaml, execution.yaml   openspec/schemas/<schema>/schema.yaml");
      console.log("  host execution, instruction     .claude/harness/runtime/contracts/");
      console.log("  authority response              authority status <change> --template");
      return;
    }
    const normalize = (value) => value.replace(/[\s-]+/g, "-");
    const target = normalize(name);
    const aliased = RUNTIME_COMMAND_ALIASES[target];
    const exact = entries.find((candidate) => normalize(candidate.name) === target);
    const family = entries.filter((candidate) =>
      normalize(candidate.name).startsWith(`${target}-`));
    if (!aliased && !exact && family.length > 1) {
      if (options.json) { console.log(JSON.stringify(family, null, 2)); return; }
      console.log(`${name} — ${family.length} commands:\n`);
      for (const member of family)
        console.log(`  ${member.name.padEnd(22)} ${member.description}`);
      return;
    }
    const entry = entries.find((candidate) => candidate.name === aliased) ||
      entries.find((candidate) => normalize(candidate.name) === target) ||
      entries.find((candidate) => normalize(candidate.name).endsWith(`-${target}`)) ||
      entries.find((candidate) => normalize(candidate.name).split("-").includes(target));
    if (!entry) {
      const near = entries.filter((candidate) => target.split("-")
        .some((token) => normalize(candidate.name).includes(token)));
      fail(`unknown command '${name}'\n  ${near.length ? "did you mean" : "known"}: ` +
        `${(near.length ? near : entries).map((candidate) => candidate.name).join(", ")}`);
    }
    if (options.json) { console.log(JSON.stringify(entry, null, 2)); return; }
    console.log(`${entry.name} — ${entry.description}\n`);
    console.log(`  usage:     ${entry.usage}`);
    console.log(`  audience:  ${entry.audience}`);
    console.log(`  kind:      ${entry.kind}${entry.idempotent ? " (idempotent)" : ""}`);
  }

  function assertRegisteredRuntimeCommand(command, values = []) {
    if (!command) return;
    const registry = commandRegistry().runtimeCommands;
    if (registry.includes(command)) return;
    const word = values[0] && !values[0].startsWith("-") ? values[0] : null;
    const publicForm = word ? `${command} ${word}` : null;
    const known = publicForm &&
      commandRegistry().commands.some((entry) => entry.name === publicForm);
    const internal = known
      ? [`${command}-${word}`, word].find((candidate) => registry.includes(candidate))
      : null;
    if (internal)
      fail(`runtime command '${command}' is not registered\n` +
        `  '${publicForm}' is the CLI form: claude-foundation ${publicForm}\n` +
        `  this entrypoint takes the internal name: ${internal}`);
    fail(`runtime command '${command}' is not registered`);
  }

  return { commandRegistry, describeCommand, assertRegisteredRuntimeCommand };
}
