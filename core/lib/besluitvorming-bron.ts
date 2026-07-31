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

type Sb = SupabaseClient;

export interface BesluitBron {
  decision_id: string;
  procedure_id: string;
  besluit_code: string;
  titel: string;
  besluitvraag: string;
  status: string;
  governance_orgaan: string | null;
  datum: string | null;
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
  procesinstantieIds: string[]
): Promise<BesluitBron[]> {
  if (procesinstantieIds.length === 0) return [];
  const { data, error } = await supabase
    .from("decision_objects")
    .select(
      "id, procedure_id, besluit_code, titel, besluitvraag, status, governance_orgaan, gewenste_besluitdatum, laatst_gewijzigd"
    )
    .in("procedure_id", procesinstantieIds)
    .in("status", [
      "geagendeerd",
      "in_bespreking",
      "besloten",
      "voorwaardelijk_besloten",
      "in_uitvoering",
      "in_evaluatie",
      "afgesloten",
    ]);
  if (error || !data) return [];
  return data.map((d) => ({
    decision_id: d.id as string,
    procedure_id: d.procedure_id as string,
    besluit_code: (d.besluit_code as string) ?? "",
    titel: (d.titel as string) ?? "",
    besluitvraag: (d.besluitvraag as string) ?? "",
    status: (d.status as string) ?? "",
    governance_orgaan: (d.governance_orgaan as string | null) ?? null,
    datum:
      (d.gewenste_besluitdatum as string | null) ??
      (d.laatst_gewijzigd as string | null) ??
      null,
  }));
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
    delen.push(
      `[Formele besluitbron ${i + 1}] Besluitregistratie ${b.besluit_code} — ${b.titel}${orgaan} — status: ${b.status}${datum}.\nBesluitvraag: "${b.besluitvraag}"`
    );
    verwijzingen.push({
      document_id: b.decision_id,
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
