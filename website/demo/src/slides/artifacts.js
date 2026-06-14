// Artifacts slide: click a file in the tree, see its owner + purpose.

const ARTIFACTS = {
  state: {
    name: "state.json",
    owner: "orchestrator",
    body: "The per-run resume cursor. Records phase, step, next_step, cycle counters, last agent, last_updated timestamp. /dev --resume <id> reads this back when a session dies mid-run.",
  },
  spec: {
    name: "spec.md",
    owner: "pm",
    body: "Outcome (before → after → benefit), users, scope, non-goals, constraints, acceptance criteria, Type. For fix: a Reproduction section. For spike: a Timebox. The interview output, never invented.",
  },
  plan: {
    name: "plan.md",
    owner: "lead · plan mode",
    body: "Step-by-step plan with path#anchor references and rollback notes — plus a Scaffold skeleton (file tree + key signatures and type shapes) for M/L, signed off at the gate before the long build. For fix runs, step 1 is the failing regression test. For refactor, includes a behavior-equivalence note. For spike, an exploration outline.",
  },
  review: {
    name: "review.md",
    owner: "lead · review mode",
    body: "Plan-adherence check + acceptance verification against spec.md. Checklist-driven: one row per plan step, one per acceptance criterion. 'Looks good overall' is banned.",
  },
  security: {
    name: "security.md",
    owner: "lead · security mode",
    body: "Only written when the diff trips the sensitive-paths trigger (auth, crypto, SQL, exec, secrets, etc.). High severity is blocking. Medium and below carry into retro.md.",
  },
  tests: {
    name: "tests.md",
    owner: "qa",
    body: "Test plan, results, acceptance-criteria mapping. For fix: notes the regression test failed on pre-fix code. For chore / docs / spike: a one-line stub explaining the skip.",
  },
  retro: {
    name: "retro.md",
    owner: "retro",
    body: "What worked, what to change, commit hash + PR URL. Surfaces memory candidates (facts) and skill candidates (procedures). Appends any new carry-overs to FOLLOWUPS.md.",
  },
};

export function initArtifacts() {
  const $links = document.querySelectorAll(".art-link");
  const $name = document.getElementById("art-card-name");
  const $owner = document.getElementById("art-card-owner");
  const $body = document.getElementById("art-card-body");

  function render(key) {
    const a = ARTIFACTS[key];
    if (!a) return;
    $name.textContent = a.name;
    $owner.textContent = `owner · ${a.owner}`;
    $body.textContent = a.body;
    $links.forEach((l) => l.classList.toggle("is-active", l.dataset.art === key));
  }

  $links.forEach((link) => {
    link.addEventListener("click", () => render(link.dataset.art));
    link.addEventListener("mouseenter", () => render(link.dataset.art));
  });

  render("spec");
}
