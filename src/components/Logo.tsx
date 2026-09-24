import { cn } from "@/lib/utils";

/** A plot with three furrows: the one mark CampoAI draws everywhere. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("h-6 w-6 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M8 21.5 17.5 9M12.5 24 22 11.5M17 26.5 24.5 16.5"
        className="stroke-primary-foreground"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Logo({ size = "default" }: { size?: "default" | "large" }) {
  const large = size === "large";
  return (
    <div className="flex items-center gap-2">
      <LogoMark className={large ? "h-10 w-10" : undefined} />
      <span className={cn("condensed font-semibold tracking-tight text-foreground", large ? "text-2xl" : "text-[15px]")}>
        CampoAI
      </span>
    </div>
  );
}
