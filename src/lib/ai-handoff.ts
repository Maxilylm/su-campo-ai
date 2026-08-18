const AI_HANDOFF_PREFIX = "campoai:ai-handoff:insights:";
const AI_CHAT_HANDOFF_PREFIX = "campoai:ai-handoff:chat:";
// Chat accepts 4,000 characters for a user message. Leave room for the
// instructions that wrap the generated summary before sending it.
export const AI_HANDOFF_MAX_CHARS = 3_300;

export type InsightsChatFocus = "priorities" | "tasks";

/** Keep AI handoffs scoped to the signed-in account and out of the URL. */
export function aiInsightsHandoffKey(userId: string): string {
  return `${AI_HANDOFF_PREFIX}${userId}`;
}

/** Generic one-time handoff key for operational cards that open Chat. */
export function aiChatHandoffKey(userId: string): string {
  return `${AI_CHAT_HANDOFF_PREFIX}${userId}`;
}

export interface AIHandoffItem {
  label: string;
  detail: string;
}

/** Turn alerts or agenda items into a bounded, current-data-aware Chat prompt. */
export function buildOperationalChatPrompt(items: AIHandoffItem[], source: string): string {
  const lines = items
    .filter((item) => item.label.trim() || item.detail.trim())
    .map((item) => `- ${item.label.trim()}${item.detail.trim() ? `: ${item.detail.trim()}` : ""}`)
    .join("\n")
    .slice(0, AI_HANDOFF_MAX_CHARS);
  return [
    `Revisá conmigo estos pendientes de ${source}.`,
    "Usá el estado actual de mis datos para confirmar si siguen vigentes y explicame los próximos pasos.",
    "No inventes identificadores ni fechas. Si corresponde registrar una tarea o cambio, pedime la información que falte antes de guardarlo.",
    "",
    "Contexto detectado:",
    lines || "(No se pudo cargar el detalle; revisá el módulo correspondiente.)",
  ].join("\n");
}

/** Turn the generated insight into a reviewable Chat prompt without growing indefinitely. */
export function buildInsightsChatPrompt(summary: string, focus: InsightsChatFocus = "priorities"): string {
  const trimmed = summary.trim();
  const bounded = trimmed.slice(0, AI_HANDOFF_MAX_CHARS);
  const instructions = focus === "tasks"
    ? [
      "Convertí las prioridades de este resumen en tareas pendientes concretas.",
      "Usá el estado actual de mis datos para detectar cambios desde que se generó el resumen.",
      "Proponé tareas registrables con título, prioridad y fecha solo cuando haya una fecha respaldada por los datos; no inventes fechas.",
      "Si falta información, preguntame antes de crearla. Cuando esté claro, registrá las tareas y explicame qué se guardó.",
    ]
    : [
      "Revisá este resumen del campo y ayudame a decidir los próximos pasos.",
      "Usá también el estado actual de mis datos para detectar cambios desde que se generó el resumen.",
      "Indicame las tres prioridades más importantes y, si corresponde, proponé acciones que pueda registrar.",
    ];
  return [
    ...instructions,
    "",
    "Resumen IA:",
    bounded,
  ].join("\n");
}
