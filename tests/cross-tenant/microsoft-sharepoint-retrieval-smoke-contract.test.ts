import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const route = lees("app/api/microsoft/sharepoint/retrieval-smoke/route.ts");
const consentRoute = lees("app/api/microsoft/sharepoint/retrieval-smoke/toestemming/route.ts");
const brug = lees("core/lib/microsoft-sharepoint-retrieval-smoke.ts");
const kern = lees("core/lib/microsoft-sharepoint-retrieval-smoke-core.ts");

test("#353 Preview-route is dubbel gegate, beheerder-only, hostgebonden en fail-closed begrensd", () => {
  assert.match(route, /capability: "login\.beleid\.manage"/);
  assert.match(route, /requireCapability\(ctx\.gebruikerId, "login\.beleid\.manage"\)/);
  assert.match(route, /hostGuard: "afdwingen"/);
  assert.match(route, /rateLimit: "microsoft_sharepoint_retrieval_spike"/);
  assert.match(route, /sharePointRetrievalSmokeToegestaan/);
  assert.match(lees("core/lib/ratelimit-enforce.ts"), /"microsoft_sharepoint_retrieval_spike"/);
});

test("#405 brede Search-consentroute bestaat alleen achter dezelfde Preview-poort", () => {
  assert.match(consentRoute, /capability: "login\.beleid\.manage"/);
  assert.match(consentRoute, /requireCapability\(ctx\.gebruikerId, "login\.beleid\.manage"\)/);
  assert.match(consentRoute, /hostGuard: "afdwingen"/);
  assert.match(consentRoute, /rateLimit: "microsoft_sharepoint_retrieval_spike"/);
  assert.match(consentRoute, /sharePointRetrievalSmokeToegestaan/);
  assert.match(consentRoute, /startMicrosoftSearchSpikeToestemming/);
  assert.match(consentRoute, /veiligeMicrosoftReturnUrl/);
  assert.doesNotMatch(consentRoute, /Sites\.Read\.All|Sites\.FullControl|Files\.ReadWrite/);
});

test("#353 browserinvoer bevat uitsluitend vaste scenario-, route- en rondecodes", () => {
  assert.match(route, /scenario: z\.enum\(SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS\)/);
  assert.match(route, /route: z\.enum\(SHAREPOINT_RETRIEVAL_SMOKE_ROUTES\)/);
  assert.match(route, /ronde: z\.union\(\[z\.literal\(1\), z\.literal\(2\), z\.literal\(3\)\]\)/);
  assert.match(route, /searchScope: z\.enum\(SHAREPOINT_RETRIEVAL_SEARCH_SCOPES\)\.optional\(\)/);
  assert.match(route, /scenario !== "S02" \|\| invoer\.data\.route !== "microsoft_search"/);
  assert.doesNotMatch(route, /vraag: z\.|ref: z\.|itemId: z\.|siteId: z\.|driveId: z\./);
  assert.match(kern, /Welke hersteltermijn geldt voor Koraalmaat 47\?/);
  assert.match(kern, /m365-permission-probe-7f4c1d9e-no-match/);
  assert.match(kern, /driveZoektermen: \["Koraalmaat 47", "IJsvogelkompas 73"\]/);
  assert.match(kern, /S04:[\s\S]*actualiteitsbeleid: "alleen_actueel"/);
  assert.match(kern, /S04H:[\s\S]*actualiteitsbeleid: "alleen_historisch"/);
  assert.match(route, /scenario === "S00" && invoer\.data\.route !== "drive_search_extract"/);
});

test("#403 scope-diagnostiek blijft inhoudsvrij en gebruikt alleen drie vaste zoekbereiken", () => {
  assert.match(kern, /SHAREPOINT_RETRIEVAL_SEARCH_SCOPES = \["tenant", "site_list", "path"\]/);
  assert.match(brug, /microsoftSearchScope: opdracht\.searchScope/);
  assert.match(brug, /search_scope: meting\.searchScope \?\? "niet_van_toepassing"/);
  assert.doesNotMatch(route, /rootWebUrl: z\.|listId: z\.|siteCollectionId: z\.|queryTemplate: z\./);
});

test("#353 alleen de veilige meetprojectie en vaste SSE-statussen verlaten de serverbrug", () => {
  assert.match(kern, /type: "wacht_op_intrekking"/);
  assert.match(route, /type: "voltooid", meting/);
  assert.doesNotMatch(route, /accessToken|microsoft_object_id|tenant_id|drive_id|item_id|passage/);
  assert.match(brug, /maakVeiligeMeetrij/);
  assert.match(brug, /voerSharePointPermissionProbeUit/);
  assert.match(brug, /sharePointRetrievalFixtureStatus\(code\)/);
  assert.doesNotMatch(brug, /fixtureStatus\s*:\s*document\.(?:naam|mappad|eTag|cTag)/);
  const auditStart = brug.indexOf("async function audit");
  const auditBlok = brug.slice(auditStart, brug.indexOf("\n}\n", auditStart) + 3);
  assert.doesNotMatch(auditBlok, /toegangscontrole|accessToken|passage|tenantId|itemId|driveId/);
  assert.match(auditBlok, /projecteerAuditAfwijzingen\(meting\)/);
  assert.deepEqual([...auditBlok.matchAll(/afwijzing_[a-z_]+/g)].map((match) => match[0]), []);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify({
    afwijzing_mapping: 0,
    afwijzing_binding: 0,
    afwijzing_root: 0,
    afwijzing_rechten_configuratie: 0,
    afwijzing_versie: 0,
    afwijzing_extractie: 0,
    afwijzing_preview: 0,
    afwijzing_actualiteit: 0,
  }))), [
    "afwijzing_mapping",
    "afwijzing_binding",
    "afwijzing_root",
    "afwijzing_rechten_configuratie",
    "afwijzing_versie",
    "afwijzing_extractie",
    "afwijzing_preview",
    "afwijzing_actualiteit",
  ]);
});

test("#353 S08 pauzeert vóór de laatste rechtencheck en S09 start zonder cachepad", () => {
  assert.match(brug, /fase !== "voor_laatste_rechtencheck"/);
  assert.match(brug, /document\?\.fixtureCode !== "PGB354-DOC-005"/);
  assert.match(brug, /wachtMetHartslag\(ctx\.signal, stuur\)/);
  assert.match(kern, /S09:[\s\S]*benodigdeFixtures: \[\][\s\S]*pauzeVoorLaatsteControle: false/);
  assert.doesNotMatch(brug, /cache|localStorage|sessionStorage/);
});

test("#353 fondsbron en gedelegeerde smoke-actor zijn afzonderlijk en tenantgebonden", () => {
  assert.doesNotMatch(brug, /bron\.gebruiker_id\s*!==\s*args\.ctx\.gebruikerId/);
  assert.match(brug, /vault\.leesVerbinding\(args\.ctx\.fondsId, args\.ctx\.gebruikerId\)/);
  assert.match(brug, /verbinding\.scopes\.includes\("Sites\.Selected"\)/);
  assert.match(brug, /verbinding\.tenant_id !== bron\.tenant_id/);
  assert.match(brug, /sharepointAccessToken\(\{ fondsId: ctx\.fondsId, gebruikerId: ctx\.gebruikerId \}\)/);
  assert.match(brug, /opdracht\.route === "drive_search_extract"/);
  assert.match(brug, /sharepointSearchAccessToken\(\{ fondsId: ctx\.fondsId, gebruikerId: ctx\.gebruikerId \}\)/);
});
