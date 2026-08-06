// ============================================================
//  Sanity-tests voor de statustransitiespec (Increment C, GATE).
//
//  Dekt elke toegestane/verboden overgang uit TO §3.1, de harde
//  conceptregel (conceptdoc met bronstatus=actief is GEEN actuele bron),
//  redenplicht, RAG-bruikbaarheid en de bronstatus-as.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/document-status-transities.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  DOCUMENT_STATUSSEN,
  BRONSTATUSSEN,
  STATUS_TRANSITIES,
  magOvergaan,
  redenVerplicht,
  vereisteCapability,
  vindTransitie,
  isActueleBronStatus,
  toegestaneVervolgstatussen,
  toegestaneIngestStatussen,
  magBronstatusOvergaan,
  bronstatusRedenVerplicht,
  bronstatusRagImpact,
  type DocumentStatus,
} from "./document-status-transities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-status-transitie sanity-tests:");

// ── Toegestane overgangen (TO §3.1) ───────────────────────────────────
const TOEGESTAAN: Array<[DocumentStatus | "upload", DocumentStatus]> = [
  ["upload", "concept"],
  // Ingest-verklaringen (besluit 0136) — aparte herkomst, geen ketensprong.
  ["upload", "vastgesteld"],
  ["upload", "van_kracht"],
  ["concept", "ter_bespreking"],
  ["ter_bespreking", "ter_besluitvorming"],
  ["ter_besluitvorming", "vastgesteld"],
  ["vastgesteld", "van_kracht"],
  ["van_kracht", "vervangen"],
  ["van_kracht", "alleen_historisch"],
  ["concept", "gearchiveerd"],
  ["van_kracht", "gearchiveerd"],
  ["vervangen", "gearchiveerd"],
];

test("alle gespecificeerde overgangen zijn toegestaan", () => {
  for (const [van, naar] of TOEGESTAAN) {
    assert.equal(magOvergaan(van, naar), true, `${van} → ${naar} zou mogen`);
  }
});

// ── Verboden overgangen ───────────────────────────────────────────────
test("sprong concept → vastgesteld is verboden", () => {
  assert.equal(magOvergaan("concept", "vastgesteld"), false);
});

test("terug vervangen → van_kracht niet via normale flow", () => {
  assert.equal(magOvergaan("vervangen", "van_kracht"), false);
  // wel benoemd in de tabel (admin-herstel), maar toegestaan=false
  assert.equal(vindTransitie("vervangen", "van_kracht")?.viaAdminHerstel, true);
});

test("no-op (van === naar) is geen toegestane overgang", () => {
  for (const s of DOCUMENT_STATUSSEN) {
    assert.equal(magOvergaan(s, s), false, `${s} → ${s} is geen overgang`);
  }
});

test("niet-genoemde overgangen zijn impliciet verboden", () => {
  // Een greep uit onzinnige overgangen die niet in de tabel staan.
  assert.equal(magOvergaan("vastgesteld", "concept"), false);
  assert.equal(magOvergaan("ter_bespreking", "van_kracht"), false);
  assert.equal(magOvergaan("alleen_historisch", "vastgesteld"), false);
  assert.equal(magOvergaan("gearchiveerd", "van_kracht"), false);
});

// ── Harde conceptregel ────────────────────────────────────────────────
test("conceptregel: concept/ter_bespreking/ter_besluitvorming nooit actuele bron", () => {
  assert.equal(isActueleBronStatus("concept"), false);
  assert.equal(isActueleBronStatus("ter_bespreking"), false);
  assert.equal(isActueleBronStatus("ter_besluitvorming"), false);
});

test("conceptregel: alleen vastgesteld + van_kracht zijn actuele-bron-statussen", () => {
  assert.equal(isActueleBronStatus("vastgesteld"), true);
  assert.equal(isActueleBronStatus("van_kracht"), true);
  // de overige (vervangen/alleen_historisch/gearchiveerd) zijn dat niet
  assert.equal(isActueleBronStatus("vervangen"), false);
  assert.equal(isActueleBronStatus("alleen_historisch"), false);
  assert.equal(isActueleBronStatus("gearchiveerd"), false);
});

test("conceptregel matcht de transitie-vlag voor alle concept-overgangen", () => {
  // Elke overgang waarvan de DOELstatus een concept-status is, mag nooit
  // bruikbaarInActueleRagNaOvergang=true hebben.
  const conceptStatussen: DocumentStatus[] = [
    "concept",
    "ter_bespreking",
    "ter_besluitvorming",
  ];
  for (const t of STATUS_TRANSITIES) {
    if (conceptStatussen.includes(t.naar)) {
      assert.equal(
        t.bruikbaarInActueleRagNaOvergang,
        false,
        `${t.van} → ${t.naar} mag niet actueel bruikbaar zijn`
      );
    }
  }
});

// ── Redenplicht ───────────────────────────────────────────────────────
test("redenplicht op governance-kritieke overgangen", () => {
  assert.equal(redenVerplicht("ter_besluitvorming", "vastgesteld"), true);
  assert.equal(redenVerplicht("van_kracht", "vervangen"), true);
  assert.equal(redenVerplicht("van_kracht", "alleen_historisch"), true);
  assert.equal(redenVerplicht("van_kracht", "gearchiveerd"), true);
});

test("geen redenplicht op de lichte overgangen", () => {
  assert.equal(redenVerplicht("concept", "ter_bespreking"), false);
  assert.equal(redenVerplicht("ter_bespreking", "ter_besluitvorming"), false);
  assert.equal(redenVerplicht("vastgesteld", "van_kracht"), false);
});

test("van_kracht → vervangen vereist vervangen_door", () => {
  assert.equal(
    vindTransitie("van_kracht", "vervangen")?.vereistVervangenDoor,
    true
  );
});

// ── Capability per overgang ───────────────────────────────────────────
test("statusovergangen vereisen documents.status.change (behalve upload)", () => {
  assert.equal(vereisteCapability("upload", "concept"), "upload");
  assert.equal(
    vereisteCapability("ter_besluitvorming", "vastgesteld"),
    "documents.status.change"
  );
  assert.equal(
    vereisteCapability("van_kracht", "vervangen"),
    "documents.status.change"
  );
});

test("concept → ter_bespreking is ook door uploader-eigen toegestaan", () => {
  assert.equal(
    vindTransitie("concept", "ter_bespreking")?.uploaderEigenToegestaan,
    true
  );
});

// ── Toegestane vervolgstatussen (UI: vereisten vooraf) ─────────────────
test("toegestaneVervolgstatussen geeft alleen toegestane doelen", () => {
  const vanaf = toegestaneVervolgstatussen("van_kracht");
  assert.deepEqual(
    [...vanaf].sort(),
    ["alleen_historisch", "gearchiveerd", "vervangen"].sort()
  );
  // concept kan naar ter_bespreking of gearchiveerd, niet naar vastgesteld
  assert.ok(!toegestaneVervolgstatussen("concept").includes("vastgesteld"));
});

// ── Bronstatus-as ─────────────────────────────────────────────────────
test("bronstatus historisch/uitgesloten → actief vereist reden + RAG-impact", () => {
  assert.equal(magBronstatusOvergaan("historisch", "actief"), true);
  assert.equal(bronstatusRedenVerplicht("historisch", "actief"), true);
  assert.equal(bronstatusRagImpact("historisch", "actief"), true);
  assert.equal(magBronstatusOvergaan("uitgesloten", "actief"), true);
  assert.equal(bronstatusRedenVerplicht("uitgesloten", "actief"), true);
});

test("bronstatus actief → historisch/uitgesloten zonder reden, wel RAG-impact", () => {
  assert.equal(bronstatusRedenVerplicht("actief", "historisch"), false);
  assert.equal(bronstatusRagImpact("actief", "historisch"), true);
  assert.equal(bronstatusRagImpact("actief", "uitgesloten"), true);
});

test("bronstatus no-op is geen overgang", () => {
  for (const b of BRONSTATUSSEN) {
    assert.equal(magBronstatusOvergaan(b, b), false);
  }
});

// ── Statusverklaring bij ingest (besluit 0136) ────────────────────────────

test("ingest-verklaring kan alleen naar vastgesteld of van_kracht", () => {
  const toegestaan = toegestaneIngestStatussen();
  assert.deepEqual([...toegestaan].sort(), ["van_kracht", "vastgesteld"]);
  // `concept` is de default en hoort GEEN verklaring te zijn — anders zou de
  // UI hem als keuze tonen en suggereren dat er iets verklaard wordt.
  assert.ok(!toegestaan.includes("concept"));
});

test("ingest-verklaring levert een ACTUELE bron op", () => {
  // De hele reden van dit pad: het document moet daarna vindbaar zijn in de
  // default retrievalmodus. Zou dit ooit false worden, dan is het pad zinloos.
  for (const naar of toegestaneIngestStatussen()) {
    assert.equal(isActueleBronStatus(naar), true);
    assert.equal(vindTransitie("upload", naar)?.bruikbaarInActueleRagNaOvergang, true);
  }
});

test("ingest-verklaring vraagt ALTIJD een reden", () => {
  // Zonder redenplicht is dit een stille sprong langs de bestuurlijke keten.
  // De reden is wat het auditspoor eerlijk houdt.
  for (const naar of toegestaneIngestStatussen()) {
    assert.equal(redenVerplicht("upload", naar), true);
  }
  // De gewone upload (naar concept) verklaart niets en vraagt dus geen reden.
  assert.equal(redenVerplicht("upload", "concept"), false);
});

test("ingest-verklaring vraagt de statuswijzig-capability, niet 'upload'", () => {
  for (const naar of toegestaneIngestStatussen()) {
    assert.equal(vereisteCapability("upload", naar), "documents.status.change");
  }
  assert.equal(vereisteCapability("upload", "concept"), "upload");
});

test("REGRESSIEPIN: de keten vanuit concept is NIET verruimd", () => {
  // Kern van besluit 0136: de ingest-verklaring is een aparte herkomst, geen
  // sprong binnen de keten. Wordt dit ooit toegestaan, dan kan een document
  // dat al ín besluitvorming is stilzwijgend actuele bron worden.
  assert.equal(magOvergaan("concept", "vastgesteld"), false);
  assert.equal(magOvergaan("concept", "van_kracht"), false);
  assert.equal(magOvergaan("ter_bespreking", "vastgesteld"), false);
  assert.equal(magOvergaan("ter_bespreking", "van_kracht"), false);
  assert.equal(magOvergaan("ter_besluitvorming", "van_kracht"), false);
  // En de conceptregel zelf blijft overeind.
  assert.equal(isActueleBronStatus("concept"), false);
  assert.equal(isActueleBronStatus("ter_bespreking"), false);
  assert.equal(isActueleBronStatus("ter_besluitvorming"), false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
