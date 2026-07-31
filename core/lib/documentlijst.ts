// ============================================================================
//  documentlijst — de ordening van de documentlijst bij `bronoverzicht`
// ----------------------------------------------------------------------------
//  Bij een vraag als "welke stukken hebben we over de compensatieregeling?" ZIJN
//  de documenten het antwoord. De weergave promoveert ze dan uit het
//  onderbouwingspaneel naar het antwoord zelf (besluit 0099). Wat die lijst toont
//  moet dan wel reproduceerbaar zijn: dezelfde bronnenset hoort altijd dezelfde
//  volgorde te geven.
//
//  Daarom is de ordening een PURE functie met een TOTALE ordening — geen
//  modelbeslissing, geen promptinstructie, en geen vergelijking die van locale of
//  omgeving afhangt. Sorteren gebeurt op kale stringvergelijking; `localeCompare`
//  staat er bewust niet in, want de ICU-collatie verschilt per Node-build en zou
//  het resultaat onreproduceerbaar maken.
//
//  Laagscheiding: dit is `core/`, dus geen React en geen app-types. De invoer is
//  structureel getypeerd (`DocumentbronInvoer`), zodat `BronVerwijzing` uit
//  rag.ts én het `Bron`-type uit de renderer er zonder conversie in passen.
// ============================================================================

import { DOCUMENTTYPEN, DOCUMENTTYPE_LABEL, type Documenttype } from "./document-metadata";
import { ACTUELE_BRON_STATUSSEN } from "./document-status-transities";

/** Structurele invoer: elke `Bron`/`BronVerwijzing` voldoet hieraan. */
export interface DocumentbronInvoer {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  documentstatus?: string | null;
  documentdatum?: string | null;
  documenttype?: string | null;
  bestandstype?: string | null;
  // Voor het actualiteitsoordeel: een stuk kan `van_kracht` zijn en tóch niet
  // actueel, doordat de bron historisch is of de geldigheid is verlopen. Zelfde
  // drieslag als `zouActueelZijn()` in rag.ts.
  bronstatus?: string | null;
  geldig_tot?: string | null;
}

/** Eén document in de lijst, met de treffer waaraan het is opgehangen. */
export interface Documentregel extends DocumentbronInvoer {
  /**
   * Nummers van ÁLLE bronvermeldingen die naar dit document wijzen (1-gebaseerd,
   * oplopend). Na ontdubbeling wijzen meerdere `[Bron N]`-pills naar dezelfde
   * kaart; de weergave hangt er een anker per nummer aan, zodat een klik op elke
   * pill nog steeds op de juiste kaart landt.
   */
  bronnummers: number[];
  /** Het laagste (= best gerangschikte) bronnummer. */
  bronnummer: number;
}

/**
 * Is dit een DOCUMENT-bron? De besluitregistratie levert `BronVerwijzing`s met
 * `bron: "Decision Object"` en een `decision_id` in het `document_id`-veld. Die
 * horen niet in een documentlijst: ze zijn geen document, hun status komt uit een
 * ander domein, en hun id zou de document-scope laten falen op `niet_gevonden`.
 * Ze blijven zichtbaar als bronkaart in het onderbouwingspaneel.
 */
export function isDocumentbron(bron: DocumentbronInvoer): boolean {
  return bron.bron !== "Decision Object";
}

export interface Documentgroep {
  /** `documenttype`-waarde, of `"onbekend"` voor de restgroep. */
  sleutel: string;
  label: string;
  documenten: Documentregel[];
}

/** Label voor documenten waarvan het type nog niet is vastgelegd. */
export const ONBEKEND_TYPE_LABEL = "Type nog niet vastgelegd";
const ONBEKEND_TYPE_SLEUTEL = "onbekend";

/** Groepsvolgorde: de canonieke constante, met de restgroep altijd achteraan. */
const TYPE_VOLGORDE = new Map<string, number>(
  DOCUMENTTYPEN.map((t, i) => [t as string, i])
);

function groepsRang(sleutel: string): number {
  const canoniek = TYPE_VOLGORDE.get(sleutel);
  if (canoniek !== undefined) return canoniek;
  // De restgroep staat áltijd onderaan — óók onder een waarde die buiten de elf
  // toegestane valt (kan alleen na een schemawijziging). Zonder dit onderscheid
  // zouden beide dezelfde rang krijgen en zou de alfabetische tiebreak
  // "onbekend" vóór bijvoorbeeld "verzonnen" zetten.
  return sleutel === ONBEKEND_TYPE_SLEUTEL
    ? Number.MAX_SAFE_INTEGER
    : Number.MAX_SAFE_INTEGER - 1;
}

function labelVoor(sleutel: string): string {
  if (sleutel === ONBEKEND_TYPE_SLEUTEL) return ONBEKEND_TYPE_LABEL;
  return (
    (DOCUMENTTYPE_LABEL as Record<string, string>)[sleutel] ??
    // Een waarde buiten de elf toegestane (kan alleen na een schemawijziging):
    // toon hem letterlijk in plaats van hem te verstoppen.
    sleutel
  );
}

/**
 * Ontdubbelt op `document_id` en groepeert op `documenttype`.
 *
 * - **Ontdubbelen** is nodig omdat één document vaak meerdere chunks levert en
 *   dus meerdere bronvermeldingen. De EERSTE treffer wint: de bronnenlijst komt
 *   in rangschikkingsvolgorde binnen, dus dat is de best scorende passage — en
 *   die hoort als trefferfragment bij de kaart.
 * - **Groepsvolgorde** volgt `DOCUMENTTYPEN`; documenten zonder (herkend) type
 *   komen in één restgroep, altijd als laatste.
 * - **Binnen een groep**: `documentdatum` aflopend, documenten zonder datum
 *   onderaan, daarna titel en `document_id` als tiebreak. Die laatste twee maken
 *   de ordening TOTAAL — zonder die stap zouden twee stukken met dezelfde datum
 *   van sorteerimplementatie kunnen wisselen.
 *
 * `documentdatum` wordt lexicografisch vergeleken. Dat mag omdat de kolom een
 * `date` is en dus als `JJJJ-MM-DD` binnenkomt; in dat formaat is de
 * stringvolgorde gelijk aan de chronologische.
 */
export function groepeerDocumentbronnen(
  bronnen: readonly DocumentbronInvoer[]
): Documentgroep[] {
  const perDocument = new Map<string, Documentregel>();
  bronnen.forEach((b, i) => {
    if (!b || typeof b.document_id !== "string" || b.document_id.length === 0) return;
    if (!isDocumentbron(b)) return;
    const bestaand = perDocument.get(b.document_id);
    if (bestaand) {
      // Zelfde document, andere treffer: het bronnummer erbij, maar het fragment
      // en de metadata van de EERSTE (best gerangschikte) treffer behouden.
      bestaand.bronnummers.push(i + 1);
      return;
    }
    perDocument.set(b.document_id, { ...b, bronnummers: [i + 1], bronnummer: i + 1 });
  });

  const groepen = new Map<string, Documentregel[]>();
  for (const regel of perDocument.values()) {
    const type = regel.documenttype ?? "";
    const sleutel =
      type && TYPE_VOLGORDE.has(type) ? type : type || ONBEKEND_TYPE_SLEUTEL;
    const lijst = groepen.get(sleutel);
    if (lijst) lijst.push(regel);
    else groepen.set(sleutel, [regel]);
  }

  return [...groepen.entries()]
    .map(([sleutel, documenten]) => ({
      sleutel,
      label: labelVoor(sleutel),
      documenten: documenten.sort(vergelijkDocumenten),
    }))
    .sort((a, b) => {
      const rang = groepsRang(a.sleutel) - groepsRang(b.sleutel);
      if (rang !== 0) return rang;
      // Twee groepen buiten de canonieke lijst: alfabetisch, zodat ook dit
      // randgeval een vaste volgorde heeft.
      return a.sleutel < b.sleutel ? -1 : a.sleutel > b.sleutel ? 1 : 0;
    });
}

function vergelijkDocumenten(a: Documentregel, b: Documentregel): number {
  const da = a.documentdatum ?? "";
  const db = b.documentdatum ?? "";
  // Zonder datum onderaan, ongeacht de sorteerrichting van de rest.
  if (!da && db) return 1;
  if (da && !db) return -1;
  if (da !== db) return da < db ? 1 : -1; // aflopend
  if (a.titel !== b.titel) return a.titel < b.titel ? -1 : 1;
  return a.document_id < b.document_id ? -1 : a.document_id > b.document_id ? 1 : 0;
}

// ── Filteren is weergave, geen retrieval ────────────────────────────────────
// De chips werken UITSLUITEND op de al opgehaalde set. Ze doen geen nieuwe
// zoekopdracht en veranderen niets aan de filtering vóór retrieval; wat je
// wegfiltert was al opgehaald en telt nog steeds mee in "n van m".

export type Documentfilter = "alle" | "vastgesteld";

/**
 * Is dit stuk aantoonbaar een ACTUELE, vastgestelde grondslag?
 *
 * Dezelfde drieslag als `zouActueelZijn()` in rag.ts en als het statusoordeel op
 * de pill: documentstatus in `ACTUELE_BRON_STATUSSEN`, bronstatus actief (of
 * afwezig), en de geldigheid niet verstreken. Een `van_kracht`-stuk waarvan de
 * bron historisch is of `geldig_tot` gepasseerd, is géén actuele grondslag —
 * anders belooft het filter iets anders dan het levert.
 */
export function isVastgesteld(regel: DocumentbronInvoer, vandaag?: string): boolean {
  if (
    !regel.documentstatus ||
    !(ACTUELE_BRON_STATUSSEN as string[]).includes(regel.documentstatus)
  ) {
    return false;
  }
  if (regel.bronstatus && regel.bronstatus !== "actief") return false;
  if (regel.geldig_tot) {
    const peil = vandaag ?? new Date().toISOString().slice(0, 10);
    if (regel.geldig_tot < peil) return false;
  }
  return true;
}

/** Ontbreekt de status, dan is er niets te oordelen — dat is iets anders dan "niet vastgesteld". */
export function statusOnbekend(regel: DocumentbronInvoer): boolean {
  return !regel.documentstatus;
}

/**
 * Past het filter toe op gegroepeerde documenten. Groepen die daarna leeg zijn
 * verdwijnen; de telling gebeurt op documenten, niet op groepen.
 *
 * `zonderStatus` telt de documenten waarvan de status niet is meegeleverd (dat
 * gebeurt op het fallback-cascade-pad). Die vallen buiten "alleen vastgesteld" —
 * maar stil wegfilteren zou suggereren dat ze níét vastgesteld zijn, en dat weten
 * we juist niet. De weergave benoemt het aantal daarom apart.
 */
export function pasFilterToe(
  groepen: readonly Documentgroep[],
  filter: Documentfilter,
  vandaag?: string
): {
  groepen: Documentgroep[];
  zichtbaar: number;
  totaal: number;
  zonderStatus: number;
} {
  const alle = groepen.flatMap((g) => g.documenten);
  const totaal = alle.length;
  const zonderStatus = alle.filter(statusOnbekend).length;
  if (filter === "alle") {
    return { groepen: [...groepen], zichtbaar: totaal, totaal, zonderStatus: 0 };
  }
  const gefilterd = groepen
    .map((g) => ({ ...g, documenten: g.documenten.filter((d) => isVastgesteld(d, vandaag)) }))
    .filter((g) => g.documenten.length > 0);
  const zichtbaar = gefilterd.reduce((n, g) => n + g.documenten.length, 0);
  return { groepen: gefilterd, zichtbaar, totaal, zonderStatus };
}

/** Alle document-id's in de (gefilterde) lijst, voor "Vraag over deze N documenten". */
export function documentIdsVan(groepen: readonly Documentgroep[]): string[] {
  return groepen.flatMap((g) => g.documenten.map((d) => d.document_id));
}

/** Documenttype-label voor één regel, of null als het niet is vastgelegd. */
export function documenttypeLabel(regel: DocumentbronInvoer): string | null {
  const t = regel.documenttype;
  if (!t) return null;
  return (DOCUMENTTYPE_LABEL as Record<Documenttype, string>)[t as Documenttype] ?? t;
}
