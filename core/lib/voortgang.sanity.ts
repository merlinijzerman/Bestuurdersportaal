// ============================================================
//  Sanity-tests voor core/lib/voortgang.ts (besluit 0087; retrieval-regel 0138).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/voortgang.sanity.ts
//  Verifieert de PURE fase-afleiding (welke fasen bij welke vlaggen — geen
//  schijnzekerheid) en de uitkomst-formatters.
//
//  B2 (besluit 0138) — de retrieval-regel mag GEEN constante zijn. De blinde vlek
//  van de oude test was dat `retrievalUitkomst(18) === "18 passages gevonden"` groen
//  bleef ook als de invoer een plafond-constante was. Daarom toetsen we hier niet
//  alleen de formattering, maar ook dat de regel over de tien tabel-A-vragen
//  aantoonbaar VARIEERT — op een vastgelegde fixture van echte retrieval-uitkomsten.
// ============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  bepaalZichtbareFasen,
  retrievalUitkomst,
  webUitkomst,
  VOORTGANG_LABEL,
  VOORTGANG_VOLGORDE,
  type VoortgangVlaggen,
} from "./voortgang";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("voortgang sanity-tests:");

const NIETS: VoortgangVlaggen = {
  reformulatieActief: false,
  retrievalActief: false,
  webActief: false,
  analyseActief: false,
};

// ── bepaalZichtbareFasen: generatie altijd, rest alleen bij vlag ────────────
check("geen enkele stap → alleen generatie", () => {
  assert.deepEqual(bepaalZichtbareFasen(NIETS), ["generatie"]);
});

check("eerste vraag met retrieval, web uit → retrieval + generatie", () => {
  assert.deepEqual(
    bepaalZichtbareFasen({ ...NIETS, retrievalActief: true }),
    ["retrieval", "generatie"]
  );
});

check("volledige vraag → alle fasen in vaste volgorde (geen aparte rerankfase)", () => {
  assert.deepEqual(
    bepaalZichtbareFasen({
      reformulatieActief: true,
      retrievalActief: true,
      webActief: true,
      analyseActief: true,
    }),
    ["reformulatie", "retrieval", "web", "analyse", "generatie"]
  );
});

check("rerank is geen zichtbare fase meer (0138 — samengevoegd in retrieval)", () => {
  const f = bepaalZichtbareFasen({
    reformulatieActief: true,
    retrievalActief: true,
    webActief: false,
    analyseActief: false,
  });
  assert.ok(!f.includes("rerank" as never));
  assert.ok(!(VOORTGANG_VOLGORDE as readonly string[]).includes("rerank"));
  assert.deepEqual(f, ["reformulatie", "retrieval", "generatie"]);
});

check("de getoonde fasen volgen altijd VOORTGANG_VOLGORDE", () => {
  const f = bepaalZichtbareFasen({
    reformulatieActief: true,
    retrievalActief: true,
    webActief: true,
    analyseActief: true,
  });
  const idx = f.map((fase) => VOORTGANG_VOLGORDE.indexOf(fase));
  const oplopend = idx.every((v, i) => i === 0 || v > idx[i - 1]);
  assert.ok(oplopend, "fasen moeten in de vaste volgorde staan");
});

check("elke fase heeft een niet-lege statische label", () => {
  for (const fase of VOORTGANG_VOLGORDE) {
    assert.ok(VOORTGANG_LABEL[fase] && VOORTGANG_LABEL[fase].length > 0);
  }
});

// ── Uitkomst-formatters (enkelvoud/meervoud, nul expliciet) ─────────────────
check("retrievalUitkomst: documenten × passages, enkelvoud/meervoud", () => {
  assert.equal(retrievalUitkomst(4, 8), "uit 4 documenten — 8 passages geselecteerd");
  assert.equal(retrievalUitkomst(1, 1), "uit 1 document — 1 passage geselecteerd");
  assert.equal(retrievalUitkomst(0, 0), "uit 0 documenten — 0 passages geselecteerd");
});

check("retrievalUitkomst: varieert op BEIDE assen (geen dode as)", () => {
  // Verander alleen de documenten → andere regel; verander alleen de passages → andere regel.
  assert.notEqual(retrievalUitkomst(3, 8), retrievalUitkomst(4, 8));
  assert.notEqual(retrievalUitkomst(4, 7), retrievalUitkomst(4, 8));
});

check("retrievalUitkomst: M5-haakje ftsArmLeeg zichtbaar", () => {
  assert.equal(
    retrievalUitkomst(4, 8, { ftsArmLeeg: true }),
    "uit 4 documenten — 8 passages geselecteerd · lexicale zoekarm leeg"
  );
});

check("webUitkomst: enkelvoud/meervoud", () => {
  assert.equal(webUitkomst(1), "1 externe bron toegestaan");
  assert.equal(webUitkomst(3), "3 externe bronnen toegestaan");
});

// ── B2 — de retrieval-regel is GEEN constante (tabel-A-fixture) ─────────────
// De fixture bevat vastgelegde ECHTE retrieval-uitkomsten (uniekeDocumenten +
// geselecteerd) per tabel-A-vraag, gemeten via de draaiende app (de retrieval-keten
// leunt op de Next-request-context en kan niet standalone draaien). Zie het
// capture-protocol in de fixture zelf. Deze test faalt zodra de teller over de
// vragen dezelfde waarde geeft — precies de blinde vlek die M6 blootlegde.
const hier = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(hier, "voortgang-tabel-a.fixture.json"), "utf8")
) as {
  beschrijving: string;
  vastgelegd: string | null;
  items: { vraag: string; uniekeDocumenten: number; geselecteerd: number }[];
};

check("tabel-A-fixture: minstens 10 vragen vastgelegd", () => {
  assert.ok(
    fixture.items.length >= 10,
    `verwacht ≥10 vragen in de fixture, kreeg ${fixture.items.length}`
  );
});

check("tabel-A-fixture: fixture is daadwerkelijk gevuld (niet de lege stub)", () => {
  assert.ok(
    fixture.vastgelegd !== null,
    "fixture nog niet via de app vastgelegd — vul voortgang-tabel-a.fixture.json (zie capture-protocol)"
  );
});

check("B2 — de retrieval-regel VARIEERT over de tabel-A-vragen (geen constante)", () => {
  const regels = new Set(
    fixture.items.map((it) => retrievalUitkomst(it.uniekeDocumenten, it.geselecteerd))
  );
  assert.ok(
    regels.size > 1,
    `de retrieval-regel gaf ${regels.size} unieke waarde(n) over ${fixture.items.length} vragen — ` +
      "een constante is precies de blinde vlek van 0087/M6."
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
