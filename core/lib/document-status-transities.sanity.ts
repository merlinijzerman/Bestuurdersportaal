// ============================================================
//  Sanity-tests voor de statustransitiespec (GATE).
//
//  Model na besluit 0154 / DOELMODEL-status-as: documentstatus = 5 waarden
//  {concept, vastgesteld, van_kracht, historisch, gearchiveerd}. De rijpingsketen
//  (ter_bespreking/ter_besluitvorming) en de aparte afvoerstatussen
//  (vervangen/alleen_historisch) zijn vervallen; `historisch` is hun merge en
//  `concept → vastgesteld` is nu toegestaan ("sprong verboden" vervalt).
//
//  De bronstatus-as bestaat in deze tussenstap nog (wordt in besluit 0153
//  vervangen door `rag_uitgesloten`); die tests blijven zolang de laag er is.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/document-status-transities.sanity.ts
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

// ── Toegestane overgangen (DOELMODEL §4) ──────────────────────────────
const TOEGESTAAN: Array<[DocumentStatus | "upload", DocumentStatus]> = [
  ["upload", "concept"],
  // Ingest-verklaringen (besluit 0136) — aparte herkomst.
  ["upload", "vastgesteld"],
  ["upload", "van_kracht"],
  // Portaal-keten zonder tussenstaten (0154).
  ["concept", "vastgesteld"],
  ["vastgesteld", "van_kracht"],
  // Afvoeren naar historisch (merge van vervangen + alleen_historisch).
  ["vastgesteld", "historisch"],
  ["van_kracht", "historisch"],
  // Archiveren vanaf elke levende status.
  ["concept", "gearchiveerd"],
  ["vastgesteld", "gearchiveerd"],
  ["van_kracht", "gearchiveerd"],
  ["historisch", "gearchiveerd"],
];

test("alle gespecificeerde overgangen zijn toegestaan", () => {
  for (const [van, naar] of TOEGESTAAN) {
    assert.equal(magOvergaan(van, naar), true, `${van} → ${naar} zou mogen`);
  }
});

// ── Verboden overgangen ───────────────────────────────────────────────
test("concept → van_kracht is verboden (van_kracht alleen vanaf vastgesteld/upload)", () => {
  assert.equal(magOvergaan("concept", "van_kracht"), false);
});

test("terug historisch → van_kracht niet via normale flow", () => {
  assert.equal(magOvergaan("historisch", "van_kracht"), false);
  // wel benoemd in de tabel (admin-herstel), maar toegestaan=false
  assert.equal(vindTransitie("historisch", "van_kracht")?.viaAdminHerstel, true);
});

test("no-op (van === naar) is geen toegestane overgang", () => {
  for (const s of DOCUMENT_STATUSSEN) {
    assert.equal(magOvergaan(s, s), false, `${s} → ${s} is geen overgang`);
  }
});

test("niet-genoemde overgangen zijn impliciet verboden", () => {
  assert.equal(magOvergaan("vastgesteld", "concept"), false);
  assert.equal(magOvergaan("historisch", "vastgesteld"), false);
  assert.equal(magOvergaan("gearchiveerd", "van_kracht"), false);
  assert.equal(magOvergaan("concept", "historisch"), false); // niet in de tabel
});

// ── Harde conceptregel + actuele-bron-statussen ───────────────────────
test("conceptregel: concept is nooit een actuele bron", () => {
  assert.equal(isActueleBronStatus("concept"), false);
});

test("alleen vastgesteld + van_kracht zijn actuele-bron-statussen", () => {
  assert.equal(isActueleBronStatus("vastgesteld"), true);
  assert.equal(isActueleBronStatus("van_kracht"), true);
  assert.equal(isActueleBronStatus("historisch"), false);
  assert.equal(isActueleBronStatus("gearchiveerd"), false);
});

test("een overgang naar concept mag nooit actueel-bruikbaar zijn", () => {
  for (const t of STATUS_TRANSITIES) {
    if (t.naar === "concept") {
      assert.equal(
        t.bruikbaarInActueleRagNaOvergang,
        false,
        `${t.van} → ${t.naar} mag niet actueel bruikbaar zijn`
      );
    }
    // historisch/gearchiveerd zijn eveneens nooit actueel bruikbaar.
    if (t.naar === "historisch" || t.naar === "gearchiveerd") {
      assert.equal(t.bruikbaarInActueleRagNaOvergang, false);
    }
  }
});

// ── Redenplicht ───────────────────────────────────────────────────────
test("redenplicht op governance-kritieke overgangen", () => {
  assert.equal(redenVerplicht("concept", "vastgesteld"), true);
  assert.equal(redenVerplicht("vastgesteld", "historisch"), true);
  assert.equal(redenVerplicht("van_kracht", "historisch"), true);
  assert.equal(redenVerplicht("van_kracht", "gearchiveerd"), true);
});

test("geen redenplicht op de lichte overgang vastgesteld → van_kracht", () => {
  assert.equal(redenVerplicht("vastgesteld", "van_kracht"), false);
});

test("de historisch-overgangen vereisen GEEN vervangen_door meer (optioneel)", () => {
  assert.notEqual(
    vindTransitie("vastgesteld", "historisch")?.vereistVervangenDoor,
    true
  );
  assert.notEqual(
    vindTransitie("van_kracht", "historisch")?.vereistVervangenDoor,
    true
  );
});

// ── Capability per overgang ───────────────────────────────────────────
test("statusovergangen vereisen documents.status.change (behalve upload)", () => {
  assert.equal(vereisteCapability("upload", "concept"), "upload");
  assert.equal(
    vereisteCapability("concept", "vastgesteld"),
    "documents.status.change"
  );
  assert.equal(
    vereisteCapability("van_kracht", "historisch"),
    "documents.status.change"
  );
});

// ── Toegestane vervolgstatussen (UI: vereisten vooraf) ─────────────────
test("toegestaneVervolgstatussen geeft alleen toegestane doelen", () => {
  assert.deepEqual(
    [...toegestaneVervolgstatussen("van_kracht")].sort(),
    ["gearchiveerd", "historisch"].sort()
  );
  assert.deepEqual(
    [...toegestaneVervolgstatussen("concept")].sort(),
    ["gearchiveerd", "vastgesteld"].sort()
  );
  assert.deepEqual(
    [...toegestaneVervolgstatussen("vastgesteld")].sort(),
    ["gearchiveerd", "historisch", "van_kracht"].sort()
  );
});

// ── Bronstatus-as (bestaat nog tot besluit 0153) ──────────────────────
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
  assert.ok(!toegestaan.includes("concept"));
});

test("ingest-verklaring levert een ACTUELE bron op", () => {
  for (const naar of toegestaneIngestStatussen()) {
    assert.equal(isActueleBronStatus(naar), true);
    assert.equal(vindTransitie("upload", naar)?.bruikbaarInActueleRagNaOvergang, true);
  }
});

test("ingest-verklaring vraagt ALTIJD een reden; gewone upload niet", () => {
  for (const naar of toegestaneIngestStatussen()) {
    assert.equal(redenVerplicht("upload", naar), true);
  }
  assert.equal(redenVerplicht("upload", "concept"), false);
});

test("ingest-verklaring vraagt de statuswijzig-capability, niet 'upload'", () => {
  for (const naar of toegestaneIngestStatussen()) {
    assert.equal(vereisteCapability("upload", naar), "documents.status.change");
  }
  assert.equal(vereisteCapability("upload", "concept"), "upload");
});

test("REGRESSIEPIN: concept → vastgesteld is NU toegestaan (0154), geen sprong meer", () => {
  // De 'sprong verboden'-regel is vervallen omdat er geen tussenstaten meer zijn.
  assert.equal(magOvergaan("concept", "vastgesteld"), true);
  // Maar de conceptregel zelf blijft: een concept is nooit een actuele bron
  // (het wordt dat pas ná de vaststelling).
  assert.equal(isActueleBronStatus("concept"), false);
  // En van_kracht blijft onbereikbaar vanuit concept in één stap.
  assert.equal(magOvergaan("concept", "van_kracht"), false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
