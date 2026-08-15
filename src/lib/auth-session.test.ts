import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_EXPIRED_EVENT, notifyAuthExpired, subscribeToAuthExpired } from "./auth-session";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth session expiry events", () => {
  it("notifies listeners in the active browser tab", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const listener = vi.fn();
    const unsubscribe = subscribeToAuthExpired(listener);

    notifyAuthExpired();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
