import { cn } from "@/lib/utils";
import { SectionTitle } from "../SectionTitle";

interface WeightHistoryRecord { id: string; date: string; weight_kg: number }

/** Newest first; each row shows the change since the previous weighing. */
export function WeightHistory({ records, focusedRecordId }: { records: WeightHistoryRecord[]; focusedRecordId: string | null }) {
  if (records.length === 0) return null;
  const rows = records.map((record, index) => ({
    record,
    delta: index > 0 ? record.weight_kg - records[index - 1].weight_kg : null,
  })).reverse();

  return (
    <section aria-labelledby="weight-history-title">
      <SectionTitle id="weight-history-title" title="Historial" meta={`${records.length} ${records.length === 1 ? "pesaje" : "pesajes"}`} />
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map(({ record, delta }) => (
          <li
            id={`weight-record-${record.id}`}
            key={record.id}
            className={cn("flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors", focusedRecordId === record.id && "bg-accent ring-2 ring-inset ring-primary/40")}
          >
            <span className="text-muted-foreground">{new Date(record.date + "T12:00:00").toLocaleDateString("es-AR")}</span>
            <span className="flex items-baseline gap-3">
              {delta != null && (
                <span className={cn("figure text-xs", delta < 0 ? "text-bad" : "text-muted-foreground")}>
                  {delta > 0 ? "+" : delta < 0 ? "−" : "±"}{Math.abs(Math.round(delta * 10) / 10)} kg
                </span>
              )}
              <span><span className="figure text-base font-semibold">{record.weight_kg}</span><span className="ml-1 text-xs text-muted-foreground">kg</span></span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
