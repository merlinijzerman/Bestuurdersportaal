import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");

const route = lees("app/api/chat/route.ts");
const productieAdapter = lees("core/lib/microsoft-sharepoint-ai-context.ts");
const gate = lees("core/lib/microsoft-sharepoint-ai-gate.ts");
const payload = lees("core/lib/assistent-payload.ts");
const gesprek = lees("core/components/assistent/useAssistent.ts");
const lijst = lees(
  "app/(dashboard)/bibliotheek/_components/SharePointDocumentenSectie.tsx"
);
const documentenRoute = lees("app/api/microsoft/sharepoint/documenten/route.ts");

test("chat accepteert SharePoint alleen achter capability en twee strikte vlaggen", () => {
  assert.match(route, /"sharepoint_scope": z\.unknown\(\)\.optional\(\)/);
  assert.match(route, /microsoftSharePointAiContextActief\(supabase, fondsId\)/);
  assert.match(route, /rolHeeftCapability\([\s\S]*?"documents\.view"/);
  assert.match(gate, /microsoft_sharepoint_fase3/);
  assert.match(gate, /SHAREPOINT_AI_CONTEXT_FLAG/);
  assert.match(gate, /fase3\?\.waarde === true/);
  assert.match(gate, /aiContext\?\.waarde === true/);
});

test("de productieadapter gebruikt uitsluitend het delegated gebruikerstoken", () => {
  assert.match(
    productieAdapter,
    /sharepointAccessToken\(\{ fondsId: args\.fondsId, gebruikerId: args\.gebruikerId \}\)/
  );
  assert.doesNotMatch(productieAdapter, /acquireTokenByClientCredential|client_credentials/);
  assert.match(productieAdapter, /token\.tenantId !== bronRij\.tenant_id/);
  assert.match(productieAdapter, /leesSharePointDocument\(args\.fondsId, args\.scope\.ref\)/);
  assert.match(productieAdapter, /sharepointDocumenten\(/);
  assert.match(productieAdapter, /leesSharePointMap\(args\.fondsId, args\.scope\.ref\)/);
});

test("een SharePoint-context bewaart en verstuurt alleen de lokale UUID-ref", () => {
  assert.match(payload, /sharepoint_scope:[\s\S]*?soort:[\s\S]*?refs:/);
  assert.doesNotMatch(
    payload.match(/sharepoint_scope:[\s\S]{0,240}/)?.[0] ?? "",
    /labels|naam|mappad/
  );
  assert.match(gesprek, /sharepoint_scope:[\s\S]*?refs: sharepointVoorOpslag\.refs/);
  assert.match(gesprek, /fetch\("\/api\/microsoft\/sharepoint\/documenten"/);
  assert.match(gesprek, /cache: "no-store"/);
});

test("documenten en mappen openen dezelfde centrale assistent via het actiemenu", () => {
  assert.match(lijst, /<AssistentIngang/);
  assert.match(lijst, /<Actiemenu label=\{doc\.naam\}/);
  assert.match(lijst, /soort: "sharepoint", objectsoort: "document", ref: doc\.ref/);
  assert.match(lijst, /<Actiemenu label=\{naam\}/);
  assert.match(lijst, /soort: "sharepoint", objectsoort: "map", ref: mapRef\.ref/);
  assert.match(lijst, /AI_TYPES\.has\(doc\.bestandstype\)/);
  assert.match(lijst, /antwoord\.aiContextBeschikbaar === true/);
  assert.match(documentenRoute, /microsoftSharePointAiContextActief/);
  assert.match(documentenRoute, /aiContextBeschikbaar/);
  assert.match(lijst, /Vraag de AI/);
  assert.doesNotMatch(lijst, /\/api\/chat/);
});

test("toegelaten SharePoint-passages bereiken de bestaande promptbrug", () => {
  assert.match(route, /directeSharePoint\.chunksVoor\(voltooid\.geselecteerd\)/);
  assert.match(route, /scopeTitels = \[directeSharePoint!\.scopeLabel\]/);
  assert.match(route, /GESELECTEERDE SHAREPOINT-MAP/);
  assert.match(route, /sharepoint_map_afgekapt/);
  assert.match(productieAdapter, /tekst: resultaat\.passage/);
  assert.match(productieAdapter, /bibliotheek: "sharepoint"/);
});

test("live mapcontrole en retrieval delen één beurtdeadline", () => {
  assert.match(route, /const setupGrendel = maakAfbreekgrendel\(req\.signal, retrievalTimeoutMs\)/);
  assert.match(route, /signal: setupGrendel\.signal/);
  assert.match(route, /effectiefRetrievalTimeoutMs = Math\.max\(1, setupGrendel\.resterendMs\(\)\)/);
  assert.match(route, /timeoutMs: effectiefRetrievalTimeoutMs/);
  assert.match(route, /finally \{\s*setupGrendel\.stop\(\)/);
});
