# Security review: Fanout default-on at safe parallel points

**Plan**: [./plan.md](./plan.md)
**Reviewed**: 2026-05-23
**Trigger**: `exec/shell` — path match on `.claude/hooks/dev-state-mark.sh` (sensitive-paths bucket: bash script under `.claude/hooks/`)
**Verdict**: pass

## Threat model (one paragraph)

The hook `.claude/hooks/dev-state-mark.sh` runs as a Claude Code PostToolUse handler on every `Agent` tool invocation. It (a) reads the tool-call JSON from stdin via `jq`, (b) gates on `tool_name == "Agent"` and `subagent_type ∈ {pm,lead,engineer,qa,retro}`, (c) `touch`es a marker file in the most-recently-modified `.workflow/<id>/` directory, and (d) emits an `additionalContext` reminder back to the orchestrator (the main agent) via a `jq -n` JSON payload. The trust boundary the hook crosses is *local-machine-only*: stdin is structured JSON produced by Claude Code itself, file paths are derived from `$CLAUDE_PROJECT_DIR` or `$PWD` (both environment-controlled by the local user, not an attacker), and the only output is JSON consumed by Claude Code's hook protocol. There is no network call, no privilege boundary, no externally-controlled input. An attacker would need to either (1) already have code-exec on the developer's machine (game already over), or (2) plant a malicious `.workflow/<id>/state.json` to influence the reminder's `${cur_phase}` / `${cur_step}` interpolations — which would only be reflected back to the same trusted main agent that just spawned the hook. The diff under review is a one-character textual rephrase of a possessive ("`state.json`'s mtime" → "the mtime of `state.json`") inside the heredoc body that becomes `additionalContext`; it removes an unescaped apostrophe that was causing a bash parse error inside `$(cat <<EOF ... EOF)`, unbreaking the hook. No shell logic, no variable expansion set, no quoting structure, no `exec`/`eval`/dynamic-command, no file-path construction, and no JSON shape were touched.

## Checklist

Walk every applicable row. Mark ✓ / ✗ / N/A with a one-line note. Inline checklist — no separate skill needed.

### Input handling
- [N/A] All user input validated at the boundary, not deep inside — diff does not touch input handling; same `jq -r '.tool_input.subagent_type // ""'` and `tool_name` extraction as before (`.claude/hooks/dev-state-mark.sh:22-25`).
- [N/A] No string concatenation into SQL / shell / HTML / paths — diff changes only literal prose inside the heredoc body; no new concatenation site.
- [N/A] Parser/decoder choice safe for untrusted input — `jq` is the same parser before and after; the diff does not alter parsing.

### Authn / authz
- [N/A] Every new endpoint has an explicit authz check — no endpoint; hook is local-process only.
- [N/A] Session/token storage — no session/token surface in the diff.
- [N/A] No new "admin" code path skips the existing authz layer — no code paths added.

### Secrets + crypto
- [✓] No hard-coded secrets, API keys, or test credentials in the diff — confirmed: the only change is rephrasing "`state.json`'s mtime" → "the mtime of `state.json`" inside heredoc prose at `.claude/hooks/dev-state-mark.sh:70`.
- [N/A] No custom crypto — no crypto surface.
- [N/A] PRNG used for security purposes is a CSPRNG — no PRNG in the diff.

### Output / rendering
- [✓] Untrusted text escaped on the way out — the heredoc body is passed to `jq -n --arg ctx "$reminder" '{...}'` at `.claude/hooks/dev-state-mark.sh:74-79`; `jq --arg` is the canonical safe way to inject arbitrary text into a JSON output and is unchanged by this diff.
- [N/A] Redirect targets validated against an allowlist — no redirects.
- [N/A] Error messages don't leak stack traces / internal paths — hook fails soft (`exit 0` on every error path), unchanged.

### Infra-adjacent
- [✓] File path joins go through `path.join` / `filepath.Clean` and reject `..` — diff does not touch file-path logic; existing path construction (`$WF_DIR/*/state.json`, `dirname`, `basename`, `touch "$run_dir/.last_worker_return"`) at lines 41–52 is unchanged. `$CLAUDE_PROJECT_DIR` and `$PWD` are environment-controlled by the local user, not attacker-influenced.
- [N/A] New outbound network call has a timeout and a target allowlist — no network call introduced or modified.
- [✓] New process exec doesn't shell out with user input — no new `exec`; only `command -v jq`, `cat`, `printf`, `jq`, `touch`, `dirname`, `basename` are invoked, all with quoted arguments and no command-substitution changes from this diff.

### exec/shell bucket-specific (trigger reason)
- [✓] No new `eval` / `exec` / dynamic command-substitution — verified by `git diff`; only one line changed and it is inside a heredoc string literal that becomes the `--arg ctx` value to `jq -n`, not a command to execute.
- [✓] Heredoc body has no remaining unescaped apostrophes that could break parsing inside `$(cat <<EOF ... EOF)` — `awk 'NR>=59 && NR<=72' .claude/hooks/dev-state-mark.sh | grep "'"` returns no matches in the body (the heredoc still uses unquoted `EOF` so `${var}` expansion is preserved, which is the intended behaviour for `${subagent_type}`, `${run_id}`, `${cur_phase}`, `${cur_step}`).
- [✓] Bash syntax check passes post-fix — `bash -n .claude/hooks/dev-state-mark.sh` exits 0.
- [✓] Hook fails soft on bad input — smoke-tested with `printf '{"tool_name":"Agent","tool_input":{"subagent_type":"lead"}}' | CLAUDE_PROJECT_DIR=/tmp/no-such-dir bash .claude/hooks/dev-state-mark.sh` returns exit 0 (no `set -e` blow-up).
- [✓] Variable expansion set is unchanged — `${subagent_type}`, `${run_id}`, `${cur_phase:-?}`, `${cur_step:-?}` are the same four interpolations before and after the diff; all four are derived from local Claude Code state, not from an external boundary.
- [N/A] Markdown sibling files in the same commit (`.claude/agents/lead.md`, `.claude/agents/pm.md`, `.claude/orchestrator.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `WORKFLOW.md`) — none of these match a sensitive-paths bucket; they are agent-prompt / workflow prose and are out of scope for this Mode C review.

## Findings

### Blocking (severity = high)
None.

### Non-blocking (severity = medium / low)
None.

## Sign-off
pass — zero high-severity findings, zero medium/low findings. The diff is a one-character non-functional rephrase that fixes a pre-existing parse error in a heredoc body; it does not introduce attacker-reachable surface, does not alter the hook's input handling, variable-expansion set, command-substitution structure, file-path construction, or JSON output shape. `bash -n` passes; fail-soft smoke test passes; no apostrophes remain in the heredoc body.
