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

export interface AIWeatherHandoff {
  place?: string;
  current: {
    condition: string;
    temp: number;
    wind: number;
    precip: number;
  };
  forecast?: Array<{ date: string; tmax: number; tmin: number; precip: number; condition: string }>;
}

export interface AIReportHandoff {
  title: string;
  facts: string[];
  partial?: boolean;
}

export interface AIMetricsHandoff {
  title: string;
  facts: string[];
  partial?: boolean;
}

export interface AIWeightHandoff {
  title: string;
  facts: string[];
  averageDailyGain?: number | null;
  partial?: boolean;
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

/** Give Chat the same weather snapshot the dashboard just showed the user. */
export function buildWeatherChatPrompt(weather: AIWeatherHandoff): string {
  const forecast = (weather.forecast || [])
    .slice(0, 3)
    .map((day) => `- ${day.date}: ${day.condition}, ${Math.round(day.tmin)}–${Math.round(day.tmax)} °C, lluvia ${Math.round(day.precip * 10) / 10} mm`)
    .join("\n");
  return [
    "Analizá conmigo el clima actual de mi campo y cómo afecta el trabajo de hoy.",
    "Usá estos datos como una medición puntual: no inventes pronósticos ni reemplaces una recomendación técnica profesional.",
    "Si corresponde pulverizar, cosechar o postergar una tarea, explicá qué dato respalda la recomendación y qué debería verificar.",
    "",
    `Ubicación: ${weather.place?.trim() || "no indicada"}`,
    `Ahora: ${weather.current.condition}, ${Math.round(weather.current.temp)} °C, viento ${Math.round(weather.current.wind)} km/h, precipitación ${Math.round(weather.current.precip * 10) / 10} mm`,
    forecast ? `Pronóstico cercano:\n${forecast}` : "Pronóstico cercano: no disponible",
  ].join("\n").slice(0, AI_HANDOFF_MAX_CHARS);
}

/** Give Chat the selected printable report while asking it to re-check the
 * live farm context before making a recommendation. */
export function buildReportChatPrompt(report: AIReportHandoff): string {
  const facts = report.facts
    .filter((fact) => typeof fact === "string" && fact.trim())
    .slice(0, 40)
    .map((fact) => `- ${fact.trim()}`)
    .join("\n")
    .slice(0, AI_HANDOFF_MAX_CHARS);
  return [
    `Analizá conmigo el reporte «${report.title.trim() || "seleccionado"}».`,
    "Contrastá estos números visibles con el estado actual de mis datos antes de sacar conclusiones.",
    "No combines monedas, no inventes registros ni fechas y aclarame si el reporte está incompleto.",
    "Si detectás una prioridad, explicá el dato que la respalda y proponé el próximo paso; pedime confirmación antes de guardar cambios.",
    "",
    report.partial ? "AVISO: el reporte visible está limitado a una muestra de registros." : "",
    "Datos visibles del reporte:",
    facts || "- No hay datos visibles en este reporte.",
  ].filter(Boolean).join("\n");
}

/** Turn the selected KPI filter into a bounded, decision-oriented Chat prompt. */
export function buildMetricsChatPrompt(metrics: AIMetricsHandoff): string {
  const facts = metrics.facts
    .filter((fact) => typeof fact === "string" && fact.trim())
    .slice(0, 40)
    .map((fact) => `- ${fact.trim()}`)
    .join("\n")
    .slice(0, AI_HANDOFF_MAX_CHARS);
  return [
    `Interpretá conmigo las métricas «${metrics.title.trim() || "seleccionadas"}».`,
    "Usá el estado actual de mis datos para explicar qué cambió, qué merece atención y qué acción concreta conviene evaluar.",
    "No combines monedas, no confundas una correlación con una causa y no inventes datos ausentes.",
    "Si proponés registrar una tarea o cambio, pedime confirmación y la información que falte antes de guardarlo.",
    "",
    metrics.partial ? "AVISO: estas métricas usan una muestra parcial de algunas fuentes." : "",
    "Indicadores visibles:",
    facts || "- No hay indicadores visibles para este filtro.",
  ].filter(Boolean).join("\n");
}

/** Turn the selected weight history into a bounded, livestock-focused Chat prompt. */
export function buildWeightChatPrompt(weights: AIWeightHandoff): string {
  const facts = weights.facts
    .filter((fact) => typeof fact === "string" && fact.trim())
    .slice(0, 30)
    .map((fact) => `- ${fact.trim()}`)
    .join("\n")
    .slice(0, AI_HANDOFF_MAX_CHARS);
  const adg = typeof weights.averageDailyGain === "number" && Number.isFinite(weights.averageDailyGain)
    ? `GMD calculada: ${weights.averageDailyGain.toFixed(3)} kg/día`
    : "GMD calculada: no disponible con los pesajes visibles";
  return [
    `Analizá conmigo la evolución de peso de «${weights.title.trim() || "lote seleccionado"}».`,
    "Usá el contexto actual de mi hacienda para validar a qué lote corresponden los datos y explicá la tendencia sin inventar pesajes ausentes.",
    "Si la GMD es negativa o la serie es insuficiente, señalalo y proponé qué dato conviene revisar antes de tomar una decisión.",
    "Si corresponde registrar un nuevo pesaje o crear una tarea de seguimiento, pedime confirmación y la información que falte antes de guardarlo.",
    "",
    adg,
    weights.partial ? "AVISO: el historial visible está limitado a una muestra reciente." : "",
    "Pesajes visibles:",
    facts || "- No hay pesajes visibles para este lote.",
  ].filter(Boolean).join("\n");
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
