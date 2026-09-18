import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
  maakSharePointSpikeContractAdapter,
  maakVeiligeMeetrij,
  standaardWacht,
  voerSharePointPermissionProbeUit,
  voerSharePointRetrievalSpikeUit,
} from "./prototype";
import type { SpikeDependencies, SpikeOpdracht } from "./prototype";
import type { SpikeBronSnapshot, SpikeRoute } from "./types";

const IDS = {
  fonds: "11111111-1111-4111-8111-111111111111",
  actor: "22222222-2222-4222-8222-222222222222",
  bron: "33333333-3333-4333-8333-333333333333",
  ref: "44444444-4444-4444-8444-444444444444",
  tenant: "55555555-5555-4555-8555-555555555555",
  site: "pgb.sharepoint.com,66666666-6666-4666-8666-666666666666,77777777-7777-4777-8777-777777777777",
  drive: "b!private-drive-id",
  root: "private-root-item",
  item: "private-document-item",
} as const;

function bron(overrides: Partial<SpikeBronSnapshot> = {}): SpikeBronSnapshot {
  return {
    fondsId: IDS.fonds,
    actorId: IDS.actor,
    microsoftActorObjectId: "private-oid",
    tenantId: IDS.tenant,
    bronId: IDS.bron,
    status: "actief",
    configuratieversie: 7,
    siteId: IDS.site,
    siteHostnaam: "pgb.sharepoint.com",
    driveId: IDS.drive,
    driveNaam: "PGB Retrieval Pilot",
    rootItemId: IDS.root,
    documenten: [{ fixtureCode: "PGB-PPTX-01", ref: IDS.ref, itemId: IDS.item, titel: "Synthetisch dek", bestandstype: "pptx", fixtureStatus: "actueel", verwachteMappad: "01 Vergaderstukken" }],
    ...overrides,
  };
}

const item = (eTag = '"v1"') => ({
  id: IDS.item,
  name: "Synthetisch dek.pptx",
  eTag,
  cTag: '"c1"',
  file: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  parentReference: { driveId: IDS.drive, id: IDS.root, path: "/drives/x/root:/PGB Retrieval Pilot" },
  webUrl: "https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot/Synthetisch%20dek.pptx",
  lastModifiedDateTime: "2026-09-10T08:00:00Z",
});

const rootItem = {
  id: IDS.root,
  name: "PGB Retrieval Pilot",
  folder: { childCount: 1 },
  parentReference: { driveId: IDS.drive, id: "drive-root", path: "/drives/x/root:" },
  webUrl: "https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const standaardDownloadUrl = "https://synthetisch-bestand.files.1drv.com/standaard-extractie";
const standaardInhoud = (async () => {
  const docx = readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/01 Vergaderstukken/2026-09 Bestuursvergadering/PGB354-DOC-001-Agenda-en-besluitpunten-september.docx"));
  const zip = await JSZip.loadAsync(docx);
  zip.file("word/document.xml", "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>De oranje kanariewaarde is 314. Koraalmaat 47 heeft een hersteltermijn.</w:t></w:r></w:p></w:body></w:document>");
  zip.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>De oranje kanariewaarde is 314. Koraalmaat 47 heeft een hersteltermijn.</a:t></a:r></a:p></p:sld>");
  return zip.generateAsync({ type: "uint8array" });
})();

function opdracht(route: SpikeRoute): SpikeOpdracht {
  return {
    route,
    correlationId: "88888888-8888-4888-8888-888888888888",
    vraag: { code: "Q-PPTX", soort: "powerpoint" as const, vraag: "Wat is de oranje kanariewaarde?", actualiteitsbeleid: "alleen_actueel" as const, verwachteFixtures: ["PGB-PPTX-01"], maxKandidaten: 10 },
  };
}

function basisDeps(fetchImpl: SpikeDependencies["fetchImpl"], leesBron = async () => bron()): SpikeDependencies {
  return {
    leesBron,
    delegatedToken: async () => ({ accessToken: "geheim-token", tenantId: IDS.tenant, actorObjectId: "private-oid" }),
    fetchImpl: async (url, init) => {
      try {
        return await fetchImpl!(url, init);
      } catch (fout) {
        if (/\/items\/[^/]+\/content$/.test(new URL(url).pathname)) {
          return new Response(null, { status: 302, headers: { Location: standaardDownloadUrl } });
        }
        if (url === standaardDownloadUrl) return new Response((await standaardInhoud).slice().buffer);
        throw fout;
      }
    },
    nu: () => new Date("2026-09-10T09:00:00Z"),
    wacht: async () => undefined,
  };
}

function aantalAfwijzingen(uitkomst: Awaited<ReturnType<typeof voerSharePointRetrievalSpikeUit>>): number {
  return Object.values(uitkomst.afwijzingen).reduce((som, aantal) => som + aantal, 0);
}

test("Microsoft Search levert alleen na dubbele rechten-, versie-, config- en previewcheck een contractkandidaat", async () => {
  let itemChecks = 0;
  const fetchImpl = async (url: string) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ moreResultsAvailable: false, hits: [{ hitId: IDS.item, rank: 1, summary: "provider-summary-mag-nooit-door" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) { itemChecks += 1; return json(item()); }
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/sites/retrieval/_layouts/15/embed.aspx?id=test" });
    throw new Error("onverwachte call");
  };
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(fetchImpl), opdracht("microsoft_search"));
  assert.equal(uitkomst.fout, undefined);
  assert.equal(itemChecks, 2);
  assert.equal(uitkomst.kandidaten.length, 1);
  const kandidaat = uitkomst.kandidaten[0];
  assert.equal(kandidaat.ref, IDS.ref);
  assert.equal(kandidaat.documentIdentiteit.id, IDS.ref);
  assert.deepEqual(kandidaat.passageIdentiteit, { id: `${IDS.ref}:live` });
  assert.equal(kandidaat.bronregistratieRef, IDS.bron);
  assert.deepEqual(kandidaat.versie, { soort: "etag", waarde: '"v1"', gecontroleerdOp: "2026-09-10T09:00:00.000Z" });
  assert.deepEqual(kandidaat.toegangscontrole, {
    toegestaan: true,
    resultaatRef: IDS.ref,
    bronregistratieRef: IDS.bron,
    gebruikerId: IDS.actor,
    correlationId: opdracht("microsoft_search").correlationId,
    gecontroleerdOp: "2026-09-10T09:00:00.000Z",
    basis: "delegated_user",
    bronconfiguratieVersie: 7,
  });
  assert.match(kandidaat.passage, /oranje kanariewaarde is 314/i);
  assert.doesNotMatch(kandidaat.passage, /provider-summary-mag-nooit-door/);
  assert.equal(kandidaat.previewMogelijk, true);
});

test("Microsoft Search neutraliseert gereserveerde operators en beschermt het vaste KQL-pad", async () => {
  let searchRequest: Record<string, unknown> | null = null;
  const gevaarlijkeVraag = opdracht("microsoft_search");
  gevaarlijkeVraag.vraag = {
    ...gevaarlijkeVraag.vraag,
    vraag: `oranje\") OR AND NOT NEAR ONEAR XRANK path:\"https://aanvaller.example/breed\"`,
  };
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url, init) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) {
      searchRequest = JSON.parse(String(init.body));
      return json({ value: [{ hitsContainers: [{ moreResultsAvailable: false, hits: [] }] }] });
    }
    throw new Error("zonder hits mag geen vervolgaanroep starten");
  }), gevaarlijkeVraag);
  assert.equal(uitkomst.fout, "geen_resultaten");
  assert.ok(searchRequest);
  const query = ((searchRequest as unknown as { requests: Array<{ query: { queryString: string; queryTemplate: string } }> }).requests[0].query);
  assert.equal(query.queryString, "oranje path https aanvaller example breed");
  assert.doesNotMatch(query.queryString, /\b(?:AND|OR|NOT|NEAR|ONEAR|XRANK)\b/i);
  assert.doesNotMatch(query.queryString, /[\":/()]/);
  assert.equal(query.queryTemplate, `({searchTerms}) path:\"${rootItem.webUrl}\" isDocument=true`);
});

test("meetunie ontdubbelt centraal en rangschikt deterministisch met één verificatieketen per item", async () => {
  const eersteItem = "private-document-a";
  const tweedeItem = "private-document-b";
  const documenten: SpikeBronSnapshot["documenten"] = [
    { ...bron().documenten[0], itemId: eersteItem, ref: `${IDS.ref}-a`, fixtureCode: "PGB-PPTX-A" },
    { ...bron().documenten[0], itemId: tweedeItem, ref: `${IDS.ref}-b`, fixtureCode: "PGB-PPTX-B" },
  ];
  const itemVoor = (id: string) => ({ ...item(), id });
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) return json({ value: [itemVoor(tweedeItem), itemVoor(eersteItem)] });
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [
      { hitId: eersteItem, rank: 1, summary: "verboden summary A" },
      { hitId: tweedeItem, rank: 2, summary: "verboden summary B" },
    ] }] }] });
    if (url.includes(`/items/${eersteItem}?`)) return json(itemVoor(eersteItem));
    if (url.includes(`/items/${tweedeItem}?`)) return json(itemVoor(tweedeItem));
    if (url.endsWith("/preview")) return json({ getUrl: "https://pgb.sharepoint.com/embed" });
    throw new Error("standaard contentfixture");
  }, async () => bron({ documenten })), {
    ...opdracht("candidate_union"),
    vraag: {
      ...opdracht("candidate_union").vraag,
      verwachteFixtures: ["PGB-PPTX-A", "PGB-PPTX-B"],
      primaireFixture: "PGB-PPTX-A",
    },
  });
  assert.equal(uitkomst.fout, undefined);
  assert.equal(uitkomst.kandidatenVoorVerificatie, 2);
  assert.equal(uitkomst.meting.downloads, 2);
  assert.deepEqual(uitkomst.kandidaten.map((kandidaat) => kandidaat.fixtureCode), ["PGB-PPTX-A", "PGB-PPTX-B"]);
  assert.ok(uitkomst.kandidaten.every((kandidaat) => !kandidaat.passage.includes("verboden summary")));
  const meting = maakVeiligeMeetrij(1, {
    ...opdracht("candidate_union").vraag,
    verwachteFixtures: ["PGB-PPTX-A", "PGB-PPTX-B"],
    primaireFixture: "PGB-PPTX-A",
  }, uitkomst);
  assert.deepEqual({ precision: meting.precision, recall: meting.recall, mrr: meting.mrr, ndcg: meting.ndcg }, {
    precision: 1,
    recall: 1,
    mrr: 1,
    ndcg: 1,
  });
});

test("de spike implementeert het gemergde RetrievalAdapter-contract zonder productiewiring", async () => {
  const adapter = maakSharePointSpikeContractAdapter(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, rank: 1, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/embed" });
    throw new Error("onverwachte call");
  }), "microsoft_search");
  assert.deepEqual(adapter.capabilities(), {
    bronsoorten: ["sharepoint"],
    strategieen: ["gericht", "volledig", "vergelijk"],
    ondersteundeFilters: [],
    versiebewijs: true,
    versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
    permissionProof: true,
    preview: true,
    cancellation: true,
    timeout: true,
  });
  const uitkomst = await adapter.zoek({
    fondsId: IDS.fonds,
    actor: { soort: "gebruiker", id: IDS.actor },
    taaktype: "chat_generatie",
    bronbeleid: { bronsoorten: ["sharepoint"] },
    correlationId: opdracht("microsoft_search").correlationId,
    verzoekStartOp: "2026-09-10T09:00:00.000Z",
  }, {
    naam: "contractproef",
    origineleVraag: "Wat is de waarde?",
    zoekvraag: "oranje 314",
    strategie: "gericht",
    maxResultaten: 5,
    maxKandidaten: 20,
    maxContextTekens: 10_000,
  });
  assert.equal(uitkomst.provider, "microsoft");
  assert.equal(uitkomst.methode, "sharepoint_live");
  assert.equal(uitkomst.opgehaald, 1);
  assert.equal(uitkomst.kandidaten[0].bronsoort, "sharepoint");
  assert.equal(uitkomst.kandidaten[0].toegangscontrole?.correlationId, opdracht("microsoft_search").correlationId);
});

test("drive-search downloadt begrensd en extraheert PowerPoint uitsluitend in-memory met een dia-locator", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Blauwe achtergrondtekst</a:t></a:r></a:p></p:sld>");
  zip.file("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>De oranje kanariewaarde is 314</a:t></a:r></a:p></p:sld>");
  const pptx = await zip.generateAsync({ type: "uint8array" });
  const downloadUrl = "https://synthetisch-bestand.files.1drv.com/tijdelijk-downloadpad";
  let downloadZonderToken = false;
  const fetchImpl = async (url: string, init: RequestInit) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) return json({ value: [item()] });
    if (url.endsWith(`/items/${IDS.item}/content`)) {
      assert.equal(init.redirect, "manual");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer geheim-token");
      return new Response(null, { status: 302, headers: { Location: downloadUrl } });
    }
    if (url === downloadUrl) {
      downloadZonderToken = !new Headers(init.headers).has("Authorization") && init.redirect === "error";
      return new Response(new Uint8Array(pptx).buffer, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
    }
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/sites/retrieval/_layouts/15/embed.aspx?id=test" });
    throw new Error("onverwachte call");
  };
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(fetchImpl), opdracht("drive_search_extract"));
  assert.equal(uitkomst.kandidaten.length, 1);
  assert.equal(uitkomst.kandidaten[0].locator.pagina, 2);
  assert.equal(uitkomst.kandidaten[0].locator.paragraaf, "Dia 2");
  assert.match(uitkomst.kandidaten[0].passage, /kanariewaarde is 314/);
  assert.equal(uitkomst.meting.contentBytes, pptx.byteLength);
  assert.equal(downloadZonderToken, true);
});

test("drive-search laat een geldige DOCX na alle controles toe", async () => {
  const docx = readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/01 Vergaderstukken/2026-09 Bestuursvergadering/PGB354-DOC-001-Agenda-en-besluitpunten-september.docx"));
  const downloadUrl = "https://synthetisch-bestand.files.1drv.com/docx-download";
  const vraag = opdracht("drive_search_extract");
  vraag.vraag = { ...vraag.vraag, vraag: "Welke hersteltermijn geldt voor Koraalmaat 47?" };
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) return json({ value: [{ ...item(), name: "PGB354-DOC-001.docx" }] });
    if (url.includes(`/items/${IDS.item}?`)) return json({ ...item(), name: "PGB354-DOC-001.docx" });
    if (url.endsWith(`/items/${IDS.item}/content`)) return new Response(null, { status: 302, headers: { Location: downloadUrl } });
    if (url === downloadUrl) return new Response(docx);
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/embed" });
    throw new Error("onverwachte call");
  }, async () => bron({ documenten: [{ ...bron().documenten[0], bestandstype: "docx", titel: "PGB354-DOC-001" }] })), vraag);
  assert.equal(uitkomst.kandidaten.length, 1);
  assert.match(uitkomst.kandidaten[0].passage, /Koraalmaat 47/i);
  assert.equal(aantalAfwijzingen(uitkomst), 0);
});

test("actualiteitsbeleid is expliciet, laat de juiste PDF toe en downloadt of previewt de uitgesloten PDF nooit", async () => {
  const actualItem = "item-actueel";
  const historischItem = "item-historisch";
  const actualPdf = readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/02 Beleid en reglementen/PGB354-PDF-001-Beleggingskader-actueel.pdf"));
  const historischPdf = readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/03 Historisch en vervallen/PGB354-PDF-002-Beleggingskader-vervallen.pdf"));
  const maakItem = (id: string, naam: string) => ({
    ...item(),
    id,
    name: naam,
    webUrl: `https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot/${naam}`,
  });
  const bronMetStatussen = () => bron({
    documenten: [
      { fixtureCode: "PGB354-PDF-001", ref: `${IDS.ref}-actueel`, itemId: actualItem, titel: "Actueel", bestandstype: "pdf", fixtureStatus: "actueel" },
      { fixtureCode: "PGB354-PDF-002", ref: `${IDS.ref}-historisch`, itemId: historischItem, titel: "Historisch", bestandstype: "pdf", fixtureStatus: "historisch" },
    ],
  });
  const draai = async (actualiteitsbeleid: "alleen_actueel" | "alleen_historisch" | "actueel_en_historisch") => {
    const calls: string[] = [];
    const vraag = opdracht("drive_search_extract");
    vraag.vraag = { ...vraag.vraag, vraag: "Wat is de bandbreedte voor Maananker 61?", actualiteitsbeleid };
    const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
      calls.push(url);
      if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
      if (url.includes("/search(q=")) return json({ value: [maakItem(actualItem, "actueel.pdf"), maakItem(historischItem, "historisch.pdf")] });
      if (url.includes(`/items/${actualItem}?`)) return json(maakItem(actualItem, "actueel.pdf"));
      if (url.includes(`/items/${historischItem}?`)) return json(maakItem(historischItem, "historisch.pdf"));
      if (url.endsWith(`/items/${actualItem}/content`)) return new Response(null, { status: 302, headers: { Location: "https://synthetisch-bestand.files.1drv.com/actueel" } });
      if (url.endsWith(`/items/${historischItem}/content`)) return new Response(null, { status: 302, headers: { Location: "https://synthetisch-bestand.files.1drv.com/historisch" } });
      if (url === "https://synthetisch-bestand.files.1drv.com/actueel") return new Response(actualPdf);
      if (url === "https://synthetisch-bestand.files.1drv.com/historisch") return new Response(historischPdf);
      if (url.endsWith("/preview")) return json({ getUrl: "https://pgb.sharepoint.com/embed" });
      throw new Error("onverwachte call");
    }, async () => bronMetStatussen()), vraag);
    return { calls, uitkomst };
  };

  const actueel = await draai("alleen_actueel");
  assert.deepEqual(actueel.uitkomst.kandidaten.map((k) => k.fixtureCode), ["PGB354-PDF-001"]);
  assert.equal(actueel.uitkomst.afwijzingen.actualiteit, 1);
  assert.ok(actueel.calls.every((url) => !url.includes(`/items/${historischItem}/content`) && !url.includes(`/items/${historischItem}/preview`)));

  const historisch = await draai("alleen_historisch");
  assert.deepEqual(historisch.uitkomst.kandidaten.map((k) => k.fixtureCode), ["PGB354-PDF-002"]);
  assert.equal(historisch.uitkomst.kandidaten[0].status.actueel, false);
  assert.equal(historisch.uitkomst.afwijzingen.actualiteit, 1);
  assert.ok(historisch.calls.every((url) => !url.includes(`/items/${actualItem}/content`) && !url.includes(`/items/${actualItem}/preview`)));

  const vergelijking = await draai("actueel_en_historisch");
  assert.deepEqual(vergelijking.uitkomst.kandidaten.map((k) => k.fixtureCode).sort(), ["PGB354-PDF-001", "PGB354-PDF-002"]);
  assert.equal(vergelijking.uitkomst.afwijzingen.actualiteit, 0);
});

test("onbekende of conflicterende fixturestatus valt vóór item, content en preview exact eenmaal af", async () => {
  const draai = async (documenten: SpikeBronSnapshot["documenten"]) => {
    const calls: string[] = [];
    const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
      calls.push(url);
      if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
      if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
      throw new Error("statusafwijzing moet vóór de itemcall plaatsvinden");
    }, async () => bron({ documenten })), opdracht("microsoft_search"));
    assert.equal(uitkomst.afwijzingen.actualiteit, 1);
    assert.equal(aantalAfwijzingen(uitkomst), 1);
    assert.equal(calls.length, 2);
  };

  await draai([{ ...bron().documenten[0], fixtureStatus: "onbekend" as never }]);
  await draai([
    { ...bron().documenten[0], fixtureStatus: "actueel" },
    { ...bron().documenten[0], ref: `${IDS.ref}-conflict`, fixtureStatus: "historisch" },
  ]);
});

test("per-kandidaatfouten krijgen volgens de vaste fasevolgorde precies één categorie", async () => {
  const rechten = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json({}, 403);
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  assert.equal(rechten.afwijzingen.rechten_configuratie, 1);
  assert.equal(aantalAfwijzingen(rechten), 1);

  const extractie = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/content`)) return new Response(null, { status: 302, headers: { Location: "https://synthetisch-bestand.files.1drv.com/lege-extractie" } });
    if (url.endsWith("/lege-extractie")) return new Response(new Uint8Array([1, 2, 3]));
    throw new Error("preview mag na lege extractie niet worden bereikt");
  }), opdracht("microsoft_search"));
  assert.equal(extractie.afwijzingen.extractie, 1);
  assert.equal(aantalAfwijzingen(extractie), 1);

  const bindingVoorVersie = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json({ ...item(), eTag: undefined, cTag: undefined, file: null });
    throw new Error("latere fase mag niet worden bereikt");
  }), opdracht("microsoft_search"));
  assert.equal(bindingVoorVersie.afwijzingen.binding, 1);
  assert.equal(bindingVoorVersie.afwijzingen.versie, 0);
  assert.equal(aantalAfwijzingen(bindingVoorVersie), 1);
});

test("rate-limit en providerfout tijdens kandidaatcontrole blijven verzoekfataal", async () => {
  let ratelimitPogingen = 0;
  const rateLimit = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) {
      ratelimitPogingen += 1;
      return json({}, 429, { "Retry-After": "0" });
    }
    throw new Error("na rate-limit mag geen content- of previewcall starten");
  }), opdracht("microsoft_search"));
  assert.equal(ratelimitPogingen, 3);
  assert.equal(rateLimit.fout, "rate_limit");
  assert.equal(rateLimit.foutcode, "graph_ratelimit");
  assert.deepEqual(rateLimit.kandidaten, []);
  assert.equal(aantalAfwijzingen(rateLimit), 0);

  const providerfout = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json({}, 500);
    throw new Error("na providerfout mag geen content- of previewcall starten");
  }), opdracht("microsoft_search"));
  assert.equal(providerfout.fout, "providerfout");
  assert.equal(providerfout.foutcode, "graph_response");
  assert.deepEqual(providerfout.kandidaten, []);
  assert.equal(aantalAfwijzingen(providerfout), 0);
});

test("drive-search gebruikt vaste korte zoektermen afzonderlijk en ontdubbelt resultaten stabiel", async () => {
  const urls: string[] = [];
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Deze volledige vraag met leestekens mag Graph niet bereiken.</a:t></a:r></a:p></p:sld>");
  const pptx = await zip.generateAsync({ type: "uint8array" });
  const vraag = opdracht("drive_search_extract");
  vraag.vraag = {
    ...vraag.vraag,
    vraag: "Deze volledige vraag met leestekens? mag Graph niet bereiken.",
    driveZoektermen: ["Koraalmaat 47", "IJsvogelkompas 73"],
  };
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) {
      urls.push(url);
      return json({ value: [item()] });
    }
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/content`)) return new Response(null, { status: 302, headers: { Location: "https://synthetisch-bestand.files.1drv.com/download" } });
    if (url === "https://synthetisch-bestand.files.1drv.com/download") return new Response(new Uint8Array(pptx).buffer);
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/embed" });
    throw new Error("onverwachte call");
  }), vraag);
  assert.equal(uitkomst.kandidaten.length, 1);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes("Koraalmaat%2047"));
  assert.ok(urls[1].includes("IJsvogelkompas%2073"));
  assert.ok(urls.every((url) => !url.includes("leestekens")));
});

test("drive-search weigert een onbegrensd of ongeldig server-side zoekplan vóór de zoekcall", async () => {
  let zoekcalls = 0;
  const vraag = opdracht("drive_search_extract");
  vraag.vraag = { ...vraag.vraag, driveZoektermen: ["geldig", "", "ook geldig"] };
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) zoekcalls += 1;
    return json({ value: [] });
  }), vraag);
  assert.equal(uitkomst.fout, "configuratiefout");
  assert.equal(uitkomst.foutcode, "configuratie_gewijzigd");
  assert.equal(zoekcalls, 0);
});

test("intrekking tijdens het verzoek faalt gesloten en laat geen kandidaat door", async () => {
  let ingetrokken = false;
  const fetchImpl = async (url: string) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, rank: 1, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return ingetrokken ? json({}, 403) : json(item());
    throw new Error("preview mag na intrekking niet worden bereikt");
  };
  const deps = basisDeps(fetchImpl);
  deps.onFase = async (fase) => { if (fase === "voor_laatste_rechtencheck") ingetrokken = true; };
  const uitkomst = await voerSharePointRetrievalSpikeUit(deps, opdracht("microsoft_search"));
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.fout, "geen_resultaten");
  assert.equal(uitkomst.afwijzingen.rechten_configuratie, 1);
  assert.equal(aantalAfwijzingen(uitkomst), 1);
});

test("configuratiewijziging tijdens het verzoek faalt gesloten en laat geen kandidaat door", async () => {
  let gewijzigd = false;
  const fetchImpl = async (url: string) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, rank: 1, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/sites/retrieval/_layouts/15/embed.aspx?id=test" });
    throw new Error("onverwachte call");
  };
  const deps = basisDeps(fetchImpl, async () => bron({ configuratieversie: gewijzigd ? 8 : 7 }));
  deps.onFase = async (fase) => { if (fase === "na_content") gewijzigd = true; };
  const uitkomst = await voerSharePointRetrievalSpikeUit(deps, opdracht("microsoft_search"));
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.fout, "configuratiefout");
  assert.equal(uitkomst.foutcode, "configuratie_gewijzigd");
  assert.equal(aantalAfwijzingen(uitkomst), 0);
});

test("gewijzigde serververtrouwde fixturestatus zit in de fingerprint en faalt zonder versieverhoging verzoekfataal", async () => {
  let statusGewijzigd = false;
  const fetchImpl = async (url: string) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, rank: 1, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    throw new Error("preview mag na mappingdrift niet worden bereikt");
  };
  const deps = basisDeps(fetchImpl, async () => bron({
    documenten: [{
      fixtureCode: "PGB-PPTX-01",
      ref: IDS.ref,
      itemId: IDS.item,
      titel: "Synthetisch dek",
      bestandstype: "pptx",
      fixtureStatus: statusGewijzigd ? "historisch" : "actueel",
      geregistreerdMappad: "01 Vergaderstukken",
    }],
  }));
  deps.onFase = async (fase) => { if (fase === "na_content") statusGewijzigd = true; };
  const uitkomst = await voerSharePointRetrievalSpikeUit(deps, opdracht("microsoft_search"));
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.fout, "configuratiefout");
  assert.equal(uitkomst.foutcode, "configuratie_gewijzigd");
  assert.equal(aantalAfwijzingen(uitkomst), 0);
});

test("een lokale kandidaatfout slikt latere verzoekfatale configuratiedrift niet in", async () => {
  const eersteItem = "eerste-item";
  const tweedeItem = "tweede-item";
  const derdeItem = "derde-item";
  let gewijzigd = false;
  let calls = 0;
  const documenten: SpikeBronSnapshot["documenten"] = [
    { ...bron().documenten[0], itemId: eersteItem, ref: `${IDS.ref}-1` },
    { ...bron().documenten[0], itemId: tweedeItem, ref: `${IDS.ref}-2` },
    { ...bron().documenten[0], itemId: derdeItem, ref: `${IDS.ref}-3` },
  ];
  const leesBron = async () => bron({ configuratieversie: gewijzigd ? 8 : 7, documenten });
  const deps = basisDeps(async (url, init) => {
    calls += 1;
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [
      { hitId: eersteItem, rank: 1, summary: "oranje 314" },
      { hitId: tweedeItem, rank: 2, summary: "oranje 314" },
      { hitId: derdeItem, rank: 3, summary: "oranje 314" },
    ] }] }] });
    if (url.includes(`/items/${eersteItem}?`)) return json({ ...item(), id: eersteItem, parentReference: { ...item().parentReference, driveId: "andere-drive" } });
    if (url.includes(`/items/${tweedeItem}?`)) return json({ ...item(), id: tweedeItem });
    if (url.includes(`/items/${derdeItem}?`)) {
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    }
    throw new Error("preview mag na configuratiedrift niet worden bereikt");
  }, leesBron);
  deps.onFase = async (fase) => { if (fase === "na_content") gewijzigd = true; };
  const uitkomst = await voerSharePointRetrievalSpikeUit(deps, { ...opdracht("microsoft_search"), concurrency: 3 });
  assert.equal(uitkomst.fout, "configuratiefout");
  assert.equal(uitkomst.foutcode, "configuratie_gewijzigd");
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.afwijzingen.binding, 1);
  const callsNaDrift = calls;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  assert.equal(calls, callsNaDrift, "na fatale configuratiedrift mag geen Graph-call starten");
});

test("documentwijziging, ontbrekend versiebewijs en een vreemde hit komen nooit in de contextkandidaten", async () => {
  let checks = 0;
  const gewijzigd = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) { checks += 1; return json(item(checks === 1 ? '"v1"' : '"v2"')); }
    throw new Error("preview mag niet worden bereikt");
  }), opdracht("microsoft_search"));
  assert.deepEqual(gewijzigd.kandidaten, []);
  assert.equal(gewijzigd.fout, "geen_resultaten");
  assert.equal(gewijzigd.afwijzingen.versie, 1);
  assert.equal(aantalAfwijzingen(gewijzigd), 1);

  const zonderVersie = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json({ ...item(), eTag: undefined, cTag: undefined });
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  assert.equal(zonderVersie.fout, "geen_resultaten");
  assert.equal(zonderVersie.afwijzingen.versie, 1);
  assert.deepEqual(zonderVersie.kandidaten, []);

  let documentCall = false;
  const vreemdeHit = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: "ander-item", summary: "oranje 314" }] }] }] });
    documentCall = true;
    throw new Error("vreemde hit mag niet worden gevolgd");
  }), opdracht("microsoft_search"));
  assert.equal(documentCall, false);
  assert.equal(vreemdeHit.fout, "geen_resultaten");
  assert.equal(vreemdeHit.afwijzingen.mapping, 1);
  assert.equal(aantalAfwijzingen(vreemdeHit), 1);
  assert.equal(maakVeiligeMeetrij(1, opdracht("microsoft_search").vraag, vreemdeHit).precision, 0);
});

test("tenant- of actormismatch stopt vóór Graph en een zoek-403 levert geen resultaten", async () => {
  let graphCalls = 0;
  const mismatchDeps = basisDeps(async () => {
    graphCalls += 1;
    throw new Error("Graph mag niet worden bereikt");
  });
  mismatchDeps.delegatedToken = async () => ({ accessToken: "geheim-token", tenantId: "andere-tenant", actorObjectId: "private-oid" });
  const mismatch = await voerSharePointRetrievalSpikeUit(mismatchDeps, opdracht("microsoft_search"));
  assert.equal(graphCalls, 0);
  assert.equal(mismatch.fout, "buiten_scope");
  assert.equal(mismatch.foutcode, "actor_of_tenant_mismatch");

  const verkeerdeActorDeps = basisDeps(async () => {
    graphCalls += 1;
    throw new Error("Graph mag niet worden bereikt");
  });
  verkeerdeActorDeps.delegatedToken = async () => ({ accessToken: "geheim-token", tenantId: IDS.tenant, actorObjectId: "andere-private-oid" });
  const verkeerdeActor = await voerSharePointRetrievalSpikeUit(verkeerdeActorDeps, opdracht("microsoft_search"));
  assert.equal(graphCalls, 0);
  assert.equal(verkeerdeActor.fout, "buiten_scope");
  assert.equal(verkeerdeActor.foutcode, "actor_of_tenant_mismatch");

  const geweigerd = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({}, 403);
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  assert.deepEqual(geweigerd.kandidaten, []);
  assert.equal(geweigerd.fout, "toestemming_geweigerd");
  assert.equal(geweigerd.foutcode, "graph_toestemming");
});

test("drivebinding en parentreferenties bepalen rootlidmaatschap en falen buiten de root gesloten", async () => {
  const scenario = async (actueelItem: Record<string, unknown>) => voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(actueelItem);
    throw new Error("content of preview mag niet worden bereikt");
  }), opdracht("microsoft_search"));

  const andereDrive = await scenario({ ...item(), parentReference: { ...item().parentReference, driveId: "b!andere-drive" } });
  assert.deepEqual(andereDrive.kandidaten, []);
  assert.equal(andereDrive.fout, "geen_resultaten");
  assert.equal(andereDrive.afwijzingen.binding, 1);
  assert.equal(aantalAfwijzingen(andereDrive), 1);

  const verplaatst = await scenario({
    ...item(),
    parentReference: { ...item().parentReference, id: "andere-map", path: "/drives/x/root:/Buiten de pilot" },
    webUrl: "https://pgb.sharepoint.com/:p:/r/sites/retrieval/_layouts/15/Doc.aspx?sourcedoc=test",
  });
  assert.deepEqual(verplaatst.kandidaten, []);
  assert.equal(verplaatst.fout, "geen_resultaten");
  assert.equal(verplaatst.afwijzingen.root, 1);
  assert.equal(aantalAfwijzingen(verplaatst), 1);

  const gelijkendePrefix = await scenario({
    ...item(),
    parentReference: { ...item().parentReference, id: "andere-map", path: "/drives/x/root:/PGB Retrieval Pilot-aanvaller" },
  });
  assert.equal(gelijkendePrefix.fout, "geen_resultaten");
  assert.equal(gelijkendePrefix.afwijzingen.root, 1);
});

test("Word- en PowerPoint-weergave-URL's slagen via drive- en parentreferenties", async () => {
  for (const [type, bestandstype, fixtureCode, naam, mimeType, officeWebUrl] of [
    ["Word", "docx", "PGB-DOCX-01", "Synthetisch document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "https://pgb.sharepoint.com/:w:/r/sites/retrieval/_layouts/15/Doc.aspx?sourcedoc=word"],
    ["PowerPoint", "pptx", "PGB-PPTX-01", "Synthetisch dek.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "https://pgb.sharepoint.com/:p:/r/sites/retrieval/_layouts/15/Doc.aspx?sourcedoc=ppt"],
  ] as const) {
    const bronSnapshot = bron({
      documenten: [{ ...bron().documenten[0], fixtureCode, bestandstype, titel: naam }],
    });
    const fetchImpl = async (url: string) => {
      if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
      if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
      if (url.includes(`/items/${IDS.item}?`)) return json({
        ...item(),
        name: naam,
        file: { mimeType },
        parentReference: { driveId: IDS.drive, id: "onderliggende-map", path: "/drives/x/root:/PGB Retrieval Pilot/01 Vergaderstukken" },
        webUrl: officeWebUrl,
      });
      if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/sites/retrieval/_layouts/15/embed.aspx?id=test" });
      throw new Error(`onverwachte ${type}-call`);
    };

    const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(fetchImpl, async () => bronSnapshot), opdracht("microsoft_search"));
    assert.equal(uitkomst.fout, undefined, `${type} hoort niet door de Office-weergave-URL te worden afgewezen`);
    assert.equal(uitkomst.kandidaten.length, 1);
    assert.equal(uitkomst.kandidaten[0]?.locator.mappad, "01 Vergaderstukken");
    assert.equal(uitkomst.kandidaten[0]?.weergave?.bestandstype, bestandstype);
    assert.equal(aantalAfwijzingen(uitkomst), 0);
  }
});

test("onveilig paginavervolg, providerfout en ongeldige preview worden genormaliseerd", async () => {
  const onveiligVervolg = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) return json({ value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=privaat" });
    throw new Error("onveilig vervolg mag niet worden gevolgd");
  }), opdracht("drive_search_extract"));
  assert.equal(onveiligVervolg.fout, "providerfout");
  assert.equal(onveiligVervolg.foutcode, "onveilig_vervolgpad");

  let aanvallerAangeroepen = false;
  const onveiligeDownload = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) return json({ value: [item()] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/content`)) return new Response(null, { status: 302, headers: { Location: "https://aanvaller.example/bestand" } });
    aanvallerAangeroepen = true;
    throw new Error("onbetrouwbare downloadhost mag niet worden gevolgd");
  }), opdracht("drive_search_extract"));
  assert.equal(aanvallerAangeroepen, false);
  assert.equal(onveiligeDownload.fout, "geen_resultaten");
  assert.equal(onveiligeDownload.afwijzingen.extractie, 1);

  const providerfout = await voerSharePointRetrievalSpikeUit(basisDeps(async () => json({}, 500)), opdracht("microsoft_search"));
  assert.equal(providerfout.fout, "providerfout");
  assert.equal(providerfout.foutcode, "graph_response");

  const preview = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://aanvaller.example/embed" });
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  assert.deepEqual(preview.kandidaten, []);
  assert.equal(preview.fout, "geen_resultaten");
  assert.equal(preview.afwijzingen.preview, 1);
  assert.equal(aantalAfwijzingen(preview), 1);
});

test("permissionprobe doet uitsluitend één inhoudsvrije drive/root-search", async () => {
  let aangeroepenPad = "";
  const toegestaan = await voerSharePointPermissionProbeUit(basisDeps(async (url, init) => {
    aangeroepenPad = new URL(url).pathname;
    assert.ok(aangeroepenPad.includes(`/drives/${IDS.drive}/items/${IDS.root}/search`));
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer geheim-token");
    return json({ value: [] });
  }));
  assert.deepEqual(toegestaan, { status: "toegestaan", foutcode: null, latencyMs: 0, microsoftCalls: 1 });

  const geweigerd = await voerSharePointPermissionProbeUit(basisDeps(async () => json({}, 403)));
  assert.equal(geweigerd.status, "toestemming_geweigerd");
  assert.equal(geweigerd.foutcode, "graph_toestemming");
  assert.equal(geweigerd.microsoftCalls, 1);
  assert.equal(Object.keys(geweigerd).sort().join(","), "foutcode,latencyMs,microsoftCalls,status");

  const ongeldigeVraag = await voerSharePointPermissionProbeUit(basisDeps(async () => json({}, 400)));
  assert.equal(ongeldigeVraag.status, "providerfout");
  assert.equal(ongeldigeVraag.foutcode, "graph_bad_request");
});

test("standaardWacht ruimt zijn abort-listener ook na normaal aflopen op", async () => {
  const controller = new AbortController();
  const wacht = standaardWacht(0, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  await wacht;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("throttling, timeout en cancellation worden genormaliseerd zonder fallback", async () => {
  let zoekpogingen = 0;
  const throttled = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) {
      zoekpogingen += 1;
      return zoekpogingen === 1 ? json({}, 429, { "Retry-After": "0" }) : json({ value: [{ hitsContainers: [{ hits: [] }] }] });
    }
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  assert.equal(throttled.meting.throttles, 1);
  assert.equal(throttled.meting.retries, 1);

  let hangCalls = 0;
  const hang = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    hangCalls += 1;
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const timeout = await voerSharePointRetrievalSpikeUit(basisDeps(hang), { ...opdracht("microsoft_search"), timeoutMs: 5 });
  assert.equal(timeout.fout, "timeout");
  assert.deepEqual(timeout.kandidaten, []);
  const callsNaTimeout = hangCalls;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  assert.equal(hangCalls, callsNaTimeout, "na timeout mag geen retry, Graph-call of fallback starten");

  const controller = new AbortController();
  let cancelCalls = 0;
  const annuleerBijEersteCall = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    cancelCalls += 1;
    controller.abort();
    if (init.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
    else init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const geannuleerd = await voerSharePointRetrievalSpikeUit(basisDeps(annuleerBijEersteCall), { ...opdracht("microsoft_search"), signal: controller.signal });
  assert.equal(geannuleerd.fout, "annulering");
  assert.deepEqual(geannuleerd.kandidaten, []);
  const callsNaAnnulering = cancelCalls;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  assert.equal(cancelCalls, callsNaAnnulering, "na cancellation mag geen retry, Graph-call of fallback starten");
});

test("een lokale kandidaatfout slikt een latere kandidaat-timeout niet in", async () => {
  const eersteItem = "eerste-timeout-item";
  const tweedeItem = "tweede-timeout-item";
  const documenten: SpikeBronSnapshot["documenten"] = [
    { ...bron().documenten[0], itemId: eersteItem, ref: `${IDS.ref}-t1` },
    { ...bron().documenten[0], itemId: tweedeItem, ref: `${IDS.ref}-t2` },
  ];
  let calls = 0;
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url, init) => {
    calls += 1;
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.includes("/search(q=")) return json({ value: [
      { ...item(), id: eersteItem },
      { ...item(), id: tweedeItem },
    ] });
    if (url.includes(`/items/${eersteItem}?`)) return json({ ...item(), id: eersteItem, file: null });
    if (url.includes(`/items/${tweedeItem}?`)) return json({ ...item(), id: tweedeItem });
    if (url.endsWith(`/items/${tweedeItem}/content`)) {
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    }
    throw new Error("na timeout mag geen volgende call starten");
  }, async () => bron({ documenten })), { ...opdracht("drive_search_extract"), concurrency: 1, timeoutMs: 5 });
  assert.equal(uitkomst.fout, "timeout");
  assert.equal(uitkomst.afwijzingen.binding, 1);
  const callsNaTimeout = calls;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  assert.equal(calls, callsNaTimeout);
});

test("meetbewijs bevat geen token, vraag, passage of private Graph-identifiers", async () => {
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, rank: 1, summary: "oranje kanariewaarde is 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/embed" });
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  const rij = maakVeiligeMeetrij(1, opdracht("microsoft_search").vraag, uitkomst);
  const bewijs = JSON.stringify(rij);
  for (const geheim of ["geheim-token", IDS.item, IDS.drive, IDS.root, IDS.site, "oranje", "314", IDS.ref, IDS.actor, IDS.fonds]) {
    assert.doesNotMatch(bewijs, new RegExp(geheim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(rij.versieVingerafdrukken[0].length, 12);
});

test("meetbewijs is alleen geslaagd bij exact de vooraf verwachte bronset", async () => {
  const uitkomst = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, rank: 1, summary: "oranje kanariewaarde is 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(item());
    if (url.endsWith(`/items/${IDS.item}/preview`)) return json({ getUrl: "https://pgb.sharepoint.com/embed" });
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  const vraag = opdracht("microsoft_search").vraag;
  const exact = maakVeiligeMeetrij(1, vraag, uitkomst);
  assert.equal(exact.resultaat, "geslaagd");

  const extra = maakVeiligeMeetrij(1, vraag, {
    ...uitkomst,
    kandidaten: [
      ...uitkomst.kandidaten,
      { ...uitkomst.kandidaten[0], fixtureCode: "PGB-ONVERWACHT" },
    ],
  });
  assert.equal(extra.resultaat, "mislukt");
  assert.equal(extra.foutcategorie, "acceptatie_afwijking");
  assert.equal(extra.foutcode, "onverwachte_bronset");
  assert.equal(extra.recall, 1, "recall alleen mag een foutpositief niet groen maken");

  const ontbrekend = maakVeiligeMeetrij(1, { ...vraag, verwachteFixtures: [vraag.verwachteFixtures[0], "PGB-ONTBREEKT"] }, uitkomst);
  assert.equal(ontbrekend.resultaat, "mislukt");
  assert.equal(ontbrekend.foutcode, "onverwachte_bronset");
});
