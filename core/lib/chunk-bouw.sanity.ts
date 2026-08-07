// ============================================================================
//  Sanity-tests voor lib/chunk-bouw.ts (F2 — kale chunk-bouw + prefix-groepering).
//
//  Geen testframework; standalone met assert. Uitvoeren: npx tsx
//  lib/chunk-bouw.sanity.ts (draait mee in `npm run sanity`).
//  Dekt bouwticket §6 tests 1–3: splitsing zonder gedragsverandering, prefix per
//  unit, en verrijkTekst spiegelt de zoek_vector-SQL. Bewust tegen de PURE module
//  (chunk-bouw) zodat er geen server-only/Anthropic-import nodig is.
// ============================================================================

import assert from "node:assert/strict";
import { maakChunksUitSegmenten } from "./chunking";
import type { TekstSegment } from "./document-extractie";
import {
  INDEXERING_VERSIE,
  PREFIX_UNIT_CAP,
  bepaalPrefixGroepen,
  bouwChunkRecordsZonderVerrijking,
  verrijkTekst,
  type PrefixInvoer,
} from "./chunk-bouw";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("chunk-bouw sanity-tests:");

const alineaA =
  "Dit is de eerste pagina over de financieringsgraad van het pensioenfonds en de bijbehorende solidariteitsreserve.";
const alineaB =
  "Dit is de tweede pagina over het beleggingsbeleid, het rendement en de beheersing van de renterisico's.";

// ── Test 1 — splitsing zonder gedragsverandering ────────────────────────────
// bouwChunkRecordsZonderVerrijking mapt de kale velden 1-op-1 uit
// maakChunksUitSegmenten (de chunker zelf is ongewijzigd), zonder enige prefix/
// embedding. Zo verandert de splitsing het bestaande gedrag niet.
check("kale records spiegelen maakChunksUitSegmenten, zonder verrijking", () => {
  const segmenten: TekstSegment[] = [
    { pagina: 1, paragraaf: null, tekst: alineaA },
    { pagina: 2, paragraaf: "Tabblad: Premies", tekst: alineaB },
  ];
  const records = bouwChunkRecordsZonderVerrijking({ documentId: "doc-1", segmenten });
  const chunks = maakChunksUitSegmenten(segmenten);

  assert.equal(records.length, chunks.length);
  records.forEach((r, i) => {
    assert.equal(r.tekst, chunks[i].tekst);
    assert.equal(r.chunk_index, i);
    assert.equal(r.pagina, chunks[i].pagina);
    assert.equal(r.paragraaf, chunks[i].paragraaf);
    assert.equal(r.structuur_type, chunks[i].structuur_type ?? null);
    assert.equal(r.structuur_label, chunks[i].structuur_label ?? null);
    // Geen verrijking op dit pad.
    assert.equal(r.context_prefix, null);
    assert.equal(r.prefix_model, null);
    assert.equal(r.embedding, undefined);
    assert.equal(r.embedding_model, undefined);
    assert.equal(r.document_id, "doc-1");
    assert.equal(r.indexering_versie, INDEXERING_VERSIE);
  });
});

// ── Test 2 — prefix per unit ────────────────────────────────────────────────
const mk = (
  type: PrefixInvoer["structuur_type"],
  label: string | null,
  tekst = "fragmenttekst"
): PrefixInvoer => ({ tekst, pagina: null, paragraaf: null, structuur_type: type, structuur_label: label });

check("chunks van dezelfde unit delen één prefix-groep; boven de cap een nieuwe", () => {
  // Vijf chunks in Artikel 3: de eerste PREFIX_UNIT_CAP delen een groep, de
  // (cap+1)-de start een nieuw blok (verse prefix).
  const chunks: PrefixInvoer[] = [
    mk("artikel", "Artikel 3"), // 0
    mk("artikel", "Artikel 3"), // 1
    mk("artikel", "Artikel 3"), // 2
    mk("artikel", "Artikel 3"), // 3
    mk("artikel", "Artikel 3"), // 4  → nieuw blok
    mk("tekst", null), //           5  → solo
    mk(null, null), //              6  → solo
    mk("paragraaf", "§2"), //       7  → andere unit
    mk("artikel", null), //         8  → solo (label ontbreekt)
  ];
  assert.equal(PREFIX_UNIT_CAP, 4); // fixture is op deze cap geijkt
  const g = bepaalPrefixGroepen(chunks);

  // Eerste vier delen één groep.
  assert.equal(g[0], g[1]);
  assert.equal(g[1], g[2]);
  assert.equal(g[2], g[3]);
  // Vijfde valt in een nieuw blok van dezelfde unit.
  assert.notEqual(g[4], g[0]);
  // Labelloze chunks zijn elk uniek (één-op-één).
  assert.notEqual(g[5], g[6]);
  assert.notEqual(g[5], g[0]);
  // Andere unit ⇒ andere groep; label-ontbreekt ⇒ solo, niet bij de paragraaf.
  assert.notEqual(g[7], g[0]);
  assert.notEqual(g[8], g[7]);

  // Zes unieke groepen = zes modelcalls i.p.v. negen: aantoonbare reductie.
  assert.equal(new Set(g).size, 6);
});

check("labelloze chunks krijgen elk een eigen groep (niets te groeperen)", () => {
  const chunks = [mk("tekst", null), mk("tekst", null), mk(null, "")];
  const g = bepaalPrefixGroepen(chunks);
  assert.equal(new Set(g).size, 3);
});

// ── Test 3 — verrijkTekst spiegelt zoek_vector ──────────────────────────────
// SQL: coalesce(context_prefix || ' ', '') || tekst. Domein: prefix is null of
// een niet-lege string (genereerPrefix geeft nooit een lege string terug).
check("verrijkTekst == coalesce(prefix || ' ', '') || tekst", () => {
  const sqlSpiegel = (prefix: string | null, tekst: string) =>
    (prefix != null ? prefix + " " : "") + tekst;

  assert.equal(verrijkTekst(null, "abc"), sqlSpiegel(null, "abc"));
  assert.equal(verrijkTekst(null, "abc"), "abc");
  assert.equal(verrijkTekst("situering", "abc"), sqlSpiegel("situering", "abc"));
  assert.equal(verrijkTekst("situering", "abc"), "situering abc");
});

console.log(`\n${n} sanity-tests geslaagd.`);
