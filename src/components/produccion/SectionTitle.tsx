import type { ReactNode } from "react";

/** Section heading with an optional muted count/meta on the right. */
export function SectionTitle({ id, title, meta, actions }: { id?: string; title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        {meta != null && <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
      {actions}
    </div>
  );
}
