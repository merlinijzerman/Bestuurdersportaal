import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { bepaalSurface, eersteGeconfigureerdeHost } from "@/core/lib/platform-host";
import { lokaleHostmodus } from "@/core/lib/host-validatie";

// Host-bewuste robots.txt. Eén deployment bedient drie surfaces, dus de inhoud
// hangt af van de request-host (TO §9.1):
//  - marketing: indexeren toegestaan, met verwijzing naar de sitemap. /login is
//    hier slechts een redirect → expliciet uitgesloten.
//  - app + platform: de besluitomgeving en back-office horen niet in de
//    zoekindex → alles uitsluiten.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  const lokaalToegestaan = lokaleHostmodus({ seedDoelomgeving: process.env.SEED_DOELOMGEVING });
  const surface = bepaalSurface({
    host,
    marketingHost: process.env.MARKETING_HOST,
    appHost: process.env.APP_HOST,
    platformHost: process.env.PLATFORM_HOST,
    lokaalToegestaan,
  });

  if (surface === "marketing") {
    const marketingHost = eersteGeconfigureerdeHost({ naam: "MARKETING_HOST", waarde: process.env.MARKETING_HOST, type: "marketing", lokaalToegestaan });
    const origin = `https://${marketingHost ?? host}`;
    return {
      rules: { userAgent: "*", allow: "/", disallow: ["/login"] },
      sitemap: `${origin}/sitemap.xml`,
    };
  }

  return { rules: { userAgent: "*", disallow: "/" } };
}
