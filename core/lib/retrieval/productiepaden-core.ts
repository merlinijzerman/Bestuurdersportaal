// ============================================================================
//  #369 F4-T2-2 — pure opdrachtbouw voor /zoeken en /vergelijk.
// ----------------------------------------------------------------------------
//  De routes leveren uitsluitend gevalideerde, server-afgeleide waarden aan.
//  Deze module bepaalt vervolgens de providerneutrale query, selectiegrenzen en
//  responsvorm. Geen databaseclient, providernaam of service-role hoort hier.
// ============================================================================

import { maxPerDocVoor, resolveerRetrievalVlaggen, type RetrievalFilters, type RetrievalOpties } from "../rag";
import type { Bronresultaat, CitaatOpdracht, RetrievalQuery } from "./contract";
import type { SelectiegrenzenPerQuery, Spoor } from "./orkestratie";

export const ZOEK_MAX_RESULTATEN = 40;
export const VERGELIJK_MAX_RESULTATEN = 4;
export const RETRIEVAL_MAX_CONTEXT_TEKENS = 120_000;

export const kandidatenpool = (maxResultaten: number): number => Math.max(maxResultaten * 3, 20);

export function geldigeUuid(waarde: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(waarde);
}

const CLIENT_SCOPE_SLEUTELS = new Set([
  "fonds",
  "fonds_id",
  "fondsId",
  "tenant",
  "tenant_id",
  "tenantId",
  "document",
  "document_id",
  "documentId",
  "vergadering",
  "vergadering_id",
  "vergaderingId",
  "provider",
  "adapter",
  "actor",
  "scope",
]);

/** Waarden die uitsluitend uit sessie/configuratie mogen komen. */
export function bevatClientScopeSturing(sleutels: Iterable<string>): boolean {
  for (const sleutel of sleutels) if (CLIENT_SCOPE_SLEUTELS.has(sleutel)) return true;
  return false;
}

function grenzen(vlaggen: RetrievalOpties, maxResultaten: number): SelectiegrenzenPerQuery {
  const v = resolveerRetrievalVlaggen(vlaggen);
  return {
    maxPerDoc: maxPerDocVoor(maxResultaten),
    representatieConstraints: v.representatieConstraints,
    regimeWeging: v.regimeWeging,
    relevantieDrempel: v.relevantieDrempel,
  };
}

export function maakZoekSpoor(input: {
  vraag: string;
  filters: RetrievalFilters;
  hybrideAan: boolean;
  vlaggen: RetrievalOpties;
}): Spoor {
  return {
    query: {
      naam: "zoeken",
      origineleVraag: input.vraag,
      zoekvraag: input.vraag,
      filters: input.filters,
      strategie: "gericht",
      maxResultaten: ZOEK_MAX_RESULTATEN,
      maxKandidaten: kandidatenpool(ZOEK_MAX_RESULTATEN),
      maxContextTekens: RETRIEVAL_MAX_CONTEXT_TEKENS,
      hybrideAan: input.hybrideAan,
    },
    grenzen: grenzen(input.vlaggen, ZOEK_MAX_RESULTATEN),
  };
}

export function maakVergelijkSpoor(input: {
  vraag: string;
  documentId: string;
  hybrideAan: boolean;
  vlaggen: RetrievalOpties;
  maxResultaten?: number;
}): Spoor {
  const maxResultaten = input.maxResultaten ?? VERGELIJK_MAX_RESULTATEN;
  return {
    query: {
      naam: "vergelijk",
      documentScope: [input.documentId],
      origineleVraag: input.vraag,
      zoekvraag: input.vraag,
      // R2: een expliciet gekozen historisch document blijft vergelijkbaar.
      // Geen impliciet `actueel`, peildatum- of statusfilter toevoegen.
      filters: undefined,
      strategie: "vergelijk",
      maxResultaten,
      maxKandidaten: kandidatenpool(maxResultaten),
      maxContextTekens: RETRIEVAL_MAX_CONTEXT_TEKENS,
      hybrideAan: input.hybrideAan,
    },
    grenzen: grenzen(input.vlaggen, maxResultaten),
  };
}

export function citaatOpdracht(documentIds: readonly string[]): CitaatOpdracht {
  return {
    primaireDocumentIds: new Set(documentIds),
    peildatum: new Date().toISOString().slice(0, 10),
    hoofddocumentLabel: " [geselecteerd document]",
  };
}

export interface ZoekTreffer {
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
}

export interface ZoekResultaatNeutraal {
  document_id: string;
  titel: string;
  bron: string;
  bibliotheek: string | null;
  procesinstantie_id: string | null;
  documentstatus: string | null;
  bronstatus: string | null;
  documentdatum: string | null;
  geldig_tot: string | null;
  bronorganisatie: string | null;
  normgewicht: string | null;
  extern_url: string | null;
  heeft_origineel: boolean;
  treffers: ZoekTreffer[];
}

/**
 * Behoudt de bestaande documentgroepering en 220-tekenpreview, maar gebruikt
 * uitsluitend `Bronresultaat`. De route hoeft geen Supabase-`DocumentChunk`
 * meer terug te halen; ook een toekomstige Microsoftbron past in deze vorm.
 */
export function groepeerZoekresultaten(bronnen: Bronresultaat[]): ZoekResultaatNeutraal[] {
  const perDoc = new Map<string, ZoekResultaatNeutraal>();
  for (const b of bronnen) {
    const d = b.documentIdentiteit;
    const w = b.weergave ?? {};
    let resultaat = perDoc.get(d.id);
    if (!resultaat) {
      resultaat = {
        document_id: d.id,
        titel: b.titel,
        bron: d.bron ?? "",
        bibliotheek: d.bibliotheek ?? null,
        procesinstantie_id: d.procesId ?? null,
        documentstatus: b.status.documentstatus ?? null,
        bronstatus: b.status.bronstatus ?? null,
        documentdatum: w.documentdatum ?? null,
        geldig_tot: b.status.geldigTot ?? null,
        bronorganisatie: w.bronorganisatie ?? null,
        normgewicht: b.curatie?.normgewicht ?? null,
        extern_url: w.externUrl ?? null,
        heeft_origineel: Boolean(w.opslagPad),
        treffers: [],
      };
      perDoc.set(d.id, resultaat);
    }
    if (resultaat.treffers.length < 3) {
      resultaat.treffers.push({
        pagina: b.locator.pagina ?? null,
        paragraaf: b.locator.paragraaf ?? null,
        fragment: b.passage.length > 220 ? `${b.passage.slice(0, 220)}…` : b.passage,
      });
    }
  }
  return [...perDoc.values()];
}

/**
 * Publieke /zoeken-respons. De centrale orkestratie bouwt intern wél citaties,
 * maar de bestaande zoek-API publiceerde die niet. Deze expliciete grens houdt
 * de W322-goldens byte-/structuuridentiek en voorkomt een ongereviewde
 * contractuitbreiding voor bestaande clients.
 */
export function maakZoekRespons(input: {
  resultaten: ZoekResultaatNeutraal[];
  procesinstanties: { id: string; titel: string }[];
  methode: import("../rag").RetrievalMeta["methode"];
  opgehaald: number;
  geselecteerd: number;
  modus: string;
  toelating?: import("./toelatingspoort").Toelatingssamenvatting;
}) {
  return {
    resultaten: input.resultaten,
    procesinstanties: input.procesinstanties,
    meta: {
      methode: input.methode,
      opgehaald: input.opgehaald,
      geselecteerd: input.geselecteerd,
      modus: input.modus,
      // Nieuw maar conditioneel: alleen zichtbaar als de centrale poort echt
      // iets weigerde. Succesresponses houden exact het historische contract.
      ...(input.toelating ? { toelating: input.toelating } : {}),
    },
  };
}

/** Alleen voor tests en adapters die een query los willen typeren. */
export type ProductieQuery = RetrievalQuery;
