# Refactoring catalog — moves and mechanics

Named moves have a tested sequence of micro-steps that never leaves the code
red. Prefer a named move over a freehand edit, and the IDE/LSP automated version
when one exists. Run the focused check after every move; if it fails, undo only
that move and keep the rest. All edits stay in returned Build paths; the harness
owns verified task status and proof, and this catalog grants no staging,
commits, branches, or Land.

| Move | Use when | Mechanics / safety check |
|---|---|---|
| Extract Function | A block needs a comment; a fragment repeats; a function is long | New function named for intent; reads → parameters, writes → return (more than one write: extract smaller); replace fragment with a call; test |
| Inline Function | Body is as clear as the name; indirection earns nothing | Confirm not polymorphic; replace each call with the body, testing per call site; delete |
| Extract / Inline Variable | A sub-expression needs a name, or a name adds nothing | Immutable local; replace occurrences one at a time; test |
| Replace Temp with Query | A long method full of temps, before Extract Function | Temp → function so extracted code threads fewer locals |
| Split Phase | "Compute then act" entangled in one function | Sequential phases with an explicit intermediate structure; each phase testable alone |
| Move Function / Field | Feature Envy; behavior scattered across modules | Copy to target, adapt, make the source delegate, redirect callers, test, delete original |
| Extract Class | Large Class, Divergent Change, Data Clump or Temporary Field | New class; move fields, then the methods using them, innermost first; test throughout |
| Inline Class | A class no longer pulls its weight | Fold into its main user |
| Introduce Parameter Object | Long Parameter List, Data Clumps (`startDate, endDate` → `DateRange`) | The new type becomes a home for related behavior |
| Replace Primitive with Object | A primitive carrying rules (`string` email → `Email`, cents → `Money`) | Constructor enforces the invariant once |
| Replace Magic Literal | Bare `0.1`, `"ADMIN"`, `86400` | Named constant |
| Decompose Conditional | A condition and its branches hide intent | Extract condition, then-branch, else-branch into named functions |
| Guard Clauses | Arrow-shaped code; real work three indents deep | Early returns for exceptional cases; main path un-indented |
| Replace Conditional with Polymorphism | Repeated switch on a type code | Extract the switch; create subclass/strategy; move **one** branch per verified step; make base abstract last |
| Introduce Special Case / Null Object | The same null/absent check in many callers | One object answering the same messages sensibly |
| Rename | The name lies, hedges, or abbreviates | LSP rename across all references |
| Separate Query from Modifier | A "get" that also mutates | Pure query plus explicit command |
| Parameterize / Remove Flag Argument | Near-identical functions, or `setReadOnly(true/false)` | Merge with a parameter, or split into two intention-named functions |

If a step cannot be made small and safe, a precursor is missing — usually a
characterization test or a seam. Add it first.

Which smell calls for which move: [code-smells](code-smells.md). Covering
legacy code before moving it: [characterization tests](characterization-tests.md).
Sequencing many moves without a long-lived branch: [large-scale](large-scale.md).
