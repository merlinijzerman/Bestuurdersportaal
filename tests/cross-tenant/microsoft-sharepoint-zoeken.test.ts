// ============================================================================
//  #463 fase A — metadatazoeken in de gekoppelde SharePoint-bron.
//  Pure kern (matching, termgrenzen, tweede grenscontrole), de afbreekketen
//  naar Graph, en broncontracten voor route, orkestratie en preview.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHAREPOINT_ZOEK_MAX_RESULTATEN,
  maakRootgrens,
  matchDocumenten,
  selecteerZoekresultaten,
  valideerZoekterm,
} from "../../core/lib/microsoft-sharepoint-zoeken-core";
import { SharePointGraphError, bouwDocumentboom, graphCollectie, type GraphDriveItem } from "../../core/lib/microsoft-sharepoint-graph-core";

const root = resolve(import.meta.dirname, "../..");
const lees = (pad: string) => readFileSync(resolve(root, pad), "utf8");

// Bronroot "R" in drive "d". Daaronder 2026/09 September en Beleid; ernaast
// (BUITEN de root) een map "Geheim" die Microsoft onverwacht meelevert.
const D = "d";
const R = "R";
const map = (id: string, name: string, ouder: string, driveId = D): GraphDriveItem => ({ id, name, folder: { childCount: 1 }, parentReference: { driveId, id: ouder } });
const bestand = (id: string, name: string, ouder: string, driveId = D): GraphDriveItem => ({ id, name, file: { mimeType: "application/octet-stream" }, parentReference: { driveId, id: ouder }, webUrl: `https://pgb.sharepoint.com/sites/x/${id}` });
const ITEMS: GraphDriveItem[] = [
  { id: R, name: "Vergaderstukken", folder: { childCount: 3 }, parentReference: { driveId: D, id: "driveroot" } },
  map("m2026", "2026", R),
  map("msep", "09 September", "m2026"),
  map("mbel", "Beleid", R),
  bestand("f1", "Agenda bestuursvergadering.docx", "msep"),
  bestand("f2", "Notulen 12-09.pdf", "msep"),
  bestand("f3", "Beleggingsplan Coördinatie.pptx", "mbel"),
  bestand("f4", "Cijfers Q3.xlsx", "mbel"),
  bestand("f5", "Zandloperbaken-unieknaam.pdf", R),
  bestand("f6", "readme.txt", R),
  map("mgeheim", "Geheim", "driveroot"),
  bestand("x1", "Notulen geheim.pdf", "mgeheim"),
];
const BOOM = bouwDocumentboom(ITEMS, D, R);
const GRENS = maakRootgrens(ITEMS, D, R);
const namen = (docs: Array<{ naam: string }>) => docs.map((d) => d.naam);

test("zoekterm wordt server-side begrensd op 2–200 tekens na trimmen, te lang wordt geweigerd (niet ingekort)", () => {
  assert.deepEqual(valideerZoekterm(null), { geldig: false, reden: "te_kort" });
  assert.deepEqual(valideerZoekterm("  a  "), { geldig: false, reden: "te_kort" });
  assert.deepEqual(valideerZoekterm(" ab "), { geldig: true, term: "ab" });
  assert.equal(valideerZoekterm("x".repeat(200)).geldig, true);
  assert.deepEqual(valideerZoekterm("x".repeat(201)), { geldig: false, reden: "te_lang" });
});

test("unieke bestandsnaam vindt precies het juiste document, hoofdletter- en accentongevoelig", () => {
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "ZANDLOPERBAKEN").map((h) => h.document)), ["Zandloperbaken-unieknaam.pdf"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "coordinatie").map((h) => h.document)), ["Beleggingsplan Coördinatie.pptx"]);
});

test("zoeken op mapnaam of volledig mappad levert de documenten in die map (en submappen) binnen de root", () => {
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "september").map((h) => h.document)).sort(), ["Agenda bestuursvergadering.docx", "Notulen 12-09.pdf"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "2026").map((h) => h.document)).sort(), ["Agenda bestuursvergadering.docx", "Notulen 12-09.pdf"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "2026/09").map((h) => h.document)).sort(), ["Agenda bestuursvergadering.docx", "Notulen 12-09.pdf"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "beleid").map((h) => h.document)).sort(), ["Beleggingsplan Coördinatie.pptx", "Cijfers Q3.xlsx"]);
});

test("zoeken op extensie of typenaam: pdf, .pdf, word, excel, powerpoint, en ook niet-previewbare extensies", () => {
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "pdf").map((h) => h.document)).sort(), ["Notulen 12-09.pdf", "Zandloperbaken-unieknaam.pdf"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, ".PDF").map((h) => h.document)).sort(), ["Notulen 12-09.pdf", "Zandloperbaken-unieknaam.pdf"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "word").map((h) => h.document)), ["Agenda bestuursvergadering.docx"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "excel").map((h) => h.document)), ["Cijfers Q3.xlsx"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "powerpoint").map((h) => h.document)), ["Beleggingsplan Coördinatie.pptx"]);
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "txt").map((h) => h.document)), ["readme.txt"]);
});

test("meerdere woorden moeten ALLEMAAL ergens matchen; naamtreffers komen vóór padtreffers", () => {
  assert.deepEqual(namen(matchDocumenten(BOOM.documenten, "notulen pdf").map((h) => h.document)), ["Notulen 12-09.pdf"]);
  assert.deepEqual(matchDocumenten(BOOM.documenten, "notulen excel"), []);
  const hits = matchDocumenten(BOOM.documenten, "september agenda");
  assert.deepEqual(namen(hits.map((h) => h.document)), ["Agenda bestuursvergadering.docx"]);
  const volgorde = matchDocumenten([
    { itemId: "a", naam: "los.pdf", mappad: "Notulen" },
    { itemId: "b", naam: "Notulen.pdf", mappad: "" },
  ], "notulen");
  assert.deepEqual(volgorde.map((h) => [h.document.itemId, h.inNaam]), [["b", true], ["a", false]]);
});

test("eerste grens: bouwDocumentboom laat de map buiten de root al vallen", () => {
  assert.equal(BOOM.documenten.some((d) => d.itemId === "x1"), false);
});

test("tweede grens: ook als de eerste projectie een document buiten de root doorlaat, weigert de zoekselectie het", () => {
  // Simuleer een fout in de eerste laag of een ruimer Microsoft-antwoord: het
  // document buiten de root staat tóch in de kandidatenlijst.
  const metLek = [...BOOM.documenten, { itemId: "x1", naam: "Notulen geheim.pdf", mappad: "" }];
  const selectie = selecteerZoekresultaten(metLek, "notulen", GRENS);
  assert.deepEqual(namen(selectie.resultaten), ["Notulen 12-09.pdf"]);
  assert.equal(selectie.totaal, 1);
  assert.equal(selectie.buitenRootGeweigerd, 1);
});

test("tweede grens faalt gesloten: andere drive, lus, ontbrekende ouder, map, root zelf, snelkoppeling", () => {
  const items: GraphDriveItem[] = [
    ...ITEMS,
    bestand("vreemd", "vreemd.pdf", "msep", "andere-drive"),
    map("lusA", "A", "lusB"), map("lusB", "B", "lusA"), bestand("inlus", "lus.pdf", "lusA"),
    bestand("wees", "wees.pdf", "bestaat-niet"),
    { ...bestand("snel", "snel.pdf", "msep"), remoteItem: { id: "elders", parentReference: { driveId: "andere-drive" } } },
    map("tussen", "Tussen", "mvreemd"), map("mvreemd", "Vreemd", R, "andere-drive"), bestand("viaVreemd", "via.pdf", "tussen"),
  ];
  const grens = maakRootgrens(items, D, R);
  assert.equal(grens("f1"), true);
  assert.equal(grens("f5"), true);
  for (const id of ["vreemd", "inlus", "wees", "snel", "viaVreemd", "msep", R, "x1", "", "onbekend"]) assert.equal(grens(id), false, id);
});

test("totaal telt alle matches binnen de root vóór de limiet; resultatenAfgekapt apart van de boom", () => {
  const veel = Array.from({ length: SHAREPOINT_ZOEK_MAX_RESULTATEN + 5 }, (_, i) => ({ itemId: `v${i}`, naam: `Verslag ${i}.pdf`, mappad: "" }));
  const selectie = selecteerZoekresultaten(veel, "verslag", () => true);
  assert.equal(selectie.resultaten.length, SHAREPOINT_ZOEK_MAX_RESULTATEN);
  assert.equal(selectie.totaal, SHAREPOINT_ZOEK_MAX_RESULTATEN + 5);
  assert.equal(selectie.resultatenAfgekapt, true);
  const weinig = selecteerZoekresultaten(veel.slice(0, 3), "verslag", () => true);
  assert.equal(weinig.resultatenAfgekapt, false);
  assert.equal(weinig.totaal, 3);
});

test("afbreken: een verlopen zoek-signaal stopt de Graph-paginering als graph_timeout", async () => {
  const signal = AbortSignal.abort();
  let aangeroepen = 0;
  await assert.rejects(
    graphCollectie("token", "https://graph.microsoft.com/v1.0/drives/d/items/R/delta", { signal, fetchImpl: async () => { aangeroepen += 1; return new Response("{}"); } }),
    (fout: unknown) => fout instanceof SharePointGraphError && fout.categorie === "graph_timeout",
  );
  assert.equal(aangeroepen, 0);
});

test("route: host afgedwongen, eigen fail-closed limiet, zoeken.use én documents.view inline, vlag-poort, termgrens vóór de teller", () => {
  const route = lees("app/api/microsoft/sharepoint/zoeken/route.ts");
  assert.match(route, /hostGuard: "afdwingen"/);
  assert.match(route, /rateLimit: "route-eigen"/);
  assert.match(route, /controleerLimiet\(ctx\.supabase, LIMIETEN\.microsoft_sharepoint_zoeken, \{ failClosed: true \}\)/);
  assert.doesNotMatch(route, /LIMIETEN\.zoeken\b/, "niet gedeeld met de kostendragende portaalzoekfunctie");
  assert.match(route, /rolHeeftCapability\(ctx\.rol, "zoeken\.use"\)/);
  assert.match(route, /rolHeeftCapability\(ctx\.rol, "documents\.view"\)/);
  assert.match(route, /microsoftSharePointActief\(ctx\.supabase, ctx\.fondsId\)/);
  assert.match(route, /AbortSignal\.timeout\(SHAREPOINT_ZOEK_TIMEOUT_MS\)/);
  assert.ok(route.indexOf("valideerZoekterm") < route.indexOf("controleerLimiet("), "ongeldige termen verbruiken geen budget");
  assert.match(route, /status: 504/);
  const limieten = lees("core/lib/rate-limit.ts");
  assert.match(limieten, /microsoft_sharepoint_zoeken: \{ endpoint: "microsoft_sharepoint_zoeken"/);
});

test("orkestratie: live met gebruikerstoken, signaal tot in Graph, tweede grens, geen content en geen zoekterm in de gebeurtenis", () => {
  const sp = lees("core/lib/microsoft-sharepoint.ts");
  const zoeken = sp.slice(sp.indexOf("export async function sharepointZoeken"), sp.indexOf("export async function sharepointPreview"));
  assert.match(zoeken, /await token\(ctx\)/);
  assert.match(zoeken, /enumereerBoom\(accessToken, bron\.drive_id, bron\.root_item_id, signal\)/);
  assert.match(zoeken, /maakRootgrens\(boom\.items, bron\.drive_id, bron\.root_item_id\)/);
  assert.doesNotMatch(zoeken, /\/content|downloadUrl|clientCredentials|client_credentials/);
  const details = [...zoeken.matchAll(/details: \{([^}]*)\}/g)].map((m) => m[1]).join(" ");
  assert.doesNotMatch(details, /\bterm\b|\bq\b/, "de zoekterm hoort niet in het auditlog");
  assert.match(sp, /deltaUrl\(driveId, rootItemId\), \{ maxItems: SHAREPOINT_MAX_DOCUMENTEN, maxPaginas: 30, signal \}/);
  assert.match(sp, /kinderenUrl\(driveId, id\), \{[^}]*signal \}/);
});

test("oude referentie: openen controleert opnieuw live met het token van de gebruiker en weigert gesloten", () => {
  const sp = lees("core/lib/microsoft-sharepoint.ts");
  const preview = sp.slice(sp.indexOf("export async function sharepointPreview"));
  assert.match(preview, /await token\(ctx\)/);
  assert.match(preview, /graphJson<GraphDriveItem>\(accessToken, itemUrl\(document\.drive_id, document\.item_id\)\)/);
  assert.match(preview, /itemOnderRoot\(item, document\.drive_id/);
  const route = lees("app/api/microsoft/sharepoint/documenten/[ref]/preview/route.ts");
  assert.match(route, /categorie === "niet_gevonden"\) return NextResponse\.json\(.*\{ status: 404/);
  assert.match(route, /categorie === "toestemming_of_token"\) return NextResponse\.json\(.*\{ status: 403/);
});

test("UI: Zoekbron is een eigen as naast Bronsoort; de portaal-bronsoort blijft fonds/generiek", () => {
  const paneel = lees("app/(dashboard)/bibliotheek/_components/ZoekenPaneel.tsx");
  assert.match(paneel, /type Bronsoort = "alles" \| "fonds" \| "generiek";/);
  assert.match(paneel, /type Zoekbron = "alles" \| "portaal" \| "sharepoint";/);
  assert.match(paneel, /\/api\/microsoft\/sharepoint\/zoeken\?/);
  assert.doesNotMatch(paneel, /bronsoort: huidigeZoekbron|bronsoort=sharepoint/);
  assert.match(lees("app/(dashboard)/bibliotheek/page.tsx"), /metSharePoint=\{actieveTab === "fonds"\}/);
});
