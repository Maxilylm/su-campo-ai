import { Skeleton } from "@/components/ui/skeleton";

export function LoadingPage() {
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <Skeleton className="h-5 w-40 mb-2" />
      <Skeleton className="h-8 w-64 mb-1" />
      <Skeleton className="h-4 w-80 mb-8" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </main>
  );
}
