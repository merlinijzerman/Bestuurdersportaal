import assert from "node:assert/strict";
import { normaliseerMicrosoftCacheRij, normaliseerPostgresDatum } from "./microsoft-vault-row-core";

assert.deepEqual(normaliseerMicrosoftCacheRij({
  verbinding_id: "verbinding-1",
  versie: 3,
  sleutel_versie: 7,
  iv: "iv",
  tag: "tag",
  ciphertext: "ciphertext",
}), {
  verbinding_id: "verbinding-1",
  versie: 3,
  sleutelVersie: 7,
  iv: "iv",
  tag: "tag",
  ciphertext: "ciphertext",
});

assert.equal(normaliseerMicrosoftCacheRij(undefined), undefined);

assert.equal(normaliseerPostgresDatum("2026-06-07"), "2026-06-07");
assert.equal(normaliseerPostgresDatum(new Date(2026, 5, 7)), "2026-06-07");
assert.throws(() => normaliseerPostgresDatum("07-06-2026"), /ongeldige_postgres_datum/);

console.log("microsoft-vault-row-core sanity: groen");
