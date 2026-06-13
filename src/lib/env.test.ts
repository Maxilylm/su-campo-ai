import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { coreEnvPresence, whatsappConfig } from "./env";

const CORE = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GROQ_API_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
] as const;

describe("env helpers", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of CORE) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of CORE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reports all core vars absent", () => {
    const p = coreEnvPresence();
    expect(p.NEXT_PUBLIC_SUPABASE_URL).toBe(false);
    expect(p.GROQ_API_KEY).toBe(false);
  });

  it("reports a core var present when set", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    expect(coreEnvPresence().GROQ_API_KEY).toBe(true);
  });

  it("treats WhatsApp as unconfigured without the required tokens", () => {
    expect(whatsappConfig().configured).toBe(false);
  });

  it("treats WhatsApp as unconfigured with only one token", () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    expect(whatsappConfig().configured).toBe(false);
  });

  it("treats WhatsApp as configured when access token + phone id are set", () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    const wa = whatsappConfig();
    expect(wa.configured).toBe(true);
    if (wa.configured) {
      expect(wa.accessToken).toBe("tok");
      expect(wa.phoneNumberId).toBe("123");
    }
  });
});
