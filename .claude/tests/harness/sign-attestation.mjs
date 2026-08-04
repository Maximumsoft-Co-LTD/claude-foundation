#!/usr/bin/env node

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";

const [challengePath, trustPath, attestationPath, issuer = "fixture-host"] = process.argv.slice(2);
if (!challengePath || !trustPath || !attestationPath) process.exit(2);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const challenge = JSON.parse(readFileSync(challengePath, "utf8"));
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const payload = {
  version: 1,
  issuer,
  changeId: challenge.changeId,
  projectRoot: challenge.projectRoot,
  agreementHash: challenge.agreementHash,
  nonce: challenge.nonce,
  permissions: challenge.requiredPermissions,
  issuedAt: challenge.issuedAt,
  expiresAt: challenge.expiresAt
};
writeFileSync(trustPath, `${JSON.stringify({
  version: 1,
  issuers: {
    [issuer]: {
      algorithm: "ed25519",
      publicKey: publicKey.export({ type: "spki", format: "pem" })
    }
  }
}, null, 2)}\n`);
chmodSync(trustPath, 0o600);
writeFileSync(attestationPath, `${JSON.stringify({
  version: 1,
  payload,
  signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64")
}, null, 2)}\n`);
