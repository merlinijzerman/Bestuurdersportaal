import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");
const route = lees("app/api/microsoft/sharepoint/retrieval-smoke/route.ts");
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

test("#353 browserinvoer bevat uitsluitend vaste scenario-, route- en rondecodes", () => {
  assert.match(route, /scenario: z\.enum\(SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS\)/);
  assert.match(route, /route: z\.enum\(SHAREPOINT_RETRIEVAL_SMOKE_ROUTES\)/);
  assert.match(route, /ronde: z\.union\(\[z\.literal\(1\), z\.literal\(2\), z\.literal\(3\)\]\)/);
  assert.doesNotMatch(route, /vraag: z\.|ref: z\.|itemId: z\.|siteId: z\.|driveId: z\./);
  assert.match(kern, /Welke hersteltermijn geldt voor Koraalmaat 47\?/);
});

test("#353 alleen de veilige meetprojectie en vaste SSE-statussen verlaten de serverbrug", () => {
  assert.match(kern, /type: "wacht_op_intrekking"/);
  assert.match(route, /type: "voltooid", meting/);
  assert.doesNotMatch(route, /accessToken|microsoft_object_id|tenant_id|drive_id|item_id|passage/);
  assert.match(brug, /maakVeiligeMeetrij/);
  const auditStart = brug.indexOf("async function audit");
  const auditBlok = brug.slice(auditStart, brug.indexOf("\n}\n", auditStart) + 3);
  assert.doesNotMatch(auditBlok, /toegangscontrole|accessToken|passage|tenantId|itemId|driveId/);
});

test("#353 S08 pauzeert vóór de laatste rechtencheck en S09 start zonder cachepad", () => {
  assert.match(brug, /fase !== "voor_laatste_rechtencheck"/);
  assert.match(brug, /document\?\.fixtureCode !== "PGB354-DOC-005"/);
  assert.match(brug, /wachtMetHartslag\(ctx\.signal, stuur\)/);
  assert.match(kern, /S09:[\s\S]*benodigdeFixtures: \[\][\s\S]*pauzeVoorLaatsteControle: false/);
  assert.doesNotMatch(brug, /cache|localStorage|sessionStorage/);
});
