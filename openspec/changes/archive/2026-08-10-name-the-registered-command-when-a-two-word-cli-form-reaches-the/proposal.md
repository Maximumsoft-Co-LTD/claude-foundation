# Change: name the registered command when a two-word CLI form reaches the runtime entrypoint

## Why

`foundation.mjs describe 'change new'` prints `usage: change new <intent>
[--rapid]`, and `foundation.mjs help` lists every command in that two-word
form. Running `foundation.mjs change new <intent>` then answers `runtime
command 'change' is not registered`.

Both halves are correct and together they are a dead end. The public two-word
name belongs to the `claude-foundation` CLI in `cli.sh`; this entrypoint
dispatches on the internal single token (`new`, `proof-run`). So the binary
documents a form it rejects, and the rejection names only the first word — a
word that was never meant to be a command on its own. The reader is told a
true thing that cannot be acted on, and the registry already holds everything
needed to say the useful one.

## What changes

- When an unregistered command plus its next word form a real public command
  name, the failure names the CLI that accepts that form and the internal token
  this entrypoint takes.
- The internal token is looked up in the registry rather than derived by rule,
  because both shapes exist: `proof run` is `proof-run`, `change new` is `new`.
- A genuinely unknown command still fails in one plain line, inventing nothing.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** the runtime entrypoint's command-registration failure
- **Security triggers:** none. The check still refuses to dispatch; only the
  message changes.

## Non-goals

- Accepting the two-word form at this entrypoint. `cli.sh` owns that mapping,
  and duplicating it here would create a second router to keep in step.
- Changing any command name, public or internal.
