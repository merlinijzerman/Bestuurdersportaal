// lib/aqlab/assurance-core.ts
// -----------------------------------------------------------------------------
// AQLab — PURE kern van de assurance-view (AQL-4, functioneel scherm 9). Geen
// I/O, los testbaar (lib/aqlab-assurance.sanity.ts). Bevat:
//   • de feature↔module-mapping die bepaalt welke AI-features een fonds gebruikt;
//   • de vertaling van ruwe (geaggregeerde) meetwaarden naar bestuurlijke labels;
//   • het samenstellen van het view-model dat UITSLUITEND aggregaten bevat.
//
// STRIKTE GRENS (CLAUDE.md / functioneel §5.7): het AssuranceTegel-type bevat
// STRUCTUREEL geen velden voor ruwe output, prompt, context, testcase-inhoud of
// andere-fondsen-data. Lekken is daardoor niet mogelijk via dit view-model.
// -----------------------------------------------------------------------------

import type { ModuleKey } from "../module-registry";
import {
  AI_ONDERSTEUNEND,
  DISCLAIMER_44,
  FONDS_STATUS_LABEL,
  GELDIGHEID_PRODUCTBREED,
  SCOPE_BANNER_PRODUCTBREED,
  SCOPE_LABEL,
  WAT_NIET,
  WAT_WEL,
  WAT_WEL_NIET_VRIJGEGEVEN,
} from "./assurance-teksten";

/** De 3 productfeatures (aqlab_ai_features.code) + hun bestuurlijke label. */
export const FEATURE_LABEL: Record<string, string> = {
  bestuurlijke_samenvatting: "Bestuurlijke samenvatting",
  brongebonden_vraagbeantwoording: "Brongebonden vraagbeantwoording",
  besluitvoorbereiding: "Besluitvoorbereiding",
};

/**
 * Feature↔module-mapping (MVP). Een fonds "gebruikt" een AI-feature als één van
 * de gekoppelde portaalmodules voor dat fonds beschikbaar is (manifest/flags).
 * Bewuste, expliciete keuze — geen open enum:
 *   • brongebonden_vraagbeantwoording en bestuurlijke_samenvatting lopen via de
 *     AI-assistentielaag ("ai"); samenvattingen zijn óók zichtbaar in "notulen".
 *   • besluitvoorbereiding ondersteunt de Decision-Object-flow ("procedures").
 * Latere fonds-specifieke assurance kan dit verfijnen (architectuur §12).
 */
export const AQLAB_FEATURE_MODULE: Record<string, ModuleKey[]> = {
  brongebonden_vraagbeantwoording: ["ai"],
  bestuurlijke_samenvatting: ["ai", "notulen"],
  besluitvoorbereiding: ["procedures"],
};

/** Welke AI-features toont de assurance-view voor een fonds, gegeven zijn
 *  beschikbare modules? (De doorsnede met de mapping is niet-leeg.) */
export function bepaalGebruikteFeatures(beschikbareModules: ReadonlySet<ModuleKey>): string[] {
  return Object.keys(AQLAB_FEATURE_MODULE).filter((code) =>
    AQLAB_FEATURE_MODULE[code].some((m) => beschikbareModules.has(m))
  );
}

export type Indicator = "Hoog" | "Midden" | "Laag" | "Onbekend";

/** Zet een 0..1-ratio om naar een bestuurlijke indicator (geen exact cijfer —
 *  meetbeperking blijft zichtbaar via de "wat níet"-uitleg). */
export function indicatorVan(ratio: number | null | undefined): Indicator {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "Onbekend";
  if (ratio >= 0.8) return "Hoog";
  if (ratio >= 0.5) return "Midden";
  return "Laag";
}

/** Vertaalt de DB-release_status naar de fonds-facing statustaal (§5.2/§5.6). */
export function fondsStatusLabel(releaseStatus: string | null): string {
  if (releaseStatus === "vrijgegeven") return FONDS_STATUS_LABEL.vrijgegeven;
  if (releaseStatus === "review_vereist") return FONDS_STATUS_LABEL.review_vereist;
  return FONDS_STATUS_LABEL.niet_vrijgegeven;
}

/** Regressie-uitkomst t.o.v. de vorige vrijgegeven versie, bestuurlijk (§5.2a). */
export function regressieLabel(status: string | null | undefined): "Verbeterd" | "Gelijk" | "Aandachtspunt" | "Onbekend" {
  if (status === "verbeterd") return "Verbeterd";
  if (status === "gelijk") return "Gelijk";
  if (status === "regressie" || status === "nieuwe_blokkade") return "Aandachtspunt";
  return "Onbekend";
}

/** Ruwe (geaggregeerde) meetwaarden voor één feature — door de service opgehaald,
 *  NOOIT ruwe output. Alle velden zijn getallen/labels/tellingen. */
export interface AssuranceMeetwaarden {
  feature_code: string;
  release_status: string | null;
  laatste_controle: string | null;   // ISO-datum van de laatste toetsing
  aantal_functioneel: number | null;
  aantal_blokkerend: number | null;
  kritieke_bevindingen: number;
  openstaande_review: number;
  brongebondenheid_ratio: number | null; // 0..1
  format_compliance_ratio: number | null; // 0..1
  regressie_status: string | null;
  audit_export_id: string | null;
  inhoud_hash: string | null;
}

/** Read-only tegel voor de assurance-view — UITSLUITEND aggregaten + vaste uitleg. */
export interface AssuranceTegel {
  feature_code: string;
  feature_naam: string;
  laatste_controle: string | null;
  type_controle: string;            // scope-label
  status_label: string;             // "Vrijgegeven voor gebruik" / ...
  aantal_testgevallen: string;      // "24 functioneel + 6 blokkerend"
  kritieke_bevindingen: number;
  openstaande_review: string;       // "Geen" / aantal
  brongebondenheid: Indicator;
  format_compliance: "Voldoet" | "Voldoet niet" | "Onbekend";
  regressie: string;
  geldigheid: string;
  audit_export_id: string | null;
  inhoud_hash: string | null;
  wat_wel: string;
  wat_niet: string;
  footer: string;
}

export interface AssuranceView {
  scope_banner: string;
  disclaimer: string;
  tegels: AssuranceTegel[];
}

/** Stelt één read-only tegel samen uit geaggregeerde meetwaarden. */
export function bouwAssuranceTegel(m: AssuranceMeetwaarden): AssuranceTegel {
  const testgevallen =
    m.aantal_functioneel === null && m.aantal_blokkerend === null
      ? "Onbekend"
      : `${m.aantal_functioneel ?? 0} functioneel + ${m.aantal_blokkerend ?? 0} blokkerend`;
  return {
    feature_code: m.feature_code,
    feature_naam: FEATURE_LABEL[m.feature_code] ?? m.feature_code,
    laatste_controle: m.laatste_controle,
    type_controle: SCOPE_LABEL.productbreed,
    status_label: fondsStatusLabel(m.release_status),
    aantal_testgevallen: testgevallen,
    kritieke_bevindingen: m.kritieke_bevindingen,
    openstaande_review: m.openstaande_review > 0 ? String(m.openstaande_review) : "Geen",
    brongebondenheid: indicatorVan(m.brongebondenheid_ratio),
    format_compliance:
      m.format_compliance_ratio === null || m.format_compliance_ratio === undefined
        ? "Onbekend"
        : m.format_compliance_ratio >= 0.99 ? "Voldoet" : "Voldoet niet",
    regressie: regressieLabel(m.regressie_status),
    geldigheid: GELDIGHEID_PRODUCTBREED,
    audit_export_id: m.audit_export_id,
    inhoud_hash: m.inhoud_hash,
    // De positieve "voldoet aan de eisen"-tekst mag ALLEEN bij een vrijgegeven
    // feature; anders een neutrale variant (geen schijnzekerheid — governance).
    wat_wel: m.release_status === "vrijgegeven" ? WAT_WEL : WAT_WEL_NIET_VRIJGEGEVEN,
    wat_niet: WAT_NIET,
    footer: AI_ONDERSTEUNEND,
  };
}

/** Bouwt de complete read-only assurance-view (banner + disclaimer + tegels). */
export function bouwAssuranceView(meetwaarden: AssuranceMeetwaarden[]): AssuranceView {
  return {
    scope_banner: SCOPE_BANNER_PRODUCTBREED,
    disclaimer: DISCLAIMER_44,
    tegels: meetwaarden.map(bouwAssuranceTegel),
  };
}
