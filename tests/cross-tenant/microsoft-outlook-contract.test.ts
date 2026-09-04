import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const migratie = lees("supabase/migrations/2026_09_04_microsoft_outlook_fase2a.sql");
const outlook = lees("core/lib/microsoft-outlook.ts");
const connector = lees("core/lib/microsoft-connector.ts");

test("Outlook 2A is alleen de driedubbele fonds-poort plus beheer-capability", () => {
  assert.match(connector, /integratieprofiel === "microsoft"/);
  assert.match(connector, /microsoft_koppeling_pilot === true/);
  assert.match(connector, /microsoft_outlook_fase2a/);
  for (const route of ["toestemming", "agendas", "sync"]) assert.match(lees(`app/api/microsoft/outlook/${route}/route.ts`), /capability: "fonds\.config\.manage"/);
  assert.match(lees("app/api/microsoft/outlook/status/route.ts"), /capability: "profile\.view\.own"/);
});

test("delta-sync bewaart alleen een volledig afgehandelde deltaLink en respecteert Retry-After", () => {
  assert.match(outlook, /calendarView\/delta/);
  assert.match(outlook, /IdType="ImmutableId"/);
  assert.match(outlook, /Retry-After/);
  assert.match(outlook, /await vault\.voltooiOutlookRun/);
  assert.match(outlook, /if \(event\["@removed"\] \|\| !event\.id\) \{ overgeslagen \+= 1; continue; \}/);
  assert.match(migratie, /outlook_sync_een_actief_per_agenda/);
  assert.match(migratie, /unique \(tenant_id, mailbox_id, calendar_id, immutable_event_id\)/);
});

test("Outlook-privacy bewaart geen ruwe deelnemers, body of Teams-link in audit", () => {
  assert.match(outlook, /value === "personal" \|\| value === "private"/);
  assert.match(migratie, /outlook_deelnemer_ids uuid\[\]/);
  assert.match(migratie, /outlook_onbekende_deelnemers integer/);
  assert.doesNotMatch(migratie, /attendee.*email|email.*attendee|bodyPreview|body json/i);
  assert.match(migratie, /jsonb_build_object\('bron','outlook','run_id',p_run\)/);
  assert.doesNotMatch(migratie, /teams_link.*jsonb_build_object/i);
});
