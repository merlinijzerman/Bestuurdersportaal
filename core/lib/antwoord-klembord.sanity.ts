// ============================================================
//  Sanity-tests voor lib/antwoord-klembord.ts
//
//  Zwaartepunt: de garantie uit besluit 0098. Een kopieeractie wordt NIET
//  gelogd; daarmee is de herkomstregel in de gekopieerde tekst het enige dat
//  later nog vertelt waar een passage vandaan komt. Deze suite bewaakt dat er
//  geen pad bestaat — geen invoer, geen lege bronnenlijst, geen leeg blok —
//  waarlangs een kopie zónder bronnenlijst en zónder herkomstregel ontstaat.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/antwoord-klembord.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { parseerBlokken } from "./antwoord-parser";
import {
  bouwKopie,
  bouwKopieVanTekst,
  bronRegel,
  geciteerdeBronnen,
  heeftVerplichteHerkomst,
  herkomstRegel,
  type KopieBron,
  type KopieContext,
} from "./antwoord-klembord";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("antwoord-klembord sanity-tests:");

const CTX: KopieContext = {
  fondsnaam: "Stichting Pensioenfonds Horizon",
  datum: "31-07-2026",
  surface: "assistent",
};

const BRONNEN: KopieBron[] = [
  {
    nummer: 1,
    titel: "Transitieplan 2026 v0.9",
    bron: "Intern",
    paragraaf: "Hoofdstuk 3",
    pagina: 14,
    documentdatum: "02-07-2026",
    documentstatus: "concept",
  },
  {
    nummer: 2,
    titel: "Notulen bestuursvergadering",
    bron: "Intern",
    paragraaf: null,
    pagina: 3,
    documentdatum: "11-07-2026",
    documentstatus: "vastgesteld",
  },
];

const TABEL = [
  "| Besluit | Uiterlijk | Doorlooptijd |",
  "|---|---|---|",
  "| Invaarmethodiek | 18-09-2026 | 6 weken |",
  "| Compensatieregeling | 25-09-2026 | 4 weken |",
].join("\n");

// ── De harde garantie ────────────────────────────────────────────────────────

test("elke kopie draagt een herkomstregel — ook bij lege invoer", () => {
  const invoeren = ["", "   ", "Losse zin.", TABEL, "- punt\n- punt"];
  for (const invoer of invoeren) {
    const p = bouwKopieVanTekst(invoer, BRONNEN, CTX);
    assert.ok(p.tekst.includes("Gekopieerd uit"), `tekst mist herkomst bij: ${JSON.stringify(invoer)}`);
    assert.ok(p.tekst.includes("geen bestuurlijk besluit"), "tekst mist het voorbehoud");
    assert.ok(p.html.includes("Gekopieerd uit"), `html mist herkomst bij: ${JSON.stringify(invoer)}`);
  }
});

test("elke kopie draagt een bronnenblok — ook zonder enkele bronverwijzing", () => {
  // Géén bronnen aangeleverd EN geen marker → expliciete melding, geen stilzwijgen.
  const p = bouwKopieVanTekst("Een alinea zonder verwijzing.", [], CTX);
  assert.ok(p.tekst.includes("geen fondsdocumenten als bron aangeleverd"), p.tekst);
  assert.ok(p.html.includes("geen fondsdocumenten als bron aangeleverd"), p.html);
});

test("REGRESSIE: zonder [Bron N] maar MET aangeleverde bronnen wordt de bron niet ontkend", () => {
  // Dit is het gewone geval bij document-scope en "document doorgronden": de
  // SP_DOCUMENT_SCOPE_BREED_REGELS VERBIEDT daar de [Bron N]-notatie letterlijk
  // en SP_DOCUMENT_SCOPE_ALG_REGELS schrijft "(pag. X)" voor; in beide gevallen
  // levert het model geen genummerde verwijzingen. Een bronnenlijst die alleen
  // op markers steunt zou daar dus altijd leeg zijn — en het
  // antwoord ten onrechte als bronloos presenteren terwijl het per constructie
  // uitsluitend op het genoemde stuk steunt. Gevonden door de governance-review.
  const p = bouwKopieVanTekst(
    "Uit het transitieplan blijkt dat de invaarmethodiek nog openstaat (pag. 14).",
    BRONNEN,
    CTX,
  );
  assert.ok(!/geen fondsdocument/i.test(p.tekst), `mag de bron niet ontkennen:\n${p.tekst}`);
  assert.ok(!/geen bronverwijzing/i.test(p.tekst), p.tekst);
  assert.ok(p.tekst.includes("Gebruikte stukken bij dit antwoord"), p.tekst);
  assert.ok(p.tekst.includes("Transitieplan 2026 v0.9"), p.tekst);
  assert.ok(p.tekst.includes("Notulen bestuursvergadering"), p.tekst);
  // En de herkomstregel verwijst dan wél naar bronnen.
  assert.ok(p.tekst.includes("op basis van de hierboven vermelde bronnen"), p.tekst);
});

test("zonder bronnen belooft de herkomstregel er ook geen", () => {
  // Zou hier "op basis van de hierboven vermelde bronnen" staan, dan spreken
  // twee opeenvolgende regels elkaar tegen.
  const p = bouwKopieVanTekst("Een losse alinea.", [], CTX);
  assert.ok(p.tekst.includes("zonder fondsdocument als bron"), p.tekst);
  assert.ok(!p.tekst.includes("hierboven vermelde bronnen"), p.tekst);
});

test("ook met een LEGE bronnenlijst blijven beide onderdelen staan", () => {
  const p = bouwKopieVanTekst("Bewering [Bron 1].", [], CTX);
  assert.ok(p.tekst.includes("geen fondsdocumenten als bron aangeleverd"));
  assert.ok(p.tekst.includes("Gekopieerd uit"));
});

test("een payload zonder herkomstregel bereikt het klembord niet", () => {
  // Vervangt een eerdere, DEFECTE bewaking: `assert.equal(bouwKopie.length, 3)`
  // liet een vierde parameter mét default gewoon door, want Function.length telt
  // niet verder vanaf de eerste default. Nu een echte controle op de payload.
  assert.equal(heeftVerplichteHerkomst({ html: "<p>x</p>", tekst: "x" }), false);
  assert.equal(
    heeftVerplichteHerkomst({ html: "<p>Gekopieerd uit …</p>", tekst: "x" }),
    false,
    "één van beide formaten is niet genoeg",
  );
  const echt = bouwKopieVanTekst("Bewering [Bron 1].", BRONNEN, CTX);
  assert.equal(heeftVerplichteHerkomst(echt), true);
});

test("elke uitvoer van bouwKopie doorstaat de klembordsluis", () => {
  const gevallen: Array<[string, KopieBron[]]> = [
    ["", []],
    ["   ", BRONNEN],
    ["Losse zin.", []],
    ["Bewering [Bron 1].", BRONNEN],
    ["Bewering [Bron 9].", BRONNEN],
    [TABEL, BRONNEN],
    ["- punt\n- punt", []],
    ["## Kop", BRONNEN],
  ];
  for (const [tekst, bronnen] of gevallen) {
    assert.equal(
      heeftVerplichteHerkomst(bouwKopieVanTekst(tekst, bronnen, CTX)),
      true,
      `sluis faalt bij: ${JSON.stringify(tekst)}`,
    );
  }
});

test("de herkomstregel benoemt fonds, datum en surface", () => {
  const r = herkomstRegel(CTX, true);
  assert.ok(r.includes("Stichting Pensioenfonds Horizon"), r);
  assert.ok(r.includes("31-07-2026"), r);
  assert.ok(r.includes("AI samengesteld"), r);

  const agenda = herkomstRegel({ ...CTX, surface: "agendapunt" }, true);
  assert.ok(agenda.includes("agendapunt"), agenda);

  // Zonder fondsnaam blijft de regel grammaticaal heel.
  const zonder = herkomstRegel({ ...CTX, fondsnaam: null }, true);
  assert.ok(zonder.includes("Gekopieerd uit de AI-assistent in het bestuurdersportaal"), zonder);
});

// ── Bronnenlijst ─────────────────────────────────────────────────────────────

test("de bronregel bevat titel, vindplaats, datum en documentstatus", () => {
  const r = bronRegel(BRONNEN[0]);
  assert.ok(r.includes("[Bron 1]"), r);
  assert.ok(r.includes("Transitieplan 2026 v0.9"), r);
  assert.ok(r.includes("Hoofdstuk 3, pag. 14"), r);
  assert.ok(r.includes("02-07-2026"), r);
  assert.ok(/concept/i.test(r), r);
});

test("alleen de in DIT fragment geciteerde bronnen komen eronder te staan", () => {
  const p = bouwKopieVanTekst("Alleen deze bewering [Bron 2].", BRONNEN, CTX);
  assert.ok(p.tekst.includes("Notulen bestuursvergadering"), p.tekst);
  assert.ok(!p.tekst.includes("Transitieplan"), "bron 1 hoort er niet bij te staan");
});

test("geciteerdeBronnen vindt markers in alinea's, lijsten, koppen en tabelcellen", () => {
  const blokken = parseerBlokken(
    [
      "# Kop met [Bron 4]",
      "Alinea met [Bron 1].",
      "- lijstitem met [Bron 2]",
      "",
      "| A [Bron 3] | B |",
      "|---|---|",
      "| C | D [Bron 5] |",
    ].join("\n"),
  );
  assert.deepEqual(geciteerdeBronnen(blokken), [4, 1, 2, 3, 5]);
});

test("een dubbel geciteerde bron staat één keer in de lijst", () => {
  const blokken = parseerBlokken("Een [Bron 1] en nog eens [Bron 1].");
  assert.deepEqual(geciteerdeBronnen(blokken), [1]);
});

test("een dangling [Bron 9] wordt in de kopie zichtbaar gewaarschuwd", () => {
  // De weergave markeert dit met "⚠ Bron 9?". Zonder tegenmaatregel verdwijnt
  // dat signaal in Word en is een gehallucineerde verwijzing niet meer van een
  // geldige te onderscheiden. Gevonden door de governance- en de code-review.
  const p = bouwKopieVanTekst("Bewering [Bron 9].", BRONNEN, CTX);
  assert.ok(p.tekst.includes("[Bron 9]"), "de verwijzing blijft in de tekst staan");
  assert.ok(
    p.tekst.includes("kon niet aan een aangeleverde bron worden gekoppeld"),
    `waarschuwing ontbreekt:\n${p.tekst}`,
  );
  assert.ok(p.html.includes("kon niet aan een aangeleverde bron worden gekoppeld"), p.html);
});

test("meerdere dangling verwijzingen komen in één waarschuwing", () => {
  const p = bouwKopieVanTekst("A [Bron 8] en B [Bron 9].", BRONNEN, CTX);
  assert.ok(p.tekst.includes("[Bron 8], [Bron 9]"), p.tekst);
  assert.ok(p.tekst.includes("Controleer deze verwijzingen"), p.tekst);
});

test("de niet-genummerde markers krijgen een legenda, alleen voor wat voorkomt", () => {
  // In de weergave dragen deze vier een eigen kleur én een waarschuwende tooltip;
  // zonder legenda worden ze in de kopie tot dezelfde vlakke tekst platgeslagen.
  const p = bouwKopieVanTekst(
    "Duiding [Toelichting agendapunt] en context [Organisatieprofiel].",
    BRONNEN,
    CTX,
  );
  assert.ok(p.tekst.includes("[Toelichting agendapunt] = uit de toelichting"), p.tekst);
  assert.ok(p.tekst.includes("geen vastgestelde fondsbron"), p.tekst);
  assert.ok(p.tekst.includes("[Organisatieprofiel] ="), p.tekst);
  assert.ok(!p.tekst.includes("[Algemene kennis] ="), "geen legenda voor wat er niet staat");
});

// ── Formaten ─────────────────────────────────────────────────────────────────

test("T5 A4: een gekoppelde [Bron N] wordt scriptie-stijl (superscript / [ordinaal])", () => {
  const p = bouwKopieVanTekst("Zoals vastgesteld [Bron 1] en [Bron 2].", BRONNEN, CTX);
  // text/plain: platte-tekst-terugval met het LIJSTNUMMER, niet [Bron N].
  assert.ok(p.tekst.includes("Zoals vastgesteld [1] en [2]."), p.tekst);
  assert.ok(!p.tekst.includes("[Bron 1]") && !p.tekst.includes("[Bron 2]"), p.tekst);
  // text/html: hooggeplaatst cijfer.
  assert.ok(p.html.includes("<sup>1</sup>") && p.html.includes("<sup>2</sup>"), p.html);
  // De genummerde bronnenlijst draagt geen [Bron N]-prefix meer (cijfer = lijstnr).
  assert.ok(p.tekst.includes("1. Intern — Transitieplan 2026 v0.9"), p.tekst);
  assert.ok(p.tekst.includes("2. Intern — Notulen bestuursvergadering"), p.tekst);
});

test("T5 A4: het inline cijfer volgt de LIJSTvolgorde, niet het ruwe bron-nummer", () => {
  // Eerst [Bron 2] geciteerd, dan [Bron 1]: lijst = [2, 1], dus ordinaal 2→1, 1→2.
  const p = bouwKopieVanTekst("Eerst [Bron 2], dan [Bron 1].", BRONNEN, CTX);
  assert.ok(p.tekst.includes("Eerst [1], dan [2]."), p.tekst);
  assert.ok(p.tekst.includes("1. Intern — Notulen bestuursvergadering"), p.tekst);
  assert.ok(p.tekst.includes("2. Intern — Transitieplan 2026 v0.9"), p.tekst);
});

test("T5 A4: een dangling [Bron N] houdt géén ordinaal en blijft letterlijk", () => {
  const p = bouwKopieVanTekst("Geldig [Bron 1] en dangling [Bron 9].", BRONNEN, CTX);
  assert.ok(p.tekst.includes("Geldig [1]"), p.tekst);
  assert.ok(p.tekst.includes("[Bron 9]"), "dangling verwijzing moet zichtbaar blijven");
  assert.ok(p.html.includes("<sup>1</sup>"), p.html);
});

test("de overige herkomstmarkers blijven eveneens staan", () => {
  const p = bouwKopieVanTekst(
    "A [Algemene kennis] B [Volgens wetgeving] C [Toelichting agendapunt] D [Organisatieprofiel]",
    BRONNEN,
    CTX,
  );
  for (const m of [
    "[Algemene kennis]",
    "[Volgens wetgeving]",
    "[Toelichting agendapunt]",
    "[Organisatieprofiel]",
  ]) {
    assert.ok(p.tekst.includes(m), `${m} ontbreekt in text/plain`);
    assert.ok(p.html.includes(m), `${m} ontbreekt in text/html`);
  }
});

test("een tabel wordt in text/html een echte <table> met th en td", () => {
  const p = bouwKopieVanTekst(TABEL, BRONNEN, CTX);
  assert.ok(p.html.includes("<table"), p.html);
  assert.ok(p.html.includes("<th"), p.html);
  assert.ok(p.html.includes("<td"), p.html);
  assert.ok(p.html.includes("border-collapse"), "Word heeft inline opmaak nodig");
  assert.ok(p.html.includes("Invaarmethodiek"), p.html);
});

test("een tabel krijgt in text/plain TABS tussen de cellen (Excel-kolommen)", () => {
  const p = bouwKopieVanTekst(TABEL, BRONNEN, CTX);
  const regels = p.tekst.split("\n");
  assert.equal(regels[0], "Besluit\tUiterlijk\tDoorlooptijd");
  assert.equal(regels[1], "Invaarmethodiek\t18-09-2026\t6 weken");
  assert.equal(regels[2], "Compensatieregeling\t25-09-2026\t4 weken");
});

test("numerieke kolommen worden ook in de HTML-kopie rechts uitgelijnd", () => {
  const p = bouwKopieVanTekst(TABEL, BRONNEN, CTX);
  assert.ok(p.html.includes("text-align:right"), p.html);
});

test("lijsten behouden hun opsommings- of nummerteken in text/plain", () => {
  const ul = bouwKopieVanTekst("- Een\n- Twee", BRONNEN, CTX);
  assert.ok(ul.tekst.startsWith("- Een\n- Twee"), ul.tekst);
  const ol = bouwKopieVanTekst("1. Een\n2. Twee", BRONNEN, CTX);
  assert.ok(ol.tekst.startsWith("1. Een\n2. Twee"), ol.tekst);
});

test("inline-opmaak wordt HTML-opmaak, niet letterlijke sterretjes", () => {
  const p = bouwKopieVanTekst("Dit is **vet** en `code`.", BRONNEN, CTX);
  assert.ok(p.html.includes("<strong>vet</strong>"), p.html);
  assert.ok(p.html.includes("<code>code</code>"), p.html);
  assert.ok(p.tekst.includes("Dit is vet en code."), p.tekst);
});

test("HTML in de brontekst wordt ge-escaped, niet doorgegeven", () => {
  const p = bouwKopieVanTekst("Een <script>alert(1)</script> & een \"quote\".", BRONNEN, CTX);
  assert.ok(!p.html.includes("<script>"), p.html);
  assert.ok(p.html.includes("&lt;script&gt;"), p.html);
  assert.ok(p.html.includes("&amp;"), p.html);
  // In de platte tekst blijft de oorspronkelijke tekst staan.
  assert.ok(p.tekst.includes("<script>alert(1)</script>"), p.tekst);
});

test("ook een titel met HTML-tekens in de bronnenlijst wordt ge-escaped", () => {
  const p = bouwKopieVanTekst("Bewering [Bron 1].", [
    { ...BRONNEN[0], titel: "Plan <b>2026</b> & meer" },
  ], CTX);
  assert.ok(!p.html.includes("<b>2026</b>"), p.html);
  assert.ok(p.html.includes("&lt;b&gt;"), p.html);
});

test("een kop wordt vet, geen markdown-hekjes", () => {
  const p = bouwKopieVanTekst("## Openstaande besluiten", BRONNEN, CTX);
  assert.ok(p.html.includes("<strong>Openstaande besluiten</strong>"), p.html);
  assert.ok(!p.tekst.includes("##"), p.tekst);
});

test("volgorde: eerst de inhoud, dan de bronnen, dan de herkomstregel", () => {
  const p = bouwKopieVanTekst("Bewering [Bron 1].", BRONNEN, CTX);
  const iInhoud = p.tekst.indexOf("Bewering");
  const iBronnen = p.tekst.indexOf("Bronnen:");
  const iHerkomst = p.tekst.indexOf("Gekopieerd uit");
  assert.ok(iInhoud < iBronnen && iBronnen < iHerkomst, p.tekst);
});

console.log(`\n${n} sanity-tests geslaagd.`);
