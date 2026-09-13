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
import type { RetrievalContext, Versiebewijs } from "./retrieval/contract";
import type { Bronresultaat } from "./retrieval/contract";
import { leesBesluitEvidence } from "./retrieval/supabase-evidence";
import type { EvidenceAudit } from "./retrieval/evidence-contract";
import { bouwCitaties } from "./retrieval/citatie";

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
  const uniekeProcessen = [...new Set(procesinstantieIds)].slice(0, 3);
  const uitkomsten = await Promise.all(uniekeProcessen.map((procesId) =>
    leesBesluitEvidence(supabase, {
      context: { ...context, scope: { ...context.scope, procesId } },
      maxItems: 1,
      maxGerenderdeTekens: 12_000,
    }, { privateProcedureRefs: [procesId], alleenFormeel: true })
  ));
  const geweigerd = uitkomsten.find((uitkomst) => uitkomst.status === "geweigerd");
  if (geweigerd?.status === "geweigerd") throw new Error(`besluit_evidence_${geweigerd.audit.fout}`);
  const items = uitkomsten.flatMap((uitkomst) => uitkomst.items);
  const audit: EvidenceAudit = {
    correlation_id: context.correlationId,
    soort: "besluitregistratie",
    gevraagd: uniekeProcessen.length,
    toegelaten: items.length,
    gerenderde_tekens: uitkomsten.reduce((som, uitkomst) => som + uitkomst.audit.gerenderde_tekens, 0),
    limiet: 12_000,
    afgekapt: false,
    pii_gedetecteerd: uitkomsten.some((uitkomst) => uitkomst.audit.pii_gedetecteerd),
    pii_soorten: [...new Set(uitkomsten.flatMap((uitkomst) => uitkomst.audit.pii_soorten ?? []))],
    versies: { sterk: items.length, gedegradeerd: 0 },
  };
  return { audit, bronnen: items.map((item) => ({
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
export function opmaakBesluitContext(
  bronnen: BesluitBron[],
  opties: { maxContextTekens?: number; startIndex?: number; sentinel?: string; peildatum?: string } = {}
): {
  contextTekst: string;
  bronnen: BronVerwijzing[];
  opgenomenCitationIds: string[];
  geneutraliseerd: number;
  afgekapt: boolean;
} {
  if (bronnen.length === 0) return { contextTekst: "", bronnen: [], opgenomenCitationIds: [], geneutraliseerd: 0, afgekapt: false };
  const kop = "FORMELE BESLUITBRONNEN (leidend boven losse documenten — Decision Object-besluitregistratie):\n\n";
  const max = opties.maxContextTekens ?? 12_000;
  if (kop.length >= max) return { contextTekst: "", bronnen: [], opgenomenCitationIds: [], geneutraliseerd: 0, afgekapt: true };
  const contractBronnen: Bronresultaat[] = bronnen.map((b, index) => ({
    ref: b.passage_identiteit,
    bronsoort: "fonds",
    titel: b.titel,
    documentIdentiteit: { id: b.document_identiteit, fondsId: null, bibliotheek: "fonds", bron: "Decision Object" },
    passageIdentiteit: { id: b.passage_identiteit },
    versie: b.versie,
    locator: {},
    passage: b.passage,
    status: { documentstatus: b.status, bronstatus: "actief", actueel: true },
    rang: { positie: index },
    weergave: { documentdatum: b.datum },
  }));
  const citaat = bouwCitaties(contractBronnen, {
    maxContextTekens: max - kop.length,
    primaireDocumentIds: new Set(),
    hoofddocumentLabel: "Decision Object",
    startIndex: opties.startIndex,
    sentinel: opties.sentinel,
    peildatum: opties.peildatum ?? new Date().toISOString().slice(0, 10),
  });
  return {
    contextTekst: citaat.contextTekst ? `${kop}${citaat.contextTekst}` : "",
    bronnen: citaat.bronnen,
    opgenomenCitationIds: citaat.bronnen.flatMap((bron) => bron.citation_id ? [bron.citation_id] : []),
    geneutraliseerd: citaat.geneutraliseerd,
    afgekapt: citaat.afgekapt,
  };
}
