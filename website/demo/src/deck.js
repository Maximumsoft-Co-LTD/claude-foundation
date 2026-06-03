// Deck navigation: keyboard, dots, prev/next, progress bar, help overlay.

export function initDeck() {
  const slides = Array.from(document.querySelectorAll(".slide"));
  const total = slides.length;
  const current = { i: 0 };

  const $bar = document.getElementById("progress-bar");
  const $cur = document.getElementById("slide-current");
  const $tot = document.getElementById("slide-total");
  const $prev = document.getElementById("prev-btn");
  const $next = document.getElementById("next-btn");
  const $dots = document.getElementById("dots");
  const $help = document.getElementById("help");
  const $helpClose = document.getElementById("help-close");
  const $deck = document.getElementById("deck");

  $tot.textContent = total;

  // Build dots
  slides.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.className = "dot" + (i === 0 ? " is-active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-label", `Slide ${i + 1}`);
    btn.addEventListener("click", () => go(i));
    $dots.appendChild(btn);
  });

  function go(target) {
    if (target < 0 || target >= total || target === current.i) return;
    const from = slides[current.i];
    const to = slides[target];
    from.classList.remove("is-active");
    from.classList.add("is-leaving");
    setTimeout(() => from.classList.remove("is-leaving"), 500);
    to.classList.add("is-active");
    current.i = target;
    update();
    // dispatch a synthetic event so widgets can react (e.g. typer restart)
    document.dispatchEvent(
      new CustomEvent("slidechange", {
        detail: { index: target, slide: to.dataset.slide },
      })
    );
  }

  function update() {
    const pct = ((current.i + 1) / total) * 100;
    $bar.style.width = `${pct}%`;
    $cur.textContent = current.i + 1;
    $prev.disabled = current.i === 0;
    $next.disabled = current.i === total - 1;
    Array.from($dots.children).forEach((d, i) => {
      d.classList.toggle("is-active", i === current.i);
    });
  }

  $prev.addEventListener("click", () => go(current.i - 1));
  $next.addEventListener("click", () => go(current.i + 1));

  document.addEventListener("keydown", (e) => {
    // Don't hijack typing in inputs
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (!$help.hidden) {
      if (e.key === "Escape" || e.key === "?") {
        $help.hidden = true;
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowRight":
      case " ":
      case "PageDown":
        go(current.i + 1);
        e.preventDefault();
        break;
      case "ArrowLeft":
      case "PageUp":
        go(current.i - 1);
        e.preventDefault();
        break;
      case "Home":
        go(0);
        e.preventDefault();
        break;
      case "End":
        go(total - 1);
        e.preventDefault();
        break;
      case "?":
        $help.hidden = false;
        e.preventDefault();
        break;
    }
  });

  $helpClose.addEventListener("click", () => ($help.hidden = true));
  $help.addEventListener("click", (e) => {
    if (e.target === $help) $help.hidden = true;
  });

  // Click-on-stage advances when clicking empty space
  $deck.focus();

  update();
}
