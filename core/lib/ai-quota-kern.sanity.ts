// ============================================================================
//  Sanity-tests voor core/lib/ai-quota-kern.ts (besluit 0180 — AI-begrenzing).
//
//  Dit bestand is de EXECUTABLE SPEC van het tellergedeelte van
//  `fn_ai_reserveer_intern`. Wijkt de SQL af van wat hier staat, dan is één van
//  beide fout — dezelfde rol die rate-limit.sanity.ts speelt voor
//  fn_rate_limit_check. Gepind worden:
//
//   * de UTC-maandgrens en de Retry-After tot de volgende kalendermaand;
//   * de drempels 50% / 80% / 100% (waarschuwen blokkeert niet);
//   * de "precies op de grens mag nog"-regel bij het reserveren;
//   * dat het SMALSTE geraakte bereik als reden wordt gemeld;
//   * dat `ocr` nul AI-acties verbruikt en OCR-pagina's apart begrenst;
//   * dat `fonds_id = null` alleen kan bij een expliciet globaal actietype;
//   * de model-allowlist inclusief tijdelijk venster (FR-4);
//   * dat een actiestatus alleen vooruit mag.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/ai-quota-kern.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  ACTIETYPES,
  ACTIETYPE_NAMEN,
  QUOTA_STANDAARD,
  SWITCH_SLEUTELS,
  beoordeelQuota,
  beoordeelStand,
  isActietype,
  isVerlopen,
  maandSleutel,
  magOvergaan,
  modelToegestaan,
  secondenTotVolgendeMaand,
  specVoor,
  startVolgendeMaand,
  type Actietype,
  type Limieten,
  type Tellers,
} from "./ai-quota-kern";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const LIMIETEN: Limieten = { ...QUOTA_STANDAARD };

function tellers(t: Partial<Tellers> = {}): Tellers {
  return { gebruiker: 0, fonds: 0, globaal: 0, ocrFonds: 0, ...t };
}

// ── 1. Kalendermaand in UTC ─────────────────────────────────────────────────

test("maandSleutel bucket op de UTC-maand, niet op lokale tijd", () => {
  assert.equal(maandSleutel(new Date("2026-08-15T12:00:00Z")), "2026-08-01");
  assert.equal(maandSleutel(new Date("2026-01-01T00:00:00Z")), "2026-01-01");
  assert.equal(maandSleutel(new Date("2026-12-31T23:59:59Z")), "2026-12-01");
});

test("Een moment dat in Amsterdam al de nieuwe maand is, telt in UTC nog oud", () => {
  // 31 juli 23:30 UTC = 1 augustus 01:30 in Amsterdam (zomertijd, UTC+2).
  // De teller volgt UTC; de UI legt dat uit. Dit is de afspraak, geen bug.
  assert.equal(maandSleutel(new Date("2026-07-31T23:30:00Z")), "2026-07-01");
});

test("startVolgendeMaand rolt correct over het jaar heen", () => {
  assert.equal(
    startVolgendeMaand(new Date("2026-12-05T10:00:00Z")).toISOString(),
    "2027-01-01T00:00:00.000Z"
  );
  assert.equal(
    startVolgendeMaand(new Date("2026-01-31T23:59:59Z")).toISOString(),
    "2026-02-01T00:00:00.000Z"
  );
});

test("secondenTotVolgendeMaand is de Retry-After en nooit nul of negatief", () => {
  // Precies één uur voor de maandwissel.
  assert.equal(secondenTotVolgendeMaand(new Date("2026-08-31T23:00:00Z")), 3600);
  // Op de allerlaatste milliseconde blijft het minimaal 1.
  assert.ok(secondenTotVolgendeMaand(new Date("2026-08-31T23:59:59.999Z")) >= 1);
});

// ── 2. Drempels: waarschuwen blokkeert niet ─────────────────────────────────

test("Drempels slaan exact op 50% en 80% om", () => {
  assert.equal(beoordeelStand(74, 150).status, "ruim"); // 49,3%
  assert.equal(beoordeelStand(75, 150).status, "waarschuwing"); // exact 50%
  assert.equal(beoordeelStand(119, 150).status, "waarschuwing"); // 79,3%
  assert.equal(beoordeelStand(120, 150).status, "verhoogd"); // exact 80%
});

test("Blokkeren gebeurt pas bij 100%, niet eerder", () => {
  assert.equal(beoordeelStand(149, 150).status, "verhoogd");
  assert.equal(beoordeelStand(150, 150).status, "geblokkeerd");
  assert.equal(beoordeelStand(151, 150).status, "geblokkeerd");
});

test("Een limiet van 0 is dicht, niet onbeperkt", () => {
  // Anders zou een tikfout in de beheer-UI een stille bypass worden.
  const stand = beoordeelStand(0, 0);
  assert.equal(stand.status, "geblokkeerd");
  assert.equal(stand.aandeel, 1);
  assert.equal(stand.resterend, 0);
});

test("Resterend telt nooit onder nul", () => {
  assert.equal(beoordeelStand(200, 150).resterend, 0);
});

// ── 3. Reserveren: precies op de grens mag nog ──────────────────────────────

test("De 150e actie van een gebruiker mag; de 151e niet", () => {
  assert.deepEqual(beoordeelQuota("chat", tellers({ gebruiker: 149 }), LIMIETEN, 0), {
    toegestaan: true,
  });
  assert.deepEqual(beoordeelQuota("chat", tellers({ gebruiker: 150 }), LIMIETEN, 0), {
    toegestaan: false,
    reden: "quotum_gebruiker",
  });
});

test("Fonds op 500 blokkeert, ook als de gebruiker zelf nog ruimte heeft", () => {
  assert.deepEqual(beoordeelQuota("chat", tellers({ gebruiker: 3, fonds: 500 }), LIMIETEN, 0), {
    toegestaan: false,
    reden: "quotum_fonds",
  });
});

test("Preview op 1.200 blokkeert alles, ook een ruim zittend fonds", () => {
  assert.deepEqual(beoordeelQuota("chat", tellers({ globaal: 1200 }), LIMIETEN, 0), {
    toegestaan: false,
    reden: "quotum_globaal",
  });
});

test("Het smalste geraakte bereik wordt gemeld", () => {
  // Alle drie zitten vol; de gebruiker heeft alleen iets aan de eigen melding.
  const alles = tellers({ gebruiker: 150, fonds: 500, globaal: 1200 });
  assert.deepEqual(beoordeelQuota("chat", alles, LIMIETEN, 0), {
    toegestaan: false,
    reden: "quotum_gebruiker",
  });
});

test("Een globaal actietype raakt gebruiker- en fondsquotum niet", () => {
  // generiek_curatie heeft geen fonds; een vol gebruikers-/fondsquotum van een
  // willekeurig fonds mag platformcuratie niet blokkeren.
  const vol = tellers({ gebruiker: 999, fonds: 999, globaal: 10 });
  assert.deepEqual(beoordeelQuota("generiek_curatie", vol, LIMIETEN, 0), { toegestaan: true });
});

test("Een globaal actietype telt wél mee voor het Preview-quotum", () => {
  assert.deepEqual(beoordeelQuota("aqlab_run", tellers({ globaal: 1200 }), LIMIETEN, 0), {
    toegestaan: false,
    reden: "quotum_globaal",
  });
});

// ── 4. OCR is een eigen grootheid ───────────────────────────────────────────

test("OCR verbruikt nul AI-acties", () => {
  assert.equal(ACTIETYPES.ocr.aiActies, 0);
  // Een gebruiker die op 150 AI-acties zit, kan nog steeds OCR laten draaien —
  // dat is een aparte teller met een eigen quotum.
  assert.deepEqual(
    beoordeelQuota("ocr", tellers({ gebruiker: 150, fonds: 500, globaal: 1200 }), LIMIETEN, 10),
    { toegestaan: true }
  );
});

test("OCR-pagina's blokkeren op 1.000 per fonds", () => {
  assert.deepEqual(beoordeelQuota("ocr", tellers({ ocrFonds: 990 }), LIMIETEN, 10), {
    toegestaan: true,
  });
  assert.deepEqual(beoordeelQuota("ocr", tellers({ ocrFonds: 991 }), LIMIETEN, 10), {
    toegestaan: false,
    reden: "quotum_ocr",
  });
});

test("Een vol OCR-quotum blokkeert niet-OCR-functionaliteit niet", () => {
  assert.deepEqual(beoordeelQuota("chat", tellers({ ocrFonds: 5000 }), LIMIETEN, 0), {
    toegestaan: true,
  });
});

test("Nul aangeboden pagina's raakt het OCR-quotum niet", () => {
  // Een document dat volledig uit de PDF-tekstlaag komt.
  assert.deepEqual(beoordeelQuota("ocr", tellers({ ocrFonds: 1000 }), LIMIETEN, 0), {
    toegestaan: true,
  });
});

// ── 5. fonds_id = null is geen bypass ───────────────────────────────────────

test("Alleen expliciet globale actietypes mogen zonder fonds", () => {
  const globaal = ACTIETYPE_NAMEN.filter((a) => ACTIETYPES[a].bereik === "globaal");
  assert.deepEqual(globaal.sort(), [
    "aqlab_adhoc",
    "aqlab_run",
    "generiek_curatie",
    "ocr_generiek",
  ]);
});

test("Geen enkel sessiegebonden actietype is globaal", () => {
  for (const naam of ACTIETYPE_NAMEN) {
    const spec = ACTIETYPES[naam];
    if (spec.viaGebruiker) {
      assert.equal(spec.bereik, "fonds", `${naam} is via een sessie bereikbaar én globaal`);
    }
  }
});

test("Elk actietype is via minstens één pad bereikbaar", () => {
  for (const naam of ACTIETYPE_NAMEN) {
    const spec = ACTIETYPES[naam];
    assert.ok(spec.viaGebruiker || spec.viaSysteem, `${naam} is nergens aanroepbaar`);
  }
});

test("Een onbekend actietype bestaat niet en levert geen spec", () => {
  assert.equal(isActietype("chat"), true);
  assert.equal(isActietype("gratis_tokens"), false);
  assert.equal(specVoor("gratis_tokens"), null);
});

// ── 6. Model-allowlist en tijdelijk venster (FR-4) ──────────────────────────

const NU = new Date("2026-08-15T12:00:00Z");

test("Een actief model zonder venster is toegestaan", () => {
  assert.deepEqual(
    modelToegestaan({ actief: true, vensterStart: null, vensterEind: null }, NU),
    { toegestaan: true }
  );
});

test("Een onbekend of inactief model is niet toegestaan", () => {
  assert.deepEqual(modelToegestaan(null, NU), {
    toegestaan: false,
    reden: "model_niet_toegestaan",
  });
  assert.deepEqual(
    modelToegestaan({ actief: false, vensterStart: null, vensterEind: null }, NU),
    { toegestaan: false, reden: "model_niet_toegestaan" }
  );
});

test("Een AQLab-venster laat het model binnen de tijd toe en daarbuiten niet", () => {
  const venster = {
    actief: true,
    vensterStart: "2026-08-15T10:00:00Z",
    vensterEind: "2026-08-15T14:00:00Z",
  };
  assert.deepEqual(modelToegestaan(venster, NU), { toegestaan: true });
  assert.deepEqual(modelToegestaan(venster, new Date("2026-08-15T09:59:59Z")), {
    toegestaan: false,
    reden: "model_buiten_venster",
  });
  // Na de eindtijd vervalt de toestemming VANZELF — geen beheerhandeling nodig.
  assert.deepEqual(modelToegestaan(venster, new Date("2026-08-15T14:00:00Z")), {
    toegestaan: false,
    reden: "model_buiten_venster",
  });
});

test("Een half ingevuld venster is fail-closed", () => {
  assert.deepEqual(
    modelToegestaan({ actief: true, vensterStart: "2026-08-15T10:00:00Z", vensterEind: null }, NU),
    { toegestaan: false, reden: "model_buiten_venster" }
  );
});

// ── 7. Actiestatus mag alleen vooruit ───────────────────────────────────────

test("Een lopende actie mag naar voltooid, mislukt of verlopen", () => {
  assert.equal(magOvergaan("in_uitvoering", "voltooid"), true);
  assert.equal(magOvergaan("in_uitvoering", "mislukt"), true);
  assert.equal(magOvergaan("in_uitvoering", "verlopen"), true);
});

test("Een eindtoestand is definitief", () => {
  assert.equal(magOvergaan("voltooid", "in_uitvoering"), false);
  assert.equal(magOvergaan("mislukt", "voltooid"), false);
  assert.equal(magOvergaan("verlopen", "in_uitvoering"), false);
  assert.equal(magOvergaan("in_uitvoering", "in_uitvoering"), false);
});

// ── 8. Lease ────────────────────────────────────────────────────────────────

test("Een actie binnen haar lease is niet verlopen", () => {
  const gestart = new Date("2026-08-15T12:00:00Z");
  // chat heeft 300 s lease.
  assert.equal(isVerlopen(gestart, "chat", new Date("2026-08-15T12:04:59Z")), false);
  assert.equal(isVerlopen(gestart, "chat", new Date("2026-08-15T12:05:01Z")), true);
});

test("Achtergrondwerk krijgt een ruimere lease dan een chatvraag", () => {
  assert.ok(ACTIETYPES.document_ingest.leaseSeconden > ACTIETYPES.chat.leaseSeconden);
  assert.ok(ACTIETYPES.aqlab_run.leaseSeconden >= ACTIETYPES.document_ingest.leaseSeconden);
});

test("Elke lease is positief en eindig", () => {
  for (const naam of ACTIETYPE_NAMEN) {
    const lease = ACTIETYPES[naam].leaseSeconden;
    assert.ok(lease > 0 && Number.isFinite(lease), `${naam} heeft een onbruikbare lease`);
  }
});

// ── 9. Vastgestelde waarden uit de werkopdracht ─────────────────────────────

test("De besloten quotumwaarden staan als startwaarde vast", () => {
  assert.deepEqual(QUOTA_STANDAARD, {
    gebruiker_maand: 150,
    fonds_maand: 500,
    globaal_maand: 1200,
    ocr_fonds_maand: 1000,
  });
});

test("Er zijn precies vier onafhankelijk bedienbare schakelaars", () => {
  assert.deepEqual([...SWITCH_SLEUTELS], ["globaal", "anthropic", "mistral", "openai"]);
});

console.log(`\n${n} ai-quota-kern sanity-tests geslaagd.`);
