import assert from "node:assert/strict";
import {
  isProviderAuthenticatieFout,
  zijnVereistePrefixesVolledig,
} from "./provider-fout";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("provider-fout sanity-tests:");

check("herkent een structurele HTTP 401", () => {
  assert.equal(isProviderAuthenticatieFout({ status: 401 }), true);
});

check("herkent Anthropic-authenticatiefouten zonder statusveld", () => {
  assert.equal(
    isProviderAuthenticatieFout(new Error("authentication_error: API key is invalid.")),
    true
  );
});

check("classificeert tijdelijke providerfouten niet als authenticatiefout", () => {
  assert.equal(isProviderAuthenticatieFout({ status: 429 }), false);
  assert.equal(isProviderAuthenticatieFout(new Error("fetch failed")), false);
});

check("blokkeert ontbrekende en gedeeltelijke prefixes in prefixmodus", () => {
  assert.equal(
    zijnVereistePrefixesVolledig({
      metPrefix: true,
      keyBeschikbaar: false,
      aantalPrefixes: 0,
      aantalChunks: 10,
    }),
    false
  );
  assert.equal(
    zijnVereistePrefixesVolledig({
      metPrefix: true,
      keyBeschikbaar: true,
      aantalPrefixes: 9,
      aantalChunks: 10,
    }),
    false
  );
});

check("staat volledige prefixes en bewuste baseline-modus toe", () => {
  assert.equal(
    zijnVereistePrefixesVolledig({
      metPrefix: true,
      keyBeschikbaar: true,
      aantalPrefixes: 10,
      aantalChunks: 10,
    }),
    true
  );
  assert.equal(
    zijnVereistePrefixesVolledig({
      metPrefix: false,
      keyBeschikbaar: false,
      aantalPrefixes: 0,
      aantalChunks: 10,
    }),
    true
  );
});

console.log(`\n${n} tests groen.`);
