import {
  closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";

export function publishJsonAtomic(output, record) {
  const parent = path.dirname(output);
  mkdirSync(parent, { recursive: true });
  const stagingDirectory = mkdtempSync(path.join(parent, `.${path.basename(output)}.stage-`));
  const staged = path.join(stagingDirectory, "record.json");
  let descriptor;
  try {
    const encoded = `${JSON.stringify(record, null, 2)}\n`;
    descriptor = openSync(staged, "wx", 0o600);
    writeFileSync(descriptor, encoded, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(staged, output);
    const directory = openSync(parent, "r");
    try { fsyncSync(directory); }
    finally { closeSync(directory); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}
