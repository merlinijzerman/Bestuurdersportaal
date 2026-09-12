// ============================================================================
//  lib/besluitvorming-bron.ts — Increment G. Besluitvorming-modus: Decision
//  Object-besluitregistratie als formele bron náást document_chunks.
// ----------------------------------------------------------------------------
//  Wanneer de antwoordmodus 'besluitrijpheid' is (retrieval-scope
//  'besluitvorming'), leiden we uit de top-gerangschikte chunks de relevante
//  procesinstantie(s) af (denorm-veld procesinstantie_id → procedures.id =
//  decision_objects.procedure_id) en halen we de bijbehorende Decision
//  Object-besluitregistratie op. Die wordt LEIDEND geplaatst en als "Formele
//  besluitbron" gelabeld — boven losse documenten (regressietests #5/#12).
//
//  RLS: query loopt onder de bestaande RLS van decision_objects (fonds_id,
//  anon-key); geen verbreding van leesrechten. Begrensd op enkele instanties
//  (ruisbeperking, besluit 3). Dedup t.o.v. besluitdocument-chunks gebeurt
//  PROMPT-side via labeling + leidende volgorde (de formele bron is leidend).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BronVerwijzing } from "./rag";
import { bouwBronfragment } from "./bronfragment";
import type { RetrievalContext, Versiebewijs } from "./retrieval/contract";
import { leesBesluitEvidence } from "./retrieval/supabase-evidence";
import type { EvidenceAudit } from "./retrieval/evidence-contract";
import { neutraliseerBrontekst } from "./bron-afbakening";

type Sb = SupabaseClient;

export interface BesluitBron {
  document_identiteit: string;
  passage_identiteit: string;
  citation_id: string;
  versie: Versiebewijs;
  besluit_code: string;
  titel: string;
  besluitvraag: string;
  status: string;
  governance_orgaan: string | null;
  datum: string | null;
  passage: string;
}

/**
 * Tel de procesinstantie-id's in de chunks en geef de meest voorkomende terug
 * (relevantie ≈ frequentie in de top-set). Begrensd op `max` (besluit 3).
 */
export function topProcesinstanties(
  procesinstantieIds: (string | null | undefined)[],
  max = 3
): string[] {
  const telling = new Map<string, number>();
  for (const id of procesinstantieIds) {
    if (!id) continue;
    telling.set(id, (telling.get(id) ?? 0) + 1);
  }
  return [...telling.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id]) => id);
}

/**
 * Haal de Decision Object-besluitregistratie(s) voor de gegeven
 * procesinstantie-id's. RLS beperkt tot het eigen fonds. Alleen geagendeerde of
 * besloten dossiers zijn als formele besluitbron zinvol; concept-decisions
 * sluiten we uit (spiegelt de conceptregel: geen schijnbesluit).
 */
export async function haalBesluitBronnen(
  supabase: Sb,
  context: RetrievalContext,
  procesinstantieIds: string[]
): Promise<{ bronnen: BesluitBron[]; audit: EvidenceAudit }> {
  const uitkomst = await leesBesluitEvidence(supabase, {
    context,
    maxItems: 3,
    maxGerenderdeTekens: 12_000,
  }, { privateProcedureRefs: procesinstantieIds, alleenFormeel: true });
  if (uitkomst.status === "geweigerd") throw new Error(`besluit_evidence_${uitkomst.audit.fout}`);
  return { audit: uitkomst.audit, bronnen: uitkomst.items.map((item) => ({
    document_identiteit: item.documentIdentiteit,
    passage_identiteit: item.passageIdentiteit,
    citation_id: item.citationId,
    versie: item.versie,
    besluit_code: item.waarde.besluitCode,
    titel: item.waarde.titel,
    besluitvraag: item.waarde.besluitvraag,
    status: item.waarde.status,
    governance_orgaan: item.waarde.governanceOrgaan,
    datum: item.waarde.datum,
    passage: item.passage,
  })) };
}

/**
 * Bouw de prompt-context + bronkaarten voor de formele besluitbronnen. Wordt
 * vóór de document-context geplaatst (leidend). De bronnen krijgen een eigen
 * label zodat de UI ze als formele besluitbron toont, niet als gewoon document.
 */
export function opmaakBesluitContext(bronnen: BesluitBron[]): {
  contextTekst: string;
  bronnen: BronVerwijzing[];
} {
  if (bronnen.length === 0) return { contextTekst: "", bronnen: [] };
  const delen: string[] = [];
  const verwijzingen: BronVerwijzing[] = [];
  bronnen.forEach((b, i) => {
    const datum = b.datum ? `, ${b.datum}` : "";
    const orgaan = b.governance_orgaan ? ` (${b.governance_orgaan})` : "";
    const rauw = `[Formele besluitbron ${i + 1}] Besluitregistratie ${b.besluit_code} — ${b.titel}${orgaan} — status: ${b.status}${datum}.\nBesluitvraag: "${b.besluitvraag}"`;
    delen.push(neutraliseerBrontekst(rauw).tekst);
    verwijzingen.push({
      citation_id: b.citation_id,
      document_id: b.document_identiteit,
      titel: `Besluitregistratie ${b.besluit_code} — ${b.titel}`,
      bron: "Decision Object",
      pagina: null,
      paragraaf: null,
      // Dezelfde citaatregel als de documentbronnen (besluit 0100): deze
      // verwijzing landt in dezelfde bronkaart en dezelfde hover-preview, dus
      // een afwijkende afkapping zou hier stil een voorbehoud wegsnijden.
      fragment: bouwBronfragment(b.besluitvraag),
      heeft_origineel: false,
      documentstatus: b.status,
      bronstatus: "actief",
      documentdatum: b.datum,
    });
  });
  return {
    contextTekst:
      "FORMELE BESLUITBRONNEN (leidend boven losse documenten — Decision Object-besluitregistratie):\n\n" +
      delen.join("\n\n"),
    bronnen: verwijzingen,
  };
}
