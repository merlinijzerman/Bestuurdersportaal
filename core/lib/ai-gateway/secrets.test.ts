import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveerCredentials } from "./secrets";
import { classificeerProviderFout, isGatewayFout } from "./fout";

console.log("ai-gateway secrets/fout sanity-tests:");

test("alleen sleutelnamen van de allowlist worden vertaald; nooit een vrije waarde", () => {
  const c = resolveerCredentials({ secretRef: "ANTHROPIC_API_KEY" }, { ANTHROPIC_API_KEY: "sk-x" });
  assert.deepEqual(c, { apiKey: "sk-x" });
  assert.throws(() => resolveerCredentials({ secretRef: "sk-ant-echte-key" }, { "sk-ant-echte-key": "x" }), /secret_ref_onbekend/);
  assert.throws(() => resolveerCredentials({ secretRef: "ANTHROPIC_API_KEY" }, {}), /secret_ontbreekt/);
});

test("endpointreferentie: alleen allowlist, alleen https, anders adapter-default", () => {
  const c = resolveerCredentials(
    { secretRef: "OPENAI_API_KEY", endpointRef: "OPENAI_BASE_URL" },
    { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://eu.voorbeeld.test/v1/" }
  );
  assert.equal(c.baseUrl, "https://eu.voorbeeld.test/v1");
  assert.equal(resolveerCredentials({ secretRef: "OPENAI_API_KEY", endpointRef: "OPENAI_BASE_URL" }, { OPENAI_API_KEY: "k" }).baseUrl, undefined);
  assert.throws(
    () => resolveerCredentials({ secretRef: "OPENAI_API_KEY", endpointRef: "OPENAI_BASE_URL" }, { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "http://intern:8080" }),
    /endpoint_geen_https/
  );
  assert.throws(
    () => resolveerCredentials({ secretRef: "OPENAI_API_KEY", endpointRef: "https://attacker.test" }, { OPENAI_API_KEY: "k" }),
    /endpoint_ref_onbekend/
  );
});

test("foutclassificatie is duck-typed en fail-safe", () => {
  assert.equal(classificeerProviderFout(Object.assign(new Error("x"), { status: 429 })).categorie, "rate_limit");
  assert.equal(classificeerProviderFout(Object.assign(new Error("x"), { status: 403 })).categorie, "configuratie");
  assert.equal(classificeerProviderFout(Object.assign(new Error("x"), { status: 422 })).herhaalbaar, false);
  assert.equal(classificeerProviderFout(Object.assign(new Error("x"), { name: "APIConnectionTimeoutError" })).categorie, "timeout");
  assert.equal(classificeerProviderFout(new Error("rerank_timeout")).categorie, "timeout");
  assert.equal(classificeerProviderFout("onbekend").categorie, "provider");
  const poort = Object.assign(new Error("dicht"), { name: "AiPoortGeslotenError", reden: "model_niet_toegestaan" });
  const f = classificeerProviderFout(poort);
  assert.equal(f.categorie, "poort_gesloten");
  assert.equal(f.reden, "model_niet_toegestaan");
  assert.ok(isGatewayFout(f));
  // Een fout van de gateway zelf gaat ongewijzigd door (geen dubbele wikkeling).
  assert.equal(classificeerProviderFout(f), f);
});
