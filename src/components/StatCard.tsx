"use client";

const ACCENT_CLASSES: Record<string, string> = {
  emerald: "border-emerald-500/30 text-emerald-400",
  blue: "border-blue-500/30 text-blue-400",
  amber: "border-amber-500/30 text-amber-400",
  red: "border-red-500/30 text-red-400",
  purple: "border-purple-500/30 text-purple-400",
};

export function StatCard({ label, value, accent = "emerald" }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className={`rounded-xl border bg-zinc-900/50 p-3 text-center ${ACCENT_CLASSES[accent] || ACCENT_CLASSES.emerald}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-zinc-500 text-xs mt-0.5">{label}</div>
    </div>
  );
}
