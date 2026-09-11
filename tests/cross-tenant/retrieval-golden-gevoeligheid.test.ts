// ============================================================================
//  #322 F4-T1 — Negatieve controle op de retrieval-goldens.
// ----------------------------------------------------------------------------
//  Een golden bewijst pas iets als hij ROOD wordt bij het gedrag dat hij heet te
//  bewaken. Deze suite toetst dat mechanisch en OFFLINE: geen stack, geen DB,
//  geen app. Ze voert de echte snapshotpijplijn (`normaliseerJson` +
//  `stabielJson`, plus de w322-volgordeprojectie) op synthetische responsen uit,
//  muteert er precies één ding in, en eist een verschil.
//
//  De vier mutaties komen één-op-één uit de verificatie-eis van #348:
//    (1) gewijzigde volgorde        (4) gewijzigde versie-identiteit
//    (2) gewijzigde citation-/chunk-ID
//    (3) gewijzigd fondsfilter
//
//  Test (0) is de vastgelegde BEVINDING waarom de projectie bestaat: op de kale
//  body is de pijplijn aantoonbaar ONgevoelig voor volgorde, omdat
//  `normaliseerJson()` elke array sorteert. Die test moet groen blijven — hij
//  documenteert de reden, en kantelt hij, dan is de gedeelde normalisatie
//  gewijzigd en mag de projectie opnieuw worden beoordeeld.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normaliseerJson, stabielJson } from "../karakterisering/normaliseer.mjs";
import { zoekVolgorde, metaVolgorde } from "../karakterisering/retrieval-volgorde.mjs";

const SNAPSHOTS = join(import.meta.dirname, "..", "karakterisering", "__snapshots__");

/** De snapshotpijplijn zoals run.mjs hem toepast. */
const vorm = (node: unknown): string => stabielJson(normaliseerJson(node));

const kloon = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ── Synthetische, representatieve responsen ─────────────────────────────────
// Twee documenten, elk twee treffers: genoeg om volgorde binnen én tussen
// documenten te muteren. De UUID's zijn vast en fictief.
const DOC_A = "11111111-1111-4111-8111-111111111111";
const DOC_B = "22222222-2222-4222-8222-222222222222";
const CHUNK_A = "33333333-3333-4333-8333-333333333333";
const CHUNK_B = "44444444-4444-4444-8444-444444444444";
const FONDS = "55555555-5555-4555-8555-555555555555";

const ZOEKBODY = {
  resultaten: [
    {
      document_id: DOC_A, bibliotheek: "fonds", documentstatus: "vastgesteld",
      treffers: [
        { pagina: 5, paragraaf: null, fragment: "De premie is vastgesteld op 24 procent." },
        { pagina: 3, paragraaf: null, fragment: "Het herstelplan beschrijft de maatregelen." },
      ],
    },
    {
      document_id: DOC_B, bibliotheek: "generiek", documentstatus: "vastgesteld",
      treffers: [{ pagina: 1, paragraaf: "2.1", fragment: "Generieke sectorbron." }],
    },
  ],
  procesinstanties: [],
  meta: { methode: "fts_dutch_ranked", opgehaald: 3, geselecteerd: 3, modus: "alles" },
};

const RETRIEVAL_META = {
  methode: "fts_dutch_ranked" as string,
  embedding_query_success: false,
  opgehaald: 2,
  geselecteerd: 2,
  chunks: [
    { id: CHUNK_A, document_id: DOC_A, rang: 0.9, fts_rang: 1, vec_rang: null as number | null },
    { id: CHUNK_B, document_id: DOC_B, rang: 0.4, fts_rang: 2, vec_rang: null as number | null },
  ],
  bronversie_audit: [
    { document_id: DOC_A, bron: "Intern", bibliotheek: "fonds", fonds_id: FONDS, documentstatus: "vastgesteld", bronstatus: null, documentdatum: "2026-01-31" },
    { document_id: DOC_B, bron: "Extern", bibliotheek: "generiek", fonds_id: null, documentstatus: "vastgesteld", bronstatus: "actueel", documentdatum: "2025-11-01" },
  ],
  retrieval_pogingen: [
    { naam: "primair", query: "premiebeleid", rijen: 2 },
    { naam: "origineel", query: "premie", rijen: 1, overgeslagen: true },
  ],
  poging_herkomst: { [CHUNK_A]: "primair", [CHUNK_B]: "origineel" } as Record<string, string>,
  toegepaste_fonds_filter: FONDS as string | null,
  citaties: { totaal: 2, ongeldig: 0 },
};

/** De w322-waarneming: body + volgordeprojectie, zoals het snapshot hem draagt. */
const zoekWaarneming = (body: typeof ZOEKBODY) => ({ body, nawerk: { volgorde: zoekVolgorde(body) } });
// Spiegelt exact wat het scenario opneemt: de meta ZONDER het rauwe
// `poging_herkomst` (sleutelgeadresseerd op chunk-ID, zie de bevinding onder),
// plus de volgordeprojectie.
const metaWaarneming = (meta: typeof RETRIEVAL_META) => {
  const { poging_herkomst, ...rest } = meta;
  return {
    nawerk: {
      retrieval_meta: { ...rest, poging_herkomst_geprojecteerd: poging_herkomst == null ? null : Object.keys(poging_herkomst).length },
      volgorde: metaVolgorde(meta),
    },
  };
};

// ── (0) De bevinding die de projectie rechtvaardigt ─────────────────────────

test("F4-golden — BEVINDING: op de kale body is de pijplijn ongevoelig voor volgorde", () => {
  const omgekeerd = kloon(ZOEKBODY);
  omgekeerd.resultaten[0].treffers.reverse();
  omgekeerd.resultaten.reverse();
  assert.equal(
    vorm(ZOEKBODY), vorm(omgekeerd),
    "normaliseerJson() sorteert arrays niet meer — herbeoordeel de w322-volgordeprojectie"
  );
});

// ── (1) Volgorde ────────────────────────────────────────────────────────────

test("F4-golden — negatieve controle: omgekeerde trefferrangorde maakt de golden rood", () => {
  const m = kloon(ZOEKBODY);
  m.resultaten[0].treffers.reverse();
  assert.notEqual(vorm(zoekWaarneming(ZOEKBODY)), vorm(zoekWaarneming(m)));
});

test("F4-golden — negatieve controle: omgekeerde documentrangorde maakt de golden rood", () => {
  const m = kloon(ZOEKBODY);
  m.resultaten.reverse();
  assert.notEqual(vorm(zoekWaarneming(ZOEKBODY)), vorm(zoekWaarneming(m)));
});

test("F4-golden — negatieve controle: omgekeerde kandidatenrangorde in retrieval_meta maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  m.chunks.reverse();
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

// ── (2) Citation-/chunk-ID ──────────────────────────────────────────────────

// BEVINDING F4-T1 — GRENS VAN DE GOLDEN. `mapUuids()` vervangt elke UUID door
// `<uuid:N>` op volgorde van eerste voorkomen. Een ID is daardoor alleen
// RELATIONEEL te pinnen (co-referentie tussen `chunks`, `poging_herkomst` en
// `bronversie_audit`), niet op waarde. Dat is bewust: de seed geeft bij elke
// heropbouw andere UUID's, en een golden die de letterlijke waarde pinde zou bij
// elke herseed omvallen — precies het gedrag dat "even bijwerken" aanleert.
// Deze twee tests leggen beide helften vast, zodat de grens gedocumenteerd is en
// niet per ongeluk voor dekking wordt aangezien.
test("F4-golden — GRENS: een consistente hernoeming van alle chunk-ID's is per ontwerp niet zichtbaar", () => {
  const m = kloon(RETRIEVAL_META);
  const nieuw = "66666666-6666-4666-8666-666666666666";
  m.chunks[0].id = nieuw;
  m.poging_herkomst = { [nieuw]: "primair", [CHUNK_B]: "origineel" };
  assert.equal(
    vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)),
    "de UUID-maskering is gewijzigd — herbeoordeel wat de w322-goldens over citaat-ID's bewijzen"
  );
});

test("F4-golden — negatieve controle: een chunk-ID die de herkomstkoppeling breekt maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  // Alleen in `chunks` hernoemd: `poging_herkomst` kent deze chunk niet meer —
  // een geselecteerde passage zonder herleidbare retrievalpoging. De projectie
  // maakt dat zichtbaar; op de kale meta zou het onder de maskering verdwijnen.
  m.chunks[0].id = "66666666-6666-4666-8666-666666666666";
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

// BEVINDING F4-T1 — `mapUuids()` maskeert string-WAARDEN, geen object-SLEUTELS.
// `poging_herkomst` is als enige retrievalveld sleutelgeadresseerd op chunk-ID
// en zou dus rauwe seed-UUID's in het snapshot zetten. De projectie in
// retrieval-volgorde.mjs zet die om naar waarden. Deze test bewaakt de reden.
test("F4-golden — BEVINDING: object-sleutels ontsnappen aan de UUID-maskering", () => {
  const rauw = vorm({ poging_herkomst: { [CHUNK_A]: "primair" } });
  assert.ok(rauw.includes(CHUNK_A), "sleutels worden nu wél gemaskeerd — de herkomstprojectie mag opnieuw worden beoordeeld");
  const geprojecteerd = vorm(metaWaarneming(RETRIEVAL_META));
  assert.ok(!geprojecteerd.includes(CHUNK_A), "de projectie laat alsnog een rauwe chunk-UUID in het snapshot staan");
});

test("F4-golden — negatieve controle: een citaat dat naar een ander document wijst maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  m.chunks[0].document_id = DOC_B;
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

test("F4-golden — negatieve controle: een gewijzigde citatietelling maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  m.citaties = { totaal: 2, ongeldig: 1 };
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

// ── (3) Fondsfilter ─────────────────────────────────────────────────────────

test("F4-golden — negatieve controle: een gewijzigd fondsfilter maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  m.toegepaste_fonds_filter = null;
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

test("F4-golden — negatieve controle: een fondsvreemde bron in de bronversie-audit maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  m.bronversie_audit[0].fonds_id = "77777777-7777-4777-8777-777777777777";
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

// ── (4) Versie-identiteit ───────────────────────────────────────────────────

test("F4-golden — negatieve controle: een gewijzigde documentstatus maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  m.bronversie_audit[0].documentstatus = "concept";
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

test("F4-golden — negatieve controle: een gewijzigde documentdatum maakt de golden rood", () => {
  const m = kloon(RETRIEVAL_META);
  m.bronversie_audit[0].documentdatum = "2020-01-01";
  assert.notEqual(vorm(metaWaarneming(RETRIEVAL_META)), vorm(metaWaarneming(m)));
});

test("F4-golden — negatieve controle: een gewijzigde passage maakt de golden rood via de sha-projectie", () => {
  const m = kloon(ZOEKBODY);
  m.resultaten[0].treffers[0].fragment = "De premie is vastgesteld op 25 procent.";
  assert.notEqual(vorm(zoekWaarneming(ZOEKBODY)), vorm(zoekWaarneming(m)));
});

// ── (5) #349 T1b — het hybride pad ─────────────────────────────────────────
//  Een hybride golden moet kantelen bij precies de twee dingen die het FTS-pad
//  niet kan opleveren: een andere RRF-fusievolgorde, en een gewijzigde
//  armherkomst (vec_rang naast fts_rang). Zonder deze controles zou een stille
//  terugval op FTS -- die `vec_rang: null` geeft -- als groen kunnen passeren.
const HYBRIDE_META = {
  ...RETRIEVAL_META,
  methode: "hybride_rrf",
  embedding_query_success: true,
  chunks: [
    { id: CHUNK_A, document_id: DOC_A, rang: 0.9, fts_rang: 1, vec_rang: 2 as number | null },
    { id: CHUNK_B, document_id: DOC_B, rang: 0.4, fts_rang: 2, vec_rang: 1 as number | null },
  ],
};

test("F4-golden — negatieve controle: een omgekeerde RRF-fusie maakt de hybride golden rood", () => {
  const m = kloon(HYBRIDE_META);
  m.chunks.reverse();
  assert.notEqual(vorm(metaWaarneming(HYBRIDE_META)), vorm(metaWaarneming(m)));
});

test("F4-golden — negatieve controle: een gewijzigde vectorrang maakt de hybride golden rood", () => {
  const m = kloon(HYBRIDE_META);
  m.chunks[0].vec_rang = 5;
  assert.notEqual(vorm(metaWaarneming(HYBRIDE_META)), vorm(metaWaarneming(m)));
});

test("F4-golden — negatieve controle: een stille terugval op FTS maakt de hybride golden rood", () => {
  // De belangrijkste: zonder embeddingprovider zet rag.ts methode op
  // fts_dutch_ranked, embedding_query_success op false en vec_rang op null.
  // Dat MOET zichtbaar zijn, anders karakteriseert de golden het verkeerde pad.
  const m = kloon(HYBRIDE_META);
  m.methode = "fts_dutch_ranked";
  m.embedding_query_success = false;
  for (const c of m.chunks) c.vec_rang = null;
  assert.notEqual(vorm(metaWaarneming(HYBRIDE_META)), vorm(metaWaarneming(m)));
});

test("F4-golden — de hybride armherkomst is per chunk zichtbaar in de projectie", () => {
  const tekst = vorm(metaWaarneming(HYBRIDE_META));
  assert.ok(tekst.includes("fts=1 vec=2"), "de volgordeprojectie moet beide armrangen dragen");
  assert.ok(tekst.includes("fts=2 vec=1"));
});

// ── De opgenomen snapshots dragen de projectie daadwerkelijk ────────────────

test("F4-golden — elk opgenomen w322/w322b-snapshot draagt een volgordeprojectie", () => {
  const bestanden = readdirSync(SNAPSHOTS).filter((b) => /^w322b?\./.test(b) && b.endsWith(".json"));
  assert.ok(bestanden.length >= 6, `verwacht ten minste 6 w322-snapshots, gevonden ${bestanden.length}`);
  for (const b of bestanden) {
    const snap = JSON.parse(readFileSync(join(SNAPSHOTS, b), "utf8")) as { nawerk?: { volgorde?: unknown } };
    assert.ok(
      snap.nawerk && "volgorde" in snap.nawerk,
      `${b} mist nawerk.volgorde — neem het snapshot opnieuw op (run.mjs --record --only=…)`
    );
  }
});
