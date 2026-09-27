import assert from "node:assert/strict";
import test from "node:test";
import { microsoftConfigVoorFonds, veiligeMicrosoftReturnUrl } from "./microsoft-config-core";
test("Microsoft-returnpad accepteert alleen een lokaal absoluut pad", () => {
  assert.equal(veiligeMicrosoftReturnUrl("/profiel"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("/profiel?tab=microsoft"), "/profiel?tab=microsoft");
  assert.equal(veiligeMicrosoftReturnUrl(null), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("profiel"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("https://aanvaller.example"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("//aanvaller.example"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("/\\aanvaller.example"), "/profiel");
});

const basis = {
  NODE_ENV: "production",
  MICROSOFT_TENANT_ID: "tenant-bestaand",
  MICROSOFT_CLIENT_ID: "client-bestaand",
  MICROSOFT_CLIENT_SECRET: "secret-bestaand",
  MICROSOFT_CALLBACK_URL: "https://pgb.preview.bestuurdersportaal.com/auth/microsoft/callback",
  MICROSOFT_APP365_FONDS_ID: "1050bc4e-640f-46c3-bb99-55f01969404e",
  MICROSOFT_APP365_TENANT_ID: "tenant-lab",
  MICROSOFT_APP365_CLIENT_ID: "client-app365",
  MICROSOFT_APP365_CLIENT_SECRET: "secret-app365",
  MICROSOFT_APP365_CALLBACK_URL: "https://app365.preview.bestuurdersportaal.com/auth/microsoft/callback",
};

test("Microsoft-configuratie selecteert App365 uitsluitend op de vertrouwde fonds-id", () => {
  assert.deepEqual(
    microsoftConfigVoorFonds(basis, "1050bc4e-640f-46c3-bb99-55f01969404e"),
    {
      tenantId: "tenant-lab",
      clientId: "client-app365",
      clientSecret: "secret-app365",
      callbackUrl: "https://app365.preview.bestuurdersportaal.com/auth/microsoft/callback",
    },
  );
  assert.equal(microsoftConfigVoorFonds(basis, "ander-fonds").tenantId, "tenant-bestaand");
});

test("een gedeeltelijke App365-set valt niet terug op de bestaande tenant", () => {
  const { MICROSOFT_APP365_CLIENT_SECRET: _weggelaten, ...onvolledig } = basis;
  assert.throws(
    () => microsoftConfigVoorFonds(onvolledig, "1050bc4e-640f-46c3-bb99-55f01969404e"),
    /MICROSOFT_APP365_CLIENT_SECRET/,
  );
});

test("Microsoft-callbacks moeten buiten development HTTPS gebruiken", () => {
  assert.throws(
    () => microsoftConfigVoorFonds({ ...basis, MICROSOFT_APP365_CALLBACK_URL: "http://app365.preview.bestuurdersportaal.com/auth/microsoft/callback" }, basis.MICROSOFT_APP365_FONDS_ID),
    /HTTPS/,
  );
});
