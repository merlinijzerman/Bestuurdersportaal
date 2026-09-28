// ============================================================================
//  lib/generiek-curatie-juridisch.ts — Wetsgeschiedenis A-light, foundation.
// ----------------------------------------------------------------------------
//  Curatievalidatie van de generieke bibliotheek MÉT de juridische
//  classificatie (documenttype, subtype wetsgeschiedenis, dossiernummer,
//  wettelijk regime). Bouwt op valideerCuratie (lib/generiek-curatie.ts)
//  zonder die module te wijzigen.
//
//  Waarom een aparte module: generiek-curatie.ts ligt in de bevroren
//  importgraaf van het antwoordpad (rag.ts → isStandaardZichtbaarInRag; zie
//  tests/cross-tenant/retrieval-census.test.ts). Deze foundation mag de
//  retrievallaag niet raken, dus de juridische regels hangen alleen aan het
//  platform-curatiepad (generieke-bibliotheek/acties.ts). Na de Microsoft-
//  release kan dit alsnog worden samengevoegd, mét een bewuste regeneratie
//  van het census-register.
// ============================================================================

import {
  valideerCuratie,
  type CuratieInvoer,
  type CuratieGenormaliseerd,
} from "./generiek-curatie";
import { DOCUMENTTYPEN } from "./document-metadata";
import type { Regime } from "./weeg-regime";
import {
  JURIDISCHE_DOCUMENTTYPEN,
  isWettelijkRegime,
  valideerJuridischeMetadata,
  type WetsgeschiedenisSubtype,
} from "./wetsgeschiedenis";

// Nieuwe generieke documenten kiezen uit de juridische typen (of geen type).
// De fondstypen blijven geldig zodat een bestaand generiek document met een
// historisch type bij bewerken niet stil zijn classificatie verliest.
export const GENERIEKE_DOCUMENTTYPEN_TOEGESTAAN: readonly string[] = [
  ...DOCUMENTTYPEN,
  ...JURIDISCHE_DOCUMENTTYPEN,
];

export interface JuridischeCuratieInvoer extends CuratieInvoer {
  documenttype?: string | null;
  wetsgeschiedenis_subtype?: string | null;
  dossiernummer?: string | null;
  wettelijk_regime?: string | null;
}

// DB-klaar (documenten-kolomnamen; CHECKs in migratie 2026_09_23).
export interface JuridischeCuratieGenormaliseerd extends CuratieGenormaliseerd {
  documenttype: string | null;
  wetsgeschiedenis_subtype: WetsgeschiedenisSubtype | null;
  dossiernummer: string | null;
  wettelijk_regime: Regime | null;
}

export type JuridischeCuratieValidatie =
  | { ok: true; waarde: JuridischeCuratieGenormaliseerd }
  | { ok: false; fouten: Record<string, string> };

function trimNaarNull(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function valideerGeneriekeCuratie(
  invoer: JuridischeCuratieInvoer
): JuridischeCuratieValidatie {
  const fouten: Record<string, string> = {};

  const documenttype = trimNaarNull(invoer.documenttype);
  if (documenttype !== null && !GENERIEKE_DOCUMENTTYPEN_TOEGESTAAN.includes(documenttype)) {
    fouten.documenttype = "Ongeldig documenttype.";
  }

  // wettelijk_regime — hergebruik T4-facet; optioneel, maar geldig als gevuld.
  const wettelijkRegime = trimNaarNull(invoer.wettelijk_regime);
  if (wettelijkRegime !== null && !isWettelijkRegime(wettelijkRegime)) {
    fouten.wettelijk_regime = "Ongeldig wettelijk regime.";
  }

  const juridisch = valideerJuridischeMetadata({
    documenttype,
    wetsgeschiedenis_subtype: trimNaarNull(invoer.wetsgeschiedenis_subtype),
    dossiernummer: trimNaarNull(invoer.dossiernummer),
    normgewicht: trimNaarNull(invoer.normgewicht),
    wettelijk_regime: wettelijkRegime,
    titel: trimNaarNull(invoer.titel),
    extern_url: trimNaarNull(invoer.extern_url),
    documentdatum: trimNaarNull(invoer.documentdatum),
  });
  for (const [veld, fout] of Object.entries(juridisch.fouten)) {
    if (!fouten[veld]) fouten[veld] = fout;
  }

  // Basisvalidatie ongewijzigd; bij wetsgeschiedenis met het afgedwongen
  // normgewicht 'informatief' (anders zou een leeg veld 'onbekend' worden).
  const basis = valideerCuratie({
    ...invoer,
    normgewicht: juridisch.normgewichtAfgedwongen ?? invoer.normgewicht,
  });
  // Bij overlap wint de basisfout (bv. "Titel is verplicht").
  const alleFouten = basis.ok ? fouten : { ...fouten, ...basis.fouten };

  if (!basis.ok || Object.keys(alleFouten).length > 0) {
    return { ok: false, fouten: alleFouten };
  }

  return {
    ok: true,
    waarde: {
      ...basis.waarde,
      documenttype,
      wetsgeschiedenis_subtype: juridisch.wetsgeschiedenis_subtype,
      dossiernummer: juridisch.dossiernummer,
      wettelijk_regime: wettelijkRegime as Regime | null,
    },
  };
}
