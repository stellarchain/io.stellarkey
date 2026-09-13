import type { MetadataRoute } from "next";
import { BRAND_ORIGIN } from "@/lib/brand";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BRAND_ORIGIN}/sitemap.xml`,
    host: BRAND_ORIGIN,
  };
}
