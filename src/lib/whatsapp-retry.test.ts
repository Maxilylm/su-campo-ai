import { describe, expect, it } from "vitest";
import { isReplayableWhatsAppEvent } from "./whatsapp-retry";

describe("WhatsApp retry state", () => {
  it("replays only after side effects have a stored response", () => {
    expect(isReplayableWhatsAppEvent({ status: "side_effects_done", response_text: "Listo" })).toBe(true);
    expect(isReplayableWhatsAppEvent({ status: "processing", response_text: "Listo" })).toBe(false);
    expect(isReplayableWhatsAppEvent({ status: "side_effects_done", response_text: " " })).toBe(false);
  });
});
