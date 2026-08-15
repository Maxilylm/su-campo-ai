import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/gestion/",
        "/produccion/",
        "/chat",
        "/mapa",
        "/pendientes",
        "/setup",
        "/reset-password",
        "/login",
      ],
    },
  };
}
