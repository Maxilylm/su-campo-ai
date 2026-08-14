"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { RouteProgress } from "@/components/RouteProgress";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <RouteProgress />
      <ServiceWorkerRegistration />
      {children}
      <Toaster position="bottom-right" richColors closeButton />
    </ThemeProvider>
  );
}
