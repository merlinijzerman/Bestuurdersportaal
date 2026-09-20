// ============================================================================
//  #413 T4-B — De scope komt uit de bronregistratie, nooit uit de vraag.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database, geen token.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { bouwFilterExpression, bouwQueryString } from "../../core/lib/microsoft-retrieval/filter";
import { COPILOT_MAX_VRAAGTEKENS } from "../../core/lib/microsoft-retrieval/endpoint";

const HOST = "contoso.sharepoint.com";
const ROOT = `https://${HOST}/sites/pgb/Gedeelde documenten/Bestuur`;

test("een geldige root levert een exact gecodeerde padscope", () => {
  const uitkomst = bouwFilterExpression(ROOT, HOST);
  assert.ok(uitkomst.ok);
  assert.equal(
    uitkomst.filterExpression,
    'path:"https://contoso.sharepoint.com/sites/pgb/Gedeelde%20documenten/Bestuur"',
  );
});

test("de codering wordt opnieuw opgebouwd, niet overgenomen", () => {
  const a = bouwFilterExpression(`https://${HOST}/sites/pgb/Gedeelde documenten`, HOST);
  const b = bouwFilterExpression(`https://${HOST}/sites/pgb/Gedeelde%20documenten`, HOST);
  assert.ok(a.ok && b.ok);
  assert.equal(a.filterExpression, b.filterExpression);
});

test("een trailing slash verandert de scope niet", () => {
  const a = bouwFilterExpression(`https://${HOST}/sites/pgb/Bestuur`, HOST);
  const b = bouwFilterExpression(`https://${HOST}/sites/pgb/Bestuur///`, HOST);
  assert.ok(a.ok && b.ok);
  assert.equal(a.filterExpression, b.filterExpression);
});

test("injectiepogingen in de root vertrekken niet", () => {
  const pogingen: [string, string][] = [
    [`https://${HOST}/sites/pgb/a" OR path:"https://${HOST}/sites/geheim`, "quote"],
    [`https://${HOST}/sites/pgb/a%22%20OR%20path:%22x`, "gecodeerde quote"],
    [`https://${HOST}/sites/pgb/a%2522`, "dubbel gecodeerd"],
    [`https://${HOST}/sites/pgb/*`, "wildcard"],
    [`https://${HOST}/sites/pgb/(a OR b)`, "haakjes met operator"],
    [`https://${HOST}/sites/pgb/a\\b`, "backslash"],
    [`https://${HOST}/sites/pgb/a?b`, "query"],
    [`https://${HOST}/sites/pgb/a#b`, "fragment"],
    [`https://${HOST}/sites/pgb/a%00b`, "nulbyte"],
    [`https://${HOST}/sites/pgb/a%0Ab`, "regeleinde"],
  ];
  for (const [root, waarom] of pogingen) {
    const uitkomst = bouwFilterExpression(root, HOST);
    assert.equal(uitkomst.ok, false, `${waarom} had moeten afvallen: ${root}`);
  }
});

test("puntsegmenten wijzigen de scope stil en worden daarom geweigerd", () => {
  // De WHATWG-parser rekent deze segmenten weg VOORDAT een controle op
  // `pathname` iets kan zien: `/sites/pgb/../ander` is dan al `/sites/ander`.
  // Zonder deze grendel zou een root uit de registratie een ANDERE bibliotheek
  // aanwijzen dan de registratie beschrijft — en meestal een bredere.
  const verschoven = [
    `https://${HOST}/sites/pgb/../ander`,
    `https://${HOST}/sites/pgb/%2e%2e/ander`,
    `https://${HOST}/sites/pgb/%2E%2E/ander`,
    `https://${HOST}/sites/pgb/..%2fander`,
    `https://${HOST}/sites/pgb/./ander`,
    `https://${HOST}/sites/pgb/%2e/ander`,
    `https://${HOST}/sites/pgb/..`,
    `https://${HOST}/..`,
  ];
  for (const root of verschoven) {
    const uitkomst = bouwFilterExpression(root, HOST);
    assert.equal(uitkomst.ok, false, root);
    assert.equal(uitkomst.ok === false && uitkomst.code, "root_pad_onveilig", root);
  }

  // Bewijs dat de grendel nodig is: de parser verschuift deze paden werkelijk.
  assert.equal(new URL(`https://${HOST}/sites/pgb/../ander`).pathname, "/sites/ander");
  assert.equal(new URL(`https://${HOST}/sites/pgb/%2e%2e/ander`).pathname, "/sites/ander");
});

test("een punt BINNEN een segment blijft gewoon toegestaan", () => {
  const uitkomst = bouwFilterExpression(`https://${HOST}/sites/pgb/Beleid.v2.docx`, HOST);
  assert.ok(uitkomst.ok);
  assert.equal(
    uitkomst.filterExpression,
    'path:"https://contoso.sharepoint.com/sites/pgb/Beleid.v2.docx"',
  );
});

test("een root buiten de geregistreerde host of buiten https valt af", () => {
  for (const [root, host, code] of [
    [`http://${HOST}/sites/pgb`, HOST, "root_geen_https"],
    ["https://andere.sharepoint.com/sites/pgb", HOST, "root_andere_host"],
    [`https://${HOST}.evil.example/sites/pgb`, HOST, "root_andere_host"],
    [`https://user:pw@${HOST}/sites/pgb`, HOST, "root_bevat_gebruikersdeel"],
    [`https://${HOST}:8443/sites/pgb`, HOST, "root_geen_https"],
    [`https://${HOST}/`, HOST, "root_pad_leeg"],
    ["geen-url", HOST, "root_geen_https"],
  ] as const) {
    const uitkomst = bouwFilterExpression(root, host);
    assert.equal(uitkomst.ok, false, root);
    assert.equal(uitkomst.ok === false && uitkomst.code, code, root);
  }
});

test("drift tussen site_hostnaam en root_pad blokkeert de call", () => {
  const uitkomst = bouwFilterExpression(ROOT, "pgb.sharepoint.com");
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.code, "root_andere_host");
});

test("de vraag kan de scope niet raken", () => {
  const vijandig = 'Wat is de hersteltermijn?" OR path:"https://contoso.sharepoint.com/sites/geheim';
  const vraag = bouwQueryString(vijandig, COPILOT_MAX_VRAAGTEKENS);
  assert.ok(vraag.ok);
  assert.ok(vraag.queryString.includes('OR path:"'));
  const filter = bouwFilterExpression(ROOT, HOST);
  assert.ok(filter.ok);
  assert.equal(filter.filterExpression.includes("geheim"), false);
});

test("de vraag wordt genormaliseerd en begrensd", () => {
  const met = bouwQueryString("  Wat\tis\nde  termijn?  ", COPILOT_MAX_VRAAGTEKENS);
  assert.ok(met.ok);
  assert.equal(met.queryString, "Wat is de termijn?");

  assert.equal(bouwQueryString("   ", COPILOT_MAX_VRAAGTEKENS).ok, false);
  assert.equal(bouwQueryString(" ", COPILOT_MAX_VRAAGTEKENS).ok, false);

  const telang = bouwQueryString("a".repeat(COPILOT_MAX_VRAAGTEKENS + 1), COPILOT_MAX_VRAAGTEKENS);
  assert.equal(telang.ok, false);
  assert.equal(telang.ok === false && telang.code, "vraag_te_lang");

  const precies = bouwQueryString("a".repeat(COPILOT_MAX_VRAAGTEKENS), COPILOT_MAX_VRAAGTEKENS);
  assert.ok(precies.ok);
});
