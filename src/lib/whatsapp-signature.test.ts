import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { verifyWhatsAppSignature } from "./whatsapp-signature";

describe("verifyWhatsAppSignature", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const secret = "test-app-secret";
  const valid = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts a valid signature", () => {
    expect(verifyWhatsAppSignature(body, valid, secret)).toBe(true);
  });

  it("rejects a wrong or malformed signature", () => {
    expect(verifyWhatsAppSignature(body, `${valid.slice(0, -1)}0`, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, "sha256=not-hex", secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, null, secret)).toBe(false);
  });
});
