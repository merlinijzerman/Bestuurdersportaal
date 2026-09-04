import assert from "node:assert/strict";
import {
  MICROSOFT_KOPPEL_FOUTCATEGORIEEN,
  MicrosoftConnectorError,
  microsoftKoppelfoutcategorie,
} from "./microsoft-connector-error-core";

for (const categorie of MICROSOFT_KOPPEL_FOUTCATEGORIEEN) {
  assert.equal(microsoftKoppelfoutcategorie(new MicrosoftConnectorError(categorie)), categorie);
}

assert.equal(microsoftKoppelfoutcategorie(new Error("gevoelige providermelding")), "onverwachte_fout");
assert.equal(microsoftKoppelfoutcategorie("geen Error-object"), "onverwachte_fout");

console.log("microsoft-connector-error-core sanity: groen");
