const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface MutationOriginInput {
  method: string;
  pathname: string;
  expectedOrigin: string;
  origin?: string | null;
  referer?: string | null;
  secFetchSite?: string | null;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Returns true only for suspicious cross-site writes to internal API routes. */
export function shouldBlockCrossSiteMutation(input: MutationOriginInput): boolean {
  if (!MUTATION_METHODS.has(input.method.toUpperCase())) return false;
  // WhatsApp is an intentionally public server-to-server webhook and does not
  // carry the browser origin headers used by this defense.
  if (input.pathname === "/api/whatsapp" || input.pathname.startsWith("/api/whatsapp/")) return false;
  if (input.secFetchSite?.toLowerCase() === "cross-site") return true;

  const expected = normalizeOrigin(input.expectedOrigin);
  if (!expected) return true;

  if (input.origin != null && input.origin !== "") {
    return normalizeOrigin(input.origin) !== expected;
  }

  // Some non-browser clients omit Origin. Preserve those integrations, but
  // still reject a supplied Referer from another origin.
  if (input.referer != null && input.referer !== "") {
    return normalizeOrigin(input.referer) !== expected;
  }

  return false;
}
