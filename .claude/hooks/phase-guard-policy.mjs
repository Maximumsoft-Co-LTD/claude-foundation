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

export function looksMutatingShellCommand(command) {
  const value = String(command || "");
  const stripped = value.replace(/(['"])(?:\\.|(?!\1).)*\1/g, " ");
  const interpreterWrite = /\b(?:python(?:3(?:\.\d+)?)?|node|ruby|perl)\b/i.test(value) &&
    /(?:\bopen\s*\([^\n)]*,\s*['"][wax+]|\.write(?:_text|_bytes)?\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|renameSync|rmSync|unlinkSync|mkdirSync|copyFileSync)\s*\()/i
      .test(value);
  const formatterWrite = /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:(?:npx|pnpm\s+(?:exec|dlx)|yarn\s+dlx|bunx)\s+)?(?:prettier\b[^\n;&|]*\s--write\b|eslint\b[^\n;&|]*\s--fix\b|ruff\b[^\n;&|]*\s(?:format|check\b[^\n;&|]*\s--fix\b)|black\b|gofmt\b[^\n;&|]*\s-w\b|cargo\s+fmt\b)/m.test(stripped);
  return interpreterWrite || formatterWrite
    || /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:rm|mv|cp|ln|install|mkdir|rmdir|touch|truncate|tee|chmod|chown|patch|git\s+(?:commit|push|merge|rebase|checkout|switch|restore|reset|clean|apply|rm|mv|cherry-pick|revert|stash|am|pull|worktree|submodule)|npm\s+(?:install|publish|run|exec)|npx|pnpm\s+(?:install|publish|run|exec|dlx)|yarn\s+(?:add|install|publish|run|dlx)|bun\s+(?:install|run)|bunx|sh\s+\S+|bash\s+\S+|zsh\s+\S+)\b/m.test(stripped)
    || /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:sed|perl|ruby)\s+(?:-\S+\s+)*-\S*i/m.test(stripped)
    || /(?:^|[^<])(?:>>?|2>>?)\s*(?!&)(?!\/dev\/null(?:[\s;&|)]|$))\S/m.test(stripped);
}

export function shellMutationViolation(phase, environment, command = null) {
  if (phase === "prove" || phase === "change")
    return `${phase === "prove" ? "Prove" : "Change"} cannot run mutating shell commands`;
  if (phase === "land" && environment.FOUNDATION_LAND_TRANSACTION !== "1")
    return "Land shell mutations require the runtime transaction marker";
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
