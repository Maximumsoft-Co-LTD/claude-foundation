import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

const DEFAULT_POLICY = {
  version: 1,
  execution: {
    maxParallelAgents: 3,
    packetBytes: { task: 8192, review: 8192, repository: 12288, global: 16384 },
    tokenBudgets: { rapid: 800000, standard: 1600000 },
    requestBudgets: { rapid: 100, standard: 200 },
    planSummaryBytes: 4096,
    leaseMinutes: 45
  },
  models: {
    fast: { family: "haiku", fallbackTier: "standard", purposes: ["inventory", "logs", "mechanical-docs"] },
    standard: { family: "sonnet", fallbackTier: "deep", purposes: ["implementation", "tests", "focused-investigation"] },
    deep: { family: "opus", fallbackTier: null, purposes: ["architecture", "security", "migration", "independent-review"] }
  },
  escalation: [
    "ambiguous-contract", "auth-or-sensitive-data", "migration",
    "concurrency", "public-compatibility", "cross-repository-conflict",
    "evidence-anomaly", "two-failed-attempts"
  ],
  review: {
    diversity: "required", independence: "required", reviewers: {},
    fallbackReviewers: [], infraFailureThreshold: 1
  },
  telemetry: { requireUsage: false },
  land: { riskBasedCi: false },
  sandbox: { setupCommand: null, setupTimeoutMs: 600000 },
  workflow: {
    grounding: "optional",
    reviewCircuit: "legacy",
    reviewPolicy: "legacy",
    handoffDefaultOwner: "devops-team"
  }
};

export function reviewAssurancePosture(policy, effectiveReview = null) {
  const review = policy?.review || {};
  const independenceWaived = effectiveReview
    ? effectiveReview.independenceWaived === true
    : review.independence === "self";
  const diversityWaived = effectiveReview
    ? effectiveReview.diversityWaived === true
    : review.diversity === "single-model";
  const independenceRequired = effectiveReview
    ? effectiveReview.independence === "required"
    : !independenceWaived;
  const diversityRequired = effectiveReview
    ? effectiveReview.diversity === "required"
    : !diversityWaived;
  const waivers = [
    ...(independenceWaived ? ["reviewer-independence"] : []),
    ...(diversityWaived ? ["model-diversity"] : [])
  ];
  const consequences = [
    independenceWaived
      ? "review may be non-independent"
      : independenceRequired
        ? "independent reviewer required"
        : "reviewer independence preferred",
    diversityWaived
      ? "review may use the same model family"
      : diversityRequired
        ? "cross-family model diversity required"
        : "cross-family model diversity preferred"
  ];
  return {
    version: 1,
    independence: {
      configured: review.independence,
      effective: effectiveReview?.independence || review.independence,
      required: independenceRequired,
      waived: independenceWaived
    },
    diversity: {
      configured: review.diversity,
      effective: effectiveReview?.diversity || review.diversity,
      required: diversityRequired,
      waived: diversityWaived
    },
    waivers,
    assurance: consequences.join("; "),
    summary: waivers.length
      ? `${effectiveReview ? "active" : "committed"} assurance waiver${waivers.length === 1 ? "" : "s"}: ${waivers.join(", ")}; ${consequences.join("; ")}`
      : `${consequences.join("; ")}; no ${effectiveReview ? "active" : "committed"} assurance waivers`
  };
}

export function createRuntimeEnvironment({
  root, protocolPath = join(root, ".claude", "harness", "protocol.json"),
  policyPath = join(root, "foundation.json"),
  protocols, readJson, fail
}) {
  function protocolDescriptor() {
    return readJson(protocolPath, protocols);
  }

  function commandExists(command, cwd = root) {
    if (!command) return false;
    if (command.includes("/") || isAbsolute(command))
      return existsSync(resolve(cwd, command));
    return String(process.env.PATH || "").split(delimiter)
      .some((directory) => existsSync(join(directory, command)));
  }

  function playwrightAvailability(workspace) {
    const packageJson = readJson(join(workspace, "package.json"), {});
    const packages = {
      ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {})
    };
    const packageOwned = Boolean(packages["@playwright/test"] || packages.playwright);
    const binary = join(workspace, "node_modules", ".bin", "playwright");
    const config = [
      "playwright.config.ts", "playwright.config.js", "playwright.config.mjs",
      "playwright.config.cjs"
    ].find((name) => existsSync(join(workspace, name))) || null;
    return { packageOwned, binary, binaryAvailable: existsSync(binary), config };
  }

  function mergePolicy(configured) {
    return {
      ...DEFAULT_POLICY, ...configured,
      execution: { ...DEFAULT_POLICY.execution, ...(configured.execution || {}) },
      models: Object.fromEntries(["fast", "standard", "deep"].map((tier) => [
        tier, { ...DEFAULT_POLICY.models[tier], ...(configured.models?.[tier] || {}) }
      ])),
      review: {
        ...DEFAULT_POLICY.review, ...(configured.review || {}),
        reviewers: {
          ...DEFAULT_POLICY.review.reviewers,
          ...(configured.review?.reviewers || {})
        }
      },
      telemetry: { ...DEFAULT_POLICY.telemetry, ...(configured.telemetry || {}) },
      land: { ...DEFAULT_POLICY.land, ...(configured.land || {}) },
      sandbox: { ...DEFAULT_POLICY.sandbox, ...(configured.sandbox || {}) },
      workflow: { ...DEFAULT_POLICY.workflow, ...(configured.workflow || {}) }
    };
  }

  function normalizeExecutionPolicy(policy) {
    if (typeof policy.execution.packetBytes === "number") {
      policy.execution.legacyNumericPacketBytes = policy.execution.packetBytes;
      policy.execution.packetBytes = {
        task: policy.execution.packetBytes,
        review: policy.execution.packetBytes,
        repository: policy.execution.packetBytes,
        global: policy.execution.packetBytes
      };
    } else {
      policy.execution.packetBytes = {
        ...DEFAULT_POLICY.execution.packetBytes,
        ...(policy.execution.packetBytes || {})
      };
    }
    policy.execution.tokenBudgets = {
      ...DEFAULT_POLICY.execution.tokenBudgets,
      ...(policy.execution.tokenBudgets || {})
    };
    policy.execution.requestBudgets = {
      ...DEFAULT_POLICY.execution.requestBudgets,
      ...(policy.execution.requestBudgets || {})
    };
  }

  function validatePacketPolicy(policy) {
    for (const type of ["task", "review", "repository", "global"]) {
      const bytes = Number(policy.execution.packetBytes?.[type]);
      if (!Number.isInteger(bytes) || bytes < 2048 || bytes > 65536)
        fail(`foundation.json execution.packetBytes.${type} must be 2048..65536`);
    }
    const summaryBytes = Number(policy.execution.planSummaryBytes);
    if (!Number.isInteger(summaryBytes) || summaryBytes < 1024 || summaryBytes > 16384)
      fail("foundation.json execution.planSummaryBytes must be 1024..16384");
  }

  function validateBudgetPolicy(policy) {
    for (const type of ["rapid", "standard"]) {
      const tokens = Number(policy.execution.tokenBudgets[type]);
      if (!Number.isInteger(tokens) || tokens < 10000 || tokens > 100000000)
        fail(`foundation.json execution.tokenBudgets.${type} must be 10000..100000000`);
      const requests = Number(policy.execution.requestBudgets[type]);
      if (!Number.isInteger(requests) || requests < 10 || requests > 100000)
        fail(`foundation.json execution.requestBudgets.${type} must be 10..100000`);
    }
  }

  function validateExecutionLimits(policy) {
    const parallel = Number(policy.execution.maxParallelAgents);
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16)
      fail("foundation.json execution.maxParallelAgents must be an integer from 1 to 16");
    const leaseMinutes = Number(policy.execution.leaseMinutes);
    if (!Number.isFinite(leaseMinutes) || leaseMinutes < 1 || leaseMinutes > 1440)
      fail("foundation.json execution.leaseMinutes must be from 1 to 1440");
  }

  function validateExecutionPolicy(policy) {
    validatePacketPolicy(policy);
    validateBudgetPolicy(policy);
    validateExecutionLimits(policy);
  }

  function validateWorkflowPolicy(policy) {
    const setupCommand = policy.sandbox.setupCommand;
    if (setupCommand !== null && setupCommand !== undefined &&
        (typeof setupCommand !== "string" || setupCommand.trim() === ""))
      fail("foundation.json sandbox.setupCommand must be a non-empty string");
    const setupTimeoutMs = Number(policy.sandbox.setupTimeoutMs);
    if (!Number.isInteger(setupTimeoutMs) || setupTimeoutMs < 1000 || setupTimeoutMs > 3600000)
      fail("foundation.json sandbox.setupTimeoutMs must be 1000..3600000");
    if (!["required", "optional"].includes(policy.workflow.grounding))
      fail("foundation.json workflow.grounding must be required|optional");
    if (!["legacy", "full-delta"].includes(policy.workflow.reviewCircuit))
      fail("foundation.json workflow.reviewCircuit must be legacy|full-delta");
    if (!["legacy", "risk-tiered"].includes(policy.workflow.reviewPolicy))
      fail("foundation.json workflow.reviewPolicy must be legacy|risk-tiered");
    if (typeof policy.workflow.handoffDefaultOwner !== "string" ||
        !policy.workflow.handoffDefaultOwner.trim())
      fail("foundation.json workflow.handoffDefaultOwner must be a non-empty team name");
  }

  function configuredFallbackReviewers(policy, configured) {
    const legacyFallback = policy.review.fallbackReviewer;
    if (legacyFallback !== undefined && legacyFallback !== null &&
        legacyFallback !== "main-session")
      fail("foundation.json review.fallbackReviewer must be main-session");
    if (legacyFallback && configured.review?.fallbackReviewers !== undefined)
      fail("foundation.json review must use fallbackReviewer or fallbackReviewers, not both");
    return configured.review?.fallbackReviewers !== undefined
      ? policy.review.fallbackReviewers
      : legacyFallback ? [legacyFallback] : [];
  }

  function validateFallbackReviewers(policy, fallbackReviewers) {
    if (!Array.isArray(fallbackReviewers) || fallbackReviewers.some((name) =>
      typeof name !== "string" || !name.trim()))
      fail("foundation.json review.fallbackReviewers must be an array of reviewer names");
    if (new Set(fallbackReviewers).size !== fallbackReviewers.length)
      fail("foundation.json review.fallbackReviewers must not contain duplicates");
    for (const name of fallbackReviewers)
      if (name !== "main-session" && !policy.review.reviewers[name])
        fail(`foundation.json review.fallbackReviewers names unknown reviewer '${name}'`);
    if (fallbackReviewers.includes(policy.review.defaultReviewer))
      fail("foundation.json review.fallbackReviewers must not repeat review.defaultReviewer");
    const infraFailureThreshold = Number(policy.review.infraFailureThreshold);
    if (!Number.isInteger(infraFailureThreshold) || infraFailureThreshold < 1 ||
        infraFailureThreshold > 5)
      fail("foundation.json review.infraFailureThreshold must be 1..5");
    if (fallbackReviewers.includes("main-session") &&
        policy.review.independence !== "self")
      fail("foundation.json review.fallbackReviewers main-session requires review.independence self");
    return infraFailureThreshold;
  }

  function normalizeReviewFallbacks(policy, configured) {
    if (policy.review.defaultReviewer &&
        !policy.review.reviewers[policy.review.defaultReviewer])
      fail("foundation.json review.defaultReviewer must name a configured reviewer");
    const fallbackReviewers = configuredFallbackReviewers(policy, configured);
    const infraFailureThreshold = validateFallbackReviewers(policy, fallbackReviewers);
    policy.review.fallbackReviewers = fallbackReviewers;
    policy.review.fallbackReviewer = fallbackReviewers.includes("main-session")
      ? "main-session" : undefined;
    policy.review.infraFailureThreshold = infraFailureThreshold;
  }

  function validateReviewer(name, reviewer) {
    if (!["codex-cli", "claude-cli"].includes(reviewer.adapter))
      fail(`foundation.json review.reviewers.${name}.adapter must be codex-cli|claude-cli`);
    for (const field of [
      "executable", "providerFamily", "modelFamily", "modelId",
      "reasoningEffort", "sandbox"
    ])
      if (!String(reviewer[field] || "").trim())
        fail(`foundation.json review.reviewers.${name}.${field} is required`);
    const expectedProvider = reviewer.adapter === "codex-cli" ? "openai" : "anthropic";
    if (String(reviewer.providerFamily).toLowerCase() !== expectedProvider)
      fail(`foundation.json review.reviewers.${name}.providerFamily must be ${expectedProvider} for ${reviewer.adapter}`);
    if (reviewer.reasoningEffort !== "high")
      fail(`foundation.json review.reviewers.${name}.reasoningEffort must be high`);
    if (reviewer.sandbox !== "read-only" || reviewer.ephemeral !== true)
      fail(`foundation.json review.reviewers.${name} must use read-only sandbox and ephemeral true`);
  }

  function validateReviewPolicy(policy, configured) {
    normalizeReviewFallbacks(policy, configured);
    for (const [name, reviewer] of Object.entries(policy.review.reviewers))
      validateReviewer(name, reviewer);
  }

  function validateModelPolicy(policy) {
    for (const tier of ["fast", "standard", "deep"])
      if (!policy.models[tier] || typeof policy.models[tier].family !== "string")
        fail(`foundation.json models.${tier}.family is required`);
    for (const tier of ["fast", "standard", "deep"]) {
      const fallback = policy.models[tier].fallbackTier;
      if (fallback !== null && fallback !== undefined &&
          !["fast", "standard", "deep"].includes(fallback))
        fail(`foundation.json models.${tier}.fallbackTier is invalid`);
      if (tier === "deep" && fallback && fallback !== "deep")
        fail("deep model tier cannot downgrade when unavailable");
    }
  }

  function foundationPolicy() {
    const path = policyPath;
    const configured = existsSync(path) ? readJson(path) : {};
    if (configured.version !== undefined && configured.version !== 1)
      fail("foundation.json requires version 1");
    const policy = mergePolicy(configured);
    normalizeExecutionPolicy(policy);
    validateExecutionPolicy(policy);
    if (!["required", "single-model"].includes(policy.review.diversity))
      fail("foundation.json review.diversity must be required|single-model");
    if (!["required", "self"].includes(policy.review.independence))
      fail("foundation.json review.independence must be required|self");
    validateWorkflowPolicy(policy);
    validateReviewPolicy(policy, configured);
    if (typeof policy.telemetry.requireUsage !== "boolean")
      fail("foundation.json telemetry.requireUsage must be boolean");
    if (typeof policy.land.riskBasedCi !== "boolean")
      fail("foundation.json land.riskBasedCi must be boolean");
    validateModelPolicy(policy);
    return policy;
  }

  return {
    protocolDescriptor,
    commandExists,
    playwrightAvailability,
    foundationPolicy,
reviewAssurancePosture: (effectiveReview = null) =>
  reviewAssurancePosture(foundationPolicy(), effectiveReview)
  };
}
