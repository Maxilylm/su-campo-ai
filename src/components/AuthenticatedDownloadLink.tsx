"use client";

import { forwardRef, useState } from "react";
import { toast } from "sonner";
import { downloadAuthenticatedFile } from "@/lib/download";

interface AuthenticatedDownloadLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "download"> {
  href: string;
  filename: string;
}

/** Download same-origin exports without silently saving API error JSON. */
export const AuthenticatedDownloadLink = forwardRef<HTMLAnchorElement, AuthenticatedDownloadLinkProps>(function AuthenticatedDownloadLink({ href, filename, children, ...anchorProps }, ref) {
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
      {...anchorProps}
      ref={ref}
      href={href}
      onClick={(event) => { void download(event); }}
      aria-busy={downloading}
      aria-disabled={downloading || undefined}
    >
      {children}
    </a>
  );
});
