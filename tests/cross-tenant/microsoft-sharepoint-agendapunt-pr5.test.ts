import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  projecteerSharePointAgendakoppelingen,
  refsZijnLiveToegankelijk,
} from "../../core/lib/microsoft-sharepoint-agendapunt-projectie";
import { selecteerSharePointDocumentKandidaten } from "../../core/lib/microsoft-sharepoint-map-ai-core";
import { splitsRetrievalMeta } from "../../core/lib/audit-meta";

const ROOT = join(import.meta.dirname, "..", "..");
const lees = (...pad: string[]) => readFileSync(join(ROOT, ...pad), "utf8");
const DOC_REF = "11111111-1111-4111-8111-111111111111";
const MAP_REF = "22222222-2222-4222-8222-222222222222";

test("B-6 — zonder live bewijs projecteert de browser alleen de neutrale placeholder", () => {
  const ruw = [{
    koppeling_id: "33333333-3333-4333-8333-333333333333",
    agendapunt_id: "44444444-4444-4444-8444-444444444444",
    soort: "document" as const,
    ref: DOC_REF,
    // De echte RPC-rij bevat deze velden. Ze mogen niet als fallback uitkomen.
    naam: "Geheim dossier.docx",
    mappad: "Bestuur/Vertrouwelijk",
    bestandstype: "docx",
  }];
  const uit = projecteerSharePointAgendakoppelingen(ruw);
  assert.deepEqual(uit, [{
    koppelingId: "33333333-3333-4333-8333-333333333333",
    agendapuntId: "44444444-4444-4444-8444-444444444444",
    toegankelijk: false,
    label: "Gekoppelde SharePoint-bron",
  }]);
  const json = JSON.stringify(uit);
  for (const geheim of ["Geheim dossier", "Vertrouwelijk", "docx", DOC_REF]) {
    assert.ok(!json.includes(geheim), `${geheim} lekte naar de projectie`);
  }
});

test("B-6 — alleen een actuele live match ontsluit metadata en lokale acties", () => {
  const uit = projecteerSharePointAgendakoppelingen(
    [{
      koppeling_id: "33333333-3333-4333-8333-333333333333",
      agendapunt_id: "44444444-4444-4444-8444-444444444444",
      soort: "document",
      ref: DOC_REF,
    }],
    {
      documenten: [{
        ref: DOC_REF,
        naam: "Beleid.docx",
        mappad: "Bestuur",
        bestandstype: "docx",
        previewMogelijk: true,
        webUrl: "https://voorbeeld.sharepoint.com/beleid.docx",
      }],
      mappen: [],
    }
  );
  assert.equal(uit[0].toegankelijk, true);
  if (!uit[0].toegankelijk) assert.fail("live document werd niet ontsloten");
  assert.equal(uit[0].naam, "Beleid.docx");
  assert.equal(uit[0].previewHref, `/bibliotheek/sharepoint/${DOC_REF}`);
});

test("koppelen vereist dat iedere lokale ref in de security-trimmed live set staat", () => {
  assert.equal(refsZijnLiveToegankelijk(
    [{ soort: "document", ref: DOC_REF }, { soort: "map", ref: MAP_REF }],
    { documenten: [{ ref: DOC_REF }], mappen: [{ ref: MAP_REF }] }
  ), true);
  assert.equal(refsZijnLiveToegankelijk(
    [{ soort: "document", ref: DOC_REF }, { soort: "map", ref: MAP_REF }],
    { documenten: [{ ref: DOC_REF }], mappen: [] }
  ), false);
});

test("map plus los document wordt vraaggestuurd en zonder dubbele download geselecteerd", () => {
  const selectie = selecteerSharePointDocumentKandidaten([
    { ref: DOC_REF, naam: "Beleid.docx", bestandstype: "docx", grootte: 100, gewijzigdOp: null, mappad: "Bestuur" },
    { ref: DOC_REF, naam: "Beleid.docx", bestandstype: "docx", grootte: 100, gewijzigdOp: null, mappad: "Bestuur" },
    { ref: MAP_REF, naam: "Risicoanalyse.pdf", bestandstype: "pdf", grootte: 100, gewijzigdOp: null, mappad: "Bestuur/Risico" },
  ], "Welke risico's staan in de risicoanalyse?");
  assert.equal(selectie.totaalOnderMap, 2);
  assert.equal(selectie.documenten.length, 2);
  assert.equal(selectie.documenten[0].ref, MAP_REF);
});

test("route dwingt capability, host/fondsgrens, live listing en uniforme fout af", () => {
  const route = lees("app", "api", "agendapunten", "[id]", "sharepoint", "route.ts");
  assert.match(route, /hostGuard: "afdwingen"/);
  assert.match(route, /capability: "documents\.metadata\.update"/);
  assert.match(route, /requireCapability\(ctx\.gebruikerId, "documents\.metadata\.update"\)/);
  assert.match(route, /vergaderingen!inner\(fonds_id\)/);
  assert.match(route, /\.eq\("vergaderingen\.fonds_id", ctx\.fondsId\)/);
  assert.match(route, /refsZijnLiveToegankelijk/);
  assert.match(route, /sharepointDocumenten/);
  assert.match(route, /koppelSharePointBronnenAanAgendapunt/);
  assert.match(route, /const UNIFORME_FOUT = "De SharePoint-koppeling kon niet worden verwerkt\."/);
  assert.ok((route.match(/error: UNIFORME_FOUT/g) ?? []).length >= 5);
  assert.ok(!route.includes("error.message"), "DB-/providerdetails mogen geen bestaansoracle vormen");
});

test("chat combineert primaire, secundaire, SharePoint-documenten en -mappen via één retrievalorkestratie", () => {
  const route = lees("app", "api", "chat", "route.ts");
  assert.match(route, /haalAgendapuntDocumenten/);
  assert.match(route, /leesSharePointAgendapuntKoppelingen/);
  assert.match(route, /maakProductieGekoppeldeSharePointAdapter/);
  assert.match(route, /primair_portaal/);
  assert.match(route, /agendapunt_sharepoint/);
  assert.match(route, /maakQuery\("aanvullend"/);
  assert.equal((route.match(/await voerVolledigeRetrievalUit\(/g) ?? []).length, 1);
  assert.match(route, /bijBronfout: "stop"/);
  assert.ok((route.match(/primair: true/g) ?? []).length >= 2);
});

test("audit van agendapunt-SharePoint bevat alleen lokale refs en inhoudsarme tellingen", () => {
  const rag = lees("core", "lib", "rag.ts");
  const blok = rag.slice(rag.indexOf("agendapunt_sharepoint?:"), rag.indexOf("// Document-scope", rag.indexOf("agendapunt_sharepoint?:")));
  for (const toegestaan of ["document_refs", "map_refs", "kandidaten", "gebruikte_documenten", "afgekapt"]) {
    assert.ok(blok.includes(toegestaan));
  }
  for (const verboden of ["graph", "token", "mappad", "prompt", "inhoud", "url"]) {
    assert.ok(!new RegExp(`\\b${verboden}\\b`, "i").test(blok), `${verboden} hoort niet in auditmeta`);
  }

  const { spoor, inhoud, onbekend } = splitsRetrievalMeta({
    agendapunt_sharepoint: {
      document_refs: [DOC_REF],
      map_refs: [MAP_REF],
      kandidaten: 4,
      gebruikte_documenten: 2,
      afgekapt: false,
    },
  });
  assert.deepEqual(onbekend, []);
  assert.deepEqual(spoor.agendapunt_sharepoint, {
    document_refs: [DOC_REF],
    map_refs: [MAP_REF],
    kandidaten: 4,
    gebruikte_documenten: 2,
    afgekapt: false,
  });
  assert.equal("agendapunt_sharepoint" in inhoud, false);
});

test("multiselect koppelt atomair via één private SQL-aanroep", () => {
  const vault = lees("core", "lib", "microsoft-vault.ts");
  const start = vault.indexOf("export async function koppelSharePointBronnenAanAgendapunt");
  const einde = vault.indexOf("/** Verwijdert uitsluitend", start);
  const blok = vault.slice(start, einde);
  assert.match(blok, /jsonb_to_recordset/);
  assert.match(blok, /cross join lateral microsoft_private\.sharepoint_koppel_agendapunt/);
  assert.equal((blok.match(/db\(\)\.query/g) ?? []).length, 1);
});
