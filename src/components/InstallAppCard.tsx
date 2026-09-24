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
    <section aria-labelledby="install-app-title">
      <div className="mb-3">
        <h2 id="install-app-title" className="text-base font-semibold">Instalar CampoAI</h2>
        <p className="text-sm text-muted-foreground">Agregá CampoAI a la pantalla de inicio para abrirlo rápido y consultar el último panel aun cuando estés en el campo.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {installPrompt ? (
          <>
            <p className="min-w-0 flex-1 text-sm">Este dispositivo puede instalar la aplicación.</p>
            <Button variant="outline" onClick={() => void install()} disabled={installing}>
              <Download aria-hidden="true" />{installing ? "Preparando…" : "Instalar aplicación"}
            </Button>
          </>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            En Safari, tocá <span className="font-medium text-foreground">Compartir</span> y luego <span className="font-medium text-foreground">Agregar a pantalla de inicio</span>.
          </p>
        )}
      </div>
    </section>
  );
}
