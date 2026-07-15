// ============================================================================
//  Sanity-tests voor lib/web-whitelist.ts (Scenario A, besluit 0072).
//  Dekt de retrieval-AC's (AC-1/2/4) en beheerscherm-AC's (AC-B4/B5/B8) op de
//  pure matching-/weeg-/validatielaag.
//
//  Uitvoeren: npx tsx lib/web-whitelist.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  matchWhitelist,
  allowedDomeinenUit,
  weegWebbronnen,
  isGeldigDomein,
  detecteerLookAlike,
  normaliseerDomein,
  type WhitelistEntry,
} from "./web-whitelist";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function entry(p: Partial<WhitelistEntry>): WhitelistEntry {
  return {
    id: p.id ?? "x",
    domein: p.domein ?? "dnb.nl",
    matchtype: p.matchtype ?? "domein",
    pad: p.pad ?? null,
    normgewicht: p.normgewicht ?? "bindend",
    categorie: p.categorie ?? null,
    tier: p.tier ?? null,
    status: p.status ?? "actief",
    toelichting: p.toelichting ?? "test",
    review_datum: p.review_datum ?? null,
  };
}

console.log("web-whitelist sanity-tests:");

// ── normaliseerDomein ───────────────────────────────────────
test("normaliseerDomein strip www/poort/hoofdletters", () => {
  assert.equal(normaliseerDomein("WWW.DNB.NL:443"), "dnb.nl");
});

// ── matchWhitelist ──────────────────────────────────────────
test("AC-1: niet-whitelist-URL matcht niet (→ null)", () => {
  const wl = [entry({ domein: "dnb.nl", matchtype: "domein" })];
  assert.equal(matchWhitelist("https://kwaadaardig.example/artikel", wl), null);
});

test("onveilige URL (javascript:) matcht nooit", () => {
  const wl = [entry({ domein: "dnb.nl", matchtype: "domein_subdomeinen" })];
  assert.equal(matchWhitelist("javascript:alert(1)", wl), null);
});

test("exact domein matcht en draagt normgewicht", () => {
  const wl = [entry({ domein: "dnb.nl", matchtype: "domein", normgewicht: "bindend" })];
  const m = matchWhitelist("https://www.dnb.nl/leidraad", wl);
  assert.ok(m);
  assert.equal(m!.normgewicht, "bindend");
});

test("AC-2/B5: subdomein toegestaan bij domein_subdomeinen, met hoofddomein-normgewicht", () => {
  const wl = [entry({ domein: "dnb.nl", matchtype: "domein_subdomeinen", normgewicht: "bindend" })];
  const m = matchWhitelist("https://toezicht.dnb.nl/open-boek", wl);
  assert.ok(m);
  assert.equal(m!.normgewicht, "bindend");
});

test("subdomein NIET toegestaan bij matchtype 'domein'", () => {
  const wl = [entry({ domein: "dnb.nl", matchtype: "domein" })];
  assert.equal(matchWhitelist("https://toezicht.dnb.nl/x", wl), null);
});

test("AC-B4: padprefix matcht binnen pad, weigert buiten pad op zelfde domein", () => {
  const wl = [entry({ domein: "voorbeeld.nl", matchtype: "padprefix", pad: "/pensioen" })];
  assert.ok(matchWhitelist("https://voorbeeld.nl/pensioen/regeling", wl));
  assert.equal(matchWhitelist("https://voorbeeld.nl/belastingen/2026", wl), null);
});

test("meest specifieke match wint (padprefix boven domein)", () => {
  const wl = [
    entry({ id: "a", domein: "voorbeeld.nl", matchtype: "domein", normgewicht: "informatief" }),
    entry({ id: "b", domein: "voorbeeld.nl", matchtype: "padprefix", pad: "/pensioen", normgewicht: "bindend" }),
  ];
  const m = matchWhitelist("https://voorbeeld.nl/pensioen/x", wl);
  assert.equal(m!.entry.id, "b");
  assert.equal(m!.normgewicht, "bindend");
});

// ── allowedDomeinenUit ──────────────────────────────────────
test("allowed_domains: alleen actieve entries, padprefix als domein/pad", () => {
  const wl = [
    entry({ domein: "dnb.nl", matchtype: "domein_subdomeinen", status: "actief" }),
    entry({ domein: "afm.nl", matchtype: "domein", status: "inactief" }),
    entry({ domein: "voorbeeld.nl", matchtype: "padprefix", pad: "/pensioen", status: "actief" }),
  ];
  const ad = allowedDomeinenUit(wl).sort();
  assert.deepEqual(ad, ["dnb.nl", "voorbeeld.nl/pensioen"]);
});

// ── weegWebbronnen (FR-3 / AC-4) ────────────────────────────
test("AC-4: bindend weegt vóór sector_guidance/informatief, stabiel binnen groep", () => {
  const bronnen = [
    { u: "s1", ng: "sector_guidance" as const },
    { u: "b1", ng: "bindend" as const },
    { u: "i1", ng: "informatief" as const },
    { u: "b2", ng: "bindend" as const },
  ];
  const gewogen = weegWebbronnen(bronnen, (x) => x.ng).map((x) => x.u);
  assert.deepEqual(gewogen, ["b1", "b2", "s1", "i1"]);
});

// ── domeinvalidatie (AC-B8) ─────────────────────────────────
test("isGeldigDomein: geldig vs. ongeldig formaat", () => {
  assert.equal(isGeldigDomein("dnb.nl"), true);
  assert.equal(isGeldigDomein("toezicht.dnb.nl"), true);
  assert.equal(isGeldigDomein("https://dnb.nl"), false); // scheme
  assert.equal(isGeldigDomein("dnb.nl/pad"), false); // pad
  assert.equal(isGeldigDomein("dnb"), false); // geen TLD
  assert.equal(isGeldigDomein("dn b.nl"), false); // spatie
});

test("AC-B8: look-alike-domein wordt gemarkeerd, legitiem niet", () => {
  const vertrouwd = ["belastingdienst.nl", "dnb.nl"];
  assert.equal(detecteerLookAlike("belastingdienst-nl.com", vertrouwd).verdacht, true);
  assert.equal(detecteerLookAlike("belastingdienst.com", vertrouwd).verdacht, true);
  // Legitiem subdomein/zelf → niet verdacht.
  assert.equal(detecteerLookAlike("toezicht.dnb.nl", vertrouwd).verdacht, false);
  assert.equal(detecteerLookAlike("dnb.nl", vertrouwd).verdacht, false);
  // Volstrekt ander domein → niet verdacht.
  assert.equal(detecteerLookAlike("cbs.nl", vertrouwd).verdacht, false);
});

console.log(`\n${n} web-whitelist sanity-tests geslaagd.`);
