// ============================================================================
//  core/lib/bronset.ts — Plateau B / B-4: de bevroren reflectiebronset.
// ----------------------------------------------------------------------------
//  WAAROM DIT BESTAAT
//
//  Tijdens een reflectie wordt er geen nieuwe retrieval gedaan (FR-54). Zou dat
//  wél gebeuren, dan levert een zin als "ik maak mij zorgen over gepensioneerden"
//  willekeurige treffers die vervolgens als bron worden getóónd — schijnzekerheid
//  bovenop een twijfel. De bronset van het antwoord waarop wordt gereflecteerd
//  wordt daarom bevroren en geversioneerd (besluit 0111).
//
//  DE VERSIEHASH IS EEN SPIEGEL, NIET DE AUTORITEIT. Hij wordt berekend in
//  public.reflectie_transitie(), uit de `governance_log`-rij die daar op
//  eigenaarschap én gesprek is gevalideerd. Deze module reproduceert exact
//  dezelfde canonieke vorm in TypeScript — zelfde patroon als
//  core/lib/audit-meta.ts tegenover meta_basisniveau(). Wijkt een van beide af,
//  dan valt dat op als een verschil in plaats van als vreemd gedrag.
//
//  ⚠ AFWIJKING VAN HET TECHNISCH ONTWERP §6.2. Het TO schrijft een hash over
//  `document_id + ':' + versie_id + ':' + passage_id` plus `document_scope_hash`.
//  Die drie velden bestaan niet in deze codebase:
//
//    • `versie_id`            — er is geen versie-id op chunk- of documentniveau.
//    • `passage_id`           — heet `chunks[].id` in RetrievalMeta.
//    • `document_scope_hash`  — er is `scope.document_ids[]`, geen hash.
//
//  Bovendien is `sources[]` sinds plateau A geclassificeerd als META_INHOUD en
//  verhuisd naar `governance_log_inhoud`; de bronset kan er dus niet uit worden
//  afgeleid. Wat wél in het append-only spoor blijft staan is `chunks` en
//  `scope.document_ids` — beide META_BRON. De hash gebruikt die twee.
//
//  ⚠ FR-69: `reflectie_bronset_versie` verlaat de privéchat nooit. Hij staat in
//  `gesprek_reflectie_state` (auteur-only, verdwijnt met het gesprek) en komt
//  niet in enig formeel object. Hij is expliciet iets anders dan
//  `publicatie_bronset_versie` uit plateau C.
//
//  Pure functies, geen DB-toegang. Getest via core/lib/bronset.sanity.ts.
// ============================================================================

import { createHash } from "node:crypto";

/** Eén bevroren passage: de chunk zoals hij in `retrieval_meta.chunks` staat. */
export interface BronsetChunk {
  id: string;
  document_id: string;
}

export interface Bronset {
  /** De chunk-id's waarop de reflectie mag steunen, gesorteerd en ontdubbeld. */
  chunkIds: string[];
  /** De documentscope die bij het antwoord actief was, gesorteerd en ontdubbeld. */
  scopeDocumentIds: string[];
  /** sha256 over de canonieke vorm; null wanneer er geen enkele bron was. */
  versie: string | null;
}

function schoonIds(ruw: unknown): string[] {
  if (!Array.isArray(ruw)) return [];
  const uniek = new Set<string>();
  for (const waarde of ruw) {
    if (typeof waarde === "string" && waarde.length > 0) uniek.add(waarde);
  }
  // Codepoint-sortering: identiek aan `order by` op text in Postgres met de
  // C-collatie, die de SQL-kant expliciet forceert (collate "C").
  return [...uniek].sort();
}

/**
 * Leest de chunks uit `retrieval_meta.chunks`. Alleen rijen met zowel een `id`
 * als een `document_id` tellen mee; een half gevulde rij zou de hash laten
 * afhangen van hoe volledig de telemetrie toevallig was.
 */
export function leesBronsetChunks(retrievalMeta: unknown): BronsetChunk[] {
  if (typeof retrievalMeta !== "object" || retrievalMeta === null) return [];
  const chunks = (retrievalMeta as Record<string, unknown>).chunks;
  if (!Array.isArray(chunks)) return [];
  const uit: BronsetChunk[] = [];
  for (const c of chunks) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id.length === 0) continue;
    if (typeof r.document_id !== "string" || r.document_id.length === 0) continue;
    uit.push({ id: r.id, document_id: r.document_id });
  }
  return uit;
}

/** Leest `retrieval_meta.scope.document_ids`. Afwezige scope ⇒ lege lijst. */
export function leesScopeDocumentIds(retrievalMeta: unknown): string[] {
  if (typeof retrievalMeta !== "object" || retrievalMeta === null) return [];
  const scope = (retrievalMeta as Record<string, unknown>).scope;
  if (typeof scope !== "object" || scope === null) return [];
  return schoonIds((scope as Record<string, unknown>).document_ids);
}

/**
 * De canonieke tekst waarover gehasht wordt. Exact gespiegeld in SQL.
 *
 *     <document_id>:<chunk_id>|<document_id>:<chunk_id>|…#<scope_id>,<scope_id>,…
 *
 * Beide lijsten worden gesorteerd en ontdubbeld, zodat de hash NIET afhangt van
 * de rangorde waarin de retrieval de chunks toevallig teruggaf. Dat is de kern
 * van bronset.sanity.ts: dezelfde bronnen in een andere volgorde moeten dezelfde
 * versie opleveren, anders zou een herhaalde reflectie op hetzelfde antwoord een
 * andere "bevroren" set lijken te hebben.
 */
export function canoniekeBronset(
  chunks: BronsetChunk[],
  scopeDocumentIds: string[]
): string {
  const paren = schoonIds(chunks.map((c) => `${c.document_id}:${c.id}`));
  return `${paren.join("|")}#${schoonIds(scopeDocumentIds).join(",")}`;
}

/**
 * De volledige bevroren bronset uit een `retrieval_meta`-object.
 *
 * Géén chunks ⇒ `versie = null`. Dat is niet hetzelfde als een lege hash: het is
 * het signaal uit FR-55 dat de assistent uitsluitend op het bestaande antwoord
 * en de woorden van de gebruiker reflecteert, en geen bronnen ophaalt (AC-21).
 * Een documentscope zónder chunks telt daarbij niet als bronset — er is dan
 * niets opgehaald om op te steunen.
 */
export function bepaalBronset(retrievalMeta: unknown): Bronset {
  const chunks = leesBronsetChunks(retrievalMeta);
  const scopeDocumentIds = leesScopeDocumentIds(retrievalMeta);
  const chunkIds = schoonIds(chunks.map((c) => c.id));

  if (chunks.length === 0) {
    return { chunkIds: [], scopeDocumentIds, versie: null };
  }

  const versie = createHash("sha256")
    .update(canoniekeBronset(chunks, scopeDocumentIds), "utf8")
    .digest("hex");

  return { chunkIds, scopeDocumentIds, versie };
}
