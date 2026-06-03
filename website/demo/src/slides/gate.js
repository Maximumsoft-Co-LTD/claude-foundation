// Gate slide: clicking the three buttons shows what each action does.

const RESPONSES = {
  approve: {
    cls: "",
    text: "✓ approved · INDEX status → approved · orchestrator advances to step 4 (implement)",
  },
  revise: {
    cls: "revise",
    text: "↺ revise · notes appended to spec.md > Open questions · loop back to step 1 (pm re-interviews)",
  },
  swap: {
    cls: "revise",
    text: "↔ swap · lead opens a different epic slice as the active run (epic-mode only)",
  },
};

export function initGate() {
  const $buttons = document.querySelectorAll(".gate-actions [data-gate]");
  const $result = document.getElementById("gate-result");

  $buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const choice = btn.dataset.gate;
      const r = RESPONSES[choice];
      $result.className = "gate-result " + r.cls;
      $result.textContent = r.text;
      $result.hidden = false;
    });
  });
}
