// ============================================================================
//  Platform — Generieke bibliotheek (Increment P1/B14, FO §8).
// ----------------------------------------------------------------------------
//  Lijst + curatie-UI voor sectorbrede, fonds-overstijgende documenten. De
//  LEESKANT loopt via de anon-RLS-client: de SELECT-policy maakt
//  bibliotheek='generiek' voor elke ingelogde identiteit leesbaar (B13). De
//  SCHRIJFKANT loopt uitsluitend via de server-actions (acties.ts) achter
//  withPlatform (service-role + capability + twee-fasen-audit) — nooit hier.
// ============================================================================

import { createServerSupabase } from "@/core/lib/supabase-server";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import GeneriekeBibliotheekClient, {
  type GeneriekDocument,
} from "./_components/GeneriekeBibliotheekClient";

export const dynamic = "force-dynamic";

// Synchrone OCR-fallback in de curatie-pipeline (besluit 0023) kan voor een
// beeld-only PDF tientallen seconden duren. De server-actions van deze pagina
// (acties.ts → verwerkGeneriekBestand) erven deze route-segment-limiet; 300s
// vereist het Vercel Pro-plan + fluid compute. Zonder deze bump kapt Vercel een
// OCR-upload halverwege af met een generieke fout.
export const maxDuration = 300;

const CAP = "platform.generic.library.manage";

const DOC_KOLOMMEN =
  "id, titel, bron, bronorganisatie, extern_url, normgewicht, documentdatum, " +
  "geldig_vanaf, geldig_tot, status, bronstatus, toepassingsgebied, regelingstype, " +
  "doelgroep, thema, statusinterpretatie, eigenaar, volgende_review, versie, " +
  "verwerkingsstatus, paginas, opslag_pad, " +
  "vervangen_door_document_id, vervangt_document_id, aangemaakt";

export default async function GeneriekeBibliotheekPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const magBeheren = (identiteit?.capabilities ?? []).includes(CAP);

  const supabase = await createServerSupabase();

  const [{ data: docs }, { count: aantalFondsen }] = await Promise.all([
    supabase
      .from("documenten")
      .select(DOC_KOLOMMEN)
      .eq("bibliotheek", "generiek")
      .order("aangemaakt", { ascending: false })
      .limit(500),
    supabase.from("fondsen").select("id", { count: "exact", head: true }),
  ]);

  const documenten = (docs ?? []) as unknown as GeneriekDocument[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Generieke bibliotheek</h1>
        <p className="mt-1 text-sm text-ink/70">
          Sectorbrede, fonds-overstijgende documenten (toezichtkaders, guidance).
          Elke wijziging verschijnt direct bij alle aangesloten fondsen en wordt
          append-only geaudit.
        </p>
      </div>

      {!magBeheren && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je kunt de generieke bibliotheek inzien maar niet beheren. Beheer
          vereist de capability <code className="font-mono">{CAP}</code>.
        </div>
      )}

      <GeneriekeBibliotheekClient
        documenten={documenten}
        aantalFondsen={aantalFondsen ?? 0}
        magBeheren={magBeheren}
      />
    </div>
  );
}
