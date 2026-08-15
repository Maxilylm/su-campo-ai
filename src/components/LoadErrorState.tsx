"use client";

import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

export function LoadErrorState({ title = "No se pudieron cargar los datos", description = "Revisá tu conexión e intentá nuevamente.", onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return <EmptyState icon={AlertTriangle} title={title} description={description} actionLabel="Reintentar" onAction={onRetry} />;
}
