import { buildAIChangeLinks, type AIChangeLink } from "./ai-change-links";

export interface ChatOperationResponse {
  response: string;
  operationMigration?: string;
  changeLinks?: AIChangeLink[];
}

const MIGRATION_PATTERN = /\bsupabase\/\d{3}_[a-z0-9_-]+\.sql\b/i;

export function extractMissingMigration(logs: string[]): string | null {
  for (const log of logs) {
    const migration = log.match(MIGRATION_PATTERN)?.[0];
    if (migration) return migration;
  }
  return null;
}

export function annotateOperationErrors(target: ChatOperationResponse, logs: string[]): string | null {
  delete target.operationMigration;
  if (logs.length === 0) return null;

  const migration = extractMissingMigration(logs);
  target.response += migration
    ? `\n\n⚠️ No se completó este cambio porque falta ${migration}. Abrí Gestión > Mi campo > Salud de los servicios para revisar Supabase.`
    : "\n\n⚠️ Algunos cambios no se guardaron correctamente. Intentá nuevamente.";
  if (migration) target.operationMigration = migration;
  return migration;
}

/** Apply one post-operation contract to Web Chat, audio and WhatsApp. Links
 * are only exposed when every requested operation completed without errors. */
export function applyAIChangeFeedback(
  target: ChatOperationResponse,
  operations: Parameters<typeof buildAIChangeLinks>[0],
  logs: string[],
): AIChangeLink[] {
  annotateOperationErrors(target, logs);
  if (logs.length > 0) {
    delete target.changeLinks;
    return [];
  }
  const links = buildAIChangeLinks(operations);
  if (links.length > 0) target.changeLinks = links;
  else delete target.changeLinks;
  return links;
}
