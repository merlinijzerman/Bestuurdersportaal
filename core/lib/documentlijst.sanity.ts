// ============================================================================
//  Sanity-suite bij core/lib/documentlijst.ts
// ----------------------------------------------------------------------------
//  Draait mee in `npm run sanity`, of los met
//  `npx tsx core/lib/documentlijst.sanity.ts`.
//
//  Kern van deze suite: de ordening moet DETERMINISTISCH en TOTAAL zijn.
//  Dezelfde bronnenset hoort altijd dezelfde documentlijst te geven — dat is wat
//  "reproduceerbare besluitvorming" hier concreet betekent.
// ============================================================================

import assert from "node:assert/strict";
import {
  groepeerDocumentbronnen,
  pasFilterToe,
  documentIdsVan,
  documenttypeLabel,
  isVastgesteld,
  isDocumentbron,
  ONBEKEND_TYPE_LABEL,
  type DocumentbronInvoer,
} from "./documentlijst";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function bron(over: Partial<DocumentbronInvoer> & { document_id: string }): DocumentbronInvoer {
  return {
    titel: `Stuk ${over.document_id}`,
    bron: "Intern",
    pagina: null,
    paragraaf: null,
    fragment: "fragment",
    heeft_origineel: true,
    documentstatus: "vastgesteld",
    documentdatum: "2026-01-01",
    documenttype: "notulen",
    bestandstype: "pdf",
    ...over,
  };
}

// ── Ontdubbeling ────────────────────────────────────────────────────────────

test("lege invoer levert een lege lijst", () => {
  assert.deepEqual(groepeerDocumentbronnen([]), []);
});

test("meerdere chunks van één document leveren één kaart", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", fragment: "eerste treffer" }),
    bron({ document_id: "a", fragment: "tweede treffer" }),
    bron({ document_id: "a", fragment: "derde treffer" }),
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].documenten.length, 1);
});

test("de best gerangschikte treffer wint als trefferfragment", () => {
  // De bronnenlijst komt in rangschikkingsvolgorde binnen; de eerste is de beste.
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", fragment: "beste" }),
    bron({ document_id: "a", fragment: "mindere" }),
  ]);
  assert.equal(g[0].documenten[0].fragment, "beste");
  assert.equal(g[0].documenten[0].bronnummer, 1);
});

// Zonder deze nummers zou een klik op `[Bron 3]` nergens landen: de bronkaarten
// staan in deze modus niet meer in het paneel, dus de kaart draagt de ankers.
test("alle bronnummers van een document worden bewaard", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a" }),
    bron({ document_id: "b" }),
    bron({ document_id: "a" }),
    bron({ document_id: "a" }),
  ]);
  const a = g[0].documenten.find((d) => d.document_id === "a")!;
  assert.deepEqual(a.bronnummers, [1, 3, 4]);
  assert.equal(a.bronnummer, 1);
});

// Een besluitregistratie is geen document: haar `document_id` is een decision_id
// (document-scope zou falen) en haar status komt uit een ander domein.
test("besluitregistratiebronnen horen niet in de documentlijst", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "d1", bron: "Decision Object", documentstatus: "besloten" }),
    bron({ document_id: "a" }),
  ]);
  assert.deepEqual(documentIdsVan(g), ["a"]);
  assert.equal(isDocumentbron(bron({ document_id: "d1", bron: "Decision Object" })), false);
  assert.equal(isDocumentbron(bron({ document_id: "a" })), true);
});

test("het bronnummer verwijst naar de plek in de oorspronkelijke lijst", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documenttype: "notulen" }),
    bron({ document_id: "b", documenttype: "notulen" }),
    bron({ document_id: "c", documenttype: "notulen" }),
  ]);
  const nummers = g[0].documenten.map((d) => `${d.document_id}:${d.bronnummer}`).sort();
  assert.deepEqual(nummers, ["a:1", "b:2", "c:3"]);
});

test("bronnen zonder document_id worden overgeslagen", () => {
  const g = groepeerDocumentbronnen([
    { ...bron({ document_id: "a" }), document_id: "" },
    bron({ document_id: "b" }),
  ]);
  assert.equal(documentIdsVan(g).length, 1);
});

// ── Groepering ──────────────────────────────────────────────────────────────

test("groepen volgen de canonieke DOCUMENTTYPEN-volgorde", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documenttype: "overig" }),
    bron({ document_id: "b", documenttype: "beleid" }),
    bron({ document_id: "c", documenttype: "notulen" }),
  ]);
  // beleid staat vóór notulen, notulen vóór overig.
  assert.deepEqual(g.map((x) => x.sleutel), ["beleid", "notulen", "overig"]);
});

// Dit is de realiteit van vandaag: `documenttype` is nullable en niet gebackfilld
// zolang de metadata-review-queue niet is doorgewerkt.
test("documenten zonder type komen in één restgroep, altijd als laatste", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documenttype: null }),
    bron({ document_id: "b", documenttype: "beleid" }),
    bron({ document_id: "c", documenttype: undefined }),
  ]);
  assert.equal(g[g.length - 1].label, ONBEKEND_TYPE_LABEL);
  assert.equal(g[g.length - 1].documenten.length, 2);
});

test("een onbekende typewaarde valt niet stil weg", () => {
  const g = groepeerDocumentbronnen([bron({ document_id: "a", documenttype: "verzonnen" })]);
  assert.equal(g.length, 1);
  assert.equal(g[0].label, "verzonnen");
});

// Randgeval: een waarde buiten de elf toegestane (alleen mogelijk na een
// schemawijziging) mag de restgroep niet van de laatste plek verdringen.
test("de restgroep blijft onderaan, óók onder een onbekende typewaarde", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documenttype: null }),
    bron({ document_id: "b", documenttype: "verzonnen" }),
    bron({ document_id: "c", documenttype: "beleid" }),
  ]);
  assert.deepEqual(g.map((x) => x.sleutel), ["beleid", "verzonnen", "onbekend"]);
});

// ── Sortering ───────────────────────────────────────────────────────────────

test("binnen een groep staat de nieuwste datum bovenaan", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documentdatum: "2025-03-01" }),
    bron({ document_id: "b", documentdatum: "2026-07-14" }),
    bron({ document_id: "c", documentdatum: "2026-01-09" }),
  ]);
  assert.deepEqual(g[0].documenten.map((d) => d.document_id), ["b", "c", "a"]);
});

test("documenten zonder datum staan onderaan", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documentdatum: null }),
    bron({ document_id: "b", documentdatum: "2026-07-14" }),
    bron({ document_id: "c", documentdatum: undefined }),
  ]);
  assert.equal(g[0].documenten[0].document_id, "b");
  assert.deepEqual(g[0].documenten.slice(1).map((d) => d.document_id).sort(), ["a", "c"]);
});

test("gelijke datum: titel beslist, daarna document_id — totale ordening", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "z", titel: "Bravo", documentdatum: "2026-01-01" }),
    bron({ document_id: "a", titel: "Alpha", documentdatum: "2026-01-01" }),
    bron({ document_id: "m", titel: "Alpha", documentdatum: "2026-01-01" }),
  ]);
  assert.deepEqual(g[0].documenten.map((d) => d.document_id), ["a", "m", "z"]);
});

test("dezelfde bronnenset levert altijd dezelfde volgorde", () => {
  const set = [
    bron({ document_id: "c", documenttype: "advies", documentdatum: "2026-02-02" }),
    bron({ document_id: "a", documenttype: null, documentdatum: null }),
    bron({ document_id: "b", documenttype: "beleid", documentdatum: "2026-02-02" }),
    bron({ document_id: "d", documenttype: "beleid", documentdatum: "2026-05-05" }),
  ];
  const sleutel = (gs: ReturnType<typeof groepeerDocumentbronnen>) =>
    gs.map((g) => `${g.sleutel}:${g.documenten.map((d) => d.document_id).join(",")}`).join("|");
  const een = sleutel(groepeerDocumentbronnen(set));
  const twee = sleutel(groepeerDocumentbronnen(set));
  const drie = sleutel(groepeerDocumentbronnen([...set]));
  assert.equal(een, twee);
  assert.equal(twee, drie);
});

test("de invoerlijst wordt niet gemuteerd", () => {
  const set = [bron({ document_id: "b" }), bron({ document_id: "a" })];
  const kopie = set.map((s) => s.document_id);
  groepeerDocumentbronnen(set);
  assert.deepEqual(set.map((s) => s.document_id), kopie);
});

// ── Filteren ────────────────────────────────────────────────────────────────

test("filter 'alle' toont alles en telt correct", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documentstatus: "concept" }),
    bron({ document_id: "b", documentstatus: "vastgesteld" }),
  ]);
  const r = pasFilterToe(g, "alle");
  assert.equal(r.zichtbaar, 2);
  assert.equal(r.totaal, 2);
});

// Het filter belooft ACTUELE grondslagen. Een van_kracht-stuk met verlopen
// geldigheid of een historische bron is dat niet — zelfde drieslag als rag.ts.
test("filter 'vastgesteld' weegt ook bronstatus en verlopen geldigheid", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documentstatus: "van_kracht" }),
    bron({ document_id: "b", documentstatus: "van_kracht", bronstatus: "historisch" }),
    bron({ document_id: "c", documentstatus: "van_kracht", geldig_tot: "2020-01-01" }),
  ]);
  const r = pasFilterToe(g, "vastgesteld", "2026-07-31");
  assert.deepEqual(documentIdsVan(r.groepen), ["a"]);
  assert.equal(r.zichtbaar, 1);
  assert.equal(r.totaal, 3);
});

// Ontbrekende status is iets anders dan "niet vastgesteld". Stil wegfilteren zou
// een oordeel suggereren dat er niet is; de teller benoemt het apart.
test("documenten zonder status worden apart geteld, niet stil verborgen", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documentstatus: "vastgesteld" }),
    bron({ document_id: "b", documentstatus: null }),
    bron({ document_id: "c", documentstatus: null }),
  ]);
  const r = pasFilterToe(g, "vastgesteld");
  assert.equal(r.zichtbaar, 1);
  assert.equal(r.totaal, 3);
  assert.equal(r.zonderStatus, 2);
  assert.equal(pasFilterToe(g, "alle").zonderStatus, 0);
});

test("filter 'vastgesteld' laat concept en vervangen weg, maar telt ze wél in het totaal", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documentstatus: "concept" }),
    bron({ document_id: "b", documentstatus: "vastgesteld" }),
    bron({ document_id: "c", documentstatus: "van_kracht" }),
    bron({ document_id: "d", documentstatus: "vervangen" }),
  ]);
  const r = pasFilterToe(g, "vastgesteld");
  assert.equal(r.zichtbaar, 2);
  assert.equal(r.totaal, 4); // "2 van 4" — het weggefilterde blijft zichtbaar in de telling
  assert.deepEqual(documentIdsVan(r.groepen).sort(), ["b", "c"]);
});

test("een groep die leeg raakt door het filter verdwijnt", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documenttype: "beleid", documentstatus: "concept" }),
    bron({ document_id: "b", documenttype: "notulen", documentstatus: "vastgesteld" }),
  ]);
  const r = pasFilterToe(g, "vastgesteld");
  assert.equal(r.groepen.length, 1);
  assert.equal(r.groepen[0].sleutel, "notulen");
});

test("filteren muteert de oorspronkelijke groepen niet", () => {
  const g = groepeerDocumentbronnen([
    bron({ document_id: "a", documentstatus: "concept" }),
    bron({ document_id: "b", documentstatus: "vastgesteld" }),
  ]);
  pasFilterToe(g, "vastgesteld");
  assert.equal(g[0].documenten.length, 2);
});

test("een document zonder status geldt niet als vastgesteld", () => {
  assert.equal(isVastgesteld(bron({ document_id: "a", documentstatus: null })), false);
  assert.equal(isVastgesteld(bron({ document_id: "a", documentstatus: "vastgesteld" })), true);
});

// ── Labels ──────────────────────────────────────────────────────────────────

test("documenttypeLabel geeft null bij een ontbrekend type", () => {
  assert.equal(documenttypeLabel(bron({ document_id: "a", documenttype: null })), null);
  assert.equal(documenttypeLabel(bron({ document_id: "a", documenttype: "beleid" })), "Beleid");
});

console.log(`\n${n} sanity-tests geslaagd.`);
