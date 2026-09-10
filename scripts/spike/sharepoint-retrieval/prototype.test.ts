import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import JSZip from "jszip";
import {
  maakSharePointSpikeContractAdapter,
  maakVeiligeMeetrij,
  standaardWacht,
  voerSharePointPermissionProbeUit,
  voerSharePointRetrievalSpikeUit,
} from "./prototype";
import type { SpikeDependencies } from "./prototype";
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
    documenten: [{ fixtureCode: "PGB-PPTX-01", ref: IDS.ref, itemId: IDS.item, titel: "Synthetisch dek", bestandstype: "pptx", verwachteMappad: "01 Vergaderstukken" }],
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
  parentReference: { driveId: IDS.drive },
  webUrl: "https://pgb.sharepoint.com/sites/retrieval/PGB%20Retrieval%20Pilot",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function opdracht(route: SpikeRoute) {
  return {
    route,
    correlationId: "88888888-8888-4888-8888-888888888888",
    vraag: { code: "Q-PPTX", soort: "powerpoint" as const, vraag: "Wat is de oranje kanariewaarde?", verwachteFixtures: ["PGB-PPTX-01"], maxKandidaten: 10 },
  };
}

function basisDeps(fetchImpl: SpikeDependencies["fetchImpl"], leesBron = async () => bron()): SpikeDependencies {
  return {
    leesBron,
    delegatedToken: async () => ({ accessToken: "geheim-token", tenantId: IDS.tenant, actorObjectId: "private-oid" }),
    fetchImpl,
    nu: () => new Date("2026-09-10T09:00:00Z"),
    wacht: async () => undefined,
  };
}

test("Microsoft Search levert alleen na dubbele rechten-, versie-, config- en previewcheck een contractkandidaat", async () => {
  let itemChecks = 0;
  const fetchImpl = async (url: string) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ moreResultsAvailable: false, hits: [{ hitId: IDS.item, rank: 1, summary: "<c0>oranje</c0> kanariewaarde is 314 <ddd/>" }] }] }] });
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
  assert.equal(kandidaat.documentIdentiteit.documentId, IDS.ref);
  assert.deepEqual(kandidaat.versie, { soort: "etag", waarde: '"v1"', gecontroleerdOp: "2026-09-10T09:00:00.000Z" });
  assert.deepEqual(kandidaat.toegangscontrole, {
    toegestaan: true,
    gebruikerId: IDS.actor,
    correlationId: opdracht("microsoft_search").correlationId,
    gecontroleerdOp: "2026-09-10T09:00:00.000Z",
    basis: "delegated_user",
    bronconfiguratieVersie: 7,
  });
  assert.equal(kandidaat.passage, "oranje kanariewaarde is 314 …");
  assert.equal(kandidaat.previewMogelijk, true);
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
  assert.equal(uitkomst.fout, "toestemming_geweigerd");
  assert.equal(uitkomst.foutcode, "graph_toestemming");
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
});

test("gewijzigde lokale documentmapping faalt ook zonder hogere bronconfiguratieversie gesloten", async () => {
  let hernoemd = false;
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
      titel: hernoemd ? "Hernoemd synthetisch dek" : "Synthetisch dek",
      bestandstype: "pptx",
      geregistreerdMappad: hernoemd ? "02 Andere map" : "01 Vergaderstukken",
    }],
  }));
  deps.onFase = async (fase) => { if (fase === "na_content") hernoemd = true; };
  const uitkomst = await voerSharePointRetrievalSpikeUit(deps, opdracht("microsoft_search"));
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.equal(uitkomst.fout, "configuratiefout");
  assert.equal(uitkomst.foutcode, "configuratie_gewijzigd");
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
  assert.equal(gewijzigd.foutcode, "document_gewijzigd");

  const zonderVersie = await voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json({ ...item(), eTag: undefined, cTag: undefined });
    throw new Error("onverwachte call");
  }), opdracht("microsoft_search"));
  assert.equal(zonderVersie.fout, "versiebewijs_ontbreekt");
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

test("gemanipuleerde drive- of sitebinding en verplaatsing buiten de root falen gesloten", async () => {
  const scenario = async (actueelItem: Record<string, unknown>) => voerSharePointRetrievalSpikeUit(basisDeps(async (url) => {
    if (url.includes(`/items/${IDS.root}?`)) return json(rootItem);
    if (url.endsWith("/search/query")) return json({ value: [{ hitsContainers: [{ hits: [{ hitId: IDS.item, summary: "oranje 314" }] }] }] });
    if (url.includes(`/items/${IDS.item}?`)) return json(actueelItem);
    throw new Error("content of preview mag niet worden bereikt");
  }), opdracht("microsoft_search"));

  const andereDrive = await scenario({ ...item(), parentReference: { ...item().parentReference, driveId: "b!andere-drive" } });
  assert.deepEqual(andereDrive.kandidaten, []);
  assert.equal(andereDrive.fout, "geen_resultaten");

  const andereSite = await scenario({ ...item(), webUrl: "https://aanvaller.example/document.pptx" });
  assert.deepEqual(andereSite.kandidaten, []);
  assert.equal(andereSite.fout, "geen_resultaten");

  const verplaatst = await scenario({ ...item(), webUrl: "https://pgb.sharepoint.com/sites/retrieval/Buiten%20de%20pilot/document.pptx" });
  assert.deepEqual(verplaatst.kandidaten, []);
  assert.equal(verplaatst.fout, "geen_resultaten");
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
  assert.equal(onveiligeDownload.fout, "providerfout");
  assert.equal(onveiligeDownload.foutcode, "ongeldige_download_url");

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
  assert.equal(preview.fout, "providerfout");
  assert.equal(preview.foutcode, "ongeldige_preview_url");
});

test("permissionprobe doet uitsluitend één inhoudsvrije drive/root-search", async () => {
  let aangeroepenPad = "";
  const toegestaan = await voerSharePointPermissionProbeUit(basisDeps(async (url, init) => {
    aangeroepenPad = new URL(url).pathname;
    assert.ok(aangeroepenPad.includes(`/drives/${IDS.drive}/items/${IDS.root}/search`));
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer geheim-token");
    return json({ value: [] });
  }));
  assert.deepEqual(toegestaan, { status: "toegestaan", latencyMs: 0, microsoftCalls: 1 });

  const geweigerd = await voerSharePointPermissionProbeUit(basisDeps(async () => json({}, 403)));
  assert.equal(geweigerd.status, "toestemming_geweigerd");
  assert.equal(geweigerd.microsoftCalls, 1);
  assert.equal(Object.keys(geweigerd).sort().join(","), "latencyMs,microsoftCalls,status");
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

  const hang = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const timeout = await voerSharePointRetrievalSpikeUit(basisDeps(hang), { ...opdracht("microsoft_search"), timeoutMs: 5 });
  assert.equal(timeout.fout, "timeout");
  assert.deepEqual(timeout.kandidaten, []);

  const controller = new AbortController();
  controller.abort();
  const geannuleerd = await voerSharePointRetrievalSpikeUit(basisDeps(hang), { ...opdracht("microsoft_search"), signal: controller.signal });
  assert.equal(geannuleerd.fout, "annulering");
  assert.deepEqual(geannuleerd.kandidaten, []);
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
