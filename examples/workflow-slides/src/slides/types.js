// Types slide: interactive type matrix.
// Cells: "run" (green), "skip" (dim), "trigger" (amber), "light" (blue).

const PHASES = [
  { n: 1, label: "interview" },
  { n: 2, label: "plan" },
  { n: 3, label: "gate" },
  { n: 4, label: "implement" },
  { n: 5, label: "review" },
  { n: 6, label: "security" },
  { n: 7, label: "test" },
  { n: 8, label: "docs" },
  { n: 9, label: "ship" },
  { n: 10, label: "retro" },
];

// For each type, define per-phase state.
// run = always runs, skip = always skips, trigger = conditional, light = thinner pass.
const MATRIX = {
  feat: {
    states: ["run", "run", "run", "run", "run", "trigger", "run", "run", "run", "run"],
    note: "New capability. Full flow. Security review fires only when the diff touches sensitive paths.",
  },
  fix: {
    states: ["run", "run", "run", "run", "run", "trigger", "run", "run", "run", "run"],
    note: "Step 1 of implement is a failing regression test. Test phase verifies it fails on pre-fix code, passes now.",
  },
  refactor: {
    states: ["run", "run", "run", "run", "run", "trigger", "run", "run", "run", "run"],
    note: "Plan includes a behavior-equivalence note. QA runs the existing suite and adds tests only for uncovered behaviour.",
  },
  chore: {
    states: ["run", "run", "run", "run", "run", "trigger", "skip", "run", "run", "run"],
    note: "Test phase skipped. Docs touch-up still happens if relevant. Security still trigger-based.",
  },
  docs: {
    states: ["run", "run", "run", "run", "run", "trigger", "skip", "run", "run", "run"],
    note: "Documentation work. No test phase. Docs phase 8 is the main payload, not a touch-up.",
  },
  spike: {
    states: ["run", "run", "run", "run", "light", "skip", "skip", "skip", "skip", "run"],
    note: "Timeboxed exploration. Review is a light pass. Recommendations.md replaces test + ship. Commit only if user opts in.",
  },
};

const MARKS = {
  run: "✓",
  skip: "—",
  trigger: "?",
  light: "·",
};

export function initTypes() {
  const $matrix = document.getElementById("type-matrix");
  const $note = document.getElementById("type-note");
  const $tabs = document.querySelectorAll(".type-tab");
  if (!$matrix) return;

  function render(type) {
    const data = MATRIX[type];
    $matrix.innerHTML = "";
    PHASES.forEach((p, i) => {
      const state = data.states[i];
      const cell = document.createElement("div");
      cell.className = `matrix-cell ${state}`;
      cell.innerHTML = `
        <span class="mc-num">${p.n}</span>
        <span class="mc-mark">${MARKS[state]}</span>
        <span class="mc-label">${p.label}</span>
      `;
      $matrix.appendChild(cell);
    });
    $note.textContent = data.note;
  }

  $tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      $tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      render(tab.dataset.type);
    });
  });

  render("feat");
}
