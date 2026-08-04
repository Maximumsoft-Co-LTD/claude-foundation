import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OPEN_STATUSES = new Set(["requested", "dispatched", "pending"]);
const RESPONSE_STATUSES = new Set(["pass", "fail", "inconclusive", "error"]);
const MULTI_VALUE_EVIDENCE = [
  "artifact", "artifacts", "reference", "criterion", "scope-path", "subject-provenance"
];

export function createAuthorityStore({ root, protocolVersion, readJson, writeJson, now }) {
  const requestRoot = (id) => join(root, id);

  function list(id) {
    const directory = requestRoot(id);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => ({
        path: join(directory, entry.name),
        value: readJson(join(directory, entry.name), {})
      }))
      .filter((entry) => String(entry.value.version) === protocolVersion)
      .sort((left, right) =>
        String(left.value.requestedAt).localeCompare(String(right.value.requestedAt)));
  }

  function writeRequest(id, request) {
    const path = join(requestRoot(id), `${request.requestId}.json`);
    writeJson(path, request);
    return path;
  }

  function status(id, workspaceHash, requestId = null) {
    const rows = list(id)
      .filter((entry) => !requestId || entry.value.requestId === requestId)
      .map((entry) => {
        const value = { ...entry.value };
        if (OPEN_STATUSES.has(value.status)) {
          if (value.workspaceHash !== workspaceHash) value.status = "stale";
          else if (Date.parse(value.expiresAt || "") <= Date.now()) value.status = "expired";
          if (value.status !== entry.value.status) writeJson(entry.path, value);
        }
        return value;
      });
    return {
      found: !requestId || rows.length > 0,
      value: {
        version: Number(protocolVersion), changeId: id, workspaceHash, requests: rows
      }
    };
  }

  function validateResponse(response, request, changeId) {
    if (String(response?.version) !== protocolVersion ||
        response.requestId !== request.requestId || response.changeId !== changeId ||
        response.type !== request.type || response.workspaceHash !== request.workspaceHash)
      return { valid: false, reason: "authority response does not match the request and workspace" };
    if (!RESPONSE_STATUSES.has(response.status))
      return { valid: false, reason: "authority response status must be pass|fail|inconclusive|error" };
    const evidence = response.evidence && typeof response.evidence === "object"
      ? { ...response.evidence } : {};
    for (const key of MULTI_VALUE_EVIDENCE)
      if (evidence[key] !== undefined && !Array.isArray(evidence[key])) evidence[key] = [evidence[key]];
    return { valid: true, status: response.status, evidence };
  }

  function complete(entry, request, response, responseDigest, receiptDigest) {
    writeJson(entry.path, {
      ...request,
      status: response.status === "pass" ? "completed" : "rejected",
      responseDigest,
      receiptDigest,
      completedAt: now()
    });
  }

  return { list, writeRequest, status, validateResponse, complete, isOpen: (statusValue) => OPEN_STATUSES.has(statusValue) };
}
