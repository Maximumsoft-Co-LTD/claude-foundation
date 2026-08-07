import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

export function createChangeLifecycle({
  root,
  securityTerms,
  fail,
  pathInside,
  readJson,
  writeJson,
  slugify,
  changePath,
  loadRuntime,
  saveRuntime,
  setOperationChangeId,
  initialBudget,
  gitHead,
  now,
  bindClaudeSession,
  validate,
  createSandbox,
  showPacket
}) {
  function templateDir(schema) {
    return join(root, "openspec", "schemas", schema, "templates");
  }

  function instantiate(path, title) {
    return readFileSync(path, "utf8")
      .replaceAll("<title>", title)
      .replaceAll("replace-with-stable-claim-id", `${slugify(title)}-outcome`);
  }

  function loadDraft(draftPath) {
    const source = resolve(root, draftPath);
    if (!pathInside(root, source) || !existsSync(source))
      fail("new --draft requires a JSON file inside the project");
    const draft = readJson(source);
    const requiredStrings = ["why", "currentState", "compatibility"];
    for (const field of requiredStrings)
      if (!String(draft[field] || "").trim())
        fail(`draft requires non-empty '${field}'`);
    for (const field of ["changes", "nonGoals", "decisions", "risks", "tasks", "claims", "specs"])
      if (!Array.isArray(draft[field]) || draft[field].length === 0)
        fail(`draft requires a non-empty '${field}' array`);
    return draft;
  }

  function materializeDraft(id, draft) {
    const state = loadRuntime(id);
    const title = draft.title || state.intent;
    const bullets = (items) => items.map((item) => `- ${item}`).join("\n");
    writeFileSync(join(changePath(id), "proposal.md"),
      `# Change: ${title}\n\n## Why\n\n${draft.why}\n\n` +
      `## What changes\n\n${bullets(draft.changes)}\n\n## Impact\n\n` +
      `- **Impact:** ${draft.impact || state.impact || "medium"}\n` +
      `- **Coupling:** ${draft.coupling || state.coupling || "coupled"}\n` +
      `- **Affected surfaces:** ${(draft.surfaces || ["code"]).join(", ")}\n` +
      `- **Security triggers:** ${(draft.securityTriggers || ["none"]).join(", ")}\n\n` +
      `## Non-goals\n\n${bullets(draft.nonGoals)}\n`);
    if (state.schema === "foundation-standard")
      writeFileSync(join(changePath(id), "design.md"),
        `# Design\n\n## Current state\n\n${draft.currentState}\n\n## Decisions\n\n` +
        draft.decisions.map((decision) =>
          `- **Decision:** ${decision.choice}\n  - **Why:** ${decision.why}\n` +
          `  - **Rejected:** ${decision.rejected || "none"}`).join("\n") +
        `\n\n## Compatibility and migration\n\n${draft.compatibility}\n\n## Risks\n\n` +
        `| Risk | Mitigation | Evidence owner |\n|---|---|---|\n` +
        draft.risks.map((risk) =>
          `| ${risk.risk} | ${risk.mitigation} | ${risk.owner} |`).join("\n") + "\n");
    writeFileSync(join(changePath(id), "tasks.md"),
      `# Tasks\n\n> This is the sole implementation ledger.\n\n` +
      draft.tasks.map((task, index) => {
        const taskId = task.id || `T${String(index + 1).padStart(3, "0")}`;
        const metadata = [
          task.repository ? `[repo:${task.repository}]` : "",
          task.kind ? `[kind:${task.kind}]` : "",
          task.paths?.length ? `[paths:${task.paths.join(",")}]` : "",
          task.dependsOn?.length ? `[depends:${task.dependsOn.join(",")}]` : ""
        ].filter(Boolean).join(" ");
        return `- [ ] **${taskId}** ${task.outcome} ${metadata} — verify: \`${task.verify}\``;
      }).join("\n") + "\n");
    const contract = readJson(join(changePath(id), "evidence.yaml"));
    contract.claims = draft.claims;
    writeJson(join(changePath(id), "evidence.yaml"), contract);
    if (draft.execution) writeJson(join(changePath(id), "execution.yaml"), draft.execution);
    if (draft.repositories) writeJson(join(changePath(id), "repositories.yaml"), {
      version: 1,
      repositories: draft.repositories
    });
    if (state.schema === "foundation-standard") {
      rmSync(join(changePath(id), "specs"), { recursive: true, force: true });
      for (const spec of draft.specs) {
        const specDir = join(changePath(id), "specs", slugify(spec.name));
        mkdirSync(specDir, { recursive: true });
        writeFileSync(join(specDir, "spec.md"),
          `# ${spec.name}\n\n## ADDED Requirements\n\n` +
          `### Requirement: ${spec.requirement}\n\n${spec.description}\n\n` +
          `#### Scenario: ${spec.scenario}\n\n- **WHEN** ${spec.when}\n` +
          `- **THEN** ${spec.then}\n`);
      }
    }
  }

  // The artifacts the standard schema adds over the rapid one. Written only
  // when absent, so an upgrade never overwrites work already done.
  function materializeStandardArtifacts(id, intent) {
    const source = templateDir("foundation-standard");
    const target = changePath(id);
    const design = join(target, "design.md");
    if (!existsSync(design))
      writeFileSync(design, instantiate(join(source, "design.md"), intent));
    const spec = join(target, "specs", "change", "spec.md");
    if (!existsSync(spec)) {
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(spec, instantiate(join(source, "spec.md"), intent));
    }
  }

  function createChange(intent, flags) {
    const id = slugify(flags.id || intent);
    setOperationChangeId(id);
    if (existsSync(changePath(id))) fail(`change already exists: ${id}`);
    const draft = flags.draft ? loadDraft(flags.draft) : null;
    const schema = flags.rapid ? "foundation-rapid" : "foundation-standard";
    const source = templateDir(schema);
    const target = changePath(id);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, ".openspec.yaml"), `schema: ${schema}\n`);
    for (const name of ["proposal.md", "tasks.md", "evidence.yaml", "execution.yaml", "repositories.yaml"])
      writeFileSync(join(target, name), instantiate(join(source, name), intent));
    if (schema === "foundation-standard") {
      writeFileSync(join(target, "design.md"), instantiate(join(source, "design.md"), intent));
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(join(target, "specs", "change", "spec.md"), instantiate(join(source, "spec.md"), intent));
    }
    const state = {
      version: 2, id, intent, schema, status: "change", ambiguity: "clear",
      revision: 0, contractRevision: 0, executionRevision: 0,
      impact: schema === "foundation-rapid" ? "low" : null,
      coupling: schema === "foundation-rapid" ? "isolated" : null,
      securityTriggers: [], reviewRequired: false, evidenceCapabilities: [],
      acceptance: {
        version: 2,
        decision: schema === "foundation-rapid" ? "not-required" : "undecided",
        required: false, reason: null, claimIds: [], declaredAt: null
      },
      reviewHistory: { version: 1, aiAttempts: 0, totalAttempts: 0, chainHead: null },
      workspace: { mode: "current", path: root, baseHead: gitHead(root) },
      budget: initialBudget(schema, id),
      createdAt: now(), updatedAt: now()
    };
    saveRuntime(state);
    if (draft) materializeDraft(id, draft);
    bindClaudeSession(id, "change");
    console.log(`CREATED ${id}\n  schema: ${schema}\n  next: complete artifacts, then /build ${id}`);
    return id;
  }

  function rapidStartTemplate() {
    return {
      version: 1,
      intent: "Describe one low-impact isolated outcome",
      why: "Explain the user-visible reason",
      currentState: "Describe the bounded current behavior",
      compatibility: "No public compatibility or migration impact",
      changes: ["Describe the intended behavior"],
      nonGoals: ["Name one explicit non-goal"],
      decisions: [{ choice: "Use the smallest isolated change", why: "Minimize risk", rejected: "Broader redesign" }],
      risks: [{ risk: "Behavior regression", mitigation: "Focused deterministic test", owner: "implementation" }],
      acceptance: { required: false, reason: null, claimIds: [] },
      tasks: [{ id: "T001", outcome: "Implement the bounded outcome", kind: "implementation", paths: ["replace-with-owned-path"], verify: "replace-with-focused-command" }],
      claims: [{ id: "replace-with-stable-claim-id", scenario: "Observable outcome passes", impact: "low", capabilities: ["test"] }],
      specs: [{ name: "unused-by-rapid", requirement: "Bounded outcome", description: "The system SHALL provide the outcome.", scenario: "Focused behavior", when: "the bounded input occurs", then: "the expected result is returned" }],
      execution: {
        version: 1,
        providers: {
          test: {
            adapter: "test-discovery",
            command: ["replace-with-project-test-command"],
            report: "replace-with-structured-test-report.json",
            minimum: 1,
            timeoutMs: 120000
          }
        },
        services: {}
      }
    };
  }

  function resolveChange(id, flags) {
    const state = loadRuntime(id);
    for (const key of ["ambiguity", "impact", "coupling"])
      if (flags[key]) state[key] = flags[key];
    if (flags.size) state.size = flags.size;
    const semanticText = `${state.intent} ${flags.security || ""}`.toLowerCase();
    // Word boundaries, not substrings. `includes("access")` fired on
    // "accessibility" and `includes("migration")` on "migration guide", so
    // routine work acquired external review it did not need — while the
    // trigger the docs promise ("semantic, not syntax") went unmet either way.
    const inferred = securityTerms.filter((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(semanticText);
    });
    const explicitSecurity = String(flags.security || "").split(",")
      .map((value) => value.trim()).filter((value) => value && value.toLowerCase() !== "none");
    state.securityTriggers = [...new Set([
      ...(state.securityTriggers || []).filter((value) =>
        String(value).trim().toLowerCase() !== "none"),
      ...inferred, ...explicitSecurity
    ])];
    state.reviewRequired = state.impact === "high" || state.coupling === "coupled" ||
      state.securityTriggers.length > 0 || Boolean(flags.review);
    if (flags["acceptance-required"] && flags["acceptance-not-required"])
      fail("resolve cannot combine --acceptance-required and --acceptance-not-required");
    if ((flags["acceptance-reason"] || flags["acceptance-claims"]) &&
        !flags["acceptance-required"])
      fail("--acceptance-reason and --acceptance-claims require --acceptance-required");
    if (flags["acceptance-required"]) {
      const reason = String(flags["acceptance-reason"] || "").trim();
      if (!reason) fail("--acceptance-required requires --acceptance-reason");
      state.acceptance = {
        version: 2,
        decision: "required",
        required: true,
        reason,
        claimIds: String(flags["acceptance-claims"] || "").split(",")
          .map((value) => value.trim()).filter(Boolean),
        scopeOrigin: "explicit",
        declaredAt: now()
      };
    } else if (flags["acceptance-not-required"])
      state.acceptance = {
        version: 2, decision: "not-required", required: false,
        reason: null, claimIds: [], declaredAt: now()
      };
    let upgraded = false;
    if (state.schema === "foundation-rapid" &&
        (state.impact !== "low" || state.coupling !== "isolated" || state.reviewRequired ||
         state.acceptance?.required)) {
      state.schema = "foundation-standard";
      state.upgradedFrom = "foundation-rapid";
      upgraded = true;
      // The rapid packet has no design.md and no specs/, which the standard
      // schema requires. Leaving them absent made `validate` refuse a change
      // whose only listed next command was `validate` — a dead end that had to
      // be guessed out of. Instantiate them here, with the upgrade.
      materializeStandardArtifacts(id, state.intent);
    }
    saveRuntime(state);
    console.log(`RESOLVED ${id}\n  impact: ${state.impact}\n  coupling: ${state.coupling}\n  review: ${state.reviewRequired ? "required" : "not required"}\n  acceptance: ${state.acceptance?.decision || (state.acceptance?.required ? "required" : "legacy-not-required")}\n  security: ${state.securityTriggers.join(", ") || "none"}\n  schema: ${state.schema}${upgraded ? " (upgraded from foundation-rapid; design.md and specs/ added)" : ""}`);
  }

  function startAtomic(draftPath) {
    const draft = loadDraft(draftPath);
    if (draft.version !== 1) fail("start draft requires version 1");
    if (!String(draft.intent || "").trim()) fail("start draft requires non-empty 'intent'");
    const impact = draft.impact || "low";
    const coupling = draft.coupling || "isolated";
    const securityTriggers = draft.securityTriggers || [];
    if (!draft.acceptance || typeof draft.acceptance.required !== "boolean")
      fail("start draft requires acceptance.required true|false from an explicit user-facing decision");
    // Validated here, with everything else, rather than inside resolveChange:
    // createChange has already persisted by then, so a late refusal leaves a
    // half-created change whose only exit is `change abandon --decision-ref`,
    // a flag the error does not mention. `start` is meant to be atomic.
    if (draft.acceptance.required && !String(draft.acceptance.reason || "").trim())
      fail("start draft requires acceptance.reason when acceptance.required is true");
    if (!["low", "medium", "high"].includes(impact))
      fail("start draft impact must be low|medium|high");
    if (!["isolated", "coupled"].includes(coupling))
      fail("start draft coupling must be isolated|coupled");
    if (!Array.isArray(securityTriggers) ||
        securityTriggers.some((trigger) => typeof trigger !== "string" || !trigger.trim()))
      fail("start draft securityTriggers must be an array of non-empty strings");
    if (!draft.execution || draft.execution.version !== 1 ||
        !draft.execution.providers || Object.keys(draft.execution.providers).length === 0)
      fail("start draft requires executable evidence wiring");
    const rapid = impact === "low" && coupling === "isolated" &&
      securityTriggers.filter((trigger) => trigger.toLowerCase() !== "none").length === 0 &&
      !draft.reviewRequired && !draft.acceptance?.required;
    const id = createChange(draft.intent, { rapid, draft: draftPath, id: draft.id });
    resolveChange(id, {
      impact,
      coupling,
      size: draft.size || (rapid ? "xs" : "S"),
      security: securityTriggers.join(","),
      review: Boolean(draft.reviewRequired),
      "acceptance-required": Boolean(draft.acceptance?.required),
      "acceptance-not-required": !draft.acceptance?.required,
      "acceptance-reason": draft.acceptance?.reason || undefined,
      "acceptance-claims": (draft.acceptance?.claimIds || []).join(",") || undefined
    });
    if (loadRuntime(id).schema === "foundation-standard") materializeDraft(id, draft);
    validate(id, "root", { quiet: true });
    createSandbox(id);
    showPacket(id, { phase: "build" });
  }

  return {
    templateDir,
    instantiate,
    loadDraft,
    materializeDraft,
    createChange,
    rapidStartTemplate,
    startAtomic,
    resolveChange
  };
}
