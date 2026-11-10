# Review rules

These rules are **advisory**. Change Loop sends this file to the AI reviewer
as guidance for what to look for and how to report it. They never change
whether a review passes; Change Loop's review contract decides that.

Owner: <name or team who maintains these rules>

This project owns this file: edit it freely. Change Loop creates it only when
it is missing and never overwrites it. Keep it under 32 KiB; a larger file is
not sent to the reviewer. An empty file counts as absent. Editing this file
makes existing reviews stale, so the next Prove reviews again.

## Passes

Review in this order, against the change's agreement rather than personal
preference.

1. **Correctness.** Every promised behavior holds, including error, empty,
   boundary, and permission paths, not only the happy path.
2. **Tests and evidence.** Each behavior change has a test at the lowest level
   that would catch its failure. No check was weakened to make it pass.
3. **Security and secrets.** No secret, token, or personal data is logged,
   committed, or exposed. Untrusted input is validated.
4. **Compatibility and migrations.** Public APIs, stored data, and config keep
   working for existing users, or the change states the migration.
5. **Documentation.** User-facing docs and examples match the new behavior.

## Severity

| Severity | Meaning |
|---|---|
| blocker | Wrong behavior would ship, data could be lost, or a secret is exposed |
| major | A realistic scenario fails or a contract drifts |
| minor | Correct but harder to maintain or read |
| nit | Style or wording only |

Report at most 3 nits per review. Name the file, line, and a concrete failure
scenario for every blocker and major finding.

## Exclusions

Do not review or request changes to:

- generated files and build output;
- lockfiles;
- vendored or third-party code;
- <add project-specific exclusions>.
