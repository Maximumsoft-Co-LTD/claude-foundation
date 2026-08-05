import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync,
} from "node:fs";

export const SOURCE_TREE_LIMITS = Object.freeze({
  maxEntries: 1_000_000,
  maxInventoryBytes: 64 * 1024 * 1024,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
});

export function sourceTreeSha256(root, limits = SOURCE_TREE_LIMITS) {
  const inventory = spawnSync(
    "git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: null, maxBuffer: limits.maxInventoryBytes },
  );
  if (inventory.status !== 0 || inventory.error) {
    throw new Error(`git source inventory failed: ${inventory.error?.message ?? inventory.stderr}`);
  }
  const paths = splitNullInventory(inventory.stdout)
    .filter((relative) => !hasComponent(relative, Buffer.from(".changeloop")))
    .sort(Buffer.compare);
  if (paths.length > limits.maxEntries) {
    throw new Error(`source inventory exceeds ${limits.maxEntries} entries`);
  }
  const rootBytes = Buffer.from(root);
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const relative of paths) {
    validateRelative(relative);
    hash.update(relative);
    hash.update("\0");
    const absolute = Buffer.concat([rootBytes, Buffer.from("/"), relative]);
    let before;
    try { before = lstatSync(absolute, { bigint: true }); }
    catch (error) {
      if (error?.code === "ENOENT") {
        hash.update("missing\0");
        continue;
      }
      throw error;
    }
    hash.update(`${before.mode.toString(8)}\0`);
    if (before.isSymbolicLink()) {
      const target = readlinkSync(absolute, { encoding: "buffer" });
      hash.update("symlink\0");
      hash.update(target);
      hash.update("\0");
      assertUnchanged(absolute, before);
      continue;
    }
    if (!before.isFile()) {
      throw new Error(`source inventory contains unsupported non-file entry: ${relative.toString("hex")}`);
    }
    const size = Number(before.size);
    if (!Number.isSafeInteger(size) || size > limits.maxFileBytes) {
      throw new Error(`source file exceeds ${limits.maxFileBytes} bytes: ${relative.toString("hex")}`);
    }
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new Error(`source inventory exceeds ${limits.maxTotalBytes} total bytes`);
    }
    hash.update(`file\0${size}\0`);
    hashFile(hash, absolute, size, before);
    hash.update("\0");
    assertUnchanged(absolute, before);
  }
  return hash.digest("hex");
}

export function splitNullInventory(bytes) {
  const paths = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) {
      if (index > start) paths.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  if (start !== bytes.length) throw new Error("git source inventory was not NUL-terminated");
  return paths;
}

function hasComponent(relative, expected) {
  return relative
    .toString("binary")
    .split("/")
    .some((component) => Buffer.from(component, "binary").equals(expected));
}

function validateRelative(relative) {
  if (relative.length === 0 || relative[0] === 0x2f) throw new Error("invalid source path");
  const components = relative.toString("binary").split("/");
  if (components.some((component) => component === "" || component === "." || component === "..")) {
    throw new Error(`unsafe source path: ${relative.toString("hex")}`);
  }
}

function hashFile(hash, absolute, expectedBytes, expectedMetadata) {
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let observed = 0;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    for (const field of ["dev", "ino", "mode", "size"]) {
      if (opened[field] !== expectedMetadata[field]) {
        throw new Error("source entry changed before hashing");
      }
    }
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      observed += count;
      if (observed > expectedBytes) throw new Error("source file grew while hashing");
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  if (observed !== expectedBytes) throw new Error("source file changed size while hashing");
}

function assertUnchanged(absolute, before) {
  const after = lstatSync(absolute, { bigint: true });
  for (const field of ["dev", "ino", "mode", "size", "mtimeNs"]) {
    if (after[field] !== before[field]) throw new Error("source entry changed while hashing");
  }
}
