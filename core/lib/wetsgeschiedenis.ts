// ============================================================================
//  lib/wetsgeschiedenis.ts — Wetsgeschiedenis A-light, foundation.
// ----------------------------------------------------------------------------
//  Pure metadata-logica voor juridische bronnen in de GENERIEKE bibliotheek:
//  actuele geconsolideerde wetgeving (geldend recht) en wetsgeschiedenis
//  (toelichting, nooit zelfstandig bindend). Geen DB/IO → testbaar via
//  lib/wetsgeschiedenis.sanity.ts. Wordt geconsumeerd door
//  valideerGeneriekeCuratie (lib/generiek-curatie-juridisch.ts); de DB-CHECKs uit migratie
//  2026_09_23_wetsgeschiedenis_a_light_foundation.sql spiegelen deze regels.
//
//  Bewust NIET hier (WERKTICKET-WETSGESCHIEDENIS-A-LIGHT):
//    • geen veld publicatiekenmerk — de volledige officiële verwijzing staat in
//      de titel (bv. "Memorie van toelichting — Kamerstukken II 2021/22,
//      36 067, nr. 3");
//    • geen veld behandelingsstatus — "aangenomen" ligt vast in het subtype
//      `aangenomen_amendement`; de controle daarop hoort in de
//      broncuratielijst vóór import;
//    • geen artikelregister, koppeltabel of historische wetsversies.
// ============================================================================

import type { Normgewicht } from "./bronsoort";
import type { Regime } from "./weeg-regime";

// ── Juridische documenttypen (alleen generieke bibliotheek) ─────────────────
// Los van `Documenttype` in document-metadata.ts gehouden: die lijst voedt de
// fonds-uploadflows, en een fondsdocument mag zich niet als wet voordoen
// (DB: documenten_juridisch_generiek_check).
export const JURIDISCHE_DOCUMENTTYPEN = ["wetgeving", "wetsgeschiedenis"] as const;
export type JuridischDocumenttype = (typeof JURIDISCHE_DOCUMENTTYPEN)[number];

export const JURIDISCH_DOCUMENTTYPE_LABEL: Record<JuridischDocumenttype, string> = {
  wetgeving: "Wetgeving (actuele geconsolideerde tekst)",
  wetsgeschiedenis: "Wetsgeschiedenis",
};

export function isJuridischDocumenttype(w: unknown): w is JuridischDocumenttype {
  return (
    typeof w === "string" &&
    (JURIDISCHE_DOCUMENTTYPEN as readonly string[]).includes(w)
  );
}

// ── Subtypen wetsgeschiedenis (spiegelt documenten_wetsgeschiedenis_subtype_check)
export const WETSGESCHIEDENIS_SUBTYPEN = [
  "memorie_van_toelichting",
  "aangenomen_amendement",
  "nota_van_wijziging",
  "nota_naar_aanleiding_van_het_verslag",
  // Ook voor een NADERE memorie van antwoord; het onderscheid staat in de titel.
  "memorie_van_antwoord",
  // Toelichting bij een AMvB: geïdentificeerd via het Staatsblad, niet via een
  // Kamerstukdossier — het enige subtype waarbij het dossiernummer optioneel is.
  "nota_van_toelichting",
] as const;
export type WetsgeschiedenisSubtype = (typeof WETSGESCHIEDENIS_SUBTYPEN)[number];

export const WETSGESCHIEDENIS_SUBTYPE_LABEL: Record<WetsgeschiedenisSubtype, string> = {
  memorie_van_toelichting: "Memorie van toelichting",
  aangenomen_amendement: "Aangenomen amendement",
  nota_van_wijziging: "Nota van wijziging",
  nota_naar_aanleiding_van_het_verslag: "Nota naar aanleiding van het verslag",
  memorie_van_antwoord: "Memorie van antwoord",
  nota_van_toelichting: "Nota van toelichting (AMvB)",
};

/** Subtypen zonder verplicht Kamerstukdossier (identificatie via Staatsblad). */
export const SUBTYPEN_DOSSIER_OPTIONEEL: readonly WetsgeschiedenisSubtype[] = [
  "nota_van_toelichting",
];

export function isDossiernummerVerplicht(subtype: string | null | undefined): boolean {
  return !(SUBTYPEN_DOSSIER_OPTIONEEL as readonly string[]).includes(subtype ?? "");
}

export function isWetsgeschiedenisSubtype(w: unknown): w is WetsgeschiedenisSubtype {
  return (
    typeof w === "string" &&
    (WETSGESCHIEDENIS_SUBTYPEN as readonly string[]).includes(w)
  );
}

// ── Wettelijk regime (hergebruik T4-facet documenten.wettelijk_regime) ───────
export const WETTELIJKE_REGIMES: readonly Regime[] = ["pw", "wvb", "beide", "algemeen"];

export const WETTELIJK_REGIME_LABEL: Record<Regime, string> = {
  pw: "Pensioenwet",
  wvb: "Wet verplichte beroepspensioenregeling",
  beide: "Pensioenwet en Wvb",
  algemeen: "Algemeen / regime-neutraal",
};

/** Een juridische bron hoort bij een concreet regime; 'algemeen' volstaat niet. */
export const JURIDISCHE_REGIMES: readonly Regime[] = ["pw", "wvb", "beide"];

export function isWettelijkRegime(w: unknown): w is Regime {
  return typeof w === "string" && (WETTELIJKE_REGIMES as readonly string[]).includes(w);
}

// ── Dossiernummer ───────────────────────────────────────────────────────────
// Canonieke opslagvorm: 3–6 cijfers zonder scheiding, optioneel "-<SUFFIX>"
// (bv. begrotingshoofdstuk "36200-XV"). Spiegelt documenten_dossiernummer_check.
export const DOSSIERNUMMER_PATROON = /^[0-9]{3,6}(-[A-Z0-9]{1,8})?$/;

/**
 * Normaliseert een ingevoerd Kamerstukdossiernummer naar de opslagvorm.
 *   "36 067"   → "36067"
 *   "36.067"   → "36067"
 *   "36 200-XV" / "36200 xv" → "36200-XV"
 * Leeg → null. Niet te herkennen → { fout }.
 */
export function normaliseerDossiernummer(
  invoer: string | null | undefined
): { ok: true; waarde: string | null } | { ok: false; fout: string } {
  if (typeof invoer !== "string") return { ok: true, waarde: null };
  // Alle spatiesoorten (incl. harde en smalle spatie) naar één gewone spatie.
  const s = invoer.replace(/[\s   ]+/g, " ").trim();
  if (s === "") return { ok: true, waarde: null };

  const m = s.match(/^(\d{1,3}(?:[ .]\d{3})?|\d{3,6})(?:\s*[-–]\s*|\s+)?([A-Za-z]{1,8}\d{0,2})?$/);
  if (m) {
    const cijfers = m[1].replace(/[ .]/g, "");
    const suffix = m[2] ? m[2].toUpperCase() : null;
    const waarde = suffix ? `${cijfers}-${suffix}` : cijfers;
    if (DOSSIERNUMMER_PATROON.test(waarde)) return { ok: true, waarde };
  }
  return {
    ok: false,
    fout:
      "Ongeldig dossiernummer. Gebruik het Kamerstukdossier, bv. '36 067' of '36 200-XV'.",
  };
}

/** Leesbare weergave: "36067" → "36 067", "36200-XV" → "36 200-XV". */
export function formatteerDossiernummer(waarde: string | null | undefined): string {
  if (!waarde) return "";
  const [cijfers, suffix] = waarde.split("-");
  const gegroepeerd = cijfers.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return suffix ? `${gegroepeerd}-${suffix}` : gegroepeerd;
}

/** Bevat de titel een Staatsbladverwijzing, bv. "Stb. 2023, 217"? */
export function titelBevatStaatsblad(titel: string): boolean {
  return /\b(?:Stb\.?|Staatsblad)\s*\d{4}\s*,?\s*(?:nr\.?\s*)?\d+/i.test(titel);
}

/** Komt het (cijferdeel van het) dossiernummer voor in de titel? */
export function titelBevatDossiernummer(titel: string, dossiernummer: string): boolean {
  const cijfers = dossiernummer.split("-")[0];
  const compact = titel.replace(/[\s   .]/g, "");
  return compact.includes(cijfers);
}

// ── Combinatievalidatie ─────────────────────────────────────────────────────
export interface JuridischeInvoer {
  /** Getrimd; null = niet opgegeven. */
  documenttype: string | null;
  wetsgeschiedenis_subtype: string | null;
  dossiernummer: string | null;
  /** Getrimd RUW normgewicht (vóór de generieke default 'onbekend'). */
  normgewicht: string | null;
  wettelijk_regime: string | null;
  titel: string | null;
  extern_url: string | null;
  documentdatum: string | null;
}

export interface JuridischeUitkomst {
  fouten: Record<string, string>;
  /** Alleen betekenisvol als fouten leeg is. */
  wetsgeschiedenis_subtype: WetsgeschiedenisSubtype | null;
  dossiernummer: string | null;
  /** Afgedwongen normgewicht (wetsgeschiedenis → 'informatief'); anders null = ongemoeid. */
  normgewichtAfgedwongen: Normgewicht | null;
}

const VOORBEELD_TITEL =
  "Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3";
const VOORBEELD_TITEL_NVT =
  "Nota van toelichting — Besluit toekomst pensioenen, Stb. 2023, 217";

/**
 * Valideert de juridische metadata-combinatie. Raakt niets als het
 * documenttype geen juridisch type is, behalve dat subtype/dossiernummer dan
 * leeg moeten zijn — zo verandert er niets voor bestaande documenttypen.
 */
export function valideerJuridischeMetadata(invoer: JuridischeInvoer): JuridischeUitkomst {
  const fouten: Record<string, string> = {};
  const type = invoer.documenttype;

  const dossier = normaliseerDossiernummer(invoer.dossiernummer);
  const subtypeRaw = invoer.wetsgeschiedenis_subtype;

  if (type !== "wetsgeschiedenis") {
    if (subtypeRaw !== null) {
      fouten.wetsgeschiedenis_subtype =
        "Een subtype hoort alleen bij documenttype 'Wetsgeschiedenis'.";
    }
    if (invoer.dossiernummer !== null && invoer.dossiernummer.trim() !== "") {
      fouten.dossiernummer =
        "Een dossiernummer hoort alleen bij documenttype 'Wetsgeschiedenis'.";
    }
  }

  if (isJuridischDocumenttype(type)) {
    if (!invoer.wettelijk_regime || !(JURIDISCHE_REGIMES as readonly string[]).includes(invoer.wettelijk_regime)) {
      fouten.wettelijk_regime =
        "Kies het wettelijk regime: Pensioenwet, Wvb of beide.";
    }
    if (!invoer.extern_url) {
      fouten.extern_url = "Een officiële bron-URL is verplicht voor wetgeving en wetsgeschiedenis.";
    }
  }

  let normgewichtAfgedwongen: Normgewicht | null = null;
  let subtype: WetsgeschiedenisSubtype | null = null;
  let dossiernummer: string | null = null;

  if (type === "wetsgeschiedenis") {
    if (subtypeRaw === null) {
      fouten.wetsgeschiedenis_subtype = "Kies het soort parlementair stuk.";
    } else if (!isWetsgeschiedenisSubtype(subtypeRaw)) {
      fouten.wetsgeschiedenis_subtype = "Ongeldig subtype voor wetsgeschiedenis.";
    } else {
      subtype = subtypeRaw;
    }

    if (!dossier.ok) {
      fouten.dossiernummer = dossier.fout;
    } else if (dossier.waarde === null) {
      if (isDossiernummerVerplicht(subtypeRaw)) {
        fouten.dossiernummer = "Het dossiernummer van het wetgevingsdossier is verplicht.";
      }
    } else {
      dossiernummer = dossier.waarde;
      if (invoer.titel && !titelBevatDossiernummer(invoer.titel, dossier.waarde)) {
        fouten.titel =
          `Neem de volledige officiële verwijzing op in de titel, inclusief het dossiernummer ` +
          `(bv. '${VOORBEELD_TITEL}').`;
      }
    }

    // Nota van toelichting (AMvB): identificatie via het Staatsblad in de titel.
    if (subtypeRaw === "nota_van_toelichting" && invoer.titel && !fouten.titel &&
        !titelBevatStaatsblad(invoer.titel)) {
      fouten.titel =
        `Neem het Staatsbladnummer op in de titel (bv. '${VOORBEELD_TITEL_NVT}').`;
    }

    // Wetsgeschiedenis is nooit bindend — ook een aangenomen amendement niet.
    if (invoer.normgewicht === null || invoer.normgewicht === "informatief") {
      normgewichtAfgedwongen = "informatief";
    } else {
      fouten.normgewicht =
        "Wetsgeschiedenis is geen zelfstandige norm; het normgewicht is altijd 'Informatief'.";
    }

    if (!invoer.documentdatum) {
      fouten.documentdatum = "De datum van het parlementaire stuk is verplicht.";
    }
  }

  return { fouten, wetsgeschiedenis_subtype: subtype, dossiernummer, normgewichtAfgedwongen };
}

// ── Duiding (voor latere bronweergave; nu alleen in de curatie-UI) ───────────
export type JuridischeRol = "geldend_recht" | "wetsgeschiedenis";

export interface JuridischeDuiding {
  rol: JuridischeRol;
  /** Mag deze bron zelfstandig een norm dragen? Wetsgeschiedenis: nooit. */
  magNormDragen: boolean;
  label: string;
}

/**
 * Duiding van een juridische bron: geldend recht of wetsgeschiedenis. null
 * voor niet-juridische documenttypen (gedrag daar ongewijzigd).
 */
export function juridischeDuiding(
  documenttype: string | null | undefined,
  subtype: string | null | undefined
): JuridischeDuiding | null {
  if (documenttype === "wetgeving") {
    return { rol: "geldend_recht", magNormDragen: true, label: "Geldend recht" };
  }
  if (documenttype === "wetsgeschiedenis") {
    const soort = isWetsgeschiedenisSubtype(subtype)
      ? WETSGESCHIEDENIS_SUBTYPE_LABEL[subtype]
      : "Wetsgeschiedenis";
    const staart =
      subtype === "aangenomen_amendement"
        ? "wetsgeschiedenis, geen zelfstandige norm"
        : "wetsgeschiedenis, geen norm";
    return { rol: "wetsgeschiedenis", magNormDragen: false, label: `${soort} — ${staart}` };
  }
  return null;
}
