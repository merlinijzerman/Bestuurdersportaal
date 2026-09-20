// ============================================================================
//  #413 T4-B — De endpointpin is een pin, geen suggestie.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database, geen token.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COPILOT_DATA_SOURCE,
  COPILOT_MAX_REQUESTBUDGET,
  COPILOT_MAX_RESULTATEN,
  COPILOT_MAX_VRAAGTEKENS,
  COPILOT_RETRIEVAL_ENDPOINT,
  begrensResultaten,
  isCopilotRetrievalEndpoint,
  raaktVerbodenOppervlak,
} from "../../core/lib/microsoft-retrieval/endpoint";

test("het endpoint is de v1.0-GA-route en de databron staat vast op sharePoint", () => {
  assert.equal(COPILOT_RETRIEVAL_ENDPOINT, "https://graph.microsoft.com/v1.0/copilot/retrieval");
  assert.equal(COPILOT_DATA_SOURCE, "sharePoint");
  assert.equal(COPILOT_MAX_RESULTATEN, 25);
  assert.equal(COPILOT_MAX_VRAAGTEKENS, 1_500);
  assert.equal(COPILOT_MAX_REQUESTBUDGET, 3);
});

test("alleen exacte gelijkheid telt als het endpoint", () => {
  assert.ok(isCopilotRetrievalEndpoint(COPILOT_RETRIEVAL_ENDPOINT));
  for (const variant of [
    "https://graph.microsoft.com/beta/copilot/retrieval",
    "https://graph.microsoft.com/v1.0/copilot/retrieval/",
    "https://graph.microsoft.com/v1.0/copilot/retrieval?api-version=beta",
    "https://graph.microsoft.com/v1.0/copilot/retrieval#x",
    "https://graph.microsoft.com//v1.0/copilot/retrieval",
    "https://graph.microsoft.com:443/v1.0/copilot/retrieval",
    "https://GRAPH.microsoft.com/v1.0/copilot/retrieval",
    "https://graph.microsoft.com.evil.example/v1.0/copilot/retrieval",
    "http://graph.microsoft.com/v1.0/copilot/retrieval",
    " https://graph.microsoft.com/v1.0/copilot/retrieval",
  ]) {
    assert.equal(isCopilotRetrievalEndpoint(variant), false, variant);
  }
});

test("de verboden oppervlakken worden herkend", () => {
  for (const waarde of [
    "https://graph.microsoft.com/beta/copilot/retrieval",
    "https://graph.microsoft.com/v1.0/shares/u!abc/driveItem",
    '{"dataSource":"sharePointEmbedded"}',
    "sharingToken=u!abc",
  ]) {
    assert.ok(raaktVerbodenOppervlak(waarde), waarde);
  }
  assert.equal(raaktVerbodenOppervlak(COPILOT_RETRIEVAL_ENDPOINT), false);
  assert.equal(raaktVerbodenOppervlak("https://graph.microsoft.com/v1.0/drives/d/items/i"), false);
});

test("het resultaatplafond klemt in plaats van te weigeren", () => {
  assert.equal(begrensResultaten(50), 25);
  assert.equal(begrensResultaten(25), 25);
  assert.equal(begrensResultaten(7), 7);
  assert.equal(begrensResultaten(0), 1);
  assert.equal(begrensResultaten(-3), 1);
  assert.equal(begrensResultaten(7.9), 7);
  assert.equal(begrensResultaten(Number.NaN), 1);
  assert.equal(begrensResultaten(Number.POSITIVE_INFINITY), 1);
});

test("de module is afhankelijkheidsvrij, zodat ook een gate haar mag laden", () => {
  const bron = readFileSync(
    resolve(import.meta.dirname, "../../core/lib/microsoft-retrieval/endpoint.ts"),
    "utf8",
  );
  assert.doesNotMatch(bron, /^\s*import\s/m, "endpoint.ts hoort geen imports te hebben");
});
