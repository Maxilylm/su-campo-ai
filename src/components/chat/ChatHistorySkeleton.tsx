import { Skeleton } from "@/components/ui/skeleton";

export function ChatHistorySkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando conversación">
      <Skeleton className="mb-2 h-8 w-40" />
      <Skeleton className="mb-10 h-4 w-72 max-w-full" />
      <div className="space-y-6">
        <Skeleton className="ml-auto h-9 w-1/2 rounded-lg" />
        <div className="flex gap-3">
          <Skeleton className="h-6 w-6 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
