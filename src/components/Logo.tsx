export function Logo({ size = "default" }: { size?: "default" | "large" }) {
  const markSize = size === "large" ? "w-10 h-10" : "w-6 h-6";
  const textSize = size === "large" ? "text-2xl" : "text-sm";

  return (
    <div className="flex items-center gap-2">
      <div className={`${markSize} rounded-lg bg-gradient-to-br from-emerald-600 to-emerald-400 flex items-center justify-center`}>
        <span className="text-white font-bold" style={{ fontSize: size === "large" ? 20 : 12 }}>C</span>
      </div>
      <span className={`${textSize} font-semibold tracking-tight text-foreground`}>
        Campo<span className="text-primary">AI</span>
      </span>
    </div>
  );
}
