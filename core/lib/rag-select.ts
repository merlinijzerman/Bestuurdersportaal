// ============================================================
//  lib/rag-select.ts — pure selectie-helpers voor RAG-retrieval.
//
//  Geen Supabase-imports, zodat dit zuiver en deterministisch te testen is
//  (zelfde principe als lib/stemming.ts). Wordt door lib/rag.ts gebruikt om
//  een op relevantie gesorteerde lijst chunks terug te knippen tot de set
//  die in de prompt belandt.
// ============================================================

// Minimaal contract dat selecteerChunks nodig heeft. DocumentChunk in
// lib/rag.ts voldoet hieraan; door generiek te werken behoudt de aanroeper
// zijn eigen, rijkere type.
export interface SelecteerbareChunk {
  id: string;
  document_id: string;
  tekst: string;
  rang?: number | null;
}

// Genormaliseerde woordset voor overlap-meting: lowercase, leestekens weg,
// woorden ≤2 tekens eruit (lidwoorden/ruis).
export function woordSet(tekst: string): Set<string> {
  return new Set(
    tekst
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

// Jaccard-similariteit tussen twee woordsets: |doorsnede| / |unie|.
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let doorsnede = 0;
  for (const w of a) if (b.has(w)) doorsnede++;
  const unie = a.size + b.size - doorsnede;
  return unie === 0 ? 0 : doorsnede / unie;
}

// ── T3 — drop-reden-trace op de selectie ────────────────────────────────────
//  De pure selectie kent intern precies waaróm een kandidaat afvalt, maar gaf
//  dat niet terug. Deze trace maakt "opgehaald maar afgevallen" herleidbaar
//  zonder de selectielogica te dupliceren: de publieke selecteerChunks /
//  selecteerMetConstraints delegeren naar de trace-varianten en geven alleen de
//  gekozen set terug (identiek gedrag, bewezen door rag-select.sanity.ts).
//
//  De reden per (niet-gekozen) kandidaat, in poortvolgorde:
//    • quotum — het bron-plafond (maxPerSource/maxPerDocument) was al bereikt.
//    • dedup  — near-duplicate van een reeds gekozen chunk (Jaccard ≥ drempel).
//    • budget — het totaalbudget (maxTotal/maxResults) was vol vóórdat de
//               kandidaat aan de beurt kwam (of hij bleef ongeprobeerd nadat het
//               vol raakte). De hogere-orde reden `weging` (bronsoort-demotie)
//               wordt in rag.ts bovenop deze trace bepaald.
export type SelectieReden = "quotum" | "dedup" | "budget";

/** Trace-uitkomst: de gekozen set + per input-index de afwijzingsreden
 *  (null = geselecteerd). `redenen` is even lang als de input en op input-
 *  positie geïndexeerd, zodat de aanroeper kandidaten 1-op-1 kan terugmappen. */
export interface SelectieTrace<T> {
  gekozen: T[];
  redenen: (SelectieReden | null)[];
}

// Knipt een (op relevantie gesorteerde) lijst chunks terug tot de set die in
// de prompt belandt. Twee criteria zodat over-fetchen zin heeft:
//   • maxPerDocument — voorkomt dat één document de hele context vult.
//   • dedup — aangrenzende chunks delen door de overlap (zie maakChunks) vaak
//     tekst; bijna-identieke chunks voegen geen context toe.
// Behoudt de inkomende volgorde (rang-volgorde). Puur & deterministisch.
export function selecteerChunks<T extends SelecteerbareChunk>(
  chunks: T[],
  maxResults = 8,
  maxPerDocument = 3,
  dedupDrempel = 0.85
): T[] {
  return selecteerChunksMetTrace(chunks, maxResults, maxPerDocument, dedupDrempel).gekozen;
}

// Trace-variant van selecteerChunks. Gelijk gedrag (de `break`-bij-vol is een
// `continue` + budget-markering: gekozen is identiek, want na `vol` wordt nooit
// meer iets toegevoegd), maar registreert per index waarom een chunk afviel.
export function selecteerChunksMetTrace<T extends SelecteerbareChunk>(
  chunks: T[],
  maxResults = 8,
  maxPerDocument = 3,
  dedupDrempel = 0.85
): SelectieTrace<T> {
  const gekozen: T[] = [];
  const redenen: (SelectieReden | null)[] = new Array(chunks.length).fill(null);
  const perDoc = new Map<string, number>();
  const woordSets: Set<string>[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (gekozen.length >= maxResults) {
      redenen[i] = "budget";
      continue;
    }
    const aantalDoc = perDoc.get(chunk.document_id) ?? 0;
    if (aantalDoc >= maxPerDocument) {
      redenen[i] = "quotum";
      continue;
    }
    const ws = woordSet(chunk.tekst);
    if (woordSets.some((b) => jaccard(ws, b) >= dedupDrempel)) {
      redenen[i] = "dedup";
      continue;
    }
    gekozen.push(chunk);
    perDoc.set(chunk.document_id, aantalDoc + 1);
    woordSets.push(ws);
  }

  return { gekozen, redenen };
}

// ── T1 — Representatie-constraintlaag (flag REPRESENTATIE_CONSTRAINTS) ────────
//  De gepoolde ranking + vaste budget-afkap (selecteerChunks) kan een hele
//  bronsoort onder het budget drukken (partnerbegrip-casus: 0 fondsbronnen onder
//  een generieke ranking). Deze laag garandeert deterministisch een minimum-
//  representatie per bibliotheek/bron VÓÓR de budget-afkap. Blijft puur & zonder
//  Supabase; de constraints worden elders afgeleid (weeg-bronsoort.constraintsVoorProfiel).
//
//  Conventie (spiegelt weeg-bronsoort.weegBronsoort): bibliotheek === "generiek"
//  is de generieke groep; al het overige telt als fonds.

/** Gegarandeerde minima + plafonds voor de selectie. Alle minima 0 =
 *  gedragsequivalent aan selecteerChunks (huidig gedrag). */
export interface RepresentatieConstraints {
  /** Minimum aantal fonds-chunks (bibliotheek !== "generiek"). */
  fondsMin: number;
  /** Minimum aantal generieke chunks (bibliotheek === "generiek"). */
  generiekMin: number;
  /** Minimum per afzonderlijke bron/document. T1: voorbereid (default 0, inert);
   *  toepassing in de vergelijkmodus (T5). */
  perSourceMin: number;
  /** Plafond per bron/document (≡ maxPerDocument in selecteerChunks). */
  maxPerSource: number;
  /** Budget-afkap: totaal aantal chunks dat de prompt in gaat (≡ maxResults). */
  maxTotal: number;
}

// De "generiek"-groep is expliciet die label-waarde; al het andere = fonds. Zo
// vallen NULL/onbekende bibliotheek-waarden aan de fonds-kant (het portaal is
// fondsgericht), consistent met weegBronsoort/prioriteit.
function isGeneriekeLib(bibliotheek: string | null | undefined): boolean {
  return bibliotheek === "generiek";
}

/**
 * Selecteer chunks met gegarandeerde representatie-minima vóór de budget-afkap.
 * Puur & deterministisch, faalt NOOIT: is een minimum niet haalbaar (te weinig
 * kandidaten of alles dedup/maxPerSource-geblokkeerd), dan gaat de selectie door
 * met wat er is — geen exception (signalering volgt in T3).
 *
 * Bewerkingsvolgorde binnen deze functie:
 *   1) reserveer slots tot de minima (fonds/generiek, daarna per-bron) gehaald
 *      zijn, in rangvolgorde binnen elke groep;
 *   2) vul het resterende budget (maxTotal) op globale rang;
 *   in beide fasen gelden maxPerSource én dedup (Jaccard ≥ dedupDrempel).
 * De uitvoer behoudt de inkomende (rang-/weging-)volgorde.
 *
 * `bibliotheekVan` ontkoppelt de helper van de chunk-vorm (DocumentChunk nest
 * bibliotheek onder `documenten`), net als weegBronsoort.
 */
export function selecteerMetConstraints<T extends SelecteerbareChunk>(
  chunks: T[],
  constraints: RepresentatieConstraints,
  bibliotheekVan: (chunk: T) => string | null | undefined,
  dedupDrempel = 0.85
): T[] {
  return selecteerMetConstraintsMetTrace(chunks, constraints, bibliotheekVan, dedupDrempel).gekozen;
}

// Trace-variant van selecteerMetConstraints (T3). Identieke selectie; registreert
// daarnaast per index de afwijzingsreden. Attributie: `probeerToevoegen` schrijft
// de reden bij elke MISLUKTE poging (laatste poging wint — de fill-fase, fase 2,
// probeert in rangvolgorde tot het budget vol is). quotum/dedup zijn structureel
// stabiel (een op maxPerSource/dedup afgewezen kandidaat blijft dat), dus een
// vroege reden overschrijft niet ten onrechte. Een nooit-geprobeerde, niet-gekozen
// index kan alleen bestaan doordat fase 2 stopte toen het budget vol was → default
// `budget`.
export function selecteerMetConstraintsMetTrace<T extends SelecteerbareChunk>(
  chunks: T[],
  constraints: RepresentatieConstraints,
  bibliotheekVan: (chunk: T) => string | null | undefined,
  dedupDrempel = 0.85
): SelectieTrace<T> {
  const { fondsMin, generiekMin, perSourceMin, maxPerSource, maxTotal } = constraints;

  const gekozen = new Set<number>(); // indices in `chunks`
  const perDoc = new Map<string, number>();
  const woordSets: Set<string>[] = [];
  const redenen: (SelectieReden | null)[] = new Array(chunks.length).fill(null);

  // Probeer de chunk op index i toe te voegen. Respecteert de budget-afkap,
  // maxPerSource en dedup — exact dezelfde poortvolgorde als selecteerChunks,
  // zodat de dedup-uitkomst identiek is (een op maxPerSource afgewezen chunk
  // belandt niet in woordSets). True = toegevoegd. Legt bij afwijzing de reden vast.
  const probeerToevoegen = (i: number): boolean => {
    if (gekozen.size >= maxTotal) {
      if (!gekozen.has(i)) redenen[i] = "budget";
      return false;
    }
    if (gekozen.has(i)) return false;
    const chunk = chunks[i];
    const aantalDoc = perDoc.get(chunk.document_id) ?? 0;
    if (aantalDoc >= maxPerSource) {
      redenen[i] = "quotum";
      return false;
    }
    const ws = woordSet(chunk.tekst);
    if (woordSets.some((b) => jaccard(ws, b) >= dedupDrempel)) {
      redenen[i] = "dedup";
      return false;
    }
    gekozen.add(i);
    perDoc.set(chunk.document_id, aantalDoc + 1);
    woordSets.push(ws);
    return true;
  };

  // Reserveer tot `doel` chunks die aan `predicate` voldoen zijn gekozen. Telt
  // reeds-gekozen chunks (uit een vorige reserveringsronde) mee; loopt in
  // rangvolgorde. Stopt zodra het doel of de budget-afkap is bereikt.
  const reserveer = (predicate: (chunk: T) => boolean, doel: number): void => {
    if (doel <= 0) return;
    let gehaald = 0;
    for (const i of gekozen) if (predicate(chunks[i])) gehaald++;
    for (let i = 0; i < chunks.length && gehaald < doel && gekozen.size < maxTotal; i++) {
      if (gekozen.has(i)) continue;
      if (!predicate(chunks[i])) continue;
      if (probeerToevoegen(i)) gehaald++;
    }
  };

  // 1a) representatie-minima per bibliotheek (fonds vóór generiek: het portaal is
  //     fondsgericht, dus bij krap budget wint de fonds-verplichting).
  reserveer((c) => !isGeneriekeLib(bibliotheekVan(c)), fondsMin);
  reserveer((c) => isGeneriekeLib(bibliotheekVan(c)), generiekMin);

  // 1b) per-bron minimum (T5-voorbereiding; perSourceMin=0 → volledig inert).
  //     Bronnen in volgorde van eerste voorkomen (= rang), zodat de reservering
  //     deterministisch en rang-geordend is.
  if (perSourceMin > 0) {
    const gezien = new Set<string>();
    for (let i = 0; i < chunks.length; i++) {
      const docId = chunks[i].document_id;
      if (gezien.has(docId)) continue;
      gezien.add(docId);
      reserveer((c) => c.document_id === docId, perSourceMin);
    }
  }

  // 2) vul het resterende budget op globale rang.
  for (let i = 0; i < chunks.length && gekozen.size < maxTotal; i++) {
    probeerToevoegen(i);
  }

  // Reden-normalisatie: gekozen indices dragen geen reden; een niet-gekozen index
  // zonder reden bleef ongeprobeerd nadat het budget vol raakte → `budget`.
  for (let i = 0; i < chunks.length; i++) {
    if (gekozen.has(i)) redenen[i] = null;
    else if (redenen[i] === null) redenen[i] = "budget";
  }

  // Uitvoer in inkomende (rang-/weging-)volgorde.
  const uit = [...gekozen].sort((a, b) => a - b).map((i) => chunks[i]);
  return { gekozen: uit, redenen };
}
