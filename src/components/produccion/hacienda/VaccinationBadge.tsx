import { Badge } from "@/components/ui/badge";
import { vaccinationTone } from "@/lib/status-styles";

const VAX_LABEL: Record<string, string> = { al_dia: "Al día", vencida: "Vencida", pendiente: "Pendiente" };
const VAX_VARIANT = { good: "ok", warn: "warn", bad: "bad", neutral: "muted" } as const;

export function VaccinationBadge({ status }: { status: string }) {
  return <Badge variant={VAX_VARIANT[vaccinationTone(status)]}>{VAX_LABEL[status] || "Pendiente"}</Badge>;
}
