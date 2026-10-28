# Code smells — symptom, cost, move

A smell is a surface symptom that usually points at a structural cost. It is not
a bug and not automatically wrong: name the smell, confirm it is costing you
(frequent edits, repeated bugs, slow comprehension), then apply the mapped move in
small green steps. Mechanics live in [catalog](catalog.md).

| Smell | What it looks like | Why it costs | Move |
|---|---|---|---|
| Long Function | Scrolling to read; comment-delimited sections | Hides several jobs; hard to name and test | Extract Function, Replace Temp with Query, Decompose Conditional, Split Phase |
| Large Class / God Object | Dozens of fields and methods, several jobs | Every change risks unrelated behavior | Extract Class, extract a strategy |
| Long Parameter List | Four or more parameters; boolean selectors | Unreadable, easy to misorder | Introduce Parameter Object, split flag-driven functions |
| Data Clumps | The same three fields travel together | A missing concept | Introduce Parameter Object / Extract Class |
| Primitive Obsession | Strings and ints standing in for concepts with rules | Validation scattered; illegal values representable | Replace Primitive with Object |
| Switch / Type-Code Statements | The same switch on a type field in several places | Every new case means a hunt | Replace Conditional with Polymorphism, Special Case |
| Temporary Field | A field set only sometimes, null otherwise | Readers cannot tell when it is valid | Extract Class, Special Case |
| Refused Bequest | Subclass ignores or throws on inherited behavior | The hierarchy is wrong | Move members down to the subclasses that use them, Replace Subclass with Delegate, composition |
| Divergent Change | One module changes for many unrelated reasons | Low cohesion | Extract Class per reason to change |
| Shotgun Surgery | One logical change touches many files | High coupling; easy to miss a spot | Move Function/Field to gather the behavior |
| Parallel Inheritance | Adding to one hierarchy forces adding to another | Shotgun Surgery in disguise | Collapse by moving one hierarchy's reference into the other |
| Duplicated Code | Same expression or structure in several places | Fixes applied N times, one missed | Extract Function, Pull Up Method; Rule of Three |
| Dead Code | Unreachable code, unused parameters | Readers assume it matters | Delete it |
| Speculative Generality | Hooks and interfaces nobody uses | Carrying cost, no payoff | Inline the abstraction, Collapse Hierarchy, Remove Parameter |
| Comments as deodorant | A comment explaining *what* a block does | Masks unclear code | Extract Function with an intention-revealing name (keep *why* comments) |
| Lazy Element | A class or function doing too little to exist | Indirection without benefit | Inline Function / Inline Class |
| Feature Envy | A method reaching through another object's data | Logic lives away from its data | Move Function to the data owner |
| Inappropriate Intimacy | Two classes deep in each other's internals | Cannot change one without the other | Move Function/Field, one-directional reference, Extract Class |
| Message Chains | `a.getB().getC().doThing()` | Caller coupled to the whole navigation | Hide Delegate, Extract Function |
| Middle Man | A class that only forwards | Useless indirection | Remove Middle Man, Inline Function |

## Refactor with a purpose

Name the trigger first: which smell, or which upcoming change does this make
easy? "It felt messy" is not a trigger; "every new payment type edits six files"
is. Preparatory refactoring — restructure to the shape that makes the change
trivial, then add the behavior as its own slice — beats forcing a feature onto an
awkward design. Tolerate duplication twice; the third occurrence earns the
extraction.

## When not to refactor

- The code is scheduled for deletion, or is stable and rarely touched: refactor
  what costs you weekly, not what merely offends you.
- No safety net and a hard deadline: build the minimum characterization net
  around the change point, make the change, record the debt.
- You are estimating effort across a batch of changes rather than making
  mechanical green-to-green moves: that is a rewrite, which discards hard-won
  correctness. Default to incremental sequencing ([large-scale](large-scale.md)).

A smell that signals a missing concept (Data Clumps, Primitive Obsession) is a
data-modeling fix; `programming-fundamentals` says what the better shape is.
Harness receipts, not a tidier diff, prove behavior stayed the same.
