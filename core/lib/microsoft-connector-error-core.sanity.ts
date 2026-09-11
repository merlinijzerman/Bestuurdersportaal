import assert from "node:assert/strict";
import {
  MICROSOFT_KOPPEL_FOUTCATEGORIEEN,
  MICROSOFT_TEST_FOUTCATEGORIEEN,
  MicrosoftConnectorError,
  microsoftKoppelfoutcategorie,
  microsoftTestFoutcategorie,
} from "./microsoft-connector-error-core";

for (const categorie of MICROSOFT_KOPPEL_FOUTCATEGORIEEN) {
  assert.equal(microsoftKoppelfoutcategorie(new MicrosoftConnectorError(categorie)), categorie);
}

for (const categorie of MICROSOFT_TEST_FOUTCATEGORIEEN) {
  assert.equal(microsoftTestFoutcategorie(new MicrosoftConnectorError(categorie)), categorie);
}

assert.equal(microsoftKoppelfoutcategorie(new Error("gevoelige providermelding")), "onverwachte_fout");
assert.equal(microsoftKoppelfoutcategorie("geen Error-object"), "onverwachte_fout");
assert.equal(microsoftKoppelfoutcategorie(new MicrosoftConnectorError("test_graph_me")), "onverwachte_fout");
assert.equal(microsoftTestFoutcategorie(new MicrosoftConnectorError("graph_me")), "test_onverwachte_fout");

console.log("microsoft-connector-error-core sanity: groen");
