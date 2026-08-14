import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest — makes CampoAI installable from the
// browser ("Agregar a pantalla de inicio") for field use on phones.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CampoAI — Gestión Agropecuaria",
    short_name: "CampoAI",
    description:
      "Gestión ganadera y agrícola: hacienda, cultivos, inventario y finanzas con asistente de IA.",
    lang: "es",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#059669",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
