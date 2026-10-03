import type { MetadataRoute } from "next";
import { SITE } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Sitemap.
 *
 * The canonical host comes from `NEXT_PUBLIC_SITE_URL`, which is set at deploy
 * time from the real production alias, so no URL here is guessed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const routes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/", priority: 1, changeFrequency: "weekly" },
    { path: "/registry", priority: 0.9, changeFrequency: "daily" },
    { path: "/assay", priority: 0.9, changeFrequency: "weekly" },
    { path: "/agent", priority: 0.8, changeFrequency: "weekly" },
    { path: "/chain", priority: 0.7, changeFrequency: "daily" },
    { path: "/export", priority: 0.7, changeFrequency: "weekly" },
    { path: "/settings", priority: 0.5, changeFrequency: "monthly" },
  ];

  return routes.map((route) => ({
    url: `${SITE.liveUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}