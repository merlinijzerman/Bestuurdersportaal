// #462 PR-4 — pure kandidaatselectie voor een expliciet gekozen SharePoint-map.
// Geen Graph- of database-imports: de live listing levert de serververtrouwde
// documenten; deze kern begrenst en rangschikt ze deterministisch op de vraag.

export const SHAREPOINT_MAP_MAX_KANDIDATEN = 25;
export const SHAREPOINT_MAP_MAX_DOCUMENTEN = 6;
export const SHAREPOINT_MAP_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const SHAREPOINT_MAP_AI_TYPES = new Set(["pdf", "docx", "pptx", "xlsx"]);

export type MapDocumentKandidaat = {
  ref: string;
  naam: string;
  bestandstype: string | null;
  grootte: number | null;
  gewijzigdOp: string | null;
  mappad: string;
};

export type SharePointMapSelectie = {
  documenten: MapDocumentKandidaat[];
  totaalOnderMap: number;
  ondersteundOnderMap: number;
  kandidatenBehandeld: number;
  afgekapt: boolean;
};

const STOPWOORDEN = new Set([
  "aan", "als", "bij", "de", "deze", "dit", "door", "een", "en", "geef",
  "het", "in", "is", "map", "met", "noem", "of", "om", "op", "over",
  "samen", "te", "uit", "van", "vat", "voor", "wat", "welke",
]);

function normaliseer(waarde: string): string {
  return waarde
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("nl-NL");
}

function vraagtermen(vraag: string): string[] {
  return [...new Set((normaliseer(vraag).match(/[a-z0-9]{2,}/g) ?? [])
    .filter((term) => !STOPWOORDEN.has(term)))];
}

function isOnderMap(mappad: string, gekozenMapPad: string): boolean {
  return mappad === gekozenMapPad || mappad.startsWith(`${gekozenMapPad}/`);
}

function score(document: MapDocumentKandidaat, termen: readonly string[]): number {
  const naam = normaliseer(document.naam);
  const pad = normaliseer(document.mappad);
  return termen.reduce((totaal, term) => {
    const inNaam = naam.includes(term) ? 5 : 0;
    const inPad = pad.includes(term) ? 2 : 0;
    return totaal + inNaam + inPad;
  }, 0);
}

/** Rangschikt een reeds server-side afgebakende set, bijvoorbeeld de vereniging
 * van losse agendadocumenten en documenten uit meerdere gekoppelde mappen. */
export function selecteerSharePointDocumentKandidaten(
  documenten: readonly MapDocumentKandidaat[],
  vraag: string,
  grenzen: { maxKandidaten?: number; maxDocumenten?: number } = {}
): SharePointMapSelectie {
  const uniek = [...new Map(documenten.map((document) => [document.ref, document])).values()];
  const ondersteund = uniek.filter((document) =>
    !!document.bestandstype &&
    SHAREPOINT_MAP_AI_TYPES.has(document.bestandstype) &&
    (document.grootte === null || document.grootte <= SHAREPOINT_MAP_MAX_DOCUMENT_BYTES)
  );
  const termen = vraagtermen(vraag);
  const gerangschikt = ondersteund
    .map((document) => ({
      document,
      score: score(document, termen),
      gewijzigd: document.gewijzigdOp ? Date.parse(document.gewijzigdOp) : 0,
    }))
    .sort((a, b) =>
      b.score - a.score ||
      b.gewijzigd - a.gewijzigd ||
      a.document.mappad.localeCompare(b.document.mappad, "nl") ||
      a.document.naam.localeCompare(b.document.naam, "nl") ||
      a.document.ref.localeCompare(b.document.ref)
    );
  const maxKandidaten = Math.max(1, Math.min(
    SHAREPOINT_MAP_MAX_KANDIDATEN,
    Math.floor(grenzen.maxKandidaten ?? SHAREPOINT_MAP_MAX_KANDIDATEN)
  ));
  const maxDocumenten = Math.max(1, Math.min(
    SHAREPOINT_MAP_MAX_DOCUMENTEN,
    Math.floor(grenzen.maxDocumenten ?? SHAREPOINT_MAP_MAX_DOCUMENTEN)
  ));
  const kandidaten = gerangschikt.slice(0, maxKandidaten);
  const geselecteerd = kandidaten.slice(0, maxDocumenten).map((x) => x.document);
  return {
    documenten: geselecteerd,
    totaalOnderMap: uniek.length,
    ondersteundOnderMap: ondersteund.length,
    kandidatenBehandeld: kandidaten.length,
    afgekapt: ondersteund.length > geselecteerd.length,
  };
}

/**
 * Rangschikt eerst de volledige live zichtbare set onder de map. Pas daarna
 * gelden de twee grenzen. Hierdoor is de Graph-/arrayvolgorde nooit de reden
 * dat juist de eerste zes documenten worden gebruikt.
 */
export function selecteerSharePointMapDocumenten(
  documenten: readonly MapDocumentKandidaat[],
  gekozenMapPad: string,
  vraag: string,
  grenzen: { maxKandidaten?: number; maxDocumenten?: number } = {}
): SharePointMapSelectie {
  const onderMap = documenten.filter((document) => isOnderMap(document.mappad, gekozenMapPad));
  return selecteerSharePointDocumentKandidaten(onderMap, vraag, grenzen);
}
