import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { FarmProvider } from "@/contexts/FarmContext";
import { AppShell } from "@/components/AppShell";
import { OfflineNavigationGuard } from "@/components/OfflineNavigationGuard";

// One family; the width axis gives condensed headings and figures (see globals.css).
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"], display: "swap" });

const SITE_URL = "https://campo-ai-mlx.vercel.app";
const SITE_DESC =
  "Gestión ganadera y agrícola en una sola plataforma. Registrá hacienda, cultivos, inventario y finanzas — con asistente de IA por chat y voz.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CampoAI — Gestión Agropecuaria Inteligente",
    template: "%s · CampoAI",
  },
  description: SITE_DESC,
  applicationName: "CampoAI",
  keywords: ["gestión ganadera", "agropecuaria", "hacienda", "agricultura", "campo", "IA"],
  openGraph: {
    title: "CampoAI — Gestión Agropecuaria Inteligente",
    description: SITE_DESC,
    url: SITE_URL,
    siteName: "CampoAI",
    locale: "es_UY",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "CampoAI — Gestión Agropecuaria Inteligente",
    description: SITE_DESC,
  },
  appleWebApp: {
    capable: true,
    title: "CampoAI",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1411" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={archivo.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers>
          <FarmProvider>
            <OfflineNavigationGuard />
            <AppShell>{children}</AppShell>
          </FarmProvider>
        </Providers>
      </body>
    </html>
  );
}
