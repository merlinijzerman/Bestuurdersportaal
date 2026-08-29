// ============================================================
//  Sanity-tests voor het capability-model (besluit 0006 B11).
//
//  De DB-read (requireCapability) is niet pure-TS testbaar; de
//  autorisatie-LOGICA zit in de pure mapping rolHeeftCapability. Die toetsen we
//  hier 1-op-1 tegen de eis uit het ticket (§7/§14 punt 5): beheerder mag
//  catalog.manage; bestuurder/voorzitter niet.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/capabilities.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { rolHeeftCapability, ROL_CAPABILITIES } from "./capabilities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("capability sanity-tests:");

test("beheerder heeft catalog.manage", () => {
  assert.equal(rolHeeftCapability("beheerder", "catalog.manage"), true);
});

test("bestuurder heeft GEEN catalog.manage", () => {
  assert.equal(rolHeeftCapability("bestuurder", "catalog.manage"), false);
});

test("voorzitter heeft GEEN catalog.manage", () => {
  assert.equal(rolHeeftCapability("voorzitter", "catalog.manage"), false);
});

test("onbekende rol heeft geen capabilities", () => {
  assert.equal(rolHeeftCapability("auditor", "catalog.manage"), false);
});

test("null/undefined rol is veilig (geen capability)", () => {
  assert.equal(rolHeeftCapability(null, "catalog.manage"), false);
  assert.equal(rolHeeftCapability(undefined, "catalog.manage"), false);
});

test("alle vier de bekende rollen staan in de mapping", () => {
  for (const rol of ["beheerder", "voorzitter", "bestuurder", "bestuursbureau"]) {
    assert.ok(rol in ROL_CAPABILITIES, `${rol} ontbreekt in mapping`);
  }
});

test("beheerder heeft dossiers.manage", () => {
  assert.equal(rolHeeftCapability("beheerder", "dossiers.manage"), true);
});

test("voorzitter heeft dossiers.manage", () => {
  assert.equal(rolHeeftCapability("voorzitter", "dossiers.manage"), true);
});

test("bestuurder heeft GEEN dossiers.manage", () => {
  assert.equal(rolHeeftCapability("bestuurder", "dossiers.manage"), false);
});

// ── Increment C — document-/metadata-capabilities ──────────────────────
const C_CAPS = [
  "documents.metadata.update",
  "documents.status.change",
  "documents.bronstatus.change",
  "metadata.review",
] as const;

test("beheerder + voorzitter dragen alle C-capabilities", () => {
  for (const cap of C_CAPS) {
    assert.equal(rolHeeftCapability("beheerder", cap), true, `beheerder ${cap}`);
    assert.equal(rolHeeftCapability("voorzitter", cap), true, `voorzitter ${cap}`);
  }
});

// I-2-release: bestuurder mag ALLE metadatavelden bewerken — koppelvelden
// (documents.metadata.update) én documentstatus/bronstatus. Review-AFRONDING
// (metadata.review) is een beoordelende governance-handeling, GEEN metadata-
// bewerking, en blijft bij beheerder/voorzitter.
const C_BEWERK_CAPS = [
  "documents.metadata.update",
  "documents.status.change",
  "documents.bronstatus.change",
] as const;

test("bestuurder draagt alle metadata-bewerkcapabilities (I-2-release)", () => {
  for (const cap of C_BEWERK_CAPS) {
    assert.equal(rolHeeftCapability("bestuurder", cap), true, `bestuurder ${cap}`);
  }
});

test("bestuurder draagt GEEN metadata.review (review = governance, geen bewerking)", () => {
  assert.equal(rolHeeftCapability("bestuurder", "metadata.review"), false);
});

// ── Increment E — classification.review ────────────────────────────────
test("beheerder + voorzitter dragen classification.review", () => {
  assert.equal(rolHeeftCapability("beheerder", "classification.review"), true);
  assert.equal(rolHeeftCapability("voorzitter", "classification.review"), true);
});

test("bestuurder draagt GEEN classification.review", () => {
  assert.equal(rolHeeftCapability("bestuurder", "classification.review"), false);
});

// ── Increment D — notulen.segment.confirm ──────────────────────────────
test("beheerder + voorzitter dragen notulen.segment.confirm", () => {
  assert.equal(rolHeeftCapability("beheerder", "notulen.segment.confirm"), true);
  assert.equal(rolHeeftCapability("voorzitter", "notulen.segment.confirm"), true);
});

test("bestuurder draagt GEEN notulen.segment.confirm (server-side gating)", () => {
  assert.equal(rolHeeftCapability("bestuurder", "notulen.segment.confirm"), false);
});

// ── Increment F — profile.manage.own (strikt zelfbeheer, besluit 0017) ─────
test("alle vier de rollen dragen profile.manage.own (eigen profiel beheren)", () => {
  for (const rol of ["beheerder", "voorzitter", "bestuurder", "bestuursbureau"]) {
    assert.equal(rolHeeftCapability(rol, "profile.manage.own"), true, `${rol} profile.manage.own`);
  }
});

// ── W7 (#153) — de 24 gedeclareerde gates ─────────────────────────────────
// Deze set bestaat zodat élke route een GEDECLAREERDE poort heeft; wie hem draagt
// is bewust nog niet ingevuld (besluitregister regel 1). Twee gates zijn wél
// meteen scherp: daar dragen ALLE onderliggende routes vandaag al dezelfde
// rolgate, dus scherp declareren verandert niets aan het gedrag (regel 3).
//
// Deze constanten dienen één doel: de pins hieronder blijven leesbaar als
// BASELINE + W7-DELTA. Wijzigt er iets buiten deze delta, dan faalt de nulgrens-
// test nog steeds luid — precies waarvoor hij is gebouwd.
const W7_GATES = [
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "beheer.backfill",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.lifecycle.manage",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "inbreng.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "stemming.deelname",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
  ] as const;

// NB: dit is de W7-delta-pin, maar hij houdt óók latere tranche-toevoegingen bij
// zodat de rol-union sluitend blijft. P3 (#168) voegt `procedures.afwijking.
// vastleggen` toe aan voorzitter + bestuurder (níet beheerder/bestuursbureau) —
// dat is een P3-capability, geen W7-gate (staat dan ook niet in W7_GATES).
const W7_PER_ROL: Record<string, readonly string[]> = {
  beheerder: [
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "beheer.backfill",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.lifecycle.manage",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "inbreng.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "stemming.deelname",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
  ],
  voorzitter: [
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "beheer.backfill",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.lifecycle.manage",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "inbreng.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "procedures.afwijking.vastleggen",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "stemming.deelname",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
  ],
  bestuurder: [
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "inbreng.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "procedures.afwijking.vastleggen",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "stemming.deelname",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
  ],
  bestuursbureau: [
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
  ],
};

test("de 24 W7-gates staan aan minstens één rol toegekend", () => {
  for (const gate of W7_GATES) {
    const dragers = Object.entries(ROL_CAPABILITIES)
      .filter(([, caps]) => (caps as string[]).includes(gate))
      .map(([rol]) => rol);
    assert.ok(dragers.length > 0, `${gate} hangt aan geen enkele rol — dan geeft elke route die hem declareert 403 voor iedere rol`);
  }
});

test("twee W7-gates zijn meteen scherp: alleen voorzitter en beheerder", () => {
  // Besluit 3. Niet omdat W7 dit beslist, maar omdat alle routes onder deze twee
  // gates vandaag al `voorzitter|beheerder` afdwingen. Richting: gelijk.
  for (const gate of ["beheer.backfill", "documents.lifecycle.manage"] as const) {
    assert.equal(rolHeeftCapability("voorzitter", gate), true, `voorzitter ${gate}`);
    assert.equal(rolHeeftCapability("beheerder", gate), true, `beheerder ${gate}`);
    assert.equal(rolHeeftCapability("bestuurder", gate), false, `bestuurder mag ${gate} niet dragen`);
    assert.equal(rolHeeftCapability("bestuursbureau", gate), false, `bestuursbureau mag ${gate} niet dragen`);
  }
});

test("twee W7-gates sluiten het bestuursbureau uit", () => {
  // inbreng en stemdeelname zijn bestuurlijke handelingen; álle routes eronder
  // weigeren het bureau vandaag al via isBureauRol() en via RLS (§5.3).
  for (const gate of ["inbreng.manage", "stemming.deelname"] as const) {
    assert.equal(rolHeeftCapability("bestuursbureau", gate), false, `bestuursbureau mag ${gate} niet dragen`);
    for (const rol of ["bestuurder", "voorzitter", "beheerder"]) {
      assert.equal(rolHeeftCapability(rol, gate), true, `${rol} ${gate}`);
    }
  }
});

test("de tenant-union draagt geen platform-only capabilities (regressie)", () => {
  // `generic.library.manage` was een dode tenant-capability: aan geen enkele rol
  // toegekend, door geen enkele route gedeclareerd. De werkelijke capability heet
  // `platform.generic.library.manage` en hoort in het PLATFORMmodel
  // (platform-capabilities.ts), niet in de tenant-union. Hij is verwijderd; deze
  // test bewaakt dat noch die naam, noch een andere `platform.`-naam terugkeert in
  // de tenant-union — dat zou de modelscheiding (T9) doorbreken.
  const tenantNamen = new Set(Object.values(ROL_CAPABILITIES).flat());
  assert.ok(!tenantNamen.has("generic.library.manage" as never), "dode capability terug in de tenant-union");
  for (const naam of tenantNamen) {
    assert.ok(!(naam as string).startsWith("platform."), `platform-capability '${naam}' hoort niet in de tenant-union`);
  }
});

// ── T1 bureau-rol (ontwerp §5.2, besluit 0128) ─────────────────────────────
// De mapping van `bestuursbureau` is een governance-afspraak met het fonds, geen
// implementatiedetail. Daarom exact gepind: wat erin zit én wat er bewust NIET in
// zit. Wijzigt iemand de rij, dan faalt dit als signaal om §5.2 opnieuw te wegen.
const BUREAU_WEL = [
  "documents.metadata.update",
  "documents.status.change",
  "documents.bronstatus.change",
  "profile.manage.own",
  "stuurinformatie.view",
  "klantbeeld.view",
  "ai.deskresearch",
  "ai.stukvoorbereiding",
] as const;

const BUREAU_NIET = [
  "metadata.review",
  "classification.review",
  "notulen.segment.confirm",
  "dossiers.manage",
  "catalog.manage",
  "organisation.profile.manage",
  "fonds.config.manage",
  "stuurinformatie.manage",
] as const;

test("bestuursbureau draagt exact de capabilities uit ontwerp §5.2", () => {
  assert.deepEqual(
    [...ROL_CAPABILITIES.bestuursbureau].sort(),
    [...BUREAU_WEL, ...W7_PER_ROL.bestuursbureau].sort(),
    "de rij bestuursbureau wijkt af van §5.2 plus de W7-gates"
  );
});

test("bestuursbureau draagt géén van de negen uitgesloten capabilities", () => {
  for (const cap of BUREAU_NIET) {
    assert.equal(
      rolHeeftCapability("bestuursbureau", cap),
      false,
      `bestuursbureau mag ${cap} niet dragen (§5.3)`
    );
  }
});

// De twee nieuwe capabilities zijn in T1 BEWUST alleen gedefinieerd en toegekend,
// niet bedraad. Ze horen aan geen enkele andere rol te hangen — anders zou een
// latere bedrading (T2 / deskresearch-ticket) het gedrag van een bestaande rol
// wijzigen en de nulgrens G23 breken.
test("ai.deskresearch en ai.stukvoorbereiding hangen uitsluitend aan bestuursbureau", () => {
  for (const [rol, caps] of Object.entries(ROL_CAPABILITIES)) {
    const heeftBureauCaps =
      (caps as string[]).includes("ai.deskresearch") ||
      (caps as string[]).includes("ai.stukvoorbereiding");
    assert.equal(
      heeftBureauCaps,
      rol === "bestuursbureau",
      `${rol} hoort de ai.*-bureaucapabilities ${rol === "bestuursbureau" ? "wél" : "niet"} te dragen`
    );
  }
});

// ── Nulgrens G23 — bewijs in code ──────────────────────────────────────────
// De bureau-rol is additief. De capability-sets van de drie bestaande rollen zijn
// hier letterlijk gepind: wijzigt er één, dan is dat per definitie een doorbraak
// van de nulgrens en faalt deze test luid in plaats van stil.
test("nulgrens G23: de drie bestaande rollen zijn alleen met W7-gates uitgebreid", () => {
  // De sets van vóór W7, letterlijk gepind. G23 (besluit 0128) verbiedt dat het
  // GEDRAG en de RECHTEN van deze drie rollen wijzigen. W7 voegt gates toe die op
  // dit moment door GEEN ENKELE route worden gedeclareerd — er verandert dus geen
  // responsebyte. En zodra PR-B ze declareert, blijft elke route-eigen gate staan,
  // dus ook dan wint de strengste. Wat hier wél verandert is de VERZAMELING, en
  // die hoort zichtbaar te veranderen in plaats van stil.
  //
  // Wijzigt er iets buiten de W7-delta, dan faalt deze test nog steeds luid.
  const VOOR_W7_beheerder = [
    "catalog.manage",
    "classification.review",
    "documents.bronstatus.change",
    "documents.metadata.update",
    "documents.status.change",
    "dossiers.manage",
    "fonds.config.manage",
    "klantbeeld.view",
    "metadata.review",
    "notulen.segment.confirm",
    "organisation.profile.manage",
    "profile.manage.own",
    "stuurinformatie.manage",
    "stuurinformatie.view",
  ];
  const VOOR_W7_voorzitter = [
    "classification.review",
    "documents.bronstatus.change",
    "documents.metadata.update",
    "documents.status.change",
    "dossiers.manage",
    "fonds.config.manage",
    "klantbeeld.view",
    "metadata.review",
    "notulen.segment.confirm",
    "profile.manage.own",
    "stuurinformatie.manage",
    "stuurinformatie.view",
  ];
  const VOOR_W7_bestuurder = [
    "documents.bronstatus.change",
    "documents.metadata.update",
    "documents.status.change",
    "klantbeeld.view",
    "profile.manage.own",
    "stuurinformatie.view",
  ];

  assert.deepEqual(
    [...ROL_CAPABILITIES.beheerder].sort(),
    [...VOOR_W7_beheerder, ...W7_PER_ROL.beheerder].sort(),
    "beheerder: wijziging buiten de W7-delta"
  );
  assert.deepEqual(
    [...ROL_CAPABILITIES.voorzitter].sort(),
    [...VOOR_W7_voorzitter, ...W7_PER_ROL.voorzitter].sort(),
    "voorzitter: wijziging buiten de W7-delta"
  );
  assert.deepEqual(
    [...ROL_CAPABILITIES.bestuurder].sort(),
    [...VOOR_W7_bestuurder, ...W7_PER_ROL.bestuurder].sort(),
    "bestuurder: wijziging buiten de W7-delta"
  );
});

test("er bestaat GEEN profile.manage.all in de mapping (geen beheerder-override)", () => {
  // Profielen zijn strikt zelfbeheerd; niemand mag andermans profiel wijzigen.
  // Zou er ooit een manage.all bijkomen, dan faalt deze test bewust als signaal
  // om de privacy-keuze (besluit 0017) opnieuw te wegen.
  for (const caps of Object.values(ROL_CAPABILITIES)) {
    assert.ok(
      !(caps as string[]).includes("profile.manage.all"),
      "profile.manage.all mag aan geen enkele rol toegekend zijn"
    );
  }
});

console.log(`\n${n} sanity-tests geslaagd.`);
