// Security slide: click a changed path, see whether the trigger fires.

const REASONS = {
  "src/auth/session.ts": "matches: auth / session / token",
  "src/db/queryBuilder.ts": "matches: SQL / query building",
  "src/lib/crypto.ts": "matches: crypto primitives",
  "scripts/exec.sh": "matches: exec / shell calls",
};

export function initSecurity() {
  const $paths = document.querySelectorAll(".sec-path");
  const $state = document.getElementById("sec-state");
  const $detail = document.getElementById("sec-detail");

  $paths.forEach((p) => {
    p.addEventListener("click", () => {
      $paths.forEach((x) => x.classList.remove("is-active"));
      p.classList.add("is-active");

      const path = p.textContent.trim();
      const fires = p.dataset.trigger === "true";

      if (fires) {
        $state.className = "sec-state fire";
        $state.textContent = `▲ security review FIRES · ${REASONS[path] || "sensitive path"}`;
        $detail.innerHTML = `<code>${path}</code> matched the sensitive-paths list. Orchestrator spawns <code>lead</code> in security mode against the diff. High-severity findings are blocking and count against the review cycle budget.`;
      } else {
        $state.className = "sec-state skip";
        $state.textContent = "✓ no trigger · phase 7 recorded as skipped";
        $detail.innerHTML = `<code>${path}</code> doesn't match any sensitive path. <code>state.security_triggered = false</code>. Orchestrator advances past the security review (phase 7) to docs.`;
      }
    });
  });
}
