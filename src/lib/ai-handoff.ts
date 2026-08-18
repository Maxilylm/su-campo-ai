const AI_HANDOFF_PREFIX = "campoai:ai-handoff:insights:";
// Chat accepts 4,000 characters for a user message. Leave room for the
// instructions that wrap the generated summary before sending it.
export const AI_HANDOFF_MAX_CHARS = 3_300;

export type InsightsChatFocus = "priorities" | "tasks";

/** Keep AI handoffs scoped to the signed-in account and out of the URL. */
export function aiInsightsHandoffKey(userId: string): string {
  return `${AI_HANDOFF_PREFIX}${userId}`;
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
