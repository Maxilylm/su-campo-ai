// Pure iCalendar generation. Keeping this separate makes calendar exports
// deterministic and easy to test without Supabase or browser APIs.

export interface CalendarEvent {
  uid: string;
  title: string;
  description?: string | null;
  date: string;
  href?: string | null;
}

export interface FarmCalendarInputs {
  farmName: string;
  vaccinations: {
    id: string;
    vaccine_name: string;
    next_due: string | null;
    sections?: { name: string } | null;
  }[];
  crops: {
    id: string;
    crop_type: string;
    expected_harvest: string | null;
    actual_harvest: string | null;
    sections?: { name: string } | null;
  }[];
  tasks?: {
    id: string;
    title: string;
    description: string | null;
    due_date: string | null;
    priority: string;
    status: string;
    sections?: { name: string } | null;
    cattle?: { category: string; count: number } | null;
    crops?: { crop_type: string } | null;
  }[];
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function dateOnly(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + match[2] + match[3] : "";
}

function nextDay(value: string): string {
  const date = new Date(value.slice(0, 10) + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function absoluteUrl(href: string, baseUrl?: string): string {
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function buildFarmCalendarEvents(input: FarmCalendarInputs): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const vaccination of input.vaccinations) {
    if (!vaccination.next_due) continue;
    const where = vaccination.sections?.name ? " en " + vaccination.sections.name : "";
    events.push({
      uid: "vaccination-" + vaccination.id + "@campoai",
      title: "Vacunación: " + vaccination.vaccine_name,
      description: "Aplicar vacuna" + where + ".",
      date: vaccination.next_due,
      href: "/produccion/sanidad?vaccinationId=" + encodeURIComponent(vaccination.id),
    });
  }

  for (const crop of input.crops) {
    if (!crop.expected_harvest || crop.actual_harvest) continue;
    const where = crop.sections?.name ? " en " + crop.sections.name : "";
    events.push({
      uid: "harvest-" + crop.id + "@campoai",
      title: "Cosecha: " + crop.crop_type,
      description: "Cosecha prevista" + where + ".",
      date: crop.expected_harvest,
      href: "/produccion/agricultura?cropId=" + encodeURIComponent(crop.id),
    });
  }

  for (const task of input.tasks || []) {
    if (!task.due_date || task.status === "completed") continue;
    const relation = task.sections?.name
      ? "Sección: " + task.sections.name
      : task.cattle
        ? "Hacienda: " + task.cattle.category + " (" + task.cattle.count + ")"
        : task.crops?.crop_type
          ? "Cultivo: " + task.crops.crop_type
          : "";
    const priority = task.priority === "high" ? "Prioridad alta." : "";
    events.push({
      uid: "task-" + task.id + "@campoai",
      title: "Tarea: " + task.title,
      description: [task.description, relation, priority].filter(Boolean).join(" "),
      date: task.due_date,
      href: "/gestion/tareas?taskId=" + encodeURIComponent(task.id),
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export function toICalendar(events: CalendarEvent[], calendarName: string, now = new Date(), baseUrl?: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CampoAI//CampoAI Calendar//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapeText(calendarName),
  ];

  for (const event of events) {
    const start = dateOnly(event.date);
    if (!start) continue;
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + escapeText(event.uid),
      "DTSTAMP:" + stamp(now),
      "DTSTART;VALUE=DATE:" + start,
      "DTEND;VALUE=DATE:" + nextDay(event.date),
      "SUMMARY:" + escapeText(event.title),
      "DESCRIPTION:" + escapeText(event.description || ""),
      ...(event.href ? ["URL:" + escapeText(absoluteUrl(event.href, baseUrl))] : []),
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
