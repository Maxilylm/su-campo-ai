const AI_HANDOFF_PREFIX = "campoai:ai-handoff:insights:";
// Chat accepts 4,000 characters for a user message. Leave room for the
// instructions that wrap the generated summary before sending it.
export const AI_HANDOFF_MAX_CHARS = 3_500;

/** Keep AI handoffs scoped to the signed-in account and out of the URL. */
export function aiInsightsHandoffKey(userId: string): string {
  return `${AI_HANDOFF_PREFIX}${userId}`;
}

/** Turn the generated insight into a reviewable Chat prompt without growing indefinitely. */
export function buildInsightsChatPrompt(summary: string): string {
  const trimmed = summary.trim();
  const bounded = trimmed.slice(0, AI_HANDOFF_MAX_CHARS);
  return [
    "Revisá este resumen del campo y ayudame a decidir los próximos pasos.",
    "Usá también el estado actual de mis datos para detectar cambios desde que se generó el resumen.",
    "Indicame las tres prioridades más importantes y, si corresponde, proponé acciones que pueda registrar.",
    "",
    "Resumen IA:",
    bounded,
  ].join("\n");
}
