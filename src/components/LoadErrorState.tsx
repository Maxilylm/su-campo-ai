"use client";

import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

export function LoadErrorState({ title = "No se pudieron cargar los datos", onRetry }: { title?: string; onRetry: () => void }) {
  return <EmptyState icon={AlertTriangle} title={title} description="Revisá tu conexión e intentá nuevamente." actionLabel="Reintentar" onAction={onRetry} />;
}
