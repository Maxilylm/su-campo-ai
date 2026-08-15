"use client";

import { useState } from "react";
import { toast } from "sonner";
import { downloadAuthenticatedFile } from "@/lib/download";

interface AuthenticatedDownloadLinkProps {
  href: string;
  filename: string;
  className?: string;
  children: React.ReactNode;
}

/** Download same-origin exports without silently saving API error JSON. */
export function AuthenticatedDownloadLink({ href, filename, className, children }: AuthenticatedDownloadLinkProps) {
  const [downloading, setDownloading] = useState(false);

  async function download(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (downloading) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("No se pudo descargar", { description: "Necesitás conexión para exportar los datos." });
      return;
    }

    setDownloading(true);
    try {
      const result = await downloadAuthenticatedFile(href, filename);
      if (!result.ok) toast.error("No se pudo descargar", { description: result.error });
    } catch {
      toast.error("No se pudo descargar", { description: "Revisá tu conexión e intentá nuevamente." });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <a
      href={href}
      onClick={(event) => { void download(event); }}
      className={className}
      aria-busy={downloading}
      aria-disabled={downloading || undefined}
    >
      {children}
    </a>
  );
}
