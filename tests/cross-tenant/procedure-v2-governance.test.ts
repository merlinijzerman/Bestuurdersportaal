// ============================================================================
//  §15 / engine v2 — governance- en tenant-invarianten op de nieuwe D6/D7-routes.
// ----------------------------------------------------------------------------
//  App-laag, bron-inspectie (zelfde patroon als audit-fonds.test.ts): de
//  kritieke server-side waarborgen op de nieuwe routes mogen niet stil
//  regresseren. De DB-laag (RLS-weigering, readiness-unie, snapshot-integriteit)
//  staat in supabase/checks/2026_08_13_engine_v2_verificatie.sql en draait tegen
//  de doeldatabase.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/procedure-v2-governance.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const requirementsRoute = lees("app", "api", "procedures", "[id]", "requirements", "route.ts");
const requirementItemRoute = lees("app", "api", "procedures", "[id]", "requirements", "[reqId]", "route.ts");
const heropenenRoute = lees("app", "api", "procedures", "[id]", "stappen", "[stapId]", "heropenen", "route.ts");
const checklistItemRoute = lees("app", "api", "procedures", "[id]", "checklist", "[itemId]", "route.ts");
const decisionLib = lees("core", "lib", "decision.ts");
const readinessMigratie = lees("supabase", "migrations", "2026_08_13_d7c_readiness_unie.sql");
// Bewijsbinding (2026-08-18): de geldende versie van fn_decision_readiness_check.
const bindingMigratie = lees("supabase", "migrations", "2026_08_18_bewijs_requirement_binding.sql");
const bindingHardening = lees("supabase", "migrations", "2026_08_22_bewijs_requirement_binding_hardening.sql");
const bewijsRoute = lees("app", "api", "procedures", "[id]", "bewijs", "route.ts");
const bewijsItemRoute = lees("app", "api", "procedures", "[id]", "bewijs", "[bewijsId]", "route.ts");

const rolGate = /\[\s*"voorzitter"\s*,\s*"beheerder"\s*\]\.includes\(/;

test("D7 requirements-toevoegen: rol-gate voorzitter/beheerder aanwezig", () => {
  assert.match(requirementsRoute, rolGate);
});

test("D7 requirements-toevoegen: fonds_id server-side uit de procedure, niet uit de body", () => {
  // Fonds komt uit een select op `procedures`, en wordt aan de insert gevoerd.
  // De selectlijst mag groeien (sinds de bewijsbinding staat `template_code`
  // erbij voor de sleutel-uniciteitscheck); de eis is dat fonds_id uit
  // `procedures` komt en niet uit de body.
  assert.match(requirementsRoute, /from\("procedures"\)[\s\S]*?select\("id, fonds_id[^"]*"\)/);
  assert.match(requirementsRoute, /fonds_id:\s*procedure\.fonds_id/);
  // Geen fonds_id rechtstreeks uit de request body.
  assert.doesNotMatch(requirementsRoute, /body\.fonds_id/);
});

test("D7 requirements-toevoegen: schrijft een governance_event", () => {
  assert.match(requirementsRoute, /from\("governance_events"\)\s*\.insert/);
  assert.match(requirementsRoute, /event_type:\s*"requirement_toegevoegd"/);
});

test("D7 requirement deactiveren: REQ-006 — blokkerend vereist motivering", () => {
  // De guard moet blokkerend + actief===false + ontbrekende motivering afvangen.
  assert.match(
    requirementItemRoute,
    /reqRow\.blokkerend\s*&&\s*body\.actief === false\s*&&\s*!motivering/
  );
  assert.match(requirementItemRoute, /status:\s*422/);
  assert.match(requirementItemRoute, rolGate);
});

test("D6 heropenen: rol-gate + verplichte motivering + governance_event", () => {
  assert.match(heropenenRoute, rolGate);
  // Motivering verplicht: lege motivering → 400.
  assert.match(heropenenRoute, /if\s*\(!motivering\)/);
  assert.match(heropenenRoute, /event_type:\s*"stap_heropend"/);
  // Alleen een afgeronde stap mag heropend worden.
  assert.match(heropenenRoute, /stap\.status !== "afgerond"/);
});

test("D7 checklist (de)activeren: rol-gate + governance_event", () => {
  assert.match(checklistItemRoute, rolGate);
  assert.match(checklistItemRoute, /checklistitem_gedeactiveerd/);
});

test("D7 readiness-unie: buildEvidenceLijst leest actieve instantie-requirements", () => {
  assert.match(decisionLib, /from\("procedure_requirement_instance"\)/);
  assert.match(decisionLib, /\.eq\("actief",\s*true\)/);
  // De unie mag geen dubbeltelling geven: template + instance worden
  // geconcateneerd (disjuncte rijen), niet gededupliceerd weg.
  assert.match(
    decisionLib,
    /alleRequirements\s*:\s*MergedRequirement\[\]\s*=\s*\[\s*\.\.\.requirements,\s*\.\.\.instanceRequirements,?\s*\]/
  );
});

test("D7 readiness-migratie: UNION ALL van template + instantie én grant-herstel (Gate H)", () => {
  assert.match(readinessMigratie, /union all/i);
  assert.match(readinessMigratie, /procedure_requirement_instance/);
  assert.match(readinessMigratie, /actief\s*=\s*true/);
  // Grant-hygiëne na create-or-replace (les OP-C13).
  assert.match(readinessMigratie, /revoke all on function public\.fn_decision_readiness_check\(uuid, text\) from public, anon/);
  assert.match(readinessMigratie, /grant execute on function public\.fn_decision_readiness_check\(uuid, text\) to authenticated, service_role/);
});

// ── Bewijsbinding (2026-08-18) ──────────────────────────────────────────────
//
// Regressiebewaking op de bewijsmatching-fix: één bewijsstuk vinkte álle
// document-vereisten van dezelfde stap af, zowel in de weergave (decision.ts)
// als in de gate (fn_decision_readiness_check). Deze tests bewaken dat de
// wildcard in geen van beide lagen terugkeert en dat weergave en gate dezelfde
// sleutel gebruiken. Het gedragsbewijs staat in core/lib/decision.sanity.ts
// (TS) en supabase/checks/2026_08_18_bewijsbinding.sql (DB), op één fixture.

test("bewijsbinding: de wildcard is weg uit de weergavelaag", () => {
  assert.doesNotMatch(decisionLib, /if\s*\(\s*!req\.documenttype\s*\)\s*return true/);
  // Vervulling loopt via de expliciete binding, niet via een titel-substring.
  assert.match(decisionLib, /b\.requirement_sleutel === sleutel/);
  assert.doesNotMatch(decisionLib, /titel\s*\?\?\s*""\)\s*\n?\s*\.toLowerCase\(\)\s*\n?\s*\.includes\(req\.documenttype/);
});

// Alleen de functiebody, niet het kopcommentaar — dat citeert de oude
// predicaten juist om uit te leggen wát er is opgeruimd.
const bindingFunctie = bindingMigratie.slice(
  bindingMigratie.indexOf("create or replace function")
);

test("bewijsbinding: de wildcard is weg uit de gate", () => {
  assert.ok(bindingFunctie.length > 0, "functiedefinitie niet gevonden in de migratie");
  assert.doesNotMatch(bindingFunctie, /rij\.documenttype is null/);
  assert.doesNotMatch(bindingFunctie, /like '%' \|\| lower\(rij\.documenttype\)/);
  assert.match(bindingFunctie, /pb\.requirement_sleutel = v_sleutel/);
});

test("bewijsbinding: TS en SQL bouwen dezelfde sleutel", () => {
  // TS: `${stapVolgorde}|${requirementType}|${identiteit}` in requirement-sleutel.ts,
  // met identiteit = documenttype ?? label.
  const sleutelLib = lees("core", "lib", "requirement-sleutel.ts");
  assert.match(sleutelLib, /\$\{stapVolgorde\}\|\$\{requirementType\}\|\$\{requirementIdentiteit\(/);
  assert.match(sleutelLib, /return documenttype \?\? label;/);
  // SQL: stap_volgorde || '|' || requirement_type || '|' || coalesce(documenttype, label).
  assert.match(
    bindingFunctie,
    /rij\.stap_volgorde::text \|\| '\|' \|\| rij\.requirement_type \|\|\s*\n?\s*'\|' \|\| coalesce\(rij\.documenttype, rij\.label\)/
  );
  // Het oorspronkelijke requirement_type, niet de v_type-mapping naar 'document'.
  assert.doesNotMatch(bindingFunctie, /\|\| v_type \|\|/);
});

test("bewijsbinding: grant-herstel na create-or-replace (Gate H)", () => {
  assert.match(bindingMigratie, /revoke all on function public\.fn_decision_readiness_check\(uuid, text\) from public, anon/);
  assert.match(bindingMigratie, /grant execute on function public\.fn_decision_readiness_check\(uuid, text\) to authenticated, service_role/);
});

test("bewijsbinding: de backfill laat een auditspoor na", () => {
  assert.match(bindingMigratie, /insert into public\.procedure_log/);
  assert.match(bindingMigratie, /'bewijs_binding_backfill'/);
  // Systeemmutatie: expliciet zonder actor, maar wél herleidbaar benoemd.
  assert.match(bindingMigratie, /systeem \(migratie 2026_08_18/);
  // Niet alleen de negatieve helft: elke gelegde binding wordt per rij
  // vastgelegd, met de regel die hem legde. De backfill is niet herrekenbaar
  // (procedure_requirements wordt bij elke seed ge-delete), dus wat hier niet
  // in de log staat, is definitief weg.
  assert.match(bindingMigratie, /'gebonden',\s*coalesce\(/);
  assert.match(bindingMigratie, /jsonb_build_object\('bewijs_id', g\.bewijs_id, 'sleutel', g\.sleutel, 'regel', g\.regel\)/);
  assert.match(bindingMigratie, /'ongebonden_bewijs_ids'/);
  assert.match(bindingMigratie, /union all/);
  assert.match(bindingMigratie, /delete from _bind_kandidaten/);
  assert.match(bindingMigratie, /having count\(\*\) <> 1/);
  // Een herhaalde run mag niet stil muteren: logt zodra er iets gebonden is,
  // en bij de eerste run ook als er niets te binden viel.
  assert.match(
    bindingMigratie,
    /having count\(\*\) filter \(where g\.bewijs_id is not null\) > 0\s*\n?\s*or not exists \(/
  );
});

test("bewijsbinding: de sleutel wordt server-side afgeleid, niet uit de body overgenomen", () => {
  for (const route of [bewijsRoute, bewijsItemRoute]) {
    assert.match(route, /resolveRequirementBinding\(/);
    // De client stuurt een triple; een kant-en-klare sleutel wordt genegeerd.
    assert.doesNotMatch(route, /body\.requirement_sleutel/);
  }
});

test("bewijsbinding: mutaties worden in de database atomair gelogd", () => {
  assert.match(bindingHardening, /create trigger trg_procedure_bewijs_audit/);
  assert.match(bindingHardening, /after insert or update or delete on public\.procedure_bewijs/);
  assert.match(bindingHardening, /'bewijs_binding_gewijzigd'/);
  assert.match(bindingHardening, /'bewijs_document_gekoppeld'/);
  assert.match(bindingHardening, /'bewijs_verwijderd'/);
  assert.match(bindingHardening, /herkomst- en inhoudsvelden zijn immutable/);
  // Geen tweede, niet-atomische loginsert in de routes: de trigger is het ene
  // schrijfpad en geldt daardoor ook voor directe PostgREST-writes.
  assert.doesNotMatch(bewijsRoute, /from\("procedure_log"\)\.insert/);
  assert.doesNotMatch(bewijsItemRoute, /from\("procedure_log"\)\.insert/);
});

test("bewijsbinding: de database weigert onbekende, ambigue en dubbele claims", () => {
  assert.match(bindingHardening, /fn_validate_bewijs_requirement_binding/);
  assert.match(bindingHardening, /fn_validate_requirement_instance_binding_sleutel/);
  assert.match(bindingHardening, /vereistesleutel is dubbel gedefinieerd/);
  assert.match(bindingHardening, /create unique index idx_procbewijs_req_sleutel/);
  assert.match(bindingHardening, /idx_procedure_stappen_volgorde_uniek/);
  assert.match(bindingFunctie, /v_sleutel_count = 1/);
});

test("bewijsbinding: beslismoment-snapshot bevat bewijs en stappen", () => {
  assert.match(bindingHardening, /'steps'/);
  assert.match(bindingHardening, /'bewijs'/);
  assert.match(bindingHardening, /to_jsonb\(pb\.\*\)/);
  // De 2026_08_22-migratie embedde ooit óók 'readiness', maar PR-D (#168, 0187)
  // haalt die key eruit (2026_08_28_p3d_01_readiness_drop.sql) nu readiness is
  // ontmanteld. Nieuwe snapshots dragen geen readiness meer; oude (append-only)
  // houden hem — afschrift-feitenkaart leest die optioneel.
  const drop = lees("supabase", "migrations", "2026_08_28_p3d_01_readiness_drop.sql");
  assert.match(drop, /create or replace function public\.fn_build_decision_dossier/);
  assert.ok(
    !/'readiness',\s*public\.fn_decision_readiness_overview/.test(drop),
    "de p3d-herdefinitie van fn_build_decision_dossier mag de readiness-key niet meer dragen"
  );
  assert.match(drop, /drop function if exists public\.fn_decision_readiness_overview/);
  assert.match(drop, /drop function if exists public\.fn_decision_readiness_check/);
});

test("bewijsbinding: de normale route én DB-trigger blokkeren botsende instantie-vereisten", () => {
  // Zonder deze controle kan een voorzitter via /requirements een
  // instantie-vereiste toevoegen met dezelfde identiteit als een template-
  // vereiste. Beide krijgen dan dezelfde bindingssleutel en één gebonden
  // bewijsstuk vervult ze allebei — precies de dubbeltelling die deze
  // wijziging opruimt. procedure_requirement_instance heeft geen tegenhanger
  // van idx_req_uniek, dus de route moet het afvangen.
  assert.match(requirementsRoute, /requirementSleutel\(/);
  assert.match(requirementsRoute, /from\("procedure_requirements"\)/);
  assert.match(requirementsRoute, /from\("procedure_requirement_instance"\)/);
  assert.match(requirementsRoute, /const botst = \[/);
  assert.match(requirementsRoute, /al een vereiste van dit type met dezelfde identiteit/);
  assert.match(bindingHardening, /trg_requirement_instance_validate_binding_sleutel/);
});

test("bewijsbinding: de seed-generator weigert een lege of dubbele matchsleutel", () => {
  const seedLib = lees("core", "lib", "procedure-requirements-seed.ts");
  assert.match(seedLib, /lege matchsleutel/);
  assert.match(seedLib, /dubbele matchsleutel/);
  const definitieLib = lees("core", "lib", "procedure-definitie.ts");
  assert.match(definitieLib, /dubbele matchsleutel/);
});
