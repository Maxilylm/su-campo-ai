import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serviceWorker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("service worker shell", () => {
  it("precaches the current PWA icon set", () => {
    expect(serviceWorker).toContain('const SHELL_CACHE = "campoai-shell-v4"');
    expect(serviceWorker).toContain('"/icon-192.png"');
    expect(serviceWorker).toContain('"/icon-512.png"');
    expect(serviceWorker).toContain('"/apple-touch-icon.png"');
  });

  it("caches PNG assets requested after installation", () => {
    expect(serviceWorker).toContain('url.pathname.endsWith(".png")');
  });
});
