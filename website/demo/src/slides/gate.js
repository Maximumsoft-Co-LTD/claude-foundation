// Gate slide: clicking the action buttons shows what each gate reply does.

const RESPONSES = {
  approve: {
    cls: "",
    text: "✓ approved · INDEX status → approved · orchestrator records the gate-confirmed phase plan and advances to step 4 (implement)",
  },
  revise: {
    cls: "revise",
    text: "↺ revise · targeted in-run edit of the affected spec / plan / test-plan section (pm spec-patch · lead plan-revise · qa test-plan-revise) — never a fresh restart",
  },
  skip: {
    cls: "revise",
    text: "⤳ skip 8 · flips a discretionary phase off (test · review · docs only) and records it in state.json > phase_plan — protected phases (interview · plan · gate · security check · retro) refuse a skip",
  },
  run: {
    cls: "revise",
    text: "⤺ run <n> · forces a discretionary phase back on — e.g. run 5 keeps the review that a chore/docs run skips at XS by default",
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
