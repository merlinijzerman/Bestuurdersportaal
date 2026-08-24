// ============================================================================
//  Sanity-tests voor de pure capability-beoordeling (W6, EPIC W, deploy 3).
//
//  Twee dingen worden hier gemeten, allebei zonder I/O en zonder Next-runtime:
//    1. de env-schakelaar. FASE 2 (besluit 0188): sinds W7 alle declaraties heeft
//       ingevuld (nul "TE_BEPALEN") en de env-flip stabiel is waargenomen, zet
//       deze functie productie/preview/staging ALTIJD fail-closed — nu GELIJK aan
//       `tenantEnforceVoorOmgeving`. Buiten die omgevingen blijft de opt-in.
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

test("FASE 2 (0188): productie/preview/staging zetten de poort ALTIJD aan", () => {
  // De inversie van de W6-tegenproef. In W6 mocht een beschermde omgeving de
  // poort NIET stil aanzetten (112× TE_BEPALEN). Na W7 is dat juist de bedoeling:
  // een beschermde omgeving is fail-closed, ook zonder env-waarde en zelfs bij
  // een foute waarde. Gelijk aan tenantEnforceVoorOmgeving.
  for (const veld of ["vercelEnv", "vercelTargetEnv", "deployTarget"] as const) {
    for (const waarde of ["production", "preview", "staging"]) {
      // enforceCapability bewust afwezig én op "off": geen van beide mag de
      // beschermde omgeving nog uitzetten.
      assert.equal(
        capabilityEnforceVoorOmgeving({ [veld]: waarde }),
        true,
        `${veld}=${waarde} moet fail-closed zijn`
      );
      assert.equal(
        capabilityEnforceVoorOmgeving({ [veld]: waarde, enforceCapability: "off" }),
        true,
        `${veld}=${waarde} mag door enforceCapability=off niet stil uitgezet worden`
      );
    }
  }
});

test("FASE 2 (0188): buiten een beschermde omgeving blijft de opt-in gelden", () => {
  // Lokaal/dev: geen omgevingsmarkering → alleen ENFORCE_CAPABILITY=on zet aan.
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: "on" }), true);
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: "off" }), false);
  assert.equal(capabilityEnforceVoorOmgeving({ enforceCapability: undefined }), false);
  assert.equal(capabilityEnforceVoorOmgeving({ vercelEnv: "development" }), false);
  assert.equal(capabilityEnforceVoorOmgeving({ deployTarget: "app", vercelEnv: null }), false);
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
