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
    schema?: { available?: boolean; reason?: string; missingMigrations?: string[] };
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

interface SupabaseErrorLike {
  code?: string;
  message?: string;
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
    || error?.code === "42703"
    || error?.code === "42P01"
    || /(?:column|relation|table|function).*\b(?:does not exist|not found|could not find)/i.test(error?.message || "");
}

export function classifySchemaProbe(
  errors: Array<SupabaseErrorLike | null | undefined>,
  timedOut = false,
  configured = true,
): SchemaProbeReason {
  if (!configured) return "missing_env";
  if (timedOut) return "timeout";
  if (errors.some((error) => error && !isMissingSchemaElement(error))) return "query_error";
  if (errors.some((error) => isMissingSchemaElement(error))) return "migration_required";
  return "ok";
}

const SCHEMA_MIGRATION_NAMES = [
  "supabase/016_cattle_ear_tags.sql",
  "supabase/013_inventory_currency.sql",
  "supabase/013_inventory_currency.sql",
  "supabase/015_financial_inventory_links.sql",
  "supabase/017_idempotency.sql",
  "supabase/017_idempotency.sql",
  "supabase/019_padron_idempotency.sql",
  "supabase/020_import_idempotency.sql",
  "supabase/020_import_idempotency.sql",
  "supabase/020_import_idempotency.sql",
  "supabase/022_task_idempotency.sql",
  "supabase/023_financial_idempotency.sql",
  "supabase/024_operational_idempotency.sql",
  "supabase/024_operational_idempotency.sql",
  "supabase/024_operational_idempotency.sql",
  "supabase/024_operational_idempotency.sql",
  "supabase/025_map_feature_idempotency.sql",
  "supabase/019_padron_idempotency.sql",
  "supabase/018_padron_transaction.sql",
  "supabase/021_cattle_move_transaction.sql",
  "supabase/029_hacienda_idempotency.sql",
  "supabase/029_hacienda_idempotency.sql",
] as const;

/** Translate the ordered schema probes into actionable migration paths. */
export function missingSchemaMigrations(errors: Array<SupabaseErrorLike | null | undefined>): string[] {
  return Array.from(new Set(errors
    .map((error, index) => isMissingSchemaElement(error) ? SCHEMA_MIGRATION_NAMES[index] : null)
    .filter((migration): migration is Exclude<typeof migration, null> => Boolean(migration))))
    .sort((a, b) => Number(a.match(/\/(\d+)_/)?.[1] || 0) - Number(b.match(/\/(\d+)_/)?.[1] || 0));
}

// These migrations improve atomicity for features that retain a validated
// compatibility path when an older production database has not caught up.
// Keep them visible in diagnostics, but do not make the whole application
// unavailable because of them.
const COMPATIBILITY_SCHEMA_MIGRATIONS = new Set([
  "supabase/018_padron_transaction.sql",
  "supabase/019_padron_idempotency.sql",
  "supabase/021_cattle_move_transaction.sql",
]);

export function isCompatibilitySchemaDrift(missingMigrations: string[]): boolean {
  return missingMigrations.length > 0
    && missingMigrations.every((migration) => COMPATIBILITY_SCHEMA_MIGRATIONS.has(migration));
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

/** Core readiness tolerates only schema drift with an explicit fallback. */
export function coreServicesReady(
  supabase: boolean,
  auth: boolean,
  groq: boolean,
  schemaReason: SchemaProbeReason,
  missingMigrations: string[] = [],
): boolean {
  if (!supabase || !auth || !groq) return false;
  if (schemaReason === "ok") return true;
  return schemaReason === "migration_required"
    && missingMigrations.length > 0
    && isCompatibilitySchemaDrift(missingMigrations);
}

export function serviceStatusLabel(status: AppServiceStatus, supabaseReason?: string, groqReason?: string, authReason?: string, schemaReason?: string): string {
  if (status === "checking") return "Verificando servicios…";
  if (status === "healthy") return "Servicios disponibles";
  if (authReason === "missing_env") return "La autenticación de Supabase no está configurada";
  if (authReason === "timeout") return "La autenticación de Supabase está tardando";
  if (authReason === "query_error") return "Supabase Auth no responde en este momento";
  if (supabaseReason === "missing_env") return "Supabase no está configurado";
  if (supabaseReason === "timeout") return "Supabase está tardando en responder";
  if (supabaseReason === "query_error") return "Supabase no responde en este momento";
  if (groqReason === "missing_env") return "La IA no está configurada";
  if (schemaReason === "migration_required") return "Supabase necesita una migración";
  if (schemaReason === "timeout") return "La verificación de Supabase está tardando";
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
    && isCompatibilitySchemaDrift(payload.features.schema.missingMigrations ?? [])) return "healthy";
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
