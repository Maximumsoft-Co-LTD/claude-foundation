const assert = require("node:assert/strict");
const test = require("node:test");
const { buildManifest, ServiceError } = require("../src/manifest");

test("builds a deployment from a service description", () => {
  const manifest = buildManifest({ name: "api", image: "img:1", port: 8080, env: { A: 1 } });
  assert.equal(manifest.kind, "Deployment");
  assert.equal(manifest.spec.replicas, 2);
  const [container] = manifest.spec.template.spec.containers;
  assert.deepEqual(container.ports, [{ containerPort: 8080, protocol: "TCP" }]);
  assert.deepEqual(container.env, [{ name: "A", value: "1" }]);
});

test("rejects invalid descriptions", () => {
  assert.throws(() => buildManifest({ name: "Bad_Name", image: "img", port: 80 }), ServiceError);
  assert.throws(() => buildManifest({ name: "api", image: "img", port: 0 }), ServiceError);
});
