// Title slide: rotating typed intent in the command bar.

const PHRASES = [
  "create a todolist app",
  "fix login redirect loop",
  "refactor auth middleware",
  "spike bullmq vs sidekiq",
  "add audit log export",
];

export function initTitle() {
  const $el = document.getElementById("cmd-typer");
  if (!$el) return;

  let phraseIdx = 0;
  let charIdx = 0;
  let mode = "typing"; // typing | holding | deleting
  let timer = null;
  let active = true;

  function tick() {
    const phrase = PHRASES[phraseIdx];

    if (mode === "typing") {
      charIdx++;
      $el.textContent = phrase.slice(0, charIdx);
      if (charIdx >= phrase.length) {
        mode = "holding";
        timer = setTimeout(tick, 1600);
        return;
      }
      timer = setTimeout(tick, 50 + Math.random() * 40);
    } else if (mode === "holding") {
      mode = "deleting";
      timer = setTimeout(tick, 60);
    } else if (mode === "deleting") {
      charIdx--;
      $el.textContent = phrase.slice(0, charIdx);
      if (charIdx <= 0) {
        mode = "typing";
        phraseIdx = (phraseIdx + 1) % PHRASES.length;
        timer = setTimeout(tick, 250);
        return;
      }
      timer = setTimeout(tick, 25);
    }
  }

  // Only run while title slide is active to spare CPU
  document.addEventListener("slidechange", (e) => {
    if (e.detail.slide === "title" && !active) {
      active = true;
      tick();
    } else if (e.detail.slide !== "title" && active) {
      active = false;
      if (timer) clearTimeout(timer);
    }
  });

  tick();
}
