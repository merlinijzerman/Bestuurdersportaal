import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { bepaalSurface } from "@/core/lib/platform-host";

// Host-bewuste sitemap. Alleen de marketing-host heeft publieke, indexeerbare
// pagina's (de (public)-allowlist, TO §9.1). Op de app- en platform-host is er
// niets te indexeren → lege sitemap.
//
// v0.8: /sectoren en /sectoren/pensioenfondsen zijn samengevoegd met /voor-wie
// en redirecten daarheen — ze horen dus niet meer in de sitemap. /contact en
// /privacy dragen `robots: noindex` en staan er om dezelfde reden niet in:
// een sitemap die een noindex-pagina aanmeldt, geeft een tegenstrijdig signaal.
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
      url: `${origin}/product`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${origin}/voor-wie`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${origin}/governance-ai`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${origin}/governance-ai/eu-ai-act`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${origin}/over-ons`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ];
}
