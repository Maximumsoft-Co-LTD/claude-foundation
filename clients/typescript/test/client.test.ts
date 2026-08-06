import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  ChangeloopClient,
  ChangeloopError,
  BackpressureError,
  CompatibilityError,
  INTERFACE_MATURITY,
  MUTATION_TOOL_SCHEMA_VERSION,
  type ApplyPatchRequest,
  type ApplyPatchResult,
  type DeleteFileRequest,
  type DeleteFileResult,
  type JobCancelRequest,
  type JobCancelResult,
  type JobStatusRequest,
  type JobStatusResult,
  type JobStdinRequest,
  type JobStdinResult,
  type ProcessToolRequest,
  type ProcessToolResult,
  type RenameFileRequest,
  type RenameFileResult,
  type ReadFileRequest,
  type ReadFileResult,
  type ServerFrame,
  type SpawnJobRequest,
  type SpawnJobResult,
  type WriteCheckVerdict,
  type WriteFileRequest,
  type WriteFileResult,
} from "../src/index.js";

const TOKEN = "sdk-fixture-token";
const ORIGIN = "http://sdk.fixture";

test("generated mutation tool contracts expose the pinned v1 shape", () => {
  const readRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    path: "src/input.ts",
    max_bytes: 4096,
  } satisfies ReadFileRequest;
  const writeRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    path: "src/output.ts",
    content: "export {};",
  } satisfies WriteFileRequest;
  const patchRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    path: "src/output.ts",
    expected_sha256: "c".repeat(64),
    replacement: "export const value = 1;",
  } satisfies ApplyPatchRequest;
  const deleteRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    path: "src/old.ts",
    expected_sha256: "a".repeat(64),
  } satisfies DeleteFileRequest;
  const renameRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    path: "src/old.ts",
    destination: "src/new.ts",
    expected_sha256: "b".repeat(64),
  } satisfies RenameFileRequest;
  const deleteResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    sha256: "a".repeat(64),
    deleted: true,
    checkpointId: "checkpoint-delete",
    proofImpact: { invalidatedPaths: ["src/old.ts"], requiresReprove: true },
  } satisfies DeleteFileResult;
  const renameResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    sha256: "b".repeat(64),
    source: "src/old.ts",
    destination: "src/new.ts",
    checkpointId: "checkpoint-rename",
    formatter: [],
    proofImpact: {
      invalidatedPaths: ["src/new.ts", "src/old.ts"],
      requiresReprove: true,
    },
  } satisfies RenameFileResult;
  const readResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    sha256: "d".repeat(64),
    byteLength: 11,
    content: "export {};",
    artifact: null,
  } satisfies ReadFileResult;
  const failedChecker = {
    status: "checked",
    runs: [
      {
        name: "tsc",
        stage: "check",
        outcome: "failed",
        exitCode: 2,
        diagnostics: "src/output.ts(1,1): error TS1005",
      },
    ],
  } satisfies WriteCheckVerdict;
  const writeResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    sha256: "e".repeat(64),
    checkpointId: "checkpoint-write",
    formatter: [],
    checker: { status: "not_configured", runs: [] },
    proofImpact: { invalidatedPaths: ["src/output.ts"], requiresReprove: true },
  } satisfies WriteFileResult;
  const patchResult = {
    ...writeResult,
    sha256: "f".repeat(64),
    checkpointId: "checkpoint-patch",
    checker: failedChecker,
  } satisfies ApplyPatchResult;

  assert.equal(readRequest.schema_version, 1);
  assert.equal(writeRequest.schema_version, 1);
  assert.equal(patchRequest.schema_version, 1);
  assert.equal(deleteRequest.schema_version, 1);
  assert.equal(renameRequest.schema_version, 1);
  assert.equal(deleteResult.schemaVersion, 1);
  assert.equal(renameResult.schemaVersion, 1);
  assert.equal(readResult.schemaVersion, 1);
  assert.equal(writeResult.schemaVersion, 1);
  assert.equal(patchResult.schemaVersion, 1);
  // A checker verdict is always attached, and a failed check is readable
  // without parsing diagnostics prose.
  assert.equal(writeResult.checker.status, "not_configured");
  assert.equal(patchResult.checker.status, "checked");
  assert.equal(patchResult.checker.runs[0]?.outcome, "failed");
});

test("generated process and job contracts expose explicit bounded v1 shapes", () => {
  const processRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    program: "/usr/bin/printf",
    arguments: ["ok"],
    environment: { LANG: "C" },
    timeout_ms: 1_000,
    sandbox: "best_effort",
    inline_bytes: 1_024,
    artifact_bytes: 4_096,
  } satisfies ProcessToolRequest;
  const processResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    exitCode: 0,
    success: true,
    stdout: "ok",
    stderr: "",
    stdoutArtifact: null,
    stderrArtifact: null,
    stdoutBytes: 2,
    stderrBytes: 0,
    truncated: false,
    filteredEnvironment: [],
    provenance: "tool-output",
  } satisfies ProcessToolResult;
  const spawnRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    program: "tools/job",
    arguments: [],
    environment: {},
    pty: true,
  } satisfies SpawnJobRequest;
  const spawnResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    jobId: "job-1",
    owned: true,
  } satisfies SpawnJobResult;
  const statusRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    id: "job-1",
  } satisfies JobStatusRequest;
  const statusResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    id: "job-1",
    kind: "pty",
    state: "running",
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    truncated: false,
  } satisfies JobStatusResult;
  const stdinRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    id: "job-1",
    input: "hello\n",
  } satisfies JobStdinRequest;
  const stdinResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    written: 6,
  } satisfies JobStdinResult;
  const cancelRequest = {
    schema_version: MUTATION_TOOL_SCHEMA_VERSION,
    id: "job-1",
  } satisfies JobCancelRequest;
  const cancelResult = {
    schemaVersion: MUTATION_TOOL_SCHEMA_VERSION,
    cancelled: true,
  } satisfies JobCancelResult;

  for (const value of [
    processRequest.schema_version,
    processResult.schemaVersion,
    spawnRequest.schema_version,
    spawnResult.schemaVersion,
    statusRequest.schema_version,
    statusResult.schemaVersion,
    stdinRequest.schema_version,
    stdinResult.schemaVersion,
    cancelRequest.schema_version,
    cancelResult.schemaVersion,
  ]) assert.equal(value, 1);
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    response.setHeader("x-changeloop-protocol", "1.0");
    response.setHeader("x-changeloop-maturity", "beta");
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

function authorize(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.headers.authorization !== `Bearer ${TOKEN}` || request.headers.origin !== ORIGIN) {
    response.writeHead(403).end("forbidden");
    return false;
  }
  return true;
}

test("typed RPC sends strict auth/origin metadata and checks response IDs", async () => {
  const fixture = await listen((request, response) => {
    if (!authorize(request, response)) return;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => body += chunk);
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: string; method: string };
      assert.equal(request.headers["x-changeloop-protocol"], "1.0");
      assert.equal(rpc.method, "status");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: rpc.id, ok: true, result: { protocol: { major: 1, minor: 4 }, ready: true } }));
    });
  });
  try {
    const client = new ChangeloopClient({ baseUrl: fixture.baseUrl, token: TOKEN, origin: ORIGIN });
    assert.deepEqual(await client.status(), { protocol: { major: 1, minor: 4 }, ready: true });
  } finally {
    await fixture.close();
  }
});

test("protocol major incompatibility and authorization failures are typed", async () => {
  const fixture = await listen((request, response) => {
    if (!authorize(request, response)) return;
    let body = "";
    request.on("data", (chunk: Buffer) => body += chunk.toString());
    request.on("end", () => {
      const { id } = JSON.parse(body) as { id: string };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id, ok: true, result: { protocol: { major: 2, minor: 0 }, ready: true } }));
    });
  });
  try {
    const incompatible = new ChangeloopClient({ baseUrl: fixture.baseUrl, token: TOKEN, origin: ORIGIN });
    await assert.rejects(incompatible.status(), CompatibilityError);
    const unauthorized = new ChangeloopClient({ baseUrl: fixture.baseUrl, token: "wrong", origin: ORIGIN });
    await assert.rejects(unauthorized.status(), (error: unknown) =>
      error instanceof ChangeloopError && error.code === "unauthorized" && error.status === 403);
  } finally {
    await fixture.close();
  }
});

test("constructor and protocol headers fail closed", async () => {
  assert.throws(
    () => new ChangeloopClient({ baseUrl: "file:///tmp/socket", token: TOKEN, origin: ORIGIN }),
    (error: unknown) => error instanceof ChangeloopError && error.code === "invalid_baseUrl",
  );
  assert.throws(
    () => new ChangeloopClient({ baseUrl: "http://localhost", token: "bad\ntoken", origin: ORIGIN }),
    (error: unknown) => error instanceof ChangeloopError && error.code === "invalid_token",
  );
  assert.throws(
    () => new ChangeloopClient({ baseUrl: "http://localhost", token: TOKEN, origin: `${ORIGIN}/path` }),
    (error: unknown) => error instanceof ChangeloopError && error.code === "invalid_origin",
  );
  assert.throws(
    () => new ChangeloopClient({ baseUrl: "http://localhost?smuggled=1", token: TOKEN, origin: ORIGIN }),
    (error: unknown) => error instanceof ChangeloopError && error.code === "invalid_baseUrl",
  );

  const maturityFixture = await listen((request, response) => {
    if (!authorize(request, response)) return;
    let body = "";
    request.on("data", (chunk: Buffer) => body += chunk.toString());
    request.on("end", () => {
      const { id } = JSON.parse(body) as { id: string };
      response.end(JSON.stringify({ id, ok: true, result: { protocol: { major: 1, minor: 0 }, ready: true } }));
    });
  });
  try {
    const stableClient = new ChangeloopClient({
      baseUrl: maturityFixture.baseUrl,
      token: TOKEN,
      origin: ORIGIN,
      minimumMaturity: "stable",
    });
    await assert.rejects(stableClient.status(), (error: unknown) =>
      error instanceof ChangeloopError && error.code === "maturity_unavailable");
  } finally {
    await maturityFixture.close();
  }

  const server = createServer((_request, response) => {
    response.setHeader("x-changeloop-protocol", "1.0.0");
    response.setHeader("x-changeloop-maturity", "beta");
    response.end(JSON.stringify({ id: "sdk-1", ok: true, result: { protocol: { major: 1, minor: 0 }, ready: true } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  try {
    const client = new ChangeloopClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: TOKEN, origin: ORIGIN });
    await assert.rejects(client.status(), (error: unknown) =>
      error instanceof ChangeloopError && error.code === "invalid_protocol_header");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("SSE reconnect uses the last persisted cursor and abort cancels the stream", async () => {
  let connections = 0;
  const fixture = await listen((request, response) => {
    if (!authorize(request, response)) return;
    const url = new URL(request.url ?? "/", "http://fixture");
    assert.equal(url.pathname, "/events");
    response.writeHead(200, { "content-type": "text/event-stream" });
    connections += 1;
    const cursor = `e:${String(connections).padStart(20, "0")}`;
    if (connections === 2) assert.equal(url.searchParams.get("after"), "e:00000000000000000001");
    const frame: ServerFrame = {
      sequence: connections,
      payload: {
        type: "event",
        data: {
          protocol_version: { major: 1, minor: 0 },
          id: `event-${connections}`,
          cursor,
          session_id: "session",
          emitted_at_ms: connections,
          event: { type: "heartbeat" },
        },
      },
    };
    response.write(`id: ${connections}\r\nevent: frame\r\ndata: ${JSON.stringify(frame)}\r\n\r\n`);
    response.end();
  });
  const controller = new AbortController();
  try {
    const client = new ChangeloopClient({ baseUrl: fixture.baseUrl, token: TOKEN, origin: ORIGIN });
    const cursors: string[] = [];
    for await (const frame of client.events("session", {
      signal: controller.signal,
      reconnectDelayMs: 1,
      maxReconnectAttempts: 2,
    })) {
      if (frame.payload.type === "event") cursors.push(frame.payload.data.cursor);
      if (cursors.length === 2) controller.abort();
    }
    assert.deepEqual(cursors, ["e:00000000000000000001", "e:00000000000000000002"]);
    assert.equal(connections, 2);
  } finally {
    controller.abort();
    await fixture.close();
  }
});

test("SSE suppresses a replayed boundary event and exposes maturity labels", async () => {
  let connections = 0;
  const cursor = "e:00000000000000000001";
  const fixture = await listen((request, response) => {
    if (!authorize(request, response)) return;
    connections += 1;
    const frame: ServerFrame = {
      sequence: 1,
      payload: {
        type: "event",
        data: {
          protocol_version: { major: 1, minor: connections },
          id: `event-${connections}`,
          cursor,
          session_id: "session",
          emitted_at_ms: connections,
          event: { type: "heartbeat" },
        },
      },
    };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify(frame)}\n\n`);
  });
  try {
    const client = new ChangeloopClient({ baseUrl: fixture.baseUrl, token: TOKEN, origin: ORIGIN });
    const seen: string[] = [];
    for await (const frame of client.events("session", { maxReconnectAttempts: 1, reconnectDelayMs: 0 })) {
      if (frame.payload.type === "event") seen.push(frame.payload.data.cursor);
    }
    assert.deepEqual(seen, [cursor]);
    assert.equal(connections, 2);
    assert.deepEqual(INTERFACE_MATURITY, { protocol: "beta", sdk: "beta", cli: "experimental" });
  } finally {
    await fixture.close();
  }
});

test("HTTP backpressure is typed and does not retry a mutating RPC", async () => {
  let requests = 0;
  const fixture = await listen((request, response) => {
    if (!authorize(request, response)) return;
    requests += 1;
    request.resume();
    response.writeHead(429, { "content-type": "text/plain" });
    response.end("reconnect with cursor");
  });
  try {
    const client = new ChangeloopClient({ baseUrl: fixture.baseUrl, token: TOKEN, origin: ORIGIN });
    await assert.rejects(client.run("must not replay"), BackpressureError);
    assert.equal(requests, 1);
  } finally {
    await fixture.close();
  }
});

test("SDK exercises authenticated RPC against the real cloop HTTP server", async (context) => {
  const binary = resolve("../../target/debug/cloop");
  if (!existsSync(binary)) return context.skip("cloop binary is unavailable");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("failed to reserve port");
  const port = address.port;
  reservation.close();
  await once(reservation, "close");
  const directory = await mkdtemp(resolve(tmpdir(), "changeloop-sdk-"));
  const server = spawn(binary, ["serve", "--http", `127.0.0.1:${port}`], {
    cwd: directory,
    env: {
      ...process.env,
      CHANGELOOP_CONFIG_HOME: resolve(directory, "config"),
      CHANGELOOP_SERVER_TOKEN: TOKEN,
      CHANGELOOP_ALLOWED_ORIGIN: ORIGIN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  const collectServerOutput = (chunk: Buffer) => {
    if (serverOutput.length < 64 * 1024) {
      serverOutput += chunk.toString("utf8").slice(0, 64 * 1024 - serverOutput.length);
    }
  };
  server.stdout.on("data", collectServerOutput);
  server.stderr.on("data", collectServerOutput);
  const client = new ChangeloopClient({ baseUrl: `http://127.0.0.1:${port}`, token: TOKEN, origin: ORIGIN });
  try {
    let status: Awaited<ReturnType<typeof client.status>> | undefined;
    let startupError: unknown;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        status = await client.status();
        break;
      } catch (error) {
        startupError = error;
        if (server.exitCode !== null) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    if (!status) {
      const detail = serverOutput.trim();
      throw new Error(
        `cloop HTTP server did not become ready${detail ? `: ${detail}` : ""}`,
        { cause: startupError },
      );
    }
    assert.equal(status?.ready, true);
    assert.equal(status?.protocol.major, 1);
    assert.deepEqual(await client.cancel(), { cancelled: true });
    await assert.rejects(client.cancelOperation("not-active"), (error: unknown) =>
      error instanceof ChangeloopError && error.code === "invalid_request");
    const wrongOrigin = new ChangeloopClient({
      baseUrl: `http://127.0.0.1:${port}`,
      token: TOKEN,
      origin: "http://wrong.fixture",
    });
    await assert.rejects(wrongOrigin.status(), (error: unknown) =>
      error instanceof ChangeloopError && error.code === "unauthorized");

    const draft = await client.rpc<{ sessionId: string }>("change.draft", { prompt: "SDK transport fixture" });
    const replay = await client.replay(draft.sessionId, { limit: 10 });
    assert.deepEqual(replay.events, []);
    const streamController = new AbortController();
    const events = client.events(draft.sessionId, {
      signal: streamController.signal,
      maxReconnectAttempts: 0,
    });
    const first = await Promise.race([
      events.next(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("real SSE heartbeat timed out")), 1_000)),
    ]);
    assert.equal(first.value?.payload.type, "heartbeat");
    streamController.abort();
    await events.return(undefined);
  } finally {
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
