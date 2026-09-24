import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: "border-border bg-card text-muted-foreground",
  warn: "border-warn-line bg-warn-soft text-warn",
  bad: "border-bad-line bg-bad-soft text-bad",
} as const;

/** One-line page notice (read-only copy, truncated data, stock bajo…). */
export function Notice({ tone = "neutral", icon: Icon, title, children, action, role = "status", className }: {
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  return (
    <div role={role} className={cn("flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-lg border px-3.5 py-2.5 text-sm", TONES[tone], className)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
