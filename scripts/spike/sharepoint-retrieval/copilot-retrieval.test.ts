// ============================================================================
//  #407 — hermetische suite voor de Copilot Retrieval-meetarm.
// ----------------------------------------------------------------------------
//  Geen netwerk, geen database, geen Microsoft-permission, geen consent en geen
//  billing. Alle Graph-antwoorden komen uit stubs in dit bestand.
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
  COPILOT_LOKAAL_REQUESTBUDGET,
  COPILOT_MAX_RESULTATEN,
  COPILOT_MAX_VRAAGTEKENS,
  COPILOT_RETRIEVAL_URL,
  bouwCopilotFilterExpression,
  bouwCopilotQueryString,
  hitUrlBinnenRoot,
  lokaliseerExtract,
  normaliseerVoorLokalisatie,
  canoniekeWebUrl,
  voerCopilotRetrievalSpikeUit,
} from "./copilot-retrieval";
import { maakVeiligeMeetrij, voerSharePointRetrievalSpikeUit, verenigKandidaten } from "./prototype";
import type { SpikeDependencies, ZoekHit } from "./prototype";
import { bepaalSemantischeWinst, maakKwaliteitsrapport, vatVergelijkingSamen, verenigArmen, voerVergelijkingUit } from "./vergelijking";
import { SEMANTISCHE_SCENARIO_CODES, VERGELIJK_SCENARIO_CODES, vergelijkScenario } from "./vergelijking-scenarios";
import type { SpikeBronSnapshot, SpikeVraag, VeiligeVergelijkrij } from "./types";

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

const ROOT_WEB_URL = "https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot";
const HIT_WEB_URL = "https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot/Synthetisch%20dek.docx";
/** Zin die letterlijk in de gestubde bestandsinhoud staat. */
const EXTRACT_IN_BESTAND = "De oranje kanariewaarde is 314 en geldt tot nader order.";

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
    documenten: [{
      fixtureCode: "PGB-DOCX-01",
      ref: IDS.ref,
      itemId: IDS.item,
      titel: "Synthetisch dek",
      bestandstype: "docx",
      fixtureStatus: "actueel",
    }],
    ...overrides,
  };
}

const rootItem = {
  id: IDS.root,
  name: "PGB Retrieval Pilot",
  folder: { childCount: 1 },
  parentReference: { driveId: IDS.drive, id: "drive-root", path: "/drives/x/root:" },
  webUrl: ROOT_WEB_URL,
};

const item = (eTag = '"v1"') => ({
  id: IDS.item,
  name: "Synthetisch dek.docx",
  eTag,
  cTag: '"c1"',
  file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  parentReference: { driveId: IDS.drive, id: IDS.root, path: "/drives/x/root:/PGB Retrieval Pilot" },
  webUrl: HIT_WEB_URL,
  lastModifiedDateTime: "2026-09-10T08:00:00Z",
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const DOWNLOAD_URL = "https://synthetisch-bestand.files.1drv.com/copilot-extractie";
const inhoudMet = (zin: string) => (async () => {
  const docx = readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/01 Vergaderstukken/2026-09 Bestuursvergadering/PGB354-DOC-001-Agenda-en-besluitpunten-september.docx"));
  const zip = await JSZip.loadAsync(docx);
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${zin}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
})();

const standaardInhoud = inhoudMet(EXTRACT_IN_BESTAND);

function vraag(overrides: Partial<SpikeVraag> = {}): SpikeVraag {
  return {
    code: "Q-COPILOT",
    soort: "gericht",
    vraag: "Wat is de oranje kanariewaarde?",
    actualiteitsbeleid: "alleen_actueel",
    verwachteFixtures: ["PGB-DOCX-01"],
    primaireFixture: "PGB-DOCX-01",
    maxKandidaten: 10,
    ...overrides,
  };
}

interface StubOpties {
  hits?: Array<{ webUrl?: string; extracts?: Array<{ text?: string }> }>;
  retrievalResponse?: () => Response;
  /** Overschrijft de webUrl die Graph voor het geregistreerde item teruggeeft. */
  itemWebUrl?: string;
  inhoud?: Promise<Uint8Array>;
  itemEtags?: string[];
  leesBron?: () => Promise<SpikeBronSnapshot>;
}

interface Stub {
  deps: SpikeDependencies;
  urls: string[];
  bodies: string[];
  /** Elke uitgaande aanroep met HTTP-methode, voor de read-only-bewijstest. */
  methodes: Array<{ url: string; method: string }>;
}

function stub(opties: StubOpties = {}): Stub {
  const urls: string[] = [];
  const bodies: string[] = [];
  const methodes: Array<{ url: string; method: string }> = [];
  const etags = [...(opties.itemEtags ?? [])];
  let itemCall = 0;
  const inhoud = opties.inhoud ?? standaardInhoud;

  const fetchImpl: NonNullable<SpikeDependencies["fetchImpl"]> = async (url, init) => {
    urls.push(url);
    methodes.push({ url, method: (init.method ?? "GET").toUpperCase() });
    if (typeof init.body === "string") bodies.push(init.body);
    const pad = new URL(url).pathname;

    if (url === COPILOT_RETRIEVAL_URL) {
      if (opties.retrievalResponse) return opties.retrievalResponse();
      return json({
        retrievalHits: opties.hits ?? [{ webUrl: HIT_WEB_URL, extracts: [{ text: EXTRACT_IN_BESTAND }] }],
      });
    }
    // #407 — /shares is bewust verwijderd: Microsoft noemt daarvoor minimaal
    // delegated Files.ReadWrite, en deze spike mag geen schrijfrecht nodig
    // hebben. Elke aanroep is hier dus een harde testfout.
    if (pad.startsWith("/v1.0/shares/")) {
      throw new Error("/shares mag nooit worden aangeroepen (schrijfpermission)");
    }
    if (pad.endsWith(`/items/${IDS.root}`)) return json(rootItem);
    if (pad.endsWith(`/items/${IDS.item}/content`)) {
      return new Response(null, { status: 302, headers: { Location: DOWNLOAD_URL } });
    }
    if (url === DOWNLOAD_URL) return new Response((await inhoud).slice().buffer);
    if (pad.endsWith(`/items/${IDS.item}/preview`)) {
      return json({ getUrl: `${ROOT_WEB_URL}/preview` });
    }
    if (pad.endsWith(`/items/${IDS.item}`)) {
      const etag = etags.length > 0 ? etags[Math.min(itemCall, etags.length - 1)] : '"v1"';
      itemCall += 1;
      return json({ ...item(etag), ...(opties.itemWebUrl ? { webUrl: opties.itemWebUrl } : {}) });
    }
    // DriveItem search en Microsoft Search voor de vergelijkingsarmen.
    if (pad.includes("/search(")) return json({ value: [item()] });
    if (pad === "/v1.0/search/query") {
      return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, rank: 1, resource: { id: IDS.item } }] }] }] });
    }
    if (pad.endsWith("/list")) return json({ id: "88888888-8888-4888-8888-888888888888" });
    throw new Error(`onverwachte stub-url: ${url}`);
  };

  return {
    urls,
    bodies,
    methodes,
    deps: {
      leesBron: opties.leesBron ?? (async () => bron()),
      delegatedToken: async () => ({ accessToken: "geheim-token", tenantId: IDS.tenant, actorObjectId: "private-oid" }),
      fetchImpl,
      nu: () => new Date("2026-09-10T09:00:00Z"),
      wacht: async () => undefined,
    },
  };
}

function uitvoeren(s: Stub, v: SpikeVraag = vraag()) {
  return voerCopilotRetrievalSpikeUit(s.deps, {
    correlationId: "88888888-8888-4888-8888-888888888888",
    vraag: v,
  });
}

// ===========================================================================
//  T0 — vaste API- en productgrenzen
// ===========================================================================

test("de call gaat exact naar het v1.0-endpoint met dataSource sharePoint en een begrensd resultaatbudget", async () => {
  const s = stub();
  const uitkomst = await uitvoeren(s);

  assert.equal(uitkomst.kandidaten.length, 1);
  assert.equal(uitkomst.route, "copilot_retrieval");
  const retrievalCalls = s.urls.filter((url) => url === COPILOT_RETRIEVAL_URL);
  assert.equal(retrievalCalls.length, 1, "exact één retrievalcall per meting");
  assert.ok(!s.urls.some((url) => url.includes("/beta/")), "geen beta-endpoint");

  const body = JSON.parse(s.bodies[0]) as Record<string, unknown>;
  assert.equal(body.dataSource, "sharePoint");
  assert.equal(body.maximumNumberOfResults, 10);
  assert.ok((body.maximumNumberOfResults as number) <= COPILOT_MAX_RESULTATEN);
  // Opnieuw gecodeerd vanuit de gecontroleerde, gedecodeerde vorm.
  assert.equal(body.filterExpression, `path:"https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot"`);
  assert.ok(!(body.filterExpression as string).slice(6, -1).includes('"'), "geen quote binnen de scope-expressie");
  assert.equal(typeof body.queryString, "string");
  assert.ok((body.queryString as string).length <= COPILOT_MAX_VRAAGTEKENS);
});

test("het resultaatbudget wordt hard op 25 geclampt", async () => {
  const s = stub();
  await uitvoeren(s, vraag({ maxKandidaten: 500 }));
  assert.equal(JSON.parse(s.bodies[0]).maximumNumberOfResults, COPILOT_MAX_RESULTATEN);
});

test("alleen server-side allowlisted KQL; browserinvoer kan de scope niet wijzigen", () => {
  // De vaste vorm accepteert uitsluitend één padscope op een sharepoint.com-host.
  assert.equal(
    bouwCopilotFilterExpression("https://pgb.sharepoint.com/sites/retrieval/Root"),
    'path:"https://pgb.sharepoint.com/sites/retrieval/Root"',
  );
  for (const kwaad of [
    'https://pgb.sharepoint.com/sites/retrieval/Root" OR path:"https://pgb.sharepoint.com/sites/geheim',
    "https://pgb.sharepoint.com/sites/retrieval/Root?q=1",
    "https://pgb.sharepoint.com/sites/retrieval/Root#fragment",
    "https://evil.example.com/sites/retrieval/Root",
    "https://pgb.sharepoint.com.evil.example/sites/Root",
  ]) {
    assert.throws(() => bouwCopilotFilterExpression(kwaad), /copilot_filter_ongeldig/, kwaad);
  }
});

test("een ongeldige filterconstructie blokkeert vóór de netwerkcall", async () => {
  const s = stub({
    // Root met een quote erin: de filtervorm mag daar nooit op scopen.
    leesBron: async () => bron(),
  });
  const kapotteRoot = { ...rootItem, webUrl: 'https://pgb.sharepoint.com/sites/retrieval/Ro"ot' };
  const urls: string[] = [];
  const deps: SpikeDependencies = {
    ...s.deps,
    fetchImpl: async (url, init) => {
      urls.push(url);
      if (new URL(url).pathname.endsWith(`/items/${IDS.root}`)) return json(kapotteRoot);
      return s.deps.fetchImpl!(url, init);
    },
  };
  const uitkomst = await voerCopilotRetrievalSpikeUit(deps, { correlationId: "c", vraag: vraag() });
  assert.equal(uitkomst.kandidaten.length, 0);
  assert.equal(uitkomst.foutcode, "copilot_filter_ongeldig");
  assert.ok(!urls.includes(COPILOT_RETRIEVAL_URL), "er is geen ongescopede call vertrokken");
});

test("een lege of te lange vraag blokkeert vóór de netwerkcall", () => {
  assert.throws(() => bouwCopilotQueryString(vraag({ copilotVraag: "   " })), /copilot_vraag_ongeldig/);
  assert.throws(
    () => bouwCopilotQueryString(vraag({ copilotVraag: "a".repeat(COPILOT_MAX_VRAAGTEKENS + 1) })),
    /copilot_vraag_ongeldig/,
  );
  assert.equal(bouwCopilotQueryString(vraag({ copilotVraag: "Wat   geldt\nhier?" })), "Wat geldt hier?");
});

test("stubs voor leeg resultaat, 401, 403, 429 en 5xx leveren nul kandidaten zonder fallback", async () => {
  const leeg = await uitvoeren(stub({ hits: [] }));
  assert.deepEqual(leeg.kandidaten, []);
  assert.equal(leeg.fout, "geen_resultaten");

  for (const [status, categorie, code] of [
    // 401/403 zijn NIET tot één oorzaak te herleiden: ontbrekend consent óf een
    // ontbrekende licentie. De code blijft daarom neutraal.
    [401, "toestemming_geweigerd", "copilot_toegang_geweigerd"],
    [403, "toestemming_geweigerd", "copilot_toegang_geweigerd"],
    [500, "providerfout", "graph_response"],
  ] as const) {
    const s = stub({ retrievalResponse: () => json({ error: "x" }, status) });
    const uitkomst = await uitvoeren(s);
    assert.deepEqual(uitkomst.kandidaten, [], `status ${status}`);
    assert.equal(uitkomst.fout, categorie, `status ${status}`);
    assert.equal(uitkomst.foutcode, code, `status ${status}`);
    assert.ok(!s.urls.some((url) => url.includes("/search/query")), "geen fallback naar een andere route");
    assert.ok(!s.urls.some((url) => url.includes("/content")), "geen download na een providerfout");
  }
});

test("alleen 402 wijst op licentie of billing; 401/403 blijven neutraal", async () => {
  const s = stub({ retrievalResponse: () => json({ error: "payment required" }, 402) });
  const uitkomst = await uitvoeren(s);
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.fout, "toestemming_geweigerd");
  assert.equal(uitkomst.foutcode, "copilot_licentie_of_billing");
  assert.ok(!s.urls.some((url) => url.includes("/content")), "geen download na 402");
});

test("het requestbudget begrenst de FEITELIJKE Copilot-POST-pogingen, niet alleen het bereik", async () => {
  // Budget 1: precies één POST, ook al blijft Microsoft 429 antwoorden.
  const strikt = stub({ retrievalResponse: () => json({ error: "throttled" }, 429, { "Retry-After": "1" }) });
  const een = await voerCopilotRetrievalSpikeUit(strikt.deps, {
    correlationId: "c",
    vraag: vraag(),
    requestBudget: 1,
  });
  const strikteCalls = strikt.urls.filter((url) => url === COPILOT_RETRIEVAL_URL);
  assert.equal(strikteCalls.length, 1, "bij budget 1 vertrekt precies één Retrieval-request");
  assert.equal(een.fout, "rate_limit");
  assert.equal(een.meting.throttles, 1);
  assert.equal(een.meting.retries, 0, "geen enkele herhaling binnen budget 1");

  // De standaard is óók 1: een aanroeper die niets opgeeft, krijgt geen retries.
  const standaard = stub({ retrievalResponse: () => json({ error: "throttled" }, 429, { "Retry-After": "1" }) });
  await uitvoeren(standaard);
  assert.equal(
    standaard.urls.filter((url) => url === COPILOT_RETRIEVAL_URL).length,
    1,
    "de standaard laat evenmin meer dan één request vertrekken",
  );

  // Budget 3: backoff mag nu wél, maar nooit verder dan het budget.
  let pogingen = 0;
  const ruim = stub({
    retrievalResponse: () => {
      pogingen += 1;
      if (pogingen <= 2) return json({ error: "throttled" }, 429, { "Retry-After": "1" });
      return json({ retrievalHits: [{ webUrl: HIT_WEB_URL, extracts: [{ text: EXTRACT_IN_BESTAND }] }] });
    },
  });
  const drie = await voerCopilotRetrievalSpikeUit(ruim.deps, {
    correlationId: "c",
    vraag: vraag(),
    requestBudget: 3,
  });
  assert.equal(ruim.urls.filter((url) => url === COPILOT_RETRIEVAL_URL).length, 3);
  assert.equal(drie.kandidaten.length, 1);
  assert.equal(drie.meting.throttles, 2);
  assert.equal(drie.meting.retries, 2);
  assert.ok(pogingen <= COPILOT_LOKAAL_REQUESTBUDGET, "nooit boven de lokale bovengrens");
});

test("een mislukte of lege retrievalcall kost geen enkele item-read voor het locatorregister", async () => {
  const itemReads = (s: Stub) => s.urls.filter((url) => new URL(url).pathname.endsWith(`/items/${IDS.item}`)).length;

  for (const antwoord of [
    () => json({ error: "x" }, 402),
    () => json({ error: "x" }, 403),
    () => json({ error: "throttled" }, 429),
    () => json({ retrievalHits: [] }),
  ]) {
    const s = stub({ retrievalResponse: antwoord });
    await uitvoeren(s);
    assert.equal(itemReads(s), 0, "het register wordt pas bij een hit binnen de root gebouwd");
  }

  // Alleen een hit die de root-prefilter haalt, rechtvaardigt de item-reads.
  const buiten = stub({ hits: [{ webUrl: "https://pgb.sharepoint.com/sites/geheim/Stuk.docx", extracts: [{ text: EXTRACT_IN_BESTAND }] }] });
  await uitvoeren(buiten);
  assert.equal(itemReads(buiten), 0, "een hit buiten de root bouwt het register niet");
});

test("de arm roept nooit /shares aan en heeft dus geen schrijfpermission nodig", async () => {
  const s = stub();
  const uitkomst = await uitvoeren(s);
  assert.equal(uitkomst.kandidaten.length, 1, "de gelukkige route werkt zonder /shares");
  assert.ok(
    !s.urls.some((url) => new URL(url).pathname.startsWith("/v1.0/shares/")),
    "/shares vereist minimaal delegated Files.ReadWrite en mag hier nooit vertrekken",
  );
  // Read-only in de breedte: er bestaan precies twee POST's — de retrievalcall
  // zelf en de gedocumenteerde previewcall, die allebei niets muteren. Al het
  // overige verkeer is GET, en er vertrekt nooit een schrijfmethode.
  const posts = s.methodes.filter(({ method }) => method === "POST").map(({ url }) => new URL(url).pathname);
  assert.deepEqual(posts.sort(), [
    "/v1.0/copilot/retrieval",
    `/v1.0/drives/${encodeURIComponent(IDS.drive)}/items/${encodeURIComponent(IDS.item)}/preview`,
  ].sort());
  for (const { url, method } of s.methodes) {
    assert.ok(["GET", "POST"].includes(method), `onverwachte methode ${method} op ${url}`);
    assert.ok(!["PUT", "PATCH", "DELETE"].includes(method), `schrijfmethode gebruikt: ${method}`);
  }
});

test("timeout en cancellation starten geen nieuwe call, download of fallback", async () => {
  const s = stub({ retrievalResponse: () => { throw Object.assign(new Error("afgebroken"), { name: "TimeoutError" }); } });
  const timeout = await uitvoeren(s);
  assert.equal(timeout.fout, "timeout");
  assert.deepEqual(timeout.kandidaten, []);
  assert.ok(!s.urls.some((url) => url.includes("/content")));

  const controller = new AbortController();
  const s2 = stub({ retrievalResponse: () => { controller.abort(); throw Object.assign(new Error("afgebroken"), { name: "AbortError" }); } });
  const geannuleerd = await voerCopilotRetrievalSpikeUit(s2.deps, {
    correlationId: "c",
    vraag: vraag(),
    signal: controller.signal,
  });
  assert.equal(geannuleerd.fout, "annulering");
  assert.deepEqual(geannuleerd.kandidaten, []);
  assert.ok(!s2.urls.some((url) => url.includes("/content")));
});

// ===========================================================================
//  T1 — bewijs- en veiligheidsketen
// ===========================================================================

test("webUrl is alleen een locator: buiten-root-hits vallen af vóór élke vervolgcall", async () => {
  const s = stub({
    hits: [
      { webUrl: "https://pgb.sharepoint.com/sites/geheim/Andere%20map/Stuk.docx", extracts: [{ text: EXTRACT_IN_BESTAND }] },
      { webUrl: "https://evil.example.com/sites/retrieval/PGB%20Retrieval%20Pilot/Stuk.docx", extracts: [{ text: EXTRACT_IN_BESTAND }] },
      { webUrl: undefined, extracts: [{ text: EXTRACT_IN_BESTAND }] },
    ],
  });
  const uitkomst = await uitvoeren(s);
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.afwijzingen.root, 3);
  assert.ok(!s.urls.some((url) => new URL(url).pathname.startsWith("/v1.0/shares/")), "nooit een /shares-resolutie");
  assert.ok(!s.urls.some((url) => url.includes("/content")), "geen download buiten de root");
});

test("het locatorregister komt read-only uit de geregistreerde DriveItems; een onbekende URL valt af als mapping", async () => {
  // Hit binnen de root, maar op een pad dat wij nooit zelf hebben opgehaald.
  const onbekend = stub({
    hits: [{
      webUrl: `${ROOT_WEB_URL}/Niet%20geregistreerd.docx`,
      extracts: [{ text: EXTRACT_IN_BESTAND }],
    }],
  });
  const a = await uitvoeren(onbekend);
  assert.deepEqual(a.kandidaten, []);
  assert.equal(a.afwijzingen.mapping, 1);
  assert.ok(!onbekend.urls.some((url) => url.includes("/content")), "geen download voor een onbekende URL");

  // Het register wordt gebouwd uit gewone item-reads op het vertrouwde item-id.
  const goed = stub();
  const b = await uitvoeren(goed);
  assert.equal(b.kandidaten.length, 1);
  assert.ok(
    goed.urls.some((url) => new URL(url).pathname === `/v1.0/drives/${encodeURIComponent(IDS.drive)}/items/${encodeURIComponent(IDS.item)}`),
    "het item is op zijn eigen id gelezen",
  );
});

test("Office-weergave-URL's matchen niet op het bibliotheekpad en vallen fail-closed af", async () => {
  for (const weergave of [
    "https://pgb.sharepoint.com/:w:/r/sites/retrieval/PGB%20Retrieval%20Pilot/Synthetisch%20dek.docx?d=w123",
    "https://pgb.sharepoint.com/:p:/r/sites/retrieval/PGB%20Retrieval%20Pilot/Synthetisch%20dek.docx",
  ]) {
    const s = stub({ hits: [{ webUrl: weergave, extracts: [{ text: EXTRACT_IN_BESTAND }] }] });
    const uitkomst = await uitvoeren(s);
    assert.deepEqual(uitkomst.kandidaten, [], weergave);
    // Buiten het rootpad -> root; binnen het rootpad maar onbekend -> mapping.
    assert.equal(uitkomst.afwijzingen.root + uitkomst.afwijzingen.mapping, 1, weergave);
    assert.ok(!s.urls.some((url) => url.includes("/content")), weergave);
  }
});

test("canoniekeWebUrl vergelijkt op codering, hoofdletters en slashes, niet op query", () => {
  const basis = canoniekeWebUrl(HIT_WEB_URL, "pgb.sharepoint.com");
  assert.equal(basis, "https://pgb.sharepoint.com/sites/retrieval/PGB Retrieval Pilot/Synthetisch dek.docx");
  assert.equal(canoniekeWebUrl(`${HIT_WEB_URL}?web=1`, "pgb.sharepoint.com"), basis);
  assert.equal(canoniekeWebUrl(`${HIT_WEB_URL}#anker`, "pgb.sharepoint.com"), basis);
  assert.equal(
    canoniekeWebUrl("https://PGB.sharepoint.com/sites/retrieval/PGB Retrieval Pilot/Synthetisch dek.docx", "pgb.sharepoint.com"),
    basis,
  );
  assert.equal(canoniekeWebUrl("https://evil.example.com/x", "pgb.sharepoint.com"), null);
  assert.equal(canoniekeWebUrl(undefined, "pgb.sharepoint.com"), null);
});

test("een geregistreerd item waarvan de webUrl buiten de root ligt, levert geen sleutel", async () => {
  const s = stub({
    itemWebUrl: "https://pgb.sharepoint.com/sites/andere/Stuk.docx",
    hits: [{ webUrl: HIT_WEB_URL, extracts: [{ text: EXTRACT_IN_BESTAND }] }],
  });
  const uitkomst = await uitvoeren(s);
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.afwijzingen.mapping, 1);
  assert.ok(!s.urls.some((url) => url.includes("/content")));
});

test("hitUrlBinnenRoot accepteert alleen dezelfde host en een pad onder de root", () => {
  assert.equal(hitUrlBinnenRoot(HIT_WEB_URL, ROOT_WEB_URL, "pgb.sharepoint.com"), HIT_WEB_URL);
  assert.equal(hitUrlBinnenRoot(ROOT_WEB_URL, ROOT_WEB_URL, "pgb.sharepoint.com"), ROOT_WEB_URL);
  for (const buiten of [
    "https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20PilotX/Stuk.docx",
    "https://pgb.sharepoint.com/sites/andere/Stuk.docx",
    "http://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot/Stuk.docx",
    "https://pgb.sharepoint.com:8443/sites/retrieval/PGB%20Retrieval%20Pilot/Stuk.docx",
  ]) {
    assert.equal(hitUrlBinnenRoot(buiten, ROOT_WEB_URL, "pgb.sharepoint.com"), null, buiten);
  }
});

test("een raw extract komt nooit rechtstreeks in de passage of het citaat terecht", async () => {
  const microsoftTekst = "De oranje kanariewaarde is 314 en geldt tot nader order.";
  const s = stub({ hits: [{ webUrl: HIT_WEB_URL, extracts: [{ text: microsoftTekst }] }] });
  const uitkomst = await uitvoeren(s);
  assert.equal(uitkomst.kandidaten.length, 1);
  const passage = uitkomst.kandidaten[0].passage;
  // De passage is uit de eigen extractie opgebouwd; de bron daarvan is het
  // gedownloade bestand, niet de Microsoft-string.
  assert.ok(passage.includes("oranje kanariewaarde"));
  assert.ok(s.urls.some((url) => url.includes("/content")), "er is altijd zelf gedownload");
  assert.ok(s.urls.some((url) => url === DOWNLOAD_URL));
});

test("een extract dat niet in de actuele eigen extractie staat, valt fail-closed af als lokalisatie", async () => {
  const s = stub({ hits: [{ webUrl: HIT_WEB_URL, extracts: [{ text: "Deze zin staat nergens in het actuele bestand en is verzonnen." }] }] });
  const uitkomst = await uitvoeren(s);
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.afwijzingen.lokalisatie, 1);
  assert.equal(uitkomst.afwijzingen.extractie, 0, "lokalisatie en extractie worden niet op één hoop gegooid");
  assert.equal(uitkomst.gelokaliseerdeExtracts, 0);
  assert.equal(uitkomst.aangebodenExtracts, 1);
});

test("een ontbrekend of te kort extract levert geen passage op", async () => {
  const geen = await uitvoeren(stub({ hits: [{ webUrl: HIT_WEB_URL, extracts: [] }] }));
  assert.deepEqual(geen.kandidaten, []);
  assert.equal(geen.afwijzingen.lokalisatie, 1);

  const kort = await uitvoeren(stub({ hits: [{ webUrl: HIT_WEB_URL, extracts: [{ text: "314" }] }] }));
  assert.deepEqual(kort.kandidaten, []);
  assert.equal(kort.afwijzingen.lokalisatie, 1);
});

test("een ambigu extract dat meermaals voorkomt, valt af in plaats van willekeurig te citeren", async () => {
  const herhaald = "De oranje kanariewaarde is 314 en geldt tot nader order.";
  const uitkomst = await uitvoeren(stub({
    inhoud: inhoudMet(`${herhaald} Tussenzin. ${herhaald}`),
    hits: [{ webUrl: HIT_WEB_URL, extracts: [{ text: herhaald }] }],
  }));
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.afwijzingen.lokalisatie, 1);
});

test("lokalisatie normaliseert opmaak maar niet de betekenis", () => {
  const segmenten = [{ pagina: null, paragraaf: null, tekst: "De  oranje “kanariewaarde” is 314 – en geldt tot nader order." }];
  assert.ok(lokaliseerExtract(segmenten, 'De oranje "kanariewaarde" is 314 - en geldt tot nader order.'));
  assert.equal(lokaliseerExtract(segmenten, "De oranje kanariewaarde is 315 en geldt tot nader order."), null);
  assert.equal(normaliseerVoorLokalisatie("A  B’s"), "a b's");
});

test("gewijzigde inhoud tijdens het verzoek faalt gesloten op de dubbele versiecontrole", async () => {
  // Drie item-reads: één voor het locatorregister, daarna de eerste en de
  // laatste versiecontrole van de keten. De inhoud kantelt pas tussen die
  // laatste twee, want juist dát moet de dubbele controle betrappen.
  const s = stub({ itemEtags: ['"v1"', '"v1"', '"v2"'] });
  const uitkomst = await uitvoeren(s);
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.afwijzingen.versie, 1);
});

test("intrekking tijdens het verzoek laat geen kandidaat door", async () => {
  const s = stub();
  let ingetrokken = false;
  const deps: SpikeDependencies = {
    ...s.deps,
    onFase: async (fase) => { if (fase === "na_content") ingetrokken = true; },
    fetchImpl: async (url, init) => {
      const pad = new URL(url).pathname;
      if (ingetrokken && pad.endsWith(`/items/${IDS.item}`)) return json({ error: "geen toegang" }, 403);
      return s.deps.fetchImpl!(url, init);
    },
  };
  const uitkomst = await voerCopilotRetrievalSpikeUit(deps, { correlationId: "c", vraag: vraag() });
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.afwijzingen.rechten_configuratie, 1);
});

test("actor-, tenant- en bronconfiguratiedrift falen gesloten vóór Graph", async () => {
  const s = stub();
  const mismatch = await voerCopilotRetrievalSpikeUit({
    ...s.deps,
    delegatedToken: async () => ({ accessToken: "t", tenantId: "andere-tenant", actorObjectId: "private-oid" }),
  }, { correlationId: "c", vraag: vraag() });
  assert.equal(mismatch.foutcode, "actor_of_tenant_mismatch");
  assert.equal(s.urls.length, 0, "geen enkele Graph-call bij identiteitsdrift");

  let lezingen = 0;
  const drift = stub();
  const uitkomst = await voerCopilotRetrievalSpikeUit({
    ...drift.deps,
    leesBron: async () => {
      lezingen += 1;
      return lezingen === 1 ? bron() : bron({ configuratieversie: 8 });
    },
  }, { correlationId: "c", vraag: vraag() });
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.foutcode, "configuratie_gewijzigd");
});

test("een geweigerde hit bereikt geen ranking, context, citaat, preview of audit", async () => {
  const s = stub({ hits: [{ webUrl: HIT_WEB_URL, extracts: [{ text: "Verzonnen zin die nergens staat in dit bestand." }] }] });
  const uitkomst = await uitvoeren(s);
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.ok(!s.urls.some((url) => url.includes("/preview")), "geen previewcall voor een geweigerde hit");
  const rij = maakVeiligeMeetrij(1, vraag(), uitkomst);
  assert.deepEqual(rij.gevondenFixtures, []);
  assert.equal(rij.previewDekking, 1, "lege bronset levert geen previewbewijs én geen valse dekking");
});

test("meetbewijs bevat geen token, vraag, passage, extract of private Graph-identifier", async () => {
  const uitkomst = await uitvoeren(stub());
  const rij = maakVeiligeMeetrij(1, vraag(), uitkomst);
  const serialisatie = JSON.stringify(rij);
  for (const geheim of [
    "geheim-token",
    "oranje kanariewaarde",
    EXTRACT_IN_BESTAND,
    IDS.item,
    IDS.drive,
    IDS.root,
    IDS.site,
    "private-oid",
    "pgb.sharepoint.com",
  ]) {
    assert.ok(!serialisatie.includes(geheim), `lek: ${geheim}`);
  }
  assert.deepEqual(rij.gevondenFixtures, ["PGB-DOCX-01"]);
});

// ===========================================================================
//  T2 — hermetische kwaliteitsvergelijking
// ===========================================================================

test("de vergelijking draait vier armen en de unie doet zelf geen enkele Graph-call", async () => {
  const s = stub();
  const rijen = await voerVergelijkingUit(s.deps, {
    ronde: 1,
    vraag: vraag(),
    correlationId: () => "88888888-8888-4888-8888-888888888888",
  });
  assert.deepEqual(rijen.map((rij) => rij.route), [
    "drive_search_extract",
    "microsoft_search",
    "copilot_retrieval",
    "candidate_union",
  ]);
  const unie = rijen[3];
  const primair = rijen.slice(0, 3);
  assert.equal(unie.microsoftCalls, primair.reduce((som, rij) => som + rij.microsoftCalls, 0));
  assert.equal(unie.downloads, primair.reduce((som, rij) => som + rij.downloads, 0));
  // De unie ontdubbelt: dezelfde fixture uit drie armen levert één bron.
  assert.deepEqual(unie.gevondenFixtures, ["PGB-DOCX-01"]);
  assert.ok(unie.exacteBronset);
});

test("de samenvatting rapporteert per arm alle geëiste maten", () => {
  const rij = (route: VeiligeVergelijkrij["route"], overrides: Partial<VeiligeVergelijkrij> = {}): VeiligeVergelijkrij => ({
    ronde: 1,
    vraagcode: "S02",
    route,
    searchScope: null,
    resultaat: "geslaagd",
    foutcategorie: null,
    foutcode: null,
    gevondenFixtures: ["PGB354-DOC-001"],
    exacteBronset: true,
    recall: 1,
    precision: 1,
    mrr: 1,
    ndcg: 1,
    locatorDekking: 1,
    versieDekking: 1,
    previewDekking: 1,
    latencyMs: 120,
    microsoftCalls: 6,
    downloads: 1,
    kandidatenVoorVerificatie: 1,
    responseBytes: 900,
    contentBytes: 1_200,
    throttles: 0,
    retries: 0,
    versieVingerafdrukken: ["abcdef012345"],
    afwijzingMapping: 0,
    afwijzingBinding: 0,
    afwijzingRoot: 0,
    afwijzingRechtenConfiguratie: 0,
    afwijzingVersie: 0,
    afwijzingExtractie: 0,
    afwijzingPreview: 0,
    afwijzingActualiteit: 0,
    afwijzingLokalisatie: 0,
    extractLokalisatieDekking: 0,
    semantisch: false,
    ...overrides,
  });

  const samenvatting = vatVergelijkingSamen([
    rij("drive_search_extract"),
    rij("microsoft_search", { recall: 0, gevondenFixtures: [], exacteBronset: false, latencyMs: 400 }),
    rij("copilot_retrieval", { extractLokalisatieDekking: 1, afwijzingLokalisatie: 2 }),
  ]);
  assert.deepEqual(samenvatting.map((arm) => arm.arm), ["drive_search_extract", "microsoft_search", "copilot_retrieval"]);
  const copilot = samenvatting[2];
  assert.equal(copilot.extractLokalisatieDekking, 1);
  assert.equal(copilot.afvalPerControle.lokalisatie, 2);
  assert.equal(copilot.mediaanLatencyMs, 120);
  assert.equal(copilot.p95LatencyMs, 120);
  assert.equal(copilot.actualiteitscorrectheid, 1);
  assert.equal(samenvatting[1].actualiteitscorrectheid, 0);
  for (const veld of ["recall", "precision", "mrr", "ndcg", "locatorDekking", "passageDekking", "versieDekking", "previewDekking", "throttles", "retries", "downloads", "responseBytes", "contentBytes"] as const) {
    assert.equal(typeof copilot[veld], "number", veld);
  }
});

test("semantische winst telt alleen zonder bronsetvervuiling", () => {
  const basis = {
    ronde: 1,
    vraagcode: "SEM01",
    searchScope: null,
    resultaat: "geslaagd" as const,
    foutcategorie: null,
    foutcode: null,
    exacteBronset: true,
    precision: 1,
    mrr: 1,
    ndcg: 1,
    locatorDekking: 1,
    versieDekking: 1,
    previewDekking: 1,
    latencyMs: 100,
    microsoftCalls: 1,
    downloads: 1,
    kandidatenVoorVerificatie: 1,
    responseBytes: 1,
    contentBytes: 1,
    throttles: 0,
    retries: 0,
    versieVingerafdrukken: [],
    afwijzingMapping: 0,
    afwijzingBinding: 0,
    afwijzingRoot: 0,
    afwijzingRechtenConfiguratie: 0,
    afwijzingVersie: 0,
    afwijzingExtractie: 0,
    afwijzingPreview: 0,
    afwijzingActualiteit: 0,
    afwijzingLokalisatie: 0,
    extractLokalisatieDekking: 0,
    semantisch: true,
  };
  const winst = bepaalSemantischeWinst([
    { ...basis, route: "drive_search_extract", recall: 0, gevondenFixtures: [] },
    { ...basis, route: "microsoft_search", recall: 0, gevondenFixtures: [] },
    { ...basis, route: "copilot_retrieval", recall: 1, gevondenFixtures: ["PGB407-DOC-101"] },
  ]);
  const copilot = winst.find((arm) => arm.arm === "copilot_retrieval")!;
  assert.equal(copilot.semantischeRecall, 1);
  assert.equal(copilot.lexicaleReferentie, 0);
  assert.equal(copilot.winst, 1);
  assert.equal(copilot.bronsetvervuiling, 0);

  const vervuild = bepaalSemantischeWinst([
    { ...basis, route: "copilot_retrieval", recall: 1, exacteBronset: false, gevondenFixtures: ["PGB407-DOC-101", "PGB354-DOC-001"] },
  ]);
  assert.equal(vervuild[0].bronsetvervuiling, 1, "extra bron maakt de winst onbruikbaar voor het besluit");
});

test("de vaste scenarioset bevat de acceptatieset en minimaal twee semantische scenario's", () => {
  for (const code of ["S02", "S03", "S04", "S04H"]) assert.ok(VERGELIJK_SCENARIO_CODES.includes(code as never), code);
  assert.ok(SEMANTISCHE_SCENARIO_CODES.length >= 2, "minimaal twee semantische scenario's");
  for (const code of VERGELIJK_SCENARIO_CODES) {
    const scenario = vergelijkScenario(code);
    assert.ok(scenario.copilotVraag && scenario.copilotVraag.length <= COPILOT_MAX_VRAAGTEKENS, code);
    assert.ok(scenario.verwachteFixtures.length >= 0, code);
    if (scenario.primaireFixture) assert.ok(scenario.verwachteFixtures.includes(scenario.primaireFixture), code);
  }
  // Een semantisch scenario mag zijn doelbron niet met een letterlijke
  // canary-term uit de vraag verraden.
  for (const code of SEMANTISCHE_SCENARIO_CODES) {
    const scenario = vergelijkScenario(code);
    assert.ok(!/\b(Koraalmaat|Maananker|IJsvogelkompas|Nachtlelie|Saffierhek|Duinglas|Bronzenveer)\b/.test(scenario.vraag), code);
  }
});

test("het kwaliteitsrapport is inhoudsvrij en markeert dat niets persistent is opgeslagen", async () => {
  const s = stub();
  const rijen: VeiligeVergelijkrij[] = [];
  for (const ronde of [1, 2]) {
    rijen.push(...await voerVergelijkingUit(s.deps, {
      ronde,
      vraag: vraag(),
      correlationId: () => "88888888-8888-4888-8888-888888888888",
    }));
  }
  const rapport = maakKwaliteitsrapport({
    doel: "PGB Preview-pilot",
    gemetenOp: "2026-09-18T10:00:00.000Z",
    rondes: 2,
    armen: ["drive_search_extract", "microsoft_search", "copilot_retrieval", "candidate_union"],
    rijen,
  });
  assert.equal(rapport.inhoudPersistentOpgeslagen, false);
  assert.equal(rapport.samenvatting.length, 4);
  const serialisatie = JSON.stringify(rapport);
  for (const geheim of ["geheim-token", EXTRACT_IN_BESTAND, IDS.item, IDS.drive, "private-oid", "Wat is de oranje kanariewaarde?"]) {
    assert.ok(!serialisatie.includes(geheim), `lek: ${geheim}`);
  }
});

// ===========================================================================
//  Regressie: de drie bestaande routes blijven gedragsmatig ongewijzigd
// ===========================================================================

test("de meetunie over twee lijsten is bit-identiek aan het gedrag van #353", () => {
  const drive: ZoekHit[] = [{ itemId: "a", positie: 1, score: null }, { itemId: "b", positie: 2, score: null }];
  const microsoft: ZoekHit[] = [{ itemId: "b", positie: 1, score: 0.9 }, { itemId: "c", positie: 2, score: 0.8 }];
  const RRF_K = 60;
  const verwacht = [
    { itemId: "b", som: 1 / (RRF_K + 2) + 1 / (RRF_K + 1) },
    { itemId: "a", som: 1 / (RRF_K + 1) },
    { itemId: "c", som: 1 / (RRF_K + 2) },
  ].sort((x, y) => y.som - x.som || x.itemId.localeCompare(y.itemId));
  assert.deepEqual(
    verenigKandidaten(drive, microsoft, 10).map((hit) => hit.itemId),
    verwacht.map((waarde) => waarde.itemId),
  );
});

test("zonder Copilot-arm gedraagt de bestaande drive-route zich onveranderd", async () => {
  const s = stub();
  const uitkomst = await voerSharePointRetrievalSpikeUit(s.deps, {
    route: "drive_search_extract",
    correlationId: "88888888-8888-4888-8888-888888888888",
    vraag: vraag(),
  });
  assert.equal(uitkomst.route, "drive_search_extract");
  assert.equal(uitkomst.kandidaten.length, 1);
  assert.equal(uitkomst.afwijzingen.lokalisatie, 0, "de lexicale routes raken de lokalisatieteller nooit");
  assert.ok(!s.urls.includes(COPILOT_RETRIEVAL_URL), "de bestaande route roept Copilot nooit aan");
});

test("verenigArmen laat niets toe dat geen enkele arm zelfstandig heeft bewezen", () => {
  const unie = verenigArmen(1, vraag(), []);
  assert.deepEqual(unie.gevondenFixtures, []);
  assert.equal(unie.route, "candidate_union");
  assert.equal(unie.microsoftCalls, 0);
  assert.equal(unie.downloads, 0);
});
