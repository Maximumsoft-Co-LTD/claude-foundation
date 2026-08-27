export function shellMutationViolation(phase, environment) {
  if (phase === "prove" || phase === "change")
    return `${phase === "prove" ? "Prove" : "Change"} cannot run mutating shell commands`;
  if (phase === "land" && environment.FOUNDATION_LAND_TRANSACTION !== "1")
    return "Land shell mutations require the runtime transaction marker";
  if (phase === "build" && !environment.FOUNDATION_WORKSPACE_ROOT)
    return "Build shell mutations require an isolated workspace";
  return null;
}
