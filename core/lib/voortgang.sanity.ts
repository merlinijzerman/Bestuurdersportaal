// ============================================================
//  Sanity-tests voor core/lib/voortgang.ts (besluit 0087).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/voortgang.sanity.ts
//  Verifieert de PURE fase-afleiding (welke fasen bij welke vlaggen — geen
//  schijnzekerheid) en de uitkomst-formatters.
// ============================================================

import assert from "node:assert/strict";
import {
  bepaalZichtbareFasen,
  retrievalUitkomst,
  rerankUitkomst,
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
  rerankActief: false,
  webActief: false,
  analyseActief: false,
};

// ── bepaalZichtbareFasen: generatie altijd, rest alleen bij vlag ────────────
check("geen enkele stap → alleen generatie", () => {
  assert.deepEqual(bepaalZichtbareFasen(NIETS), ["generatie"]);
});

check("eerste vraag met retrieval, reranker+web uit → retrieval + generatie", () => {
  assert.deepEqual(
    bepaalZichtbareFasen({ ...NIETS, retrievalActief: true }),
    ["retrieval", "generatie"]
  );
});

check("volledige vraag → alle fasen in vaste volgorde", () => {
  assert.deepEqual(
    bepaalZichtbareFasen({
      reformulatieActief: true,
      retrievalActief: true,
      rerankActief: true,
      webActief: true,
      analyseActief: true,
    }),
    ["reformulatie", "retrieval", "rerank", "web", "analyse", "generatie"]
  );
});

check("reranker uit én web uit → die twee fasen verschijnen niet (criterium 2)", () => {
  const f = bepaalZichtbareFasen({
    reformulatieActief: true,
    retrievalActief: true,
    rerankActief: false,
    webActief: false,
    analyseActief: false,
  });
  assert.ok(!f.includes("rerank"));
  assert.ok(!f.includes("web"));
  assert.deepEqual(f, ["reformulatie", "retrieval", "generatie"]);
});

check("de getoonde fasen volgen altijd VOORTGANG_VOLGORDE", () => {
  const f = bepaalZichtbareFasen({
    reformulatieActief: true,
    retrievalActief: true,
    rerankActief: true,
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
check("retrievalUitkomst: enkelvoud/meervoud", () => {
  assert.equal(retrievalUitkomst(1), "1 passage gevonden");
  assert.equal(retrievalUitkomst(18), "18 passages gevonden");
  assert.equal(retrievalUitkomst(0), "0 passages gevonden");
});

check("rerankUitkomst: nul relevante treffers expliciet zichtbaar (criterium 3)", () => {
  assert.equal(rerankUitkomst(0), "0 relevant bevonden");
  assert.equal(rerankUitkomst(6), "6 relevant bevonden");
});

check("webUitkomst: enkelvoud/meervoud", () => {
  assert.equal(webUitkomst(1), "1 externe bron toegestaan");
  assert.equal(webUitkomst(3), "3 externe bronnen toegestaan");
});

console.log(`\n${n} sanity-tests geslaagd.`);
