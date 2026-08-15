import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { FarmProvider } from "@/contexts/FarmContext";
import { NavBar } from "@/components/NavBar";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { OfflineNavigationGuard } from "@/components/OfflineNavigationGuard";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_URL = "https://89campoai.vercel.app";
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
  themeColor: "#059669",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh flex flex-col bg-background text-foreground antialiased">
        <Providers>
          <FarmProvider>
            <OfflineNavigationGuard />
            <NavBar />
            <ConnectionBanner />
            <div className="flex-1 pb-16 sm:pb-0">{children}</div>
          </FarmProvider>
        </Providers>
      </body>
    </html>
  );
}
