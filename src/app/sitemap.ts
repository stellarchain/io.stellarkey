import type { MetadataRoute } from "next";
import { BRAND_ORIGIN, PUBLIC_ROUTES } from "@/lib/brand";

const LAST_MODIFIED = "2026-08-28T00:00:00.000Z";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { path: PUBLIC_ROUTES.home, priority: 1 },
    { path: PUBLIC_ROUTES.about, priority: 0.7 },
    { path: PUBLIC_ROUTES.privacy, priority: 0.5 },
    { path: PUBLIC_ROUTES.terms, priority: 0.5 },
    { path: PUBLIC_ROUTES.security, priority: 0.6 },
    { path: PUBLIC_ROUTES.support, priority: 0.6 },
  ].map(({ path, priority }) => ({
    url: new URL(path, BRAND_ORIGIN).href,
    lastModified: LAST_MODIFIED,
    changeFrequency: "monthly" as const,
    priority,
  }));
}
