// ============================================================================
//  Platform — Organisatieprofiel-beheer (OP-5, FO Organisatieprofiel v0.4
//  §2/§4/§5/§7).
// ----------------------------------------------------------------------------
//  Beheer-UI waarmee een gemachtigde platformbeheerder per organisatie (fonds)
//  het generieke contextprofiel invult/bijwerkt. SCHRIJVEN uitsluitend via de
//  server-action (acties.ts) achter withPlatform (service-role + capability
//  platform.config.manage + twee-fasen-audit).
//
//  LEESKANT via de service-role (createServiceSupabase): de SELECT-policy op
//  organisatie_profielen (OP-1) geeft alleen het eigen fonds vrij via
//  profielen.id = auth.uid(); een platform-identiteit heeft géén profielen-rij,
//  dus de anon-RLS-client ziet niets. De read draait pas ná de capability-gate
//  (magBeheren), binnen de door de (beveiligd)-layout afgedwongen identiteit+MFA-
//  poort. Dit verzwakt de tenant-RLS niet (besluit B-OP5-2).
// ============================================================================

import { createServiceSupabase } from "@/lib/supabase-service";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";
import OrganisatieprofielClient from "./_components/OrganisatieprofielClient";

export const dynamic = "force-dynamic";

const CAP = "platform.config.manage"; // zie besluit B-OP5-1

const PROFIEL_KOLOMMEN =
  "fonds_id, organisatietype, uitvoerende_partijen, omvang, kernfeiten, " +
  "missie, visie, strategische_speerpunten, risicohouding, peildatum, " +
  "bijgewerkt_door, bijgewerkt_op";

export default async function OrganisatieprofielPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const magBeheren = (identiteit?.capabilities ?? []).includes(CAP);

  let fondsen: { id: string; naam: string }[] = [];
  let profielen: Record<string, unknown>[] = [];

  if (magBeheren) {
    const svc = createServiceSupabase();
    const [{ data: f }, { data: p }] = await Promise.all([
      svc.from("fondsen").select("id, naam").order("naam"),
      svc.from("organisatie_profielen").select(PROFIEL_KOLOMMEN),
    ]);
    fondsen = (f ?? []) as { id: string; naam: string }[];
    profielen = (p ?? []) as unknown as Record<string, unknown>[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Organisatieprofiel</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Generiek contextprofiel per organisatie. De AI gebruikt dit als
          organisatiespecifieke context; het weegt onder wet- en regelgeving en
          formele stukken. Elke wijziging is direct actief en wordt geaudit.
        </p>
      </div>

      {!magBeheren ? (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen rechten om organisatieprofielen te beheren. Vereist de
          capability <code className="font-mono">{CAP}</code>.
        </div>
      ) : (
        <OrganisatieprofielClient fondsen={fondsen} profielen={profielen} />
      )}
    </div>
  );
}
