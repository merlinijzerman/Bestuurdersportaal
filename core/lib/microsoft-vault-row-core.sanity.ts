import assert from "node:assert/strict";
import { normaliseerMicrosoftCacheRij } from "./microsoft-vault-row-core";

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

console.log("microsoft-vault-row-core sanity: groen");
