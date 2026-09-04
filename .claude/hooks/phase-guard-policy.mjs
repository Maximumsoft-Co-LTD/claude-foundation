// Compatibility surface for hook tests and third-party host integrations. The
// runtime owns the policy so `exec` and live hooks cannot drift apart.
export {
  looksMutatingShellCommand,
  mutatingShellOperations,
  shellMutationViolation,
} from "../harness/runtime/core/shell-mutation-policy.mjs";
