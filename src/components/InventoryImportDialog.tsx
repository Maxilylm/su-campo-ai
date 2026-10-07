"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmartImportDialog } from "@/components/import/SmartImportDialog";

const NO_SECTIONS: never[] = [];

/** "Importar" on Inventario: Excel/CSV (columns by name or mapped by AI) or a photo of the stock sheet. */
export function InventoryImportDialog({
  readOnly,
  onImported,
}: {
  readOnly: boolean;
  onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={readOnly}>
        <Upload className="h-4 w-4" aria-hidden="true" />Importar
      </Button>
      <SmartImportDialog open={open} onOpenChange={setOpen} target="inventory" sections={NO_SECTIONS} readOnly={readOnly} onImported={onImported} />
    </>
  );
}
