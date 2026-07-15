// ============================================================================
//  lib/parent-context.ts — parent-retrieval / small-to-big (R1.6).
// ----------------------------------------------------------------------------
//  Doel (RAG-review B5): retrieven op de kleine, precieze chunk maar aan het
//  model de omliggende STRUCTUUR-UNIT aanleveren (het hele artikel/de paragraaf
//  i.p.v. één fragment). Kleine chunks houden de retrieval-precisie; de bredere
//  passage geeft het antwoord meer volledige context ("wat zegt artikel X").
//
//  CITATIE BLIJFT PRECIES: de bronvermelding/locatie blijft wijzen naar de
//  oorspronkelijke TREFFER-chunk; alleen de AANGELEVERDE passage wordt het
//  samengevoegde blok (chunk.aangeleverde_passage). maxPerDoc telt op treffers,
//  niet op siblings.
//
//  TENANT-DISCIPLINE: de sibling-fetch loopt via de directe .from()-route (de RPC
//  levert structuur_label/-index niet). Die route past de published/review-verval-
//  poort voor generieke chunks NIET toe — daarom draait handhaafFondsdiscipline
//  OOK op de opgehaalde siblings (dragend, niet enkel defense-in-depth; besluit
//  0045). RLS blijft primair (anon-key).
//
//  De merge-/selectielogica is puur en los testbaar (lib/parent-context.sanity.ts);
//  alleen de fetch-orchestrator raakt Supabase.
// ============================================================================

import { createServerSupabase } from "./supabase-server";
import { handhaafFondsdiscipline, type DocumentChunk } from "./rag";

// Caps als constanten (motivatie in commentaar). Per structuur-unit een plafond
// zodat één zeer lang artikel de context niet opslokt; een totaalplafond zodat de
// som over alle treffers het promptbudget niet laat ontploffen. Bij overschrijding
// van de per-unit-cap valt die treffer terug op de kale chunk; bij het bereiken
// van het totaalplafond worden verdere treffers niet meer uitgebreid.
//   ~4.000 tekens ≈ een ruime pagina/artikel; ~25.000 tekens ≈ het contextbudget
//   dat we maximaal aan bron-passages besteden (vergelijk CHUNK_BUDGET × chunk).
export const PARENT_PER_UNIT_CAP = 4000;
export const PARENT_TOTAAL_CAP = 25000;

// Structuur-units waarvoor we op structuur_label bijhalen (de hele eenheid). Voor
// 'tekst'/'kop'/onbekend gebruiken we een chunk_index-venster ±1 (geen betrouwbaar
// label). Spiegelt de StructuurType-domeinwaarden uit lib/chunking.ts.
export const STRUCTUUR_UNITS = new Set(["artikel", "paragraaf", "besluit", "definitie", "tabel"]);

// Bovengrens op de te herstellen overlap tussen twee opeenvolgende chunks. De
// chunk-overlap is ~100 tekens (≈16 woorden, lib/chunking.ts); ruim hierboven.
const MAX_OVERLAP_TEKENS = 300;

// Sibling-fetch-plafond. Schaalt mee met het aantal betrokken documenten zodat
// één groot document de siblings van de andere treffers niet wegdrukt (een vlak
// globaal LIMIT zou, geordend op document_id, de láátste documenten afkappen).
// Ondergrens = ruim voor één groot document; harde bovengrens tegen ontsporing.
const SIBLING_FETCH_PER_DOC = 1500;
const SIBLING_FETCH_MIN = 5000;
const SIBLING_FETCH_MAX = 20000;

// Sibling-vorm: DocumentChunk + de structuurvelden die de RPC niet levert maar de
// directe select wél (voor sibling-scoping).
export interface SiblingRij extends DocumentChunk {
  structuur_type: string | null;
  structuur_label: string | null;
}

// ── Zuivere kern ─────────────────────────────────────────────────────────────

// Verwijdert de overlap-duplicatie: chunk B begint (door de chunking-overlap) met
// een herhaling van de staart van chunk A. Vindt de langste suffix van `vorige`
// die exact het begin van `huidige` is (begrensd) en knipt die van `huidige`.
export function verwijderOverlap(vorige: string, huidige: string): string {
  const max = Math.min(vorige.length, huidige.length, MAX_OVERLAP_TEKENS);
  for (let L = max; L > 0; L--) {
    if (vorige.slice(-L) === huidige.slice(0, L)) return huidige.slice(L);
  }
  return huidige;
}

// Voegt sibling-chunks samen in LEESVOLGORDE (chunk_index oplopend), met overlap-
// dedup tussen opeenvolgende stukken. Overschrijdt het resultaat `perUnitCap`, dan
// null → de caller valt terug op de kale treffer-chunk. Puur & deterministisch.
export function voegSiblingsSamen(
  siblings: { chunk_index: number; tekst: string }[],
  perUnitCap: number = PARENT_PER_UNIT_CAP
): string | null {
  if (siblings.length === 0) return null;
  const gesorteerd = [...siblings].sort((a, b) => a.chunk_index - b.chunk_index);
  let uit = gesorteerd[0].tekst.trim();
  for (let i = 1; i < gesorteerd.length; i++) {
    const stuk = verwijderOverlap(uit, gesorteerd[i].tekst).trim();
    if (stuk.length === 0) continue; // volledig overlap → niets toe te voegen
    uit = `${uit} ${stuk}`;
  }
  uit = uit.trim();
  if (uit.length > perUnitCap) return null;
  return uit;
}

// Kiest de siblings van een treffer binnen zijn document: op structuur_label voor
// herkende structuur-units, anders een chunk_index-venster ±1. Puur.
export function kiesSiblings(hit: SiblingRij, docChunks: SiblingRij[]): SiblingRij[] {
  if (hit.structuur_label && hit.structuur_type && STRUCTUUR_UNITS.has(hit.structuur_type)) {
    return docChunks.filter((c) => c.structuur_label === hit.structuur_label);
  }
  return docChunks.filter((c) => Math.abs(c.chunk_index - hit.chunk_index) <= 1);
}

// ── Fetch-orchestrator (onzuiver) ────────────────────────────────────────────

export interface ParentMeta {
  uitgebreid: number; // treffers waarvoor een parent-passage is aangeleverd
  teruggevallen: number; // treffers die op de kale chunk terugvielen (cap/geen sibling)
  totaal_tekens: number; // som van de aangeleverde parent-passages
  per_unit_cap: number;
  totaal_cap: number;
}

const LEEG_META = (): ParentMeta => ({
  uitgebreid: 0,
  teruggevallen: 0,
  totaal_tekens: 0,
  per_unit_cap: PARENT_PER_UNIT_CAP,
  totaal_cap: PARENT_TOTAAL_CAP,
});

interface ParentOpties {
  supabase?: Awaited<ReturnType<typeof createServerSupabase>>;
  perUnitCap?: number;
  totaalCap?: number;
}

// Breidt geselecteerde treffer-chunks uit met hun structuur-unit (parent-passage).
// Muteert `chunk.aangeleverde_passage` in-place voor uitgebreide treffers en laat
// de rest kaal. De treffer-chunk zelf (id/pagina/paragraaf/bron) blijft ongewijzigd
// zodat de citatie precies blijft. Fondsdiscipline draait op de siblings.
export async function verrijkMetParents(
  geselecteerd: DocumentChunk[],
  fondsFilter: string | null,
  peildatum: string,
  opties?: ParentOpties
): Promise<{ chunks: DocumentChunk[]; meta: ParentMeta }> {
  const meta = LEEG_META();
  if (opties?.perUnitCap) meta.per_unit_cap = opties.perUnitCap;
  if (opties?.totaalCap) meta.totaal_cap = opties.totaalCap;
  if (geselecteerd.length === 0) return { chunks: geselecteerd, meta };

  const supabase = opties?.supabase ?? (await createServerSupabase());
  const docIds = [...new Set(geselecteerd.map((c) => c.document_id))];

  // Eén gebatchte fetch van alle chunks van de betrokken documenten (met de velden
  // die de fondsdiscipline-guard én de sibling-scoping nodig hebben). RLS-veilig
  // (anon-client). Plafond tegen extreem grote documenten.
  const { data, error } = await supabase
    .from("document_chunks")
    .select(
      `id, document_id, tekst, pagina, paragraaf, chunk_index, structuur_type, structuur_label,
       documenten!inner(titel, bron, bibliotheek, opslag_pad, fonds_id, documentstatus:status, bronstatus, volgende_review)`
    )
    .in("document_id", docIds)
    .eq("documenten.actief", true)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(
      Math.min(SIBLING_FETCH_MAX, Math.max(SIBLING_FETCH_MIN, docIds.length * SIBLING_FETCH_PER_DOC))
    );

  if (error || !data || data.length === 0) {
    // Geen siblings ophaalbaar → alles kaal (fail-safe, geen regressie).
    meta.teruggevallen = geselecteerd.length;
    return { chunks: geselecteerd, meta };
  }

  // Fondsdiscipline op de siblings (dragend: de directe route mist de RPC-poort).
  const alleSiblings = handhaafFondsdiscipline(
    data as unknown as SiblingRij[],
    fondsFilter,
    peildatum
  ).chunks as SiblingRij[];

  // Groepeer siblings per document; index treffer-metadata per id (de RPC-treffer
  // draagt structuur_type/-label niet, de fetch wél).
  const perDoc = new Map<string, SiblingRij[]>();
  const perId = new Map<string, SiblingRij>();
  for (const s of alleSiblings) {
    const lijst = perDoc.get(s.document_id) ?? [];
    lijst.push(s);
    perDoc.set(s.document_id, lijst);
    perId.set(s.id, s);
  }

  let totaal = 0;
  const cap = meta.totaal_cap;
  for (const treffer of geselecteerd) {
    const hitMeta = perId.get(treffer.id);
    const docChunks = perDoc.get(treffer.document_id);
    if (!hitMeta || !docChunks) {
      meta.teruggevallen++;
      continue;
    }
    const siblings = kiesSiblings(hitMeta, docChunks);
    const samengevoegd = voegSiblingsSamen(siblings, meta.per_unit_cap);
    // Alleen aanleveren als het écht méér context is dan de kale chunk en het
    // totaalbudget het toelaat. Anders: kale chunk (terugval).
    if (
      samengevoegd &&
      samengevoegd.length > treffer.tekst.trim().length &&
      totaal + samengevoegd.length <= cap
    ) {
      treffer.aangeleverde_passage = samengevoegd;
      totaal += samengevoegd.length;
      meta.uitgebreid++;
    } else {
      meta.teruggevallen++;
    }
  }
  meta.totaal_tekens = totaal;
  return { chunks: geselecteerd, meta };
}
