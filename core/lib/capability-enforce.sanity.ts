// ============================================================================
//  Sanity-tests voor de pure capability-beoordeling (W6, EPIC W, deploy 3).
//
//  Twee dingen worden hier gemeten, allebei zonder I/O en zonder Next-runtime:
//    1. de env-schakelaar — en vooral: dat hij NIET het omgevingsgedrag van
//       `tenantEnforceVoorOmgeving` kopieert. Zou hij preview/productie
//       automatisch fail-closed zetten, dan zou de eerste W6-deploy het hele
//       portaal op 403 zetten, want alle 112 handlers staan op "TE_BEPALEN".
//    2. de zou-beslissing per declaratie, inclusief de drie bijzondere waarden.
//
//  Uitvoeren: npx tsx core/lib/capability-enforce.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  beoordeelCapability,
  capabilityEnforceVoorOmgeving,
} from "./capability-enforce";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("capability-enforce sanity-tests:");

// ── De env-schakelaar ────────────────────────────────────────────────────────

test("alleen ENFORCE_CAPABILITY=on zet de poort aan", () => {
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: "on" }), true);
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: " ON " }), true);
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: "off" }), false);
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: "" }), false);
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: null }), false);
  assert.equal(capabilityEnforceVoorOmgeving({}), false);
});

test("de schakelaar leunt NIET op de omgeving — de vlag-default flipt pas in W7+", () => {
  // Tegenproef op de verleiding om tenantEnforceVoorOmgeving te kopiëren. Zolang
  // er 112 declaraties "TE_BEPALEN" staan, is een omgevings-default hetzelfde als
  // het portaal uitzetten. De flip naar fail-closed hoort in deze functie thuis,
  // op een eigen moment, met een eigen BESLUIT.
  //
  // Geen object-literal maar een variabele: zo passeert de excess-property-check
  // en toetst de assertie het RUNTIME-gedrag — de functie kijkt naar geen van
  // deze velden. De typefout zou hier juist het bewijs verbergen.
  const omgevingsInvoer = {
    enforceCapability: undefined,
    vercelEnv: "production",
    vercelTargetEnv: "preview",
    deployTarget: "staging",
  };
  assert.equal(
    capabilityEnforceVoorOmgeving(omgevingsInvoer),
    false,
    "een beschermde omgeving mag de poort in W6 niet stil aanzetten"
  );
});

// ── De zou-beslissing ────────────────────────────────────────────────────────

test('"TE_BEPALEN" wordt ALTIJD geweigerd — voor elke rol, ook beheerder', () => {
  for (const rol of ["beheerder", "voorzitter", "bestuurder", "bestuursbureau", null]) {
    const o = beoordeelCapability({ capability: "TE_BEPALEN", rol });
    assert.equal(o.toegestaan, false, `TE_BEPALEN liet ${rol} door`);
    assert.equal(o.toegestaan === false && o.reden, "te-bepalen");
  }
});

test('"iedere-ingelogde" laat elke rol door, ook een onbekende', () => {
  for (const rol of ["bestuurder", "bestuursbureau", "iets-nieuws"]) {
    assert.equal(beoordeelCapability({ capability: "iedere-ingelogde", rol }).toegestaan, true);
  }
});

test('"iedere-ingelogde" laat óók een sessie zonder profiel door', () => {
  // Bewust: de wrapper heeft dan al een geldige sessie vastgesteld; dat een
  // profielrij ontbreekt is een datavraag, geen autorisatievraag. Wie dat wél
  // wil afsluiten, declareert een echte capability.
  assert.equal(beoordeelCapability({ capability: "iedere-ingelogde", rol: null }).toegestaan, true);
});

test('"publiek" laat door zonder rol', () => {
  const o = beoordeelCapability({ capability: "publiek", rol: null });
  assert.equal(o.toegestaan, true);
  assert.equal(o.toegestaan === true && o.reden, "publiek");
});

test("een echte capability volgt ROL_CAPABILITIES — en niets anders", () => {
  assert.equal(beoordeelCapability({ capability: "dossiers.manage", rol: "voorzitter" }).toegestaan, true);
  assert.equal(beoordeelCapability({ capability: "dossiers.manage", rol: "bestuurder" }).toegestaan, false);
  assert.equal(beoordeelCapability({ capability: "catalog.manage", rol: "beheerder" }).toegestaan, true);
  assert.equal(beoordeelCapability({ capability: "catalog.manage", rol: "voorzitter" }).toegestaan, false);
  assert.equal(beoordeelCapability({ capability: "ai.deskresearch", rol: "bestuursbureau" }).toegestaan, true);
  assert.equal(beoordeelCapability({ capability: "ai.deskresearch", rol: "beheerder" }).toegestaan, false);
});

test("geen rol → geweigerd bij een echte capability, met eigen reden", () => {
  for (const rol of [null, undefined, ""]) {
    const o = beoordeelCapability({ capability: "dossiers.manage", rol });
    assert.equal(o.toegestaan, false);
    assert.equal(o.toegestaan === false && o.reden, "geen-rol");
  }
});

test("een onbekende rol krijgt geen capabilities", () => {
  const o = beoordeelCapability({ capability: "dossiers.manage", rol: "verzonnen-rol" });
  assert.equal(o.toegestaan, false);
  assert.equal(o.toegestaan === false && o.reden, "rol-mist-capability");
});

// ── §4-audit, als test verankerd ─────────────────────────────────────────────

test("de zes capabilities die NUL rollen uitsluiten scheiden aantoonbaar niets", () => {
  // Dit is geen wens maar een MEETING, en ze staat hier zodat W7 haar niet
  // opnieuw hoeft te doen en een latere maprij haar niet stil ongedaan maakt.
  // Een capability die alle vier de rollen hebben is geen autorisatiepoort;
  // declareer op zo'n route `iedere-ingelogde`, óf herstel de map. Zie
  // TICKET-W6 §4 en de audit bij het issue.
  const NUL_UITSLUITING = [
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "profile.manage.own",
    "stuurinformatie.view",
    "klantbeeld.view",
  ] as const;
  for (const cap of NUL_UITSLUITING) {
    for (const rol of ["beheerder", "voorzitter", "bestuurder", "bestuursbureau"]) {
      assert.equal(
        beoordeelCapability({ capability: cap, rol }).toegestaan,
        true,
        `${cap} sluit ${rol} nu wél uit — de §4-audit is achterhaald, werk hem bij`
      );
    }
  }
});

console.log(`\nAlle ${n} capability-enforce sanity-tests groen.`);
