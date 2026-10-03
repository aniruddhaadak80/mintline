import type { MetadataRoute } from "next";
import { SITE } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Share links are token-gated dossiers; they must not be indexed.
        disallow: ["/api/", "/share/"],
      },
    ],
    sitemap: `${SITE.liveUrl}/sitemap.xml`,
    host: SITE.liveUrl,
  };
}