"use client";

export function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="text-center py-12 text-zinc-600">
      <div className="text-4xl mb-2">{icon}</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
