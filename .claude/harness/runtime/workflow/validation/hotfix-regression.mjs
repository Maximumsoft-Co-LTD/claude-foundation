// A hotfix proves it guards its incident: at least one scenario names the
// incident in `regressionOf`, and that scenario's requirement is proven by a
// repeatable check rather than a one-off review or acceptance verdict.
const NON_EXECUTABLE_CAPABILITIES = new Set(["review", "acceptance", "semantic-acceptance"]);

const text = (value) => typeof value === "string" ? value.trim() : "";

function incidentLink(bugfix) {
  const incident = bugfix?.incident;
  return incident && typeof incident === "object" ? text(incident.link) : text(incident);
}

// `draft` is a normalized semantic draft: `specs[i]` belongs to
// `_requirementKeys[i]`, and `claims` carry each requirement's capabilities.
export function hotfixRegressionIssues(draft) {
  const bugfix = draft?.bugfix;
  if (!bugfix || typeof bugfix !== "object" || text(bugfix.variant).toLowerCase() !== "hotfix")
    return [];
  const link = incidentLink(bugfix);
  // A hotfix without an incident link is already refused by the bugfix
  // validator; repeating it here would only add a second message.
  if (!link) return [];
  const specs = Array.isArray(draft.specs) ? draft.specs : [];
  const keys = Array.isArray(draft._requirementKeys) ? draft._requirementKeys : [];
  const claims = Array.isArray(draft.claims) ? draft.claims : [];
  const marked = [];
  specs.forEach((spec, index) => {
    for (const scenario of Array.isArray(spec?.scenarios) ? spec.scenarios : [])
      if (text(scenario?.regressionOf))
        marked.push({ key: keys[index], regressionOf: text(scenario.regressionOf), name: scenario.name });
  });
  const matching = marked.filter((row) => row.regressionOf === link);
  if (!matching.length) {
    const mismatched = marked.map((row) => `'${row.regressionOf}'`);
    return [`semantic draft hotfix requires a scenario with regressionOf: '${link}' ` +
      "(bugfix.incident.link) that reproduces the incident and fails without the fix" +
      (mismatched.length ? `; found regressionOf ${mismatched.join(", ")}, which must equal '${link}'` : "")];
  }
  const executable = matching.some((row) => claims
    .filter((claim) => claim?.requirementKey === row.key)
    .some((claim) => (claim.capabilities || [])
      .some((capability) => !NON_EXECUTABLE_CAPABILITIES.has(capability))));
  if (!executable)
    return [`semantic draft hotfix regression for '${link}' needs an executable capability ` +
      `on requirement '${matching[0].key}' (for example "test"); review, acceptance, and ` +
      "semantic-acceptance alone cannot be re-run as a regression"];
  return [];
}
