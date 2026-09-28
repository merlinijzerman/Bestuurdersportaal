// ============================================================================
//  #463 fase A — metadatazoeken in de gekoppelde SharePoint-bron (puur).
// ----------------------------------------------------------------------------
//  Geen server-only imports en geen I/O: de route levert de live, met het
//  token van de gebruiker opgehaalde boom aan; deze module beslist alleen
//  welke documenten matchen en of ze aantoonbaar onder de bronroot liggen.
//
//  Zoeken gaat uitsluitend over METADATA: bestandsnaam, mapnaam/-pad en
//  extensie/type. Documentinhoud komt hier niet langs (dat is fase B, achter
//  #413). De zoekterm zelf wordt nergens gelogd; hij kan persoonsgegevens
//  bevatten en is voor diagnose niet nodig.
// ============================================================================
import type { DocumentProjectie, GraphDriveItem } from "@/core/lib/microsoft-sharepoint-graph-core";

export const SHAREPOINT_ZOEK_MIN_TEKENS = 2;
export const SHAREPOINT_ZOEK_MAX_TEKENS = 200;
export const SHAREPOINT_ZOEK_MAX_RESULTATEN = 100;
/** Harde grens op de hele SharePoint-kant van één zoekopdracht (enumeratie
 * inclusief paginering). Daarna faalt de SharePoint-kant met graph_timeout;
 * de portaalresultaten staan los daarvan. */
export const SHAREPOINT_ZOEK_TIMEOUT_MS = 8_000;
/** Plafond op de ouderketen bij de tweede grenscontrole. Ruim boven de
 * rootmapdiepte (8) plus de kinddiepte (10) van de enumeratie. */
const MAX_KETENLENGTE = 64;

export type ZoektermOordeel = { geldig: true; term: string } | { geldig: false; reden: "te_kort" | "te_lang" };

/** Server-side begrenzing van `q`: 2–200 tekens na trimmen. Te lang wordt
 * geweigerd, niet ingekort: stilzwijgend afkappen zou een andere zoekvraag
 * beantwoorden dan de gebruiker stelde. */
export function valideerZoekterm(q: string | null | undefined): ZoektermOordeel {
  const term = (q ?? "").trim();
  if (term.length < SHAREPOINT_ZOEK_MIN_TEKENS) return { geldig: false, reden: "te_kort" };
  if (term.length > SHAREPOINT_ZOEK_MAX_TEKENS) return { geldig: false, reden: "te_lang" };
  return { geldig: true, term };
}

/** Hoofdletter- en accentongevoelig vergelijken ("Notulen" ≈ "notulen",
 * "Coördinatie" ≈ "coordinatie"). */
export function normaliseerZoektekst(tekst: string): string {
  return tekst.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Typenamen waarop een gebruiker naast de extensie kan zoeken. */
const TYPE_ALIASSEN: Record<string, readonly string[]> = {
  pdf: ["pdf"],
  doc: ["word"], docx: ["word"],
  ppt: ["powerpoint"], pptx: ["powerpoint"],
  xls: ["excel"], xlsx: ["excel"],
};

function extensieVan(naam: string): string | null {
  return naam.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] ?? null;
}

function zoekwoorden(term: string): string[] {
  const woorden = normaliseerZoektekst(term)
    .split(/\s+/)
    .map((w) => w.replace(/^\.+(?=[a-z0-9])/, "")) // ".pdf" → "pdf"
    .filter((w) => w.length > 0);
  return [...new Set(woorden)];
}

export type Zoekhit<D> = { document: D; inNaam: boolean };

/**
 * Elk zoekwoord moet ergens voorkomen: in de bestandsnaam, in het volledige
 * mappad (dus ook in een tussenliggende mapnaam — "zoek op map" levert alle
 * documenten in die map en haar submappen), of als extensie/typenaam.
 * Documenten waarvan de NAAM alle woorden bevat komen eerst; binnen die twee
 * groepen blijft de volgorde van de boom (mappad, naam) staan.
 */
export function matchDocumenten<D extends Pick<DocumentProjectie, "naam" | "mappad">>(documenten: readonly D[], term: string): Zoekhit<D>[] {
  const woorden = zoekwoorden(term);
  if (woorden.length === 0) return [];
  const hits: Zoekhit<D>[] = [];
  for (const document of documenten) {
    const naam = normaliseerZoektekst(document.naam);
    const pad = normaliseerZoektekst(document.mappad);
    const extensie = extensieVan(document.naam);
    const typen = extensie ? [extensie, ...(TYPE_ALIASSEN[extensie] ?? [])] : [];
    let inNaam = true;
    let alles = true;
    for (const woord of woorden) {
      const naamHit = naam.includes(woord);
      if (!naamHit) inNaam = false;
      if (!naamHit && !pad.includes(woord) && !typen.includes(woord)) { alles = false; break; }
    }
    if (alles) hits.push({ document, inNaam });
  }
  return [...hits.filter((h) => h.inNaam), ...hits.filter((h) => !h.inNaam)];
}

/**
 * TWEEDE grenscontrole (#463), onafhankelijk van `bouwDocumentboom`: loopt per
 * resultaat opnieuw de ouderketen af over de RUWE Graph-items en eist dat die
 * binnen {@link MAX_KETENLENGTE} stappen, zonder lus, precies het rootitem
 * bereikt, en dat geen schakel een afwijkende drive draagt. Een document dat
 * Microsoft onverwacht buiten de root meelevert — of dat via een ruimer
 * antwoord in de verzameling belandt — valt hier af, ook als de eerste
 * projectie het (door een fout) had doorgelaten.
 */
export function maakRootgrens(items: readonly GraphDriveItem[], driveId: string, rootItemId: string): (itemId: string) => boolean {
  const perId = new Map<string, GraphDriveItem>();
  for (const item of items) if (item.id) perId.set(item.id, item);
  const andereDrive = (item: GraphDriveItem) => Boolean(item.parentReference?.driveId && item.parentReference.driveId !== driveId);
  return (itemId: string) => {
    if (!itemId || itemId === rootItemId) return false;
    const bestand = perId.get(itemId);
    if (!bestand || !bestand.file || bestand.folder || bestand.remoteItem || andereDrive(bestand)) return false;
    const bezocht = new Set<string>([itemId]);
    let ouder = bestand.parentReference?.id ?? null;
    for (let stap = 0; stap < MAX_KETENLENGTE; stap += 1) {
      if (!ouder) return false;
      if (ouder === rootItemId) return true;
      if (bezocht.has(ouder)) return false;
      bezocht.add(ouder);
      const map = perId.get(ouder);
      if (!map || !map.folder || map.remoteItem || andereDrive(map)) return false;
      ouder = map.parentReference?.id ?? null;
    }
    return false;
  };
}

export type ZoekselectieResultaat<D> = {
  resultaten: D[];
  /** Aantal matches binnen de root vóór de limiet van {@link SHAREPOINT_ZOEK_MAX_RESULTATEN}. */
  totaal: number;
  resultatenAfgekapt: boolean;
  /** Matches die de tweede grenscontrole weigerde (alleen voor diagnose). */
  buitenRootGeweigerd: number;
};

export function selecteerZoekresultaten<D extends Pick<DocumentProjectie, "itemId" | "naam" | "mappad">>(
  documenten: readonly D[],
  term: string,
  binnenRoot: (itemId: string) => boolean,
  max: number = SHAREPOINT_ZOEK_MAX_RESULTATEN,
): ZoekselectieResultaat<D> {
  const hits = matchDocumenten(documenten, term);
  const binnen = hits.filter((h) => binnenRoot(h.document.itemId)).map((h) => h.document);
  return {
    resultaten: binnen.slice(0, max),
    totaal: binnen.length,
    resultatenAfgekapt: binnen.length > max,
    buitenRootGeweigerd: hits.length - binnen.length,
  };
}
