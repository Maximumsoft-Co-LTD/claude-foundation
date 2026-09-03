function shellQuoted(value) {
  return [value, `'${value.replaceAll("'", "'\\''")}'`,
    `"${value.replaceAll('"', '\\"')}"`];
}

function explicitlyAnchored(command, workspace) {
  return shellQuoted(workspace).some((value) =>
    new RegExp(`^\\s*(?:cd|pushd)\\s+${value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*(?:&&|;)`)
      .test(command));
}

function obviousWorkspaceEscape(command, workspace) {
  if (/(?:^|[\s'"=])\.\.(?:\/|$)/.test(command)) return true;
  const redirects = [...command.matchAll(/(?:>>?|\btee\b(?:\s+-\S+)*)\s+(['"]?)(\/[^\s'";&|]+)\1/g)]
    .map((match) => match[2]);
  return redirects.some((target) => target !== "/dev/null" &&
    target !== workspace && !target.startsWith(`${workspace}/`));
}

const INTERPRETER = /\b(?:python(?:3(?:\.\d+)?)?|node|ruby|perl)\b/i;
const INTERPRETER_WRITE = /(?:\bopen\s*\([^\n)]*,\s*['"][wax+]|\.write(?:_text|_bytes)?\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|renameSync|rmSync|unlinkSync|mkdirSync|copyFileSync)\s*\()/i;
const FORMATTER_WRITE = /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:(?:npx|pnpm\s+(?:exec|dlx)|yarn\s+dlx|bunx)\s+)?(?:prettier\b[^\n;&|]*\s--write\b|eslint\b[^\n;&|]*\s--fix\b|ruff\b[^\n;&|]*\s(?:format|check\b[^\n;&|]*\s--fix\b)|black\b|gofmt\b[^\n;&|]*\s-w\b|cargo\s+fmt\b)/m;
const MUTATING_WORD = /(?:^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(rm|mv|cp|ln|install|mkdir|rmdir|touch|truncate|tee|chmod|chown|patch|git\s+(?:commit|push|merge|rebase|checkout|switch|restore|reset|clean|apply|rm|mv|cherry-pick|revert|stash|am|pull|worktree|submodule)|npm\s+(?:install|publish|run|exec)|npx|pnpm\s+(?:install|publish|run|exec|dlx)|yarn\s+(?:add|install|publish|run|dlx)|bun\s+(?:install|run)|bunx|sh\s+\S+|bash\s+\S+|zsh\s+\S+)\b/gm;
const IN_PLACE_EDIT = /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:sed|perl|ruby)\s+(?:-\S+\s+)*-\S*i/m;
const REDIRECT = /(?:^|[^<])(?:>>?|2>>?)\s*(?!&)(?!\/dev\/null(?:[\s;&|)]|$))\S/m;

// Delivery is not a tree mutation. The Land transaction marker exists to stop
// an agent editing the checkout while the runtime projects a proven sandbox
// into it; publishing what the runtime already applied is the step the Land
// contract requires the agent to perform under separate user authority. That
// marker is process-local to the apply transaction and can never reach a host
// tool call, so requiring it for every command made an authorized commit
// unreachable and handed the work back to the user.
const LAND_DELIVERY_OPERATIONS = new Set(["git commit", "git push"]);

// The operation screen reads a copy with quoted spans blanked out, so a
// substitution inside a commit message reaches it as whitespace: `git commit -m
// "$(rm -rf build)"` reduces to the single operation `git commit` while the
// shell still runs the removal. Build refuses the same constructs before it
// trusts an anchored path; delivery has to as well, or the carve-out is wider
// than the two commands it was scoped to permit.
const HIDDEN_COMMAND = /\$\(|`|\$\{|<\(/;

// The matched command words, not merely whether one exists: a phase rule that
// permits some operations and refuses others has to name the ones it refused.
export function mutatingShellOperations(command) {
  const value = String(command || "");
  const stripped = value.replace(/(['"])(?:\\.|(?!\1).)*\1/g, " ");
  const operations = [];
  if (INTERPRETER.test(value) && INTERPRETER_WRITE.test(value))
    operations.push("interpreter write");
  if (FORMATTER_WRITE.test(stripped)) operations.push("formatter write");
  for (const match of stripped.matchAll(MUTATING_WORD))
    operations.push(match[1].replace(/\s+/g, " ").toLowerCase());
  if (IN_PLACE_EDIT.test(stripped)) operations.push("in-place edit");
  if (REDIRECT.test(stripped)) operations.push("redirect");
  return [...new Set(operations)];
}

export function looksMutatingShellCommand(command) {
  return mutatingShellOperations(command).length > 0;
}

export function shellMutationViolation(phase, environment, command = null) {
  if (phase === "prove" || phase === "change")
    return `${phase === "prove" ? "Prove" : "Change"} cannot run mutating shell commands`;
  if (phase === "land" && environment.FOUNDATION_LAND_TRANSACTION !== "1") {
    if (command === null)
      return "Land shell mutations require the runtime transaction marker";
    const refused = mutatingShellOperations(command)
      .filter((operation) => !LAND_DELIVERY_OPERATIONS.has(operation));
    if (HIDDEN_COMMAND.test(String(command)))
      refused.push("command substitution");
    if (refused.length)
      return "Land shell mutations require the runtime transaction marker; only " +
        `authorized git commit and git push deliver outside it (refused: ${refused.join(", ")})`;
  }
  if (phase === "build") {
    const workspace = environment.FOUNDATION_WORKSPACE_ROOT;
    if (!workspace) return "Build shell mutations require an isolated workspace";
    if (command !== null && !explicitlyAnchored(String(command), workspace))
      return "Build shell mutations must start inside the isolated workspace";
    if (command !== null && /(?:\$\(|`|\$\{|(?:^|[\s=])\$[A-Za-z_]|(?:^|[\s=])~(?:\/|\s|$))/.test(String(command)))
      return "Build shell mutation contains a dynamic path that cannot be proven isolated";
    if (command !== null && obviousWorkspaceEscape(String(command), workspace))
      return "Build shell mutation contains an obvious path outside the isolated workspace";
  }
  return null;
}
