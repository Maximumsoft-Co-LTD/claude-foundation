// Workflow slides — interactive deck.
// No build step. ES modules, vanilla DOM. Each slide owns its little widget.

import { initDeck } from "./deck.js";
import { initTitle } from "./slides/title.js";
import { initTypes } from "./slides/types.js";
import { initAgents } from "./slides/agents.js";
import { initArtifacts } from "./slides/artifacts.js";
import { initGate } from "./slides/gate.js";
import { initFlow } from "./slides/flow.js";
import { initSecurity } from "./slides/security.js";
import { initResume } from "./slides/resume.js";

document.addEventListener("DOMContentLoaded", () => {
  initDeck();
  initTitle();
  initTypes();
  initAgents();
  initArtifacts();
  initGate();
  initFlow();
  initSecurity();
  initResume();
});
