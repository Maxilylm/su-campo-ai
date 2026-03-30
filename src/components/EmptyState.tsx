"use client";

import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NewEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** @deprecated Use icon: LucideIcon + title/description instead */
interface LegacyEmptyStateProps {
  icon: string;
  message: string;
}

type EmptyStateProps = NewEmptyStateProps | LegacyEmptyStateProps;

function isLegacy(props: EmptyStateProps): props is LegacyEmptyStateProps {
  return typeof props.icon === "string";
}

export function EmptyState(props: EmptyStateProps) {
  if (isLegacy(props)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <span className="text-4xl mb-4">{props.icon}</span>
        <p className="text-sm text-muted-foreground max-w-sm">{props.message}</p>
      </div>
    );
  }

  const { icon: Icon, title, description, actionLabel, onAction } = props;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-base font-medium mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-4">{actionLabel}</Button>
      )}
    </div>
  );
}
