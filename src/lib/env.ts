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

const PLACEHOLDER_VALUES = new Set([
  "your-project.supabase.co",
  "https://your-project.supabase.co",
  "your-anon-key",
  "your-service-role-key",
  "your-groq-api-key",
]);

function isConfiguredCoreValue(name: CoreVar, value: string | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized || PLACEHOLDER_VALUES.has(normalized.toLowerCase())) return false;
  if (name !== "NEXT_PUBLIC_SUPABASE_URL") return true;

  try {
    const url = new URL(normalized);
    return (url.protocol === "https:" || url.protocol === "http:")
      && url.hostname.toLowerCase() !== "your-project.supabase.co";
  } catch {
    return false;
  }
}

// Literal process.env.X member expressions are required: Next.js only inlines
// NEXT_PUBLIC_* values into the client bundle when the access is a static
// property read. A computed process.env[name] lookup is left as-is and comes
// back undefined in the browser, breaking getSupabaseBrowser() in production.
function raw(name: CoreVar): string | undefined {
  switch (name) {
    case "NEXT_PUBLIC_SUPABASE_URL":
      return process.env.NEXT_PUBLIC_SUPABASE_URL;
    case "NEXT_PUBLIC_SUPABASE_ANON_KEY":
      return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    case "SUPABASE_SERVICE_ROLE_KEY":
      return process.env.SUPABASE_SERVICE_ROLE_KEY;
    case "GROQ_API_KEY":
      return process.env.GROQ_API_KEY;
  }
}

function read(name: CoreVar): string {
  const value = raw(name);
  if (!value || !isConfiguredCoreValue(name, value)) {
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
    CORE_VARS.map((name) => [name, isConfiguredCoreValue(name, raw(name))])
  ) as Record<CoreVar, boolean>;
}

// WhatsApp is optional. This is the only place WhatsApp env is read.
// appSecret (the Meta app secret) is required to authenticate inbound webhook
// POSTs via X-Hub-Signature-256 — without it the webhook rejects all POSTs.
export function whatsappConfig():
  | { configured: true; accessToken: string; phoneNumberId: string; verifyToken: string; appSecret: string }
  | { configured: false } {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!accessToken || !phoneNumberId) return { configured: false };
  return {
    configured: true,
    accessToken,
    phoneNumberId,
    verifyToken: verifyToken ?? "",
    appSecret: appSecret ?? "",
  };
}
