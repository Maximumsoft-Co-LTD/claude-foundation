import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { deliveryTreeEntries } from "../runtime/workflow/delivery-integrity.mjs";

import {
  classifyPullRequest,
  containsSecretMaterial,
  createPullRequestRuntime,
  deliveryBranchName,
  deliveryEvidenceAssessment,
  deliveryPolicy,
  deliveryProjection,
  markdownSection,
  parseGitHubRemote,
  pullRequestNarrative,
  repositoryDeliveryProjection,
  renderPullRequestBody
} from "../runtime/workflow/pull-request-runtime.mjs";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function directoryHash(root) {
  const rows = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path);
      else rows.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return hash(rows.sort().map((path) => `${path}\0${pathIdentity(join(root, path))}`).join("\0"));
}

function pathIdentity(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
    if (stat.isDirectory()) return `directory:${directoryHash(path)}`;
    if (stat.isFile()) return hash(readFileSync(path));
    return `unsupported:${stat.mode}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function checkedGit(args, cwd) {
  const result = git(args, cwd);
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

test("PR policy, remote parsing, branch naming, and secret guards are fail-closed", () => {
  assert.equal(deliveryPolicy({}).missingPresentationEvidence, "draft");
  assert.equal(deliveryPolicy({ deliver: { allowForcePush: true } }).allowForcePush, false);
  assert.equal(deliveryBranchName("change/{changeId}", "Booking UI!!!"), "change/booking-ui");
  assert.deepEqual(parseGitHubRemote("git@github.com:acme/app.git"), {
    host: "github.com", owner: "acme", repository: "app", slug: "acme/app"
  });
  assert.deepEqual(parseGitHubRemote("https://github.com/acme/app.git"), {
    host: "github.com", owner: "acme", repository: "app", slug: "acme/app"
  });
  assert.equal(parseGitHubRemote("/local/repository"), null);
  assert.equal(containsSecretMaterial("API key: abcdefghijklmnop"), true);
  assert.equal(containsSecretMaterial("API key: redacted"), false);
  assert.equal(containsSecretMaterial("Authorization: Bearer abcdefghijklmnop"), true);
});

test("classifier covers the eight company PR types with risk-first precedence", () => {
  const fixtures = [
    ["security-hotfix", "Fix IDOR incident in authorization", ["api/user.js"]],
    ["database-migration", "Add database migration and index", ["db/migrate.sql"]],
    ["infrastructure-devops", "Update Terraform Kubernetes service", ["infra/main.tf"]],
    ["performance", "Improve P95 latency benchmark", ["api/query.js"]],
    ["bug-fix", "Bug root cause and regression fix", ["src/count.js"]],
    ["refactor-technical-debt", "Refactor complexity and CRAP score", ["src/pay.js"]],
    ["feature-frontend", "Add booking flow", ["web/components/Booking.tsx"]],
    ["feature-backend", "Add booking endpoint", ["api/booking.js"]]
  ];
  for (const [expected, text, paths] of fixtures)
    assert.equal(classifyPullRequest({ text, paths }), expected, text);
  assert.equal(classifyPullRequest({
    text: "Performance fix for an authorization vulnerability", paths: []
  }), "security-hotfix");
});

test("renderer uses archived sources and labels plans without inventing observed results", () => {
  const proposal = [
    "# Change: booking", "", "## Why", "", "Reduce operator work.", "",
    "## What changes", "", "- Add booking API", "- Emit analytics", "",
    "## Non-goals", "", "- Payment processing"
  ].join("\n");
  const design = "# Design\n\n## Monitoring\n\nAfter deploy, watch booking_error_rate.\n";
  assert.equal(markdownSection(proposal, "Why"), "Reduce operator work.");
  const narrative = pullRequestNarrative({
    changeId: "booking", state: { intent: "booking", impact: "medium", coupling: "isolated" },
    proposal, design, tasks: "", paths: ["api/booking.js"],
    proof: { receipts: [{ provider: "test", path: "proof/test.json", sha256: "a".repeat(64) }] }
  });
  const body = renderPullRequestBody(narrative);
  for (const heading of ["Summary", "Why", "Related Work", "Type", "Scope",
    "Test & Evidence", "Risk", "Rollback", "Monitoring", "API contract"])
    assert.match(body, new RegExp(`## ${heading}`));
  assert.match(body, /After deploy, watch booking_error_rate/);
  assert.match(body, /proof\/test\.json/);
  assert.doesNotMatch(body, /production monitoring passed/i);
});

test("delivery evidence separates required proof from type-specific presentation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-delivery-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = ".foundation/proof/frontend.json";
  writeJson(join(root, receipt), {
    observed: "Playwright passed", artifacts: [{ type: "screenshot", path: "after.png" }]
  });
  const proof = { status: "pass", proofRunId: "proof-1", receipts: [{
    provider: "browser", path: receipt, sha256: pathIdentity(join(root, receipt))
  }] };
  const assessment = deliveryEvidenceAssessment({
    root, lifecycle: { land: { proofRunId: "proof-1" } }, proof,
    narrative: { type: "feature-frontend", summary: "UI", why: "Need it",
      paths: ["web/app.tsx"], risk: "low", rollback: "revert", monitoring: "errors" },
    readJson
  });
  assert.equal(assessment.requiredComplete, true);
  assert.equal(assessment.presentationComplete, true);
  assert.equal(assessment.quality.score, 100);
  write(join(root, receipt), "changed\n");
  assert.equal(deliveryEvidenceAssessment({
    root, lifecycle: { land: { proofRunId: "proof-1" } }, proof,
    narrative: { type: "feature-frontend", summary: "UI", why: "Need it",
      paths: ["web/app.tsx"], risk: "low", rollback: "revert", monitoring: "errors" },
    readJson
  }).requiredComplete, false);
});

test("projection binds committed Land paths and rejects post-Land drift", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-delivery-projection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "booking";
  write(join(root, "src", "booking.js"), "export const booking = true;\n");
  write(join(root, "openspec", "changes", "archive", "2026-09-16-booking", "proposal.md"), "# Change\n");
  write(join(root, "openspec", "changes", "archive", "2026-09-16-booking", "specs", "booking", "spec.md"), "## ADDED\n");
  write(join(root, "openspec", "specs", "booking", "spec.md"), "# Booking\n");
  const journal = join(root, ".foundation", "transactions", id, "tx", "journal.json");
  writeJson(journal, {
    status: "committed",
    projectionHash: "projection",
    entries: [
      { path: "src/booking.js", before: "before", after: pathIdentity(join(root, "src", "booking.js")), afterMode: 0o644 },
      { path: `openspec/changes/${id}`, before: null, after: "directory:old" }
    ]
  });
  const state = {
    id, status: "archived", archivedChangePath: "openspec/changes/archive/2026-09-16-booking",
    deliveryIntegrity: { version: 2, entries: deliveryTreeEntries(root,
      ["openspec/changes/archive/2026-09-16-booking", "openspec/specs/booking/spec.md"], pathIdentity) },
    workspace: { baseHead: "base", apply: { transactionId: "tx", projectionHash: "projection" } }
  };
  const projection = deliveryProjection({
    root, state, readJson,
    transactionJournalPath: () => journal,
    pathIdentity
  });
  assert(projection.entries.some((entry) => entry.path === "src/booking.js"));
  assert(projection.entries.some((entry) => entry.path.endsWith("2026-09-16-booking/proposal.md")));
  assert(projection.entries.some((entry) => entry.path === "openspec/specs/booking/spec.md"));

  write(join(root, "src", "booking.js"), "drift\n");
  assert.throws(() => deliveryProjection({
    root, state, readJson, transactionJournalPath: () => journal, pathIdentity
  }), /proven path changed after Land/);

  write(join(root, "src", "booking.js"), "export const booking = true;\n");
  write(join(root, "openspec", "specs", "booking", "spec.md"), "drift\n");
  assert.throws(() => deliveryProjection({
    root, state, readJson, transactionJournalPath: () => journal, pathIdentity
  }), /archived delivery input changed after Land/);
});

test("child repository projection is bound to its verified Land journal", (t) => {
  const base = mkdtempSync(join(tmpdir(), "foundation-child-delivery-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = { id: "api", path: join(base, "api") };
  const transactions = join(base, ".foundation", "transactions");
  write(join(repository.path, "src", "api.js"), "export const api = true;\n");
  const lifecycle = {
    id: "booking", repositories: { api: {
      baseHead: "base-api", delivery: { transactionId: "tx-api", projectionHash: "projection-api" }
    } }
  };
  const journal = join(transactions, "repository-delivery", "api", "booking",
    "tx-api", "journal.json");
  writeJson(journal, { status: "verified", entries: [{
    path: "src/api.js", before: "before",
    after: pathIdentity(join(repository.path, "src", "api.js")), afterMode: 0o644
  }] });
  const projection = repositoryDeliveryProjection({
    repository, lifecycle, transactions, readJson, pathIdentity
  });
  assert.equal(projection.baseHead, "base-api");
  assert.deepEqual(projection.roots, ["src/api.js"]);
  chmodSync(join(repository.path, "src/api.js"), 0o755);
  assert.throws(() => repositoryDeliveryProjection({
    repository, lifecycle, transactions, readJson, pathIdentity
  }), /proven file mode changed after Land/);
  chmodSync(join(repository.path, "src/api.js"), 0o644);
  const modeJournal = readJson(journal);
  modeJournal.entries[0].before = modeJournal.entries[0].after;
  modeJournal.entries[0].beforeMode = 0o644;
  modeJournal.entries[0].afterMode = 0o755;
  writeJson(journal, modeJournal);
  chmodSync(join(repository.path, "src/api.js"), 0o755);
  const modeOnly = repositoryDeliveryProjection({
    repository, lifecycle, transactions, readJson, pathIdentity
  });
  assert.deepEqual(modeOnly.roots, ["src/api.js"], "mode-only changes are not omitted as byte-identical no-ops");
  assert.equal(modeOnly.entries[0].mode, "100755");
  write(join(repository.path, "src", "api.js"), "drift\n");
  assert.throws(() => repositoryDeliveryProjection({
    repository, lifecycle, transactions, readJson, pathIdentity
  }), /proven path changed after Land in 'api'/);
});

for (const scenario of ["normal", "mixed-files", "resume-edit", "resume-mode", "commit-hook",
  "hook-extra-path", "recovered-commit", "unrelated-base", "remote-base-moved",
  "push-url", "push-repository", "push-multiple", "push-rewrite", "push-resume",
  "default-branch", "dangling-link", "post-land-mode", "archive-mode", "legacy-mode",
  "crlf", "autocrlf", "conversion-resume", "custom-filter", "reserved-filter",
  "encoding", "legacy-archive-mode", "post-land-mode-remove", "non-main-default",
  "unknown-default", "stale-default", "modified-links"])
test(`delivery verifies publication boundaries: ${scenario}`, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-delivery-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  checkedGit(["init", "-b", "main"], root);
  checkedGit(["config", "user.name", "Foundation Test"], root);
  checkedGit(["config", "user.email", "foundation@example.test"], root);
  write(join(root, ".gitignore"), ".foundation/\n");
  write(join(root, "src", "booking.js"), "export const booking = false;\n");
  if (["crlf", "conversion-resume"].includes(scenario))
    write(join(root, ".gitattributes"), "*.js text eol=crlf\n");
  if (scenario === "autocrlf") checkedGit(["config", "core.autocrlf", "true"], root);
  if (scenario === "mixed-files") write(join(root, "obsolete.txt"), "remove me\n");
  if (scenario === "modified-links") symlinkSync("old-missing-target", join(root, "link"));
  checkedGit(["add", "."], root);
  checkedGit(["commit", "-m", "chore: baseline"], root);
  const remoteBase = checkedGit(["rev-parse", "HEAD"], root);
  if (scenario === "unrelated-base") {
    checkedGit(["switch", "-c", "other-feature"], root);
    write(join(root, "unrelated.txt"), "unrelated committed work\n");
    checkedGit(["add", "unrelated.txt"], root);
    checkedGit(["commit", "-m", "feat: unrelated work"], root);
  }
  const baseHead = checkedGit(["rev-parse", "HEAD"], root);
  checkedGit(["remote", "add", "origin", "https://github.com/acme/booking.git"], root);

  const id = "booking-flow";
  const archive = `openspec/changes/archive/2026-09-16-${id}`;
  write(join(root, "src", "booking.js"), ["crlf", "autocrlf", "conversion-resume"].includes(scenario)
    ? "export const booking = true;\r\n" : "export const booking = true;\n");
  if (scenario === "post-land-mode-remove") chmodSync(join(root, "src/booking.js"), 0o755);
  write(join(root, archive, "proposal.md"), [
    "# Change: booking", "", "## Why", "", "Let users book directly.", "",
    "## What changes", "", "- Add booking flow", "", "## Non-goals", "", "- Payment"
  ].join("\n"));
  write(join(root, archive, "design.md"), "# Design\n\n## Monitoring\n\nWatch booking errors after deploy.\n");
  write(join(root, archive, "tasks.md"), "- [x] **T001** Add booking flow\n");
  write(join(root, archive, "specs", "booking", "spec.md"), "## ADDED Requirements\n");
  write(join(root, "openspec", "specs", "booking", "spec.md"), "# Booking Specification\n");

  const transaction = join(root, ".foundation", "transactions", id, "tx", "journal.json");
  const extraEntries = [];
  if (scenario === "modified-links") {
    rmSync(join(root, "link"));
    symlinkSync("new-missing-target", join(root, "link"));
    write(join(root, ".foundation/external-target"), "external bytes must survive\n");
    symlinkSync(join(root, ".foundation/external-target"), join(root, "external-link"));
    symlinkSync("src/booking.js", join(root, "valid-link"));
    for (const path of ["link", "external-link", "valid-link"])
      extraEntries.push({ path, before: path === "link" ? "symlink:old-missing-target" : null,
        after: pathIdentity(join(root, path)) });
  }
  if (scenario === "dangling-link") {
    symlinkSync("missing-target", join(root, "link"));
    extraEntries.push({ path: "link", before: null, after: "symlink:missing-target" });
  }
  if (scenario === "mixed-files") {
    rmSync(join(root, "obsolete.txt"));
    write(join(root, "data.bin"), Buffer.from([0, 255, 128, 10, 13, 0]));
    write(join(root, "run.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(root, "run.sh"), 0o755);
    for (const path of ["obsolete.txt", "data.bin", "run.sh"])
      extraEntries.push({ path, before: "before", after: pathIdentity(join(root, path)),
        afterMode: path === "run.sh" ? 0o755 : path === "obsolete.txt" ? null : 0o644 });
  }
  writeJson(transaction, {
    status: "committed", projectionHash: "source-projection",
    entries: [{
      path: "src/booking.js", before: "before",
      after: pathIdentity(join(root, "src", "booking.js")),
      ...(scenario === "legacy-mode" ? {} : { afterMode: scenario === "post-land-mode-remove" ? 0o755 : 0o644 })
    }, {
      path: `openspec/changes/${id}`, before: null, after: "directory:old"
    }, ...extraEntries]
  });
  const proofPath = join(root, ".foundation", "receipts", id, "proof.json");
  const durableReceipt = join(root, ".foundation", "proof-runs", id, "proof-1", "receipts", "test.json");
  writeJson(durableReceipt, {
    observed: "API request and response integration test passed",
    artifacts: [{ type: "command-log", path: ".foundation/evidence/test.log" }]
  });
  writeJson(proofPath, {
    status: "pass", proofRunId: "proof-1", receipts: [{
      provider: "test", path: relative(root, durableReceipt).replaceAll("\\", "/"),
      sha256: pathIdentity(durableReceipt)
    }]
  });
  const lifecycle = {
    id, status: "archived", intent: "Add booking flow", impact: "medium", coupling: "isolated",
    archivedAt: "2026-09-16T00:00:00.000Z", archivedChangePath: archive,
    deliveryIntegrity: { version: 2, entries: deliveryTreeEntries(root,
      [archive, "openspec/specs/booking/spec.md"], pathIdentity) },
    preArchiveWorkspaceHash: "workspace", land: { proofRunId: "proof-1" },
    workspace: { baseHead, apply: { transactionId: "tx", projectionHash: "source-projection" } }
  };
  const deliveries = join(root, ".foundation", "deliveries");
  if (scenario === "legacy-archive-mode") lifecycle.deliveryIntegrity.version = 1;
  let commit = null;
  let creates = 0;
  let pushes = 0;
  let failPushOnce = true;
  let failCommitOnce = ["resume-edit", "resume-mode", "recovered-commit"].includes(scenario);
  let fetchedBase = remoteBase;
  let pullRequest = null;
  let actualDefault = scenario === "non-main-default" ? "trunk" : "main";
  let defaultAvailable = scenario !== "unknown-default";
  const run = (executable, args, options) => {
    if (executable === "git" && args[0] === "ls-remote")
      return { status: 0, stdout: defaultAvailable ? `ref: refs/heads/${actualDefault}\tHEAD\n${remoteBase}\tHEAD\n` : "", stderr: "" };
    if (executable === "git" && args[0] === "fetch") {
      return spawnSync("git", ["fetch", "--no-tags", root, fetchedBase], options);
    }
    if (executable === "git" && args[0] === "push") {
      assert.equal(args.at(-1), `${commit}:refs/heads/change/${id}`);
      pushes += 1;
      if (failPushOnce) {
        failPushOnce = false;
        return { status: 1, stdout: "", stderr: "authentication temporarily unavailable" };
      }
      return { status: 0, stdout: "pushed\n", stderr: "" };
    }
    if (executable === "git") {
      if (args[0] === "commit" && failCommitOnce) {
        failCommitOnce = false;
        return { status: 1, stdout: "", stderr: "temporary local commit failure" };
      }
      const result = spawnSync(executable, args, options);
      if (args[0] === "commit" && result.status === 0)
        commit = checkedGit(["rev-parse", "HEAD"], options.cwd);
      return result;
    }
    assert.equal(executable, "gh");
    if (args[1] === "list")
      return { status: 0, stdout: JSON.stringify(pullRequest ? [pullRequest] : []), stderr: "" };
    if (args[1] === "create") {
      creates += 1;
      pullRequest = {
        number: 42, url: "https://github.com/acme/booking/pull/42", state: "OPEN",
        isDraft: false, headRefOid: commit, headRefName: `change/${id}`, baseRefName: "main"
      };
      return { status: 0, stdout: `${pullRequest.url}\n`, stderr: "" };
    }
    if (args[1] === "view")
      return { status: 0, stdout: JSON.stringify(pullRequest), stderr: "" };
    return { status: 1, stdout: "", stderr: "unexpected gh command" };
  };
  const runtime = createPullRequestRuntime({
    root, deliveriesRoot: deliveries,
    loadRuntime: () => lifecycle,
    activeChangePath: () => join(root, archive),
    proofPath: () => proofPath,
    transactionJournalPath: () => transaction,
    pathIdentity, readJson, writeJson,
    stableHash: (value) => hash(JSON.stringify(value)),
    git,
    foundationPolicy: () => ({ deliver: {
      defaultBaseBranch: scenario === "default-branch" ? "release" : "main",
      branchPattern: scenario === "default-branch" ? "main"
        : scenario === "non-main-default" ? "trunk" : "change/{changeId}"
    } }),
    now: () => "2026-09-16T01:00:00.000Z",
    run,
    fail: (message) => { throw new Error(message); }
  });

  const originalHead = checkedGit(["rev-parse", "HEAD"], root);
  const originalIndex = checkedGit(["diff", "--cached"], root);
  if (scenario === "post-land-mode") chmodSync(join(root, "src/booking.js"), 0o755);
  if (scenario === "post-land-mode-remove") chmodSync(join(root, "src/booking.js"), 0o644);
  if (scenario === "archive-mode") chmodSync(join(root, archive, "proposal.md"), 0o755);
  if (["custom-filter", "reserved-filter"].includes(scenario)) {
    const driver = scenario === "reserved-filter" ? "unset" : "lfs";
    write(join(root, ".git/info/attributes"), `*.js filter=${driver}\n`);
    checkedGit(["config", `filter.${driver}.clean`, "touch filter-was-executed; cat"], root);
  }
  if (scenario === "encoding") write(join(root, ".git/info/attributes"), "*.js working-tree-encoding=UTF-16\n");
  if (scenario === "stale-default") {
    // Cached origin/HEAD incorrectly calls our ordinary feature branch default.
    checkedGit(["update-ref", `refs/remotes/origin/change/${id}`, baseHead], root);
    checkedGit(["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/change/${id}`], root);
  }
  if (["push-url", "push-repository", "push-multiple"].includes(scenario)) {
    if (scenario === "push-multiple")
      checkedGit(["remote", "set-url", "--add", "--push", "origin", "https://github.com/acme/booking.git"], root);
    checkedGit(["remote", "set-url", "--add", "--push", "origin",
      scenario === "push-repository" ? "https://github.com/acme/other.git" : "https://unapproved.example/acme/booking.git"], root);
  }
  if (scenario === "push-rewrite")
    checkedGit(["config", "url.https://unapproved.example/.pushInsteadOf", "https://github.com/"], root);
  if (scenario === "default-branch") {
    checkedGit(["branch", "-m", "main", "operator"], root);
    checkedGit(["update-ref", "refs/remotes/origin/main", baseHead], root);
    checkedGit(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], root);
  }
  if (["commit-hook", "hook-extra-path"].includes(scenario)) {
    const hook = join(root, ".git/hooks/pre-commit");
    const path = scenario === "hook-extra-path" ? "outside-projection.txt" : "src/booking.js";
    write(hook, `#!/bin/sh\nprintf "unproven hook edit\\n" > ${path}\ngit add ${path}\n`);
    chmodSync(hook, 0o755);
  }
  if (["resume-edit", "resume-mode", "recovered-commit"].includes(scenario)) {
    await assert.rejects(runtime.advance(id), /temporary local commit failure/);
    const workspace = runtime.workspacePath(id);
    if (scenario === "resume-mode") chmodSync(join(workspace, "src/booking.js"), 0o755);
    else write(join(workspace, "src/booking.js"), "unproven edit after interruption\n");
    if (scenario === "recovered-commit") {
      checkedGit(["add", "src/booking.js"], workspace);
      checkedGit(["commit", "-m", "feat: unproven recovery"], workspace);
    }
  }
  let interrupted = await runtime.advance(id);
  if (["custom-filter", "reserved-filter", "encoding"].includes(scenario)) {
    assert.equal(interrupted.action, "ASK_USER");
    assert.equal(interrupted.boundary, "git-conversion");
    assert.equal(pushes, 0);
    assert.equal(creates, 0);
    assert.equal(existsSync(join(root, "filter-was-executed")), false);
    assert.equal(existsSync(join(runtime.workspacePath(id), "filter-was-executed")), false);
    assert.equal(checkedGit(["rev-parse", "HEAD"], root), originalHead);
    assert.equal(checkedGit(["diff", "--cached"], root), originalIndex);
    return;
  }
  if (["legacy-mode", "legacy-archive-mode"].includes(scenario)) {
    assert.equal(interrupted.action, "ASK_USER");
    assert.equal(interrupted.boundary, "legacy-mode-evidence");
    assert(interrupted.options.includes("review-current-diff-for-separate-git-publication"));
    assert.equal(pushes, 0);
    return;
  }
  if (scenario === "unknown-default") {
    assert.equal(interrupted.action, "WAIT");
    assert.equal(pushes, 0);
    defaultAvailable = true;
    interrupted = await runtime.advance(id);
  }
  if (["push-url", "push-repository", "push-multiple", "push-rewrite", "default-branch", "non-main-default"].includes(scenario)) {
    assert.equal(interrupted.action, "WAIT");
    assert.equal(pushes, 0);
    assert.equal(creates, 0);
    assert.equal(checkedGit(["diff", "--cached"], root), originalIndex);
    return;
  }
  if (["resume-edit", "resume-mode", "recovered-commit"].includes(scenario)) {
    // Drift in the unpublished harness workspace is rebuilt in place, once,
    // from the Land-bound projection; it never becomes a new-change question.
    const state = readJson(runtime.statePath(id));
    assert.match(state.workspaceRebuilt.reason, /delivery|proven/);
    assert.equal(interrupted.action, "WAIT", "the rebuilt workspace reaches the first push attempt");
    assert.equal(checkedGit(["show", `${commit}:src/booking.js`], root),
      "export const booking = true;");
  }
  if (["commit-hook", "hook-extra-path"].includes(scenario)) {
    assert.equal(interrupted.action, "ASK_USER");
    assert.equal(interrupted.boundary, "delivery-workspace");
    assert.equal(interrupted.options.some((option) => /new-change/.test(option)), false);
    assert.equal(interrupted.resumeCommand, `claude-foundation deliver advance ${id}`);
    assert.equal(pushes, 0);
    assert.equal(creates, 0);
    assert.equal(checkedGit(["rev-parse", "HEAD"], root), originalHead);
    assert.equal(checkedGit(["diff", "--cached"], root), originalIndex);
    return;
  }
  if (["unrelated-base", "post-land-mode", "post-land-mode-remove", "archive-mode"].includes(scenario)) {
    assert.equal(interrupted.action, "ASK_USER");
    assert.equal(interrupted.boundary, "content-identity");
    assert.deepEqual(interrupted.options,
      ["restore-the-proven-content-and-retry-deliver", "leave-archived-without-deliver"]);
    assert.equal(pushes, 0);
    assert.equal(creates, 0);
    assert.equal(checkedGit(["rev-parse", "HEAD"], root), originalHead);
    assert.equal(checkedGit(["diff", "--cached"], root), originalIndex);
    return;
  }
  assert.equal(interrupted.action, "WAIT");
  assert.equal(readJson(runtime.statePath(id)).status, "commit-created");
  if (scenario === "conversion-resume") {
    checkedGit(["config", "core.autocrlf", "input"], root);
    const stopped = await runtime.advance(id);
    assert.equal(stopped.action, "WAIT");
    assert.equal(pushes, 1);
    checkedGit(["config", "--unset", "core.autocrlf"], root);
  }
  if (scenario === "push-resume") {
    checkedGit(["remote", "set-url", "origin", "https://github.com/acme/other.git"], root);
    assert.equal((await runtime.advance(id)).action, "WAIT");
    assert.equal(pushes, 1, "a changed destination cannot reuse publication authority");
    checkedGit(["remote", "set-url", "origin", "https://github.com/acme/booking.git"], root);
  }

  if (scenario === "remote-base-moved") {
    // A force-moved remote no longer contains the proven Land base.
    const emptyTree = checkedGit(["mktree"], root);
    fetchedBase = checkedGit(["commit-tree", emptyTree, "-m", "unrelated remote history"], root);
    const resumed = await runtime.advance(id);
    assert.equal(resumed.action, "ASK_USER");
    assert.equal(resumed.boundary, "content-identity");
    assert.equal(pushes, 1, "resume must not push to an incompatible PR base");
    assert.equal(creates, 0);
    return;
  }

  const first = await runtime.advance(id);
  assert.equal(first.action, "DONE");
  assert.equal(first.pullRequests[0].url, "https://github.com/acme/booking/pull/42");
  assert.equal(creates, 1);
  assert.equal(pushes, 2);
  assert.equal(checkedGit(["rev-parse", "HEAD"], root), originalHead);
  assert.equal(checkedGit(["diff", "--cached"], root), originalIndex);
  assert.equal(existsSync(runtime.receiptPath(id)), true);
  if (["crlf", "autocrlf", "conversion-resume"].includes(scenario))
    assert.equal(spawnSync("git", ["show", `${commit}:src/booking.js`], { cwd: root, encoding: "utf8" }).stdout,
      "export const booking = true;\n");
  if (scenario === "dangling-link") {
    assert.match(checkedGit(["ls-tree", commit, "link"], root), /^120000 /);
    assert.equal(checkedGit(["show", `${commit}:link`], root), "missing-target");
  }
  if (scenario === "modified-links") {
    for (const path of ["link", "external-link", "valid-link"]) {
      assert.match(checkedGit(["ls-tree", commit, path], root), /^120000 /);
      assert.equal(checkedGit(["show", `${commit}:${path}`], root), readlinkSync(join(root, path)));
    }
    assert.equal(readFileSync(join(root, ".foundation/external-target"), "utf8"), "external bytes must survive\n");
  }
  if (scenario === "mixed-files") {
    assert.deepEqual(spawnSync("git", ["show", `${commit}:data.bin`], { cwd: root }).stdout,
      Buffer.from([0, 255, 128, 10, 13, 0]));
    assert.match(checkedGit(["ls-tree", commit, "run.sh"], root), /^100755 /);
    assert.equal(checkedGit(["ls-tree", commit, "obsolete.txt"], root), "");
  }

  const second = await runtime.advance(id);
  assert.equal(second.action, "DONE");
  assert.equal(second.reused, true);
  assert.equal(creates, 1);
  assert.equal(pushes, 2);
});

for (const [topology, boundary] of [["sibling", "normal"], ["submodule", "normal"],
  ["sibling", "root-unsafe"], ["sibling", "child-unsafe"], ["sibling", "child-default"]])
test(`multi-repository delivery preserves ${topology} topology and target HEADs: ${boundary}`, async (t) => {
  const base = mkdtempSync(join(tmpdir(), "foundation-delivery-multi-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "control");
  const child = topology === "submodule" ? join(root, "modules", "api") : join(base, "api");
  for (const [path, remote] of [[root, "control"], [child, "api"]]) {
    mkdirSync(path, { recursive: true });
    checkedGit(["init", "-b", "main"], path);
    checkedGit(["config", "user.name", "Foundation Test"], path);
    checkedGit(["config", "user.email", "foundation@example.test"], path);
    write(join(path, ".gitignore"), ".foundation/\n");
    write(join(path, "src", "value.js"), "export const value = false;\n");
    checkedGit(["add", "."], path);
    checkedGit(["commit", "-m", "chore: baseline"], path);
    checkedGit(["remote", "add", "origin", `https://github.com/acme/${remote}.git`], path);
  }
  const childHead = checkedGit(["rev-parse", "HEAD"], child);
  if (topology === "submodule") {
    write(join(root, ".gitmodules"), '[submodule "api"]\n\tpath = modules/api\n\turl = https://github.com/acme/api.git\n');
    checkedGit(["add", ".gitmodules"], root);
    checkedGit(["update-index", "--add", "--cacheinfo", `160000,${childHead},modules/api`], root);
    checkedGit(["commit", "-m", "chore: register submodule"], root);
  }
  const rootHead = checkedGit(["rev-parse", "HEAD"], root);
  write(join(root, "src", "value.js"), "export const value = true;\n");
  write(join(child, "src", "value.js"), "export const value = true;\n");
  const id = "multi-change";
  const archive = `openspec/changes/archive/2026-09-16-${id}`;
  write(join(root, archive, "proposal.md"), "# Change\n\n## Why\n\nCoordinate services.\n\n## What changes\n\n- Add coordinated API\n");
  write(join(root, archive, "design.md"), "# Design\n\n## Monitoring\n\nWatch API errors.\n");
  write(join(root, archive, "tasks.md"), "- [x] **T001** Coordinate API\n");
  const transactions = join(root, ".foundation", "transactions");
  const rootJournal = join(transactions, id, "root-tx", "journal.json");
  writeJson(rootJournal, { status: "committed", projectionHash: "root-projection", entries: [{
    path: "src/value.js", before: "before", after: pathIdentity(join(root, "src", "value.js")), afterMode: 0o644
  }] });
  const childJournal = join(transactions, "repository-delivery", "api", id,
    "api-tx", "journal.json");
  writeJson(childJournal, { status: "verified", projectionHash: "api-projection", entries: [{
    path: "src/value.js", before: "before", after: pathIdentity(join(child, "src", "value.js")), afterMode: 0o644
  }] });
  const durableReceipt = join(root, ".foundation", "proof-runs", id, "proof-1",
    "receipts", "integration.json");
  writeJson(durableReceipt, { observed: "API integration request and response passed",
    artifacts: [{ type: "command-log", path: "integration.log" }] });
  const finalizedProof = join(root, ".foundation", "receipts", id, "proof.json");
  writeJson(finalizedProof, { status: "pass", proofRunId: "proof-1", receipts: [{
    provider: "integration", path: relative(root, durableReceipt).replaceAll("\\", "/"),
    sha256: pathIdentity(durableReceipt)
  }] });
  const lifecycle = {
    id, status: "archived", archivedAt: "2026-09-16T00:00:00.000Z",
    archivedChangePath: archive, land: { proofRunId: "proof-1" },
    deliveryIntegrity: { version: 2, entries: deliveryTreeEntries(root, [archive], pathIdentity) },
    workspace: { baseHead: rootHead, apply: {
      transactionId: "root-tx", projectionHash: "root-projection"
    } },
    repositories: { api: { baseHead: childHead, delivery: {
      transactionId: "api-tx", projectionHash: "api-projection"
    } } }
  };
  const pullRequests = new Map();
  const pushed = [];
  const run = (executable, args, options) => {
    if (executable === "git" && args[0] === "ls-remote")
      return { status: 0, stdout: `ref: refs/heads/${boundary === "child-default" && options.cwd === child ? `change/${id}` : "main"}\tHEAD\n${rootHead}\tHEAD\n`, stderr: "" };
    if (executable === "git" && args[0] === "fetch") {
      const isChild = options.cwd.includes("repositories/api") || options.cwd === child;
      return spawnSync("git", ["fetch", "--no-tags", isChild ? child : root,
        isChild ? childHead : rootHead], options);
    }
    if (executable === "git" && args[0] === "push") {
      assert.equal(args.at(-1), `${checkedGit(["rev-parse", "HEAD"], options.cwd)}:refs/heads/change/${id}`);
      pushed.push(options.cwd.includes("repositories/api") ? "api" : "root");
      return { status: 0, stdout: "pushed\n", stderr: "" };
    }
    if (executable === "git") return spawnSync(executable, args, options);
    const slug = args[args.indexOf("--repo") + 1];
    if (args[1] === "list")
      return { status: 0, stdout: JSON.stringify(pullRequests.has(slug)
        ? [pullRequests.get(slug)] : []), stderr: "" };
    if (args[1] === "create") {
      const repositoryId = slug.endsWith("/api") ? "api" : "root";
      const workspace = repositoryId === "api"
        ? join(root, ".foundation", "deliveries", id, "repositories", "api", "workspace")
        : join(root, ".foundation", "deliveries", id, "workspace");
      const commit = checkedGit(["rev-parse", "HEAD"], workspace);
      const value = { number: pullRequests.size + 1,
        url: `https://github.com/${slug}/pull/${pullRequests.size + 1}`,
        state: "OPEN", isDraft: false, headRefOid: commit,
        headRefName: `change/${id}`, baseRefName: "main" };
      pullRequests.set(slug, value);
      return { status: 0, stdout: `${value.url}\n`, stderr: "" };
    }
    if (args[1] === "view")
      return { status: 0, stdout: JSON.stringify(pullRequests.get(slug)), stderr: "" };
    return { status: 1, stdout: "", stderr: "unexpected" };
  };
  const runtime = createPullRequestRuntime({
    root, deliveriesRoot: join(root, ".foundation", "deliveries"), transactions,
    loadRuntime: () => lifecycle,
    activeChangePath: () => join(root, archive), proofPath: () => finalizedProof,
    transactionJournalPath: () => rootJournal,
    selectedRepositories: () => [
      { id: "root", path: root, mode: "write", dependsOn: [], relativePath: "." },
      { id: "api", type: topology === "submodule" ? "submodule" : "git", path: child,
        mode: "write", dependsOn: [], relativePath: topology === "submodule" ? "modules/api" : "../api" }
    ],
    pathIdentity, readJson, writeJson,
    stableHash: (value) => hash(JSON.stringify(value)), git,
    foundationPolicy: () => ({ deliver: { defaultBaseBranch: "main" } }),
    now: () => "2026-09-16T02:00:00.000Z", run,
    fail: (message) => { throw new Error(message); }
  });
  if (["root-unsafe", "child-unsafe"].includes(boundary))
    checkedGit(["remote", "set-url", "--push", "origin", "https://github.com/other/project.git"],
      boundary === "root-unsafe" ? root : child);
  let result = await runtime.advance(id);
  if (boundary !== "normal") {
    assert.equal(result.action, "WAIT");
    assert.deepEqual(pushed, [], "validate every selected destination before publishing any repository");
    assert.equal(pullRequests.size, 0);
    assert.equal(checkedGit(["rev-parse", "HEAD"], root), rootHead);
    assert.equal(checkedGit(["rev-parse", "HEAD"], child), childHead);
    if (boundary === "child-default") return;
    checkedGit(["remote", "set-url", "--delete", "--push", "origin", ".*"], boundary === "root-unsafe" ? root : child);
    result = await runtime.advance(id);
  }
  assert.equal(result.action, "DONE");
  assert.deepEqual(result.pullRequests.map((row) => row.repositoryId), ["api", "root"]);
  assert.deepEqual(pushed, ["api", "root"]);
  assert.equal(checkedGit(["rev-parse", "HEAD"], root), rootHead);
  assert.equal(checkedGit(["rev-parse", "HEAD"], child), childHead);
  const workspace = runtime.workspacePath(id);
  const gitlink = checkedGit(["ls-tree", "HEAD", "--", "modules/api"], workspace);
  if (topology === "submodule") {
    const deliveredChild = result.pullRequests.find((row) => row.repositoryId === "api");
    assert.match(gitlink, new RegExp(`160000 commit ${deliveredChild.headCommit}\\tmodules/api`));
  } else assert.equal(gitlink, "");
  const reused = await runtime.advance(id);
  assert.equal(reused.reused, true);
  assert.equal(pullRequests.size, 2);
});
