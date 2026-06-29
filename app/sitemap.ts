import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { bepaalSurface } from "@/lib/platform-host";

// Host-bewuste sitemap. Alleen de marketing-host heeft publieke, indexeerbare
// pagina's (/, /contact, /privacy — de (public)-allowlist, TO §9.1). Op de app-
// en platform-host is er niets te indexeren → lege sitemap.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host");
  const surface = bepaalSurface({
    host,
    marketingHost: process.env.MARKETING_HOST,
    appHost: process.env.APP_HOST,
    platformHost: process.env.PLATFORM_HOST,
  });

  if (surface !== "marketing") return [];

  const origin = `https://${
    process.env.MARKETING_HOST?.split(",")[0]?.trim() || host
  }`;
  const nu = new Date();

  return [
    { url: `${origin}/`, lastModified: nu, changeFrequency: "monthly", priority: 1 },
    {
      url: `${origin}/contact`,
      lastModified: nu,
      changeFrequency: "yearly",
      priority: 0.6,
    },
    {
      url: `${origin}/privacy`,
      lastModified: nu,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
