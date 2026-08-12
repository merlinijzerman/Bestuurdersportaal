// ============================================================================
//  Statuslabel voor bronnen in de prompt (2026-08-12)
// ----------------------------------------------------------------------------
//  Tot nu toe reisde `documentstatus` alleen mee naar de bronkaart in de UI en
//  NIET naar de prompt (rag.ts maakContext bouwde de kop uit bron + titel +
//  bronsoort). Zodra een niet-vastgesteld stuk de promptset haalt — via modus
//  'besluitvorming'/'alles', via een primair gekozen document, of via de
//  agendapunt-/procesmodus — kan het model dus niet zien dat het om een concept
//  gaat en presenteert het de inhoud als gewone bron.
//
//  Dat is het eigenlijke risico bij het verbreden van de retrieval: niet dat er
//  iets wordt verzonnen (elke uitspraak draagt een [Bron N]-marker), maar
//  VERSIEVERWARRING — een conceptbegroting en een vastgestelde begroting die
//  naast elkaar in de context staan en in het antwoord samensmelten.
//
//  Deze module is de enige plek waar die labeling wordt bepaald. Pure functie,
//  programmatisch toetsbaar (documentstatus-label.sanity.ts).
//
//  Ontwerpkeuze: alleen AFWIJKINGEN krijgen een label. Een vastgesteld/van
//  kracht zijnd stuk met een actieve bronstatus is de norm en blijft kaal — dat
//  houdt de prompt kort en voorkomt dat het model op elk bronlabel gaat wegen.
// ============================================================================

export interface StatuslabelInvoer {
  documentstatus?: string | null;
  bronstatus?: string | null;
  geldig_tot?: string | null;
}

// De statussen die als "geldend" gelden. Bewust een eigen, kleine kopie i.p.v.
// een import uit document-status-transities: die module draagt de volledige
// transitietabel mee en dit is een presentatielaag. Wijkt de lijst daar af, dan
// valt dat op in documentstatus-label.sanity.ts (die de bron-lijst importeert).
const GELDEND = new Set(["vastgesteld", "van_kracht"]);

/**
 * Het statuslabel dat achter de brontitel in de prompt komt te staan, of "" als
 * de bron geen afwijkende status heeft.
 *
 * Volgorde is bewust: documentstatus wint van bronstatus wint van geldigheid.
 * Een conceptstuk dat óók verlopen is, is in de eerste plaats een concept — dat
 * is wat de lezer moet weten voordat hij iets met de inhoud doet.
 */
export function statuslabelVoorBron(
  doc: StatuslabelInvoer,
  peildatum?: string
): string {
  const status = (doc.documentstatus ?? "").trim();

  if (status === "concept") return " [concept — nog niet vastgesteld]";
  if (status === "historisch") return " [historisch — niet meer geldend]";
  if (status === "gearchiveerd") return " [gearchiveerd]";

  // Onbekende/lege status: expliciet als onbepaald labelen in plaats van stil
  // als geldend te behandelen. Geen schijnzekerheid.
  if (status && !GELDEND.has(status)) return ` [status: ${status}]`;

  const bron = (doc.bronstatus ?? "").trim();
  if (bron === "historisch") return " [niet-actuele bron]";
  if (bron === "uitgesloten") return " [uitgesloten als bron]";
  if (bron === "actief_na_vaststelling") return " [nog niet als bron actief]";

  // Geldigheidsvenster verlopen (alleen toetsen als er een peildatum is; zonder
  // peildatum doen we geen uitspraak in plaats van te gokken).
  if (peildatum && doc.geldig_tot && doc.geldig_tot < peildatum) {
    return " [geldigheid verlopen]";
  }

  if (!status) return " [status onbekend]";
  return "";
}

/** Draagt deze bron een afwijkende status? Handig voor tellingen/diagnostiek. */
export function heeftAfwijkendeStatus(
  doc: StatuslabelInvoer,
  peildatum?: string
): boolean {
  return statuslabelVoorBron(doc, peildatum) !== "";
}
