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
    phases: "4 · implement  ·  7½ · improve  ·  8 · docs  ·  9 · ship",
    body: "Executes plan.md step by step using TaskCreate. For fix runs, the first task is the failing regression test as its own commit. Improve mode (7½, brownfield feat/fix) is a bounded, behaviour-preserving cleanup of the touched code with the suite green — refactor and greenfield skip it. Stages, commits, opens the PR if the gate opted in.",
    reads: "plan.md · spec.md · diff",
    writes: "source · commit · PR",
  },
  qa: {
    phases: "phase 2½ · test plan + phase 7 · tests",
    body: "Phase 2½ (test-plan mode): writes test-plan.md before code — which level proves each AC, edge cases to probe, fixtures, regression/baseline contract — signed off at the gate. Phase 7 (execute mode): runs unit + integration + e2e against that plan, records tests.md with advisory diff-coverage floors (unit 80% / integration 70% / e2e 50% of critical journeys). For fix: verifies regression test fails on pre-fix code, passes now. Stub-skips for chore / docs / spike.",
    reads: "spec.md · plan.md · test-plan.md · source",
    writes: "test-plan.md · tests · tests.md",
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
