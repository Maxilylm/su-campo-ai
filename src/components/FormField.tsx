"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface FormFieldProps {
  label: ReactNode;
  /** A single form control (Input, Textarea, ...). Its `id` is set to a
   * stable auto-generated one unless it already has its own. */
  children: ReactElement<{ id?: string }>;
  className?: string;
}

/**
 * Label + control pair wired together with `useId()`, so the label is
 * announced when the control gets focus without hand-writing an id per field.
 * Not for Radix `Select` — put the id directly on its `SelectTrigger` instead.
 */
export function FormField({ label, children, className = "space-y-2" }: FormFieldProps) {
  const generatedId = useId();
  const id = isValidElement(children) ? children.props.id ?? generatedId : generatedId;
  const control = isValidElement(children) ? cloneElement(children, { id }) : children;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {control}
    </div>
  );
}
