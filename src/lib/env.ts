// Centralized environment validation.
// Core vars are required for the app to function at all. WhatsApp vars are
// intentionally NOT validated here — they are optional and checked lazily,
// only inside the WhatsApp route, so the app never crashes at boot without them.

const CORE_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GROQ_API_KEY",
] as const;

type CoreVar = (typeof CORE_VARS)[number];

function read(name: CoreVar): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[CampoAI] Missing required environment variable: ${name}. ` +
        `Set it in .env.local (dev) or your Vercel project settings (prod). ` +
        `See .env.example for the full list.`
    );
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return read("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
  get groqApiKey() {
    return read("GROQ_API_KEY");
  },
};

// Returns which core vars are present without throwing — for the status endpoint.
export function coreEnvPresence(): Record<CoreVar, boolean> {
  return Object.fromEntries(
    CORE_VARS.map((name) => [name, Boolean(process.env[name])])
  ) as Record<CoreVar, boolean>;
}

// WhatsApp is optional. This is the only place WhatsApp env is read.
export function whatsappConfig():
  | { configured: true; accessToken: string; phoneNumberId: string; verifyToken: string }
  | { configured: false } {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!accessToken || !phoneNumberId) return { configured: false };
  return { configured: true, accessToken, phoneNumberId, verifyToken: verifyToken ?? "" };
}
