import assert from "node:assert/strict";
import {
  HostConfiguratieFout,
  leesHostConfiguratie,
  lokaleHostmodus,
  normaliseerExacteHost,
  normaliseerHostVoorRoutering,
  normaliseerMarketingHost,
} from "./host-validatie";

const productie = { lokaalToegestaan: false };
assert.equal(normaliseerExacteHost("APP365.BESTUURDERSPORTAAL.COM", productie), "app365.bestuurdersportaal.com");
assert.equal(normaliseerMarketingHost("www.bestuurdersportaal.com", productie), "bestuurdersportaal.com");
assert.equal(normaliseerExacteHost("www.app365.bestuurdersportaal.com", productie), "www.app365.bestuurdersportaal.com");

for (const host of [
  "app365.bestuurdersportaal.com:443",
  "app365.bestuurdersportaal.com:443@evil.test",
  "user@app365.bestuurdersportaal.com",
  "app365.bestuurdersportaal.com/path",
  "app365.bestuurdersportaal.com\\evil",
  "app365.bestuurdersportaal.com?x=1",
  "app365.bestuurdersportaal.com#x",
  " app365.bestuurdersportaal.com",
  "app365.bestuurdersportaal.com ",
  "[::1]",
]) assert.equal(normaliseerExacteHost(host, productie), null, host);

assert.equal(normaliseerExacteHost("fonds.localhost:3000", productie), null);
assert.equal(normaliseerExacteHost("fonds.localhost:3000", { lokaalToegestaan: true }), "fonds.localhost:3000");
assert.equal(normaliseerHostVoorRoutering("fonds.localhost:3000", { lokaalToegestaan: true }), "fonds.localhost");
assert.equal(normaliseerExacteHost("example.test:3000", { lokaalToegestaan: true }), null);

assert.deepEqual(
  leesHostConfiguratie({
    naam: "MARKETING_HOST",
    waarde: "bestuurdersportaal.com,www.bestuurdersportaal.com",
    type: "marketing",
    lokaalToegestaan: false,
  }),
  new Set(["bestuurdersportaal.com"])
);
for (const waarde of ["", "app.example,", "app.example, app2.example", "app.example:443@evil.test"]) {
  assert.throws(
    () => leesHostConfiguratie({ naam: "APP_HOST", waarde, type: "exact", lokaalToegestaan: false }),
    HostConfiguratieFout
  );
}
assert.deepEqual(leesHostConfiguratie({ naam: "APP_HOST", waarde: undefined, type: "exact", lokaalToegestaan: false }), new Set());
assert.equal(lokaleHostmodus({ seedDoelomgeving: "local" }), true);
assert.equal(lokaleHostmodus({ seedDoelomgeving: "preview" }), false);

console.log("host-validatie sanity-tests geslaagd.");
