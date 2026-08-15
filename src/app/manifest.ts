import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CampoAI — Gestión Agropecuaria Inteligente",
    short_name: "CampoAI",
    description: "Gestión de hacienda, cultivos, inventario y finanzas para el campo.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#059669",
    lang: "es-UY",
    icons: [
      // PNG `any` icons are required for Chrome installability (maskable-only
      // fails the audit) and for iOS; the SVG maskables stay for adaptive shapes.
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
