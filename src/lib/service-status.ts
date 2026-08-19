export type TasksProbeReason = "ok" | "migration_required" | "query_error" | "timeout" | "missing_env";
export type SupabaseProbeReason = "ok" | "missing_env" | "query_error" | "timeout";
export type AuthProbeReason = "ok" | "missing_env" | "query_error" | "timeout";
export type GroqProbeReason = "ok" | "missing_env";
export type SchemaProbeReason = "ok" | "migration_required" | "query_error" | "timeout" | "missing_env";
export type AppServiceStatus = "checking" | "healthy" | "degraded";
export type ServiceProbe = "healthy" | "missing" | "unavailable" | "offline" | "checking";
export type ServiceKey = "supabase" | "auth" | "groq" | "tasks" | "schema" | "chatRetries" | "sampleData";
export const HEALTH_CHECKED_AT_HEADER = "X-CampoAI-Health-Checked-At";
export const HEALTH_CHECK_TIMEOUT_MS = 12_000;
const HEALTHY_CACHE_CONTROL = "public, max-age=15, s-maxage=30, stale-while-revalidate=60";

/** Keep recovered health checks cacheable, but never keep an outage alive in
 * the browser or at the edge after Supabase has recovered. */
export function healthCacheHeaders(healthy: boolean): Record<string, string> {
  const cacheControl = healthy ? HEALTHY_CACHE_CONTROL : "no-store, max-age=0";
  return {
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": healthy ? HEALTHY_CACHE_CONTROL : "no-store",
  };
}

export interface ServiceStatusPayload {
  ok?: boolean;
  supabase?: boolean;
  auth?: boolean;
  groq?: boolean;
  supabaseReason?: string;
  authReason?: string;
  groqReason?: string;
  features?: {
    tasks?: { available?: boolean; reason?: string };
    schema?: { available?: boolean; reason?: string; missingMigrations?: string[]; issues?: SchemaProbeIssue[] };
    chatRetries?: { available?: boolean; reason?: string };
    sampleData?: { available?: boolean; reason?: string };
  };
}

/**
 * Prefer the server-side probe timestamp over the browser receive time. The
 * public status response is intentionally cached, so these values can differ.
 */
export function readHealthCheckedAt(
  response: Pick<Response, "headers">,
  fallback = new Date().toISOString(),
): string {
  const value = response.headers.get(HEALTH_CHECKED_AT_HEADER);
  if (!value || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

export interface SupabaseErrorLike {
  code?: string;
  message?: string;
  name?: string;
  status?: number;
}

function normalizedProbeCode(error: { code?: unknown; message?: unknown; name?: unknown }): string {
  if (typeof error.code === "string" && error.code) return error.code;
  const message = typeof error.message === "string" ? error.message : "";
  const name = typeof error.name === "string" ? error.name : "";
  if (name === "AbortError" || /(?:aborted|timeout)/i.test(message)) return "TIMEOUT";
  if (name === "TypeError" || /(?:fetch failed|network|socket|connection (?:failed|reset)|ECONN)/i.test(message)) return "NETWORK_ERROR";
  return "QUERY_ERROR";
}

/** Preserve safe provider codes while keeping probe failures generic. */
export function normalizeSupabaseProbeError(error: unknown, fallbackMessage: string): SupabaseErrorLike {
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      name?: unknown;
      status?: unknown;
    };
    return {
      code: normalizedProbeCode(candidate),
      message: typeof candidate.message === "string" ? candidate.message : fallbackMessage,
      ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
      ...(typeof candidate.status === "number" ? { status: candidate.status } : {}),
    };
  }
  return { code: "QUERY_ERROR", message: fallbackMessage };
}

export interface SchemaProbeResult {
  migration: string;
  critical?: boolean;
  error: SupabaseErrorLike | null | undefined;
}

export interface SchemaProbeIssue {
  migration: string;
  code: string;
  name?: string;
  status?: number;
}

export function isMissingTasksTable(error: SupabaseErrorLike | null | undefined): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

function isExpectedUnauthenticatedResponse(error: SupabaseErrorLike | null | undefined): boolean {
  return error?.status === 401
    || error?.name === "AuthSessionMissingError"
    || /(?:auth session missing|invalid jwt|invalid token|no authorization)/i.test(error?.message || "");
}

export function classifyAuthProbe(
  error: SupabaseErrorLike | null | undefined,
  timedOut = false,
  configured = true,
): AuthProbeReason {
  if (!configured) return "missing_env";
  if (timedOut) return "timeout";
  if (!error || isExpectedUnauthenticatedResponse(error)) return "ok";
  return "query_error";
}

export function classifyTasksProbe(
  error: SupabaseErrorLike | null | undefined,
  timedOut = false,
  configured = true,
): TasksProbeReason {
  if (!configured) return "missing_env";
  if (timedOut) return "timeout";
  if (!error) return "ok";
  return isMissingTasksTable(error) ? "migration_required" : "query_error";
}

export function isMissingSchemaElement(error: SupabaseErrorLike | null | undefined): boolean {
  return error?.code === "PGRST204"
    || error?.code === "PGRST205"
    || error?.code === "PGRST202"
    || error?.code === "PGRST203"
    || error?.code === "42703"
    || error?.code === "42P01"
    || error?.code === "42704"
    || error?.code === "42883"
    || /(?:column|relation|table|function|procedure|type).*\b(?:does not exist|not found|could not find|undefined)/i.test(error?.message || "")
    // PostgREST commonly phrases schema-cache drift in the opposite order:
    // "Could not find ... column ... in the schema cache". Treat it as a
    // migration gap instead of hiding it as a generic query failure.
    || /(?:could not find|does not exist|not found|undefined).*\b(?:column|relation|table|function|procedure|type)\b/i.test(error?.message || "");
}

export function classifySchemaProbe(
  errors: Array<SupabaseErrorLike | null | undefined>,
  timedOut = false,
  configured = true,
): SchemaProbeReason {
  if (!configured) return "missing_env";
  if (timedOut) return "timeout";
  if (errors.some((error) => error?.code === "TIMEOUT")) return "timeout";
  if (errors.some((error) => error && !isMissingSchemaElement(error))) return "query_error";
  if (errors.some((error) => isMissingSchemaElement(error))) return "migration_required";
  return "ok";
}

/** Translate named schema probes into actionable migration paths. */
export function missingSchemaMigrations(probes: SchemaProbeResult[]): string[] {
  return Array.from(new Set(probes
    .filter(({ error }) => isMissingSchemaElement(error))
    .map(({ migration }) => migration)
    .filter(Boolean)))
    .sort((a, b) => Number(a.match(/\/(\d+)_/)?.[1] || 0) - Number(b.match(/\/(\d+)_/)?.[1] || 0));
}

/** Expose only safe, actionable probe metadata; never return provider messages. */
export function schemaProbeIssues(probes: SchemaProbeResult[]): SchemaProbeIssue[] {
  const seen = new Set<string>();
  const issues: SchemaProbeIssue[] = [];
  for (const { migration, error } of probes) {
    // A batch timeout is already represented by the schema reason; listing
    // every uncompleted migration would make a transient slowdown look like
    // dozens of independent schema defects.
    if (!migration || !error || error.code === "TIMEOUT" || isMissingSchemaElement(error)) continue;
    const code = typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "QUERY_ERROR";
    const key = `${migration}:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = typeof error.name === "string" && /^[A-Za-z][A-Za-z0-9_$]*$/.test(error.name)
      ? error.name
      : undefined;
    issues.push({
      migration,
      code,
      ...(name ? { name } : {}),
      ...(typeof error.status === "number" ? { status: error.status } : {}),
    });
  }
  return issues;
}

// These migrations improve atomicity for features that retain a validated
// compatibility path when an older production database has not caught up.
// Keep them visible in diagnostics, but do not make the whole application
// unavailable because of them.
const COMPATIBILITY_SCHEMA_MIGRATIONS = new Set([
  "supabase/018_padron_transaction.sql",
  "supabase/019_padron_idempotency.sql",
  "supabase/021_cattle_move_transaction.sql",
  "supabase/030_inventory_item_idempotency.sql",
]);

export function isCompatibilitySchemaDrift(missingMigrations: string[]): boolean {
  return missingMigrations.length > 0
    && missingMigrations.every((migration) => COMPATIBILITY_SCHEMA_MIGRATIONS.has(migration));
}

/** Whether the schema supports the application's current compatibility path.
 * A compatible migration gap remains visible through `reason` and
 * `missingMigrations`, but should not contradict an overall healthy status. */
export function schemaFeatureAvailable(reason: SchemaProbeReason, missingMigrations: string[] = []): boolean {
  return reason === "ok" || (reason === "migration_required" && isCompatibilitySchemaDrift(missingMigrations));
}

export function normalizeSchemaProbeReason(
  reason: SchemaProbeReason,
  missingMigrations: string[],
): SchemaProbeReason {
  const onlyCompatibilityDrift = isCompatibilitySchemaDrift(missingMigrations);
  return onlyCompatibilityDrift && (reason === "query_error" || reason === "migration_required")
    ? "migration_required"
    : reason;
}

/** Core readiness tolerates uncertain optional schema checks: a timeout is not
 * evidence of drift, while a confirmed incompatible migration still blocks. */
export function coreServicesReady(
  supabase: boolean,
  auth: boolean,
  groq: boolean,
  schemaReason: SchemaProbeReason,
  missingMigrations: string[] = [],
  supabaseReason: SupabaseProbeReason = supabase ? "ok" : "query_error",
  authReason: AuthProbeReason = auth ? "ok" : "query_error",
): boolean {
  // A bounded probe timeout means the dependency is uncertain, not confirmed
  // offline. Keep the app available while exposing the timeout to the UI and
  // the individual service indicators so the next request can recover.
  const supabaseReady = supabase || supabaseReason === "timeout";
  const authReady = auth || authReason === "timeout";
  if (!supabaseReady || !authReady || !groq) return false;
  if (schemaReason === "ok") return true;
  if (schemaReason === "timeout") return true;
  return schemaReason === "migration_required"
    && missingMigrations.length > 0
    && isCompatibilitySchemaDrift(missingMigrations);
}

export function serviceStatusLabel(status: AppServiceStatus, supabaseReason?: string, groqReason?: string, authReason?: string, schemaReason?: string): string {
  if (status === "checking") return "Verificando servicios…";
  if (status === "healthy") {
    if (authReason === "timeout") return "Servicios disponibles; Auth está tardando";
    if (supabaseReason === "timeout") return "Servicios disponibles; Supabase está tardando";
    if (schemaReason === "timeout") return "Servicios disponibles; verificación pendiente";
    return "Servicios disponibles";
  }
  if (authReason === "missing_env") return "La autenticación de Supabase no está configurada";
  if (authReason === "timeout") return "La autenticación de Supabase está tardando";
  if (authReason === "query_error") return "Supabase Auth no responde en este momento";
  if (supabaseReason === "missing_env") return "Supabase no está configurado";
  if (supabaseReason === "timeout") return "Supabase está tardando en responder";
  if (supabaseReason === "query_error") return "Supabase no responde en este momento";
  if (groqReason === "missing_env") return "La IA no está configurada";
  if (schemaReason === "migration_required") return "Supabase necesita una migración";
  if (schemaReason === "timeout") return "La verificación de Supabase está tardando";
  if (schemaReason === "query_error") return "No se pudo verificar el esquema de Supabase";
  return "Conexión con servicios interrumpida";
}

export function serviceProbe(payload: ServiceStatusPayload | null, service: ServiceKey, online: boolean): ServiceProbe {
  if (!online) return "offline";
  if (!payload) return "checking";
  if (service === "supabase") {
    if (payload.supabase) return "healthy";
    return payload.supabaseReason === "missing_env" ? "missing" : "unavailable";
  }
  if (service === "groq") {
    if (payload.groq) return "healthy";
    return payload.groqReason === "missing_env" ? "missing" : "unavailable";
  }
  if (service === "auth") {
    if (payload.auth) return "healthy";
    return payload.authReason === "missing_env" ? "missing" : "unavailable";
  }
  if (service === "tasks") {
    if (payload.features?.tasks?.available) return "healthy";
    return payload.features?.tasks?.reason === "migration_required" ? "missing" : "unavailable";
  }
  if (service === "chatRetries") {
    // Older deployments do not expose this optional diagnostic yet; the Chat
    // route remains backward-compatible and falls back safely in that case.
    if (!payload.features?.chatRetries) return "healthy";
    if (payload.features.chatRetries.available) return "healthy";
    return payload.features.chatRetries.reason === "migration_required" ? "missing" : "unavailable";
  }
  if (service === "sampleData") {
    // Older deployments do not expose this optional diagnostic yet.
    if (!payload.features?.sampleData) return "healthy";
    if (payload.features.sampleData.available) return "healthy";
    return payload.features.sampleData.reason === "migration_required" ? "missing" : "unavailable";
  }
  if (payload.features?.schema?.available) return "healthy";
  if (payload.features?.schema?.reason === "migration_required"
    && schemaFeatureAvailable("migration_required", payload.features.schema.missingMigrations ?? [])) return "healthy";
  return payload.features?.schema?.reason === "migration_required" ? "missing" : "unavailable";
}

export function serviceProbeLabel(probe: ServiceProbe, service: ServiceKey): string {
  if (probe === "checking") return "Comprobando…";
  if (probe === "offline") return "Sin conexión";
  if (probe === "healthy") return "Disponible";
  if (probe === "missing") return service === "tasks" || service === "schema" || service === "chatRetries" || service === "sampleData" ? "Requiere migración" : "No configurado";
  return service === "tasks" ? "No disponible" : "No responde";
}

export function serviceProbeDetail(probe: ServiceProbe, service: ServiceKey): string | null {
  if (probe === "missing" && service === "tasks") return "Aplicá supabase/014_tasks.sql para activar la agenda.";
  if (probe === "missing" && service === "chatRetries") return "Aplicá supabase/026_chat_request_idempotency.sql para evitar duplicados al reintentar el Chat.";
  if (probe === "missing" && service === "sampleData") return "Aplicá supabase/028_sample_data_idempotency.sql para evitar duplicados al cargar datos de ejemplo.";
  if (probe === "missing" && service === "schema") return "Hay migraciones de datos pendientes. Revisá la lista indicada abajo.";
  if (probe === "missing" && service === "supabase") return "Revisá las variables de entorno de Supabase.";
  if (probe === "missing" && service === "groq") return "Revisá GROQ_API_KEY si querés usar el chat y los resúmenes.";
  if (probe === "unavailable" && service === "auth") return "La base puede estar disponible aunque el inicio de sesión no responda.";
  if (probe === "unavailable") return "Reintentá cuando el servicio vuelva a responder.";
  return null;
}
