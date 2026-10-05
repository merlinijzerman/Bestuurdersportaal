// ============================================================================
//  lib/wetsgeschiedenis-structuur.ts — Wetsgeschiedenis A-light, foundation.
// ----------------------------------------------------------------------------
//  Pure, conservatieve structurering van parlementaire stukken (memorie van
//  toelichting, nota van wijziging, nota n.a.v. het verslag, aangenomen
//  amendement) in logische delen:
//    • algemeen deel;
//    • artikelsgewijze toelichting, per artikel of onderdeel;
//    • bij een amendement: de wijzigingstekst en de toelichting.
//
//  Het resultaat is compatibel met StructuurUnit (lib/chunking.ts): het
//  hergebruikt de bestaande chunkvelden structuur_type en structuur_label, er
//  komt geen nieuw chunkveld bij.
//
//  Aangesloten op de pure chunk-bouw voor documenttype `wetsgeschiedenis`.
//  Zowel de eerste ingest als herindexering gebruikt daardoor dezelfde logica.
//
//  Conservatief: alleen een kop op een EIGEN, korte regel telt als grens. Een
//  verwijzing midden in een zin ("zoals artikel 150d bepaalt") splitst nooit.
//  Wordt niets herkend, dan blijft de tekst één 'overig'-unit en valt de
//  bestaande generieke chunking terug op haar eigen structuurdetectie.
// ============================================================================

import type {
  GestructureerdTekstSegment,
  StructuurType,
  StructuurUnit,
} from "./chunking";
import type { TekstSegment } from "./document-extractie";
import type { WetsgeschiedenisSubtype } from "./wetsgeschiedenis";

export type ParlementairDeel =
  | "algemeen_deel"
  | "artikelsgewijze_toelichting"
  | "amendement_wijziging"
  | "amendement_toelichting"
  | "overig";

export const PARLEMENTAIR_DEEL_LABEL: Record<ParlementairDeel, string> = {
  algemeen_deel: "Algemeen deel",
  artikelsgewijze_toelichting: "Artikelsgewijze toelichting",
  amendement_wijziging: "Amendement — wijziging",
  amendement_toelichting: "Amendement — toelichting",
  overig: "Overig",
};

export interface ParlementaireUnit {
  deel: ParlementairDeel;
  type: StructuurType;
  /** Artikel/onderdeel of kop binnen het deel; null = lopende tekst. */
  label: string | null;
  tekst: string;
}

interface ParlementaireToestand {
  deel: ParlementairDeel;
  huidigArtikel: string | null;
  voortzetting: Pick<ParlementaireUnit, "deel" | "type" | "label"> | null;
}

// Maximale lengte van een kopregel. Langer = doorlopende tekst.
const MAX_KOP = 120;

const RE_ALGEMEEN = /^(?:[IVX]+\.?\s+)?(?:algemeen(?:\s+deel)?|algemene\s+toelichting)$/i;
const RE_ARTIKELSGEWIJS = /^(?:[IVX]+\.?\s+)?(?:artikelsgewijs|artikelsgewijze\s+toelichting|artikelgewijze\s+toelichting|artikelsgewijze\s+toelichting\s+.*)$/i;
const RE_TOELICHTING = /^toelichting$/i;
const RE_EERSTE_ALGEMENE_KOP = /^1\.?\s+(?:Algemeen|Inleiding)\b/;
// Een artikelkop begint met een hoofdletter ("Artikel"/"ARTIKEL"), heeft een
// arabisch nummer (met letter) of een romeins hoofdletternummer, en wordt
// gevolgd door het regeleinde, een punt, een opschrift met hoofdletter, een
// gedachtestreepje of "en …" (koppelkop). Zo blijft een afgebroken verwijzing
// als "artikel 102a, heeft …" lopende tekst (#548). Dat het een losse regel
// is, borgt isKopregel.
const RE_ARTIKEL = /^((?:Artikel|ARTIKEL)\s+(?:\d+[a-z]*|[IVXLC]+)(?:\s*,\s*onderdeel\s+[A-Z0-9]+)?)(?=$|[.:]|\s*[–—-]\s|\s+(?:en|tot\s+en\s+met)\s|\s+\p{Lu})/u;
const RE_ROMEINS_ONDERDEEL = /^[IVXLC]{1,6}$/;
const RE_HOOFDSTUK = /^(Hoofdstuk\s+\d+[a-z]?)\.?\s+\p{Lu}[^\n]{0,110}$/u;
const RE_ONDERDEEL = /^(Onderdeel\s+[A-Z0-9]+)\b/;
const RE_GENUMMERDE_KOP = /^(\d+(?:\.\d+){0,3})\.?\s+\p{Lu}[^\n]{0,110}$/u;

function isKopregel(regel: string): boolean {
  return regel.length > 0 && regel.length <= MAX_KOP && !/[.;:,]$/.test(regel);
}

/**
 * Structureert de tekst van een parlementair stuk. Deterministisch en zonder
 * IO. `subtype` stuurt alleen de amendement-behandeling; bij een onbekend of
 * ontbrekend subtype gelden de MvT-regels.
 */
export function structureerParlementairStuk(
  tekst: string,
  subtype: WetsgeschiedenisSubtype | null
): ParlementaireUnit[] {
  const { units } = structureerSegment(tekst, subtype, beginToestand(subtype));
  return units.length > 0
    ? units
    : [{ deel: "overig", type: "tekst", label: null, tekst }];
}

function beginToestand(subtype: WetsgeschiedenisSubtype | null): ParlementaireToestand {
  const isAmendement = subtype === "aangenomen_amendement";
  return {
    deel: isAmendement ? "amendement_wijziging" : "overig",
    huidigArtikel: null,
    voortzetting: null,
  };
}

/**
 * Structureert extractiesegmenten (PDF-pagina's, een DOCX-blok of tabbladen)
 * met behoud van de toestand tussen segmenten. Een vervolgpagina erft dus het
 * laatst herkende deel en artikel totdat een nieuwe kop een grens opent, maar
 * blijft een apart segment met het eigen paginanummer.
 */
export function structureerParlementaireSegmenten(
  segmenten: TekstSegment[],
  subtype: WetsgeschiedenisSubtype | null
): GestructureerdTekstSegment[] {
  let toestand = beginToestand(subtype);
  return segmenten.map((segment) => {
    const resultaat = structureerSegment(segment.tekst, subtype, toestand);
    toestand = resultaat.toestand;
    return {
      pagina: segment.pagina,
      paragraaf: segment.paragraaf,
      units: alsStructuurUnits(resultaat.units),
    };
  });
}

function structureerSegment(
  tekst: string,
  subtype: WetsgeschiedenisSubtype | null,
  begin: ParlementaireToestand
): { units: ParlementaireUnit[]; toestand: ParlementaireToestand } {
  const isAmendement = subtype === "aangenomen_amendement";
  const units: ParlementaireUnit[] = [];
  let deel = begin.deel;
  let huidigArtikel = begin.huidigArtikel;
  let huidig: ParlementaireUnit | null = begin.voortzetting
    ? { ...begin.voortzetting, tekst: "" }
    : null;

  const sluit = () => {
    if (huidig && huidig.tekst.trim() !== "") units.push(huidig);
    huidig = null;
  };
  const open = (u: ParlementaireUnit) => {
    sluit();
    huidig = u;
  };

  for (const ruw of tekst.split("\n")) {
    const regel = ruw.trim();
    const kop = isKopregel(regel);

    // 1. Deelgrenzen.
    if (kop && isAmendement && RE_TOELICHTING.test(regel)) {
      deel = "amendement_toelichting";
      huidigArtikel = null;
      open({ deel, type: "kop", label: PARLEMENTAIR_DEEL_LABEL[deel], tekst: ruw });
      continue;
    }
    if (kop && !isAmendement && RE_ALGEMEEN.test(regel)) {
      deel = "algemeen_deel";
      huidigArtikel = null;
      open({ deel, type: "kop", label: PARLEMENTAIR_DEEL_LABEL[deel], tekst: ruw });
      continue;
    }
    if (kop && !isAmendement && RE_ARTIKELSGEWIJS.test(regel)) {
      deel = "artikelsgewijze_toelichting";
      huidigArtikel = null;
      open({ deel, type: "kop", label: PARLEMENTAIR_DEEL_LABEL[deel], tekst: ruw });
      continue;
    }

    // 1a. Zonder eigen deelkop (alleen in de inhoudsopgave, zoals de nota van
    //     toelichting in het Staatsblad) opent de eerste genummerde kop
    //     "1. Algemeen" of "1. Inleiding" het algemeen deel.
    if (kop && !isAmendement && deel === "overig" && RE_EERSTE_ALGEMENE_KOP.test(regel)) {
      deel = "algemeen_deel";
      huidigArtikel = null;
    }

    // 1b. Wijzigingsonderdeel van een amendement: een losse romeinse regel
    //     ("I", "II") opent een nieuw onderdeel. Zonder deze grens liep het
    //     laatste artikel van onderdeel I door tot in onderdeel II (#548).
    if (kop && deel === "amendement_wijziging" && RE_ROMEINS_ONDERDEEL.test(regel)) {
      huidigArtikel = null;
      open({ deel, type: "kop", label: `Wijzigingsonderdeel ${regel}`, tekst: ruw });
      continue;
    }

    // 2. Artikel/onderdeel — alleen in de artikelsgewijze toelichting of in de
    //    wijzigingstekst van een amendement (daar is het de structuur zelf).
    const artikelContext =
      deel === "artikelsgewijze_toelichting" || deel === "amendement_wijziging";
    if (kop && artikelContext) {
      const art = regel.match(RE_ARTIKEL);
      if (art) {
        huidigArtikel = normaliseerLabel(art[1]);
        open({ deel, type: "artikel", label: huidigArtikel, tekst: ruw });
        continue;
      }
      const ond = regel.match(RE_ONDERDEEL);
      if (ond) {
        const onderdeel = normaliseerLabel(ond[1]);
        // "Onderdeel B" na "Artikel I, onderdeel A" hoort bij Artikel I.
        const basis = huidigArtikel?.replace(/,\s*onderdeel\s+\S+$/i, "") ?? null;
        const label = basis ? `${basis}, ${onderdeel.replace(/^Onderdeel/, "onderdeel")}` : onderdeel;
        open({ deel, type: "artikel", label, tekst: ruw });
        continue;
      }
    }

    // 3. Hoofdstuk- en genummerde paragraafkop binnen het algemeen deel.
    if (kop && deel === "algemeen_deel") {
      const hfd = regel.match(RE_HOOFDSTUK);
      if (hfd) {
        open({ deel, type: "kop", label: normaliseerLabel(hfd[1]), tekst: ruw });
        continue;
      }
      const par = regel.match(RE_GENUMMERDE_KOP);
      if (par) {
        open({ deel, type: "paragraaf", label: `§${par[1]}`, tekst: ruw });
        continue;
      }
    }

    // 4. Lopende tekst hoort bij de lopende unit (of opent een tekst-unit).
    if (huidig) {
      (huidig as ParlementaireUnit).tekst += "\n" + ruw;
    } else if (regel !== "") {
      huidig = { deel, type: "tekst", label: null, tekst: ruw };
    }
  }
  sluit();

  const laatste = units.at(-1) ?? null;
  return {
    units,
    toestand: {
      deel,
      huidigArtikel,
      voortzetting: laatste
        ? { deel: laatste.deel, type: laatste.type, label: laatste.label }
        : begin.voortzetting,
    },
  };
}

function normaliseerLabel(s: string): string {
  const compact = s.replace(/\s+/g, " ").trim();
  return compact.charAt(0).toUpperCase() + compact.slice(1);
}

/**
 * Vertaalt naar StructuurUnit voor de bestaande chunkpijplijn. Het deel komt
 * in het label (structuur_label), zodat een chunk herkenbaar blijft als
 * "Artikelsgewijze toelichting — Artikel I, onderdeel B".
 */
export function alsStructuurUnits(units: ParlementaireUnit[]): StructuurUnit[] {
  return units.map((u) => {
    const deelLabel = u.deel === "overig" ? null : PARLEMENTAIR_DEEL_LABEL[u.deel];
    const label =
      u.label && deelLabel && u.label !== deelLabel
        ? `${deelLabel} — ${u.label}`
        : (u.label ?? deelLabel);
    return { type: u.type, label, tekst: u.tekst };
  });
}
