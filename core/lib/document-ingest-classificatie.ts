// ============================================================================
//  core/lib/document-ingest-classificatie.ts — besluit 0140
// ----------------------------------------------------------------------------
//  Classificatie BIJ AANLEVERING: documenttype en bronstatus, server-side
//  leidend. Puur (geen I/O) zodat de route én de UI dezelfde regels gebruiken
//  en de sanity-suite ze kan naslaan.
//
//  WAAROM DIT NODIG WAS
//  --------------------
//  Twee gaten in de uploadroute, die elkaar versterkten:
//
//  1. `documenttype` bleef bij upload altijd leeg. Elk geüpload document belandde
//     daardoor in de restgroep "Zonder type" en zette de review-vlag. Het type
//     was pas achteraf, per document, via de metadata-modal te zetten.
//
//  2. `bronstatus` bleef bij upload altijd NULL — en NULL is in
//     `document-status-transities.ts` gelijk aan **actief**. Een archiefdocument
//     dat als "van kracht" werd aangeleverd (want het wás van kracht) werd
//     daarmee stilzwijgend een ACTUELE bron voor de assistent. Dat is geen
//     invulveldje maar een RAG-risico: de assistent kan een verouderd stuk
//     citeren alsof het geldend is. Zichtbaar wordt dat pas als een bestuurder
//     een verkeerd antwoord krijgt.
//
//  DE POORT IS DEZELFDE ALS BIJ EEN LATERE WIJZIGING
//  -------------------------------------------------
//  Bronstatus heeft een eigen transitietabel met capability
//  `documents.bronstatus.change` en redenplicht. Die bij aanlevering overslaan
//  zou een achterdeur maken om precies die governance te omzeilen — upload in
//  plaats van wijzig, en de capability geldt niet meer. Daarom rekenen we de
//  aanlevering door als een gewone overgang vanaf de impliciete beginwaarde
//  `actief`, met dezelfde tabel, dezelfde capability en dezelfde redenplicht.
//  Ditzelfde patroon staat al bij de statusverklaring (besluit 0136).
// ============================================================================

import { DOCUMENTTYPEN, type Documenttype } from "./document-metadata";
import {
  BRONSTATUSSEN,
  magBronstatusOvergaan,
  bronstatusRedenVerplicht,
  bronstatusRagImpact,
  vindBronstatusTransitie,
  type Bronstatus,
} from "./document-status-transities";

/**
 * De impliciete bronstatus van een vers geüpload document.
 *
 * `documenten.bronstatus` blijft NULL bij insert en NULL ≡ actief (migratie
 * 2026_06_18, §2d). Een verklaring bij aanlevering is dus een overgang vanaf
 * `actief` — niet vanaf "niets".
 */
export const INGEST_BRONSTATUS_HERKOMST: Bronstatus = "actief";

/**
 * Bronstatussen die bij aanlevering verklaard mogen worden.
 *
 * Afgeleid uit de transitietabel, niet handmatig opgesomd: wat niet vanaf
 * `actief` mag, mag hier ook niet. Dat sluit `actief_na_vaststelling`
 * automatisch uit — die waarde is een GEVOLG van een statusovergang
 * (capability `afgeleid`) en hoort niet met de hand gezet te worden.
 */
export const INGEST_BRONSTATUSSEN: Bronstatus[] = BRONSTATUSSEN.filter(
  (b) =>
    b !== INGEST_BRONSTATUS_HERKOMST &&
    magBronstatusOvergaan(INGEST_BRONSTATUS_HERKOMST, b) &&
    vindBronstatusTransitie(INGEST_BRONSTATUS_HERKOMST, b)?.capability !== "afgeleid"
);

export function isGeldigDocumenttype(waarde: unknown): waarde is Documenttype {
  return typeof waarde === "string" && (DOCUMENTTYPEN as string[]).includes(waarde);
}

// ── Documenttype ────────────────────────────────────────────────────────────

export type DocumenttypeUitkomst =
  | { ok: true; documenttype: Documenttype | null }
  | { ok: false; foutcode: string; melding: string };

/**
 * Beoordeelt het aangeleverde documenttype.
 *
 * `verplicht` is bewust een PARAMETER en geen constante. De uploadroute wordt
 * door drie stromen gedeeld: de bibliotheek, een vergaderstuk bij een
 * agendapunt, en een bewijsstuk bij een processtap. Alleen de bibliotheek heeft
 * een formulier waarin de gebruiker een type kán kiezen; de andere twee
 * uploaden vanuit een context waarin niemand die vraag krijgt.
 *
 * Daar automatisch "bijlage" invullen zou een classificatie verzinnen die we
 * niet kennen — precies wat de guardrail "geen schijnzekerheid" verbiedt. Die
 * stromen houden dus `null`, ongewijzigd t.o.v. vóór 0140.
 */
export function beoordeelIngestDocumenttype(
  raw: unknown,
  opties: { verplicht: boolean }
): DocumenttypeUitkomst {
  const waarde = typeof raw === "string" ? raw.trim() : "";
  if (!waarde) {
    if (opties.verplicht) {
      return {
        ok: false,
        foutcode: "documenttype_ontbreekt",
        melding:
          "Kies een documenttype. Zonder type belandt het document in de restgroep " +
          '"Zonder type" en vindt de assistent het minder gericht terug.',
      };
    }
    return { ok: true, documenttype: null };
  }
  if (!isGeldigDocumenttype(waarde)) {
    return {
      ok: false,
      foutcode: "documenttype_ongeldig",
      melding: `Onbekend documenttype "${waarde}".`,
    };
  }
  return { ok: true, documenttype: waarde };
}

// ── Bronstatus ──────────────────────────────────────────────────────────────

export type BronstatusUitkomst =
  | {
      ok: true;
      /** `null` = geen verklaring; de kolom blijft NULL (≡ actief). */
      bronstatus: Bronstatus | null;
      redenVerplicht: boolean;
      ragImpact: boolean;
    }
  | { ok: false; foutcode: string; melding: string };

/**
 * Beoordeelt een bronstatusverklaring bij aanlevering.
 *
 * Retourneert `bronstatus: null` wanneer er niets is verklaard — dan verandert
 * er niets aan het bestaande gedrag. `redenVerplicht` en `ragImpact` komen uit
 * de transitietabel; de aanroeper doet met `redenVerplicht` de redencheck en
 * met `ragImpact` de auditregel.
 *
 * De CAPABILITY-check zit bewust NIET hier: die vraagt een DB-lookup en zou
 * deze module onzuiver maken. De route doet hem, met
 * `VEREISTE_BRONSTATUS_CAPABILITY` als bron van waarheid.
 */
export function beoordeelIngestBronstatus(
  raw: unknown,
  reden: unknown
): BronstatusUitkomst {
  const waarde = typeof raw === "string" ? raw.trim() : "";
  if (!waarde || waarde === INGEST_BRONSTATUS_HERKOMST) {
    // Leeg óf expliciet "actief": beide betekenen "laat de default staan".
    return { ok: true, bronstatus: null, redenVerplicht: false, ragImpact: false };
  }
  if (!(BRONSTATUSSEN as string[]).includes(waarde)) {
    return {
      ok: false,
      foutcode: "bronstatus_ongeldig",
      melding: `Onbekende bronstatus "${waarde}".`,
    };
  }
  const doel = waarde as Bronstatus;
  if (!magBronstatusOvergaan(INGEST_BRONSTATUS_HERKOMST, doel)) {
    return {
      ok: false,
      foutcode: "bronstatus_bij_ingest_ongeldig",
      melding:
        `Bronstatus "${doel}" kan niet bij aanlevering worden verklaard. ` +
        `Toegestaan: ${INGEST_BRONSTATUSSEN.join(", ")}.`,
    };
  }
  const moetReden = bronstatusRedenVerplicht(INGEST_BRONSTATUS_HERKOMST, doel);
  const redenTekst = typeof reden === "string" ? reden.trim() : "";
  if (moetReden && !redenTekst) {
    return {
      ok: false,
      foutcode: "bronstatus_reden_ontbreekt",
      melding:
        "Geef een reden bij de bronstatusverklaring. Die reden landt in het auditlog.",
    };
  }
  return {
    ok: true,
    bronstatus: doel,
    redenVerplicht: moetReden,
    ragImpact: bronstatusRagImpact(INGEST_BRONSTATUS_HERKOMST, doel),
  };
}

/** De capability die de route moet afdwingen bij een bronstatusverklaring. */
export const VEREISTE_BRONSTATUS_CAPABILITY = "documents.bronstatus.change" as const;
