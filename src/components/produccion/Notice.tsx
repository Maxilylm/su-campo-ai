import type { ReactNode } from "react";
import { AlertTriangle, CloudOff, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type NoticeTone = "info" | "warn" | "bad" | "offline";

const TONE_CLASSES: Record<NoticeTone, string> = {
  info: "border-info-line bg-info-soft",
  offline: "border-info-line bg-info-soft",
  warn: "border-warn-line bg-warn-soft",
  bad: "border-bad-line bg-bad-soft",
};

const ICON_CLASSES: Record<NoticeTone, string> = {
  info: "text-info",
  offline: "text-info",
  warn: "text-warn",
  bad: "text-bad",
};

const ICONS = { info: Info, offline: CloudOff, warn: AlertTriangle, bad: AlertTriangle };

/** One-line page notice (offline copy, partial list, overdue items). The tint
 * carries the state; the text stays in the foreground color for contrast. */
export function Notice({ tone = "info", title, role = "status", className, children }: {
  tone?: NoticeTone;
  title?: string;
  role?: "status" | "alert";
  className?: string;
  children: ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <div role={role} className={cn("flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm", TONE_CLASSES[tone], className)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_CLASSES[tone])} aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className={cn("font-medium", ICON_CLASSES[tone])}>{title}</p>}
        <div className="text-foreground">{children}</div>
      </div>
    </div>
  );
}

export const noticeLinkClass = "font-medium text-primary underline underline-offset-2 hover:no-underline";
