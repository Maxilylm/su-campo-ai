import { readFileSync } from "node:fs";
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
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    expect(source).not.toMatch(BARE_LABEL_INPUT_PATTERN);
  });
});
