---
name: programming-fundamentals
description: Apply the code-level fundamentals — data modeling, illegal-state elimination, one-thing functions, pure core / effectful shell, error handling as values, complexity awareness, naming. Use BEFORE writing or modifying any function, module, or data structure with real logic, in any language — implement, refactor, model data, fix a non-trivial bug, review code. The trigger is non-trivial code work, even when no principle is named. Includes references on naming, error handling, complexity, and testing. Skip one-line shell, throwaway scripts, and pure config edits.
---

# Programming Fundamentals

## The 7 principles

1. **Model the data first.** Decide the shape of the data before the operations — if the data is wrong, the operations will be ugly forever. Sketch input/output types before writing the function; prefer the most constrained shape that holds what you have (`Set` not a de-duped `List`, a struct not `Map<String, Any>`); group fields that always travel together into one type. Most "complex logic" is an awkward data shape in disguise. Details + example: `references/details.md > 1. Model the data first`.

2. **Make illegal states unrepresentable.** Use types, enums, sum types, and smart constructors so wrong states can't even be written down. An app-level check gets forgotten or written five different ways; a type constraint enforces it once, everywhere. Typed wrapper instead of bare `String` when it has rules (`Email`, `UserId`); sum type instead of booleans that combine illegally (`Loading | Error(e) | Ready(data)`); split a nullable-but-conditional field into explicit states. Details + example: `references/details.md > 2. Make illegal states unrepresentable`.

3. **Functions do one thing, named for what they do.** One clear job, a name that states it — if you can't name it crisply without "and", it's doing too much. A name is a contract ("you don't have to read my body"); when it lies, every caller reads the body anyway. Query functions named for what they return (`activeUsers()`); command functions named for the action (`sendInvoice()`). A function that both returns data and mutates state is two functions sharing a body — split them. See [[naming]].

4. **Pure core, effectful shell.** Push I/O, time, randomness, network, and DB calls to the edges; keep the logic in the middle pure and testable — I/O kills both testability and composability. Pass time/randomness as arguments or injected ports ([[hexagonal-backend]]) instead of reading them ambiently. Sequence load → compute → write; don't interleave I/O with computation. Details + example: `references/details.md > 4. Pure core, effectful shell`.

5. **Errors are values; handle them where you have context.** Treat errors as first-class data; never silently swallow — a swallow lets the program continue in an unknown state, so you debug consequences, not causes. Expected failures (validation, not-found) belong in the return type (`Result`, `Either`, tagged union); bugs (invariant violations) should crash loudly. Handle at the layer that can actually recover (retry, fall back, ask the user); propagate everywhere else with context. System boundaries (HTTP handlers, CLI entry points, message consumers) must catch everything, log with context, and translate to the boundary's error model. See [[error-handling]].

6. **Mind complexity — know your Big O.** Know the time/space cost of the structures and loops you use; watch for accidentally-quadratic patterns — most performance disasters are an O(n) lookup inside an O(n) loop on data that grew from 10 in dev to 1M in prod. `list.includes`/`array.find` inside a loop over the same list is O(n²); build a `Set`/`Map` once and look up in O(1). Baseline costs: array append O(1) amortized, prepend O(n); hash map O(1) avg, tree map O(log n); sort O(n log n). Measure before optimizing, but don't choose O(n²) when O(n) is the same code length. See [[complexity]].

7. **Read before you write.** Read the surrounding code, the error message, and the actual failing function before writing or guessing — most fixes that fail address an imagined problem; reading first is free, rework is expensive. When debugging, read the full error message and stack trace first — most bugs name themselves in the first line (unknown-cause failures have their own procedure: `debug-fundamentals`). Before adding a utility, search for an existing one (LSP-first — `CLAUDE.md`) and match project convention. Before changing a function, read its callers — the contract is what they depend on, not the docstring. Details: `references/details.md > 7. Read before you write`.

## Pre-flight checklist

Before writing or substantially changing code, run through these in your head:

1. **Data:** what are the input and output types? Are they as constrained as the domain allows?
2. **Illegal states:** can a caller pass something that compiles but is semantically wrong? Can the type system stop them?
3. **One thing:** does each new function have a name you can say without "and"?
4. **Pure where possible:** are the I/O calls pushed to the edge, with pure logic in the middle?
5. **Errors:** does every failure path either recover here, propagate with context, or crash loudly? No silent swallows.
6. **Complexity:** any nested loops over the same collection? Any `O(n)` lookup inside an `O(n)` loop?
7. **Read first:** have I read the existing code, the error message, and the callers?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- One-line shell commands or trivial REPL exploration.
- Pure config edits with no logic (env vars, package versions, formatter rules).
- Throwaway scripts you will delete in the next hour.

For anything else — yes, even the "small" feature, even the "quick" fix — these fundamentals apply.

## Reference files

- `references/naming.md` — variables, functions, types, files, commit messages.
- `references/error-handling.md` — Result/Either patterns, exceptions vs return values, boundary handling.
- `references/complexity.md` — Big O cheat sheet, common accidentally-quadratic patterns, profiling first principles.
- `references/testing.md` — what to test, what not to test, fast tests vs slow tests, test-behavior-not-implementation.
- `references/details.md` — rule/why/example detail for principles 1, 2, 4, 7 (no topical file of their own).
