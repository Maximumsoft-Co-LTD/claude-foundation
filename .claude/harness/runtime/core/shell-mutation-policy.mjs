import { isAbsolute, relative, resolve } from "node:path";

// One shell-word grammar for every operand the policy reads: a double-quoted
// word with backslash escapes, a single-quoted word with POSIX `'\''` joins,
// or a bare word. The anchor screen and the escape screen must judge the same
// literal the same way, so there is exactly one unquoter.
const QUOTED_WORD = String.raw`"(?:\\.|[^"\\])*"|'(?:'\\''|[^'])*'`;
const SAFE_ARGUMENT = /^[A-Za-z0-9_./:@%+=,-]+$/;

function shellUnquote(value) {
  const text = String(value || "");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"'))
    return text.slice(1, -1).replace(/\\(.)/g, "$1");
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1).replaceAll("'\\''", "'");
  return text;
}

// Quote a path the way a shell must receive it. Shared with `exec` so a
// refusal's suggested prefix is exactly what the runtime itself would emit.
export function shellDisplayArgument(value) {
  const text = String(value);
  return SAFE_ARGUMENT.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function hintPath(workspace, suffix) {
  const text = `${workspace}${suffix}`;
  return SAFE_ARGUMENT.test(workspace) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function within(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function sameDirectory(left, right) {
  return resolve(left) === resolve(right);
}

// The command's first word must change directory. `;` is accepted only for
// the workspace root, which the harness guarantees exists: below the root the
// directory may be missing, and `;` would then run the mutation in whatever
// cwd the shell inherited, so those anchors require `&&`.
const ANCHOR = new RegExp(`^\\s*((?:cd|pushd)\\s+(?:${QUOTED_WORD}|[^\\s;&|]+))\\s*(&&|;)`);

function shellAnchor(command) {
  const match = ANCHOR.exec(command);
  if (!match) return null;
  const word = match[1];
  const target = shellUnquote(word.replace(/^(?:cd|pushd)\s+/, ""));
  return { word, target, separator: match[2] };
}

function shellWords(value) {
  return String(value).match(new RegExp(`${QUOTED_WORD}|[^\\s]+`, "g")) || [];
}

function unquote(value) {
  return shellUnquote(String(value || "").replace(/^[({]+|[)},]+$/g, ""));
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

const DIRECTORY_CHANGE = new RegExp(`(?:^|[;&|()]|\\b(?:then|do)\\b)\\s*(?:cd|pushd)\\s+(${QUOTED_WORD}|[^\\s;&|]+)`, "gmi");
const REDIRECT_TARGET = new RegExp(`(?:>>?|\\btee\\b(?:\\s+-\\S+)*)\\s+(${QUOTED_WORD}|[^\\s;&|]+)`, "gmi");
// A quoted absolute path is one operand, spaces included; reading only its
// first segment reported `/my` for `"/my ws"` and refused the workspace itself.
const LITERAL_ABSOLUTE = new RegExp(String.raw`"(\/(?:\\.|[^"\\])*)"|'(\/(?:'\\''|[^'])*)'|(?:^|[\s'"(=,])((?:\/(?!\/))[^\s'";&|,)\]]+)`, "gm");

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
  for (const match of command.matchAll(DIRECTORY_CHANGE)) targets.push(unquote(match[1]));
  for (const match of command.matchAll(REDIRECT_TARGET)) targets.push(unquote(match[1]));
  // Interpreter and option-value writes do not necessarily expose a standalone
  // shell operand (`writeFile('/tmp/x')`, `--output=/tmp/x`). Once the command
  // is already known to mutate, every literal absolute reference is safer to
  // treat as scoped input than to let a destination disappear from analysis.
  for (const match of command.matchAll(LITERAL_ABSOLUTE)) {
    const raw = match[1] ?? match[2] ?? match[3];
    const start = match.index + match[0].indexOf(raw);
    if (executableRanges.some(([from, to]) => start >= from && start < to)) continue;
    targets.push(match[1] !== undefined ? shellUnquote(`"${raw}"`)
      : match[2] !== undefined ? shellUnquote(`'${raw}'`) : raw);
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

// Returns the first fragment that leaves the workspace, or null. Naming it is
// what lets an agent repair the command instead of retrying it unchanged.
function obviousWorkspaceEscape(command, workspace, inspection = null) {
  const parent = /(?:^|[\s'"=])(\.\.(?:\/[^\s'";&|]*|$))/.exec(command);
  if (parent) return parent[1];
  // A second popd can return to the checkout that preceded the required
  // workspace anchor. Its resulting cwd cannot be proven from the command.
  if (/\bpopd\b/.test(command)) return "popd";
  return filesystemMutationTargets(command)
    .find((target) => targetEscapes(target, workspace, inspection)) ?? null;
}

// A `$name` after `/` is a path segment (`/workspace/$X`), not a quoted argument
// such as `-m "$MSG"`; only the former can move a mutation target.
const DYNAMIC_TOKEN = /\$\(|`|\$\{[^}\s]*\}?|(?<=^|[\s=/])\$[A-Za-z_][A-Za-z0-9_]*|(?<=^|[\s=])~(?=\/|\s|$)/g;
// Exit-status expansions produce integers, never paths. A Build check that
// reports `${PIPESTATUS[0]}` after a piped test run is the ordinary shape of
// verification and must not read as an unprovable mutation target. The
// subscript is limited to literal forms because bash evaluates it, so
// `${PIPESTATUS[$(…)]}` would run the substitution.
const STATUS_EXPANSION = /^\$(?:\{(?:PIPESTATUS|pipestatus)(?:\[(?:\d+|@|\*)\])?\}|(?:PIPESTATUS|pipestatus))$/;

function dynamicPathToken(command) {
  for (const match of command.matchAll(DYNAMIC_TOKEN)) {
    const token = match[0];
    if (STATUS_EXPANSION.test(token)) continue;
    if (token === "$(") return "$(…)";
    if (token === "`") return "`…`";
    return token;
  }
  return null;
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
  // Quoted text is opaque to the word screens, but it is still an operand:
  // erasing it entirely made `> "/etc/x"` read as a redirect with no target.
  const stripped = value.replace(/(['"])(?:\\.|(?!\1).)*\1/g, " _ ");
  const operations = [];
  if (INTERPRETER.test(value) && INTERPRETER_WRITE.test(value))
    operations.push("interpreter write");
  if (FORMATTER_WRITE.test(stripped)) operations.push("formatter write");
  // A script runner is named by the runner, not by whichever script it ran.
  for (const match of stripped.matchAll(MUTATING_WORD))
    operations.push(match[1].replace(/\s+/g, " ").toLowerCase().replace(/^(sh|bash|zsh) .*$/, "$1"));
  if (IN_PLACE_EDIT.test(stripped)) operations.push("in-place edit");
  if (REDIRECT.test(stripped)) operations.push("redirect");
  return [...new Set(operations)];
}

export function looksMutatingShellCommand(command) {
  return mutatingShellOperations(command).length > 0;
}

export function shellMutationViolation(phase, environment, command = null, inspection = null) {
  const operations = command === null ? null : mutatingShellOperations(command);
  if (operations !== null && operations.length === 0) return null;
  if (phase === "prove" || phase === "change")
    return `${phase === "prove" ? "Prove" : "Change"} cannot run mutating shell commands`;
  if (phase === "land" && environment.FOUNDATION_LAND_TRANSACTION !== "1")
    return "Land shell mutations require the runtime transaction marker";
  if (phase === "build") {
    const workspace = environment.FOUNDATION_WORKSPACE_ROOT;
    if (!workspace) return "Build shell mutations require an isolated workspace";
    if (command === null) return null;
    // Every refusal below carries its own repair: the refused operation, the
    // exact workspace, and the shape the command must take. A bare rule name
    // sent agents into unchanged retries.
    const text = String(command);
    const root = shellDisplayArgument(workspace);
    const anchor = shellAnchor(text);
    const dynamic = anchor ? dynamicPathToken(anchor.target) : null;
    if (dynamic === null && (!anchor || !isAbsolute(anchor.target) ||
        !within(workspace, anchor.target)))
      return "Build shell mutations must start inside the isolated workspace " +
        `(refused: ${operations.join(", ")}); ` +
        `start the command with \`cd ${root} && \` or \`cd ${hintPath(workspace, "/<subdir>")} && \``;
    if (dynamic === null && anchor.separator === ";" && !sameDirectory(workspace, anchor.target))
      return "Build shell mutations must start inside the isolated workspace " +
        `(\`${anchor.word};\` continues even when the directory change fails); ` +
        `start the command with \`cd ${shellDisplayArgument(anchor.target)} && \``;
    const dynamicToken = dynamic ?? dynamicPathToken(text);
    if (dynamicToken !== null)
      return "Build shell mutation contains a dynamic path that cannot be proven isolated " +
        `(\`${dynamicToken}\`); use literal paths inside ${root}`;
    const escape = obviousWorkspaceEscape(text, workspace, inspection);
    if (escape !== null)
      return "Build shell mutation contains an obvious path outside the isolated workspace " +
        `(\`${escape}\`); keep every mutation target inside ${root}`;
  }
  return null;
}
