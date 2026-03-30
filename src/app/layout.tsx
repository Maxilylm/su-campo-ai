import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { FarmProvider } from "@/contexts/FarmContext";
import { NavBar } from "@/components/NavBar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CampoAI — Gestión Agropecuaria Inteligente",
  description: "Sistema de gestión ganadera y agrícola con WhatsApp. Registra hacienda, cultivos, inventario y finanzas con mensajes de texto o audio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh flex flex-col bg-background text-foreground antialiased">
        <Providers>
          <FarmProvider>
            <NavBar />
            <div className="flex-1 pb-16 sm:pb-0">{children}</div>
          </FarmProvider>
        </Providers>
      </body>
    </html>
  );
}
