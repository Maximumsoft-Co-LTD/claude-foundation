import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  discoverConsumerQuality, discoverRepositoryQuality, inventoryRepository
} from "../../harness/runtime/quality/quality-discovery.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-quality-discovery-"));
try {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "hidden"), { recursive: true });
  mkdirSync(join(root, ".claude", "harness", "tests", "fixtures"), { recursive: true });
  mkdirSync(join(root, "openspec", "changes", "archive", "old"), { recursive: true });
  mkdirSync(join(root, "test-results"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    scripts: { test: "vitest run", typecheck: "tsc --noEmit", "foundation:quality:crap": "quality-crap" },
    dependencies: { mongodb: "1.0.0" }
  }));
  writeFileSync(join(root, "tsconfig.json"), "{}");
  writeFileSync(join(root, "src", "app.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "src", "styles.scss"), ".root { color: red; }\n");
  writeFileSync(join(root, "node_modules", "hidden", "ignored.py"), "pass\n");
  writeFileSync(join(root, ".claude", "harness", "tests", "fixtures", "ignored.go"), "package ignored\n");
  writeFileSync(join(root, "openspec", "changes", "archive", "old", "ignored.sql"), "select 1;\n");
  writeFileSync(join(root, "test-results", "ignored.scss"), ".ignored {}\n");

  const inventory = inventoryRepository(root);
  assert.ok(inventory.markers.includes("package.json"));
  assert.ok(!inventory.extensions.includes(".py"), "dependency directories must not affect language discovery");
  assert.ok(!inventory.extensions.includes(".go"), "installed Harness files must not affect language discovery");
  assert.ok(!inventory.extensions.includes(".sql"), "archived changes must not affect language discovery");
  const discovered = discoverRepositoryQuality({ id: "frontend", path: root, relativePath: "." });
  assert.deepEqual(discovered.profiles,
    ["application-js-ts", "database-mongodb", "web-style"]);
  assert.equal(discovered.capabilities.test.status, "available");
  assert.deepEqual(discovered.providers.test.command, ["npm", "test"]);
  assert.equal(discovered.capabilities.crap.status, "available");
  assert.equal(discovered.capabilities["automated-mutation"].status, "unsupported");
  assert.match(discovered.capabilities["automated-mutation"].reason, /no configured/);
  assert.ok(discovered.requiredControls.includes("crap"));
  assert.ok(discovered.recommendedSemanticFaults.includes("remove-tenant-constraint"));

  const report = discoverConsumerQuality([{ id: "frontend", path: root, relativePath: "." }]);
  assert.equal(report.protocol, "foundation-quality-discovery-v1");
  assert.equal(report.repositories.length, 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}

const aliasRoot = mkdtempSync(join(tmpdir(), "foundation-quality-discovery-alias-"));
try {
  writeFileSync(join(aliasRoot, "package.json"), JSON.stringify({
    scripts: { test: "node --test", "quality:crap": "node quality.mjs" }
  }));
  writeFileSync(join(aliasRoot, "app.js"), "export function value() { return 1; }\n");
  const discovered = discoverRepositoryQuality({ id: "alias", path: aliasRoot, relativePath: "." });
  assert.equal(discovered.capabilities.crap.status, "available");
  assert.deepEqual(discovered.providers.crap.command, ["npm", "run", "quality:crap"]);
} finally {
  rmSync(aliasRoot, { recursive: true, force: true });
}

const fixtureRoot = join(fileURLToPath(new URL("../../harness/tests/fixtures/quality/polyglot-multi-repo/", import.meta.url)));
const fixtureRepositories = ["frontend", "api", "database", "deploy"].map((id) => ({
  id, path: join(fixtureRoot, id), relativePath: id
}));
const polyglot = discoverConsumerQuality(fixtureRepositories);
assert.deepEqual(polyglot.repositories.map((repository) => repository.repository),
  ["frontend", "api", "database", "deploy"]);
assert.ok(polyglot.repositories[0].profiles.includes("application-js-ts"));
assert.ok(polyglot.repositories[0].profiles.includes("database-mongodb"));
assert.deepEqual(polyglot.repositories[1].profiles, ["application-go"]);
assert.deepEqual(polyglot.repositories[2].profiles, ["database-sql"]);
assert.deepEqual(polyglot.repositories[3].profiles, ["script-bash"]);

console.log("consumer quality discovery tests: ok");
