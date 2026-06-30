// ============================================================================
//  Platform-home (Increment P0). P0 levert GEEN eindgebruikersfunctie; dit is
//  een minimale geverifieerde landingspagina die toont dat de gate werkt en
//  welke capabilities de ingelogde identiteit heeft. De functionele modules
//  (P1-P10) hangen hier later onder, allemaal achter withPlatform.
// ============================================================================

import Link from "next/link";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";

export const dynamic = "force-dynamic";

export default async function PlatformHome() {
  const identiteit = await huidigePlatformIdentiteit();
  // De (beveiligd)-layout garandeert dat identiteit hier niet null is.
  const caps = identiteit?.capabilities ?? [];
  const magBibliotheek = caps.includes("platform.generic.library.manage");
  const magConfig = caps.includes("platform.config.manage");
  const magRechten =
    caps.includes("platform.capabilities.grant") ||
    caps.includes("platform.capabilities.revoke");
  const magContact = caps.includes("platform.contact.manage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welkom, {identiteit?.naam}</h1>
        <p className="mt-1 text-sm text-[#0F2744]/70">
          Platformfundament (P0) actief. De functionele beheermodules volgen in
          P1-P10; elke handeling loopt via de capability- en auditwrapper.
        </p>
      </div>

      <section className="rounded-xl border border-[#0F2744]/10 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0F2744]/60">
          Beheermodules
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/platform/generieke-bibliotheek"
            className="inline-flex items-center gap-2 rounded-lg bg-[#F0F3F8] px-4 py-2 text-sm font-medium text-[#0F2744] hover:bg-[#0F2744]/10"
          >
            Generieke bibliotheek
            {!magBibliotheek && (
              <span className="text-xs text-[#0F2744]/50">(alleen inzien)</span>
            )}
          </Link>
          <Link
            href="/platform/standaardcatalogus"
            className="inline-flex items-center gap-2 rounded-lg bg-[#F0F3F8] px-4 py-2 text-sm font-medium text-[#0F2744] hover:bg-[#0F2744]/10"
          >
            Standaardcatalogus
            {!magConfig && (
              <span className="text-xs text-[#0F2744]/50">(alleen inzien)</span>
            )}
          </Link>
          {magRechten && (
            <Link
              href="/platform/rechten"
              className="inline-flex items-center gap-2 rounded-lg bg-[#F0F3F8] px-4 py-2 text-sm font-medium text-[#0F2744] hover:bg-[#0F2744]/10"
            >
              Identiteiten &amp; rechten
            </Link>
          )}
          {magContact && (
            <Link
              href="/platform/contact"
              className="inline-flex items-center gap-2 rounded-lg bg-[#F0F3F8] px-4 py-2 text-sm font-medium text-[#0F2744] hover:bg-[#0F2744]/10"
            >
              Contactaanvragen
            </Link>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[#0F2744]/10 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0F2744]/60">
          Toegekende capabilities ({caps.length})
        </h2>
        {caps.length === 0 ? (
          <p className="mt-3 text-sm text-[#0F2744]/70">
            Geen capabilities toegekend. Neem contact op met een
            platformbeheerder voor toekenning (vier-ogen, geaudit).
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {caps.map((cap) => (
              <li
                key={cap}
                className="rounded-lg bg-[#F0F3F8] px-3 py-2 font-mono text-xs"
              >
                {cap}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
