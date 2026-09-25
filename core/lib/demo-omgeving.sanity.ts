import assert from "node:assert/strict";
import { APP365_DEMO_HOSTS, isApp365DemoHost } from "./demo-omgeving";

assert.equal(APP365_DEMO_HOSTS.size, 2);
for (const host of APP365_DEMO_HOSTS) assert.equal(isApp365DemoHost(host), true);
assert.equal(isApp365DemoHost("APP365.BESTUURDERSPORTAAL.COM"), true);
assert.equal(isApp365DemoHost("www.app365.bestuurdersportaal.com"), false);
assert.equal(isApp365DemoHost("app365.bestuurdersportaal.com:443"), false);
assert.equal(isApp365DemoHost("app365.bestuurdersportaal.com:443@evil.test"), false);
assert.equal(isApp365DemoHost("pgb.bestuurdersportaal.com"), false);
console.log("demo-omgeving sanity-tests geslaagd.");
