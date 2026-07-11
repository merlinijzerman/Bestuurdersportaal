// ============================================================
//  Sanity-tests voor lib/aqlab/modellen.ts (AQL-5).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/aqlab-modellen.sanity.ts
//  Verifieert: allowlist-check, hash-stabiliteit + dedup, auto-naam,
//  en de automatische afleiding van de "gewijzigde as".
// ============================================================

import assert from "node:assert/strict";
import {
  AQLAB_TOEGESTANE_MODELLEN,
  isToegestaanModel,
  autoNaam,
  leidGewijzigdeAsAf,
  type VariantInstellingen,
} from "./aqlab/modellen";
import { configHash } from "./aqlab/modellen-hash";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("aqlab/modellen sanity-tests:");

const base: VariantInstellingen = {
  model: "claude-sonnet-4-6",
  temperature: null,
  maxTokens: 3200,
  topP: null,
  retrieval: {},
};

// ── Allowlist ───────────────────────────────────────────────────────────────
check("allowlist bevat de productiekern-baseline (sonnet-4-6)", () => {
  const b = AQLAB_TOEGESTANE_MODELLEN.filter((m) => m.isBaseline);
  assert.equal(b.length, 1);
  assert.equal(b[0].model_name, "claude-sonnet-4-6");
});
check("allowlist telt ≥3 modellen (DoD)", () => {
  assert.ok(AQLAB_TOEGESTANE_MODELLEN.length >= 3);
});
check("isToegestaanModel accepteert allowlist, weigert vrije tekst", () => {
  assert.equal(isToegestaanModel("claude-opus-4-8"), true);
  assert.equal(isToegestaanModel("gpt-4o"), false);
  assert.equal(isToegestaanModel(""), false);
});

// ── Hash-stabiliteit + dedup ─────────────────────────────────────────────────
check("configHash is deterministisch (zelfde invoer → zelfde hash)", () => {
  assert.equal(configHash(base), configHash({ ...base }));
});
check("configHash is onafhankelijk van retrieval-sleutelvolgorde", () => {
  const a = configHash({ ...base, retrieval: { x: 1, y: 2 } });
  const b = configHash({ ...base, retrieval: { y: 2, x: 1 } });
  assert.equal(a, b);
});
check("configHash verschilt per as (model/temp/max/topp/retrieval)", () => {
  const h = configHash(base);
  assert.notEqual(h, configHash({ ...base, model: "claude-opus-4-8" }));
  assert.notEqual(h, configHash({ ...base, temperature: 0.2 }));
  assert.notEqual(h, configHash({ ...base, maxTokens: 4500 }));
  assert.notEqual(h, configHash({ ...base, topP: 0.9 }));
  assert.notEqual(h, configHash({ ...base, retrieval: { chunk_budget: 8 } }));
});
check("provider-default (null temp) ≠ expliciete temp 0", () => {
  assert.notEqual(configHash({ ...base, temperature: null }), configHash({ ...base, temperature: 0 }));
});

// ── Auto-naam ────────────────────────────────────────────────────────────────
check("autoNaam gebruikt korte alias + provider-default", () => {
  assert.equal(autoNaam(base), "sonnet-4-6 · provider-default · 3200");
});
check("autoNaam toont expliciete temperature", () => {
  assert.equal(autoNaam({ ...base, temperature: 0.2 }), "sonnet-4-6 · temp0.2 · 3200");
});

// ── Gewijzigde as (automatisch afgeleid) ─────────────────────────────────────
check("geen baseline → 'geen'", () => {
  assert.equal(leidGewijzigdeAsAf(null, base), "geen");
});
check("identieke variant → 'geen'", () => {
  assert.equal(leidGewijzigdeAsAf(base, { ...base }), "geen");
});
check("alleen model gewijzigd → 'model'", () => {
  assert.equal(leidGewijzigdeAsAf(base, { ...base, model: "claude-opus-4-8" }), "model");
});
check("alleen temperature gewijzigd → 'temperature'", () => {
  assert.equal(leidGewijzigdeAsAf(base, { ...base, temperature: 0.2 }), "temperature");
});
check("alleen top_p gewijzigd → 'temperature' (sampling-as, geen aparte enum)", () => {
  assert.equal(leidGewijzigdeAsAf(base, { ...base, topP: 0.9 }), "temperature");
});
check("alleen max_tokens gewijzigd → 'max_tokens'", () => {
  assert.equal(leidGewijzigdeAsAf(base, { ...base, maxTokens: 4500 }), "max_tokens");
});
check("alleen retrieval gewijzigd → 'retrieval'", () => {
  assert.equal(leidGewijzigdeAsAf(base, { ...base, retrieval: { chunk_budget: 8 } }), "retrieval");
});
check("twee assen gewijzigd → 'meerdere'", () => {
  assert.equal(
    leidGewijzigdeAsAf(base, { ...base, model: "claude-opus-4-8", maxTokens: 4500 }),
    "meerdere"
  );
});

console.log(`\n${n} sanity-checks geslaagd.`);
