import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

describe("import direction guard: src/sim must not import pixi.js", () => {
  const simDir = join(process.cwd(), "src", "sim");

  it("finds no pixi.js imports in src/sim/**", () => {
    let files: string[] = [];
    try {
      files = collectFiles(simDir);
    } catch {
      // sim dir does not exist yet — nothing to check
    }

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (
        /from\s+['"]pixi\.js['"]/.test(content) ||
        /require\s*\(\s*['"]pixi\.js['"]\s*\)/.test(content)
      ) {
        violations.push(file);
      }
    }

    expect(
      violations,
      `pixi.js imported in sim files: ${violations.join(", ")}`,
    ).toHaveLength(0);
  });
});
