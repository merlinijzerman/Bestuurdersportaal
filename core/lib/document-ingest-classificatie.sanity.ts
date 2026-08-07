// ============================================================
//  Sanity-tests voor de classificatie bij aanlevering (besluit 0140).
//
//  Wat hier bevroren wordt:
//   • `actief_na_vaststelling` is bij aanlevering NIET te verklaren — die
//     waarde is afgeleid uit een statusovergang. Wordt de transitietabel ooit
//     uitgebreid, dan valt deze test om en is dat een bewuste keuze.
//   • De aanlevering loopt door DEZELFDE transitietabel als een latere
//     wijziging; upload is geen achterdeur om de bronstatus-governance te
//     omzeilen.
//   • Documenttype is alleen verplicht waar de gebruiker de vraag ook krijgt.
//     Vergaderstukken en bewijsstukken houden `null` — geen verzonnen
//     classificatie (guardrail "geen schijnzekerheid").
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/document-ingest-classificatie.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  INGEST_BRONSTATUSSEN,
  INGEST_BRONSTATUS_HERKOMST,
  VEREISTE_BRONSTATUS_CAPABILITY,
  beoordeelIngestBronstatus,
  beoordeelIngestDocumenttype,
  isGeldigDocumenttype,
} from "./document-ingest-classificatie";
import { DOCUMENTTYPEN } from "./document-metadata";
import {
  magBronstatusOvergaan,
  vindBronstatusTransitie,
} from "./document-status-transities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-ingest-classificatie sanity-tests:");

// ── Herkomst ────────────────────────────────────────────────────────────────

test("de impliciete beginwaarde bij aanlevering is 'actief' (NULL ≡ actief)", () => {
  assert.equal(INGEST_BRONSTATUS_HERKOMST, "actief");
});

// ── Toegestane bronstatussen ────────────────────────────────────────────────

test("bij aanlevering zijn precies 'historisch' en 'uitgesloten' te verklaren", () => {
  assert.deepEqual([...INGEST_BRONSTATUSSEN].sort(), ["historisch", "uitgesloten"]);
});

test("'actief_na_vaststelling' is bij aanlevering NIET te verklaren (afgeleid)", () => {
  assert.equal(INGEST_BRONSTATUSSEN.includes("actief_na_vaststelling"), false);
  const r = beoordeelIngestBronstatus("actief_na_vaststelling", "");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "bronstatus_bij_ingest_ongeldig");
});

test("de lijst is AFGELEID uit de transitietabel, niet handmatig opgesomd", () => {
  // Bevriest de koppeling: alles wat vanaf 'actief' mag én niet afgeleid is,
  // staat erin — en niets anders.
  for (const b of INGEST_BRONSTATUSSEN) {
    assert.equal(magBronstatusOvergaan("actief", b), true);
    assert.notEqual(vindBronstatusTransitie("actief", b)?.capability, "afgeleid");
  }
});

test("de capability is dezelfde als bij een latere wijziging — geen achterdeur", () => {
  assert.equal(VEREISTE_BRONSTATUS_CAPABILITY, "documents.bronstatus.change");
  for (const b of INGEST_BRONSTATUSSEN) {
    assert.equal(
      vindBronstatusTransitie("actief", b)?.capability,
      VEREISTE_BRONSTATUS_CAPABILITY
    );
  }
});

// ── Geen verklaring = ongewijzigd gedrag ────────────────────────────────────

test("lege bronstatus laat de kolom NULL — bestaand gedrag ongemoeid", () => {
  for (const leeg of ["", "   ", null, undefined]) {
    const r = beoordeelIngestBronstatus(leeg, "");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.bronstatus, null);
  }
});

test("expliciet 'actief' is óók geen verklaring — de default blijft staan", () => {
  const r = beoordeelIngestBronstatus("actief", "");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.bronstatus, null);
    assert.equal(r.ragImpact, false);
  }
});

// ── RAG-impact en redenplicht komen uit de tabel ────────────────────────────

test("'historisch' en 'uitgesloten' hebben RAG-impact en dus een auditregel", () => {
  for (const b of INGEST_BRONSTATUSSEN) {
    const r = beoordeelIngestBronstatus(b, "");
    assert.equal(r.ok, true, `${b} zou geldig moeten zijn`);
    if (r.ok) assert.equal(r.ragImpact, true, `${b} hoort RAG-impact te hebben`);
  }
});

test("vanaf 'actief' geldt geen redenplicht — blootstelling neemt af, niet toe", () => {
  // De redenplicht in de tabel zit op de omgekeerde richting (→ actief). Kantelt
  // dat, dan moet de route een redenveld gaan afdwingen en faalt deze test.
  for (const b of INGEST_BRONSTATUSSEN) {
    const r = beoordeelIngestBronstatus(b, "");
    if (r.ok) assert.equal(r.redenVerplicht, false);
  }
});

test("onbekende bronstatus wordt geweigerd", () => {
  const r = beoordeelIngestBronstatus("vervallen", "");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "bronstatus_ongeldig");
});

// ── Documenttype ────────────────────────────────────────────────────────────

test("elk type uit DOCUMENTTYPEN wordt geaccepteerd", () => {
  for (const t of DOCUMENTTYPEN) {
    assert.equal(isGeldigDocumenttype(t), true);
    const r = beoordeelIngestDocumenttype(t, { verplicht: true });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.documenttype, t);
  }
});

test("een onbekend type wordt geweigerd, ook als het niet verplicht is", () => {
  const r = beoordeelIngestDocumenttype("jaarrekening", { verplicht: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "documenttype_ongeldig");
});

test("verplicht + leeg → geweigerd met een leesbare melding", () => {
  const r = beoordeelIngestDocumenttype("", { verplicht: true });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.foutcode, "documenttype_ontbreekt");
    assert.match(r.melding, /documenttype/i);
  }
});

test("niet verplicht + leeg → null, geen verzonnen classificatie", () => {
  // Regressiepin op de guardrail "geen schijnzekerheid": de vergaderstuk- en
  // bewijsstukstroom mag GEEN automatisch type krijgen.
  const r = beoordeelIngestDocumenttype("", { verplicht: false });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.documenttype, null);
});

test("witruimte telt als leeg", () => {
  const r = beoordeelIngestDocumenttype("   ", { verplicht: true });
  assert.equal(r.ok, false);
});

console.log(`\n${n} sanity-tests geslaagd.\n`);
