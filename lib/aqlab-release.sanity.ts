// lib/aqlab-release.sanity.ts
// -----------------------------------------------------------------------------
// Sanity-checks op de PURE release-kern (lib/aqlab/release-core.ts, AQL-4):
// de 7-status-statusmachine + de harde vrijgave-guard (kritieke blokkade,
// run-type-regels, motivatie bij afwijken/subset-vrijgave) + advies-mapping.
// De DB-orchestratie (legVrijgavebesluitVast) is geen pure functie → smoke/handmatig.
// Run: npx tsx lib/aqlab-release.sanity.ts   (of: npm run sanity)
// -----------------------------------------------------------------------------
import assert from "node:assert/strict";
import {
  isToegestaneOvergang,
  mapAdviesNaarDb,
  valideerVrijgaveBesluit,
  wijktAfVanAdvies,
  type VrijgaveBesluitInput,
} from "./aqlab/release-core";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function input(over: Partial<VrijgaveBesluitInput> = {}): VrijgaveBesluitInput {
  return {
    run_type: over.run_type ?? "full_regression",
    gewenste_status: over.gewenste_status ?? "vrijgegeven",
    besluit: over.besluit ?? "vrijgegeven",
    run_advies: over.run_advies ?? "accepteren",
    kritieke_bevindingen_count: over.kritieke_bevindingen_count ?? 0,
    motivatie: over.motivatie ?? null,
    heeft_besluitnemer: over.heeft_besluitnemer ?? true,
  };
}

console.log("aqlab-release sanity-tests:");

// ── Statusmachine (functioneel §6) ─────────────────────────────────────────
test("toegestane overgangen kloppen met §6", () => {
  assert.equal(isToegestaneOvergang("concept", "getest"), true);
  assert.equal(isToegestaneOvergang("getest", "vrijgegeven"), true);
  assert.equal(isToegestaneOvergang("getest", "review_vereist"), true);
  assert.equal(isToegestaneOvergang("review_vereist", "geblokkeerd"), true);
  assert.equal(isToegestaneOvergang("geblokkeerd", "aangepast"), true);
  assert.equal(isToegestaneOvergang("vrijgegeven", "gearchiveerd"), true);
});

test("verboden overgangen worden geweigerd", () => {
  assert.equal(isToegestaneOvergang("concept", "vrijgegeven"), false);
  assert.equal(isToegestaneOvergang("gearchiveerd", "getest"), false);
  assert.equal(isToegestaneOvergang("vrijgegeven", "getest"), false);
});

// ── Advies-mapping ─────────────────────────────────────────────────────────
test("review_required mapt naar aanpassen + review_vereist (geen DB-advies)", () => {
  assert.deepEqual(mapAdviesNaarDb("review_required"), { advies: "aanpassen", geadviseerdeStatus: "review_vereist" });
  assert.deepEqual(mapAdviesNaarDb("accepteren"), { advies: "accepteren", geadviseerdeStatus: "getest" });
  assert.deepEqual(mapAdviesNaarDb(null), { advies: null, geadviseerdeStatus: "getest" });
});

// ── Harde blokkade: kritieke bevinding ─────────────────────────────────────
test("open kritieke bevinding blokkeert vrijgave én accepteren", () => {
  const r = valideerVrijgaveBesluit(input({ kritieke_bevindingen_count: 2 }));
  assert.equal(r.toegestaan, false);
  assert.ok(r.redenen.some((x) => x.includes("kritieke")));
});

test("geen kritieke bevinding + full_regression + accepteren + besluitnemer = toegestaan", () => {
  const r = valideerVrijgaveBesluit(input());
  assert.equal(r.toegestaan, true, r.redenen.join(" | "));
});

// ── Run-type-regels ────────────────────────────────────────────────────────
test("ad_hoc kan nooit vrijgegeven opleveren", () => {
  const r = valideerVrijgaveBesluit(input({ run_type: "ad_hoc" }));
  assert.equal(r.toegestaan, false);
  assert.ok(r.redenen.some((x) => x.toLowerCase().includes("ad-hoc")));
});

test("subset-vrijgave vereist governance-motivatie", () => {
  const zonder = valideerVrijgaveBesluit(input({ run_type: "subset", run_advies: "accepteren", motivatie: null }));
  assert.equal(zonder.toegestaan, false);
  assert.equal(zonder.motivatie_verplicht, true);
  const met = valideerVrijgaveBesluit(input({ run_type: "subset", run_advies: "accepteren", motivatie: "Governance akkoord: subset dekt de gewijzigde as." }));
  assert.equal(met.toegestaan, true, met.redenen.join(" | "));
});

// ── Vrijgegeven vereist besluitnemer + tijdstip ────────────────────────────
test("vrijgegeven zonder besluitnemer wordt geweigerd", () => {
  const r = valideerVrijgaveBesluit(input({ heeft_besluitnemer: false }));
  assert.equal(r.toegestaan, false);
  assert.ok(r.redenen.some((x) => x.includes("besluitnemer")));
});

// ── Motivatie verplicht bij afwijken van het advies ────────────────────────
test("afwijken van advies (blokkeren → toch vrijgeven) vereist motivatie", () => {
  const zonder = valideerVrijgaveBesluit(input({ run_advies: "blokkeren", motivatie: null }));
  assert.equal(zonder.motivatie_verplicht, true);
  assert.equal(zonder.toegestaan, false);
  const met = valideerVrijgaveBesluit(input({ run_advies: "blokkeren", motivatie: "Bewuste governance-afwijking, gemotiveerd." }));
  assert.equal(met.toegestaan, true, met.redenen.join(" | "));
});

test("wijktAfVanAdvies: advies accepteren + vrijgeven = geen afwijking", () => {
  assert.equal(wijktAfVanAdvies(input({ run_advies: "accepteren", besluit: "vrijgegeven" })), false);
  assert.equal(wijktAfVanAdvies(input({ run_advies: "blokkeren", besluit: "vrijgegeven" })), true);
  assert.equal(wijktAfVanAdvies(input({ run_advies: "accepteren", besluit: "geblokkeerd", gewenste_status: "geblokkeerd" })), true);
});

// ── Besluit ↔ status-consistentie (code-review) ────────────────────────────
test("besluit='vrijgegeven' op een niet-vrijgegeven status wordt geweigerd", () => {
  const r = valideerVrijgaveBesluit(input({ gewenste_status: "getest", besluit: "vrijgegeven" }));
  assert.equal(r.toegestaan, false);
  assert.ok(r.redenen.some((x) => x.includes("overeenkomen")));
});

// ── Formeel no-go = herleidbaar mensbesluit (governance-review E) ───────────
test("geblokkeerd (no-go) vereist besluit='geblokkeerd' + besluitnemer", () => {
  const zonderNemer = valideerVrijgaveBesluit(input({ gewenste_status: "geblokkeerd", besluit: "geblokkeerd", run_advies: "blokkeren", heeft_besluitnemer: false }));
  assert.equal(zonderNemer.toegestaan, false);
  const zonderBesluit = valideerVrijgaveBesluit(input({ gewenste_status: "geblokkeerd", besluit: null, run_advies: "blokkeren" }));
  assert.equal(zonderBesluit.toegestaan, false);
  const compleet = valideerVrijgaveBesluit(input({ gewenste_status: "geblokkeerd", besluit: "geblokkeerd", run_advies: "blokkeren" }));
  assert.equal(compleet.toegestaan, true, compleet.redenen.join(" | "));
});

test("no-go tegen een 'accepteren'-advies vereist motivatie (afwijking)", () => {
  const zonder = valideerVrijgaveBesluit(input({ gewenste_status: "geblokkeerd", besluit: "geblokkeerd", run_advies: "accepteren", motivatie: null }));
  assert.equal(zonder.motivatie_verplicht, true);
  assert.equal(zonder.toegestaan, false);
  const met = valideerVrijgaveBesluit(input({ gewenste_status: "geblokkeerd", besluit: "geblokkeerd", run_advies: "accepteren", motivatie: "Bewuste no-go ondanks positief advies." }));
  assert.equal(met.toegestaan, true, met.redenen.join(" | "));
});

console.log(`\n${n} sanity-tests geslaagd.`);
