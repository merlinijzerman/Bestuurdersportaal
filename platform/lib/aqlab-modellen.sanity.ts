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
  providerVanModel,
  isRedeneermodel,
  autoNaam,
  leidGewijzigdeAsAf,
  type ModelProvider,
  type VariantInstellingen,
} from "../../core/lib/aqlab/modellen";
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
  // Niet-allowlisted modelstrings (ook plausibel klinkende) blijven geweigerd —
  // modelkeuze is nooit vrije tekst.
  assert.equal(isToegestaanModel("gpt-3.5-turbo"), false);
  assert.equal(isToegestaanModel("gpt-4o-realtime"), false);
  assert.equal(isToegestaanModel(""), false);
});

// ── Multi-provider (AQL-6) ───────────────────────────────────────────────────
check("allowlist bevat de toegestane OpenAI- en Mistral-challengers", () => {
  for (const m of ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "mistral-large-latest"]) {
    assert.equal(isToegestaanModel(m), true);
  }
});
check("elke allowlist-entry heeft een geldige provider; baseline = anthropic", () => {
  const geldig: ModelProvider[] = ["anthropic", "openai", "mistral"];
  for (const m of AQLAB_TOEGESTANE_MODELLEN) assert.ok(geldig.includes(m.provider));
  const baseline = AQLAB_TOEGESTANE_MODELLEN.find((m) => m.isBaseline)!;
  assert.equal(baseline.provider, "anthropic");
});
check("providerVanModel leidt provider af uit de modelnaam (default anthropic)", () => {
  assert.equal(providerVanModel("claude-sonnet-4-6"), "anthropic");
  assert.equal(providerVanModel("gpt-4.1"), "openai");
  assert.equal(providerVanModel("mistral-large-latest"), "mistral");
  assert.equal(providerVanModel("onbekend-model"), "anthropic");
});
check("config-hash is provider-onafhankelijk (decision 0064): model draagt identiteit", () => {
  // Twee verschillende modellen (dus providers) → verschillende hash via model,
  // niet via een aparte provider-as. Zelfde model → zelfde hash ongeacht provider.
  const claude: VariantInstellingen = { model: "claude-sonnet-4-6", temperature: null, maxTokens: 3200, topP: null, retrieval: {} };
  const gpt: VariantInstellingen = { ...claude, model: "gpt-4.1" };
  assert.notEqual(configHash(claude), configHash(gpt));
  // Canoniek bevat geen provider-veld → hash blijft stabiel over herhaalde opbouw.
  assert.equal(configHash(gpt), configHash({ ...gpt }));
});

// ── Reasoning-modellen (AQL-6) ───────────────────────────────────────────────
check("reasoning-modellen (GPT-5-serie) staan op de allowlist en zijn geflagd", () => {
  for (const m of ["gpt-5", "gpt-5-mini", "gpt-5-nano"]) assert.equal(isToegestaanModel(m), true);
  assert.equal(isRedeneermodel("gpt-5"), true);
  assert.equal(isRedeneermodel("gpt-5-mini"), true);
  // Chat-modellen zijn géén reasoning-model.
  assert.equal(isRedeneermodel("gpt-4.1"), false);
  assert.equal(isRedeneermodel("claude-sonnet-4-6"), false);
});
check("reasoning_effort is back-compat in de hash: null == weggelaten", () => {
  const zonder: VariantInstellingen = { model: "gpt-5", temperature: null, maxTokens: 8000, topP: null, retrieval: {} };
  const nul: VariantInstellingen = { ...zonder, reasoningEffort: null };
  // Een expliciete null mag de hash NIET veranderen (anders zouden bestaande
  // chat-configs kantelen). Alleen een gezette effort telt mee.
  assert.equal(configHash(zonder), configHash(nul));
});
check("reasoning_effort is een eigen hash-as als het gezet is", () => {
  const base: VariantInstellingen = { model: "gpt-5", temperature: null, maxTokens: 8000, topP: null, retrieval: {} };
  assert.notEqual(configHash(base), configHash({ ...base, reasoningEffort: "high" }));
  assert.notEqual(configHash({ ...base, reasoningEffort: "low" }), configHash({ ...base, reasoningEffort: "high" }));
});
check("autoNaam toont reasoning-effort i.p.v. temperature bij reasoning-modellen", () => {
  assert.equal(
    autoNaam({ model: "gpt-5", temperature: null, maxTokens: 8000, topP: null, reasoningEffort: "high", retrieval: {} }),
    "gpt-5 · effort:high · 8000"
  );
});
check("reasoning_effort-wijziging telt als de sampling-as ('temperature')", () => {
  const base: VariantInstellingen = { model: "gpt-5", temperature: null, maxTokens: 8000, topP: null, reasoningEffort: "low", retrieval: {} };
  assert.equal(leidGewijzigdeAsAf(base, { ...base, reasoningEffort: "high" }), "temperature");
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
