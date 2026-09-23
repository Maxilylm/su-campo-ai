// When can we spray next? The current reading only answers "now". Hourly
// wind and rain from Open-Meteo (farm-local times, timezone=auto) give the
// next stretch of daylight hours with workable wind and no rain.

export interface HourlyWeather {
  /** Farm-local "YYYY-MM-DDTHH:MM", as Open-Meteo returns it. */
  time: string;
  wind: number;
  precip: number;
}

export interface SprayWindow {
  date: string;
  startHour: number;
  /** Exclusive: a window 7-11 covers 7:00 to 11:00. */
  endHour: number;
  maxWind: number;
}

export interface SprayWindowOptions {
  /** Farm-local now, "YYYY-MM-DDTHH:MM"; hours before it are skipped. */
  now: string;
  minHours?: number;
  maxWind?: number;
  /** Below this, calm air risks inversions and drift. */
  minWind?: number;
  firstHour?: number;
  lastHour?: number;
}

function hourOf(time: string): number {
  return Number(time.slice(11, 13));
}

function workable(hour: HourlyWeather, maxWind: number, minWind: number): boolean {
  return Number.isFinite(hour.wind) && hour.wind >= minWind && hour.wind <= maxWind && !(hour.precip > 0);
}

/** Every workable window from `now` on, in order. */
export function findSprayWindows(hourly: HourlyWeather[], options: SprayWindowOptions): SprayWindow[] {
  const minHours = options.minHours ?? 3;
  const maxWind = options.maxWind ?? 15;
  const minWind = options.minWind ?? 3;
  const firstHour = options.firstHour ?? 6;
  const lastHour = options.lastHour ?? 20;
  const nowKey = options.now.slice(0, 13);

  const windows: SprayWindow[] = [];
  let run: HourlyWeather[] = [];
  const flush = () => {
    if (run.length >= minHours) {
      windows.push({
        date: run[0].time.slice(0, 10),
        startHour: hourOf(run[0].time),
        endHour: hourOf(run[run.length - 1].time) + 1,
        maxWind: Math.round(Math.max(...run.map((hour) => hour.wind))),
      });
    }
    run = [];
  };

  for (const hour of hourly) {
    if (typeof hour.time !== "string" || hour.time.slice(0, 13) < nowKey) continue;
    const h = hourOf(hour.time);
    const inDaylight = h >= firstHour && h < lastHour;
    const sameDay = run.length === 0 || run[0].time.slice(0, 10) === hour.time.slice(0, 10);
    if (inDaylight && sameDay && workable(hour, maxWind, minWind)) {
      run.push(hour);
    } else {
      flush();
      if (inDaylight && workable(hour, maxWind, minWind)) run.push(hour);
    }
  }
  flush();
  return windows;
}

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "hoy 7–11 h", "mañana 8–12 h", "jue 25, 7–10 h". */
export function describeSprayWindow(window: SprayWindow, today: string): string {
  const hours = `${window.startHour}–${window.endHour} h`;
  if (window.date === today) return `hoy ${hours}`;
  const next = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (window.date === next) return `mañana ${hours}`;
  const date = new Date(`${window.date}T12:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}, ${hours}`;
}

/** One line for the plan, the weather card and the assistant. */
export function nextSprayWindowText(hourly: HourlyWeather[] | undefined, now: string | undefined): string | null {
  if (!hourly?.length || !now) return null;
  const [first] = findSprayWindows(hourly, { now });
  if (!first) return "sin ventana para pulverizar en los próximos días";
  return `próxima ventana para pulverizar: ${describeSprayWindow(first, now.slice(0, 10))} (viento hasta ${first.maxWind} km/h, sin lluvia)`;
}
