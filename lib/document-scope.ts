// ============================================================================
// Document-scope validatie — increment 1 (single-document strict scope)
// ----------------------------------------------------------------------------
// Pure beslislogica voor de server-side validatie van een documentscope (§7 van
// het ontwerp "AI-vragen over een specifiek document"). Bewust DB-vrij en zuiver
// testbaar (zie lib/document-scope.sanity.ts): de chat-route haalt de
// documentrijen op (RLS doet de fonds-isolatie) en geeft ze hier door.
//
// Security: een gemanipuleerde document_id van een ANDER fonds wordt door RLS
// niet teruggegeven, valt dus buiten `gevonden`, en wordt hier afgewezen met
// "niet_gevonden" — nooit een stille terugval naar de hele bibliotheek.
// Generieke (gedeelde) documenten zijn wél toegestaan: dat is de RLS-toegangs-
// grens die de gebruiker tóch al heeft (bewuste keuze, zie HANDOVER 10-6-2026).
// ============================================================================

/** Documentrij zoals de chat-route die ophaalt (na RLS), aangevuld met chunk-presentie. */
export type ScopeDocumentRij = {
  id: string;
  titel: string;
  bron: string;
  actief: boolean;
  geindexeerd: boolean;
  gepubliceerd: string | null;
  aangemaakt: string | null;
  /** Of het document ten minste één chunk heeft (doorzoekbaar gemaakt). */
  heeft_chunks: boolean;
};

export type ScopeFoutcode =
  | "geen_ids"
  | "niet_gevonden"
  | "gedeactiveerd"
  | "niet_geindexeerd";

export type ScopeValidatie =
  | { ok: true; documenten: ScopeDocumentRij[] }
  | { ok: false; foutcode: ScopeFoutcode; melding: string; document_id?: string };

/**
 * Valideer een gevraagde documentscope tegen de (via RLS opgehaalde) rijen.
 *
 * @param gevraagdeIds  De door de client meegestuurde document_id's.
 * @param gevonden      De documentrijen die de server (onder RLS) terugkreeg.
 * @returns ok + documenten in de volgorde van `gevraagdeIds`, of een concrete,
 *          gesanitiseerde foutmelding bij de eerste die faalt.
 */
export function valideerScope(
  gevraagdeIds: string[],
  gevonden: ScopeDocumentRij[]
): ScopeValidatie {
  const ids = [...new Set(gevraagdeIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) {
    return {
      ok: false,
      foutcode: "geen_ids",
      melding: "Er is geen geldig document gekozen om de vraag toe te spitsen.",
    };
  }

  const perId = new Map(gevonden.map((d) => [d.id, d]));
  const documenten: ScopeDocumentRij[] = [];

  for (const id of ids) {
    const doc = perId.get(id);

    // Bestaat niet / geen toegang (RLS filterde het weg — bv. ander fonds).
    if (!doc) {
      return {
        ok: false,
        foutcode: "niet_gevonden",
        document_id: id,
        melding:
          "Het gekozen document is niet gevonden of u heeft er geen toegang toe. Kies een document uit uw eigen bibliotheek.",
      };
    }

    // Gedeactiveerd of vervangen.
    if (!doc.actief) {
      return {
        ok: false,
        foutcode: "gedeactiveerd",
        document_id: id,
        melding: `Het document «${doc.titel}» is gedeactiveerd of vervangen en kan niet meer worden bevraagd.`,
      };
    }

    // Niet geïndexeerd / geen doorzoekbare tekst (gescand PDF of extractie mislukt).
    if (!doc.geindexeerd || !doc.heeft_chunks) {
      return {
        ok: false,
        foutcode: "niet_geindexeerd",
        document_id: id,
        melding:
          `Het document «${doc.titel}» is nog niet doorzoekbaar gemaakt. Mogelijk is het een gescand ` +
          `PDF zonder tekstlaag of is de tekstextractie mislukt. Laat het document opnieuw indexeren/` +
          `extraheren en probeer het daarna opnieuw.`,
      };
    }

    documenten.push(doc);
  }

  return { ok: true, documenten };
}
