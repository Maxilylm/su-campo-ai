// "Plan del día": today's work grouped by potrero, so it reads as a route a
// manager can hand to whoever goes out to the field. Pure — the route fetches
// the agenda, field status and weather and passes them in.
import type { AgendaItem } from "./agenda";
import type { RotationMove, SectionFieldStatus } from "./grazing";
import { sprayAdvice } from "./weather";

export type PlanItemKind = "move" | "water" | "task" | "vaccination" | "harvest";
export type PlanUrgency = "overdue" | "today" | "soon";

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  urgency: PlanUrgency;
  title: string;
  detail: string;
  href: string;
  /** Set when today's weather says not to do this now. */
  blockedBy?: string;
  /** Move items: the suggested destination potrero. */
  destinationSectionId?: string;
}

export interface PlanStop {
  sectionId: string | null;
  name: string;
  /** One line on what is there now, e.g. "40 vacas · 23 d". */
  context: string | null;
  items: PlanItem[];
}

export interface PlanWeather {
  sprayOk: boolean;
  sprayReason: string;
  notes: string[];
}

export interface DailyPlan {
  date: string;
  weather: PlanWeather | null;
  stops: PlanStop[];
  counts: { total: number; overdue: number; blocked: number };
}

export interface DailyPlanInput {
  today: string;
  agenda: AgendaItem[];
  statuses: SectionFieldStatus[];
  rotation: RotationMove[];
  weather: {
    current?: { wind: number; precip: number; temp?: number };
    today?: { tmax: number; precip: number };
    /** e.g. "próxima ventana para pulverizar: mañana 7–11 h (…)". */
    sprayWindow?: string | null;
  } | null;
  /** Days ahead (beyond today) worth preparing for. */
  lookaheadDays?: number;
}

const WATER_WORDS = /\bagua|aguada|tajamar|bebedero|molino/i;
const SPRAY_WORDS = /pulveriz|fumig|aplicaci|aplicar|herbicid|fungicid|insecticid|curasemill/i;
/** Above this, animals drink roughly twice as much — aguadas fail first. */
const HEAT_TMAX = 32;
const URGENCY_ORDER: Record<PlanUrgency, number> = { overdue: 0, today: 1, soon: 2 };
const KIND_ORDER: Record<PlanItemKind, number> = { water: 0, move: 1, vaccination: 2, task: 3, harvest: 4 };

function urgencyFor(daysFromNow: number): PlanUrgency {
  return daysFromNow < 0 ? "overdue" : daysFromNow === 0 ? "today" : "soon";
}

function stopScore(stop: PlanStop): number {
  return Math.min(...stop.items.map((item) => URGENCY_ORDER[item.urgency] * 10 + KIND_ORDER[item.kind]));
}

export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const lookahead = input.lookaheadDays ?? 2;
  const statusById = new Map(input.statuses.map((status) => [status.id, status]));
  const stops = new Map<string, PlanStop>();
  const stopFor = (sectionId: string | null | undefined): PlanStop => {
    const key = sectionId && statusById.has(sectionId) ? sectionId : "";
    let stop = stops.get(key);
    if (!stop) {
      const status = key ? statusById.get(key)! : null;
      stop = {
        sectionId: status?.id ?? null,
        name: status?.name ?? "General",
        context: status && (status.heads > 0 || status.crops.length > 0) ? status.summary : null,
        items: [],
      };
      stops.set(key, stop);
    }
    return stop;
  };

  let weather: PlanWeather | null = null;
  if (input.weather?.current) {
    const precip = Math.max(input.weather.current.precip, input.weather.today?.precip ?? 0);
    const spray = sprayAdvice(input.weather.current.wind, precip);
    const notes: string[] = [];
    const tmax = input.weather.today?.tmax;
    if (tmax != null && tmax >= HEAT_TMAX) notes.push(`Calor (${Math.round(tmax)} °C): recorré aguadas temprano y evitá mover hacienda al mediodía.`);
    if (precip >= 10) notes.push(`Lluvia fuerte prevista (${Math.round(precip)} mm): caminos y mangas pueden quedar intransitables.`);
    if (!spray.ok && input.weather.sprayWindow) notes.unshift(input.weather.sprayWindow.charAt(0).toUpperCase() + input.weather.sprayWindow.slice(1) + ".");
    weather = { sprayOk: spray.ok, sprayReason: spray.reason, notes };
  }

  const inPlan = (item: AgendaItem) => item.daysFromNow <= lookahead;
  // A water task someone already wrote for this potrero covers it; don't
  // add a second, generated one next to it.
  const waterTaskSections = new Set(input.agenda.filter((item) => inPlan(item) && item.sectionId && WATER_WORDS.test(item.title)).map((item) => item.sectionId));

  // Water first: animals standing where the aguada failed can't wait.
  for (const status of input.statuses) {
    if (status.heads === 0 || !["seco", "bajo"].includes(status.waterStatus) || waterTaskSections.has(status.id)) continue;
    stopFor(status.id).items.push({
      id: `water-${status.id}`,
      kind: "water",
      urgency: status.waterStatus === "seco" ? "overdue" : "today",
      title: status.waterStatus === "seco" ? "Sin agua: resolver hoy" : "Agua baja: revisar aguada",
      detail: `${status.heads} cabezas dependen de esta aguada`,
      href: "/mapa",
    });
  }

  for (const move of input.rotation) {
    const best = move.destinations[0];
    const urgent = move.reasons.some((reason) => reason.code === "water" || reason.code === "stocking");
    stopFor(move.fromSectionId).items.push({
      id: `move-${move.fromSectionId}`,
      kind: "move",
      urgency: urgent ? "today" : "soon",
      title: best ? `Mover ${move.heads} cabezas a ${best.name}` : `Buscar potrero para ${move.heads} cabezas`,
      detail: [
        move.reasons.map((reason) => reason.label).join(", "),
        best ? best.notes.join(", ") : move.reservedFor ? `${move.reservedFor.sectionName} ya está sugerido para ${move.reservedFor.forName}` : "",
      ].filter(Boolean).join(" · "),
      href: `/produccion/hacienda?sectionId=${encodeURIComponent(move.fromSectionId)}`,
      ...(best ? { destinationSectionId: best.sectionId } : {}),
    });
  }

  for (const item of input.agenda) {
    if (!inPlan(item)) continue;
    const blockedBy = weather && !weather.sprayOk && item.daysFromNow <= 0 && SPRAY_WORDS.test(`${item.title} ${item.detail}`)
      ? `${weather.sprayReason}${input.weather?.sprayWindow ? ` · ${input.weather.sprayWindow}` : ""}`
      : undefined;
    stopFor(item.sectionId).items.push({
      id: item.id,
      kind: item.kind,
      urgency: urgencyFor(item.daysFromNow),
      title: item.title,
      detail: item.detail,
      href: item.href,
      ...(blockedBy ? { blockedBy } : {}),
    });
  }

  const ordered = [...stops.values()]
    .filter((stop) => stop.items.length > 0)
    .map((stop) => ({
      ...stop,
      items: stop.items.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
    }))
    // Potreros before "General", most urgent potrero first.
    .sort((a, b) => Number(a.sectionId === null) - Number(b.sectionId === null) || stopScore(a) - stopScore(b) || a.name.localeCompare(b.name, "es"));

  const items = ordered.flatMap((stop) => stop.items);
  return {
    date: input.today,
    weather,
    stops: ordered,
    counts: {
      total: items.length,
      overdue: items.filter((item) => item.urgency === "overdue").length,
      blocked: items.filter((item) => item.blockedBy).length,
    },
  };
}

const URGENCY_MARK: Record<PlanUrgency, string> = { overdue: "‼️", today: "•", soon: "◦" };

/** Plain-text plan for WhatsApp or print: what the foreman reads on the phone. */
export function dailyPlanText(plan: DailyPlan, farmName?: string | null): string {
  const date = new Date(`${plan.date}T12:00:00Z`).toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const lines = [`*Plan del día${farmName ? ` — ${farmName}` : ""}*`, date.charAt(0).toUpperCase() + date.slice(1)];
  if (plan.weather) {
    lines.push("", `${plan.weather.sprayOk ? "✅" : "⛔"} Pulverizar: ${plan.weather.sprayReason}`);
    for (const note of plan.weather.notes) lines.push(`⚠️ ${note}`);
  }
  if (plan.stops.length === 0) {
    lines.push("", "Sin pendientes para hoy.");
    return lines.join("\n");
  }
  for (const stop of plan.stops) {
    lines.push("", `*${stop.name}*${stop.context ? ` (${stop.context})` : ""}`);
    for (const item of stop.items) {
      const when = item.urgency === "overdue" ? " — atrasado" : item.urgency === "soon" ? " — próximos días" : "";
      lines.push(`${URGENCY_MARK[item.urgency]} ${item.title}${when}${item.blockedBy ? ` — NO HOY: ${item.blockedBy}` : ""}`);
    }
  }
  return lines.join("\n");
}
