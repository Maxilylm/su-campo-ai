import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function listTsxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

describe("button semantics", () => {
  it("declares an explicit type for every native button", () => {
    const srcDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const violations = listTsxFiles(srcDirectory).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return [...source.matchAll(/<button\b(?![^>]*\btype\s*=)[^>]*>/g)].map((match) => `${path.relative(srcDirectory, filePath)}: ${match[0]}`);
    });

    expect(violations).toEqual([]);
  });
});
