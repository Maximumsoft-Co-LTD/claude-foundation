// Agents slide: pick an agent, see what it owns.

const AGENTS = {
  orchestrator: {
    phases: "drives all 1 → 10",
    body: "Drives the flow. Never substantive work itself — spawns specialists, manages cycle budgets, updates state.json, decides whether security review fires.",
    reads: "INDEX · FOLLOWUPS · state.json",
    writes: "INDEX status · state.json",
  },
  pm: {
    phases: "phase 1 · interview + spec",
    body: "Runs the AskUserQuestion interview (mandatory, ≤4 questions in one batch). Reads FOLLOWUPS first to surface carry-overs. Writes spec.md from a template — never freeform.",
    reads: "intent · FOLLOWUPS",
    writes: "spec.md",
  },
  lead: {
    phases: "2 · plan  ·  5 · review  ·  6 · security",
    body: "Wears three hats. Plan mode reverse-engineers the codebase and writes plan.md. Review mode is checklist-driven (no vibes). Security mode runs an inline checklist when the trigger fires.",
    reads: "spec.md · codebase · diff",
    writes: "plan.md · review.md · security.md",
  },
  engineer: {
    phases: "4 · implement  ·  8 · docs  ·  9 · ship",
    body: "Executes plan.md step by step using TaskCreate. For fix runs, the first task is the failing regression test as its own commit. Stages, commits, opens the PR if the gate opted in.",
    reads: "plan.md · spec.md · diff",
    writes: "source · commit · PR",
  },
  qa: {
    phases: "phase 7 · tests",
    body: "Writes and runs unit + integration + e2e. Records in tests.md. For fix: verifies regression test fails on pre-fix code, passes now. Stub-skips for chore / docs / spike.",
    reads: "plan.md · spec.md · source",
    writes: "tests · tests.md",
  },
  retro: {
    phases: "phase 10 · reflect",
    body: "Reads everything: plan, review, security, tests, diff, commit. Writes retro.md. Appends new follow-ups to FOLLOWUPS.md. Surfaces memory + skill candidates for user confirmation.",
    reads: "all artifacts · FOLLOWUPS",
    writes: "retro.md · FOLLOWUPS append",
  },
};

export function initAgents() {
  const $tiles = document.querySelectorAll(".agent");
  const $name = document.getElementById("agent-card-name");
  const $phases = document.getElementById("agent-card-phases");
  const $body = document.getElementById("agent-card-body");
  const $reads = document.getElementById("agent-card-reads");
  const $writes = document.getElementById("agent-card-writes");

  function render(key) {
    const a = AGENTS[key];
    if (!a) return;
    $name.textContent = key;
    $phases.textContent = a.phases;
    $body.textContent = a.body;
    $reads.textContent = a.reads;
    $writes.textContent = a.writes;

    $tiles.forEach((t) => t.classList.toggle("is-active", t.dataset.agent === key));
  }

  $tiles.forEach((tile) => {
    tile.addEventListener("click", () => render(tile.dataset.agent));
    tile.addEventListener("mouseenter", () => render(tile.dataset.agent));
  });

  render("orchestrator");
}
