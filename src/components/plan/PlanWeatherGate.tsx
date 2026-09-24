import { CloudRain, SprayCan } from "lucide-react";
import type { PlanWeather } from "@/lib/daily-plan";
import { toneTint } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

/** Today's weather as a gate: can we spray, and what it holds back. */
export function PlanWeatherGate({ weather, blocked }: { weather: PlanWeather | null; blocked: number }) {
  if (!weather) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        Sin pronóstico: cargá la ubicación en Mi campo para sumar el clima al plan.
      </p>
    );
  }

  return (
    <section aria-labelledby="plan-weather-title" className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", toneTint(weather.sprayOk ? "good" : "warn"))}>
          <SprayCan className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="plan-weather-title" className={cn("text-base font-semibold", weather.sprayOk ? "text-ok" : "text-warn")}>
            {weather.sprayOk ? "Se puede pulverizar" : "No pulverizar hoy"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{weather.sprayReason}</p>
          {blocked > 0 && (
            <p className="mt-1.5 text-sm font-medium text-warn">
              {blocked === 1 ? "1 tarea queda para otro día" : `${blocked} tareas quedan para otro día`}; están marcadas en el recorrido.
            </p>
          )}
          {weather.notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {weather.notes.map((note) => (
                <li key={note} className="flex items-start gap-2 text-sm">
                  <CloudRain className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
