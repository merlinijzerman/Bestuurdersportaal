import assert from "node:assert/strict";
import { test } from "vitest";
import {
  isProviderAuthenticatieFout,
  zijnVereistePrefixesVolledig,
} from "./provider-fout";

console.log("provider-fout sanity-tests:");

test("herkent een structurele HTTP 401", () => {
  assert.equal(isProviderAuthenticatieFout({ status: 401 }), true);
});

test("herkent Anthropic-authenticatiefouten zonder statusveld", () => {
  assert.equal(
    isProviderAuthenticatieFout(new Error("authentication_error: API key is invalid.")),
    true
  );
});

test("classificeert tijdelijke providerfouten niet als authenticatiefout", () => {
  assert.equal(isProviderAuthenticatieFout({ status: 429 }), false);
  assert.equal(isProviderAuthenticatieFout(new Error("fetch failed")), false);
});

test("blokkeert ontbrekende en gedeeltelijke prefixes in prefixmodus", () => {
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

test("staat volledige prefixes en bewuste baseline-modus toe", () => {
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
