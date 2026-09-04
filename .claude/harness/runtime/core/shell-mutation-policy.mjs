import { isAbsolute, relative, resolve } from "node:path";

function shellQuoted(value) {
  return [value, `'${value.replaceAll("'", "'\\''")}'`,
    `"${value.replaceAll('"', '\\"')}"`];
}

function explicitlyAnchored(command, workspace) {
  return shellQuoted(workspace).some((value) =>
    new RegExp(`^\\s*(?:cd|pushd)\\s+${value.replace(/[.*+?^${}()|[\]\\\\]/g, "\\$&")}\\s*(?:&&|;)`)
      .test(command));
}

function within(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function shellWords(value) {
  return String(value).match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g) || [];
}

function unquote(value) {
  const text = String(value || "").replace(/^[({]+|[)},]+$/g, "");
  if ((text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"')))
    return text.slice(1, -1);
  return text;
}

function absoluteExecutableRanges(command) {
  const ranges = [];
  const executable = /(?:^|[;&|()]|\b(?:then|do)\b)\s*(?:(?:sudo|command)\s+)?(?:env(?:\s+-\S+|\s+[A-Za-z_][A-Za-z0-9_]*=\S+)*\s+)?(\/[^\s;&|()]+)/gmi;
  for (const match of command.matchAll(executable)) {
    const offset = match[0].lastIndexOf(match[1]);
    ranges.push([match.index + offset, match.index + offset + match[1].length]);
  }
  return ranges;
}

// Return every path that a recognized filesystem command may mutate. Reading
// an extra source path is harmless to containment, while omitting a destination
// is not, so multi-path commands deliberately inspect all operands.
function filesystemMutationTargets(command) {
  const targets = [];
  const executableRanges = absoluteExecutableRanges(command);
  const operations = /(?:^|[;&|()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:[^\s;&|()]+\/)*(rm|mv|cp|ln|install|mkdir|rmdir|touch|truncate|tee|chmod|chown)\b([^;&|\n]*)/gmi;
  for (const match of command.matchAll(operations)) {
    const words = shellWords(match[2]).map(unquote);
    for (const word of words) {
      if (!word || word.startsWith("-") || /^\d+$/.test(word)) continue;
      targets.push(word.includes("=") ? word.slice(word.indexOf("=") + 1) : word);
    }
  }
  for (const match of command.matchAll(/(?:^|[;&|()]|\b(?:then|do)\b)\s*(?:cd|pushd)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;&|]+)/gmi))
    targets.push(unquote(match[1]));
  for (const match of command.matchAll(/(?:>>?|\btee\b(?:\s+-\S+)*)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;&|]+)/gmi))
    targets.push(unquote(match[1]));
  // Interpreter and option-value writes do not necessarily expose a standalone
  // shell operand (`writeFile('/tmp/x')`, `--output=/tmp/x`). Once the command
  // is already known to mutate, every literal absolute reference is safer to
  // treat as scoped input than to let a destination disappear from analysis.
  for (const match of command.matchAll(/(?:^|[\s'"(=,])((?:\/(?!\/))[^\s'";&|,)\]]+)/gm)) {
    const start = match.index + match[0].lastIndexOf(match[1]);
    if (executableRanges.some(([from, to]) => start >= from && start < to)) continue;
    targets.push(match[1]);
  }
  return [...new Set(targets)].filter((target) => target && target !== "/dev/null");
}

function targetEscapes(target, workspace, inspection) {
  const absolute = isAbsolute(target) ? resolve(target) : resolve(workspace, target);
  if (!within(workspace, absolute)) return true;
  if (!inspection?.canonicalTarget || !inspection?.contains) return false;
  const canonical = inspection.canonicalTarget(absolute);
  return !canonical || !inspection.contains(canonical, workspace);
}

function obviousWorkspaceEscape(command, workspace, inspection = null) {
  if (/(?:^|[\s'"=])\.\.(?:\/|$)/.test(command)) return true;
  // A second popd can return to the checkout that preceded the required
  // workspace anchor. Its resulting cwd cannot be proven from the command.
  if (/\bpopd\b/.test(command)) return true;
  return filesystemMutationTargets(command)
    .some((target) => targetEscapes(target, workspace, inspection));
}

const INTERPRETER = /\b(?:python(?:3(?:\.\d+)?)?|node|ruby|perl)\b/i;
const INTERPRETER_WRITE = /(?:\bopen\s*\([^\n)]*,\s*['"][wax+]|\.write(?:_text|_bytes)?\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|renameSync|rmSync|unlinkSync|mkdirSync|copyFileSync)\s*\()/i;
const FORMATTER_WRITE = /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:(?:npx|pnpm\s+(?:exec|dlx)|yarn\s+dlx|bunx)\s+)?(?:prettier\b[^\n;&|]*\s--write\b|eslint\b[^\n;&|]*\s--fix\b|ruff\b[^\n;&|]*\s(?:format|check\b[^\n;&|]*\s--fix\b)|black\b|gofmt\b[^\n;&|]*\s-w\b|cargo\s+fmt\b)/m;
const MUTATING_WORD = /(?:^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:[^\s;&|()]+\/)*(rm|mv|cp|ln|install|mkdir|rmdir|touch|truncate|tee|chmod|chown|patch|git\s+(?:add|tag|commit|push|merge|rebase|checkout|switch|restore|reset|clean|apply|rm|mv|cherry-pick|revert|stash|am|pull|worktree|submodule)|npm\s+(?:install|publish|run|exec)|npx|pnpm\s+(?:install|publish|run|exec|dlx)|yarn\s+(?:add|install|publish|run|dlx)|bun\s+(?:install|run)|bunx|sh\s+\S+|bash\s+\S+|zsh\s+\S+)\b/gm;
const IN_PLACE_EDIT = /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:sed|perl|ruby)\s+(?:-\S+\s+)*-\S*i/m;
const REDIRECT = /(?:^|[^<])(?:>>?|2>>?)\s*(?!&)(?!\/dev\/null(?:[\s;&|)]|$))\S/m;

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

export function shellMutationViolation(phase, environment, command = null, inspection = null) {
  if (command !== null && !looksMutatingShellCommand(command)) return null;
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
    if (command !== null && obviousWorkspaceEscape(String(command), workspace, inspection))
      return "Build shell mutation contains an obvious path outside the isolated workspace";
  }
  return null;
}
