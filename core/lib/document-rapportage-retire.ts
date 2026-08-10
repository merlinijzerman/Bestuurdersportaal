// ============================================================================
//  core/lib/document-rapportage-retire.ts — werkopdracht metadata-vereenvoudiging 2.5
// ----------------------------------------------------------------------------
//  De "vorige rapportage → historisch"-retire bij aanlevering van een NIEUWE
//  rapportage. Rapportages zijn serieel: elke periode vervangt de vorige. Zonder
//  retire blijft een eerdere rapportage die op `vastgesteld`/`van_kracht` staat
//  een ACTUELE bron náást de nieuwe — dan kan de assistent verouderde
//  periodecijfers citeren alsof ze actueel zijn (OP-MS1).
//
//  Human-in-the-loop: de uploader KIEST de op te volgen rapportage; het systeem
//  raadt niet. De retire is een gewone statustransitie
//  (`vastgesteld/van_kracht → historisch`, besluit 0154) — deze helper valideert
//  hem puur, zodat de upload-route én de UI dezelfde regels gebruiken en de
//  sanity-suite ze kan naslaan. Geen bronstatus, geen migratie: additief op het
//  bestaande 5-waarden-statusmodel (Fase 2A).
// ============================================================================

import { type Documenttype } from "./document-metadata";
import {
  magOvergaan,
  redenVerplicht,
  type DocumentStatus,
} from "./document-status-transities";

export type RapportageRetireUitkomst =
  | { ok: true; naar: "historisch"; redenVerplicht: boolean }
  | { ok: false; foutcode: string; melding: string };

/**
 * Beoordeelt of de gekozen voorganger bij een rapportage-upload naar
 * `historisch` mag worden afgevoerd.
 *
 * Voorwaarden:
 *  - het NIEUW aangeleverde stuk is zelf een `rapportage` (anders is er geen
 *    opvolging in de reeks);
 *  - de voorganger is óók een `rapportage` (je voert geen beleidsstuk af als
 *    "vorige rapportage");
 *  - de voorganger staat op een status die volgens de transitietabel naar
 *    `historisch` mag (in de praktijk `vastgesteld` of `van_kracht`).
 *
 * De capability-check (`documents.status.change`) en de fonds-/RLS-grens zitten
 * bewust NIET hier — die vragen een DB-lookup; de route doet ze.
 */
export function beoordeelRapportageRetire(opties: {
  nieuwDocumenttype: Documenttype | null;
  voorgangerDocumenttype: Documenttype | null;
  voorgangerStatus: DocumentStatus | null;
}): RapportageRetireUitkomst {
  if (opties.nieuwDocumenttype !== "rapportage") {
    return {
      ok: false,
      foutcode: "geen_rapportage_upload",
      melding:
        "Een voorganger afvoeren kan alleen bij het aanleveren van een rapportage.",
    };
  }
  if (opties.voorgangerDocumenttype !== "rapportage") {
    return {
      ok: false,
      foutcode: "voorganger_geen_rapportage",
      melding: "Alleen een eerdere rapportage kan als voorganger worden afgevoerd.",
    };
  }
  const status = opties.voorgangerStatus;
  if (!status || !magOvergaan(status, "historisch")) {
    return {
      ok: false,
      foutcode: "voorganger_niet_afvoerbaar",
      melding:
        `De vorige rapportage staat op '${status ?? "onbekend"}' en kan van daaruit ` +
        "niet naar historisch worden afgevoerd.",
    };
  }
  return {
    ok: true,
    naar: "historisch",
    redenVerplicht: redenVerplicht(status, "historisch"),
  };
}

/**
 * Mag een rapportage als actuele voorganger in de picker verschijnen? Puur de
 * status-kant (documenttype-filter doet de aanroeper): alleen een rapportage die
 * NU actueel is, is een zinvolle op te volgen versie.
 */
export function isActueleRapportageVoorganger(
  status: DocumentStatus | null
): boolean {
  return status === "vastgesteld" || status === "van_kracht";
}
