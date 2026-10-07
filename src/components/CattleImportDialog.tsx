"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmartImportDialog } from "@/components/import/SmartImportDialog";
import type { SectionOption } from "@/lib/cattle-import";

/** "Importar" on Hacienda: Excel/CSV (columns by name or mapped by AI) or a photo of a planilla. */
export function CattleImportDialog({
  sections,
  readOnly,
  onImported,
}: {
  sections: SectionOption[];
  readOnly: boolean;
  onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={readOnly}>
        <Upload className="h-4 w-4" aria-hidden="true" />Importar
      </Button>
      <SmartImportDialog open={open} onOpenChange={setOpen} target="cattle" sections={sections} readOnly={readOnly} onImported={onImported} />
    </>
  );
}
