// ============================================================================
// Aantoonbare documentdekking — pure taal- en bewijscontracten (M6–M8)
// ============================================================================

import type { Bewijsniveau, Vraagroute } from "./vraagrouter";

export type Dekkingsmodus = "targeted" | "volledig" | "gedeeltelijk";
export type DekkingsAfkapreden =
  | "chunk_cap"
  | "token_cap"
  | "batch_cap"
  | "batch_timeout"
  | "batch_fout"
  | "retrieval_fout";

export interface DocumentDekking {
  modus: Dekkingsmodus;
  geselecteerde_passages: number;
  totaal_passages: number | null;
  verwerkte_passages: number;
  totaal_batches: number | null;
  verwerkte_batches: number | null;
  volledig: boolean;
  afkapredenen: DekkingsAfkapreden[];
  pagina_dekking: { verwerkt: number; totaal: number | null } | null;
  sectie_dekking: { verwerkt: number; totaal: number | null } | null;
}

export function gerichteDekking(geselecteerd: number): DocumentDekking {
  return {
    modus: "targeted",
    geselecteerde_passages: Math.max(0, geselecteerd),
    totaal_passages: null,
    verwerkte_passages: Math.max(0, geselecteerd),
    totaal_batches: null,
    verwerkte_batches: null,
    volledig: false,
    afkapredenen: [],
    pagina_dekking: null,
    sectie_dekking: null,
  };
}

export function bredeDekking(input: {
  totaalPassages: number | null;
  verwerktePassages: number;
  totaalBatches?: number | null;
  verwerkteBatches?: number | null;
  afkapredenen?: DekkingsAfkapreden[];
  verwerktePaginas?: number;
  totaalPaginas?: number | null;
  verwerkteSecties?: number;
  totaalSecties?: number | null;
}): DocumentDekking {
  const totaal = input.totaalPassages;
  const verwerkt = Math.max(0, input.verwerktePassages);
  const redenen = [...new Set(input.afkapredenen ?? [])];
  const batchesCompleet =
    input.totaalBatches == null || input.verwerkteBatches === input.totaalBatches;
  const volledig =
    totaal !== null && totaal > 0 && verwerkt === totaal && batchesCompleet && redenen.length === 0;
  return {
    modus: volledig ? "volledig" : "gedeeltelijk",
    geselecteerde_passages: verwerkt,
    totaal_passages: totaal,
    verwerkte_passages: verwerkt,
    totaal_batches: input.totaalBatches ?? null,
    verwerkte_batches: input.verwerkteBatches ?? null,
    volledig,
    afkapredenen: redenen,
    pagina_dekking:
      input.verwerktePaginas === undefined
        ? null
        : {
            verwerkt: Math.max(0, input.verwerktePaginas),
            totaal: input.totaalPaginas ?? null,
          },
    sectie_dekking:
      input.verwerkteSecties === undefined
        ? null
        : {
            verwerkt: Math.max(0, input.verwerkteSecties),
            totaal: input.totaalSecties ?? null,
          },
  };
}

export function bewijsniveauVoorDekking(dekking: DocumentDekking): Bewijsniveau {
  if (dekking.volledig) return "uitputtend";
  if (dekking.verwerkte_passages > 0) return "onderbouwd";
  return "indicatief";
}

export function finaliseerRouteMetDekking(
  route: Vraagroute,
  dekking: DocumentDekking
): Vraagroute {
  return { ...route, bewijsniveau: bewijsniveauVoorDekking(dekking) };
}

/** Code-gedreven, bestuurlijk leesbaar label voor UI en auditcontrole. */
export function dekkingslabel(dekking: DocumentDekking): string {
  if (dekking.modus === "targeted") {
    const n = dekking.geselecteerde_passages;
    return `Gericht gezocht · ${n} ${n === 1 ? "passage" : "passages"} geselecteerd`;
  }
  if (dekking.volledig) {
    return `Volledig document verwerkt · ${dekking.verwerkte_passages} van ${dekking.totaal_passages} passages`;
  }
  if (dekking.totaal_batches !== null) {
    return `Gedeeltelijk verwerkt · ${dekking.verwerkte_batches ?? 0} van ${dekking.totaal_batches} batches`;
  }
  const totaal = dekking.totaal_passages === null ? "onbekend" : String(dekking.totaal_passages);
  return `Gedeeltelijk verwerkt · ${dekking.verwerkte_passages} van ${totaal} passages`;
}

/**
 * Exact taalcontract dat als extra systeembrok wordt toegevoegd. De gebruiker
 * ziet hetzelfde contract via `dekkingslabel`; het model mag het niet oprekken.
 */
export function dekkingsInstructie(dekking: DocumentDekking): string {
  if (dekking.modus === "targeted") {
    return `DEKKINGSCONTRACT — GERICHTE ZOEKACTIE:
U kreeg uitsluitend ${dekking.geselecteerde_passages} geselecteerde passages, niet het volledige document.
Als gevraagde informatie daarin ontbreekt, formuleer uitsluitend: "Niet gevonden in de geselecteerde passages. Dit is geen uitspraak over het volledige document."
Zeg nooit dat iets niet in het document of hoofddocument staat.`;
  }
  if (dekking.volledig) {
    return `DEKKINGSCONTRACT — VOLLEDIG:
De volledige technisch beschikbare documentversie is verwerkt: ${dekking.verwerkte_passages} van ${dekking.totaal_passages} passages.
Alleen nu mag u, per concreet criterium, formuleren: "Binnen de volledig verwerkte documentversie is voor [criterium] geen onderbouwing aangetroffen."`;
  }
  return `DEKKINGSCONTRACT — GEDEELTELIJK:
De analyse is gedeeltelijk: ${dekking.verwerkte_passages} van ${dekking.totaal_passages ?? "een onbekend aantal"} passages en ${dekking.verwerkte_batches ?? 0} van ${dekking.totaal_batches ?? "een onbekend aantal"} batches zijn verwerkt.
Formuleer expliciet: "De analyse is gedeeltelijk. Over ontbrekende inhoud in het volledige document kan geen conclusie worden getrokken."
Zeg nooit dat iets niet in het volledige document staat.`;
}

export interface VolledigeAnalyseAanbodInput {
  route: Vraagroute;
  dekking: DocumentDekking;
  documentIds: string[];
  totaalPassages: number | null;
  maximaalPassages: number;
  actief: boolean;
}

export function magVolledigeAnalyseAanbieden(input: VolledigeAnalyseAanbodInput): boolean {
  if (!input.actief || input.route.dekking !== "targeted") return false;
  if (input.documentIds.length !== 1) return false;
  if (input.route.taak === "feitopzoeking") return false;
  if (input.dekking.verwerkte_passages <= 0 && input.route.taak === "onbekend") return false;
  if (input.totaalPassages === null || input.totaalPassages <= 0) return false;
  return input.totaalPassages <= input.maximaalPassages;
}
