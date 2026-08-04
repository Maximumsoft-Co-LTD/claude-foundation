#!/usr/bin/env node

import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "../../harness/runtime/core/trust.mjs";

const [command, ...args] = process.argv.slice(2);

if (command === "generate") {
  const [privatePath, publicPath] = args;
  if (!privatePath || !publicPath) throw new Error("generate requires private and public paths");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
} else if (command === "sign") {
  const [payloadPath, privatePath, envelopePath] = args;
  if (!payloadPath || !privatePath || !envelopePath)
    throw new Error("sign requires payload, private key, and envelope paths");
  const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  const signature = sign(null, Buffer.from(canonicalJson(payload)), readFileSync(privatePath, "utf8"))
    .toString("base64");
  writeFileSync(envelopePath, `${JSON.stringify({ version: 1, payload, signature }, null, 2)}\n`);
} else {
  throw new Error("usage: sign-envelope.mjs generate <private> <public> | sign <payload> <private> <envelope>");
}
