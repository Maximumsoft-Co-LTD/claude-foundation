(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var nav = document.getElementById("nav");

  function updateNav() {
    nav.classList.toggle("is-stuck", window.scrollY > 8);
  }
  window.addEventListener("scroll", updateNav, { passive: true });
  updateNav();

  var reveals = document.querySelectorAll(".reveal:not(.in)");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    reveals.forEach(function (element) {
      observer.observe(element);
    });
  } else {
    reveals.forEach(function (element) {
      element.classList.add("in");
    });
  }

  var adapterData = {
    command: {
      kicker: "ONE PROVIDER · ONE COMMAND",
      title: "command",
      description: "Run one deterministic project command for one evidence capability.",
      code:
        "// execution.yaml\n" +
        '"static-analysis": {\n' +
        '  "adapter": "command",\n' +
        '  "command": ["npm", "run", "check"],\n' +
        '  "timeoutMs": 120000\n' +
        "}"
    },
    "test-discovery": {
      kicker: "ONE PROCESS · TWO RECEIPTS",
      title: "test-discovery",
      description: "Execute the suite once and produce both behavioral-test and discovery evidence from a structured count.",
      code:
        "// execution.yaml\n" +
        '"test": {\n' +
        '  "adapter": "test-discovery",\n' +
        '  "command": ["npm", "test", "--", "--json"],\n' +
        '  "report": "test-results/unit.json",\n' +
        '  "minimum": 1\n' +
        "}"
    },
    playwright: {
      kicker: "REAL BROWSER · CLAIM MAPPING",
      title: "playwright",
      description: "Consume structured project-owned Playwright output and require annotations for every claim it proves. One execution may emit several capability receipts.",
      code:
        "// execution.yaml\n" +
        '"browser": {\n' +
        '  "adapter": "playwright",\n' +
        '  "command": ["npx", "playwright", "test"],\n' +
        '  "project": "chromium",\n' +
        '  "outputs": ["accessibility"],\n' +
        '  "inputMode": "browser-automation"\n' +
        "}"
    },
    "contract-digest": {
      kicker: "NO COMMAND · BYTES MUST AGREE",
      title: "contract-digest",
      description: "Hash one declared contract artifact in two or more repositories and pass only when every side carries identical bytes.",
      code:
        "// execution.yaml\n" +
        '"cross-repo-contract": {\n' +
        '  "adapter": "contract-digest",\n' +
        '  "contract": {\n' +
        '    "profile-api": "contracts/profile.v1.json",\n' +
        '    "web": "src/contracts/profile.v1.json"\n' +
        "  }\n" +
        "}"
    },
    external: {
      kicker: "REMOTE OR HUMAN · EXPLICIT RECEIPT",
      title: "external",
      description: "Require evidence from CI, a reviewer, or another system that Change Loop must not execute locally. Signed CI envelopes are verified against the workspace.",
      code:
        "// execution.yaml\n" +
        '"review": {\n' +
        '  "adapter": "external",\n' +
        '  "claims": ["auth-boundary"],\n' +
        '  "ci": {\n' +
        '    "issuer": "github-actions",\n' +
        '    "publicKey": "-----BEGIN PUBLIC KEY-----\\n…"\n' +
        "  }\n" +
        "}"
    }
  };

  var adapterTabs = document.querySelectorAll(".adapter-tab");
  var adapterKicker = document.getElementById("adapter-kicker");
  var adapterTitle = document.getElementById("adapter-title");
  var adapterDescription = document.getElementById("adapter-description");
  var adapterCode = document.getElementById("adapter-code");

  adapterTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var selected = adapterData[tab.dataset.adapter];
      adapterTabs.forEach(function (item) {
        var active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      adapterKicker.textContent = selected.kicker;
      adapterTitle.textContent = selected.title;
      adapterDescription.textContent = selected.description;
      adapterCode.textContent = selected.code;
    });
  });

  var catalogToggle = document.getElementById("catalog-toggle");
  var capabilityList = document.getElementById("capability-list");
  catalogToggle.addEventListener("click", function () {
    var expanded = catalogToggle.getAttribute("aria-expanded") === "true";
    catalogToggle.setAttribute("aria-expanded", String(!expanded));
    capabilityList.classList.toggle("is-expanded", !expanded);
    catalogToggle.innerHTML = expanded ? "Show all 19 <span>+</span>" : "Show fewer <span>−</span>";
  });

  var installs = {
    brew:
      "brew tap maximumsoft-co-ltd/claude-foundation \\\n" +
      "  https://github.com/Maximumsoft-Co-LTD/claude-foundation\n" +
      "brew install claude-foundation\n" +
      "claude-foundation init /path/to/project --yes",
    source:
      "npm install -g @fission-ai/openspec@1.7.0\n" +
      "git clone https://github.com/Maximumsoft-Co-LTD/claude-foundation.git\n" +
      "cd claude-foundation\n" +
      "./install.sh /path/to/project"
  };

  var installTabs = document.querySelectorAll(".install-tab");
  var installCommand = document.getElementById("install-command");
  installTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      installTabs.forEach(function (item) {
        var active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      installCommand.textContent = installs[tab.dataset.install];
    });
  });

  var copyButton = document.getElementById("copy-install");
  copyButton.addEventListener("click", function () {
    var value = installCommand.textContent;
    var finish = function () {
      copyButton.textContent = "Copied";
      copyButton.classList.add("is-copied");
      window.setTimeout(function () {
        copyButton.textContent = "Copy";
        copyButton.classList.remove("is-copied");
      }, 1600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(finish, finish);
      return;
    }

    var textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (_) {
      /* The command remains selectable when clipboard APIs are unavailable. */
    }
    document.body.removeChild(textarea);
    finish();
  });
})();
