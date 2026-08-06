#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const providers = [
  { id: "anthropic", family: "messages", apiVersion: "2023-06-01" },
  { id: "openai", family: "responses", apiVersion: "v1" },
];

const groups = [
  ["roles-history", ["roles", "system", "developer", "user-assistant-history", "unsupported-role-transform"]],
  ["reasoning-replay", ["reasoning", "reasoning-signature", "redacted-reasoning", "missing-reasoning-resume"]],
  ["parallel-partial-tools", ["tools", "one-tool", "parallel-tools", "interleaved-deltas", "partial-json", "empty-arguments", "malformed-arguments", "tool-error"]],
  ["tool-result-media", ["tools", "tool-result-text", "tool-result-file", "tool-result-image"]],
  ["stream-edge", ["streaming", "split-utf8", "unknown-optional-event", "duplicate-frame", "out-of-order-frame", "clean-end"]],
  ["truncated-cancellation", ["streaming", "truncated-stream", "cancel-before-commit", "cancel-after-commit", "interrupted-tool-terminal"]],
  ["limits-artifacts", ["limits", "context-overflow", "maximum-output", "provider-truncation", "oversized-tool-result", "artifact-promotion"]],
  ["cache-accounting", ["caching", "cache-request", "cache-hit", "cache-write", "cache-read", "unsupported-cache", "accounting", "partial-usage", "quota-reset", "currency-source"]],
  ["auth-permission-errors", ["errors", "authentication", "permission", "invalid-request", "provider-unknown"]],
  ["model-lifecycle", ["errors", "model-unavailable", "model-deprecated", "capability-status"]],
  ["transient-errors", ["errors", "rate-limit", "timeout", "overload", "transport-failure"]],
  ["history-compaction", ["replay", "multi-turn", "tool-replay", "reasoning-resume", "compaction-boundary"]],
  ["fallback-precommit", ["fallback", "safe-precommit"]],
  ["fallback-committed", ["fallback", "deny-after-output", "deny-after-mutation"]],
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function wire(provider, group) {
  if (provider === "anthropic") {
    if (["auth-permission-errors", "model-lifecycle", "transient-errors"].includes(group)) {
      const type = group === "transient-errors" ? "overloaded_error" : group === "model-lifecycle" ? "not_found_error" : "authentication_error";
      const value = { type: "error", error: { type, message: `<REDACTED_${group.toUpperCase()}>` } };
      return [`event: error\ndata: ${JSON.stringify(value)}\n\n`];
    }
    const frames = [
      { type: "message_start", message: { id: `msg_${group}`, usage: { input_tokens: 11, output_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } },
    ];
    if (group === "reasoning-replay") frames.push(
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "inspect" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_TEST_ONLY_1" } },
    );
    else if (group === "parallel-partial-tools") frames.push(
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_a", name: "read" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool_b", name: "search" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"path\":" } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"README.md\"}" } },
      { type: "content_block_stop", index: 1 }, { type: "content_block_stop", index: 0 },
    );
    else frames.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `ok:${group}` } });
    frames.push({ type: "message_delta", delta: { stop_reason: group.includes("tools") ? "tool_use" : group === "limits-artifacts" ? "max_tokens" : "end_turn" }, usage: { output_tokens: 7, output_tokens_details: { reasoning_tokens: group === "reasoning-replay" ? 2 : 0 } } });
    if (group !== "truncated-cancellation") frames.push({ type: "message_stop" });
    return frames.map((value) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  }
  if (["auth-permission-errors", "model-lifecycle", "transient-errors"].includes(group)) {
    const code = group === "transient-errors" ? "overloaded_error" : group === "model-lifecycle" ? "model_not_found" : "authentication_error";
    const value = { type: "error", code, message: `<REDACTED_${group.toUpperCase()}>` };
    return [`event: error\ndata: ${JSON.stringify(value)}\n\n`];
  }
  const frames = [];
  if (group === "reasoning-replay") frames.push({ type: "response.reasoning_text.delta", delta: "inspect" });
  else if (group === "parallel-partial-tools") frames.push(
    { type: "response.output_item.added", item: { type: "function_call", id: "tool_a", name: "read" } },
    { type: "response.output_item.added", item: { type: "function_call", id: "tool_b", name: "search" } },
    { type: "response.function_call_arguments.delta", item_id: "tool_a", delta: "{\"path\":" },
    { type: "response.function_call_arguments.delta", item_id: "tool_b", delta: "{}" },
    { type: "response.function_call_arguments.done", item_id: "tool_b", arguments: "{}" },
    { type: "response.function_call_arguments.done", item_id: "tool_a", arguments: "{\"path\":\"README.md\"}" },
  );
  else frames.push({ type: "response.output_text.delta", delta: `ok:${group}` });
  if (group !== "truncated-cancellation") {
    const type = group === "limits-artifacts" ? "response.incomplete" : "response.completed";
    frames.push({ type, response: { id: `resp_${group}`, usage: { input_tokens: 11, output_tokens: 7, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: group === "reasoning-replay" ? 2 : 0 } } } });
  }
  return frames.map((value) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
}

function request(provider, group) {
  if (provider === "anthropic") {
    const resultContent = group === "tool-result-media" ? [{ role: "user", content: [{
      type: "tool_result", tool_use_id: "tool_media", is_error: false,
      content: [{ type: "text", text: "artifact result" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "<REDACTED_ARTIFACT_BYTES>" } }],
    }] }] : [];
    return {
    model: "claude-test", max_tokens: 256, stream: true,
    system: [{ type: "text", text: "<REDACTED_USER_CONTENT>", ...(group === "cache-accounting" ? { cache_control: { type: "ephemeral" } } : {}) }],
    messages: [{ role: "user", content: [{ type: "text", text: group }] }, { role: "assistant", content: [{ type: "text", text: "history" }] }, ...resultContent],
    tools: [{ name: "read", description: "read", input_schema: { type: "object" } }],
    metadata: { replay_signature: group === "reasoning-replay" ? "sig_TEST_ONLY_1" : null, compaction_boundary: group === "history-compaction" ? "compact_TEST_ONLY_1" : null },
  };
  }
  const resultInput = group === "tool-result-media" ? [{ type: "function_call_output", call_id: "tool_media", output: [{ type: "input_text", text: "artifact result" }, { type: "input_image", image_url: "artifact://sha256/IMAGE_TEST_ONLY" }, { type: "input_file", file_id: "artifact_FILE_TEST_ONLY" }] }] : [];
  return {
    model: "gpt-test", stream: true, store: false, max_output_tokens: 256,
    input: [{ role: "developer", content: [{ type: "input_text", text: "<REDACTED_USER_CONTENT>" }] }, { role: "user", content: [{ type: "input_text", text: group }] }, { role: "assistant", content: [{ type: "output_text", text: "history" }] }, ...resultInput],
    tools: [{ type: "function", name: "read", strict: true, parameters: { type: "object" } }],
    previous_response_id: group === "reasoning-replay" ? "resp_TEST_ONLY_1" : null,
    prompt_cache_key: group === "cache-accounting" ? "cache_TEST_ONLY_1" : null,
    metadata: { compaction_boundary: group === "history-compaction" ? "compact_TEST_ONLY_1" : null },
  };
}

// Reasoning state is tagged with the identity that issued it. The Rust corpus
// test parses with this same fixture identity, so the two must stay in step.
const REASONING_IDENTITY = { provider: "anthropic", account: "fixture-account", model: "test-model" };
const known = (value) => ({ state: "known", value });
const unknown = (reason) => ({ state: "unknown", value: { reason } });
function accounting(requestId, usage) {
  return {
    pricing_catalog_version: "unpriced", pricing_source: "provider_usage_only",
    provider_request_id: requestId ? known(requestId) : unknown("request ID omitted"),
    tokens: {
      input: usage.input_tokens === undefined ? unknown("input_tokens omitted") : known(usage.input_tokens),
      output: usage.output_tokens === undefined ? unknown("output_tokens omitted") : known(usage.output_tokens),
      cache_read: usage.cache_read_input_tokens !== undefined ? known(usage.cache_read_input_tokens) : usage.input_tokens_details?.cached_tokens !== undefined ? known(usage.input_tokens_details.cached_tokens) : unknown("cache usage omitted"),
      cache_write: usage.cache_creation_input_tokens === undefined ? unknown("cache write usage omitted") : known(usage.cache_creation_input_tokens),
      reasoning: usage.output_tokens_details?.reasoning_tokens === undefined ? unknown("reasoning usage omitted") : known(usage.output_tokens_details.reasoning_tokens),
    },
    estimated_cost: unknown("pricing catalog not injected"),
    provider_reported_cost: unknown("provider did not report cost"),
    quota_remaining: unknown("quota header not persisted in stream"),
    quota_reset_at_ms: unknown("quota reset header not persisted in stream"),
  };
}

function normalize(provider, wires) {
  const values = wires.map((wire) => JSON.parse(wire.split("\ndata: ")[1].trim()));
  const events = [];
  if (provider === "anthropic") {
    let responseId = "";
    const tools = new Map();
    let finish = "unknown";
    for (const value of values) {
      if (value.type === "message_start") {
        responseId = value.message.id;
        events.push({ type: "usage", data: { accounting: accounting(responseId, value.message.usage) } });
      } else if (value.type === "content_block_start" && value.content_block.type === "tool_use") {
        tools.set(value.index, { id: value.content_block.id, args: "" });
        events.push({ type: "tool_call_started", data: { id: value.content_block.id, name: value.content_block.name } });
      } else if (value.type === "content_block_delta" && value.delta.type === "text_delta") {
        events.push({ type: "output_delta", data: { text: value.delta.text } });
      } else if (value.type === "content_block_delta" && value.delta.type === "thinking_delta") {
        events.push({ type: "reasoning_delta", data: { text: value.delta.thinking, replay: null } });
      } else if (value.type === "content_block_delta" && value.delta.type === "signature_delta") {
        events.push({ type: "reasoning_delta", data: { text: "", replay: { identity: REASONING_IDENTITY, raw: { provider: "anthropic", reasoning_signature: value.delta.signature } } } });
      } else if (value.type === "content_block_delta" && value.delta.type === "input_json_delta") {
        const tool = tools.get(value.index); tool.args += value.delta.partial_json;
        events.push({ type: "tool_arguments_delta", data: { id: tool.id, json_fragment: value.delta.partial_json } });
      } else if (value.type === "content_block_stop") {
        const tool = tools.get(value.index); tools.delete(value.index);
        events.push({ type: "tool_call_completed", data: { id: tool.id, arguments: JSON.parse(tool.args) } });
      } else if (value.type === "message_delta") {
        finish = ({ end_turn: "stop", max_tokens: "length", tool_use: "tool_calls" })[value.delta.stop_reason] ?? "unknown";
        events.push({ type: "usage", data: { accounting: accounting(responseId, value.usage) } });
      } else if (value.type === "message_stop") {
        events.push({ type: "completed", data: { response_id: responseId, finish_reason: finish } });
      }
    }
  } else {
    for (const value of values) {
      if (value.type === "response.output_text.delta") events.push({ type: "output_delta", data: { text: value.delta } });
      else if (value.type === "response.reasoning_text.delta") events.push({ type: "reasoning_delta", data: { text: value.delta, replay: null } });
      else if (value.type === "response.output_item.added" && value.item.type === "function_call") events.push({ type: "tool_call_started", data: { id: value.item.id, name: value.item.name } });
      else if (value.type === "response.function_call_arguments.delta") events.push({ type: "tool_arguments_delta", data: { id: value.item_id, json_fragment: value.delta } });
      else if (value.type === "response.function_call_arguments.done") events.push({ type: "tool_call_completed", data: { id: value.item_id, arguments: JSON.parse(value.arguments) } });
      else if (value.type === "response.completed") {
        events.push({ type: "usage", data: { accounting: accounting(value.response.id, value.response.usage) } });
        events.push({ type: "completed", data: { response_id: value.response.id, finish_reason: "stop" } });
      } else if (value.type === "response.incomplete") events.push({ type: "completed", data: { response_id: value.response.id, finish_reason: "length" } });
    }
  }
  return events;
}

async function main() {
  const artifactBodies = [
    { kind: "file", mimeType: "text/plain", bytes: Buffer.from("synthetic promoted provider output\n") },
    { kind: "image", mimeType: "image/png", bytes: Buffer.from("synthetic-png-placeholder") },
  ];
  const artifacts = [];
  for (const artifact of artifactBodies) {
    const hash = digest(artifact.bytes);
    const relativePath = `shared/${artifact.kind}s/${hash}`;
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, artifact.bytes);
    artifacts.push({ sha256: hash, byteCount: artifact.bytes.length, mimeType: artifact.mimeType, path: relativePath, quarantined: artifact.kind === "image" });
  }
  const cases = [];
  for (const provider of providers) {
    for (const [group, tags] of groups) {
      const base = `${provider.id}/${provider.family}/${group}`;
      const requestText = `${canonical(request(provider.id, group))}\n`;
      const wires = wire(provider.id, group);
      const streamText = wires.map((chunk, sequence) => canonical({ sequence, wire: chunk })).join("\n") + "\n";
      const expected = {
        equivalenceGroup: group,
        parser: provider.id,
        terminal: ["auth-permission-errors", "model-lifecycle", "transient-errors"].includes(group) ? "error" : group === "truncated-cancellation" ? "cancelled" : group === "limits-artifacts" ? "length" : "completed",
        exactEvents: normalize(provider.id, wires),
        exactError: ["auth-permission-errors", "model-lifecycle", "transient-errors"].includes(group) ? "provider" : null,
        invariants: tags,
      };
      const expectedText = `${canonical(expected)}\n`;
      for (const [name, text] of [["request.json", requestText], ["stream.jsonl", streamText], ["expected.json", expectedText]]) {
        const path = join(root, base, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text);
      }
      cases.push({
        id: `${provider.id}.${group}.v1`, provider: provider.id, apiFamily: provider.family,
        fixtureKind: "synthetic", requestPath: `${base}/request.json`, requestSha256: digest(requestText),
        streamPath: `${base}/stream.jsonl`, streamSha256: digest(streamText),
        expectedPath: `${base}/expected.json`, expectedSha256: digest(expectedText),
        protocolVersion: 1, capabilityProfile: "native-test-v1",
        expectedTerminalClassification: expected.terminal, tags,
        equivalenceGroup: group, providerApiVersion: provider.apiVersion,
        adapterVersion: "changeloop-provider-adapters/0.1.0",
        providerRequestIdShape: provider.id === "anthropic" ? "msg_<CASE>" : "resp_<CASE>",
        captureProvenance: "hand-authored synthetic; no live credentials",
      });
    }
  }
  const manifest = {
    schemaVersion: 1, corpusVersion: "1.0.0", capturedAt: null,
    sourceRevision: "m3-provider-contract-v1", redactionProfile: "provider-fixture-redaction-v1",
    pricingCatalogVersion: null, liveDriftPolicy: "scheduled-live-invariants-only",
    artifacts, cases,
  };
  await writeFile(join(root, "manifest.json"), `${canonical(manifest)}\n`);
}

await main();
