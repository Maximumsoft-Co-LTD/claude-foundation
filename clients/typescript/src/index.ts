import type { ChangeState } from "../generated/ChangeState.js";
import type { EventCursor } from "../generated/EventCursor.js";
import type { EventEnvelope } from "../generated/EventEnvelope.js";
import type { ProtocolVersion } from "../generated/ProtocolVersion.js";
import type { SessionKind } from "../generated/SessionKind.js";

export type {
  ArtifactId,
} from "../generated/ArtifactId.js";
export type { ArtifactRef } from "../generated/ArtifactRef.js";
export type { ApplyPatchRequest } from "../generated/ApplyPatchRequest.js";
export type { ApplyPatchResult } from "../generated/ApplyPatchResult.js";
export type { ChangeState } from "../generated/ChangeState.js";
export type { DeleteFileRequest } from "../generated/DeleteFileRequest.js";
export type { DeleteFileResult } from "../generated/DeleteFileResult.js";
export type { Event } from "../generated/Event.js";
export type { EventCursor } from "../generated/EventCursor.js";
export type { EventEnvelope } from "../generated/EventEnvelope.js";
export type { EventId } from "../generated/EventId.js";
export type { Message } from "../generated/Message.js";
export type { MessagePart } from "../generated/MessagePart.js";
export type { FormatterMutationResult } from "../generated/FormatterMutationResult.js";
export type { FormatterMutationStatus } from "../generated/FormatterMutationStatus.js";
export type { JobCancelRequest } from "../generated/JobCancelRequest.js";
export type { JobCancelResult } from "../generated/JobCancelResult.js";
export type { JobStatusKind } from "../generated/JobStatusKind.js";
export type { JobStatusRequest } from "../generated/JobStatusRequest.js";
export type { JobStatusResult } from "../generated/JobStatusResult.js";
export type { JobStatusState } from "../generated/JobStatusState.js";
export type { JobStdinRequest } from "../generated/JobStdinRequest.js";
export type { JobStdinResult } from "../generated/JobStdinResult.js";
export type { MutationDiagnostic } from "../generated/MutationDiagnostic.js";
export type { MutationProofImpact } from "../generated/MutationProofImpact.js";
export type { ProcessArtifactOutcome } from "../generated/ProcessArtifactOutcome.js";
export type { ProcessSandbox } from "../generated/ProcessSandbox.js";
export type { ProcessToolRequest } from "../generated/ProcessToolRequest.js";
export type { ProcessToolResult } from "../generated/ProcessToolResult.js";
export type { ProtocolVersion } from "../generated/ProtocolVersion.js";
export type { ReadFileRequest } from "../generated/ReadFileRequest.js";
export type { ReadFileResult } from "../generated/ReadFileResult.js";
export type { RenameFileRequest } from "../generated/RenameFileRequest.js";
export type { RenameFileResult } from "../generated/RenameFileResult.js";
export type { Session } from "../generated/Session.js";
export type { SessionId } from "../generated/SessionId.js";
export type { SessionKind } from "../generated/SessionKind.js";
export type { SpawnJobRequest } from "../generated/SpawnJobRequest.js";
export type { SpawnJobResult } from "../generated/SpawnJobResult.js";
export type { WriteCheckOutcome } from "../generated/WriteCheckOutcome.js";
export type { WriteCheckRun } from "../generated/WriteCheckRun.js";
export type { WriteCheckStage } from "../generated/WriteCheckStage.js";
export type { WriteCheckStatus } from "../generated/WriteCheckStatus.js";
export type { WriteCheckVerdict } from "../generated/WriteCheckVerdict.js";
export type { WriteFileRequest } from "../generated/WriteFileRequest.js";
export type { WriteFileResult } from "../generated/WriteFileResult.js";

export const CURRENT_PROTOCOL_VERSION = { major: 1, minor: 0 } as const satisfies ProtocolVersion;
export const MUTATION_TOOL_SCHEMA_VERSION = 1 as const;
export type InterfaceMaturity = "experimental" | "beta" | "stable";
/** Public maturity labels; changing either value requires release notes and compatibility review. */
export const INTERFACE_MATURITY = {
  protocol: "beta",
  sdk: "beta",
  cli: "experimental",
} as const satisfies Record<"protocol" | "sdk" | "cli", InterfaceMaturity>;

export interface ClientOptions {
  baseUrl: string;
  token: string;
  /** Exact value configured by CHANGELOOP_ALLOWED_ORIGIN. */
  origin: string;
  protocol?: ProtocolVersion;
  /** Reject servers below this public interface maturity. Defaults to beta. */
  minimumMaturity?: InterfaceMaturity;
  fetch?: typeof globalThis.fetch;
}

export interface StatusResult {
  protocol: ProtocolVersion;
  ready: boolean;
  toolContract: { version: string; maturity: InterfaceMaturity };
}

export interface InvocationResult {
  sessionId: string;
  sessionKind: SessionKind;
  changeState: ChangeState | null;
  text: string;
  cursor: EventCursor | null;
}

export interface ReplayResult {
  events: EventEnvelope[];
  nextCursor: EventCursor | null;
  hasMore: boolean;
}

export interface WireError {
  code: string;
  message: string;
}

interface WireResponse<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: WireError;
}

export type ServerFrame =
  | { sequence: number; payload: { type: "event"; data: EventEnvelope } }
  | {
      sequence: number;
      payload: {
        type: "heartbeat";
        data: { emitted_at_ms: number; last_cursor: EventCursor | null };
      };
    };

export interface EventStreamOptions {
  after?: EventCursor;
  signal?: AbortSignal;
  /** Number of reconnects after the initial request. Defaults to unlimited. */
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SSE_FRAME_BYTES = 1024 * 1024;

export class ChangeloopError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChangeloopError";
  }
}

export class CompatibilityError extends ChangeloopError {
  constructor(
    readonly clientProtocol: ProtocolVersion,
    readonly serverProtocol: ProtocolVersion,
  ) {
    super(
      `protocol major mismatch: client ${clientProtocol.major}, server ${serverProtocol.major}`,
      "protocol_major",
    );
    this.name = "CompatibilityError";
  }
}

export class BackpressureError extends ChangeloopError {
  constructor(message = "server disconnected the slow client; reconnect with the last cursor") {
    super(message, "backpressure");
    this.name = "BackpressureError";
  }
}

export class ChangeloopClient {
  readonly protocol: ProtocolVersion;
  readonly baseUrl: string;
  readonly origin: string;
  readonly minimumMaturity: InterfaceMaturity;
  readonly fetch: typeof globalThis.fetch;
  readonly #token: string;
  #nextId = 1;

  constructor(options: ClientOptions) {
    const baseUrl = parseEndpoint(options.baseUrl, "baseUrl");
    const origin = parseEndpoint(options.origin, "origin");
    if (origin.pathname !== "/" || origin.search || origin.hash) {
      throw new ChangeloopError("origin must not include a path, query, or fragment", "invalid_origin");
    }
    if (!options.token || containsControl(options.token)) {
      throw new ChangeloopError("token must be non-empty and contain no control characters", "invalid_token");
    }
    this.baseUrl = baseUrl.href.replace(/\/$/, "");
    this.#token = options.token;
    this.origin = origin.origin;
    this.minimumMaturity = options.minimumMaturity ?? "beta";
    this.protocol = options.protocol ?? CURRENT_PROTOCOL_VERSION;
    this.fetch = options.fetch ?? globalThis.fetch;
    if (!this.fetch) throw new ChangeloopError("fetch is unavailable", "fetch_unavailable");
  }

  async status(signal?: AbortSignal): Promise<StatusResult> {
    const result = await this.rpc<StatusResult>("status", null, signal);
    this.assertCompatible(result.protocol);
    return result;
  }

  ask(prompt: string, signal?: AbortSignal): Promise<InvocationResult> {
    return this.rpc("ask", { prompt }, signal);
  }

  run(intent: string, signal?: AbortSignal): Promise<InvocationResult> {
    return this.rpc("run", { prompt: intent }, signal);
  }

  replay(
    sessionId: string,
    options: { after?: EventCursor; limit?: number; signal?: AbortSignal } = {},
  ): Promise<ReplayResult> {
    return this.rpc(
      "replay",
      { sessionId, ...(options.after ? { after: options.after } : {}), ...(options.limit ? { limit: options.limit } : {}) },
      options.signal,
    );
  }

  cancel(signal?: AbortSignal): Promise<{ cancelled: boolean }> {
    return this.rpc("cancel", null, signal);
  }

  cancelOperation(operationId: string, signal?: AbortSignal): Promise<{ operationId: string; cancelled: boolean }> {
    if (!operationId || containsControl(operationId)) {
      return Promise.reject(new ChangeloopError("operationId is invalid", "invalid_request"));
    }
    return this.rpc("operation.cancel", { operationId }, signal);
  }

  steerOperation(operationId: string, message: string, signal?: AbortSignal): Promise<{ operationId: string; steered: boolean }> {
    if (!operationId || containsControl(operationId) || !message || containsControl(message)) {
      return Promise.reject(new ChangeloopError("operation steering input is invalid", "invalid_request"));
    }
    return this.rpc("operation.steer", { operationId, message }, signal);
  }

  async rpc<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const id = `sdk-${this.#nextId++}`;
    const response = await this.fetch(`${this.baseUrl}/rpc`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ id, method, params }),
      ...(signal ? { signal } : {}),
    });
    this.assertProtocolHeader(response);
    if (!response.ok) throw await this.httpError(response);
    const wire = JSON.parse(await readResponseText(response, MAX_RESPONSE_BYTES)) as WireResponse<T>;
    if (wire.id !== id) throw new ChangeloopError("response ID does not match request", "response_id_mismatch");
    if (!wire.ok || wire.result === undefined) {
      throw new ChangeloopError(wire.error?.message ?? "RPC failed", wire.error?.code ?? "rpc_failure");
    }
    return wire.result;
  }

  async *events(sessionId: string, options: EventStreamOptions = {}): AsyncGenerator<ServerFrame> {
    let cursor = options.after;
    let reconnects = 0;
    const maximum = options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    const delay = options.reconnectDelayMs ?? 100;
    if ((maximum !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maximum) || maximum < 0))
      || !Number.isSafeInteger(delay) || delay < 0) {
      throw new ChangeloopError("reconnect limits must be non-negative integers", "invalid_reconnect_options");
    }
    let lastEventCursor = cursor;
    while (!options.signal?.aborted) {
      const query = new URLSearchParams({ session: sessionId });
      if (cursor) query.set("after", cursor);
      let response: Response;
      try {
        response = await this.fetch(`${this.baseUrl}/events?${query}`, {
          headers: this.headers({ accept: "text/event-stream" }),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted) return;
        if (reconnects++ >= maximum) throw error;
        await abortableDelay(delay, options.signal);
        continue;
      }
      this.assertProtocolHeader(response);
      if (!response.ok) throw await this.httpError(response);
      if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/event-stream")) {
        throw new ChangeloopError("server returned a non-SSE content type", "invalid_sse");
      }
      if (!response.body) throw new ChangeloopError("SSE response has no body", "invalid_sse");
      try {
        let lastSequence = 0;
        for await (const data of parseSse(response.body, options.signal)) {
          let decoded: unknown;
          try {
            decoded = JSON.parse(data);
          } catch {
            throw new ChangeloopError("SSE frame is not valid JSON", "invalid_sse");
          }
          const frame = validateServerFrame(decoded, sessionId, this.protocol);
          if (frame.sequence <= lastSequence) {
            throw new ChangeloopError("SSE frame sequence is not strictly increasing", "invalid_sse_sequence");
          }
          lastSequence = frame.sequence;
          if (frame.payload.type === "event") {
            // Reconnect is cursor-exclusive, but suppress an exact boundary replay
            // defensively so consumers can never execute a tool twice.
            if (frame.payload.data.cursor === lastEventCursor) continue;
            cursor = frame.payload.data.cursor;
            lastEventCursor = cursor;
          }
          yield frame;
        }
      } catch (error) {
        if (options.signal?.aborted) return;
        if (error instanceof ChangeloopError) throw error;
        if (reconnects++ >= maximum) throw error;
        await abortableDelay(delay, options.signal);
        continue;
      }
      if (reconnects++ >= maximum) return;
      await abortableDelay(delay, options.signal);
    }
  }

  private headers(extra: Record<string, string>): Headers {
    return new Headers({
      authorization: `Bearer ${this.#token}`,
      origin: this.origin,
      "x-changeloop-protocol": `${this.protocol.major}.${this.protocol.minor}`,
      ...extra,
    });
  }

  private assertCompatible(server: ProtocolVersion): void {
    if (server.major !== this.protocol.major) throw new CompatibilityError(this.protocol, server);
  }

  private assertProtocolHeader(response: Response): void {
    const advertised = response.headers.get("x-changeloop-protocol");
    if (!advertised) {
      throw new ChangeloopError("server omitted the protocol header", "missing_protocol_header");
    }
    if (!/^\d+\.\d+$/.test(advertised)) {
      throw new ChangeloopError("server returned an invalid protocol header", "invalid_protocol_header");
    }
    const [major, minor] = advertised.split(".").map(Number) as [number, number];
    if (major > 65_535 || minor > 65_535) {
      throw new ChangeloopError("server returned an invalid protocol header", "invalid_protocol_header");
    }
    this.assertCompatible({ major, minor });
    const maturity = response.headers.get("x-changeloop-maturity");
    if (!maturity || !isMaturity(maturity)) {
      throw new ChangeloopError("server omitted or returned an invalid maturity label", "invalid_maturity_header");
    }
    if (maturityRank(maturity) < maturityRank(this.minimumMaturity)) {
      throw new ChangeloopError(
        `server interface maturity ${maturity} is below required ${this.minimumMaturity}`,
        "maturity_unavailable",
      );
    }
  }

  private async httpError(response: Response): Promise<ChangeloopError> {
    const message = (await readResponseText(response, MAX_RESPONSE_BYTES)).trim() || `HTTP ${response.status}`;
    if (response.status === 409 || response.status === 429) return new BackpressureError(message);
    return new ChangeloopError(message, response.status === 403 ? "unauthorized" : "http_failure", response.status);
  }
}

async function* parseSse(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      if (buffer.length > MAX_SSE_FRAME_BYTES && !buffer.includes("\n\n")) {
        throw new ChangeloopError("SSE frame exceeds the size limit", "invalid_sse");
      }
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data.length > MAX_SSE_FRAME_BYTES) {
          throw new ChangeloopError("SSE frame exceeds the size limit", "invalid_sse");
        }
        if (data) yield data;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function containsControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function parseEndpoint(value: string, field: "baseUrl" | "origin"): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ChangeloopError(`${field} must be an absolute HTTP URL`, `invalid_${field}`);
  }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ChangeloopError(`${field} must be an HTTP URL without embedded credentials`, `invalid_${field}`);
  }
  if (field === "baseUrl" && (parsed.search || parsed.hash)) {
    throw new ChangeloopError("baseUrl must not include a query or fragment", "invalid_baseUrl");
  }
  return parsed;
}

function isMaturity(value: string): value is InterfaceMaturity {
  return value === "experimental" || value === "beta" || value === "stable";
}

function maturityRank(value: InterfaceMaturity): number {
  return value === "experimental" ? 0 : value === "beta" ? 1 : 2;
}

async function readResponseText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ChangeloopError("server response exceeds the size limit", "response_too_large", response.status);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw new ChangeloopError("server response exceeds the size limit", "response_too_large", response.status);
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function validateServerFrame(value: unknown, sessionId: string, protocol: ProtocolVersion): ServerFrame {
  if (!value || typeof value !== "object") throw new ChangeloopError("invalid SSE frame", "invalid_sse");
  const frame = value as Partial<ServerFrame>;
  if (!Number.isSafeInteger(frame.sequence) || (frame.sequence ?? 0) < 1 || !frame.payload || typeof frame.payload !== "object") {
    throw new ChangeloopError("invalid SSE frame envelope", "invalid_sse");
  }
  if (frame.payload.type === "heartbeat") {
    const data = frame.payload.data;
    if (!Number.isSafeInteger(data.emitted_at_ms)
      || (data.last_cursor !== null && typeof data.last_cursor !== "string")) {
      throw new ChangeloopError("invalid SSE heartbeat", "invalid_sse");
    }
    return frame as ServerFrame;
  }
  if (frame.payload.type !== "event") throw new ChangeloopError("unknown SSE payload type", "invalid_sse");
  const envelope = frame.payload.data;
  if (!envelope || typeof envelope !== "object"
    || typeof envelope.cursor !== "string"
    || envelope.session_id !== sessionId
    || !envelope.protocol_version
    || !Number.isInteger(envelope.protocol_version.major)
    || !Number.isInteger(envelope.protocol_version.minor)) {
    throw new ChangeloopError("invalid SSE event envelope", "invalid_sse");
  }
  if (envelope.protocol_version.major !== protocol.major) {
    throw new CompatibilityError(protocol, envelope.protocol_version);
  }
  return frame as ServerFrame;
}
