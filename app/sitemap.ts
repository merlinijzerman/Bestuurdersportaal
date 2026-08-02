import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { bepaalSurface } from "@/core/lib/platform-host";

// Host-bewuste sitemap. Alleen de marketing-host heeft publieke, indexeerbare
// pagina's (de (public)-allowlist, TO §9.1). Op de app- en platform-host is er
// niets te indexeren → lege sitemap.
//
// /sectoren/pensioenfondsen was gated tot de pensioen-SME-validatie (besluit
// 0037 #4); die is akkoord (6 juli 2026), dus het pad staat nu in de sitemap én
// in MARKETING_PUBLIEKE_PADEN (lib/platform-host.ts).
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
      url: `${origin}/sectoren`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${origin}/sectoren/pensioenfondsen`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.7,
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
      // Sinds besluit 0103 een hoofdnavigatie-item ("Over") met eigen inhoud
      // (oprichters, werkprincipes, visie) — daarom hoger dan de 0.5/yearly
      // die paste bij een colofon-achtige pagina.
      url: `${origin}/over-ons`,
      lastModified: nu,
      changeFrequency: "monthly",
      priority: 0.7,
    },
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
