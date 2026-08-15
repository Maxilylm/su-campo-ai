"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone;
}

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function InstallAppCard() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [appleMobile, setAppleMobile] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    setAppleMobile(isAppleMobile());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setStandalone(false);
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
    } finally {
      setInstalling(false);
    }
  }

  if (standalone || (!installPrompt && !appleMobile)) return null;

  return (
    <section className="max-w-2xl rounded-xl border border-emerald-500/25 bg-card p-6" aria-labelledby="install-app-title">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-emerald-500/10 p-2"><Smartphone className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="install-app-title" className="font-medium">Instalar CampoAI</h2>
          <p className="mt-1 text-sm text-muted-foreground">Agregá CampoAI a la pantalla de inicio para abrirlo rápido y consultar el último panel aun cuando estés en el campo.</p>
          {installPrompt ? (
            <Button className="mt-4" onClick={() => void install()} disabled={installing}>
              <Download className="mr-1.5 h-4 w-4" />{installing ? "Preparando…" : "Instalar aplicación"}
            </Button>
          ) : (
            <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              En Safari, tocá <span className="font-medium text-foreground">Compartir</span> y luego <span className="font-medium text-foreground">Agregar a pantalla de inicio</span>.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
