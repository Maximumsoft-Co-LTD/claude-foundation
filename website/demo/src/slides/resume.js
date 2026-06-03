// Resume slide: tick to advance one step; state.json updates in real time.

const SCRIPT = [
  { phase: "phase-1-requirements", step: "spec", next: "plan", agent: "pm" },
  { phase: "phase-1-requirements", step: "plan", next: "gate", agent: "lead" },
  { phase: "phase-1-requirements", step: "gate", next: "implement", agent: "orchestrator" },
  { phase: "phase-2-implementation", step: "implement", next: "review", agent: "engineer" },
  { phase: "phase-2-implementation", step: "review", next: "test", agent: "lead", cycle: "review" },
  { phase: "phase-2-implementation", step: "test", next: "docs", agent: "qa", cycle: "test" },
  { phase: "phase-2-implementation", step: "docs", next: "ship", agent: "engineer" },
  { phase: "phase-2-implementation", step: "ship", next: "retro", agent: "engineer" },
  { phase: "phase-2-implementation", step: "retro", next: "done", agent: "retro" },
  { phase: "done", step: "done", next: "—", agent: "orchestrator" },
];

export function initResume() {
  const $json = document.getElementById("state-json");
  const $tick = document.getElementById("resume-tick");
  const $reset = document.getElementById("resume-reset");

  let idx = 0;
  const cycles = { review: 0, test: 0 };

  function render() {
    const s = SCRIPT[idx];
    const ts = new Date().toISOString().replace(/\.\d+/, "");
    const obj = {
      id: "0001-feat-todolist-app",
      type: "feat",
      phase: s.phase,
      step: s.step,
      next_step: s.next,
      cycles: { review: cycles.review, test: cycles.test },
      last_agent: s.agent,
      last_updated: ts,
    };
    $json.textContent = JSON.stringify(obj, null, 2);
  }

  function reset() {
    idx = 0;
    cycles.review = 0;
    cycles.test = 0;
    render();
    $tick.disabled = false;
    $tick.textContent = "advance one step";
  }

  $tick.addEventListener("click", () => {
    if (idx >= SCRIPT.length - 1) {
      $tick.disabled = true;
      $tick.textContent = "run complete";
      return;
    }
    idx++;
    const s = SCRIPT[idx];
    if (s.cycle === "review") cycles.review++;
    if (s.cycle === "test") cycles.test++;
    render();
    if (idx === SCRIPT.length - 1) {
      $tick.textContent = "run complete";
      $tick.disabled = true;
    }
  });

  $reset.addEventListener("click", reset);

  render();
}
