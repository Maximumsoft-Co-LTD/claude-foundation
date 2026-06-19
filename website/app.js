/* claude-foundation landing — interactions. Vanilla, no deps. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------- nav */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (window.scrollY > 8) nav.classList.add("is-stuck");
    else nav.classList.remove("is-stuck");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ----------------------------------------------------- scroll reveal */
  var reveals = document.querySelectorAll(".reveal:not(.in)");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add("in");
    });
  }

  /* --------------------------------------------------- hero terminal */
  var RUNS = [
    {
      cmd: "/dev create a todo app with localStorage",
      out: [
        ["→ ", "ok", "0007-feat-todolist", "step", " · type=feat", "dim"],
        ["  will run ", "dim", "1·2·3·4·5·7·8·9·10", "step", "  ·  skip 6", "dim"]
      ]
    },
    {
      cmd: "/dev add an audit log to the back-office",
      out: [
        ["→ ", "ok", "0008-feat-audit-log", "step", " · type=feat", "dim"],
        ["  security review ", "dim", "armed", "step", " — diff touches auth", "dim"]
      ]
    },
    {
      cmd: "/dev fix the login redirect loop",
      out: [
        ["→ ", "ok", "0003-fix-login-redirect", "step", " · type=fix", "dim"],
        ["  step 1 ", "dim", "failing regression test", "step", " (must fail pre-fix)", "dim"]
      ]
    },
    {
      cmd: "/dev spike compare bullmq vs sidekiq",
      out: [
        ["→ ", "ok", "0009-spike-bullmq-sidekiq", "step", " · type=spike", "dim"],
        ["  timeboxed · deliverable = ", "dim", "recommendations.md", "step", "", "dim"]
      ]
    },
    {
      cmd: "/dev --resume 0003-fix-login-redirect",
      out: [
        ["→ ", "ok", "resuming 0003", "step", " from state.json", "dim"],
        ["  cursor: ", "dim", "phase 5 · test", "step", "", "dim"]
      ]
    }
  ];

  var typedEl = document.getElementById("typed");
  var outEl = document.getElementById("term-out");

  function renderOut(lines) {
    outEl.innerHTML = lines
      .map(function (parts) {
        var html = "";
        for (var i = 0; i < parts.length; i += 2) {
          var text = parts[i];
          var cls = parts[i + 1];
          if (text === "") continue;
          html += '<span class="' + cls + '">' + esc(text) + "</span>";
        }
        return html;
      })
      .join("<br>");
  }
  function esc(s) {
    return s.replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  if (typedEl && outEl) {
    if (reduceMotion) {
      typedEl.textContent = RUNS[0].cmd;
      renderOut(RUNS[0].out);
    } else {
      var ri = 0;
      function typeRun() {
        var run = RUNS[ri];
        outEl.style.opacity = "0";
        typedEl.textContent = "";
        var ci = 0;
        (function type() {
          if (ci <= run.cmd.length) {
            typedEl.textContent = run.cmd.slice(0, ci);
            ci++;
            setTimeout(type, 34 + Math.random() * 36);
          } else {
            setTimeout(function () {
              renderOut(run.out);
              outEl.style.transition = "opacity .35s ease";
              outEl.style.opacity = "1";
              setTimeout(eraseRun, 2600);
            }, 360);
          }
        })();
      }
      function eraseRun() {
        var run = RUNS[ri];
        outEl.style.opacity = "0";
        var len = run.cmd.length;
        (function erase() {
          if (len >= 0) {
            typedEl.textContent = run.cmd.slice(0, len);
            len--;
            setTimeout(erase, 14);
          } else {
            ri = (ri + 1) % RUNS.length;
            setTimeout(typeRun, 240);
          }
        })();
      }
      setTimeout(typeRun, 650);
    }
  }

  /* ------------------------------------------------ type-aware matrix */
  // {n, name} — n is the displayed phase number (half-phases keep the ½ glyph)
  var PHASES = [
    { n: "01", name: "Interview + spec" },
    { n: "02", name: "Plan" },
    { n: "03", name: "Gate" },
    { n: "04", name: "Implement" },
    { n: "05", name: "Test" },
    { n: "06", name: "Review" },
    { n: "07", name: "Security review" },
    { n: "08", name: "Docs touch-up" },
    { n: "09", name: "Ship" },
    { n: "10", name: "Retro" }
  ];
  // cell = [status, detail?]  ·  status: run | skip | light | trigger | optional
  // 10 cells in PHASES order — test runs before review; no Improve phase.
  var MATRIX = {
    feat: {
      note: "Full pipeline — the canonical run. Security arms only on a sensitive diff.",
      cells: [["run"], ["run"], ["run"], ["run"], ["run"], ["run"], ["trigger"], ["run"], ["run"], ["run"]]
    },
    fix: {
      note: "Reproduce before fix — step 1 is a regression test that must fail on pre-fix code and pass now.",
      cells: [
        ["run"], ["run", "step 1 = regression test"], ["run"], ["run", "test FIRST, then fix"],
        ["run", "regression must pass"], ["run"], ["trigger"], ["optional"], ["run"], ["run"]
      ]
    },
    refactor: {
      note: "Carries a behavior-equivalence statement; review and tests guard against drift.",
      cells: [
        ["run"], ["run", "behavior-equivalence note"], ["run"], ["run"], ["run", "behavior-equiv check"],
        ["run"], ["trigger"], ["optional"], ["run"], ["run"]
      ]
    },
    chore: {
      note: "Config, deps, tooling — no domain logic, so tests are skipped and docs run light. Review is also skipped at XS (size×type default).",
      cells: [["run"], ["run"], ["run"], ["run"], ["skip"], ["run", "skip @XS"], ["trigger"], ["optional"], ["run"], ["run"]]
    },
    docs: {
      note: "Documentation work — no test phase. Review is skipped at XS (size×type default); the docs phase is the payload, not a touch-up.",
      cells: [["run"], ["run"], ["run"], ["run"], ["skip"], ["run", "skip @XS"], ["trigger"], ["run"], ["run"], ["run"]]
    },
    spike: {
      note: "Timeboxed exploration — review is light, no test, ship is commit-only, the deliverable is recommendations.md.",
      cells: [
        ["run", "timeboxed"], ["run", "exploration plan"], ["run"], ["run", "exploration"], ["skip"],
        ["light"], ["skip"], ["skip"], ["optional", "commit only"], ["run"]
      ]
    }
  };
  var STATUS = {
    run: { cls: "st-run", text: "runs" },
    skip: { cls: "st-skip", text: "skipped" },
    light: { cls: "st-light", text: "light" },
    trigger: { cls: "st-trigger", text: "trigger-based" },
    optional: { cls: "st-light", text: "optional" }
  };

  var matrixEl = document.getElementById("matrix");
  var matrixNote = document.getElementById("matrix-note");
  var tabs = document.querySelectorAll(".type-tab");

  function renderMatrix(type) {
    var data = MATRIX[type];
    if (!data || !matrixEl) return;
    matrixEl.innerHTML = data.cells
      .map(function (cell, i) {
        var st = STATUS[cell[0]];
        var detail = cell[1]
          ? '<div class="pdetail">' + esc(cell[1]) + "</div>"
          : "";
        var phase = PHASES[i];
        return (
          '<div class="matrix-row">' +
          '<div class="matrix-phase"><span class="pn">' + phase.n + "</span>" +
          "<div><span class=\"pname\">" + phase.name + "</span>" + detail + "</div></div>" +
          '<span class="matrix-status ' + st.cls + '">' + st.text + "</span>" +
          "</div>"
        );
      })
      .join("");
    if (matrixNote) {
      matrixNote.innerHTML = "<b>type=" + type + "</b> — " + esc(data.note);
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      renderMatrix(tab.dataset.type);
    });
  });
  renderMatrix("feat");

  /* --------------------------------------------------- demo loader */
  var poster = document.getElementById("demo-poster");
  if (poster) {
    function loadDemo() {
      if (poster.dataset.loaded) return;
      poster.dataset.loaded = "1";
      var wrap = poster.parentNode;
      var iframe = document.createElement("iframe");
      iframe.src = "./demo/index.html";
      iframe.title = "The /dev workflow — interactive walkthrough";
      iframe.loading = "lazy";
      iframe.setAttribute("allow", "fullscreen");
      wrap.appendChild(iframe);
      poster.classList.add("is-hidden");
    }
    poster.addEventListener("click", loadDemo);
    poster.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        loadDemo();
      }
    });
  }

  /* ---------------------------------------------------- copy button */
  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      var label = btn.querySelector(".copy-text");
      var done = function () {
        btn.classList.add("copied");
        if (label) label.textContent = "Copied!";
        setTimeout(function () {
          btn.classList.remove("copied");
          if (label) label.textContent = "Copy";
        }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  });

  /* ------------------------------------------------------- changelog */
  var REPO = "https://github.com/Maximumsoft-Co-LTD/claude-foundation";
  var RAW = "https://raw.githubusercontent.com/Maximumsoft-Co-LTD/claude-foundation/main/CHANGELOG.md";
  var clRoot = document.getElementById("changelog-body");

  // canonical Keep-a-Changelog order + badge classes
  var GROUP_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
  var GROUP_CLASS = {
    Added: "add", Changed: "chg", Deprecated: "dep",
    Removed: "rem", Fixed: "fix", Security: "sec"
  };

  function escHtml(s) {
    return s.replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  // minimal inline markdown → HTML for changelog bullets
  function inlineMd(s) {
    s = escHtml(s);
    // links [text](url) — rewrite repo-relative refs to absolute GitHub URLs
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, url) {
      if (url.indexOf("../../") === 0) url = REPO + "/" + url.slice(6);
      var ext = /^https?:/.test(url) ? ' target="_blank" rel="noopener"' : "";
      return '<a href="' + url + '"' + ext + ">" + text + "</a>";
    });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return s;
  }

  // parse the [Unreleased]/[x.y.z] + ###Group + bullets structure
  function parseChangelog(md) {
    var lines = md.split("\n");
    var version = null, group = null, items = [], m;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if ((m = line.match(/^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$/))) {
        if (version && items.length) break; // first non-empty release wins
        // skip [Unreleased] entirely — the section shows shipped releases, so a
        // populated Unreleased must not shadow the latest tagged version.
        if (/^unreleased$/i.test(m[1])) { version = null; group = null; continue; }
        version = { name: m[1], date: (m[2] || "").trim() };
        group = null;
        continue;
      }
      if (!version) continue;
      if ((m = line.match(/^###\s+(.+?)\s*$/))) { group = m[1]; continue; }
      if (!group) continue;
      if ((m = line.match(/^-\s+(.+)/))) {
        items.push({ group: group, text: m[1], subs: [] });
      } else if ((m = line.match(/^\s{2,}-\s+(.+)/))) {
        if (items.length) items[items.length - 1].subs.push(m[1]);
      } else if (line.trim() && items.length) {
        // wrapped continuation of a bullet — ignore structural lines
        // (headings, hr, link-ref defs at the foot, the closing note)
        var t = line.trim();
        if (t[0] !== "#" && t[0] !== "[" && t[0] !== "_" && t.slice(0, 3) !== "---") {
          items[items.length - 1].text += " " + t;
        }
      }
    }
    return { version: version, items: items };
  }

  function renderChangelog(md) {
    var data = parseChangelog(md);
    if (!data.version || !data.items.length) return showChangelogError();

    // counts per group (in canonical order, only groups present)
    var counts = {};
    data.items.forEach(function (it) { counts[it.group] = (counts[it.group] || 0) + 1; });
    var groups = GROUP_ORDER.filter(function (g) { return counts[g]; });

    var html = "";
    // meta
    html +=
      '<div class="cl-meta"><span class="cl-ver">' +
      escHtml(data.version.name) +
      (data.version.date ? " · " + escHtml(data.version.date) : "") +
      '</span><span class="cl-count">' + data.items.length + " changes</span></div>";

    // filters
    html += '<div class="cl-filters">';
    html += '<button class="cl-chip is-active" data-f="all">All<span class="ct">' + data.items.length + "</span></button>";
    groups.forEach(function (g) {
      html += '<button class="cl-chip" data-f="' + g + '">' + g + '<span class="ct">' + counts[g] + "</span></button>";
    });
    html += "</div>";

    // list — canonical group order, source order within a group
    html += '<div class="cl-list">';
    groups.forEach(function (g) {
      data.items
        .filter(function (it) { return it.group === g; })
        .forEach(function (it) {
          var body = inlineMd(it.text);
          if (it.subs.length) {
            body += "<ul>" + it.subs.map(function (s) { return "<li>" + inlineMd(s) + "</li>"; }).join("") + "</ul>";
          }
          html +=
            '<div class="cl-entry" data-group="' + g + '">' +
            '<span class="cl-badge ' + GROUP_CLASS[g] + '">' + g + "</span>" +
            '<div class="cl-body"><div class="cl-text clamp">' + body + "</div>" +
            '<button class="cl-more" hidden>Show more</button></div></div>';
        });
    });
    html += "</div>";

    // footer link
    html +=
      '<div class="cl-foot"><a href="' + REPO + '/blob/main/CHANGELOG.md" target="_blank" rel="noopener">' +
      "Read the full CHANGELOG.md on GitHub" +
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>';

    clRoot.innerHTML = html;
    wireChangelog();
  }

  function wireChangelog() {
    // reveal "Show more" only where the text actually overflows the clamp
    clRoot.querySelectorAll(".cl-entry").forEach(function (entry) {
      var text = entry.querySelector(".cl-text");
      var more = entry.querySelector(".cl-more");
      if (text.scrollHeight - text.clientHeight > 4) {
        more.hidden = false;
        more.addEventListener("click", function () {
          var clamped = text.classList.toggle("clamp");
          more.textContent = clamped ? "Show more" : "Show less";
        });
      }
    });

    // filter chips
    var chips = clRoot.querySelectorAll(".cl-chip");
    var entries = clRoot.querySelectorAll(".cl-entry");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.classList.remove("is-active"); });
        chip.classList.add("is-active");
        var f = chip.dataset.f;
        entries.forEach(function (e) {
          e.classList.toggle("is-hidden", f !== "all" && e.dataset.group !== f);
        });
      });
    });
  }

  function showChangelogError() {
    if (!clRoot) return;
    clRoot.innerHTML =
      '<div class="cl-error">Couldn\'t load the changelog inline. ' +
      '<a href="' + REPO + '/blob/main/CHANGELOG.md" target="_blank" rel="noopener">' +
      "Read it on GitHub →</a></div>";
  }

  if (clRoot) {
    // Loaded straight from the public repo on GitHub (raw.githubusercontent.com
    // sends Access-Control-Allow-Origin: *), so there's no copy to keep in sync.
    fetch(RAW)
      .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(renderChangelog)
      .catch(showChangelogError);
  }
})();
