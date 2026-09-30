// ============================================================================
//  platform/lib/generiek-curatie-diff.ts — #504.
// ----------------------------------------------------------------------------
//  Pure kern van curatieBijwerken (generieke-bibliotheek/acties.ts):
//    • leesCuratieInvoer — FormData → JuridischeCuratieInvoer;
//    • bouwCuratieDiff   — huidige documentrij × gevalideerde metadata →
//                          { update, logRijen } voor de #499-RPC
//                          fn_platform_generiek_document_bijwerken.
//  Los van de serveractie ("use server" mag alleen async functies exporteren)
//  zodat het formulier→diff-pad zonder DB/sessie testbaar is
//  (generiek-curatie-diff.sanity.ts). Gedrag gelijk aan de eerdere inline-code,
//  behalve: datumkolommen worden als JJJJ-MM-DD vergeleken, en documentdatum/
//  geldig_vanaf tellen als RAG-relevant (ze worden naar de chunks
//  gedenormaliseerd; documentdatum is het versiebewijs van de toelatingspoort).
// ============================================================================

import type {
  JuridischeCuratieInvoer,
  JuridischeCuratieGenormaliseerd,
} from "@/core/lib/generiek-curatie-juridisch";

export type CuratieLogRij = {
  veld_naam: string;
  oude_waarde: string | null;
  nieuwe_waarde: string | null;
  wijzig_type: "metadata" | "status" | "bronstatus" | "koppeling";
  rag_impact: boolean;
};

// De bewerkbare §8.1-velden. Moet gelijk blijven aan c_toegestaan in de RPC
// (supabase/migrations/2026_09_30_499_generieke_metadatawijziging_timeout.sql).
export const BEWERKBARE_CURATIEVELDEN = [
  "titel", "bron", "bronorganisatie", "extern_url", "normgewicht",
  "documentdatum", "geldig_vanaf", "geldig_tot", "status", "bronstatus",
  "toepassingsgebied", "regelingstype", "doelgroep", "thema", "statusinterpretatie",
  "eigenaar", "volgende_review", "versie",
  "documenttype", "wetsgeschiedenis_subtype", "dossiernummer", "wettelijk_regime",
] as const satisfies readonly (keyof JuridischeCuratieGenormaliseerd & string)[];

// `date`-kolommen op documenten.
export const DATUM_CURATIEVELDEN: ReadonlySet<string> = new Set([
  "documentdatum", "geldig_vanaf", "geldig_tot", "volgende_review",
]);

// Retrieval-relevante velden: een wijziging werkt door in de RAG-laag (denorm
// op de chunks via fn_chunk_denorm, of de review-verval-gate), dus
// rag_impact=true in het auditspoor.
export const RAG_CURATIEVELDEN: ReadonlySet<string> = new Set([
  "normgewicht",
  "bronorganisatie",
  "extern_url",
  "bronstatus",
  "geldig_tot",
  "status",
  // Increment T10: een verstreken review degradeert de bron als actuele bron.
  "volgende_review",
  // Wetsgeschiedenis A-light: door fn_chunk_denorm naar de chunks gespiegeld.
  // Subtype en dossiernummer (nog) niet — die blijven documentmetadata.
  "documenttype",
  "wettelijk_regime",
  // #504: óók gedenormaliseerd (trigger-kolomlijst trg_chunk_denorm_refresh);
  // documentdatum is bovendien het versiebewijs in de retrieval-toelatingspoort.
  "documentdatum",
  "geldig_vanaf",
]);

export function leesCuratieInvoer(fd: FormData): JuridischeCuratieInvoer {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : null;
  };
  return {
    titel: s("titel"),
    bron: s("bron"),
    bronorganisatie: s("bronorganisatie"),
    extern_url: s("extern_url"),
    normgewicht: s("normgewicht"),
    documentdatum: s("documentdatum"),
    geldig_vanaf: s("geldig_vanaf"),
    geldig_tot: s("geldig_tot"),
    documentstatus: s("documentstatus"),
    bronstatus: s("bronstatus"),
    toepassingsgebied: s("toepassingsgebied"),
    regelingstype: s("regelingstype"),
    doelgroep: s("doelgroep"),
    thema: s("thema"),
    statusinterpretatie: s("statusinterpretatie"),
    documenttype: s("documenttype"),
    wetsgeschiedenis_subtype: s("wetsgeschiedenis_subtype"),
    dossiernummer: s("dossiernummer"),
    wettelijk_regime: s("wettelijk_regime"),
    eigenaar: s("eigenaar"),
    volgende_review: s("volgende_review"),
    versie: s("versie"),
  };
}

// Een date-kolom komt via PostgREST als 'JJJJ-MM-DD'; mocht een pad ooit een
// tijdstempel teruggeven ('JJJJ-MM-DDT…'), dan telt alleen de kalenderdag —
// anders ontstaat een schijnwijziging (of, omgekeerd, een gemiste gelijkheid).
function normaliseer(veld: string, w: unknown): unknown {
  if (w === undefined || w === null) return null;
  if (DATUM_CURATIEVELDEN.has(veld) && typeof w === "string" && /^\d{4}-\d{2}-\d{2}/.test(w)) {
    return w.slice(0, 10);
  }
  return w;
}

export function bouwCuratieDiff(
  huidig: Record<string, unknown>,
  meta: JuridischeCuratieGenormaliseerd
): { update: Record<string, unknown>; logRijen: CuratieLogRij[] } {
  const update: Record<string, unknown> = {};
  const logRijen: CuratieLogRij[] = [];
  const nieuwRij = meta as unknown as Record<string, unknown>;
  for (const veld of BEWERKBARE_CURATIEVELDEN) {
    const oud = normaliseer(veld, huidig[veld]);
    const nieuw = normaliseer(veld, nieuwRij[veld]);
    if (oud !== nieuw) {
      update[veld] = nieuw;
      logRijen.push({
        veld_naam: veld,
        oude_waarde: oud === null ? null : String(oud),
        nieuwe_waarde: nieuw === null ? null : String(nieuw),
        wijzig_type: veld === "status" ? "status" : veld === "bronstatus" ? "bronstatus" : "metadata",
        rag_impact: RAG_CURATIEVELDEN.has(veld),
      });
    }
  }
  return { update, logRijen };
}
