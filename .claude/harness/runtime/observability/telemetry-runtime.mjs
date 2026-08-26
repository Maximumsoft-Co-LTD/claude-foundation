import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { measuredNumber } from "../core/measured-number.mjs";
import {
  normalizeClaudeUserTransition,
  normalizeTelemetryRow,
  runtimeSessionId
} from "./telemetry.mjs";
import { usageAvailability } from "./metrics-runtime.mjs";

export function validateTelemetryEventFlags(context, id, state, flags) {
  if (flags.repo) context.repositoryById(id, flags.repo, state);
  if (flags.task) {
    const taskId = String(flags.task).toUpperCase();
    const known = context.taskBlocks(context.readFile(
      join(context.activeChangePath(id), "tasks.md"), "utf8"))
      .some((task) => task.id === taskId);
    if (!known) context.fail(`event references unknown task '${flags.task}'`);
    flags.task = taskId;
  }
  for (const field of ["input", "output", "cache", "cache-create", "cost", "duration"])
    if (flags[field] !== undefined && measuredNumber(flags[field]) === null)
      context.fail(`event --${field} must be numeric`);
}

export function telemetryCacheUsage(flags) {
  // `--cache` is the read. A separate write input is required so cache-write
  // spend remains billable instead of collapsing structurally to zero.
  const cacheReadTokens = measuredNumber(flags.cache);
  const cacheCreationTokens = flags["cache-create"] === undefined
    ? null : measuredNumber(flags["cache-create"]);
  const measured = [cacheReadTokens, cacheCreationTokens]
    .filter((value) => value !== null);
  return {
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens: measured.length
      ? measured.reduce((sum, value) => sum + value, 0)
      : null
  };
}

export function buildTelemetryEvent(context, id, flags, snapshot) {
  return {
    version: 2,
    runId: flags.run || process.env.FOUNDATION_RUN_ID ||
      process.env.FOUNDATION_CLAUDE_SESSION_ID || id,
    operationId: flags.operation || "unknown",
    agentId: flags.agent || null,
    modelId: flags.model || null,
    requestId: flags.request || null,
    parentRequestId: flags.parent || null,
    timestamp: context.now(),
    inputTokens: measuredNumber(flags.input),
    outputTokens: measuredNumber(flags.output),
    ...telemetryCacheUsage(flags),
    cost: measuredNumber(flags.cost),
    durationMs: measuredNumber(flags.duration),
    tool: flags.tool || null,
    repositoryId: flags.repo || null,
    taskId: flags.task || null,
    workspaceHash: snapshot.workspaceHash || null,
    workspaceSnapshotId: snapshot.snapshotId || snapshot.id || null,
    changeId: id,
    source: "host-execution-contract"
  };
}

export function assertUniqueTelemetryRequest(context, path, requestId) {
  if (!existsSync(path)) return;
  const duplicate = context.readFile(path, "utf8").split("\n")
    .filter(Boolean).some((line) => {
      try { return JSON.parse(line).requestId === requestId; }
      catch { context.fail(`invalid telemetry ledger: ${relative(context.root, path)}`); }
    });
  if (duplicate) context.fail(`duplicate telemetry request '${requestId}'`);
}

export function recordTelemetryEvent(context, id, flags) {
  const state = context.loadRuntime(id);
  validateTelemetryEventFlags(context, id, state, flags);
  const snapshot = state.activeProofRun || context.readJson(context.snapshotPath(id), {});
  const event = buildTelemetryEvent(context, id, flags, snapshot);
  if (!event.requestId) context.fail("event requires --request for unique telemetry identity");
  const path = join(context.logs, id, "events.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  assertUniqueTelemetryRequest(context, path, event.requestId);
  context.append(path, `${JSON.stringify(event)}\n`);
  context.synchronizeBudgetUsage(
    state, context.readJsonLines(path), event.runId, "external-events", 1);
  context.saveRuntime(state);
  context.reportBudget(id, state);
}

export function createTelemetryRuntime({
  root,
  logs,
  contextEventSchemaVersion,
  stableHash,
  now,
  readJson,
  writeJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  saveRuntime,
  synchronizeBudgetUsage,
  reportBudget,
  snapshotPath,
  parseFlags,
  activeChangePath,
  repositoryById,
  taskBlocks,
  fail
}) {
  function recordContextMetric(id, kind, bytes, details = {}) {
    try {
      const dir = join(logs, id, "context-events");
      mkdirSync(dir, { recursive: true });
      const event = {
        version: Number(contextEventSchemaVersion),
        changeId: id,
        kind,
        bytes,
        ...details,
        timestamp: now()
      };
      const name = `${Date.now()}-${process.pid}-${stableHash(event).slice(0, 12)}.json`;
      writeJson(join(dir, name), event);
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
      if (entries.length <= 1000) return;

      const lockPath = join(logs, id, "context-rollup.lock");
      let lock = null;
      try {
        try {
          lock = openSync(lockPath, "wx");
        } catch {
          if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 300000) {
            rmSync(lockPath, { force: true });
            lock = openSync(lockPath, "wx");
          }
        }
        if (lock === null) return;
        const rollupPath = join(logs, id, "context-rollup.json");
        // A re-read rollup is external input: a non-numeric counter would
        // concatenate or NaN-poison every later drain, and a missing byKind
        // threw before any file was folded in, so the drain failed on every
        // retry while pending events accumulated past the threshold forever.
        // Rebuild from measured components; a junk byKind row restarts from
        // the fresh measurements, matching the skip rule metrics-runtime
        // applies when it reads the rollup back.
        const loaded = readJson(rollupPath, {});
        const rollup = {
          version: 1,
          changeId: id,
          count: measuredNumber(loaded.count) ?? 0,
          totalBytes: measuredNumber(loaded.totalBytes) ?? 0,
          byKind: {}
        };
        const archivedKinds = loaded.byKind && typeof loaded.byKind === "object"
          ? Object.entries(loaded.byKind) : [];
        for (const [kind, archived] of archivedKinds) {
          const count = measuredNumber(archived?.count);
          const totalBytes = measuredNumber(archived?.totalBytes);
          const maxBytes = measuredNumber(archived?.maxBytes);
          if ([count, totalBytes, maxBytes].some((value) => value === null)) continue;
          rollup.byKind[kind] = { count, totalBytes, maxBytes };
        }
        for (const entry of entries.slice(0, 500)) {
          const path = join(dir, entry);
          const row = readJson(path, {});
          const bytes = measuredNumber(row.bytes);
          if (row.kind && bytes !== null) {
            rollup.count += 1;
            rollup.totalBytes += bytes;
            const summary = rollup.byKind[row.kind] ||= {
              count: 0,
              totalBytes: 0,
              maxBytes: 0
            };
            summary.count += 1;
            summary.totalBytes += bytes;
            summary.maxBytes = Math.max(summary.maxBytes, bytes);
          }
          rmSync(path, { force: true });
        }
        rollup.updatedAt = now();
        writeJson(rollupPath, rollup);
      } finally {
        if (lock !== null) closeSync(lock);
        if (lock !== null) rmSync(lockPath, { force: true });
      }
    } catch (error) {
      if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
        console.error(`WARNING: context telemetry unavailable: ${error.message}`);
    }
  }

  function telemetryCursorPath(id) {
    return join(logs, id, "claude-cursors.json");
  }

  function sourceKey(path) {
    return createHash("sha256").update(path).digest("hex").slice(0, 24);
  }

  const CURSOR_ANCHOR_BYTES = 4096;

  function cursorIdentity(path, offset) {
    const metadata = statSync(path);
    const boundedOffset = Math.max(0, Math.min(Number(offset) || 0, metadata.size));
    const anchorStart = Math.max(0, boundedOffset - CURSOR_ANCHOR_BYTES);
    const buffer = Buffer.alloc(boundedOffset - anchorStart);
    if (buffer.length) {
      const descriptor = openSync(path, "r");
      try {
        let consumed = 0;
        while (consumed < buffer.length) {
          const count = readSync(
            descriptor, buffer, consumed, buffer.length - consumed, anchorStart + consumed);
          if (count === 0) break;
          consumed += count;
        }
        if (consumed !== buffer.length)
          throw new Error(`Claude transcript changed while its cursor was inspected`);
      } finally {
        closeSync(descriptor);
      }
    }
    return {
      device: String(metadata.dev),
      inode: String(metadata.ino),
      anchorStart,
      anchorHash: createHash("sha256").update(buffer).digest("hex")
    };
  }

  function sourceCursor(path, offset) {
    return { path, offset, ...cursorIdentity(path, offset) };
  }

  function sourceReadOffset(path, source) {
    const size = statSync(path).size;
    const offset = Number(source.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) return 0;
    // A legacy cursor cannot prove that the path still names the file it read.
    // Re-scan it once from the start; request/transition deduplication prevents
    // duplicate events, and the successful read upgrades it with an identity.
    if (source.device === undefined || source.inode === undefined ||
        source.anchorStart === undefined || !source.anchorHash)
      return 0;
    const current = cursorIdentity(path, offset);
    return current.device === String(source.device) &&
      current.inode === String(source.inode) &&
      current.anchorStart === Number(source.anchorStart) &&
      current.anchorHash === source.anchorHash ? offset : 0;
  }

  // The session bound works; the project bound did not exist. A transcript is
  // resolved purely from the environment, so a sibling agent working in a
  // different repository — same host, same session id space — had its requests
  // and cache reads counted against this project's change, and reached the
  // user's cost numbers. Rows that name a working directory must name one
  // inside this project; rows that name none are kept, since dropping them
  // would silently under-report rather than mis-attribute.
  function belongsToThisProject(row) {
    const cwd = row?.cwd || row?.workingDirectory || row?.projectPath;
    if (typeof cwd !== "string" || !cwd) return true;
    const inside = relative(canonicalRoot(), canonicalPathOrSelf(cwd));
    return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
  }

  function canonicalPathOrSelf(path) {
    try { return realpathSync(path); } catch { return resolve(path); }
  }

  let canonicalRootCache = null;
  function canonicalRoot() {
    canonicalRootCache ||= canonicalPathOrSelf(root);
    return canonicalRootCache;
  }

  function claudeHostContext(sourceOverride = null) {
    const transcriptPath = sourceOverride || process.env.FOUNDATION_CLAUDE_TRANSCRIPT_PATH;
    if (!transcriptPath) return null;
    const path = resolve(transcriptPath);
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    return {
      sessionId: sourceOverride
        ? basename(path).replace(/\.jsonl$/, "")
        : (process.env.FOUNDATION_CLAUDE_SESSION_ID || basename(path).replace(/\.jsonl$/, "")),
      transcriptPath: realpathSync(path)
    };
  }

  function recordPhaseContext(id, phase) {
    try {
      const path = join(logs, id, "phase-context.jsonl");
      const prior = readJsonLinesTolerant(path).at(-1) || null;
      const host = claudeHostContext();
      const sessionId = host?.sessionId || runtimeSessionId();
      const telemetryHost = host ? "claude-code"
        : process.env.CODEX_THREAD_ID ? "codex"
          : sessionId ? "generic-host" : "unknown";
      const telemetryMode = host ? "automatic-transcript"
        : sessionId ? "explicit-import" : "unavailable";
      const recommendedTier = {
        change: "deep",
        build: "standard",
        prove: "fast",
        land: "fast"
      }[phase] || "standard";
      const contextMode = !sessionId ? "unavailable"
        : !prior?.sessionId ? "initial"
          : prior.sessionId === sessionId ? "retained" : "fresh";
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify({
        version: 1,
        changeId: id,
        phase,
        sessionId,
        telemetryHost,
        telemetryMode,
        contextMode,
        recommendedModelTier: recommendedTier,
        actualModel: process.env.FOUNDATION_MODEL_ID || null,
        trigger: process.env.FOUNDATION_PHASE_TRIGGER || null,
        priorPhase: prior?.phase || null,
        priorSessionId: prior?.sessionId || null,
        timestamp: now()
      })}\n`);
    } catch (error) {
      if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
        console.error(`WARNING: phase telemetry unavailable: ${error.message}`);
    }
  }

  function collectClaudeSources(transcriptPath) {
    const sources = [transcriptPath];
    const sessionArtifacts = join(dirname(transcriptPath),
      basename(transcriptPath).replace(/\.jsonl$/, ""), "subagents");
    function collect(path) {
      if (!existsSync(path)) return;
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) collect(child);
        else if (entry.isFile() && entry.name.endsWith(".jsonl"))
          sources.push(realpathSync(child));
      }
    }
    collect(sessionArtifacts);
    return [...new Set(sources)];
  }

  function loadClaudeCursors(id) {
    return readJson(telemetryCursorPath(id), { version: 1, sessions: {} });
  }

  function saveClaudeCursors(id, cursors) {
    writeJson(telemetryCursorPath(id), cursors);
  }

  // Whether any model-usage row was ever imported for this change. Archive
  // consults this to warn — not block — when the record is sealed with empty
  // cost columns.
  function modelUsageRecorded(id) {
    const path = join(logs, id, "events.jsonl");
    try { return existsSync(path) && statSync(path).size > 0; }
    catch { return false; }
  }

  function telemetryReadiness(id) {
    return usageAvailability(
      readJsonLinesTolerant(join(logs, id, "events.jsonl")),
      readJsonLinesTolerant(join(logs, id, "phase-context.jsonl")),
      id
    );
  }

  function bindClaudeSession(id, operationId, options = {}) {
    const context = claudeHostContext(options.source || null);
    if (!context) return null;
    const cursors = loadClaudeCursors(id);
    let session = cursors.sessions[context.sessionId];
    if (!session) {
      session = {
        sessionId: context.sessionId,
        transcriptPath: context.transcriptPath,
        operationId: operationId || "unknown",
        boundAt: now(),
        sources: {}
      };
      for (const path of collectClaudeSources(context.transcriptPath)) {
        session.sources[sourceKey(path)] = sourceCursor(
          path, options.fromStart ? 0 : statSync(path).size);
      }
      cursors.sessions[context.sessionId] = session;
    } else {
      session.transcriptPath = context.transcriptPath;
      if (operationId) session.operationId = operationId;
    }
    session.updatedAt = now();
    saveClaudeCursors(id, cursors);
    return { context, cursors, session };
  }

  function readCompleteJsonLines(path, offset) {
    const size = statSync(path).size;
    const start = offset >= 0 && offset <= size ? offset : 0;
    if (start === size) return { rows: [], nextOffset: start };
    const buffer = Buffer.alloc(size - start);
    const descriptor = openSync(path, "r");
    try {
      readSync(descriptor, buffer, 0, buffer.length, start);
    } finally {
      closeSync(descriptor);
    }
    const newline = buffer.lastIndexOf(10);
    if (newline < 0) return { rows: [], nextOffset: start };
    const text = buffer.subarray(0, newline + 1).toString("utf8");
    const rows = text.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `invalid Claude transcript record in ${basename(path)} (${error.message})`);
      }
    });
    return { rows, nextOffset: start + newline + 1 };
  }

  function appendTelemetryRows(id, rows, format, context = {}) {
    const target = join(logs, id, "events.jsonl");
    const transitionTarget = join(logs, id, "user-transitions.jsonl");
    const known = new Set(readJsonLines(target).map((row) => row.requestId));
    const knownTransitions = new Set(readJsonLines(transitionTarget)
      .map((row) => row.transitionId));
    const normalized = [];
    const transitions = [];
    for (const row of rows) {
      if (format === "claude") {
        const transition = normalizeClaudeUserTransition(id, row, context, now());
        if (transition && !knownTransitions.has(transition.transitionId)) {
          knownTransitions.add(transition.transitionId);
          transitions.push(transition);
        }
      }
      const event = normalizeTelemetryRow(id, row, format, context, now());
      if (!event || known.has(event.requestId)) continue;
      known.add(event.requestId);
      normalized.push(event);
    }
    if (transitions.length) {
      mkdirSync(dirname(transitionTarget), { recursive: true });
      appendFileSync(transitionTarget,
        transitions.map((row) => JSON.stringify(row)).join("\n") + "\n");
    }
    if (normalized.length) {
      // Loading runtime state can normalize it, so it stays inside this branch:
      // an import that adds nothing must leave the change untouched.
      const state = loadRuntime(id);
      // A budget window represents one real run. Rows that carry a genuine run
      // or session identity may rotate it. Rows that fell back to the change id
      // carry no identity at all — attribute those to the run already active,
      // or every external import opens a window and discards the current one
      // along with its targets.
      const windowId = state.budget?.window?.id || null;
      if (windowId)
        for (const event of normalized)
          if (event.runId === id) event.runId = windowId;
      mkdirSync(dirname(target), { recursive: true });
      appendFileSync(target, normalized.map((row) => JSON.stringify(row)).join("\n") + "\n");
      const allEvents = readJsonLines(target);
      const activeRunId = normalized.at(-1)?.runId || context.sessionId || id;
      synchronizeBudgetUsage(state, allEvents, activeRunId, format === "claude"
        ? "claude-transcript" : `host-events:${format}`, normalized.length);
      saveRuntime(state);
      reportBudget(id, state, true);
    }
    return normalized.length;
  }

  function syncClaudeTelemetry(id, options = {}) {
    loadRuntime(id);
    const context = claudeHostContext(options.source || null);
    if (!context) {
      if (!options.quiet)
        console.log(`TELEMETRY ${id}: Claude transcript unavailable; imported 0`);
      return { imported: 0, scanned: 0 };
    }
    const { cursors, session } = bindClaudeSession(id, options.operationId || null, {
      source: options.source || null,
      fromStart: Boolean(options.source)
    });
    const snapshot = readJson(snapshotPath(id), {});
    let imported = 0;
    let scanned = 0;
    for (const path of collectClaudeSources(context.transcriptPath)) {
      const key = sourceKey(path);
      const source = session.sources[key] || { path, offset: 0 };
      let chunk;
      let nextSource;
      try {
        const offset = sourceReadOffset(path, source);
        chunk = readCompleteJsonLines(path, offset);
        nextSource = sourceCursor(path, chunk.nextOffset);
      } catch (error) {
        if (!options.quiet) fail(error.message);
        console.error(
          `WARNING: skipped unreadable Claude transcript ${basename(path)}: ${error.message}`);
        continue;
      }
      const isSubagent = path !== context.transcriptPath;
      const rows = chunk.rows.filter(belongsToThisProject);
      imported += appendTelemetryRows(id, rows, "claude", {
        sessionId: context.sessionId,
        operationId: session.operationId || "unknown",
        agentId: isSubagent
          ? basename(path).replace(/^agent-/, "").replace(/\.jsonl$/, "")
          : "orchestrator",
        sourcePath: path,
        snapshot
      });
      scanned += chunk.rows.length;
      session.sources[key] = nextSource;
    }
    session.updatedAt = now();
    saveClaudeCursors(id, cursors);
    if (!options.quiet)
      console.log(`TELEMETRY ${id}: imported ${imported}; scanned ${scanned}; source claude-transcript`);
    return { imported, scanned };
  }

  function prepareClaudeTelemetry(id, operationId) {
    const context = claudeHostContext();
    if (!context) return;
    const cursors = loadClaudeCursors(id);
    if (cursors.sessions[context.sessionId]) syncClaudeTelemetry(id, { quiet: true });
    bindClaudeSession(id, operationId);
  }

  function importTelemetry(id, values) {
    const { flags, rest } = parseFlags(values);
    const source = rest[0];
    if (!source) fail("telemetry import requires a JSON or JSONL file");
    const format = flags.format || "generic";
    if (!["generic", "codex", "cursor", "otel", "claude"].includes(format))
      fail("telemetry --format must be generic|codex|cursor|otel|claude");
    const path = resolve(process.cwd(), source);
    if (!existsSync(path)) fail(`telemetry source not found: ${source}`);
    const text = readFileSync(path, "utf8").trim();
    let rows;
    try {
      const parsed = JSON.parse(text);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // A telemetry export is someone else's file, so a malformed line is an
      // expected input rather than an exceptional one. Parsing the JSONL
      // fallback with a bare `map` threw out of the command: the operator got a
      // Node stack trace with absolute runtime paths instead of a sentence, for
      // the ordinary case of a truncated or half-written export. Skipping is
      // already this command's vocabulary — it reports `imported N; skipped M` —
      // so unparseable lines join that count, and only a file with nothing
      // readable in it is an error.
      rows = [];
      let unparseable = 0;
      for (const line of text.split("\n").filter(Boolean)) {
        try { rows.push(JSON.parse(line)); }
        catch { unparseable += 1; }
      }
      if (!rows.length)
        fail(`telemetry source is neither JSON nor JSONL: ${source}`);
      if (unparseable)
        console.error(`WARNING: skipped ${unparseable} unparseable telemetry line(s) in ${source}`);
    }
    if (format === "claude" && !rows.some((row) =>
      row.type === "assistant" && row.message?.role === "assistant" && row.message?.usage))
      fail("Claude telemetry source has no assistant.message.usage records");
    const snapshot = readJson(snapshotPath(id), {});
    const imported = appendTelemetryRows(id, rows, format, {
      snapshot,
      sessionId: format === "codex" ? runtimeSessionId() : null
    });
    console.log(`TELEMETRY ${id}: imported ${imported}; skipped ${rows.length - imported}`);
  }

  const recordEvent = recordTelemetryEvent.bind(null, {
    root, logs, now, loadRuntime, readJson, snapshotPath, repositoryById,
    activeChangePath, taskBlocks, fail,
    readFile: readFileSync,
    append: appendFileSync,
    readJsonLines,
    synchronizeBudgetUsage,
    saveRuntime,
    reportBudget
  });

  return {
    appendTelemetryRows,
    bindClaudeSession,
    claudeHostContext,
    importTelemetry,
    modelUsageRecorded,
    telemetryReadiness,
    prepareClaudeTelemetry,
    recordContextMetric,
    recordEvent,
    recordPhaseContext,
    syncClaudeTelemetry
  };
}
