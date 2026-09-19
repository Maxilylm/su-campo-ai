import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression guard for the FormField a11y migration: the exact
// `<Label>text</Label><Input .../>` one-liner pattern (an unassociated
// label — no htmlFor, no id) must not creep back into the files where we
// just replaced every instance with <FormField>.
const MIGRATED_FILES = [
  "../app/gestion/finanzas/page.tsx",
  "../app/gestion/inventario/page.tsx",
  "../app/produccion/hacienda/page.tsx",
];

const BARE_LABEL_INPUT_PATTERN = /<div className="space-y-2"><Label>[^<]*<\/Label><Input /;

describe("FormField a11y migration", () => {
  it.each(MIGRATED_FILES)("%s has no unassociated Label+Input one-liners left", (relativePath) => {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    expect(source).not.toMatch(BARE_LABEL_INPUT_PATTERN);
  });
});

function listTsxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

// General guard for the full GOAL-audit-2026-09.md a11y sweep (all 84
// <Label>s across the dialog forms): every <Label> must carry htmlFor
// (pointing to a control's id, e.g. a Select's SelectTrigger) or its own
// id (for the group-label pattern: <Label id={x}> + role="group"
// aria-labelledby={x} on a non-form-control group like toggle buttons or
// color swatches, where htmlFor has no single control to point to).
describe("Label htmlFor coverage", () => {
  it("every <Label> in src/app is associated with a control", () => {
    const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");
    const violations = listTsxFiles(appDirectory).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return [...source.matchAll(/<Label(\s[^>]*)?>/g)]
        .filter((match) => {
          const attrs = match[1] || "";
          return !/\bhtmlFor=/.test(attrs) && !/\bid=/.test(attrs);
        })
        .map((match) => `${path.relative(appDirectory, filePath)}: ${match[0]}`);
    });

    expect(violations).toEqual([]);
  });
});
