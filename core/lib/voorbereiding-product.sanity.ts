// ============================================================
//  Sanity-tests voor core/lib/voorbereiding-product.ts (T2, #304).
//
//  De vorm van het bewaarde product is een contract tussen drie partijen die
//  elkaar niet zien: de chat-route schrijft, de agendapuntkaart leest, en de
//  notities-route deelt de rij. Deze suite pint de afspraken die anders alleen
//  in proza bestaan — vooral de belangrijkste: er komt GEEN brontekst in
//  `bronnen_meta`.
//
//  Uitvoeren: npx tsx core/lib/voorbereiding-product.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  MAX_BRONTITELS,
  bouwVoorbereidingProduct,
  leesVoorbereidingProduct,
} from "./voorbereiding-product";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("voorbereiding-product sanity-tests:");

const NU = "2026-09-04T08:30:00.000Z";
const bron = (i: number) => ({
  document_id: `doc-${i}`,
  titel: `Beleidsnota ${i}`,
  bron: "bibliotheek",
  pagina: i,
  paragraaf: `3.${i}`,
  fragment: "GEHEIME BRONTEKST DIE HIER NIET HOORT",
  heeft_origineel: true,
  documentstatus: "concept",
  documentdatum: "2026-08-01",
  documenttype: "beleidsnota",
});

test("product draagt tekst, tijdstip en de twee herleidbaarheidssleutels", () => {
  const p = bouwVoorbereidingProduct({
    tekst: "**Bestuurlijke duiding** — …",
    bronnen: [bron(1)],
    governanceLogId: "log-1",
    gesprekId: "gesprek-1",
    nu: NU,
  });
  assert.equal(p.ai_output.tekst, "**Bestuurlijke duiding** — …");
  assert.equal(p.ai_output.opgesteld_op, NU);
  // Zonder deze twee is het product niet terug te leiden naar de auditregel en
  // het gesprek waarin het is opgesteld — precies wat T2 wil herstellen.
  assert.equal(p.ai_output.governance_log_id, "log-1");
  assert.equal(p.ai_output.gesprek_id, "gesprek-1");
});

test("GEEN brontekst in bronnen_meta", () => {
  const p = bouwVoorbereidingProduct({
    tekst: "x",
    bronnen: [bron(1), bron(2)],
    governanceLogId: null,
    gesprekId: null,
    nu: NU,
  });
  const serialisatie = JSON.stringify(p.bronnen_meta);
  assert.equal(
    serialisatie.includes("GEHEIME BRONTEKST"),
    false,
    "documentinhoud mag niet in voorbereidingen.bronnen_meta belanden — dat is een tweede opslag naast governance_log_inhoud, buiten de retentiebaan om"
  );
  assert.equal(serialisatie.includes("fragment"), false);
  // Wél de velden die de bronpill nodig heeft om niet als ONGELDIG te renderen.
  for (const veld of ["document_id", "titel", "bron", "pagina", "paragraaf"]) {
    assert.ok(serialisatie.includes(veld), `pill-veld ontbreekt: ${veld}`);
  }
});

test("aantal telt álle bronnen, ook als de lijst is afgekapt", () => {
  const veel = Array.from({ length: MAX_BRONTITELS + 4 }, (_, i) => bron(i + 1));
  const p = bouwVoorbereidingProduct({
    tekst: "x",
    bronnen: veel,
    governanceLogId: null,
    gesprekId: null,
    nu: NU,
  });
  assert.equal(p.bronnen_meta.bronnen.length, MAX_BRONTITELS);
  // De kaart zou anders "10 bronnen" tonen bij veertien gebruikte bronnen en de
  // onderbouwing daarmee kleiner voorstellen dan ze was.
  assert.equal(p.bronnen_meta.aantal, veel.length);
});

test("nummering loopt vanaf 1 en volgt de promptvolgorde", () => {
  const p = bouwVoorbereidingProduct({
    tekst: "x",
    bronnen: [bron(7), bron(8)],
    governanceLogId: null,
    gesprekId: null,
    nu: NU,
  });
  assert.deepEqual(
    p.bronnen_meta.bronnen.map((b) => b.nummer),
    [1, 2]
  );
  assert.deepEqual(
    p.bronnen_meta.bronnen.map((b) => b.titel),
    ["Beleidsnota 7", "Beleidsnota 8"]
  );
});

test("een lege titel wordt zichtbaar leeg, niet stil weggelaten", () => {
  const p = bouwVoorbereidingProduct({
    tekst: "x",
    bronnen: [{ ...bron(1), titel: "   " }],
    governanceLogId: null,
    gesprekId: null,
    nu: NU,
  });
  assert.equal(p.bronnen_meta.bronnen[0].titel, "(zonder titel)");
  assert.equal(p.bronnen_meta.aantal, 1);
});

test("lezen: heen en terug levert hetzelfde product", () => {
  const p = bouwVoorbereidingProduct({
    tekst: "**Aandachtspunten** — de dekkingsgraad daalt.",
    bronnen: [bron(1), bron(2)],
    governanceLogId: "log-9",
    gesprekId: "gesprek-9",
    nu: NU,
  });
  const terug = leesVoorbereidingProduct({
    ai_output: p.ai_output,
    bronnen_meta: p.bronnen_meta,
    gegenereerd_op: NU,
    bijgewerkt_op: NU,
  });
  assert.ok(terug);
  assert.equal(terug!.tekst, "**Aandachtspunten** — de dekkingsgraad daalt.");
  assert.equal(terug!.aantalBronnen, 2);
  assert.equal(terug!.opgesteldOp, NU);
  assert.equal(terug!.bronnen[0].titel, "Beleidsnota 1");
});

test("lezen: een rij ZONDER AI-tekst is geen voorbereiding", () => {
  // Deze rij bestaat legitiem: de notities-route maakt hem aan zodra iemand
  // alleen een aantekening opslaat. Zou de kaart hem als "voorbereid" tonen,
  // dan ziet de bestuurder een lege voorbereiding en verdwijnt de knop om er
  // een te maken.
  assert.equal(
    leesVoorbereidingProduct({
      ai_output: {},
      bronnen_meta: {},
      gegenereerd_op: NU,
      bijgewerkt_op: NU,
    }),
    null
  );
  assert.equal(
    leesVoorbereidingProduct({ ai_output: { tekst: "   " } }),
    null
  );
  assert.equal(leesVoorbereidingProduct(null), null);
});

test("lezen: rommelige jsonb breekt de kaart niet", () => {
  const terug = leesVoorbereidingProduct({
    ai_output: { tekst: "iets" },
    bronnen_meta: { aantal: "drie", bronnen: [null, 3, { titel: "Wel goed" }] },
  });
  assert.ok(terug);
  assert.equal(terug!.bronnen.length, 1);
  // `aantal` was geen getal → val terug op wat er werkelijk staat, niet op NaN.
  assert.equal(terug!.aantalBronnen, 1);
  assert.equal(terug!.opgesteldOp, null);
});

console.log(`\n${n} sanity-tests groen.`);
