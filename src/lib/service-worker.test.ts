import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serviceWorker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("service worker shell", () => {
  it("precaches the current PWA icon set", () => {
    expect(serviceWorker).toContain('const SHELL_CACHE = "campoai-shell-v5"');
    expect(serviceWorker).toContain('const PUBLIC_ASSET_CACHE = "campoai-public-assets-v1"');
    expect(serviceWorker).toContain('"/icon-192.png"');
    expect(serviceWorker).toContain('"/icon-512.png"');
    expect(serviceWorker).toContain('"/apple-touch-icon.png"');
  });

  it("caches PNG assets requested after installation", () => {
    expect(serviceWorker).toContain('url.pathname.endsWith(".png")');
  });

  it("clears private page shells without deleting public assets on logout", () => {
    expect(serviceWorker).toContain('event.data?.type === "CLEAR_AUTHENTICATED_SHELL"');
    expect(serviceWorker).toContain('caches.delete(SHELL_CACHE)');
    expect(serviceWorker).toContain('key !== PUBLIC_ASSET_CACHE');
  });
});
