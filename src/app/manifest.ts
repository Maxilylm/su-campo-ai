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
    // PNG entries with purpose "any" satisfy the browser installability check
    // (and iOS, which does not accept SVG); the SVG entries stay as maskable.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
