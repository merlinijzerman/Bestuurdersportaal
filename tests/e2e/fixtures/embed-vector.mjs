// ============================================================================
//  #349 F4-T1b — deterministische pseudo-embedding voor de lokale testketen.
// ----------------------------------------------------------------------------
//  Eén bron van waarheid, gedeeld door twee kanten die het over dezelfde
//  vectoren eens MOETEN zijn:
//    • de embeddingstub (`embed-stub.mjs`), die de vraag-embedding levert;
//    • de W1-seed, die dezelfde functie op de chunkteksten toepast.
//  Zouden ze uiteenlopen, dan zou de vectorarm ruis meten in plaats van
//  gelijkenis, en zegt een hybride golden niets.
//
//  WAAROM EEN HASHING-VECTORIZER EN GEEN WILLEKEUR
//  Een hash-afgeleide willekeurige vector is deterministisch, maar levert voor
//  elk tekstpaar een cosinus rond nul: de vectorarm zou dan een willekeurige
//  maar vaste volgorde teruggeven, en de RRF-fusie zou een golden opleveren die
//  wél stabiel is maar niets over retrievalgedrag bewijst. Deze vectorizer
//  hasht TOKENS naar dimensies (het klassieke "hashing trick"), zodat teksten
//  die woorden delen daadwerkelijk dichter bij elkaar liggen. De rangorde die
//  de golden vastlegt is daarmee betekenisvol: hij verschuift als de tekst of
//  de tokenisatie verandert.
//
//  Dit is NADRUKKELIJK geen semantisch model. Het is een stabiele, uitlegbare
//  benadering waarmee het hybride PAD (RPC, RRF-fusie, arm-herkomst, poging-
//  administratie) gekarakteriseerd kan worden zonder providerafhankelijkheid.
// ============================================================================
import { createHash } from "node:crypto";

/** Moet exact gelijk zijn aan EMBED_DIMS in core/lib/embeddings.ts. */
export const STUB_DIMS = 1024;

/** Nederlandse stopwoorden die anders elke tekst naar elkaar toe trekken. */
const STOP = new Set([
  "de", "het", "een", "en", "van", "voor", "op", "in", "is", "wordt", "worden",
  "die", "dat", "met", "aan", "te", "door", "bij", "als", "naar", "uit", "per",
  "tot", "of", "ook", "zijn", "was", "er", "om", "onder", "over",
]);

/** Tokenisatie: kleine letters, alleen woordkarakters, stopwoorden eruit. */
export function tokeniseer(tekst) {
  return String(tekst ?? "")
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Stabiele dimensie-index voor één token. */
function dimensieVan(token) {
  const h = createHash("sha256").update(token).digest();
  return h.readUInt32BE(0) % STUB_DIMS;
}

/** Teken (+1/-1) per token, zodat verschillende tokens op dezelfde dimensie
 *  elkaar niet stelselmatig versterken. */
function tekenVan(token) {
  const h = createHash("sha256").update(`teken:${token}`).digest();
  return (h[0] & 1) === 0 ? 1 : -1;
}

/**
 * Deterministische, L2-genormaliseerde vector van `STUB_DIMS` getallen.
 * Zelfde tekst → byte-identieke vector, op elke machine en in elke run.
 * Een lege of tokenloze tekst levert een vaste eenheidsvector, zodat de
 * RPC nooit een nulvector krijgt (cosinus is dan ongedefinieerd).
 */
export function pseudoEmbedding(tekst) {
  const vec = new Array(STUB_DIMS).fill(0);
  const tokens = tokeniseer(tekst);
  for (const t of tokens) vec[dimensieVan(t)] += tekenVan(t);
  let norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (norm === 0) {
    vec[0] = 1;
    norm = 1;
  }
  // Afronden op 6 decimalen: ruim binnen float4-precisie van pgvector en
  // daardoor byte-stabiel in zowel de HTTP-respons als de SQL-literal.
  return vec.map((x) => Number((x / norm).toFixed(6)));
}

/** pgvector-literal, hetzelfde formaat als naarVectorLiteral() in core/lib/embeddings.ts. */
export function vectorLiteral(vec) {
  return `[${vec.join(",")}]`;
}
