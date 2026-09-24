import { Skeleton } from "@/components/ui/skeleton";

export function LoadingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8" aria-busy="true" aria-label="Cargando">
      <Skeleton className="mb-2 h-4 w-32" />
      <Skeleton className="mb-8 h-8 w-64" />
      <Skeleton className="mb-8 h-24 rounded-lg" />
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
