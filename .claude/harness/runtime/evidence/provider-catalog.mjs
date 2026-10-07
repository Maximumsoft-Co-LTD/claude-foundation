export const ADAPTERS = new Set([
  "command", "test-discovery", "playwright", "contract-digest", "external"
]);

export const INPUT_MODES = new Set([
  "browser-automation", "dom-event", "os-input", "both"
]);

export const PROVIDER_CONTRACTS = {
  "test": "Executable behavioral checks for the declared claim.",
  "discovery": "Expected tests were found and the discovered count meets the floor.",
  "browser": "Rendered behavior in a real browser with the required input capability.",
  "mutation": "A deliberate behavioral fault is detected by the evidence suite.",
  "changed-quality": "Changed functions meet complexity, coverage, and CRAP-score policy without regressing from their baseline.",
  "state-identity": "State before, during, or after the change belongs to the intended actor and revision.",
  "integration": "Multiple components or external boundaries work together.",
  "compatibility": "Public or persisted contracts remain compatible across supported versions.",
  "performance": "Measured latency, throughput, resource, or size budgets are met.",
  "security-static": "Static security checks cover the changed trust boundary and unsafe sinks.",
  "cross-repo-contract": "Producer and consumer repositories agree on the same versioned contract.",
  "review": "Independent risk review covers the declared claims and unresolved findings.",
  "acceptance": "A named human accepts an explicitly subjective product or experience decision.",
  "semantic-acceptance": "A signed external oracle verdict covers every declared behavior partition without exposing hidden oracle content.",
  "static-analysis": "Compilation, type checking, linting, and applicable static quality gates pass.",
  "data-migration": "Schema or data evolution is forward-safe, backward-compatible, and rollback-aware.",
  "accessibility": "Rendered semantics, keyboard use, focus, contrast, and assistive access meet policy.",
  "resilience": "Timeout, retry, partial-failure, recovery, and degraded-dependency behavior is proven.",
  "observability": "Required logs, metrics, traces, and alerts expose success and failure safely.",
  "deployment": "Packaging, configuration, rollout health checks, and rollback behavior are proven.",
  "dependency-supply-chain": "Dependency vulnerability, license, lockfile, and provenance policy passes."
};

export const PROVIDERS = new Set(Object.keys(PROVIDER_CONTRACTS));

export function providerCapability(provider, config = null) {
  return config?.capability || (PROVIDERS.has(provider) ? provider : null);
}

// Capabilities whose contract a behavioral test run cannot establish by
// itself: static security analysis, failure injection, version compatibility,
// migration safety, and producer/consumer agreement.
export const SPECIALIST_CAPABILITIES = new Set([
  "security-static", "resilience", "compatibility", "data-migration", "cross-repo-contract"
]);

const sameValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

// The test provider whose execution a specialist provider merely repeats, or
// null. A command provider that runs exactly a test provider's argv, in the
// same repository and environment, with no critical cases of its own, observes
// only those tests: its exit code says nothing about its own capability, so it
// must never be credited as that capability.
export function aliasedTestProvider(providers = {}, provider, config = providers?.[provider]) {
  if (!config || config.adapter !== "command" || !Array.isArray(config.command) ||
      !SPECIALIST_CAPABILITIES.has(providerCapability(provider, config)) ||
      (config.criticalCases || []).length) return null;
  for (const [name, other] of Object.entries(providers || {}).sort(([a], [b]) =>
    (a < b ? -1 : a > b ? 1 : 0))) {
    if (name === provider || providerCapability(name, other) !== "test" ||
        !["command", "test-discovery"].includes(other?.adapter)) continue;
    if (sameValue(other.command, config.command) &&
        sameValue(other.repository, config.repository) &&
        sameValue(other.repositories, config.repositories) &&
        sameValue(other.env, config.env) && sameValue(other.envFrom, config.envFrom))
      return name;
  }
  return null;
}

// The configuration a provider that would only repeat a test run resolves
// to: never executed, naming what it repeated. While review is required the
// required set drops it and records it as `covered-by-review`; when review is
// waived it stays required and needs a project-owned command, verifiable
// external evidence, or its own waiver. Every other configuration is returned
// as is.
export function unobservedAliasConfig(providers, provider, config) {
  const aliasOf = aliasedTestProvider(providers, provider, config);
  if (!aliasOf) return config;
  return {
    adapter: "external",
    capability: providerCapability(provider, config),
    ...(config.claims !== undefined ? { claims: config.claims } : {}),
    ...(config.repository !== undefined ? { repository: config.repository } : {}),
    ...(config.repositories !== undefined ? { repositories: config.repositories } : {}),
    aliasOf
  };
}

// Every configured provider that only repeats a test run, sorted by name:
// `{ provider, capability, aliasOf }`. Review covers these capabilities.
export function reviewCoveredProviders(providers = {}) {
  return Object.keys(providers || {}).sort().flatMap((provider) => {
    const aliasOf = aliasedTestProvider(providers, provider);
    return aliasOf
      ? [{ provider, capability: providerCapability(provider, providers[provider]), aliasOf }]
      : [];
  });
}
