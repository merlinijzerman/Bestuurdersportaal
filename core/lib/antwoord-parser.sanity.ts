// ============================================================
//  Sanity-tests voor lib/antwoord-parser.ts
//
//  De handgeschreven markdown-parser voedt sinds besluit 0079 TWEE schermen
//  (/ai en de inline agendapuntchat) en had tot deze tranche geen enkele
//  geautomatiseerde test. Deze suite legt het gedrag vast zoals het is —
//  inclusief de eigenaardigheden. Waar iets suboptimaal is, staat dat als
//  BEVINDING bij de test genoteerd: bevriezen, niet stilletjes repareren.
//
//  Bewust op de AST en niet op de gerenderde HTML: de opmaak verandert in
//  dezelfde tranche (si-tabel, leesmaat, kopstreepje). Een HTML-snapshot zou
//  dan omvallen en juist zijn regressiewaarde verliezen; de AST is invariant
//  onder styling.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/antwoord-parser.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  parseerBlokken,
  parseerInline,
  parseerInlineStukken,
  bronIndexVoor,
  isNumeriekeCel,
  kolomIsNumeriek,
  numeriekeKolommen,
  isTabelRij,
  isScheiding,
  splitCellen,
  type Blok,
  type InlineDeel,
} from "./antwoord-parser";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("antwoord-parser sanity-tests:");

// ── Hulpjes ──────────────────────────────────────────────────────────────────

/** Platte tekst van een inline-AST — markers worden weer letterlijk uitgeschreven. */
function tekstVan(delen: InlineDeel[]): string {
  return delen
    .map((d) => {
      switch (d.soort) {
        case "tekst":
          return d.stukken.map((s) => s.tekst).join("");
        case "bron":
          return `[Bron ${d.nummer}]`;
        case "kennis":
          return `[${d.label}]`;
        case "toelichting":
          return "[Toelichting agendapunt]";
        case "organisatieprofiel":
          return "[Organisatieprofiel]";
      }
    })
    .join("");
}

function soorten(blokken: Blok[]): string[] {
  return blokken.map((b) => b.soort);
}

// ── Alinea's ─────────────────────────────────────────────────────────────────

test("lege tekst levert geen blokken", () => {
  assert.deepEqual(parseerBlokken(""), []);
  assert.deepEqual(parseerBlokken("   \n\n  \n"), []);
});

test("enkele alinea", () => {
  const b = parseerBlokken("Het transitieplan is akkoord bevonden.");
  assert.equal(b.length, 1);
  assert.equal(b[0].soort, "alinea");
  assert.equal(tekstVan((b[0] as { inline: InlineDeel[] }).inline), "Het transitieplan is akkoord bevonden.");
});

test("lege regel scheidt alinea's; de lege regel zelf levert geen blok", () => {
  const b = parseerBlokken("Eerste.\n\nTweede.");
  assert.deepEqual(soorten(b), ["alinea", "alinea"]);
});

// ── Inline-opmaak ────────────────────────────────────────────────────────────

test("**vet**", () => {
  const s = parseerInlineStukken("Het bestuur wenst **meer analyse**.");
  assert.deepEqual(
    s.map((x) => [x.soort, x.tekst]),
    [
      ["plat", "Het bestuur wenst "],
      ["vet", "meer analyse"],
      ["plat", "."],
    ],
  );
});

test("*cursief* en _cursief_", () => {
  assert.deepEqual(
    parseerInlineStukken("dit is *schuin* hier").map((x) => [x.soort, x.tekst]),
    [
      ["plat", "dit is "],
      ["cursief", "schuin"],
      ["plat", " hier"],
    ],
  );
  assert.deepEqual(
    parseerInlineStukken("dit is _schuin_ hier").map((x) => [x.soort, x.tekst]),
    [
      ["plat", "dit is "],
      ["cursief", "schuin"],
      ["plat", " hier"],
    ],
  );
});

test("`code`", () => {
  assert.deepEqual(
    parseerInlineStukken("De waarde `fonds_id` is verplicht.").map((x) => [x.soort, x.tekst]),
    [
      ["plat", "De waarde "],
      ["code", "fonds_id"],
      ["plat", " is verplicht."],
    ],
  );
});

test("vet wint van cursief (** wordt niet als twee losse * gelezen)", () => {
  const s = parseerInlineStukken("**vet**");
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].soort, s[0].tekst], ["vet", "vet"]);
});

test("ongesloten opmaak blijft platte tekst (half gestreamd)", () => {
  for (const invoer of ["Halverwege **gestreamd", "Halverwege `gestreamd", "Halverwege *gestreamd"]) {
    const s = parseerInlineStukken(invoer);
    assert.deepEqual(s.map((x) => x.soort), ["plat"]);
    assert.equal(s[0].tekst, invoer);
  }
});

// ── Lijsten ──────────────────────────────────────────────────────────────────

test("ongeordende lijst met - en met *", () => {
  for (const teken of ["-", "*"]) {
    const b = parseerBlokken(`${teken} Eerste\n${teken} Tweede`);
    assert.equal(b.length, 1);
    assert.equal(b[0].soort, "lijst");
    const l = b[0] as Extract<Blok, { soort: "lijst" }>;
    assert.equal(l.geordend, false);
    assert.deepEqual(l.items.map(tekstVan), ["Eerste", "Tweede"]);
  }
});

test("geordende lijst", () => {
  const b = parseerBlokken("1. Eerste\n2. Tweede");
  const l = b[0] as Extract<Blok, { soort: "lijst" }>;
  assert.equal(l.geordend, true);
  assert.deepEqual(l.items.map(tekstVan), ["Eerste", "Tweede"]);
});

test("wisseling ul→ol sluit de eerste lijst", () => {
  const b = parseerBlokken("- Een\n- Twee\n1. Een\n2. Twee");
  assert.deepEqual(soorten(b), ["lijst", "lijst"]);
  assert.equal((b[0] as Extract<Blok, { soort: "lijst" }>).geordend, false);
  assert.equal((b[1] as Extract<Blok, { soort: "lijst" }>).geordend, true);
});

test("BEVINDING: de nummering van een geordende lijst gaat verloren", () => {
  // "3." en "7." leveren twee items op; de renderer telt via <ol> altijd vanaf 1.
  // Bevroren gedrag — een antwoord dat bij 3 begint, toont 1.
  const l = parseerBlokken("3. Derde\n7. Zevende")[0] as Extract<Blok, { soort: "lijst" }>;
  assert.deepEqual(l.items.map(tekstVan), ["Derde", "Zevende"]);
});

test("BEVINDING: geneste lijsten worden platgeslagen tot één niveau", () => {
  const l = parseerBlokken("- Top\n  - Genest\n- Top twee")[0] as Extract<Blok, { soort: "lijst" }>;
  assert.equal(l.items.length, 3);
  assert.deepEqual(l.items.map(tekstVan), ["Top", "Genest", "Top twee"]);
});

// ── Koppen ───────────────────────────────────────────────────────────────────

test("koppen # t/m ###### met hun niveau", () => {
  for (const niveau of [1, 2, 3, 4, 5, 6]) {
    const b = parseerBlokken(`${"#".repeat(niveau)} Openstaande besluiten`);
    assert.equal(b[0].soort, "kop");
    const k = b[0] as Extract<Blok, { soort: "kop" }>;
    assert.equal(k.niveau, niveau);
    assert.equal(tekstVan(k.inline), "Openstaande besluiten");
  }
});

test("een # zonder spatie is geen kop", () => {
  assert.equal(parseerBlokken("#Geenspatie")[0].soort, "alinea");
});

// ── Tabellen ─────────────────────────────────────────────────────────────────

const TABEL = [
  "| Besluit | Uiterlijk | Doorlooptijd |",
  "|---|---|---|",
  "| Invaarmethodiek | 18-09-2026 | 6 weken |",
  "| Compensatieregeling | 25-09-2026 | 4 weken |",
].join("\n");

test("tabel: kop + scheiding + rijen", () => {
  const b = parseerBlokken(TABEL);
  assert.equal(b.length, 1);
  const t = b[0] as Extract<Blok, { soort: "tabel" }>;
  assert.deepEqual(t.kop.map(tekstVan), ["Besluit", "Uiterlijk", "Doorlooptijd"]);
  assert.equal(t.rijen.length, 2);
  assert.deepEqual(t.rijen[0].map(tekstVan), ["Invaarmethodiek", "18-09-2026", "6 weken"]);
  assert.deepEqual(t.rijen[1].map(tekstVan), ["Compensatieregeling", "25-09-2026", "4 weken"]);
});

test("tabel tussen alinea's; de tabel stopt bij een lege regel", () => {
  const b = parseerBlokken(`Inleiding.\n\n${TABEL}\n\nSlot.`);
  assert.deepEqual(soorten(b), ["alinea", "tabel", "alinea"]);
});

test("een tabel direct na een lijst sluit die lijst", () => {
  const b = parseerBlokken(`- Punt een\n- Punt twee\n${TABEL}`);
  assert.deepEqual(soorten(b), ["lijst", "tabel"]);
});

test("scheidingsvarianten worden herkend", () => {
  for (const sch of ["|---|---|", "| --- | --- |", "|:---|---:|", "|:---:|:---:|", "|-|-|"]) {
    assert.equal(isScheiding(sch), true, sch);
    const b = parseerBlokken(`| A | B |\n${sch}\n| 1 | 2 |`);
    assert.equal(b[0].soort, "tabel", sch);
  }
});

test("BEVINDING: uitlijningsdubbelepunten worden genegeerd", () => {
  // |:---|---:| draagt in markdown links/rechts-uitlijning. De parser bewaart
  // die informatie niet; de uitlijning wordt in de renderlaag uit de CELINHOUD
  // afgeleid (deterministische regex), niet uit de scheidingsregel.
  const t = parseerBlokken("| A | B |\n|:---|---:|\n| 1 | 2 |")[0] as Extract<Blok, { soort: "tabel" }>;
  assert.deepEqual(Object.keys(t).sort(), ["kop", "rijen", "soort"]);
});

test("BEVINDING: ragged rijen worden niet aangevuld of afgekapt", () => {
  const t = parseerBlokken("| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |")[0] as Extract<
    Blok,
    { soort: "tabel" }
  >;
  assert.equal(t.kop.length, 3);
  assert.equal(t.rijen[0].length, 1);
  assert.equal(t.rijen[1].length, 4);
});

test("pipe-regels ZONDER scheidingsregel blijven gewone alinea's", () => {
  const b = parseerBlokken("| A | B |\n| 1 | 2 |");
  assert.deepEqual(soorten(b), ["alinea", "alinea"]);
  assert.equal(tekstVan((b[0] as Extract<Blok, { soort: "alinea" }>).inline), "| A | B |");
});

test("een losse scheidingsregel is een alinea", () => {
  assert.deepEqual(soorten(parseerBlokken("|---|---|")), ["alinea"]);
});

test("een kopregel zonder sluitpipe start geen tabel", () => {
  // isTabelRij eist een pipe aan BEIDE kanten.
  assert.equal(isTabelRij("| A | B"), false);
  assert.deepEqual(soorten(parseerBlokken("| A | B\n|---|---|\n| 1 | 2 |")), [
    "alinea",
    "alinea",
    "alinea",
  ]);
});

test("splitCellen strippt de buitenste pipes en trimt", () => {
  assert.deepEqual(splitCellen("|  a |b  |"), ["a", "b"]);
  assert.deepEqual(splitCellen("| a | | c |"), ["a", "", "c"]);
});

test("markers en opmaak werken binnen tabelcellen", () => {
  const t = parseerBlokken("| Onderwerp | Bron |\n|---|---|\n| Invaren [Bron 1] | **vet** |")[0] as Extract<
    Blok,
    { soort: "tabel" }
  >;
  assert.equal(t.rijen[0][0][1].soort, "bron");
  const cel = t.rijen[0][1][0];
  assert.equal(cel.soort, "tekst");
  assert.equal(cel.soort === "tekst" && cel.stukken[0].soort, "vet");
});

// ── Half gestreamde tabel (het gedrag tijdens het antwoorden) ────────────────

test("half gestreamde tabel: pipe-rijen zijn tekst tot de scheidingsregel binnen is", () => {
  const kop = "| Besluit | Uiterlijk |";
  const sch = "|---|---|";
  const rij = "| Invaren | 18-09-2026 |";

  // 1) alleen de kopregel → alinea
  assert.deepEqual(soorten(parseerBlokken(kop)), ["alinea"]);
  // 2) kop + halve scheidingsregel → nog steeds tekst
  assert.deepEqual(soorten(parseerBlokken(`${kop}\n|--`)), ["alinea", "alinea"]);
  // 3) kop + volledige scheidingsregel → tabel zonder rijen
  const t0 = parseerBlokken(`${kop}\n${sch}`);
  assert.deepEqual(soorten(t0), ["tabel"]);
  assert.equal((t0[0] as Extract<Blok, { soort: "tabel" }>).rijen.length, 0);
  // 4) plus één rij
  const t1 = parseerBlokken(`${kop}\n${sch}\n${rij}`);
  assert.equal((t1[0] as Extract<Blok, { soort: "tabel" }>).rijen.length, 1);
});

// Hulpje: aantal tabelrijen in een prefix, of null als er geen tabel is.
function rijenBij(tekst: string): number | null {
  const t = parseerBlokken(tekst).find((b) => b.soort === "tabel") as
    | Extract<Blok, { soort: "tabel" }>
    | undefined;
  return t ? t.rijen.length : null;
}

test("BEVINDING: tijdens het streamen flikkert de tabel op tekenniveau (scheidingsregel)", () => {
  // Een scheidingsregel is pas geldig als hij op | eindigt. Terwijl hij binnenkomt
  // is "|---|" al een geldige scheiding voor een 1-koloms tabel, "|---|-" niet.
  // Gevolg: de tabel verschijnt en verdwijnt per pipe tot de regel compleet is.
  const basis = "| A | B |\n";
  assert.equal(rijenBij(basis + "|---"), null);
  assert.equal(rijenBij(basis + "|---|"), 0); // even wél een tabel
  assert.equal(rijenBij(basis + "|---|-"), null); // en weer niet
  assert.equal(rijenBij(basis + "|---|---"), null);
  assert.equal(rijenBij(basis + "|---|---|"), 0);
});

test("BEVINDING: tijdens het streamen flikkert ook de laatste rij (rijaantal daalt)", () => {
  // "| 1 |" is een complete rij van ÉÉN cel → rijen=1. Zodra het volgende teken
  // binnenkomt ("| 1 | 2") eindigt de regel niet meer op | en telt hij niet meer
  // → rijen=0. De rij komt compleet terug bij "| 1 | 2 |". Zichtbaar als een
  // knipperende laatste regel met tijdelijk het verkeerde aantal kolommen.
  const basis = "| A | B |\n|---|---|\n";
  assert.equal(rijenBij(basis + "| 1 |"), 1);
  assert.equal(rijenBij(basis + "| 1 | 2"), 0);
  assert.equal(rijenBij(basis + "| 1 | 2 |"), 1);
});

test("streameigenschap op regelgrenzen: rijen groeien monotoon, afgeronde rijen wijzigen niet", () => {
  // Op REGELGRENZEN — de granulariteit waarop een tabel visueel afgerond is —
  // is het gedrag wél netjes: de tabel verschijnt zodra de scheidingsregel
  // compleet is, groeit met één rij per regel, en eerdere rijen blijven staan.
  const regels = [
    "Inleiding met [Bron 1].",
    "",
    "| Besluit | Uiterlijk | Doorlooptijd |",
    "|---|---|---|",
    ...Array.from(
      { length: 12 },
      (_, i) => `| Besluit ${i + 1} | 0${(i % 9) + 1}-09-2026 | ${i + 1} weken |`,
    ),
    "",
    "Slot.",
  ];
  const volledig = regels.join("\n");

  let vorigeRijen: string[][] = [];
  let tabelGezien = false;
  let pos = 0;
  for (const regel of regels) {
    pos += regel.length + 1;
    const blokken = parseerBlokken(volledig.slice(0, Math.min(pos, volledig.length)));
    const tabel = blokken.find((b) => b.soort === "tabel") as
      | Extract<Blok, { soort: "tabel" }>
      | undefined;
    if (!tabel) {
      assert.equal(tabelGezien, false, "een herkende tabel verdween op een regelgrens");
      continue;
    }
    tabelGezien = true;
    const rijen = tabel.rijen.map((r) => r.map(tekstVan));
    assert.ok(
      rijen.length >= vorigeRijen.length,
      `rijen namen af op een regelgrens: ${vorigeRijen.length} → ${rijen.length}`,
    );
    for (let r = 0; r < vorigeRijen.length; r++) {
      assert.deepEqual(rijen[r], vorigeRijen[r], `rij ${r} wijzigde tijdens het streamen`);
    }
    vorigeRijen = rijen;
  }
  assert.equal(vorigeRijen.length, 12);
});

test("de parser gooit niet op afgekapte invoer", () => {
  for (const invoer of ["|", "|-", "| a |\n|-", "**", "`", "#", "1.", "- ", "[Bron", "[Bron 1"]) {
    assert.doesNotThrow(() => parseerBlokken(invoer), invoer);
  }
});

// ── Citatiemarkers ───────────────────────────────────────────────────────────

test("[Bron N] wordt een eigen segment", () => {
  const d = parseerInline("Zoals vastgesteld [Bron 1] en [Bron 12].");
  assert.deepEqual(
    d.map((x) => x.soort),
    ["tekst", "bron", "tekst", "bron", "tekst"],
  );
  assert.equal(d[1].soort === "bron" && d[1].nummer, 1);
  assert.equal(d[3].soort === "bron" && d[3].nummer, 12);
});

test("[Algemene kennis] — met en zonder herkende instantie", () => {
  const zonder = parseerInline("Dit is [Algemene kennis].");
  assert.equal(zonder[1].soort, "kennis");
  assert.equal(zonder[1].soort === "kennis" && zonder[1].label, "Algemene kennis");
  assert.equal(zonder[1].soort === "kennis" && zonder[1].instantie, null);

  // De instantie wordt uit de HELE regel gehaald, niet uit het segment.
  const met = parseerInline("Volgens DNB is dit [Algemene kennis].");
  assert.equal(met[1].soort === "kennis" && met[1].instantie, "DNB");
});

test("[Volgens wetgeving]", () => {
  const d = parseerInline("Op grond van de Pensioenwet [Volgens wetgeving].");
  assert.equal(d[1].soort, "kennis");
  assert.equal(d[1].soort === "kennis" && d[1].label, "Volgens wetgeving");
});

test("[Toelichting agendapunt] (ADR 0028)", () => {
  const d = parseerInline("Volgens de toelichting [Toelichting agendapunt].");
  assert.equal(d[1].soort, "toelichting");
});

test("[Organisatieprofiel] (OP-4)", () => {
  const d = parseerInline("Het fonds kent [Organisatieprofiel] drie organen.");
  assert.equal(d[1].soort, "organisatieprofiel");
});

test("markers zijn hoofdletterongevoelig", () => {
  assert.equal(parseerInline("[algemene kennis]")[0].soort, "kennis");
  assert.equal(parseerInline("[VOLGENS WETGEVING]")[0].soort, "kennis");
  assert.equal(parseerInline("[bron 3]")[0].soort, "bron");
  assert.equal(parseerInline("[organisatieprofiel]")[0].soort, "organisatieprofiel");
});

test("alle markersoorten in één regel", () => {
  const d = parseerInline(
    "A [Bron 1] B [Algemene kennis] C [Volgens wetgeving] D [Toelichting agendapunt] E [Organisatieprofiel] F",
  );
  assert.deepEqual(
    d.filter((x) => x.soort !== "tekst").map((x) => x.soort),
    ["bron", "kennis", "kennis", "toelichting", "organisatieprofiel"],
  );
});

test("BEVINDING: **vet** dat over een marker heen loopt, wordt niet herkend", () => {
  // De marker splitst eerst; de twee helften houden elk één losse **.
  const d = parseerInline("**vet [Bron 1] doorlopend**");
  const eerste = d[0];
  assert.equal(eerste.soort, "tekst");
  assert.equal(eerste.soort === "tekst" && eerste.stukken[0].soort, "plat");
});

// ── Bronkoppeling (dangling verwijzingen) ────────────────────────────────────

test("bronIndexVoor koppelt geldige nummers", () => {
  assert.equal(bronIndexVoor(1, 4), 0);
  assert.equal(bronIndexVoor(4, 4), 3);
});

test("dangling [Bron 9] zonder bijbehorende bron levert geen index", () => {
  assert.equal(bronIndexVoor(9, 4), null);
  assert.equal(bronIndexVoor(1, 0), null);
  // De renderer toont hier de zichtbare "⚠ Bron 9?"-markering.
  const d = parseerInline("Zoals vastgesteld [Bron 9].");
  assert.equal(d[1].soort === "bron" && d[1].nummer, 9);
});

test("BEVINDING: [Bron 0] is altijd ongeldig (index -1)", () => {
  assert.equal(bronIndexVoor(0, 4), null);
});

// ── Keystabiliteit (remount-gedrag tijdens het streamen) ─────────────────────

test("segmenten dragen hun oorspronkelijke splitsindex als key", () => {
  const d = parseerInline("A [Bron 1] B");
  assert.deepEqual(d.map((x) => x.k), [0, 1, 2]);
  // Een lege eerste helft laat de nummering staan: [Bron 1] houdt k=1.
  const e = parseerInline("[Bron 1] B");
  assert.deepEqual(e.map((x) => x.k), [1, 2]);
});

// ── Kolomuitlijning (stap 1a — deterministische regex op de celinhoud) ───────

test("datums, bedragen, percentages en duur gelden als numeriek", () => {
  const numeriek = [
    "18-09-2026", "18/09/2026", "2026-09-18", "2 juli 2026", "sep 2026", "Q3 2026", "2026",
    "€ 1.250.000", "€1.250,50", "-1.250,50", "12,5 mln", "3,4 mld",
    "4,2%", "-0.5 %", "+12%",
    "12", "1.250", "0,75", "-3",
    "6 weken", "1 dag", "3 maanden", "2 kwartalen", "1,5 jaar",
    // Randgevallen uit de code-review: gangbaar in NL-pensioentabellen.
    "€ 1.250,-", "1.250 euro", "± 3%", "2026 Q3",
  ];
  for (const v of numeriek) assert.equal(isNumeriekeCel(v), true, v);
});

test("tekst, gemengde cellen en losse woorden gelden niet als numeriek", () => {
  const tekstueel = [
    "Invaarmethodiek", "Gevoeligheidsanalyse actuaris", "Geen",
    "18-09-2026 (onder voorbehoud)", "circa 6 weken", "6 weken en 3 dagen",
    "ja", "€", "%", "versie 1.2.3",
  ];
  for (const v of tekstueel) assert.equal(isNumeriekeCel(v), false, v);
});

test("een kolom is numeriek als alle niet-neutrale cellen dat zijn", () => {
  assert.equal(kolomIsNumeriek(["18-09-2026", "25-09-2026", "30-09-2026"]), true);
  assert.equal(kolomIsNumeriek(["6 weken", "4 weken", "2 weken"]), true);
  assert.equal(kolomIsNumeriek(["18-09-2026", "nader te bepalen"]), false);
});

test("lege cellen en streepjes breken de kolom niet, maar dragen hem ook niet", () => {
  assert.equal(kolomIsNumeriek(["18-09-2026", "", "–", "n.v.t.", "25-09-2026"]), true);
  assert.equal(kolomIsNumeriek(["", "-", "n.v.t."]), false, "alleen neutraal → geen uitlijning");
  assert.equal(kolomIsNumeriek([]), false, "lege kolom → geen uitlijning");
});

test("numeriekeKolommen leest de bodyrijen, niet de kopregel", () => {
  const t = parseerBlokken(
    [
      "| Besluit | Uiterlijk | Doorlooptijd | Afhankelijkheid |",
      "|---|---|---|---|",
      "| Invaarmethodiek | 18-09-2026 | 6 weken | Gevoeligheidsanalyse |",
      "| Compensatieregeling | 25-09-2026 | 4 weken | Advies VO |",
      "| Communicatiekalender | 30-09-2026 | 2 weken | Geen |",
    ].join("\n"),
  )[0] as Extract<Blok, { soort: "tabel" }>;
  // Kolom 0 en 3 zijn tekst, 1 (datums) en 2 (duur) numeriek. De kopcel volgt.
  assert.deepEqual(numeriekeKolommen(t), [false, true, true, false]);
});

test("een kopcel met een getal maakt de kolom niet numeriek", () => {
  const t = parseerBlokken("| 2026 | Onderwerp |\n|---|---|\n| Invaren | Compensatie |")[0] as Extract<
    Blok,
    { soort: "tabel" }
  >;
  assert.deepEqual(numeriekeKolommen(t), [false, false]);
});

test("een cel met een [Bron N] telt als tekst, niet als getal", () => {
  const t = parseerBlokken("| Bedrag |\n|---|\n| 1.250 [Bron 1] |")[0] as Extract<
    Blok,
    { soort: "tabel" }
  >;
  assert.deepEqual(numeriekeKolommen(t), [false]);
});

test("ragged rijen: ontbrekende cellen tellen niet mee voor de kolom", () => {
  const t = parseerBlokken("| A | B |\n|---|---|\n| x | 12 |\n| y |")[0] as Extract<
    Blok,
    { soort: "tabel" }
  >;
  assert.deepEqual(numeriekeKolommen(t), [false, true]);
});

console.log(`\n${n} sanity-tests geslaagd.`);
