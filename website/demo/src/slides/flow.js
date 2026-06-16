// Flow slide: animated simulation of a `feat` run with one review cycle.

const SCRIPT = [
  { step: 1, log: "pm · interview → spec.md written", cls: "accent" },
  { step: 2, log: "lead (plan) · 10 steps + rollback noted", cls: "accent" },
  { step: 2, log: "qa (test-plan) · coverage plan per AC → test-plan.md", cls: "accent" },
  { step: 3, log: "orchestrator · gate · spec + plan + test plan · awaiting user", cls: "warn" },
  { step: 3, log: "user → approve", cls: "success" },
  { step: 4, log: "engineer · scaffolding Vite + React + TS", cls: "accent" },
  { step: 4, log: "engineer · acceptance criteria ticked", cls: "success" },
  { step: 5, log: "lead (review) · 1 finding · cycles.review = 1", cls: "warn", cycle: "review" },
  { step: 4, log: "engineer · addressing finding", cls: "accent" },
  { step: 5, log: "lead (review) · clean", cls: "success" },
  { step: 6, log: "orchestrator · no sensitive paths → skip", cls: "muted", skip: 6 },
  { step: 7, log: "qa · 14 tests, all pass · cycles.test = 1", cls: "success", cycle: "test" },
  { step: 7.5, log: "orchestrator · greenfield feat → improve skipped", cls: "muted", skip: 7.5 },
  { step: 8, log: "engineer (docs) · README updated", cls: "accent" },
  { step: 9, log: "engineer (ship) · commit 8a3f2c1 · PR #42 opened", cls: "success" },
  { step: 10, log: "retro · 1 skill candidate · react-vite-bootstrap", cls: "success" },
  { step: 10, log: "done · all artifacts written", cls: "success" },
];

export function initFlow() {
  const $strip = document.getElementById("flow-strip");
  const $log = document.getElementById("flow-log");
  const $play = document.getElementById("flow-play");
  const $reset = document.getElementById("flow-reset");
  const $cycleReview = document.getElementById("cycle-review");
  const $cycleTest = document.getElementById("cycle-test");

  let timer = null;
  let i = 0;
  let running = false;
  const cycles = { review: 0, test: 0 };

  const steps = Array.from($strip.querySelectorAll(".flow-step"));

  function reset() {
    if (timer) clearTimeout(timer);
    running = false;
    i = 0;
    cycles.review = 0;
    cycles.test = 0;
    $cycleReview.textContent = "0";
    $cycleTest.textContent = "0";
    steps.forEach((s) => s.classList.remove("active", "done", "skipped"));
    $log.innerHTML = '<div class="log-line muted">› idle · press play to start</div>';
    $play.textContent = "play";
  }

  function step() {
    if (i >= SCRIPT.length) {
      running = false;
      $play.textContent = "play again";
      $play.disabled = false;
      return;
    }
    const ev = SCRIPT[i++];

    // Mark "done" on any step number less than current
    steps.forEach((s) => {
      const n = parseFloat(s.dataset.step);
      s.classList.remove("active");
      if (n < ev.step) {
        if (!s.classList.contains("skipped")) s.classList.add("done");
      }
    });

    // Skipped step?
    if (ev.skip) {
      const sk = steps.find((s) => parseFloat(s.dataset.step) === ev.skip);
      if (sk) sk.classList.add("skipped");
    }

    // Active step
    const cur = steps.find((s) => parseFloat(s.dataset.step) === ev.step);
    if (cur) {
      cur.classList.remove("done", "skipped");
      cur.classList.add("active");
    }

    // Cycle bump
    if (ev.cycle === "review") {
      cycles.review++;
      $cycleReview.textContent = String(cycles.review);
    } else if (ev.cycle === "test") {
      cycles.test++;
      $cycleTest.textContent = String(cycles.test);
    }

    // Log line
    const line = document.createElement("div");
    line.className = `log-line ${ev.cls || ""}`;
    line.textContent = `[${ev.step === 7.5 ? "7½" : pad2(ev.step)}] ${ev.log}`;
    $log.appendChild(line);
    $log.scrollTop = $log.scrollHeight;

    // Keep log tidy
    while ($log.children.length > 8) $log.removeChild($log.firstChild);

    timer = setTimeout(step, ev.cls === "warn" ? 1100 : 850);
  }

  function play() {
    if (running) return;
    if (i >= SCRIPT.length) reset();
    running = true;
    $play.textContent = "running…";
    $play.disabled = true;
    step();
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  $play.addEventListener("click", play);
  $reset.addEventListener("click", () => {
    reset();
    $play.disabled = false;
  });

  // Reset when leaving the slide
  document.addEventListener("slidechange", (e) => {
    if (e.detail.slide !== "flow") {
      if (timer) clearTimeout(timer);
      running = false;
      $play.disabled = false;
    }
  });

  reset();
}
