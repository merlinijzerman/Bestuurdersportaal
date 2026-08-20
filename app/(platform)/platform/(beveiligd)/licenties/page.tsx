// ============================================================================
//  Platform — Licenties (Verbruik & bundel-config, besluit 0178 · OP-2)
// ----------------------------------------------------------------------------
//  Beheer van public.fonds_licentie per fonds: jaarbundel, tarieven en de
//  contract-ingangsdatum die de weergave "Verbruik & bundel" (monitoring)
//  gebruikt. Achter `platform.config.manage`: een vriendelijke voorcheck plus de
//  échte afdwinging binnen withPlatform(Read).
// ============================================================================

import { withPlatformRead, PlatformError } from "@/platform/lib/platform-wrapper";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import LicentiesClient, { type LicentieRij } from "./_components/LicentiesClient";

export const dynamic = "force-dynamic";

const CAP = "platform.config.manage" as const;

export default async function LicentiesPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const magBeheren = (identiteit?.capabilities ?? []).includes(CAP);

  let fondsen: { id: string; naam: string }[] = [];
  let licenties: LicentieRij[] = [];

  if (magBeheren) {
    try {
      const geladen = await withPlatformRead(
        { capability: CAP, handeling: "fondslicentie.overzicht.inzien" },
        async (svc) => {
          const [{ data: f }, { data: l }] = await Promise.all([
            svc.from("fondsen").select("id, naam").order("naam"),
            svc
              .from("fonds_licentie")
              .select(
                "fonds_id, bundel_eur_jaar, tarief_in_eur_mln, tarief_uit_eur_mln, contract_start, geldig_vanaf, versie, bijgewerkt, bijgewerkt_door"
              ),
          ]);
          const fondsenUit = (f ?? []) as { id: string; naam: string }[];
          const licentiesUit = (l ?? []) as LicentieRij[];
          return {
            resultaat: { fondsenUit, licentiesUit },
            effect: { fondsen: fondsenUit.length, licenties: licentiesUit.length },
          };
        }
      );
      fondsen = geladen.fondsenUit;
      licenties = geladen.licentiesUit;
    } catch (e) {
      if (!(e instanceof PlatformError)) throw e;
      return (
        <Omhulsel>
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
            De licenties konden niet worden geopend ({e.foutcode}). Log opnieuw in met
            tweefactorauthenticatie of neem contact op met een platformbeheerder.
          </div>
        </Omhulsel>
      );
    }
  }

  return (
    <Omhulsel>
      {!magBeheren ? (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen rechten om licenties te beheren. Vereist de capability{" "}
          <code className="font-mono">{CAP}</code>.
        </div>
      ) : (
        <LicentiesClient fondsen={fondsen} licenties={licenties} />
      )}
    </Omhulsel>
  );
}

function Omhulsel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Licenties &mdash; verbruik &amp; bundel</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Bundel, tarieven en contract-ingangsdatum per fonds. Deze waarden voeden de
          weergave <strong>Verbruik &amp; bundel</strong> in de monitoring; ze worden pro rata
          vanaf de contract-ingangsdatum verrekend. Commerciële configuratie, geaudit.
        </p>
      </div>
      {children}
    </div>
  );
}
