"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ServiceWorkerRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let active = true;
    const hadController = Boolean(navigator.serviceWorker.controller);
    let registration: ServiceWorkerRegistration | null = null;
    let onUpdateFound: (() => void) | null = null;

    const onControllerChange = () => {
      if (active && hadController) setUpdateAvailable(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((nextRegistration) => {
      if (!active) return;
      registration = nextRegistration;
      onUpdateFound = () => {
        const installing = registration?.installing;
        if (!installing) return;
        const onStateChange = () => {
          if (active && hadController && installing.state === "installed") setUpdateAvailable(true);
          if (installing.state === "installed" || installing.state === "redundant") {
            installing.removeEventListener("statechange", onStateChange);
          }
        };
        installing.addEventListener("statechange", onStateChange);
      };
      registration.addEventListener("updatefound", onUpdateFound);
      if (hadController && registration.waiting) setUpdateAvailable(true);
    }).catch(() => {
      // The app remains usable without a service worker.
    });

    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      if (registration && onUpdateFound) registration.removeEventListener("updatefound", onUpdateFound);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-primary/30 bg-card p-3 text-sm text-foreground shadow-lg">
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">Hay una versión nueva de CampoAI lista para usar.</span>
      <Button size="sm" onClick={() => window.location.reload()}>Actualizar</Button>
    </div>
  );
}
