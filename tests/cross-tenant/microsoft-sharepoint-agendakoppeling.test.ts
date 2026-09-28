// #462 PR-2 — mapregister en agendapuntkoppeling: enumeratieprojectie (puur),
// browserprojectie van maprefs (puur) en het contract van migratie, rollback,
// wrappers en CI-aansluiting. Het DB-GEDRAG (cross-fonds, xor, ontkoppelen,
// configuratieversie, inactieve bron) staat in
// supabase/checks/2026_09_28_462_sharepoint_mapregister_agendakoppeling.sql en
// draait in de DB-laag van scripts/cross-tenant-ci.sh.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bouwDocumentboom } from "../../core/lib/microsoft-sharepoint-graph-core";
import { projecteerMapRefs } from "../../core/lib/microsoft-sharepoint-mapregister-core";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const MIGRATIE = "supabase/migrations/2026_09_28_462_sharepoint_mapregister_agendakoppeling.sql";
const ROLLBACK = "supabase/rollbacks/2026_09_28_462_sharepoint_mapregister_agendakoppeling_ROLLBACK.sql";
const CHECK = "supabase/checks/2026_09_28_462_sharepoint_mapregister_agendakoppeling.sql";

const boomItems = [
  { id: "root", name: "Vergaderstukken", folder: { childCount: 2 }, parentReference: { driveId: "d", id: "drive-root" } },
  { id: "m2026", name: "2026", folder: { childCount: 1 }, parentReference: { driveId: "d", id: "root" } },
  { id: "m09", name: "09 September", folder: { childCount: 1 }, parentReference: { driveId: "d", id: "m2026" } },
  { id: "mweg", name: "Weg", folder: {}, deleted: { state: "deleted" }, parentReference: { driveId: "d", id: "root" } },
  { id: "mvreemd", name: "Vreemd", folder: {}, parentReference: { driveId: "andere-drive", id: "root" } },
  { id: "mzwevend", name: "Zwevend", folder: {}, parentReference: { driveId: "d", id: "onbekend" } },
  { id: "lus-a", name: "A", folder: {}, parentReference: { driveId: "d", id: "lus-b" } },
  { id: "lus-b", name: "B", folder: {}, parentReference: { driveId: "d", id: "lus-a" } },
  { id: "f1", name: "Agenda.docx", file: {}, parentReference: { driveId: "d", id: "m09" } },
];

test("enumeratie levert mappen als registerprojectie: alleen onder de root, met ouder en pad", () => {
  const boom = bouwDocumentboom(boomItems, "d", "root");
  assert.deepEqual(boom.mapItems, [
    { itemId: "m2026", naam: "2026", ouderItemId: "root", mappad: "2026" },
    { itemId: "m09", naam: "09 September", ouderItemId: "m2026", mappad: "2026/09 September" },
  ]);
  // Het rootitem zelf, verwijderde, vreemde, zwevende en lus-mappen vallen af.
  for (const weg of ["root", "mweg", "mvreemd", "mzwevend", "lus-a", "lus-b"]) {
    assert.equal(boom.mapItems.some((m) => m.itemId === weg), false, weg);
  }
  // De bestaande padenlijst blijft exact gelijk (bibliotheek-UI hangt ervan af).
  assert.deepEqual(boom.mappen, ["2026", "2026/09 September"]);
  assert.deepEqual(boom.mapItems.map((m) => m.mappad), boom.mappen);
});

test("maprefs naar de browser: lokale ref, naam en pad — nooit een Graph-id, nooit een pad als surrogaatsleutel", () => {
  const boom = bouwDocumentboom(boomItems, "d", "root");
  const refs = [
    { ref: "00000000-0000-4000-8000-000000000009", item_id: "m09" },
    { ref: "00000000-0000-4000-8000-000000002026", item_id: "m2026" },
  ];
  const uit = projecteerMapRefs(boom.mapItems, refs);
  assert.deepEqual(uit, [
    { ref: "00000000-0000-4000-8000-000000002026", naam: "2026", mappad: "2026" },
    { ref: "00000000-0000-4000-8000-000000000009", naam: "09 September", mappad: "2026/09 September" },
  ]);
  for (const rij of uit) assert.deepEqual(Object.keys(rij).sort(), ["mappad", "naam", "ref"]);
  assert.doesNotMatch(JSON.stringify(uit), /m09|m2026|drive|item/);
  // Map zonder registerref valt weg; een lege refset levert niets.
  assert.deepEqual(projecteerMapRefs(boom.mapItems, [refs[0]]).map((x) => x.ref), [refs[0].ref]);
  assert.deepEqual(projecteerMapRefs(boom.mapItems, []), []);
});

test("migratie: private registers, xor, composite-FK's, partiële unieke indexen en validatietrigger", () => {
  const m = lees(MIGRATIE);
  assert.match(m, /create table if not exists microsoft_private\.sharepoint_mappen/);
  assert.match(m, /constraint sharepoint_mappen_bron_item_uniek unique \(bron_id, item_id\)/);
  assert.match(m, /status in \('gezien','verwijderd','ontoegankelijk'\)/);
  assert.match(m, /create table if not exists microsoft_private\.agendapunt_sharepoint_koppelingen/);
  assert.match(m, /fonds_id uuid not null references public\.fondsen\(id\) on delete cascade/);
  assert.match(m, /agendapunt_id uuid not null references public\.agendapunten\(id\) on delete cascade/);
  assert.match(m, /check \(\(document_ref is null\) <> \(map_ref is null\)\)/);
  assert.match(m, /foreign key \(fonds_id, document_ref\)\s+references microsoft_private\.sharepoint_documenten\(fonds_id, id\)/);
  assert.match(m, /foreign key \(fonds_id, map_ref\)\s+references microsoft_private\.sharepoint_mappen\(fonds_id, id\)/);
  assert.match(m, /add constraint sharepoint_documenten_fonds_id_id_uniek unique \(fonds_id, id\)/);
  assert.match(m, /\(agendapunt_id, document_ref\) where document_ref is not null/);
  assert.match(m, /\(agendapunt_id, map_ref\) where map_ref is not null/);
  assert.equal(m.match(/enable row level security/g)?.length, 2);
  assert.doesNotMatch(m, /create policy/i, "geen browserpad: RLS aan zonder policies");
  assert.match(m, /pg_advisory_xact_lock\(hashtext\('microsoft_private\.sharepoint_mappen'\)/);
  assert.match(m, /#variable_conflict use_column/);
  assert.match(m, /m\.drive_id = b\.drive_id and m\.configuratieversie = b\.configuratieversie/);
  assert.match(m, /before insert or update on microsoft_private\.agendapunt_sharepoint_koppelingen/);
  // Geen publieke objecten: de V3-grants-gate (public/storage) blijft ongemoeid.
  assert.doesNotMatch(m, /create (?:table if not exists|table|or replace function|view|index if not exists \w+ on) public\./i);
});

test("RPC's: SECURITY DEFINER met gepind search_path, alleen microsoft_vault, browserrollen expliciet ingetrokken", () => {
  const m = lees(MIGRATIE);
  assert.equal(m.match(/security definer set search_path = microsoft_private, public, pg_temp/gi)?.length, 5);
  assert.match(m, /revoke all on all tables in schema microsoft_private from public, anon, authenticated/);
  assert.match(m, /revoke all on all functions in schema microsoft_private from public, anon, authenticated/);
  for (const sig of [
    "sharepoint_upsert_mappen\\(uuid,uuid,integer,jsonb\\)",
    "sharepoint_lees_map\\(uuid,uuid\\)",
    "sharepoint_koppel_agendapunt\\(uuid,uuid,uuid,text,uuid\\)",
    "sharepoint_ontkoppel_agendapunt\\(uuid,uuid,uuid\\)",
    "sharepoint_lees_agendapunt_koppelingen\\(uuid,uuid\\[\\]\\)",
  ]) assert.match(m, new RegExp(`grant execute on function microsoft_private\\.${sig} to microsoft_vault;`));
  assert.doesNotMatch(m, /grant [^;]* to (anon|authenticated|public)\b/i);
  assert.equal(m.match(/grant execute/g)?.length, 5, "de triggerfunctie krijgt geen EXECUTE-grant");
  // Leesprojectie van koppelingen geeft geen Graph-identiteit terug.
  const lees_ = m.slice(m.indexOf("function microsoft_private.sharepoint_lees_agendapunt_koppelingen"));
  const returns = lees_.slice(0, lees_.indexOf("language plpgsql"));
  assert.doesNotMatch(returns, /drive_id|item_id|site_|root_/);
  // Eén uniforme weigering per kant: geen bestaansorakel.
  assert.ok((m.match(/'sharepoint object niet beschikbaar voor koppeling'/g)?.length ?? 0) >= 2);
  assert.ok((m.match(/'agendapunt niet beschikbaar voor sharepoint koppeling'/g)?.length ?? 0) >= 2);
});

test("rollback verwijdert uitsluitend de #462-objecten; documentregister en bron blijven", () => {
  const r = lees(ROLLBACK);
  assert.match(r, /drop table if exists microsoft_private\.agendapunt_sharepoint_koppelingen/);
  assert.match(r, /drop table if exists microsoft_private\.sharepoint_mappen/);
  assert.match(r, /drop constraint if exists sharepoint_documenten_fonds_id_id_uniek/);
  assert.doesNotMatch(r, /drop table if exists microsoft_private\.sharepoint_(documenten|bronnen)|drop schema/);
  assert.ok(r.indexOf("drop table if exists microsoft_private.agendapunt_sharepoint_koppelingen") < r.indexOf("drop constraint if exists sharepoint_documenten_fonds_id_id_uniek"),
    "het FK-doel gaat pas weg nadat de verwijzer weg is");
  assert.match(lees(MIGRATIE), /ROLLBACK: \.\.\/rollbacks\/2026_09_28_462_sharepoint_mapregister_agendakoppeling_ROLLBACK\.sql/);
});

test("wrappers en lijstroute: smalle RPC-aanroepen, geen Graph-id's naar de browser, check aangesloten in CI", () => {
  const vault = lees("core/lib/microsoft-vault.ts");
  for (const rpc of ["sharepoint_upsert_mappen", "sharepoint_lees_map", "sharepoint_koppel_agendapunt", "sharepoint_ontkoppel_agendapunt", "sharepoint_lees_agendapunt_koppelingen"]) {
    assert.match(vault, new RegExp(`microsoft_private\\.${rpc}\\(`));
  }
  const koppelType = vault.slice(vault.indexOf("export type SharePointAgendakoppeling"), vault.indexOf("export const SHAREPOINT_KOPPELINGEN_MAX_AGENDAPUNTEN"));
  assert.doesNotMatch(koppelType, /drive_id|item_id|site_|root_/);
  assert.doesNotMatch(vault, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);

  const sharepoint = lees("core/lib/microsoft-sharepoint.ts");
  assert.match(sharepoint, /registreerMappen\(ctx\.fondsId, bron\.id, bron\.configuratieversie, boom\.mapItems\)/);
  assert.match(sharepoint, /mappen: boom\.mappen, mapRefs: mapRefs\.mappen/);
  assert.doesNotMatch(sharepoint, /mapRefs:[^,}]*mapItems/, "de ruwe registerprojectie (met item-id) gaat nooit naar de browser");
  assert.match(lees("app/api/microsoft/sharepoint/documenten/route.ts"), /mappen: \[\], mapRefs: \[\]/);

  const ci = lees("scripts/cross-tenant-ci.sh");
  assert.match(ci, new RegExp(CHECK.replace(/[.]/g, "\\.")));
  assert.match(ci, /psql "\$DB_URL" -v ON_ERROR_STOP=1 -f "\$SQL_M365_462_KOPPELING"/);
});
